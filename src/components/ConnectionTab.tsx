import { useState, useEffect, useRef, useMemo } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import {
  Power, Shield, ShieldAlert, Wifi, WifiOff, Search, ChevronDown,
  AlertTriangle, CheckCircle2, Copy, Download,
  Settings, Globe, Zap, Eye, EyeOff, MonitorSmartphone, X, RefreshCcw, PlayCircle, Cpu, Activity, Loader2
} from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import Hint from "./Hint";
import TrafficChart from "./TrafficChart";
import ConnectionStatsPanel from "./ConnectionStatsPanel";
import { generateV2RayConfig } from "../utils/v2rayConfig";
import { generateSingBoxConfig } from "../utils/singBoxConfig";
import { configCore } from "../store";
import { isDesktop, tauriInvoke } from "../utils/tauriBridge";
import { connectToConfig, disconnectConnection } from "../utils/connectionActions";
import { runTunnelUrlTest } from "../utils/urlTest";

type ConnMode = "direct" | "system-proxy" | "tun";

export default function ConnectionTab() {
  const {
    configs, language, pingResults, subscriptionGroups,
    connStatus, connConfigId, connPid, connStartedAt,
    connMode, connSocksPort, connHttpPort, connApiPort,
    connDownloadBytes, connUploadBytes, connDownSpeed, connUpSpeed, connLogs,
    setConnState, autoFailover, setAutoFailover,
    geoPreparing, // C3 fix: explicit "Preparing geo data…" state during the connect-time geo gate
    killSwitchArmed, // Phase C5: the blocked banner reads the same mirror the Settings toggle writes
    builderOptions, // Phase D2 (item 9): the JSON preview must match what connect will run
  } = useStore();

  const isRtl = language === "fa" || language === "ar";
  const status = connStatus;

  // Xray-core auto-setup state
  const [xrayReady, setXrayReady] = useState<boolean | null>(null);
  const [xrayDownloading, setXrayDownloading] = useState(false);
  const [xrayPath, setXrayPath] = useState("");

  useEffect(() => {
    async function ensureXray() {
      if (!isDesktop()) {
        setXrayReady(false);
        return;
      }
      try {
        const info = await tauriInvoke<any>("check_xray");
        if (info?.installed) {
          setXrayReady(true);
          setXrayPath(info.path);
          return;
        }
        setXrayDownloading(true);
        toast("Downloading xray-core… This only happens once.", { icon: "📥", duration: 8000 });

        const dlResult = await tauriInvoke<any>("download_xray");
        if (dlResult?.installed) {
          setXrayReady(true);
          setXrayPath(dlResult.path);
          toast.success("xray-core installed ✓");
        } else {
          setXrayReady(false);
        }
      } catch (err: any) {
        console.warn("[MEMENTO] xray check/download failed:", err);
        setXrayReady(false);
      } finally {
        setXrayDownloading(false);
      }
    }
    ensureXray();
  }, []);

  // Local UI-only state (safe to lose on tab switch — purely presentational)
  const [showJson, setShowJson] = useState(false);
  const [configDropdownOpen, setConfigDropdownOpen] = useState(false);

  // Phase C2: live-tunnel real-delay probe (spinner on the button only;
  // the sample lands in the latencyHistory slice of the connected config).
  const [urlTesting, setUrlTesting] = useState(false);
  const handleTunnelUrlTest = async () => {
    if (urlTesting || status !== "connected") return;
    setUrlTesting(true);
    try {
      const outcome = await runTunnelUrlTest(connSocksPort, connConfigId);
      if (outcome.ok && outcome.ms !== null) {
        toast.success(t("connection.urlTestDone", language).replace("{ms}", String(outcome.ms)));
      } else {
        toast.error(t("connection.urlTestFail", language).replace("{error}", outcome.error || ""));
      }
    } finally {
      setUrlTesting(false);
    }
  };
  const [search, setSearch] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [showFailoverSettings, setShowFailoverSettings] = useState(false);

  /* ---- Phase D1: IP & leak check (result is presentational -> local state) ---- */
  interface IpPathResult {
    ok: boolean; ip?: string; loc?: string; warp?: string; error?: string;
  }
  interface NetCheckResult {
    exit: IpPathResult;
    direct: IpPathResult;
    dnsServers: string[];
  }
  const [ipChecking, setIpChecking] = useState(false);
  const [ipResult, setIpResult] = useState<NetCheckResult | null>(null);
  const [ipPort, setIpPort] = useState(0);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const validConfigs = useMemo(() => configs.filter(c => c.isValid), [configs]);
  const selectedConfig = useMemo(
    () => validConfigs.find(c => c.id === connConfigId) || null,
    [validConfigs, connConfigId],
  );

  // Task 11: preview honors the same dual-core routing the real connect
  // uses — hysteria2/tuic preview their sing-box JSON (with a fresh clash_api
  // secret each render; the running connection's secret lives in main only).
  const v2rayConfig = useMemo(() => {
    if (!selectedConfig) return null;
    return configCore(selectedConfig) === "sing-box"
      ? generateSingBoxConfig(selectedConfig, connSocksPort, connHttpPort, connApiPort, builderOptions)
      : generateV2RayConfig(selectedConfig, "socks-http", connSocksPort, connHttpPort, connApiPort, builderOptions);
  }, [selectedConfig, connSocksPort, connHttpPort, connApiPort, builderOptions]);

  /** Core badge label for the ACTIVE connection ("sing-box" full text). */
  const activeCoreLabel = selectedConfig
    ? configCore(selectedConfig) === "sing-box" ? "sing-box" : "Xray"
    : null;

  const filteredConfigs = useMemo(() => {
    if (!search.trim()) return validConfigs;
    const q = search.toLowerCase();
    return validConfigs.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.address?.toLowerCase().includes(q) ||
      c.protocol?.toLowerCase().includes(q),
    );
  }, [validConfigs, search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setConfigDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Uptime ticker — derived from the persisted connStartedAt timestamp, so
  // it stays correct even if this component remounts after a tab switch.
  useEffect(() => {
    if (status === "connected" && connStartedAt) {
      const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - connStartedAt) / 1000)));
      tick();
      timerRef.current = setInterval(tick, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, connStartedAt]);

  const formatElapsed = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h > 0 ? String(h).padStart(2, "0") : null, String(m).padStart(2, "0"), String(s).padStart(2, "0")]
      .filter(Boolean)
      .join(":");
  };

  /* ---- Connect / Disconnect (delegated to the shared, store-backed module) ---- */
  const handleConnect = async () => {
    if (!selectedConfig) {
      toast.error(language === "en" || language === "zh" ? "Select a config first" : "ابتدا یک کانفیگ انتخاب کنید");
      return;
    }
    setShowLogs(false);
    await connectToConfig(selectedConfig.id);
  };

  // R3 task #2: the VPN Device (TUN) pill + the elevation outcome live in
  // the global routing view — poll it while this tab is mounted so the
  // UAC feedback toasts (accepted/cancelled/failed) always land.
  const lastLaunchFeedbackAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const rv = await tauriInvoke<any>("routing_status");
        if (cancelled) return;
        if (rv?.launchFeedback && rv.launchFeedback.atMs !== lastLaunchFeedbackAtRef.current) {
          lastLaunchFeedbackAtRef.current = rv.launchFeedback.atMs;
          if (rv.launchFeedback.ok) {
            toast.success(t("connection.tunUacAccepted", language), { duration: 6000 });
          } else {
            toast.error(
              `${t("connection.tunUacFailed", language)}${rv.launchFeedback.message ? `\n${rv.launchFeedback.message}` : ""}`,
              { duration: 12000, style: { whiteSpace: "pre-line", maxWidth: 480 } }
            );
          }
        }
      } catch {
        /* routing_status unavailable — best-effort */
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [language]);

  const handleDisconnect = async () => {
    await disconnectConnection({ manual: true });
    toast.success(t("connection.disconnected", language));
  };

  /* ---- Phase D1: IP & leak check ----
   * The main process probes Cloudflare's trace endpoint twice (through the
   * given local SOCKS port on a throwaway session + direct via Node https).
   * Port selection: an Aether session tests the AETHER core's socks port,
   * everything else tests the config connection's port — so the button is
   * meaningful for all three cores. */
  const handleIpCheck = async () => {
    if (ipChecking) return;
    setIpChecking(true);
    try {
      const st = useStore.getState();
      const aetherLive = st.aetherStatus === "connected" || st.aetherStatus === "connecting";
      const port = aetherLive
        ? (st.aetherInfo?.socks_port || 0)
        : st.connSocksPort;
      setIpPort(port);
      const res = await tauriInvoke<NetCheckResult>("net_check", { socksPort: port });
      if (res) setIpResult(res);
      else toast.error(t("ipcheck.browserMode", language));
    } catch (err: any) {
      toast.error(String(err?.message || err || "IP check failed"), { duration: 6000 });
    } finally {
      setIpChecking(false);
    }
  };

  const handleLaunchSpoofingPatt = async () => {
    if (!isDesktop()) {
      toast.error("Spoofing Patt can only be launched from the installed desktop app.");
      return;
    }
    try {
      await tauriInvoke("launch_spoofing_patt");
      toast.success("Spoofing Patt launched with Administrator privileges ✓");
    } catch (err: any) {
      toast.error(String(err?.message || err || "Could not launch Spoofing Patt"), { duration: 8000 });
    }
  };

  // Auto-reveal logs the moment an unexpected disconnect happens, even if
  // the user is looking at this tab when it occurs.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "connected" && status === "disconnected" && !useStore.getState().connManualStop) {
      setShowLogs(true);
    }
    prevStatusRef.current = status;
  }, [status]);

  /* ---- Copy / Download JSON ---- */
  const handleCopyJson = async () => {
    if (!v2rayConfig) return;
    await navigator.clipboard.writeText(v2rayConfig.json);
    toast.success("Config JSON copied ✓");
  };

  const handleDownloadJson = () => {
    if (!v2rayConfig) return;
    const blob = new Blob([v2rayConfig.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "memento-xray-config.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON downloaded ✓");
  };

  /* ---- Colors ---- */
  const statusColor: Record<string, string> = {
    disconnected: "text-ink-400",
    connecting: "text-yellow-400",
    connected: "text-emerald-400",
    error: "text-red-400",
  };

  const statusBg: Record<string, string> = {
    disconnected: "bg-ink-800/60",
    connecting: "bg-yellow-500/10 border-yellow-500/30",
    connected: "bg-emerald-500/10 border-emerald-500/30 glow-green",
    error: "bg-red-500/10 border-red-500/30",
  };

  const statusLabel: Record<string, string> = {
    disconnected: t("connection.disconnected", language),
    connecting: t("connection.connecting", language),
    connected: t("connection.connected", language),
    error: t("connection.error", language),
  };

  const fmtBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  /** Phase D1: throughput formatting — bytes/second input. */
  const fmtSpeed = (bps: number) => {
    if (bps < 1024) return `${bps} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    if (bps < 1024 * 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
    return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader
        titleKey="tab.connection"
        descKey="desc.connection"
        hintKey="hint.connection"
        icon={Shield}
      />

      {/* ---- STATUS CARD ---- */}
      <div className={cn(
        "rounded-3xl border p-6 transition-all duration-500 scale-in",
        statusBg[status],
      )}>
        {/* Phase C5: honest blocked banner — the switch is ARMED and the
            tunnel is DOWN, so system-proxy apps are failing closed right
            now. Red + role=alert: the one state the user must understand
            at a glance (it looks like “no internet” — because it is). */}
        {killSwitchArmed && (status === "disconnected" || status === "error") && (
          <div role="alert" className="mb-4 rounded-2xl border border-red-500/40 bg-red-950/60 px-4 py-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-300">{t("connection.killSwitchBlocked", language)}</p>
                <p className="text-[11px] text-surface-400 mt-1">{t("connection.killSwitchBlockedHint", language)}</p>
              </div>
            </div>
          </div>
        )}
        <div className={cn("flex flex-wrap items-center justify-between gap-4", isRtl && "flex-row-reverse")}>
          <div className={cn("flex items-center gap-4", isRtl && "flex-row-reverse")}>
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-500",
              status === "connected"
                ? "bg-gradient-to-br from-emerald-400 to-green-600 shadow-xl shadow-emerald-500/40 glow-green-strong"
                : status === "connecting"
                  ? "bg-gradient-to-br from-yellow-400 to-amber-600 shadow-xl shadow-yellow-500/30 animate-pulse"
                  : status === "error"
                    ? "bg-gradient-to-br from-red-400 to-red-600 shadow-xl shadow-red-500/30"
                    : "bg-surface-800 shadow-lg"
            )}>
              {status === "connected"
                ? <CheckCircle2 className="w-8 h-8 text-black/80" />
                : status === "connecting"
                  ? <div className="w-8 h-8 border-3 border-black/30 border-t-black/80 rounded-full animate-spin" />
                  : status === "error"
                    ? <AlertTriangle className="w-8 h-8 text-black/80" />
                    : <WifiOff className="w-8 h-8 text-ink-400" />
              }
            </div>
            <div>
              <p className={cn("text-2xl font-extrabold tracking-tight", statusColor[status])}>
                {statusLabel[status]}
              </p>
              {status === "connected" && (
                <p className="text-xs text-ink-400 font-mono mt-1">
                  PID: {connPid} · Uptime: {formatElapsed(elapsed)}
                  {selectedConfig && ` · ${selectedConfig.name || selectedConfig.address}`}
                </p>
              )}
              {status === "connected" && activeCoreLabel && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
                    activeCoreLabel === "sing-box"
                      ? "bg-pink-500/10 text-pink-300 border-pink-500/30"
                      : "bg-surface-500/10 text-ink-300 border-surface-500/30"
                  )}
                  title="Proxy core running this connection"
                >
                  <Cpu className="w-2.5 h-2.5" />
                  {activeCoreLabel}
                </span>
              )}
              {status === "connected" && connMode === "system-proxy" && (
                <p className="text-xs text-emerald-400 font-semibold mt-0.5 flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  {language === "en" || language === "zh"
                    ? `System proxy → 127.0.0.1:${connSocksPort}`
                    : `پراکسی سیستم → 127.0.0.1:${connSocksPort}`}
                </p>
              )}
            </div>
          </div>

          {/* Live Traffic Stats (only when connected) */}
          {status === "connected" && (
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 rounded-xl bg-surface-800/80 border border-emerald-500/20 flex items-center gap-3 text-xs font-mono">
                <div className="flex items-center gap-1" title="Downloaded">
                  <span className="text-emerald-400">↓</span>
                  <span className="font-bold tabular-nums text-white">{fmtBytes(connDownloadBytes)}</span>
                </div>
                <div className="flex items-center gap-1" title="Uploaded">
                  <span className="text-yellow-400">↑</span>
                  <span className="font-bold tabular-nums text-white">{fmtBytes(connUploadBytes)}</span>
                </div>
              </div>

              {/* Phase D1: live throughput — delta between consecutive 3 s polls */}
              <div
                className="px-3 py-1.5 rounded-xl bg-surface-950/80 border border-cyan-500/25 flex items-center gap-3 text-xs font-mono"
                title={t("connection.liveSpeed", language)}
              >
                <div className="flex items-center gap-1">
                  <span className="text-emerald-400">↓</span>
                  <span className={cn("font-bold tabular-nums", connDownSpeed > 0 ? "text-cyan-300" : "text-ink-400")}>
                    {fmtSpeed(connDownSpeed)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-yellow-400">↑</span>
                  <span className={cn("font-bold tabular-nums", connUpSpeed > 0 ? "text-cyan-300" : "text-ink-400")}>
                    {fmtSpeed(connUpSpeed)}
                  </span>
                </div>
                <span className={cn("w-1.5 h-1.5 rounded-full", connDownSpeed + connUpSpeed > 0 ? "bg-cyan-400 pulse-glow" : "bg-ink-600")} />
              </div>

              <button
                onClick={handleTunnelUrlTest}
                disabled={urlTesting}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors",
                  urlTesting
                    ? "bg-teal-500/20 text-teal-300 animate-pulse cursor-wait"
                    : "bg-teal-500/10 text-teal-300 hover:bg-teal-500/20"
                )}
                title={t("connection.urlTest", language)}
              >
                <Activity className={cn("w-3.5 h-3.5", urlTesting && "animate-spin")} />
                {t("connection.urlTest", language)}
              </button>

              <button
                onClick={() => setShowLogs(!showLogs)}
                className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-bold flex items-center gap-1 hover:bg-emerald-500/20 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" /> {showLogs ? "Hide Logs" : "Show Logs"}
              </button>
            </div>
          )}

          {/* Phase C1 (item 5): live traffic chart — mounted ONLY while
              connected, data-driven by the standalone trafficHistory slice
              (useSyncExternalStore), so no other component re-renders on
              sample pushes (App.tsx:61-64 perf rule respected). */}
          {status === "connected" && <TrafficChart language={language} />}

          {/* Phase E1: live per-connection stats panel — self-polling, only
              while connected AND expanded; the aggregate counters/chart
              above keep their own untouched data path. */}
          {status === "connected" && <ConnectionStatsPanel language={language} />}

          {/* Big connect/disconnect button. C3 fix (user-approved): while
              the geo gate is downloading (geoPreparing), show an explicit
              disabled "Preparing geo data…" state — the gate can take up to
              ~120s/file on a slow network and must never look like a dead
              Connect button. Re-entry is also blocked at the store level
              (connectionActions guard), covering ConfigsTab quick-connect. */}
          {geoPreparing ? (
            <button
              disabled
              aria-live="polite"
              className="flex items-center gap-3 px-8 py-4 rounded-2xl text-lg font-extrabold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 cursor-wait"
            >
              <Loader2 className="w-6 h-6 animate-spin" />
              {t("connection.preparingGeo", language)}
            </button>
          ) : status === "disconnected" || status === "error" ? (
            <button
              onClick={handleConnect}
              disabled={!selectedConfig}
              className={cn(
                "flex items-center gap-3 px-8 py-4 rounded-2xl text-lg font-extrabold transition-all duration-300 cursor-pointer",
                selectedConfig
                  ? "bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-600 text-black/90 shadow-xl shadow-emerald-500/30 glow-green hover:brightness-110 active:scale-95 hover:scale-[1.02]"
                  : "bg-surface-700 text-ink-500 cursor-not-allowed opacity-50"
              )}
            >
              <Power className="w-6 h-6" />
              {t("button.connect", language)}
            </button>
          ) : status === "connecting" ? (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl text-lg font-extrabold bg-red-500/80 text-white shadow-lg transition-all hover:bg-red-500 active:scale-95 cursor-pointer"
            >
              <Power className="w-6 h-6" />
              {t("button.cancel", language)}
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl text-lg font-extrabold bg-red-500/20 text-red-400 border border-red-500/40 shadow-lg transition-all hover:bg-red-500/30 active:scale-95 cursor-pointer"
            >
              <Power className="w-6 h-6" />
              {t("button.disconnect", language)}
            </button>
          )}
        </div>
      </div>

      {/* ---- AUTO-FAILOVER STRIP ---- */}
      <div className={cn(
        "rounded-2xl border p-4 transition-all duration-300 flex items-center justify-between gap-3 flex-wrap",
        autoFailover.enabled
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "dark:border-surface-700/60 dark:bg-surface-900/50",
      )}>
        <div className={cn("flex items-center gap-3", isRtl && "flex-row-reverse")}>
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
            autoFailover.enabled ? "bg-gradient-to-br from-emerald-400 to-green-600" : "bg-surface-800"
          )}>
            <RefreshCcw className={cn("w-5 h-5", autoFailover.enabled ? "text-black/80" : "text-ink-400")} />
          </div>
          <div>
            <p className="text-sm font-extrabold dark:text-white flex items-center gap-1.5">
              {language === "en" || language === "zh" ? "Auto Failover" : "تعویض خودکار کانفیگ"}
              <Hint text={t("hint.autoFailover", language)} size="sm" />
            </p>
            <p className="text-[11px] text-ink-400">
              {autoFailover.enabled
                ? (language === "en" || language === "zh"
                    ? `On — from ${autoFailover.scope === "group" ? "same subscription group" : "all configs"}${autoFailover.matchPort ? ", same port only" : ""}`
                    : `فعال — از ${autoFailover.scope === "group" ? "همان گروه سابسکریپشن" : "همه‌ی کانفیگ‌ها"}${autoFailover.matchPort ? "، فقط پورت یکسان" : ""}`)
                : (language === "en" || language === "zh"
                    ? "Automatically switch to another config if the connection drops"
                    : "اگر اتصال قطع شد، خودکار به یک کانفیگ دیگر وصل شود")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoFailover.enabled}
              onChange={e => setAutoFailover({ enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-surface-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full" />
          </label>
          <button
            onClick={() => setShowFailoverSettings(true)}
            title={language === "en" || language === "zh" ? "Failover settings" : "تنظیمات تعویض خودکار"}
            className="w-9 h-9 rounded-xl bg-surface-800 hover:bg-surface-700 flex items-center justify-center text-ink-300 hover:text-emerald-400 transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ---- BUNDLED SPOOFING PATT HELPER ---- */}
      <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4 flex items-center justify-between gap-3 flex-wrap shadow-lg">
        <div className={cn("flex items-center gap-3", isRtl && "flex-row-reverse")}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-600 flex items-center justify-center shadow-md shadow-violet-500/25 shrink-0">
            <PlayCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-white">Spoofing Patt</p>
            <p className="text-[11px] text-ink-400 mt-0.5">
              {language === "en" || language === "zh"
                ? "Launch the bundled helper with Administrator privileges (UAC confirmation required)."
                : "اجرای برنامه‌ی کمکی بسته‌بندی‌شده با دسترسی Administrator (نیازمند تأیید UAC)."}
            </p>
          </div>
        </div>
        <button
          onClick={handleLaunchSpoofingPatt}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-violet-400 to-fuchsia-600 text-white shadow-lg shadow-violet-500/25 hover:brightness-110 hover:scale-105 active:scale-95 transition-all cursor-pointer"
        >
          <PlayCircle className="w-4 h-4" />
          {language === "en" || language === "zh" ? "Run as Admin" : "اجرا با دسترسی ادمین"}
        </button>
      </div>

      {/* ---- MAIN GRID ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* LEFT: Config selector + connection mode */}
        <div className="space-y-5">

          {/* Config selector */}
          <div className={cn(
            "rounded-2xl border p-5 transition-all duration-300 hover:border-emerald-500/40 shadow-xl",
            "dark:border-surface-700/60 dark:bg-surface-900/50",
          )}>
            <label className="flex items-center gap-2 text-sm font-extrabold dark:text-white mb-3">
              <Eye className="w-4 h-4 text-emerald-400" />
              {t("connection.selectConfig", language)}
            </label>

            {/* Custom dropdown */}
            <div ref={dropdownRef} className="relative">
              <button
                onClick={() => setConfigDropdownOpen(!configDropdownOpen)}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all",
                  "dark:bg-surface-950/60 dark:border-surface-700/80 dark:text-ink-200",
                  "hover:border-emerald-500/50",
                  status === "connected" && "opacity-50 pointer-events-none",
                )}
                disabled={status === "connected"}
              >
                {selectedConfig ? (
                  <span className="flex items-center gap-2 truncate">
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                      "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    )}>
                      {selectedConfig.protocol}
                    </span>
                    {configCore(selectedConfig) === "sing-box" && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-500/10 text-pink-300 border border-pink-500/30">
                        sing-box
                      </span>
                    )}
                    <span className="truncate">{selectedConfig.name || selectedConfig.address}</span>
                    <span className="text-ink-500 font-mono text-xs">:{selectedConfig.port}</span>
                  </span>
                ) : (
                  <span className="text-ink-500">
                    {t("connection.chooseConfig", language)}
                  </span>
                )}
                <ChevronDown className={cn("w-4 h-4 text-ink-400 transition-transform", configDropdownOpen && "rotate-180")} />
              </button>

              {configDropdownOpen && (
                <div className="absolute top-full mt-1 left-0 right-0 z-30 max-h-60 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl shadow-black/50 scale-in">
                  <div className="p-2 border-b border-surface-800">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-950 border border-surface-700">
                      <Search className="w-3.5 h-3.5 text-ink-500" />
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t("connection.searchConfigs", language)}
                        className="flex-1 bg-transparent text-xs text-ink-200 placeholder:text-ink-600 outline-none"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-48">
                    {filteredConfigs.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-ink-500">
                        {t("connection.noConfigs", language)}
                      </div>
                    ) : (
                      filteredConfigs.map(c => {
                        const ping = pingResults[c.id];
                        return (
                          <button
                            key={c.id}
                            onClick={() => {
                              setConnState({ connConfigId: c.id });
                              setConfigDropdownOpen(false);
                              setSearch("");
                            }}
                            className={cn(
                              "w-full flex items-center gap-2 px-4 py-2.5 text-left text-xs transition-all",
                              "hover:bg-emerald-500/10",
                              connConfigId === c.id && "bg-emerald-500/10",
                            )}
                          >
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0",
                              "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            )}>
                              {c.protocol}
                            </span>
                            <span className="truncate text-ink-200">{c.name || c.address}</span>
                            {ping && ping.ping !== null && !ping.error ? (
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-bold font-mono shrink-0",
                                ping.ping < 100
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : ping.ping < 300
                                    ? "bg-yellow-500/15 text-yellow-400"
                                    : "bg-red-500/15 text-red-400"
                              )}>
                                {ping.ping}ms
                              </span>
                            ) : null}
                            <span className="ms-auto text-ink-500 font-mono shrink-0">:{c.port}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {validConfigs.length === 0 && (
              <p className="mt-2 text-xs text-ink-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t("connection.importFirst", language)}
              </p>
            )}
          </div>

          {/* Connection mode */}
          <div className={cn(
            "rounded-2xl border p-5 transition-all duration-300 hover:border-emerald-500/40 shadow-xl",
            "dark:border-surface-700/60 dark:bg-surface-900/50",
          )}>
            <label className="flex items-center gap-2 text-sm font-extrabold dark:text-white mb-4">
              <Settings className="w-4 h-4 text-emerald-400" />
              {t("connection.mode", language)}
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: "direct" as ConnMode,
                  icon: Wifi,
                  label: t("connection.modeDirect", language),
                  desc: t("connection.modeDirectDesc", language),
                  hint: t("hint.modeDirect", language),
                },
                {
                  id: "system-proxy" as ConnMode,
                  icon: MonitorSmartphone,
                  label: t("connection.modeProxy", language),
                  desc: t("connection.modeProxyDesc", language),
                  hint: t("hint.modeProxy", language),
                },
                {
                  id: "tun" as ConnMode,
                  icon: Globe,
                  label: t("connection.modeTun", language),
                  desc: t("connection.modeTunDesc", language),
                  hint: t("hint.modeTun", language),
                },
              ].map(mode => (
                <button
                  key={mode.id}
                  onClick={() => setConnState({ connMode: mode.id })}
                  className={cn(
                    "relative flex flex-col items-start gap-2 p-4 rounded-xl border transition-all duration-200 text-left",
                    connMode === mode.id
                      ? "border-emerald-400 bg-emerald-500/10 shadow-md shadow-emerald-500/10 scale-[1.02]"
                      : "border-surface-700/60 bg-surface-900/40 hover:border-surface-500",
                    status === "connected" && "opacity-50 pointer-events-none",
                  )}
                  disabled={status === "connected"}
                >
                  <span className={cn(
                    "absolute top-2 end-2",
                    status === "connected" && "pointer-events-none",
                  )}>
                    <Hint text={mode.hint} size="sm" />
                  </span>
                  <mode.icon className={cn(
                    "w-5 h-5",
                    connMode === mode.id ? "text-emerald-400" : "text-ink-400",
                  )} />
                  <div>
                    <p className={cn(
                      "text-sm font-bold",
                      connMode === mode.id ? "text-emerald-400" : "text-ink-200",
                    )}>
                      {mode.label}
                    </p>
                    <p className="text-[10px] text-ink-500 mt-0.5">{mode.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Port settings */}
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">
                  SOCKS5 {t("connection.port", language)}
                </label>
                <input
                  type="number"
                  value={connSocksPort}
                  onChange={e => setConnState({ connSocksPort: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80 transition-colors"
                  disabled={status === "connected"}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">
                  HTTP {t("connection.port", language)}
                </label>
                <input
                  type="number"
                  value={connHttpPort}
                  onChange={e => setConnState({ connHttpPort: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80 transition-colors"
                  disabled={status === "connected"}
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Config JSON preview + xray-core info */}
        <div className="space-y-5">

          {/* Xray-core status card */}
          <div className={cn(
            "rounded-2xl border p-5 transition-all duration-300 shadow-xl",
            xrayDownloading
              ? "border-yellow-500/30 bg-yellow-500/5"
              : xrayReady
                ? "border-emerald-500/20 bg-emerald-500/5"
                : isDesktop()
                  ? "border-red-500/20 bg-red-500/5"
                  : "border-yellow-500/20 bg-yellow-500/5",
          )}>
            <div className={cn("flex items-start gap-3", isRtl && "flex-row-reverse")}>
              {xrayDownloading ? (
                <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin shrink-0 mt-0.5" />
              ) : xrayReady ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : isDesktop() ? (
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-bold dark:text-white mb-1">
                  {xrayDownloading
                    ? "Downloading xray-core… Please wait"
                    : xrayReady
                      ? `xray-core Ready ✓`
                      : isDesktop()
                        ? "xray-core not found — retrying…"
                        : t("connection.browserMode", language)}
                </p>
                <p className="text-xs text-ink-400 leading-relaxed">
                  {xrayDownloading
                    ? "MEMENTO is downloading xray-core automatically. This only happens once (~15 MB)."
                    : xrayReady
                      ? `Installed at: ${xrayPath}`
                      : isDesktop()
                        ? "MEMENTO will auto-download xray-core when you click Connect."
                        : t("connection.browserDesc", language)}
                </p>

                {!isDesktop() && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={handleCopyJson}
                      disabled={!v2rayConfig}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-surface-800 text-ink-300 hover:text-emerald-400 transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      Copy JSON
                    </button>
                    <button
                      onClick={handleDownloadJson}
                      disabled={!v2rayConfig}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-surface-800 text-ink-300 hover:text-emerald-400 transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      Save JSON
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ---- Phase D1: IP & DNS-leak check ---- */}
          <div className={cn(
            "rounded-2xl border p-5 transition-all duration-300 shadow-xl",
            "dark:border-surface-700/60 dark:bg-surface-900/50",
          )}>
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <span className="text-sm font-extrabold dark:text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                {t("ipcheck.title", language)}
              </span>
              <button
                onClick={handleIpCheck}
                disabled={ipChecking}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  ipChecking
                    ? "bg-cyan-500/15 text-cyan-300 cursor-wait"
                    : "bg-gradient-to-r from-cyan-400 to-sky-600 text-white shadow-md shadow-cyan-500/20 hover:brightness-110 active:scale-95",
                )}
              >
                <RefreshCcw className={cn("w-3 h-3", ipChecking && "animate-spin")} />
                {ipChecking ? t("ipcheck.checking", language) : t("ipcheck.check", language)}
              </button>
            </div>

            <p className="text-[11px] text-ink-400 leading-relaxed mb-3">
              {t("ipcheck.desc", language)}
            </p>

            {!ipResult ? (
              <p className="text-xs text-ink-500">{t("ipcheck.idle", language)}</p>
            ) : (
              <div className="space-y-2.5">
                {/* Through-tunnel IP (tested against the local SOCKS port) */}
                <div className="rounded-xl border border-surface-700/60 bg-surface-950/50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wider">
                      {t("ipcheck.exit", language).replace("{port}", String(ipPort))}
                    </p>
                    {ipResult.exit.ok && ipResult.exit.warp && ipResult.exit.warp !== "off" && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30">
                        WARP: {ipResult.exit.warp}
                      </span>
                    )}
                  </div>
                  {ipResult.exit.ok ? (
                    <p className="text-sm font-mono font-bold text-emerald-400 mt-0.5 break-all">
                      {ipResult.exit.ip}
                      {ipResult.exit.loc && (
                        <span className="text-ink-400 text-xs font-sans font-semibold"> · {ipResult.exit.loc}</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-red-400 font-mono mt-0.5 break-all" title={ipResult.exit.error}>
                      {ipResult.exit.error}
                    </p>
                  )}
                </div>

                {/* Direct IP (Node https, never proxied) */}
                <div className="rounded-xl border border-surface-700/60 bg-surface-950/50 px-3 py-2.5">
                  <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wider">
                    {t("ipcheck.direct", language)}
                  </p>
                  {ipResult.direct.ok ? (
                    <p className="text-sm font-mono font-bold text-sky-400 mt-0.5 break-all">
                      {ipResult.direct.ip}
                      {ipResult.direct.loc && (
                        <span className="text-ink-400 text-xs font-sans font-semibold"> · {ipResult.direct.loc}</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-red-400 font-mono mt-0.5 break-all" title={ipResult.direct.error}>
                      {ipResult.direct.error}
                    </p>
                  )}
                </div>

                {/* Verdict */}
                {ipResult.exit.ok && ipResult.direct.ok && (
                  <div className={cn(
                    "rounded-xl px-3 py-2.5 flex items-center gap-2 text-xs font-bold border",
                    ipResult.exit.ip !== ipResult.direct.ip
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
                  )}>
                    {ipResult.exit.ip !== ipResult.direct.ip
                      ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                      : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    {ipResult.exit.ip !== ipResult.direct.ip
                      ? t("ipcheck.diff", language)
                      : t("ipcheck.same", language)}
                  </div>
                )}

                {/* System DNS resolvers */}
                <div className="rounded-xl border border-surface-700/60 bg-surface-950/50 px-3 py-2.5">
                  <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1">
                    {t("ipcheck.dns", language)}
                  </p>
                  {ipResult.dnsServers.length === 0 ? (
                    <p className="text-xs font-mono text-ink-500">—</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {ipResult.dnsServers.map((s, i) => (
                        <span key={`${s}-${i}`} className="px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-surface-800 text-ink-300 border border-surface-700/60">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-ink-500 leading-relaxed mt-1.5">
                    {t("ipcheck.dnsHint", language)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Live Logs — stays visible after an unexpected disconnect too,
              so the user can actually read WHY xray-core stopped instead
              of the panel disappearing the instant status flips back to
              "disconnected". */}
          {showLogs && (status === "connected" || connLogs.length > 0) && (
            <div className={cn(
              "rounded-2xl border p-4 shadow-xl max-h-72 overflow-auto font-mono text-xs",
              status === "connected"
                ? "border-emerald-500/20 bg-surface-950/80 text-emerald-300/90"
                : "border-red-500/30 bg-surface-950/80 text-red-300/90"
            )}>
              {connLogs.length === 0 ? (
                <p className="text-emerald-500/60">Waiting for logs…</p>
              ) : (
                connLogs.map((log, idx) => (
                  <div key={idx} className={cn(
                    "py-px border-l-2 pl-2 mb-px",
                    status === "connected" ? "border-emerald-500/30" : "border-red-500/40"
                  )}>
                    {log}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Config JSON Preview */}
          <div className={cn(
            "rounded-2xl border overflow-hidden transition-all duration-300 shadow-xl",
            "dark:border-surface-700/60 dark:bg-surface-900/50",
          )}>
            <div className={cn(
              "flex items-center justify-between px-5 py-3 border-b",
              "dark:border-surface-700/60 dark:bg-surface-800/80",
            )}>
              <span className="text-sm font-extrabold dark:text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400" />
                {t("connection.configPreview", language)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowJson(!showJson)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-surface-800 text-ink-400 hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  {showJson ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showJson ? "Hide" : "Show"}
                </button>
                {v2rayConfig && (
                  <button
                    onClick={handleCopyJson}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-gradient-to-r from-emerald-400 to-green-600 text-black/80 hover:brightness-110 transition-all cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    {t("button.copy", language)}
                  </button>
                )}
              </div>
            </div>

            <div className={cn(
              "overflow-auto transition-all duration-300",
              showJson ? "max-h-[500px]" : "max-h-[160px]",
            )}>
              {v2rayConfig ? (
                <pre className="p-5 text-xs font-mono leading-relaxed text-emerald-300/90 whitespace-pre-wrap break-all">
                  {showJson
                    ? v2rayConfig.json
                    : v2rayConfig.json.split("\n").slice(0, 8).join("\n") + "\n  // ..."}
                </pre>
              ) : (
                <div className="p-8 text-center">
                  <Shield className="w-10 h-10 mx-auto text-ink-600 mb-3 floaty" />
                  <p className="text-xs text-ink-500">
                    {t("connection.selectToPreview", language)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Quick setup guide */}
          <div className={cn(
            "rounded-2xl border p-5 transition-all duration-300 shadow-xl dark:border-surface-700/60 dark:bg-surface-900/50",
          )}>
            <p className="text-sm font-extrabold dark:text-white mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              {t("connection.quickStart", language)}
            </p>
            <ol className="space-y-2 text-xs text-ink-300 leading-relaxed list-decimal list-inside">
              <li dangerouslySetInnerHTML={{ __html: t("connection.step1", language) }} />
              <li dangerouslySetInnerHTML={{ __html: t("connection.step2", language) }} />
              <li dangerouslySetInnerHTML={{ __html: t("connection.step3", language) }} />
              <li dangerouslySetInnerHTML={{ __html: t("connection.step4", language) }} />
            </ol>
          </div>
        </div>
      </div>

      {/* ---- Auto-Failover Settings Modal ---- */}
      {showFailoverSettings && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-fade-in">
          <div className={cn(
            "w-full max-w-md rounded-3xl border border-emerald-500/20 bg-surface-900/95 shadow-2xl shadow-black/80 p-6 pop-in",
            isRtl && "text-right"
          )} dir={isRtl ? "rtl" : "ltr"}>
            <div className={cn("flex items-center justify-between mb-5", isRtl && "flex-row-reverse")}>
              <div className={cn("flex items-center gap-3", isRtl && "flex-row-reverse")}>
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shrink-0">
                  <RefreshCcw className="w-5 h-5 text-black/80" />
                </div>
                <h3 className="text-lg font-extrabold text-white">
                  {language === "en" || language === "zh" ? "Auto Failover Settings" : "تنظیمات تعویض خودکار کانفیگ"}
                </h3>
              </div>
              <button
                onClick={() => setShowFailoverSettings(false)}
                className="p-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-5">
              {/* Enable */}
              <div className="flex items-center justify-between rounded-xl border border-surface-700 bg-surface-950/60 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-white">
                    {language === "en" || language === "zh" ? "Enable Auto Failover" : "فعال‌سازی تعویض خودکار"}
                  </p>
                  <p className="text-[11px] text-ink-400 mt-0.5">
                    {language === "en" || language === "zh"
                      ? "Reconnect to another config if this one drops"
                      : "اتصال به کانفیگ دیگر در صورت قطع شدن این یکی"}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={autoFailover.enabled}
                    onChange={e => setAutoFailover({ enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-surface-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full" />
                </label>
              </div>

              {/* Scope */}
              <div>
                <p className="text-xs font-bold text-ink-400 uppercase tracking-wider mb-2">
                  {language === "en" || language === "zh"
                    ? "Pick replacement config from…"
                    : "کانفیگ جایگزین از کجا انتخاب شود؟"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setAutoFailover({ scope: "group" })}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      autoFailover.scope === "group"
                        ? "border-emerald-400 bg-emerald-500/10"
                        : "border-surface-700 bg-surface-950/40 hover:border-surface-500"
                    )}
                  >
                    <p className={cn("text-xs font-bold", autoFailover.scope === "group" ? "text-emerald-400" : "text-ink-200")}>
                      {language === "en" || language === "zh" ? "Same Group" : "همان گروه سابسکریپشن"}
                    </p>
                    <p className="text-[10px] text-ink-500 mt-1">
                      {language === "en" || language === "zh"
                        ? "Only configs from the same subscription group"
                        : "فقط کانفیگ‌های همان subscription group"}
                    </p>
                  </button>
                  <button
                    onClick={() => setAutoFailover({ scope: "all" })}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      autoFailover.scope === "all"
                        ? "border-emerald-400 bg-emerald-500/10"
                        : "border-surface-700 bg-surface-950/40 hover:border-surface-500"
                    )}
                  >
                    <p className={cn("text-xs font-bold", autoFailover.scope === "all" ? "text-emerald-400" : "text-ink-200")}>
                      {language === "en" || language === "zh" ? "All Configs" : "همه‌ی کانفیگ‌ها"}
                    </p>
                    <p className="text-[10px] text-ink-500 mt-1">
                      {language === "en" || language === "zh"
                        ? "Consider every valid config in the table"
                        : "هر کانفیگ معتبر در جدول"}
                    </p>
                  </button>
                </div>
              </div>

              {/* Match port */}
              <div className="flex items-center justify-between rounded-xl border border-surface-700 bg-surface-950/60 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-white">
                    {language === "en" || language === "zh" ? "Require Same Port" : "پورت یکسان الزامی باشد"}
                  </p>
                  <p className="text-[11px] text-ink-400 mt-0.5">
                    {language === "en" || language === "zh"
                      ? "Replacement must use the same port as the failed config"
                      : "کانفیگ جایگزین باید همان پورت کانفیگ قطع‌شده را داشته باشد"}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={autoFailover.matchPort}
                    onChange={e => setAutoFailover({ matchPort: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-surface-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full" />
                </label>
              </div>

              {autoFailover.scope === "group" && subscriptionGroups.length === 0 && (
                <div className="flex items-start gap-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-yellow-300 leading-relaxed">
                    {language === "en" || language === "zh"
                      ? "You have no Subscription Groups yet — failover will fall back to all configs."
                      : "هنوز هیچ Subscription Group ای ندارید — تعویض خودکار از بین همه‌ی کانفیگ‌ها انتخاب می‌کند."}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowFailoverSettings(false)}
              className="mt-6 w-full py-3 rounded-2xl font-extrabold text-sm bg-gradient-to-r from-emerald-400 to-green-600 text-black/90 hover:brightness-110 shadow-lg shadow-emerald-500/30 transition-all cursor-pointer"
            >
              {language === "en" || language === "zh" ? "Done" : "تمام"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
