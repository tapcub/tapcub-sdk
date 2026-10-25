# TapCub (Android)

TapCub analytics SDK for Android. minSdk 21, Kotlin 2.0 / Java 8 bytecode; Java calls look the same as Kotlin (`@JvmStatic`).

## Install

```kotlin
dependencies {
    implementation("com.tapcub:android:0.1.1")
}
```

Until the SDK is on Maven Central, use your local repository: run `./gradlew publishToMavenLocal` in `packages/android` of [tapcub-sdk](https://github.com/tapcub/tapcub-sdk), then add `mavenLocal()` to your project.

`com.tapcub:android` depends on the pure-JVM `com.tapcub:core` (the core logic, no Android code), which is pulled in automatically.

## Quick start

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // Only stores the config and hooks lifecycles: no collection, no device reads, no network
        TapCub.preInit(this, TapCubConfig(siteKey = "s_xxx"))
    }
}

// After the user accepts the privacy policy (call right after preInit if the site does not require consent)
TapCub.init()
```

`appId`, `appVersion` and `appBuild` default to the package name and `versionName` / `versionCode`. Call `preInit` in `Application.onCreate`; otherwise the first screen of a cold start and the launch time are lost.

Java:

```java
TapCub.preInit(this, new TapCubConfig("s_xxx"));
TapCub.init(null);
```

## Common calls

```kotlin
TapCub.track("checkout", mapOf("amount" to 99.0, "currency" to "CNY"))
TapCub.trackScreen("Checkout")
TapCub.login("u_123")                        // type: login | email | mobile | unionid | openid | custom
TapCub.setProps(mapOf("plan" to "pro"))      // user properties
TapCub.registerSuperProps(mapOf("channel" to "huawei"))
TapCub.grantConsent(listOf("analytics"))     // analytics | functional | marketing
TapCub.optOut()
TapCub.trackPurchase(mapOf("product_id" to "vip_month", "amount" to 30, "currency" to "CNY"))
TapCub.trackDeeplink(intent.dataString ?: "")
TapCub.flush()
val did = TapCub.getDeviceId()
```

Every call is posted to the SDK's own `tapcub-worker` thread, so it can be made from any thread and returns immediately; network requests run on a separate `tapcub-net` thread. Getters read a snapshot refreshed after each call and never block. Callbacks (`onConsentChange`, `onSessionStart`, `onError`, `init(callback)`) run on the main thread.

## Automatic collection

| Event | Source | How to turn off |
| --- | --- | --- |
| `$app_start` / `$app_end`, sessions | Foreground / background counting via `ActivityLifecycleCallbacks` (rotation does not count) | Always on |
| `$screen_view` | Activity `onResume` (name from `@TapCubScreen`, else the class name) | `autoTrackScreens = false` |
| `$app_click` | Wraps `Window.Callback` and hits the deepest clickable View | `autoTrack = false` or remote config |
| `$app_crashed` | Uncaught Java exceptions (reported on the next launch with the original crash time); native crashes on API 30+ come from `ApplicationExitInfo` | `crashReport = false` |
| `$anr` | Read from `ApplicationExitInfo` on API 30+, with the trace | Same as above |
| `$fps_sample` / `$memory_sample` | Once per session, 10 s of Choreographer sampling | `perf = true` or remote `rc.perf` |

Cold start time is in `$duration_ms` on `$app_start` (API 24+, from process start until the first Activity is visible). The crash handler chains in front of any existing handler (Firebase Crashlytics, for example) and hands over to it after writing its record.

Screen names and click customization:

```kotlin
@TapCubScreen("Order")
class OrderActivity : AppCompatActivity()

TapCub.ignoreScreen(SplashActivity::class.java)
TapCub.setElementId(buyButton, "buy")        // defaults to the resource id name
TapCub.ignoreView(secretPanel)               // no clicks from it or its children
```

Input fields (`EditText`) record only the widget type and id, never the content. Screens inside Fragments, Compose or Dialogs are not collected automatically; use `trackScreen`.

## Storage and privacy

- Plain keys go to `SharedPreferences("tapcub_sdk")`; the event queue lives in SQLite (`tapcub_sdk.db`), capped by default at 8 MB / 10,000 events / 7 days.
- Device ID: `android_id:<ANDROID_ID>`, with a copy in `noBackupFilesDir` so it stays out of cloud backups. After `reset()` a new ID is generated and the SDK no longer falls back to ANDROID_ID.
- Declares only the `INTERNET` permission. The network type is read only if the host already declares `ACCESS_NETWORK_STATE`. IMEI, MAC, OAID and the advertising ID are never read.
- ProGuard / R8 rules ship with the AAR (`consumer-rules.pro`); hosts need no extra configuration.

## Development

In this directory (`packages/android`):

```bash
./gradlew :core:test -Ptapcub.coreOnly=true     # shared vectors, needs only JDK 17
./gradlew :sdk:assembleRelease :sdk:lintRelease   # needs the Android SDK (ANDROID_HOME or local.properties)
node --test test/api_surface.mjs            # source API surface check, no JDK needed
```

`core/` is a line-by-line port of the TypeScript core `packages/app-sdk/src/core`: change the vectors and the TS first, then port the change here. Brand constants live in `sdk/src/main/java/com/tapcub/Brand.kt`.
