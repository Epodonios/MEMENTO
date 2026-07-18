import { useState, useMemo, useCallback } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { editLink } from "../utils/editor";
import {
  Copy, Download, Code, FileJson, Share2, Zap, Edit3, Check,
  FolderOpen, Route, Hash, Gauge, X, Sliders
} from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";

type ExportFormat = "raw" | "json" | "clash" | "surge" | "singbox" | "base64";

function configTransportTokens(config: { network?: string; type?: string; security?: string }): string[] {
  // Users commonly think of TLS/Reality as part of the transport profile,
  // so expose both the network layer (ws/grpc/tcp/...) and security layer
  // (tls/reality) as independently selectable transport chips.
  return Array.from(new Set([
    (config.network || config.type || "tcp").toLowerCase(),
    config.security && config.security !== "none" ? config.security.toLowerCase() : "",
  ].filter(Boolean)));
}

export default function ExportTab() {
  const { configs, language, subscriptionGroups, pingResults } = useStore();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("raw");
  const [includeInvalid, setIncludeInvalid] = useState(false);

  // Bulk Rename state
  const [renamePattern, setRenamePattern] = useState("");
  const [applyRename, setApplyRename] = useState(false);

  // Export scope: all configs, or a single Subscription Group
  const [scopeByGroup, setScopeByGroup] = useState(false);
  const [exportGroupId, setExportGroupId] = useState<string | null>(null);

  // Advanced multi-select filter state
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [selectedTransports, setSelectedTransports] = useState<Set<string>>(new Set());
  const [selectedPorts, setSelectedPorts] = useState<Set<string>>(new Set());
  const [selectedProtocols, setSelectedProtocols] = useState<Set<string>>(new Set());
  const [maxPing, setMaxPing] = useState<number>(300);

  const isRtl = language === "fa" || language === "ar";

  // Derived: unique values from configs
  const allTransports = useMemo(() => {
    const set = new Set<string>();
    configs.forEach(c => configTransportTokens(c).forEach(token => set.add(token)));
    return Array.from(set).sort();
  }, [configs]);

  const allPorts = useMemo(() => {
    const set = new Set<string>();
    configs.forEach(c => {
      const p = String(c.port || "");
      if (p) set.add(p);
    });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [configs]);

  const allProtocols = useMemo(() => {
    const set = new Set<string>();
    configs.forEach(c => set.add(c.protocol));
    return Array.from(set).sort();
  }, [configs]);

  const toggleFilter = (f: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const toggleItem = (set: Set<string>, setFn: (s: Set<string>) => void, val: string) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    setFn(next);
  };

  const validConfigs = useMemo(() => {
    let list = includeInvalid ? configs : configs.filter(c => c.isValid);

    // Scope to a single Subscription Group if requested
    if (scopeByGroup && exportGroupId) {
      const group = subscriptionGroups.find(g => g.id === exportGroupId);
      if (group) {
        const idSet = new Set(group.configIds);
        list = list.filter(c => idSet.has(c.id));
      }
    }

    // Apply advanced multi-select filters
    if (activeFilters.has("transport") && selectedTransports.size > 0) {
      list = list.filter(c => configTransportTokens(c).some(token => selectedTransports.has(token)));
    }
    if (activeFilters.has("port") && selectedPorts.size > 0) {
      list = list.filter(c => selectedPorts.has(String(c.port)));
    }
    if (activeFilters.has("protocol") && selectedProtocols.size > 0) {
      list = list.filter(c => selectedProtocols.has(c.protocol));
    }
    if (activeFilters.has("ping")) {
      list = list.filter(c => {
        const pr = pingResults[c.id];
        if (!pr || pr.ping === null || pr.error) return false;
        return pr.ping <= maxPing;
      });
    }

    // Apply Bulk Rename if active and pattern provided
    if (!applyRename || !renamePattern.trim()) {
      return list;
    }

    return list.map((c, idx) => {
      let newName = renamePattern.trim();
      // If user includes %i%, replace with index; else append index if multiple
      if (newName.includes("%i%")) {
        newName = newName.replace(/%i%/g, String(idx + 1));
      } else if (list.length > 1) {
        newName = `${newName} ${idx + 1}`;
      }

      // We use editLink helper to safely reconstruct the raw link with the new remark/name
      const rebuiltRaw = editLink(c.raw, { appendName: newName }); // Assuming editLink can replace or append. 
      // Actually editLink's appendName appends. To fully replace, we can rebuild or just update c.name for json/clash/surge/singbox.
      // Let's create a custom raw link if it's raw/base64, or just update the object.
      // In editLink, if we want exact replace, let's look at how c.raw is constructed or just handle it per protocol.
      return {
        ...c,
        name: newName,
        raw: updateRawRemark(c.raw, c.protocol, newName) || rebuiltRaw,
      };
    });
  }, [configs, includeInvalid, applyRename, renamePattern, scopeByGroup, exportGroupId, subscriptionGroups, activeFilters, selectedTransports, selectedPorts, selectedProtocols, maxPing, pingResults]);

  const exportData = useMemo(() => {
    switch (selectedFormat) {
      case "raw":
        return validConfigs.map(c => c.raw).join("\n");

      case "json": {
        const obj = validConfigs.map(c => ({
          protocol: c.protocol,
          name: c.name,
          address: c.address,
          port: c.port,
          uuid: c.uuid,
          security: c.security,
          network: c.network,
          sni: c.sni,
          host: c.host,
          path: c.path,
          type: c.type,
          fingerprint: c.fingerprint,
        }));
        return JSON.stringify(obj, null, 2);
      }

      case "base64": {
        const raw = validConfigs.map(c => c.raw).join("\n");
        return btoa(raw);
      }

      case "clash": {
        const proxies = validConfigs
          .filter(c => ["vmess", "vless", "trojan", "ss", "ssr"].includes(c.protocol))
          .map(c => {
            const base: any = {
              name: c.name || `${c.protocol}-${c.address}`,
              server: c.address,
              port: Number(c.port) || 443,
              type: c.protocol,
            };

            if (c.protocol === "vmess") {
              base.uuid = c.uuid;
              base.alterId = 0;
              base.cipher = c.security || "auto";
              base.network = c.network || "tcp";
              if (c.host) base.wsHeaders = { Host: c.host };
              if (c.path) base.wsPath = c.path;
              base.tls = c.security === "tls";
              base.servername = c.sni || "";
            } else if (c.protocol === "vless" || c.protocol === "trojan") {
              base.uuid = c.uuid || c.password;
              base.network = c.network || "tcp";
              if (c.host) base.wsHeaders = { Host: c.host };
              if (c.path) base.wsPath = c.path;
              base.tls = true;
              base.servername = c.sni || c.address;
              if (c.flow) base.flow = c.flow;
              if (c.fingerprint) base.clientFingerprint = c.fingerprint;
            } else {
              base.password = c.password;
              base.cipher = c.method || "aes-256-gcm";
            }

            return base;
          });

        return JSON.stringify({ proxies }, null, 2);
      }

      case "surge": {
        return validConfigs
          .filter(c => ["vmess", "vless", "trojan", "ss"].includes(c.protocol))
          .map(c => {
            if (c.protocol === "ss") {
              return `ss = ${c.protocol}, ${c.address}, ${c.port}, encrypt-method=${c.method}, password=${c.password}${c.name ? `, tag=${c.name}` : ""}`;
            }
            if (c.protocol === "trojan") {
              return `trojan = ${c.address}, ${c.port}, password=${c.password}${c.sni ? `, sni=${c.sni}` : ""}${c.name ? `, tag=${c.name}` : ""}`;
            }
            return `vmess = ${c.address}, ${c.port}, username=${c.uuid || ""}${c.name ? `, tag=${c.name}` : ""}`;
          }).join("\n");
      }

      case "singbox": {
        const outbounds = validConfigs.map((c, i) => {
          const ob: any = {
            type: c.protocol,
            tag: c.name || `${c.protocol}-out-${i}`,
            server: c.address,
            server_port: Number(c.port) || 443,
          };

          if (c.protocol === "vmess") {
            ob.uuid = c.uuid;
            ob.security = c.security || "auto";
            ob.transport = { type: c.network || "tcp" };
            if (c.host) ob.transport.host = c.host;
            if (c.path) ob.transport.path = c.path;
          } else if (c.protocol === "vless" || c.protocol === "trojan") {
            ob.uuid = c.uuid || c.password;
            const tls: any = { enabled: true, server_name: c.sni || c.address };
            if (c.fingerprint) tls.utls = { fingerprint: c.fingerprint };
            ob.tls = tls;
            ob.transport = { type: c.network || "tcp" };
            if (c.host) ob.transport.host = c.host;
            if (c.path) ob.transport.path = c.path;
          } else {
            ob.password = c.password;
            ob.method = c.method || "aes-256-gcm";
          }

          return ob;
        });

        return JSON.stringify({ outbounds }, null, 2);
      }

      default:
        return "";
    }
  }, [validConfigs, selectedFormat]);

  const copyToClipboard = useCallback(async () => {
    if (!exportData.trim()) {
      toast.error(t("message.noData", language));
      return;
    }
    await navigator.clipboard.writeText(exportData);
    toast.success(`Copied ${selectedFormat.toUpperCase()} export`);
  }, [exportData, selectedFormat, language]);

  const downloadFile = useCallback(() => {
    if (!exportData.trim()) {
      toast.error(t("message.noData", language));
      return;
    }
    const extMap: Record<ExportFormat, string> = {
      raw: "txt", json: "json", clash: "yaml", surge: "conf", singbox: "json", base64: "txt"
    };
    const mimeMap: Record<ExportFormat, string> = {
      raw: "text/plain", json: "application/json", clash: "text/yaml",
      surge: "text/plain", singbox: "application/json", base64: "text/plain"
    };

    const blob = new Blob([exportData], { type: mimeMap[selectedFormat] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `v2ray-config.${extMap[selectedFormat]}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("File downloaded successfully");
  }, [exportData, selectedFormat, language]);

  const formatOptions: { id: ExportFormat; label: string; icon: React.ElementType; desc: string }[] = [
    { id: "raw", label: "Raw Links", icon: Share2, desc: "Original share links" },
    { id: "base64", label: "Base64", icon: Code, desc: "Subscription format" },
    { id: "json", label: "JSON", icon: FileJson, desc: "Structured JSON" },
    { id: "clash", label: "Clash Meta", icon: Zap, desc: "Clash Meta YAML" },
    { id: "surge", label: "Surge Proxy", icon: Zap, desc: "Surge config" },
    { id: "singbox", label: "Sing-Box Out", icon: Zap, desc: "Sing-Box config" },
  ];

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader titleKey="tab.export" descKey="desc.export" icon={Share2} />

      {/* Format Selection Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 stagger">
        {formatOptions.map(opt => {
          const Icon = opt.icon;
          const isSelected = selectedFormat === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setSelectedFormat(opt.id)}
              className={cn(
                "p-4 rounded-2xl border text-left transition-all duration-300 relative overflow-hidden hover-lift shine cursor-pointer",
                isRtl && "text-right",
                isSelected
                  ? "border-emerald-400 bg-gradient-to-br from-emerald-500/15 to-green-500/5 shadow-lg shadow-emerald-500/20 scale-[1.02]"
                  : "dark:border-surface-700/60 dark:bg-surface-900/40 dark:hover:border-surface-500 light:border-surface-200 light:bg-white light:hover:border-surface-400"
              )}
            >
              {isSelected && (
                <div className="absolute top-0 right-0 w-12 h-12 bg-emerald-400/20 rounded-bl-full flex items-start justify-end p-2 pointer-events-none">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              )}
              <Icon className={cn(
                "w-6 h-6 mb-3 transition-transform duration-300",
                isSelected ? "text-emerald-400 scale-110" : "dark:text-ink-400 light:text-ink-500"
              )} />
              <div className={cn(
                "text-sm font-extrabold tracking-tight",
                isSelected ? "text-emerald-400" : "dark:text-white light:text-ink-900"
              )}>
                {opt.label}
              </div>
              <div className="text-xs dark:text-ink-400 light:text-ink-500 mt-1 font-medium">
                {opt.desc}
              </div>
            </button>
          );
        })}
      </div>

      {/* Advanced Multi-Select Filters */}
      <div className={cn(
        "p-5 rounded-2xl border dark:border-surface-700/60 light:border-surface-200 shadow-xl relative overflow-hidden",
        "dark:bg-surface-900/40 light:bg-white",
        isRtl && "text-right"
      )}>
        <div className="absolute -top-16 -left-16 w-40 h-40 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-2 mb-4">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <p className="text-sm font-extrabold dark:text-white">
            {language === "en" || language === "zh" ? "Advanced Filters (Multi-Select)" : "فیلترهای پیشرفته (چند انتخابی)"}
          </p>
          {(activeFilters.size > 0 || scopeByGroup) && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">
              {activeFilters.size + (scopeByGroup ? 1 : 0)} active
            </span>
          )}
          <span className="ml-auto px-2.5 py-1 rounded-full border border-emerald-500/20 bg-surface-950/60 text-[10px] font-mono font-bold text-emerald-300 tabular-nums">
            {validConfigs.length} / {configs.length} live results
          </span>
        </div>

        <div className="relative z-10 space-y-4">
          {/* Filter type buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setScopeByGroup(!scopeByGroup)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all duration-300 cursor-pointer",
                scopeByGroup
                  ? "border-emerald-400 bg-emerald-500/10 text-emerald-400 shadow-md shadow-emerald-500/10 scale-105"
                  : "dark:border-surface-700/60 dark:text-ink-400 light:border-surface-200 light:text-ink-500 hover:border-emerald-500/40"
              )}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {language === "en" || language === "zh" ? "Subscription Group" : "گروه سابسکریپشن"}
              {scopeByGroup && <Check className="w-3 h-3 ml-0.5" />}
            </button>

            {([
              { id: "transport", label: language === "fa" || language === "ar" ? "ترنسپورت" : "Transport", icon: Route },
              { id: "port", label: language === "fa" || language === "ar" ? "پورت" : "Port", icon: Hash },
              { id: "protocol", label: language === "fa" || language === "ar" ? "پروتکل" : "Protocol", icon: Share2 },
              { id: "ping", label: "Ping", icon: Gauge },
            ]).map(f => {
              const Icon = f.icon;
              const isActive = activeFilters.has(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => toggleFilter(f.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer",
                    isActive
                      ? "border-emerald-400 bg-emerald-500/10 text-emerald-400 shadow-md shadow-emerald-500/10 scale-105"
                      : "dark:border-surface-700/60 dark:text-ink-400 light:border-surface-200 light:text-ink-500 hover:border-emerald-500/40"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {f.label}
                  {isActive && <Check className="w-3 h-3 ml-0.5" />}
                </button>
              );
            })}

            {(activeFilters.size > 0 || scopeByGroup) && (
              <button
                onClick={() => {
                  setActiveFilters(new Set());
                  setSelectedTransports(new Set());
                  setSelectedPorts(new Set());
                  setSelectedProtocols(new Set());
                  setScopeByGroup(false);
                  setExportGroupId(null);
                }}
                className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
              >
                <X className="w-3 h-3" />
                {language === "en" || language === "zh" ? "Clear All" : "پاک‌سازی"}
              </button>
            )}
          </div>

          {/* Subscription group scope — animated card picker lives inside
              Advanced Filters instead of a detached, duplicate section. */}
          {scopeByGroup && (
            <div className="animate-fade-in rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                <p className="text-xs font-extrabold text-white">
                  {language === "en" || language === "zh" ? "Choose a Subscription Group" : "یک Subscription Group انتخاب کنید"}
                </p>
              </div>
              {subscriptionGroups.length === 0 ? (
                <p className="text-xs text-yellow-400">{language === "en" || language === "zh" ? "No groups available." : "هیچ گروهی وجود ندارد."}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 stagger">
                  {subscriptionGroups.map(g => (
                    <button
                      key={g.id}
                      onClick={() => setExportGroupId(g.id)}
                      className={cn(
                        "flex items-center justify-between gap-2 p-3 rounded-xl border text-left transition-all duration-300 hover-lift cursor-pointer",
                        exportGroupId === g.id
                          ? "border-emerald-400 bg-emerald-500/15 shadow-md shadow-emerald-500/15"
                          : "border-surface-700/70 bg-surface-950/50 hover:border-emerald-500/40"
                      )}
                    >
                      <span className={cn("text-xs font-bold truncate", exportGroupId === g.id ? "text-emerald-300" : "text-ink-200")}>{g.name}</span>
                      <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-surface-900 text-ink-400 shrink-0">{g.configIds.length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Transport filter values */}
          {activeFilters.has("transport") && (
            <div className="scale-in space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
                <Route className="w-3 h-3" />
                {language === "en" || language === "zh" ? "Select transports" : "ترنسپورت‌ها را انتخاب کنید"}
                <span className="text-emerald-400 normal-case">({selectedTransports.size}/{allTransports.length})</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allTransports.map(tr => (
                  <button
                    key={tr}
                    onClick={() => toggleItem(selectedTransports, setSelectedTransports, tr)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-all cursor-pointer",
                      selectedTransports.has(tr)
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-400"
                        : "dark:border-surface-700/60 dark:text-ink-400 light:border-surface-200 light:text-ink-500 hover:border-emerald-500/40"
                    )}
                  >
                    {tr}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Port filter values */}
          {activeFilters.has("port") && (
            <div className="scale-in space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
                <Hash className="w-3 h-3" />
                {language === "en" || language === "zh" ? "Select ports" : "پورت‌ها را انتخاب کنید"}
                <span className="text-emerald-400 normal-case">({selectedPorts.size}/{allPorts.length})</span>
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {allPorts.map(p => (
                  <button
                    key={p}
                    onClick={() => toggleItem(selectedPorts, setSelectedPorts, p)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-all cursor-pointer",
                      selectedPorts.has(p)
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-400"
                        : "dark:border-surface-700/60 dark:text-ink-400 light:border-surface-200 light:text-ink-500 hover:border-emerald-500/40"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Protocol filter values */}
          {activeFilters.has("protocol") && (
            <div className="scale-in space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
                <Share2 className="w-3 h-3" />
                {language === "en" || language === "zh" ? "Select protocols" : "پروتکل‌ها را انتخاب کنید"}
                <span className="text-emerald-400 normal-case">({selectedProtocols.size}/{allProtocols.length})</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allProtocols.map(p => (
                  <button
                    key={p}
                    onClick={() => toggleItem(selectedProtocols, setSelectedProtocols, p)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase border transition-all cursor-pointer",
                      selectedProtocols.has(p)
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-400"
                        : "dark:border-surface-700/60 dark:text-ink-400 light:border-surface-200 light:text-ink-500 hover:border-emerald-500/40"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ping max filter */}
          {activeFilters.has("ping") && (
            <div className="scale-in space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
                <Gauge className="w-3 h-3" />
                {language === "en" || language === "zh" ? "Maximum ping" : "حداکثر پینگ"}
                <span className="text-emerald-400 font-mono">≤ {maxPing}ms</span>
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={10}
                  max={2000}
                  step={10}
                  value={maxPing}
                  onChange={e => setMaxPing(Number(e.target.value))}
                  className="flex-1 accent-emerald-500 h-1.5"
                />
                <input
                  type="number"
                  value={maxPing}
                  onChange={e => setMaxPing(Math.max(10, Number(e.target.value) || 10))}
                  className="w-20 px-2 py-1.5 rounded-lg text-xs font-mono text-center border dark:bg-surface-950 dark:border-surface-700 dark:text-emerald-300 outline-none focus:border-emerald-500"
                />
                <span className="text-xs text-ink-500">ms</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Control Toolbox: Bulk Rename + Invalid Switch */}
      <div className={cn(
        "p-5 rounded-2xl border dark:border-surface-700/60 light:border-surface-200 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl",
        "dark:bg-surface-900/40 light:bg-white",
        isRtl && "flex-row-reverse"
      )}>
        {/* Bulk Rename section */}
        <div className={cn("flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto", isRtl && "flex-row-reverse")}>
          <button
            onClick={() => setApplyRename(!applyRename)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer w-full sm:w-auto justify-center shrink-0",
              applyRename
                ? "bg-gradient-to-r from-emerald-400 to-green-600 text-black shadow-md shadow-emerald-500/30 scale-105"
                : "dark:bg-surface-800 dark:text-ink-300 light:bg-surface-100 light:text-ink-700 hover:dark:text-white"
            )}
          >
            <Edit3 className="w-4 h-4" />
            {applyRename ? "Bulk Rename: Active" : "Enable Bulk Rename"}
          </button>

          {applyRename && (
            <div className={cn("flex items-center gap-2 w-full sm:w-auto scale-in", isRtl && "flex-row-reverse")}>
              <input
                type="text"
                value={renamePattern}
                onChange={(e) => setRenamePattern(e.target.value)}
                placeholder="e.g. MEMENTO VIP (%i% for index)"
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-mono font-semibold border transition-all w-full sm:w-64",
                  isRtl && "text-right",
                  "dark:bg-surface-950 dark:border-surface-700 dark:text-emerald-300 dark:placeholder:text-ink-600",
                  "light:bg-surface-50 light:border-surface-300 light:text-emerald-700 light:placeholder:text-ink-400",
                  "focus:outline-none focus:border-emerald-500 glow-green"
                )}
              />
            </div>
          )}
        </div>

        {/* Checkbox option */}
        <label className={cn("flex items-center gap-2 cursor-pointer select-none px-2", isRtl && "flex-row-reverse")}>
          <input
            type="checkbox"
            checked={includeInvalid}
            onChange={(e) => setIncludeInvalid(e.target.checked)}
            className="w-4 h-4 rounded accent-emerald-400 bg-surface-800 cursor-pointer"
          />
          <span className="text-xs font-bold dark:text-ink-200 light:text-ink-800 tracking-wide">
            Include invalid / broken configs
          </span>
        </label>
      </div>

      {/* Preview Box & Output Controls */}
      <div className={cn(
        "rounded-2xl border overflow-hidden shine transition-all duration-300 shadow-2xl",
        "dark:border-surface-700/60 dark:bg-surface-900/50",
        "light:border-surface-200 light:bg-white"
      )}>
        <div className={cn(
          "flex items-center justify-between px-5 py-3 border-b",
          "dark:border-surface-700/60 dark:bg-surface-800/80",
          "light:border-surface-200 light:bg-surface-50",
          isRtl && "flex-row-reverse"
        )}>
          <span className="text-sm font-extrabold dark:text-white light:text-ink-900 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-glow" />
            Live Preview <span className="text-xs font-mono dark:text-ink-400 light:text-ink-500">({exportData.split("\n").length} lines)</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-extrabold text-black/90 bg-gradient-to-r from-emerald-400 to-green-600 hover:from-emerald-300 hover:to-green-500 shadow-md shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              {t("button.copy", language)}
            </button>
            <button
              onClick={downloadFile}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-extrabold text-black/90 bg-gradient-to-r from-green-400 via-emerald-500 to-teal-500 hover:brightness-110 shadow-md shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              {t("button.download", language)}
            </button>
          </div>
        </div>

        <pre className={cn(
          "p-5 text-sm font-mono overflow-auto max-h-[500px] min-h-[150px] whitespace-pre-wrap break-all leading-relaxed",
          "dark:bg-transparent dark:text-emerald-300/90",
          "light:bg-transparent light:text-emerald-800"
        )}>
          {exportData || "Import valid configs to see preview..."}
        </pre>
      </div>
    </div>
  );
}

/**
 * Safely replaces the exact remark/name of a raw V2Ray link.
 */
function updateRawRemark(link: string, protocol: string, newName: string): string | null {
  try {
    if (protocol === "vmess") {
      const b64 = link.replace("vmess://", "");
      let padded = b64;
      if (padded.length % 4 > 0) padded += "=".repeat(4 - (padded.length % 4));
      const json = decodeURIComponent(escape(atob(padded)));
      const obj = JSON.parse(json);
      obj.ps = newName;
      return "vmess://" + btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    } else if (["vless", "trojan", "hysteria2", "tuic"].includes(protocol)) {
      const hashIdx = link.lastIndexOf("#");
      const core = hashIdx > -1 ? link.slice(0, hashIdx) : link;
      return `${core}#${encodeURIComponent(newName)}`;
    } else if (protocol === "ss") {
      const hashIdx = link.lastIndexOf("#");
      const core = hashIdx > -1 ? link.slice(0, hashIdx) : link;
      return `${core}#${encodeURIComponent(newName)}`;
    } else if (protocol === "ssr") {
      const b64 = link.replace("ssr://", "");
      let padded = b64;
      if (padded.length % 4 > 0) padded += "=".repeat(4 - (padded.length % 4));
      const decoded = decodeURIComponent(escape(atob(padded)));
      const [core, ...queryParts] = decoded.split("/?");
      const queryStr = queryParts.join("/?");
      const params = new URLSearchParams(queryStr);
      params.set("remarks", btoa(unescape(encodeURIComponent(newName))));
      return "ssr://" + btoa(unescape(encodeURIComponent(`${core}/?${params.toString()}`)));
    }
  } catch {
    return null;
  }
  return null;
}
