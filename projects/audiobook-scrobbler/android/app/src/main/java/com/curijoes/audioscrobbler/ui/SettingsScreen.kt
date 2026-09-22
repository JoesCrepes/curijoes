package com.curijoes.audioscrobbler.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One media app the phone can see, and whether we record it. */
data class WatchableApp(val pkg: String, val label: String, val watched: Boolean, val playing: Boolean)

@Composable
fun SettingsScreen(
    serverUrl: String,
    token: String,
    deviceName: String,
    apps: List<WatchableApp>,
    listenerOk: Boolean,
    notificationsOk: Boolean,
    queued: Long,
    lastUpload: String,
    lastError: String,
    onBack: () -> Unit,
    onServerUrl: (String) -> Unit,
    onToken: (String) -> Unit,
    onDeviceName: (String) -> Unit,
    onToggleApp: (String, Boolean) -> Unit,
    onGrantListener: () -> Unit,
    onGrantNotifications: () -> Unit,
    onUploadNow: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        TopBar("Settings", onBack = onBack)
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item { SectionLabel("Status") }
            item {
                Card {
                    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        StatusRow("Notification access", if (listenerOk) "granted" else "OFF", if (listenerOk) Ink.ok else Ink.warn)
                        StatusRow("Notifications", if (notificationsOk) "allowed" else "off", if (notificationsOk) Ink.ok else Ink.warn)
                        StatusRow("Queued events", queued.toString(), Ink.muted)
                        StatusRow("Last upload", lastUpload, Ink.muted)
                        if (lastError.isNotEmpty()) StatusRow("Last error", lastError, Ink.warn)
                    }
                }
            }
            if (!listenerOk || !notificationsOk) {
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (!listenerOk) PrimaryButton("Grant access", Modifier.weight(1f)) { onGrantListener() }
                        if (!notificationsOk) QuietButton("Allow notifications", Modifier.weight(1f)) { onGrantNotifications() }
                    }
                }
            }

            item { Spacer(Modifier.height(6.dp)); SectionLabel("Apps to watch") }
            item {
                Card(padding = 0.dp) {
                    if (apps.isEmpty()) {
                        Text(
                            "No media apps seen yet. Play something and come back.",
                            color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(12.dp),
                        )
                    }
                    apps.forEachIndexed { i, app ->
                        if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.border))
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(app.label, fontSize = 14.sp, color = if (app.watched) Ink.text else Ink.muted)
                                    if (app.playing) Dot(Ink.ok)
                                }
                                Text(
                                    app.pkg, fontSize = 11.sp, color = Ink.muted,
                                    fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Switch(
                                checked = app.watched,
                                onCheckedChange = { onToggleApp(app.pkg, it) },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Ink.bg,
                                    checkedTrackColor = Ink.accent,
                                    checkedBorderColor = Ink.accent,
                                    uncheckedThumbColor = Ink.muted,
                                    uncheckedTrackColor = Ink.border,
                                    uncheckedBorderColor = Ink.border,
                                ),
                            )
                        }
                    }
                }
            }
            item {
                Text(
                    "Every media app the phone has shown us is listed. Only the ones switched on are recorded.",
                    color = Ink.muted, fontSize = 12.sp,
                )
            }

            item { Spacer(Modifier.height(6.dp)); SectionLabel("Server") }
            item {
                Card {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Field("Address", serverUrl, onServerUrl)
                        Field("Token", token, onToken, secret = true)
                        Field("This device", deviceName, onDeviceName)
                    }
                }
            }
            item { QuietButton("Send queued events now", Modifier.fillMaxWidth()) { onUploadNow() } }
            item { Spacer(Modifier.height(8.dp)) }
        }
    }
}

@Composable
private fun StatusRow(label: String, value: String, color: androidx.compose.ui.graphics.Color) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Dot(color)
        Text(label, fontSize = 14.sp, color = Ink.text, modifier = Modifier.weight(1f))
        Text(value, fontSize = 13.sp, color = color, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.End)
    }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, secret: Boolean = false) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, color = Ink.muted, fontSize = 12.sp) },
        singleLine = true,
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        modifier = Modifier.fillMaxWidth(),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Ink.bg,
            unfocusedContainerColor = Ink.bg,
            focusedTextColor = Ink.text,
            unfocusedTextColor = Ink.text,
            cursorColor = Ink.accent,
            focusedIndicatorColor = Ink.accent,
            unfocusedIndicatorColor = Ink.border,
        ),
    )
}
