package com.curijoes.audioscrobbler

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBars
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.app.NotificationManagerCompat
import com.curijoes.audioscrobbler.ui.Ink
import com.curijoes.audioscrobbler.ui.ScrobblerTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Where the app opens when a prompt notification is tapped. */
const val EXTRA_ACTION_ID = "open_action_id"

private sealed interface Screen {
    data object Home : Screen
    data object Settings : Screen
    data class Match(val actionId: String) : Screen
    data class Finish(val actionId: String) : Screen
    data class Book(val readId: String) : Screen
}

class MainActivity : ComponentActivity() {

    private lateinit var prefs: Prefs
    private val scope = CoroutineScope(Dispatchers.Main.immediate)

    private var dash by mutableStateOf<Dashboard?>(null)
    private var error by mutableStateOf<String?>(null)
    private var busy by mutableStateOf(false)
    private var screen by mutableStateOf<Screen>(Screen.Home)
    private var tick by mutableStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        handleIntent(intent)

        setContent {
            ScrobblerTheme {
                @Suppress("UNUSED_EXPRESSION") tick // recompose when device state is re-read
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Ink.bg)
                        .windowInsetsPadding(WindowInsets.systemBars),
                ) {
                    Router()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        tick++
        refresh()
    }

    private fun handleIntent(i: Intent?) {
        val id = i?.getStringExtra(EXTRA_ACTION_ID) ?: return
        // The type is only known once the dashboard arrives, so park the id and
        // let the router pick the right screen when it does.
        pendingActionId = id
    }

    private var pendingActionId: String? = null

    @androidx.compose.runtime.Composable
    private fun Router() {
        val d = dash
        val pending = pendingActionId
        if (pending != null && d != null) {
            val a = d.actions.firstOrNull { it.id == pending }
            pendingActionId = null
            if (a != null) screen = if (a.type == "match_book") Screen.Match(a.id) else Screen.Finish(a.id)
        }

        val listenerOk = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
        val notifOk = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        when (val s = screen) {
            is Screen.Home -> com.curijoes.audioscrobbler.ui.HomeScreen(
                dash = d,
                error = error,
                listenerOk = listenerOk,
                watching = prefs.allowedApps.size,
                lastUpload = prefs.lastUploadStatus.substringBefore(","),
                onOpenSettings = { screen = Screen.Settings },
                onOpenAction = { a -> screen = if (a.type == "match_book") Screen.Match(a.id) else Screen.Finish(a.id) },
                onOpenRead = { r -> screen = Screen.Book(r.id) },
            )

            is Screen.Settings -> {
                val seen = ServiceState.sessions.map { it.substringBefore(' ') }.filter { it.isNotBlank() }
                val allowed = prefs.allowedApps
                val apps = (seen + allowed).distinct().sorted().map { pkg ->
                    com.curijoes.audioscrobbler.ui.WatchableApp(
                        pkg = pkg,
                        label = appLabel(pkg),
                        watched = pkg in allowed,
                        playing = ServiceState.sessions.any { it.startsWith(pkg) && it.endsWith("state=3") },
                    )
                }
                com.curijoes.audioscrobbler.ui.SettingsScreen(
                    serverUrl = prefs.serverUrl,
                    token = prefs.token,
                    deviceName = prefs.deviceName,
                    apps = apps,
                    listenerOk = listenerOk,
                    notificationsOk = notifOk,
                    queued = EventStore.get(this).count(),
                    lastUpload = prefs.lastUploadStatus,
                    lastError = ServiceState.lastError,
                    onBack = { screen = Screen.Home; refresh() },
                    onServerUrl = { prefs.serverUrl = it; tick++ },
                    onToken = { prefs.token = it; tick++ },
                    onDeviceName = { prefs.deviceName = it; tick++ },
                    onToggleApp = { pkg, on ->
                        prefs.allowedApps = if (on) prefs.allowedApps + pkg else prefs.allowedApps - pkg
                        tick++
                    },
                    onGrantListener = { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) },
                    onGrantNotifications = { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1) },
                    onUploadNow = { MediaListenerService.scheduleUpload(this); tick++ },
                )
            }

            is Screen.Match -> {
                val a = d?.actions?.firstOrNull { it.id == s.actionId }
                if (a == null) screen = Screen.Home
                else com.curijoes.audioscrobbler.ui.MatchScreen(
                    a = a, busy = busy,
                    onBack = { screen = Screen.Home },
                    onPick = { i -> resolve(a.id, JSONObject().put("candidate", i)) },
                    onSkip = { resolve(a.id, JSONObject().put("skip", true)) },
                )
            }

            is Screen.Finish -> {
                val a = d?.actions?.firstOrNull { it.id == s.actionId }
                if (a == null) screen = Screen.Home
                else com.curijoes.audioscrobbler.ui.FinishScreen(
                    a = a, busy = busy,
                    onBack = { screen = Screen.Home },
                    onResolve = { key -> resolve(a.id, JSONObject().put(key, true)) },
                )
            }

            is Screen.Book -> {
                val r = d?.reads?.firstOrNull { it.id == s.readId }
                if (r == null) screen = Screen.Home
                else com.curijoes.audioscrobbler.ui.BookScreen(
                    r = r, busy = busy,
                    onBack = { screen = Screen.Home },
                    onStatus = { status -> setStatus(r.id, status) },
                )
            }
        }
    }

    // --- server calls -------------------------------------------------------

    private fun refresh() {
        if (!prefs.configured) {
            error = "Set the server address and token in Settings."
            return
        }
        scope.launch {
            try {
                val json = withContext(Dispatchers.IO) { Api(prefs).get("/api/dashboard") }
                dash = DashboardParser.parse(json)
                error = null
            } catch (e: Exception) {
                error = e.message ?: "Could not reach the server"
            }
        }
    }

    private fun resolve(actionId: String, body: JSONObject) {
        busy = true
        scope.launch {
            try {
                withContext(Dispatchers.IO) { Api(prefs).post("/api/actions/$actionId", body) }
                screen = Screen.Home
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save that"
            } finally {
                busy = false
            }
        }
    }

    private fun setStatus(readId: String, status: String) {
        busy = true
        scope.launch {
            try {
                withContext(Dispatchers.IO) { Api(prefs).post("/api/reads/$readId/status", JSONObject().put("status", status)) }
                refresh()
            } catch (e: Exception) {
                error = e.message ?: "Could not save that"
            } finally {
                busy = false
            }
        }
    }
}
