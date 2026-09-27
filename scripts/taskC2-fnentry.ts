// Phase C2 functional-test entry — re-exports the REAL main-process
// appPrefs (with the Phase-C2 testUrl field) and the REAL renderer
// latencyHistory slice (pure, no imports) under the electron stub.
export {
  loadAppPrefs, saveAppPrefs, sanitizePrefsPatch,
  normalizeTestUrl, normalizeLanguage,
  URL_TEST_DEFAULT, DEFAULT_APP_PREFS,
} from "../electron-app/electron/appPrefs";
export {
  pushLatencySample, getLatencyHistory, lastLatencySample,
  clearLatencyHistory, subscribeLatencyHistory, LATENCY_HISTORY_MAX,
} from "../src/utils/latencyHistory";
