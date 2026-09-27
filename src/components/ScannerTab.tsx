/**
 * MEMENTO — IP Scanner tab (v3 — full rebuild on the 3.1.6 brief).
 *
 * The scanner's NATURE (this rebuild): one-click provider target groups —
 * Cloudflare, Google, Vercel, AWS CloudFront, Azure, Oracle, DigitalOcean,
 * Hetzner, GitHub, ArvanCloud, public DNS — that toggle their published
 * CIDR blocks into the target list, PLUS everything the user brings
 * themselves (paste, CIDR, dash ranges, hostnames, imported list files,
 * one-click LAN sweep). NOTHING from v2 was removed:
 *
 *   - live stat strip (scanned / online / open ports / elapsed) ticking
 *     DURING the scan
 *   - port preset chips + custom ports + concurrency / timeout /
 *     reverse-DNS / geo-lookup tuning
 *   - live results: every host streams in as it finishes (scanner_host)
 *   - auto-tags (web/ssh/windows/db/router/…), optional geo (country+ISP)
 *   - category chips with counts, text filter, 4-way sort, per-row copy,
 *     copy selected / IPs / rows, CSV export
 *
 * v3 additions: provider preset grid (multi-select, exact host counts,
 * live target-total badge against the 65,536-host engine cap, clear
 * targets), radar pulse while scanning, horizontally scrollable table.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import {
  Radar, Upload, Square, Download as DownloadIcon, Settings2,
  Copy, Check, Globe, Wifi, WifiOff, MapPin, Network, ScanLine, ListFilter, Layers,
  Cloud, Zap, Box, Database, Droplets, Server, GitBranch, Trash2, Crosshair,
} from "lucide-react";
import { isDesktop, tauriInvoke, onMainEvent } from "../utils/tauriBridge";
import {
  SCAN_PRESETS, presetHostCount, estimateTargetHosts, SCAN_HOST_CAP,
  type ScanTargetPreset,
} from "../utils/scanPresets";

interface ScanPortResultWire { port: number; open: boolean; ms: number | null; }
interface ScanGeoWire {
  country: string | null;
  countryCode: string | null;
  city: string | null;
  isp: string | null;
  as: string | null;
}
interface ScanHostResultWire {
  ip: string;
  hostname: string | null;
  online: boolean;
  ms: number | null;
  ports: ScanPortResultWire[];
  tags: string[];
  geo: ScanGeoWire | null;
}
interface ScanOutcomeWire {
  results: ScanHostResultWire[];
  scanned: number;
  online: number;
  elapsedMs: number;
  cancelled: boolean;
}

const PORT_PRESETS: { id: string; labelEn: string; labelFa: string; ports: string }[] = [
  { id: "ping", labelEn: "Ping (80,443)", labelFa: "پینگ (۸۰،۴۴۳)", ports: "80,443" },
  { id: "web", labelEn: "Web", labelFa: "وب", ports: "80,443,8080,8443" },
  { id: "windows", labelEn: "Windows / RDP", labelFa: "ویندوز / ریموت", ports: "445,3389,139,135" },
  { id: "dev", labelEn: "Dev", labelFa: "دولوپر", ports: "22,3000,5432,3306,6379,8080,9000" },
  { id: "gaming", labelEn: "Gaming", labelFa: "گیمینگ", ports: "27015-27036,3074,25565" },
  { id: "torrent", labelEn: "Torrent", labelFa: "تورنت", ports: "6881-6889,51413" },
  { id: "top30", labelEn: "Top 30", labelFa: "۳۰ پورت مهم", ports: "21,22,23,25,53,80,110,135,139,143,443,445,993,995,1433,1723,3306,3389,5900,6379,8080,8443,8888,9200,27017,32400,5432,25565,11211,1900" },
  { id: "all", labelEn: "All (1-65535)", labelFa: "همه (۱-۶۵۵۳۵)", ports: "1-65535" },
];

const TAG_STYLES: Record<string, string> = {
  web: "bg-teal-500/10 border-teal-500/30 text-teal-300",
  ssh: "bg-lime-500/10 border-lime-500/30 text-lime-300",
  windows: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  db: "bg-amber-500/10 border-amber-500/30 text-amber-300",
  dev: "bg-green-500/10 border-green-500/30 text-green-300",
  game: "bg-rose-500/10 border-rose-500/30 text-rose-300",
  torrent: "bg-orange-500/10 border-orange-500/30 text-orange-300",
  media: "bg-yellow-500/10 border-yellow-500/30 text-yellow-300",
  mail: "bg-amber-500/10 border-amber-500/30 text-amber-300",
  dns: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  ftp: "bg-yellow-500/10 border-yellow-500/30 text-yellow-300",
  proxy: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  router: "bg-emerald-600/15 border-emerald-500/40 text-emerald-300",
};

const FLAG_EMOJI: Record<string, string> = {
  IR: "🇮🇷", US: "🇺🇸", DE: "🇩🇪", FR: "🇫🇷", GB: "🇬🇧", TR: "🇹🇷", NL: "🇳🇱", CA: "🇨🇦",
  RU: "🇷🇺", CN: "🇨🇳", JP: "🇯🇵", AE: "🇦🇪", SE: "🇸🇪", FI: "🇫🇮", SG: "🇸🇬", IN: "🇮🇳",
};

const PRESET_ICONS: Record<string, typeof Cloud> = {
  cloudflare: Cloud,
  google: Globe,
  vercel: Zap,
  aws: Layers,
  azure: Box,
  oracle: Database,
  digitalocean: Droplets,
  hetzner: Server,
  github: GitBranch,
  arvan: MapPin,
  dns: Network,
};

/** Clipboard with a guaranteed fallback (Electron + browser). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the execCommand path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const u32 = (ip: string) => ip.split(".").reduce((n, o) => ((n << 8) + Number(o)) >>> 0, 0);

const tokensOf = (text: string): string[] =>
  String(text || "").split(/[\s,;]+/).filter(Boolean);

export default function ScannerTab() {
  const { language } = useStore();
  const isRtl = language === "fa" || language === "ar";
  const L = useCallback((en: string, fa: string) => (language === "fa" ? fa : en), [language]);

  const [targetText, setTargetText] = useState("");
  const [preset, setPreset] = useState("ping");
  const [portText, setPortText] = useState("");
  const [concurrency, setConcurrency] = useState(256);
  const [timeoutMs, setTimeoutMs] = useState(1200);
  const [reverseDns, setReverseDns] = useState(true);
  const [geoLookup, setGeoLookup] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showProviders, setShowProviders] = useState(true);

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, total: 0, online: 0, phase: "" });
  const [results, setResults] = useState<ScanHostResultWire[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const startedAtRef = useRef(0);

  const [sort, setSort] = useState<"ip" | "ms" | "ports" | "tags">("ip");
  const [filterText, setFilterText] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const [lanCidr, setLanCidr] = useState<string | null>(null);
  const [lanIp, setLanIp] = useState<string | null>(null);

  /* live elapsed ticker */
  useEffect(() => {
    if (!scanning) return;
    const id = window.setInterval(() => {
      setLiveSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [scanning]);

  useEffect(() => {
    if (isDesktop()) {
      tauriInvoke<{ cidr: string; ip: string } | null>("scanner_local_subnet")
        .then((r) => {
          if (r?.cidr) {
            setLanCidr(r.cidr);
            setLanIp(r.ip);
          }
        })
        .catch(() => {});
    }
  }, []);

  /* live streams: per-host rows + progress */
  useEffect(() => {
    const offHost = onMainEvent("scanner_host", (payload) => {
      const h = payload as ScanHostResultWire;
      if (!h?.ip) return;
      setResults((prev) => {
        const i = prev.findIndex((x) => x.ip === h.ip);
        if (i >= 0) {
          const next = [...prev];
          next[i] = h;
          return next;
        }
        return [...prev, h];
      });
    });
    const offProgress = onMainEvent("scanner_progress", (payload) => {
      const ev = payload as { phase?: string; scanned?: number; total?: number; online?: number; detail?: string };
      if (!ev) return;
      setProgress({
        scanned: ev.scanned ?? 0,
        total: ev.total ?? 0,
        online: ev.online ?? 0,
        phase: ev.phase ?? "",
      });
      if (ev.phase === "error" && ev.detail) toast.error(ev.detail);
    });
    return () => {
      offHost();
      offProgress();
    };
  }, []);

  const openPortCount = useMemo(
    () => results.reduce((n, r) => n + r.ports.filter((p) => p.open).length, 0),
    [results]
  );
  const onlineCount = useMemo(() => results.filter((r) => r.online).length, [results]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) {
      if (!r.online) continue;
      for (const tag of r.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [results]);

  const visible = useMemo(() => {
    let arr = [...results];
    if (category === "online") arr = arr.filter((r) => r.online);
    else if (category === "offline") arr = arr.filter((r) => !r.online);
    else if (category !== "all") arr = arr.filter((r) => r.online && r.tags.includes(category));
    const q = filterText.trim().toLowerCase();
    if (q) {
      arr = arr.filter((r) => {
        if (r.ip.includes(q)) return true;
        if (r.hostname?.toLowerCase().includes(q)) return true;
        if (r.tags.some((t) => t.includes(q))) return true;
        if (r.geo?.country?.toLowerCase().includes(q)) return true;
        if (r.geo?.isp?.toLowerCase().includes(q)) return true;
        if (r.ports.some((p) => p.open && String(p.port).includes(q))) return true;
        return false;
      });
    }
    if (sort === "ms") arr.sort((a, b) => (a.ms ?? 1e9) - (b.ms ?? 1e9));
    else if (sort === "ports")
      arr.sort((a, b) => b.ports.filter((p) => p.open).length - a.ports.filter((p) => p.open).length);
    else if (sort === "tags") arr.sort((a, b) => b.tags.length - a.tags.length);
    else arr.sort((a, b) => u32(a.ip) - u32(b.ip));
    return arr;
  }, [results, category, filterText, sort]);

  /* ---------- provider preset state (derived from the textarea) ---------- */
  const targetTokens = useMemo(() => tokensOf(targetText), [targetText]);
  const selectedPresetIds = useMemo(() => {
    const set = new Set(targetTokens);
    return new Set(SCAN_PRESETS.filter((p) => p.ranges.every((r) => set.has(r))).map((p) => p.id));
  }, [targetTokens]);
  const estimatedHosts = useMemo(() => estimateTargetHosts(targetText), [targetText]);
  const overCap = estimatedHosts > SCAN_HOST_CAP;

  const togglePreset = (p: ScanTargetPreset) => {
    const toks = tokensOf(targetText);
    const hasAll = p.ranges.every((r) => toks.includes(r));
    if (hasAll) {
      const drop = new Set(p.ranges);
      setTargetText(toks.filter((t) => !drop.has(t)).join("\n"));
    } else {
      const add = p.ranges.filter((r) => !toks.includes(r));
      setTargetText(toks.length ? [...toks, ...add].join("\n") : add.join("\n"));
    }
  };

  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.scanned / progress.total) * 100)) : 0;

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setTargetText((prev) => {
        const content = (e.target?.result as string) || "";
        return prev.trim() ? prev.trim() + "\n" + content : content;
      });
      toast.success(
        L("Target list imported ✓", "لیست هدف‌ها وارد شد ✓")
      );
    };
    reader.readAsText(file);
  };

  const startScan = async () => {
    if (!targetText.trim()) {
      toast.error(
        L(
          "Pick a provider preset or enter at least one target — IP, CIDR, range or hostname.",
          "یک پریست ارائه‌دهنده انتخاب کن یا حداقل یک هدف وارد کن — آی‌پی، CIDR، بازه یا نام دامنه."
        )
      );
      return;
    }
    if (overCap) {
      toast.error(
        L(
          `Target list expands to ~${estimatedHosts.toLocaleString("en")} hosts — the engine cap is ${SCAN_HOST_CAP.toLocaleString("en")}. Trim a preset or narrow the ranges.`,
          `لیست هدف‌ها به حدود ${estimatedHosts.toLocaleString("fa-IR")} میزبان می‌رسد — سقف موتور ${SCAN_HOST_CAP.toLocaleString("fa-IR")} است. یک پریست را کم کن یا بازه‌ها را محدودتر کن.`
        ),
        { duration: 8000 }
      );
      return;
    }
    setScanning(true);
    setResults([]);
    setSelected(new Set());
    setElapsed(0);
    setLiveSeconds(0);
    setProgress({ scanned: 0, total: 0, online: 0, phase: "expanding" });
    startedAtRef.current = Date.now();
    try {
      const out = await tauriInvoke<ScanOutcomeWire>("scanner_scan", {
        targetText,
        portText,
        preset,
        concurrency,
        timeoutMs,
        reverseDns,
        geoLookup,
      });
      if (out) {
        setResults(out.results ?? []);
        setElapsed(out.elapsedMs ?? 0);
        if (out.cancelled) toast(L("Scan cancelled.", "اسکن لغو شد."));
        else
          toast.success(
            L(
              `Scan finished — ${out.online} host(s) online of ${out.scanned}`,
              `اسکن تمام شد — ${out.online} میزبان آنلاین از ${out.scanned}`
            )
          );
      } else {
        toast.error(L("Scanner needs the desktop app.", "اسکنر به برنامه دسکتاپ نیاز دارد."));
      }
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setScanning(false);
    }
  };

  const stopScan = async () => {
    try {
      await tauriInvoke("scanner_stop");
    } catch {
      /* best-effort */
    }
  };

  const fullRowText = (r: ScanHostResultWire) => {
    const parts = [
      r.ip,
      r.hostname || "",
      r.online ? `online${r.ms !== null ? ` ${r.ms}ms` : ""}` : "offline",
      r.ports.filter((p) => p.open).map((p) => p.port).join(" "),
      r.tags.join(","),
      r.geo ? [r.geo.country, r.geo.isp].filter(Boolean).join(" · ") : "",
    ];
    return parts.filter(Boolean).join("  |  ");
  };

  const ipListText = (rows: ScanHostResultWire[]) => rows.map((r) => r.ip).join("\n");
  const fullListText = (rows: ScanHostResultWire[]) => rows.map(fullRowText).join("\n");

  const doCopy = async (text: string, label: string, ip?: string) => {
    if (await copyText(text)) {
      toast.success(label);
      if (ip) {
        setCopiedIp(ip);
        window.setTimeout(() => setCopiedIp((c) => (c === ip ? null : c)), 1200);
      }
    } else {
      toast.error(L("Copy failed", "کپی ناموفق بود"));
    }
  };

  const exportCsv = () => {
    const header = "ip,hostname,online,best_ms,open_ports,tags,country,isp";
    const lines = visible.map((r) =>
      [
        r.ip,
        r.hostname ?? "",
        r.online ? "1" : "0",
        r.ms ?? "",
        r.ports.filter((p) => p.open).map((p) => p.port).join(" "),
        r.tags.join(" "),
        r.geo?.country ?? "",
        r.geo?.isp ?? "",
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "memento-ipscan.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(L("CSV exported ✓", "خروجی CSV ساخته شد ✓"));
  };

  const latencyColor = (ms: number | null) =>
    ms === null
      ? "text-ink-500"
      : ms < 120
        ? "text-emerald-400"
        : ms < 300
          ? "text-lime-400"
          : ms < 800
            ? "text-yellow-400"
            : "text-orange-400";

  const latencyDot = (ms: number | null) =>
    ms === null
      ? "bg-surface-600"
      : ms < 120
        ? "bg-emerald-400"
        : ms < 300
          ? "bg-lime-400"
          : ms < 800
            ? "bg-yellow-400"
            : "bg-orange-400";

  const toggleSelect = (ip: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  };

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.ip));

  const glassCard = "rounded-2xl border border-surface-700/60 bg-surface-900/50 backdrop-blur-xl shadow-xl shadow-black/20";

  const chipBtn =
    "px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all flex items-center gap-1.5";

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader titleKey="scanner.title2" descKey="scanner.desc2" hintKey="hint.scanner" icon={Radar} />

      {/* ============ LIVE STAT STRIP ============ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          {
            icon: ScanLine,
            label: L("Scanned", "اسکن‌شده"),
            value: scanning && progress.total > 0 ? `${progress.scanned}/${progress.total}` : String(results.length),
            accent: "from-emerald-400 to-green-600",
          },
          {
            icon: Wifi,
            label: L("Online", "آنلاین"),
            value: scanning && progress.total > 0 ? String(progress.online) : String(onlineCount),
            accent: "from-teal-400 to-emerald-600",
          },
          {
            icon: Network,
            label: L("Open ports", "پورت باز"),
            value: String(openPortCount),
            accent: "from-lime-400 to-teal-600",
          },
          {
            icon: Globe,
            label: L("Elapsed", "زمان"),
            value: scanning
              ? `${liveSeconds}s`
              : elapsed
                ? `${(elapsed / 1000).toFixed(1)}s`
                : "—",
            accent: "from-green-400 to-emerald-600",
          },
        ] as const).map((s) => (
          <div key={s.label} className={cn(glassCard, "p-4 flex items-center gap-3")}>
            <div className={cn("w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0", s.accent)}>
              <s.icon className="w-4 h-4 text-black/80" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400 truncate">{s.label}</p>
              <p className="text-lg font-extrabold dark:text-white font-mono leading-tight" dir="ltr">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ============ PROVIDER TARGET PRESETS (the v3 heart) ============ */}
      <div className={cn(glassCard, "p-5 space-y-3")}>
        <div className={cn("flex items-center justify-between gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
          <h3 className="font-extrabold dark:text-white text-sm flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-emerald-400" />
            {L("Provider targets", "هدف‌های آماده")}
            <span className="text-[10px] font-bold text-ink-400 font-normal hidden sm:inline">
              {L("— one click fills the scan list", "— با یک کلیک لیست اسکن پر می‌شود")}
            </span>
          </h3>
          <button
            onClick={() => setShowProviders((v) => !v)}
            className={chipBtn + " border-surface-600/80 text-ink-300 hover:border-emerald-500/60"}
          >
            {showProviders ? L("Hide", "بستن") : L("Show", "نمایش")}
          </button>
        </div>

        {showProviders && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {SCAN_PRESETS.map((p) => {
              const Icon = PRESET_ICONS[p.id] || Cloud;
              const on = selectedPresetIds.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => togglePreset(p)}
                  title={L(p.noteEn, p.noteFa)}
                  className={cn(
                    "group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-start transition-all overflow-hidden",
                    on
                      ? "border-emerald-400/80 bg-emerald-500/10 shadow-[0_0_16px_rgba(34,197,94,0.25)]"
                      : "border-surface-700/60 hover:border-surface-500 bg-surface-950/30"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
                    p.accent
                  )}>
                    <Icon className="w-4 h-4 text-black/80" />
                  </div>
                  <div className="min-w-0">
                    <p className={cn("text-xs font-extrabold truncate", on ? "text-emerald-300" : "dark:text-white")}>
                      {L(p.nameEn, p.nameFa)}
                    </p>
                    <p className="text-[10px] font-mono text-ink-500" dir="ltr">
                      {presetHostCount(p).toLocaleString("en")} hosts
                    </p>
                  </div>
                  {on && <Check className="w-3.5 h-3.5 text-emerald-400 absolute top-1.5 end-1.5" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ============ TARGETS ============ */}
      <div className={cn(glassCard, "p-5 space-y-4")}>
        <div className={cn("flex items-center justify-between gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
          <h3 className="font-extrabold dark:text-white text-sm flex items-center gap-2">
            <ListFilter className="w-4 h-4 text-emerald-400" />
            {L("Targets", "هدف‌ها")}
            <span
              className={cn(
                "text-[10px] font-mono px-2 py-0.5 rounded-full border",
                overCap
                  ? "border-red-500/50 bg-red-500/10 text-red-400"
                  : estimatedHosts > 0
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-surface-700/70 text-ink-500"
              )}
              dir="ltr"
            >
              ≈ {estimatedHosts.toLocaleString("en")} / {SCAN_HOST_CAP.toLocaleString("en")}
            </span>
          </h3>
          <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
            {lanCidr && (
              <button
                onClick={() => setTargetText((p) => (p.trim() ? p.trim() + "\n" + lanCidr : lanCidr))}
                title={lanIp || lanCidr}
                className={chipBtn + " border-emerald-500/40 bg-emerald-500/10 hover:border-emerald-400 text-emerald-300"}
              >
                <Globe className="w-3.5 h-3.5" />
                {L("Scan my LAN", "اسکن شبکه‌ی من")}
                <span className="font-mono text-[10px] text-emerald-400/80" dir="ltr">({lanCidr})</span>
              </button>
            )}
            <label className={cn(chipBtn, "cursor-pointer border-surface-600/80 hover:border-emerald-500/60 text-ink-200")}>
              <Upload className="w-3.5 h-3.5" />
              {L("Import list", "بارگذاری لیست")}
              <input
                type="file"
                accept=".txt,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
            {targetText.trim() && (
              <button
                onClick={() => setTargetText("")}
                className={chipBtn + " border-surface-600/80 hover:border-red-500/60 text-ink-300 hover:text-red-400"}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {L("Clear", "پاک‌کردن")}
              </button>
            )}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className={cn(
                chipBtn,
                showAdvanced
                  ? "border-emerald-500/60 text-emerald-400"
                  : "border-surface-600/80 hover:border-emerald-500/60 text-ink-200"
              )}
            >
              <Settings2 className="w-3.5 h-3.5" />
              {L("Advanced", "پیشرفته")}
            </button>
          </div>
        </div>

        <textarea
          value={targetText}
          onChange={(e) => setTargetText(e.target.value)}
          placeholder={"104.16.0.0/20\n172.64.0.0/20\n192.168.1.1-254\nexample.com\n… " + L("or pick a provider preset above", "یا یک پریست ارائه‌دهنده را از بالا انتخاب کن")}
          rows={4}
          className="w-full px-3 py-2.5 rounded-xl text-xs font-mono bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80 transition-colors resize-y max-h-96"
          dir="ltr"
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {PORT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setPreset(p.id);
                setPortText("");
              }}
              className={cn(
                "px-3 py-2 rounded-lg border text-[11px] font-bold transition-all text-center",
                preset === p.id && !portText.trim()
                  ? "border-emerald-400 bg-emerald-500/10 text-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.25)]"
                  : "border-surface-700/60 hover:border-surface-500 text-ink-300"
              )}
            >
              {L(p.labelEn, p.labelFa)}
            </button>
          ))}
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
            <div className="col-span-2">
              <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">
                {L("Custom ports (overrides preset)", "پورت‌های دلخواه (جایگزین پریست)")}
              </label>
              <input
                value={portText}
                onChange={(e) => setPortText(e.target.value)}
                placeholder="80,443,8000-8100"
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">{L("Concurrency", "همزمانی")}</label>
              <input
                type="number"
                value={concurrency}
                min={1}
                max={2048}
                onChange={(e) => setConcurrency(Math.max(1, Math.min(2048, Number(e.target.value) || 256)))}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">{L("Timeout (ms)", "تایم‌اوت (ms)")}</label>
              <input
                type="number"
                value={timeoutMs}
                min={50}
                max={10000}
                step={50}
                onChange={(e) => setTimeoutMs(Math.max(50, Math.min(10000, Number(e.target.value) || 1200)))}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80"
                dir="ltr"
              />
            </div>
            <label className={cn("flex items-center gap-2 text-xs text-ink-300 cursor-pointer", isRtl && "flex-row-reverse")}>
              <input
                type="checkbox"
                checked={reverseDns}
                onChange={(e) => setReverseDns(e.target.checked)}
                className="accent-emerald-500"
              />
              {L("Reverse-DNS names", "نام معکوس DNS")}
            </label>
            <label className={cn("flex items-center gap-2 text-xs text-ink-300 cursor-pointer col-span-2", isRtl && "flex-row-reverse")}>
              <input
                type="checkbox"
                checked={geoLookup}
                onChange={(e) => setGeoLookup(e.target.checked)}
                className="accent-emerald-500"
              />
              {L("Geo lookup for online hosts (country + ISP)", "موقعیت مکان برای میزبان‌های آنلاین (کشور + ISP)")}
            </label>
          </div>
        )}

        <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
          {scanning ? (
            <button
              onClick={stopScan}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-extrabold bg-gradient-to-r from-red-500 to-rose-600 text-white hover:brightness-110 transition-all shadow-lg shadow-red-500/20"
            >
              <Square className="w-4 h-4" />
              {L("Stop", "توقف")}
            </button>
          ) : (
            <button
              onClick={startScan}
              className="relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-extrabold bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 hover:brightness-110 transition-all shadow-lg shadow-emerald-500/30"
            >
              {scanning && <span className="absolute inset-0 rounded-xl border-2 border-emerald-400/60 radar-ring" />}
              <Radar className="w-4 h-4" />
              {L("Start scan", "شروع اسکن")}
            </button>
          )}
          {results.length > 0 && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-surface-600/80 hover:border-emerald-500/60 text-ink-200 transition-all"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              CSV
            </button>
          )}
          {(scanning || progress.total > 0) && (
            <div className="flex-1 min-w-48">
              <div className="h-2 rounded-full bg-surface-800 overflow-hidden relative">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-300 relative"
                  style={{ width: `${scanning ? Math.max(pct, 2) : pct}%` }}
                >
                  {scanning && <span className="absolute inset-0 animate-pulse bg-white/10" />}
                </div>
              </div>
              <p className="text-[10px] text-ink-400 mt-1 font-mono" dir="ltr">
                {progress.phase === "geo"
                  ? L("geo lookup…", "جستجوی مکان…")
                  : `${progress.scanned}/${progress.total || "?"} · ${progress.online} ${L("online", "آنلاین")} · ${pct}%`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ============ RESULTS ============ */}
      {results.length > 0 && (
        <div className={cn(glassCard, "p-5 space-y-3")}>
          <div className={cn("flex items-center justify-between flex-wrap gap-2", isRtl && "flex-row-reverse")}>
            <h3 className="font-extrabold dark:text-white text-sm">
              {L("Results", "نتایج")}{" "}
              <span className="text-ink-400 font-mono text-xs" dir="ltr">
                ({onlineCount} {L("online", "آنلاین")} / {results.length})
                {elapsed ? ` · ${(elapsed / 1000).toFixed(1)}s` : scanning ? ` · ${liveSeconds}s` : ""}
              </span>
            </h3>
            <div className={cn("flex items-center gap-1.5 flex-wrap", isRtl && "flex-row-reverse")}>
              <button
                onClick={() => doCopy(ipListText(visible), L(`${visible.length} IPs copied ✓`, `${visible.length} آی‌پی کپی شد ✓`))}
                className={chipBtn + " border-surface-600/80 hover:border-emerald-500/60 text-ink-200"}
              >
                <Copy className="w-3 h-3" />
                {L("Copy IPs", "کپی آی‌پی‌ها")}
              </button>
              <button
                onClick={() => doCopy(fullListText(visible), L("Full rows copied ✓", "ردیف‌های کامل کپی شد ✓"))}
                className={chipBtn + " border-surface-600/80 hover:border-emerald-500/60 text-ink-200"}
              >
                <Copy className="w-3 h-3" />
                {L("Copy rows", "کپی ردیف‌ها")}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => doCopy(fullListText(results.filter((r) => selected.has(r.ip))), L(`${selected.size} selected copied ✓`, `${selected.size} مورد انتخاب‌شده کپی شد ✓`))}
                  className={chipBtn + " border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}
                >
                  <Copy className="w-3 h-3" />
                  {L(`Selected (${selected.size})`, `انتخاب‌شده (${selected.size})`)}
                </button>
              )}
            </div>
          </div>

          {/* category chips + filter + sort */}
          <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
            {([
              ["all", L("All", "همه"), results.length],
              ["online", L("Online", "آنلاین"), onlineCount],
              ["offline", L("Offline", "آفلاین"), results.length - onlineCount],
            ] as const).map(([id, label, n]) => (
              <button
                key={id}
                onClick={() => setCategory(id)}
                className={cn(
                  "px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all flex items-center gap-1.5",
                  category === id
                    ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                    : "border-surface-700/70 text-ink-400 hover:text-ink-200 hover:border-surface-500"
                )}
              >
                {id === "online" ? <Wifi className="w-3 h-3" /> : id === "offline" ? <WifiOff className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
                {label}
                <span className="font-mono opacity-70">{n}</span>
              </button>
            ))}
            {tagCounts.map(([tag, n]) => (
              <button
                key={tag}
                onClick={() => setCategory(category === tag ? "all" : tag)}
                className={cn(
                  "px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all",
                  category === tag ? TAG_STYLES[tag] || "border-emerald-400 text-emerald-300" : cn("opacity-70 hover:opacity-100", TAG_STYLES[tag] || "border-surface-700/70 text-ink-400")
                )}
              >
                {tag} <span className="font-mono opacity-70">{n}</span>
              </button>
            ))}
          </div>

          <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={L("Filter — IP, hostname, port, country, ISP…", "فیلتر — آی‌پی، نام، پورت، کشور، ISP…")}
              className="flex-1 min-w-44 px-3 py-1.5 rounded-lg text-xs bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80"
            />
            <div className={cn("flex items-center gap-1 text-[11px]", isRtl && "flex-row-reverse")}>
              {([
                ["ip", L("IP", "آی‌پی")],
                ["ms", L("Latency", "تأخیر")],
                ["ports", L("Ports", "پورت")],
                ["tags", L("Tags", "برچسب")],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setSort(id)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg border transition-all",
                    sort === id ? "border-emerald-500/60 text-emerald-400" : "border-transparent text-ink-400 hover:text-ink-200"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-surface-700/50 overflow-hidden">
            <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
              <table className="w-full text-xs" dir="ltr">
                <thead className="bg-surface-950/80 text-ink-400 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-2.5 py-2 font-bold w-8">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(e) => {
                          if (e.target.checked) setSelected((prev) => new Set([...prev, ...visible.map((r) => r.ip)]));
                          else setSelected((prev) => new Set([...prev].filter((ip) => !visible.some((r) => r.ip === ip))));
                        }}
                        className="accent-emerald-500"
                        aria-label={L("Select all visible", "انتخاب همه‌ی نمایان‌ها")}
                      />
                    </th>
                    <th className="text-left px-3 py-2 font-bold">IP</th>
                    <th className="text-left px-3 py-2 font-bold">{L("Hostname", "نام میزبان")}</th>
                    <th className="text-left px-3 py-2 font-bold">{L("Tags", "برچسب‌ها")}</th>
                    <th className="text-left px-3 py-2 font-bold">{L("Latency", "تأخیر")}</th>
                    <th className="text-left px-3 py-2 font-bold">{L("Open ports", "پورت‌های باز")}</th>
                    <th className="text-left px-3 py-2 font-bold">{L("Location", "موقعیت")}</th>
                    <th className="text-left px-2 py-2 font-bold w-10" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => (
                    <tr
                      key={r.ip}
                      className={cn(
                        "border-t border-surface-800/60 transition-colors hover:bg-surface-800/40",
                        i % 2 === 0 && "bg-surface-900/30",
                        !r.online && "opacity-40",
                        selected.has(r.ip) && "bg-emerald-500/5"
                      )}
                    >
                      <td className="px-2.5 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(r.ip)}
                          onChange={() => toggleSelect(r.ip)}
                          className="accent-emerald-500"
                          aria-label={`select ${r.ip}`}
                        />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-ink-200 whitespace-nowrap">
                        <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-2", r.online ? latencyDot(r.ms) : "bg-surface-600")} />
                        {r.ip}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-ink-400 max-w-40 truncate" title={r.hostname || ""}>
                        {r.hostname || "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {r.tags.slice(0, 3).map((t) => (
                            <span key={t} className={cn("px-1.5 py-0.5 rounded border text-[10px] font-bold", TAG_STYLES[t] || "bg-surface-800 border-surface-600 text-ink-300")}>
                              {t}
                            </span>
                          ))}
                          {r.online && r.tags.length === 0 && (
                            <span className="text-[10px] text-yellow-400">{L("responsive", "پاسخ‌گو")}</span>
                          )}
                          {!r.online && <span className="text-[10px] text-ink-500">{L("no response", "بدون پاسخ")}</span>}
                        </div>
                      </td>
                      <td className={cn("px-3 py-1.5 font-mono whitespace-nowrap", latencyColor(r.ms))}>
                        {r.ms !== null ? `${r.ms} ms` : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {r.ports.filter((p) => p.open).slice(0, 12).map((p) => (
                            <span key={p.port} className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono">
                              {p.port}
                            </span>
                          ))}
                          {r.ports.filter((p) => p.open).length > 12 && (
                            <span className="text-[10px] text-ink-500">+{r.ports.filter((p) => p.open).length - 12}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 max-w-44">
                        {r.geo ? (
                          <div className="flex items-center gap-1.5 min-w-0" title={[r.geo.country, r.geo.city, r.geo.isp].filter(Boolean).join(" · ")}>
                            <span>{FLAG_EMOJI[r.geo.countryCode || ""] || "🌐"}</span>
                            <span className="text-ink-200 whitespace-nowrap">{r.geo.country || "?"}</span>
                            {r.geo.isp && <span className="text-[10px] text-ink-500 truncate max-w-28">{r.geo.isp}</span>}
                          </div>
                        ) : r.online && geoLookup ? (
                          <span className="text-[10px] text-ink-600 flex items-center gap-1"><MapPin className="w-3 h-3" />—</span>
                        ) : (
                          <span className="text-[10px] text-ink-600">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => doCopy(fullRowText(r), L("Row copied ✓", "ردیف کپی شد ✓"), r.ip)}
                          className="p-1 rounded-md text-ink-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                          title={L("Copy this result", "کپی این نتیجه")}
                          aria-label={`copy ${r.ip}`}
                        >
                          {copiedIp === r.ip ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[10px] text-ink-500 font-mono" dir="ltr">
            {visible.length} / {results.length} {L("shown", "نمایش‌داده‌شده")}
          </p>
        </div>
      )}
    </div>
  );
}
