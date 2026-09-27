/**
 * MEMENTO — preload bridge.
 *
 * Exposes a minimal, typed `window.electronAPI` to the React renderer with
 * contextIsolation:true and nodeIntegration:false (sandboxed preload —
 * only Electron's ipcRenderer/contextBridge are used).
 *
 * The generic `invoke(cmd, args)` keeps the EXACT Tauri command names, so
 * `src/utils/tauriBridge.ts` can route calls without touching the React
 * components. Errors are unwrapped so toasts show the same clean message
 * strings the Tauri build produced (no "Error invoking remote method..."
 * noise).
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

function unwrapError(e: unknown): Error {
  let msg = e instanceof Error ? e.message : String(e);
  // Electron wraps handler rejections as:
  //   "Error invoking remote method 'start_xray': Error: <real message>"
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, "");
  msg = msg.replace(/^(Error|Exception):\s*/i, "");
  return new Error(msg);
}

/**
 * Hardening: the generic pass-through only forwards the 11 legacy MEMENTO
 * commands + the 4 additive Task-12 Aether commands + the Phase-D1 net_check
 * probe + the three Phase-D3 app-prefs commands + the Phase-D4 tray status
 * push + the Phase-C2 real-delay url_test probe + the Phase-C3 geo commands
 * + the Phase-C6 update commands + the Phase-E1 connection-stats probe.
 * Window controls and openExternal have
 * their own dedicated methods below, so any other channel name is rejected
 * here instead of reaching ipcMain (a compromised renderer can no longer
 * probe arbitrary Electron-internal channels).
 */
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  "check_xray",
  "download_xray",
  "start_xray",
  "stop_xray",
  "get_xray_status",
  "get_xray_logs",
  "get_xray_traffic",
  "set_system_proxy",
  "clear_system_proxy",
  "tcp_ping_batch",
  "launch_spoofing_patt",
  // Task 12 (additive only): the Aether core's own lifecycle commands.
  "aether_start",
  "aether_stop",
  "aether_status",
  "aether_logs",
  // Phase D1 (additive): IP / DNS-leak check — fixed URLs, no renderer input
  // beyond the local socks port to probe.
  "net_check",
  // Phase D3 (additive): app prefs — autostart + global hotkeys. The main
  // process sanitizes every field; the renderer can only flip booleans +
  // the UI language (sanitizePrefsPatch in appPrefs.ts).
  "app_prefs_get",
  "app_prefs_set",
  "autostart_set",
  // Phase D4 (additive): one-way status push for the tray menu label.
  "tray_status_set",
  // Phase C2 (additive): real-delay URL test. The main process validates
  // the test URL itself and never lets a probe touch the live VPN.
  "url_test",
  // Phase C3 (additive): geo data file status + download for routing rules.
  // Read-only status; ensure only ever writes into dataDir's geo slots.
  "geo_status",
  "geo_ensure",
  // Phase C6 (additive): Aether pin-per-version update service. User-click
  // only (no timer exists in the service), honest typed outcomes, and the
  // check/download transport never touches system state (C2 parity). The
  // pin table is the only install authority; the sha256 gate is mandatory.
  "aether_update_status",
  "aether_update_check",
  "aether_update_apply",
  // Phase C6 (additive): MEMENTO's own honest update assistant — static
  // facts only (this build's version + the pinned releases page). The app
  // never self-updates, never self-swaps, and never phones home on its own.
  "app_update_info",
  // Phase B2 (additive): the VPN Device (TUN) routing session. start/stop/
  // repair carry only user-safe scalars (tunMtu is clamped main-side, D7);
  // the D5 request itself (pids, ports, paths, the kill-switch flag) is
  // built ENTIRELY main-side — the renderer can never forge a session.
  "routing_start",
  "routing_stop",
  "routing_status",
  "routing_repair",
  // Phase E1 (additive): live per-connection stats. Read-only probe on the
  // active core's stats surface; rows are normalized MAIN-SIDE and the
  // clash_api secret never crosses this bridge.
  "get_connection_stats",
  // R3 (additive): the Update Center — xray/sing-box download->verify->APPLY
  // pipeline with structured progress events. User-click only.
  "update_center_list",
  "update_center_check",
  "update_center_download",
  "update_center_rollback",
  // 3.1.8 (additive): pause/cancel for the Update Center downloads
  // (resume rides update_center_download with resume:true).
  "update_center_pause",
  "update_center_cancel",
  // 3.1.8 (additive): the logging & error pipeline — the renderer pushes
  // errors it caught into the SAME main-side log, reads the recent tail,
  // and can export/open/clear it. All user-action-only + length-capped.
  "log_event",
  "logs_get_recent",
  "logs_export",
  "logs_open_folder",
  "logs_clear",
  // R3 (additive): the Live Connection section — a read-only per-app
  // socket snapshot (netstat/tasklist aggregation, main-side normalized).
  "live_conn_snapshot",
  // taskF2 (additive): the rebuilt IP Scanner engine v2 (main-side TCP
  // probing with bounded concurrency, per-host live streaming, optional
  // batch geo lookup; every target validated before use).
  "scanner_scan",
  "scanner_stop",
  "scanner_local_subnet",
  // R3 (additive): the in-app MHRV (MasterHttpRelayVPN) engine — config,
  // lifecycle, scanners, embedded Code.gs, MITM CA management.
  "mhrv_config_get",
  "mhrv_config_set",
  "mhrv_status",
  "mhrv_start",
  "mhrv_stop",
  "mhrv_scan_ips",
  "mhrv_scan_sni",
  "mhrv_test_relay",
  "mhrv_codegs",
  "mhrv_ca_status",
  "mhrv_ca_install",
  // H-c (additive): mhrv-rs v1.9.37-parity — recent-log surface (read /
  // clear / save via a MAIN-side native save dialog), CA remove+check, and
  // the user-click-only update check. All read-only or user-clicked.
  "mhrv_logs_get",
  "mhrv_logs_clear",
  "mhrv_logs_save",
  "mhrv_ca_remove",
  "mhrv_ca_check",
  "mhrv_update_check",
]);

const api = {
  isElectron: true,

  /** Generic pass-through — cmd names match the legacy Tauri commands. */
  invoke: async <T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    if (!ALLOWED_COMMANDS.has(cmd)) {
      throw new Error(`Unknown command: ${cmd}`);
    }
    try {
      return (await ipcRenderer.invoke(cmd, args ?? {})) as T;
    } catch (e) {
      throw unwrapError(e);
    }
  },

  /** Phase D3 (item 4): the Ctrl+Alt+C global hotkey fires in the MAIN
   *  process and is forwarded here — the connection engine (connect best /
   *  disconnect) lives in the renderer. Phase D4: the tray menu's
   *  Connect/Disconnect item rides the SAME command-bus pattern
   *  (memento:tray-toggle-connect) so both entry points share one handler
   *  with identical semantics. Each returns an unsubscribe function. */
  app: {
    onHotkeyToggleConnect: (cb: () => void): (() => void) => {
      const handler = (_e: IpcRendererEvent) => cb();
      ipcRenderer.on("memento:hotkey-toggle-connect", handler);
      return () => {
        ipcRenderer.removeListener("memento:hotkey-toggle-connect", handler);
      };
    },
    onTrayToggleConnect: (cb: () => void): (() => void) => {
      const handler = (_e: IpcRendererEvent) => cb();
      ipcRenderer.on("memento:tray-toggle-connect", handler);
      return () => {
        ipcRenderer.removeListener("memento:tray-toggle-connect", handler);
      };
    },
  },

  /** Generic main->renderer event subscribe for the R3 progress channels
   *  (Update Center download progress, Scanner progress). Allow-listed:
   *  anything else is refused. Returns an unsubscribe function. */
  onMainEvent: (channel: string, cb: (payload: unknown) => void): (() => void) => {
    const ALLOWED_EVENTS: ReadonlySet<string> = new Set([
      "update_center_progress",
      "scanner_progress",
      "scanner_host",
      "mhrv_progress",
    ]);
    if (!ALLOWED_EVENTS.has(channel)) {
      throw new Error(`Event channel not allowed: ${channel}`);
    }
    const handler = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  /** opener-plugin equivalent: open a link in the user's default browser. */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("memento:open-external", url),

  /** Custom title-bar window controls (TitleBar.tsx). */
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("memento:window-minimize"),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke("memento:window-toggle-maximize"),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke("memento:window-is-maximized"),
    close: (): Promise<void> => ipcRenderer.invoke("memento:window-close"),
    /**
     * Fired on resize/maximize/unmaximize — the equivalent of the Tauri
     * `Window.onResized` listener. Returns an unsubscribe function.
     */
    onResized: (cb: () => void): (() => void) => {
      const handler = (_e: IpcRendererEvent) => cb();
      ipcRenderer.on("memento:window-resized", handler);
      return () => {
        ipcRenderer.removeListener("memento:window-resized", handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

export type ElectronAPI = typeof api;
