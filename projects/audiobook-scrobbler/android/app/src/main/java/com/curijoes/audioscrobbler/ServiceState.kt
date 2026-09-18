package com.curijoes.audioscrobbler

/** Live snapshot for the status panel; written by the service, read by the activity. */
object ServiceState {
    @Volatile var connected: Boolean = false
    @Volatile var sessions: List<String> = emptyList()
    @Volatile var lastError: String = ""
}
