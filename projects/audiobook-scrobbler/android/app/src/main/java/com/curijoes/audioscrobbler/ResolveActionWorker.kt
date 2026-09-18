package com.curijoes.audioscrobbler

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONObject

class ResolveActionWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString(ActionReceiver.EXTRA_ACTION_ID) ?: return Result.failure()
        val resolution = inputData.getString(ActionReceiver.EXTRA_RESOLUTION) ?: return Result.failure()
        val prefs = Prefs(applicationContext)
        return try {
            Api(prefs).post("/api/actions/$id", JSONObject(resolution))
            prefs.notifiedActionIds = prefs.notifiedActionIds - id
            Result.success()
        } catch (e: Api.HttpException) {
            ServiceState.lastError = "resolve: ${e.message}"
            if (e.code in 400..499) Result.failure() else Result.retry()
        } catch (e: Exception) {
            ServiceState.lastError = "resolve: ${e.message}"
            Result.retry()
        }
    }
}
