/**
 * MEMENTO — Live Connection tab (R3 task #4 + H-d per-app consumption).
 *
 * Two live surfaces, one tab, polled together every 2 s (pausable):
 *
 *   1. live_conn_snapshot — the OS socket table (netstat/tasklist or ss):
 *      who has sockets open RIGHT NOW, per-app aggregates, honest totals.
 *   2. get_connection_stats — the ACTIVE core's stats surface. On sing-box
 *      every clash_api /connections row carries metadata.sourcePort — the
 *      LOCAL port of the app that opened the proxied connection — which we
 *      JOIN against the snapshot's socket localPorts to attribute real
 *      BYTES per app. On xray the stats API only exposes per-outbound
 *      counters, so consumption is shown honestly as tunnel-level totals
 *      (never dressed up as a per-app split).
 *
 * Consumption engine (renderer-side ledger):
 *   - bytes are CUMULATIVE counters per connection id -> deltas per poll,
 *     guarded against resets (a smaller reading yields delta 0, never a
 *     negative or a bogus burst);
 *   - deltas are attributed to `pid|app` via a port->owner map refreshed
 *     from every snapshot, with a ~15 s TTL so attribution survives the
 *     gap between the socket table and the core's view;
 *   - per-app live speed is an exponential moving average of deltas/s;
 *   - first sighting of a connection counts 0 (the tab measures the
 *     session from when IT opened — it never retro-invents history).
 *
 * Everything here is REAL data from the two channels; the browser preview
 * exercises it through electron-mock.ts's simulated snapshot + counters.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import SectionHeader from "./SectionHeader";
import Hint from "./Hint";
import {
  Activity, Search, Wifi, Globe2, Server, ChevronDown, ChevronUp, Pause, Play,
  ArrowDown, ArrowUp, Crown, Unplug, Zap, Radio, Filter, Orbit,
} from "lucide-react";
import { isDesktop, tauriInvoke } from "../utils/tauriBridge";

/* ------------------------------------------------------------------ */
/*  Wire shapes                                                        */
/* ------------------------------------------------------------------ */

interface LiveSocketRowWire {
  proto: "tcp" | "udp";
  localAddr: string;
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  state: string;
  pid: number;
  app: string;
}
interface LiveAppRowWire {
  app: string;
  pid: number;
  total: number;
  established: number;
  listening: number;
  udp: number;
  remoteTargets: string[];
  isSystem: boolean;
}
interface LiveSnapshotWire {
  atMs: number;
  platform: string;
  rows: LiveSocketRowWire[];
  apps: LiveAppRowWire[];
  totals: { tcp: number; udp: number; established: number; apps: number };
}
interface ConnStatsRowWire {
  id: string;
  label: string;
  network: string | null;
  download: number;
  upload: number;
  start: string | null;
  chains: string[] | null;
  rule: string | null;
  role: string | null;
  /** sing-box only: the app's local endpoint behind this proxied conn. */
  sourceIp?: string | null;
  sourcePort?: string | null;
}
interface ConnStatsReplyWire {
  core: string;
  /** "per-connection" sing-box · "per-outbound" xray + google-side ·
   *  "sockets" aether (live endpoints, no byte counters) · "none" idle. */
  granularity: "per-connection" | "per-outbound" | "none" | "sockets";
  connections: ConnStatsRowWire[] | null;
  totalLive: number;
  totalShown: number;
}

/* ------------------------------------------------------------------ */
/*  Consumption engine constants                                       */
/* ------------------------------------------------------------------ */

/** port->owner entries older than this expire (snapshot timing gaps). */
const OWNER_TTL_MS = 15_000;
/** EMA weight of the newest delta sample (per 2 s poll). */
const EMA_ALPHA = 0.45;
/** Render caps — the engine sees everything, the DOM stays cheap. */
const MAX_RENDERED_APPS = 60;
const MAX_SOCKETS_PER_APP = 80;
const MAX_CONNS_PER_APP = 40;
const MAX_HISTORY = 60;
/** Ledger bucket for deltas whose sourcePort has no known owner. */
const UNKNOWN_KEY = "0|unattributed";

interface LedgerEntry {
  key: string;
  app: string;
  pid: number;
  down: number;
  up: number;
  speedD: number;
  speedU: number;
}

interface MergedApp {
  key: string;
  app: string;
  pid: number;
  isSystem: boolean;
  total: number;
  established: number;
  listening: number;
  udp: number;
  remoteTargets: string[];
  sockets: LiveSocketRowWire[];
  conns: ConnStatsRowWire[];
  down: number;
  up: number;
  speedD: number;
  speedU: number;
  inSnapshot: boolean;
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function fmtBytes(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  return `${(b / 1024 ** 4).toFixed(2)} TB`;
}
const fmtSpeed = (bps: number): string => `${fmtBytes(bps)}/s`;

/** Fancy pseudo-logo tile per app — deterministic color from the name. */
function appColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hues = ["from-emerald-400 to-green-600", "from-teal-400 to-emerald-600", "from-lime-400 to-emerald-500", "from-green-400 to-teal-600", "from-cyan-400 to-emerald-500"];
  return hues[h % hues.length];
}

function initials(name: string): string {
  const clean = name.replace(/\.exe$/i, "").replace(/^pid:/, "");
  const parts = clean.split(/[.\s_-]+/).filter(Boolean);
  if (!parts.length) return "·";
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Tweened number (rAF interpolation — no deps)                       */
/* ------------------------------------------------------------------ */

function useTweened(target: number, ms = 450): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef(0);
  useEffect(() => {
    const from = displayRef.current;
    const diff = target - from;
    if (Math.abs(diff) < 0.5) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const v = from + diff * e;
      displayRef.current = v;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, ms]);
  return display;
}

function TweenNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const v = useTweened(value);
  return <span dir="ltr" className={cn("tabular-nums", className)}>{format(v)}</span>;
}

/* ------------------------------------------------------------------ */
/*  Throughput sparkline (thin live gradient area)                     */
/* ------------------------------------------------------------------ */

function SpeedSpark({ hist }: { hist: number[] }) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const pts = hist.slice(-40);
  const w = 132;
  const h = 38;
  if (pts.length < 2) {
    return (
      <div className="flex items-end gap-[2px] h-[38px]" dir="ltr">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="w-[4px] h-1 rounded-sm bg-emerald-800/50" />
        ))}
      </div>
    );
  }
  const max = Math.max(1, ...pts);
  const step = w / (pts.length - 1);
  const y = (v: number) => h - (v / max) * (h - 4) - 2;
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${gradId})`} />
      <path d={line} fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={y(pts[pts.length - 1])} r="2.5" fill="#6ee7b7" className="drop-shadow-[0_0_4px_rgba(110,231,183,0.9)]" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Usage bar — width = app's share of current total speed             */
/* ------------------------------------------------------------------ */

function UsageBar({ share, isTop }: { share: number; isTop: boolean }) {
  const pct = Math.min(100, Math.max(0, share * 100));
  return (
    <div className="relative h-1.5 w-full rounded-full bg-surface-800/80" dir="ltr">
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-green-400",
          "transition-[width] duration-300 ease-out",
          isTop && "shadow-[0_0_14px_rgba(52,211,153,0.7)]"
        )}
        style={{ width: `${pct}%` }}
      >
        {pct > 2.5 && (
          <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.95)]" />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small chips                                                        */
/* ------------------------------------------------------------------ */

const ROLE_COLORS: Record<string, string> = {
  tunnel: "bg-emerald-500/15 text-emerald-300",
  pool: "bg-teal-500/15 text-teal-300",
  chain: "bg-violet-500/15 text-violet-300",
  dialer: "bg-violet-500/15 text-violet-300",
  direct: "bg-ink-500/15 text-ink-300",
  blocked: "bg-red-500/15 text-red-300",
  other: "bg-ink-500/15 text-ink-300",
};

/* ------------------------------------------------------------------ */
/*  Per-app row (memoized — only re-renders when its data changes)     */
/* ------------------------------------------------------------------ */

interface AppRowProps {
  a: MergedApp;
  open: boolean;
  isTop: boolean;
  totalSpeed: number;
  isRtl: boolean;
  L: (en: string, fa: string) => string;
  onToggle: (key: string) => void;
}

const AppRow = memo(function AppRow({ a, open, isTop, totalSpeed, isRtl, L, onToggle }: AppRowProps) {
  const share = totalSpeed > 0 ? (a.speedD + a.speedU) / totalSpeed : 0;
  const isUnknown = a.key === UNKNOWN_KEY;
  const displayName = isUnknown ? L("Unattributed", "تخصیص‌نشده") : a.app;
  const moving = a.speedD + a.speedU > 1;

  return (
    <div
      className={cn(
        "rounded-2xl border transition-all duration-300 overflow-hidden",
        open
          ? "border-emerald-500/50 bg-emerald-500/5"
          : isTop
            ? "border-emerald-400/40 bg-surface-900/50 shadow-[0_0_22px_rgba(34,197,94,0.14)]"
            : "border-surface-700/50 bg-surface-900/40 hover:border-surface-500/80"
      )}
    >
      <button
        className={cn("w-full p-4 pb-2 flex items-center gap-3 text-left", isRtl && "flex-row-reverse text-right")}
        onClick={() => onToggle(a.key)}
      >
        <div className="relative shrink-0">
          <div className={cn("w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center font-extrabold text-black/80", isUnknown ? "from-ink-500 to-ink-700" : appColor(a.app))}>
            {isUnknown ? "?" : initials(a.app)}
          </div>
          {moving && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 ring-2 ring-surface-900" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
            <p className="font-bold text-sm dark:text-white truncate font-mono" dir="ltr">{displayName}</p>
            {isTop && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gradient-to-r from-emerald-500/25 to-green-500/10 border border-emerald-400/40 text-emerald-300 text-[10px] font-extrabold whitespace-nowrap">
                <Crown className="w-3 h-3" />
                {L("top consumer", "بیشترین مصرف")}
              </span>
            )}
            {!a.inSnapshot && (
              <span className="px-2 py-0.5 rounded-lg bg-surface-800/80 border border-surface-700/60 text-ink-400 text-[10px] font-bold whitespace-nowrap">
                {L("no live sockets", "بدون سوکت زنده")}
              </span>
            )}
          </div>
          <p className="text-[10px] text-ink-500 font-mono mt-0.5 truncate" dir="ltr">
            {a.pid ? `PID ${a.pid}` : "—"}
            {a.remoteTargets.length > 0 ? ` · ${a.remoteTargets.slice(0, 2).join(" · ")}` : ""}
          </p>
        </div>

        <div className={cn("flex items-center gap-3 shrink-0", isRtl && "flex-row-reverse")}>
          <div className="hidden sm:flex flex-col items-end gap-1" dir="ltr">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-mono text-[11px] font-bold">
              <ArrowDown className="w-3 h-3" /> {fmtSpeed(a.speedD)}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-teal-500/10 border border-teal-500/25 text-teal-300 font-mono text-[11px] font-bold">
              <ArrowUp className="w-3 h-3" /> {fmtSpeed(a.speedU)}
            </span>
          </div>
          <div className="text-center">
            <p className="text-sm font-extrabold dark:text-white font-mono" dir="ltr">
              <TweenNumber value={a.down + a.up} format={fmtBytes} />
            </p>
            <p className="text-[9px] text-ink-500 uppercase whitespace-nowrap">{L("session", "نشست")}</p>
          </div>
          <div className="hidden md:flex items-center gap-2.5">
            <div className="text-center">
              <p className="text-sm font-extrabold text-emerald-400 font-mono" dir="ltr">{a.established}</p>
              <p className="text-[9px] text-ink-500 uppercase">{L("active", "فعال")}</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-extrabold dark:text-white font-mono" dir="ltr">{a.total}</p>
              <p className="text-[9px] text-ink-500 uppercase">{L("total", "کل")}</p>
            </div>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-ink-400" /> : <ChevronDown className="w-4 h-4 text-ink-400" />}
        </div>
      </button>

      <div className="px-4 pb-3">
        <UsageBar share={share} isTop={isTop} />
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* quick counters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-xl bg-surface-950/60 border border-surface-700/40 p-2 text-center">
              <p className="text-xs font-bold text-teal-400 font-mono">{a.listening}</p>
              <p className="text-[9px] text-ink-500 uppercase">{L("listening", "شنونده")}</p>
            </div>
            <div className="rounded-xl bg-surface-950/60 border border-surface-700/40 p-2 text-center">
              <p className="text-xs font-bold text-lime-400 font-mono">{a.udp}</p>
              <p className="text-[9px] text-ink-500 uppercase">{L("udp", "UDP")}</p>
            </div>
            <div className="rounded-xl bg-surface-950/60 border border-surface-700/40 p-2 text-center">
              <p className="text-xs font-bold text-emerald-400 font-mono" dir="ltr">
                <TweenNumber value={a.down} format={fmtBytes} />
              </p>
              <p className="text-[9px] text-ink-500 uppercase">{L("downloaded", "دانلود")}</p>
            </div>
            <div className="rounded-xl bg-surface-950/60 border border-surface-700/40 p-2 text-center">
              <p className="text-xs font-bold text-teal-300 font-mono" dir="ltr">
                <TweenNumber value={a.up} format={fmtBytes} />
              </p>
              <p className="text-[9px] text-ink-500 uppercase">{L("uploaded", "آپلود")}</p>
            </div>
          </div>

          {/* OS sockets — the real socket table rows of this app */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-400 font-bold mb-1.5">
              {L("Sockets (OS table)", "سوکت‌ها (جدول سیستم‌عامل)")} · {a.sockets.length}
            </p>
            {a.sockets.length > 0 ? (
              <div className="max-h-72 overflow-y-auto rounded-xl border border-surface-700/40">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-ink-500 text-[9px] uppercase tracking-wider bg-surface-950/95 sticky top-0 backdrop-blur">
                      <th className="text-start font-bold py-1.5 px-2">{L("proto", "پروتکل")}</th>
                      <th className="text-start font-bold py-1.5 px-2">{L("state", "وضعیت")}</th>
                      <th className="text-start font-bold py-1.5 px-2">{L("local", "محلی")}</th>
                      <th className="text-start font-bold py-1.5 px-2">{L("remote", "مقصد")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.sockets.map((s, i) => (
                      <tr key={`${s.proto}-${s.localPort}-${s.remoteAddr}-${i}`} className="border-t border-surface-800/60">
                        <td className={cn("py-1 px-2 uppercase font-bold", s.proto === "tcp" ? "text-emerald-400" : "text-lime-400")}>{s.proto}</td>
                        <td className="py-1 px-2 text-ink-300">{s.state || "—"}</td>
                        <td className="py-1 px-2 text-ink-200">{s.localAddr}:{s.localPort}</td>
                        <td className="py-1 px-2 text-ink-200">{s.remoteAddr ? `${s.remoteAddr}:${s.remotePort}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-ink-500">{L("No sockets reported for this app right now.", "در حال حاضر سوکتی برای این برنامه گزارش نشده.")}</p>
            )}
          </div>

          {/* proxied connections through the core (sing-box only) */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-400 font-bold mb-1.5">
              {L("Proxied connections", "اتصال‌های پروکسی‌شده")} · {a.conns.length}
            </p>
            {a.conns.length > 0 ? (
              <div className="max-h-72 overflow-y-auto rounded-xl border border-surface-700/40">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-ink-500 text-[9px] uppercase tracking-wider bg-surface-950/95 sticky top-0 backdrop-blur">
                      <th className="text-start font-bold py-1.5 px-2">{L("destination", "مقصد")}</th>
                      <th className="text-start font-bold py-1.5 px-2">{L("net", "شبکه")}</th>
                      <th className="text-start font-bold py-1.5 px-2">{L("chain → rule", "زنجیره ← قانون")}</th>
                      <th className="text-end font-bold py-1.5 px-2">{L("down", "دانلود")}</th>
                      <th className="text-end font-bold py-1.5 px-2">{L("up", "آپلود")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.conns.map((c) => (
                      <tr key={c.id} className="border-t border-surface-800/60">
                        <td className="py-1 px-2 max-w-[220px]">
                          <span className="text-ink-100 truncate block" title={c.sourceIp ? `${c.sourceIp}:${c.sourcePort ?? ""}` : undefined}>
                            {c.label}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-ink-400 uppercase">{c.network ?? "—"}</td>
                        <td className="py-1 px-2 text-ink-400 max-w-[160px] truncate" dir="ltr">
                          {c.chains && c.chains.length > 0 ? c.chains.join("→") : "—"}
                          {c.rule ? ` · ${c.rule}` : ""}
                        </td>
                        <td className="py-1 px-2 text-end text-emerald-300 font-bold">{fmtBytes(c.download)}</td>
                        <td className="py-1 px-2 text-end text-teal-300 font-bold">{fmtBytes(c.upload)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-ink-500">
                {L(
                  "No proxied connections attributed to this app right now (direct traffic or a non-reporting core).",
                  "در حال حاضر اتصال پروکسی‌شده‌ای به این برنامه تخصیص نیافته (ترافیک مستقیم یا هسته‌ی بدون گزارش)."
                )}
              </p>
            )}
          </div>

          {/* remote targets chips (kept from the original tab) */}
          {a.remoteTargets.length > 0 && (
            <div className="flex flex-wrap gap-1.5" dir="ltr">
              {a.remoteTargets.map((r) => (
                <span key={r} className="px-2 py-1 rounded-lg text-[10px] font-mono bg-surface-950/80 border border-surface-700/50 text-ink-300">
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Tab                                                                */
/* ------------------------------------------------------------------ */

export default function LiveConnTab() {
  const language = useStore((s) => s.language);
  const connApiPort = useStore((s) => s.connApiPort);
  const isRtl = language === "fa" || language === "ar";
  const L = useCallback((en: string, fa: string) => (language === "fa" ? fa : en), [language]);

  const [snap, setSnap] = useState<LiveSnapshotWire | null>(null);
  const [stats, setStats] = useState<ConnStatsReplyWire | null>(null);
  const [live, setLive] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"speed" | "session" | "connections">("speed");
  const [hideSystem, setHideSystem] = useState(true);
  const [ledger, setLedger] = useState<Map<string, LedgerEntry>>(new Map());
  const [speedHist, setSpeedHist] = useState<number[]>([]);
  const [tunnel, setTunnel] = useState({ down: 0, up: 0, speedD: 0, speedU: 0 });
  const [outSpeed, setOutSpeed] = useState<Map<string, { d: number; u: number }>>(new Map());

  /* ---- engine refs (mutated in-place every poll, committed to state) ---- */
  const portOwnerRef = useRef<Map<string, { key: string; at: number }>>(new Map());
  const countersRef = useRef<Map<string, { d: number; u: number }>>(new Map());
  const ledgerRef = useRef<Map<string, LedgerEntry>>(new Map());
  const tunnelRef = useRef({ down: 0, up: 0, speedD: 0, speedU: 0 });
  const outSpeedRef = useRef<Map<string, { d: number; u: number }>>(new Map());
  const lastStatsAtRef = useRef(0);
  const pollBusyRef = useRef(false);

  /* -------------------------------------------------------------- */
  /*  Snapshot ingest: refresh the port->owner join map             */
  /* -------------------------------------------------------------- */
  const ingestSnapshot = useCallback((s: LiveSnapshotWire) => {
    const now = Date.now();
    const owners = portOwnerRef.current;
    for (const r of s.rows) {
      if (!r.localPort) continue;
      const key = `${r.pid}|${r.app || (r.pid ? `pid:${r.pid}` : "System")}`;
      owners.set(String(r.localPort), { key, at: now });
    }
    // expire owners whose socket vanished from the table > TTL ago
    for (const [port, o] of owners) {
      if (now - o.at > OWNER_TTL_MS) owners.delete(port);
    }
    setSnap(s);
  }, []);

  /* -------------------------------------------------------------- */
  /*  Stats ingest: deltas -> ledger attribution -> EMA speeds      */
  /* -------------------------------------------------------------- */
  const ingestStats = useCallback((reply: ConnStatsReplyWire) => {
    const now = Date.now();
    const last = lastStatsAtRef.current;
    // nominal 2 s cadence; clamp against interval drift / first call
    const dt = last ? Math.min(10, Math.max(0.25, (now - last) / 1000)) : 2;
    lastStatsAtRef.current = now;

    const rows = Array.isArray(reply.connections) ? reply.connections : [];
    const instByKey = new Map<string, { d: number; u: number }>();
    const instPerRow = new Map<string, { d: number; u: number }>();
    const instTunnel = { d: 0, u: 0 };

    if (rows.length > 0) {
      const liveIds = new Set<string>();
      for (const row of rows) {
        liveIds.add(row.id);
        const prev = countersRef.current.get(row.id);
        // CUMULATIVE counters -> per-poll deltas; a reset (smaller reading)
        // yields 0, never a negative or a bogus burst.
        const dD = prev ? Math.max(0, row.download - prev.d) : 0;
        const dU = prev ? Math.max(0, row.upload - prev.u) : 0;
        countersRef.current.set(row.id, { d: row.download, u: row.upload });
        if (dD === 0 && dU === 0) continue;
        instPerRow.set(row.id, { d: dD, u: dU });
        instTunnel.d += dD;
        instTunnel.u += dU;
        if (reply.granularity !== "per-connection") continue;
        // ATTRIBUTION JOIN: clash_api metadata.sourcePort === the local
        // port of the app's socket in the OS table. The port->owner map
        // was refreshed from THIS cycle's snapshot a moment ago; entries
        // survive snapshot timing gaps for OWNER_TTL_MS.
        const port = row.sourcePort != null ? String(row.sourcePort) : "";
        const owner = port ? portOwnerRef.current.get(port) : undefined;
        const key = owner ? owner.key : UNKNOWN_KEY;
        const acc = instByKey.get(key);
        if (acc) {
          acc.d += dD;
          acc.u += dU;
        } else {
          instByKey.set(key, { d: dD, u: dU });
        }
      }
      // prune counters of connections the core no longer reports (a
      // reappearing id simply starts a fresh baseline — under-counts one
      // cycle, never double-counts)
      for (const id of [...countersRef.current.keys()]) {
        if (!liveIds.has(id)) countersRef.current.delete(id);
      }
    }

    if (reply.granularity === "per-connection") {
      // commit ledger deltas
      for (const [key, inst] of instByKey) {
        const e = ledgerRef.current.get(key);
        if (e) {
          e.down += inst.d;
          e.up += inst.u;
        } else {
          const sep = key.indexOf("|");
          const pid = Number(key.slice(0, sep)) || 0;
          const app = key.slice(sep + 1) || `pid:${pid}`;
          ledgerRef.current.set(key, { key, app, pid, down: inst.d, up: inst.u, speedD: 0, speedU: 0 });
        }
      }
      // EMA live speed for EVERY app (untouched ones decay toward 0)
      for (const e of ledgerRef.current.values()) {
        const inst = instByKey.get(e.key);
        e.speedD = e.speedD * (1 - EMA_ALPHA) + ((inst ? inst.d : 0) / dt) * EMA_ALPHA;
        e.speedU = e.speedU * (1 - EMA_ALPHA) + ((inst ? inst.u : 0) / dt) * EMA_ALPHA;
      }
      setLedger(new Map(ledgerRef.current));
    }

    if (reply.granularity === "per-outbound") {
      // xray: honest tunnel-level session (no per-app split exists)
      const t = tunnelRef.current;
      t.down += instTunnel.d;
      t.up += instTunnel.u;
      t.speedD = t.speedD * (1 - EMA_ALPHA) + (instTunnel.d / dt) * EMA_ALPHA;
      t.speedU = t.speedU * (1 - EMA_ALPHA) + (instTunnel.u / dt) * EMA_ALPHA;
      setTunnel({ ...t });
      // per-outbound live speeds for the tunnel card (ref-driven, so the
      // ingest callback itself stays referentially stable across polls)
      const nextOut = new Map<string, { d: number; u: number }>();
      for (const row of rows) {
        const inst = instPerRow.get(row.id);
        const prevS = outSpeedRef.current.get(row.id) ?? { d: 0, u: 0 };
        nextOut.set(row.id, {
          d: prevS.d * (1 - EMA_ALPHA) + ((inst ? inst.d : 0) / dt) * EMA_ALPHA,
          u: prevS.u * (1 - EMA_ALPHA) + ((inst ? inst.u : 0) / dt) * EMA_ALPHA,
        });
      }
      outSpeedRef.current = nextOut;
      setOutSpeed(nextOut);
    }

    setStats(reply);

    // hero sparkline: total throughput bytes/s
    let totalSpeed = 0;
    if (reply.granularity === "per-connection") {
      for (const e of ledgerRef.current.values()) totalSpeed += e.speedD + e.speedU;
    } else if (reply.granularity === "per-outbound") {
      totalSpeed = tunnelRef.current.speedD + tunnelRef.current.speedU;
    }
    setSpeedHist((h) => [...h.slice(-(MAX_HISTORY - 1)), totalSpeed]);
    // stable on purpose: every input above is a ref or a setState — the
    // poll interval must NOT be recreated by render-cycle state changes
  }, []);

  /* -------------------------------------------------------------- */
  /*  Poll loop — BOTH channels every 2 s, pausable                 */
  /* -------------------------------------------------------------- */
  const refresh = useCallback(async () => {
    if (!isDesktop() || pollBusyRef.current) return;
    pollBusyRef.current = true;
    try {
      const [snapRes, statsRes] = await Promise.allSettled([
        tauriInvoke<LiveSnapshotWire>("live_conn_snapshot"),
        tauriInvoke<ConnStatsReplyWire>("get_connection_stats", { apiPort: connApiPort }),
      ]);
      // snapshot FIRST so this cycle's port->owner map feeds attribution
      if (snapRes.status === "fulfilled" && snapRes.value) ingestSnapshot(snapRes.value);
      if (statsRes.status === "fulfilled" && statsRes.value) ingestStats(statsRes.value);
    } catch {
      /* best-effort — next tick retries */
    } finally {
      pollBusyRef.current = false;
    }
  }, [connApiPort, ingestSnapshot, ingestStats]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [live, refresh]);

  /* -------------------------------------------------------------- */
  /*  Derived view model                                            */
  /* -------------------------------------------------------------- */
  const merged = useMemo<MergedApp[]>(() => {
    const apps = snap?.apps ?? [];
    const rows = snap?.rows ?? [];

    const socketsByApp = new Map<string, LiveSocketRowWire[]>();
    for (const r of rows) {
      const key = `${r.pid}|${r.app || (r.pid ? `pid:${r.pid}` : "System")}`;
      let arr = socketsByApp.get(key);
      if (!arr) {
        arr = [];
        socketsByApp.set(key, arr);
      }
      if (arr.length < MAX_SOCKETS_PER_APP) arr.push(r);
    }

    // proxied connections joined to their owning app via sourcePort
    const connsByApp = new Map<string, ConnStatsRowWire[]>();
    if (
      (stats?.granularity === "per-connection" || stats?.granularity === "sockets") &&
      Array.isArray(stats.connections)
    ) {
      for (const c of stats.connections) {
        const port = c.sourcePort != null ? String(c.sourcePort) : "";
        const owner = port ? portOwnerRef.current.get(port) : undefined;
        const key = owner ? owner.key : UNKNOWN_KEY;
        let arr = connsByApp.get(key);
        if (!arr) {
          arr = [];
          connsByApp.set(key, arr);
        }
        if (arr.length < MAX_CONNS_PER_APP) arr.push(c);
      }
    }

    const list: MergedApp[] = [];
    const seen = new Set<string>();
    for (const a of apps) {
      const key = `${a.pid}|${a.app}`;
      seen.add(key);
      const led = ledger.get(key);
      list.push({
        key,
        app: a.app,
        pid: a.pid,
        isSystem: a.isSystem,
        total: a.total,
        established: a.established,
        listening: a.listening,
        udp: a.udp,
        remoteTargets: a.remoteTargets,
        sockets: socketsByApp.get(key) ?? [],
        conns: connsByApp.get(key) ?? [],
        down: led?.down ?? 0,
        up: led?.up ?? 0,
        speedD: led?.speedD ?? 0,
        speedU: led?.speedU ?? 0,
        inSnapshot: true,
      });
    }
    // apps that consumed bytes this session but currently hold no sockets
    for (const [key, led] of ledger) {
      if (seen.has(key)) continue;
      if (led.down + led.up <= 0 && led.speedD + led.speedU <= 0) continue;
      list.push({
        key,
        app: led.app,
        pid: led.pid,
        isSystem: false,
        total: 0,
        established: 0,
        listening: 0,
        udp: 0,
        remoteTargets: [],
        sockets: [],
        conns: connsByApp.get(key) ?? [],
        down: led.down,
        up: led.up,
        speedD: led.speedD,
        speedU: led.speedU,
        inSnapshot: false,
      });
    }
    return list;
  }, [snap, stats, ledger]);

  const singboxMode = stats?.granularity === "per-connection";
  const xrayMode = stats?.granularity === "per-outbound";
  // 3.1.8 (field report #5): aether's honest "sockets" surface + the
  // Google Side relay reusing the per-outbound tunnel table.
  const aetherMode = stats?.granularity === "sockets";
  const googleSideMode = stats?.core === "google-side" && xrayMode;

  const sessionDown = useMemo(() => merged.reduce((s, a) => s + a.down, 0), [merged]);
  const sessionUp = useMemo(() => merged.reduce((s, a) => s + a.up, 0), [merged]);
  const sumSpeedD = useMemo(() => merged.reduce((s, a) => s + a.speedD, 0), [merged]);
  const sumSpeedU = useMemo(() => merged.reduce((s, a) => s + a.speedU, 0), [merged]);

  const heroDown = singboxMode ? sessionDown : tunnel.down;
  const heroUp = singboxMode ? sessionUp : tunnel.up;
  const heroSpeedD = singboxMode ? sumSpeedD : tunnel.speedD;
  const heroSpeedU = singboxMode ? sumSpeedU : tunnel.speedU;
  const totalSpeed = heroSpeedD + heroSpeedU;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = merged;
    if (q) {
      rows = rows.filter(
        (a) =>
          a.app.toLowerCase().includes(q) ||
          String(a.pid).includes(q) ||
          a.remoteTargets.some((r) => r.toLowerCase().includes(q)) ||
          a.sockets.some((s) => s.remoteAddr.toLowerCase().includes(q)) ||
          a.conns.some((c) => c.label.toLowerCase().includes(q))
      );
    } else if (hideSystem) {
      rows = rows.filter((a) => !a.isSystem);
    }
    return rows;
  }, [merged, search, hideSystem]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortMode === "speed") {
        return b.speedD + b.speedU - (a.speedD + a.speedU) || b.down + b.up - (a.down + a.up);
      }
      if (sortMode === "session") {
        return b.down + b.up - (a.down + a.up) || b.speedD + b.speedU - (a.speedD + a.speedU);
      }
      return b.established - a.established || b.total - a.total || b.down + b.up - (a.down + a.up);
    });
    return arr.slice(0, MAX_RENDERED_APPS);
  }, [filtered, sortMode]);

  const topKey = useMemo(() => {
    let best: string | null = null;
    let bestV = 0;
    for (const a of sorted) {
      const v = a.speedD + a.speedU;
      if (v > bestV) {
        bestV = v;
        best = a.key;
      }
    }
    return bestV > 0 ? best : null;
  }, [sorted]);

  const onToggle = useCallback((key: string) => {
    setExpanded((cur) => (cur === key ? null : key));
  }, []);

  /* footer: established delta (kept from the original tab) */
  const prevEstablished = useRef(0);
  const delta = snap ? snap.totals.established - prevEstablished.current : 0;
  useEffect(() => {
    if (snap) prevEstablished.current = snap.totals.established;
  }, [snap]);

  /* core badge */
  const badge = (() => {
    if (!stats || stats.granularity === "none") {
      return {
        icon: Unplug,
        label: stats ? L("no active connection", "اتصال فعالی نیست") : L("probing…", "در حال نمونه‌گیری…"),
        cls: "border-surface-600/70 text-ink-400 bg-surface-900/60",
      };
    }
    if (stats.core === "sing-box") {
      return {
        icon: Zap,
        label: "sing-box · per-connection",
        cls: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
      };
    }
    if (stats.core === "aether") {
      return {
        icon: Orbit,
        label: "aether · " + L("live sockets", "سوکت‌های زنده"),
        cls: "border-teal-500/40 text-teal-300 bg-teal-500/10",
      };
    }
    if (stats.core === "google-side") {
      return {
        icon: Globe2,
        label: "google side · " + L("relay", "رله"),
        cls: "border-lime-500/40 text-lime-300 bg-lime-500/10",
      };
    }
    return {
      icon: Radio,
      label: "xray · per-outbound",
      cls: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
    };
  })();
  const BadgeIcon = badge.icon;

  const StatTile = ({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: string | number; accent?: string }) => (
    <div className="rounded-2xl border border-surface-700/50 bg-surface-900/60 p-4">
      <div className={cn("flex items-center gap-2", isRtl && "flex-row-reverse")}>
        <Icon className={cn("w-4 h-4", accent || "text-emerald-400")} />
        <span className="text-[10px] uppercase tracking-wider text-ink-400 font-bold">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-extrabold dark:text-white font-mono" dir="ltr">{value}</p>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader titleKey="liveconn.title" descKey="liveconn.desc" hintKey="hint.liveconn" icon={Activity} />

      {/* ============ HERO — per-app consumption ============ */}
      <div className="relative rounded-2xl border border-surface-700/60 bg-surface-900/50 glass overflow-hidden">
        <div className="absolute -top-16 -right-10 w-64 h-40 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-10 w-56 h-36 rounded-full bg-green-600/10 blur-3xl pointer-events-none" />
        <div className="relative p-5 grid gap-5 lg:grid-cols-[1fr_1fr_auto]">
          {/* session download */}
          <div>
            <div className={cn("flex items-center gap-2", isRtl && "flex-row-reverse")}>
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <ArrowDown className="w-4 h-4 text-emerald-300" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-ink-400 font-bold">
                {L("Session download", "مجموع نشست — دانلود")}
              </span>
            </div>
            <p className="mt-2 text-4xl font-extrabold font-mono gradient-text">
              <TweenNumber value={heroDown} format={fmtBytes} />
            </p>
            <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-mono text-xs font-bold" dir="ltr">
              <ArrowDown className="w-3 h-3" /> {fmtSpeed(heroSpeedD)}
              <span className="text-ink-500 font-sans font-bold ms-1">{L("now", "الان")}</span>
            </span>
          </div>
          {/* session upload */}
          <div>
            <div className={cn("flex items-center gap-2", isRtl && "flex-row-reverse")}>
              <div className="w-8 h-8 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
                <ArrowUp className="w-4 h-4 text-teal-300" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-ink-400 font-bold">
                {L("Session upload", "مجموع نشست — آپلود")}
              </span>
            </div>
            <p className="mt-2 text-4xl font-extrabold font-mono gradient-text">
              <TweenNumber value={heroUp} format={fmtBytes} />
            </p>
            <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-500/10 border border-teal-500/25 text-teal-300 font-mono text-xs font-bold" dir="ltr">
              <ArrowUp className="w-3 h-3" /> {fmtSpeed(heroSpeedU)}
              <span className="text-ink-500 font-sans font-bold ms-1">{L("now", "الان")}</span>
            </span>
          </div>
          {/* throughput sparkline + core badge */}
          <div className={cn("flex lg:flex-col items-center lg:items-end justify-between gap-3", isRtl && "lg:items-start")}>
            <span className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-extrabold font-mono", badge.cls)} dir="ltr">
              <BadgeIcon className="w-3.5 h-3.5" />
              {badge.label}
            </span>
            <div className="text-center lg:text-right">
              <SpeedSpark hist={speedHist} />
              <p className="mt-1 text-[9px] uppercase tracking-wider text-ink-500 font-bold" dir="ltr">
                {L("total throughput", "کل گذر داده")} · {fmtSpeed(totalSpeed)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ============ honest granularity states ============ */}
      {!isDesktop() && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-5 text-sm text-yellow-300">
          {L("Live Connection needs the desktop app.", "لایو کانکشن به برنامه دسکتاپ نیاز دارد.")}
        </div>
      )}
      {isDesktop() && stats && stats.granularity === "none" && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
          <div className={cn("flex items-start gap-3", isRtl && "flex-row-reverse")}>
            <Unplug className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <p className="text-xs leading-5 text-amber-200/80">
              {L(
                "No active connection right now — connect through VPN Connection, Aether or Google Side and this surface goes live. The socket table below still works.",
                "در حال حاضر اتصال فعالی وجود ندارد — از طریق VPN Connection، Aether یا Google Side وصل شو تا این بخش زنده شود. جدول سوکت‌ها پایین همچنان کار می‌کند."
              )}
            </p>
          </div>
        </div>
      )}
      {isDesktop() && stats === null && (
        <p className="text-xs text-ink-500 text-center">{L("Waiting for the first consumption probe…", "در انتظار اولین نمونه‌گیری مصرف…")}</p>
      )}
      {isDesktop() && singboxMode && stats!.connections?.length === 0 && (
        <p className="text-xs text-ink-500 text-center">
          {L("No proxied connections through the core right now — consumption will build up as apps send traffic.", "در حال حاضر اتصال پروکسی‌شده‌ای از طریق هسته نیست — با ترافیک گرفتن برنامه‌ها، مصرف ساخته می‌شود.")}
        </p>
      )}

      {isDesktop() && aetherMode && Array.isArray(stats!.connections) && (
        <div className="rounded-2xl border border-teal-500/25 bg-teal-500/5 p-4">
          <p className="text-xs leading-5 text-teal-200/80 mb-3">
            {L(
              "Aether exposes no stats API — these are the live OS sockets of the aether process (byte counters are not available for this core). The socket table below still attributes per-app usage.",
              "Aether هیچ API آماری ندارد — این‌ها سوکت‌های زنده‌ی پروسه‌ی aether در سیستم‌عامل هستند (شمارنده‌ی بایت برای این هسته موجود نیست). جدول سوکت‌ها پایین همچنان مصرف هر برنامه را نشان می‌دهد."
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono" dir="ltr">
              <thead>
                <tr className="text-ink-500 text-[9px] uppercase tracking-wider border-b border-surface-700/40">
                  <th className="text-start font-bold py-1.5 pe-2">{L("destination", "مقصد")}</th>
                  <th className="text-start font-bold py-1.5 pe-2">{L("net", "شبکه")}</th>
                  <th className="text-start font-bold py-1.5 pe-2">{L("state", "وضعیت")}</th>
                  <th className="text-end font-bold py-1.5">{L("local port", "پورت محلی")}</th>
                </tr>
              </thead>
              <tbody>
                {stats!.connections!.slice(0, 24).map((r) => (
                  <tr key={r.id} className="border-b border-surface-800/40 last:border-0">
                    <td className="py-1.5 pe-2 font-bold text-ink-100 break-all">{r.label}</td>
                    <td className="py-1.5 pe-2 uppercase text-teal-300 font-bold">{r.network ?? "—"}</td>
                    <td className="py-1.5 pe-2 text-ink-400">{r.rule || "—"}</td>
                    <td className="py-1.5 text-end text-ink-300">{r.sourcePort || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============ xray / google-side: honest tunnel totals ============ */}
      {isDesktop() && xrayMode && Array.isArray(stats!.connections) && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
          <p className="text-xs leading-5 text-amber-200/80 mb-3">
            {googleSideMode
              ? L(
                  "Google Side is an in-process relay — these are its honest cumulative relay bytes.",
                  "Google Side یک رله‌ی درون‌پردازشی است — این‌ها بایت‌های تجمعی و صادقانه‌ی رله هستند."
                )
              : L(
                  "xray's stats API reports per-outbound totals only — a per-app byte split is not exposed by the core. Tunnel-level truth:",
                  "آمار xray فقط مجموع هر خروجی را می‌دهد — هسته تفکیک بایت به‌ازای هر برنامه ارائه نمی‌کند. حقیقت در سطح تونل:"
                )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono" dir="ltr">
              <thead>
                <tr className="text-ink-500 text-[9px] uppercase tracking-wider border-b border-surface-700/40">
                  <th className="text-start font-bold py-1.5 pe-2">{L("outbound", "خروجی")}</th>
                  <th className="text-start font-bold py-1.5 pe-2">{L("role", "نقش")}</th>
                  <th className="text-end font-bold py-1.5 pe-2">{L("down", "دانلود")}</th>
                  <th className="text-end font-bold py-1.5 pe-2">{L("up", "آپلود")}</th>
                  <th className="text-end font-bold py-1.5">{L("speed", "سرعت")}</th>
                </tr>
              </thead>
              <tbody>
                {stats!.connections!.slice(0, 20).map((r) => {
                  const sp = outSpeed.get(r.id) ?? { d: 0, u: 0 };
                  return (
                    <tr key={r.id} className="border-b border-surface-800/40 last:border-0">
                      <td className="py-1.5 pe-2 font-bold text-ink-100">{r.label}</td>
                      <td className="py-1.5 pe-2">
                        <span className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-bold", ROLE_COLORS[r.role ?? "other"] ?? ROLE_COLORS.other)}>
                          {r.role ?? "—"}
                        </span>
                      </td>
                      <td className="py-1.5 pe-2 text-end text-emerald-300 font-bold">{fmtBytes(r.download)}</td>
                      <td className="py-1.5 pe-2 text-end text-teal-300 font-bold">{fmtBytes(r.upload)}</td>
                      <td className="py-1.5 text-end text-ink-300">{fmtSpeed(sp.d + sp.u)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============ socket totals strip (kept) ============ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={Globe2} label={L("Established", "برقرار")} value={snap?.totals.established ?? "—"} />
        <StatTile icon={Wifi} label={L("TCP sockets", "سوکت TCP")} value={snap?.totals.tcp ?? "—"} accent="text-teal-400" />
        <StatTile icon={Server} label={L("UDP sockets", "سوکت UDP")} value={snap?.totals.udp ?? "—"} accent="text-lime-400" />
        <StatTile icon={Globe2} label={L("Apps", "برنامه‌ها")} value={snap?.totals.apps ?? "—"} />
      </div>

      {/* ============ controls ============ */}
      <div className={cn("flex items-center gap-3 flex-wrap", isRtl && "flex-row-reverse")}>
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L("Search apps, PIDs, remote IPs…", "جستجوی برنامه، PID، مقصدها…")}
            className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-surface-950/70 border border-surface-700/70 text-ink-200 outline-none focus:border-emerald-500/70"
            dir="ltr"
          />
        </div>
        <div className={cn("flex items-center rounded-xl border border-surface-700/70 overflow-hidden bg-surface-950/50", isRtl && "flex-row-reverse")}>
          {(
            [
              ["speed", L("Speed", "سرعت")],
              ["session", L("Session total", "مجموع نشست")],
              ["connections", L("Connections", "اتصال‌ها")],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setSortMode(m)}
              className={cn(
                "px-3 py-2 text-[11px] font-bold transition-all",
                sortMode === m ? "bg-emerald-500/15 text-emerald-300" : "text-ink-400 hover:text-ink-200"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setHideSystem((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border transition-all",
            hideSystem
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
              : "border-surface-700/70 text-ink-400 hover:text-ink-200"
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          {hideSystem ? L("system hidden", "سیستمی‌ها پنهان") : L("system shown", "سیستمی‌ها نمایان")}
        </button>
        <button
          onClick={() => setLive((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all",
            live
              ? "bg-gradient-to-r from-emerald-500 to-green-600 text-black/80"
              : "border border-surface-600 text-ink-300 hover:border-emerald-500/60"
          )}
        >
          {live ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {live ? L("Live — 2s", "زنده — هر ۲ ثانیه") : L("Paused", "متوقف")}
          <Hint text={t("hint.livePause", language)} size="sm" />
        </button>
      </div>

      {/* ============ per-app consumption list ============ */}
      <div className="space-y-2">
        {snap && sorted.length === 0 && (
          <div className="rounded-2xl border border-surface-700/50 bg-surface-900/40 p-8 text-center text-ink-400 text-sm">
            {L("No matching apps right now.", "در حال حاضر برنامه‌ای مطابق پیدا نشد.")}
          </div>
        )}
        {sorted.map((a) => (
          <AppRow
            key={a.key}
            a={a}
            open={expanded === a.key}
            isTop={topKey === a.key}
            totalSpeed={totalSpeed}
            isRtl={isRtl}
            L={L}
            onToggle={onToggle}
          />
        ))}
      </div>

      {snap && (
        <p className="text-[10px] text-ink-500 text-center font-mono" dir="ltr">
          snapshot @ {new Date(snap.atMs).toLocaleTimeString()} · {delta >= 0 ? "+" : ""}{delta} {L("established since last tick", "برقرار نسبت به تیک قبل")}
          {stats ? ` · stats core: ${stats.core} (${stats.granularity})` : ""}
        </p>
      )}
    </div>
  );
}
