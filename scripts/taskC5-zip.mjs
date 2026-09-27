#!/usr/bin/env node
/**
 * Phase C5: rebuild download/MEMENTO-electron-migration.zip and run
 * in-archive verification for the Batch-C5 features (kill switch —
 * fail-closed system proxy: the new killSwitch.ts choke points, the
 * blocked state in proxy.ts, the manager/ipc/main integration incl. the
 * quit latch, appPrefs persistence, the renderer mirror + toggle +
 * banner, the honest mock, and the Batch-C5 documentation in
 * README/TESTING-CHECKLIST §26) AND the full regression pin chain
 * (Task-13/12 + D1 + D2 + D3 + D4 + C1 + C2 + C3 + C4). Same exclusion
 * rules as every previous phase; binaries are never shipped.
 *
 * Negative pins are API-shaped (imports / call forms), never bare words —
 * a C1 lesson: legitimate doc comments may mention the forbidden thing.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SRC = "/home/z/my-project/memento-src";
const OUT = "/home/z/my-project/download/MEMENTO-electron-migration.zip";

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "dist-electron", "release", "target"].includes(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      if (entry.name === ".gitignore" || [".tsbuildinfo", ".log"].includes(path.extname(entry.name))) continue;
      files.push(path.join(dir, entry.name));
    }
  }
})(SRC);

fs.rmSync(OUT, { force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const X = [
  "node_modules/*", "*/node_modules/*",
  "dist/*", "*/dist/*",
  "dist-electron/*", "*/dist-electron/*",
  "release/*", "*/release/*",
  "target/*", "*/target/*",
  "*.tsbuildinfo", "*.log",
  "scripts/taskD4-quitclean-tmp/*", "scripts/taskD4-smoke-tmp/*",
  "scripts/taskD4-fn-tmp/*", "scripts/taskD3-*-tmp/*", "scripts/taskD2-*-tmp/*",
  "scripts/taskC1-*-tmp/*", "scripts/taskC1-smoke-tmp/*",
  "scripts/taskC2-*-tmp/*", "scripts/taskC2-smoke-tmp/*",
  "scripts/taskC3-*-tmp/*", "scripts/taskC3-smoke-tmp/*",
  "scripts/taskC4-*-tmp/*", "scripts/taskC4-smoke-tmp/*", "scripts/taskC4-live-tmp/*",
  "scripts/taskC5-*-tmp/*", "scripts/taskC5-smoke-tmp/*", "scripts/taskC5-live-tmp/*",
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

// Phase-C5 key files
["electron-app/electron/killSwitch.ts",
 "scripts/taskC5-quickcheck.mjs", "scripts/taskC5-fntest.mjs",
 "scripts/taskC5-live.mjs", "scripts/taskC5-fnentry.ts",
 "scripts/taskC5-smoke.mjs", "scripts/taskC5-zip.mjs"].forEach(must);

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

/* ---------- C5 feature needles: the choke-point module ---------- */

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

/* ---------- C5 feature needles: the blocked state + integration ---------- */

contentOk("fail-closed blocked state shipped (C5)", "electron-app/electron/proxy.ts", [
  "export const KILL_SWITCH_BLOCKED_PORT = 9;",
  "export function setBlockedSystemProxy(): void {",
  '"/d", "1", "/f"',
  "`127.0.0.1:${KILL_SWITCH_BLOCKED_PORT}`",
  '"Cannot enable blocked proxy"',
  '"Cannot set blocked proxy server"',
]);

contentOk("manager exit handlers + stop paths wired (C5)", "electron-app/electron/xray.ts", [
  'import { releaseSystemProxy, blockOnCoreExit } from "./killSwitch";',
  "blockOnCoreExit();",
  "releaseSystemProxy();",
]);
contentOk("sing-box manager wired identically (C5)", "electron-app/electron/singbox.ts", [
  'import { releaseSystemProxy, blockOnCoreExit } from "./killSwitch";',
  "blockOnCoreExit();",
  "releaseSystemProxy();",
]);
contentOk("aether exit handler rides the main-wide contract (C5)", "electron-app/electron/aether.ts", [
  'import { blockOnCoreExit } from "./killSwitch";',
  "blockOnCoreExit();",
  "the kill-switch CONTRACT is main-wide",
]);

contentOk("ipc boundary: clear_system_proxy + prefs enforcement (C5)", "electron-app/electron/ipc.ts", [
  'import { releaseSystemProxy, enforceKillSwitchAfterPrefChange } from "./killSwitch";',
  "releaseSystemProxy();",
  "enforceKillSwitchAfterPrefChange(",
  "new Set([10808, 10809, ...readLastActivePorts()])",
]);

contentOk("main.ts: quit latch on BOTH paths + kill-switch-aware audit (C5)",
  "electron-app/electron/main.ts", [
  "markQuitting();",
  "resolveAuditAction(",
  "applyAuditAction(action);",
  "new Set([...ourPorts, KILL_SWITCH_BLOCKED_PORT])",
]);

contentOk("appPrefs: killSwitch field + default OFF + boolean sanitizer + tolerant load (C5)",
  "electron-app/electron/appPrefs.ts", [
  "killSwitch: boolean;",
  "killSwitch: false,",
  'if (typeof p.killSwitch === "boolean") out.killSwitch = p.killSwitch;',
  "killSwitch: o.killSwitch === true,",
]);

/* ---------- C5 feature needles: renderer + honest mock ---------- */

contentOk("store mirror + fire-and-forget persistence (C5)", "src/store.ts", [
  "killSwitchArmed: boolean;",
  "setKillSwitchArmed: (armed: boolean, opts?: { persist?: boolean }) => void;",
  "killSwitchArmed: false,",
  "app_prefs_set",
  "killSwitch: armed",
]);
contentOk("App.tsx boot-loads the mirror reply-is-authority (C5)", "src/App.tsx", [
  'typeof p.killSwitch === "boolean"',
  "setKillSwitchArmed(p.killSwitch, { persist: false })",
]);
contentOk("Settings toggle + Connection banner shipped (C5)", "src/components/SettingsTab.tsx", [
  "const killSwitchArmed = useStore(s => s.killSwitchArmed);",
  't("set.killSwitch", language)',
  't("set.killSwitchHint", language)',
]);
contentOk("Connection-tab blocked banner (role=alert) shipped (C5)", "src/components/ConnectionTab.tsx", [
  'killSwitchArmed && (status === "disconnected" || status === "error")',
  'role="alert"',
  't("connection.killSwitchBlocked", language)',
  't("connection.killSwitchBlockedHint", language)',
  "<ShieldAlert",
]);
contentOk("electron-mock mirrors honestly (C5)", "src/electron-mock.ts", [
  "killSwitch: false,",
  'typeof args?.patch?.killSwitch === "boolean"',
]);

// i18n parity: the 4 C5 keys x4 languages + the en hint real contract
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["set.killSwitch", "set.killSwitchHint",
    "connection.killSwitchBlocked", "connection.killSwitchBlockedHint"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
  const enHint = (i18n.match(/"set\.killSwitchHint": "([^"]*)"/) || [])[1] ?? "";
  for (const needle of ["127.0.0.1:9", "blocks immediately", "Quitting the app always restores direct"]) {
    if (!enHint.includes(needle)) { console.error(`FAIL  en killSwitchHint lacks ${JSON.stringify(needle)}`); bad++; }
    else console.log(`PASS  en killSwitchHint states the contract: ${JSON.stringify(needle)}`);
  }
}

/* ---------- C5 docs: README + TESTING-CHECKLIST ---------- */

contentOk("README documents Batch C5 + the honest scope", "electron-app/README.md", [
  "Phase C — Batch C5 (kill switch — fail-closed system proxy)",
  "FORCED to",
  "127.0.0.1:9",
  "quitting the APP always",
  "restores direct access (a portable app must never strand",
  "taskC5-live",
  "proxy-level fail-closing",
]);
contentOk("TESTING-CHECKLIST section 26 carries the C5 manual items", "electron-app/TESTING-CHECKLIST.md", [
  "26. Phase C5 — kill switch (fail-closed system proxy)",
  "the \"Kill switch\" toggle is OFF by default",
  "the F9 audit normalizes the leftover",
  "touched by arming/disarming or by the audit",
]);
contentOk("core pins intact (tracked-limitation trigger file)", "electron-app/electron/core-versions.json",
  ['"xray": "v25.1.1"', '"sing-box": "1.14.0"', '"aether": "1.9.0"']);

/* ---------- C4 regression needles (unchanged by C5) ---------- */

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
  "this.trafficTags = sanitizeTrafficTags(trafficTags);",
  "const upMatchers = trafficTags.map((t) => `>>>${t}>>>traffic>>>uplink`);",
]);
contentOk("README C4 tracked-limitation section intact (C5 must not have touched it)",
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

/* ---------- C3 regression needles (unchanged by C5) ---------- */

contentOk("geo file lifecycle shipped (C3)", "electron-app/electron/geoFiles.ts", [
  "`https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/geoip.dat`",
  "meta-rules-dat/sing/geo/geosite/category-ir.srs",
  "fs.renameSync(tmp, dest);",
]);
contentOk("connect-time geo gate shipped (C3)", "src/utils/connectionActions.ts", [
  "const needed = requiredGeoFiles(state.routingOptions, core);",
  "useStore.getState().setGeoPreparing(true);",
  "useStore.getState().setGeoPreparing(false);",
  "trafficTags: trafficTagsFor(topo, balancerExtras.length),",
]);
contentOk("xray routing builder shipped (C3)", "src/utils/routingOptions.ts", [
  '{ type: "field", outboundTag: "blocked", domain: blockD }',
  "const domainStrategy = needsGeo ? \"IPIfNonMatch\" : \"AsIs\";",
]);

/* ---------- C2 regression needles (unchanged by C5) ---------- */

contentOk("probe config rewrite shipped (C2)", "electron-app/electron/urlTest.ts", [
  "export function rewriteConfigForProbe(configJson: string, port: number): RewrittenConfig {",
  'throw new Error("Aether is not a config-driven core");',
]);
contentAbsent("probe spawns DIRECT: kill switch adds NOTHING to the C2 isolation",
  "electron-app/electron/urlTest.ts",
  ['from "./coreOps"', "stopOtherCore(", "killAllOrphanedCores(", "killSwitch", "setSystemProxy", "clearSystemProxy"]);

/* ---------- C1 regression needles (unchanged by C5) ---------- */

contentOk("standalone trafficHistory ring shipped (C1)", "src/utils/trafficHistory.ts", [
  "export const TRAFFIC_HISTORY_MAX = 120;",
]);
contentOk("TrafficChart rides ONLY the standalone slice (perf contract)", "src/components/TrafficChart.tsx", [
  "useSyncExternalStore(subscribeTrafficHistory, getTrafficHistory)",
]);

/* ---------- D4/D3/D2/Task-13/12/D1 regression needles ---------- */

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
