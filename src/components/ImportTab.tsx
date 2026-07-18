import { useState, useCallback, useRef } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { Upload, Clipboard, Link, X, Zap, AlertCircle, CheckCircle2, Download } from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import { SelectGroupModal } from "./SubscriptionGroups";
import { t } from "../i18n";
import { MAX_CONFIGS_PER_SOURCE } from "../utils/subscription";

export default function ImportTab() {
  const { addConfigs, configs, subscriptionGroups, language } = useStore();
  const [textInput, setTextInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pendingGroupConfigs, setPendingGroupConfigs] = useState<{ added: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTextImport = useCallback(() => {
    const lines = textInput
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) {
      toast.error("No links to import");
      return;
    }

    const before = configs.length;
    addConfigs(lines);
    const after = useStore.getState().configs.length;
    const added = after - before;

      if (added > 0) {
        toast.success(`Imported ${added} config(s)`);
        setTextInput("");
        if (subscriptionGroups.length > 0) {
          setPendingGroupConfigs({ added });
        }
      } else {
        toast("All links already exist", { icon: "⚠️" });
      }
    }, [textInput, addConfigs, configs.length]);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("Clipboard is empty");
        return;
      }
      const lines = text
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);

      const before = configs.length;
      addConfigs(lines);
      const after = useStore.getState().configs.length;
      const added = after - before;

      if (added > 0) {
        toast.success(`Imported ${added} config(s) from clipboard`);
      } else {
        toast("All links already exist", { icon: "⚠️" });
      }
    } catch {
      toast.error("Failed to read clipboard. Check permissions.");
    }
  }, [addConfigs, configs.length]);

  const handleUrlImport = useCallback(async () => {
    const rawUrl = urlInput.trim();
    if (!rawUrl) {
      toast.error("Enter a subscription URL");
      return;
    }

    setUrlLoading(true);

    /** Try to fetch text from a URL using the given fetch function. */
    const attemptFetch = async (
      fetcher: () => Promise<Response>,
      timeoutMs = 12000,
    ): Promise<string> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetcher();
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    };

    /**
     * Subscription links are often base64-encoded. If the fetched text
     * contains no "://" it is probably a base64 blob — decode it.
     */
    const decodeIfBase64 = (body: string): string => {
      const trimmed = body.trim();
      if (trimmed.includes("://")) return trimmed;
      try {
        // Try standard base64
        let s = trimmed.replace(/-/g, "+").replace(/_/g, "/");
        while (s.length % 4 !== 0) s += "=";
        const decoded = atob(s);
        // Make sure utf8 is preserved
        const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
        const utf8 = new TextDecoder().decode(bytes);
        if (utf8.includes("://")) return utf8;
      } catch {
        /* not valid b64 — return as-is */
      }
      return trimmed;
    };

    try {
      let text = "";

      // ── Strategy A: Direct fetch (works inside Tauri / Electron) ──
      try {
        text = await attemptFetch(() => fetch(rawUrl, { mode: "cors" }), 8000);
      } catch {
        /* direct fetch failed — silently try proxies */
      }

      // ── Strategy B: AllOrigins proxy ──
      if (!text) {
        try {
          const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`;
          text = await attemptFetch(() => fetch(proxy), 10000);
        } catch {
          /* proxy 1 failed */
        }
      }

      // ── Strategy C: CorsProxy.io ──
      if (!text) {
        try {
          const proxy = `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`;
          text = await attemptFetch(() => fetch(proxy), 10000);
        } catch {
          /* proxy 2 failed */
        }
      }

      // ── Strategy D: CodeTabs proxy ──
      if (!text) {
        try {
          const proxy = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rawUrl)}`;
          text = await attemptFetch(() => fetch(proxy), 10000);
        } catch {
          /* proxy 3 failed */
        }
      }

      if (!text) {
        throw new Error(
          "Could not reach the URL.\n\nMake sure:\n• The link is correct\n• Your firewall allows outbound HTTPS\n• The subscription server is online",
        );
      }

      // Decode base64 if needed
      const decoded = decodeIfBase64(text);
      const allLines = decoded
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

      // Never import more than MAX_CONFIGS_PER_SOURCE from a single source —
      // some subscription links publish 10k+ lines which would freeze the UI.
      const lines = allLines.slice(0, MAX_CONFIGS_PER_SOURCE);
      const truncated = allLines.length > MAX_CONFIGS_PER_SOURCE;

      if (lines.length === 0) {
        toast("URL returned empty content", { icon: "⚠️" });
        setUrlLoading(false);
        return;
      }

      const before = configs.length;
      addConfigs(lines);
      const after = useStore.getState().configs.length;
      const added = after - before;

      if (added > 0) {
        toast.success(`Fetched ${added} config(s) from URL`);
        if (truncated) {
          toast(`Source had more than ${MAX_CONFIGS_PER_SOURCE} configs — only the first ${MAX_CONFIGS_PER_SOURCE} were imported`, { icon: "✂️", duration: 6000 });
        }
        setUrlInput("");
        if (subscriptionGroups.length > 0) {
          setPendingGroupConfigs({ added });
        }
      } else {
        toast(`${lines.length} link(s) found, but none are new`, { icon: "⚠️" });
      }
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      // Don't show "AbortError" to the user — replace with friendly text
      const friendly =
        msg.includes("AbortError") || msg.includes("aborted")
          ? "Request timed out — server may be slow or offline"
          : msg;
      toast.error(`Fetch failed: ${friendly}`, { duration: 6000 });
    } finally {
      setUrlLoading(false);
    }
  }, [urlInput, addConfigs, configs.length]);

  const handleFileImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);

      const before = configs.length;
      addConfigs(lines);
      const after = useStore.getState().configs.length;
      const added = after - before;

      if (added > 0) {
        toast.success(`Imported ${added} config(s) from file`);
        if (subscriptionGroups.length > 0) {
          setPendingGroupConfigs({ added });
        }
      } else {
        toast("All links already exist", { icon: "⚠️" });
      }
    };
    reader.readAsText(file);
  }, [addConfigs, configs.length]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      handleFileImport(file);
    }
  }, [handleFileImport]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-8 fade-in">
      {/* Header */}
      <SectionHeader titleKey="tab.import" descKey="desc.import" icon={Download} />

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger">
        <button
          onClick={handlePasteFromClipboard}
          className={cn(
            "flex items-center gap-3 p-4 rounded-2xl border transition-all duration-200 hover-lift shine",
            "dark:bg-surface-800/40 dark:border-surface-700/50 dark:hover:border-emerald-500/40",
            "light:bg-white light:border-surface-200 light:hover:border-emerald-500/40",
            "hover:shadow-lg hover:shadow-emerald-500/10"
          )}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/30">
            <Clipboard className="w-5 h-5 text-black/80" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold dark:text-white light:text-surface-900">Clipboard</div>
            <div className="text-xs dark:text-surface-500 light:text-surface-400">Paste from clipboard</div>
          </div>
        </button>

        <label
          className={cn(
            "flex items-center gap-3 p-4 rounded-2xl border transition-all duration-200 cursor-pointer hover-lift shine",
            "dark:bg-surface-800/40 dark:border-surface-700/50 dark:hover:border-emerald-500/40",
            "light:bg-white light:border-surface-200 light:hover:border-emerald-500/40",
            "hover:shadow-lg hover:shadow-emerald-500/10"
          )}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/30">
            <Upload className="w-5 h-5 text-black/80" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold dark:text-white light:text-surface-900">File</div>
            <div className="text-xs dark:text-surface-500 light:text-surface-400">Upload .txt file</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.json,.yaml,.yml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileImport(file);
            }}
          />
        </label>

        <div
          className={cn(
            "flex items-start gap-3 p-4 rounded-2xl border transition-all duration-200 hover-lift min-w-0",
            "dark:bg-surface-800/40 dark:border-surface-700/50 dark:hover:border-emerald-500/40",
            "light:bg-white light:border-surface-200 light:hover:border-emerald-500/40",
            "hover:shadow-lg hover:shadow-emerald-500/10"
          )}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/30">
            <Link className="w-5 h-5 text-black/80" />
          </div>
          {/* min-w-0 is essential here: without it, this flex child refuses
              to shrink below its content's natural width, which is exactly
              what pushed the Fetch button outside the visible area when the
              window is narrowed (e.g. Windows Split View / snapping the app
              to half the screen). */}
          <div className="text-left flex-1 min-w-0">
            <div className="text-sm font-semibold dark:text-white light:text-surface-900">Subscription URL</div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-1.5">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlImport()}
                placeholder="https://..."
                className={cn(
                  "flex-1 min-w-0 w-full px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  "dark:bg-surface-900 dark:border-surface-600 dark:text-white dark:placeholder:text-surface-600",
                  "light:bg-surface-50 light:border-surface-300 light:text-surface-900 light:placeholder:text-surface-400",
                  "focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                )}
              />
              <button
                onClick={handleUrlImport}
                disabled={urlLoading}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold text-black/80 transition-all shrink-0 whitespace-nowrap w-full sm:w-auto cursor-pointer",
                  "bg-gradient-to-r from-emerald-400 to-green-600 hover:from-emerald-300 hover:to-green-500 disabled:opacity-50"
                )}
              >
                {urlLoading ? "Fetching..." : "Fetch"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Drop Zone + Text Input */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          "relative rounded-2xl border-2 border-dashed transition-all duration-200 p-1",
          dragOver
            ? "border-emerald-500 bg-emerald-500/10 glow-green"
            : "dark:border-surface-700 light:border-surface-300"
        )}
      >
        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/10 rounded-2xl z-10">
            <div className="text-center pop-in">
              <Upload className="w-10 h-10 text-emerald-400 mx-auto mb-2 floaty" />
              <p className="text-emerald-400 font-semibold">Drop files here</p>
            </div>
          </div>
        )}

        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold dark:text-white light:text-surface-900">
                Paste Links
              </span>
              <span className="text-xs dark:text-surface-500 light:text-surface-400">
                (one per line)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {textInput.trim() && (
                <button
                  onClick={() => setTextInput("")}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors dark:text-surface-400 light:text-surface-500 hover:dark:text-surface-200 hover:light:text-surface-700"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
              <button
                onClick={handleTextImport}
                disabled={!textInput.trim()}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-black/80 transition-all hover:scale-105",
                  "bg-gradient-to-r from-emerald-400 to-green-600 hover:from-emerald-300 hover:to-green-500 disabled:opacity-40 disabled:cursor-not-allowed",
                  "shadow-lg shadow-emerald-500/25"
                )}
              >
                <Zap className="w-3 h-3" />
                Import
              </button>
            </div>
          </div>

          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              "vmess://eyJ2IjoiMiIsInBzIjoi8J+H...\nvless://uuid@server:443?...\ntrojan://password@server:443?...\nss://Y2hhY2hhMjAtaWV0Zi1wb2x5..."
            }
            rows={12}
            className={cn(
              "w-full rounded-xl p-4 text-sm code-textarea resize-y min-h-[180px] transition-colors",
              "dark:bg-surface-900/80 dark:text-surface-200 dark:placeholder:text-surface-600 dark:border dark:border-surface-700/50",
              "light:bg-surface-50 light:text-surface-800 light:placeholder:text-surface-400 light:border light:border-surface-200",
              "focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            )}
          />
        </div>
      </div>

      {/* Tips */}
      <div className={cn(
        "rounded-2xl p-5 border",
        "dark:bg-surface-800/40 dark:border-surface-700/50",
        "light:bg-white light:border-surface-200"
      )}>
        <h3 className="flex items-center gap-2 text-sm font-semibold dark:text-white light:text-surface-900 mb-3">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          Supported Protocols
        </h3>
        <div className="flex flex-wrap gap-2">
          {["vmess://", "vless://", "trojan://", "ss://", "ssr://", "hysteria2://", "tuic://"].map(proto => (
            <span
              key={proto}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-mono font-medium",
                "dark:bg-surface-900 dark:text-surface-300",
                "light:bg-surface-100 light:text-surface-600"
              )}
            >
              {proto}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs dark:text-surface-500 light:text-surface-400 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          Also supports base64-encoded subscription lists
        </p>
      </div>

      {pendingGroupConfigs && (
        <SelectGroupModal
          title={t("subs.addToGroup", language) || "Add imported configs to a group?"}
          subtitle={`${pendingGroupConfigs.added} config(s) were just imported.`}
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
    </div>
  );
}
