/**
 * MEMENTO — Aether process manager (Task 12, SOCKS5-only phase).
 *
 * Third core, mirroring the xray.ts/singbox.ts manager discipline 1:1:
 *
 *  - pendingChild + serialized start queue (F3 parity): a spawn that has not
 *    yet passed the crash-grace check is invisible to running-status but can
 *    still be killed by a concurrent stop; two rapid starts can never
 *    interleave their stop/spawn/grace phases.
 *  - 900 ms grace period; if the process died, surface the LAST 8 lines of
 *    combined stdout+stderr as the error.
 *  - 300-line ring buffer of merged stdout/stderr + generation counter so
 *    stale readers of an older connection stop appending.
 *  - 任一时刻仅一个核心存活 is enforced one level up (cores.ts stopOtherCore
 *    is 3-way since Task 12); this manager only ever manages its own child.
 *
 * Differences from the other two managers (all facts verified against the
 * OFFICIAL v1.9.0 binaries — `aether --help` captured from the release
 * artifact, plus live runs on 2026-09-16):
 *
 *  - The core is configured 100% through AETHER_* environment variables and
 *    spawned with ZERO CLI arguments (Aethon/AetherGUI parity). With no
 *    protocol/scan/ip answer the binary asks INTERACTIVE questions — so the
 *    manager ALWAYS sets AETHER_PROTOCOL / AETHER_SCAN / AETHER_IP (plus
 *    SOCKS/LOG/QUICK_RECONNECT/CONFIG) to guarantee a headless start.
 *  - SHA-256 integrity gate BEFORE every spawn (Aethon parity): the binary
 *    hash must equal the pinned value for the running platform, otherwise
 *    the start is refused. Windows pin = the official aether.exe v1.9.0
 *    (ee400806…b36cd, bit-identical to Aethon's AETHER_SHA256); Linux pin =
 *    the official aether v1.9.0 linux binary (used by dev machines and the
 *    smoke). An unsigned/unpinned binary is never spawned.
 *  - System proxy is NEVER touched here (deliberate deviation from the
 *    xray/sing-box managers): the Aether connection is driven from the
 *    renderer-side Aether tab, which points Windows system proxy at the
 *    HTTP CONNECT listener when enabled (B5), else at the SOCKS port.
 *  - Smart Connect is a GUI-SIDE candidate loop (Aethon lib.rs parity):
 *    sequential spawn/ready/stop per candidate protocol until the first
 *    success, with "[smart] candidate=…" log-line parity. The core itself
 *    has NO smart protocol value (AETHER_PROTOCOL is masque | wg | gool
 *    only — verified from the binary's --help).
 *  - Traffic stats: the core has NO stats API — get_xray_traffic answers
 *    {0,0} for aether (honest limitation, surfaced in the UI).
 *  - Readiness is two-stage: 900 ms crash grace → wait for the stdout
 *    marker "socks5 server listening on 127.0.0.1:<port>" OR a live TCP
 *    connect to the SOCKS port (dual path, robust against log-text drift).
 *    running && !ready is reported as "connecting".
 */
import { ChildProcess, spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { app } from "electron";
import {
  AETHER_VERSION,
  MAX_LOG_LINES,
  dataDir,
  findAether,
} from "./paths";
import {
  removeActiveCoreMeta,
  writeActiveCoreMeta,
} from "./coreOps";
import type { ConnectionStatus } from "./coreTypes";
import { blockOnCoreExit } from "./killSwitch";
import aetherVersionsTable from "./aether-versions.json";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*  Public types (renderer mirror lives in src/store.ts — keep in sync) */
/* ------------------------------------------------------------------ */

/** The core's REAL protocol values (verified: no "smart" exists in-core). */
export type AetherProtocol = "masque" | "wg" | "gool";

/** "smart" is a MEMENTO-side loop mode, not an AETHER_PROTOCOL value. */
export type AetherProtocolMode = AetherProtocol | "smart";

export type AetherScanMode =
  | "turbo"
  | "balanced"
  | "thorough"
  | "stealth"
  | "ironclad";

export type AetherIpMode = "v4" | "v6" | "both";

/** 6 core values (the binary adds "light" on top of Aethon's five). */
export type AetherNoize =
  | "default"
  | "off"
  | "light"
  | "firewall"
  | "balanced"
  | "gfw"
  | "aggressive";

export type AetherLogLevel = "error" | "warn" | "info" | "debug" | "trace";

/** ECH is 3-state (approved rev-2 spec): off | auto | explicit base64 config. */
export type AetherEchMode = "off" | "auto" | "custom";

export interface AetherSettings {
  /* -------- main section (always visible) -------- */
  protocol: AetherProtocolMode; // default "gool" (live-verified fastest; Aethon GUI parity)
  scanMode: AetherScanMode; // default "balanced" (core default)
  socksPort: number; // default 1819 (core default bind port)
  /** Custom endpoint "ip:port" — forces a MASQUE/WireGuard peer, skips
   *  scanning (AETHER_PEER). Empty = auto-discovery. */
  endpoint: string;

  /* -------- advanced section (collapsed by default) -------- */
  /** "default" omits AETHER_NOIZE entirely so the core applies its own
   *  protocol-aware profile (firewall for MASQUE, balanced for WG/gool —
   *  verified in the live log). Any other value is passed verbatim. */
  noize: AetherNoize;
  ipMode: AetherIpMode; // AETHER_IP
  /** Comma-separated resolver IPs; empty = core default 1.1.1.1,1.0.0.1. */
  dns: string; // AETHER_DNS
  routeBlock: string; // AETHER_ROUTE_BLOCK (comma/newline entries)
  routeDirect: string; // AETHER_ROUTE_DIRECT
  routesFile: string; // AETHER_ROUTES_FILE
  httpProxyEnabled: boolean; // AETHER_HTTP_PROXY second listener
  httpProxyPort: number; // default 1820
  /** Chain through an existing local proxy, e.g. socks5://127.0.0.1:1080 */
  upstream: string; // AETHER_UPSTREAM
  ech: AetherEchMode; // AETHER_ECH (auto | base64)
  echBase64: string; // used when ech === "custom"
  /** TLS ClientHello fragmentation — only meaningful on MASQUE h2. */
  fragment: boolean; // AETHER_MASQUE_H2_FRAGMENT
  /** MASQUE HTTP/2 (TCP) transport instead of HTTP/3 (QUIC). */
  masqueHttp2: boolean; // AETHER_MASQUE_HTTP2
  quickReconnect: boolean; // AETHER_QUICK_RECONNECT 1/0
  logLevel: AetherLogLevel; // AETHER_LOG_LEVEL

  /* -------- protocol-contextual peer forms (approved rev-2 spec) ----- */
  /** gool warp-in-warp hops (AETHER_WIW_OUTER_PEER / AETHER_WIW_INNER_PEER). */
  wiwOuter: string;
  wiwInner: string;
  /** gool FORCE outer hop (AETHER_WG_PEER = wiw outer + FULL scan skip —
   *  deliberately a separate field: it is NOT the same knob as wiw-outer). */
  wgForceOuter: string;
  /** WireGuard persistent keepalive seconds (AETHER_WG_KEEPALIVE); empty
   *  string = omit (core default 5). */
  wgKeepalive: string;
}

export const DEFAULT_AETHER_SETTINGS: AetherSettings = {
  protocol: "gool",
  scanMode: "balanced",
  socksPort: 1819,
  endpoint: "",
  noize: "default",
  ipMode: "v4",
  dns: "",
  routeBlock: "",
  routeDirect: "",
  routesFile: "",
  httpProxyEnabled: false,
  httpProxyPort: 1820,
  upstream: "",
  ech: "off",
  echBase64: "",
  fragment: false,
  masqueHttp2: false,
  quickReconnect: true,
  logLevel: "info",
  wiwOuter: "",
  wiwInner: "",
  wgForceOuter: "",
  wgKeepalive: "",
};

/** Extra aether-only fields on top of the shared ConnectionStatus wire. */
export interface AetherStatusInfo extends ConnectionStatus {
  core: "aether";
  /** SOCKS5 listening confirmed (marker line or TCP probe). */
  ready: boolean;
  /** Smart Connect loop state (null when a single protocol was started). */
  smart: boolean;
  candidate: string | null;
  candidateIndex: number; // 1-based; 0 when not smart
  candidateTotal: number; // 0 when not smart
}

/* ------------------------------------------------------------------ */
/*  Pinned integrity (Aethon-parity gate)                              */
/* ------------------------------------------------------------------ */

/**
 * Official v1.9.0 binary hashes, both taken from the OFFICIAL release
 * assets (SHA256SUMS.txt + per-asset .sha256, live-verified 2026-09-16;
 * the Windows hash is additionally bit-identical to Aethon's own
 * AETHER_SHA256 pin). The gate refuses ANY mismatch — never spawn a
 * substituted binary.
 */
const AETHER_SHA256_PINS: Record<string, string> = {
  win32: "ee400806bf73fe16e655e6478eb7442c2c4e0576c4c8ce1913ac474e846b36cd",
  linux: "e8b2a83c4ab0ad1a75dac21f2f2b9d701998f86866fde15025ffba307b7130b9",
};

/**
 * Phase C6 (Option B — pin-per-version): the accepted-hash set EXTENDS to
 * every entry of electron/aether-versions.json for the running platform.
 * Each table row was hand-verified from the official release assets before
 * being added; an unknown hash is still refused exactly as before. The
 * 1.9.0 table entries are pinned-by-test (taskC6-quickcheck) to equal the
 * constants above, so the bundled pin stays the single offline authority.
 */
function allowedAetherTableHashes(platform: string): string[] {
  const out: string[] = [];
  for (const v of aetherVersionsTable.versions) {
    const h = (v.sha256 as Record<string, string | undefined>)[platform];
    if (typeof h === "string" && !out.includes(h)) out.push(h);
  }
  return out;
}

function sha256OfFile(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

/* ------------------------------------------------------------------ */
/*  Smart Connect matrix — LOCKED 2026-09-16 (all candidates            */
/*  live-tested with the REAL official binary; see final report)        */
/* ------------------------------------------------------------------ */

/**
 * ① USER DIRECTIVE (2026-09-16): order + per-candidate deadlines stayed
 * PROVISIONAL until every candidate was live-tested with the REAL official
 * binary, then locked in the formal smoke + final report. LOCKED evidence
 * (official v1.9.0 linux binary, fresh balanced scan, quick-reconnect=0):
 *
 *   protocol  measured time-to-listening       core's own scan budget
 *   -------   -------------------------------- ----------------------
 *   gool      4.8 s (probe + formal smoke)     80 s (early-exits)
 *   wg        12.275 s / 12.487 s (2x probe)   80 s (early-exits)
 *   masque    121.5 s TWICE (probe)            120 s (ALWAYS burned)
 *   wg + forced peer (AETHER_PEER, scan skipped): 206 ms
 *
 * All three candidates verified end-to-end (cloudflare trace warp=on
 * through the tunnel). Deadlines follow the user preference "shorter than
 * 60 s unless there is a technical reason":
 *   - gool 45 s  → ~9x the measured 4.8 s.
 *   - wg 45 s    → ~3.6x the measured ~12.4 s. wg (like gool) exits the
 *     scan as soon as enough endpoints validate, so success lands far
 *     below the core's 80 s budget on a working network; a run that has
 *     found nothing in 45 s is the degenerate case the Smart loop falls
 *     through from anyway (masque remains the deep fallback).
 *   - masque 140 s → documented technical reason to exceed 60 s: the
 *     balanced scan consumes its whole 120 s budget BEFORE selecting the
 *     fastest gateway, so any sub-budget deadline false-fails healthy
 *     masque attempts (measured 121.5 s twice).
 *   - forced endpoint 25 s → forced wg measured 206 ms; masque tunnel
 *     setup after selection measured ~1 s. Only a dead forced peer
 *     reaches the cap — a failure by the core's own verdict anyway.
 *
 * Order = Aethon parity (gool → wg → masque); also fastest-first per the
 * measurements. Direct-connect dropdown default = gool (Aethon GUI parity
 * + ~25x faster than masque measured); masque's ~2-minute fresh connect
 * keeps a fallback role: one click away in the dropdown and last in the
 * Smart loop.
 */
export const SMART_CONNECT_ORDER: readonly AetherProtocol[] = [
  "gool",
  "wg",
  "masque",
];

/** Deadline per candidate when NO endpoint is forced (scanning path). */
export const SCAN_DEADLINE_MS: Record<AetherProtocol, number> = {
  gool: 45_000, // measured 4.8 s → ~9x headroom (< 60 s per user preference)
  wg: 45_000, // measured 12.275 s / 12.487 s → ~3.6x headroom (< 60 s per user preference)
  masque: 140_000, // core's own 120 s scan budget + selection/startup buffer (measured 121.5 s twice)
};

/** Deadline when an endpoint/peer is forced (AETHER_PEER path skips scanning). */
export const FORCED_ENDPOINT_DEADLINE_MS = 25_000;

/* ------------------------------------------------------------------ */
/*  Validation (mirrored from Aethon settings.rs + binary help)         */
/* ------------------------------------------------------------------ */

const SCAN_MODES: AetherScanMode[] = [
  "turbo",
  "balanced",
  "thorough",
  "stealth",
  "ironclad",
];
const LOG_LEVELS: AetherLogLevel[] = ["error", "warn", "info", "debug", "trace"];
const NOIZE_VALUES: AetherNoize[] = [
  "default",
  "off",
  "light",
  "firewall",
  "balanced",
  "gfw",
  "aggressive",
];

/** Strict "ip:port" (Rust SocketAddr semantics: IP literal, no hostnames). */
function isIpPort(value: string): boolean {
  const v = value.trim();
  const v6 = /^\[[0-9a-fA-F:]+\]:(\d{1,5})$/.exec(v);
  if (v6) return Number(v6[1]) >= 1 && Number(v6[1]) <= 65535;
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(v);
  if (v4) {
    const ipOk = v4[1].split(".").every((o) => Number(o) >= 0 && Number(o) <= 255);
    const portOk = Number(v4[2]) >= 1 && Number(v4[2]) <= 65535;
    return ipOk && portOk;
  }
  return false;
}

function isIpLiteral(value: string): boolean {
  const v = value.trim();
  if (/^(\d{1,3})(?:\.(\d{1,3})){3}$/.test(v)) {
    return v.split(".").every((o) => Number(o) >= 0 && Number(o) <= 255);
  }
  return /^[0-9a-fA-F:]+$/.test(v) && v.includes(":");
}

/** Route rules reject empty entries and the Aethon-banned characters. */
function routeRulesValid(raw: string): boolean {
  return raw
    .split(/[\n,]+/)
    .map((r) => r.trim())
    .every((r) => r.length > 0 && !/[\0;&|]/.test(r));
}

/** Returns a list of human-readable problems; empty = valid. */
export function validateAetherSettings(s: AetherSettings): string[] {
  const errors: string[] = [];
  if (
    !Number.isInteger(s.socksPort) ||
    s.socksPort < 1 ||
    s.socksPort > 65535
  ) {
    errors.push("SOCKS port must be an integer between 1 and 65535.");
  }
  if (s.httpProxyEnabled) {
    if (
      !Number.isInteger(s.httpProxyPort) ||
      s.httpProxyPort < 1 ||
      s.httpProxyPort > 65535
    ) {
      errors.push("HTTP proxy port must be an integer between 1 and 65535.");
    } else if (s.httpProxyPort === s.socksPort) {
      errors.push("HTTP proxy port must differ from the SOCKS port.");
    }
  }
  if (s.endpoint.trim() && !isIpPort(s.endpoint)) {
    errors.push('Custom endpoint must be an "IP:port" pair, e.g. 162.159.192.1:2408.');
  }
  if (s.wiwOuter.trim() && !isIpPort(s.wiwOuter)) {
    errors.push('WIW outer must be an "IP:port" pair.');
  }
  if (s.wiwInner.trim() && !isIpPort(s.wiwInner)) {
    errors.push('WIW inner must be an "IP:port" pair.');
  }
  if (
    s.wiwOuter.trim() &&
    s.wiwInner.trim() &&
    s.wiwOuter.trim() === s.wiwInner.trim()
  ) {
    errors.push("WIW outer and inner hops must be different addresses.");
  }
  if (s.wgForceOuter.trim() && !isIpPort(s.wgForceOuter)) {
    errors.push('WIW force-outer must be an "IP:port" pair.');
  }
  if (s.wgKeepalive.trim()) {
    const n = Number(s.wgKeepalive);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      errors.push("WireGuard keepalive must be an integer between 1 and 65535 seconds.");
    }
  }
  if (s.dns.trim()) {
    const bad = s.dns
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d.length > 0 && !isIpLiteral(d));
    if (bad.length > 0) {
      errors.push("DNS resolvers must be comma-separated IP addresses.");
    }
  }
  if (s.routeBlock.trim() && !routeRulesValid(s.routeBlock)) {
    errors.push("Blocked routing rules must be non-empty and free of ; & | characters.");
  }
  if (s.routeDirect.trim() && !routeRulesValid(s.routeDirect)) {
    errors.push("Direct routing rules must be non-empty and free of ; & | characters.");
  }
  if (s.routesFile.trim()) {
    if (/[\0]/.test(s.routesFile) || !path.basename(s.routesFile.trim())) {
      errors.push("Invalid routing rules file path.");
    }
  }
  if (s.upstream.trim()) {
    if (!/^socks5:\/\/\S+$/i.test(s.upstream.trim()) && !/^http:\/\/\S+$/i.test(s.upstream.trim())) {
      errors.push("Upstream must be socks5://host:port or http://host[:port] (optionally user:pass@).");
    }
  }
  if (!SCAN_MODES.includes(s.scanMode)) errors.push("Invalid scan mode.");
  if (!LOG_LEVELS.includes(s.logLevel)) errors.push("Invalid log level.");
  if (!NOIZE_VALUES.includes(s.noize)) errors.push("Invalid noize profile.");
  if (!["v4", "v6", "both"].includes(s.ipMode)) errors.push("Invalid IP mode.");
  if (!["off", "auto", "custom"].includes(s.ech)) errors.push("Invalid ECH mode.");
  if (s.ech === "custom" && !s.echBase64.trim()) {
    errors.push("ECH is set to a custom config but the base64 config is empty.");
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/*  Env contract (verified against `aether --help`, official v1.9.0)    */
/* ------------------------------------------------------------------ */

function redactUpstream(url: string): string {
  return url.replace(/\/\/[^@/\s]*@/, "//***@");
}

/**
 * Builds the AETHER_* environment for ONE protocol attempt. Shared knobs go
 * in always; protocol-contextual peer/transport knobs only apply to their
 * own protocol. The output is merged over process.env at spawn time.
 */
export function buildAetherEnv(
  s: AetherSettings,
  protocol: AetherProtocol,
  identityConfigPath: string
): Record<string, string> {
  const env: Record<string, string> = {
    // The three answers the binary would otherwise ASK for interactively —
    // always present, guaranteeing a headless start.
    AETHER_PROTOCOL: protocol,
    AETHER_SCAN: s.scanMode,
    AETHER_IP: s.ipMode,
    // Listener + behavior basics.
    AETHER_SOCKS: `127.0.0.1:${s.socksPort}`,
    AETHER_LOG_LEVEL: s.logLevel,
    AETHER_QUICK_RECONNECT: s.quickReconnect ? "1" : "0",
    // Identity lives in OUR data dir (the core defaults to ./aether.toml in
    // its CWD, which is wrong for a packaged app).
    AETHER_CONFIG: identityConfigPath,
  };

  // Noize: "default" deliberately OMITS the variable so the core applies
  // its own protocol-aware profile (verified in the live log).
  if (s.noize !== "default") env.AETHER_NOIZE = s.noize;

  // Second listener for the Windows system proxy (B5).
  if (s.httpProxyEnabled) {
    env.AETHER_HTTP_PROXY = `127.0.0.1:${s.httpProxyPort}`;
  }

  // Chain through an already-running local proxy.
  if (s.upstream.trim()) env.AETHER_UPSTREAM = s.upstream.trim();

  // Tunnel-internal resolvers (core default 1.1.1.1,1.0.0.1).
  if (s.dns.trim()) env.AETHER_DNS = s.dns.trim();

  // Routing lists (comma-joined; entries were validated already).
  if (s.routeBlock.trim()) {
    env.AETHER_ROUTE_BLOCK = s.routeBlock
      .split(/[\n,]+/)
      .map((r) => r.trim())
      .filter(Boolean)
      .join(",");
  }
  if (s.routeDirect.trim()) {
    env.AETHER_ROUTE_DIRECT = s.routeDirect
      .split(/[\n,]+/)
      .map((r) => r.trim())
      .filter(Boolean)
      .join(",");
  }
  if (s.routesFile.trim()) env.AETHER_ROUTES_FILE = s.routesFile.trim();

  // Protocol-contextual knobs.
  if (protocol === "masque") {
    if (s.endpoint.trim()) env.AETHER_PEER = s.endpoint.trim();
    if (s.masqueHttp2) env.AETHER_MASQUE_HTTP2 = "1";
    if (s.ech === "auto") env.AETHER_ECH = "auto";
    if (s.ech === "custom" && s.echBase64.trim()) {
      env.AETHER_ECH = s.echBase64.trim();
    }
    // Fragmentation only exists on the h2 transport (help: "--fragment …
    // on the HTTP/2 transport") — gate it accordingly.
    if (s.fragment && s.masqueHttp2) env.AETHER_MASQUE_H2_FRAGMENT = "1";
  }
  if (protocol === "wg") {
    if (s.endpoint.trim()) env.AETHER_PEER = s.endpoint.trim();
    if (s.wgKeepalive.trim()) env.AETHER_WG_KEEPALIVE = s.wgKeepalive.trim();
  }
  if (protocol === "gool") {
    if (s.wiwOuter.trim()) env.AETHER_WIW_OUTER_PEER = s.wiwOuter.trim();
    if (s.wiwInner.trim()) env.AETHER_WIW_INNER_PEER = s.wiwInner.trim();
    // FORCE outer = full scan skip (deliberately NOT wiw-outer's knob).
    if (s.wgForceOuter.trim()) env.AETHER_WG_PEER = s.wgForceOuter.trim();
    if (s.wgKeepalive.trim()) env.AETHER_WG_KEEPALIVE = s.wgKeepalive.trim();
  }

  return env;
}

/* ------------------------------------------------------------------ */
/*  Manager                                                             */
/* ------------------------------------------------------------------ */

class AetherManager {
  private child: ChildProcess | null = null;
  /** Spawned but not yet past the crash-grace period (F3 parity). */
  private pendingChild: ChildProcess | null = null;
  private identityPath: string | null = null;
  private logs: string[] = [];
  private generation = 0;
  private startQueue: Promise<unknown> = Promise.resolve();
  /** Cancellation token for the CURRENT start attempt (smart loop included).
   *  stopInternal() nulls it; the loop and every pending spawn check it. */
  private currentStartToken: object | null = null;

  // Reported while running (readiness/status wire).
  private ready = false;
  private activeSocksPort = 0;
  private activeHttpPort = 0;
  private activeProtocol: AetherProtocol | null = null;

  // Smart-loop progress (read by getStatus).
  private smartActive = false;
  private smartCandidate: string | null = null;
  private smartIndex = 0;
  private smartTotal = 0;

  /** Stdout marker cache: set by the drain when the listening line appears. */
  private listeningMarker = false;

  /* -------------------------------------------------------------- */
  /*  start (single protocol OR smart loop)                          */
  /* -------------------------------------------------------------- */

  startAether(settings: AetherSettings): Promise<AetherStatusInfo> {
    // F3 parity: strictly one start at a time; the first call's error still
    // propagates to ITS caller.
    const run = this.startQueue.then(
      () => this.startInner(settings),
      () => this.startInner(settings)
    );
    this.startQueue = run.catch(() => {});
    return run;
  }

  private async startInner(settings: AetherSettings): Promise<AetherStatusInfo> {
    this.stopInternal();
    // Own the attempt slot AFTER the clearing stop — a concurrent stopAether()
    // nulls the token and every stage below aborts on isCancelled().
    const myToken: object = {};
    this.currentStartToken = myToken;
    const isCancelled = (): boolean => this.currentStartToken !== myToken;

    const problems = validateAetherSettings(settings);
    if (problems.length > 0) {
      throw new Error(`Invalid Aether settings:\n${problems.join("\n")}`);
    }

    const binPath = findAether();
    if (!binPath) {
      throw new Error(
        `Aether core v${AETHER_VERSION} was not found.\n` +
          `Place the official binary in resources/aether/ — see resources/aether/README.md ` +
          `for the exact pinned download URL and SHA-256. Xray and sing-box flows are unaffected.`
      );
    }

    // Integrity gate (Aethon parity): refuse ANY binary that is not the
    // pinned official release for this platform. Phase C6: the pin table
    // (aether-versions.json) extends the accepted set — every hash in it
    // was verified by hand before shipping; an unknown hash is refused
    // exactly as before.
    const pin = AETHER_SHA256_PINS[process.platform];
    const tablePins = allowedAetherTableHashes(process.platform);
    if (!pin && tablePins.length === 0) {
      throw new Error(
        `No pinned Aether SHA-256 exists for platform "${process.platform}" — ` +
          `refusing to start an unverified binary.`
      );
    }
    let actualHash = "";
    try {
      actualHash = sha256OfFile(binPath);
    } catch (e: any) {
      throw new Error(`Cannot hash the Aether binary for verification: ${e?.message || e}`);
    }
    if (actualHash !== pin && !tablePins.includes(actualHash)) {
      throw new Error(
        `Aether binary integrity check FAILED (sha256 mismatch).\n` +
          `expected ${pin}\nfound    ${actualHash}\n` +
          `Refusing to start. Replace resources/aether/${AETHER_BIN_NAME_LABEL} with the ` +
          `official v${AETHER_VERSION} release — see resources/aether/README.md.`
      );
    }

    // Busy-port probe (same UX as the other managers).
    const busyPort = await firstBusyPortAsync(
      settings.httpProxyEnabled ? [settings.socksPort, settings.httpProxyPort] : [settings.socksPort]
    );
    if (busyPort !== null) {
      throw new Error(
        `Port ${busyPort} is already in use by another program.\n` +
          `Close whatever is using it (another VPN/proxy app, or a leftover aether process in Task Manager) and try again, ` +
          `or change the Aether listener port.`
      );
    }

    // Identity config inside OUR data dir (the core writes/provisions it).
    const dir = path.join(dataDir(), "aether");
    fs.mkdirSync(dir, { recursive: true });
    const identityPath = path.join(dir, "identity.toml");
    this.identityPath = identityPath;

    // Book the reported ports up front.
    this.activeSocksPort = settings.socksPort;
    this.activeHttpPort = settings.httpProxyEnabled ? settings.httpProxyPort : 0;

    const smart = settings.protocol === "smart";
    const candidates: AetherProtocol[] = smart
      ? [...SMART_CONNECT_ORDER]
      : [settings.protocol as AetherProtocol];
    const startedAt = Date.now();

    if (smart) {
      this.smartActive = true;
      this.smartTotal = candidates.length;
      const deadlines = candidates
        .map((p) => `${p}:${Math.round(SCAN_DEADLINE_MS[p] / 1000)}s`)
        .join(" → ");
      this.logs.push(
        `[MEMENTO] Aether Smart Connect: trying ${candidates.join(" → ")} (per-candidate deadline ${deadlines})`
      );
      this.trimLogs();
    } else {
      this.smartActive = false;
      this.smartTotal = 0;
    }

    const failures: string[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const protocol = candidates[i];
      this.smartCandidate = protocol;
      this.smartIndex = i + 1;

      // A stop that landed between candidates must abort the loop.
      if (isCancelled()) {
        throw new Error("Connection attempt was cancelled.");
      }

      const forced = isEndpointForced(settings, protocol);
      const deadlineMs = forced
        ? FORCED_ENDPOINT_DEADLINE_MS
        : SCAN_DEADLINE_MS[protocol];
      const attemptStarted = Date.now();

      try {
        const pid = await this.spawnCandidate(
          settings,
          protocol,
          identityPath,
          binPath,
          deadlineMs,
          isCancelled
        );
        if (isCancelled()) {
          // Cancelled between readiness and commit — shut the winner down.
          try {
            this.stopInternal();
          } catch {
            /* best-effort */
          }
          throw new Error("Connection attempt was cancelled.");
        }

        // Commit the winner. Deliberately NO generation bump here: the
        // winning child's drain closures keep their myGeneration and the
        // live log stream keeps flowing (a bump would silence it).
        if (this.pendingChild) {
          this.child = this.pendingChild;
          this.pendingChild = null;
        }
        this.ready = true;
        this.activeProtocol = protocol;
        this.listeningMarker = true;

        const scoreMs = Date.now() - attemptStarted;
        if (smart) {
          this.logs.push(
            `[smart] candidate=${protocol} result=accepted score_ms=${scoreMs} selected=true`
          );
        }
        this.logs.push(
          `[MEMENTO] Aether v${AETHER_VERSION} connected via ${protocol} (pid ${pid}, socks 127.0.0.1:${this.activeSocksPort}${
            this.activeHttpPort ? `, http 127.0.0.1:${this.activeHttpPort}` : ""
          }, ${((Date.now() - startedAt) / 1000).toFixed(1)}s total)`
        );
        this.trimLogs();

        const child = this.child!;
        child.on("exit", (code, signal) => {
          if (this.child !== child) return;
          this.logs.push(
            `[MEMENTO] Aether process exited (code: ${
              code !== null ? code : JSON.stringify(signal)
            }). If this keeps happening, check that your antivirus / Windows Defender is not blocking or quarantining aether.`
          );
          this.trimLogs();
          this.child = null;
          // the kill-switch CONTRACT is main-wide: armed -> normalize the
          // dead tunnel proxy to BLOCKED (renderer-owned proxy preserved);
          // quit-latch aware; best-effort.
          blockOnCoreExit();
          this.ready = false;
        });

        writeActiveCoreMeta("aether", AETHER_VERSION, {
          socksPort: this.activeSocksPort,
          httpPort: this.activeHttpPort,
        });

        this.smartActive = false;
        this.smartCandidate = null;
        this.smartIndex = 0;
        this.smartTotal = 0;

        return {
          running: true,
          pid: child.pid ?? null,
          socks_port: this.activeSocksPort,
          http_port: this.activeHttpPort,
          core: "aether",
          ready: true,
          smart,
          candidate: null,
          candidateIndex: 0,
          candidateTotal: 0,
        };
      } catch (err: any) {
        if (isCancelled()) {
          throw new Error("Connection attempt was cancelled.");
        }
        const reason = String(err?.message || err || "unknown error");
        const scoreMs = Date.now() - attemptStarted;
        if (smart) {
          this.logs.push(
            `[smart] candidate=${protocol} result=rejected score_ms=${scoreMs} reason=${reason.split("\n")[0]}`
          );
          this.trimLogs();
        }
        failures.push(`${protocol}: ${reason.split("\n").slice(-3).join(" / ")}`);
        // Make sure no half-started child leaks into the next candidate.
        this.stopChildOnly();
      }
    }

    // All candidates failed.
    const joined = failures.join("; ");
    this.stopInternal();
    throw new Error(
      smart
        ? `Smart Connect could not establish a protocol: ${joined}`
        : `Aether failed to start: ${joined}`
    );
  }

  /**
   * ONE spawn/readiness attempt for a single protocol. Resolves with the
   * pid once the SOCKS5 listener is confirmed; rejects on crash, deadline
   * or cancellation. F3: the child parks in pendingChild until success.
   */
  private async spawnCandidate(
    settings: AetherSettings,
    protocol: AetherProtocol,
    identityPath: string,
    binPath: string,
    deadlineMs: number,
    isCancelled: () => boolean
  ): Promise<number> {
    const env = buildAetherEnv(settings, protocol, identityPath);
    const myGeneration = ++this.generation;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    let child: ChildProcess;
    try {
      // Aethon parity: the core is spawned with ZERO CLI arguments; the
      // entire configuration travels through AETHER_* env vars.
      child = spawn(binPath, [], {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e: any) {
      throw new Error(`Cannot start aether: ${e?.message || e}`);
    }

    // Async spawn failures must never become uncaught exceptions.
    let spawnError: Error | null = null;
    child.on("error", (err: Error) => {
      spawnError = err;
    });

    this.listeningMarker = false;
    const markerRe = new RegExp(
      `socks5 server listening on 127\\.0\\.0\\.1:${settings.socksPort}\\b`
    );

    const drain = (stream: NodeJS.ReadableStream | null, bucket: string[]): void => {
      if (!stream) return;
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        pending += chunk;
        const parts = pending.split(/\r?\n/);
        pending = parts.pop() ?? "";
        for (const line of parts) {
          if (markerRe.test(line)) this.listeningMarker = true;
          this.appendLine(line, bucket, myGeneration);
        }
      });
      stream.on("end", () => {
        if (pending.trim()) this.appendLine(pending, bucket, myGeneration);
      });
    };
    drain(child.stdout, stdoutLines);
    drain(child.stderr, stderrLines);

    // F3 parity: park in the PENDING slot until readiness confirms.
    this.pendingChild = child;
    this.ready = false;

    // Stage 1: crash grace (900 ms) — catches instant-death misconfigurations.
    await sleep(900);
    const graceErr = spawnError as Error | null;
    if (this.pendingChild === child && !graceErr) {
      if (child.exitCode !== null || child.signalCode !== null) {
        this.pendingChild = null;
        throw new Error(
          `aether exited immediately (exit code: ${
            child.exitCode !== null ? child.exitCode : JSON.stringify(child.signalCode)
          }).${combineTail(stdoutLines, stderrLines)}`
        );
      }
    }
    if (graceErr) {
      this.pendingChild = null;
      throw new Error(`Cannot start aether: ${graceErr.message || graceErr}`);
    }

    // Stage 2: readiness wait — stdout marker OR live TCP probe, deadline-bounded.
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      if (isCancelled()) {
        throw new Error("cancelled while connecting");
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        this.pendingChild = null;
        throw new Error(
          `aether exited while connecting (exit code: ${
            child.exitCode !== null ? child.exitCode : JSON.stringify(child.signalCode)
          }).${combineTail(stdoutLines, stderrLines)}`
        );
      }
      if (this.listeningMarker || (await probeSocksPort(settings.socksPort))) {
        this.pendingChild = child;
        return child.pid ?? 0;
      }
      await sleep(200);
    }

    // Deadline hit — kill the attempt and report the tail.
    this.pendingChild = null;
    try {
      child.kill();
    } catch {
      /* best-effort */
    }
    throw new Error(
      `no SOCKS5 listener on 127.0.0.1:${settings.socksPort} within ${Math.round(
        deadlineMs / 1000
      )}s${combineTail(stdoutLines, stderrLines)}`
    );
  }

  private appendLine(line: string, bucket: string[], myGeneration: number): void {
    if (!line.trim()) return;
    bucket.push(line);
    if (myGeneration === this.generation) {
      this.logs.push(line);
      this.trimLogs();
    }
  }

  private trimLogs(): void {
    while (this.logs.length > MAX_LOG_LINES) this.logs.shift();
  }

  /* -------------------------------------------------------------- */
  /*  stop                                                           */
  /* -------------------------------------------------------------- */

  /** Kills the live + pending children WITHOUT clearing the ring/logs. */
  private stopChildOnly(): void {
    for (const c of [this.child, this.pendingChild]) {
      if (c && c.exitCode === null && c.signalCode === null) {
        try {
          c.kill();
        } catch {
          /* best-effort */
        }
      }
    }
    this.child = null;
    this.pendingChild = null;
    this.ready = false;
  }

  private stopInternal(): void {
    this.generation++;
    this.currentStartToken = null;
    this.stopChildOnly();
    this.smartActive = false;
    this.smartCandidate = null;
    this.smartIndex = 0;
    this.smartTotal = 0;
    this.activeProtocol = null;
    this.listeningMarker = false;
    removeActiveCoreMeta();
  }

  stopAether(): AetherStatusInfo {
    this.stopInternal();
    // NOTE: system proxy is intentionally NOT cleared here — the aether
    // manager never touches the registry; the renderer owns that toggle.
    return {
      running: false,
      pid: null,
      socks_port: 0,
      http_port: 0,
      core: "aether",
      ready: false,
      smart: false,
      candidate: null,
      candidateIndex: 0,
      candidateTotal: 0,
    };
  }

  cleanupOnExit(): void {
    this.stopInternal();
  }

  /* -------------------------------------------------------------- */
  /*  status / logs / liveness                                       */
  /* -------------------------------------------------------------- */

  getStatus(): AetherStatusInfo {
    const live = (c: ChildProcess | null) =>
      !!c && c.exitCode === null && c.signalCode === null;
    const committed = live(this.child);
    const pending = live(this.pendingChild);
    const running = committed || pending;
    return {
      running,
      pid: running ? (this.child ?? this.pendingChild)!.pid ?? null : null,
      socks_port: running ? this.activeSocksPort : 0,
      http_port: running ? this.activeHttpPort : 0,
      core: "aether",
      ready: committed && this.ready,
      smart: this.smartActive,
      candidate: this.smartActive ? this.smartCandidate : null,
      candidateIndex: this.smartActive ? this.smartIndex : 0,
      candidateTotal: this.smartActive ? this.smartTotal : 0,
    };
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  /** True while THIS manager owns a live (or grace-pending) child. */
  hasLiveChild(): boolean {
    const live = (c: ChildProcess | null) =>
      !!c && c.exitCode === null && c.signalCode === null;
    return live(this.child) || live(this.pendingChild);
  }

  /** Which protocol the current/last successful connection used. */
  getActiveProtocol(): AetherProtocol | null {
    return this.activeProtocol;
  }
}

const AETHER_BIN_NAME_LABEL = process.platform === "win32" ? "aether.exe" : "aether";

function combineTail(stdoutLines: string[], stderrLines: string[]): string {
  const combined = [stdoutLines.join("\n").trim(), stderrLines.join("\n").trim()]
    .filter((s) => s.length > 0)
    .join("\n");
  if (!combined) return "";
  const tail = combined.split(/\r?\n/).slice(-8).join("\n");
  return `\nLast core output:\n${tail}`;
}

/** Dual-path readiness: a live TCP connect to the SOCKS port. */
function probeSocksPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 400).unref();
  });
}

/** Same bind probe as the other managers (keeps the failure message shape). */
async function firstBusyPortAsync(ports: number[]): Promise<number | null> {
  for (const port of ports) {
    if (!port) continue;
    const free = await canBindAsync(port);
    if (!free) return port;
  }
  return null;
}

function canBindAsync(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    server.once("error", () => done(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => done(true));
    setTimeout(() => done(false), 500).unref();
  });
}

/** True when the given protocol would skip scanning (endpoint forced). */
function isEndpointForced(s: AetherSettings, protocol: AetherProtocol): boolean {
  if (protocol === "gool") {
    return !!(s.wgForceOuter.trim() || (s.wiwOuter.trim() && s.wiwInner.trim()));
  }
  return !!s.endpoint.trim(); // masque / wg share the AETHER_PEER force path
}

export const aetherManager = new AetherManager();

// Ensure the app data dir exists early (mirrors the other managers).
app.on("ready", () => {
  try {
    fs.mkdirSync(path.join(dataDir(), "aether"), { recursive: true });
  } catch {
    /* ignore */
  }
});
