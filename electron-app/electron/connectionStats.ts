/**
 * MEMENTO — Phase E1: live per-connection stats (main-side module).
 *
 * ONE module owns the whole per-connection surface, exactly like the
 * approved design (decisions D1-D6, 2026-09-21):
 *
 *   - sing-box 1.14.0  -> granularity "per-connection": the clash_api
 *     GET /connections response ALREADY carries a live per-connection
 *     array (live-probed today: id/upload/download/start/chains/rule/
 *     metadata{destinationIP,destinationPort,host,network,...}) — the
 *     aggregate getTraffic() only ever read its totals. This module maps
 *     the SAME endpoint's rows, using the per-build Bearer secret handed
 *     in by ipc.ts. The secret NEVER crosses the IPC bridge (D2): the
 *     renderer receives normalized rows only.
 *   - xray 25.1.1      -> granularity "per-outbound": live-probed today,
 *     `xray api statsquery` exposes ONLY inbound/outbound per-tag traffic
 *     counters — there is NO per-connection counter anywhere on the
 *     Stats API surface. We say so: rows are per-outbound, labeled with
 *     the tag + an honest role hint, never dressed up as connections.
 *   - aether           -> granularity "none": no stats API at all (the
 *     same honest limitation get_xray_traffic already answers zeros for).
 *
 * Shared contracts with the existing traffic path: the hard 1200 ms
 * deadline (getTraffic parity), fail -> honest empty (never a throw into
 * the renderer), loopback-only endpoints, and zero persistence.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { findXray } from "./paths";
import type {
  ConnectionStatsReply,
  ConnectionStatsRow,
  ConnectionStatsGranularity,
  CoreKind,
} from "./coreTypes";

export type {
  ConnectionStatsReply,
  ConnectionStatsRow,
  ConnectionStatsGranularity,
};

/** Display cap (approved D4): sort by download desc, keep the first N,
 *  report the honest pre-cap count alongside. */
const MAX_ROWS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*  entry — routed by ipc.ts with the SAME active-core semantics as    */
/*  get_xray_traffic (aether guard included)                           */
/* ------------------------------------------------------------------ */

export async function getConnectionStats(
  core: "xray" | "sing-box",
  apiPort: number,
  clashSecret: string | null
): Promise<ConnectionStatsReply> {
  if (core === "sing-box") {
    return getSingBoxConnectionStats(apiPort, clashSecret);
  }
  return getXrayOutboundStats(apiPort);
}

/* ------------------------------------------------------------------ */
/*  sing-box — clash_api GET /connections, per-connection rows         */
/* ------------------------------------------------------------------ */

const emptyReply = (core: CoreKind, granularity: ConnectionStatsGranularity): ConnectionStatsReply => ({
  core,
  granularity,
  connections: granularity === "none" ? null : [],
  totalLive: 0,
  totalShown: 0,
});

async function getSingBoxConnectionStats(
  apiPort: number,
  clashSecret: string | null
): Promise<ConnectionStatsReply> {
  // No live session captured a secret -> honest empty (getTraffic parity:
  // it answers {0,0} under the exact same condition).
  if (!clashSecret) return emptyReply("sing-box", "per-connection");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`http://127.0.0.1:${apiPort}/connections`, {
      headers: { Authorization: `Bearer ${clashSecret}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return emptyReply("sing-box", "per-connection");
    const data: any = await res.json();
    const items = Array.isArray(data?.connections) ? data.connections : [];
    const rows: ConnectionStatsRow[] = [];
    for (const item of items) {
      const meta = item?.metadata ?? {};
      const row = normalizeSingBoxRow(item, meta);
      if (row) rows.push(row);
    }
    rows.sort((a, b) => b.download - a.download || b.upload - a.upload);
    const totalLive = rows.length;
    const shown = rows.slice(0, MAX_ROWS);
    return {
      core: "sing-box",
      granularity: "per-connection",
      connections: shown,
      totalLive,
      totalShown: shown.length,
    };
  } catch {
    return emptyReply("sing-box", "per-connection");
  }
}

/** Defensive normalization: only plain-shaped fields survive, numbers are
 *  coerced through Number() with a 0 fallback (clash dashboards and the
 *  live probe agree on these field names; anything unexpected is dropped
 *  rather than invented). */
function normalizeSingBoxRow(item: any, meta: any): ConnectionStatsRow | null {
  const id = typeof item?.id === "string" ? item.id : "";
  if (!id) return null;
  const host = typeof meta?.host === "string" ? meta.host : "";
  const destIP = typeof meta?.destinationIP === "string" ? meta.destinationIP : "";
  const destPort = typeof meta?.destinationPort === "string" ? meta.destinationPort : "";
  const label =
    host ||
    (destIP ? `${destIP}${destPort ? `:${destPort}` : ""}` : "(unknown destination)");
  const network = typeof meta?.network === "string" ? meta.network : null;
  const download = Number(item?.download) || 0;
  const upload = Number(item?.upload) || 0;
  const start = typeof item?.start === "string" ? item.start : null;
  const chains = Array.isArray(item?.chains)
    ? item.chains.filter((c: unknown) => typeof c === "string").slice(0, 8)
    : null;
  const rule = typeof item?.rule === "string" ? item.rule : null;
  // H-d (per-app consumption): the LOCAL endpoint of the app behind this
  // proxied connection. clash_api reports sourceIP/sourcePort as strings
  // exactly like destinationIP/destinationPort — same defensive norm, and
  // the renderer joins sourcePort against the live_conn_snapshot's
  // socket localPort to attribute bytes per app. Absent/null on any
  // surprise shape (never invented).
  const sourceIp = typeof meta?.sourceIP === "string" ? meta.sourceIP : null;
  const sourcePort = typeof meta?.sourcePort === "string" ? meta.sourcePort : null;
  return { id, label, network, download, upload, start, chains, rule, role: null, sourceIp, sourcePort };
}

/* ------------------------------------------------------------------ */
/*  xray — statsquery per-OUTBOUND rows (honest granularity)           */
/* ------------------------------------------------------------------ */

/**
 * Same spawn pattern as queryXrayTraffic in xray.ts (windowsHide, hard
 * 1200 ms deadline, kill on overrun, fail -> honest empty). Unlike the
 * aggregate helper this does NOT sum: every `outbound>>><tag>>>traffic`
 * counter pair becomes one row, so a chain hop / balancer pool / dialer
 * shows its own byte counts instead of disappearing into a total.
 */
async function getXrayOutboundStats(apiPort: number): Promise<ConnectionStatsReply> {
  const xrayPath = findXray();
  if (!xrayPath) return emptyReply("xray", "per-outbound");

  let child: ChildProcess;
  try {
    child = spawn(xrayPath, ["api", "statsquery", "-s", `127.0.0.1:${apiPort}`], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return emptyReply("xray", "per-outbound");
  }

  let outputText = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    outputText += chunk;
  });

  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });

  const timedOut = await Promise.race([
    closed.then(() => false),
    sleep(1200).then(() => true),
  ]);

  if (timedOut) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    return emptyReply("xray", "per-outbound");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return emptyReply("xray", "per-outbound");
  }

  const statArr = Array.isArray(parsed?.stat) ? parsed.stat : [];
  // Per-tag buckets: tag -> { download, upload }.
  const byTag = new Map<string, { download: number; upload: number }>();
  for (const item of statArr) {
    const name = typeof item?.name === "string" ? item.name : "";
    // Stats API granularity is per-tag ONLY (live-proven). Only the
    // outbound counters map to rows the UI can honestly label.
    const m = /^outbound>>>([^>]+)>>>traffic>>>(uplink|downlink)$/.exec(name);
    if (!m) continue;
    let value = 0;
    if (typeof item?.value === "number") value = item.value;
    else if (typeof item?.value === "string") value = parseInt(item.value, 10) || 0;
    const tag = m[1];
    const bucket = byTag.get(tag) ?? { download: 0, upload: 0 };
    if (m[2] === "uplink") bucket.upload += value;
    else bucket.download += value;
    byTag.set(tag, bucket);
  }

  const rows: ConnectionStatsRow[] = [...byTag.entries()].map(([tag, v]) => ({
    id: `outbound:${tag}`,
    label: tag,
    network: null,
    download: v.download,
    upload: v.upload,
    start: null,
    chains: null,
    rule: null,
    role: classifyXrayTag(tag),
  }));
  rows.sort((a, b) => b.download - a.download || b.upload - a.upload);
  const totalLive = rows.length;
  const shown = rows.slice(0, MAX_ROWS);
  return {
    core: "xray",
    granularity: "per-outbound",
    connections: shown,
    totalLive,
    totalShown: shown.length,
  };
}

/** Role hint for the UI's secondary line. Names mirror the generator's
 *  fixed tags (v2rayConfig.ts): proxy = primary tunnel, proxy2..N = C4
 *  balancer pool members, the chain carrier + fragment dialer have their
 *  own fixed tags, direct/blocked are the always-present utility
 *  outbounds, anything else is "other". */
function classifyXrayTag(tag: string): string {
  if (tag === "proxy") return "tunnel";
  if (/^proxy\d+$/.test(tag)) return "pool";
  if (tag === "direct") return "direct";
  if (tag === "blocked") return "blocked";
  return "other";
}
