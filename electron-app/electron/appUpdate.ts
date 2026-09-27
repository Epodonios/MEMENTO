/**
 * MEMENTO — MEMENTO's own update helper (Phase C6, Option A: the honest
 * assistant, approved by the user).
 *
 * DELIBERATE SCOPE — what this module deliberately does NOT do:
 *   - it never checks the network (no fetch/https import, no timers);
 *   - it never downloads anything;
 *   - it never replaces, patches or re-launches the running executable
 *     (no self-swap — that path is Option B, postponed, not cancelled);
 *   - it never imports electron, fs, child_process or the autoUpdater.
 *
 * A portable app must never modify the files of the very process it runs
 * from (the C5 portable principle, extended to updates). The helper only
 * carries STATIC facts — this build's version and the pinned releases
 * page — and the renderer opens that page in the USER's browser through
 * the existing open-external shell command. The human performs the check
 * and the replacement; the app stays an honest signpost.
 */

/**
 * The ONE place the distribution channel is recorded. If the project
 * ever moves, edit this constant (and the docs) — nothing else changes.
 */
export const APP_RELEASES_URL = "https://github.com/epodonios/memento/releases";

/** Static, honest facts for the Settings-tab update panel. */
export interface AppUpdateInfo {
  /** Version of THIS build (passed in from main: app.getVersion()). */
  appVersion: string;
  /** The pinned releases page, opened only on an explicit user click. */
  releasesUrl: string;
  /** Always false by construction — pinned by tests so a future edit
   *  cannot quietly introduce a self-update path. */
  selfUpdate: false;
}

export function appUpdateInfo(appVersion: string): AppUpdateInfo {
  return {
    appVersion: String(appVersion || ""),
    releasesUrl: APP_RELEASES_URL,
    selfUpdate: false,
  };
}
