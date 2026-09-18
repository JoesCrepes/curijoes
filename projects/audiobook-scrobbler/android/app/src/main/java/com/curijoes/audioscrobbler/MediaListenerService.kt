package com.curijoes.audioscrobbler

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

/**
 * The capture side. Notification access is only the permission gate: this
 * service never reads notifications, it uses MediaSessionManager to watch
 * the players' media sessions and logs every change to the outbox.
 */
class MediaListenerService : NotificationListenerService() {

    private class Tracked(val controller: MediaController, val callback: MediaController.Callback) {
        var metaSig = ""
        var queueSig = ""
        var lastState = PlaybackState.STATE_NONE
    }

    private lateinit var msm: MediaSessionManager
    private lateinit var prefs: Prefs
    private lateinit var store: EventStore
    private val handler = Handler(Looper.getMainLooper())
    private val tracked = HashMap<String, Tracked>()
    private val component by lazy { ComponentName(this, MediaListenerService::class.java) }

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { controllers -> sync(controllers ?: emptyList()) }

    private val sampler = object : Runnable {
        override fun run() {
            for ((pkg, t) in tracked) {
                if (t.controller.playbackState?.state == PlaybackState.STATE_PLAYING) emit("position", pkg, t)
            }
            handler.postDelayed(this, SAMPLE_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        store = EventStore.get(this)
        msm = getSystemService(MEDIA_SESSION_SERVICE) as MediaSessionManager
        try {
            msm.addOnActiveSessionsChangedListener(sessionsListener, component)
            sync(msm.getActiveSessions(component))
        } catch (e: SecurityException) {
            ServiceState.lastError = "notification access not granted"
            Log.w(TAG, "no notification access yet", e)
        }
        handler.postDelayed(sampler, SAMPLE_MS)
    }

    override fun onListenerConnected() {
        ServiceState.connected = true
        try { sync(msm.getActiveSessions(component)) } catch (e: SecurityException) { Log.w(TAG, "sync on connect", e) }
    }

    override fun onListenerDisconnected() {
        ServiceState.connected = false
    }

    override fun onDestroy() {
        handler.removeCallbacks(sampler)
        try { msm.removeOnActiveSessionsChangedListener(sessionsListener) } catch (_: Exception) {}
        for ((_, t) in tracked) t.controller.unregisterCallback(t.callback)
        tracked.clear()
        super.onDestroy()
    }

    private fun sync(controllers: List<MediaController>) {
        val seen = HashSet<String>()
        for (c in controllers) {
            val pkg = c.packageName
            seen.add(pkg)
            if (!prefs.shouldCapture(pkg)) continue
            if (tracked.containsKey(pkg)) continue
            val t = Tracked(c, object : MediaController.Callback() {
                override fun onMetadataChanged(metadata: MediaMetadata?) = onMeta(pkg)
                override fun onPlaybackStateChanged(state: PlaybackState?) = onState(pkg)
                override fun onQueueChanged(queue: MutableList<MediaSession.QueueItem>?) = onQueue(pkg)
                override fun onSessionDestroyed() = untrack(pkg, destroyed = true)
            })
            c.registerCallback(t.callback, handler)
            tracked[pkg] = t
            // Initial snapshot so a session that was already playing is captured.
            t.metaSig = EventBuilder.metadataSignature(c.metadata)
            t.queueSig = EventBuilder.queueSignature(c.queue)
            t.lastState = c.playbackState?.state ?: PlaybackState.STATE_NONE
            if (c.metadata != null) emit("metadata", pkg, t)
            if (!c.queue.isNullOrEmpty()) emit("queue", pkg, t, c.queue)
            if (t.lastState == PlaybackState.STATE_PLAYING) emit("play", pkg, t)
        }
        for (pkg in tracked.keys.toList()) if (pkg !in seen) untrack(pkg, destroyed = false)
        ServiceState.sessions = controllers.map { c ->
            val st = c.playbackState?.state
            "${c.packageName}${if (tracked.containsKey(c.packageName)) "" else " (ignored)"} state=$st"
        }
    }

    private fun untrack(pkg: String, destroyed: Boolean) {
        val t = tracked.remove(pkg) ?: return
        if (t.lastState == PlaybackState.STATE_PLAYING) emit("stop", pkg, t)
        if (!destroyed) try { t.controller.unregisterCallback(t.callback) } catch (_: Exception) {}
    }

    private fun onMeta(pkg: String) {
        val t = tracked[pkg] ?: return
        val sig = EventBuilder.metadataSignature(t.controller.metadata)
        if (sig == t.metaSig) return
        t.metaSig = sig
        emit("metadata", pkg, t)
    }

    private fun onQueue(pkg: String) {
        val t = tracked[pkg] ?: return
        val q = t.controller.queue
        val sig = EventBuilder.queueSignature(q)
        if (sig == t.queueSig) return
        t.queueSig = sig
        if (!q.isNullOrEmpty()) emit("queue", pkg, t, q)
    }

    private fun onState(pkg: String) {
        val t = tracked[pkg] ?: return
        val s = t.controller.playbackState?.state ?: PlaybackState.STATE_NONE
        val was = t.lastState
        if (s == was) {
            // Same state but a new snapshot: a seek while playing/paused. Log it as a position tick.
            if (s == PlaybackState.STATE_PLAYING || s == PlaybackState.STATE_PAUSED) emit("position", pkg, t)
            return
        }
        t.lastState = s
        when (s) {
            PlaybackState.STATE_PLAYING -> emit("play", pkg, t)
            PlaybackState.STATE_PAUSED -> if (was == PlaybackState.STATE_PLAYING || was == PlaybackState.STATE_BUFFERING) emit("pause", pkg, t)
            PlaybackState.STATE_STOPPED, PlaybackState.STATE_NONE -> if (was == PlaybackState.STATE_PLAYING || was == PlaybackState.STATE_PAUSED) emit("stop", pkg, t)
            else -> {}
        }
    }

    private fun emit(type: String, pkg: String, t: Tracked, queue: List<MediaSession.QueueItem>? = null) {
        try {
            store.insert(EventBuilder.build(type, pkg, t.controller, queue))
            scheduleUpload(this)
        } catch (e: Exception) {
            ServiceState.lastError = "emit: ${e.message}"
            Log.e(TAG, "emit failed", e)
        }
    }

    companion object {
        private const val TAG = "MediaListener"
        private const val SAMPLE_MS = 60_000L

        fun scheduleUpload(context: android.content.Context) {
            val req = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("upload", ExistingWorkPolicy.KEEP, req)
        }
    }
}
