/**
 * taskC6-fnentry.ts — esbuild entry for the Phase C6 functional test.
 * Bundles the REAL main-process update modules (aetherUpdate.ts +
 * appUpdate.ts + their transitive deps incl. the two JSON tables) —
 * NO electron alias is needed: both modules are deliberately
 * electron-free, which is itself part of the C6 contract.
 *
 * Every external effect is injected by taskC6-fntest.mjs:
 *   transport  (the only network seam), isRunning (the running lock),
 *   binaryPath / swapTargetDir (a temp dir), tablePath (test tables)
 * — so the assertions run against the actual product code with zero
 * real network and zero real system state.
 */
export {
  // aetherUpdate.ts — the REAL pin-per-version service under test
  loadAetherVersionTable,
  semverCompare,
  sha256Bytes,
  sha256File,
  createAetherUpdateService,
  defaultTransport,
} from "../electron-app/electron/aetherUpdate";
export {
  // appUpdate.ts — the honest self-update assistant (static facts only)
  appUpdateInfo,
  APP_RELEASES_URL,
} from "../electron-app/electron/appUpdate";
