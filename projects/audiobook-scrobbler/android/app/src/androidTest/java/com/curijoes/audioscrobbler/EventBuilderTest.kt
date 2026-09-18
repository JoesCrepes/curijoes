package com.curijoes.audioscrobbler

import android.media.MediaDescription
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runs on a device/emulator (`./gradlew connectedDebugAndroidTest`). A real
 * MediaSession is created in-process so EventBuilder is exercised against
 * the platform's actual MediaController, not a mock.
 */
@RunWith(AndroidJUnit4::class)
class EventBuilderTest {

    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var session: MediaSession
    private lateinit var controller: MediaController

    @Before
    fun setUp() {
        session = MediaSession(ctx, "eventbuilder-test")
        session.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "The Hobbit")
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "J. R. R. Tolkien")
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, "Chapter 3")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, 1_800_000L)
                .putLong(MediaMetadata.METADATA_KEY_TRACK_NUMBER, 3L)
                .putLong(MediaMetadata.METADATA_KEY_NUM_TRACKS, 19L)
                .build()
        )
        session.setQueue((0 until 19).map { i ->
            MediaSession.QueueItem(MediaDescription.Builder().setMediaId("ch$i").setTitle("Chapter ${i + 1}").build(), i.toLong())
        })
        session.setPlaybackState(
            PlaybackState.Builder()
                .setState(PlaybackState.STATE_PLAYING, 120_000L, 1.5f, SystemClock.elapsedRealtime())
                .setActiveQueueItemId(2L)
                .build()
        )
        session.isActive = true
        controller = MediaController(ctx, session.sessionToken)
    }

    @After
    fun tearDown() {
        session.release()
    }

    @Test
    fun buildsEventFromLiveSession() {
        val e = EventBuilder.build("play", "com.example.player", controller)

        assertEquals("play", e.getString("event_type"))
        assertEquals("com.example.player", e.getString("app_package"))
        assertEquals(36, e.getString("id").length)
        assertTrue(e.getBoolean("is_playing"))
        assertEquals(1_800_000L, e.getLong("duration_ms"))
        assertEquals(1.5, e.getDouble("playback_speed"), 0.001)
        // activeQueueItemId wins over TRACK_NUMBER (which would say 2 as well here, but via a different path).
        assertEquals(2, e.getInt("chapter_idx"))
        assertEquals(19, e.getInt("chapter_count"))
        // Playing: position is extrapolated from the snapshot, so >= 120s and only a little more.
        val pos = e.getLong("position_ms")
        assertTrue("position $pos", pos in 120_000L..125_000L)

        val raw = e.getJSONObject("raw")
        assertEquals("The Hobbit", raw.getString(MediaMetadata.METADATA_KEY_ALBUM))
        assertEquals("J. R. R. Tolkien", raw.getString(MediaMetadata.METADATA_KEY_ARTIST))
        assertEquals("Chapter 3", raw.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE))
        assertEquals(3L, raw.getLong(MediaMetadata.METADATA_KEY_TRACK_NUMBER))
        assertEquals(PlaybackState.STATE_PLAYING, raw.getInt("_state"))
        assertEquals(2L, raw.getLong("_active_queue_id"))
        assertFalse("queue only on queue events", e.has("queue"))
    }

    @Test
    fun queueEventCarriesChapterList() {
        val e = EventBuilder.build("queue", "com.example.player", controller, controller.queue)
        val q = e.getJSONArray("queue")
        assertEquals(19, q.length())
        assertEquals("Chapter 1", q.getJSONObject(0).getString("title"))
        assertEquals("ch18", q.getJSONObject(18).getString("media_id"))
    }

    @Test
    fun pausedPositionIsNotExtrapolated() {
        session.setPlaybackState(
            PlaybackState.Builder().setState(PlaybackState.STATE_PAUSED, 45_000L, 0f, SystemClock.elapsedRealtime() - 10_000).build()
        )
        Thread.sleep(50) // let the controller see the new state
        val e = EventBuilder.build("pause", "com.example.player", controller)
        assertFalse(e.getBoolean("is_playing"))
        assertEquals(45_000L, e.getLong("position_ms"))
        assertEquals(1.0, e.getDouble("playback_speed"), 0.001) // 0 speed while paused is reported as 1x
    }

    @Test
    fun chapterFallsBackToTrackNumber() {
        session.setPlaybackState(
            PlaybackState.Builder().setState(PlaybackState.STATE_PAUSED, 0L, 0f).build() // no active queue id
        )
        Thread.sleep(50)
        val e = EventBuilder.build("metadata", "com.example.player", controller)
        assertEquals(2, e.getInt("chapter_idx")) // TRACK_NUMBER 3 -> idx 2
    }

    @Test
    fun metadataSignatureTracksRealChanges() {
        val before = EventBuilder.metadataSignature(controller.metadata)
        assertEquals(before, EventBuilder.metadataSignature(controller.metadata))
        session.setMetadata(
            MediaMetadata.Builder(controller.metadata).putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, "Chapter 4").build()
        )
        Thread.sleep(50)
        assertNotEquals(before, EventBuilder.metadataSignature(controller.metadata))
        assertEquals("", EventBuilder.metadataSignature(null))
    }

    @Test
    fun eventStoreRoundTrip() {
        val store = EventStore.get(ctx)
        store.clear()
        assertEquals(0L, store.count())
        val a = EventBuilder.build("play", "com.example.player", controller)
        val b = EventBuilder.build("pause", "com.example.player", controller)
        store.insert(a)
        store.insert(a) // duplicate id is ignored
        store.insert(b)
        assertEquals(2L, store.count())

        val batch = store.takeBatch(10)
        assertEquals(listOf(a.getString("id"), b.getString("id")), batch.map { it.first })
        assertEquals("play", batch[0].second.getString("event_type"))
        assertTrue(store.recentLog().any { it.contains("pause") })

        store.delete(listOf(a.getString("id")))
        assertEquals(1L, store.count())
        assertEquals(b.getString("id"), store.takeBatch(10).single().first)
        store.clear()
        assertEquals(0L, store.count())
    }

    @Test
    fun currentPositionHandlesMissingState() {
        assertEquals(JSONObject.NULL, EventBuilder.currentPosition(null))
        val unknown = PlaybackState.Builder().setState(PlaybackState.STATE_NONE, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0f).build()
        assertEquals(JSONObject.NULL, EventBuilder.currentPosition(unknown))
    }
}
