package com.curijoes.audioscrobbler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Debug builds only. Lets the e2e harness configure the app from adb:
 *
 *   adb shell am broadcast -n com.curijoes.audioscrobbler/.DebugConfigReceiver \
 *       -a com.curijoes.audioscrobbler.DEBUG_CONFIG \
 *       --es server_url http://127.0.0.1:8765 --es token secret \
 *       --es allowed_apps com.curijoes.fakeplayer --ez capture_all false \
 *       --ez reset true --ez upload_now true
 *
 * Every extra is optional; only the ones present are applied.
 */
class DebugConfigReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val prefs = Prefs(context)
        intent.getStringExtra("server_url")?.let { prefs.serverUrl = it }
        intent.getStringExtra("token")?.let { prefs.token = it }
        intent.getStringExtra("device_name")?.let { prefs.deviceName = it }
        intent.getStringExtra("allowed_apps")?.let { v ->
            prefs.allowedApps = v.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        }
        if (intent.hasExtra("capture_all")) prefs.captureAll = intent.getBooleanExtra("capture_all", false)
        if (intent.getBooleanExtra("reset", false)) {
            EventStore.get(context).clear()
            prefs.lastUploadStatus = "never"
            prefs.notifiedActionIds = emptySet()
            ServiceState.lastError = ""
        }
        ActionsWorker.schedulePeriodic(context)
        if (intent.getBooleanExtra("upload_now", false)) MediaListenerService.scheduleUpload(context)
        Log.i("DebugConfig", "applied: url=${prefs.serverUrl} apps=${prefs.allowedApps} captureAll=${prefs.captureAll} configured=${prefs.configured}")
        resultData = "ok configured=${prefs.configured}"
    }
}
