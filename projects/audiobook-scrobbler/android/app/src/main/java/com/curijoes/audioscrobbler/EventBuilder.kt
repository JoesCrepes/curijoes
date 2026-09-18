package com.curijoes.audioscrobbler

import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/**
 * Turns a MediaController snapshot into the JSON the server ingests. The
 * whole metadata bag goes into `raw` so the server can decide per app which
 * key is the book title and which is the chapter.
 */
object EventBuilder {

    private val LONG_KEYS = setOf(
        MediaMetadata.METADATA_KEY_DURATION, MediaMetadata.METADATA_KEY_TRACK_NUMBER,
        MediaMetadata.METADATA_KEY_NUM_TRACKS, MediaMetadata.METADATA_KEY_DISC_NUMBER, MediaMetadata.METADATA_KEY_YEAR,
    )
    private val SKIP_KEYS = setOf(
        MediaMetadata.METADATA_KEY_ART, MediaMetadata.METADATA_KEY_ALBUM_ART, MediaMetadata.METADATA_KEY_DISPLAY_ICON,
        MediaMetadata.METADATA_KEY_RATING, MediaMetadata.METADATA_KEY_USER_RATING,
    )

    fun build(type: String, pkg: String, controller: MediaController, queue: List<MediaSession.QueueItem>? = null): JSONObject {
        val md = controller.metadata
        val state = controller.playbackState
        val playing = state?.state == PlaybackState.STATE_PLAYING
        val speed = state?.playbackSpeed?.takeIf { it > 0f } ?: 1f

        val e = JSONObject()
        e.put("id", UUID.randomUUID().toString())
        e.put("app_package", pkg)
        e.put("event_type", type)
        e.put("occurred_at", Instant.now().toString())
        e.put("is_playing", playing)
        e.put("position_ms", currentPosition(state))
        e.put("duration_ms", md?.getLong(MediaMetadata.METADATA_KEY_DURATION)?.takeIf { it > 0 } ?: JSONObject.NULL)
        e.put("playback_speed", speed.toDouble())

        val q = queue ?: controller.queue
        val activeId = state?.activeQueueItemId ?: -1L
        var chapterIdx = q?.indexOfFirst { it.queueId == activeId }?.takeIf { it >= 0 }
        if (chapterIdx == null) {
            val track = md?.getLong(MediaMetadata.METADATA_KEY_TRACK_NUMBER) ?: 0L
            if (track > 0) chapterIdx = (track - 1).toInt()
        }
        e.put("chapter_idx", chapterIdx ?: JSONObject.NULL)
        val count = q?.size?.takeIf { it > 0 } ?: md?.getLong(MediaMetadata.METADATA_KEY_NUM_TRACKS)?.takeIf { it > 0 }?.toInt()
        e.put("chapter_count", count ?: JSONObject.NULL)

        val raw = JSONObject()
        if (md != null) {
            for (key in md.keySet()) {
                if (key in SKIP_KEYS) continue
                try {
                    if (key in LONG_KEYS) raw.put(key, md.getLong(key))
                    else md.getString(key)?.let { raw.put(key, it) } ?: md.getText(key)?.let { raw.put(key, it.toString()) }
                } catch (_: Exception) { /* bitmaps, ratings, odd types */ }
            }
        }
        raw.put("_state", state?.state ?: -1)
        raw.put("_active_queue_id", activeId)
        raw.put("_buffered_ms", state?.bufferedPosition ?: -1L)
        e.put("raw", raw)

        if (type == "queue" && q != null) {
            val arr = JSONArray()
            for (item in q) {
                val d = item.description
                arr.put(JSONObject().apply {
                    put("title", d.title?.toString() ?: JSONObject.NULL)
                    put("subtitle", d.subtitle?.toString() ?: JSONObject.NULL)
                    put("media_id", d.mediaId ?: JSONObject.NULL)
                })
            }
            e.put("queue", arr)
        }
        return e
    }

    /** PlaybackState.position is a snapshot; extrapolate while playing. */
    fun currentPosition(state: PlaybackState?): Any {
        if (state == null || state.position < 0) return JSONObject.NULL
        if (state.state != PlaybackState.STATE_PLAYING) return state.position
        val elapsed = SystemClock.elapsedRealtime() - state.lastPositionUpdateTime
        val speed = state.playbackSpeed.takeIf { it > 0f } ?: 1f
        return (state.position + (elapsed * speed).toLong()).coerceAtLeast(0L)
    }

    /** Cheap change detector for metadata so we only log real changes. */
    fun metadataSignature(md: MediaMetadata?): String {
        if (md == null) return ""
        return listOf(
            MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE,
            MediaMetadata.METADATA_KEY_ALBUM, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_MEDIA_ID,
        ).joinToString("|") { md.getString(it) ?: "" } + "|" + md.getLong(MediaMetadata.METADATA_KEY_DURATION) + "|" + md.getLong(MediaMetadata.METADATA_KEY_TRACK_NUMBER)
    }

    fun queueSignature(q: List<MediaSession.QueueItem>?): String =
        q?.joinToString("|") { "${it.queueId}:${it.description.title}" } ?: ""
}
