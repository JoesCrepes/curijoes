package com.curijoes.audioscrobbler

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/** Plain SharedPreferences: single user, single device, no secrets worth a keystore yet. */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("scrobbler", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", "")!!.trimEnd('/')
        set(v) = sp.edit().putString("server_url", v.trim()).apply()

    var token: String
        get() = sp.getString("token", "")!!
        set(v) = sp.edit().putString("token", v.trim()).apply()

    var deviceName: String
        get() = sp.getString("device_name", android.os.Build.MODEL)!!
        set(v) = sp.edit().putString("device_name", v.trim()).apply()

    val deviceId: String
        get() = sp.getString("device_id", null) ?: UUID.randomUUID().toString().also { sp.edit().putString("device_id", it).apply() }

    var allowedApps: Set<String>
        get() = sp.getString("allowed_apps", DEFAULT_APPS)!!.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        set(v) = sp.edit().putString("allowed_apps", v.joinToString(",")).apply()

    var captureAll: Boolean
        get() = sp.getBoolean("capture_all", false)
        set(v) = sp.edit().putBoolean("capture_all", v).apply()

    var lastUploadStatus: String
        get() = sp.getString("last_upload", "never")!!
        set(v) = sp.edit().putString("last_upload", v).apply()

    var notifiedActionIds: Set<String>
        get() = sp.getStringSet("notified_actions", emptySet())!!
        set(v) = sp.edit().putStringSet("notified_actions", v).apply()

    val configured: Boolean get() = serverUrl.startsWith("http") && token.isNotEmpty()

    fun shouldCapture(pkg: String): Boolean = captureAll || pkg in allowedApps

    companion object {
        // Audible and Libby are well known; Libro.fm's package is a guess to be
        // corrected from the status panel (it lists every active session's package).
        const val DEFAULT_APPS = "com.audible.application,fm.libro.librofm,com.overdrive.mobile.android.libby"
    }
}
