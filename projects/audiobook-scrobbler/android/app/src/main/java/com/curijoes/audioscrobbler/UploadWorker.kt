package com.curijoes.audioscrobbler

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject

/** Drains the outbox to POST /api/ingest in batches; retries with WorkManager backoff. */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        val store = EventStore.get(applicationContext)
        val api = Api(prefs)
        if (!prefs.configured) {
            prefs.lastUploadStatus = "not configured"
            return Result.failure()
        }
        var sent = 0
        try {
            while (true) {
                val batch = store.takeBatch(200)
                if (batch.isEmpty()) break
                val body = JSONObject().apply {
                    put("device", JSONObject().put("id", prefs.deviceId).put("name", prefs.deviceName))
                    put("events", JSONArray().also { arr -> batch.forEach { arr.put(it.second) } })
                }
                val res = api.post("/api/ingest", body)
                store.delete(batch.map { it.first })
                sent += batch.size
                prefs.lastUploadStatus = "ok ${java.time.LocalTime.now().withNano(0)}: sent $sent, server $res"
            }
            if (sent > 0) ActionsWorker.runNow(applicationContext)
            return Result.success()
        } catch (e: Api.HttpException) {
            prefs.lastUploadStatus = "HTTP ${e.code} ${e.message}"
            // 4xx other than 429 won't fix itself by retrying the same payload.
            return if (e.code in 400..499 && e.code != 429) Result.failure() else Result.retry()
        } catch (e: Exception) {
            prefs.lastUploadStatus = "retrying: ${e.message}"
            return Result.retry()
        }
    }
}
