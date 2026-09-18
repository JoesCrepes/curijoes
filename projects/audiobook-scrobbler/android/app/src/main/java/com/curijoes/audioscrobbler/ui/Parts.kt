package com.curijoes.audioscrobbler.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Section heading: small, muted, spaced caps. Same role as the web app's h2. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = Ink.muted,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.6.sp,
    )
}

/** The web app's `.card`: panel fill, hairline border, 10px radius. */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    borderColor: Color = Ink.border,
    padding: Dp = 12.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Ink.panel)
            .border(1.dp, borderColor, RoundedCornerShape(10.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

/** The web app's `.pill`. */
@Composable
fun Pill(text: String, color: Color = Ink.muted, border: Color = Ink.border) {
    Text(
        text,
        color = color,
        fontSize = 11.sp,
        maxLines = 1,
        modifier = Modifier
            .clip(CircleShape)
            .border(1.dp, border, CircleShape)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** The web app's `.bar`. */
@Composable
fun ProgressBar(fraction: Double?, modifier: Modifier = Modifier, barHeight: Dp = 6.dp) {
    Box(
        modifier
            .fillMaxWidth()
            .height(barHeight)
            .clip(RoundedCornerShape(barHeight / 2))
            .background(Ink.border),
    ) {
        val f = (fraction ?: 0.0).coerceIn(0.0, 1.0).toFloat()
        if (f > 0f) {
            Box(
                Modifier
                    .fillMaxWidth(f)
                    .height(barHeight)
                    .clip(RoundedCornerShape(barHeight / 2))
                    .background(Ink.accent),
            )
        }
    }
}

/** Stand-in for cover art, which no player hands us reliably. */
@Composable
fun CoverBox(w: Dp = 44.dp, h: Dp = 66.dp) {
    Box(Modifier.size(w, h).clip(RoundedCornerShape(4.dp)).background(Ink.border))
}

@Composable
fun Dot(color: Color) {
    Box(Modifier.size(7.dp).clip(CircleShape).background(color))
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (enabled) Ink.accent else Ink.border)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (enabled) Ink.onAccent else Ink.muted, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun QuietButton(text: String, modifier: Modifier = Modifier, color: Color = Ink.text, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, Ink.border, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = color, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** A labelled value row, used by the match panel and the status list. */
@Composable
fun FactRow(label: String, value: String, valueColor: Color = Ink.text, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.width(104.dp))
        Text(
            value,
            color = valueColor,
            fontSize = 13.sp,
            fontFamily = if (mono) FontFamily.Monospace else FontFamily.SansSerif,
            overflow = TextOverflow.Ellipsis,
            maxLines = 3,
            modifier = Modifier.weight(1f),
        )
    }
}

/** Back chevron, drawn rather than pulled from an icon pack. */
@Composable
private fun BackChevron(tint: Color) {
    Canvas(Modifier.size(22.dp)) {
        val w = size.width
        val h = size.height
        drawLine(
            color = tint,
            start = Offset(w * 0.62f, h * 0.24f),
            end = Offset(w * 0.36f, h * 0.5f),
            strokeWidth = w * 0.085f,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = tint,
            start = Offset(w * 0.36f, h * 0.5f),
            end = Offset(w * 0.62f, h * 0.76f),
            strokeWidth = w * 0.085f,
            cap = StrokeCap.Round,
        )
    }
}

@Composable
fun TopBar(
    title: String,
    onBack: (() -> Unit)? = null,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            Box(
                Modifier.size(44.dp).offsetStart().clip(CircleShape).clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) { BackChevron(Ink.text) }
        }
        Text(
            title,
            fontSize = if (onBack == null) 20.sp else 17.sp,
            fontWeight = FontWeight.SemiBold,
            color = Ink.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(start = if (onBack == null) 0.dp else 4.dp),
        )
        if (trailing != null) trailing()
    }
}

/** Pulls a 44dp touch target back so its glyph lines up with the 16dp gutter. */
private fun Modifier.offsetStart(): Modifier = this.padding(end = 0.dp)

/** Settings glyph: a ring of teeth around a hub, drawn to avoid an icon pack. */
@Composable
fun GearGlyph(tint: Color) {
    Canvas(Modifier.size(22.dp)) {
        val r = size.minDimension / 2f
        val c = Offset(size.width / 2f, size.height / 2f)
        drawCircle(color = tint, radius = r * 0.34f, center = c, style = androidx.compose.ui.graphics.drawscope.Stroke(width = r * 0.17f))
        repeat(8) { i ->
            val a = (Math.PI / 4.0) * i
            val inner = r * 0.62f
            val outer = r * 0.95f
            drawLine(
                color = tint,
                start = Offset(c.x + (kotlin.math.cos(a) * inner).toFloat(), c.y + (kotlin.math.sin(a) * inner).toFloat()),
                end = Offset(c.x + (kotlin.math.cos(a) * outer).toFloat(), c.y + (kotlin.math.sin(a) * outer).toFloat()),
                strokeWidth = r * 0.17f,
                cap = StrokeCap.Round,
            )
        }
    }
}
