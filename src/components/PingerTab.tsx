import { useState, useCallback, useRef } from "react";
import { useStore, parseSingleLink } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { extractIpFromConfig } from "../utils/ping";
import { pingManyFast } from "../utils/fastPing";
import { runUrlTestBatch } from "../utils/urlTest";
import { Copy, Upload, Trash2, Activity } from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import { SelectGroupModal } from "./SubscriptionGroups";

interface PingItem {
  index: number;
  name: string;
  protocol: string;
  ip: string;
  port: string;
  transport: string;
  raw: string;
  ping: number | null;
  error?: string;
  testing?: boolean;
}

export default function PingerTab() {
  const { language, notificationMode } = useStore();
  const [configsInput, setConfigsInput] = useState("");
  const [results, setResults] = useState<PingItem[]>([]);
  const [testing, setTesting] = useState(false);
  // Phase C2: "tcp" = handshake-only batch (original flow); "url" = real
  // end-to-end HTTP delay through a temporary core instance per link.
  const [testMode, setTestMode] = useState<"tcp" | "url">("tcp");
  const [pendingGroupConfigs, setPendingGroupConfigs] = useState<{ added: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      setConfigsInput(text);
      toast.success(t("message.fileLoaded", language));
    };
    reader.readAsText(file);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error(t("message.clipboardEmpty", language));
        return;
      }
      setConfigsInput(configsInput ? configsInput + "\n" + text : text);
      toast.success(t("message.pasted", language));
    } catch {
      toast.error(t("message.error", language));
    }
  };

  const handleStartTest = useCallback(async () => {
    const lines = configsInput
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      toast.error(t("pinger.noConfigs", language));
      return;
    }

    /* ---------- Phase C2: real-delay URL mode ----------
     * Every valid link is probed through its own temporary core instance
     * (worker pool, concurrency 4) with the CURRENT builder options.
     * Pasted links have no stable identity, so these results intentionally
     * bypass the latencyHistory slice (they live in this tab only), and
     * the TCP-mode add-to-group offer is not triggered here. */
    if (testMode === "url") {
      setTesting(true);
      const parsedList = lines.map(l => parseSingleLink(l));
      const items: PingItem[] = parsedList.map((cfg, i) => ({
        index: i + 1,
        name: cfg?.name || `Config ${i + 1}`,
        protocol: cfg?.protocol || "unknown",
        ip: cfg?.address || "N/A",
        port: cfg?.port != null ? String(cfg.port) : "N/A",
        transport: "url",
        raw: lines[i],
        ping: null,
        error: cfg?.isValid ? undefined : "Unsupported or invalid",
        testing: !!cfg?.isValid,
      }));
      setResults([...items]);

      const idToIdx = new Map<string, number[]>();
      const validConfigs: typeof parsedList = [];
      parsedList.forEach((cfg, i) => {
        if (!cfg?.isValid) return;
        validConfigs.push(cfg);
        const list = idToIdx.get(cfg.id) ?? [];
        list.push(i);
        idToIdx.set(cfg.id, list);
      });

      await runUrlTestBatch(validConfigs, {
        recordHistory: false,
        onResult: (r) => {
          for (const idx of idToIdx.get(r.id) ?? []) {
            items[idx].ping = r.ms;
            items[idx].error = r.error;
            items[idx].testing = false;
          }
          setResults([...items]);
        },
      });
      items.forEach(it => { if (it.testing) it.testing = false; });
      setResults([...items]);
      setTesting(false);

      if (notificationMode === "sound" || notificationMode === "both") {
        playNotificationSound();
      }
      if (notificationMode === "toast" || notificationMode === "both") {
        toast.success(t("pinger.completed", language));
      }
      return;
    }

    setTesting(true);
    const items: PingItem[] = lines.map((link, i) => {
      const info = extractIpFromConfig(link);
      return {
        index: i + 1,
        name: info?.name || `Config ${i + 1}`,
        protocol: info?.protocol || "unknown",
        ip: info?.ip || "N/A",
        port: info?.port || "N/A",
        transport: "tcp",
        raw: link,
        ping: null,
        error: info?.ip ? undefined : "Failed to extract IP",
        testing: !!info?.ip,
      };
    });
    setResults([...items]);

    const targets = items
      .filter(item => item.ip !== "N/A")
      .map(item => ({ id: String(item.index), host: item.ip, port: Number(item.port) || 443 }));

    await pingManyFast(targets, 4000, batch => {
      for (const result of batch) {
        const item = items[Number(result.id) - 1];
        if (!item) continue;
        item.ping = result.ping;
        item.error = result.error;
        item.testing = false;
      }
      setResults([...items]);
    });

    setTesting(false);

    // Play notification
    if (notificationMode === "sound" || notificationMode === "both") {
      playNotificationSound();
    }
    if (notificationMode === "toast" || notificationMode === "both") {
      toast.success(t("pinger.completed", language));
    }

    // Ask user if they want to add successful configs to a subscription group
    const successfulItems = items.filter(r => r.ping !== null && r.ping > 0 && !r.error);
    const successCount = successfulItems.length;
    const groups = useStore.getState().subscriptionGroups;
    if (successCount > 0 && groups.length > 0) {
      useStore.getState().addConfigs(successfulItems.map(r => r.raw));
      setPendingGroupConfigs({ added: successfulItems.length });
    }
  }, [configsInput, language, notificationMode, testMode]);

  const lineCount = configsInput.split("\n").filter(l => l.trim()).length;
  const avgPing =
    results.length > 0
      ? Math.round(
          results
            .filter(r => r.ping !== null)
            .reduce((sum, r) => sum + (r.ping || 0), 0) /
            results.filter(r => r.ping !== null).length
        )
      : 0;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader titleKey="tab.pinger" descKey="desc.pinger" hintKey="hint.pinger" icon={Activity} />

      {/* Input section */}
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
            {t("pinger.pasteConfigs", language)}
            <span className="text-xs font-normal dark:text-surface-500 light:text-surface-400 ml-2">
              ({lineCount} {t("pinger.config", language)})
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePaste}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors dark:bg-surface-700/60 dark:text-surface-300 dark:hover:bg-surface-700 light:bg-surface-100 light:text-surface-600 light:hover:bg-surface-200"
            >
              <Copy className="w-3 h-3" /> {t("button.paste", language)}
            </button>
            <label className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors dark:bg-surface-700/60 dark:text-surface-300 dark:hover:bg-surface-700 light:bg-surface-100 light:text-surface-600 light:hover:bg-surface-200">
              <Upload className="w-3 h-3" /> {t("button.file", language)}
              <input
                ref={fileRef}
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
            {configsInput.trim() && (
              <button
                onClick={() => setConfigsInput("")}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> {t("button.clear", language)}
              </button>
            )}
          </div>
        </div>
        <textarea
          value={configsInput}
          onChange={(e) => setConfigsInput(e.target.value)}
          placeholder="vmess://...\nvless://...\ntrojan://..."
          rows={8}
          className={cn(
            "w-full p-4 text-sm code-textarea resize-y min-h-[140px] transition-colors",
            "dark:bg-transparent dark:text-surface-200 dark:placeholder:text-surface-600",
            "light:bg-transparent light:text-surface-800 light:placeholder:text-surface-400",
            "focus:outline-none"
          )}
        />
      </div>

      {/* Phase C2: test-mode toggle — TCP handshake vs real end-to-end HTTP
          delay through a temporary core instance per link. */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-xl border border-surface-700/50 overflow-hidden text-xs font-bold">
          <button
            onClick={() => setTestMode("tcp")}
            disabled={testing}
            className={cn(
              "px-4 py-2 transition-colors disabled:opacity-50",
              testMode === "tcp"
                ? "bg-emerald-500/20 text-emerald-400"
                : "dark:text-surface-400 light:text-surface-600 hover:bg-surface-700/30"
            )}
          >
            Ping (TCP)
          </button>
          <button
            onClick={() => setTestMode("url")}
            disabled={testing}
            className={cn(
              "px-4 py-2 transition-colors border-l border-surface-700/50 disabled:opacity-50",
              testMode === "url"
                ? "bg-teal-500/20 text-teal-300"
                : "dark:text-surface-400 light:text-surface-600 hover:bg-surface-700/30"
            )}
          >
            {t("pinger.urlTest", language)}
          </button>
        </div>
      </div>

      <button
        onClick={handleStartTest}
        disabled={testing || lineCount === 0}
        className={cn(
          "w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-all duration-200 hover:scale-[1.01]",
          testing || lineCount === 0
            ? "bg-surface-700 opacity-50 cursor-not-allowed"
            : testMode === "url"
              ? "bg-gradient-to-r from-teal-400 to-emerald-500 hover:from-teal-300 hover:to-emerald-400 text-black/80 shadow-lg shadow-teal-500/30"
              : "bg-gradient-to-r from-emerald-400 to-green-600 hover:from-emerald-300 hover:to-green-500 text-black/80 shadow-lg shadow-emerald-500/30 glow-green"
        )}
      >
        <Activity className={cn("w-4 h-4", testing && "animate-pulse")} />
        {testing ? t("pinger.testing", language) : testMode === "url" ? t("pinger.urlTest", language) : t("pinger.startPinging", language)}
      </button>

      {/* Results */}
      {pendingGroupConfigs && (
        <SelectGroupModal
          title={t("subs.addToGroup", language) || "Add successful pings to a group?"}
          subtitle={`${pendingGroupConfigs.added} config(s) responded successfully.`}
          onSelect={(groupId) => {
            if (groupId) {
              const addedIds = useStore.getState().configs.slice(-pendingGroupConfigs.added).map(c => c.id);
              useStore.getState().addConfigsToGroup(groupId, addedIds);
              toast.success(`Added configs to group ✓`);
            }
            setPendingGroupConfigs(null);
          }}
          onCancel={() => setPendingGroupConfigs(null)}
        />
      )}

      {results.length > 0 && (
        <div className={cn(
          "rounded-2xl border overflow-hidden",
          "dark:border-surface-700/50 dark:bg-surface-800/30",
          "light:border-surface-200 light:bg-white"
        )}>
          <div className={cn(
            "flex items-center justify-between px-4 py-3 border-b",
            "dark:border-surface-700/50 dark:bg-surface-800/50",
            "light:border-surface-200 light:bg-surface-50"
          )}>
            <span className="text-sm font-semibold dark:text-white light:text-surface-900">
              {t("pinger.results", language)} | {t("pinger.ping", language)}: {avgPing}ms
            </span>

            {/* Send successful configs to Config Table */}
            <button
              onClick={() => {
                const successfulRaw = results
                  .filter(r => r.ping !== null && r.ping > 0 && !r.error)
                  .map(r => r.raw);
                if (successfulRaw.length === 0) {
                  toast.error("No successful pings to send");
                  return;
                }
                useStore.getState().addConfigs(successfulRaw);
                toast.success(`Sent ${successfulRaw.length} config(s) to table ✓`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-400 to-green-600 text-black/80 hover:brightness-110 shadow-md shadow-emerald-500/25 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              Send to Table
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={cn(
                  "text-xs font-semibold uppercase",
                  "dark:bg-surface-800/80 dark:text-surface-400",
                  "light:bg-surface-50 light:text-surface-500"
                )}>
                  <th className="px-4 py-3 text-left">{t("pinger.index", language)}</th>
                  <th className="px-4 py-3 text-left">{t("pinger.config", language)}</th>
                  <th className="px-4 py-3 text-left">{t("pinger.type", language)}</th>
                  <th className="px-4 py-3 text-left">{t("pinger.ip", language)}</th>
                  <th className="px-4 py-3 text-left">{t("pinger.port", language)}</th>
                  <th className="px-4 py-3 text-left">{t("pinger.transport", language)}</th>
                  <th className="px-4 py-3 text-center">{t("pinger.ping", language)}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((item, idx) => (
                  <tr
                    key={idx}
                    className={cn(
                      "border-t transition-colors",
                      "dark:border-surface-700/30 dark:hover:bg-surface-700/30",
                      "light:border-surface-100 light:hover:bg-surface-50",
                      idx % 2 === 0 && "dark:bg-surface-900/20 light:bg-surface-50/50"
                    )}
                  >
                    <td className="px-4 py-3 font-mono dark:text-surface-400 light:text-surface-500">
                      #{item.index}
                    </td>
                    <td className="px-4 py-3 truncate dark:text-surface-200 light:text-surface-800">
                      {item.name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400">
                        {item.protocol.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono dark:text-surface-300 light:text-surface-600 text-xs">
                      {item.ip}
                    </td>
                    <td className="px-4 py-3 font-mono dark:text-surface-300 light:text-surface-600">
                      {item.port}
                    </td>
                    <td className="px-4 py-3 text-xs dark:text-surface-400 light:text-surface-500">
                      {item.transport}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.testing ? (
                        <span className="text-xs dark:text-surface-400 light:text-surface-500 animate-pulse">
                          {t("pinger.testing", language)}
                        </span>
                      ) : item.error ? (
                        <span className="text-xs text-red-500">
                          {item.error === "Timeout" ? t("pinger.timeout", language) : t("pinger.error", language)}
                        </span>
                      ) : item.ping !== null ? (
                        <span className={cn(
                          "font-semibold",
                          item.ping < 100
                            ? "text-emerald-400"
                            : item.ping < 300
                              ? "text-yellow-400"
                              : "text-red-400"
                        )}>
                          {item.ping}ms
                        </span>
                      ) : (
                        <span className="text-xs text-red-500">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function playNotificationSound() {
  // Create a simple beep sound using Web Audio API.
  // Guarded: AudioContext may be missing (hardened/locked-down Electron) and
  // construction may throw (autoplay policy) — this must never break the
  // ping-completion flow, so any failure is a silent fallback.
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const audioContext = new AudioCtx();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch {
    /* audio unavailable — silent fallback */
  }
}
