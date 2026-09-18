package com.curijoes.audioscrobbler.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.curijoes.audioscrobbler.Action
import com.curijoes.audioscrobbler.Dashboard
import com.curijoes.audioscrobbler.Read
import com.curijoes.audioscrobbler.appLabel
import com.curijoes.audioscrobbler.fmtBasis
import com.curijoes.audioscrobbler.fmtDuration

private fun timeOf(iso: String): String =
    Regex("T(\\d{2}:\\d{2})").find(iso)?.groupValues?.get(1) ?: iso.take(10)

private fun dayOf(iso: String): String = iso.take(10)

private fun pctText(p: Double?): String = if (p == null) "—" else "%.1f%%".format(p * 100)

// --- Home -------------------------------------------------------------------

@Composable
fun HomeScreen(
    dash: Dashboard?,
    error: String?,
    listenerOk: Boolean,
    watching: Int,
    lastUpload: String,
    onOpenSettings: () -> Unit,
    onOpenAction: (Action) -> Unit,
    onOpenRead: (Read) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        TopBar("Listening") {
            Box(
                Modifier.size(44.dp).clip(CircleShape).clickable { onOpenSettings() },
                contentAlignment = Alignment.Center,
            ) { GearGlyph(Ink.muted) }
        }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (error != null) {
                item { Card(borderColor = Ink.warn) { Text(error, color = Ink.warn, fontSize = 14.sp) } }
            }
            if (!listenerOk) {
                item {
                    Card(borderColor = Ink.warn) {
                        Text("Notification access is off", color = Ink.warn, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Without it Android will not let the app see what is playing. Turn it on in Settings.",
                            color = Ink.muted, fontSize = 13.sp,
                        )
                    }
                }
            }

            val actions = dash?.actions.orEmpty()
            if (actions.isNotEmpty()) {
                item { SectionLabel("Needs you") }
                items(actions, key = { it.id }) { a -> ActionCard(a) { onOpenAction(a) } }
            }

            val reading = dash?.reading.orEmpty()
            item { SectionLabel("In progress") }
            if (dash == null && error == null) {
                item { Text("Loading…", color = Ink.muted) }
            } else if (reading.isEmpty()) {
                item {
                    Text(
                        "Nothing in progress. Play something in Audible, Libby or Libro.fm and it will turn up here.",
                        color = Ink.muted, fontSize = 14.sp,
                    )
                }
            }
            items(reading, key = { it.id }) { r -> ReadCard(r) { onOpenRead(r) } }

            val finished = dash?.finished.orEmpty()
            if (finished.isNotEmpty()) {
                item { Spacer(Modifier.height(6.dp)); SectionLabel("Finished") }
                items(finished, key = { it.id }) { r -> ReadCard(r) { onOpenRead(r) } }
            }

            item {
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Dot(if (listenerOk) Ink.ok else Ink.warn)
                    Text(
                        "Watching $watching app${if (watching == 1) "" else "s"} · $lastUpload",
                        color = Ink.muted, fontSize = 12.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun ActionCard(a: Action, onOpen: () -> Unit) {
    Card(onClick = onOpen) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Text(
                    if (a.type == "match_book") "Which book is “${a.title}”?" else "Finished “${a.title}”?",
                    fontWeight = FontWeight.SemiBold, color = Ink.text,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    if (a.type == "match_book") listOfNotNull(a.author, "${a.candidates.size} candidates").joinToString(" · ")
                    else "Parked at ${pctText(a.pct)} with no recent listening.",
                    color = Ink.muted, fontSize = 13.sp,
                )
            }
            Pill(if (a.type == "match_book") "identify" else "confirm", Ink.accent, Ink.accent)
        }
    }
}

@Composable
private fun ReadCard(r: Read, onOpen: () -> Unit) {
    Card(onClick = onOpen) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CoverBox()
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Column {
                    Text(r.book.title, fontWeight = FontWeight.SemiBold, color = Ink.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(r.book.author ?: "Unknown author", color = Ink.muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                ProgressBar(r.progressPct)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(pctText(r.progressPct), color = Ink.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        when {
                            r.chapterIdx != null && r.chapterCount != null -> "Chapter ${r.chapterIdx + 1} of ${r.chapterCount}"
                            r.bookPositionMs != null -> "${fmtDuration((r.bookPositionMs / 1000).toInt())} in"
                            else -> fmtDuration(r.bookSecondsListened) + " listened"
                        },
                        color = Ink.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Pill(appLabel(r.book.sourceApp))
                }
            }
        }
    }
}

// --- Identify ---------------------------------------------------------------

@Composable
fun MatchScreen(a: Action, busy: Boolean, onBack: () -> Unit, onPick: (Int) -> Unit, onSkip: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TopBar("Identify book", onBack = onBack)
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Column {
                    Text("Which book is “${a.title}”?", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Ink.text)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Not confident enough to log this automatically. Pick the right one and it will not be asked again.",
                        color = Ink.muted, fontSize = 13.sp,
                    )
                }
            }
            items(a.candidates, key = { it.index }) { c ->
                Card(borderColor = if (c.runtimeAgrees) Ink.accent else Ink.border, onClick = { if (!busy) onPick(c.index) }) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CoverBox()
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(c.title, fontWeight = FontWeight.SemiBold, color = Ink.text)
                            Text(
                                listOfNotNull(c.author, c.runtimeSeconds?.let { fmtDuration(it) } ?: "no audiobook").joinToString(" · "),
                                color = Ink.muted, fontSize = 13.sp,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (c.runtimeAgrees) Pill("runtime agrees", Ink.ok, Ink.ok)
                                Pill("${(c.score * 100).toInt()}%")
                            }
                        }
                    }
                }
            }
            item {
                Spacer(Modifier.height(4.dp))
                QuietButton("None of these · stop asking", Modifier.fillMaxWidth(), Ink.muted) { if (!busy) onSkip() }
            }
            item {
                Text(
                    "Your answer is pinned to this player's own id for the book, so it carries over even if the title changes.",
                    color = Ink.muted, fontSize = 12.sp,
                )
            }
        }
    }
}

// --- Confirm finished -------------------------------------------------------

@Composable
fun FinishScreen(a: Action, busy: Boolean, onBack: () -> Unit, onResolve: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TopBar("Finished?", onBack = onBack)
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Did you finish “${a.title}”?", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Ink.text)
            Text(
                "It reached ${pctText(a.pct)} and has been quiet for a while.",
                color = Ink.muted, fontSize = 14.sp,
            )
            Spacer(Modifier.height(4.dp))
            PrimaryButton("Finished", Modifier.fillMaxWidth(), !busy) { onResolve("finished") }
            QuietButton("Not yet, still reading", Modifier.fillMaxWidth()) { if (!busy) onResolve("not_yet") }
            QuietButton("Gave up on it", Modifier.fillMaxWidth(), Ink.warn) { if (!busy) onResolve("dnf") }
        }
    }
}

// --- Book detail ------------------------------------------------------------

@Composable
fun BookScreen(r: Read, busy: Boolean, onBack: () -> Unit, onStatus: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TopBar(r.book.title, onBack = onBack)
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    CoverBox(84.dp, 126.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(r.book.title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Ink.text)
                        Text(r.book.author ?: "Unknown author", color = Ink.muted, fontSize = 13.sp)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val (label, color) = when (r.book.matchStatus) {
                                "confirmed" -> "confirmed" to Ink.ok
                                "auto" -> "matched" to Ink.ok
                                "needs_review" -> "needs review" to Ink.accent
                                else -> r.book.matchStatus to Ink.muted
                            }
                            Pill(label, color, color)
                            Pill(appLabel(r.book.sourceApp))
                        }
                        if (r.book.runtimeSeconds != null) {
                            Text("${fmtDuration(r.book.runtimeSeconds)} total", color = Ink.muted, fontSize = 12.sp)
                        }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProgressBar(r.progressPct, barHeight = 8.dp)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(pctText(r.progressPct), fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink.text)
                        Column(Modifier.weight(1f)) {
                            Text(
                                listOfNotNull(
                                    r.bookPositionMs?.let { "${fmtDuration((it / 1000).toInt())} in" },
                                    r.chapterIdx?.let { i -> "Chapter ${i + 1}" + (r.chapterCount?.let { " of $it" } ?: "") },
                                ).joinToString(" · ").ifEmpty { "Position unknown" },
                                color = Ink.muted, fontSize = 12.sp,
                            )
                            Text(fmtBasis(r.progressBasis), color = Ink.muted, fontSize = 12.sp)
                        }
                    }
                }
            }

            item { SectionLabel("Sessions") }
            if (r.sessions.isEmpty()) {
                item { Text("No session recorded yet.", color = Ink.muted, fontSize = 13.sp) }
            } else {
                item {
                    Card(padding = 0.dp) {
                        r.sessions.sortedByDescending { it.startedAt }.take(8).forEachIndexed { i, s ->
                            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.border))
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text("${dayOf(s.startedAt)} ${timeOf(s.startedAt)}", fontSize = 14.sp, color = Ink.text)
                                    Text(
                                        if (s.startChapterIdx != null && s.endChapterIdx != null && s.startChapterIdx != s.endChapterIdx)
                                            "Chapters ${s.startChapterIdx + 1} to ${s.endChapterIdx + 1}"
                                        else s.startChapterIdx?.let { "Chapter ${it + 1}" } ?: "No chapter reported",
                                        fontSize = 12.sp, color = Ink.muted,
                                    )
                                }
                                Text(fmtDuration(s.bookSeconds), fontSize = 14.sp, color = Ink.text)
                            }
                        }
                    }
                }
            }

            item { SectionLabel("Match") }
            item {
                Card {
                    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        FactRow("Hardcover", r.book.hardcoverBookId?.let { "book $it" + (r.book.hardcoverEditionId?.let { e -> " · edition $e" } ?: "") } ?: "not matched")
                        FactRow(
                            when (r.book.externalId) {
                                null -> "Player id"
                                else -> appLabel(r.book.sourceApp) + " id"
                            },
                            r.book.externalId ?: "none published", mono = r.book.externalId != null,
                        )
                        FactRow(
                            "Sync",
                            r.hardcoverError ?: "no error",
                            valueColor = if (r.hardcoverError != null) Ink.warn else Ink.muted,
                        )
                    }
                }
            }

            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (r.status == "reading") {
                        PrimaryButton("Mark finished", Modifier.weight(1f), !busy) { onStatus("finished") }
                        QuietButton("Gave up", Modifier.weight(1f), Ink.warn) { if (!busy) onStatus("dnf") }
                    } else {
                        QuietButton("Move back to reading", Modifier.fillMaxWidth()) { if (!busy) onStatus("reading") }
                    }
                }
            }
        }
    }
}
