package com.curijoes.audioscrobbler

import org.json.JSONArray
import org.json.JSONObject

/** What the app shows. Parsed straight from GET /api/dashboard. */
data class Book(
    val id: String,
    val title: String,
    val author: String?,
    val sourceApp: String,
    val matchStatus: String,
    val runtimeSeconds: Int?,
    val externalId: String?,
    val hardcoverBookId: Int?,
    val hardcoverEditionId: Int?,
)

data class Session(
    val startedAt: String,
    val endedAt: String,
    val wallSeconds: Int,
    val bookSeconds: Int,
    val startChapterIdx: Int?,
    val endChapterIdx: Int?,
)

data class Read(
    val id: String,
    val status: String,
    val progressPct: Double?,
    val progressBasis: String,
    val chapterIdx: Int?,
    val chapterCount: Int?,
    val bookPositionMs: Long?,
    val bookSecondsListened: Int,
    val lastActivityAt: String,
    val hardcoverError: String?,
    val book: Book,
    val sessions: List<Session>,
)

data class Candidate(
    val index: Int,
    val title: String,
    val author: String?,
    val runtimeSeconds: Int?,
    val score: Double,
    val runtimeAgrees: Boolean,
)

data class Action(
    val id: String,
    val type: String,
    val bookId: String?,
    val readId: String?,
    val title: String,
    val author: String?,
    val pct: Double?,
    val candidates: List<Candidate>,
)

data class Dashboard(val reads: List<Read>, val actions: List<Action>) {
    val reading get() = reads.filter { it.status == "reading" }
    val finished get() = reads.filter { it.status != "reading" }
}

private fun JSONObject.stringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

private fun JSONObject.intOrNull(key: String): Int? = if (isNull(key)) null else optInt(key)
private fun JSONObject.longOrNull(key: String): Long? = if (isNull(key)) null else optLong(key)
private fun JSONObject.doubleOrNull(key: String): Double? = if (isNull(key)) null else optDouble(key)

private fun <T> JSONArray?.map(f: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { i -> optJSONObject(i)?.let(f) }
}

object DashboardParser {

    fun parse(json: JSONObject): Dashboard =
        Dashboard(
            reads = json.optJSONArray("reads").map { read(it) },
            actions = json.optJSONArray("actions").map { action(it) },
        )

    private fun book(o: JSONObject) = Book(
        id = o.optString("id"),
        title = o.optString("title"),
        author = o.stringOrNull("author"),
        sourceApp = o.optString("source_app"),
        matchStatus = o.optString("match_status", "unmatched"),
        runtimeSeconds = o.intOrNull("runtime_seconds"),
        externalId = o.stringOrNull("external_id"),
        hardcoverBookId = o.intOrNull("hardcover_book_id"),
        hardcoverEditionId = o.intOrNull("hardcover_edition_id"),
    )

    private fun read(o: JSONObject) = Read(
        id = o.optString("id"),
        status = o.optString("status", "reading"),
        progressPct = o.doubleOrNull("progress_pct"),
        progressBasis = o.optString("progress_basis", "none"),
        chapterIdx = o.intOrNull("chapter_idx"),
        chapterCount = o.intOrNull("chapter_count"),
        bookPositionMs = o.longOrNull("book_position_ms"),
        bookSecondsListened = o.optInt("book_seconds_listened"),
        lastActivityAt = o.optString("last_activity_at"),
        hardcoverError = o.stringOrNull("hardcover_error"),
        book = o.optJSONObject("books")?.let { book(it) }
            ?: Book(o.optString("book_id"), "Unknown", null, "", "unmatched", null, null, null, null),
        sessions = o.optJSONArray("sessions").map { s ->
            Session(
                startedAt = s.optString("started_at"),
                endedAt = s.optString("ended_at"),
                wallSeconds = s.optInt("wall_seconds"),
                bookSeconds = s.optInt("book_seconds"),
                startChapterIdx = s.intOrNull("start_chapter_idx"),
                endChapterIdx = s.intOrNull("end_chapter_idx"),
            )
        },
    )

    private fun action(o: JSONObject): Action {
        val payload = o.optJSONObject("payload") ?: JSONObject()
        val observed = payload.doubleOrNull("observed_runtime_seconds")
        var i = -1
        return Action(
            id = o.optString("id"),
            type = o.optString("type"),
            bookId = o.stringOrNull("book_id"),
            readId = o.stringOrNull("read_id"),
            title = payload.optString("title", "this book"),
            author = payload.stringOrNull("author"),
            pct = payload.doubleOrNull("pct"),
            candidates = payload.optJSONArray("candidates").map { c ->
                i += 1
                val runtime = c.intOrNull("runtime_seconds")
                Candidate(
                    index = i,
                    title = c.optString("title"),
                    author = c.stringOrNull("author"),
                    runtimeSeconds = runtime,
                    score = c.optDouble("score", 0.0),
                    // Surfaces the evidence that separates a real match from a
                    // same-titled coincidence, rather than only a percentage.
                    runtimeAgrees = observed != null && runtime != null &&
                        kotlin.math.abs(runtime - observed) / observed <= 0.1,
                )
            },
        )
    }
}

/** Friendly names for the players we know; anything else shows its package. */
fun appLabel(pkg: String): String = when (pkg) {
    "com.audible.application" -> "Audible"
    "com.overdrive.mobile.android.libby" -> "Libby"
    "fm.libro.librofm" -> "Libro.fm"
    "com.spotify.music" -> "Spotify"
    "au.com.shiftyjelly.pocketcasts" -> "Pocket Casts"
    "com.curijoes.fakeplayer" -> "Fake player"
    else -> pkg.substringAfterLast('.').replaceFirstChar { it.uppercase() }
}

fun fmtDuration(seconds: Int?): String {
    if (seconds == null || seconds <= 0) return "—"
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    return when {
        h > 0 -> "${h} h ${m} m"
        m > 0 -> "${m} m ${s} s"
        else -> "${s} s"
    }
}

fun fmtBasis(basis: String): String = when (basis) {
    "chapters" -> "from the chapter map"
    "position" -> "from the player's position"
    "cumulative" -> "from listened time"
    "app" -> "the player said it's done"
    else -> "no runtime yet"
}
