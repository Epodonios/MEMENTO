/**
 * taskB3-fnentry.ts — esbuild entry for the Phase B3 functional test.
 *
 * Bundles the REAL fused modules:
 *   - routingManager.ts  (the B3 staleness + C5 transition + audit view)
 *   - routingSession.ts  (the session primitives the tests seed with)
 *   - routingHelper.ts   (the B3 fresh-armed read + status heartbeat)
 *   - killSwitch.ts      (blockOnRoutingExit + the TUN audit decision)
 *
 * killSwitch.ts transitively imports appPrefs.ts which imports
 * "electron" — the fntest aliases electron to the proven stub
 * (taskC2-electron-stub.mts, the C5 pattern). routingManager,
 * routingSession and routingHelper are ELECTRON-FREE by contract.
 *
 * Every external effect is injected by taskB3-fntest.mjs: the platform,
 * the exe path, the active core's SOCKS inbound, the kill-switch armed
 * state, the elevation launcher (a capture fake), the engine spawn, the
 * probe, the clock — so the assertions drive the REAL fused code with
 * zero real processes, zero real elevation, and zero real system state.
 */
export {
  // routingManager.ts — the B3 staleness/transition/audit surface
  createRoutingManager,
  ROUTING_MANAGER_CONSTANTS,
} from "../electron-app/electron/routingManager";
export type {
  RoutingManager,
  RoutingManagerDeps,
  RoutingStatusView,
} from "../electron-app/electron/routingManager";
export {
  // routingSession.ts — the session primitives the tests seed with
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
  prepareRoutingSession,
  sessionBaseDir,
  recoveryPathFor,
  readRecovery,
  writeRecovery,
  clearRecovery,
  readSessionStatus,
  writeSessionStatus,
  writeControlStop,
  readJsonFile,
  SOCKS_PROBE_INTERVAL_MS,
  SOCKS_FAILURE_LIMIT,
  HELPER_TICK_MS,
} from "../electron-app/electron/routingSession";
export {
  // routingHelper.ts — the B3 fresh-armed read + heartbeat
  runRoutingHelper,
  runNetworkRepair,
  cleanupStaleSession,
} from "../electron-app/electron/routingHelper";
export type { HelperDeps } from "../electron-app/electron/routingHelper";
export {
  // killSwitch.ts — the B3 TUN twin + the TUN audit decision
  blockOnRoutingExit,
  resolveRoutingAuditAction,
  applyRoutingAuditAction,
  blockOnCoreExit,
  markQuitting,
  isQuitting,
  isKillSwitchArmed,
} from "../electron-app/electron/killSwitch";
export {
  // proxy.ts — the REAL registry read surface for the audit replication
  readProxyState,
  KILL_SWITCH_BLOCKED_PORT,
} from "../electron-app/electron/proxy";
export {
  // appPrefs.ts (via the electron stub) — the REAL prefs lifecycle the
  // fresh-armed reader consumes in the shared-file tests
  loadAppPrefs,
  saveAppPrefs,
  DEFAULT_APP_PREFS,
} from "../electron-app/electron/appPrefs";
