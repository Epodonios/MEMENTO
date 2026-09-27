/**
 * taskB2-fnentry.ts — esbuild entry for the Phase B2 functional test.
 * Bundles the REAL routingManager.ts (plus the routingSession.ts core it
 * drives). routingManager is ELECTRON-FREE by contract (the factory takes
 * every platform path/version/exe/kill-switch read as injected deps), so
 * NO electron alias is needed — same discipline as the B1 entry.
 *
 * Every external effect is injected by taskB2-fntest.mjs: the platform,
 * the exe path, the active core's SOCKS inbound, the kill-switch state,
 * the elevation launcher (a capture fake), and the clock — so the
 * assertions drive the actual manager with zero real processes, zero
 * real elevation, and zero real system state.
 */
export {
  // routingManager.ts — the manager under test
  createRoutingManager,
  ROUTING_MANAGER_CONSTANTS,
} from "../electron-app/electron/routingManager";
export {
  // routingSession.ts — the session primitives the manager drives
  SESSION_BASE_DIR_NAME,
  RECOVERY_FILE_NAME,
  REQUEST_FILE_NAME,
  STATUS_FILE_NAME,
  CONTROL_FILE_NAME,
  HELPER_FLAG,
  REPAIR_FLAG,
  TUN_INTERFACE_NAME,
  HELPER_ROLE_NAME,
  TUN_MTU_DEFAULT,
  clampTunMtu,
  sessionBaseDir,
  readRecovery,
  clearRecovery,
  readSessionStatus,
  writeSessionStatus,
  writeControlStop,
  readJsonFile,
} from "../electron-app/electron/routingSession";
