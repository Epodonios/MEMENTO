/**
 * tray.ts (Phase D4 — quick-win item 3)
 *
 * System tray + Close-to-tray support. The original Tauri build enabled a
 * tray-icon feature flag but never had tray code (dead flag — inventoried
 * in Task 1); D3 shipped the interim "start minimized" behavior and this
 * module completes the design:
 *
 *  - Tray icon (packaged: resourcesPath/icon.ico|png — added to
 *    extraResources in electron-builder.yml; dev: build/icon.ico|png).
 *  - Command bus: menu "Connect / Disconnect" and the balloon texts are
 *    MAIN-process surfaces, but the connection ENGINE lives in the
 *    renderer — so the menu item sends `memento:tray-toggle-connect` and
 *    the renderer applies the exact same semantics as the Ctrl+Alt+C
 *    hotkey (App.tsx listens to both through one shared handler).
 *  - Status sync: the renderer pushes connection state via
 *    `tray_status_set` (ipc.ts -> updateTrayStatus) so the menu label
 *    honestly reads "Connect" or "Disconnect".
 *  - Close-to-tray one-shot education: the FIRST hidden close fires a
 *    native Windows balloon ("still running — reopen via the tray icon").
 *    The one-shot flag (closeTrayToastShown in memento-app-prefs.json) is
 *    written ONLY here, never through IPC (sanitizePrefsPatch drops it).
 *
 * Tray strings live in THIS file (self-contained record, all four UI
 * languages) instead of the renderer's i18n.ts on purpose: the tray menu
 * and balloon must render before/without any renderer round-trip, and the
 * main-process tsc build has no React dependency. taskD4-fntest asserts
 * the record covers all four languages with no empty strings.
 */
import { Tray, Menu, app, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { loadAppPrefs, toggleWindowVisibility, saveAppPrefs, AppLanguage } from "./appPrefs";

interface TrayLabels {
  showHide: string;
  connect: string;
  disconnect: string;
  quit: string;
  balloonTitle: string;
  balloonBody: string;
}

const TRAY_I18N: Record<AppLanguage, TrayLabels> = {
  en: {
    showHide: "Show / Hide MEMENTO",
    connect: "Connect",
    disconnect: "Disconnect",
    quit: "Quit",
    balloonTitle: "MEMENTO is still running",
    balloonBody:
      "Closed to the tray — the VPN stays connected. Click the tray icon to reopen. You can turn this off in Settings.",
  },
  fa: {
    showHide: "نمایش / مخفی کردن MEMENTO",
    connect: "اتصال",
    disconnect: "قطع اتصال",
    quit: "خروج",
    balloonTitle: "MEMENTO هنوز در حال اجراست",
    balloonBody:
      "به Tray مخفی شد — VPN قطع نشده است. برای بازگشتن روی آیکن Tray کلیک کنید. این رفتار در تنظیمات قابل تغییر است.",
  },
  zh: {
    showHide: "显示 / 隐藏 MEMENTO",
    connect: "连接",
    disconnect: "断开连接",
    quit: "退出",
    balloonTitle: "MEMENTO 仍在运行",
    balloonBody:
      "已隐藏到托盘 — VPN 保持连接。点击托盘图标可重新打开。此行为可在设置中更改。",
  },
  ar: {
    showHide: "إظهار / إخفاء MEMENTO",
    connect: "اتصال",
    disconnect: "قطع الاتصال",
    quit: "خروج",
    balloonTitle: "لا يزال MEMENTO قيد التشغيل",
    balloonBody:
      "تم الإخفاء إلى شريط النظام — يبقى VPN متصلاً. انقر فوق أيقونة الشريط لإعادة الفتح. يمكن تغيير هذا السلوك من الإعدادات.",
  },
};

/** Pure lookup (unknown languages fall back to English). Exported for
 *  taskD4-fntest. */
export function trayLabels(lang: string): TrayLabels {
  return (TRAY_I18N as Record<string, TrayLabels>)[lang] ?? TRAY_I18N.en;
}

let tray: Tray | null = null;
let contextMenu: Menu | null = null;
let connected = false; // last status pushed by the renderer (tray_status_set)

/** Packaged builds: electron-builder copies build/icon.ico + build/icon.png
 *  to process.resourcesPath (extraResources, D4). Dev builds: the same
 *  files live in electron-app/build/ next to dist-electron/. */
function resolveIconPath(): string | null {
  const candidates: string[] = [];
  if (app.isPackaged) {
    const rp = process.resourcesPath;
    if (process.platform === "win32") candidates.push(path.join(rp, "icon.ico"));
    candidates.push(path.join(rp, "icon.png"));
  } else {
    candidates.push(path.join(__dirname, "..", "build", "icon.ico"));
    candidates.push(path.join(__dirname, "..", "build", "icon.png"));
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore — try the next candidate */
    }
  }
  return null;
}

function trayToggleConnect(): void {
  const w = BrowserWindow.getAllWindows()[0];
  if (w && !w.isDestroyed()) {
    w.webContents.send("memento:tray-toggle-connect");
  }
}

/** (Re)build the context menu from the CURRENT prefs + connection status.
 *  Called at creation, after every app_prefs_set (language may have
 *  changed) and on status pushes. */
export function rebuildMenu(): void {
  if (!tray) return;
  const L = trayLabels(loadAppPrefs().language);
  contextMenu = Menu.buildFromTemplate([
    { label: L.showHide, click: () => toggleWindowVisibility() },
    { label: connected ? L.disconnect : L.connect, click: () => trayToggleConnect() },
    { type: "separator" },
    // Real quit path: app.quit() -> before-quit sets `quitting` in main.ts,
    // so the close-to-tray interception can never trap the user here.
    { label: L.quit, click: () => app.quit() },
  ]);
}

export function createTray(): void {
  if (tray) return;
  try {
    const iconPath = resolveIconPath();
    if (!iconPath) return; // honest fallback: main.ts keeps quit-on-close
    tray = new Tray(iconPath);
    tray.setToolTip("MEMENTO");
    // Windows recipe: with setContextMenu() a LEFT click would open the
    // menu too; two explicit handlers give the standard VPN-manager
    // behavior — left click toggles the window, right click opens the menu.
    tray.on("click", () => toggleWindowVisibility());
    tray.on("right-click", () => {
      if (tray && contextMenu) tray.popUpContextMenu(contextMenu);
    });
    rebuildMenu();
  } catch {
    // Some Linux DEs have no StatusNotifier host etc. — no tray means
    // main.ts falls back to classic quit-on-close (never strand the user).
    try {
      tray?.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
    contextMenu = null;
  }
}

export function destroyTray(): void {
  try {
    tray?.destroy();
  } catch {
    /* app already tearing down */
  }
  tray = null;
  contextMenu = null;
}

export function trayExists(): boolean {
  return tray !== null;
}

/** Status sync from the renderer (`tray_status_set`). Rebuilds the menu
 *  only when the state actually flipped — a connect/disconnect is rare,
 *  so this is effectively free. */
export function updateTrayStatus(next: boolean): void {
  if (next === connected) return;
  connected = next;
  rebuildMenu();
}

/** The one-time "still running" education for Close-to-tray. Fires at most
 *  ONCE per userData (flag persisted in memento-app-prefs.json), only when
 *  a tray exists, and natively only on Windows (displayBalloon is a
 *  Windows API — Electron converts it to a toast notification on Win10+).
 *  The flag is set even when the balloon itself is impossible so the app
 *  never keeps trying; on non-Windows the Settings hint text carries the
 *  education instead. */
export function showCloseToTrayBalloonOnce(): void {
  const prefs = loadAppPrefs();
  if (prefs.closeTrayToastShown) return;
  try {
    if (process.platform === "win32" && tray) {
      const L = trayLabels(prefs.language);
      tray.displayBalloon({
        title: L.balloonTitle,
        content: L.balloonBody,
        iconType: "info",
        noSound: true,
      });
    }
  } catch {
    /* balloon is best-effort — never block the close flow */
  }
  saveAppPrefs({ ...prefs, closeTrayToastShown: true });
}
