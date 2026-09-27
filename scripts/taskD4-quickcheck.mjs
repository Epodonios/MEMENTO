#!/usr/bin/env node
/**
 * Phase D4 quickcheck — NO network, NO spawned processes (no Electron).
 * Verifies the Batch D4 implementation surface structurally:
 *   N1  tray.ts (NEW): icon resolution, click/right-click recipe, menu
 *       rebuild, status sync, one-shot balloon guarded to win32 + tray
 *   N2  appPrefs.ts: 3 new fields + defaults + sanitize gate + language
 *   N3  main.ts: quitting flag, close-to-tray interception, tray lifecycle,
 *       second-instance show() fix, tray-created-before-window ordering,
 *       win32 session-end cleanup hook (D4 review: before-quit is not
 *       guaranteed on Windows shutdown/logoff)
 *   N4  ipc.ts: sanitized+serialized app_prefs_set, tray_status_set handler
 *   N5  preload.ts: allowlist 20 + tray toggle bridge
 *   N6  SettingsTab.tsx (NEW): 4 sections incl. closeToTray + migrated
 *       builder panel
 *   N7  ConfigsTab.tsx: both panels REMOVED, QR stays
 *   N8  Sidebar.tsx: settings tab entry
 *   N9  App.tsx: settings route + shared hotkey/tray toggle handler
 *   N10 ConnectionManager: tray_status_set push on status change
 *   N11 store.ts: setLanguage syncs language to the main process
 *   N12 electron-mock.ts: simulated D4 handlers (honest: no tray in browser)
 *   N13 electron-builder.yml: tray icon extraResources
 *   N14 i18n: new keys x4 + parity + rewording purge ("starts minimized"
 *       promise gone, tray wording present)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const read = (p) => readFileSync(join(ROOT, p), "utf8");

console.log("== Phase D4 quickcheck (no network, no processes) ==");

/* ---- N1 tray.ts ---- */
const tray = read("electron-app/electron/tray.ts");
ok(tray.includes("export function createTray") && tray.includes("export function destroyTray") &&
   tray.includes("export function trayExists") && tray.includes("export function updateTrayStatus") &&
   tray.includes("export function rebuildMenu") && tray.includes("export function trayLabels") &&
   tray.includes("export function showCloseToTrayBalloonOnce"),
  "N1a tray module exports the full surface");
ok(tray.includes('tray.on("click"') && tray.includes("toggleWindowVisibility()") &&
   tray.includes('tray.on("right-click"') && tray.includes("popUpContextMenu"),
  "N1b Windows recipe: left click toggles window, right click opens menu");
ok(tray.includes("connected ? L.disconnect : L.connect") &&
   tray.includes('"memento:tray-toggle-connect"'),
  "N1c command bus: menu item sends tray-toggle-connect, label follows pushed status");
ok(/process\.platform === "win32" && tray/.test(tray) && tray.includes("displayBalloon") &&
   tray.includes("noSound: true"),
  "N1d one-shot balloon: win32+tray guarded, silent");
ok(/if \(prefs\.closeTrayToastShown\) return;/.test(tray) &&
   tray.includes("saveAppPrefs({ ...prefs, closeTrayToastShown: true })"),
  "N1e balloon fires at most once per userData (persisted flag)");
ok(tray.includes("process.resourcesPath") && tray.includes('"icon.ico"') && tray.includes('"icon.png"'),
  "N1f icon resolution: packaged resources + dev build/ fallbacks");
ok(/en: \{[\s\S]*fa: \{[\s\S]*zh: \{[\s\S]*ar: \{/.test(tray),
  "N1g tray i18n record covers all four languages (self-contained, main-side)");

/* ---- N2 appPrefs.ts ---- */
const ap = read("electron-app/electron/appPrefs.ts");
ok(/closeToTray: boolean/.test(ap) && /closeTrayToastShown: boolean/.test(ap) &&
   /language: AppLanguage/.test(ap), "N2a AppPrefs carries the three D4 fields");
ok(/closeToTray: true,/.test(ap) && /closeTrayToastShown: false,/.test(ap) && /language: "en",/.test(ap),
  "N2b defaults: close-to-tray ON, balloon pending, en");
ok(/closeToTray: o\.closeToTray !== false/.test(ap) &&
   /closeTrayToastShown: o\.closeTrayToastShown === true/.test(ap) &&
   /normalizeLanguage\(o\.language\) \?\? "en"/.test(ap),
  "N2c tolerant load: legacy D3 files get D4 defaults");
ok(/export function sanitizePrefsPatch/.test(ap) &&
   ap.includes("export function normalizeLanguage"),
  "N2d pure sanitize + language validator exported (fntest-covered)");

/* ---- N3 main.ts ---- */
const main = read("electron-app/electron/main.ts");
ok(/let quitting = false;/.test(main) && /before-quit[\s\S]*?quitting = true;/.test(main),
  "N3a quitting flag: set in before-quit, checked in the close handler");
ok(/mainWindow\.on\("close", \(e\) => \{[\s\S]*?if \(quitting\) return;[\s\S]*?!prefs\.closeToTray \|\| !trayExists\(\)[\s\S]*?e\.preventDefault\(\);[\s\S]*?w\.hide\(\);[\s\S]*?showCloseToTrayBalloonOnce\(\);[\s\S]*?\}\);/.test(main),
  "N3b close-to-tray interception: quit passes through, hide+balloon otherwise");
ok(/createTray\(\);[\s\S]*createWindow\(\);/.test(main),
  "N3c tray exists BEFORE the window (silent launch + close both gate on it)");
ok(main.includes("destroyTray();") && main.includes("before-quit"),
  "N3d tray destroyed on quit");
ok(/second-instance[\s\S]*?w\.isMinimized\(\)[\s\S]*?w\.restore\(\);[\s\S]*?w\.show\(\);[\s\S]*?w\.focus\(\);/.test(main),
  "N3e second launch restores a HIDDEN window too (show() added in D4)");
ok(/mainWindow\.on\("closed"[\s\S]*?cleanupOnce\(\);[\s\S]*?\}\);[\s\S]*?mainWindow\.on\("session-end", \(\) => \{[\s\S]*?quitting = true;[\s\S]*?cleanupOnce\(\);[\s\S]*?\}\);/.test(main),
  "N3f win32 session-end hook (window-level, Electron 44) runs the SAME cleanup — before-quit is not guaranteed on shutdown/logoff");
ok(!main.includes('app.on("session-end"') && !main.includes('.on("query-session-end"'),
  "N3g no app-level session-end (removed from Electron 44 typings) and the cancelable query-session-end is never touched (a user's shutdown must never be blocked)");

/* ---- N4 ipc.ts ---- */
const ipc = read("electron-app/electron/ipc.ts");
ok(ipc.includes("sanitizePrefsPatch(args?.patch)") && ipc.includes("prefsChain = prefsChain.then"),
  "N4a app_prefs_set: sanitized patch + serialized read-modify-write (no lost-update race)");
ok(ipc.includes("rebuildMenu();") && /ipcMain\.handle\("tray_status_set"/.test(ipc) &&
   ipc.includes("updateTrayStatus(args?.connected === true)"),
  "N4b tray menu rebuilds on prefs change; tray_status_set handler wired");
ok(ipc.includes("closeTrayToastShown") === false || !ipc.includes("args?.patch?.closeTrayToastShown"),
  "N4c IPC handler never lets the renderer write the one-shot balloon flag");

/* ---- N5 preload.ts ---- */
const preload = read("electron-app/electron/preload.ts");
const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
// R3 re-point: allowlist was 32; +18 R3 channels disclosed
ok(allow.length === 53 && allow.includes("tray_status_set") && allow.includes("url_test") && allow.includes("geo_ensure") && allow.includes("aether_update_apply"),
  `N5a allowlist = 53 quoted-comma tokens (50 commands + 3 R3 event-channel names) incl. tray_status_set + url_test + C3 geo pair + R3 additions (disclosed re-point; got ${allow.length})`);
ok(preload.includes('ipcRenderer.on("memento:tray-toggle-connect", handler)') &&
   preload.includes("onTrayToggleConnect"),
  "N5b tray toggle bridge exposed with unsubscribe");

/* ---- N6 SettingsTab.tsx ---- */
const st = read("src/components/SettingsTab.tsx");
ok(st.includes("export default function SettingsTab") && st.includes('titleKey="tab.settings"'),
  "N6a dedicated Settings tab with its own header");
ok(st.includes('t("set.closeToTray", language)') && st.includes('patchPrefs({ closeToTray: v })'),
  "N6b Close-to-tray toggle wired to app_prefs_set");
ok(st.includes('t("appopt.autostart", language)') && st.includes('t("appopt.hotkeyShow", language)') &&
   st.includes('t("appopt.hotkeyConn", language)') && st.includes('t("appopt.backup", language)'),
  "N6c App Options migrated: autostart + both hotkeys + backup");
ok(st.includes("BuilderOptionsPanel") && st.includes('t("builder.allowLanWarning", language)') &&
   st.includes("DEFAULT_BUILDER_OPTIONS") && st.includes('titleKey="builder.title"'),
  "N6d Builder panel migrated with the allowLan warning + reset (locked D4 home)");

/* ---- N7 ConfigsTab.tsx ---- */
const ct = read("src/components/ConfigsTab.tsx");
ok(!ct.includes("AppOptionsPanel") && !ct.includes("showAppOptions") &&
   !ct.includes("BuilderOptionsPanel") && !ct.includes("BuilderToggle") &&
   !ct.includes("showBuilderOptions") && !ct.includes("appBackup"),
  "N7a both panels + helpers removed from ConfigsTab");
ok(ct.includes("<QrModal link={qrModal.link}") && ct.includes("QrCode"),
  "N7b QR feature stays in ConfigsTab (untouched D3 surface)");

/* ---- N8 Sidebar.tsx ---- */
const sb = read("src/components/Sidebar.tsx");
ok(sb.includes('{ id: "settings", label: "tab.settings", icon: Settings') &&
   sb.includes("tab.settings"),
  "N8 sidebar has the settings entry (before donate/contact)");

/* ---- N9 App.tsx ---- */
const app = read("src/App.tsx");
ok(app.includes('activeTab === "settings" && <SettingsTab />') && app.includes('import SettingsTab'),
  "N9a settings route registered");
ok(/onHotkeyToggleConnect\?\.\(onToggle\)[\s\S]*?onTrayToggleConnect\?\.\(onToggle\)/.test(app) &&
   app.includes("const onToggle = () => {"),
  "N9b ONE shared toggle handler for hotkey + tray (identical semantics)");

/* ---- N10 ConnectionManager ---- */
const cm = read("src/components/ConnectionManager.tsx");
ok(/useEffect\(\(\) => \{\s*const connected = status === "connected" \|\| status === "connecting";\s*tauriInvoke\("tray_status_set", \{ connected \}\)\?\.catch\(\(\) => \{\}\);\s*\}, \[status\]\);/.test(cm),
  "N10 connection status pushed to the tray (connecting counts as active)");

/* ---- N11 store.ts ---- */
const store = read("src/store.ts");
ok(/setLanguage: \(lang\) => \{[\s\S]*?app_prefs_set", \{ patch: \{ language: lang \} \}/.test(store),
  "N11 setLanguage syncs the UI language into memento-app-prefs.json");

/* ---- N12 electron-mock.ts ---- */
const mock = read("src/electron-mock.ts");
ok(/tray_status_set: async/.test(mock) && mock.includes("onTrayToggleConnect") &&
   mock.includes("closeToTray: true") && mock.includes('language: "en"'),
  "N12 mock simulates the D4 surface (no tray in browser — acknowledged)");

/* ---- N13 electron-builder.yml ---- */
const yml = read("electron-app/electron-builder.yml");
ok(/- from: build\/icon\.ico\s+to: icon\.ico/.test(yml) &&
   /- from: build\/icon\.png\s+to: icon\.png/.test(yml),
  "N13 tray icons shipped via extraResources (resourcesPath resolvable)");

/* ---- N14 i18n ---- */
const bundle = join(HERE, "taskD4-i18n.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskD4-entry.ts"), "--bundle", "--platform=node", "--outfile=" + bundle], { cwd: HERE, stdio: "pipe" });
const { langs } = JSON.parse(execFileSync("node", [bundle], { encoding: "utf8" }));
const NEW_KEYS = [
  "tab.settings",
  "set.closeToTray", "set.closeToTrayHint", "set.sectionWindow", "set.sectionHotkeys", "set.sectionBackup",
];
const missing = [];
for (const key of NEW_KEYS) {
  for (const lang of ["en", "fa", "zh", "ar"]) {
    if (!langs[lang]?.includes(key)) missing.push(`${lang}:${key}`);
  }
}
ok(missing.length === 0, `N14a all ${NEW_KEYS.length} new keys exist in 4 languages${missing.length ? " — missing: " + missing.join(", ") : ""}`);
const setEn = langs.en.join("|");
ok(["fa", "zh", "ar"].every(l => langs[l].join("|") === setEn), "N14b key-set parity across languages");

const i18nSrc = read("src/i18n.ts");
const hints = [...i18nSrc.matchAll(/"appopt\.autostartHint": "([^"]+)"/g)].map(m => m[1]);
ok(hints.length === 4 && hints.every(h => /tray|托盘|شريط/i.test(h)),
  "N14c autostart hint says hidden-in-tray x4");
ok(!/starts minimized|کمینه‌شده|以最小化方式|مصغَّراً/.test(hints.join(" ")),
  "N14d old 'starts minimized' wording purged (silent launch is now full-hide)");
const appHints = [...i18nSrc.matchAll(/"appopt\.hint": "([^"]+)"/g)].map(m => m[1]);
ok(appHints.length === 4 && !appHints.some(h => /D4 arrives|بچ D4|D4 批次|الدفعة D4/.test(h)),
  "N14e no more 'Settings arrives in D4' promise (it IS the Settings page now)");

console.log(`\nD4 quickcheck: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
