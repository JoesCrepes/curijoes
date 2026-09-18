package com.curijoes.audioscrobbler.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** The PWA's palette, so the phone and the web page look like one product. */
object Ink {
    val bg = Color(0xFF0F1115)
    val panel = Color(0xFF181B22)
    val border = Color(0xFF2A2F3A)
    val text = Color(0xFFE8E8EA)
    val muted = Color(0xFF8B90A0)
    val accent = Color(0xFFF2A541)
    val ok = Color(0xFF4CC38A)
    val warn = Color(0xFFE5484D)
    val onAccent = Color(0xFF111111)
}

private val scheme = darkColorScheme(
    primary = Ink.accent,
    onPrimary = Ink.onAccent,
    background = Ink.bg,
    onBackground = Ink.text,
    surface = Ink.panel,
    onSurface = Ink.text,
    surfaceVariant = Ink.border,
    onSurfaceVariant = Ink.muted,
    outline = Ink.border,
    error = Ink.warn,
)

private val type = Typography().run {
    val base = TextStyle(fontFamily = FontFamily.SansSerif, color = Ink.text)
    copy(
        titleLarge = base.copy(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = base.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = base.copy(fontSize = 15.sp, lineHeight = 22.sp),
        bodyMedium = base.copy(fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = base.copy(fontSize = 13.sp, lineHeight = 18.sp, color = Ink.muted),
        labelSmall = base.copy(fontSize = 11.sp, color = Ink.muted),
    )
}

/**
 * Deliberately one theme. The web app is `color-scheme: dark` only, and a
 * scrobbler is read in the dark as often as not.
 */
@Composable
fun ScrobblerTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_EXPRESSION") isSystemInDarkTheme()
    MaterialTheme(colorScheme = scheme, typography = type, content = content)
}
