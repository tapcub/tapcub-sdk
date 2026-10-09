package com.tapcub

import android.Manifest
import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import com.tapcub.core.DeviceInfo
import com.tapcub.core.DeviceSnapshot
import java.util.Locale
import java.util.TimeZone

/**
 * Device info for Android. Everything here is only read after consent (the core decides when).
 * The network type needs ACCESS_NETWORK_STATE; the SDK does not declare it and reports `unknown` without it.
 */
internal class SystemDevice(private val context: Context, private val storage: DeviceStorage) : DeviceInfo {
    override val platform = "android"

    override fun read(): DeviceSnapshot {
        val (w, h, density) = screen()
        return DeviceSnapshot(
            os = "Android",
            osVersion = Build.VERSION.RELEASE,
            brand = Build.MANUFACTURER,
            model = Build.MODEL,
            deviceType = deviceType(),
            screenWidth = w,
            screenHeight = h,
            pixelRatio = density,
            locale = languageTag(Locale.getDefault()),
            timezone = TimeZone.getDefault().id,
        )
    }

    private fun deviceType(): String {
        val ui = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return "tv"
        return if (context.resources.configuration.smallestScreenWidthDp >= 600) "tablet" else "phone"
    }

    @Suppress("DEPRECATION")
    private fun screen(): Triple<Int?, Int?, Double?> {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return Triple(null, null, null)
        val density = context.resources.displayMetrics.density.toDouble()
        val (a, b) = if (Build.VERSION.SDK_INT >= 30) {
            val r = wm.maximumWindowMetrics.bounds
            r.width() to r.height()
        } else {
            val m = DisplayMetrics()
            wm.defaultDisplay.getRealMetrics(m)
            m.widthPixels to m.heightPixels
        }
        if (a <= 0 || b <= 0) return Triple(null, null, density)
        return Triple(minOf(a, b), maxOf(a, b), density)
    }

    override fun networkType(cb: (String?) -> Unit) {
        cb(readNetworkType())
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun readNetworkType(): String {
        val granted = context.checkPermission(Manifest.permission.ACCESS_NETWORK_STATE, Process.myPid(), Process.myUid()) == PackageManager.PERMISSION_GRANTED
        if (!granted) return "unknown"
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return "unknown"
        return try {
            if (Build.VERSION.SDK_INT >= 23) {
                val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "none"
                when {
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                    else -> "unknown"
                }
            } else {
                val info = cm.activeNetworkInfo ?: return "none"
                if (!info.isConnected) return "none"
                when (info.type) {
                    ConnectivityManager.TYPE_WIFI -> "wifi"
                    ConnectivityManager.TYPE_MOBILE -> "cellular"
                    ConnectivityManager.TYPE_ETHERNET -> "ethernet"
                    else -> "unknown"
                }
            }
        } catch (_: SecurityException) {
            "unknown"
        }
    }

    /** `android_id:<ANDROID_ID>`; null after a rotation or when the value is missing / the known bad value. */
    @SuppressLint("HardwareIds")
    override fun deviceId(): String? {
        storage.get(DeviceStorage.DID_KEY)?.let { return it }
        if (storage.didRotated) return null
        val id = try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        } catch (_: Exception) {
            null
        }
        if (id.isNullOrEmpty() || id.length < 8 || id == BAD_ANDROID_ID || !ID_RE.matches(id)) return null
        return "android_id:${id.lowercase(Locale.ROOT)}"
    }

    companion object {
        private const val BAD_ANDROID_ID = "9774d56d682e549c"
        private val ID_RE = Regex("^[A-Za-z0-9]{8,64}$")

        /** `zh-Hans-CN` → `zh-CN`, `zh-Hant` → `zh-TW`, `en-US` unchanged (same shape as the other SDKs). */
        fun languageTag(l: Locale): String {
            val lang = l.language.ifEmpty { return "und" }
            if (l.country.isNotEmpty()) return "$lang-${l.country}"
            if (lang == "zh" && l.script.isNotEmpty()) return if (l.script == "Hant") "zh-TW" else "zh-CN"
            return lang
        }
    }
}
