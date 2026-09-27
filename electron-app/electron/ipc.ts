/**
 * MEMENTO — IPC registration — the Electron equivalent of Tauri's
 * `invoke_handler(tauri::generate_handler![...])`.
 *
 * Command names are kept IDENTICAL to the Tauri commands so the frontend
 * bridge (`src/utils/tauriBridge.ts`) can pass them through unchanged:
 *
 *   check_xray, download_xray, start_xray, stop_xray, get_xray_status,
 *   get_xray_logs, get_xray_traffic, set_system_proxy, clear_system_proxy,
 *   tcp_ping_batch, launch_spoofing_patt
 *
 * Argument names are the camelCase keys the React code already sends
 * (configJson, socksPort, httpPort, apiPort, targets, timeoutMs).
 * Error semantics match Tauri: a rejected invoke whose payload is the
 * message string the UI shows in toasts.
 */
import { BrowserWindow, ipcMain, app, session, shell, dialog } from "electron";
import * as dns from "node:dns";
import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
import { checkXray, findXray, findSingBox, findAether, XrayInfo, SING_BOX_VERSION, AETHER_VERSION, resourceRoot } from "./paths";
import { createAetherUpdateService } from "./aetherUpdate";
import { appUpdateInfo } from "./appUpdate";
import { downloadXray } from "./download";
import { xrayManager, XRAY_VERSION, sanitizeTrafficTags } from "./xray";
import { singBoxManager } from "./singbox";
import { aetherManager } from "./aether";
import type { AetherSettings, AetherStatusInfo } from "./aether";
import { DEFAULT_AETHER_SETTINGS } from "./aether";
import {
  detectCoreFromConfigJson,
  getActiveCore,
  setActiveCore,
  stopOtherCore,
} from "./cores";
import type { ConnectionStatus, TrafficStats } from "./coreTypes";
import type { ConnectionStatsRow } from "./coreTypes";
import {
  getConnectionStats,
  type ConnectionStatsReply,
} from "./connectionStats";
import { clearSystemProxy, setSystemProxy } from "./proxy";
import { releaseSystemProxy, enforceKillSwitchAfterPrefChange } from "./killSwitch";
import { readLastActivePorts } from "./xray";
import { tcpPingBatch, PingTarget, PingOutcome } from "./ping";
import { urlTestProbe } from "./urlTest";
import {
  updateCenterCheck,
  updateCenterList,
  updateCenterRollback,
  runUpdatePipeline,
  updateCenterPause,
  updateCenterCancel,
  type UpdateCore,
} from "./updateCenter";
import { liveConnSnapshot } from "./liveConn";
import {
  runScan,
  cancelScan,
  localSubnet,
} from "./scanner";
import {
  loadConfig as mhrvLoadConfig,
  saveConfig as mhrvSaveConfig,
  mhrvStart,
  mhrvStatus,
  mhrvStop,
  mhrvLiveStats,
  scanGoogleIps,
  scanSniCandidates,
  testRelay,
  embeddedCodeGs,
  caStatus,
  installCaToUserStore,
  removeCaFromUserStore,
  checkCaInUserStore,
  mhrvConfigPath,
  mhrvLogsGet,
  mhrvLogsClear,
  mhrvLogsText,
  mhrvUpdateCheck,
  type MhrvMode,
  type MhrvLogLevel,
} from "./mhrv";
import { aetherSocketRows } from "./aetherLive";
import {
  mementoLog,
  logInfo,
  logException,
  recentLogs,
  logsText,
  clearRecentLogs,
  mementoLogDir,
  type MementoLogLevel,
} from "./logger";
import { geoStatus, geoEnsure } from "./geoFiles";
import { launchSpoofingPatt } from "./spoofing";
import { rebuildMenu, updateTrayStatus } from "./tray";
import {
  loadAppPrefs, saveAppPrefs, applyHotkeyRegistration, hotkeysActive,
  getAutostartStatus, setAutostart, sanitizePrefsPatch, type AppPrefs,
} from "./appPrefs";
import type { RoutingManager } from "./routingManager";

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Rust parity: Tauri typed these arguments as u16, so out-of-range or
 * non-integer values were rejected at the IPC boundary before the handler
 * ran. The `num()` helper silently coerced anything to a number (fallback
 * 0), losing that boundary — e.g. a corrupted store value of 99999 for a
 * port reached xray/reg.exe untouched. Restore the same boundary with a
 * clear message (0 is legal — u16 includes it, and the bind probe skips 0
 * exactly like Rust).
 */
const u16Port = (name: string, v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(
      `Invalid ${name}: ${String(v)} — must be an integer between 0 and 65535.`
    );
  }
  return n;
};

/**
 * Task 12: coerce the renderer's settings object into a strict
 * AetherSettings. Unknown fields are dropped (never forwarded), types are
 * normalized (numbers via Number, booleans via !!, enums via String + a
 * validity check that falls back to the default) — a compromised renderer
 * cannot smuggle unexpected env keys through to the core.
 */
function sanitizeAetherSettings(raw: unknown): AetherSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = { ...DEFAULT_AETHER_SETTINGS };
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const bool = (v: unknown): boolean => v === true;
  const int = (v: unknown): number => {
    const n = Number(v);
    return Number.isInteger(n) ? n : -1; // invalid markers fail validateAetherSettings
  };
  if (typeof r.protocol === "string" && ["smart", "masque", "wg", "gool"].includes(r.protocol)) {
    s.protocol = r.protocol as AetherSettings["protocol"];
  }
  if (typeof r.scanMode === "string" && ["turbo", "balanced", "thorough", "stealth", "ironclad"].includes(r.scanMode)) {
    s.scanMode = r.scanMode as AetherSettings["scanMode"];
  }
  if (r.socksPort !== undefined) s.socksPort = int(r.socksPort);
  s.endpoint = str(r.endpoint).slice(0, 64);
  if (typeof r.noize === "string" && ["default", "off", "light", "firewall", "balanced", "gfw", "aggressive"].includes(r.noize)) {
    s.noize = r.noize as AetherSettings["noize"];
  }
  if (typeof r.ipMode === "string" && ["v4", "v6", "both"].includes(r.ipMode)) {
    s.ipMode = r.ipMode as AetherSettings["ipMode"];
  }
  s.dns = str(r.dns).slice(0, 256);
  s.routeBlock = str(r.routeBlock).slice(0, 4096);
  s.routeDirect = str(r.routeDirect).slice(0, 4096);
  s.routesFile = str(r.routesFile).slice(0, 1024);
  s.httpProxyEnabled = bool(r.httpProxyEnabled);
  if (r.httpProxyPort !== undefined) s.httpProxyPort = int(r.httpProxyPort);
  s.upstream = str(r.upstream).slice(0, 512);
  if (typeof r.ech === "string" && ["off", "auto", "custom"].includes(r.ech)) {
    s.ech = r.ech as AetherSettings["ech"];
  }
  s.echBase64 = str(r.echBase64).slice(0, 4096);
  s.fragment = bool(r.fragment);
  s.masqueHttp2 = bool(r.masqueHttp2);
  s.quickReconnect = r.quickReconnect === undefined ? true : bool(r.quickReconnect);
  if (typeof r.logLevel === "string" && ["error", "warn", "info", "debug", "trace"].includes(r.logLevel)) {
    s.logLevel = r.logLevel as AetherSettings["logLevel"];
  }
  s.wiwOuter = str(r.wiwOuter).slice(0, 64);
  s.wiwInner = str(r.wiwInner).slice(0, 64);
  s.wgForceOuter = str(r.wgForceOuter).slice(0, 64);
  s.wgKeepalive = str(r.wgKeepalive).slice(0, 8);
  return s;
}

export function registerIpcHandlers(routing: RoutingManager): void {
  /* ---------------- core lifecycle (dual-core, Task 11) ---------------
   *
   * Command names/arguments are UNCHANGED from the Tauri build. Routing:
   * the generated config JSON itself decides the core (any outbound with
   * `type: "hysteria2" | "tuic"` → sing-box; anything else → xray), and
   * status/logs/traffic/stop follow whichever core the last start targeted.
   * Every response also carries a `core` field (additive — the existing
   * renderer ignores unknown fields; badges may read it later).
   */

  ipcMain.handle("check_xray", (): XrayInfo => {
    return checkXray();
  });

  ipcMain.handle("download_xray", async (): Promise<XrayInfo> => {
    return downloadXray();
  });

  ipcMain.handle(
    "start_xray",
    async (_e, args: {
      configJson?: unknown;
      socksPort?: unknown;
      httpPort?: unknown;
      apiPort?: unknown;
      /** Phase C4: outbound tags whose stats the connection sums (balancer
       *  pools send proxy + proxy2..N; absent/invalid -> ["proxy"]). */
      trafficTags?: unknown;
    }): Promise<ConnectionStatus> => {
      // Phase B2: the TUN session's upstream must never be swapped
      // underneath itself (same guard as aether_start below) — starting
      // another core would stopOtherCore() the tunnel's feed.
      if (routing.isSessionLive()) {
        throw new Error(
          "A VPN Device (TUN) session is active — disconnect it before connecting in SOCKS mode (the TUN session tunnels into the active core's local inbound)."
        );
      }
      const configJson = String(args?.configJson ?? "");
      const socksPort = u16Port("socksPort", args?.socksPort);
      const httpPort = u16Port("httpPort", args?.httpPort);
      const apiPort = u16Port("apiPort", args?.apiPort);
      // Phase C4: sanitize at the boundary too (defense in depth — xray.ts
      // re-sanitizes). sing-box ignores the field: its clash_api traffic is
      // cumulative across all outbounds, no per-tag accounting exists.
      const trafficTags = sanitizeTrafficTags(args?.trafficTags);

      const core = detectCoreFromConfigJson(configJson);
      // Single live core: switch off the OTHER core only if it is actually
      // running (idle other-core = no-op, legacy reconnect path untouched).
      stopOtherCore(core);
      // Tracks the ATTEMPTED core so status/logs route to the right manager
      // even when the start fails (failure logs must reach the Logs tab).
      setActiveCore(core);

      // 3.1.8: the start attempt AND its failure both land in the log
      // pipeline (user request #4) — the toast still carries the message.
      try {
        const status =
          core === "sing-box"
            ? await singBoxManager.startSingBox(configJson, socksPort, httpPort, apiPort)
            : await xrayManager.startXray(configJson, socksPort, httpPort, apiPort, trafficTags);
        logInfo("connection", `${core} started — socks ${socksPort}, http ${httpPort}, api ${apiPort}`);
        return { ...status, core };
      } catch (e) {
        logException("connection", e, `core start failed (${core})`);
        throw e;
      }
    }
  );

  ipcMain.handle("stop_xray", (): ConnectionStatus => {
    // Phase B2: a live TUN session tunnels into THIS core's inbound —
    // fire the session's control stop first (sync, best-effort), then
    // stop the core. The D6 watchdog owns the actual teardown.
    routing.requestStopBestEffort();
    const core = getActiveCore() ?? "xray";
    const status =
      core === "sing-box"
        ? singBoxManager.stopSingBox()
        : core === "aether"
          ? aetherManager.stopAether()
          : xrayManager.stopXray();
    setActiveCore(null);
    logInfo("connection", `${core} stopped`);
    return { ...status, core: null };
  });

  ipcMain.handle("get_xray_status", (): ConnectionStatus => {
    const core = getActiveCore() ?? "xray";
    const status =
      core === "sing-box"
        ? singBoxManager.getStatus()
        : core === "aether"
          ? aetherManager.getStatus()
          : xrayManager.getStatus();
    // Report the ATTEMPTED core even once it has stopped: the renderer's
    // unexpected-stop toast labels itself from this field at exactly the
    // moment `running` already flipped false (user-approved toast fix).
    return { ...status, core };
  });

  ipcMain.handle("get_xray_logs", (): string[] => {
    const core = getActiveCore() ?? "xray";
    return core === "sing-box"
      ? singBoxManager.getLogs()
      : core === "aether"
        ? aetherManager.getLogs()
        : xrayManager.getLogs();
  });

  ipcMain.handle(
    "get_xray_traffic",
    async (_e, args: { apiPort?: unknown }): Promise<TrafficStats> => {
      const apiPort = u16Port("apiPort", args?.apiPort);
      // Aether guard (honest limitation): the aether core exposes NO stats
      // API at all (verified against the official binary + --help), so the
      // cumulative-traffic counters answer zeros for an aether connection
      // instead of silently returning another core's numbers.
      if (getActiveCore() === "aether") {
        return { uplink: 0, downlink: 0 };
      }
      // Xray → short-lived `xray api statsquery` helper; sing-box → HTTP
      // GET /connections on the clash_api (same 1200 ms deadline, same
      // cumulative-bytes wire semantics).
      return getActiveCore() === "sing-box"
        ? singBoxManager.getTraffic(apiPort)
        : xrayManager.getTraffic(apiPort);
    }
  );

  // Phase E1 (additive): live per-connection stats. Same active-core
  // routing + aether guard as get_xray_traffic directly above; the rows
  // are built ENTIRELY main-side in connectionStats.ts — the clash_api
  // bearer secret is handed over in-process and NEVER crosses the IPC
  // bridge. The aggregate path above stays byte-identical.
  ipcMain.handle(
    "get_connection_stats",
    async (_e, args: { apiPort?: unknown }): Promise<ConnectionStatsReply> => {
      const apiPort = u16Port("apiPort", args?.apiPort);
      const active = getActiveCore();
      if (active === "aether") {
        // 3.1.8 (field report #5): no stats API exists on this core, but
        // the OS socket table still shows WHO aether talks to. Honest
        // "sockets" granularity — live endpoints, byte counters 0, the
        // UI labels the limitation instead of inventing numbers.
        const st = aetherManager.getStatus();
        const pid = st.pid ?? 0;
        const socks = aetherSocketRows(pid);
        const rows: ConnectionStatsRow[] = socks
          .filter((s) => s.remoteAddr && s.remoteAddr !== "*" && s.remoteAddr !== "0.0.0.0" && s.remoteAddr !== "[::]")
          .slice(0, 200)
          .map((s, i) => ({
            id: `aether-sock:${pid}:${s.localPort}:${i}`,
            label: `${s.remoteAddr}${s.remotePort ? `:${s.remotePort}` : ""}`,
            network: s.proto,
            download: 0,
            upload: 0,
            start: null,
            chains: ["aether"],
            rule: s.state || null,
            role: "socket" as string,
            sourceIp: null,
            sourcePort: String(s.localPort || ""),
          }));
        return {
          core: "aether",
          granularity: "sockets",
          connections: rows,
          totalLive: rows.length,
          totalShown: rows.length,
        };
      }
      // 3.1.8 (field report #5): no core is live but the Google Side
      // relay IS — its in-process byte counters become one honest
      // tunnel-level row ("per-outbound" shape, core "google-side").
      if (!active) {
        const mhrv = mhrvLiveStats();
        if (mhrv.running) {
          const rows: ConnectionStatsRow[] = [
            {
              id: "google-side",
              label: "google-side · relay",
              network: null,
              download: mhrv.downlink,
              upload: mhrv.uplink,
              start: null,
              chains: null,
              rule: null,
              role: "tunnel",
            },
          ];
          return {
            core: "google-side",
            granularity: "per-outbound",
            connections: rows,
            totalLive: 1,
            totalShown: 1,
          };
        }
        // Nothing is running at all — the honest empty surface.
        return { core: "xray", granularity: "none", connections: null, totalLive: 0, totalShown: 0 };
      }
      return active === "sing-box"
        ? getConnectionStats("sing-box", apiPort, singBoxManager.getClashSecret())
        : getConnectionStats("xray", apiPort, null);
    }
  );

  /* ---------------- Aether core (Task 12, SOCKS5-only) ----------------
   *
   * Four NEW additive commands — the 11 legacy commands above keep their
   * names/args byte-identical. The aether core is NOT config-driven: the
   * renderer sends the full settings object (protocol mode, scan, ports,
   * noize, DNS, routes, http-proxy, upstream, ECH, fragment, WIW hops…)
   * and the manager turns it into AETHER_* env vars (zero CLI args,
   * Aethon parity). System proxy is renderer-owned for aether — none of
   * these handlers ever touches the registry.
   */

  ipcMain.handle(
    "aether_start",
    async (_e, args: { settings?: unknown }): Promise<AetherStatusInfo> => {
      // Phase B2: same D6 guard as start_xray — the TUN session's
      // upstream must never be swapped underneath itself.
      if (routing.isSessionLive()) {
        throw new Error(
          "A VPN Device (TUN) session is active — disconnect it before connecting in SOCKS mode (the TUN session tunnels into the active core's local inbound)."
        );
      }
      const settings = sanitizeAetherSettings(args?.settings);
      // Single live core in BOTH directions (three-way stopOtherCore).
      stopOtherCore("aether");
      // Tracks the ATTEMPTED core so status/logs route to the aether
      // manager even when the start fails (failure logs reach the tab).
      setActiveCore("aether");
      try {
        const st = await aetherManager.startAether(settings);
        logInfo("aether", `started — socks ${st.socks_port}`);
        return st;
      } catch (e) {
        // Keep activeCore="aether" on failure (parity with start_xray:
        // failure logs must still route to the attempted manager).
        logException("aether", e, "aether start failed");
        throw e;
      }
    }
  );

  ipcMain.handle("aether_stop", (): AetherStatusInfo => {
    // Phase B2: stop the TUN session before its upstream (same rule as
    // stop_xray above).
    routing.requestStopBestEffort();
    const status = aetherManager.stopAether();
    if (getActiveCore() === "aether") setActiveCore(null);
    return status;
  });

  ipcMain.handle("aether_status", (): AetherStatusInfo => {
    return aetherManager.getStatus();
  });

  ipcMain.handle("aether_logs", (): string[] => {
    return aetherManager.getLogs();
  });

  /* ------------ Aether core update (Phase C6, pin-per-version) --------
   *
   * Four NEW additive commands, user-click ONLY (no timer, no boot-time
   * check exists anywhere — the offline default stays the bundled v1.9.0
   * pin). The service enforces the approved contract: the pin table
   * (electron/aether-versions.json) is the ONLY install authority, the
   * downloaded artifact must match the table's sha256 BEFORE anything is
   * written, and the RUNNING LOCK gates BOTH the check and the install
   * (the running core is never swapped underneath itself — the gate is
   * evaluated again right before the final rename).
   *
   * ISOLATION (C2 parity, user re-confirmed): the check/download path is
   * a plain DIRECT fetch inside this process — it never touches the
   * system-configuration state of the machine (no registry writes, no
   * netsh, no WinINET, no Electron session/net), so a check while the
   * VPN is up or down cannot alter a single system value.
   */
  const aetherUpdate = createAetherUpdateService({
    // The live (or grace-pending) child probe — the same truth the
    // manager's own status uses; a "connecting" spawn blocks updates too.
    isRunning: () => aetherManager.hasLiveChild(),
    binaryPath: () => findAether(),
    // The canonical bundled location: findAether's FIRST candidate wins
    // the ladder, so a swapped binary there becomes the active one.
    swapTargetDir: () => path.join(resourceRoot(), "aether"),
  });

  ipcMain.handle("aether_update_status", () => {
    return aetherUpdate.status();
  });

  /* ---------------- R3 task #3: the Update Center ----------------
   * The xray / sing-box legs of the Update Center. The Aether leg keeps
   * its stricter pin-per-version service above. Every operation is
   * user-click only; progress events fan out on update_center_progress.
   * The full download->verify->APPLY pipeline lives in updateCenter.ts —
   * the historical "downloaded but never applied" bug is structurally
   * impossible there (the button only clears after the swap succeeded). */
  ipcMain.handle("update_center_list", () => updateCenterList());

  ipcMain.handle(
    "update_center_check",
    async (_e, args: { core?: unknown }) => {
      const core = args?.core === "sing-box" ? "sing-box" : "xray";
      return updateCenterCheck(core as UpdateCore);
    }
  );

  ipcMain.handle(
    "update_center_download",
    async (_e, args: { core?: unknown; resume?: unknown }) => {
      const core = args?.core === "sing-box" ? "sing-box" : "xray";
      // 3.1.8: resume:true continues a paused download from its partial
      // file (HTTP Range); a fresh Update call always starts clean.
      return runUpdatePipeline(core as UpdateCore, undefined, { resume: args?.resume === true });
    }
  );

  // 3.1.8 (user request #6): PAUSE keeps the partial file + returns the
  // running pipeline as phase "paused"; CANCEL aborts and deletes it.
  ipcMain.handle(
    "update_center_pause",
    (_e, args: { core?: unknown }) => {
      const core = args?.core === "sing-box" ? "sing-box" : "xray";
      return updateCenterPause(core as UpdateCore);
    }
  );

  ipcMain.handle(
    "update_center_cancel",
    (_e, args: { core?: unknown }) => {
      const core = args?.core === "sing-box" ? "sing-box" : "xray";
      return updateCenterCancel(core as UpdateCore);
    }
  );

  /* ------------- 3.1.8 (user request #4): logging & errors -------------
   * ONE pipeline owns every error of the app:
   *   log_event       -> the RENDERER pushes an error/warn it caught
   *                      (window.onerror, unhandledrejection, a failed
   *                      invoke) into the SAME main-side log — files +
   *                      the recent tail. Levels are sanitized at the
   *                      boundary; message/detail are length-capped.
   *   logs_get_recent -> the in-memory recent tail for the Logs card.
   *   logs_export     -> MAIN-side save dialog (the ONLY renderer-
   *                      triggered dialog here) writing a .log JSONL.
   *   logs_open_folder-> shell.openPath on the log dir.
   *   logs_clear      -> clears the in-memory tail (files stay — they
   *                      are the forensic record).
   */
  ipcMain.handle(
    "log_event",
    (_e, args: { level?: unknown; scope?: unknown; message?: unknown; detail?: unknown }) => {
      const level: MementoLogLevel =
        args?.level === "error" || args?.level === "warn" || args?.level === "debug"
          ? args.level
          : "info";
      const scope = String(args?.scope ?? "renderer").slice(0, 64);
      const message = String(args?.message ?? "").slice(0, 2000);
      const detail = args?.detail != null ? String(args.detail).slice(0, 4000) : null;
      return mementoLog(level, scope, message, detail);
    }
  );
  ipcMain.handle("logs_get_recent", (_e, args: { limit?: unknown }) => recentLogs(args?.limit));
  ipcMain.handle("logs_clear", () => {
    clearRecentLogs();
    return { ok: true };
  });
  ipcMain.handle("logs_open_folder", async () => {
    const dir = mementoLogDir();
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch { /* best-effort */ }
    await shell.openPath(dir);
    return { ok: true };
  });
  ipcMain.handle("logs_export", async () => {
    const res = await dialog.showSaveDialog({
      title: "Export MEMENTO logs",
      defaultPath: `memento-logs-${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: "Log", extensions: ["log", "txt"] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, detail: "cancelled" };
    try {
      await fs.promises.writeFile(res.filePath, logsText(800), "utf8");
      return { ok: true, path: res.filePath };
    } catch (e: any) {
      return { ok: false, detail: String(e?.message || e) };
    }
  });

  ipcMain.handle(
    "update_center_rollback",
    (_e, args: { core?: unknown }) => {
      const core = args?.core === "sing-box" ? "sing-box" : "xray";
      return updateCenterRollback(core as UpdateCore);
    }
  );

  /* ---------------- R3 task #4: Live Connection ----------------
   * Read-only per-app socket snapshot. Every value the renderer sees is
   * normalized MAIN-SIDE from netstat/tasklist (or ss on POSIX) — the
   * renderer never spawns processes itself. */
  ipcMain.handle("live_conn_snapshot", () => liveConnSnapshot());

  /* ---------------- taskF2: the rebuilt IP Scanner v2 ----------------
   * Main-side TCP probing with bounded concurrency; targets/ports
   * validated before any socket is opened. Progress fans out on
   * scanner_progress, EVERY finished host streams on scanner_host (live
   * rows), and the full outcome returns from the invoke. A second scan
   * supersedes the first. */
  ipcMain.handle("scanner_scan", async (_e, args: Record<string, unknown>) => {
    const opts = {
      targetText: String(args?.targetText ?? "").slice(0, 100_000),
      portText: String(args?.portText ?? "").slice(0, 4_000),
      preset: args?.preset ? String(args.preset).slice(0, 24) : undefined,
      concurrency: Number(args?.concurrency) || 256,
      timeoutMs: Number(args?.timeoutMs) || 1200,
      reverseDns: !!args?.reverseDns,
      geoLookup: !!args?.geoLookup,
    };
    return runScan(
      opts,
      (ev) => {
        try {
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send("scanner_progress", ev);
          }
        } catch {
          /* best-effort */
        }
      },
      (host) => {
        try {
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send("scanner_host", host);
          }
        } catch {
          /* best-effort */
        }
      }
    );
  });
  ipcMain.handle("scanner_stop", () => {
    cancelScan();
    return { ok: true };
  });
  /* taskF2: the LAN suggestion for the one-click "scan my network". */
  ipcMain.handle("scanner_local_subnet", () => localSubnet());

  /* ---------------- R3 task #7: the in-app MHRV engine ----------------
   * Config get/set (auth-key writes never echo the key back), lifecycle,
   * the two scanners, the end-to-end relay test, the EMBEDDED Code.gs
   * (with optional auth-key injection for the one-click copy), and the
   * MITM CA status/install. */
  ipcMain.handle("mhrv_config_get", () => {
    const cfg = mhrvLoadConfig();
    return { ...cfg, authKeySet: !!cfg.authKey, authKey: undefined, configPath: mhrvConfigPath() };
  });

  ipcMain.handle("mhrv_config_set", (_e, args: Record<string, unknown>) => {
    const patch: Record<string, unknown> = {};
    const allowed: Array<string> = [
      "mode", "scriptIds", "authKey", "cfwWorkerUrl", "googleIp", "frontDomain",
      "listenPort", "socksPort", "verifySsl", "googleIpValidation",
      "maxIpsToScan", "scanBatchSize", "parallelConcurrency",
      // H-c (mhrv-rs v1.9.37 parity):
      "frontDomains", "sniPool", "shareLan", "upstreamSocks5", "parallelDispatch",
      "logLevel", "showAuthKey", "normalizeXTwitter", "youtubeThroughRelay",
      "blockQuic", "blockStun",
    ];
    for (const k of allowed) {
      if (k in args) patch[k] = args[k];
    }
    if (typeof patch.mode === "string") patch.mode = (patch.mode === "direct" ? "direct" : "apps_script") as MhrvMode;
    if (typeof patch.logLevel === "string" && !["error", "warn", "info", "debug"].includes(patch.logLevel)) {
      delete patch.logLevel; // mhrvSaveConfig falls back to the current/default value
    }
    const merged = mhrvSaveConfig(patch);
    const running = mhrvStatus().running;
    return {
      ok: true,
      config: { ...merged, authKeySet: !!merged.authKey, authKey: undefined, configPath: mhrvConfigPath() },
      note: running ? "config saved — restart the MHRV proxy for port/mode/bind changes to take effect" : undefined,
    };
  });

  ipcMain.handle("mhrv_status", () => mhrvStatus());
  ipcMain.handle("mhrv_start", async () => mhrvStart());
  ipcMain.handle("mhrv_stop", () => mhrvStop());
  ipcMain.handle("mhrv_scan_ips", async () => scanGoogleIps(mhrvLoadConfig()));
  ipcMain.handle("mhrv_scan_sni", async () => scanSniCandidates(mhrvLoadConfig()));
  ipcMain.handle("mhrv_test_relay", async () => testRelay(mhrvLoadConfig()));

  ipcMain.handle(
    "mhrv_codegs",
    (_e, args: { variant?: unknown; injectKey?: unknown }) => {
      const variant = args?.variant === "cfw" ? "cfw" : "apps_script";
      const cfg = mhrvLoadConfig();
      const out = embeddedCodeGs(
        variant as "apps_script" | "cfw",
        args?.injectKey ? cfg.authKey : null,
        args?.injectKey ? cfg.cfwWorkerUrl : null
      );
      return out; // {text, source} | null
    }
  );

  ipcMain.handle("mhrv_ca_status", () => caStatus());
  ipcMain.handle("mhrv_ca_install", () => installCaToUserStore());

  /* ---------------- H-c: MHRV v1.9.37-parity additions ----------------
   *   mhrv_logs_get     {level?, limit?} -> MhrvLogLine[] (min-level order
   *                     error>warn>info>debug, last N of the 500-line ring)
   *   mhrv_logs_clear   -> {ok}
   *   mhrv_logs_save    -> the ONLY renderer-triggered dialog in this file:
   *                     a native save dialog (same dialog.* API main.ts uses
   *                     for its uninstall confirm), writing a .log file.
   *                     Returns {ok, path, detail} — never throws.
   *   mhrv_ca_remove    -> delete CA files + reset cache + best-effort
   *                     certutil -user -del store Root
   *   mhrv_ca_check     -> presence in the user store (win32) / files exist
   *   mhrv_update_check -> {current, latest, isNewer} via the appUpdate.ts
   *                     facts + the GitHub releases/latest redirect probe;
   *                     user-click only, never throws.
   * ------------------------------------------------------------------- */
  ipcMain.handle("mhrv_logs_get", (_e, args: { level?: unknown; limit?: unknown }) => {
    const level = typeof args?.level === "string" && ["error", "warn", "info", "debug"].includes(args.level)
      ? (args.level as MhrvLogLevel)
      : undefined;
    const limit = Number.isFinite(Number(args?.limit)) ? Number(args?.limit) : undefined;
    return mhrvLogsGet({ level, limit });
  });

  ipcMain.handle("mhrv_logs_clear", () => {
    mhrvLogsClear();
    return { ok: true };
  });

  ipcMain.handle("mhrv_logs_save", async () => {
    try {
      const text = mhrvLogsText();
      const parent = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
      const opts = {
        title: "Save MHRV log",
        defaultPath: `mhrv-log-${new Date().toISOString().slice(0, 10)}.log`,
        filters: [
          { name: "Log files", extensions: ["log"] as string[] },
          { name: "All files", extensions: ["*"] as string[] },
        ],
      };
      const res = parent
        ? await dialog.showSaveDialog(parent, opts)
        : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) {
        return { ok: false, path: null, detail: "save cancelled" };
      }
      fs.writeFileSync(res.filePath, text + (text ? "\n" : ""), "utf8");
      return { ok: true, path: res.filePath, detail: `saved ${text.split("\n").length} lines` };
    } catch (e: any) {
      return { ok: false, path: null, detail: String(e?.message || e) };
    }
  });

  ipcMain.handle("mhrv_ca_remove", () => removeCaFromUserStore());
  ipcMain.handle("mhrv_ca_check", () => checkCaInUserStore());
  ipcMain.handle("mhrv_update_check", () => mhrvUpdateCheck());

  ipcMain.handle("aether_update_check", async () => {
    return aetherUpdate.check();
  });

  ipcMain.handle(
    "aether_update_apply",
    async (_e, args: { version?: unknown }) => {
      // A pinned-version string is the ONLY argument the renderer may
      // send; everything else (URLs, hashes) comes from the table.
      const version = String(args?.version || "").trim().slice(0, 32);
      return aetherUpdate.apply(version);
    }
  );

  /* ------- MEMENTO's own update helper (Phase C6, Option A) -----------
   * Static facts only: this build's version + the pinned releases page.
   * The app never checks the network for itself, never downloads, and
   * never replaces its own executable (no self-swap — the portable-app
   * principle). The renderer opens the page in the USER's browser via
   * the existing open-external shell command below.
   */
  ipcMain.handle("app_update_info", () => {
    return appUpdateInfo(app.getVersion());
  });

  /* ------------- Phase B2: VPN Device (TUN) routing session -------------
   *
   * Four NEW additive commands — the session machinery is the B1 pair
   * (routingSession + routingHelper); THIS manager (main.ts's instance,
   * shared with every quit path) is the GUI-side owner:
   *
   *   routing_start   -> validate + authorize the D5 request, write the
   *                      session files, hand `<exe> --routing-helper
   *                      <requestPath>` to UAC. Throws with an honest
   *                      reason on refusal (non-win32, no active core,
   *                      already live, elevation refused) — the app's
   *                      uniform toasts-are-the-payload semantics.
   *   routing_stop    -> control.json stop; the helper performs the D6
   *                      full teardown (the GUI never kills anything).
   *   routing_status  -> the merged honest view (helper status.json +
   *                      recovery marker + fresh kill-switch flag + the
   *                      D6 suppression mapping + the D5 names echoed so
   *                      the renderer never hardcodes them).
   *   routing_repair  -> the elevated one-shot --repair-network pass;
   *                      nothing to repair = { launched:false } with NO
   *                      UAC prompt (honest, and no elevation for show).
   */
  ipcMain.handle(
    "routing_start",
    async (_e, args: { tunMtu?: unknown; bypassHost?: unknown }): Promise<ReturnType<typeof routing.startRouting>> => {
      // 3.1.8 (field report #5): the renderer passes the ACTIVE server's
      // address; the TUN engine excludes it (sniff/domain + ip_cidr +
      // route_exclude_address) so the core's own packets to the server
      // EXIT via the physical NIC instead of looping back into the tunnel
      // (the exact "TUN works on Aether, black-holes on xray/sing-box"
      // field bug — Aether self-protects, the other cores cannot).
      // Domain resolution happens HERE, async, on the still-clean system
      // DNS (the adapter does not exist yet); failures are best-effort.
      let resolvedIps: string[] = [];
      const host = typeof args?.bypassHost === "string" ? args.bypassHost.trim() : "";
      if (host && !host.includes(":") && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        try {
          const infos = await dns.promises.lookup(host, { all: true, verbatim: true });
          resolvedIps = infos
            .map((i) => String(i?.address ?? "").trim())
            .filter((a) => a.length > 0)
            .slice(0, 8);
        } catch {
          /* best-effort — the sniff/domain rules still cover TLS/QUIC */
        }
      }
      try {
        const res = routing.startRouting(args?.tunMtu, { serverHost: host || null, serverIps: resolvedIps });
        logInfo("tun", `TUN session requested — server bypass: ${host || "(none)"}${resolvedIps.length ? ` -> ${resolvedIps.join(", ")}` : ""}`);
        return res;
      } catch (e) {
        logException("tun", e, "TUN start failed");
        throw e;
      }
    }
  );
  ipcMain.handle("routing_stop", () => routing.stopRouting());
  ipcMain.handle("routing_status", () => routing.getRoutingStatus());
  ipcMain.handle("routing_repair", () => routing.repairRouting());

  /* ---------------- system proxy ---------------- */

  const d6SuppressionError = (): Error =>
    new Error(
      "A VPN Device (TUN) session owns system routing right now — system proxy writes are suppressed while it is live (D6). Disconnect the VPN Device session first."
    );

  ipcMain.handle(
    "set_system_proxy",
    (_e, args: { socksPort?: unknown }): void => {
      // Phase B2 (D6): while the TUN adapter owns the routing table the
      // WinINET writes are meaningless at best, dangling at worst — a
      // live session SUPPRESSES every renderer-initiated proxy write.
      if (routing.isSystemProxySuppressed()) throw d6SuppressionError();
      setSystemProxy(u16Port("socksPort", args?.socksPort));
    }
  );

  ipcMain.handle("clear_system_proxy", (): void => {
    // Phase B2 (D6): same suppression — a clear during a live TUN
    // session would only dangle (or, armed, block) a proxy no app uses.
    // Phase C5 routing (armed -> BLOCK, disarmed -> clear) is untouched.
    if (routing.isSystemProxySuppressed()) throw d6SuppressionError();
    // Phase C5: routes through the kill switch — armed -> BLOCK, disarmed
    // -> plain clear, quitting -> plain clear (never a raw clear here).
    releaseSystemProxy();
  });

  /* ---------------- native TCP ping ---------------- */

  ipcMain.handle(
    "tcp_ping_batch",
    async (_e, args: { targets?: unknown; timeoutMs?: unknown }): Promise<PingOutcome[]> => {
      const timeoutMs = Math.max(1, num(args?.timeoutMs, 1500));
      const rawTargets = Array.isArray(args?.targets) ? (args.targets as PingTarget[]) : [];
      // Same u16 boundary as the Rust Vec<PingTarget{port: u16}>: one bad
      // port rejected the whole invoke (serde error) — mirror that.
      const targets: PingTarget[] = rawTargets.map((t, i) => ({
        id: String(t?.id ?? ""),
        host: String(t?.host ?? ""),
        port: u16Port(`targets[${i}].port`, t?.port),
      }));
      return tcpPingBatch(targets, timeoutMs);
    }
  );

  /* ---------------- elevated tool ---------------- */

  ipcMain.handle("launch_spoofing_patt", (): void => {
    launchSpoofingPatt();
  });

  /* ------------- Phase D1: IP / DNS-leak check (net_check) -------------
   *
   * Two independent HTTPS probes to Cloudflare's trace endpoint + the OS
   * resolver list, so the user can SEE whether traffic really exits through
   * the tunnel:
   *
   *   exit   -> ses.fetch() on a THROWAWAY in-memory session pinned to
   *             socks5://127.0.0.1:<socksPort>. Chromium passes hostnames to
   *             a SOCKS5 proxy unresolved (no local DNS), and the path works
   *             regardless of the Windows system-proxy state — the renderer
   *             decides which port to test (config connection's socksPort,
   *             or the Aether core's socks_port while an Aether session is
   *             live). A dead/unlistened port surfaces as a clear error —
   *             which is itself the honest answer ("nothing is proxying").
   *   direct -> Node https, which NEVER uses the system proxy — the real
   *             ISP-facing IP for the comparison.
   *   dnsServers -> dns.getServers(): the resolvers the OS uses for
   *             non-proxied lookups (informational; in System-Proxy mode
   *             browser DNS goes through the proxy instead).
   *
   * Fixed URLs only (no user input in the request), 12 s deadlines, 64 KB
   * response cap — the handler cannot be turned into a fetch primitive.
   */

  type IpPathResult =
    | { ok: true; ip: string; loc?: string; warp?: string }
    | { ok: false; error: string };

  const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";

  const parseTrace = (body: string): { ip?: string; loc?: string; warp?: string } => {
    const out: { ip?: string; loc?: string; warp?: string } = {};
    for (const line of body.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k === "ip") out.ip = v;
      else if (k === "loc") out.loc = v;
      else if (k === "warp") out.warp = v;
    }
    return out;
  };

  /** Direct-path GET: Node https, no proxy support at all (by design). */
  const httpsGetText = (url: string, timeoutMs: number): Promise<string> =>
    new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: timeoutMs }, (res) => {
        if ((res.statusCode ?? 0) !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          data += c;
          if (data.length > 64 * 1024) req.destroy(new Error("Response too large"));
        });
        res.on("end", () => resolve(data));
      });
      req.on("timeout", () => req.destroy(new Error("Timed out")));
      req.on("error", reject);
    });

  ipcMain.handle(
    "net_check",
    async (_e, args: { socksPort?: unknown }): Promise<{
      exit: IpPathResult;
      direct: IpPathResult;
      dnsServers: string[];
    }> => {
      const socksPort = u16Port("socksPort", args?.socksPort ?? 0);

      const exitProbe: Promise<IpPathResult> = (async () => {
        if (socksPort === 0) {
          return { ok: false, error: "No proxy port provided" };
        }
        try {
          // "persist:"-less partition = in-memory session, thrown away
          // after the check; nothing about it outlives this handler call.
          // ses.fetch() (NOT net.fetch) is the deliberate choice: it runs
          // on THIS session's Chromium network stack, i.e. with the pinned
          // socks5 proxy — net.fetch would always use the default session.
          const ses = session.fromPartition(`ipcheck-${Date.now()}-${Math.random()}`);
          await ses.setProxy({ mode: "fixed_servers", proxyRules: `socks5://127.0.0.1:${socksPort}` });
          const res = await ses.fetch(TRACE_URL, {
            signal: AbortSignal.timeout(12_000),
          });
          const t = parseTrace(await res.text());
          if (!t.ip) return { ok: false, error: "Unexpected trace response" };
          return { ok: true, ip: t.ip, loc: t.loc, warp: t.warp };
        } catch (err) {
          const raw = String((err as Error)?.message || err);
          return { ok: false, error: raw.replace(/^Error:\s*/, "") };
        }
      })();

      const directProbe: Promise<IpPathResult> = (async () => {
        try {
          const t = parseTrace(await httpsGetText(TRACE_URL, 12_000));
          if (!t.ip) return { ok: false, error: "Unexpected trace response" };
          return { ok: true, ip: t.ip, loc: t.loc };
        } catch (err) {
          const raw = String((err as Error)?.message || err);
          return { ok: false, error: raw.replace(/^Error:\s*/, "") };
        }
      })();

      const [exit, direct] = await Promise.all([exitProbe, directProbe]);
      let dnsServers: string[] = [];
      try { dnsServers = dns.getServers(); } catch { /* resolver list unavailable */ }
      return { exit, direct, dnsServers };
    }
  );

  /* ------------- Phase C2 (item 3): real URL-test (url_test) -------------
   *
   * v2rayN-style "real delay": one HTTP GET through an actual core, timed
   * to the response headers. Two modes (urlTest.ts):
   *   - instance: { configJson, testUrl?, timeoutMs? } — a TEMPORARY
   *     xray/sing-box instance serves the probe on an ephemeral port (the
   *     renderer generated the config with the SAME generators as connect,
   *     so fragment/builder options apply to the measured path too); the
   *     instance is killed in a finally block and never touches the live
   *     VPN, the system proxy, or the active-config files.
   *   - tunnel: { socksPort, testUrl?, timeoutMs? } — probe an ALREADY
   *     RUNNING local inbound (the connected session — works for all three
   *     cores — or any socks port the user points at).
   * The testUrl is validated main-side (normalizeTestUrl) and defaults to
   * the persisted pref (appPrefs.testUrl) when omitted.
   */
  ipcMain.handle(
    "url_test",
    (_e, args: { configJson?: unknown; socksPort?: unknown; testUrl?: unknown; timeoutMs?: unknown }) =>
      urlTestProbe(args ?? {})
  );

  /* ------------- Phase C3 (items 1+2): geo data files -------------
   *
   * geo_status: what is on disk right now (per file, with byte sizes) —
   * the Routing tab renders this verbatim. geo_ensure: download missing
   * files for one family ("xray" = geoip.dat/geosite.dat into dataDir,
   * "srs" = .srs rule-sets into dataDir/sing-box); { force: true } is the
   * explicit "Update" button. NEVER throws for a per-file network failure —
   * the returned errors map names the failed file so the UI can show the
   * exact reason (a connect-flow gate treats any error as "geo not ready").
   */
  ipcMain.handle("geo_status", () => geoStatus());
  ipcMain.handle(
    "geo_ensure",
    (_e, args: { family?: unknown; force?: unknown; name?: unknown }) => {
      const family = args?.family === "xray" || args?.family === "srs" ? args.family : null;
      if (!family) {
        return Promise.resolve({ status: geoStatus(), errors: { _: "geo_ensure needs family \"xray\" or \"srs\"" } });
      }
      return geoEnsure(family, { force: args?.force === true, name: typeof args?.name === "string" ? args.name : undefined });
    }
  );

  /* ------------- Phase D3/D4: app prefs (autostart + hotkeys + tray) ------
   *
   * The MAIN process owns these system-coupled options: hotkeys must be
   * globalShortcut-registered at boot (before/without the renderer),
   * auto-start lives in the OS login-items registry, and the tray menu +
   * balloon need the UI language main-side. Prefs persist in
   * userData/memento-app-prefs.json (see appPrefs.ts); every reply carries
   * the FULL new state so the renderer toggle UI can never drift.
   */

  ipcMain.handle("app_prefs_get", () => {
    return {
      ...loadAppPrefs(),
      hotkeysActive: hotkeysActive(),
      autostartSupported: getAutostartStatus().supported,
      autostartEnabled: getAutostartStatus().openAtLogin,
    };
  });

  // Serialized read-modify-write (Phase D4): the renderer now pushes
  // language changes fire-and-forget from setLanguage() WHILE the Settings
  // tab patches booleans — two concurrent load->save cycles could drop one
  // side's field. Chaining every patch through one promise makes the
  // last-writer-wins race impossible.
  let prefsChain: Promise<unknown> = Promise.resolve();
  ipcMain.handle(
    "app_prefs_set",
    (_e, args: { patch?: unknown }) => {
      prefsChain = prefsChain.then(() => {
        const prefs: AppPrefs = loadAppPrefs();
        // sanitizePrefsPatch (appPrefs.ts) accepts ONLY the user-facing
        // fields (hotkeys, closeToTray, language, testUrl, killSwitch) and
        // drops everything else — most notably
        // closeTrayToastShown, the privileged one-shot balloon flag that
        // only the main process may write.
        const patch = sanitizePrefsPatch(args?.patch);
        if (patch.hotkeyShowHide !== undefined) prefs.hotkeyShowHide = patch.hotkeyShowHide;
        if (patch.hotkeyConnect !== undefined) prefs.hotkeyConnect = patch.hotkeyConnect;
        if (patch.closeToTray !== undefined) prefs.closeToTray = patch.closeToTray;
        if (patch.language !== undefined) prefs.language = patch.language;
        if (patch.killSwitch !== undefined) prefs.killSwitch = patch.killSwitch;
        saveAppPrefs(prefs);
        // Phase C5: the kill-switch transition acts on the PERSISTED state
        // (it re-loads the prefs file), so it must run AFTER the save —
        // arming while disconnected blocks NOW; disarming restores direct
        // ONLY if the current proxy state is ours (never a foreign proxy).
        // Our-ports set mirrors auditLeftoverProxy (main.ts): the canonical
        // defaults + the last session's real ports.
        enforceKillSwitchAfterPrefChange(
          new Set([10808, 10809, ...readLastActivePorts()])
        );
        const active = applyHotkeyRegistration(prefs);
        // Tray menu labels follow the (possibly new) language.
        rebuildMenu();
        const autostart = getAutostartStatus();
        return {
          ...prefs,
          hotkeysActive: active,
          autostartSupported: autostart.supported,
          autostartEnabled: autostart.openAtLogin,
        };
      });
      return prefsChain;
    }
  );

  ipcMain.handle("autostart_set", (_e, args: { enabled?: unknown }) => {
    const status = setAutostart(args?.enabled === true);
    return { autostartSupported: status.supported, autostartEnabled: status.openAtLogin };
  });

  // Phase D4: the renderer pushes connection state changes here so the tray
  // menu label can honestly read "Connect" vs "Disconnect". Fire-and-forget
  // from the renderer; a stale/failed push costs nothing (menu rebuilds on
  // the next real flip only).
  ipcMain.handle("tray_status_set", (_e, args: { connected?: unknown }) => {
    updateTrayStatus(args?.connected === true);
    return { connected: args?.connected === true };
  });

  /* ---------------- shell (opener plugin equivalent) ---------------- */

  ipcMain.handle("memento:open-external", async (_e, url: unknown): Promise<void> => {
    const u = String(url || "");
    // Only http/https/mailto — never allow file:// or custom protocol abuse.
    if (/^(https?|mailto):/i.test(u)) {
      await shell.openExternal(u);
    }
  });

  /* ---------------- window controls (custom title bar) ---------------- */

  const win = (): BrowserWindow | null => {
    const w = BrowserWindow.getAllWindows()[0];
    return w && !w.isDestroyed() ? w : null;
  };

  ipcMain.handle("memento:window-minimize", () => win()?.minimize());
  ipcMain.handle("memento:window-toggle-maximize", () => {
    const w = win();
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
    return w.isMaximized();
  });
  ipcMain.handle("memento:window-is-maximized", () => !!win()?.isMaximized());
  ipcMain.handle("memento:window-close", () => win()?.close());
}

/** Convenience export used by main.ts diagnostics. */
export function describeXraySetup(): string {
  const found = findXray();
  const sb = findSingBox();
  const ae = findAether();
  const xrayPart = found ? `xray ${XRAY_VERSION} @ ${found}` : "xray not found yet";
  const sbPart = sb
    ? `sing-box v${SING_BOX_VERSION} @ ${sb}`
    : `sing-box v${SING_BOX_VERSION} not found (Hysteria2/TUIC disabled)`;
  const aePart = ae
    ? `aether v${AETHER_VERSION} @ ${ae}`
    : `aether v${AETHER_VERSION} not found (Aether tab disabled)`;
  return `${xrayPart}; ${sbPart}; ${aePart}`;
}
