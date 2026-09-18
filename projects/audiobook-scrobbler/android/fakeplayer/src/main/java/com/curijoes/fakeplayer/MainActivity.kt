package com.curijoes.fakeplayer

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.TextView

/**
 * Sole entry point for adb. Starting an activity is always allowed to start a
 * foreground service, so every command is `am start -n <pkg>/.MainActivity -a
 * com.curijoes.fakeplayer.<CMD> [extras]` and gets forwarded to PlayerService.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            setPadding(48, 48, 48, 48)
            text = "Fake audiobook player.\n\nDrive it with adb, e.g.\n" +
                "am start -n $packageName/.MainActivity -a $packageName.LOAD --es title \"The Hobbit\" --es author Tolkien\n" +
                "am start -n $packageName/.MainActivity -a $packageName.PLAY\n\nSee android/tools/e2e.py."
        })
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        forward(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        forward(intent)
    }

    private fun forward(intent: Intent?) {
        val action = intent?.action ?: return
        if (!action.startsWith(packageName)) return
        val svc = Intent(this, PlayerService::class.java).setAction(action)
        intent.extras?.let { svc.putExtras(it) }
        startForegroundService(svc)
    }
}
