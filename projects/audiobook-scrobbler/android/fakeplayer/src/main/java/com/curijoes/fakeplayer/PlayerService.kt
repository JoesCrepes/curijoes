package com.curijoes.fakeplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaDescription
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log

/**
 * A scripted audiobook player. It owns one MediaSession and mutates it in
 * response to intents (forwarded by MainActivity from `adb shell am start`):
 *
 *   LOAD    --es title --es author [--es narrator] [--ei chapters N] [--el chapter_ms MS]
 *           [--es chapter_ms_list "a,b,c"] [--es layout audible|libby|librofm|generic]
 *                                            load a book, chapter 0, paused (default layout: audible)
 *   PLAY / PAUSE / STOP
 *   SEEK    --el position_ms MS              seek inside the current chapter
 *   CHAPTER --ei idx N                       jump to chapter N, position 0
 *   SPEED   --ef speed F                     change playback speed
 *   RELEASE                                  release the session and stop
 *
 * Position advances in real time x speed while playing, and the player rolls
 * into the next chapter (or stops at the end of the book) by itself, so a
 * whole "listen" can be scripted in seconds with short chapters or high speed.
 *
 * The metadata layout imitates a real player (see [Layout]); the shapes come
 * from recordings of the real apps, so the scrobbler is tested against what
 * Audible, Libby and Libro.fm actually publish.
 */
class PlayerService : Service() {

    /**
     * Which real player's metadata layout to imitate. Shapes were captured from
     * the real apps with tools/capture.py (see PLAN.md and web/tests/fixtures).
     */
    enum class Layout { GENERIC, AUDIBLE, LIBBY, LIBROFM }

    private class Book(val title: String, val author: String, val narrator: String, val chapterMs: List<Long>, val layout: Layout) {
        val id = "book-" + (title + "|" + author).hashCode().toUInt().toString(16)
        val asin = "B0FAKE" + (title + author).hashCode().toUInt().toString(36).uppercase().padStart(4, '0').take(4)
        val totalMs = chapterMs.sum()
        fun chapterTitle(i: Int) = "Chapter ${i + 1}"
        fun trackId(i: Int) = (1000 + i).toString()
        fun prefixMs(i: Int) = chapterMs.take(i).sum()
    }

    private lateinit var session: MediaSession
    private val handler = Handler(Looper.getMainLooper())

    private var book: Book? = null
    private var chapter = 0
    private var basePos = 0L
    private var baseTime = 0L
    private var playing = false
    private var speed = 1f
    private var state = PlaybackState.STATE_NONE

    private val ticker = object : Runnable {
        override fun run() {
            val b = book
            if (playing && b != null && position() >= b.chapterMs[chapter]) {
                if (chapter < b.chapterMs.size - 1) {
                    chapter += 1
                    basePos = 0
                    baseTime = SystemClock.elapsedRealtime()
                    publishMetadata()
                    publishState(PlaybackState.STATE_PLAYING)
                } else {
                    // End of book: park at the end of the last chapter.
                    playing = false
                    basePos = b.chapterMs[chapter]
                    publishState(PlaybackState.STATE_STOPPED)
                }
                updateNotification()
            }
            handler.postDelayed(this, 250)
        }
    }

    override fun onCreate() {
        super.onCreate()
        session = MediaSession(this, "fakeplayer")
        session.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = play()
            override fun onPause() = pause()
            override fun onStop() = stop()
            override fun onSeekTo(pos: Long) = seek(pos)
            override fun onSkipToNext() { book?.let { if (chapter < it.chapterMs.size - 1) jump(chapter + 1) } }
            override fun onSkipToPrevious() { if (chapter > 0) jump(chapter - 1) }
            override fun onSkipToQueueItem(id: Long) = jump(id.toInt())
            override fun onSetPlaybackSpeed(s: Float) = setSpeed(s)
        })
        session.isActive = true
        ensureChannel()
        startForeground(1, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        handler.postDelayed(ticker, 250)
        Log.i(TAG, "session created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action?.substringAfterLast('.') ?: return START_STICKY
        Log.i(TAG, "command $action extras=" + (intent.extras?.keySet()?.joinToString(",") ?: ""))
        when (action) {
            "LOAD" -> load(intent)
            "PLAY" -> play()
            "PAUSE" -> pause()
            "STOP" -> stop()
            "SEEK" -> seek(intent.getLongExtra("position_ms", 0L))
            "CHAPTER" -> jump(intent.getIntExtra("idx", 0))
            "SPEED" -> setSpeed(intent.getFloatExtra("speed", 1f))
            "RELEASE" -> { session.release(); stopSelf(); return START_NOT_STICKY }
            else -> Log.w(TAG, "unknown action $action")
        }
        updateNotification()
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(ticker)
        try { session.release() } catch (_: Exception) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // --- commands -------------------------------------------------------

    private fun load(intent: Intent) {
        val title = intent.getStringExtra("title") ?: "Untitled"
        val author = intent.getStringExtra("author") ?: "Unknown"
        val narrator = intent.getStringExtra("narrator") ?: "Narrator"
        val list = intent.getStringExtra("chapter_ms_list")
        val chapterMs: List<Long> = if (!list.isNullOrBlank()) {
            list.split(',').map { it.trim().toLong() }
        } else {
            val n = intent.getIntExtra("chapters", 5).coerceAtLeast(1)
            val ms = intent.getLongExtra("chapter_ms", 60_000L).coerceAtLeast(1000L)
            List(n) { ms }
        }
        val layout = try {
            Layout.valueOf((intent.getStringExtra("layout") ?: "audible").uppercase())
        } catch (_: IllegalArgumentException) { Layout.AUDIBLE }
        book = Book(title, author, narrator, chapterMs, layout)
        chapter = 0
        basePos = 0
        baseTime = SystemClock.elapsedRealtime()
        playing = false
        publishQueue()
        publishMetadata()
        publishState(PlaybackState.STATE_PAUSED)
    }

    private fun play() {
        if (book == null || playing) return
        baseTime = SystemClock.elapsedRealtime()
        playing = true
        publishState(PlaybackState.STATE_PLAYING)
    }

    private fun pause() {
        if (book == null) return
        basePos = position()
        playing = false
        publishState(PlaybackState.STATE_PAUSED)
    }

    private fun stop() {
        if (book == null) return
        basePos = position()
        playing = false
        publishState(PlaybackState.STATE_STOPPED)
    }

    private fun seek(pos: Long) {
        val b = book ?: return
        basePos = pos.coerceIn(0L, b.chapterMs[chapter])
        baseTime = SystemClock.elapsedRealtime()
        publishState(state)
    }

    private fun jump(idx: Int) {
        val b = book ?: return
        chapter = idx.coerceIn(0, b.chapterMs.size - 1)
        basePos = 0
        baseTime = SystemClock.elapsedRealtime()
        publishMetadata()
        publishState(state)
    }

    private fun setSpeed(s: Float) {
        basePos = position()
        baseTime = SystemClock.elapsedRealtime()
        speed = s.takeIf { it > 0f } ?: 1f
        publishState(state)
    }

    // --- session plumbing -----------------------------------------------

    private fun position(): Long {
        val b = book ?: return 0L
        val p = if (playing) basePos + ((SystemClock.elapsedRealtime() - baseTime) * speed).toLong() else basePos
        return p.coerceIn(0L, b.chapterMs[chapter])
    }

    private fun publishMetadata() {
        val b = book ?: return
        val m = MediaMetadata.Builder()
        when (b.layout) {
            Layout.AUDIBLE -> m
                // TITLE = book, AUTHOR = ALBUM = author, ARTIST = chapter, MEDIA_ID = ASIN, DURATION = chapter.
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, b.asin)
                .putString(MediaMetadata.METADATA_KEY_TITLE, b.title)
                .putString(MediaMetadata.METADATA_KEY_AUTHOR, b.author)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, b.author)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, b.chapterTitle(chapter))
                .putString(MediaMetadata.METADATA_KEY_ART_URI, "https://example.invalid/cover/${b.asin}.jpg")
                .putString(MediaMetadata.METADATA_KEY_DATE, "2026-01-01")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, b.chapterMs[chapter])
            Layout.LIBBY -> m
                // TITLE = ALBUM = DISPLAY_TITLE = book, ARTIST = ALBUM_ARTIST = author,
                // DISPLAY_SUBTITLE = chapter, DURATION = whole book, MEDIA_ID empty, no queue.
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, "")
                .putString(MediaMetadata.METADATA_KEY_TITLE, b.title)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, b.title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, b.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, b.author)
                .putString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST, b.author)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, b.chapterTitle(chapter))
                .putString("titleId", b.id.hashCode().toUInt().toString())
                .putString("itemType", "SHELL")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, b.totalMs)
            Layout.LIBROFM -> m
                // TITLE = ALBUM = book, ARTIST = author, MEDIA_ID = track id, DURATION = track, YEAR.
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, b.trackId(chapter))
                .putString(MediaMetadata.METADATA_KEY_TITLE, b.title)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, b.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, b.author)
                .putString(MediaMetadata.METADATA_KEY_ART_URI, "https://example.invalid/cover/${b.id}.jpg")
                .putLong(MediaMetadata.METADATA_KEY_YEAR, 2023)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, b.chapterMs[chapter])
            Layout.GENERIC -> m
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, "${b.id}-ch$chapter")
                .putString(MediaMetadata.METADATA_KEY_ALBUM, b.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, b.author)
                .putString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST, b.author)
                .putString(MediaMetadata.METADATA_KEY_AUTHOR, b.author)
                .putString(MediaMetadata.METADATA_KEY_TITLE, b.chapterTitle(chapter))
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, b.chapterTitle(chapter))
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, b.title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_DESCRIPTION, "Narrated by ${b.narrator}")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, b.chapterMs[chapter])
                .putLong(MediaMetadata.METADATA_KEY_TRACK_NUMBER, (chapter + 1).toLong())
                .putLong(MediaMetadata.METADATA_KEY_NUM_TRACKS, b.chapterMs.size.toLong())
        }
        session.setMetadata(m.build())
    }

    private fun publishQueue() {
        val b = book ?: return
        if (b.layout == Layout.LIBBY) {
            session.setQueue(null)
            return
        }
        session.setQueue(b.chapterMs.indices.map { i ->
            val d = MediaDescription.Builder()
            when (b.layout) {
                Layout.AUDIBLE -> d.setMediaId(b.asin).setTitle(b.chapterTitle(i))
                Layout.LIBROFM -> d.setMediaId(b.trackId(i)).setTitle(b.title)
                else -> d.setMediaId("${b.id}-ch$i").setTitle(b.chapterTitle(i)).setSubtitle(b.title)
            }
            MediaSession.QueueItem(d.build(), i.toLong())
        })
        session.setQueueTitle(b.title)
    }

    /** Libby reports one position across the whole book; the others are chapter/track-relative. */
    private fun reportedPosition(): Long {
        val b = book ?: return 0L
        return if (b.layout == Layout.LIBBY) b.prefixMs(chapter) + position() else position()
    }

    private fun publishState(newState: Int) {
        state = newState
        session.setPlaybackState(
            PlaybackState.Builder()
                .setState(newState, reportedPosition(), if (playing) speed else 0f, SystemClock.elapsedRealtime())
                .setActiveQueueItemId(if (book?.layout == Layout.LIBBY) 0L else chapter.toLong())
                .setActions(
                    PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                        PlaybackState.ACTION_STOP or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_SKIP_TO_NEXT or
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SKIP_TO_QUEUE_ITEM or
                        PlaybackState.ACTION_SET_PLAYBACK_SPEED
                )
                .build()
        )
    }

    private fun ensureChannel() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW))
    }

    private fun notification(): Notification {
        val b = book
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(b?.chapterTitle(chapter) ?: "Fake player")
            .setContentText(b?.let { "${it.title} - ${it.author}" } ?: "idle")
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken))
            .setOngoing(true)
            .build()
    }

    private fun updateNotification() {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(1, notification())
    }

    companion object {
        private const val TAG = "FakePlayer"
        private const val CHANNEL = "playback"
    }
}
