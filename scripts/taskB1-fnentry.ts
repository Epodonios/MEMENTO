/**
 * taskB1-fnentry.ts — esbuild entry for the Phase B1 functional test.
 * Bundles the REAL routing modules (routingSession.ts + routingHelper.ts
 * + the wintunPin constants they consume) — NO electron alias is needed:
 * both modules are deliberately electron-free (the killSwitch.ts
 * discipline), which is itself part of the B1 contract.
 *
 * Every external effect is injected by taskB1-fntest.mjs:
 *   spawnEngine (a FAKE engine child), probeSocks (the upstream health),
 *   sleep/now (a stepped virtual clock), processAlive/processImageName
 *   (the identity guard), runPublisherCheck (the Authenticode leg)
 * — so the assertions drive the actual product watchdog loop with zero
 * real processes, zero real elevation, and zero real system state.
 */
export {
  // routingSession.ts — the session core under test
  TUN_INTERFACE_NAME,
  HELPER_ROLE_NAME,
  SESSION_BASE_DIR_NAME,
  RECOVERY_FILE_NAME,
  HELPER_FLAG,
  REPAIR_FLAG,
  REQUEST_FILE_NAME,
  STATUS_FILE_NAME,
  CONTROL_FILE_NAME,
  CONFIG_FILE_NAME,
  TUN_MTU_DEFAULT,
  TUN_MTU_MIN,
  TUN_MTU_MAX,
  clampTunMtu,
  validateRequest,
  authorizeRequestPath,
  suppressSystemProxyWrites,
  watchdogOutcome,
  SOCKS_FAILURE_LIMIT,
  SOCKS_PROBE_INTERVAL_MS,
  atomicWriteJson,
  readJsonFile,
  sessionBaseDir,
  recoveryPathFor,
  writeSessionStatus,
  readSessionStatus,
  writeControlStop,
  clearControl,
  writeRecovery,
  readRecovery,
  clearRecovery,
  prepareRoutingSession,
  buildTunSingboxConfig,
  verifyWintunForSpawn,
  wintunDllPathFor,
  buildElevatedLaunchArgs,
  launchElevatedHelper,
} from "../electron-app/electron/routingSession";
export {
  // routingHelper.ts — the elevated side under test
  isHelperInvocation,
  parseHelperArgv,
  runRoutingHelper,
  runNetworkRepair,
  runHelperInvocation,
  ensureWintunBesideEngine,
  killEnginePidGuarded,
  cleanupStaleSession,
} from "../electron-app/electron/routingHelper";
export {
  // wintunPin.ts — the B0 identity the gate re-verifies
  WINTUN_DLL_SHA256,
  WINTUN_PUBLISHER,
  WINTUN_DLL_RELATIVE_PATH,
} from "../electron-app/electron/wintunPin";
