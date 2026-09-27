#!/usr/bin/env node
/**
 * Phase B2 QUICK-CHECK — structural gates on the routing manager, the
 * IPC wiring, the renderer segment and the docs.
 *
 * Sections:
 *   S1  routingManager.ts source contract (electron-free, D5/D6/D7 pins,
 *       the honest refusals, the UAC heal, the repair anti-UAC-spam
 *       window, the sync quit stop)
 *   S2  main.ts wiring (factory + injected deps + registerIpcHandlers +
 *       cleanupOnce stop) and ipc.ts (4 handlers + D6 suppression gates
 *       + the core start/stop guards)
 *   S3  preload allowlist (+4) and the compiled freshness of the trio
 *   S4  renderer: store (mode + view wire), AetherTab (segment, card,
 *       sequenced disconnect, suppressed toggle), mock honest mirror,
 *       D5-name discipline (only the mock carries the literals)
 *   S5  i18n: the 20 new keys x 4 locales, key parity
 *   S6  docs: README Batch-B2 + TESTING-CHECKLIST section 30
 *   S7  B1 modules untouched (byte pins on the frozen surfaces)
 *
 * Exit code 0 = all gates passed.
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP = join(ROOT, "electron-app");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/* ---------------- S1: routingManager.ts source contract ---------------- */
console.log("\n== S1 routingManager.ts contract ==");
{
  const src = read(join(APP, "electron", "routingManager.ts"));
  ok("routingManager.ts exists (the B2 module)", src.length > 8000);
  ok("ELECTRON-FREE: no electron import anywhere", !src.includes("from \"electron\"") && !src.includes('require("electron")'));
  ok("factory shape: createRoutingManager(deps) + RoutingManager interface",
     src.includes("export function createRoutingManager(deps: RoutingManagerDeps)") && src.includes("export interface RoutingManager"));
  ok("D5 names consumed from routingSession (never redefined)",
     src.includes("TUN_INTERFACE_NAME,") && src.includes("HELPER_ROLE_NAME,") &&
     !src.includes('interfaceName: "MementoTun"') && !src.includes('role: "MementoTunHelper"'));
  ok("D7 clampTunMtu applied to the request at start", src.includes("tunMtu: clampTunMtu(tunMtuInput)"));
  ok("start builds the request MAIN-SIDE (renderer cannot forge it)",
     src.includes("guiPid: process.pid") && src.includes("killSwitchArmed: deps.isKillSwitchArmed()"));
  ok("honest refusals: win32-only / no core / already active",
     src.includes("only implemented on Windows") && src.includes("No active core to tunnel into") &&
     src.includes("already active"));
  ok("prepareRoutingSession is the ONLY write path (validate+authorize inside)",
     src.includes("prepareRoutingSession(request, base())"));
  ok("D6 suppression map = the helper's live states only",
     src.includes('"starting",') && src.includes('"connected",') && src.includes('"reconnecting",') &&
     src.includes("!launchPending &&"));
  ok("UAC heal deadline exists (120 s) and clears the stranded marker",
     src.includes("UAC_HEAL_MS = 120_000") && src.includes("clearRecovery(base())"));
  ok("launch failure clears the recovery marker (no stranded active view)",
     src.includes("clearRecovery(base());") && src.includes("the elevated helper could not be launched"));
  ok("stop writes control.json only (the helper owns the teardown)",
     src.includes("writeControlStop(dir);") && !src.includes("process.kill"));
  ok("repair refuses nothing-to-repair WITHOUT elevation",
     src.includes("no VPN Device state to repair"));
  ok("repair anti-UAC-spam: the 120 s window exists + arms ONLY on a real launch",
     src.includes("REPAIR_COOLDOWN_MS = 120_000") &&
     src.includes("now() - lastRepairLaunchMs < REPAIR_COOLDOWN_MS") &&
     src.includes("if (launched.launched) lastRepairLaunchMs = now();"));
  ok("repair refuses while a TUN start elevation is still pending (one unanswered elevation at a time)",
     src.includes("if (launchPending) {") &&
     src.includes("a VPN Device (TUN) start elevation is still pending") &&
     src.includes("a network repair was launched less than 120 s ago"));
  ok("requestStopBestEffort is synchronous + best-effort (quit path)",
     src.includes("requestStopBestEffort(): void") && src.includes("best-effort — the gui-pid watchdog is the guaranteed backstop"));
  ok("previousSessionDir chains B1's stale cleanup",
     src.includes("previousSessionDir =") && src.includes("path.resolve(rec.sessionDir)"));
}

/* ---------------- S2: main.ts + ipc.ts wiring ---------------- */
console.log("\n== S2 main.ts + ipc.ts wiring ==");
{
  const mainTs = read(join(APP, "electron", "main.ts"));
  ok("main.ts creates the factory with injected deps",
     mainTs.includes("createRoutingManager({") &&
     mainTs.includes("getUserDataDir: () => app.getPath(\"userData\")") &&
     mainTs.includes("getPlatform: () => process.platform") &&
     mainTs.includes("getExePath: () => process.execPath"));
  ok("main.ts resolves the ACTIVE core's SOCKS inbound (three managers)",
     mainTs.includes("xrayManager.getStatus()") &&
     mainTs.includes("singBoxManager.getStatus()") &&
     mainTs.includes("aetherManager.getStatus()"));
  ok("main.ts arms the request from the C5 pref (fresh read)",
     mainTs.includes("isKillSwitchArmed,"));
  ok("main.ts hands the SAME instance to the IPC handlers",
     mainTs.includes("registerIpcHandlers(routingManager);"));
  ok("cleanupOnce stops the TUN session FIRST (before the cores)",
     mainTs.indexOf("routingManager.requestStopBestEffort()") !== -1 &&
     mainTs.indexOf("routingManager.requestStopBestEffort()") < mainTs.indexOf("cleanupAllCores();"));
  ok("B1 helper-mode guards intact (all four)",
     mainTs.includes("const HELPER_MODE = isHelperInvocation(process.argv);") &&
     mainTs.includes("if (HELPER_MODE) return; // the helper runs its own lifecycle above") &&
     mainTs.includes("if (HELPER_MODE) return;\n  // Flip FIRST") &&
     mainTs.includes("if (!HELPER_MODE) cleanupOnce();"));

  const ipc = read(join(APP, "electron", "ipc.ts"));
  ok("ipc.ts signature takes the manager", ipc.includes("export function registerIpcHandlers(routing: RoutingManager)"));
  ok("the FOUR routing handlers exist",
     ipc.includes('ipcMain.handle("routing_start"') && ipc.includes('ipcMain.handle("routing_stop"') &&
     ipc.includes('ipcMain.handle("routing_status"') && ipc.includes('ipcMain.handle("routing_repair"'));
  ok("routing_start passes ONLY the clamped scalar (no forged requests)",
     ipc.includes("routing.startRouting(args?.tunMtu)"));
  ok("D6 gate: set_system_proxy throws while a session owns routing",
     ipc.includes("if (routing.isSystemProxySuppressed()) throw d6SuppressionError();\n      setSystemProxy"));
  ok("D6 gate: BOTH proxy handlers refuse while a session owns routing (C5 routing untouched)",
     ipc.split("if (routing.isSystemProxySuppressed()) throw d6SuppressionError();").length - 1 === 2 &&
     ipc.includes("releaseSystemProxy();"));
  ok("start_xray + aether_start refuse while the TUN session is live",
     ipc.split("if (routing.isSessionLive())").length - 1 === 2 &&
     ipc.includes("A VPN Device (TUN) session is active"));
  ok("stop_xray + aether_stop fire the control stop FIRST",
     ipc.indexOf("routing.requestStopBestEffort()") < ipc.indexOf("singBoxManager.stopSingBox()") &&
     ipc.indexOf("routing.requestStopBestEffort()") < ipc.indexOf("aetherManager.stopAether()"));
}

/* ---------------- S3: preload + compiled freshness ---------------- */
console.log("\n== S3 preload + compiled freshness ==");
{
  const preload = read(join(APP, "electron", "preload.ts"));
  ok("preload allowlist carries exactly the 4 routing commands",
     preload.includes('"routing_start",') && preload.includes('"routing_stop",') &&
     preload.includes('"routing_status",') && preload.includes('"routing_repair",'));
  ok("preload comment pins the security shape (request built main-side)",
     preload.includes("built ENTIRELY main-side"));

  const compiled = read(join(APP, "dist-electron", "routingManager.js"));
  ok("compiled routingManager.js is fresh (factory + heal + D6 map)",
     compiled.includes("createRoutingManager") &&
     /120_?000/.test(compiled) &&
     compiled.includes("reconnecting") &&
     compiled.includes("!launchPending &&"));
  const compiledIpc = read(join(APP, "dist-electron", "ipc.js"));
  ok("compiled ipc.js carries the 4 handlers + the D6 gates",
     compiledIpc.includes('"routing_start"') && compiledIpc.includes('"routing_stop"') &&
     compiledIpc.includes('"routing_status"') && compiledIpc.includes('"routing_repair"') &&
     compiledIpc.includes("isSystemProxySuppressed") && compiledIpc.includes("isSessionLive"));
  const compiledMain = read(join(APP, "dist-electron", "main.js"));
  ok("compiled main.js wires the manager + the quit stop",
     compiledMain.includes("createRoutingManager") && compiledMain.includes("requestStopBestEffort"));
  const compiledPreload = read(join(APP, "dist-electron", "preload.js"));
  ok("compiled preload allowlist keeps the 4 routing entries (31 through L0; 32 after E1)",
     (compiledPreload.match(/routing_(start|stop|status|repair)/g) || []).length === 4);
}

/* ---------------- S4: renderer ---------------- */
console.log("\n== S4 renderer ==");
{
  const store = read(join(ROOT, "src", "store.ts"));
  ok("store: mode type + persisted default socks",
     store.includes("export type AetherRoutingMode = \"socks\" | \"vpn-device\";") &&
     store.includes("memento-aether-mode") && store.includes("return \"socks\" as AetherRoutingMode;"));
  ok("store: RoutingStatusViewWire mirrors the manager shape (no renderer imports of the main process)",
     store.includes("export interface RoutingStatusViewWire {") &&
     store.includes("suppressSystemProxy: boolean;") && store.includes("helperRole: string;"));
  ok("store: setters exist", store.includes("setAetherMode: (mode)") && store.includes("setRoutingView: (v)"));

  const tab = read(join(ROOT, "src", "components", "AetherTab.tsx"));
  ok("AetherTab: the routing segment exists with the two options",
     tab.includes("aether.modeSocks") && tab.includes("aether.modeVpnDevice") &&
     tab.includes("setAetherMode(m.id)"));
  ok("AetherTab: segment is connect-time only (disabled while busy/connected)",
     tab.includes("!isDesktop() || busy || connected"));
  ok("AetherTab: connect sequence = aether_start THEN routing_start",
     tab.indexOf('tauriInvoke<AetherLiveInfo>("aether_start"') < tab.indexOf('tauriInvoke("routing_start"'));
  ok("AetherTab: failed TUN start keeps the SOCKS session (honest fallback toast)",
     tab.includes("aether.tunStartFailed") && tab.includes("routing_start\", {})"));
  ok("AetherTab: disconnect sequence = routing_stop -> wait -> aether_stop",
     tab.includes("waitRoutingTerminal") &&
     (() => {
       const body = tab.slice(tab.indexOf("const handleDisconnect = useCallback"));
       return body.indexOf('tauriInvoke("routing_stop")') !== -1 &&
              body.indexOf('tauriInvoke("routing_stop")') < body.indexOf('tauriInvoke("aether_stop")');
     })());
  ok("AetherTab: D6 — no system-proxy writes in vpn-device mode",
     tab.includes('if (useStore.getState().aetherMode === "vpn-device") return;') &&
     tab.includes('cur.aetherMode !== "vpn-device" && cur.aetherSystemProxy'));
  ok("AetherTab: reconnecting gets its own amber fail-closed banner",
     tab.includes("aether.tunReconnectHint") && tab.includes('"reconnecting"'));
  ok("AetherTab: the repair button routes to routing_repair",
     tab.includes('tauriInvoke<{ launched: boolean; reason?: string }>("routing_repair")'));
  ok("AetherTab: the pill switches to the routing state while live",
     tab.includes("TUN_LIVE_STATES") && tab.includes("pillLabel") && tab.includes("pillReconnecting"));

  const mock = read(join(ROOT, "src", "electron-mock.ts"));
  ok("electron-mock: honest mirrors for all four commands",
     mock.includes("routing_start:") && mock.includes("routing_stop:") &&
     mock.includes("routing_status:") && mock.includes("routing_repair:") &&
     mock.includes("requires the Windows desktop app"));
}

/* ---------------- S5: i18n ---------------- */
console.log("\n== S5 i18n parity ==");
{
  const i18n = read(join(ROOT, "src", "i18n.ts"));
  const keys = [
    "aether.mode", "aether.modeSocks", "aether.modeSocksDesc",
    "aether.modeVpnDevice", "aether.modeVpnDeviceDesc",
    "aether.vpnDeviceCard", "aether.vpnDeviceHint", "aether.vpnDeviceProxyNote",
    "aether.tunReconnectHint", "aether.tunStartFailed",
    "aether.tunStateStarting", "aether.tunStateConnected", "aether.tunStateReconnecting",
    "aether.tunStateRestoring", "aether.tunStateDisabled", "aether.tunStateError", "aether.tunStateIdle",
    "aether.repairNetwork", "aether.repairNetworkHint", "aether.repairLaunched", "aether.repairNothing",
  ];
  const locales = ["en", "fa", "zh", "ar"];
  // split by top-level locale blocks
  const marks = locales.map(l => i18n.indexOf(`  ${l}: {`)).concat([i18n.length]);
  let allOk = true;
  let detail = "";
  for (let i = 0; i < locales.length; i++) {
    const block = i18n.slice(marks[i], marks[i + 1]);
    for (const k of keys) {
      if (!block.includes(`"${k}"`)) { allOk = false; detail += ` ${locales[i]}:${k}`; }
    }
  }
  ok(`all ${keys.length} new keys present in all 4 locales`, allOk, detail);
}

/* ---------------- S6: docs ---------------- */
console.log("\n== S6 docs ==");
{
  const readme = read(join(APP, "README.md"));
  ok("README carries the Batch B2 section",
     readme.includes("## Phase B — Batch B2") && readme.includes("routingManager") &&
     readme.includes("routing_start") && readme.includes("VPN Device"));
  const checklist = read(join(APP, "TESTING-CHECKLIST.md"));
  ok("TESTING-CHECKLIST carries section 30 (B2 manual items)",
     checklist.includes("## 30. Phase B2") && checklist.includes("VPN Device"));
}

/* ---------------- S7: B1 frozen surfaces untouched ---------------- */
console.log("\n== S7 B1 frozen surfaces ==");
{
  const sessionTs = read(join(APP, "electron", "routingSession.ts"));
  const helperTs = read(join(APP, "electron", "routingHelper.ts"));
  ok("routingSession.ts untouched by B2 (D5 constants byte-exact)",
     sessionTs.includes('export const TUN_INTERFACE_NAME = "MementoTun";') &&
     sessionTs.includes('export const HELPER_ROLE_NAME = "MementoTunHelper";') &&
     sessionTs.includes('export const HELPER_FLAG = "--routing-helper";'));
  ok("routingHelper.ts untouched by B2 (watchdog + repair + memoized exit intact)",
     helperTs.includes("hold-reconnecting") && helperTs.includes("--repair-network") &&
     helperTs.includes("Memoized ONCE") && helperTs.includes("killEnginePidGuarded"));
  ok("wintunPin.ts still constants-only",
     !read(join(APP, "electron", "wintunPin.ts")).includes("require(") &&
     read(join(APP, "electron", "wintunPin.ts")).includes("WINTUN_DLL_SHA256"));
}

/* ---------------- summary ---------------- */
console.log(`\n===== taskB2-quickcheck: ${pass} PASS / ${fail} FAIL =====`);
if (fail > 0) process.exit(1);
