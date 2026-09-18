package com.curijoes.audioscrobbler

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

/** Outbox for events awaiting upload. Rows are deleted only after the server acknowledges them. */
class EventStore private constructor(context: Context) : SQLiteOpenHelper(context, "events.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("create table pending (id text primary key, created_at integer not null, json text not null)")
        db.execSQL("create table log (seq integer primary key autoincrement, created_at integer not null, summary text not null)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    fun insert(event: JSONObject) {
        writableDatabase.insertWithOnConflict("pending", null, ContentValues().apply {
            put("id", event.getString("id"))
            put("created_at", System.currentTimeMillis())
            put("json", event.toString())
        }, SQLiteDatabase.CONFLICT_IGNORE)
        val summary = "${event.optString("event_type")} ${event.optString("app_package").substringAfterLast('.')} " +
            "ch${event.optInt("chapter_idx", -1)} ${event.optLong("position_ms") / 1000}s" +
            (if (event.optBoolean("is_playing")) " ▶" else "")
        writableDatabase.insert("log", null, ContentValues().apply {
            put("created_at", System.currentTimeMillis())
            put("summary", summary)
        })
        writableDatabase.execSQL("delete from log where seq not in (select seq from log order by seq desc limit 30)")
    }

    fun takeBatch(limit: Int): List<Pair<String, JSONObject>> {
        val out = ArrayList<Pair<String, JSONObject>>()
        readableDatabase.rawQuery("select id, json from pending order by created_at asc limit $limit", null).use { c ->
            while (c.moveToNext()) out.add(c.getString(0) to JSONObject(c.getString(1)))
        }
        return out
    }

    fun delete(ids: Collection<String>) {
        if (ids.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in ids) db.delete("pending", "id = ?", arrayOf(id))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun count(): Long = readableDatabase.rawQuery("select count(*) from pending", null).use { it.moveToFirst(); it.getLong(0) }

    /** Drop everything, queued and logged. Used by the debug config receiver and tests. */
    fun clear() {
        writableDatabase.execSQL("delete from pending")
        writableDatabase.execSQL("delete from log")
    }

    fun recentLog(): List<String> {
        val out = ArrayList<String>()
        readableDatabase.rawQuery("select created_at, summary from log order by seq desc limit 12", null).use { c ->
            while (c.moveToNext()) out.add(java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(c.getLong(0)) + " " + c.getString(1))
        }
        return out
    }

    companion object {
        @Volatile private var instance: EventStore? = null
        fun get(context: Context): EventStore = instance ?: synchronized(this) {
            instance ?: EventStore(context.applicationContext).also { instance = it }
        }
    }
}
