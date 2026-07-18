import { useState, useEffect, useRef, useMemo } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import {
  Power, Shield, Wifi, WifiOff, Search, ChevronDown,
  AlertTriangle, CheckCircle2, Copy, Download,
  Settings, Globe, Zap, Eye, EyeOff, MonitorSmartphone, X, RefreshCcw, PlayCircle
} from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import { generateV2RayConfig } from "../utils/v2rayConfig";
import { isTauri, tauriInvoke } from "../utils/tauriBridge";
import { connectToConfig, disconnectConnection } from "../utils/connectionActions";

type ConnMode = "direct" | "system-proxy";

export default function ConnectionTab() {
  const {
    configs, language, pingResults, subscriptionGroups,
    connStatus, connConfigId, connPid, connStartedAt,
    connMode, connSocksPort, connHttpPort, connApiPort,
    connDownloadBytes, connUploadBytes, connLogs,
    setConnState, autoFailover, setAutoFailover,
  } = useStore();

  const isRtl = language === "fa" || language === "ar";
  const status = connStatus;

  // Xray-core auto-setup state
  const [xrayReady, setXrayReady] = useState<boolean | null>(null);
  const [xrayDownloading, setXrayDownloading] = useState(false);
  const [xrayPath, setXrayPath] = useState("");

  useEffect(() => {
    async function ensureXray() {
      if (!isTauri()) {
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
  const [search, setSearch] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [showFailoverSettings, setShowFailoverSettings] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const validConfigs = useMemo(() => configs.filter(c => c.isValid), [configs]);
  const selectedConfig = useMemo(
    () => validConfigs.find(c => c.id === connConfigId) || null,
    [validConfigs, connConfigId],
  );

  const v2rayConfig = useMemo(() => {
    if (!selectedConfig) return null;
    return generateV2RayConfig(selectedConfig, "socks-http", connSocksPort, connHttpPort, connApiPort);
  }, [selectedConfig, connSocksPort, connHttpPort, connApiPort]);

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

  const handleDisconnect = async () => {
    await disconnectConnection({ manual: true });
    toast.success(t("connection.disconnected", language));
  };

  const handleLaunchSpoofingPatt = async () => {
    if (!isTauri()) {
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

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader
        titleKey="tab.connection"
        descKey="desc.connection"
        icon={Shield}
      />

      {/* ---- STATUS CARD ---- */}
      <div className={cn(
        "rounded-3xl border p-6 transition-all duration-500 scale-in",
        statusBg[status],
      )}>
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

              <button
                onClick={() => setShowLogs(!showLogs)}
                className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-bold flex items-center gap-1 hover:bg-emerald-500/20 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" /> {showLogs ? "Hide Logs" : "Show Logs"}
              </button>
            </div>
          )}

          {/* Big connect/disconnect button */}
          {status === "disconnected" || status === "error" ? (
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
            <p className="text-sm font-extrabold dark:text-white">
              {language === "en" || language === "zh" ? "Auto Failover" : "تعویض خودکار کانفیگ"}
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

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  id: "direct" as ConnMode,
                  icon: Wifi,
                  label: t("connection.modeDirect", language),
                  desc: t("connection.modeDirectDesc", language),
                },
                {
                  id: "system-proxy" as ConnMode,
                  icon: MonitorSmartphone,
                  label: t("connection.modeProxy", language),
                  desc: t("connection.modeProxyDesc", language),
                },
              ].map(mode => (
                <button
                  key={mode.id}
                  onClick={() => setConnState({ connMode: mode.id })}
                  className={cn(
                    "flex flex-col items-start gap-2 p-4 rounded-xl border transition-all duration-200 text-left",
                    connMode === mode.id
                      ? "border-emerald-400 bg-emerald-500/10 shadow-md shadow-emerald-500/10 scale-[1.02]"
                      : "border-surface-700/60 bg-surface-900/40 hover:border-surface-500",
                    status === "connected" && "opacity-50 pointer-events-none",
                  )}
                  disabled={status === "connected"}
                >
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
                : isTauri()
                  ? "border-red-500/20 bg-red-500/5"
                  : "border-yellow-500/20 bg-yellow-500/5",
          )}>
            <div className={cn("flex items-start gap-3", isRtl && "flex-row-reverse")}>
              {xrayDownloading ? (
                <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin shrink-0 mt-0.5" />
              ) : xrayReady ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : isTauri() ? (
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
                      : isTauri()
                        ? "xray-core not found — retrying…"
                        : t("connection.browserMode", language)}
                </p>
                <p className="text-xs text-ink-400 leading-relaxed">
                  {xrayDownloading
                    ? "MEMENTO is downloading xray-core automatically. This only happens once (~15 MB)."
                    : xrayReady
                      ? `Installed at: ${xrayPath}`
                      : isTauri()
                        ? "MEMENTO will auto-download xray-core when you click Connect."
                        : t("connection.browserDesc", language)}
                </p>

                {!isTauri() && (
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
