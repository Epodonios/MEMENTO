import { useState, useMemo, useCallback, useRef } from "react";
import { cn } from "../utils/cn";
import { editLink, expandIpRange, detectProtocol } from "../utils/editor";
import { useStore } from "../store";
import { t } from "../i18n";
import {
  Network, Wand2, Copy, Download, Upload, Trash2, ArrowRight,
  Globe, Hash, Sparkles, Info, RotateCcw, PlusCircle
} from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";

type Mode = "iprange" | "spoof";

export default function EditorTab() {
  const [mode, setMode] = useState<Mode>("iprange");

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader titleKey="tab.editor" descKey="desc.editor" icon={Wand2} />

      {/* Mode Switcher */}
      <div className="inline-flex p-1 rounded-2xl gap-1 dark:bg-surface-800/80 light:bg-surface-200/80 border dark:border-surface-700/50 light:border-surface-300/50 shadow-inner">
        <button
          onClick={() => setMode("iprange")}
          className={cn(
            "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all duration-300",
            mode === "iprange"
              ? "bg-gradient-to-r from-emerald-400 to-green-600 text-black/90 shadow-lg shadow-emerald-500/30 scale-105"
              : "dark:text-ink-400 light:text-ink-500 hover:dark:text-emerald-300 hover:light:text-emerald-700"
          )}
        >
          <Network className="w-4 h-4" />
          IP Range
        </button>
        <button
          onClick={() => setMode("spoof")}
          className={cn(
            "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all duration-300",
            mode === "spoof"
              ? "bg-gradient-to-r from-green-400 via-emerald-500 to-teal-600 text-black/90 shadow-lg shadow-emerald-500/30 scale-105"
              : "dark:text-ink-400 light:text-ink-500 hover:dark:text-emerald-300 hover:light:text-emerald-700"
          )}
        >
          <Wand2 className="w-4 h-4" />
          Spoof Mode
        </button>
      </div>

      <div className="transition-all duration-300">
        {mode === "iprange" ? <IpRangeMode /> : <SpoofMode />}
      </div>
    </div>
  );
}

/* ----------------------- Shared input box ----------------------- */

function ConfigInput({
  value, onChange, label = "V2Ray Configs",
}: { value: string; onChange: (v: string) => void; label?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const language = useStore(s => s.language);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      onChange(value ? value + "\n" + text : text);
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
      onChange(value ? value + "\n" + text : text);
      toast.success(t("message.pasted", language));
    } catch {
      toast.error(t("message.error", language));
    }
  };

  const lineCount = value.split("\n").filter(l => l.trim()).length;

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden shine transition-all duration-300 hover:border-emerald-500/40 shadow-xl",
      "dark:border-surface-700/60 dark:bg-surface-900/50",
      "light:border-surface-200 light:bg-white"
    )}>
      <div className={cn(
        "flex items-center justify-between px-5 py-3 border-b",
        "dark:border-surface-700/60 dark:bg-surface-800/80",
        "light:border-surface-200 light:bg-surface-50"
      )}>
        <span className="text-sm font-extrabold dark:text-white light:text-ink-900 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-glow" />
          {label} <span className="text-xs font-semibold dark:text-ink-400 light:text-ink-500 font-mono">({lineCount} lines)</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePaste}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all dark:bg-surface-700/80 dark:text-emerald-300 hover:dark:bg-emerald-500/20 light:bg-surface-100 light:text-emerald-700 light:hover:bg-emerald-500/10 hover:scale-105 active:scale-95"
          >
            <Copy className="w-3.5 h-3.5" /> {t("button.paste", language)}
          </button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all dark:bg-surface-700/80 dark:text-emerald-300 hover:dark:bg-emerald-500/20 light:bg-surface-100 light:text-emerald-700 light:hover:bg-emerald-500/10 hover:scale-105 active:scale-95">
            <Upload className="w-3.5 h-3.5" /> {t("button.file", language)}
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.json,.yaml,.yml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
          {value.trim() && (
            <button
              onClick={() => onChange("")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-red-400 hover:bg-red-500/15 transition-all hover:scale-105 active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" /> {t("button.clear", language)}
            </button>
          )}
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"vmess://...\nvless://uuid@host:443?...\ntrojan://pass@host:443?..."}
        rows={9}
        className={cn(
          "w-full p-5 text-sm code-textarea resize-y min-h-[160px] transition-colors leading-relaxed",
          "dark:bg-transparent dark:text-ink-200 dark:placeholder:text-ink-600",
          "light:bg-transparent light:text-ink-800 light:placeholder:text-ink-400",
          "focus:outline-none"
        )}
      />
    </div>
  );
}

/* ----------------------- Output box ----------------------- */

function OutputBox({ value }: { value: string }) {
  const addConfigs = useStore(s => s.addConfigs);
  const language = useStore(s => s.language);
  const lineCount = value.split("\n").filter(l => l.trim()).length;

  const copy = () => {
    if (!value.trim()) { toast.error(t("message.noData", language)); return; }
    navigator.clipboard.writeText(value).then(() => toast.success(t("message.copied", language)));
  };

  const download = () => {
    if (!value.trim()) { toast.error(t("message.noData", language)); return; }
    const blob = new Blob([value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "memento-edited-configs.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("message.success", language));
  };

  const sendToTable = () => {
    if (!value.trim()) { toast.error(t("message.noData", language)); return; }
    const lines = value.split("\n").map(l => l.trim()).filter(Boolean);
    const before = useStore.getState().configs.length;
    addConfigs(lines);
    const added = useStore.getState().configs.length - before;
    toast.success(added > 0 ? `Added ${added} to table` : "All already exist");
  };

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden shine transition-all duration-300 hover:border-emerald-500/40 shadow-xl",
      "dark:border-surface-700/60 dark:bg-surface-900/50",
      "light:border-surface-200 light:bg-white"
    )}>
      <div className={cn(
        "flex items-center justify-between px-5 py-3 border-b",
        "dark:border-surface-700/60 dark:bg-surface-800/80",
        "light:border-surface-200 light:bg-surface-50"
      )}>
        <span className="flex items-center gap-2 text-sm font-extrabold dark:text-white light:text-ink-900">
          <Sparkles className="w-4 h-4 text-emerald-400 animate-spin" style={{ animationDuration: "6s" }} />
          Generated Output
          <span className="text-xs font-semibold dark:text-ink-400 light:text-ink-500 font-mono">({lineCount} configs)</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-extrabold text-black/90 bg-gradient-to-r from-emerald-400 to-green-600 hover:from-emerald-300 hover:to-green-500 shadow-md shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all"
          >
            <Copy className="w-3.5 h-3.5" /> {t("button.copy", language)}
          </button>
          <button
            onClick={download}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-extrabold text-black/90 bg-gradient-to-r from-green-400 via-emerald-500 to-teal-500 hover:brightness-110 shadow-md shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all"
          >
            <Download className="w-3.5 h-3.5" /> {t("button.download", language)}
          </button>
          <button
            onClick={sendToTable}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all dark:bg-surface-700/80 dark:text-emerald-300 hover:dark:bg-emerald-500/20 light:bg-surface-100 light:text-emerald-700 light:hover:bg-emerald-500/10 hover:scale-105 active:scale-95"
          >
            <PlusCircle className="w-3.5 h-3.5" /> {t("button.toTable", language)}
          </button>
        </div>
      </div>
      <pre className={cn(
        "p-5 text-sm font-mono overflow-auto max-h-[360px] whitespace-pre-wrap break-all min-h-[140px] leading-relaxed",
        "dark:text-ink-200 light:text-ink-800"
      )}>
        {value || "Output will appear here after generating..."}
      </pre>
    </div>
  );
}

/* ----------------------- IP RANGE MODE ----------------------- */

function IpRangeMode() {
  const [configsInput, setConfigsInput] = useState("");
  const [ipRangeInput, setIpRangeInput] = useState("");
  const [portInput, setPortInput] = useState("");
  const [output, setOutput] = useState("");
  const [maxOutput, setMaxOutput] = useState(2000);

  const ipList = useMemo(() => {
    if (!ipRangeInput.trim()) return [];
    return expandIpRange(ipRangeInput, 100000);
  }, [ipRangeInput]);

  const handleGenerate = useCallback(() => {
    const links = configsInput.split("\n").map(l => l.trim()).filter(Boolean);
    if (links.length === 0) {
      toast.error("Paste some V2Ray configs first");
      return;
    }
    if (ipList.length === 0) {
      toast.error("Enter a valid IP range");
      return;
    }

    const results: string[] = [];
    outer: for (const link of links) {
      if (detectProtocol(link) === "unknown") continue;
      for (let i = 0; i < ipList.length; i++) {
        if (results.length >= maxOutput) break outer;
        const ip = ipList[i];
        const edited = editLink(link, {
          newAddress: ip,
          newPort: portInput.trim() || undefined,
          appendName: ` | ${ip}`,
        });
        results.push(edited);
      }
    }

    if (results.length === 0) {
      toast.error("No valid configs generated");
      return;
    }

    setOutput(results.join("\n"));
    toast.success(`Generated ${results.length} configs`);
  }, [configsInput, ipList, portInput, maxOutput]);

  const totalPossible = configsInput.split("\n").filter(l => l.trim()).length * ipList.length;

  return (
    <div className="space-y-6 fade-in">
      <InfoBanner text="Each config will be cloned for every IP in the range, replacing the original server IP/host. Great for screening CDN IPs." />

      <ConfigInput value={configsInput} onChange={setConfigsInput} />

      {/* IP Range + Port controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={cn(
          "rounded-2xl border p-5 transition-all duration-300 hover:border-emerald-500/40 shadow-xl",
          "dark:border-surface-700/60 dark:bg-surface-900/50",
          "light:border-surface-200 light:bg-white"
        )}>
          <label className="flex items-center gap-2 text-sm font-extrabold dark:text-white light:text-ink-900 mb-3">
            <Globe className="w-4 h-4 text-emerald-400" />
            IP Range Target
          </label>
          <textarea
            value={ipRangeInput}
            onChange={(e) => setIpRangeInput(e.target.value)}
            placeholder={"104.16.0.0/24\n1.1.1.1-1.1.1.50\n8.8.8.8, 8.8.4.4"}
            rows={5}
            className={cn(
              "w-full p-4 rounded-xl text-sm code-textarea resize-y border transition-colors leading-relaxed",
              "dark:bg-surface-950/60 dark:border-surface-700/80 dark:text-ink-200 dark:placeholder:text-ink-600",
              "light:bg-surface-50 light:border-surface-200 light:text-ink-800 light:placeholder:text-ink-400",
              "focus:outline-none focus:border-emerald-500/80"
            )}
          />
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="dark:text-ink-400 light:text-ink-500">
              Supports CIDR (<code className="font-mono text-emerald-400">/24</code>), ranges (<code className="font-mono text-emerald-400">a-b</code>), or exact lists.
            </span>
            {ipList.length > 0 && (
              <span className="font-mono font-bold text-emerald-400 py-1 px-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 pulse-glow">
                {ipList.length.toLocaleString()} IPs Ready
              </span>
            )}
          </div>
        </div>

        <div className={cn(
          "rounded-2xl border p-5 space-y-6 flex flex-col justify-between transition-all duration-300 hover:border-emerald-500/40 shadow-xl",
          "dark:border-surface-700/60 dark:bg-surface-900/50",
          "light:border-surface-200 light:bg-white"
        )}>
          <div>
            <label className="flex items-center gap-2 text-sm font-extrabold dark:text-white light:text-ink-900 mb-3">
              <Hash className="w-4 h-4 text-emerald-400" />
              Target Port <span className="text-xs font-semibold dark:text-ink-500 light:text-ink-400">(optional)</span>
            </label>
            <input
              type="text"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              placeholder="Leave blank to maintain original port"
              className={cn(
                "w-full px-4 py-3.5 rounded-xl text-sm font-mono font-semibold border transition-colors",
                "dark:bg-surface-950/60 dark:border-surface-700/80 dark:text-ink-200 dark:placeholder:text-ink-600",
                "light:bg-surface-50 light:border-surface-200 light:text-ink-800 light:placeholder:text-ink-400",
                "focus:outline-none focus:border-emerald-500/80"
              )}
            />
          </div>

          <div className="space-y-2 pb-2">
            <label className="flex items-center justify-between text-sm font-extrabold dark:text-white light:text-ink-900">
              <span>Output Limiter</span>
              <span className="text-emerald-400 font-mono py-1 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 tabular-nums">
                {maxOutput.toLocaleString()} Max
              </span>
            </label>
            <input
              type="range"
              min={100}
              max={20000}
              step={100}
              value={maxOutput}
              onChange={(e) => setMaxOutput(Number(e.target.value))}
              className="w-full accent-emerald-400 h-2 bg-surface-700 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-xs dark:text-ink-400 light:text-ink-500">
              <span>Prevents browser crashes on massive sets.</span>
              {totalPossible > 0 && (
                <span className="font-bold">Total Combos: {totalPossible.toLocaleString()}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl text-base font-extrabold text-black/90 bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-600 hover:brightness-110 shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] glow-green cursor-pointer"
      >
        <ArrowRight className="w-5 h-5 animate-bounce" />
        Generate Bulk Configs with IP Range
      </button>

      <OutputBox value={output} />
    </div>
  );
}

/* ----------------------- SPOOF MODE ----------------------- */

function SpoofMode() {
  const [configsInput, setConfigsInput] = useState("");
  const [newIp, setNewIp] = useState("");
  const [newPort, setNewPort] = useState("");
  const [output, setOutput] = useState("");

  const handleGenerate = useCallback(() => {
    const links = configsInput.split("\n").map(l => l.trim()).filter(Boolean);
    if (links.length === 0) {
      toast.error("Paste some V2Ray configs first");
      return;
    }
    if (!newIp.trim() && !newPort.trim()) {
      toast.error("Enter a new IP and/or port");
      return;
    }

    const results: string[] = [];
    for (const link of links) {
      if (detectProtocol(link) === "unknown") continue;
      const edited = editLink(link, {
        newAddress: newIp.trim() || undefined,
        newPort: newPort.trim() || undefined,
      });
      results.push(edited);
    }

    if (results.length === 0) {
      toast.error("No valid configs to edit");
      return;
    }

    setOutput(results.join("\n"));
    toast.success(`Spoofed ${results.length} configs`);
  }, [configsInput, newIp, newPort]);

  const reset = () => {
    setNewIp("");
    setNewPort("");
    setOutput("");
  };

  return (
    <div className="space-y-6 fade-in">
      <InfoBanner text="Replace the IP/host and/or port of all your configs with custom values you provide. All extra settings (UUID, TLS, path, headers) remain exactly as they were." />

      <ConfigInput value={configsInput} onChange={setConfigsInput} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className={cn(
          "rounded-2xl border p-5 transition-all duration-300 hover:border-emerald-500/40 shadow-xl",
          "dark:border-surface-700/60 dark:bg-surface-900/50",
          "light:border-surface-200 light:bg-white"
        )}>
          <label className="flex items-center gap-2 text-sm font-extrabold dark:text-white light:text-ink-900 mb-3">
            <Globe className="w-4 h-4 text-emerald-400" />
            New IP / Host Address
          </label>
          <input
            type="text"
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            placeholder="e.g. 104.16.1.1 or cdn.awesome.com"
            className={cn(
              "w-full px-4 py-3.5 rounded-xl text-sm font-mono font-semibold border transition-colors",
              "dark:bg-surface-950/60 dark:border-surface-700/80 dark:text-ink-200 dark:placeholder:text-ink-600",
              "light:bg-surface-50 light:border-surface-200 light:text-ink-800 light:placeholder:text-ink-400",
              "focus:outline-none focus:border-emerald-500/80"
            )}
          />
          <p className="mt-2.5 text-xs dark:text-ink-400 light:text-ink-500">
            Leave blank to keep the existing IP of each config.
          </p>
        </div>

        <div className={cn(
          "rounded-2xl border p-5 transition-all duration-300 hover:border-emerald-500/40 shadow-xl",
          "dark:border-surface-700/60 dark:bg-surface-900/50",
          "light:border-surface-200 light:bg-white"
        )}>
          <label className="flex items-center gap-2 text-sm font-extrabold dark:text-white light:text-ink-900 mb-3">
            <Hash className="w-4 h-4 text-emerald-400" />
            New Connection Port
          </label>
          <input
            type="text"
            value={newPort}
            onChange={(e) => setNewPort(e.target.value)}
            placeholder="e.g. 443, 8443, 2087"
            className={cn(
              "w-full px-4 py-3.5 rounded-xl text-sm font-mono font-semibold border transition-colors",
              "dark:bg-surface-950/60 dark:border-surface-700/80 dark:text-ink-200 dark:placeholder:text-ink-600",
              "light:bg-surface-50 light:border-surface-200 light:text-ink-800 light:placeholder:text-ink-400",
              "focus:outline-none focus:border-emerald-500/80"
            )}
          />
          <p className="mt-2.5 text-xs dark:text-ink-400 light:text-ink-500">
            Leave blank to keep the existing port of each config.
          </p>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={handleGenerate}
          className="flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl text-base font-extrabold text-black/90 bg-gradient-to-r from-emerald-400 via-green-500 to-teal-500 hover:brightness-110 shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] glow-green cursor-pointer"
        >
          <Wand2 className="w-5 h-5 animate-spin" style={{ animationDuration: "8s" }} />
          Spoof All Configs Instantly
        </button>
        <button
          onClick={reset}
          className="flex items-center justify-center gap-2 px-7 py-4 rounded-2xl text-sm font-bold transition-all dark:bg-surface-800 dark:text-ink-300 hover:dark:bg-surface-700 light:bg-surface-200 light:text-ink-700 hover:light:bg-surface-300 hover:scale-105 active:scale-95 cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          Reset Mode
        </button>
      </div>

      <OutputBox value={output} />
    </div>
  );
}

/* ----------------------- Info banner ----------------------- */

function InfoBanner({ text }: { text: string }) {
  return (
    <div className={cn(
      "flex items-start gap-3.5 p-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 shadow-inner scale-in"
    )}>
      <Info className="w-5 h-5 mt-0.5 shrink-0 text-emerald-400 animate-pulse" />
      <p className="text-xs dark:text-ink-200 light:text-ink-800 leading-relaxed font-medium">
        {text}
      </p>
    </div>
  );
}
