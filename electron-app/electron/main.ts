/**
 * MEMENTO — Electron main process.
 *
 * Electron port of the Tauri runtime configuration (tauri.conf.json +
 * lib.rs `run()` + main.rs):
 *
 *  - Frameless window (decorations:false -> frame:false), 1280x820,
 *    min 480x600, centered, resizable, title "MEMENTO — from EPODONIOS to A Who"
 *  - The renderer draws its own title bar (TitleBar.tsx) and drives
 *    minimize/maximize/close via the preload bridge.
 *  - dragDropEnabled:false -> will-navigate is blocked (dropping a file can
 *    never navigate the window away from the app).
 *  - CSP null (same as Tauri — no meta CSP injected).
 *  - WindowEvent::Destroyed cleanup -> win 'closed' + app quit hooks:
 *    stop xray, clear system proxy, kill orphaned xray.exe. This is what
 *    guarantees xray never survives the app closing.
 *  - Phase D4: tray + Close-to-tray (see tray.ts). Closing the window now
 *    HIDES it (VPN survives the X button) unless close-to-tray is disabled
 *    in Settings or the tray itself is unavailable; the tray menu's Quit,
 *    and every OS-initiated quit, bypass the interception via `quitting`.
 */
import { app, BrowserWindow, dialog } from "electron";
import path from "path";
import os from "os";
import fs from "fs";
import { execFile, execFileSync, spawn } from "child_process";
import {
  isUninstallInvocation,
  isQuietUninstall,
  buildPlan,
  selfDeleteCommand,
  readOwnershipSentinel,
  inPlaceSelfDeleteCommand,
  otherMementoPids,
  terminateCommand,
} from "./uninstall";
import { registerIpcHandlers, describeXraySetup } from "./ipc";
import { readLastActivePorts } from "./xray";
import { cleanupAllCores } from "./cores";
import { isAnyCoreRunning } from "./coreOps";
import { isWindows, readProxyState } from "./proxy";
import {
  markQuitting,
  isKillSwitchArmed,
  resolveAuditAction,
  applyAuditAction,
  blockOnRoutingExit,
  resolveRoutingAuditAction,
  applyRoutingAuditAction,
  KILL_SWITCH_BLOCKED_PORT,
} from "./killSwitch";
import { resourceRoot, findXray, findSingBox } from "./paths";
import { applyHotkeyRegistration, loadAppPrefs, unregisterHotkeys, isSilentLaunch } from "./appPrefs";
import { createTray, destroyTray, trayExists, showCloseToTrayBalloonOnce } from "./tray";
import { isHelperInvocation, runHelperInvocation } from "./routingHelper";
import { createRoutingManager } from "./routingManager";
import { getActiveCore } from "./cores";
import { xrayManager } from "./xray";
import { singBoxManager } from "./singbox";
import { aetherManager } from "./aether";
import { initMementoLogger, logInfo, logWarn, logException } from "./logger";

// Keep the SAME persistent data dir the Tauri build used
// (%APPDATA%/com.epodonios.memento) so existing installs keep their
// downloaded xray.exe, geoip.dat/geosite.dat and active config.
// Must be set before app 'ready'.
try {
  app.setPath("userData", path.join(app.getPath("appData"), "com.epodonios.memento"));
} catch {
  /* ignore — fall back to default userData */
}

// 3.1.8 (user request #4): the logging & error management system. The
// FIRST thing that comes up — every later error (main, core children,
// renderer via the log_event bridge) lands in one structured pipeline:
// <userData>/logs/memento-YYYY-MM-DD.log + the in-memory recent tail.
try {
  initMementoLogger(path.join(app.getPath("userData"), "logs"));
} catch (e) {
  try { console.warn("[MEMENTO] logger init failed:", e); } catch { /* ignore */ }
}

/**
 * Phase B2: the GUI-side owner of the TUN routing session (the B1
 * machinery's wiring layer). ELECTRON-FREE factory — every path/exe/
 * platform/kill-switch read is injected here; the ACTIVE core's SOCKS
 * inbound is resolved from the three managers' live statuses, because
 * the tunnel feeds on exactly that inbound (D1 topology).
 *
 * Created at module level (after the userData override) so BOTH the IPC
 * handlers and every quit path (cleanupOnce) share ONE instance — the
 * launch bookkeeping (lastSessionDir/launchPending) must be identical
 * everywhere.
 */
const routingManager = createRoutingManager({
  getUserDataDir: () => app.getPath("userData"),
  getPlatform: () => process.platform,
  getExePath: () => process.execPath,
  getActiveSocks: () => {
    const core = getActiveCore();
    if (!core) return null;
    const st =
      core === "xray"
        ? xrayManager.getStatus()
        : core === "sing-box"
          ? singBoxManager.getStatus()
          : aetherManager.getStatus();
    return st.running && st.socks_port > 0
      ? { host: "127.0.0.1", port: st.socks_port }
      : null;
  },
  isKillSwitchArmed,
  // Phase B3 (C5 fusion): the TUN death transition fires the kill
  // switch's blocked write — the C5 invariant for the TUN tunnel type,
  // enforced main-side without any renderer dependency.
  onRoutingLiveLost: blockOnRoutingExit,
});

// Single-instance enforcement (approved fix): the Tauri build technically
// allowed multiple instances, but two MEMENTO processes share the same
// userData dir, the same system-proxy registry keys and — worst of all —
// each start_xray runs `taskkill /F /IM xray.exe /T` to clear orphans, so
// the second instance's connect SILENTLY KILLED the first instance's live
// VPN (instance war). A second launch now focuses the existing window
// instead of starting a competing process.
//
// Phase B1: the routing helper (--routing-helper / --repair-network) is
// ALSO a second process of this exe — the ELEVATED one. It must NEVER
// acquire this lock (the un-elevated GUI owns it), never create a
// window/tray/hotkeys/cores, never touch the system proxy: the
// process-based loop prevention (D6). argv is therefore checked BEFORE
// the lock request, and every normal-app lifecycle hook below is guarded
// by HELPER_MODE.
let gotSingleInstanceLock = true;
const HELPER_MODE = isHelperInvocation(process.argv);
const UNINSTALL_MODE = isUninstallInvocation(process.argv);
if (HELPER_MODE) {
  void startRoutingHelperMode();
} else if (UNINSTALL_MODE) {
  // The uninstaller is its own headless MEMENTO.exe process — it must
  // neither fight the running GUI for the single-instance lock nor boot
  // any normal-app lifecycle. See startUninstallMode below.
  void startUninstallMode();
} else {
  gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    logWarn("main", "second instance refused the single-instance lock — focusing the existing window");
    app.quit();
  }
}

/**
 * The complete uninstaller (`--memento-uninstall`, registered by
 * MementoSetup in Add/Remove Programs). Headless — no window, no tray, no
 * lock. REMOVES program files + shortcuts + the ARP entry; PRESERVES
 * userData (profiles/subscriptions/settings) exactly as the wizard's
 * Notes step promises. The final directory delete runs DETACHED because
 * Windows cannot delete its own running executable.
 */
async function startUninstallMode(): Promise<void> {
  await app.whenReady();
  const isWin = process.platform === "win32";
  try {
    const plan = buildPlan({
      isWin,
      exePath: process.execPath,
      desktopDir: app.getPath("desktop"),
      startMenuDir: isWin
        ? path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs")
        : path.join(app.getPath("home"), ".local", "share", "applications"),
      userDataDir: app.getPath("userData"),
    });
    const quiet = isQuietUninstall(process.argv);

    if (!quiet) {
      const confirm = await dialog.showMessageBox({
        type: "question",
        title: "Uninstall MEMENTO",
        message: "Uninstall MEMENTO?",
        detail:
          "Program files, shortcuts and the Add/Remove Programs entry are removed.\n\n" +
          "Your profiles, subscriptions and settings are PRESERVED " +
          "(" + plan.preservedUserData + ") — a reinstall picks up exactly where you left off.",
        buttons: ["Uninstall", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (confirm.response !== 0) {
        app.exit(0);
        return;
      }
    }

    // 1 — stop the cores (children die BEFORE the GUI processes that own them)
    try {
      cleanupAllCores();
    } catch {
      /* best-effort */
    }

    // 2 — every OTHER MEMENTO.exe must die (a running GUI locks the dir;
    // the naive taskkill /IM would kill THIS uninstaller too).
    try {
      const listOutput = execFileSync(
        isWin ? "tasklist" : "ps",
        isWin
          ? ["/FI", `IMAGENAME eq ${plan.exeName}`, "/FO", "CSV", "/NH"]
          : ["-eo", "comm=,pid="],
        { encoding: "utf8", timeout: 15_000, windowsHide: true }
      );
      for (const pid of otherMementoPids({
        exeName: plan.exeName,
        ownPid: process.pid,
        isWin,
        listOutput,
      })) {
        const { cmd, args } = terminateCommand(pid, isWin);
        try {
          execFileSync(cmd, args, { timeout: 15_000, windowsHide: true });
        } catch {
          /* already gone — fine */
        }
      }
    } catch {
      /* best-effort — the detached rmdir retries nothing, but a locked
       * dir is only ever stale files, never user data. */
    }

    // 3 — shortcuts
    for (const lnk of plan.shortcuts) {
      try {
        fs.rmSync(lnk, { force: true });
      } catch {
        /* best-effort */
      }
    }

    // 4 — Add/Remove Programs registration
    if (plan.registryKey && isWin) {
      await new Promise<void>((resolve) => {
        execFile("reg", ["delete", plan.registryKey!, "/f"], { windowsHide: true }, () => resolve());
      });
    }

    // 5 — detached self-delete (userData NEVER touched).
    // 3.1.8 (field report #4): when the install lives IN PLACE inside a
    // foreign folder (the setup's ownership sentinel says so), only the
    // recorded files are deleted — the folder itself and every foreign
    // file in it survive. Owned installs keep the whole-dir contract.
    const ownership = readOwnershipSentinel(plan.installDir);
    const { cmd, args } = ownership
      ? inPlaceSelfDeleteCommand(plan.installDir, ownership.files, isWin, (name, content) => {
          const p = path.join(os.tmpdir(), name);
          fs.writeFileSync(p, content, "utf8");
          return p;
        })
      : selfDeleteCommand(plan.installDir, isWin);
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
    } catch {
      /* best-effort */
    }

    if (!quiet) {
      dialog.showMessageBox({
        type: "info",
        title: "MEMENTO",
        message: "MEMENTO was uninstalled.",
        detail:
          "Your profiles, subscriptions and settings are kept in " +
          plan.preservedUserData +
          ". Reinstalling MEMENTO restores everything.",
        buttons: ["OK"],
        noLink: true,
      });
      setTimeout(() => app.exit(0), 800);
    } else {
      app.exit(0);
    }
  } catch (e) {
    console.error(`[MementoUninstall] fatal: ${String(e)}`);
    app.exit(1);
  }
}

/** Phase B1: the headless elevated helper. Runs the helper invocation to
 *  completion, then exits the process with its code. No window, no tray,
 *  no IPC, no cores — the session directory is the only I/O surface. */
async function startRoutingHelperMode(): Promise<void> {
  await app.whenReady();
  try {
    const code = await runHelperInvocation(process.argv, {
      userDataDir: app.getPath("userData"),
      resourceRootDir: resourceRoot(),
      platform: process.platform,
      findEngine: findSingBox,
      log: (line) => console.log(line),
    });
    app.exit(code);
  } catch (e) {
    console.error(`[MementoTunHelper] fatal: ${String(e)}`);
    app.exit(1);
  }
}

const WINDOW_TITLE = "MEMENTO — from EPODONIOS to A Who";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let cleanedUp = false;
// Set by before-quit / the tray Quit item (app.quit()): while true the
// 'close' handler below must NOT intercept — a quitting user gets a real
// quit, never a hide.
let quitting = false;

function windowIcon(): string | undefined {
  // Packaged builds: electron-builder embeds build/icon.ico into the exe and
  // Windows uses the exe's icon for the taskbar automatically. Dev builds:
  // point at the generated ico / the Tauri source icons.
  if (app.isPackaged) return undefined;
  const candidates = [
    path.join(__dirname, "..", "build", "icon.ico"),
    path.join(__dirname, "..", "..", "src-tauri", "icons", "128x128.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 600,
    center: true,
    resizable: true,
    fullscreenable: true,
    frame: false, // Tauri: decorations:false — custom title bar in React
    title: WINDOW_TITLE,
    show: false,
    autoHideMenuBar: true,
    icon: windowIcon(),
    backgroundColor: "#020617", // surface-950 — avoids white flash on load
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // required by the migration spec
      nodeIntegration: false, // required by the migration spec
      spellcheck: false,
    },
  });

  // Keep the Tauri window title (index.html's <title> would override it).
  mainWindow.on("page-title-updated", (e) => e.preventDefault());

  // dragDropEnabled:false parity + hardening: the window must never navigate.
  mainWindow.webContents.on("will-navigate", (e) => {
    if (DEV_SERVER_URL && e.url.startsWith(DEV_SERVER_URL)) return;
    e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Notify the renderer so TitleBar can refresh its maximize/restore icon —
  // the equivalent of the Tauri `Window.onResized` listener.
  const notifyResized = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("memento:window-resized");
    }
  };
  mainWindow.on("resize", notifyResized);
  mainWindow.on("maximize", notifyResized);
  mainWindow.on("unmaximize", notifyResized);

  // Render only when ready — same perceived startup as the Tauri build.
  // Phase D4: a login-item launch carries `--hidden`; now that the tray
  // EXISTS the silent launch is fully HIDDEN (tray icon / Ctrl+Alt+V / a
  // second launch bring it back). If the tray could not be created, fall
  // back to the D3 behavior (minimized — a hidden window with no tray
  // would strand the user).
  mainWindow.once("ready-to-show", () => {
    if (isSilentLaunch()) {
      if (trayExists()) mainWindow?.hide();
      else mainWindow?.minimize();
    } else {
      mainWindow?.show();
    }
  });

  // Phase D4: Close-to-tray. The X button hides the window instead of
  // quitting — closing a VPN manager by accident must not silently kill a
  // live VPN. Interception requires (a) closeToTray enabled in prefs and
  // (b) a tray that actually exists (otherwise hide() would strand the
  // user with no way back in). The FIRST intercepted close fires the
  // one-time "still running" balloon (see tray.ts).
  mainWindow.on("close", (e) => {
    if (quitting) return;
    const prefs = loadAppPrefs();
    if (!prefs.closeToTray || !trayExists()) return; // classic quit
    e.preventDefault();
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) w.hide();
    showCloseToTrayBalloonOnce();
  });

  // WindowEvent::Destroyed cleanup equivalent.
  mainWindow.on("closed", () => {
    mainWindow = null;
    cleanupOnce();
  });

  // Windows shutdown / restart / logoff (D4 review). Electron 44 fires the
  // win32-only WINDOW-level 'session-end' here and then terminates the
  // process — the app-level 'before-quit' is NOT guaranteed on this path
  // (and the old app-level 'session-end' event no longer exists in the
  // typings; the hole itself is inherited from the Tauri build, whose
  // WindowEvent::Destroyed never fired on session end either). The dispatch
  // is a normal JS turn, so the SAME fully-synchronous cleanup runs here
  // (kill all three cores + clear our system proxy) before the OS pulls the
  // plug. The session end cannot (and must not) be prevented — we also
  // deliberately do NOT touch the cancelable 'query-session-end', so a
  // user's shutdown is never blocked; this only stops a normal shutdown
  // from dangling ProxyEnable=1 at 127.0.0.1:<our port>. Works while the
  // window is HIDDEN too — session messages arrive regardless of
  // visibility. Hard kills (Task Manager TerminateProcess, power loss) stay
  // physically uncoverable in-process; the F9 startup audit + the orphan
  // sweep in every start path remain the backstop for those.
  mainWindow.on("session-end", () => {
    quitting = true;
    markQuitting(); // C5: latch the kill switch BEFORE any child can die
    cleanupOnce();
  });

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function cleanupOnce(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    // Phase B2 (D6): tell the elevated helper to tear down NOW — a
    // synchronous control.json write, then the D6 gui-pid watchdog
    // remains the guaranteed backstop for every death path.
    routingManager.requestStopBestEffort();
  } catch {
    /* best-effort — never block shutdown */
  }
  try {
    // Task 11: BOTH managers (stop children, clear proxy, kill orphans).
    cleanupAllCores();
  } catch {
    /* best-effort — never block shutdown */
  }
}

/**
 * F9 (approved): leftover system-proxy cleanup at startup.
 *
 * If the app crashed / was force-killed after start_xray had already set
 * the system proxy, ProxyEnable=1 keeps pointing at 127.0.0.1:<our port>
 * forever — every website then routes through a dead proxy until the user
 * manually fixes their settings. On startup (only when NO xray.exe is
 * running, so we never touch a proxy a live core owns) we clear the proxy
 * IF AND ONLY IF it points at one of OUR ports:
 *
 *   1. the real inbound ports of the LAST connection, recovered from
 *      memento-active-config.json (written by start_xray, deleted on clean
 *      stop — so its survival IS the crash signature), which covers
 *      user-configured custom ports;
 *   2. the canonical defaults 10808 (socks) / 10809 (http) as fallback for
 *      a machine that never connected.
 *
 * A proxy pointing anywhere else belongs to another VPN/proxy app and is
 * left strictly alone. Phase C5: when the kill switch is ARMED, an
 * ours-leftover is NORMALIZED to the blocked state (fail closed) instead
 * of cleared. Runs deferred so it never delays first window paint.
 */
function auditLeftoverProxy(): void {
  try {
    if (!isWindows()) return;
    if (isAnyCoreRunning()) return; // a live core may legitimately own the proxy
    const { enabled, server } = readProxyState();
    if (!enabled) return;
    const m = server.match(/^127\.0\.0\.1:(\d+)$/);
    if (!m) return;
    const port = Number(m[1]);
    // Phase C5: the hands-off set is OUR ports PLUS the kill-switch blocked
    // port itself (a blocked residue is this app's own crash state, not a
    // foreign setting).
    const ourPorts = new Set([10808, 10809, ...readLastActivePorts()]);
    const action = resolveAuditAction(
      isKillSwitchArmed(),
      port,
      new Set([...ourPorts, KILL_SWITCH_BLOCKED_PORT])
    );
    if (action === "leave") return; // foreign proxy — hands off, always
    applyAuditAction(action);
    if (!app.isPackaged) {
      console.log(`[MEMENTO] leftover system proxy (was ${server}) -> ${action}`);
    }
  } catch {
    /* best-effort — never block startup */
  }
}

/**
 * Phase B3 (C5/F9 fusion): the TUN half of the startup audit.
 *
 * The proxy audit above covers the SOCKS leg; a VPN Device session that
 * died un-teardown'd (power loss / force kill / helper crash) leaves a
 * DIFFERENT residue: the recovery marker (memento-routing-recovery.json)
 * plus possibly a stale MementoTun adapter. For an ARMED user that
 * marker is evidence of an interrupted PROTECTED session: fail closed by
 * normalizing the system proxy to the blocked state — the same contract
 * as the armed SOCKS leftover. Guards, in order:
 *   - win32 only (the whole TUN feature is win32);
 *   - never while a core is running (a live core owns the proxy leg —
 *     its own C5 enforcement is active; this audit must not race it);
 *   - never against a FRESH-live helper status (an orphan elevated
 *     helper may still own a live adapter — the GUI surfaces that
 *     session and the user's disconnect/repair owns the transitions);
 *   - never when the proxy leg is already ENABLED (the proxy audit
 *     above already normalized an ours-leftover to blocked, and a
 *     foreign enabled proxy stays hands-off — this audit adds nothing);
 *   - and NEVER anything that clears — this audit only ever BLOCKS.
 * Runs in the SAME deferred tick as auditLeftoverProxy, right after it
 * (ordering: the proxy leg is normalized first; this audit then only
 * ever blocks a DISABLED leg).
 */
function auditLeftoverRoutingSession(): void {
  try {
    if (!isWindows()) return;
    if (isAnyCoreRunning()) return; // a live core owns the proxy leg
    const { markerActive, helperLiveFresh } = routingManager.getLeftoverAuditState();
    if (!markerActive || helperLiveFresh) return;
    if (readProxyState().enabled) return; // owned by the proxy audit above
    const action = resolveRoutingAuditAction(
      isKillSwitchArmed(),
      markerActive,
      helperLiveFresh
    );
    if (action === "leave") return;
    applyRoutingAuditAction(action);
    if (!app.isPackaged) {
      console.log(
        "[MEMENTO] leftover VPN Device session (kill switch armed) -> system proxy blocked"
      );
    }
  } catch {
    /* best-effort — never block startup */
  }
}

app.whenReady().then(() => {
  if (HELPER_MODE) return; // the helper runs its own lifecycle above
  if (UNINSTALL_MODE) return; // the uninstaller runs its own lifecycle above
  if (!gotSingleInstanceLock) return; // quit() already in progress

  // 3.1.8: lifecycle breadcrumbs — the log tells the whole story of a
  // session (ready, prefs, tray) without any noise.
  logInfo("main", `app ready — v${app.getVersion()} · electron ${process.versions.electron ?? "?"} · ${process.platform}`);

  // A second launcher attempt was rejected by the lock — bring the
  // existing window to the front so the behavior feels deliberate.
  // Phase D4: show() was added because with Close-to-tray the window is
  // routinely HIDDEN (not just minimized) — focus() alone would do
  // nothing visible for a hidden window.
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });

  registerIpcHandlers(routingManager);

  // Phase D3 (item 4): global hotkeys — registered by the MAIN process at
  // boot from the persisted prefs file (no renderer round-trip needed).
  applyHotkeyRegistration(loadAppPrefs());

  // Phase D4: the tray must exist BEFORE the window can ever be hidden —
  // both the silent launch and the close interception gate on trayExists().
  createTray();

  // F9: deferred so window creation is never delayed; see auditLeftoverProxy.
  // Phase B3: the TUN residue audit runs in the SAME deferred tick, right
  // after the proxy leg (see auditLeftoverRoutingSession for the order).
  setTimeout(() => {
    auditLeftoverProxy();
    auditLeftoverRoutingSession();
  }, 300);

  // Phase B3 (C5 fusion): the main-side routing watchdog. The renderer's
  // 2 s routing_status poll only runs while the Aether tab is MOUNTED —
  // the kill-switch transition enforcement (blockOnRoutingExit on a
  // live -> terminal/stale flip) and the UAC self-heal must NEVER depend
  // on which tab is open, or on a hidden window at all. Two ticks of
  // silence after a helper heartbeat loss is well inside the 30 s
  // staleness budget. unref'd: the timer must never hold the process
  // open; during a quit the kill-switch latch makes any late fire a
  // no-op.
  const routingWatchdog = setInterval(() => {
    try {
      routingManager.getRoutingStatus();
    } catch {
      /* best-effort — the next tick retries */
    }
  }, 2_000);
  routingWatchdog.unref?.();

  if (!app.isPackaged) {
    // Helpful dev diagnostics (dev builds only — release stays silent like
    // the Rust windows_subsystem="windows" binary).
    const xray = findXray();
    console.log("[MEMENTO] resource root:", resourceRoot());
    console.log("[MEMENTO] xray:", xray || "not found (will auto-download)");
    console.log("[MEMENTO] cores:", describeXraySetup());
  }

  createWindow();
  logInfo("main", "main window created");

  app.on("activate", () => {
    // macOS dock click — recreate the window if none exist.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  // Phase B1: the elevated helper must NEVER run the normal-app cleanup —
  // cleanupAllCores would kill the GUI's live cores (the very upstream the
  // tunnel feeds on) from an elevated process. The helper tears down its
  // OWN engine in routingHelper.teardown only. Same rule for the
  // uninstaller (it owns its own teardown sequence).
  if (HELPER_MODE || UNINSTALL_MODE) return;
  // Flip FIRST: the window 'close' handler checks this flag — without it a
  // quit while close-to-tray is on would hide the window instead of quit.
  quitting = true;
  markQuitting(); // C5: latch the kill switch BEFORE cleanup (quit -> direct)
  destroyTray();
  unregisterHotkeys();
  cleanupOnce();
});
app.on("window-all-closed", () => {
  if (HELPER_MODE || UNINSTALL_MODE) return;
  // Since D4 the window is only ever DESTROYED on a real quit (Close-to-tray
  // hides instead of closing; tray Quit / OS shutdown set quitting first),
  // so this remains the classic full-teardown path.
  unregisterHotkeys();
  cleanupOnce();
  app.quit();
});

// Last-resort safety net: even a crash must not leave xray + system proxy
// dangling. (Node's process exit handlers are best-effort on crash paths,
// but the orphan-killer at next startup covers the remainder.)
// Phase B1: never in helper mode — same rule as before-quit above.
process.on("exit", () => {
  if (!HELPER_MODE && !UNINSTALL_MODE) cleanupOnce();
});
