package com.tapcub

import android.content.ContentValues
import android.content.Context
import android.content.SharedPreferences
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.tapcub.core.Storage
import java.io.File

/**
 * Small keys go to SharedPreferences("tapcub_sdk"); queue chunks (`tc_q*`) go to a SQLite key-value table so a
 * 40-event chunk rewrite does not rewrite the whole preferences XML. `tc_did` lives in a file under
 * `noBackupFilesDir`, so a restored backup on another phone does not clone the device id. Removing it records
 * a rotation so the next id is generated instead of falling back to ANDROID_ID again (otherwise `reset()`
 * would not rotate).
 */
internal class DeviceStorage(context: Context) : Storage {
    private val prefs: SharedPreferences = context.getSharedPreferences(Brand.PREFS, Context.MODE_PRIVATE)
    private val db = KvDb(context)
    private val didFile = File(noBackupDir(context), Brand.DID_FILE)

    override fun get(key: String): String? = when {
        key.startsWith("tc_q") -> db.get(key)
        key == DID_KEY -> if (didFile.exists()) runCatching { didFile.readText() }.getOrNull()?.takeIf { it.isNotEmpty() } else null
        else -> prefs.getString(key, null)
    }

    override fun set(key: String, value: String) {
        when {
            key.startsWith("tc_q") -> db.set(key, value)
            key == DID_KEY -> {
                val tmp = File(didFile.parentFile, didFile.name + ".tmp")
                tmp.writeText(value)
                if (!tmp.renameTo(didFile)) {
                    didFile.writeText(value)
                    tmp.delete()
                }
            }
            else -> prefs.edit().putString(key, value).apply()
        }
    }

    override fun remove(key: String) {
        when {
            key.startsWith("tc_q") -> db.remove(key)
            key == DID_KEY -> {
                didFile.delete()
                prefs.edit().putString(ROTATED_KEY, "1").apply()
            }
            else -> prefs.edit().remove(key).apply()
        }
    }

    /** True once the core has dropped a device id on this install. */
    val didRotated: Boolean get() = prefs.getString(ROTATED_KEY, null) == "1"

    companion object {
        const val DID_KEY = "tc_did"
        const val ROTATED_KEY = "tapcub_did_rotated"

        fun noBackupDir(context: Context): File = context.noBackupFilesDir
    }
}

private class KvDb(context: Context) : SQLiteOpenHelper(context, Brand.DB, null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS tapcub_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    fun get(k: String): String? =
        readableDatabase.query("tapcub_kv", arrayOf("v"), "k = ?", arrayOf(k), null, null, null).use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    fun set(k: String, v: String) {
        val values = ContentValues(2)
        values.put("k", k)
        values.put("v", v)
        if (writableDatabase.insertWithOnConflict("tapcub_kv", null, values, SQLiteDatabase.CONFLICT_REPLACE) == -1L) {
            throw IllegalStateException("sqlite write failed for $k")
        }
    }

    fun remove(k: String) {
        writableDatabase.delete("tapcub_kv", "k = ?", arrayOf(k))
    }
}
