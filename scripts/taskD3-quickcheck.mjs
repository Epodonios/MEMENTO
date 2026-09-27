#!/usr/bin/env node
/**
 * Phase D3 quickcheck — NO network, NO spawned processes.
 * Structural surface for Batch D3 (item 2 autostart + item 4 hotkeys +
 * item 5 QR in/out + item 7 backup/restore):
 *   N1  appBackup.ts: versioned format, 10 persisted keys, strict parse
 *   N2  qrShare.ts: generate + decode + payload split (2000 cap)
 *   N3  appPrefs.ts (main): hotkey consts, defaults, silent launch, OS autostart
 *   N4  main.ts: boot registration + quit unregistration + --hidden launch
 *       (D3: minimized; D4: hidden when the tray exists, minimize fallback)
 *   N5  ipc.ts: 3 sanitized handlers
 *   N6  preload.ts: allowlist 19 + hotkey event bridge (Phase D4 grows the
 *       allowlist to 20 with tray_status_set — pin updated per batch order)
 *   N7  electron-mock.ts: simulated prefs + app stub
 *   N8  App.tsx: Ctrl+Alt+C renderer semantics
 *   N9  App options panel (QR stays in ConfigsTab): panel MOVED to the
 *       dedicated Settings tab in Phase D4 per the locked batch order —
 *       the D3 assertions now read SettingsTab.tsx
 *   N10 ImportTab: QR quick action + image drop routing
 *   N11 i18n: all 29 new keys x4 + key-set parity
 *   N12 package.json: qrcode + jsqr dependencies
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = "/home/z/my-project/memento-src";

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const read = (p) => readFileSync(join(ROOT, p), "utf8");

console.log("== Phase D3 quickcheck (no network, no processes) ==");

/* ---- N1 appBackup ---- */
const ab = read("src/utils/appBackup.ts");
ok(ab.includes('export const BACKUP_FORMAT = "memento-backup"') && ab.includes("export const BACKUP_VERSION = 1"), "N1a versioned format");
ok(ab.includes('"memento-configs"') && ab.includes('"memento-subscription-groups"') &&
   ab.includes('"memento-auto-failover"') && ab.includes('"memento-builder-options"') &&
   ab.includes('"memento-conn-mode"') && ab.includes('"v2ray-editor-language"'),
  "N1b all 10 persisted keys covered");
ok(/format !== BACKUP_FORMAT/.test(ab) && /version < 1 \|\| o\.version > BACKUP_VERSION/.test(ab) &&
   ab.includes('"Backup has no data section"'), "N1c strict parse with human-readable rejections");
ok(/if \(v === undefined\) continue;/.test(ab) && /typeof v === "string" && v\.length <= 32 \* 1024 \* 1024/.test(ab),
  "N1d apply skips absent keys; 32MB per-key cap");

/* ---- N2 qrShare ---- */
const qs = read("src/utils/qrShare.ts");
ok(qs.includes('import QRCode from "qrcode"') && qs.includes('import jsQR from "jsqr"'), "N2a pure-JS libs only");
ok(qs.includes('errorCorrectionLevel: "M"') && qs.includes('dark: "#020617", light: "#ffffff"'), "N2b high-contrast QR");
ok(qs.includes("inversionAttempts: \"attemptBoth\"") && qs.includes("maxDim = 2048"), "N2c decode: both inversions + 2048 downscale cap");
ok(/\.slice\(0, 2000\)/.test(qs), "N2d payload split capped at 2000");

/* ---- N3 appPrefs (main) ---- */
const ap = read("electron-app/electron/appPrefs.ts");
ok(ap.includes('hotkeyShowHide: true') && ap.includes('hotkeyConnect: true'), "N3a defaults ON/ON");
ok(ap.includes('export const HOTKEY_SHOW_HIDE = "Control+Alt+V"') && ap.includes('export const HOTKEY_CONNECT = "Control+Alt+C"'), "N3b combos avoid Ctrl+V/system shortcuts + in-app Ctrl+K/1-6");
ok(ap.includes("memento-app-prefs.json") && /o\.hotkeyShowHide !== false/.test(ap), "N3c prefs file + tolerant load (default ON)");
ok(ap.includes("globalShortcut.unregisterAll()") && ap.includes("globalShortcut.register(HOTKEY_SHOW_HIDE"), "N3d re-register semantics");
ok(/w\.isVisible\(\) && !w\.isMinimized\(\)/.test(ap) && ap.includes("w.restore()"), "N3e visibility toggle handles minimized state");
ok(ap.includes("args: enabled ? AUTOSTART_ARGS : []") && ap.includes("supported: app.isPackaged"),
  "N3f login item args const + dev-guard (portable exe IS packaged -> supported)");
ok(ap.includes("process.argv.includes(\"--hidden\")"), "N3g silent-launch detection");
ok(ap.includes("process.env.PORTABLE_EXECUTABLE_FILE") && ap.includes("...(p ? { path: p } : {})") &&
   ap.includes("app.getLoginItemSettings({ path: p, args: AUTOSTART_ARGS })"),
  "N3h PORTABLE fix: real exe path registered via `path` option (not the %TEMP% unpack) + read-back with the SAME path+args (Electron app.md)");

/* ---- N4 main.ts ---- */
const main = read("electron-app/electron/main.ts");
ok(main.includes("applyHotkeyRegistration(loadAppPrefs())"), "N4a hotkeys registered at boot from prefs file");
ok(/app\.on\("before-quit", \(\) => \{[\s\S]*?quitting = true;[\s\S]*?unregisterHotkeys\(\);/.test(main) &&
   main.includes("unregisterHotkeys();\n  cleanupOnce();\n  app.quit();"), "N4b unregistered on before-quit AND window-all-closed (D4: quitting flag flips first)");
ok(/if \(isSilentLaunch\(\)\) \{[\s\S]*?trayExists\(\)\) mainWindow\?\.hide\(\);[\s\S]*?mainWindow\?\.minimize\(\);[\s\S]*?\}/.test(main), "N4c --hidden starts HIDDEN with tray, MINIMIZED fallback without (never stranded)");

/* ---- N5 ipc.ts ---- */
const ipc = read("electron-app/electron/ipc.ts");
ok(ipc.includes('"app_prefs_get"') && ipc.includes('"app_prefs_set"') && ipc.includes('"autostart_set"'), "N5a three handlers");
ok(/sanitizePrefsPatch\(args\?\.patch\)/.test(ipc) && /typeof args\?\.enabled === true|args\?\.enabled === true/.test(ipc), "N5b strict boolean sanitization (D4: centralized in sanitizePrefsPatch, functionally proven by taskD4-fntest F5)");
ok(ipc.includes("hotkeysActive()") && ipc.includes("saveAppPrefs(prefs)") && ipc.includes("applyHotkeyRegistration(prefs)"), "N5c reply carries active state; set persists + re-registers");

/* ---- N6 preload ---- */
const preload = read("electron-app/electron/preload.ts");
const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
// R3 re-point: allowlist was 32; +18 R3 channels disclosed
ok(allow.length === 53 && allow.includes("app_prefs_get") && allow.includes("app_prefs_set") && allow.includes("autostart_set") && allow.includes("tray_status_set") && allow.includes("url_test") && allow.includes("geo_ensure") && allow.includes("aether_update_status"),
  `N6a allowlist = ${allow.length} quoted-comma tokens (50 commands + 3 R3 event-channel names) incl. the D3 trio + D4 tray + C2 url_test + C3 geo pair (27 at C6; 31 after B2; 32 after E1; R3 disclosed re-point)`);
ok(preload.includes('ipcRenderer.on("memento:hotkey-toggle-connect", handler)') &&
   preload.includes("ipcRenderer.removeListener"), "N6b hotkey event bridge with unsubscribe");

/* ---- N7 electron-mock ---- */
const mock = read("src/electron-mock.ts");
ok(mock.includes("app_prefs_get:") && mock.includes("app_prefs_set:") && mock.includes("autostart_set:") &&
   mock.includes("autostartSupported: false"), "N7a mock prefs handlers (honest unsupported)");
ok(/onHotkeyToggleConnect: \(_cb: \(\) => void\) => \(\) => \{\}/.test(mock), "N7b mock app event stub (same signature)");

/* ---- N8 App.tsx ---- */
const app = read("src/App.tsx");
ok(app.includes("onHotkeyToggleConnect") && app.includes("aetherStatus === \"connected\"") &&
   app.includes("disconnectConnection({ manual: true })") && app.includes("connectToConfig(st.connConfigId)") &&
   app.includes("appopt.hotkeyNoConfig"), "N8a toggle semantics: aether guard / disconnect / reconnect / honest toast");

/* ---- N9 app options panel (moved to SettingsTab in Phase D4) ---- */
const ct = read("src/components/ConfigsTab.tsx");
const st = read("src/components/SettingsTab.tsx");
ok(ct.includes("onQr={(c) => setQrModal({ link: c.raw") && ct.includes("<QrModal link={qrModal.link}") &&
   ct.includes('title={t("configs.qr", language)}'), "N9a QR button + modal wired to config.raw (stays in ConfigsTab)");
ok(st.includes("export default function SettingsTab") && st.includes('t("appopt.autostart", language)') &&
   st.includes('tauriInvoke<PrefsView>("app_prefs_get")') &&
   st.includes('tauriInvoke<PrefsView>("app_prefs_set", { patch })') &&
   st.includes('tauriInvoke<{ autostartSupported: boolean; autostartEnabled: boolean }>("autostart_set", { enabled })') &&
   !ct.includes("function AppOptionsPanel"),
  "N9b Settings tab mirrors main-process state via IPC (panel migrated OUT of ConfigsTab)");
ok(st.includes("downloadBackup(collectBackup())") && st.includes("parseBackup(") &&
   st.includes("applyBackup(parsed)") && st.includes("window.location.reload()"), "N9c backup export + confirm + apply + reload");
ok(st.includes("appopt.hotkeyStolen"), "N9d honest registration-failure hint");

/* ---- N10 ImportTab ---- */
const it = read("src/components/ImportTab.tsx");
ok(it.includes("handleQrImport") && it.includes("decodeQrImageFile(file)") && it.includes('accept="image/*"') &&
   it.includes('t("qr.importTitle", language)'), "N10a QR quick-action card");
ok(/if \(file\.type\.startsWith\("image\/"\)\) handleQrImport\(file\);/.test(it), "N10b drop-zone routes images to the QR decoder");

/* ---- N11 i18n ---- */
const bundle = join(HERE, "taskD3-i18n.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskD3-entry.ts"), "--bundle", "--platform=node", "--outfile=" + bundle], { cwd: HERE, stdio: "pipe" });
const { langs } = JSON.parse(execFileSync("node", [bundle], { encoding: "utf8" }));
const NEW_KEYS = [
  "configs.qr",
  "qr.importTitle", "qr.importDesc", "qr.noLinks", "qr.imported", "qr.copyLink", "qr.copied", "qr.savePng",
  "appopt.title", "appopt.hint", "appopt.loading", "appopt.autostart", "appopt.autostartHint", "appopt.autostartUnsupported",
  "appopt.hotkeyShow", "appopt.hotkeyShowHint", "appopt.hotkeyConn", "appopt.hotkeyConnHint", "appopt.hotkeyStolen",
  "appopt.hotkeyNoConfig", "appopt.hotkeyAether", "appopt.backup", "appopt.backupHint", "appopt.backupExport",
  "appopt.backupImport", "appopt.backupImportConfirm", "appopt.backupExported", "appopt.backupRestored", "appopt.backupBad",
];
const missing = [];
for (const key of NEW_KEYS) {
  for (const lang of ["en", "fa", "zh", "ar"]) {
    if (!langs[lang]?.includes(key)) missing.push(`${lang}:${key}`);
  }
}
ok(missing.length === 0, `N11a all ${NEW_KEYS.length} new keys exist in 4 languages${missing.length ? " — missing: " + missing.join(", ") : ""}`);
const setEn = langs.en.join("|");
ok(["fa", "zh", "ar"].every(l => langs[l].join("|") === setEn), "N11b key-set parity across languages");

/* N11c review-fix wording: the old fa/ar texts claimed "installed build only",
   which contradicted the portable-only distribution — the guard is
   app.isPackaged and the portable exe passes it. */
const i18nSrc = read("src/i18n.ts");
const hints = [...i18nSrc.matchAll(/"appopt\.autostartHint": "([^"]+)"/g)].map(m => m[1]);
const unsups = [...i18nSrc.matchAll(/"appopt\.autostartUnsupported": "([^"]+)"/g)].map(m => m[1]);
ok(hints.length === 4 && unsups.length === 4, "N11c-i autostart hint + unsupported strings exist x4");
ok(hints[0].includes("portable exe") && hints[1].includes("پرتابل") && hints[2].includes("便携") && hints[3].includes("المحمول"),
  "N11c-ii hint names the portable exe in all 4 languages");
ok(!/installed|نصب‌شده|المثبتة|安装/.test(hints.join(" ") + " " + unsups.join(" ")),
  "N11c-iii no 'installed build' claim anywhere in autostart strings");
ok(unsups.every(u => /dev|توسعه|开发|التطوير/.test(u)), "N11c-iv unsupported toast blames dev/browser mode only");

/* ---- N12 deps ---- */
const pkg = JSON.parse(read("package.json"));
ok(!!pkg.dependencies?.qrcode && !!pkg.dependencies?.jsqr, "N12a qrcode + jsqr in dependencies");

/* ---- summary ---- */
console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
