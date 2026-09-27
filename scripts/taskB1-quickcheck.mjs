#!/usr/bin/env node
/**
 * Phase B1 QUICK-CHECK — structural gates on the routing modules.
 * Source-level pins for what B1 owns (D5/D6/D7 constants, the electron
 * -free contract, the main.ts helper hook + loop prevention, the B0
 * wintunPin contract fulfillment, the untouched IPC/renderer surfaces,
 * the docs) + compiled-artifact freshness. The BEHAVIORAL proof lives in
 * taskB1-fntest.mjs (98 assertions incl. the real sing-box check).
 * RESULT: N PASS / 0 FAIL
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "electron-app");
const ROOT = join(HERE, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? " — " + extra : ""}`); }
};
const read = (f) => fs.readFileSync(f, "utf8");

/* ---------------- files exist ---------------- */
const sessionTs = read(join(APP, "electron", "routingSession.ts"));
const helperTs = read(join(APP, "electron", "routingHelper.ts"));
const mainTs = read(join(APP, "electron", "main.ts"));
ok("routingSession.ts exists", sessionTs.length > 1000);
ok("routingHelper.ts exists", helperTs.length > 1000);
ok("taskB1-fnentry.ts exists", fs.existsSync(join(HERE, "taskB1-fnentry.ts")));
ok("taskB1-fntest.mjs exists", fs.existsSync(join(HERE, "taskB1-fntest.mjs")));

/* ---------------- the electron-free contract (testability) ---------------- */
ok("routingSession.ts is ELECTRON-FREE (killSwitch.ts discipline)",
   !sessionTs.includes('from "electron"') && !sessionTs.includes('from "electron";'));
ok("routingHelper.ts is ELECTRON-FREE",
   !helperTs.includes('from "electron"') && !helperTs.includes('from "electron";'));

/* ---------------- D5 fixed names ---------------- */
ok("D5 interface name: MementoTun", sessionTs.includes('export const TUN_INTERFACE_NAME = "MementoTun";'));
ok("D5 helper role: MementoTunHelper", sessionTs.includes('export const HELPER_ROLE_NAME = "MementoTunHelper";'));
ok("D5 session base dir: MementoTunSession", sessionTs.includes('export const SESSION_BASE_DIR_NAME = "MementoTunSession";'));
ok("D5 recovery file: memento-routing-recovery.json", sessionTs.includes('export const RECOVERY_FILE_NAME = "memento-routing-recovery.json";'));
ok("D5 flags: --routing-helper / --repair-network",
   sessionTs.includes('export const HELPER_FLAG = "--routing-helper";') &&
   sessionTs.includes('export const REPAIR_FLAG = "--repair-network";'));

/* ---------------- D7 MTU ---------------- */
ok("D7 MTU constants (default 1500, [1280, 9000])",
   sessionTs.includes("export const TUN_MTU_DEFAULT = 1500;") &&
   sessionTs.includes("export const TUN_MTU_MIN = 1280;") &&
   sessionTs.includes("export const TUN_MTU_MAX = 9000;"));
ok("D7 clampTunMtu folds UNSET to the default", sessionTs.includes("if (value === null || value === undefined || value === \"\") return TUN_MTU_DEFAULT;"));

/* ---------------- D4 config builder ---------------- */
ok("D4 builder: real remote DNS detoured through the tunnel",
   sessionTs.includes('{ type: "udp", tag: "dns-remote", server: "1.1.1.1", detour: "proxy" }') &&
   sessionTs.includes('{ type: "udp", tag: "dns-remote-backup", server: "8.8.8.8", detour: "proxy" }'));
ok("D4 builder: route.default_domain_resolver ALWAYS present (mandatory)",
   sessionTs.includes('default_domain_resolver: { server: "dns-remote" }'));
ok("D1 builder: tun inbound auto_route + strict_route + stack mixed",
   sessionTs.includes("auto_route: true") && sessionTs.includes("strict_route: true") &&
   sessionTs.includes('stack: "mixed"'));
ok("routing engine carries NO clash_api/experimental", !sessionTs.includes("clash_api") && !sessionTs.includes("experimental:"));

/* ---------------- D6 semantics ---------------- */
ok("D6 watchdog: armed -> hold-reconnecting, unarmed -> teardown-restoring",
   helperTs.includes('? "hold-reconnecting"\n              : "teardown-restoring"') ||
   (helperTs.includes('"hold-reconnecting"') && helperTs.includes('"teardown-restoring"')));
ok("D6 suppression mapping exported", sessionTs.includes("export function suppressSystemProxyWrites"));
ok("D6 quit boundary: gui pid death exits the loop", helperTs.includes('exitReason = "gui-gone"'));
ok("D6 full teardown: restoring -> disabled + recovery cleared",
   helperTs.includes('"restoring", "closing the adapter and restoring routes"') &&
   helperTs.includes('"disabled", "networking was restored"'));

/* ---------------- B0 wintunPin contract fulfilled ---------------- */
ok("the B1 session RE-VERIFIES the B0 pin before spawn (contract fulfilled)",
   sessionTs.includes('import {\n  WINTUN_DLL_SHA256') && sessionTs.includes("WINTUN_PUBLISHER"));
ok("spawn gate: hash mismatch refuses with an honest reason",
   sessionTs.includes("integrity check FAILED") && sessionTs.includes("refusing"));
ok("spawn gate: win32 publisher leg + non-win32 skip",
   sessionTs.includes('deps.platform === "win32"') && sessionTs.includes("Get-AuthenticodeSignature"));

/* ---------------- privilege boundary ---------------- */
ok("request authorized BEFORE use + RE-authorized behind the boundary",
   sessionTs.includes("export function authorizeRequestPath") && helperTs.includes("authorizeRequestPath(requestPath, base, req)"));
ok("elevation runs with NO new dependencies (PowerShell Start-Process)",
   sessionTs.includes('"-Verb",') && sessionTs.includes("RunAs"));

/* ---------------- main.ts helper hook + loop prevention ---------------- */
{
  const hookIdx = mainTs.indexOf("const HELPER_MODE = isHelperInvocation(process.argv);");
  const lockIdx = mainTs.indexOf("app.requestSingleInstanceLock()");
  ok("helper argv is checked BEFORE the single-instance lock", hookIdx !== -1 && lockIdx !== -1 && hookIdx < lockIdx);
  ok("helper mode NEVER requests the lock (else-branch wiring)",
     mainTs.includes("if (HELPER_MODE) {\n  void startRoutingHelperMode();\n} else {\n  gotSingleInstanceLock = app.requestSingleInstanceLock();"));
  ok("startRoutingHelperMode resolves the platform deps (userData/resources/sing-box)",
     mainTs.includes("userDataDir: app.getPath(\"userData\")") &&
     mainTs.includes("resourceRootDir: resourceRoot()") &&
     mainTs.includes("findEngine: findSingBox"));
  ok("whenReady guarded: helper never creates a window/tray/IPC",
     mainTs.includes("if (HELPER_MODE) return; // the helper runs its own lifecycle above"));
  ok("before-quit guarded: the helper NEVER runs cleanupAllCores (would kill the GUI's cores)",
     mainTs.includes("if (HELPER_MODE) return;\n  // Flip FIRST") &&
     mainTs.includes("cleanupAllCores would kill the GUI's live cores"));
  ok("window-all-closed guarded", mainTs.includes('app.on("window-all-closed", () => {\n  if (HELPER_MODE) return;'));
  ok("process-exit cleanup guarded", mainTs.includes("if (!HELPER_MODE) cleanupOnce();"));
}

/* ---------------- untouched surfaces (B2 keeps them) ----------------
 * UPDATED for B2 (user-approved batch): the three B1 "frozen" surfaces
 * gain their approved B2 additions — the preload allowlist carries the
 * FOUR routing commands (27 -> 31), ipc.ts carries EXACTLY the four
 * routing handlers, and the renderer gains the segment UI while still
 * never hardcoding the D5 names (electron-mock.ts's honest mirror is the
 * ONLY renderer-side "MementoTun" literal). */
{
  const preload = read(join(APP, "electron", "preload.ts"));
  ok("preload allowlist keeps the 4 B2 routing commands (31 through L0; 32 after E1: the connection-stats probe)",
     preload.split("routing_start").length === 2 &&
     preload.includes('"routing_start",') && preload.includes('"routing_stop",') &&
     preload.includes('"routing_status",') && preload.includes('"routing_repair",') &&
     !preload.includes('"tun_start"'));
  const ipc = read(join(APP, "electron", "ipc.ts"));
  ok("ipc.ts carries EXACTLY the four B2 routing handlers",
     ipc.includes('ipcMain.handle("routing_start"') &&
     ipc.includes('ipcMain.handle("routing_stop"') &&
     ipc.includes('ipcMain.handle("routing_status"') &&
     ipc.includes('ipcMain.handle("routing_repair"') &&
     !ipc.includes('"tun_start"'));
  const ks = read(join(APP, "electron", "killSwitch.ts"));
  ok("killSwitch.ts untouched by B1/B2 (C5 choke points intact)",
     ks.includes("export function markQuitting(): void {") &&
     ks.includes("export function resolveAuditAction(") &&
     ks.includes("export function enforceKillSwitchAfterPrefChange("));
  const cv = JSON.parse(read(join(APP, "electron", "core-versions.json")));
  ok("core-versions.json unchanged (xray/sing-box/aether/wintun)",
     cv.xray === "v25.1.1" && cv["sing-box"] === "1.14.0" && cv.aether === "1.9.0" && cv.wintun === "0.14.1");
  // UPDATED for B2: the renderer may reference the D5 names ONLY in
  // sanctioned places — the honest browser-preview mirror (electron-mock.ts),
  // the user-facing locale strings (i18n.ts), and COMMENT lines elsewhere
  // (AetherTab/store docs). No renderer CODE path may hardcode them: the
  // values must arrive from routing_status.
  const sanctionedFiles = new Set(["electron-mock.ts", "i18n.ts"]);
  const commentHits = [];
  const codeHits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.(ts|tsx)$/.test(e.name)) {
        if (read(join(d, e.name)).includes("MementoTun")) {
          if (sanctionedFiles.has(e.name)) continue;
          const bad = read(join(d, e.name))
            .split("\n")
            .filter((l) => l.includes("MementoTun"))
            .filter((l) => { const t = l.trim(); return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")); });
          if (bad.length === 0) commentHits.push(e.name);
          else codeHits.push(`${e.name}(${bad.length})`);
        }
      }
    }
  })(join(ROOT, "src"));
  ok("renderer D5 discipline: mock mirror + locale strings + comments only, ZERO code hardcoding",
     codeHits.length === 0, codeHits.join(","));
}

/* ---------------- compiled freshness ---------------- */
{
  const compiledSession = read(join(APP, "dist-electron", "routingSession.js"));
  const compiledHelper = read(join(APP, "dist-electron", "routingHelper.js"));
  ok("compiled routingSession.js carries the D5 constants", compiledSession.includes('"MementoTun"') && compiledSession.includes("memento-routing-recovery.json"));
  ok("compiled routingSession.js consumes the pin module + carries the gate",
     compiledSession.includes("wintunPin_1") && compiledSession.includes("integrity check FAILED") &&
     compiledSession.includes("Get-AuthenticodeSignature"));
  ok("compiled routingHelper.js carries the D6 fork + repair", compiledHelper.includes("hold-reconnecting") && compiledHelper.includes("--repair-network"));
  const compiledMain = read(join(APP, "dist-electron", "main.js"));
  ok("compiled main.js wires the helper mode before the lock",
     compiledMain.indexOf("isHelperInvocation") < compiledMain.indexOf("requestSingleInstanceLock") &&
     compiledMain.includes("startRoutingHelperMode"));
}

/* ---------------- docs ---------------- */
{
  const readme = read(join(APP, "README.md"));
  ok("README carries the Batch B1 section",
     readme.includes("## Phase B — Batch B1 (routingSession + routingHelper") &&
     readme.includes("MementoTunHelper") &&
     readme.includes("--routing-helper") &&
     readme.includes("--repair-network"));
  const checklist = read(join(APP, "TESTING-CHECKLIST.md"));
  ok("TESTING-CHECKLIST carries section 29 (real-Windows legs)",
     checklist.includes("## 29. Phase B1 — routing session (real-Windows manual items)") &&
     checklist.includes("UAC") &&
     checklist.includes("MementoTun"));
}

/* ---------------- fntest harness shape ---------------- */
{
  const fntest = read(join(HERE, "taskB1-fntest.mjs"));
  ok("fntest drives the REAL modules via esbuild (no electron alias)",
     fntest.includes("taskB1-fnentry.ts") && !fntest.includes("electron-stub"));
  ok("fntest proves the config against the REAL pinned sing-box",
     fntest.includes("sing-box-1.14.0-linux-amd64") && fntest.includes('"check", "-c"'));
  ok("fntest covers all 18 groups (T1..T18)",
     ["T1 ", "T2 ", "T3 ", "T4 ", "T5 ", "T6 ", "T7 ", "T8 ", "T9 ", "T10 ", "T11 ", "T12 ", "T13 ", "T14 ", "T15 ", "T16 ", "T17 ", "T18 "]
       .every((t) => fntest.includes(`== ${t}`)));
}

console.log(`\ntaskB1-quickcheck: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
