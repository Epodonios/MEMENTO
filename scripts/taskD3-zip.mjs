#!/usr/bin/env node
/**
 * Phase D3: rebuild download/MEMENTO-electron-migration.zip and run
 * in-archive verification for ALL Batch-D3 features (autostart incl. the
 * review fixes: portable-exe path registration + honest read-back + wording
 * purge, global hotkeys, QR in/out, backup/restore) AND the full
 * Task-13/12/D1/D2 regression pins in one gate. Same exclusion rules as
 * every previous phase. Real core BINARIES are never shipped in the source
 * zip — resources/ README files document the pinned downloads + hashes.
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

// Phase-D3 key files
["src/utils/appBackup.ts", "src/utils/qrShare.ts", "src/components/QrModal.tsx",
 "src/components/ImportTab.tsx", "src/components/ConfigsTab.tsx",
 "electron-app/electron/appPrefs.ts",
 "scripts/taskD3-quickcheck.mjs", "scripts/taskD3-fntest.mjs", "scripts/taskD3-entry.ts",
 "scripts/taskD3-fnentry.ts", "scripts/taskD3-i18n.cjs",
 "scripts/taskD3-smoke.mjs", "scripts/taskD3-zip.mjs"].forEach(must);

const zcat = (f) => execFileSync("unzip", ["-p", OUT, f], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const contentOk = (name, file, needles) => {
  const body = zcat(file);
  for (const n of needles) {
    if (!body.includes(n)) { console.error(`FAIL  ${name}: ${file} lacks ${JSON.stringify(n.slice(0, 40))}`); bad++; return; }
  }
  console.log(`PASS  ${name} (${needles.length} needles in ${file})`);
};

/* ---------- D3 feature needles ---------- */

// item 2: autostart — review fixes are the gates
contentOk("autostart portable fix shipped", "electron-app/electron/appPrefs.ts", [
  "process.env.PORTABLE_EXECUTABLE_FILE",
  "app.getLoginItemSettings({ path: p, args: AUTOSTART_ARGS })",
  "{ path: p }",
  "const AUTOSTART_ARGS = [\"--hidden\"]",
  "supported: app.isPackaged",
  "TRUE for the packaged app INCLUDING the portable exe",
]);
contentOk("autostart honest wording shipped (4 languages)", "src/i18n.ts", [
  "Works with the portable exe too",
  "toggle this off and on once to re-register the new path",
  "(portable exe included)",
  "با exe پرتابل هم کار می‌کند",
  "پکیج‌شده",
  "便携版 exe 同样支持",
  "（含便携版 exe）",
  "يعمل مع exe المحمول أيضاً",
  "بما في ذلك exe المحمول",
]);
{
  const i18n = zcat("src/i18n.ts");
  if (/installed|نصب‌شده|المثبتة|安装/.test(i18n)) { console.error("FAIL  'installed build' wording still present in i18n"); bad++; }
  else console.log("PASS  'installed build' claim purged from i18n");
}

// item 4: hotkeys
contentOk("global hotkeys shipped", "electron-app/electron/appPrefs.ts", [
  'export const HOTKEY_SHOW_HIDE = "Control+Alt+V"',
  'export const HOTKEY_CONNECT = "Control+Alt+C"',
  "globalShortcut.unregisterAll()",
  "memento-app-prefs.json",
]);

// item 5: QR in/out
contentOk("qrShare module shipped", "src/utils/qrShare.ts", [
  'import QRCode from "qrcode"',
  'import jsQR from "jsqr"',
  'errorCorrectionLevel: "M"',
  "inversionAttempts: \"attemptBoth\"",
  ".slice(0, 2000)",
]);
contentOk("QR UI wired on both tabs", "src/components/ConfigsTab.tsx", [
  "onQr={(c) => setQrModal({ link: c.raw",
  "<QrModal link={qrModal.link}",
]);
contentOk("QR import shipped", "src/components/ImportTab.tsx", [
  "handleQrImport", 'accept="image/*"',
]);

// item 7: backup — ALLOWLIST is the gate
contentOk("backup allowlist shipped", "src/utils/appBackup.ts", [
  'export const BACKUP_FORMAT = "memento-backup"',
  "export const BACKUP_VERSION = 1",
  '"memento-configs"',
  '"memento-builder-options"',
  "for (const key of BACKUP_KEYS) {",
  'typeof v === "string" && v.length <= 32 * 1024 * 1024',
  "if (v === undefined) continue;",
]);
{
  const ab = zcat("src/utils/appBackup.ts");
  const keys = [...ab.matchAll(/"([a-z0-9-]+)",/g)].map(m => m[1]);
  const named = keys.filter(k => k.startsWith("memento-") || k.startsWith("v2ray-"));
  if (named.length !== 10) { console.error(`FAIL  BACKUP_KEYS = ${named.length} named keys (need 10)`); bad++; }
  else console.log("PASS  BACKUP_KEYS allowlist = exactly 10 named keys");
}
contentOk("backup UI shipped", "src/components/ConfigsTab.tsx", [
  "downloadBackup(collectBackup())",
  "applyBackup(parsed)",
  "window.location.reload()",
]);

// app options panel + IPC surface
contentOk("AppOptionsPanel + honest hotkey hint shipped", "src/components/ConfigsTab.tsx", [
  't("appopt.title", language)',
  "appopt.hotkeyStolen",
]);
{
  const preload = zcat("electron-app/electron/preload.ts");
  const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
  if (allow.length !== 19 || !allow.includes("app_prefs_get") || !allow.includes("app_prefs_set") || !allow.includes("autostart_set")) {
    console.error(`FAIL  preload allowlist = ${allow.length} commands (need 19 incl. the 3 prefs handlers)`); bad++;
  } else console.log("PASS  preload allowlist ships 19 commands incl. app_prefs_get/set + autostart_set");
}
contentOk("ipc prefs handlers shipped", "electron-app/electron/ipc.ts", [
  '"app_prefs_get"', '"app_prefs_set"', '"autostart_set"', "args?.enabled === true",
]);

// i18n key parity x4 for the D3 batch
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["configs.qr", "appopt.autostart", "appopt.autostartHint", "appopt.autostartUnsupported", "appopt.backupImportConfirm", "qr.savePng"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
}

// docs
contentOk("README documents Batch D3 + portable autostart", "electron-app/README.md", [
  "Batch D3",
  "PORTABLE_EXECUTABLE_FILE",
  "toggle the option off/on once to re-register",
  "maps to START",
]);
contentOk("TESTING-CHECKLIST has section 20 + portable items", "electron-app/TESTING-CHECKLIST.md", [
  "20. Phase D3",
  "HKCU Run entry points at the PORTABLE exe path",
  "same path+args that were registered",
]);

/* ---------- Task-13/12/D1/D2 regression needles ---------- */
contentOk("socks parser shipped", "src/store.ts",
  ["function parseSocks(", "username?: string", "tryBase64Decode("]);
contentOk("socks outbound builder shipped", "src/utils/v2rayConfig.ts",
  ["buildSocksOutbound", 'case "socks":']);
contentOk("# header filter shipped", "src/utils/subscription.ts",
  ["skip \"#\"-prefixed subscription header lines", "!l.startsWith(\"#\")"]);
contentOk("D2 trojan mux shipped", "src/utils/v2rayConfig.ts",
  ["Phase D2 review fix: mux applies to trojan too"]);
contentOk("D2 allowLan warning shipped", "src/components/ConfigsTab.tsx", [
  "options.allowLan && (",
  "border-amber-500/30 bg-amber-500/10",
]);
contentOk("core pins intact", "electron-app/electron/core-versions.json",
  ['"xray": "v25.1.1"', '"sing-box": "1.14.0"', '"aether": "1.9.0"']);
contentOk("net_check handler shipped (D1)", "electron-app/electron/ipc.ts",
  ['"net_check"', "socks5://127.0.0.1:", "session.fromPartition("]);
contentOk("speed + Connect Best + IP card shipped (D1)", "src/components/ConnectionTab.tsx",
  ["fmtSpeed(connDownSpeed)", "ipcheck.title"]);
contentOk("userinfo capture shipped", "src/utils/subscription.ts",
  ["export function parseSubscriptionUserInfo", 'res.headers.get("subscription-userinfo")']);

if (bad > 0) { console.error(`ZIP VERIFICATION FAILED: ${bad} problem(s)`); process.exit(1); }
console.log("zip verification complete — ALL CHECKS PASSED");
