package com.curijoes.audioscrobbler

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Polls GET /api/actions and turns pending prompts into notifications with
 * buttons. No push service: the phone is the only client and 15-minute
 * polling is plenty for "did you finish this book?".
 */
class ActionsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        if (!prefs.configured) return Result.failure()
        val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return try {
            val res = Api(prefs).get("/api/actions")
            val actions = res.optJSONArray("actions") ?: return Result.success()
            val pendingIds = HashSet<String>()
            for (i in 0 until actions.length()) {
                val a = actions.getJSONObject(i)
                val id = a.getString("id")
                pendingIds.add(id)
                if (id in prefs.notifiedActionIds) continue
                nm.notify(Notifications.idFor(id), buildNotification(a))
            }
            // Prompts resolved elsewhere (the PWA) disappear from the shade.
            for (old in prefs.notifiedActionIds) if (old !in pendingIds) nm.cancel(Notifications.idFor(old))
            prefs.notifiedActionIds = pendingIds
            Result.success()
        } catch (e: Exception) {
            ServiceState.lastError = "actions: ${e.message}"
            Result.retry()
        }
    }

    private fun buildNotification(a: JSONObject): Notification {
        val ctx = applicationContext
        val id = a.getString("id")
        val payload = a.optJSONObject("payload") ?: JSONObject()
        val title = payload.optString("title", "a book")
        val open = PendingIntent.getActivity(
            ctx, Notifications.idFor(id),
            Intent(Intent.ACTION_VIEW, Uri.parse(Prefs(ctx).serverUrl + "/")),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val b = Notification.Builder(ctx, Notifications.CHANNEL_PROMPTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(open)
            .setAutoCancel(true)

        when (a.optString("type")) {
            "match_book" -> {
                val cands = payload.optJSONArray("candidates")
                b.setContentTitle("Which book is “$title”?")
                val lines = StringBuilder()
                if (cands != null) for (i in 0 until minOf(cands.length(), 2)) {
                    val c = cands.getJSONObject(i)
                    val label = c.optString("title").take(24)
                    lines.append("${i + 1}. ${c.optString("title")} — ${c.optString("author", "?")}\n")
                    b.addAction(action(id, "${i + 1}: $label", JSONObject().put("candidate", i)))
                }
                b.addAction(action(id, "None", JSONObject().put("skip", true)))
                b.setContentText(if (lines.isEmpty()) "No candidates found. Tap to search." else lines.toString().trim())
                b.setStyle(Notification.BigTextStyle().bigText(if (lines.isEmpty()) "No candidates found. Tap to search on the web." else lines.toString().trim() + "\nTap to see more on the web."))
            }
            "confirm_finished" -> {
                val pct = (payload.optDouble("pct", 0.0) * 100).toInt()
                b.setContentTitle("Finished “$title”?")
                b.setContentText("Parked at $pct% with no recent listening.")
                b.addAction(action(id, "Finished", JSONObject().put("finished", true)))
                b.addAction(action(id, "Not yet", JSONObject().put("not_yet", true)))
                b.addAction(action(id, "DNF", JSONObject().put("dnf", true)))
            }
            else -> b.setContentTitle("Scrobbler needs input").setContentText(a.toString())
        }
        return b.build()
    }

    private fun action(actionId: String, label: String, resolution: JSONObject): Notification.Action {
        val ctx = applicationContext
        val intent = Intent(ctx, ActionReceiver::class.java)
            .setAction("resolve:$actionId:${resolution}")
            .putExtra(ActionReceiver.EXTRA_ACTION_ID, actionId)
            .putExtra(ActionReceiver.EXTRA_RESOLUTION, resolution.toString())
        val pi = PendingIntent.getBroadcast(ctx, (actionId + resolution).hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Notification.Action.Builder(null, label, pi).build()
    }

    companion object {
        fun schedulePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<ActionsWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("actions", ExistingPeriodicWorkPolicy.KEEP, req)
            val up = PeriodicWorkRequestBuilder<UploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("upload-periodic", ExistingPeriodicWorkPolicy.KEEP, up)
        }

        fun runNow(context: Context) {
            val req = OneTimeWorkRequestBuilder<ActionsWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("actions-now", ExistingWorkPolicy.REPLACE, req)
        }
    }
}
