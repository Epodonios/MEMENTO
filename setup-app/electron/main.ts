/**
 * MementoSetup — Electron main.
 *
 * Owns the 900×640-design window (frameless, the wizard draws its own
 * title bar), the payload context, and the Windows touchpoints for
 * installerCore:
 *   - real directory picker (dialog.showOpenDialog)
 *   - real free-space probe (fs.statfs)
 *   - real shortcuts (shell.writeShortcutLink — desktop + Start Menu)
 *   - real Add/Remove Programs registration (HKCU via reg.exe, per-user)
 *   - real upgrade path (taskkill a running MEMENTO)
 *   - real run-after-finish (detached spawn of MEMENTO.exe)
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import path from "path";
import fs from "fs";
import { execFile, execFileSync, spawn } from "child_process";
import {
  runInstall,
  freeDiskBytes,
  validateDestPath,
  type InstallEvent,
  type InstallResult,
  type InstallMode,
  type RuntimeFileEntry,
} from "./installerCore";

const SETUP_VERSION = "3.2.0";
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "payload-meta.json"), "utf8")).appVersion;
  } catch {
    return app.getVersion();
  }
})();

let mainWindow: BrowserWindow | null = null;
let installBusy = false;
let cancelRequested = false;
let lastResult: InstallResult | null = null;

const IS_WIN = process.platform === "win32";
const EXE_NAME = IS_WIN ? "MEMENTO.exe" : "MEMENTO";

function payloadDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "payload");
  return path.join(__dirname, "..", "payload");
}

function payloadMeta(): {
  appVersion?: string;
  cores?: { xray?: string; singbox?: string; aether?: string };
  mode?: InstallMode;
} {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "payload-meta.json"), "utf8"));
  } catch {
    return {};
  }
}

/** runtime-reuse ONLY (packaged): the files of the installer's OWN Electron
 *  runtime that the destination needs. The wizard's app.asar, the payload
 *  itself and the installer icon are deliberately excluded — the payload
 *  provides MEMENTO's own UNPACKED app/ tree (2.0.5) + icons. */
function runtimeFileEntries(): RuntimeFileEntry[] {
  const root = path.dirname(process.execPath);
  const SKIP = new Set([
    "app.asar",
    "payload",
    "icon.ico",
    "icon.png",
    "payload-manifest.json",
    "payload-meta.json",
    ".memento-uninstall.json",
    "MementoSetup.exe",
    "MEMENTO.exe",
  ]);
  const out: RuntimeFileEntry[] = [];
  for (const e of safeReaddir(root)) {
    if (e.isDirectory() || SKIP.has(e.name)) continue;
    const p = path.join(root, e.name);
    try {
      out.push({ rel: e.name, bytes: fs.statSync(p).size });
    } catch {
      /* unreadable runtime file — skip */
    }
  }
  const loc = path.join(root, "locales");
  if (fs.existsSync(loc)) {
    for (const e of safeReaddir(loc)) {
      if (!e.isFile()) continue;
      try {
        out.push({ rel: path.join("locales", e.name), bytes: fs.statSync(path.join(loc, e.name)).size });
      } catch {
        /* skip */
      }
    }
  }
  const elevate = path.join(root, "resources", "elevate.exe");
  if (fs.existsSync(elevate)) {
    try {
      out.push({ rel: path.join("resources", "elevate.exe"), bytes: fs.statSync(elevate).size });
    } catch {
      /* skip */
    }
  }
  return out;
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Payload staging — the portable-extraction rescue (3.1.7)            */
/* ------------------------------------------------------------------ */
/* The setup ships as a portable SFX: at EVERY launch NSIS extracts the
 * whole app into the SAME %TEMP%\<unpack-id> folder (the id is baked at
 * build time) and a NEW launch of the same exe begins with `RMDir /r` on
 * that exact folder (electron-builder portable.nsi, line 38). Users
 * double-click (the silent 130 MB extraction gives no feedback), so the
 * second stub wipes the payload + loose files out from under the RUNNING
 * wizard: the exe and loaded DLLs survive (Windows locks open images) but
 * data files vanish → "ENOENT …\Temp\<id>\resources\payload" mid-install.
 *
 * FIX (2.0.2): right after launch the payload was COPIED into a private
 * staging folder under %LOCALAPPDATA%\MementoSetup\staging\stage-<pid>-<ts>
 * and the install reads from THERE.
 *
 * FIX (2.0.3, AV-hardening): the payload is now MOVED (same-volume
 * rename — a pure metadata operation, ~1s, zero file content written)
 * into that private staging folder. The flagged unsigned core binaries
 * (xray.exe / sing-box.exe / aether.exe) are therefore written to disk
 * ONE time fewer (no Temp→AppData byte copy anymore), which removes one
 * of the behaviors Defender's dropper heuristics score. The tolerant
 * byte copy remains only as the cross-volume / locked-dir fallback.
 * The volatile extraction dir can still be deleted at any moment
 * without harming the installation, and the honest install log still
 * reports anything an AV removed mid-copy. */

interface StagingState {
  root: string;
  payloadDir: string | null;
  ready: boolean;
  skipped: number;
  error: string | null;
  promise: Promise<void> | null;
}

let staging: StagingState | null = null;

function stagingBase(): string {
  const base =
    (IS_WIN && process.env.LOCALAPPDATA) || app.getPath("userData");
  return path.join(base, "MementoSetup", "staging");
}

/** Per-file tolerant recursive copy — returns the skipped count. */
function copyTreeTolerant(src: string, dst: string): number {
  let skipped = 0;
  const walk = (s: string, d: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(s, { withFileTypes: true });
    } catch {
      skipped++;
      return;
    }
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {
      skipped += entries.filter((e) => e.isFile()).length || 1;
      return;
    }
    for (const e of entries) {
      const sp = path.join(s, e.name);
      const dp = path.join(d, e.name);
      if (e.isDirectory()) walk(sp, dp);
      else if (e.isFile()) {
        try {
          fs.copyFileSync(sp, dp);
        } catch {
          skipped++;
        }
      }
    }
  };
  walk(src, dst);
  return skipped;
}

/** Remove stage-* folders left behind by earlier runs (the single-instance
 *  lock guarantees no sibling wizard is live while this runs). */
function cleanupStaleStaging(): void {
  const base = stagingBase();
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith("stage-")) continue;
    try {
      fs.rmSync(path.join(base, e.name), { recursive: true, force: true });
    } catch {
      /* best-effort — the next boot retries */
    }
  }
}

function startPayloadStaging(): void {
  if (!app.isPackaged) return; // dev runs read the repo payload directly
  cleanupStaleStaging();
  const src = payloadDir();
  const root = path.join(stagingBase(), `stage-${process.pid}-${Date.now()}`);
  const st: StagingState = {
    root,
    payloadDir: null,
    ready: false,
    skipped: 0,
    error: null,
    promise: null,
  };
  staging = st;
  st.promise = (async () => {
    try {
      const dst = path.join(root, "payload");
      // 2.0.3 AV-hardening: MOVE the payload out of the volatile SFX
      // extraction folder instead of byte-copying it. A same-volume
      // rename writes ZERO file content (vs. streaming ~110 MB of
      // unsigned exes through a second location), completes in about a
      // second, and keeps every 2.0.2 guarantee: the extraction dir can
      // be wiped at any moment, stale stages are cleaned on boot, and
      // the copy fallback still tolerates AV-hidden files.
      let moved = false;
      try {
        fs.renameSync(src, dst);
        moved = true;
      } catch {
        /* EXDEV (different volume) / EBUSY / EPERM — tolerant copy below */
      }
      st.skipped = moved ? 0 : copyTreeTolerant(src, dst);
      st.payloadDir = dst;
      st.ready = true;
    } catch (e: any) {
      st.error = String(e?.message || e);
    }
  })();
  void st.promise;
}

/** The payload the INSTALL reads from: the private staged copy when it
 *  exists, the (volatile) extraction copy otherwise. */
function installPayloadDir(): string {
  if (staging?.ready && staging.payloadDir && fs.existsSync(staging.payloadDir)) {
    return staging.payloadDir;
  }
  return payloadDir();
}

function disposeStaging(): void {
  if (!staging) return;
  try {
    fs.rmSync(staging.root, { recursive: true, force: true });
  } catch {
    /* stale sweep on next boot */
  }
  staging = null;
}

/** The active install mode: runtime-reuse only in a real packaged build
 *  whose payload-meta declares it — every other situation (dev runs, POSIX
 *  gate fixtures, --stub payloads) stays on the classic full-tree copy. */
function installMode(): InstallMode {
  const meta = payloadMeta();
  return app.isPackaged && meta.mode === "runtime-reuse" ? "runtime-reuse" : "full-tree";
}

/** Default per-user destination: %LOCALAPPDATA%\Programs\MEMENTO.
 *  Deliberately KEPT per-user even though the setup now runs elevated
 *  (2.0.3 requireAdministrator): the uninstall contract (MEMENTO.exe
 *  --memento-uninstall as the standard user + HKCU ARP key + preserved
 *  userData) depends on a user-writable install dir, and an unelevated
 *  MEMENTO must never need admin to run. */
function defaultDestDir(): string {
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
    return path.join(localAppData, "Programs", "MEMENTO");
  }
  // POSIX (dev / gate runs): a writable sandbox path, never the system.
  return path.join(app.getPath("home"), ".local", "share", "memento-test");
}

function sendEvent(ev: InstallEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("setup:event", ev);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    // 2.0.6 (field feedback): the window IS the design — one opaque
    // 900×640 canvas, square corners, no transparent margin, no painted
    // outer glow. The old 960×730 transparent canvas + the panel's CSS
    // drop-shadow read as a dark halo around the window on real desktops.
    // fitStage now scales 1:1 at this exact content size.
    width: 900,
    height: 640,
    useContentSize: true,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false, // the design draws its own title bar
    transparent: false,
    roundedCorners: false, // square corners: the hairline border is the edge
    hasShadow: true, // native OS shadow only — no CSS glow outside the panel
    title: "MEMENTO Setup",
    show: false,
    autoHideMenuBar: true,
    icon: (() => {
      const candidates = [
        path.join(__dirname, "..", "build", "icon.ico"),
        path.join(__dirname, "..", "build", "icon.png"),
      ];
      for (const p of candidates) if (fs.existsSync(p)) return p;
      return undefined;
    })(),
    backgroundColor: "#070c09", // opaque — the darkest tone of the design gradient
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.on("page-title-updated", (e) => e.preventDefault());
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

/* ------------------------------------------------------------------ */
/* Windows touchpoints for installerCore                               */
/* ------------------------------------------------------------------ */

function writeShortcut(
  lnkPath: string,
  exePath: string,
  args: string | null,
  description: string
): "created" | "skipped" | "failed" {
  try {
    if (!IS_WIN) {
      // POSIX gate/dev runs: write a .desktop stub so the pipeline is
      // observable outside Windows too.
      try {
        fs.writeFileSync(
          lnkPath,
          ["[Desktop Entry]", "Type=Application", `Name=${description.split("—")[0].trim()}`, `Exec="${exePath}" ${args ?? ""}`.trim(), "Terminal=false"].join("\n"),
          "utf8"
        );
        return "created";
      } catch {
        return "skipped";
      }
    }
    const okFlag = shell.writeShortcutLink(lnkPath, "create", {
      target: exePath,
      args: args ?? "",
      description,
      icon: exePath,
      iconIndex: 0,
    });
    return okFlag ? "created" : "failed";
  } catch {
    return "failed";
  }
}

async function writeUninstallRegistration(info: {
  DisplayName: string;
  DisplayVersion: string;
  Publisher: string;
  InstallLocation: string;
  DisplayIcon: string;
  UninstallString: string;
  QuietUninstallString: string;
  NoModify: number;
  NoRepair: number;
  EstimatedSizeKB: number;
  UninstallPreservesUserData: number;
}): Promise<void> {
  if (!IS_WIN) {
    // POSIX gate runs: persist the registration beside the install so the
    // smoke can assert the EXACT fields Windows would write. 2.0.7: MERGE
    // with an existing ownership sentinel (installerCore may already have
    // written inPlace + files) — field order must never matter.
    const twinPath = path.join(info.InstallLocation, ".memento-uninstall.json");
    let merged: Record<string, unknown> = {};
    try {
      merged = JSON.parse(fs.readFileSync(twinPath, "utf8"));
    } catch {
      /* no sentinel yet */
    }
    fs.writeFileSync(twinPath, JSON.stringify({ ...merged, ...info }, null, 2), "utf8");
    return;
  }
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MEMENTO";
  const pairs: Array<[string, string]> = [
    ["DisplayName", info.DisplayName],
    ["DisplayVersion", info.DisplayVersion],
    ["Publisher", info.Publisher],
    ["InstallLocation", info.InstallLocation],
    ["DisplayIcon", info.DisplayIcon],
    ["UninstallString", info.UninstallString],
    ["QuietUninstallString", info.QuietUninstallString],
    ["NoModify", String(info.NoModify)],
    ["NoRepair", String(info.NoRepair)],
    ["EstimatedSize", String(info.EstimatedSizeKB)],
    ["SystemComponent", "0"],
  ];
  for (const [name, value] of pairs) {
    await new Promise<void>((resolve) => {
      execFile("reg", ["add", key, "/v", name, "/d", value, "/f"], { windowsHide: true }, () => resolve());
    });
  }
}

function removeUninstallRegistration(): void {
  if (!IS_WIN) return;
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MEMENTO";
  execFile("reg", ["delete", key, "/f"], { windowsHide: true }, () => {});
}

function closeRunningApp(): boolean {
  if (!IS_WIN) return false;
  try {
    execFileSync("taskkill", ["/F", "/IM", EXE_NAME, "/T"], { windowsHide: true, timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** True when this process runs with an elevated (admin) token — the
 *  normal case now that the portable stub requests requireAdministrator. */
let elevatedCache: boolean | null = null;
function isElevatedWindows(): boolean {
  if (!IS_WIN) return false;
  if (elevatedCache !== null) return elevatedCache;
  try {
    execFileSync("net", ["session"], { windowsHide: true, stdio: "ignore", timeout: 5_000 });
    elevatedCache = true;
  } catch {
    elevatedCache = false;
  }
  return elevatedCache;
}

/** 2.0.3 — the wizard runs ELEVATED (requireAdministrator). A directly
 *  spawned child would INHERIT the admin token, so MEMENTO — and the
 *  proxy cores it supervises — would run as admin without needing to.
 *  Spawning through the unelevated shell (explorer.exe) drops the
 *  token; the direct spawn remains for the non-elevated (dev/POSIX)
 *  case. Best-effort either way: the desktop shortcut always works. */
function launchInstalledApp(exe: string, cwd: string): void {
  if (IS_WIN && isElevatedWindows()) {
    try {
      const shellChild = spawn("explorer.exe", [exe], { detached: true, stdio: "ignore" });
      shellChild.unref();
      return;
    } catch {
      /* explorer unavailable — fall through to the direct spawn */
    }
  }
  try {
    const child = spawn(exe, [], { cwd, detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    /* best-effort — the user can start MEMENTO from the shortcut */
  }
}

/* ------------------------------------------------------------------ */
/* IPC surface (the renderer's setupAPI)                               */
/* ------------------------------------------------------------------ */

function registerIpc(): void {
  ipcMain.handle("setup:ctx", () => {
    const meta = payloadMeta();
    const dest = defaultDestDir();
    const mode = installMode();
    // runtime-reuse: the meters must show the FULL installed footprint
    // (payload + the installer's own runtime), not just the payload.
    const runtimeEntries = mode === "runtime-reuse" ? runtimeFileEntries() : null;
    const runtimeBytes = runtimeEntries
      ? runtimeEntries.reduce((a, b) => a + b.bytes, 0)
      : 0;
    const payloadStat = (() => {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "payload-manifest.json"), "utf8"));
        return { fileCount: m.fileCount, totalBytes: m.totalBytes };
      } catch {
        // compute live (small delay on first dev run, cached afterwards)
        return { fileCount: 0, totalBytes: 0 };
      }
    })();
    return {
      appVersion: meta.appVersion || APP_VERSION,
      setupVersion: SETUP_VERSION,
      defaultDir: dest,
      freeBytes: freeDiskBytes(dest),
      payload: {
        fileCount: payloadStat.fileCount + (runtimeEntries?.length ?? 0),
        totalBytes: payloadStat.totalBytes + runtimeBytes,
      },
      cores: meta.cores || {},
      mode,
    };
  });

  ipcMain.handle("setup:statPath", (_e, args: { path?: unknown }) => {
    const p = String(args?.path || "").trim();
    const validity = validateDestPath(p, IS_WIN);
    return {
      valid: validity.ok,
      reason: validity.reason,
      freeBytes: validity.ok ? freeDiskBytes(p) : null,
    };
  });

  ipcMain.handle("setup:chooseDir", async (_e, args: { current?: unknown }) => {
    const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const res = await dialog.showOpenDialog(w!, {
      title: "Choose where MEMENTO is installed",
      defaultPath: String(args?.current || defaultDestDir()),
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle("setup:start", async (_e, args: { destDir?: unknown; createDesktopShortcut?: unknown }) => {
    const destDir = String(args?.destDir || "").trim();
    if (installBusy) return false;
    installBusy = true;
    cancelRequested = false;
    try {
      // The install must read from the PRIVATE staged payload — the temp
      // extraction dir can be wiped by a second launch at ANY moment.
      if (staging?.promise) {
        try {
          await staging.promise;
        } catch {
          /* fall back to the live payload below */
        }
      }
      const result = await runInstall(
        { destDir, createDesktopShortcut: !!args?.createDesktopShortcut },
        {
          isWin: IS_WIN,
          appVersion: payloadMeta().appVersion || APP_VERSION,
          payloadDir: installPayloadDir(),
          coreVersions: payloadMeta().cores || {},
          mode: installMode(),
          runtimeDir: () => path.dirname(process.execPath),
          runtimeFiles: runtimeFileEntries,
          runtimeExePath: () => process.execPath,
          desktopDir: () => {
            try {
              return app.getPath("desktop");
            } catch {
              return path.join(app.getPath("home"), "Desktop");
            }
          },
          startMenuDir: () =>
            IS_WIN
              ? path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs")
              : path.join(app.getPath("home"), ".local", "share", "applications"),
          writeShortcut,
          writeUninstallRegistration,
          removeUninstallRegistration,
          closeRunningApp: () => closeRunningApp(),
          onEvent: sendEvent,
          cancelled: () => cancelRequested,
        }
      );
      lastResult = result;
      return result.ok;
    } finally {
      installBusy = false;
    }
  });

  ipcMain.handle("setup:cancel", () => {
    cancelRequested = true;
    return true;
  });

  ipcMain.handle("setup:launch", () => {
    const dest = lastResult?.destDir || defaultDestDir();
    const exe = path.join(dest, EXE_NAME);
    launchInstalledApp(exe, dest);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    app.quit();
    return true;
  });

  ipcMain.handle("setup:minimize", () => {
    mainWindow?.minimize();
    return true;
  });

  ipcMain.handle("setup:close", () => {
    void requestClose();
    return true;
  });

  // Field report #3 (2.0.5) — remediation helpers for the error row.
  // Read-only OS touchpoints: we OPEN Windows Security and put candidate
  // exclusion paths on the clipboard. The setup still NEVER modifies
  // Defender settings itself (that contract is pinned by the H8 gates).
  ipcMain.handle("setup:openDefender", async () => {
    try {
      await shell.openExternal("ms-settings:windowsdefender");
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("setup:copyPayloadPaths", () => {
    const lines = [
      "Add these folders to your antivirus exclusions",
      "(Windows Security → Virus & threat protection → Manage settings → Exclusions → Add an exclusion → Folder):",
      "",
      path.dirname(process.execPath) + "   ← the running setup's own extraction folder (contains the payload)",
      stagingBase() + "   ← the setup's private staging folder",
      (lastResult?.destDir || defaultDestDir()) + "   ← the MEMENTO install destination",
      "",
      "Then open Windows Security → Protection history, Allow/Restore the removed MEMENTO file, and re-run this setup.",
    ];
    const text = lines.join("\n");
    try {
      clipboard.writeText(text);
      return text;
    } catch {
      return text; // clipboard may be blocked — renderer falls back to display
    }
  });
}

/** Close = abort while installing (with a real confirm), instant otherwise. */
async function requestClose(): Promise<void> {
  if (installBusy) {
    const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const choice = await dialog.showMessageBox(w!, {
      type: "warning",
      title: "MEMENTO Setup",
      message: "Cancel the installation?",
      detail: "The wizard is still copying files. Canceling leaves MEMENTO uninstalled.",
      buttons: ["Continue installing", "Cancel setup"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice.response === 0) return;
    cancelRequested = true;
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.quit();
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    startPayloadStaging();
  });
  app.on("window-all-closed", () => {
    disposeStaging();
    app.quit();
  });
  app.on("will-quit", disposeStaging);
}
