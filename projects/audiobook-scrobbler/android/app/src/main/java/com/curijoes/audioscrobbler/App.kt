package com.curijoes.audioscrobbler

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
        ActionsWorker.schedulePeriodic(this)
    }
}
