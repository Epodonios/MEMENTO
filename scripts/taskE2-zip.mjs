#!/usr/bin/env node
/**
 * Phase E / Batch E2: rebuild download/MEMENTO-electron-migration.zip
 * and run in-archive verification for Batch-E2 (the MEMENTO ShadowTLS
 * parser — the THIRD post-B register item, additive only, the whole
 * electron/* surface byte-stable): the proprietary memento-stls://
 * scheme (the userinfo carries the INNER trojan credential — probe P5
 * proved a bare shadowtls outbound carries NO traffic), parseShadowTLS()
 * with the honest validation (versions exactly 1..3, v2/v3 require
 * stls-password — probe P3 users[] contract), the paired-outbound
 * generator (trojan primary detour:stls-t + the shadowtls transport;
 * probe P4 carried REAL loopback traffic 200:14336), the THREE honest
 * connect-flow gates in connectionActions.ts backed by the
 * generator-side topology wholesale-ignore, the amber NON-STANDARD
 * disclosure (import.stlsNote x4), the ConfigsTab chip, ping/editor
 * peripherals, the electron-mock demo-de-stls config, README Batch-E2 +
 * TESTING-CHECKLIST section 35, the taskE2 gate scripts) AND the full
 * regression pin chain (Task-13/12 + D1-D4 + C1-C6 + B0 + B1 + B2 + B3
 * + B4 + L0 + E1).
 *
 * Retained from B0: resources/wintun/bin/* NEVER rides the zip (the
 * binary-never-ships negative gate below still ENFORCES that absence).
 * NEW EXCLUSION for E2: scripts/taskE2-*-tmp/* (beside the
 * B1/B2/B3/B4/L0/E1 ones) — the probe/fntest ARTIFACTS stay outside the
 * zip tree by design.
 *
 * Negative pins are API-shaped (imports / call forms), never bare words —
 * a C1 lesson: legitimate doc comments may mention the forbidden thing.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SRC = "/home/z/my-project/memento-src";
const OUT = "/home/z/my-project/download/MEMENTO-electron-migration.zip";

fs.rmSync(OUT, { force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const X = [
  "node_modules/*", "*/node_modules/*",
  "dist/*", "*/dist/*",
  "dist-electron/*", "*/dist-electron/*",
  "release/*", "*/release/*",
  "target/*", "*/target/*",
  "*.tsbuildinfo", "*.log",
  "resources/wintun/bin/*",              // B0: the wintun.dll NEVER ships in the zip
  "scripts/taskD4-quitclean-tmp/*", "scripts/taskD4-smoke-tmp/*",
  "scripts/taskD4-fn-tmp/*", "scripts/taskD3-*-tmp/*", "scripts/taskD2-*-tmp/*",
  "scripts/taskC1-*-tmp/*", "scripts/taskC1-smoke-tmp/*",
  "scripts/taskC2-*-tmp/*", "scripts/taskC2-smoke-tmp/*",
  "scripts/taskC3-*-tmp/*", "scripts/taskC3-smoke-tmp/*",
  "scripts/taskC4-*-tmp/*", "scripts/taskC4-smoke-tmp/*", "scripts/taskC4-live-tmp/*",
  "scripts/taskC5-*-tmp/*", "scripts/taskC5-smoke-tmp/*", "scripts/taskC5-live-tmp/*",
  "scripts/taskC6-*-tmp/*", "scripts/taskC6-smoke-tmp/*", "scripts/taskC6-live-tmp/*",
  "scripts/taskB0-*-tmp/*", "scripts/taskB0-smoke-tmp/*", "scripts/taskB0-live-tmp/*",
  "scripts/taskB1-*-tmp/*", "scripts/taskB1-smoke-tmp/*", "scripts/taskB1-live-tmp/*",
  "scripts/taskB2-*-tmp/*", "scripts/taskB2-smoke-tmp/*", "scripts/taskB2-live-tmp/*",
  "scripts/taskB3-*-tmp/*", "scripts/taskB3-smoke-tmp/*", "scripts/taskB3-live-tmp/*",
  "scripts/taskB4-*-tmp/*", "scripts/taskB4-smoke-tmp/*", "scripts/taskB4-live-tmp/*",
  "scripts/taskL0-*-tmp/*", "scripts/taskL0-smoke-tmp/*", "scripts/taskL0-live-tmp/*",
  "scripts/taskE1-*-tmp/*", "scripts/taskE1-smoke-tmp/*", "scripts/taskE1-live-tmp/*",
  "scripts/taskE2-*-tmp/*", "scripts/taskE2-smoke-tmp/*", "scripts/taskE2-live-tmp/*",
];
execFileSync("zip", ["-q", "-r", OUT, ".", ...X.flatMap((p) => ["-x", p])], { cwd: SRC });

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`zip rebuilt: ${OUT}`);
console.log(`size: ${mb} MB`);

const listing = execFileSync("unzip", ["-Z1", OUT], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const entries = listing.split("\n").filter((l => l && !l.endsWith("/")));
console.log(`file entries: ${entries.length}`);

let bad = 0;
const must = (m) => {
  if (!entries.includes(m)) { console.error(`FAIL  missing key file in zip: ${m}`); bad++; return; }
  console.log(`PASS  zip contains ${m}`);
};

// E2 entry-count gate: 246 file entries at E1 + 7 new files (the three
// E2 harnesses — the probe, the fntest, and the fnentry bundle stub that
// ships with them — plus the quickcheck and the battery/smoke/zip gate
// scripts; E2 added NO new runtime sources, its product changes modify
// existing files only) = 253.
{
  const want = 253;
  if (entries.length !== want) { console.error(`FAIL  entry count: ${entries.length} (expected ${want})`); bad++; }
  else console.log(`PASS  entry count == ${want} (246 at E1 + 3 E2 harnesses + 4 E2 gate scripts)`);
}

// Task-13 key files (regression)
["src/store.ts", "src/utils/v2rayConfig.ts", "src/components/BrokersModal.tsx",
 "src/utils/subscription.ts", "src/utils/editor.ts", "src/utils/ping.ts",
 "src/components/ConfigsTab.tsx", "src/components/ExportTab.tsx",
 "scripts/task13-smoke.mjs", "scripts/task13-selftest.mjs", "scripts/task13-cfgtest.mjs",
 "scripts/task13-remote-udp-probe.mjs", "scripts/task13-udp-finalize.mjs",
 "scripts/task13-store.cjs", "scripts/task13-cfg.cjs", "scripts/task13-sub.cjs",
 "electron-app/TESTING-CHECKLIST.md", "electron-app/README.md"].forEach(must);

// Task-12 key files (regression)
["electron-app/electron/aether.ts", "electron-app/electron/core-versions.json",
 "electron-app/resources/aether/README.md", "src/components/AetherTab.tsx",
 "scripts/task12-aether-smoke.mjs"].forEach(must);

// Phase-D1 key files (regression)
["electron-app/electron/ipc.ts", "electron-app/electron/preload.ts",
 "src/components/ConnectionManager.tsx", "src/components/ConnectionTab.tsx",
 "src/electron-mock.ts", "src/i18n.ts",
 "scripts/taskD1-quickcheck.mjs", "scripts/taskD1-entry.ts", "scripts/taskD1-i18n.cjs",
 "scripts/taskD1-smoke.mjs"].forEach(must);

// Phase-D2 key files (regression)
["src/utils/builderOptions.ts", "src/components/SubscriptionGroups.tsx",
 "src/utils/singBoxConfig.ts",
 "scripts/taskD2-quickcheck.mjs", "scripts/taskD2-cfgtest.mjs", "scripts/taskD2-entry.ts",
 "scripts/taskD2-cfgentry.ts", "scripts/taskD2-cfg.cjs", "scripts/taskD2-i18n.cjs",
 "scripts/taskD2-smoke.mjs", "scripts/taskD2-zip.mjs"].forEach(must);

// Phase-D3 key files (regression)
["src/utils/appBackup.ts", "src/utils/qrShare.ts", "src/components/QrModal.tsx",
 "src/components/ImportTab.tsx", "electron-app/electron/appPrefs.ts",
 "scripts/taskD3-quickcheck.mjs", "scripts/taskD3-fntest.mjs", "scripts/taskD3-entry.ts",
 "scripts/taskD3-fnentry.ts", "scripts/taskD3-i18n.cjs",
 "scripts/taskD3-smoke.mjs", "scripts/taskD3-zip.mjs"].forEach(must);

// Phase-D4 key files (regression)
["electron-app/electron/tray.ts", "electron-app/electron/main.ts",
 "src/components/SettingsTab.tsx",
 "scripts/taskD4-quickcheck.mjs", "scripts/taskD4-fntest.mjs",
 "scripts/taskD4-quitclean-fntest.mjs", "scripts/taskD4-electron-stub.mts",
 "scripts/taskD4-entry.ts", "scripts/taskD4-fnentry.ts", "scripts/taskD4-i18n.cjs",
 "scripts/taskD4-smoke.mjs", "scripts/taskD4-zip.mjs"].forEach(must);

// Phase-C1 key files (regression)
["src/utils/trafficHistory.ts", "src/components/TrafficChart.tsx",
 "scripts/taskC1-quickcheck.mjs", "scripts/taskC1-fntest.mjs",
 "scripts/taskC1-cfgtest.mjs", "scripts/taskC1-live.mjs",
 "scripts/taskC1-entry.ts", "scripts/taskC1-cfgentry.ts", "scripts/taskC1-i18n.cjs",
 "scripts/taskC1-smoke.mjs", "scripts/taskC1-zip.mjs"].forEach(must);

// Phase-C2 key files (regression)
["src/utils/latencyHistory.ts", "src/utils/urlTest.ts", "electron-app/electron/urlTest.ts",
 "scripts/taskC2-quickcheck.mjs", "scripts/taskC2-fntest.mjs",
 "scripts/taskC2-cfgtest.mjs", "scripts/taskC2-live.mjs",
 "scripts/taskC2-entry.ts", "scripts/taskC2-cfgentry.ts", "scripts/taskC2-fnentry.ts",
 "scripts/taskC2-electron-stub.mts", "scripts/taskC2-i18n.cjs",
 "scripts/taskC2-smoke.mjs", "scripts/taskC2-zip.mjs"].forEach(must);

// Phase-C3 key files (regression)
["src/utils/routingOptions.ts", "src/components/RoutingTab.tsx",
 "electron-app/electron/geoFiles.ts",
 "scripts/taskC3-quickcheck.mjs", "scripts/taskC3-fntest.mjs",
 "scripts/taskC3-cfgtest.mjs", "scripts/taskC3-live.mjs",
 "scripts/taskC3-entry.ts", "scripts/taskC3-cfgentry.ts", "scripts/taskC3-i18n.cjs",
 "scripts/taskC3-smoke.mjs", "scripts/taskC3-zip.mjs"].forEach(must);

// Phase-C4 key files (regression)
["src/utils/topologyOptions.ts",
 "scripts/taskC4-quickcheck.mjs", "scripts/taskC4-fntest.mjs",
 "scripts/taskC4-cfgtest.mjs", "scripts/taskC4-live.mjs",
 "scripts/taskC4-cfgentry.ts", "scripts/taskC4-uplink-probe.mjs",
 "scripts/taskC4-stats-debug.mjs",
 "scripts/taskC4-smoke.mjs", "scripts/taskC4-zip.mjs"].forEach(must);

// Phase-C5 key files (regression)
["electron-app/electron/killSwitch.ts",
 "scripts/taskC5-quickcheck.mjs", "scripts/taskC5-fntest.mjs",
 "scripts/taskC5-live.mjs", "scripts/taskC5-fnentry.ts",
 "scripts/taskC5-smoke.mjs", "scripts/taskC5-zip.mjs"].forEach(must);

// Phase-C6 key files (regression)
["electron-app/electron/aether-versions.json", "electron-app/electron/aetherUpdate.ts",
 "electron-app/electron/appUpdate.ts",
 "scripts/taskC6-quickcheck.mjs", "scripts/taskC6-fntest.mjs", "scripts/taskC6-fnentry.ts",
 "scripts/taskC6-smoke.mjs", "scripts/taskC6-zip.mjs"].forEach(must);

// Phase-B0 key files (regression)
["electron-app/electron/wintunPin.ts",
 "electron-app/scripts/fetch-wintun.sh", "electron-app/scripts/fetch-wintun.ps1",
 "electron-app/resources/wintun/README.md", "electron-app/resources/wintun/wintun-LICENSE.txt",
 "electron-app/NOTICE.md",
 "scripts/taskB0-smoke.mjs", "scripts/taskB0-zip.mjs"].forEach(must);

// Phase-B1 key files (regression)
["electron-app/electron/routingSession.ts", "electron-app/electron/routingHelper.ts",
 "scripts/taskB1-fnentry.ts", "scripts/taskB1-fntest.mjs", "scripts/taskB1-quickcheck.mjs",
 "scripts/taskB1-smoke.mjs", "scripts/taskB1-zip.mjs"].forEach(must);

// Phase-B2 key files (regression)
["electron-app/electron/routingManager.ts",
 "scripts/taskB2-fnentry.ts", "scripts/taskB2-fntest.mjs", "scripts/taskB2-quickcheck.mjs",
 "scripts/taskB2-smoke.mjs", "scripts/taskB2-zip.mjs"].forEach(must);

// Phase-B3 key files (regression)
["electron-app/electron/killSwitch.ts",
 "scripts/taskB3-fnentry.ts", "scripts/taskB3-fntest.mjs", "scripts/taskB3-quickcheck.mjs",
 "scripts/taskB3-battery.mjs", "scripts/taskB3-smoke.mjs", "scripts/taskB3-zip.mjs"].forEach(must);

// Phase-B4 key files (NEW — the closeout; the probe is the B4 documentation site)
["scripts/taskC4-probe.mjs",
 "scripts/taskB4-quickcheck.mjs", "scripts/taskB4-battery.mjs",
 "scripts/taskB4-smoke.mjs", "scripts/taskB4-zip.mjs"].forEach(must);

// Phase-L0 key files (NEW — the third-party license/origin manifest)
["electron-app/resources/THIRD-PARTY.json",
 "electron-app/resources/licenses/Xray-core-v25.1.1-MPL-2.0.txt",
 "electron-app/resources/licenses/sing-box-v1.14.0-GPL-3.0.txt",
 "electron-app/resources/licenses/sing-box-v1.14.0-LICENSE-notice.txt",
 "electron-app/resources/licenses/Aether-v1.9.0-AGPL-3.0.txt",
 "electron-app/resources/licenses/jsqr-1.4.0-Apache-2.0.txt",
 "electron-app/resources/licenses/Inter-OFL-1.1.txt",
 "electron-app/resources/licenses/JetBrainsMono-OFL-1.1.txt",
 "scripts/taskL0-quickcheck.mjs", "scripts/taskL0-battery.mjs",
 "scripts/taskL0-smoke.mjs", "scripts/taskL0-zip.mjs"].forEach(must);

// Phase-E1 key files (NEW — live per-connection stats)
["electron-app/electron/connectionStats.ts", "electron-app/electron/coreTypes.ts",
 "src/components/ConnectionStatsPanel.tsx",
 "scripts/taskE1-probe.mjs", "scripts/taskE1-fntest.mjs", "scripts/taskE1-quickcheck.mjs",
 "scripts/taskE1-battery.mjs", "scripts/taskE1-smoke.mjs", "scripts/taskE1-zip.mjs"].forEach(must);

// Phase-E2 key files (NEW — the MEMENTO ShadowTLS parser; the product
// changes MODIFY existing sources, the NEW entries are the harnesses +
// the gate scripts)
["scripts/taskE2-probe.mjs", "scripts/taskE2-fntest.mjs", "scripts/taskE2-fnentry.ts",
 "scripts/taskE2-quickcheck.mjs", "scripts/taskE2-battery.mjs",
 "scripts/taskE2-smoke.mjs", "scripts/taskE2-zip.mjs"].forEach(must);

const zcat = (f) => execFileSync("unzip", ["-p", OUT, f], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const contentOk = (name, file, needles) => {
  const body = zcat(file);
  for (const n of needles) {
    if (!body.includes(n)) { console.error(`FAIL  ${name}: ${file} lacks ${JSON.stringify(n.slice(0, 40))}`); bad++; return; }
  }
  console.log(`PASS  ${name} (${needles.length} needles in ${file})`);
};
const contentAbsent = (name, file, needles) => {
  const body = zcat(file);
  for (const n of needles) {
    if (body.includes(n)) { console.error(`FAIL  ${name}: ${file} must NOT contain ${JSON.stringify(n.slice(0, 40))}`); bad++; return; }
  }
  console.log(`PASS  ${name} (${needles.length} negative needles in ${file})`);
};

/* ---------- B1: the dll binary NEVER ships (zip-level negative gate, B0-retained) ---------- */

{
  const leaked = entries.filter((e) => e.startsWith("resources/wintun/bin/"));
  if (leaked.length > 0) { console.error(`FAIL  binary-never-ships: found in zip: ${leaked.join(", ")}`); bad++; }
  else console.log("PASS  binary-never-ships: NO resources/wintun/bin/* entry in the zip");
}
{
  const leaked = entries.filter((e) => e.startsWith("scripts/taskB1-fn-tmp/") || e.startsWith("scripts/taskB2-fn-tmp/") || e.startsWith("scripts/taskB3-fn-tmp/") || e.startsWith("scripts/taskB4-fn-tmp/") || e.includes("-tmp/"));
  if (leaked.length > 0) { console.error(`FAIL  B1/B2/B3/B4/L0/E1/E2 tmp-exclusion: found in zip: ${leaked.slice(0, 5).join(", ")}`); bad++; }
  else console.log("PASS  B1/B2/B3/B4/L0/E1/E2 tmp-exclusion: NO taskB1/taskB2/taskB3/taskB4/taskL0/taskE1/taskE2-*-tmp/* scratch entries in the zip");
}

/* ---------- B1 feature needles: routingSession.ts (the session core) ---------- */

contentOk("routingSession.ts: the D5 fixed names (user-approved MementoTunHelper) (B1)",
  "electron-app/electron/routingSession.ts", [
  'export const TUN_INTERFACE_NAME = "MementoTun";',
  'export const HELPER_ROLE_NAME = "MementoTunHelper";',
  'export const SESSION_BASE_DIR_NAME = "MementoTunSession";',
  'export const RECOVERY_FILE_NAME = "memento-routing-recovery.json";',
  'export const HELPER_FLAG = "--routing-helper";',
  'export const REPAIR_FLAG = "--repair-network";',
]);
contentOk("routingSession.ts: the session file names (B1)",
  "electron-app/electron/routingSession.ts", [
  'export const REQUEST_FILE_NAME = "routing-request.json";',
  'export const STATUS_FILE_NAME = "status.json";',
  'export const CONTROL_FILE_NAME = "control.json";',
  'export const CONFIG_FILE_NAME = "routing-config.json";',
  'export const LOG_FILE_NAME = "routing.log";',
]);
contentOk("routingSession.ts: the D7 MTU clamp (default 1500, [1280,9000], UNSET folds to default — the approved bug fix) (B1)",
  "electron-app/electron/routingSession.ts", [
  "export const TUN_MTU_DEFAULT = 1500;",
  "export const TUN_MTU_MIN = 1280;",
  "export const TUN_MTU_MAX = 9000;",
  'if (value === null || value === undefined || value === "") return TUN_MTU_DEFAULT;',
  "if (!Number.isFinite(n)) return TUN_MTU_DEFAULT;",
  "mtu: clampTunMtu(req.tunMtu),",
]);
contentOk("routingSession.ts: the privilege boundary (validation + direct-child authorization) (B1)",
  "electron-app/electron/routingSession.ts", [
  "const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;",
  "const HOST_RE = /^[A-Za-z0-9._-]{1,253}$/;",
  '"sessionId missing/malformed"',
  "export function authorizeRequestPath(",
  '"sessionDir is not a direct child of the session base"',
  '"request path does not match <sessionDir>/routing-request.json"',
]);
contentOk("routingSession.ts: the D6 pure semantic mapping (B1)",
  "electron-app/electron/routingSession.ts", [
  "export const SOCKS_PROBE_INTERVAL_MS = 10_000;",
  "export const SOCKS_FAILURE_LIMIT = 3;",
  "export const HELPER_TICK_MS = 400;",
  "export function suppressSystemProxyWrites(state: SessionState): boolean {",
  "export function watchdogOutcome(",
  'return armed ? "hold-reconnecting" : "teardown-restoring";',
]);
contentOk("routingSession.ts: atomic session files + GUI-side preparation (B1)",
  "electron-app/electron/routingSession.ts", [
  "Write-then-rename atomicity",
  "export function atomicWriteJson(file: string, value: unknown): void {",
  "fs.renameSync(tmp, file);",
  "export function prepareRoutingSession(",
]);
contentOk("routingSession.ts: the D1/D4/D7 TUN config builder (tun-in + REAL remote DNS + mandatory resolver) (B1)",
  "electron-app/electron/routingSession.ts", [
  'type: "tun",',
  'tag: "tun-in",',
  "interface_name: req.interfaceName,",
  'address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],',
  "auto_route: true,",
  "strict_route: true,",
  'stack: "mixed",',
  '{ type: "udp", tag: "dns-remote", server: "1.1.1.1", detour: "proxy" },',
  '{ type: "udp", tag: "dns-remote-backup", server: "8.8.8.8", detour: "proxy" },',
  'version: "5",',
  'final: "proxy",',
  "auto_detect_interface: true,",
  'default_domain_resolver: { server: "dns-remote" },',
]);
contentAbsent("routingSession.ts carries NO clash_api/experimental (traffic stats stay on the core) (B1)",
  "electron-app/electron/routingSession.ts",
  ["clash_api", "experimental:"]);
contentOk("routingSession.ts: the B0 wintunPin spawn-gate contract FULFILLED (B1)",
  "electron-app/electron/routingSession.ts", [
  "import {\n  WINTUN_DLL_SHA256,",
  "WINTUN_DLL_RELATIVE_PATH,\n  WINTUN_PUBLISHER,",
  '"wintun.dll is missing — run scripts/fetch-wintun.ps1 (Windows) or fetch-wintun.sh (sandbox/CI) to place the pinned artifact"',
  "wintun.dll integrity check FAILED",
  "refusing to start the TUN session with an unverified artifact",
  'if (deps.platform === "win32") {',
  "Get-AuthenticodeSignature",
  "!subject.includes(WINTUN_PUBLISHER)",
  "wintun.dll Authenticode check FAILED",
]);
contentOk("routingSession.ts: dll path + the elevation launcher (no new dependencies, non-win32 refused) (B1)",
  "electron-app/electron/routingSession.ts", [
  "export function wintunDllPathFor(resourceRootDir: string): string {",
  "path.join(resourceRootDir, WINTUN_DLL_RELATIVE_PATH)",
  "function psQuote(s: string): string {",
  '"Start-Process",',
  '"-Verb",',
  '"RunAs",',
  '"elevation is only implemented on win32"',
]);

/* ---------- B1 feature needles: routingHelper.ts (the elevated side) ---------- */

contentOk("routingHelper.ts: argv recognition + dispatch (both D5 flags) (B1)",
  "electron-app/electron/routingHelper.ts", [
  "export function isHelperInvocation(argv: string[]): boolean {",
  "export function parseHelperArgv(argv: string[]): HelperInvocation | null {",
  '{ mode: "helper", requestPath: arg ?? "" }',
  '{ mode: "repair", sessionDir: arg ?? null }',
  "export async function runHelperInvocation(",
]);
contentOk("routingHelper.ts: EngineChild with the MEMOIZED exit promise (the approved memory-leak fix) (B1)",
  "electron-app/electron/routingHelper.ts", [
  "export interface EngineChild {",
  "Memoized ONCE: the watchdog races this promise every tick — a fresh",
  "promise per call would pile up 'close' listeners on long sessions.",
  "onExit: () => exitPromise,",
  "await Promise.race([child.onExit()",
]);
contentOk("routingHelper.ts: wintun placement beside the engine (copy, never rename) (B1)",
  "electron-app/electron/routingHelper.ts", [
  "export function ensureWintunBesideEngine(",
  "fs.copyFileSync(wintunDllPath, path.join(path.dirname(enginePath), \"wintun.dll\"));",
  "never the reverse, never a rename",
  "Only ever copies FROM the B0-verified location",
]);
contentOk("routingHelper.ts: the identity-guarded engine kill (tamper-proof by image name) (B1)",
  "electron-app/electron/routingHelper.ts", [
  "const ENGINE_IMAGE_RE = /^sing-box(\\.exe)?$/i;",
  "export async function killEnginePidGuarded(",
  "not the engine — hands off",
  "a tampered pid from becoming kill-any-process",
]);
contentOk("routingHelper.ts: the watchdog loop boundaries (control stop + GUI death + honest engine crash) (B1)",
  "electron-app/electron/routingHelper.ts", [
  "if (fs.existsSync(path.join(sessionDir, CONTROL_FILE_NAME))) {",
  'exitReason = "gui-gone";',
  '"upstream socks never became reachable — tunnel refused to go live"',
  "routing engine exited unexpectedly (code",
  "routing engine exited before the tunnel went live (code",
]);
contentOk("routingHelper.ts: the D6 fork (fail-closed hold + fail-open teardown) (B1)",
  "electron-app/electron/routingHelper.ts", [
  "? \"hold-reconnecting\"",
  ': "teardown-restoring";',
  '"kill switch is holding system traffic while the upstream recovers"',
  '"upstream recovered — system-wide routing resumed"',
  "D6 fail-closed: the tunnel stays UP and keeps swallowing",
  "D6 fail-open: restore normal networking.",
]);
contentOk("routingHelper.ts: the D6 full teardown (restoring -> disabled, recovery + control consumed) (B1)",
  "electron-app/electron/routingHelper.ts", [
  '"restoring", "closing the adapter and restoring routes"',
  '"disabled", "networking was restored"',
  "clearRecovery(sessionBaseDir(deps.userDataDir));",
  "clearControl(sessionDir);",
]);
contentOk("routingHelper.ts: stale cleanup + the --repair-network one-shot (identity-guarded, outside-base refused) (B1)",
  "electron-app/electron/routingHelper.ts", [
  "export async function cleanupStaleSession(",
  '"cleaned up by a newer session"',
  "export async function runNetworkRepair(",
  '"no MEMENTO network state was found to repair"',
  '"session dir is outside the session base — refusing"',
  "await killEnginePidGuarded(status.enginePid, deps);",
  '"network repair completed"',
]);
contentOk("routingHelper.ts: honest dispatch logging under the approved role name (B1)",
  "electron-app/electron/routingHelper.ts", [
  "`[MementoTunHelper] repair: ${r.message}`",
  "`[MementoTunHelper] helper: ${r.finalState}${r.message ? \" — \" + r.message : \"\"}`",
]);

/* ---------- B1 feature needles: main.ts (the helper hook + loop prevention) ---------- */

contentOk("main.ts: the B1 helper hook — argv checked BEFORE the single-instance lock, all four lifecycle guards (B1)",
  "electron-app/electron/main.ts", [
  'import { isHelperInvocation, runHelperInvocation } from "./routingHelper";',
  "const HELPER_MODE = isHelperInvocation(process.argv);",
  "if (HELPER_MODE) {\n  void startRoutingHelperMode();\n} else {",
  "async function startRoutingHelperMode(): Promise<void> {",
  "await app.whenReady();",
  'userDataDir: app.getPath("userData"),',
  "resourceRootDir: resourceRoot(),",
  "findEngine: findSingBox,",
  "app.exit(code);",
  "`[MementoTunHelper] fatal: ${String(e)}`",
  "if (HELPER_MODE) return; // the helper runs its own lifecycle above",
  "cleanupAllCores would kill the GUI's live cores",
  "if (HELPER_MODE) return;\n  // Flip FIRST",
  'app.on("window-all-closed", () => {\n  if (HELPER_MODE) return;',
  "if (!HELPER_MODE) cleanupOnce();",
]);

/* ---------- B1 docs: README + TESTING-CHECKLIST + the fntest harness ---------- */

contentOk("README documents Batch B1: fixed names, D6 semantics, loop prevention, no UI yet (B1)",
  "electron-app/README.md", [
  "## Phase B — Batch B1 (routingSession + routingHelper — the TUN session machinery, no UI yet)",
  "**Helper role:** `MementoTunHelper`",
  "`--routing-helper <requestPath>`",
  "`--repair-network <sessionDir>`",
  "REAL remote (`1.1.1.1` / `8.8.8.8`) DETOURED through the tunnel",
  "carries NO clash_api",
  "identity-guarded stale-engine kill",
  "BEFORE the single-instance",
  "98 assertions on the REAL bundled",
]);
contentOk("TESTING-CHECKLIST section 29 carries the B1 real-Windows legs (B1)",
  "electron-app/TESTING-CHECKLIST.md", [
  "## 29. Phase B1 — routing session (real-Windows manual items)",
  "UAC consent dialog appears exactly once per session",
  "`MementoTun` adapter exists",
  "status.json shows `reconnecting`",
  "`restoring` then `disabled`",
  "`memento-routing-recovery.json` is removed",
  "refuses BEFORE spawning sing-box",
  "ONLY if its image name is sing-box",
  "garbage value folds to 1500",
]);
contentOk("taskB1-fntest harness rides the zip: real modules via esbuild + the REAL pinned sing-box check (B1)",
  "scripts/taskB1-fntest.mjs", [
  "taskB1-fnentry.ts",
  "sing-box-1.14.0-linux-amd64",
  '"check", "-c"',
  "== T1 ",
  "== T18 ",
]);

/* ---------- B2 feature needles: routingManager.ts + the wiring + the renderer ---------- */

contentOk("routingManager.ts: the ELECTRON-FREE factory + the wire types (B2)",
  "electron-app/electron/routingManager.ts", [
  "export function createRoutingManager(deps: RoutingManagerDeps): RoutingManager {",
  'export type RoutingViewState = SessionState | "idle";',
  "export interface RoutingStatusView {",
  "killSwitchArmed: boolean;",
  "suppressSystemProxy: boolean;",
]);
contentOk("routingManager.ts: the honest start refusals + the MAIN-SIDE request build (B2)",
  "electron-app/electron/routingManager.ts", [
  "VPN Device (TUN) routing is only implemented on Windows",
  "No active core to tunnel into",
  "A VPN Device (TUN) session is already active",
  "guiPid: process.pid,",
  "killSwitchArmed: deps.isKillSwitchArmed(),",
  "tunMtu: clampTunMtu(tunMtuInput), // D7",
  "previousSessionDir,",
]);
contentOk("routingManager.ts: the UAC self-heal (120 s) + the launch-failure marker cleanup (B2)",
  "electron-app/electron/routingManager.ts", [
  "const UAC_HEAL_MS = 120_000;",
  "launchPendingHeal(",
  "clearRecovery(base());",
  "the elevated helper could not be launched",
]);
contentOk("routingManager.ts: the repair anti-UAC-spam window (the user-confirmed close addendum) (B2)",
  "electron-app/electron/routingManager.ts", [
  "const REPAIR_COOLDOWN_MS = 120_000;",
  "if (launchPending) {",
  "a VPN Device (TUN) start elevation is still pending",
  "now() - lastRepairLaunchMs < REPAIR_COOLDOWN_MS",
  "a network repair was launched less than 120 s ago",
  "if (launched.launched) lastRepairLaunchMs = now();",
]);
contentOk("routingManager.ts: the D6 suppression map + the sync quit stop (B2)",
  "electron-app/electron/routingManager.ts", [
  "!launchPending &&",
  'state === "starting" || state === "connected" || state === "reconnecting"',
  "requestStopBestEffort(): void {",
  "best-effort — the gui-pid watchdog is the guaranteed backstop",
]);
contentOk("ipc.ts: the FOUR routing handlers + the D6 suppression gates + the core-transition guards (B2)",
  "electron-app/electron/ipc.ts", [
  'ipcMain.handle("routing_start", (_e, args: { tunMtu?: unknown }) => {',
  "routing.startRouting(args?.tunMtu);",
  'ipcMain.handle("routing_stop", () => routing.stopRouting());',
  'ipcMain.handle("routing_status", () => routing.getRoutingStatus());',
  'ipcMain.handle("routing_repair", () => routing.repairRouting());',
  "d6SuppressionError",
  "routing.isSystemProxySuppressed()",
  "routing.isSessionLive()",
  "routing.requestStopBestEffort()",
]);
contentOk("main.ts: the manager factory block + the IPC registration + the cleanup order (B2)",
  "electron-app/electron/main.ts", [
  "createRoutingManager({",
  'getUserDataDir: () => app.getPath("userData"),',
  "getPlatform: () => process.platform,",
  "getExePath: () => process.execPath,",
  "registerIpcHandlers(routingManager);",
  "routingManager.requestStopBestEffort();",
]);
contentOk("preload.ts: the allowlist carries the 4 routing commands + the security comment (B2)",
  "electron-app/electron/preload.ts", [
  '"routing_start",', '"routing_stop",', '"routing_status",', '"routing_repair",',
  "built ENTIRELY main-side",
]);
contentOk("store.ts: the mode + the wire types + the persisted setters (B2)",
  "src/store.ts", [
  'export type AetherRoutingMode = "socks" | "vpn-device";',
  "memento-aether-mode",
  "export interface RoutingStatusViewWire {",
  "suppressSystemProxy: boolean;",
  "setAetherMode: (mode)",
  "setRoutingView: (v)",
]);
contentOk("AetherTab.tsx: the SOCKS/VPN Device segment + the sequenced connect/disconnect (B2)",
  "src/components/AetherTab.tsx", [
  "aether.modeSocks",
  "aether.modeVpnDevice",
  'tauriInvoke<AetherLiveInfo>("aether_start"',
  'tauriInvoke("routing_start", {})',
  "aether.tunStartFailed",
  "waitRoutingTerminal",
  'tauriInvoke("routing_stop")',
  'tauriInvoke<{ launched: boolean; reason?: string }>("routing_repair")',
  "TUN_LIVE_STATES",
]);
contentOk("AetherTab.tsx: D6 discipline — no proxy writes in vpn-device mode + the amber reconnect banner (B2)",
  "src/components/AetherTab.tsx", [
  'if (useStore.getState().aetherMode === "vpn-device") return;',
  "aether.tunReconnectHint",
  '"reconnecting"',
]);
contentOk("electron-mock.ts: the honest browser mirror for all 4 commands (B2)",
  "src/electron-mock.ts", [
  "routing_start:",
  "routing_stop:",
  "routing_status:",
  "routing_repair:",
  "requires the Windows desktop app",
]);
contentOk("taskB2-fntest harness rides the zip: the real factory via esbuild + the anti-spam legs (B2)",
  "scripts/taskB2-fntest.mjs", [
  "taskB2-fnentry.ts",
  "== T1 ",
  "== T16 ",
  "== T17 ",
]);
{
  const i18n = zcat("src/i18n.ts");
  const keys = [
    "aether.mode", "aether.modeSocks", "aether.modeSocksDesc",
    "aether.modeVpnDevice", "aether.modeVpnDeviceDesc",
    "aether.vpnDeviceCard", "aether.vpnDeviceHint", "aether.vpnDeviceProxyNote",
    "aether.tunReconnectHint", "aether.tunStartFailed",
    "aether.tunStateStarting", "aether.tunStateConnected", "aether.tunStateReconnecting",
    "aether.tunStateRestoring", "aether.tunStateDisabled", "aether.tunStateError", "aether.tunStateIdle",
    "aether.repairNetwork", "aether.repairNetworkHint", "aether.repairLaunched", "aether.repairNothing",
  ];
  for (const k of keys) {
    const n = (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
}
contentOk("README documents Batch B2: manager + 4 commands + the segment + the anti-spam window (B2)",
  "electron-app/README.md", [
  "## Phase B — Batch B2 (routingManager + the 4 IPC commands + the SOCKS/VPN Device segment)",
  "Anti-UAC-spam:",
  "REPAIR_COOLDOWN_MS",
  "routing_start",
  "VPN Device",
  "UAC self-heal",
]);
contentOk("TESTING-CHECKLIST section 30 carries the B2 legs incl. the anti-spam leg (B2)",
  "electron-app/TESTING-CHECKLIST.md", [
  "## 30. Phase B2",
  "ONE elevation per 120 s",
  "never queue a second prompt",
  "69 fntest assertions",
]);

/* ---------- B3 feature needles: the C5/F9 fusion (killSwitch + helper + manager + main) ---------- */

contentOk("killSwitch.ts: the TUN twin + the block-only TUN audit decision (B3)",
  "electron-app/electron/killSwitch.ts", [
  "export function blockOnRoutingExit(): void {",
  "export function resolveRoutingAuditAction(",
  'return armed && markerActive && !helperLiveFresh ? "block" : "leave";',
  'export function applyRoutingAuditAction(action: "block" | "leave"): void {',
  "the F9 startup audit owns boot",
]);
contentOk("routingHelper.ts: the fresh-armed read + the heartbeat (B3)",
  "electron-app/electron/routingHelper.ts", [
  "readKillSwitchArmed?: (userDataDir: string) => boolean;",
  "function defaultReadKillSwitchArmed(userDataDir: string, fallback: boolean): boolean {",
  '"memento-app-prefs.json"',
  "crosses no trust boundary",
  "Phase B3: readiness heartbeat",
  "Phase B3 heartbeat: healthy session, no transition",
  "Heartbeat on the failing path too",
]);
contentOk("routingManager.ts: the staleness + the once-only C5 transition + the audit view (B3)",
  "electron-app/electron/routingManager.ts", [
  "const ROUTING_STATUS_STALE_MS = 30_000;",
  "const isStaleLive = (st: SessionStatus | null): boolean =>",
  "const observeLive = (liveNow: boolean): void => {",
  "the routing helper stopped reporting (heartbeat lost) — use network repair or start a new session",
  "onRoutingLiveLost?: () => void;",
  "getLeftoverAuditState(): { markerActive: boolean; helperLiveFresh: boolean }",
  "The audit must never act on unreadable state",
]);
contentOk("main.ts: the TUN startup audit + the watchdog + the C5 wiring (B3)",
  "electron-app/electron/main.ts", [
  "onRoutingLiveLost: blockOnRoutingExit,",
  "blockOnRoutingExit,",
  "resolveRoutingAuditAction,",
  "applyRoutingAuditAction,",
  "function auditLeftoverRoutingSession(): void {",
  "if (!markerActive || helperLiveFresh) return;",
  "if (readProxyState().enabled) return; // owned by the proxy audit above",
  "applyRoutingAuditAction(action);",
  "auditLeftoverProxy();",
  "auditLeftoverRoutingSession();",
  "const routingWatchdog = setInterval(() => {",
  "}, 2_000);",
  "routingWatchdog.unref?.();",
]);
contentOk("taskB3-fntest harness rides the zip: heartbeat + fresh-armed + transition + audit legs (B3)",
  "scripts/taskB3-fntest.mjs", [
  "taskB3-fnentry.ts",
  "== T1 ",
  "== T3 ",
  "== T7 ",
  "== T11 ",
  "== T14 ",
  "== T16 ",
]);
{
  const i18n = zcat("src/i18n.ts");
  const n = (i18n.match(/set\.killSwitchHint/g) || []).length;
  if (n !== 4) { console.error(`FAIL  i18n set.killSwitchHint x${n} (need 4 languages)`); bad++; }
  else console.log("PASS  i18n set.killSwitchHint x4 (the B3 TUN sentences ride the same keys)");
  if (!i18n.includes("In VPN Device (TUN) mode the same switch drives the hold")) {
    console.error("FAIL  i18n EN killSwitchHint lacks the B3 TUN sentence"); bad++;
  } else console.log("PASS  i18n EN killSwitchHint carries the TUN hold + silent-helper block sentence");
}
contentOk("README documents Batch B3: the C5/F9 fusion (B3)",
  "electron-app/README.md", [
  "## Phase B — Batch B3 (C5 kill-switch + F9 audit fusion",
  "fresh armed reads + the status heartbeat",
  "heartbeat staleness + the C5 transition",
  "the TUN twin + the TUN audit decision",
  "the TUN startup audit + the main-side watchdog",
  "crosses no trust boundary",
]);
contentOk("TESTING-CHECKLIST section 31 carries the B3 real-Windows legs (B3)",
  "electron-app/TESTING-CHECKLIST.md", [
  "## 31. Phase B3 — C5 kill-switch + F9 audit fusion",
  "Stale helper (armed)",
  "Fresh-armed flip",
  "Startup audit (armed, TUN residue)",
  "Watchdog independence",
]);

/* ---------- B4 closeout needles (NEW — the documentation-only batch) ---------- */

contentOk("README documents Batch B4: the DOCUMENTATION-ONLY closeout + the seal chain (B4)",
  "electron-app/README.md", [
  "## Phase B — Batch B4 (Phase B closeout — the phase is closed)",
  "DOCUMENTATION-ONLY closeout of Phase B",
  "B0 — wintun.dll provenance** (seal `bef82af1…`)",
  "B1 — routingSession + routingHelper** (seal `d7ca91c9…`)",
  "`be226a11…`",
  "C5 kill-switch + F9 audit fusion** (seal `499fbe14…`)",
  "### The frozen Phase B surface (as sealed at B3 — byte-identical at B4)",
  "`electron/routingSession.ts` 537",
  "`electron/routingHelper.ts` 673",
  "`electron/routingManager.ts` 535",
  "`electron/killSwitch.ts` 262",
  "`electron/main.ts` 499",
  "`electron/ipc.ts` 724",
  "1,374 embedded assertions all-green (982 pre-B + 145 B1 +",
]);
contentOk("README Batch-B4: the probe finding + the remaining-work register (B4)",
  "electron-app/README.md", [
  "### The taskC4-probe.mjs finding (registered at B3, documented at B4)",
  "does NOT hold: `check` ACCEPTS such a config",
  "Dangling urltest members surface at RUNTIME, not at",
  "re-running it today exits 1 on S4 by design",
  "### The remaining-work register AFTER Phase B (unchanged, user ruling)",
  "**E1** per-connection stats",
  "**E2** ShadowTLS parser",
  "**THIRD-PARTY.json** the license manifest",
  "**setup-app** the new installer",
  "to be implemented FROM SCRATCH in",
]);
contentOk("TESTING-CHECKLIST section 32 carries the final acceptance sweep (B4)",
  "electron-app/TESTING-CHECKLIST.md", [
  "## 32. Phase B4 — Phase B closeout (real-Windows final acceptance sweep)",
  "- [ ] Provenance leg (B0):",
  "- [ ] Full lifecycle leg (B1+B2+B3, one continuous pass):",
  "- [ ] Crash-residue leg (B3 audit):",
  "- [ ] Documentation leg (B4):",
  "- [ ] Regression leg (pre-B parity):",
  "127.0.0.1:9 (blocked, NEVER cleared)",
]);
contentOk("taskC4-probe.mjs: the B4 NOTE header + the byte-identical executable record (B4)",
  "scripts/taskC4-probe.mjs", [
  " * B4 NOTE (2026-09-20, design-time artifact status):",
  "it is NOT part of any official",
  " *     S4  NEGATIVE: urltest referencing a missing outbound must be REJECTED",
  'outbounds: ["proxy", "ghost"],',
  "process.exit(fail ? 1 : 0);",
]);
contentOk("taskB4-quickcheck harness rides the zip: the closeout structural gates (B4)",
  "scripts/taskB4-quickcheck.mjs", [
  "taskB4-quickcheck:",
  "== S1 README Batch-B4 closure map ==",
  "== S4 taskC4-probe.mjs header note + byte-stable body ==",
  "== S5 frozen surfaces (the zero-runtime-change proof) ==",
]);

/* ---------- L0 feature needles (NEW — the license/origin manifest) ---------- */

contentOk("resources/THIRD-PARTY.json: the machine-readable authority rides the zip (L0)",
  "electron-app/resources/THIRD-PARTY.json", [
  '"manifest": "MEMENTO third-party license and origin manifest"',
  '"manifestVersion": 1',
  '"liveEvidenceDate": "2026-09-20"',
  '"licenseId": "MPL-2.0"',
  '"licenseId": "GPL-3.0-or-later"',
  '"licenseId": "AGPL-3.0-only"',
  "Wintun Prebuilt Binaries License",
  "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce",
  "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51",
  "complete-source-offer",
  "NO standalone license file",
]);
{
  const lc = (s) => s.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).length;
  const texts = [
    ["electron-app/resources/licenses/Xray-core-v25.1.1-MPL-2.0.txt", 373, "Mozilla Public License"],
    ["electron-app/resources/licenses/sing-box-v1.14.0-GPL-3.0.txt", 674, "GNU GENERAL PUBLIC LICENSE"],
    ["electron-app/resources/licenses/sing-box-v1.14.0-LICENSE-notice.txt", 17, "nekohasekai"],
    ["electron-app/resources/licenses/Aether-v1.9.0-AGPL-3.0.txt", 661, "GNU AFFERO GENERAL PUBLIC LICENSE"],
    ["electron-app/resources/licenses/jsqr-1.4.0-Apache-2.0.txt", 202, "Apache License"],
    ["electron-app/resources/licenses/Inter-OFL-1.1.txt", 93, "SIL Open Font License"],
    ["electron-app/resources/licenses/JetBrainsMono-OFL-1.1.txt", 93, "SIL Open Font License"],
  ];
  for (const [f, want, needle] of texts) {
    const body = zcat(f);
    const n = lc(body);
    if (n !== want || !body.includes(needle)) { console.error(`FAIL  license text ${f}: ${n} lines / needle ${JSON.stringify(needle)} (want ${want})`); bad++; }
    else console.log(`PASS  license text rides verbatim: ${f.replace("electron-app/resources/licenses/", "")} (${want} lines)`);
  }
}
contentOk("NOTICE.md: the L0 human-readable registry rides (L0)",
  "electron-app/NOTICE.md", [
  "HUMAN-READABLE attribution registry",
  "SIL OFL 1.1",
  "MetaCubeX/meta-rules-dat",
  "unofficial wrapper",
]);
contentOk("README: the Batch-L0 section rides (L0)",
  "electron-app/README.md", [
  "## Phase E — Batch L0 (third-party license/origin manifest — the post-B register begins)",
  "16 `bundled`",
  "2 `runtimeFetched`",
  "4 `excluded`",
  "17-line GPL NOTICE HEADER",
  "the complete-source-offer path",
  "~~THIRD-PARTY.json~~ — **DONE at this batch**",
]);
contentOk("TESTING-CHECKLIST section 33 rides (L0)",
  "electron-app/TESTING-CHECKLIST.md", [
  "## 33. Phase E — Batch L0 (license manifest — real-Windows verification)",
  "- [ ] Manifest rides:",
  "- [ ] Pin cross-check:",
  "- [ ] Verbatim texts ride:",
  "- [ ] GPL/AGPL source offers:",
  "- [ ] Attribution walk:",
  "- [ ] Packaging leg:",
  "- [ ] Regression leg (inert data):",
]);
contentOk("taskL0-quickcheck harness rides the zip: the L0 structural gates (L0)",
  "scripts/taskL0-quickcheck.mjs", [
  "taskL0-quickcheck:",
  "== S1 resources/THIRD-PARTY.json structure ==",
  "== S3 resources/licenses/ verbatim texts ==",
  "== S5 frozen surfaces (the zero-runtime-change proof) ==",
]);

/* ---------- E1 feature needles (NEW — live per-connection stats) ---------- */

contentOk("connectionStats.ts: the ONE main-side stats module — both mappers + honest granularities + the 1200 ms deadlines + the D2 secrecy note (E1)",
  "electron-app/electron/connectionStats.ts", [
  "export async function getConnectionStats(",
  'granularity: "per-connection"',
  'granularity: "per-outbound"',
  "const MAX_ROWS = 200;",
  "setTimeout(() => controller.abort(), 1200)",
  "sleep(1200)",
  "/^outbound>>>([^>]+)>>>traffic>>>(uplink|downlink)$/.exec(name)",
  "The secret NEVER crosses the IPC bridge (D2)",
  "function classifyXrayTag(tag: string): string {",
  'if (tag === "proxy") return "tunnel";',
]);
contentOk("coreTypes.ts: the E1 additive wire shapes (Granularity/Row/Reply) (E1)",
  "electron-app/electron/coreTypes.ts", [
  "export type ConnectionStatsGranularity =",
  '"per-outbound"   // xray: per-tag rows only — no per-connection counter exists',
  "export interface ConnectionStatsRow {",
  "export interface ConnectionStatsReply {",
  "totalLive: number;",
  "totalShown: number;",
]);
contentOk("ipc.ts: the ADDITIVE get_connection_stats handler mirrors the aggregate routing + the aether honest-none + the aggregate body byte-intact (E1)",
  "electron-app/electron/ipc.ts", [
  '"get_connection_stats"',
  'getConnectionStats("sing-box", apiPort, singBoxManager.getClashSecret())',
  'getConnectionStats("xray", apiPort, null)',
  '{ core: "aether", granularity: "none", connections: null, totalLive: 0, totalShown: 0 }',
  "// Aether guard (honest limitation): the aether core exposes NO stats",
  "return { uplink: 0, downlink: 0 };",
  "? singBoxManager.getTraffic(apiPort)",
  ": xrayManager.getTraffic(apiPort);",
]);
contentOk("preload.ts: allowlist 31 -> 32, EXACTLY one new channel + the docstring note (E1)",
  "electron-app/electron/preload.ts", [
  '"get_connection_stats",',
  "the Phase-E1 connection-stats probe",
]);
contentOk("ConnectionStatsPanel.tsx: collapsed = zero IPC + the honest granularities rendered (E1)",
  "src/components/ConnectionStatsPanel.tsx", [
  "if (!open) return; // collapsed = zero IPC (approval D4)",
  'await tauriInvoke<ConnStatsReply>("get_connection_stats", {',
  't("connections.perOutboundNote", language)',
  'granularity === "none" &&',
]);
{
  const i18n = zcat("src/i18n.ts");
  const keys = [
    "connections.title", "connections.show", "connections.hide", "connections.live",
    "connections.destination", "connections.network", "connections.down", "connections.up",
    "connections.empty", "connections.none", "connections.perOutboundNote", "connections.more",
  ];
  for (const k of keys) {
    const n = (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
}
contentOk("electron-mock.ts: the honest browser mirror — aether none + per-connection rows + per-outbound rows (E1)",
  "src/electron-mock.ts", [
  "get_connection_stats: async () => {",
  'return { core: sim.core ?? "xray", granularity: "none", connections: null, totalLive: 0, totalShown: 0 };',
  'granularity: "per-connection"',
  'granularity: "per-outbound"',
]);
contentOk("README documents Batch E1: the additive-only runtime batch + the frozen-surface declaration + the register (E1)",
  "electron-app/README.md", [
  "## Phase E — Batch E1 (live per-connection stats",
  "~~E1~~ — **DONE at this batch**",
  "The frozen Phase B surface after E1",
  "12 `connections.*` keys",
  "Byte-stable (sha256-gated in the quickcheck)",
]);
contentOk("TESTING-CHECKLIST section 34 carries the E1 real-Windows legs (E1)",
  "electron-app/TESTING-CHECKLIST.md", [
  "## 34. Phase E — Batch E1",
  "- [ ] sing-box leg:",
  "- [ ] xray leg:",
  "- [ ] aether leg:",
  "- [ ] Collapsed cost:",
  "- [ ] Lifecycle:",
  "- [ ] Failure honesty:",
  "- [ ] Regression leg:",
  "- [ ] i18n leg:",
  "- [ ] Preview leg:",
]);
contentOk("taskE1-quickcheck harness rides the zip: the E1 structural gates incl. the live probe re-run (E1)",
  "scripts/taskE1-quickcheck.mjs", [
  "taskE1-quickcheck:",
  "/* ---------- G3: ipc.ts ---------- */",
  "/* ---------- G4: singbox additive + xray byte-stable ---------- */",
  "/* ---------- G8: LIVE probe re-run ---------- */",
]);

/* ---------- E2 feature needles (NEW — the MEMENTO ShadowTLS parser) ---------- */

contentOk("store.ts: the memento-stls:// parser — ProtocolType + isSingBoxProtocol structural exclusion + ParsedConfig pair fields (E2)",
  "src/store.ts", [
  'export type ProtocolType = "vmess" | "vless" | "trojan" | "ss" | "ssr" | "socks" | "hysteria2" | "tuic" | "shadowtls";',
  'return protocol === "hysteria2" || protocol === "tuic" || protocol === "shadowtls";',
  "stlsVersion?: string;",
  "stlsPassword?: string;",
]);
contentOk("store.ts: parseShadowTLS with the honest validation (versions exactly 1..3 — probe P1; v2/v3 require stls-password — probe P3 users[] contract) (E2)",
  "src/store.ts", [
  'const urlPart = raw.replace("memento-stls://", "");',
  'const version = params.get("version") || "3";',
  '"Invalid ShadowTLS version (expected 1, 2 or 3)"',
  '"ShadowTLS v2/v3 requires stls-password"',
  "stlsVersion: version,",
  "stlsPassword,",
]);
contentOk("store.ts: the parseSingleLink dispatch + the pass-through fields (subscriptions inherit the scheme) (E2)",
  "src/store.ts", [
  'trimmed.startsWith("memento-stls://")',
  "parsed = parseShadowTLS(trimmed);",
  'stlsVersion: parsed.stlsVersion || "",',
  'stlsPassword: parsed.stlsPassword || "",',
]);
contentOk("singBoxConfig.ts: the paired outbounds — trojan primary detour:stls-t + the shadowtls transport (the live-proven P4 shape) (E2)",
  "src/utils/singBoxConfig.ts", [
  'const STLS_TRANSPORT_TAG = "stls-t";',
  "type: \"trojan\",",
  "detour: STLS_TRANSPORT_TAG,",
  "function buildSbStlsTransport(config: ParsedConfig): Record<string, unknown> {",
  "version: Number(config.stlsVersion) || 3,",
  "...(config.stlsPassword ? { password: config.stlsPassword } : {}),",
]);
contentOk("singBoxConfig.ts: allowStlsPair — the pair builds ONLY for the main connection + the generator-side topology defense (E2)",
  "src/utils/singBoxConfig.ts", [
  "allowStlsPair = false,",
  "if (!allowStlsPair) return null; // E2 v1 scope: main connection only",
  "const outbound = buildSbOutbound(config, true);",
  'const stlsTransport = config.protocol === "shadowtls" ? buildSbStlsTransport(config) : null;',
  "...(stlsTransport ? [stlsTransport] : []), // Task E2: the paired transport",
  "? null // E2: a shadowtls MAIN is plain-only — a hop would overwrite the",
  "? [] // E2: same for balancer members (feature-off, honest gate upstream).",
]);
contentOk("connectionActions.ts: the THREE honest connect-flow gates (MAIN+topology abort / hop abort / pool drop) (E2)",
  "src/utils/connectionActions.ts", [
  'if (config.protocol === "shadowtls" && (topo.chainEnabled || topo.balancerEnabled)) {',
  '"ShadowTLS connections run as a plain main connection — chain proxy and balancer are not supported for them yet.',
  'if (hop.protocol === "shadowtls") {',
  '"Chain proxy: ShadowTLS connections pair a transport with their inner trojan and run as the main connection only',
  'if (c.protocol === "shadowtls") { dropped.push(`${c.name}: ShadowTLS runs as a main connection only (transport + trojan pair), not as a pool member`); continue; }',
]);
contentOk("ImportTab.tsx: the memento-stls:// chip + the amber NON-STANDARD disclosure (E2)",
  "src/components/ImportTab.tsx", [
  '"tuic://", "memento-stls://"].map(proto =>',
  '{t("import.stlsNote", language)}',
]);
contentOk("ConfigsTab.tsx: the shadowtls chip entry (the Record<ProtocolType,string> type contract) (E2)",
  "src/components/ConfigsTab.tsx", [
  'shadowtls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",',
]);
contentOk("ping.ts: shadowtls rides the URI-branch target extraction + the memento-stls:// sniff (E2)",
  "src/utils/ping.ts", [
  '"tuic", "shadowtls"].includes(protocol)',
  'if (l.startsWith("memento-stls://")) return "shadowtls";',
]);
contentOk("editor.ts: the memento-stls Protocol member + sniff + the edit branch (E2)",
  "src/utils/editor.ts", [
  '"tuic" | "memento-stls" | "unknown"',
  'if (t.startsWith("memento-stls://")) return "memento-stls";',
  'case "memento-stls":',
]);
contentOk("electron-mock.ts: the demo-de-stls config — a full memento-stls:// link in the browser preview (E2)",
  "src/electron-mock.ts", [
  'id: "demo-de-stls", protocol: "shadowtls",',
  'stlsVersion: "3", stlsPassword: "memento-demo-stls",',
  'raw: "memento-stls://memento-demo-trojan@de-01.demo.memento.app:443?version=3&stls-password=memento-demo-stls&sni=cdn.demo.memento.app#Demo%20%E2%96%B8%20Frankfurt%20%E2%80%94%20MEMENTO%20ShadowTLS",',
]);
contentAbsent("xray-path exclusion: v2rayConfig.ts AND electron/xray.ts carry NO shadowtls token at all (E2)",
  "src/utils/v2rayConfig.ts", ["shadowtls"]);
contentAbsent("xray-path exclusion: electron/xray.ts carries NO shadowtls token (E2)",
  "electron-app/electron/xray.ts", ["shadowtls"]);
contentOk("README documents Batch E2: the MEMENTO ShadowTLS parser + the register (E2)",
  "electron-app/README.md", [
  "## Phase E — Batch E2 (the MEMENTO ShadowTLS parser)",
  "~~E2~~ — **DONE at this batch** (this section);",
  "### The remaining-work register after E2",
  "- **setup-app** the new installer;",
  "### Implementation (additive; the whole electron/* surface byte-stable)",
  "the `memento-stls://` dispatch in",
  "a hop would overwrite the pair's detour and orphan the transport",
]);
contentOk("TESTING-CHECKLIST section 35 carries the E2 real-Windows legs (E2)",
  "electron-app/TESTING-CHECKLIST.md", [
  "## 35. Phase E — Batch E2 (the MEMENTO ShadowTLS parser — real-Windows manual items)",
  "- [ ] Import leg:",
  "- [ ] Scheme honesty leg:",
  "- [ ] Version honesty leg:",
  "- [ ] Topology gate leg 1:",
  "- [ ] Topology gate leg 2:",
  "- [ ] Xray-exclusion leg:",
  "- [ ] Regression leg:",
  "- [ ] Preview leg:",
]);
{
  const i18n = zcat("src/i18n.ts");
  const keys = ["import.stlsNote"];
  for (const k of keys) {
    const n = (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
  for (const needle of ["it is NOT an industry standard and works only inside MEMENTO",
    "sing-box only"]) {
    if (!i18n.includes(needle)) { console.error(`FAIL  en i18n lacks ${JSON.stringify(needle)}`); bad++; }
    else console.log(`PASS  en i18n states the non-standard contract: ${JSON.stringify(needle)}`);
  }
}
contentOk("taskE2-quickcheck harness rides the zip: the E2 structural gates incl. the live probe re-run (E2)",
  "scripts/taskE2-quickcheck.mjs", [
  "taskE2-quickcheck:",
  "/* ---------- G3: scope honesty (connectionActions.ts) ---------- */",
  "/* ---------- G6: frozen surface sha256 ---------- */",
  "/* ---------- G8: LIVE probe re-run ---------- */",
]);

/* ---------- B0 regression needles (unchanged by B1) ---------- */

contentOk("wintunPin.ts: the artifact identity — all 8 constants byte-exact (B0)",
  "electron-app/electron/wintunPin.ts", [
  'export const WINTUN_VERSION = "0.14.1";',
  'export const WINTUN_OFFICIAL_URL = "https://www.wintun.net/";',
  'export const WINTUN_ZIP_URL = "https://www.wintun.net/builds/wintun-0.14.1.zip";',
  'export const WINTUN_ZIP_SHA256 =\n  "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51";',
  'export const WINTUN_DLL_SHA256 =\n  "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce";',
  'export const WINTUN_PUBLISHER = "WireGuard LLC";',
  'export const WINTUN_DLL_RELATIVE_PATH = "wintun/bin/amd64/wintun.dll";',
  'export const WINTUN_VERIFIED_AT = "2026-09-20";',
]);
contentOk("wintunPin.ts: the contract comments shipped (B0) — FULFILLED by routingSession (B1)",
  "electron-app/electron/wintunPin.ts", [
  "MUST re-verify WINTUN_DLL_SHA256 before the",
  "first spawn (spawn-integrity gate, C6-style)",
  "in the SAME reviewed commit",
]);
contentAbsent("wintunPin.ts is CONSTANTS-ONLY: no imports/require/spawn/fs (B0 D3 boundary)",
  "electron-app/electron/wintunPin.ts",
  ['from "fs"', 'from "node:fs"', 'from "child_process"', 'from "node:child_process"',
   "require(", "spawn("]);

contentOk("fetch-wintun.sh: official-source-only + BOTH digest gates + placement (B0)",
  "electron-app/scripts/fetch-wintun.sh", [
  "https://www.wintun.net/builds/wintun-0.14.1.zip",
  "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51",
  "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce",
  "REFUSED: zip sha256 mismatch",
  "REFUSED: dll sha256 mismatch",
  "exit 1",
  "placed verified wintun.dll -> resources/wintun/bin/amd64/wintun.dll",
  "refreshed wintun-LICENSE.txt",
  "Keep in lockstep with electron/wintunPin.ts",
]);
contentOk("fetch-wintun.ps1: official-source-only + BOTH digest gates + Authenticode (B0)",
  "electron-app/scripts/fetch-wintun.ps1", [
  "https://www.wintun.net/builds/wintun-0.14.1.zip",
  "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51",
  "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce",
  '$WintunPublisher = "WireGuard LLC"',
  "Get-AuthenticodeSignature",
  '$Sig.Status -ne "Valid"',
  "REFUSED: Authenticode check failed",
  "Expand-Archive",
]);

contentOk("resources/wintun/README.md: the provenance record shipped (B0)",
  "electron-app/resources/wintun/README.md", [
  "**Version:** 0.14.1 (amd64, win32-x64 only)",
  "**Official page:** https://www.wintun.net/",
  "**Official zip:** https://www.wintun.net/builds/wintun-0.14.1.zip (750,540 bytes)",
  "`07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51`",
  "`e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce`",
  "**Authenticode publisher (verified on real Windows):** `WireGuard LLC`",
  "**Provenance verified (live official-source fetch + hash + PE inspection):** 2026-09-20",
  "byte-identical",
  "routing.rs",
  "CERTIFICATE_TABLE",
  "NOT committed to this repository",
  "## License (the dll is NOT open-source)",
  "wintun.h **Permitted API**",
]);
{
  const lic = zcat("electron-app/resources/wintun/wintun-LICENSE.txt");
  const lines = lic.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).length;
  if (lines !== 84) { console.error(`FAIL  wintun-LICENSE.txt verbatim: ${lines} lines (need 84)`); bad++; }
  else console.log("PASS  wintun-LICENSE.txt verbatim: 84 lines ride the zip");
  for (const n of ["Prebuilt Binaries License", "WireGuard LLC grants to you",
    "the \"Permitted API\"", "remove any proprietary notices",
    "resell, redistribute, lease, rent, transfer, sublicense", "wintun.net/builds"]) {
    if (!lic.includes(n)) { console.error(`FAIL  wintun-LICENSE.txt lacks ${JSON.stringify(n)}`); bad++; }
    else console.log(`PASS  wintun-LICENSE.txt: ${JSON.stringify(n.slice(0, 32))}`);
  }
}
contentOk("NOTICE.md: wintun attribution + the L0 authority pointer shipped (B0 section verbatim; rewritten at L0)",
  "electron-app/NOTICE.md", [
  "**wintun.dll 0.14.1 (amd64)**",
  "**Copyright / licensor:** WireGuard LLC (www.wintun.net)",
  'License:** Wintun "Prebuilt Binaries License"',
  "resources/wintun/wintun-LICENSE.txt",
  "clause 3(c)",
  "clause 3(d)",
  "resources/THIRD-PARTY.json",
  "MACHINE-READABLE authority",
  "landed at Phase E Batch L0, 2026-09-20",
  "sha256-pinned in `electron/wintunPin.ts`",
]);

contentOk("core pins registry gains wintun beside the three cores (B0)", "electron-app/electron/core-versions.json",
  ['"xray": "v25.1.1"', '"sing-box": "1.14.0"', '"aether": "1.9.0"', '"wintun": "0.14.1"']);

contentOk("README documents Batch B0: provenance-only, byte-cross-check, binaries-never-shipped",
  "electron-app/README.md", [
  "## Phase B — Batch B0 (wintun.dll provenance — the ONLY new distribution file of the TUN effort)",
  "Batch B0 ships the PROVENANCE ONLY — zero executable TUN code",
  "byte-identical to the independent reference pin",
  "NOT committed and NOT zipped",
  "THE ONE PLACE",
  "REFUSES at fetch time",
]);
contentOk("TESTING-CHECKLIST section 28 carries the B0 real-Windows items", "electron-app/TESTING-CHECKLIST.md", [
  "## 28. Phase B0 — wintun.dll provenance (real-Windows manual items)",
  "fetch-wintun.ps1",
  "Authenticode OK: signed by WireGuard LLC",
  "Tamper leg",
  "clause 3(c)",
  '"wintun": "0.14.1"',
  "No TUN behavior exists yet",
]);

/* ---------- C6 regression needles (unchanged by B1) ---------- */

contentOk("pin-per-version table shipped with the byte-identical 1.9.0 authority row (C6)",
  "electron-app/electron/aether-versions.json", [
  '"releasesPage": "https://github.com/CluvexStudio/Aether/releases"',
  '"checkUrl": "https://api.github.com/repos/CluvexStudio/Aether/releases/latest"',
  '"version": "1.9.0"',
  '"verified": "2026-09-16"',
  "ee400806bf73fe16e655e6478eb7442c2c4e0576c4c8ce1913ac474e846b36cd",
  "e8b2a83c4ab0ad1a75dac21f2f2b9d701998f86866fde15025ffba307b7130b9",
  "5c64be2f2967469c53abdbec82599cb3c2ef005b8ef8efed79ba235d4ed3eb8d",
  "https://github.com/CluvexStudio/Aether/releases/download/v1.9.0/aether-windows-x86_64.zip",
  "an apply for linux therefore refuses with an honest no-url reason",
]);
contentOk("aetherUpdate.ts: table-as-authority service + strict validation shipped (C6)",
  "electron-app/electron/aetherUpdate.ts", [
  "export function createAetherUpdateService(deps: AetherUpdateDeps) {",
  "export function loadAetherVersionTable(tablePath?: string): AetherVersionTable {",
  "export function semverCompare(a: string, b: string): number | null {",
  '"pinned-newer"',
  '"unpinned-newer"',
  '"blocked-running"',
  "export function sha256File(filePath: string): string {",
  "status()",
  "check()",
  "apply(",
]);
contentAbsent("aetherUpdate.ts is electron-free + transport never reads proxy env/system config (C6)\n      [fs+global fetch are LEGITIMATE here: table/binary IO + the direct Node transport]",
  "electron-app/electron/aetherUpdate.ts",
  ['from "electron"', "process.env", "getSession", "systemPreferences"]);
contentOk("appUpdate.ts: the honest assistant — static facts only (C6 Option A)",
  "electron-app/electron/appUpdate.ts", [
  'export const APP_RELEASES_URL = "https://github.com/epodonios/memento/releases";',
  "export function appUpdateInfo(appVersion: string): AppUpdateInfo {",
  "selfUpdate: false",
  "The human performs the check",
]);
contentAbsent("appUpdate.ts imports NOTHING: no electron/fs/child_process/autoUpdater/timers (C6)\n      [the doc comment LISTS the forbidden imports — C1 lesson, API-shaped negatives only]",
  "electron-app/electron/appUpdate.ts",
  ['from "electron"', 'from "fs"', 'from "node:fs"', "from \"child_process\"", "from \"node:child_process\"", "autoUpdater)", "setInterval(", "fetch("]);
contentOk("spawn-integrity gate extended with the table hashes, refusals preserved (C6)",
  "electron-app/electron/aether.ts", [
  'import aetherVersionsTable from "./aether-versions.json";',
  "function allowedAetherTableHashes(platform: string): string[] {",
  "allowedAetherTableHashes(process.platform)",
]);
contentOk("ipc boundary: 4 C6 handlers, version-string-only argument (C6)",
  "electron-app/electron/ipc.ts", [
  "const aetherUpdate = createAetherUpdateService({",
  "isRunning: () => aetherManager.hasLiveChild(),",
  'swapTargetDir: () => path.join(resourceRoot(), "aether"),',
  'ipcMain.handle("aether_update_status"',
  'ipcMain.handle("aether_update_check"',
  '"aether_update_apply",',
  "A pinned-version string is the ONLY argument the renderer may",
  'ipcMain.handle("app_update_info"',
  "appUpdateInfo(app.getVersion())",
]);
contentOk("preload allowlist carries exactly the 4 new commands (C6)",
  "electron-app/electron/preload.ts", [
  '"aether_update_status"', '"aether_update_check"', '"aether_update_apply"', '"app_update_info"',
]);
contentOk("AetherUpdatePanel shipped: click-driven check + running lock + installability badge (C6)",
  "src/components/AetherTab.tsx", [
  "<AetherUpdatePanel language={language} isRtl={isRtl} />",
  "function AetherUpdatePanel({ language, isRtl }",
  't("aether.updateTitle", language)',
  't("aether.updateCheckBtn", language)',
  't("aether.updateRunningBlocked", language)',
  "row.installable",
]);
contentOk("Settings Section 5: the honest assistant panel (C6)",
  "src/components/SettingsTab.tsx", [
  'titleKey="set.appUpdateTitle"',
  't("set.appUpdateHint", language)',
  't("set.appUpdateThisBuild", language)',
  'tauriInvoke<AppUpdateInfoWire>("app_update_info")',
]);
contentOk("electron-mock mirrors all 4 commands honestly (C6)", "src/electron-mock.ts", [
  "aether_update_status: async () => ({",
  "aether_update_check: async () => ({",
  "aether_update_apply: async (args: any) => ({",
  "app_update_info: async () => ({",
  "selfUpdate: false,",
]);
{
  const i18n = zcat("src/i18n.ts");
  const keys = ["aether.updateTitle", "aether.updateHint", "aether.updateCheckBtn",
    "aether.updateChecking", "aether.updateUpToDate", "aether.updatePinnedNewer",
    "aether.updateUnpinnedNewer", "aether.updateRunningBlocked", "aether.updateErrNotPinned",
    "aether.updateErrHash", "aether.updateNotIdentified", "aether.updateBinaryMissing",
    "aether.updateBundled", "aether.updateActive", "aether.updateDone", "aether.updateInstalling",
    "aether.updateInstallBtn", "aether.updateCheckFailed", "aether.updateErrGeneric",
    "aether.updateTableTitle",
    "set.appUpdateTitle", "set.appUpdateHint", "set.appUpdateThisBuild", "set.appUpdateSteps",
    "set.appUpdateOpenBtn"];
  for (const k of keys) {
    const n = (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
  for (const needle of ["never checks by itself", "sha256-verified against that table",
    "aether.prev.bak", "never replaces its own executable"]) {
    if (!i18n.includes(needle)) { console.error(`FAIL  en i18n lacks ${JSON.stringify(needle)}`); bad++; }
    else console.log(`PASS  en i18n states the contract: ${JSON.stringify(needle)}`);
  }
}
contentOk("README documents Batch C6: table-as-authority + click-only + honest assistant",
  "electron-app/README.md", [
  "## Phase C — Batch C6 (Aether pin-per-version updates + the honest self-update assistant)",
  "**table, not a channel**",
  "is the ONLY install authority",
  "**User-click only.**",
  "**sha256 is mandatory and comes from the table.**",
]);
contentOk("TESTING-CHECKLIST section 27 carries the C6 manual items", "electron-app/TESTING-CHECKLIST.md", [
  "## 27. Phase C6 — Aether pin-per-version updates + the honest self-update assistant",
  "the panel shows the bundled pin (v1.9.0)",
  "returns blocked-running",
  "aether.prev.bak exists next to the binary",
  "no self-modification of the running app happened at any point",
]);

/* ---------- C5 regression needles (unchanged by B1) ---------- */

contentOk("kill-switch choke points shipped (C5)", "electron-app/electron/killSwitch.ts", [
  "export function markQuitting(): void {",
  "export function isQuitting(): boolean {",
  "return loadAppPrefs().killSwitch === true;",
  "export function releaseSystemProxy(): void {",
  "if (quitting) {",
  "if (isKillSwitchArmed()) {",
  "setBlockedSystemProxy();",
  "export function blockOnCoreExit(): void {",
  'return armed ? "block" : "clear";',
  'return "leave";',
  "export function resolveAuditAction(",
  "export function applyAuditAction(action: \"block\" | \"clear\" | \"leave\"): void {",
  "export function enforceKillSwitchAfterPrefChange(ourPorts: ReadonlySet<number>): void {",
  "if (isAnyCoreRunning()) return;",
]);
contentAbsent("killSwitch.ts is testable + scoped (no electron, no orphan-killers, never writes prefs)",
  "electron-app/electron/killSwitch.ts",
  ['from "electron"', "killAllOrphanedCores", "saveAppPrefs"]);
contentOk("fail-closed blocked state shipped (C5)", "electron-app/electron/proxy.ts", [
  "export const KILL_SWITCH_BLOCKED_PORT = 9;",
  "export function setBlockedSystemProxy(): void {",
  "`127.0.0.1:${KILL_SWITCH_BLOCKED_PORT}`",
]);
contentOk("manager exit handlers + stop paths wired (C5)", "electron-app/electron/xray.ts", [
  'import { releaseSystemProxy, blockOnCoreExit } from "./killSwitch";',
  "blockOnCoreExit();",
  "releaseSystemProxy();",
]);
contentOk("main.ts: quit latch on BOTH paths + kill-switch-aware audit (C5)",
  "electron-app/electron/main.ts", [
  "markQuitting();",
  "resolveAuditAction(",
  "applyAuditAction(action);",
  "new Set([...ourPorts, KILL_SWITCH_BLOCKED_PORT])",
]);
contentOk("Connection-tab blocked banner (role=alert) shipped (C5)", "src/components/ConnectionTab.tsx", [
  'killSwitchArmed && (status === "disconnected" || status === "error")',
  'role="alert"',
  "<ShieldAlert",
]);

/* ---------- C4 regression needles (unchanged by B1) ---------- */

contentOk("topology tag scheme shipped (C4)", "src/utils/topologyOptions.ts", [
  'export const CHAIN_HOP_TAG = "chain-hop";',
  'export const BALANCER_TAG = "balancer";',
  "export const MAX_BALANCER_EXTRAS = 8;",
  "export function trafficTagsFor(opts: TopologyOptions, resolvedExtrasCount: number): string[] {",
  'export const TOPOLOGY_OPTIONS_STORAGE_KEY = "memento-topology-options";',
]);
contentOk("xray chain + balancer generator shipped (C4)", "src/utils/v2rayConfig.ts", [
  "ss.sockopt = { dialerProxy: CHAIN_HOP_TAG };",
  "balancerTag: BALANCER_TAG,",
  'selector: ["proxy"],',
  "burstObservatory: {",
]);
contentOk("sing-box chain + urltest generator shipped (C4)", "src/utils/singBoxConfig.ts", [
  "outbound.detour = CHAIN_HOP_TAG;",
  'type: "urltest",',
  "if (balancerActive) sbRouting.route.final = BALANCER_TAG;",
]);
contentOk("traffic-tag sanitizer + per-tag counters shipped (C4)", "electron-app/electron/xray.ts", [
  "const TRAFFIC_TAG_RE = /^[A-Za-z0-9_-]{1,64}$/;",
  "export function sanitizeTrafficTags(input: unknown): string[] {",
  "const upMatchers = trafficTags.map((t) => `>>>${t}>>>traffic>>>uplink`);",
]);
contentOk("README C4 tracked-limitation section intact (B1 must not have touched it)",
  "electron-app/README.md", [
  "TRACKED LIMITATION (re-check on every core pin bump)",
  "scripts/taskC4-uplink-probe.mjs",
  "RE-CHECK DIRECTIVE",
  "sums ALL member tags",
]);
contentOk("TESTING-CHECKLIST section 25 + 25.1 intact", "electron-app/TESTING-CHECKLIST.md", [
  "25. Phase C4 — chain proxy + balancer",
  "25.1 Xray core limitation tracker — balancer uplink gap (MUST re-check on every core pin bump)",
]);

/* ---------- C3/C2/C1/D regression needles (unchanged by B1) ---------- */

contentOk("geo file lifecycle shipped (C3)", "electron-app/electron/geoFiles.ts", [
  "`https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/geoip.dat`",
  "meta-rules-dat/sing/geo/geosite/category-ir.srs",
  "fs.renameSync(tmp, dest);",
]);
contentOk("connect-time geo gate shipped (C3)", "src/utils/connectionActions.ts", [
  "const needed = requiredGeoFiles(state.routingOptions, core);",
  "useStore.getState().setGeoPreparing(true);",
  "trafficTags: trafficTagsFor(topo, balancerExtras.length),",
]);
contentOk("xray routing builder shipped (C3)", "src/utils/routingOptions.ts", [
  '{ type: "field", outboundTag: "blocked", domain: blockD }',
  'const domainStrategy = needsGeo ? "IPIfNonMatch" : "AsIs";',
]);
contentOk("probe config rewrite shipped (C2)", "electron-app/electron/urlTest.ts", [
  "export function rewriteConfigForProbe(configJson: string, port: number): RewrittenConfig {",
  'throw new Error("Aether is not a config-driven core");',
]);
contentOk("standalone trafficHistory ring shipped (C1)", "src/utils/trafficHistory.ts", [
  "export const TRAFFIC_HISTORY_MAX = 120;",
]);
contentOk("TrafficChart rides ONLY the standalone slice (perf contract)", "src/components/TrafficChart.tsx", [
  "useSyncExternalStore(subscribeTrafficHistory, getTrafficHistory)",
]);
contentOk("close-to-tray interception + session-end hardening shipped (D4)", "electron-app/electron/main.ts", [
  "let quitting = false;",
  'mainWindow.on("session-end", () => {',
  'app.on("before-quit", () => {',
]);
contentOk("global hotkeys shipped (D3)", "electron-app/electron/appPrefs.ts", [
  'export const HOTKEY_SHOW_HIDE = "Control+Alt+V"',
  'export const HOTKEY_CONNECT = "Control+Alt+C"',
  "globalShortcut.unregisterAll()",
]);
contentOk("socks parser + outbound shipped (Task-13)", "src/store.ts",
  ["function parseSocks(", "tryBase64Decode("]);
contentOk("net_check handler shipped (D1)", "electron-app/electron/ipc.ts",
  ['"net_check"', "session.fromPartition("]);
contentOk("tray status push shipped (D4)", "src/components/ConnectionManager.tsx", [
  'tauriInvoke("tray_status_set", { connected })',
]);

if (bad > 0) { console.error(`ZIP VERIFICATION FAILED: ${bad} problem(s)`); process.exit(1); }
console.log("zip verification complete — ALL CHECKS PASSED");
