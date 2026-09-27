import { useState, useEffect, useRef } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t, type Language } from "../i18n";
import { tauriInvoke } from "../utils/tauriBridge";
import { Eye, EyeOff, Globe } from "lucide-react";

/**
 * Phase E1 — Live Connections panel (approved design D1-D6, 2026-09-21).
 *
 * FULLY SELF-POLLING: mounted only while the VPN tab shows "connected"
 * (ConnectionTab anchor, right under TrafficChart), and it only issues its
 * get_connection_stats probe while EXPANDED — closed, it costs zero IPC.
 * Deliberately NOT wired into ConnectionManager's 3 s loop or the store:
 * the aggregate counters/speed/chart path stays byte-untouched (approval
 * D4), this component keeps its own local state and its own cadence.
 *
 * Granularity is rendered HONESTLY per core (D1):
 *   sing-box -> per-connection rows (destination / network / bytes / chain);
 *   xray     -> per-outbound rows + the explicit "no per-connection
 *               counters on this core" note;
 *   aether   -> the "this core exposes no stats API" note.
 * Rows arrive pre-normalized from the main process (connectionStats.ts);
 * the clash_api secret never crosses the bridge (D2/D3).
 */

interface ConnRow {
  id: string;
  label: string;
  network: string | null;
  download: number;
  upload: number;
  start: string | null;
  chains: string[] | null;
  rule: string | null;
  role: string | null;
}

interface ConnStatsReply {
  core: string;
  /** 3.1.8 adds "sockets" (aether: live OS sockets, no byte counters). */
  granularity: "per-connection" | "per-outbound" | "sockets" | "none";
  connections: ConnRow[] | null;
  totalLive: number;
  totalShown: number;
}

const fmtBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const ROLE_COLORS: Record<string, string> = {
  tunnel: "bg-emerald-500/15 text-emerald-300",
  socket: "bg-teal-500/15 text-teal-300",
  pool: "bg-cyan-500/15 text-cyan-300",
  chain: "bg-violet-500/15 text-violet-300",
  dialer: "bg-violet-500/15 text-violet-300",
  direct: "bg-ink-500/15 text-ink-300",
  blocked: "bg-red-500/15 text-red-300",
  other: "bg-ink-500/15 text-ink-300",
};

export default function ConnectionStatsPanel({ language }: { language: Language }) {
  const connApiPort = useStore((s) => s.connApiPort);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState<ConnStatsReply | null>(null);
  const pollInProgress = useRef(false);

  useEffect(() => {
    if (!open) return; // collapsed = zero IPC (approval D4)
    let cancelled = false;

    const poll = async () => {
      if (cancelled || pollInProgress.current) return;
      pollInProgress.current = true;
      try {
        const res = await tauriInvoke<ConnStatsReply>("get_connection_stats", {
          apiPort: connApiPort,
        });
        if (!cancelled && res) setReply(res);
      } catch {
        /* transient IPC error — next poll retries; keep last good rows */
      } finally {
        pollInProgress.current = false;
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, connApiPort]);

  const rows = reply?.connections ?? null;
  const granularity = reply?.granularity;
  const hidden =
    reply && reply.totalLive > reply.totalShown ? reply.totalLive - reply.totalShown : 0;

  return (
    <div className="rounded-2xl border border-surface-700/60 bg-surface-800/60 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-ink-200 hover:bg-surface-700/30 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-emerald-400" />
          {t("connections.title", language)}
          {reply && reply.totalLive > 0 && (
            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 tabular-nums">
              {t("connections.live", language).replace("{n}", String(reply.totalLive))}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 text-emerald-400">
          {open ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {open
            ? t("connections.hide", language)
            : t("connections.show", language)}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {granularity === "per-outbound" && (
            <p className="text-[11px] leading-5 text-amber-300/80 border-b border-surface-700/40 pb-2 mb-2">
              {t("connections.perOutboundNote", language)}
            </p>
          )}
          {granularity === "none" && (
            <p className="text-[11px] leading-5 text-ink-400 py-1">
              {t("connections.none", language)}
            </p>
          )}
          {granularity === "sockets" && (
            <p className="text-[11px] leading-5 text-teal-300/80 border-b border-surface-700/40 pb-2 mb-2">
              {t("connections.socketsNote", language)}
            </p>
          )}
          {granularity && granularity !== "none" && rows && rows.length === 0 && (
            <p className="text-[11px] leading-5 text-ink-400 py-1">
              {t("connections.empty", language)}
            </p>
          )}
          {rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-ink-400 text-[11px] border-b border-surface-700/40">
                    <th className="text-start font-semibold py-1.5 pe-2">
                      {t("connections.destination", language)}
                    </th>
                    <th className="text-start font-semibold py-1.5 pe-2">
                      {t("connections.network", language)}
                    </th>
                    <th className="text-end font-semibold py-1.5 pe-2">
                      {t("connections.down", language)}
                    </th>
                    <th className="text-end font-semibold py-1.5">
                      {t("connections.up", language)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-surface-700/20 last:border-0"
                    >
                      <td className="py-1.5 pe-2 max-w-[240px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-white truncate tabular-nums">
                            {row.label}
                          </span>
                          {row.role && (
                            <span
                              className={cn(
                                "shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-bold",
                                ROLE_COLORS[row.role] ?? ROLE_COLORS.other
                              )}
                            >
                              {row.role}
                            </span>
                          )}
                        </div>
                        {row.chains && row.chains.length > 0 && (
                          <div className="text-[10px] text-ink-400 truncate">
                            {row.chains.join(" → ")}
                            {row.rule ? ` · ${row.rule}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pe-2 text-ink-300 uppercase tabular-nums">
                        {row.network ?? "—"}
                      </td>
                      <td className="py-1.5 pe-2 text-end font-bold tabular-nums text-white">
                        {fmtBytes(row.download)}
                      </td>
                      <td className="py-1.5 text-end font-bold tabular-nums text-cyan-300">
                        {fmtBytes(row.upload)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hidden > 0 && (
                <p className="text-[11px] text-ink-400 pt-2">
                  {t("connections.more", language).replace("{n}", String(hidden))}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
