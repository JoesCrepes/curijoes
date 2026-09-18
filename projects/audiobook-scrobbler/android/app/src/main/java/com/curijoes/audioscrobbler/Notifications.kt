package com.curijoes.audioscrobbler

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

object Notifications {
    const val CHANNEL_PROMPTS = "prompts"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PROMPTS, "Book prompts", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Which book is this? / Did you finish?"
            }
        )
    }

    /** Stable small int per action id for NotificationManager. */
    fun idFor(actionId: String): Int = actionId.hashCode() and 0x7fffffff
}
