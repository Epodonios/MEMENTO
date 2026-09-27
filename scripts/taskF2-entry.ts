/**
 * taskF2 entry — the REAL scanner engine (electron-free) for the live
 * loopback sweep + the Update Center pipeline under the electron stub.
 */
export {
  expandTargets,
  expandTargetsAsync,
  parsePorts,
  classifyHost,
  localSubnet,
  runScan,
  cancelScan,
  fetchGeoBatch,
  PORT_PRESETS,
  MAX_SCAN_HOSTS,
} from "../electron-app/electron/scanner";
