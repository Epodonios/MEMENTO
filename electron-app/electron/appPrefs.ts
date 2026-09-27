/**
 * appPrefs.ts (Phase D3 — items 2/4/7; extended in Phase D4 — tray era)
 *
 * Main-process owner of the system-coupled app options:
 *
 *  - Auto-start with Windows: app.setLoginItemSettings. The OS registry is
 *    the real store — nothing to persist here beyond READING
 *    getLoginItemSettings(). Enabled logins launch with `--hidden`, which
 *    main.ts maps to "start hidden in the tray" (since D4 the tray EXISTS,
 *    so the silent launch is fully hidden; the tray icon / Ctrl+Alt+V /
 *    a second launch bring the window back).
 *  - Global hotkeys: globalShortcut. Ctrl+Alt+V toggles window visibility;
 *    Ctrl+Alt+C asks the renderer to connect/disconnect (the connection
 *    engine lives there).
 *  - Close-to-tray (Phase D4): when closeToTray is on, closing the window
 *    hides it instead of quitting (the VPN survives the X button). The
 *    FIRST hidden close fires a one-time Windows balloon from the tray
 *    ("still running" hint); closeTrayToastShown is the one-shot flag and
 *    is written ONLY by the main process — the renderer can never touch it
 *    (sanitizePrefsPatch deliberately drops it).
 *  - language (Phase D4): the tray menu + balloon texts need the UI
 *    language in the MAIN process (before/without any renderer round-trip),
 *    so the renderer syncs it here on every change; defaults to "en".
 *
 * All prefs persist in a tiny JSON file in userData
 * (memento-app-prefs.json). Hotkeys were checked against
 * KeyboardShortcuts.tsx (in-app: Ctrl+K, Ctrl+1-6) and common Windows
 * shortcuts: Ctrl+Alt+V / Ctrl+Alt+C collide with neither (plain Ctrl+V
 * paste is intentionally untouched — see the F7 lesson in
 * KeyboardShortcuts.tsx).
 */
import { app, globalShortcut, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";

export interface AppPrefs {
  /** Ctrl+Alt+V — show/hide the main window. */
  hotkeyShowHide: boolean;
  /** Ctrl+Alt+C — connect/disconnect (renderer handles the toggle). */
  hotkeyConnect: boolean;
  /** Phase D4: the X button hides to tray instead of quitting. */
  closeToTray: boolean;
  /** Phase D4: one-shot flag for the "still running in tray" balloon.
   *  Main-process internal — NOT writable through IPC. */
  closeTrayToastShown: boolean;
  /** Phase D4: UI language for the tray menu + balloon texts. */
  language: AppLanguage;
  /** Phase C2: the URL the real-delay test (url_test) GETs through the
   *  tunnel. User-configurable by design; http/https only, no whitespace,
   *  ≤500 chars (normalizeTestUrl enforces every write + load). */
  testUrl: string;
  /** Phase C5 (kill switch): when true, every tunnel-down path fails
   *  CLOSED (system proxy forced to 127.0.0.1:9) while quitting the app
   *  always restores direct (the quit latch in killSwitch.ts). Default
   *  OFF: strictly opt-in. The ENFORCEMENT lives main-side in
   *  killSwitch.ts — this boolean is only the persisted arm flag. */
  killSwitch: boolean;
}

export const APP_LANGUAGES = ["en", "fa", "zh", "ar"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** Phase C2: canonical default for the real-delay test URL — the same
 *  generate_204 endpoint v2rayN/v2rayNG use (tiny 204 answer, no body,
 *  so the measurement is almost pure tunnel latency). */
export const URL_TEST_DEFAULT = "https://www.gstatic.com/generate_204";

export const DEFAULT_APP_PREFS: AppPrefs = {
  hotkeyShowHide: true,
  hotkeyConnect: true,
  closeToTray: true,
  closeTrayToastShown: false,
  language: "en",
  testUrl: URL_TEST_DEFAULT,
  killSwitch: false, // Phase C5: the kill switch is strictly opt-in
};

/** Pure validator for the language field — unknown/garbage values fall
 *  back to null so callers can keep the previous value. Exported for the
 *  functional tests (taskD4-fntest). */
export function normalizeLanguage(v: unknown): AppLanguage | null {
  return typeof v === "string" && (APP_LANGUAGES as readonly string[]).includes(v)
    ? (v as AppLanguage)
    : null;
}

/** Pure validator for the test URL (Phase C2) — returns the trimmed URL
 *  or null. Rules: absolute http(s) URL with a hostname, no whitespace,
 *  ≤500 chars. Exported for the functional tests (taskC2-fntest). */
export function normalizeTestUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0 || s.length > 500 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname) return s;
  } catch { /* fall through */ }
  return null;
}

/** Pure IPC-patch sanitizer (Phase D4). The renderer patch may only carry
 *  the three user-facing booleans + language; everything else — including
 *  the privileged one-shot balloon flag — is dropped here so a compromised
 *  renderer cannot suppress the educational toast or forge state.
 *  Exported for taskD4-fntest. */
export function sanitizePrefsPatch(patch: unknown): {
  hotkeyShowHide?: boolean;
  hotkeyConnect?: boolean;
  closeToTray?: boolean;
  language?: AppLanguage;
  testUrl?: string;
  killSwitch?: boolean;
} {
  const out: ReturnType<typeof sanitizePrefsPatch> = {};
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    // Spread first: snapshots ONLY own enumerable properties, so values
    // planted on a prototype chain (structured-clone artifacts or a
    // polluted object) can never be read by the field checks below.
    const p = { ...(patch as Record<string, unknown>) };
    if (typeof p.hotkeyShowHide === "boolean") out.hotkeyShowHide = p.hotkeyShowHide;
    if (typeof p.hotkeyConnect === "boolean") out.hotkeyConnect = p.hotkeyConnect;
    if (typeof p.closeToTray === "boolean") out.closeToTray = p.closeToTray;
    const lang = normalizeLanguage(p.language);
    if (lang) out.language = lang;
    // Phase C2: an INVALID test URL is dropped (the previous value stays
    // alive) — the field can never be poisoned through the IPC boundary.
    const testUrl = normalizeTestUrl(p.testUrl);
    if (testUrl) out.testUrl = testUrl;
    // Phase C5: the arm flag is a plain boolean; the DECISION (block vs
    // clear vs leave; tunnel-down) lives only in the main process (killSwitch.ts).
    if (typeof p.killSwitch === "boolean") out.killSwitch = p.killSwitch;
  }
  return out;
}

export const HOTKEY_SHOW_HIDE = "Control+Alt+V";
export const HOTKEY_CONNECT = "Control+Alt+C";

const prefsFile = (): string => path.join(app.getPath("userData"), "memento-app-prefs.json");

export function loadAppPrefs(): AppPrefs {
  try {
    const raw = fs.readFileSync(prefsFile(), "utf8");
    const o = JSON.parse(raw) as Partial<AppPrefs>;
    // Tolerant load — a pre-D4 file carries only the two hotkey booleans;
    // every D4 field falls back to its default (closeToTray ON, balloon
    // pending, English tray).
    return {
      hotkeyShowHide: o.hotkeyShowHide !== false, // default ON
      hotkeyConnect: o.hotkeyConnect !== false,
      closeToTray: o.closeToTray !== false, // default ON (D4)
      closeTrayToastShown: o.closeTrayToastShown === true, // default pending
      language: normalizeLanguage(o.language) ?? "en",
      testUrl: normalizeTestUrl(o.testUrl) ?? URL_TEST_DEFAULT, // Phase C2
      killSwitch: o.killSwitch === true, // Phase C5: default OFF (opt-in)
    };
  } catch {
    return { ...DEFAULT_APP_PREFS };
  }
}

export function saveAppPrefs(prefs: AppPrefs): void {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2), "utf8");
  } catch {
    /* best-effort — hotkeys simply fall back to defaults next boot */
  }
}

let registered: { showHide: boolean; connect: boolean } = { showHide: false, connect: false };

function win(): BrowserWindow | null {
  const w = BrowserWindow.getAllWindows()[0];
  return w && !w.isDestroyed() ? w : null;
}

/** Show/hide toggle. Hiding keeps the core running (like minimize); the
 *  hotkey, the taskbar or a second launch (single-instance focus) brings
 *  it back. window-all-closed is NOT triggered by hide(). */
export function toggleWindowVisibility(): void {
  const w = win();
  if (!w) return;
  if (w.isVisible() && !w.isMinimized()) {
    w.hide();
  } else {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
}

/** (Re)register exactly the enabled hotkeys. Called at boot and after every
 *  app_prefs_set that touches hotkeys. Registration failures (e.g. another
 *  app owns the combo) are surfaced through the return value so the
 *  renderer can show an honest toast. */
export function applyHotkeyRegistration(prefs: AppPrefs): { showHide: boolean; connect: boolean } {
  globalShortcut.unregisterAll();
  registered = { showHide: false, connect: false };
  if (prefs.hotkeyShowHide) {
    registered.showHide = globalShortcut.register(HOTKEY_SHOW_HIDE, toggleWindowVisibility);
  }
  if (prefs.hotkeyConnect) {
    registered.connect = globalShortcut.register(HOTKEY_CONNECT, () => {
      const w = win();
      w?.webContents.send("memento:hotkey-toggle-connect");
    });
  }
  return { ...registered };
}

export function unregisterHotkeys(): void {
  try { globalShortcut.unregisterAll(); } catch { /* app already tearing down */ }
  registered = { showHide: false, connect: false };
}

/** Read-only view for app_prefs_get — did the last registration ACTUALLY
 *  take (false can mean the user disabled it OR another app owns it). */
export function hotkeysActive(): { showHide: boolean; connect: boolean } {
  return { ...registered };
}

/* ---------------- item 2: auto-start with Windows ---------------- */

export interface AutostartStatus {
  /** false in dev/browser — setLoginItemSettings would register electron.exe.
   *  TRUE for the packaged app INCLUDING the portable exe (app.isPackaged is
   *  true for it — portability is about the distribution format, not about
   *  being unpackaged). */
  supported: boolean;
  openAtLogin: boolean;
}

/** The login item ALWAYS launches with --hidden (mapped to "start
 *  minimized" by main.ts). The SAME args must be handed to
 *  getLoginItemSettings() when reading: Windows matches Run-key entries on
 *  path AND args — Electron docs (app.md, verified against main): "If you
 *  provided path and args options to app.setLoginItemSettings, then you
 *  need to pass the same arguments here for openAtLogin to be set
 *  correctly." Reading with default empty args would report a false OFF. */
const AUTOSTART_ARGS = ["--hidden"];

/**
 * The REAL user-visible exe path when running from an electron-builder
 * PORTABLE exe. A portable run unpacks into a FRESH %TEMP% folder on every
 * launch, so process.execPath points at a throwaway copy — registering
 * THAT would write a dead path into HKCU\...\Run (the D research phase
 * flagged exactly this). The portable launcher exposes the true exe path
 * via env (verified against electron-builder's portable.nsi on master:
 * PORTABLE_EXECUTABLE_DIR=$EXEDIR, PORTABLE_EXECUTABLE_FILE=$EXEPATH) and
 * both login-item APIs accept it through the `path` option ("The
 * executable to launch at login. Defaults to process.execPath.").
 * Returns undefined everywhere else — NSIS-installed apps and dev shells
 * keep the process.execPath default.
 */
function portableExePath(): string | undefined {
  const raw = process.env.PORTABLE_EXECUTABLE_FILE;
  const p = typeof raw === "string" ? raw.trim() : "";
  return p.length > 0 ? p : undefined;
}

export function getAutostartStatus(): AutostartStatus {
  try {
    const p = portableExePath();
    const s = p
      ? app.getLoginItemSettings({ path: p, args: AUTOSTART_ARGS })
      : app.getLoginItemSettings({ args: AUTOSTART_ARGS });
    return { supported: app.isPackaged, openAtLogin: !!s.openAtLogin };
  } catch {
    return { supported: false, openAtLogin: false };
  }
}

export function setAutostart(enabled: boolean): AutostartStatus {
  if (app.isPackaged) {
    try {
      const p = portableExePath();
      app.setLoginItemSettings({
        openAtLogin: enabled,
        args: enabled ? AUTOSTART_ARGS : [],
        ...(p ? { path: p } : {}),
      });
    } catch {
      /* some Linux setups throw — report the real status below */
    }
  }
  return getAutostartStatus();
}

/** True when this instance was launched BY the login item (`--hidden` arg). */
export function isSilentLaunch(): boolean {
  try {
    return process.argv.includes("--hidden");
  } catch {
    return false;
  }
}
