import { useSyncExternalStore } from "react";
import {
  getTrafficHistory, subscribeTrafficHistory, TRAFFIC_HISTORY_MAX,
} from "../utils/trafficHistory";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { Activity } from "lucide-react";

/**
 * TrafficChart (Phase C1, item 5 — live traffic visualization).
 *
 * Renders ONLY the D1-computed bytes/sec deltas (ConnectionManager) as a
 * rolling area chart. Performance contract (user-mandated for C1):
 *  - Data lives in the standalone trafficHistory slice, NOT in zustand —
 *    a new sample re-renders THIS component alone (useSyncExternalStore);
 *    nothing else in the tree (not App, not the config lists) is touched.
 *  - The chart is mounted only while the Connection tab is open AND the
 *    status is "connected" (the caller wraps it), so polls that land while
 *    the user is elsewhere cost a ring push and nothing more.
 *  - Pure SVG (no chart library, no canvas); one polyline+area per series;
 *    bounded window (TRAFFIC_HISTORY_MAX samples ≈ 6 minutes at 3 s).
 *
 * Language note: labels come from i18n; numbers are LTR digits inside a
 * tabular-nums block so RTL layouts keep readable numerals.
 */

const DOWN_COLOR = "#22d3ee"; // cyan-400 — matches the D1 speed pill
const UP_COLOR = "#facc15";   // yellow-400 — matches the D1 speed pill

const W = 600;
const H = 100;
const PAD_TOP = 6;

function fmtSpeed(bps: number): string {
  if (bps <= 0) return "0 B/s";
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

/** Round the Y max up to a human 1/2/5×10^k step so gridlines look sane. */
function niceMax(v: number): number {
  if (v <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    if (v <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/** Build an SVG points string for the samples against a fixed Y max. */
function seriesPoints(samples: { down: number; up: number }[], key: "down" | "up", yMax: number): string {
  const n = samples.length;
  if (n === 0) return "";
  // Samples are drawn RIGHT-aligned (newest at the right edge); the window
  // fills left-to-right during the first minutes of a session.
  const step = W / (TRAFFIC_HISTORY_MAX - 1);
  const x0 = W - (n - 1) * step;
  return samples
    .map((s, i) => {
      const x = x0 + i * step;
      const y = H - PAD_TOP - (s[key] / yMax) * (H - PAD_TOP);
      return `${x.toFixed(1)},${Math.max(1, y).toFixed(1)}`;
    })
    .join(" ");
}

export default function TrafficChart({ language }: { language: import("../i18n").Language }) {
  // The ONLY reactive wiring: the standalone history slice. No zustand
  // hook, no whole-store subscription — the App.tsx:61-64 perf rule stays
  // intact.
  const samples = useSyncExternalStore(subscribeTrafficHistory, getTrafficHistory);

  const peak = samples.reduce((m, s) => Math.max(m, s.down, s.up), 0);
  const yMax = niceMax(peak * 1.15);
  const downPts = seriesPoints(samples, "down", yMax);
  const upPts = seriesPoints(samples, "up", yMax);
  const last = samples[samples.length - 1];

  // Area fill = the line polygon closed to the baseline.
  const area = (pts: string) => (pts ? `0,${H - PAD_TOP} ${pts} ${W},${H - PAD_TOP}` : "");

  return (
    <div className="rounded-2xl border border-surface-700/50 bg-surface-900/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-bold text-surface-300 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          {t("connection.trafficTitle", language)}
        </p>
        <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums" dir="ltr">
          <span className="flex items-center gap-1 text-cyan-300">
            <span className="w-2 h-2 rounded-sm" style={{ background: DOWN_COLOR }} />
            {last ? fmtSpeed(last.down) : "—"}
          </span>
          <span className="flex items-center gap-1 text-yellow-300">
            <span className="w-2 h-2 rounded-sm" style={{ background: UP_COLOR }} />
            {last ? fmtSpeed(last.up) : "—"}
          </span>
        </div>
      </div>
      <div className={cn("relative w-full h-24 rounded-xl overflow-hidden bg-surface-950/60")} dir="ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full block"
          aria-label={t("connection.trafficTitle", language)}
        >
          {/* Y gridline at 50% — subtle, no numbers (peak label carries scale) */}
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#334155" strokeWidth="1" strokeDasharray="4 6" opacity="0.5" />
          <polygon points={area(downPts)} fill={DOWN_COLOR} opacity="0.14" />
          <polyline points={downPts} fill="none" stroke={DOWN_COLOR} strokeWidth="1.6" opacity="0.9" />
          <polygon points={area(upPts)} fill={UP_COLOR} opacity="0.10" />
          <polyline points={upPts} fill="none" stroke={UP_COLOR} strokeWidth="1.4" opacity="0.85" />
        </svg>
        {!samples.length && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-surface-500">
            {t("connection.trafficWaiting", language)}
          </div>
        )}
      </div>
      <p className="text-[10px] text-surface-500 mt-1 font-mono tabular-nums" dir="ltr">
        peak ↓ {fmtSpeed(peak)} · max {fmtSpeed(yMax)}
      </p>
    </div>
  );
}
