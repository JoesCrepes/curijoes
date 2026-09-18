package com.curijoes.audioscrobbler

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

/** Notification button tap → dismiss the notification, resolve on the server via a worker. */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val actionId = intent.getStringExtra(EXTRA_ACTION_ID) ?: return
        val resolution = intent.getStringExtra(EXTRA_RESOLUTION) ?: return
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(Notifications.idFor(actionId))
        val req = OneTimeWorkRequestBuilder<ResolveActionWorker>()
            .setInputData(Data.Builder().putString(EXTRA_ACTION_ID, actionId).putString(EXTRA_RESOLUTION, resolution).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueue(req)
    }

    companion object {
        const val EXTRA_ACTION_ID = "action_id"
        const val EXTRA_RESOLUTION = "resolution"
    }
}
