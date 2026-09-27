/**
 * taskC5-fnentry.ts — esbuild entry for the Phase C5 functional test.
 * Bundles the REAL main-process modules (appPrefs.ts + proxy.ts +
 * killSwitch.ts + their transitive deps) with electron aliased to the
 * proven C2 stub (taskC2-electron-stub.mts), so the assertions below run
 * against the actual product code, not a copy of it.
 *
 * The bundle is compiled twice by taskC5-fntest.mjs:
 *   A) native linux  — honest non-Windows behavior + REAL prefs file
 *   B) win32 define  — the reg.exe write path is reached; a FAKE reg.exe
 *      on PATH emulates ProxyEnable/ProxyServer with a real query surface
 */
export {
  // appPrefs.ts — the REAL persistence + sanitizer
  DEFAULT_APP_PREFS,
  loadAppPrefs,
  saveAppPrefs,
  sanitizePrefsPatch,
  normalizeLanguage,
  normalizeTestUrl,
} from "../electron-app/electron/appPrefs";
export {
  // proxy.ts — the REAL reg.exe choke point (the only writer)
  isWindows,
  setSystemProxy,
  clearSystemProxy,
  readProxyState,
  setBlockedSystemProxy,
  KILL_SWITCH_BLOCKED_PORT,
} from "../electron-app/electron/proxy";
export {
  // killSwitch.ts — the REAL decision layer under test
  markQuitting,
  isQuitting,
  isKillSwitchArmed,
  releaseSystemProxy,
  blockOnCoreExit,
  resolveAuditAction,
  applyAuditAction,
  enforceKillSwitchAfterPrefChange,
} from "../electron-app/electron/killSwitch";
