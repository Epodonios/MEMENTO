import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, DEFAULT_AETHER_SETTINGS, type AetherRoutingMode, type RoutingStatusViewWire } from "../store";
import type { AetherLiveInfo, AetherSettings } from "../store";
import { cn } from "../utils/cn";
import { t, type Language } from "../i18n";
import { isDesktop, openExternalLink, tauriInvoke } from "../utils/tauriBridge";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import Hint from "./Hint";
import {
  Orbit, ChevronDown, ChevronUp, Zap, Globe, ShieldCheck,
  ExternalLink, Info, RefreshCw, Download, Lock, Network, Wrench,
} from "lucide-react";

/**
 * Task 12 — Aether tab (SOCKS5-only phase).
 *
 * Two approved UI zones:
 *  - MAIN (always open): protocol mode (Smart / MASQUE / WireGuard / WARP-in-
 *    WARP), scan mode, SOCKS port, custom endpoint, the Connect button and
 *    the renderer-owned system-proxy toggle.
 *  - ADVANCED (collapsed by default): noize, IP mode, MASQUE h2/fragment/ECH,
 *    DNS, routing lists, the second HTTP CONNECT listener, upstream chaining,
 *    quick-reconnect, log level, and the protocol-contextual WireGuard /
 *    WARP-in-WARP peer forms.
 *
 * The connection state lives in the GLOBAL store (aetherStatus/aetherInfo) so
 * it survives tab switches, mirroring the config-connection pattern. The
 * aether core is driven through the 4 dedicated IPC commands; the main
 * process NEVER touches the system-proxy registry for aether — the toggle
 * here owns set/clear_system_proxy (B5: prefer the HTTP CONNECT listener
 * port when it is enabled, because WinINET ProxyServer has HTTP semantics).
 *
 * Phase B2 — the routing segment (SOCKS / VPN Device):
 *  - SOCKS (default): the pre-B2 behavior, byte-for-byte.
 *  - VPN Device: the B1 TUN machinery (MementoTun adapter, elevated
 *    MementoTunHelper). Connect = aether_start THEN routing_start (the
 *    TUN tunnels into this session's SOCKS inbound); Disconnect =
 *    routing_stop, wait for the D6 teardown, THEN aether_stop. While the
 *    TUN session owns system routing the system-proxy toggle is replaced
 *    by an honest note (D6 suppression — the main process refuses proxy
 *    writes during a live session anyway). The pill shows the ROUTING
 *    state while a session is live (reconnecting = the D6 fail-closed
 *    hold, amber). A repair button launches the elevated one-shot pass.
 */

const SCAN_MODES = ["turbo", "balanced", "thorough", "stealth", "ironclad"] as const;
const NOIZE_PROFILES = ["default", "off", "light", "firewall", "balanced", "gfw", "aggressive"] as const;
const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;
const IP_MODES = ["v4", "v6", "both"] as const;

/** Phase B2: the TUN states that count as "live" for the UI flows (the
 *  terminal states disabled/error/idle are NOT live). Mirrors the main
 *  process's LIVE_STATES — keep in sync by shape, not by import (the
 *  renderer never imports main-process modules). */
const TUN_LIVE_STATES: ReadonlySet<string> = new Set([
  "starting", "connected", "reconnecting", "restoring",
]);

export default function AetherTab() {
  const language = useStore(s => s.language);
  const settings = useStore(s => s.aetherSettings);
  const aetherStatus = useStore(s => s.aetherStatus);
  const aetherInfo = useStore(s => s.aetherInfo);
  const setAetherSettings = useStore(s => s.setAetherSettings);
  // Phase B2: the routing segment + the last routing_status snapshot.
  const aetherMode = useStore(s => s.aetherMode);
  const setAetherMode = useStore(s => s.setAetherMode);
  const routingView = useStore(s => s.routingView);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsBoxRef = useRef<HTMLDivElement>(null);
  // Phase B2: toast the "error" transition once per transition (a ref
  // guard — the 2 s poll would otherwise re-toast every tick).
  const lastTunErrorToastRef = useRef<string | null>(null);
  // R3 task #2: the launchFeedback event the toast was last shown for
  // (dedupe key = atMs — a repeated poll must not re-toast).
  const lastLaunchFeedbackAtRef = useRef<number | null>(null);

  const isRtl = language === "fa" || language === "ar";
  const busy = aetherStatus === "connecting";
  const connected = aetherStatus === "connected";

  /* ---------------- Phase B2: TUN session derived state ---------------- */
  const tunLive = !!(
    aetherMode === "vpn-device" &&
    routingView &&
    TUN_LIVE_STATES.has(routingView.state)
  );
  const tunState = tunLive ? routingView!.state : null;
  const tunInteractive = !!(
    aetherMode === "vpn-device" &&
    routingView &&
    (TUN_LIVE_STATES.has(routingView.state) || routingView.state === "error")
  );

  /* ---------------- context visibility (approved spec) ---------------- */
  const showEndpoint = settings.protocol === "masque" || settings.protocol === "wg";
  const showMasque = settings.protocol === "masque";
  const showWg = settings.protocol === "wg" || settings.protocol === "gool";
  const showWiw = settings.protocol === "gool";
  const httpPortActive = connected && settings.httpProxyEnabled;

  /* ---------------- status + logs polling (tab-local) ---------------- */
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const status = await tauriInvoke<AetherLiveInfo>("aether_status");
        if (cancelled || !status) return;
        const cur = useStore.getState();
        if (status.running && status.ready && cur.aetherStatus !== "connected") {
          cur.setAetherState({ aetherStatus: "connected", aetherInfo: status });
        } else if (status.running && !status.ready && cur.aetherStatus === "disconnected") {
          // A start invoke is in flight from another source — reflect it.
          cur.setAetherState({ aetherStatus: "connecting", aetherInfo: status });
        } else if (status.running) {
          cur.setAetherState({ aetherInfo: status });
        } else if (!status.running && cur.aetherStatus === "connected") {
          // The core died unexpectedly (crash / killed by AV).
          cur.setAetherState({ aetherStatus: "disconnected", aetherInfo: status });
          toast.error(t("aether.stoppedUnexpectedly", cur.language), { duration: 6000 });
        } else {
          cur.setAetherState({ aetherInfo: status });
        }
        const newLogs = await tauriInvoke<string[]>("aether_logs");
        if (!cancelled && Array.isArray(newLogs)) setLogs(newLogs);

        // Phase B2: the routing session view (cheap file-read main-side;
        // always refreshed so the VPN Device card is current when shown).
        try {
          const rv = await tauriInvoke<RoutingStatusViewWire>("routing_status");
          if (cancelled) return;
          const cur2 = useStore.getState();
          const prev = cur2.routingView;
          cur2.setRoutingView(rv ?? null);
          // R3 task #2: surface the elevation launcher's async outcome
          // (UAC accepted / cancelled / failed) exactly once per event.
          if (rv?.launchFeedback && rv.launchFeedback.atMs !== lastLaunchFeedbackAtRef.current) {
            lastLaunchFeedbackAtRef.current = rv.launchFeedback.atMs;
            if (rv.launchFeedback.ok) {
              toast.success(
                t("aether.tunUacAccepted", cur2.language),
                { duration: 6000 }
              );
            } else {
              toast.error(
                `${t("aether.tunUacFailed", cur2.language)}${rv.launchFeedback.message ? `\n${rv.launchFeedback.message}` : ""}`,
                { duration: 12000, style: { whiteSpace: "pre-line", maxWidth: 480 } }
              );
            }
          }
          if (
            rv &&
            rv.state === "error" &&
            prev?.state !== "error" &&
            cur2.aetherMode === "vpn-device" &&
            lastTunErrorToastRef.current !== rv.message
          ) {
            lastTunErrorToastRef.current = rv.message;
            toast.error(
              `${t("aether.tunStateError", cur2.language)}${rv.message ? ` — ${rv.message}` : ""}`,
              { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } }
            );
          }
        } catch {
          /* routing_status unavailable — the card stays on its last view */
        }
      } catch {
        /* transient IPC error — next tick retries */
      }
    };

    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Keep the log box pinned to the newest line.
  useEffect(() => {
    const el = logsBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  /* ---------------- connect / disconnect ---------------- */

  const handleConnect = useCallback(async () => {
    const st = useStore.getState();
    const s = st.aetherSettings;

    // Light client-side checks (the main process re-validates strictly).
    if (!Number.isInteger(s.socksPort) || s.socksPort < 1 || s.socksPort > 65535) {
      toast.error("SOCKS port must be an integer between 1 and 65535.");
      return;
    }
    if (s.httpProxyEnabled && s.httpProxyPort === s.socksPort) {
      toast.error("HTTP proxy port must differ from the SOCKS port.");
      return;
    }

    const attempt = st.aetherAttempt + 1;
    st.setAetherState({
      aetherStatus: "connecting",
      aetherAttempt: attempt,
      aetherInfo: null,
    });
    // Aether takes over the tunnel: reset the config-connection store and
    // arm connManualStop so the ConnectionManager watcher can neither toast
    // nor auto-failover when the main process stops the other core (B7-safe).
    st.setConnState({
      connStatus: "disconnected",
      connManualStop: true,
      connLogs: [],
      connDownloadBytes: 0,
      connUploadBytes: 0,
      connDownSpeed: 0, // Phase D1
      connUpSpeed: 0,
    });

    try {
      const res = await tauriInvoke<AetherLiveInfo>("aether_start", { settings: s });
      if (!res) {
        throw new Error("Aether core is unavailable in this environment.");
      }
      const cur = useStore.getState();
      if (cur.aetherAttempt !== attempt || cur.aetherStatus !== "connecting") {
        // A disconnect landed while connecting — shut the winner down
        // instead of leaving an unowned core + proxy behind.
        try { await tauriInvoke("aether_stop"); } catch { /* best-effort */ }
        return;
      }
      cur.setAetherState({ aetherStatus: "connected", aetherInfo: res });
      // Phase B2 (VPN Device): the TUN session tunnels into THIS core's
      // SOCKS inbound — start it AFTER the core is live. A refused/failed
      // start is honest (UAC denied, elevation refused, wintun gate): the
      // aether session STAYS UP in SOCKS mode and the toast says why; the
      // system-proxy write is deliberately skipped in this mode (D6 — the
      // TUN adapter owns system routing, or nothing does).
      if (cur.aetherMode === "vpn-device") {
        try {
          await tauriInvoke("routing_start", {});
        } catch (e: any) {
          toast.error(
            t("aether.tunStartFailed", cur.language).replace("{reason}", String(e?.message || e)),
            { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } }
          );
        }
        toast.success(t("aether.connectedVia", language).replace("{protocol}", res.candidate ?? (s.protocol === "smart" ? "smart" : s.protocol)));
        return;
      }
      // B5 (approved): the WinINET ProxyServer value has HTTP semantics, so
      // point it at the HTTP CONNECT listener when enabled, else at SOCKS.
      if (cur.aetherSystemProxy) {
        try {
          await tauriInvoke("set_system_proxy", {
            socksPort: res.http_port ? res.http_port : res.socks_port,
          });
        } catch (e: any) {
          toast.error(String(e?.message || e), { duration: 8000 });
        }
      }
      toast.success(t("aether.connectedVia", language).replace("{protocol}", res.candidate ?? (s.protocol === "smart" ? "smart" : s.protocol)));
    } catch (err: any) {
      const cur = useStore.getState();
      if (cur.aetherAttempt === attempt && cur.aetherStatus === "connecting") {
        cur.setAetherState({ aetherStatus: "error" });
        const msg = String(err?.message || err || "Unknown error");
        toast.error(msg, { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
      }
    }
  }, [language]);

  /** Phase B2: poll routing_status until the session reaches a terminal
   *  state (disabled/error/idle) — the D6 teardown takes a few helper
   *  ticks; the core is only stopped AFTER the adapter is really gone. */
  const waitRoutingTerminal = useCallback(async (timeoutMs = 12000): Promise<void> => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const rv = await tauriInvoke<RoutingStatusViewWire>("routing_status");
        useStore.getState().setRoutingView(rv ?? null);
        if (!rv || rv.state === "disabled" || rv.state === "error" || rv.state === "idle") return;
      } catch {
        return; // status unavailable — do not block the disconnect forever
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    // Phase B2 (VPN Device): stop the TUN session FIRST and wait for the
    // D6 teardown, THEN stop the upstream core — never the reverse (a
    // dead upstream under a live adapter is exactly what D6 forbids).
    const st0 = useStore.getState();
    if (
      st0.aetherMode === "vpn-device" &&
      st0.routingView &&
      TUN_LIVE_STATES.has(st0.routingView.state)
    ) {
      try { await tauriInvoke("routing_stop"); } catch { /* best-effort */ }
      await waitRoutingTerminal();
    }
    try { await tauriInvoke("aether_stop"); } catch { /* best-effort */ }
    const cur = useStore.getState();
    if (cur.aetherMode !== "vpn-device" && cur.aetherSystemProxy) {
      try { await tauriInvoke("clear_system_proxy"); } catch { /* best-effort */ }
    }
    cur.setAetherState({ aetherStatus: "disconnected", aetherInfo: null });
  }, [waitRoutingTerminal]);

  /** Phase B2: the elevated one-shot network repair (--repair-network).
   *  Nothing to repair = an honest refusal WITHOUT a UAC prompt. */
  const handleRepairNetwork = useCallback(async () => {
    try {
      const r = await tauriInvoke<{ launched: boolean; reason?: string }>("routing_repair");
      if (r?.launched) {
        toast.success(t("aether.repairLaunched", language), { duration: 6000 });
      } else {
        toast.error(r?.reason || t("aether.repairNothing", language), { duration: 8000 });
      }
    } catch (e: any) {
      toast.error(String(e?.message || e), { duration: 8000 });
    }
  }, [language]);

  const handleToggleSystemProxy = useCallback(async (next: boolean) => {
    // Phase B2 (D6): the toggle does not exist in VPN Device mode (the
    // main process refuses the writes anyway) — a defensive no-op here.
    if (useStore.getState().aetherMode === "vpn-device") return;
    useStore.getState().setAetherState({ aetherSystemProxy: next });
    if (useStore.getState().aetherStatus !== "connected") return;
    try {
      if (next) {
        const info = useStore.getState().aetherInfo;
        const port = info?.http_port ? info.http_port : info?.socks_port;
        if (port) await tauriInvoke("set_system_proxy", { socksPort: port });
      } else {
        await tauriInvoke("clear_system_proxy");
      }
    } catch (e: any) {
      toast.error(String(e?.message || e), { duration: 8000 });
    }
  }, []);

  /* ---------------- tiny field helpers ---------------- */

  const fieldLabel = (key: string) => (
    <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">
      {t(key, language)}
    </label>
  );

  const inputCls =
    "w-full px-3 py-2 rounded-lg text-xs font-mono bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80 transition-colors disabled:opacity-50";

  const TextInput = ({
    value, onChange, placeholder, disabled, type = "text",
  }: {
    value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; type?: string;
  }) => (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={inputCls}
    />
  );

  const Select = ({
    value, onChange, options, disabled,
  }: {
    value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={cn(inputCls, "font-sans cursor-pointer")}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} className="bg-surface-900">
          {o.label}
        </option>
      ))}
    </select>
  );

  const Toggle = ({
    checked, onChange, label, hint, disabled,
  }: {
    checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
  }) => (
    <div className={cn("flex items-start justify-between gap-3 py-1.5", isRtl && "flex-row-reverse")}>
      <div className={cn(isRtl && "text-right")}>
        <p className={cn("text-xs font-semibold", disabled ? "text-ink-600" : "text-ink-200")}>{label}</p>
        {hint && <p className="text-[10px] text-ink-500 mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={cn(
          "relative w-10 h-5.5 rounded-full transition-all duration-300 shrink-0 mt-0.5",
          checked ? "bg-gradient-to-r from-emerald-400 to-green-600" : "bg-surface-700/80",
          disabled && "opacity-40 cursor-not-allowed"
        )}
        style={{ height: 22 }}
      >
        <span className={cn(
          "absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all duration-300",
          isRtl ? (checked ? "left-0.5" : "right-0.5") : (checked ? "right-0.5" : "left-0.5")
        )} style={{ width: 18, height: 18 }} />
      </button>
    </div>
  );

  /* ---------------- protocol hint (contextual) ---------------- */

  const protocolHint = useMemo(() => {
    switch (settings.protocol) {
      case "smart":
        return t("aether.hintSmart", language);
      case "masque":
        return t("aether.hintMasque", language);
      case "wg":
        return t("aether.hintWg", language);
      case "gool":
        return t("aether.hintGool", language);
    }
  }, [settings.protocol, language]);

  const statusLabel =
    aetherStatus === "connected"
      ? t("connection.connected", language)
      : aetherStatus === "connecting"
        ? t("connection.connecting", language)
        : aetherStatus === "error"
          ? t("connection.error", language)
          : t("connection.disconnected", language);

  /* Phase B2: while a TUN session is live the pill shows the ROUTING
   * state (the user-facing effect is the device routing, not the local
   * listener); reconnecting gets its own amber fail-closed label. */
  const tunStateKey = (s: string): string =>
    s === "starting" ? "aether.tunStateStarting"
      : s === "connected" ? "aether.tunStateConnected"
        : s === "reconnecting" ? "aether.tunStateReconnecting"
          : s === "restoring" ? "aether.tunStateRestoring"
            : s === "disabled" ? "aether.tunStateDisabled"
              : s === "error" ? "aether.tunStateError"
                : "aether.tunStateIdle";
  const pillLabel = tunState
    ? t(tunStateKey(tunState), language)
    : statusLabel;
  const pillError = aetherStatus === "error" || tunState === "error";
  const pillBusy = tunState
    ? tunState === "starting" || tunState === "restoring"
    : busy;
  const pillConnected = tunState ? tunState === "connected" : connected;
  const pillReconnecting = tunState === "reconnecting";

  const smartProgress =
    busy && aetherInfo?.smart && aetherInfo.candidate
      ? ` — ${t("aether.candidate", language)
          .replace("{i}", String(aetherInfo.candidateIndex))
          .replace("{n}", String(aetherInfo.candidateTotal))
          .replace("{protocol}", aetherInfo.candidate)}`
      : "";

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader titleKey="tab.aether" descKey="desc.aether" hintKey="hint.aether" icon={Orbit} />

      {!isDesktop() && (
        <div className={cn(
          "rounded-xl border px-4 py-3 flex items-center gap-2 text-xs",
          "border-yellow-500/30 bg-yellow-500/5 text-yellow-300"
        )}>
          <Info className="w-4 h-4 shrink-0" />
          {t("aether.browserMode", language)}
        </div>
      )}

      {/* ================= MAIN (always open) ================= */}
      <div className={cn(
        "rounded-2xl border overflow-hidden",
        "dark:border-surface-700/50 dark:bg-surface-800/30",
        "light:border-surface-200 light:bg-white"
      )}>
        <div className={cn(
          "flex items-center justify-between px-4 py-2.5 border-b",
          "dark:border-surface-700/50 dark:bg-surface-800/50",
          "light:border-surface-200 light:bg-surface-50"
        )}>
          <span className="text-sm font-semibold dark:text-white light:text-surface-900">
            {t("aether.mainSection", language)}
          </span>
          {/* Status pill */}
          <span className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold",
            pillConnected
              ? "bg-emerald-500/15 text-emerald-400"
              : pillReconnecting
                ? "bg-amber-500/15 text-amber-400"
                : pillBusy
                  ? "bg-yellow-500/15 text-yellow-300"
                  : pillError
                    ? "bg-red-500/15 text-red-400"
                    : "bg-surface-700/40 text-ink-400"
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              pillConnected ? "bg-emerald-400 pulse-glow"
                : pillReconnecting ? "bg-amber-400 animate-pulse"
                  : pillBusy ? "bg-yellow-400 animate-pulse"
                    : pillError ? "bg-red-400" : "bg-ink-500"
            )} />
            {pillLabel}{!tunState && smartProgress}
          </span>
        </div>

        <div className="p-4 space-y-4">
          {/* Phase B2: routing segment — HOW the tunnel reaches apps.
              Connect-time choice only (like the protocol buttons); in
              browser mode the segment is disabled with the rest. */}
          <div>
            {fieldLabel("aether.mode")}
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "socks" as AetherRoutingMode, icon: Globe,
                  label: t("aether.modeSocks", language),
                  desc: t("aether.modeSocksDesc", language),
                  hint: "" },
                { id: "vpn-device" as AetherRoutingMode, icon: Network,
                  label: t("aether.modeVpnDevice", language),
                  desc: t("aether.modeVpnDeviceDesc", language),
                  hint: t("hint.aetherVpnDevice", language) },
              ]).map(m => (
                <button
                  key={m.id}
                  onClick={() => setAetherMode(m.id)}
                  disabled={!isDesktop() || busy || connected}
                  className={cn(
                    "flex flex-col items-start gap-1.5 p-3 rounded-xl border transition-all text-left",
                    aetherMode === m.id
                      ? "border-emerald-500/60 bg-emerald-500/10 shadow-md shadow-emerald-500/10"
                      : "border-surface-700/60 hover:border-emerald-500/30",
                    (!isDesktop() || busy || connected) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <m.icon className={cn("w-4 h-4", aetherMode === m.id ? "text-emerald-400" : "text-ink-400")} />
                    <span className={cn("text-[11px] font-bold", aetherMode === m.id ? "text-emerald-400" : "text-ink-300")}>
                      {m.label}
                    </span>
                    {m.hint && <Hint text={m.hint} size="sm" />}
                  </span>
                  <span className="text-[10px] text-ink-500 leading-relaxed">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Protocol mode */}
          <div>
            {fieldLabel("aether.protocol")}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { id: "smart", label: t("aether.protocolSmart", language), icon: Zap },
                { id: "masque", label: "MASQUE", icon: Globe },
                { id: "wg", label: "WireGuard", icon: ShieldCheck },
                { id: "gool", label: "WARP-in-WARP", icon: Orbit },
              ] as const).map(p => (
                <button
                  key={p.id}
                  onClick={() => setAetherSettings({ protocol: p.id })}
                  disabled={busy || connected}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl border text-[11px] font-bold transition-all",
                    settings.protocol === p.id
                      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400 shadow-md shadow-emerald-500/10"
                      : "border-surface-700/60 text-ink-400 hover:border-emerald-500/30 hover:text-emerald-300",
                    (busy || connected) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <p.icon className="w-4 h-4" />
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-500 mt-1.5 leading-relaxed">{protocolHint}</p>
          </div>

          {/* Scan mode + SOCKS port */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={showEndpoint ? "" : "sm:col-span-2"}>
              {fieldLabel("aether.scan")}
              <Select
                value={settings.scanMode}
                disabled={busy || connected}
                onChange={v => setAetherSettings({ scanMode: v as AetherSettings["scanMode"] })}
                options={SCAN_MODES.map(m => ({ value: m, label: m }))}
              />
              <p className="text-[10px] text-ink-500 mt-1">{t("aether.scanHint", language)}</p>
            </div>
            <div>
              {fieldLabel("aether.socksPort")}
              <TextInput
                type="number"
                value={String(settings.socksPort)}
                disabled={busy || connected}
                onChange={v => setAetherSettings({ socksPort: Number(v) || 0 })}
              />
            </div>
          </div>

          {/* Custom endpoint (masque / wg only) */}
          {showEndpoint && (
            <div>
              {fieldLabel("aether.endpoint")}
              <TextInput
                value={settings.endpoint}
                disabled={busy || connected}
                placeholder={t("aether.endpointAuto", language)}
                onChange={v => setAetherSettings({ endpoint: v })}
              />
              <p className="text-[10px] text-ink-500 mt-1">{t("aether.endpointHint", language)}</p>
            </div>
          )}

          {/* Connect / Disconnect */}
          <div className="flex items-center gap-3 pt-1">
            {!connected ? (
              <button
                onClick={handleConnect}
                disabled={busy || !isDesktop()}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-extrabold transition-all",
                  busy
                    ? "bg-yellow-500/15 text-yellow-300 cursor-wait"
                    : "bg-gradient-to-r from-emerald-400 to-green-600 text-black/85 hover:shadow-lg hover:shadow-emerald-500/30 active:scale-[0.99]",
                  (!isDesktop()) && "opacity-50 cursor-not-allowed"
                )}
              >
                {busy ? (
                  <>
                    <span className="w-4 h-4 border-2 border-yellow-300 border-t-transparent rounded-full animate-spin" />
                    {t("connection.connecting", language)}
                  </>
                ) : (
                  <>{t("button.connect", language)}</>
                )}
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-extrabold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-all active:scale-[0.99]"
              >
                {t("button.disconnect", language)}
              </button>
            )}
          </div>

          {/* Phase B2: the VPN Device session card — honest D5/D6/D7 state.
              Visible whenever the segment is in vpn-device mode; shows the
              live session state, the helper's own message, the armed flag,
              and the elevated one-shot repair. */}
          {aetherMode === "vpn-device" && (
            <div className="rounded-xl border border-surface-700/50 bg-surface-950/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400/90">
                  <Network className="w-3.5 h-3.5 shrink-0" />
                  {t("aether.vpnDeviceCard", language)}
                </span>
                {tunState && (
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold",
                    tunState === "connected" ? "bg-emerald-500/15 text-emerald-400"
                      : tunState === "reconnecting" ? "bg-amber-500/15 text-amber-400"
                        : tunState === "error" ? "bg-red-500/15 text-red-400"
                          : "bg-yellow-500/15 text-yellow-300"
                  )}>
                    {t(tunStateKey(tunState), language)}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-ink-500 leading-relaxed">
                {t("aether.vpnDeviceHint", language)}
              </p>
              {tunState === "reconnecting" && (
                <p className="text-[10px] text-amber-400 leading-relaxed font-semibold">
                  {t("aether.tunReconnectHint", language)}
                </p>
              )}
              {routingView?.message && tunInteractive && (
                <p className="font-mono text-[10px] text-ink-600 break-all" dir="ltr">
                  {routingView.message}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <button
                  onClick={handleRepairNetwork}
                  disabled={!isDesktop()}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors",
                    "border border-surface-700/60 text-ink-400 hover:text-emerald-300 hover:border-emerald-500/40",
                    !isDesktop() && "opacity-40 cursor-not-allowed"
                  )}
                >
                  <Wrench className="w-3 h-3" />
                  {t("aether.repairNetwork", language)}
                </button>
                <span className="text-[10px] text-ink-600">
                  {t("aether.repairNetworkHint", language)}
                </span>
              </div>
            </div>
          )}

          {/* Phase D1 (honest limitation): the aether binary exposes NO
              traffic/statistics API (verified against the official binary),
              so no speed or cumulative counter is shown for this core. */}
          {connected && (
            <div className="flex items-center gap-2 rounded-xl border border-surface-700/50 bg-surface-950/40 px-3 py-2">
              <Info className="w-3.5 h-3.5 text-ink-500 shrink-0" />
              <p className="text-[10px] text-ink-500 leading-relaxed">
                {t("aether.noTrafficStats", language)}
              </p>
            </div>
          )}

          {/* Phase B2: in VPN Device mode the system-proxy toggle is
              REPLACED by an honest note — the TUN adapter routes ALL system
              traffic itself, and D6 suppresses proxy writes for the whole
              lifetime of a live session (the main process refuses them). */}
          {aetherMode === "vpn-device" ? (
            <div className="pt-1 border-t border-surface-700/40 flex items-center gap-2 rounded-xl px-1 py-1">
              <Info className="w-3.5 h-3.5 text-ink-500 shrink-0" />
              <p className="text-[10px] text-ink-500 leading-relaxed">
                {t("aether.vpnDeviceProxyNote", language)}
              </p>
            </div>
          ) : (
            <div className="pt-1 border-t border-surface-700/40">
              <Toggle
                checked={useStore.getState().aetherSystemProxy ? connected && useStore.getState().aetherSystemProxy : false}
                onChange={handleToggleSystemProxy}
                label={t("aether.systemProxy", language)}
                hint={
                  httpPortActive
                    ? t("aether.systemProxyHttpHint", language).replace("{port}", String(aetherInfo?.http_port ?? ""))
                    : t("aether.systemProxyHint", language)
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* ================= ADVANCED (collapsed by default) ================= */}
      <div className={cn(
        "rounded-2xl border overflow-hidden",
        "dark:border-surface-700/50 dark:bg-surface-800/30",
        "light:border-surface-200 light:bg-white"
      )}>
        <button
          onClick={() => setAdvancedOpen(o => !o)}
          className={cn(
            "w-full flex items-center justify-between px-4 py-2.5",
            "dark:bg-surface-800/50 light:bg-surface-50",
            "dark:border-surface-700/50 light:border-surface-200 border-b",
            !advancedOpen && "border-b-0"
          )}
        >
          <span className="text-sm font-semibold dark:text-white light:text-surface-900">
            {t("aether.advanced", language)}
          </span>
          {advancedOpen
            ? <ChevronUp className="w-4 h-4 text-ink-400" />
            : <ChevronDown className="w-4 h-4 text-ink-400" />}
        </button>

        {advancedOpen && (
          <div className="p-4 space-y-5">

            {/* Obfuscation + IP mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                {fieldLabel("aether.noize")}
                <Select
                  value={settings.noize}
                  disabled={busy || connected}
                  onChange={v => setAetherSettings({ noize: v as AetherSettings["noize"] })}
                  options={NOIZE_PROFILES.map(n => ({
                    value: n,
                    label: n === "default" ? t("aether.noizeDefault", language) : n,
                  }))}
                />
                <p className="text-[10px] text-ink-500 mt-1">{t("aether.noizeHint", language)}</p>
              </div>
              <div>
                {fieldLabel("aether.ipMode")}
                <Select
                  value={settings.ipMode}
                  disabled={busy || connected}
                  onChange={v => setAetherSettings({ ipMode: v as AetherSettings["ipMode"] })}
                  options={IP_MODES.map(m => ({ value: m, label: m === "v4" ? "IPv4" : m === "v6" ? "IPv6" : "IPv4 + IPv6" }))}
                />
              </div>
            </div>

            {/* MASQUE transport (h3/h2) + fragment */}
            {showMasque && (
              <div className="rounded-xl border border-surface-700/40 p-3 space-y-1">
                <p className="text-[10px] font-bold text-emerald-400/90 uppercase tracking-wider">
                  {t("aether.masqueSection", language)}
                </p>
                <Toggle
                  checked={settings.masqueHttp2}
                  disabled={busy || connected}
                  onChange={v => setAetherSettings({ masqueHttp2: v, ...(v ? {} : { fragment: false }) })}
                  label={t("aether.masqueHttp2", language)}
                  hint={t("aether.masqueHttp2Hint", language)}
                />
                <Toggle
                  checked={settings.fragment}
                  disabled={busy || connected || !settings.masqueHttp2}
                  onChange={v => setAetherSettings({ fragment: v })}
                  label={t("aether.fragment", language)}
                  hint={t("aether.fragmentHint", language)}
                />
                <div>
                  {fieldLabel("aether.ech")}
                  <Select
                    value={settings.ech}
                    disabled={busy || connected}
                    onChange={v => setAetherSettings({ ech: v as AetherSettings["ech"] })}
                    options={[
                      { value: "off", label: t("aether.echOff", language) },
                      { value: "auto", label: t("aether.echAuto", language) },
                      { value: "custom", label: t("aether.echCustom", language) },
                    ]}
                  />
                  {settings.ech === "custom" && (
                    <div className="mt-2">
                      {fieldLabel("aether.echBase64")}
                      <TextInput
                        value={settings.echBase64}
                        disabled={busy || connected}
                        placeholder="AESCU…"
                        onChange={v => setAetherSettings({ echBase64: v })}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* WireGuard / WARP-in-WARP peer forms (protocol-contextual) */}
            {showWg && (
              <div className="rounded-xl border border-surface-700/40 p-3 space-y-3">
                <p className="text-[10px] font-bold text-emerald-400/90 uppercase tracking-wider">
                  {showWiw ? t("aether.wiwSection", language) : t("aether.wgSection", language)}
                </p>
                {showWiw ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        {fieldLabel("aether.wiwOuter")}
                        <TextInput
                          value={settings.wiwOuter}
                          disabled={busy || connected}
                          placeholder="162.159.192.1:2408"
                          onChange={v => setAetherSettings({ wiwOuter: v })}
                        />
                      </div>
                      <div>
                        {fieldLabel("aether.wiwInner")}
                        <TextInput
                          value={settings.wiwInner}
                          disabled={busy || connected}
                          placeholder="188.114.96.1:2408"
                          onChange={v => setAetherSettings({ wiwInner: v })}
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-ink-500 leading-relaxed">{t("aether.wiwHint", language)}</p>
                    <div>
                      {fieldLabel("aether.wiwForce")}
                      <TextInput
                        value={settings.wgForceOuter}
                        disabled={busy || connected}
                        placeholder={t("aether.wiwForceAuto", language)}
                        onChange={v => setAetherSettings({ wgForceOuter: v })}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-[10px] text-ink-500 leading-relaxed">{t("aether.endpointIsWgHint", language)}</p>
                )}
                <div>
                  {fieldLabel("aether.keepalive")}
                  <TextInput
                    type="number"
                    value={settings.wgKeepalive}
                    disabled={busy || connected}
                    placeholder="5"
                    onChange={v => setAetherSettings({ wgKeepalive: v })}
                  />
                </div>
              </div>
            )}

            {/* DNS + upstream */}
            <div className="grid grid-cols-1 gap-4">
              <div>
                {fieldLabel("aether.dns")}
                <TextInput
                  value={settings.dns}
                  disabled={busy || connected}
                  placeholder="1.1.1.1,1.0.0.1"
                  onChange={v => setAetherSettings({ dns: v })}
                />
                <p className="text-[10px] text-ink-500 mt-1">{t("aether.dnsHint", language)}</p>
              </div>
              <div>
                {fieldLabel("aether.upstream")}
                <TextInput
                  value={settings.upstream}
                  disabled={busy || connected}
                  placeholder="socks5://127.0.0.1:1080"
                  onChange={v => setAetherSettings({ upstream: v })}
                />
                <p className="text-[10px] text-ink-500 mt-1">{t("aether.upstreamHint", language)}</p>
              </div>
            </div>

            {/* Routing lists */}
            <div className="rounded-xl border border-surface-700/40 p-3 space-y-3">
              <p className="text-[10px] font-bold text-emerald-400/90 uppercase tracking-wider">
                {t("aether.routingSection", language)}
              </p>
              <p className="text-[10px] text-ink-500 leading-relaxed">{t("aether.routeHint", language)}</p>
              <div>
                {fieldLabel("aether.routeBlock")}
                <TextInput
                  value={settings.routeBlock}
                  disabled={busy || connected}
                  placeholder="ads.example.com, port:25, private"
                  onChange={v => setAetherSettings({ routeBlock: v })}
                />
              </div>
              <div>
                {fieldLabel("aether.routeDirect")}
                <TextInput
                  value={settings.routeDirect}
                  disabled={busy || connected}
                  placeholder="mybank.com, 10.0.0.0/8"
                  onChange={v => setAetherSettings({ routeDirect: v })}
                />
              </div>
              <div>
                {fieldLabel("aether.routesFile")}
                <TextInput
                  value={settings.routesFile}
                  disabled={busy || connected}
                  placeholder="C:\\routes.txt"
                  onChange={v => setAetherSettings({ routesFile: v })}
                />
              </div>
            </div>

            {/* Second HTTP CONNECT listener */}
            <div className="rounded-xl border border-surface-700/40 p-3 space-y-1">
              <Toggle
                checked={settings.httpProxyEnabled}
                disabled={busy || connected}
                onChange={v => setAetherSettings({ httpProxyEnabled: v })}
                label={t("aether.httpProxy", language)}
                hint={t("aether.httpProxyHint", language)}
              />
              {settings.httpProxyEnabled && (
                <div className="sm:w-1/3">
                  {fieldLabel("aether.httpProxyPort")}
                  <TextInput
                    type="number"
                    value={String(settings.httpProxyPort)}
                    disabled={busy || connected}
                    onChange={v => setAetherSettings({ httpProxyPort: Number(v) || 0 })}
                  />
                </div>
              )}
            </div>

            {/* Quick reconnect + log level */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <Toggle
                checked={settings.quickReconnect}
                disabled={busy || connected}
                onChange={v => setAetherSettings({ quickReconnect: v })}
                label={t("aether.quickReconnect", language)}
                hint={t("aether.quickReconnectHint", language)}
              />
              <div>
                {fieldLabel("aether.logLevel")}
                <Select
                  value={settings.logLevel}
                  disabled={busy || connected}
                  onChange={v => setAetherSettings({ logLevel: v as AetherSettings["logLevel"] })}
                  options={LOG_LEVELS.map(l => ({ value: l, label: l }))}
                />
              </div>
            </div>

            {/* Reset */}
            <button
              onClick={() => setAetherSettings({ ...DEFAULT_AETHER_SETTINGS })}
              disabled={busy || connected}
              className="text-[11px] font-bold text-ink-500 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              {t("button.reset", language)}
            </button>
          </div>
        )}
      </div>

      {/* ================= Logs ================= */}
      <div className={cn(
        "rounded-2xl border overflow-hidden",
        "dark:border-surface-700/50 dark:bg-surface-800/30",
        "light:border-surface-200 light:bg-white"
      )}>
        <div className={cn(
          "flex items-center justify-between px-4 py-2.5 border-b",
          "dark:border-surface-700/50 dark:bg-surface-800/50",
          "light:border-surface-200 light:bg-surface-50"
        )}>
          <span className="text-sm font-semibold dark:text-white light:text-surface-900">
            {t("aether.logs", language)}
          </span>
          <span className="text-[10px] text-ink-500">{logs.length} lines</span>
        </div>
        <div
          ref={logsBoxRef}
          className="allow-select h-56 overflow-auto px-4 py-3 bg-surface-950/70 font-mono text-[10px] leading-relaxed text-emerald-200/80"
          dir="ltr"
        >
          {logs.length === 0 ? (
            <p className="text-ink-600 font-sans">{t("aether.logsEmpty", language)}</p>
          ) : (
            logs.map((line, i) => (
              <p key={i} className="whitespace-pre-wrap break-all">{line}</p>
            ))
          )}
        </div>
      </div>

      {/* ================= Aether core updates (Phase C6) =================
          Pin-per-version panel: user-click only, sha256-verified, running-
          locked. Rendered as a self-contained component below. */}
      <AetherUpdatePanel language={language} isRtl={isRtl} />

      {/* Honest limitation note + trademark attribution */}
      <div className="space-y-2 pb-2">
        <p className="text-[10px] text-ink-500 leading-relaxed flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          {t("aether.trafficNote", language)}
        </p>
        <p className={cn("text-[10px] text-ink-500 leading-relaxed flex items-start gap-1.5", isRtl && "text-right")}>
          <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            {t("aether.attribution", language)}{" "}
            <button
              onClick={() => openExternalLink("https://github.com/CluvexStudio/Aether")}
              className="text-emerald-400/90 hover:text-emerald-300 underline underline-offset-2 font-bold"
            >
              github.com/CluvexStudio/Aether
            </button>
          </span>
        </p>
      </div>
    </div>
  );
}

/* ==================================================================== */
/*  Phase C6 — Aether pin-per-version update panel                      */
/*                                                                      */
/*  The four honest states map 1:1 to the main-process outcome types:   */
/*  up-to-date / pinned-newer (install offered) / unpinned-newer        */
/*  (honest refusal: update MEMENTO itself) / error. While the core is  */
/*  running the whole panel is gated with a clear banner — the running  */
/*  version is never swapped underneath itself, and the check/download  */
/*  path never touches any system state (C2 parity). Offline default =  */
/*  the bundled pin: without an explicit user click NOTHING happens.    */
/* ==================================================================== */

interface AetherUpdateTableEntryWire {
  version: string;
  verified: string;
  installable: boolean;
}

interface AetherUpdateStatusWire {
  bundledVersion: string;
  activeVersion: string | null;
  activeIdentified: boolean;
  binaryFound: boolean;
  isRunning: boolean;
  releasesPage: string;
  table: AetherUpdateTableEntryWire[];
}

interface AetherCheckWire {
  kind: "up-to-date" | "pinned-newer" | "unpinned-newer" | "blocked-running" | "error";
  latest?: string;
  version?: string;
  detail?: string;
  baseline?: string;
}

interface AetherApplyWire {
  reason: string;
  version?: string;
  detail?: string;
  activeVersionAfter?: string | null;
}

function AetherUpdatePanel({ language, isRtl }: { language: Language; isRtl: boolean }) {
  const [st, setSt] = useState<AetherUpdateStatusWire | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [offer, setOffer] = useState<AetherCheckWire | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await tauriInvoke<AetherUpdateStatusWire>("aether_update_status");
      if (s) setSt(s);
    } catch {
      /* honest silence — the panel simply stays unpopulated */
    }
  }, []);

  useEffect(() => {
    if (isDesktop()) refresh();
  }, [refresh]);

  const handleCheck = useCallback(async () => {
    setChecking(true);
    setMsg(null);
    try {
      const r = await tauriInvoke<AetherCheckWire>("aether_update_check");
      if (!r) throw new Error("update service unavailable");
      setOffer(r.kind === "pinned-newer" ? r : null);
      if (r.kind === "up-to-date") {
        setMsg({ tone: "ok", text: t("aether.updateUpToDate", language).replace("{version}", r.latest || r.baseline || "") });
      } else if (r.kind === "pinned-newer") {
        setMsg({ tone: "ok", text: t("aether.updatePinnedNewer", language).replace("{version}", r.version || "") });
      } else if (r.kind === "unpinned-newer") {
        setMsg({ tone: "warn", text: t("aether.updateUnpinnedNewer", language).replace("{version}", r.latest || "") });
      } else if (r.kind === "blocked-running") {
        setMsg({ tone: "warn", text: t("aether.updateRunningBlocked", language) });
      } else {
        setMsg({ tone: "err", text: t("aether.updateCheckFailed", language).replace("{detail}", r.detail || "") });
      }
    } catch (e: any) {
      setMsg({ tone: "err", text: String(e?.message || e) });
    } finally {
      setChecking(false);
      refresh();
    }
  }, [language, refresh]);

  const handleApply = useCallback(async (version: string) => {
    setApplying(true);
    setMsg(null);
    try {
      const r = await tauriInvoke<AetherApplyWire>("aether_update_apply", { version });
      if (!r) throw new Error("update service unavailable");
      if (r.reason === "ok") {
        setMsg({ tone: "ok", text: t("aether.updateDone", language).replace("{version}", version) });
        setOffer(null);
      } else if (r.reason === "hash-mismatch" || r.reason === "zip-hash-mismatch") {
        setMsg({ tone: "err", text: t("aether.updateErrHash", language) });
      } else if (r.reason === "not-pinned") {
        setMsg({ tone: "err", text: t("aether.updateErrNotPinned", language) });
      } else if (r.reason === "blocked-running") {
        setMsg({ tone: "warn", text: t("aether.updateRunningBlocked", language) });
      } else {
        setMsg({ tone: "err", text: t("aether.updateErrGeneric", language).replace("{reason}", r.reason).replace("{detail}", r.detail || "") });
      }
    } catch (e: any) {
      setMsg({ tone: "err", text: String(e?.message || e) });
    } finally {
      setApplying(false);
      refresh();
    }
  }, [language, refresh]);

  const busy = checking || applying;
  const gated = !!st?.isRunning;

  const activeLabel = !st
    ? "…"
    : st.activeVersion
      ? `v${st.activeVersion}`
      : st.binaryFound
        ? t("aether.updateNotIdentified", language)
        : t("aether.updateBinaryMissing", language);

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden",
      "dark:border-surface-700/50 dark:bg-surface-800/30",
      "light:border-surface-200 light:bg-white"
    )}>
      <div className={cn(
        "flex items-center justify-between px-4 py-2.5 border-b gap-2",
        "dark:border-surface-700/50 dark:bg-surface-800/50",
        "light:border-surface-200 light:bg-surface-50",
        isRtl && "flex-row-reverse"
      )}>
        <span className="text-sm font-semibold dark:text-white light:text-surface-900 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-emerald-400 shrink-0" />
          {t("aether.updateTitle", language)}
        </span>
        <button
          onClick={handleCheck}
          disabled={busy || gated || !st}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors flex items-center gap-1.5",
            busy || gated || !st
              ? "bg-surface-800 text-surface-500 cursor-not-allowed"
              : "bg-gradient-to-r from-emerald-400 to-teal-500 text-black/90 hover:brightness-110"
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", checking && "animate-spin")} />
          {checking ? t("aether.updateChecking", language) : t("aether.updateCheckBtn", language)}
        </button>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        <p className="text-[10px] text-ink-500 leading-relaxed">{t("aether.updateHint", language)}</p>

        {/* version rows */}
        <div className={cn("grid grid-cols-2 gap-2 text-xs", isRtl && "text-right")}>
          <div className="rounded-lg border border-surface-700/40 px-3 py-2">
            <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wider">{t("aether.updateActive", language)}</p>
            <p className="font-mono text-ink-200 mt-0.5">{activeLabel}</p>
          </div>
          <div className="rounded-lg border border-surface-700/40 px-3 py-2">
            <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wider">{t("aether.updateBundled", language)}</p>
            <p className="font-mono text-ink-200 mt-0.5">{st ? `v${st.bundledVersion}` : "…"}</p>
          </div>
        </div>

        {/* running lock banner (the user constraint, honest and visible) */}
        {gated && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
            <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed text-amber-300">{t("aether.updateRunningBlocked", language)}</p>
          </div>
        )}

        {/* last check / apply message */}
        {msg && (
          <div className={cn(
            "flex items-start gap-2 rounded-xl border px-3.5 py-2.5",
            msg.tone === "ok" && "border-emerald-500/30 bg-emerald-500/10",
            msg.tone === "warn" && "border-amber-500/30 bg-amber-500/10",
            msg.tone === "err" && "border-red-500/30 bg-red-500/10"
          )}>
            {msg.tone === "ok"
              ? <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              : <Info className={cn("w-4 h-4 shrink-0 mt-0.5", msg.tone === "warn" ? "text-amber-400" : "text-red-400")} />}
            <p className={cn(
              "text-[11px] leading-relaxed",
              msg.tone === "ok" && "text-emerald-300",
              msg.tone === "warn" && "text-amber-300",
              msg.tone === "err" && "text-red-300"
            )}>{msg.text}</p>
          </div>
        )}

        {/* the only install path: a pinned-newer offer from an explicit check */}
        {offer?.kind === "pinned-newer" && offer.version && (
          <button
            onClick={() => handleApply(offer.version!)}
            disabled={busy || gated}
            className={cn(
              "w-full px-3 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2",
              busy || gated
                ? "bg-surface-800 text-surface-500 cursor-not-allowed"
                : "bg-gradient-to-r from-emerald-400 to-teal-500 text-black/90 hover:brightness-110"
            )}
          >
            <Download className="w-3.5 h-3.5" />
            {applying ? t("aether.updateInstalling", language) : t("aether.updateInstallBtn", language).replace("{version}", offer.version)}
          </button>
        )}

        {/* the pin table itself — the only versions that can ever install */}
        {st && st.table.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1">{t("aether.updateTableTitle", language)}</p>
            <div className="space-y-1" dir="ltr">
              {st.table.map(row => (
                <div key={row.version} className="flex items-center justify-between gap-2 rounded-lg border border-surface-700/30 px-2.5 py-1.5 font-mono text-[10px]">
                  <span className="text-ink-300">v{row.version}</span>
                  <span className="text-ink-600">{row.verified}</span>
                  <span className={cn("font-sans font-bold", row.installable ? "text-emerald-400/90" : "text-ink-600")}>
                    {row.installable ? "sha256 + url" : "no url"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
