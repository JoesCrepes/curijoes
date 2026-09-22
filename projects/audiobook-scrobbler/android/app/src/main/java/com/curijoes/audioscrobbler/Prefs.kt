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
        get() = sp.getString(KEY_ALLOWED_APPS, DEFAULT_APPS)!!.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        set(v) = sp.edit().putString(KEY_ALLOWED_APPS, v.joinToString(",")).apply()

    var captureAll: Boolean
        get() = sp.getBoolean(KEY_CAPTURE_ALL, false)
        set(v) = sp.edit().putBoolean(KEY_CAPTURE_ALL, v).apply()

    /** SharedPreferences keeps listeners weakly; callers must hold a strong reference. */
    fun registerOnChange(l: SharedPreferences.OnSharedPreferenceChangeListener) = sp.registerOnSharedPreferenceChangeListener(l)
    fun unregisterOnChange(l: SharedPreferences.OnSharedPreferenceChangeListener) = sp.unregisterOnSharedPreferenceChangeListener(l)

    var lastUploadStatus: String
        get() = sp.getString("last_upload", "never")!!
        set(v) = sp.edit().putString("last_upload", v).apply()

    var notifiedActionIds: Set<String>
        get() = sp.getStringSet("notified_actions", emptySet())!!
        set(v) = sp.edit().putStringSet("notified_actions", v).apply()

    val configured: Boolean get() = serverUrl.startsWith("http") && token.isNotEmpty()

    fun shouldCapture(pkg: String): Boolean = captureAll || pkg in allowedApps

    companion object {
        const val KEY_ALLOWED_APPS = "allowed_apps"
        const val KEY_CAPTURE_ALL = "capture_all"
        // Audible and Libby are well known; Libro.fm's package is a guess to be
        // corrected from the status panel (it lists every active session's package).
        const val DEFAULT_APPS = "com.audible.application,fm.libro.librofm,com.overdrive.mobile.android.libby"
    }
}
