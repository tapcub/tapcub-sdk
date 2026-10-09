/** Brand-dependent names in one place. App-global names use the full `tapcub` (plan §6.3); core storage keys are `tc_*` (shared vectors). */
export const Brand = {
  PREFS: 'tapcub_sdk',
  QUEUE_DIR: 'tapcub_queue',
  LOG_TAG: 'TapCub',
  LOG_DOMAIN: 0x5743,
  CRASH_WATCHER: 'tapcub_crash_watcher',
} as const;
