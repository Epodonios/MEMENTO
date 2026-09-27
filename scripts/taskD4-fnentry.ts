// Phase D4 functional-test entry: expose the REAL appPrefs.ts (main
// process module) + the tray label model under the electron stub.
export {
  DEFAULT_APP_PREFS,
  loadAppPrefs,
  saveAppPrefs,
  sanitizePrefsPatch,
  normalizeLanguage,
  APP_LANGUAGES,
} from "../electron-app/electron/appPrefs";
export { trayLabels } from "../electron-app/electron/tray";
