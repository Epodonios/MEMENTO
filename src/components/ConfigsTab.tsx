import { useMemo, useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useStore, ParsedConfig, ProtocolType, configCore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { extractIpFromConfig } from "../utils/ping";
import { pingManyFast } from "../utils/fastPing";
import { runUrlTest, runUrlTestBatch } from "../utils/urlTest";
import { getLatencyHistory, subscribeLatencyHistory, type LatencySample } from "../utils/latencyHistory";
import { isDesktop } from "../utils/tauriBridge";
import { playNotificationSound, showBrowserNotification } from "../utils/notification";
import { fetchSubscriptionDetailed } from "../utils/subscription";
import { connectToConfig } from "../utils/connectionActions";
import QrModal from "./QrModal";
import {
  Search, Filter, Trash2, Copy, CheckSquare, Square, ChevronDown,
  Server, Shield, Key, Globe, Fingerprint, Wifi, Route, Cpu,
  AlertTriangle, CheckCircle2, ArrowUpDown, Table, Zap, RefreshCw, FolderOpen, Plug, Gauge,
  Activity, BarChart3, QrCode
} from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import { ManageGroupsModal } from "./SubscriptionGroups";
import BrokersModal from "./BrokersModal";

const protocolColors: Record<ProtocolType, string> = {
  vmess: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  vless: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  trojan: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  ss: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  ssr: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  socks: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  hysteria2: "bg-pink-500/10 text-pink-400 border-pink-500/30",
  tuic: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  // Task E2: amber-family chip — the honest "proprietary scheme" accent
  // matching the Import tab's non-standard disclosure color.
  shadowtls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
};

type SortField = "name" | "protocol" | "address" | "port" | "isValid" | "ping";
type SortDir = "asc" | "desc";

export default function ConfigsTab() {
  const {
    configs, selectedIds, toggleSelect, setSelectedIds, selectAll, deselectAll,
    filter, setFilter, searchTerm, setSearchTerm, removeConfigs,
    pingResults, setPingResult, notificationMode, language,
    subscriptionGroups
  } = useStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pinging, setPinging] = useState(false);
  // Phase C2: real-delay URL-test batch (progress + click-again-to-cancel)
  const [urlTesting, setUrlTesting] = useState(false);
  const [urlTestProgress, setUrlTestProgress] = useState({ done: 0, total: 0 });
  const urlTestAbortRef = useRef<AbortController | null>(null);

  // Subscription Groups
  const [showManageGroups, setShowManageGroups] = useState(false);
  const [showBrokers, setShowBrokers] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null); // null = All Configs
  const [refreshingGroup, setRefreshingGroup] = useState<string | null>(null);
  const [qrModal, setQrModal] = useState<{ link: string; name: string } | null>(null); // Phase D3 (item 5)
  const selectionAnchorRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragModeRef = useRef<"select" | "deselect">("select");
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const getFilteredConfigs = useStore(s => s.getFilteredConfigs);
  const baseFilteredConfigs = getFilteredConfigs();

  // Phase D2 (item 1): the group whose usage bar is shown (null = All Configs)
  const activeGroup = activeGroupId ? subscriptionGroups.find(g => g.id === activeGroupId) : null;

  // If a group is active, filter to only that group's configs
  const filteredConfigs = useMemo(() => {
    if (!activeGroupId) return baseFilteredConfigs;
    const group = subscriptionGroups.find(g => g.id === activeGroupId);
    if (!group) return baseFilteredConfigs;
    const idSet = new Set(group.configIds);
    return baseFilteredConfigs.filter(c => idSet.has(c.id));
  }, [baseFilteredConfigs, activeGroupId, subscriptionGroups]);

  /** Refresh a subscription group from its URL */
  const handleRefreshGroup = useCallback(async (groupId: string) => {
    const group = subscriptionGroups.find(g => g.id === groupId);
    if (!group?.subscriptionUrl) return;

    setRefreshingGroup(groupId);
    try {
      // Phase D2 (item 1): detailed fetch also captures the standard
      // subscription-userinfo (HTTP header or "#subscription-userinfo:" line).
      const detailed = await fetchSubscriptionDetailed(group.subscriptionUrl);
      const lines = detailed.lines;
      if (lines.length === 0) {
        toast("URL returned no configs", { icon: "⚠️" });
        return;
      }
      const before = useStore.getState().configs.length;
      useStore.getState().addConfigs(lines);
      const after = useStore.getState().configs.length;
      const added = after - before;

      // Only overwrite the stored usage when the server actually reported it
      // this time — a proxy attempt that hid the header must not erase the
      // last known value (fetchedAt keeps staleness visible).
      const userInfoPatch = detailed.userInfo
        ? { userInfo: { ...detailed.userInfo, fetchedAt: Date.now() } }
        : {};

      if (added > 0) {
        const newIds = useStore.getState().configs.slice(-added).map(c => c.id);
        useStore.getState().addConfigsToGroup(groupId, newIds);
        useStore.getState().updateSubscriptionGroup(groupId, { lastUpdated: Date.now(), ...userInfoPatch });
        toast.success(`Refreshed "${group.name}": +${added} new configs`);
      } else {
        toast(`"${group.name}" is already up to date`, { icon: "✓" });
        useStore.getState().updateSubscriptionGroup(groupId, { lastUpdated: Date.now(), ...userInfoPatch });
      }
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message || "Unknown error"}`);
    } finally {
      setRefreshingGroup(null);
    }
  }, [subscriptionGroups]);

  const sortedConfigs = useMemo(() => {
    const sorted = [...filteredConfigs];
    sorted.sort((a, b) => {
      let cmp = 0;
      const dir = sortDir === "asc" ? 1 : -1;

      if (sortField === "isValid") {
        cmp = (a.isValid === b.isValid ? 0 : a.isValid ? -1 : 1);
      } else if (sortField === "port") {
        cmp = Number(a.port) - Number(b.port);
      } else if (sortField === "ping") {
        // Configs that haven't been pinged (or failed) always sort to the
        // bottom regardless of direction, so the fastest servers are
        // always easy to find at a glance.
        const pa = pingResults[a.id];
        const pb = pingResults[b.id];
        const va = pa && pa.ping !== null && !pa.error ? pa.ping : Infinity;
        const vb = pb && pb.ping !== null && !pb.error ? pb.ping : Infinity;
        if (va === Infinity && vb === Infinity) return 0;
        if (va === Infinity) return 1;
        if (vb === Infinity) return -1;
        cmp = va - vb;
      } else {
        const valA = (a[sortField] || "").toString().toLowerCase();
        const valB = (b[sortField] || "").toString().toLowerCase();
        cmp = valA.localeCompare(valB);
      }
      return cmp * dir;
    });
    return sorted;
  }, [filteredConfigs, sortField, sortDir, pingResults]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  /**
   * Ping all visible configs — fast!
   * Uses the native Rust TCP-connect batch ping when running inside the
   * compiled desktop app (dozens of concurrent real socket connects, just
   * like v2rayN), or a parallel browser fallback in dev mode. This
   * replaced the old one-at-a-time loop (with a 30ms sleep between every
   * single config) that made pinging hundreds of configs take minutes.
   */
  const handlePingAll = useCallback(async () => {
    if (configs.length === 0 || pinging) return;
    setPinging(true);

    const targets = configs
      .filter(c => c.isValid)
      .map(c => {
        const info = extractIpFromConfig(c.raw);
        return info?.ip ? { id: c.id, host: info.ip, port: Number(info.port) || 443 } : null;
      })
      .filter((t): t is { id: string; host: string; port: number } => t !== null);

    // Configs we couldn't even extract an IP from — mark immediately.
    const noIpIds = configs.filter(c => c.isValid && !targets.some(t => t.id === c.id)).map(c => c.id);
    noIpIds.forEach(id => setPingResult(id, null, "No IP"));

    let successCount = 0;
    let failCount = noIpIds.length;

    await pingManyFast(targets, 4000, (batch) => {
      for (const r of batch) {
        setPingResult(r.id, r.ping, r.error);
        if (r.ping !== null && !r.error) successCount++;
        else failCount++;
      }
    });

    setPinging(false);

    if (notificationMode === "sound" || notificationMode === "both") {
      playNotificationSound();
    }
    if (notificationMode === "toast" || notificationMode === "both") {
      toast.success(
        `${t("pinger.completed", language)} — ${successCount} OK, ${failCount} failed`,
        { duration: 4000 },
      );
    }
    showBrowserNotification("MEMENTO Ping", `${successCount} online, ${failCount} failed`);

  }, [configs, pinging, notificationMode, language, setPingResult, subscriptionGroups]);

  /**
   * Phase C2 (item 3) — real-delay URL-test over the CURRENT view: every
   * valid config gets one HTTP GET through its own TEMPORARY core instance
   * (worker pool, concurrency 4), generated by the SAME generators +
   * builder options as connect (the C1 fragment dialer is measured when
   * enabled). Results live in the standalone latencyHistory slice — NOT in
   * pingResults, whose semantics are a plain TCP handshake (Connect Best
   * keeps sorting on TCP ping; the URL badges show end-to-end HTTP).
   * Clicking while running cancels SCHEDULING (in-flight probes finish or
   * time out on their own).
   */
  const handleUrlTestAll = useCallback(async () => {
    if (urlTesting) {
      urlTestAbortRef.current?.abort();
      return;
    }
    const targets = filteredConfigs.filter(c => c.isValid);
    if (targets.length === 0) return;
    if (!isDesktop()) {
      toast.error("Desktop only — the real-delay test needs the desktop app");
      return;
    }
    setUrlTesting(true);
    setUrlTestProgress({ done: 0, total: targets.length });
    const ac = new AbortController();
    urlTestAbortRef.current = ac;
    try {
      const results = await runUrlTestBatch(targets, {
        signal: ac.signal,
        onProgress: (done, total) => setUrlTestProgress({ done, total }),
      });
      const ok = results.filter(r => r.ms !== null).length;
      const fail = results.length - ok;
      if (notificationMode === "sound" || notificationMode === "both") {
        playNotificationSound();
      }
      if (notificationMode === "toast" || notificationMode === "both") {
        toast.success(
          `${t("pinger.completed", language)} — ${ok} OK, ${fail} failed`,
          { duration: 4000 },
        );
      }
      showBrowserNotification("MEMENTO URL-test", `${ok} reachable, ${fail} failed`);
    } finally {
      setUrlTesting(false);
      urlTestAbortRef.current = null;
    }
  }, [urlTesting, filteredConfigs, notificationMode, language]);

  /**
   * Phase D1 — "Connect Best": connect to the lowest-latency config in the
   * CURRENT view (respects the active Subscription Group tab, protocol filter
   * and search box), using the existing fast-ping data. Deliberately does NOT
   * trigger a ping sweep by itself — pinging 2000 imported configs takes tens
   * of seconds, so a silent long-running action would look broken; the button
   * asks for a ping run first when no latency data exists yet.
   */
  const handleConnectBest = useCallback(async () => {
    const best = filteredConfigs.reduce<{ id: string; ping: number } | null>((acc, c) => {
      if (!c.isValid) return acc;
      const p = pingResults[c.id];
      if (!p || p.ping === null || p.error) return acc;
      if (acc === null || p.ping < acc.ping) return { id: c.id, ping: p.ping };
      return acc;
    }, null);

    if (!best) {
      toast(t("configs.connectBestNone", language), { icon: "⚡", duration: 5000 });
      return;
    }

    const st = useStore.getState();
    if (st.connConfigId === best.id && st.connStatus === "connected") {
      toast.success(
        t("configs.connectBestAlready", language).replace("{ms}", String(best.ping)),
        { duration: 5000 },
      );
      return;
    }

    const bestConfig = st.configs.find(c => c.id === best.id);
    st.setActiveTab("connection");
    toast(
      t("configs.connectBestConnecting", language)
        .replace("{ms}", String(best.ping))
        .replace("{name}", bestConfig?.name || bestConfig?.address || ""),
      { icon: "⚡", duration: 4000 },
    );
    await connectToConfig(best.id);
  }, [filteredConfigs, pingResults, language]);

  const applySelection = useCallback((index: number, mode: "select" | "deselect", asRange = false) => {
    if (index < 0 || index >= sortedConfigs.length) return;
    const next = new Set(useStore.getState().selectedIds);
    const start = asRange && selectionAnchorRef.current !== null
      ? Math.min(selectionAnchorRef.current, index)
      : index;
    const end = asRange && selectionAnchorRef.current !== null
      ? Math.max(selectionAnchorRef.current, index)
      : index;
    for (let i = start; i <= end; i++) {
      const id = sortedConfigs[i]?.id;
      if (!id) continue;
      if (mode === "select") next.add(id);
      else next.delete(id);
    }
    setSelectedIds(next);
  }, [sortedConfigs, setSelectedIds]);

  const handleRowPointerDown = useCallback((index: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button,input,a,select,textarea")) return;

    // A plain click after a multi/range selection clears the whole range,
    // as requested. Starting another drag right after that begins a fresh
    // selection on the next row entered.
    if (!e.shiftKey && useStore.getState().selectedIds.size > 1) {
      setSelectedIds([]);
      selectionAnchorRef.current = index;
      draggingRef.current = false;
      return;
    }

    if (e.shiftKey && selectionAnchorRef.current !== null) {
      const rangeIds = sortedConfigs
        .slice(Math.min(selectionAnchorRef.current, index), Math.max(selectionAnchorRef.current, index) + 1)
        .map(c => c.id);
      const current = useStore.getState().selectedIds;
      const allSelected = rangeIds.every(id => current.has(id));
      applySelection(index, allSelected ? "deselect" : "select", true);
      return;
    }

    selectionAnchorRef.current = index;
    dragModeRef.current = useStore.getState().selectedIds.has(sortedConfigs[index].id) ? "deselect" : "select";
    draggingRef.current = true;
    applySelection(index, dragModeRef.current);
  }, [applySelection, setSelectedIds, sortedConfigs]);

  const handleRowPointerEnter = useCallback((index: number, e: React.PointerEvent) => {
    if (e.shiftKey && selectionAnchorRef.current !== null) {
      applySelection(index, "select", true);
      return;
    }
    if (draggingRef.current && (e.buttons & 1) === 1) {
      applySelection(index, dragModeRef.current);
    }
  }, [applySelection]);

  useEffect(() => {
    const stopDrag = () => { draggingRef.current = false; };
    const trackPointer = (e: PointerEvent) => { lastPointerRef.current = { x: e.clientX, y: e.clientY }; };
    const shiftWheelRange = (e: WheelEvent) => {
      if (!e.shiftKey || selectionAnchorRef.current === null) return;
      requestAnimationFrame(() => {
        const { x, y } = lastPointerRef.current;
        const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-config-index]");
        if (row) applySelection(Number(row.dataset.configIndex), "select", true);
      });
    };
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("blur", stopDrag);
    window.addEventListener("pointermove", trackPointer);
    window.addEventListener("wheel", shiftWheelRange, { passive: true });
    return () => {
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("blur", stopDrag);
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("wheel", shiftWheelRange);
    };
  }, [applySelection]);

  /**
   * Ctrl+V (Cmd+V on macOS) while a specific Subscription Group tab is
   * active: paste clipboard content directly into that group instead of
   * just the general config table. Ignored while the user is typing in a
   * text field (search box, modals, etc.) so normal paste behavior there
   * is never hijacked.
   */
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isPasteShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v";
      if (!isPasteShortcut) return;

      const active = document.activeElement as HTMLElement | null;
      const isTypingField = !!active && (
        active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable
      );
      if (isTypingField) return;

      try {
        // Product requirement: Ctrl+V over a selected row copies the
        // selected config link(s) and shows a notification. This is
        // intentionally non-standard, but retained for workflow parity.
        const selected = useStore.getState().selectedIds;
        if (selected.size > 0) {
          e.preventDefault();
          const text = useStore.getState().configs.filter(c => selected.has(c.id)).map(c => c.raw).join("\n");
          await navigator.clipboard.writeText(text);
          toast.success(`Copied ${selected.size} selected config(s) ✓`);
          return;
        }
        if (!activeGroupId) return;
        const text = await navigator.clipboard.readText();
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return;

        const group = subscriptionGroups.find(g => g.id === activeGroupId);
        const before = useStore.getState().configs.length;
        useStore.getState().addConfigs(lines);
        const added = useStore.getState().configs.length - before;

        if (added > 0) {
          const addedIds = useStore.getState().configs.slice(-added).map(c => c.id);
          useStore.getState().addConfigsToGroup(activeGroupId, addedIds);
          toast.success(`Pasted ${added} config(s) into "${group?.name || "group"}" ✓`);
        } else {
          toast("Clipboard links already exist in the table", { icon: "⚠️" });
        }
      } catch {
        /* clipboard permission denied or empty — silently ignore */
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeGroupId, subscriptionGroups]);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <SectionHeader titleKey="tab.configs" descKey="desc.configs" hintKey="hint.configs" icon={Table} />
        <div className="flex items-center gap-2 flex-wrap">
          {/* Subscription Groups Button */}
          <button
            onClick={() => setShowManageGroups(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-400 to-green-600 text-black/90 hover:brightness-110 shadow-md shadow-emerald-500/25 hover:scale-105 active:scale-95 transition-all cursor-pointer"
          >
            <Table className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("subs.groups", language) || "Subscription Groups"}</span>
            <span className="sm:hidden">Groups</span>
            {subscriptionGroups.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-black/20 text-[9px] font-mono">
                {subscriptionGroups.length}
              </span>
            )}
          </button>

          {/* Brokers Button */}
          <button
            onClick={() => setShowBrokers(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-violet-400 to-fuchsia-600 text-white hover:brightness-110 shadow-md shadow-fuchsia-500/25 hover:scale-105 active:scale-95 transition-all cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            Brokers
          </button>

          {/* Ping Button */}
          <button
            onClick={handlePingAll}
            disabled={pinging || configs.length === 0}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer",
              pinging
                ? "bg-yellow-500/20 text-yellow-400 animate-pulse cursor-wait"
                : "bg-gradient-to-r from-yellow-400 to-amber-500 text-black/90 shadow-md shadow-yellow-500/25 hover:brightness-110",
              configs.length === 0 && "opacity-40 cursor-not-allowed",
            )}
            title="Ping all configs"
          >
            <Zap className={cn("w-3.5 h-3.5", pinging && "animate-spin")} />
            {pinging ? "Pinging…" : "⚡ Ping"}
          </button>

          {/* Phase C2: real-delay URL-test — one HTTP GET through a temporary
              core instance per config (v2rayN "real delay" semantics);
              click again while running to cancel scheduling. */}
          <button
            onClick={handleUrlTestAll}
            disabled={configs.length === 0}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer",
              urlTesting
                ? "bg-teal-500/20 text-teal-300 animate-pulse cursor-wait"
                : "bg-gradient-to-r from-teal-400 to-emerald-500 text-black/90 shadow-md shadow-teal-500/25 hover:brightness-110",
              configs.length === 0 && "opacity-40 cursor-not-allowed",
            )}
            title={urlTesting ? "Click to cancel scheduling" : t("configs.urlTest", language)}
          >
            <Activity className={cn("w-3.5 h-3.5", urlTesting && "animate-spin")} />
            {urlTesting
              ? `${t("configs.urlTesting", language)} ${urlTestProgress.done}/${urlTestProgress.total}`
              : t("configs.urlTestAll", language)}
          </button>

          {/* Phase D1: Connect Best — lowest-latency config of the current view */}
          <button
            onClick={handleConnectBest}
            disabled={configs.length === 0}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer",
              "bg-gradient-to-r from-cyan-400 to-sky-600 text-white shadow-md shadow-cyan-500/25 hover:brightness-110",
              configs.length === 0 && "opacity-40 cursor-not-allowed",
            )}
            title={t("configs.connectBest", language)}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("configs.connectBest", language)}</span>
            <span className="sm:hidden">Best</span>
          </button>

          {selectedIds.size > 0 && (
            <>
              <button
                onClick={() => {
                  const selected = sortedConfigs.filter(c => selectedIds.has(c.id));
                  const text = selected.map(c => c.raw).join("\n");
                  navigator.clipboard.writeText(text).then(() => {
                    toast.success(`Copied ${selected.length} links`);
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-emerald-400 to-green-600 text-black/80 hover:scale-105 transition-transform shadow-md shadow-emerald-500/25"
              >
                <Copy className="w-3 h-3" />
                Copy ({selectedIds.size})
              </button>
              <button
                onClick={() => {
                  removeConfigs(Array.from(selectedIds));
                  toast.success("Deleted selected configs");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 min-w-0 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 dark:text-surface-500 light:text-surface-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search configs..."
            className={cn(
              "w-full pl-10 pr-4 py-2.5 rounded-xl text-sm border transition-colors",
              "dark:bg-surface-800/60 dark:border-surface-700/50 dark:text-white dark:placeholder:text-surface-600",
              "light:bg-white light:border-surface-200 light:text-surface-900 light:placeholder:text-surface-400",
              "focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            )}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Filter className="w-4 h-4 dark:text-surface-400 light:text-surface-500 shrink-0" />
          {["all", "valid", "invalid", ...[...new Set(configs.map(c => c.protocol))]].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border shrink-0",
                filter === f
                  ? "bg-gradient-to-r from-emerald-400 to-green-600 text-black border-emerald-500 shadow-md shadow-emerald-500/25"
                  : "dark:bg-surface-800/60 dark:border-surface-700/50 dark:text-surface-400 light:bg-white light:border-surface-200 light:text-surface-600 hover:border-emerald-500/50"
              )}
            >
              {f === "all" ? "All" : f === "valid" ? "✓ Valid" : f === "invalid" ? "✗ Invalid" : f.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          onClick={selectedIds.size === filteredConfigs.length ? deselectAll : selectAll}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border flex items-center gap-1.5 shrink-0",
            "dark:border-surface-700/50 dark:text-surface-400 light:border-surface-200 light:text-surface-600",
            "hover:border-emerald-500/50"
          )}
        >
          {selectedIds.size === filteredConfigs.length && filteredConfigs.length > 0 ? (
            <CheckSquare className="w-3.5 h-3.5" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">Select All</span>
        </button>
      </div>

      {/* Subscription Group Tabs */}
      {subscriptionGroups.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <FolderOpen className="w-4 h-4 dark:text-surface-400 light:text-surface-500 shrink-0" />

          {/* All Configs tab */}
          <button
            onClick={() => setActiveGroupId(null)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
              activeGroupId === null
                ? "bg-gradient-to-r from-emerald-400 to-green-600 text-black border-emerald-500 shadow-md shadow-emerald-500/25"
                : "dark:bg-surface-800/60 dark:border-surface-700/50 dark:text-surface-400 light:bg-white light:border-surface-200 light:text-surface-600 hover:border-emerald-500/50"
            )}
          >
            All Configs
          </button>

          {/* One tab per group */}
          {subscriptionGroups.map(g => (
            <div key={g.id} className="flex items-center gap-0">
              <button
                onClick={() => setActiveGroupId(activeGroupId === g.id ? null : g.id)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-all border",
                  g.subscriptionUrl ? "rounded-l-lg" : "rounded-lg",
                  activeGroupId === g.id
                    ? "bg-gradient-to-r from-emerald-400 to-green-600 text-black border-emerald-500 shadow-md shadow-emerald-500/25"
                    : "dark:bg-surface-800/60 dark:border-surface-700/50 dark:text-surface-400 light:bg-white light:border-surface-200 light:text-surface-600 hover:border-emerald-500/50"
                )}
              >
                {g.name}
                <span className="ml-1.5 opacity-60">({g.configIds.length})</span>
              </button>

              {/* Refresh button — only if group has a subscription URL */}
              {g.subscriptionUrl && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRefreshGroup(g.id); }}
                  disabled={refreshingGroup === g.id}
                  title={`Refresh "${g.name}" from subscription URL`}
                  className={cn(
                    "px-2 py-1.5 rounded-r-lg text-xs transition-all border border-l-0",
                    activeGroupId === g.id
                      ? "bg-emerald-600 text-black/70 border-emerald-500 hover:bg-emerald-500"
                      : "dark:bg-surface-800/60 dark:border-surface-700/50 dark:text-surface-400 light:bg-white light:border-surface-200 light:text-surface-600 hover:text-emerald-400 hover:border-emerald-500/50",
                    refreshingGroup === g.id && "animate-pulse"
                  )}
                >
                  <RefreshCw className={cn("w-3 h-3", refreshingGroup === g.id && "animate-spin")} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Phase D2 (item 1): server-reported subscription usage for the ACTIVE group */}
      {activeGroup?.userInfo && <SubscriptionUsageBar group={activeGroup} language={language} />}

      {/* Phase D4: the builder toggles (item 9) and the app options (items
          2/4/7) both moved to the dedicated Settings tab — their locked
          final home since the D2/D3 interim placement here. */}

      {/* Table */}
      <div className={cn(
        "rounded-2xl border overflow-hidden",
        "dark:border-surface-700/50 dark:bg-surface-800/30",
        "light:border-surface-200 light:bg-white"
      )}>
        {sortedConfigs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Server className="w-12 h-12 dark:text-surface-700 light:text-surface-300 mb-4" />
            <p className="text-sm font-medium dark:text-surface-400 light:text-surface-500">
              No configurations found
            </p>
            <p className="text-xs dark:text-surface-600 light:text-surface-400 mt-1">
              Import some links to get started
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={cn(
                  "text-xs font-semibold uppercase tracking-wider",
                  "dark:bg-surface-800/80 dark:text-surface-400",
                  "light:bg-surface-50 light:text-surface-500"
                )}>
                  <th className="hidden sm:table-cell w-10 px-4 py-3 text-center">#</th>
                  <th className="px-4 py-3 text-left cursor-pointer" onClick={() => handleSort("name")}>
                    <div className="flex items-center gap-1">
                      Name
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left cursor-pointer" onClick={() => handleSort("protocol")}>
                    <div className="flex items-center gap-1">
                      Protocol
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  {/* Address & Status are the least essential columns at a
                      glance (Name + Protocol + Port + Ping cover the daily
                      workflow), so they're the first to hide when the
                      window is narrowed — e.g. Windows Split View / snapping
                      the app to half the screen — instead of forcing a
                      horizontal scrollbar for the whole table. */}
                  <th className="hidden lg:table-cell px-4 py-3 text-left cursor-pointer" onClick={() => handleSort("address")}>
                    <div className="flex items-center gap-1">
                      Address
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left cursor-pointer" onClick={() => handleSort("port")}>
                    <div className="flex items-center gap-1">
                      Port
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-center cursor-pointer" onClick={() => handleSort("ping")}>
                    <div className="flex items-center justify-center gap-1">
                      Ping
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="hidden md:table-cell px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedConfigs.map((config, idx) => (
                  <ConfigRow
                    key={config.id}
                    config={config}
                    index={idx}
                    isExpanded={expandedId === config.id}
                    isSelected={selectedIds.has(config.id)}
                    onToggle={() => toggleSelect(config.id)}
                    onExpand={() => setExpandedId(expandedId === config.id ? null : config.id)}
                    onQr={(c) => setQrModal({ link: c.raw, name: c.name || `${c.address}:${c.port}` })}
                    onPointerDown={(e) => handleRowPointerDown(idx, e)}
                    onPointerEnter={(e) => handleRowPointerEnter(idx, e)}
                    pingResult={pingResults[config.id] || null}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Subscription Groups Modal */}
      {showManageGroups && (
        <ManageGroupsModal onClose={() => setShowManageGroups(false)} />
      )}

      {/* Brokers Modal */}
      {showBrokers && (
        <BrokersModal onClose={() => setShowBrokers(false)} />
      )}

      {/* QR Modal (Phase D3, item 5) */}
      {qrModal && (
        <QrModal link={qrModal.link} name={qrModal.name} onClose={() => setQrModal(null)} />
      )}

    </div>
  );
}

function ConfigRow({
  config, index, isExpanded, isSelected, onToggle, onExpand, onQr,
  onPointerDown, onPointerEnter, pingResult
}: {
  config: ParsedConfig;
  index: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onQr: (c: ParsedConfig) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerEnter: (e: React.PointerEvent) => void;
  pingResult: { ping: number | null; error?: string; timestamp: number } | null;
}) {
  const colors = protocolColors[config.protocol] || protocolColors.vmess;
  const { language, setActiveTab } = useStore();
  const connStatus = useStore(s => s.connStatus);
  const connConfigId = useStore(s => s.connConfigId);
  const isThisConnected = connConfigId === config.id && (connStatus === "connected" || connStatus === "connecting");

  // Brief "flash" highlight animation on click/expand — makes interacting
  // with a row feel a lot more alive than the previous plain hover-only
  // feedback, without relying on CSS transforms on <tr> (unreliably
  // supported across browsers/table layout engines).
  const [flash, setFlash] = useState(false);

  // Phase C2: per-row real-delay probe (spinner local to THIS row; the
  // result itself lands in the latencyHistory slice, not in props).
  const [urlTestingRow, setUrlTestingRow] = useState(false);
  const handleUrlTestRow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (urlTestingRow) return;
    if (!config.isValid) {
      toast.error("This config is invalid and cannot be tested");
      return;
    }
    setUrlTestingRow(true);
    try {
      await runUrlTest(config);
    } finally {
      setUrlTestingRow(false);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(config.raw).then(() => {
      toast.success("Link copied");
    });
  };

  const handleQuickConnect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!config.isValid) {
      toast.error("This config is invalid and cannot be connected to");
      return;
    }
    setActiveTab("connection");
    toast(
      language === "en" || language === "zh" ? "Connecting…" : "در حال اتصال…",
      { icon: "⚡", duration: 2000 },
    );
    await connectToConfig(config.id);
  };

  return (
    <>
      <tr
        data-config-index={index}
        tabIndex={0}
        onPointerDown={(e) => { setFlash(true); setTimeout(() => setFlash(false), 450); onPointerDown(e); }}
        onPointerEnter={onPointerEnter}
        onKeyDown={(e) => {
          if (e.key === "Enter" && config.isValid) {
            e.preventDefault();
            handleQuickConnect(e as unknown as React.MouseEvent);
          }
        }}
        className={cn(
          "border-t cursor-pointer outline-none focus:bg-emerald-500/10",
          "dark:border-surface-700/30 dark:hover:bg-surface-700/30",
          "light:border-surface-100 light:hover:bg-surface-50",
          isSelected && "bg-emerald-500/5 dark:bg-emerald-500/10",
          index % 2 === 0 && !isSelected && "dark:bg-surface-900/20 light:bg-surface-50/50",
          // Base transition covers hover/select; the flash uses a faster,
          // more noticeable timing so the two effects don't fight visually.
          flash
            ? "!bg-emerald-500/25 transition-colors duration-100"
            : "transition-colors duration-300"
        )}
      >
        <td className="hidden sm:table-cell px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onToggle}
            className="p-0.5 rounded transition-all duration-200 hover:text-emerald-500 hover:scale-110 active:scale-90"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-emerald-500 scale-in" />
            ) : (
              <Square className="w-4 h-4 dark:text-surface-500 light:text-surface-400" />
            )}
          </button>
        </td>
        <td className="px-4 py-3 max-w-[200px]">
          <div className="flex items-center gap-2">
            {isThisConnected ? (
              <span className="relative flex items-center justify-center w-3.5 h-3.5 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            ) : config.isValid ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            )}
            <span className={cn(
              "text-sm font-medium truncate",
              isThisConnected ? "text-emerald-400 font-bold" : "dark:text-surface-200 light:text-surface-800"
            )}>
              {config.name || "Unnamed"}
            </span>
            {isThisConnected && configCore(config) === "sing-box" && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 bg-pink-500/10 text-pink-300 border border-pink-500/30">
                sing-box
              </span>
            )}
            {isThisConnected && configCore(config) === "xray" && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 bg-surface-500/10 text-ink-300 border border-surface-500/30">
                Xray
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <span className={cn(
            "px-2.5 py-1 rounded-lg text-xs font-semibold border uppercase",
            colors
          )}>
            {config.protocol}
          </span>
        </td>
        <td className="hidden lg:table-cell px-4 py-3 text-sm font-mono dark:text-surface-300 light:text-surface-600">
          {config.address || "—"}
        </td>
        <td className="px-4 py-3 text-sm font-mono dark:text-surface-300 light:text-surface-600">
          {config.port || "—"}
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex flex-col items-center gap-1">
            {pingResult ? (
              pingResult.ping !== null && !pingResult.error ? (
                <span className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold font-mono",
                  pingResult.ping < 100
                    ? "bg-emerald-500/15 text-emerald-400"
                    : pingResult.ping < 300
                      ? "bg-yellow-500/15 text-yellow-400"
                      : "bg-red-500/15 text-red-400"
                )}>
                  <Zap className="w-2.5 h-2.5" />
                  {pingResult.ping}ms
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  —
                </span>
              )
            ) : (
              <span className="text-xs dark:text-surface-600 light:text-surface-400">—</span>
            )}
            {/* Phase C2: real-delay URL-test badge — renders ONLY once this
                config has actually been tested (never-tested rows stay clean) */}
            <UrlTestBadge configId={config.id} language={language} />
          </div>
        </td>
        <td className="hidden md:table-cell px-4 py-3 text-center">
          <span className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
            config.isValid
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-red-500/10 text-red-500"
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              config.isValid ? "bg-emerald-500" : "bg-red-500"
            )} />
            {config.isValid ? "Valid" : "Invalid"}
          </span>
        </td>
        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-1">
            {/* Phase C2: per-row real-delay test — one probe, result lands in
                the latencyHistory slice and shows in the ping column. */}
            <button
              onClick={handleUrlTestRow}
              disabled={!config.isValid || urlTestingRow}
              className={cn(
                "p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-90",
                urlTestingRow
                  ? "text-teal-400 animate-pulse cursor-wait"
                  : "dark:hover:bg-teal-500/20 light:hover:bg-teal-100 dark:text-surface-400 light:text-surface-500 hover:text-teal-500",
                !config.isValid && "opacity-30 cursor-not-allowed hover:scale-100"
              )}
              title={t("configs.urlTest", language)}
            >
              <Activity className={cn("w-3.5 h-3.5", urlTestingRow && "animate-spin")} />
            </button>
            {/* Quick Connect — jump straight to a live VPN connection with
                this exact config, without needing to go pick it manually
                from the dropdown on the Connection tab. */}
            <button
              onClick={handleQuickConnect}
              disabled={!config.isValid || isThisConnected}
              className={cn(
                "p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-90",
                isThisConnected
                  ? "text-emerald-400 cursor-default"
                  : "dark:hover:bg-emerald-500/20 light:hover:bg-emerald-100 dark:text-surface-400 light:text-surface-500 hover:text-emerald-500",
                !config.isValid && "opacity-30 cursor-not-allowed hover:scale-100"
              )}
              title={isThisConnected ? "Already connected" : "Quick connect to this config"}
            >
              <Plug className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-90 dark:hover:bg-surface-600 light:hover:bg-surface-200"
              title="Copy link"
            >
              <Copy className="w-3.5 h-3.5 dark:text-surface-400 light:text-surface-500" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onQr(config); }}
              className="p-1.5 rounded-lg transition-all duration-200 hover:scale-110 active:scale-90 dark:hover:bg-surface-600 light:hover:bg-surface-200"
              title={t("configs.qr", language)}
            >
              <QrCode className="w-3.5 h-3.5 dark:text-surface-400 light:text-surface-500" />
            </button>
            <button
              onClick={onExpand}
              className={cn(
                "p-1.5 rounded-lg transition-all duration-300 hover:scale-110 active:scale-90",
                isExpanded && "rotate-180"
              )}
            >
              <ChevronDown className="w-4 h-4 dark:text-surface-400 light:text-surface-500" />
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className={cn(
          "border-t animate-fade-in",
          "dark:border-surface-700/30 dark:bg-surface-900/40",
          "light:border-surface-100 light:bg-surface-50"
        )}>
          <td colSpan={8} className="px-6 py-4">
            <ConfigDetail config={config} />
          </td>
        </tr>
      )}
    </>
  );
}

function ConfigDetail({ config }: { config: ParsedConfig }) {
  const fields: { label: string; value: string | undefined; icon: React.ElementType }[] = [
    { label: "UUID", value: config.uuid, icon: Key },
    { label: "Password", value: config.password, icon: Key },
    { label: "Core", value: configCore(config) === "sing-box" ? "sing-box" : undefined, icon: Cpu },
    { label: "Security", value: config.security, icon: Shield },
    { label: "Encryption", value: config.encryption, icon: Shield },
    { label: "Network", value: config.network, icon: Wifi },
    { label: "Transport", value: config.type, icon: Route },
    { label: "SNI", value: config.sni, icon: Globe },
    { label: "Host", value: config.host, icon: Globe },
    { label: "Path", value: config.path, icon: Route },
    { label: "Flow", value: config.flow, icon: Route },
    { label: "Fingerprint", value: config.fingerprint, icon: Fingerprint },
    { label: "Public Key", value: config.publicKey, icon: Key },
    { label: "Short ID", value: config.shortId, icon: Key },
    { label: "Error", value: config.errorMessage, icon: AlertTriangle },
  ];

  const visibleFields = fields.filter(f => f.value);

  if (visibleFields.length === 0) {
    return <p className="text-xs dark:text-surface-500 light:text-surface-400">No additional info</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {visibleFields.map(f => {
          const Icon = f.icon;
          const isError = f.label === "Error";
          return (
            <div
              key={f.label}
              className={cn(
                "flex items-start gap-2 p-3 rounded-xl",
                "dark:bg-surface-800/60 light:bg-white",
                isError && "dark:bg-red-500/5 light:bg-red-50"
              )}
            >
              <Icon className={cn(
                "w-3.5 h-3.5 mt-0.5 shrink-0",
                isError ? "text-red-500" : "dark:text-surface-500 light:text-surface-400"
              )} />
              <div className="min-w-0">
                <div className={cn(
                  "text-xs font-medium",
                  isError ? "text-red-500" : "dark:text-surface-400 light:text-surface-500"
                )}>
                  {f.label}
                </div>
                <div className={cn(
                  "text-sm font-mono truncate max-w-[200px]",
                  isError
                    ? "text-red-400 dark:text-red-300"
                    : "dark:text-surface-200 light:text-surface-700"
                )}>
                  {f.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium dark:text-surface-500 light:text-surface-400">Raw Link</p>
        <div className={cn(
          "p-3 rounded-xl overflow-x-auto",
          "dark:bg-surface-900 light:bg-surface-100"
        )}>
          <code className="text-xs font-mono dark:text-surface-300 light:text-surface-600 break-all">
            {config.raw}
          </code>
        </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/*   Phase D2 (item 1): subscription usage bar + (item 9) builder panel  */
/* ==================================================================== */

/** Human-readable bytes: B -> KB -> MB -> GB -> TB (1 decimal except B). */
function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Server-reported usage for the ACTIVE subscription group. Rendered ONLY
 *  when the group actually has userInfo — the "server did not report" case
 *  is deliberately silent here (no noise on groups that never supported it);
 *  the ManageGroups modal documents that case in text. */
function SubscriptionUsageBar({ group, language }: {
  group: import("../store").SubscriptionGroup;
  language: import("../i18n").Language;
}) {
  const ui = group.userInfo!;
  const used = (ui.upload || 0) + (ui.download || 0);
  const total = ui.total || 0;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : null;
  const barColor = pct === null ? "bg-emerald-400"
    : pct < 75 ? "bg-emerald-400" : pct < 90 ? "bg-amber-400" : "bg-red-400";
  const expireStr = ui.expire && ui.expire > 0
    ? t("subs.usageExpire", language).replace("{date}", new Date(ui.expire * 1000).toLocaleDateString())
    : t("subs.usageNoExpire", language);
  const fetchedStr = ui.fetchedAt ? new Date(ui.fetchedAt).toLocaleString() : "";

  return (
    <div className={cn(
      "p-3 rounded-xl border space-y-2",
      "dark:border-surface-700/50 dark:bg-surface-800/30",
      "light:border-surface-200 light:bg-white"
    )}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold flex items-center gap-1.5 dark:text-surface-300 light:text-surface-700">
          <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
          {t("subs.usage", language)} — {group.name}
        </p>
        <p className="text-[11px] dark:text-surface-500 light:text-surface-400">
          {expireStr}{fetchedStr ? ` • ${fetchedStr}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-surface-700/50 overflow-hidden">
          {pct !== null && (
            <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
          )}
        </div>
        <span className="text-[11px] font-mono shrink-0 dark:text-surface-400 light:text-surface-500">
          {pct !== null ? `${pct.toFixed(1)}%` : t("subs.usageNoTotal", language)}
        </span>
      </div>
      <p className="text-[11px] font-mono dark:text-surface-500 light:text-surface-400">
        ↑ {fmtBytes(ui.upload || 0)} · ↓ {fmtBytes(ui.download || 0)} · {t("subs.usageUsed", language)
          .replace("{used}", fmtBytes(used)).replace("{total}", total > 0 ? fmtBytes(total) : "—")}
      </p>
    </div>
  );
}


/** Phase C2: the real-delay URL-test result for ONE config — driven ONLY by
 *  the standalone latencyHistory slice via useSyncExternalStore, so a new
 *  sample re-renders THIS row alone (the App.tsx:61-64 whole-store perf
 *  rule stays intact). Renders nothing for never-tested configs. */
function UrlTestBadge({ configId, language }: {
  configId: string;
  language: import("../i18n").Language;
}) {
  const samples = useSyncExternalStore(subscribeLatencyHistory, () => getLatencyHistory(configId));
  if (samples.length === 0) return null;
  const last = samples[samples.length - 1];
  const ok = last.ms !== null && !last.error;
  return (
    <div className="flex items-center gap-1.5">
      {ok ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold font-mono",
            last.ms! < 200
              ? "bg-teal-500/15 text-teal-300"
              : last.ms! < 500
                ? "bg-yellow-500/15 text-yellow-400"
                : "bg-red-500/15 text-red-400"
          )}
          title={`${t("configs.urlTest", language)}${last.mode === "tunnel" ? " · tunnel" : ""}`}
        >
          <Activity className="w-2.5 h-2.5" />
          {last.ms}ms
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400"
          title={last.error || t("configs.urlTestFail", language)}
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          {t("configs.urlTestFail", language)}
        </span>
      )}
      <LatencySparkline samples={samples} />
    </div>
  );
}

/** Mini pure-SVG sparkline of the recent real-delay history (teal line;
 *  failed probes drop to the floor so gaps stay visible). Hidden on narrow
 *  viewports to keep the table compact. */
function LatencySparkline({ samples }: { samples: LatencySample[] }) {
  const W = 64;
  const H = 18;
  const valid = samples.filter(s => s.ms !== null);
  if (valid.length < 2) return null;
  const max = Math.max(...valid.map(s => s.ms!), 1);
  const step = W / (samples.length - 1);
  const pts = samples
    .map((s, i) => {
      const x = i * step;
      const y = s.ms === null ? H : Math.max(1, H - (s.ms! / max) * (H - 2));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="hidden xl:block" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#2dd4bf" strokeWidth="1.2" opacity="0.85" />
    </svg>
  );
}
