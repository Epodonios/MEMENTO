/**
 * MEMENTO — shared core types (Task 11 dual-core, Task 12 triple-core).
 *
 * Wire shapes shared by the Xray, sing-box and Aether managers.
 * ConnectionStatus gained the optional `core` field: every lifecycle response
 * now also tells the renderer WHICH core it came from ("xray" | "sing-box" |
 * "aether") — purely additive, the 11 IPC command names/args stay identical.
 */

export type CoreKind = "xray" | "sing-box" | "aether";

export interface ConnectionStatus {
  running: boolean;
  pid: number | null;
  // Key names kept identical to the Rust serde output.
  socks_port: number;
  http_port: number;
  /**
   * Which core this status belongs to ("xray" | "sing-box" | "aether").
   * get_xray_status reports the last ATTEMPTED core even once it stopped
   * (the crash-time toast labels itself from this); start/stop responses
   * keep their start-time core / null semantics.
   */
  core?: CoreKind | null;
}

export interface TrafficStats {
  uplink: number;
  downlink: number;
}

/* ------------------------------------------------------------------ */
/*  Phase E1 — live per-connection stats (additive wire shapes)        */
/* ------------------------------------------------------------------ */

/** What the ACTIVE core can honestly report for this connection. */
export type ConnectionStatsGranularity =
  | "per-connection" // sing-box: real per-connection rows (clash_api /connections)
  | "per-outbound"   // xray: per-tag rows only — no per-connection counter exists
  | "sockets"        // 3.1.8 aether: live OS sockets of the process — no byte counters
  | "none";          // idle: nothing is running

/** One normalized row. A row is built ENTIRELY main-side — the clash_api
 *  bearer secret never crosses the IPC bridge (approved decision D2/D3). */
export interface ConnectionStatsRow {
  /** sing-box: the core's own connection UUID. xray: `outbound:<tag>`. */
  id: string;
  /** sing-box: destination (host when known, else ip:port). xray: tag name. */
  label: string;
  /** "tcp" | "udp" (sing-box). null for xray per-outbound rows. */
  network: string | null;
  download: number;
  upload: number;
  /** RFC3339 session start (sing-box). null for xray rows. */
  start: string | null;
  /** sing-box outbound chain (e.g. ["proxy"]). null for xray rows. */
  chains: string[] | null;
  /** sing-box matching rule (e.g. "final"). null for xray rows. */
  rule: string | null;
  /** xray role hint ("tunnel" | "pool" | "chain" | "dialer" | "direct" |
   *  "blocked" | "other"). null for sing-box rows. */
  role: string | null;
  /** sing-box only: the LOCAL endpoint of the app that opened this
   *  connection through the proxy (clash_api metadata.sourceIP /
   *  metadata.sourcePort — the join key the renderer maps to the OS
   *  socket table's localPort to attribute bytes per app). Both are the
   *  raw strings clash_api reports; null/absent for xray per-outbound
   *  rows (no per-connection attribution exists there). */
  sourceIp?: string | null;
  sourcePort?: string | null;
}

export interface ConnectionStatsReply {
  /** The ACTIVE surface: a core ("xray" | "sing-box" | "aether") or the
   *  in-process Google Side relay ("google-side", 3.1.8). */
  core: CoreKind | "google-side";
  granularity: ConnectionStatsGranularity;
  /** null = this core cannot report (aether). Never an error — the UI
   *  renders the honest "unsupported" note instead of a crash surface. */
  connections: ConnectionStatsRow[] | null;
  /** Honest counts: live rows seen BEFORE any cap, rows actually returned. */
  totalLive: number;
  totalShown: number;
}
