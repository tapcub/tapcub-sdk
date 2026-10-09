package com.tapcub

/** Brand-dependent names in one place. App-global names use the full `tapcub` (plan §6.3); core storage keys are `tc_*` (shared vectors). */
internal object Brand {
    const val PREFS = "tapcub_sdk"
    const val DB = "tapcub_sdk.db"
    const val WORKER_THREAD = "tapcub-worker"
    const val NET_THREAD = "tapcub-net"
    const val LOG_TAG = "TapCub"
    const val DID_FILE = "tapcub_did"
    const val CRASH_FILE = "tapcub_crash_pending.json"
}
