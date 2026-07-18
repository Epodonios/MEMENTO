import { useState, useCallback, useRef } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { batchPing, PingResult } from "../utils/ping";
import { Copy, Upload, Trash2, Radar } from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";

export default function ScannerTab() {
  const { language, notificationMode } = useStore();
  const [ipsInput, setIpsInput] = useState("");
  const [results, setResults] = useState<(PingResult & { index: number })[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      setIpsInput(text);
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
      setIpsInput(ipsInput ? ipsInput + "\n" + text : text);
      toast.success(t("message.pasted", language));
    } catch {
      toast.error(t("message.error", language));
    }
  };

  const handleStartScan = useCallback(async () => {
    const lines = ipsInput
      .split(/[\n,]+/)
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      toast.error(t("message.noData", language));
      return;
    }

    setScanning(true);
    setResults([]);
    setProgress(0);

    try {
      // Firewall-friendly concurrency: 4 parallel pings, 4s timeout each.
      // We collect results progressively so the UI updates live.
      let collected: any[] = [];
      await batchPing(lines, 4, 4000, (completed, total, partial) => {
        setProgress(Math.round((completed / total) * 100));
        if (partial && partial.length > 0) {
          collected = [...collected, ...partial.map((r, i) => ({
            index: collected.length + i + 1,
            ...r,
          }))];
          setResults(collected);
        }
      });

      // Play notification
      if (notificationMode === "sound" || notificationMode === "both") {
        playNotificationSound();
      }
      if (notificationMode === "toast" || notificationMode === "both") {
        toast.success(t("scanner.completed", language));
      }
    } catch (err: any) {
      toast.error(t("message.error", language));
    } finally {
      setScanning(false);
      setProgress(0);
    }
  }, [ipsInput, language, notificationMode]);

  const lineCount = ipsInput.split(/[\n,]+/).filter(l => l.trim()).length;
  const successCount = results.filter(r => r.ping !== null).length;
  const avgPing =
    successCount > 0
      ? Math.round(
          results
            .filter(r => r.ping !== null)
            .reduce((sum, r) => sum + (r.ping || 0), 0) / successCount
        )
      : 0;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader titleKey="tab.scanner" descKey="desc.scanner" icon={Radar} />

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
            {t("scanner.pasteIps", language)}
            <span className="text-xs font-normal dark:text-surface-500 light:text-surface-400 ml-2">
              ({lineCount} IPs)
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
            {ipsInput.trim() && (
              <button
                onClick={() => setIpsInput("")}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> {t("button.clear", language)}
              </button>
            )}
          </div>
        </div>
        <textarea
          value={ipsInput}
          onChange={(e) => setIpsInput(e.target.value)}
          placeholder="1.1.1.1, 8.8.8.8&#10;8.8.4.4&#10;104.16.0.1"
          rows={8}
          className={cn(
            "w-full p-4 text-sm code-textarea resize-y min-h-[140px] transition-colors",
            "dark:bg-transparent dark:text-surface-200 dark:placeholder:text-surface-600",
            "light:bg-transparent light:text-surface-800 light:placeholder:text-surface-400",
            "focus:outline-none"
          )}
        />
      </div>

      <button
        onClick={handleStartScan}
        disabled={scanning || lineCount === 0}
        className={cn(
          "w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all duration-200 hover:scale-[1.01]",
          scanning || lineCount === 0
            ? "bg-surface-700 opacity-50 cursor-not-allowed text-white"
            : "bg-gradient-to-r from-emerald-400 to-green-600 hover:from-emerald-300 hover:to-green-500 text-black/80 shadow-lg shadow-emerald-500/30 glow-green"
        )}
      >
        <Radar className={cn("w-4 h-4", scanning && "spin-slow")} />
        {scanning ? t("scanner.scanningProgress", language) : t("scanner.startScanning", language)}
      </button>

      {/* Progress bar */}
      {scanning && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="dark:text-surface-400 light:text-surface-500">{t("scanner.scanningProgress", language)}</span>
            <span className="font-semibold dark:text-white light:text-surface-900">{progress}%</span>
          </div>
          <div className={cn(
            "w-full h-2 rounded-full overflow-hidden",
            "dark:bg-surface-700 light:bg-surface-200"
          )}>
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-green-600 transition-all duration-300 glow-green relative overflow-hidden"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-white/20 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className={cn(
          "rounded-2xl border overflow-hidden",
          "dark:border-surface-700/50 dark:bg-surface-800/30",
          "light:border-surface-200 light:bg-white"
        )}>
          <div className={cn(
            "px-4 py-3 border-b",
            "dark:border-surface-700/50 dark:bg-surface-800/50",
            "light:border-surface-200 light:bg-surface-50"
          )}>
            <span className="text-sm font-semibold dark:text-white light:text-surface-900">
              {t("scanner.results", language)} | {successCount}/{results.length} | Avg: {avgPing}ms
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={cn(
                  "text-xs font-semibold uppercase",
                  "dark:bg-surface-800/80 dark:text-surface-400",
                  "light:bg-surface-50 light:text-surface-500"
                )}>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">IP</th>
                  <th className="px-4 py-3 text-center">Ping (ms)</th>
                  <th className="px-4 py-3 text-left">Status</th>
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
                    <td className="px-4 py-3 font-mono dark:text-surface-200 light:text-surface-800">
                      {item.ip}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.error ? (
                        <span className="text-xs text-red-500">N/A</span>
                      ) : item.ping !== null ? (
                        <span className={cn(
                          "font-semibold",
                          item.ping < 100
                            ? "text-emerald-400"
                            : item.ping < 300
                              ? "text-yellow-400"
                              : "text-red-400"
                        )}>
                          {item.ping}
                        </span>
                      ) : (
                        <span className="text-xs text-red-500">Failed</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className={cn(
                        "px-2 py-1 rounded-lg font-medium",
                        item.error
                          ? "bg-red-500/10 text-red-400"
                          : item.ping !== null
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-gray-500/10 text-gray-400"
                      )}>
                        {item.error || (item.ping !== null ? "OK" : "Failed")}
                      </span>
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
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.value = 1000;
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.3);
}
