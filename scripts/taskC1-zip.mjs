#!/usr/bin/env node
/**
 * Phase C1: rebuild download/MEMENTO-electron-migration.zip and run
 * in-archive verification for the Batch-C1 features (live traffic chart
 * via a standalone non-zustand slice + TLS fragment dialer, noises
 * deliberately NOT shipped) AND the full regression pin chain (Task-13/12
 * + D1 + D2 + D3 + D4). Same exclusion rules as every previous phase;
 * binaries are never shipped.
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

// Phase-C1 key files
["src/utils/trafficHistory.ts", "src/components/TrafficChart.tsx",
 "scripts/taskC1-quickcheck.mjs", "scripts/taskC1-fntest.mjs",
 "scripts/taskC1-cfgtest.mjs", "scripts/taskC1-live.mjs",
 "scripts/taskC1-entry.ts", "scripts/taskC1-cfgentry.ts", "scripts/taskC1-i18n.cjs",
 "scripts/taskC1-smoke.mjs", "scripts/taskC1-zip.mjs"].forEach(must);

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

/* ---------- C1 feature needles: traffic chart ---------- */

// standalone slice: bounded ring OUTSIDE zustand, NaN guard, stable snapshots
contentOk("standalone trafficHistory ring shipped (C1)", "src/utils/trafficHistory.ts", [
  "export const TRAFFIC_HISTORY_MAX = 120;",
  "export function pushTrafficSample(down: number, up: number, at = Date.now()): void {",
  "if (!Number.isFinite(down) || !Number.isFinite(up)) return;",
  "export function resetTrafficHistory(): void {",
  "export function subscribeTrafficHistory(listener: () => void): () => void {",
  "export function getTrafficHistory(): TrafficSample[] {",
]);

// chart component: useSyncExternalStore ONLY — the user-mandated perf contract
contentOk("TrafficChart rides ONLY the standalone slice (perf contract)", "src/components/TrafficChart.tsx", [
  "useSyncExternalStore(subscribeTrafficHistory, getTrafficHistory)",
  't("connection.trafficTitle", language)',
  't("connection.trafficWaiting", language)',
  "<polyline",
]);
contentAbsent("TrafficChart: NO zustand/whole-store subscription (App.tsx:61-64 rule)", "src/components/TrafficChart.tsx",
  ["useStore(", "from \"zustand\"", "from '../store'", "from \"../store\""]);

// poll loop wiring: one push per D1 delta + reset on EVERY identity change
contentOk("poll loop pushes samples into the slice (C1)", "src/components/ConnectionManager.tsx", [
  'import { pushTrafficSample, resetTrafficHistory } from "../utils/trafficHistory";',
  "pushTrafficSample(downSpeed, upSpeed, now);",
]);
{
  const cm = zcat("src/components/ConnectionManager.tsx");
  const n = (cm.match(/resetTrafficHistory\(\)/g) || []).length;
  if (n < 2) { console.error(`FAIL  chart reset must fire in BOTH branches (non-connected + connected arm), found ${n}`); bad++; }
  else console.log(`PASS  chart reset fires in both identity-change branches (${n} call sites)`);
}

// mount gate: chart exists ONLY while connected
contentOk("chart mounts ONLY while connected (C1)", "src/components/ConnectionTab.tsx", [
  '{status === "connected" && <TrafficChart language={language} />}',
]);

/* ---------- C1 feature needles: TLS fragment ---------- */

// builder options: dialer tag + TS-overloaded parser + defaults (byte-identical OFF)
contentOk("fragment builder options + parser shipped (C1)", "src/utils/builderOptions.ts", [
  'export const FRAGMENT_DIALER_TAG = "memento-frag-dialer";',
  "export function parseFragmentRange(value: string, allowTlsHello = false): { from: number; to: number } | \"tlshello\" | null {",
  "tlsFragment: false,",
  'tlsFragmentPackets: "tlshello",',
  'tlsFragmentLength: "100-200",',
  'tlsFragmentInterval: "10-20",',
]);

// generator: freedom+dialerProxy recipe, guards, invalid-range => off
contentOk("fragment dialer injection shipped (C1)", "src/utils/v2rayConfig.ts", [
  "const fragDialer = buildFragmentDialer(builderOptions);",
  "const useFragment = !!fragDialer && fragmentApplies(outbound);",
  "dialerProxy: FRAGMENT_DIALER_TAG,",
  "function fragmentApplies(outbound: Record<string, unknown>): boolean {",
  'return ss.security === "tls" || ss.security === "reality";',
  "function buildFragmentDialer(builderOptions: BuilderOptions): Record<string, unknown> | null {",
  "if (!builderOptions.tlsFragment) return null;",
  "if (!packets || !length || !interval) return null;",
  'protocol: "freedom",',
  'domainStrategy: "AsIs",',
  "fragment: {",
]);
contentAbsent("noises honestly NOT shipped (UDP-only dead config in v25.1.1)", "src/utils/v2rayConfig.ts",
  ["noises:", '"noises"']);

// Settings UI: toggle + 3 range fields + amber validation hint
contentOk("fragment UI shipped (C1, Settings tab)", "src/components/SettingsTab.tsx", [
  "checked={options.tlsFragment}",
  "onChange={v => onChange({ tlsFragment: v })}",
  '["tlsFragmentPackets", "builder.fragmentPackets"],',
  '["tlsFragmentLength", "builder.fragmentLength"],',
  '["tlsFragmentInterval", "builder.fragmentInterval"],',
  't("builder.fragmentBad", language)',
]);

// i18n parity: 8 new keys x4 languages
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["connection.trafficTitle", "connection.trafficWaiting", "builder.fragment", "builder.fragmentHint",
    "builder.fragmentPackets", "builder.fragmentLength", "builder.fragmentInterval", "builder.fragmentBad"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
}

// docs: README C1 section + checklist 22 with the real-server DPI mandate
contentOk("README documents Batch C1", "electron-app/README.md", [
  "Phase C — Batch C1",
  "useSyncExternalStore",
  "memento-frag-dialer",
  "silently ignored",
]);
contentOk("TESTING-CHECKLIST section 22 carries the real-server DPI mandate", "electron-app/TESTING-CHECKLIST.md", [
  "22. Phase C1",
  "REAL server over a REAL (censored) path",
  "DPI pass-through can only be proven against a real server",
]);

/* ---------- D4 regression needles (unchanged by C1) ---------- */

contentOk("tray command bus + real quit shipped (D4)", "electron-app/electron/tray.ts", [
  "{ label: L.quit, click: () => app.quit() }",
  'tray.on("click"',
  'tray.on("right-click"',
  "popUpContextMenu",
  "displayBalloon({",
  "noSound: true",
  "closeTrayToastShown",
]);
contentOk("close-to-tray interception + session-end hardening shipped (D4)", "electron-app/electron/main.ts", [
  "let quitting = false;",
  'mainWindow.on("close", (e) => {',
  "if (quitting) return;",
  "!prefs.closeToTray || !trayExists()",
  "e.preventDefault();",
  'mainWindow.on("session-end", () => {',
  'app.on("before-quit", () => {',
  'process.on("exit", cleanupOnce);',
]);
contentOk("appPrefs D4 fields + sanitizer shipped", "electron-app/electron/appPrefs.ts", [
  "closeToTray: boolean;",
  "closeTrayToastShown: boolean;",
  'language: "en",',
  "export function sanitizePrefsPatch",
  "export function normalizeLanguage",
]);
contentOk("ipc prefs + tray handlers shipped (D4)", "electron-app/electron/ipc.ts", [
  "sanitizePrefsPatch(args?.patch)",
  "prefsChain = prefsChain.then",
  '"tray_status_set"',
  "updateTrayStatus",
]);
{
  const preload = zcat("electron-app/electron/preload.ts");
  const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
  if (allow.length !== 20 || !allow.includes("tray_status_set")) {
    console.error(`FAIL  preload allowlist = ${allow.length} commands (need 20)`); bad++;
  } else console.log("PASS  preload allowlist ships 20 commands (C1 added none — honest)");
}
contentOk("Settings tab single home intact (D4)", "src/components/SettingsTab.tsx", [
  'titleKey="tab.settings"',
  't("set.closeToTray", language)',
  "patchPrefs({ closeToTray: v })",
  "BuilderOptionsPanel",
]);
contentAbsent("ConfigsTab: panels migrated AWAY (negative pins, D4)", "src/components/ConfigsTab.tsx",
  ["AppOptionsPanel", "BuilderOptionsPanel", "BuilderToggle"]);
contentOk("tray status push shipped (D4)", "src/components/ConnectionManager.tsx", [
  'tauriInvoke("tray_status_set", { connected })',
]);
contentOk("language sync to main shipped (D4)", "src/store.ts", [
  'invoke("app_prefs_set", { patch: { language: lang } })',
]);

/* ---------- D3 regression needles ---------- */
contentOk("autostart portable fix shipped (D3)", "electron-app/electron/appPrefs.ts", [
  "process.env.PORTABLE_EXECUTABLE_FILE",
  'const AUTOSTART_ARGS = ["--hidden"]',
  "supported: app.isPackaged",
]);
contentOk("global hotkeys shipped (D3)", "electron-app/electron/appPrefs.ts", [
  'export const HOTKEY_SHOW_HIDE = "Control+Alt+V"',
  'export const HOTKEY_CONNECT = "Control+Alt+C"',
  "globalShortcut.unregisterAll()",
]);
contentOk("qrShare module shipped (D3)", "src/utils/qrShare.ts", [
  'import QRCode from "qrcode"',
  'import jsQR from "jsqr"',
  'errorCorrectionLevel: "M"',
]);
contentOk("QR import shipped (D3)", "src/components/ImportTab.tsx", [
  "handleQrImport", 'accept="image/*"',
]);
contentOk("backup allowlist shipped (D3)", "src/utils/appBackup.ts", [
  'export const BACKUP_FORMAT = "memento-backup"',
  "export const BACKUP_VERSION = 1",
  "for (const key of BACKUP_KEYS) {",
]);
{
  const ab = zcat("src/utils/appBackup.ts");
  const keys = [...ab.matchAll(/"([a-z0-9-]+)",/g)].map(m => m[1]);
  const named = keys.filter(k => k.startsWith("memento-") || k.startsWith("v2ray-"));
  if (named.length !== 10) { console.error(`FAIL  BACKUP_KEYS = ${named.length} named keys (need 10)`); bad++; }
  else console.log("PASS  BACKUP_KEYS allowlist = exactly 10 named keys");
}
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["tab.settings", "set.closeToTray", "set.closeToTrayHint"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages, D4)`);
  }
  if (/starts minimized|کمینه‌شده|以最小化方式|مصغَّراً/.test(i18n)) {
    console.error("FAIL  old 'starts minimized' autostart wording still present"); bad++;
  } else console.log("PASS  autostart hint says hidden-in-tray (old wording purged, D3/D4)");
}

/* ---------- D2 regression needles ---------- */
contentOk("userinfo capture shipped (D2)", "src/utils/subscription.ts", [
  "export interface SubscriptionUserInfo",
  "export function parseSubscriptionUserInfo",
  'res.headers.get("subscription-userinfo")',
]);
contentOk("builder options + allowLan/mux gates shipped (D2)", "src/utils/v2rayConfig.ts", [
  'builderOptions.allowLan ? "0.0.0.0" : "127.0.0.1"',
  "if (!builderOptions.muxEnabled || flowEmitted) return null;",
  "Phase D2 review fix: mux applies to trojan too",
]);
contentOk("usage carriers shipped (D2)", "src/components/ConfigsTab.tsx", [
  "SubscriptionUsageBar",
  "fetchSubscriptionDetailed(group.subscriptionUrl)",
]);
contentOk("allowLan warning shipped (D2, SettingsTab home)", "src/components/SettingsTab.tsx", [
  "options.allowLan && (",
  "border-amber-500/30 bg-amber-500/10",
]);

/* ---------- Task-13/12/D1 regression needles ---------- */
contentOk("socks parser shipped", "src/store.ts",
  ["function parseSocks(", "username?: string", "tryBase64Decode("]);
contentOk("socks outbound builder shipped", "src/utils/v2rayConfig.ts",
  ["buildSocksOutbound", 'case "socks":']);
contentOk("# header filter shipped", "src/utils/subscription.ts",
  ["!l.startsWith(\"#\")"]);
contentOk("core pins intact", "electron-app/electron/core-versions.json",
  ['"xray": "v25.1.1"', '"sing-box": "1.14.0"', '"aether": "1.9.0"']);
contentOk("net_check handler shipped (D1)", "electron-app/electron/ipc.ts",
  ['"net_check"', "socks5://127.0.0.1:", "session.fromPartition("]);
contentOk("speed + Connect Best + IP card shipped (D1)", "src/components/ConnectionTab.tsx",
  ["fmtSpeed(connDownSpeed)", "ipcheck.title"]);
{
  const bm = zcat("src/components/BrokersModal.tsx");
  const urls = bm.match(/https:\/\/raw\.githubusercontent\.com[^"]+/g) || [];
  if (urls.length !== 40) { console.error(`FAIL  expected 40 broker URLs in zip, got ${urls.length}`); bad++; }
  else console.log("PASS  BrokersModal ships all 40 URLs");
}

if (bad > 0) { console.error(`ZIP VERIFICATION FAILED: ${bad} problem(s)`); process.exit(1); }
console.log("zip verification complete — ALL CHECKS PASSED");
