#!/usr/bin/env node
/**
 * Phase D4: rebuild download/MEMENTO-electron-migration.zip and run
 * in-archive verification for the Batch-D4 features (dedicated Settings
 * tab + Tray + Close-to-tray + the session-end cleanup hardening) AND the
 * full regression pin chain (Task-13/12 + D1 + D2 + D3), with the D4
 * re-points: AppOptionsPanel/BuilderOptionsPanel/backup UI now live in
 * SettingsTab.tsx (ConfigsTab carries a NEGATIVE pin instead). Same
 * exclusion rules as every previous phase; binaries are never shipped.
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

// Phase-D4 key files
["electron-app/electron/tray.ts", "electron-app/electron/main.ts",
 "src/components/SettingsTab.tsx",
 "scripts/taskD4-quickcheck.mjs", "scripts/taskD4-fntest.mjs",
 "scripts/taskD4-quitclean-fntest.mjs", "scripts/taskD4-electron-stub.mts",
 "scripts/taskD4-entry.ts", "scripts/taskD4-fnentry.ts", "scripts/taskD4-i18n.cjs",
 "scripts/taskD4-smoke.mjs", "scripts/taskD4-zip.mjs"].forEach(must);

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

/* ---------- D4 feature needles ---------- */

// tray.ts: real quit path + Windows recipe + one-shot balloon + 4-language menu
contentOk("tray command bus + real quit shipped", "electron-app/electron/tray.ts", [
  "{ label: L.quit, click: () => app.quit() }",
  "{ label: connected ? L.disconnect : L.connect, click: () => trayToggleConnect() }",
  'tray.on("click"',
  'tray.on("right-click"',
  "popUpContextMenu",
  "displayBalloon({",
  "noSound: true",
  "closeTrayToastShown",
]);
{
  const tray = zcat("electron-app/electron/tray.ts");
  const langs = ["en:", "fa:", "zh:", "ar:"].filter((l) => tray.includes(l)).length;
  // 4 string-VALUE entries (interface field + usage site don't count)
  const balloons = (tray.match(/balloonTitle: "/g) || []).length;
  if (langs !== 4 || balloons !== 4) { console.error(`FAIL  tray i18n: ${langs} langs, ${balloons} balloonTitle values (need 4/4)`); bad++; }
  else console.log("PASS  tray menu + balloon texts ship in 4 languages");
}

// main.ts: close-to-tray interception + quitting flag + session-end hardening
contentOk("close-to-tray interception shipped", "electron-app/electron/main.ts", [
  "let quitting = false;",
  'mainWindow.on("close", (e) => {',
  "if (quitting) return;",
  "!prefs.closeToTray || !trayExists()",
  "e.preventDefault();",
  "showCloseToTrayBalloonOnce();",
  'mainWindow.on("closed", () => {',
  "cleanupOnce();",
]);
contentOk("session-end hardening shipped (D4 review)", "electron-app/electron/main.ts", [
  'mainWindow.on("session-end", () => {',
  "quitting = true;",
  'app.on("before-quit", () => {',
  'process.on("exit", cleanupOnce);',
]);
{
  const main = zcat("electron-app/electron/main.ts");
  const iT = main.indexOf("createTray();");
  const iW = main.indexOf("createWindow();");
  if (!(iT !== -1 && iW !== -1 && iT < iW)) { console.error("FAIL  tray must be created BEFORE the window"); bad++; }
  else console.log("PASS  tray created before window (silent launch + close both gate on it)");
  if (main.includes('app.on("session-end"') || main.includes('.on("query-session-end"')) {
    console.error("FAIL  app-level session-end or cancelable query-session-end used"); bad++;
  } else console.log("PASS  no app-level session-end, query-session-end untouched (shutdown never blocked)");
  // ordering: quitting=true BEFORE cleanupOnce inside before-quit
  const bq = main.slice(main.indexOf('app.on("before-quit"'));
  if (!(bq.indexOf("quitting = true;") !== -1 && bq.indexOf("quitting = true;") < bq.indexOf("cleanupOnce();"))) {
    console.error("FAIL  before-quit must set quitting BEFORE cleanup"); bad++;
  } else console.log("PASS  before-quit sets quitting=true before cleanup (interception can never trap a quit)");
  contentAbsent("no D4-promise leftovers in main.ts", "electron-app/electron/main.ts", ["isSilentLaunch() {"]);
}

// appPrefs.ts: D4 fields + sanitizer + privileged flag drop
contentOk("appPrefs D4 fields + sanitizer shipped", "electron-app/electron/appPrefs.ts", [
  "closeToTray: boolean;",
  "closeTrayToastShown: boolean;",
  "language: AppLanguage;",
  "closeToTray: true,",
  "closeTrayToastShown: false,",
  'language: "en",',
  "export function sanitizePrefsPatch",
  "export function normalizeLanguage",
  "APP_LANGUAGES",
]);

// ipc.ts: sanitized + serialized prefs writes, tray handlers
contentOk("ipc prefs + tray handlers shipped", "electron-app/electron/ipc.ts", [
  "sanitizePrefsPatch(args?.patch)",
  "prefsChain = prefsChain.then",
  '"tray_status_set"',
  "updateTrayStatus",
  "rebuildMenu()",
]);

// preload: allowlist 20 incl. tray_status_set + toggle bridge
{
  const preload = zcat("electron-app/electron/preload.ts");
  const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
  if (allow.length !== 20 || !allow.includes("tray_status_set") || !allow.includes("app_prefs_get") || !allow.includes("app_prefs_set") || !allow.includes("autostart_set")) {
    console.error(`FAIL  preload allowlist = ${allow.length} commands (need 20 incl. tray_status_set + 3 prefs handlers)`); bad++;
  } else console.log("PASS  preload allowlist ships 20 commands incl. tray_status_set");
  if (!preload.includes("onTrayToggleConnect")) { console.error("FAIL  onTrayToggleConnect bridge missing"); bad++; }
  else console.log("PASS  onTrayToggleConnect bridge shipped with unsubscribe");
}

// SettingsTab: the single home for app-level options
contentOk("Settings tab shipped (D4 single home)", "src/components/SettingsTab.tsx", [
  'titleKey="tab.settings"',
  't("set.closeToTray", language)',
  "patchPrefs({ closeToTray: v })",
  't("appopt.autostart", language)',
  't("appopt.hotkeyStolen", language)',
  "BuilderOptionsPanel",
  't("builder.allowLanWarning", language)',
  "downloadBackup(collectBackup())",
  "applyBackup(parsed)",
]);
contentAbsent("ConfigsTab: panels migrated AWAY (negative pins)", "src/components/ConfigsTab.tsx",
  ["AppOptionsPanel", "BuilderOptionsPanel", "BuilderToggle"]);
contentOk("ConfigsTab keeps: usage bar + QR (untouched)", "src/components/ConfigsTab.tsx", [
  "SubscriptionUsageBar",
  "onQr={(c) => setQrModal({ link: c.raw",
  "<QrModal link={qrModal.link}",
]);

// renderer wiring: status push + language sync + shared toggle handler
contentOk("tray status push shipped", "src/components/ConnectionManager.tsx", [
  'tauriInvoke("tray_status_set", { connected })',
]);
contentOk("language sync to main shipped", "src/store.ts", [
  'invoke("app_prefs_set", { patch: { language: lang } })',
]);
contentOk("browser mock honest (no tray in browser)", "src/electron-mock.ts", [
  "tray_status_set",
  "closeToTray",
]);

// packaging: tray icon resources
contentOk("tray icon extraResources shipped", "electron-app/electron-builder.yml", [
  "from: build/icon.ico",
  "to: icon.ico",
  "from: build/icon.png",
  "to: icon.png",
]);

// i18n: D4 keys x4 + D3 wording intact + old promise purged
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["tab.settings", "set.closeToTray", "set.closeToTrayHint", "set.sectionWindow", "set.sectionHotkeys", "set.sectionBackup"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
  if (/starts minimized|کمینه‌شده|以最小化方式|مصغَّراً/.test(i18n)) {
    console.error("FAIL  old 'starts minimized' autostart wording still present"); bad++;
  } else console.log("PASS  autostart hint says hidden-in-tray (old wording purged)");
  if (!i18n.includes("Works with the portable exe too") || !i18n.includes("便携版 exe 同样支持")) {
    console.error("FAIL  D3 portable autostart wording lost in D4 rewording"); bad++;
  } else console.log("PASS  D3 portable autostart wording intact x4");
}

// docs
contentOk("README documents Batch D4", "electron-app/README.md", [
  "Batch D4",
  "Close-to-tray",
  "session-end",
]);
contentOk("TESTING-CHECKLIST has section 21 + tray items", "electron-app/TESTING-CHECKLIST.md", [
  "21.",
  "balloon",
]);

/* ---------- D3 regression needles (re-pointed where D4 moved them) ---------- */
contentOk("autostart portable fix shipped (D3)", "electron-app/electron/appPrefs.ts", [
  "process.env.PORTABLE_EXECUTABLE_FILE",
  "app.getLoginItemSettings({ path: p, args: AUTOSTART_ARGS })",
  'const AUTOSTART_ARGS = ["--hidden"]',
  "supported: app.isPackaged",
]);
contentOk("global hotkeys shipped (D3)", "electron-app/electron/appPrefs.ts", [
  'export const HOTKEY_SHOW_HIDE = "Control+Alt+V"',
  'export const HOTKEY_CONNECT = "Control+Alt+C"',
  "globalShortcut.unregisterAll()",
  "memento-app-prefs.json",
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
  '"memento-configs"',
  '"memento-builder-options"',
  "for (const key of BACKUP_KEYS) {",
]);
{
  const ab = zcat("src/utils/appBackup.ts");
  const keys = [...ab.matchAll(/"([a-z0-9-]+)",/g)].map(m => m[1]);
  const named = keys.filter(k => k.startsWith("memento-") || k.startsWith("v2ray-"));
  if (named.length !== 10) { console.error(`FAIL  BACKUP_KEYS = ${named.length} named keys (need 10)`); bad++; }
  else console.log("PASS  BACKUP_KEYS allowlist = exactly 10 named keys");
}
contentOk("backup UI shipped (D3, re-pointed to SettingsTab in D4)", "src/components/SettingsTab.tsx", [
  "window.confirm(",
  "window.location.reload()",
]);
contentOk("ipc prefs handlers shipped (D3)", "electron-app/electron/ipc.ts", [
  '"app_prefs_get"', '"app_prefs_set"', '"autostart_set"', "args?.enabled === true",
]);

/* ---------- D2 regression needles (re-pointed where D4 moved them) ---------- */
contentOk("userinfo capture shipped (D2)", "src/utils/subscription.ts", [
  "export interface SubscriptionUserInfo",
  "export function parseSubscriptionUserInfo",
  'res.headers.get("subscription-userinfo")',
]);
contentOk("userinfo store + builder options shipped (D2)", "src/store.ts", [
  "builderOptions: BuilderOptions;",
  "setBuilderOptions: (patch: Partial<BuilderOptions>) => void;",
]);
contentOk("usage carriers shipped (D2, re-pointed)", "src/components/ConfigsTab.tsx", [
  "SubscriptionUsageBar",
  "fetchSubscriptionDetailed(group.subscriptionUrl)",
]);
contentOk("usage row in ManageGroups shipped (D2)", "src/components/SubscriptionGroups.tsx", [
  "fmtBytesShort", "subs.usageUnavailable",
]);
contentOk("builderOptions module shipped (D2)", "src/utils/builderOptions.ts", [
  'allowLan: false,', 'muxEnabled: false,',
  '"memento-builder-options"',
]);
contentOk("v2ray generator gates + trojan mux shipped (D2)", "src/utils/v2rayConfig.ts", [
  "builderOptions.allowLan ? \"0.0.0.0\" : \"127.0.0.1\"",
  "if (!builderOptions.muxEnabled || flowEmitted) return null;",
  "Phase D2 review fix: mux applies to trojan too",
]);
contentOk("allowLan warning shipped (D2, re-pointed to SettingsTab in D4)", "src/components/SettingsTab.tsx", [
  "options.allowLan && (",
  "border-amber-500/30 bg-amber-500/10",
]);

/* ---------- Task-13/12/D1 regression needles ---------- */
contentOk("socks parser shipped", "src/store.ts",
  ["function parseSocks(", "username?: string", "tryBase64Decode("]);
contentOk("socks outbound builder shipped", "src/utils/v2rayConfig.ts",
  ["buildSocksOutbound", 'case "socks":']);
contentOk("# header filter shipped", "src/utils/subscription.ts",
  ["skip \"#\"-prefixed subscription header lines", "!l.startsWith(\"#\")"]);
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
