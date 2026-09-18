package com.curijoes.audioscrobbler

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            renderStatus()
            handler.postDelayed(this, 2000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)

        val serverUrl = findViewById<EditText>(R.id.serverUrl)
        val token = findViewById<EditText>(R.id.token)
        val deviceName = findViewById<EditText>(R.id.deviceName)
        val allowedApps = findViewById<EditText>(R.id.allowedApps)
        val captureAll = findViewById<CheckBox>(R.id.captureAll)

        serverUrl.setText(prefs.serverUrl)
        token.setText(prefs.token)
        deviceName.setText(prefs.deviceName)
        allowedApps.setText(prefs.allowedApps.joinToString(","))
        captureAll.isChecked = prefs.captureAll

        findViewById<Button>(R.id.save).setOnClickListener {
            prefs.serverUrl = serverUrl.text.toString()
            prefs.token = token.text.toString()
            prefs.deviceName = deviceName.text.toString()
            prefs.allowedApps = allowedApps.text.toString().split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()
            prefs.captureAll = captureAll.isChecked
            ActionsWorker.schedulePeriodic(this)
            MediaListenerService.scheduleUpload(this)
            renderStatus()
        }
        findViewById<Button>(R.id.grantListener).setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        findViewById<Button>(R.id.grantNotif).setOnClickListener {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        findViewById<Button>(R.id.uploadNow).setOnClickListener { MediaListenerService.scheduleUpload(this) }
        findViewById<Button>(R.id.checkActions).setOnClickListener { ActionsWorker.runNow(this) }
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun renderStatus() {
        val listenerOk = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
        val notifOk = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val store = EventStore.get(this)
        val sb = StringBuilder()
        sb.append("notification access: ").append(if (listenerOk) "granted" else "MISSING").append('\n')
        sb.append("listener connected:  ").append(ServiceState.connected).append('\n')
        sb.append("notifications:       ").append(if (notifOk) "allowed" else "not allowed").append('\n')
        sb.append("configured:          ").append(prefs.configured).append('\n')
        sb.append("queued events:       ").append(store.count()).append('\n')
        sb.append("last upload:         ").append(prefs.lastUploadStatus).append('\n')
        if (ServiceState.lastError.isNotEmpty()) sb.append("last error:          ").append(ServiceState.lastError).append('\n')
        sb.append("\nactive media sessions:\n")
        if (ServiceState.sessions.isEmpty()) sb.append("  (none)\n") else ServiceState.sessions.forEach { sb.append("  ").append(it).append('\n') }
        sb.append("\nrecent events:\n")
        store.recentLog().forEach { sb.append("  ").append(it).append('\n') }
        findViewById<TextView>(R.id.status).text = sb.toString()
    }
}
