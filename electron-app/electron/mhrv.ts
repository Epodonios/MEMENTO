/**
 * MEMENTO — in-app MHRV engine (R3 task #7) — a native TypeScript port of
 * MasterHttpRelayVPN-RUST (mhrv-rs), rebuilt from the GitHub source for
 * zero external software: the user connects from INSIDE MEMENTO.
 *
 * FAITHFUL PORT MAP (mhrv-rs src -> this module):
 *   scan_ips.rs       -> scanGoogleIps()   — famous-domains resolve +
 *                        goog.json CIDR sampling + batched TLS probes with
 *                        the `server: gws` Google-edge validation.
 *   scan_sni.rs       -> scanSniCandidates() — probe SNI names against the
 *                        google_ip edge, detect DPI interference.
 *   proxy_server.rs   -> the local HTTP proxy (plain + CONNECT) and the
 *                        SOCKS5 listener on 8085/8086 with the same
 *                        dispatch tree:
 *                          plain HTTP + apps_script  -> relay
 *                          plain HTTP + direct       -> passthrough
 *                          CONNECT google-host       -> SNI-rewrite tunnel
 *                          CONNECT other + apps_script -> MITM + relay
 *                          CONNECT other + direct    -> raw passthrough
 *   domain_fronter.rs -> relayRequest(): POST
 *                        /macros/s/{script_id}/exec with
 *                        {k,m,u,h,b,ct,r} -> {s,h,b} (+ redirect chain),
 *                        optionally pinned to google_ip (domain fronting).
 *   mitm.rs           -> the local CA + per-host cert minting (node-forge)
 *                        and the TLSSocket MITM bridge.
 *   assets/apps_script/Code.gs -> EMBEDDED (resources/mhrv/Code.gs) — the
 *                        user copies it from inside the app, never from
 *                        GitHub. Same for the CFW variant.
 *
 * USER-VISIBLE CONTRACTS:
 *   - the CA is generated on THIS machine and never leaves it (mhrv-rs
 *     run.bat wording preserved); the install uses the per-user Root store
 *     (certutil -user -addstore Root) — a Windows confirmation dialog, NO
 *     UAC/admin.
 *   - running-lock parity: Stop before changing config; Start refuses
 *     while already running; the status surface is honest.
 *   - the auth key is stored in userData/mhrv/config.json (0600 best-
 *     effort), never logged, never included in error texts.
 */

import fs from "fs";
import path from "path";
import net from "net";
import tls from "tls";
import http from "http";
import https from "https";
import crypto from "crypto";
import { app } from "electron";
import forge from "node-forge";

/* ================================================================== */
/* Embedded data                                                       */
/* ================================================================== */

/** FAMOUS_GOOGLE_DOMAINS — ported verbatim from mhrv-rs scan_ips.rs. */
export const FAMOUS_GOOGLE_DOMAINS: string[] = [
  // Core services
  "google.com", "www.google.com", "youtube.com", "www.youtube.com",
  "gmail.com", "www.gmail.com", "drive.google.com", "docs.google.com",
  "sheets.google.com", "slides.google.com", "maps.google.com",
  "www.maps.google.com",
  // Search & Discovery
  "search.google.com", "images.google.com", "www.images.google.com",
  "news.google.com", "www.news.google.com", "scholar.google.com",
  "www.scholar.google.com", "books.google.com", "translate.google.com",
  "www.translate.google.com",
  // Communication
  "mail.google.com", "chat.google.com", "meet.google.com",
  "hangouts.google.com", "voice.google.com",
  // Media & Entertainment
  "play.google.com", "music.google.comm", "photos.google.com",
  "keep.google.com", "contacts.google.com", "tasks.google.com",
  "forms.google.com", "sites.google.com", "www.sites.google.com",
  "myaccount.google.com", "myactivity.google.com",
  "passwords.google.com", "adssettings.google.com",
  // Mobile & Apps
  "android.google.com", "chrome.google.com", "chromebook.google.com",
  // Education & Learning
  "classroom.google.com", "edu.google.com",
  // Shopping & Payments
  "shopping.google.com", "pay.google.com", "payments.google.com",
  "wallet.google.com", "store.google.com",
  // Travel & Local
  "flights.google.com", "hotels.google.com", "travel.google.com",
  // Other Services
  "blogger.google.com", "domains.google.com", "trends.google.com",
  "alerts.google.com", "podcasts.google.com", "fit.google.com",
  "home.google.com", "assistant.google.com", "gemini.google.com",
  // Support & Info
  "support.google.com", "policies.google.com", "privacy.google.com",
  "about.google.com", "blog.google.com",
  // Legacy
  "plus.google.com", "www.plus.google.com",
  // Extra high-value fronts observed in the binary
  "youtubei.googleapis.com", "ytimg.com", "i.ytimg.com",
  "googleusercontent.com", "www.googleapis.com", "gstatic.com",
  "www.gstatic.com", "ssl.gstatic.com", "fonts.googleapis.com",
  "fonts.gstatic.com", "script.google.com",
];

/** SNI_REWRITE_SUFFIXES — ported from mhrv-rs proxy_server.rs (incl. the
 *  v1.7.6 googlevideo.com revert note: served by EVA edge IPs, NOT the
 *  GFE IPs google_ip points at — rewriting it there breaks YouTube). */
const SNI_REWRITE_SUFFIXES = [
  "google.com", "gstatic.com", "googleusercontent.com", "googleapis.com",
  "ggpht.com", "youtube.com", "youtu.be", "youtube-nocookie.com",
  "ytimg.com", "gvt1.com", "gvt2.com", "doubleclick.net",
  "googlesyndication.com", "googleadservices.com",
  "google-analytics.com", "googletagmanager.com", "googletagservices.com",
];

export function matchesSniRewrite(host: string): boolean {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  return SNI_REWRITE_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
}

/** DEFAULT_SNI_POOL — the 13 well-known Google front SNIs the mhrv-rs
 *  v1.9.37 UI shows as the "SNI pool (13/13)" chip. The SNI scanner
 *  (scanSniCandidates) probes EXACTLY this pool, so "n/n" is honestly
 *  "healthy from last scan / pool size". Users manage the pool via the
 *  config (sniPool field). */
export const DEFAULT_SNI_POOL: string[] = [
  "www.google.com", "script.google.com", "www.googleapis.com", "www.gstatic.com",
  "ssl.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com",
  "translate.google.com", "maps.google.com", "play.google.com",
  "docs.google.com", "mail.google.com", "drive.google.com",
];

/** DEFAULT_FRONT_DOMAINS — the curated ~16 Google front domains from the
 *  mhrv-rs reference UI. frontDomains is the MANAGED selectable list; the
 *  ACTIVE value stays in frontDomain (a member of this list — saveConfig
 *  guarantees membership). */
export const DEFAULT_FRONT_DOMAINS: string[] = [
  "www.google.com", "www.google.ad", "www.google.ae", "www.google.com.af",
  "www.google.com.ag", "www.google.com.ai", "www.google.al", "www.google.am",
  "www.google.co.ao", "www.google.com.ar", "www.google.as", "www.google.at",
  "www.google.com.au", "www.google.az", "www.google.ba", "www.google.com.bd",
];

/** YouTube hosts that break when SNI-rewritten onto the google_ip edge
 *  (googlevideo.com is served by EVA edge IPs, NOT the GFE IPs — the
 *  v1.7.6 revert note above). When youtubeThroughRelay is on, these are
 *  relay-eligible instead of SNI-rewrite-only. */
const YOUTUBE_RELAY_SUFFIXES = ["youtube.com", "googlevideo.com", "ytimg.com"];

export function matchesYoutubeRelay(host: string): boolean {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  return YOUTUBE_RELAY_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
}

/** Static candidate IP fallback list — ported from scan_ips.rs. */
const CANDIDATE_IPS = [
  "216.239.32.120", "216.239.34.120", "216.239.36.120", "216.239.38.120",
  "216.58.212.142", "142.250.80.142", "142.250.80.138", "142.250.179.110",
  "142.250.185.110", "142.250.184.206", "142.250.190.238", "142.250.191.78",
  "172.217.1.206", "172.217.14.206", "172.217.16.142", "172.217.22.174",
  "172.217.164.110", "172.217.168.206", "172.217.169.206", "34.107.221.82",
  "142.251.32.110", "142.251.33.110", "142.251.46.206", "142.251.46.238",
  "142.250.80.170", "142.250.72.206", "142.250.64.206", "142.250.72.110",
];

/* ================================================================== */
/* Config                                                              */
/* ================================================================== */

export type MhrvMode = "apps_script" | "direct";
export type MhrvLogLevel = "error" | "warn" | "info" | "debug";

export interface MhrvConfig {
  mode: MhrvMode;
  /** Apps Script Deployment ID(s) — /macros/s/<id>/exec. Multi-ID pool:
   *  one per line, round-robin with auto-failover (relayWithFailover).
   *  [0] = the standard Code.gs deployment, [1] = the CFW variant slot. */
  scriptIds: string[];
  authKey: string;
  /** The Cloudflare Worker URL baked into the pasted Code.cfw.gs. */
  cfwWorkerUrl: string;
  googleIp: string;
  /** The ACTIVE front domain (what tlsProbe/relay actually use). */
  frontDomain: string;
  /** The MANAGED list of selectable front domains (UI chips). */
  frontDomains: string[];
  /** The managed SNI candidate pool — what the SNI scanner probes. */
  sniPool: string[];
  listenPort: number;  // HTTP proxy  (mhrv-rs default 8085)
  socksPort: number;   // SOCKS5      (mhrv-rs default 8086)
  verifySsl: boolean;
  googleIpValidation: boolean;
  maxIpsToScan: number;
  scanBatchSize: number;
  parallelConcurrency: number;
  /* --- H-c additions (mhrv-rs v1.9.37 settings parity) --- */
  /** Bind the HTTP+SOCKS listeners on 0.0.0.0 (share with the LAN) vs
   *  127.0.0.1 (this machine only). Applied on the next Start. */
  shareLan: boolean;
  /** Optional upstream SOCKS5 chain, "host:port" or "user:pass@host:port".
   *  Empty = direct. When valid, the relay's outbound TLS and the
   *  direct-mode SNI-rewrite connections dial THROUGH it. */
  upstreamSocks5: string;
  /** mhrv-rs "Parallel dispatch" — kept for config parity; in this port
   *  every request already runs in its own async task, so the value is
   *  advisory (exposed in status, not a scheduler). */
  parallelDispatch: number;
  /** Ring-buffer verbosity: entries below this level are dropped. */
  logLevel: MhrvLogLevel;
 /** Reveal the auth key in the UI input (never echoed over IPC anyway). */
  showAuthKey: boolean;
  /** Conservative X/Twitter GraphQL path normalization (apps_script mode). */
  normalizeXTwitter: boolean;
  /** Direct mode: treat *.youtube.com / *.googlevideo.com / *.ytimg.com as
   *  relay-eligible instead of SNI-rewrite-only (see handleConnect). */
  youtubeThroughRelay: boolean;
  /** QUIC blocking (UDP/443). HONESTY: the local proxy is TCP-CONNECT-only
   *  (no UDP ASSOCIATE), so no UDP ever traverses it anyway — these flags
   *  are stored + exposed in status and apply when a system-wide tunnel
   *  (VPN Device) is active. See startSocks for the enforced part. */
  blockQuic: boolean;
  /** STUN/TURN blocking (UDP 3478-3481/19302/5349) — same honesty note. */
  blockStun: boolean;
}

const DEFAULT_CONFIG: MhrvConfig = {
  mode: "apps_script",
  scriptIds: [],
  authKey: "",
  cfwWorkerUrl: "",
  googleIp: "216.239.38.120",
  frontDomain: "www.google.com",
  frontDomains: [...DEFAULT_FRONT_DOMAINS],
  sniPool: [...DEFAULT_SNI_POOL],
  listenPort: 8085,
  socksPort: 8086,
  verifySsl: true,
  googleIpValidation: true,
  maxIpsToScan: 128,
  scanBatchSize: 32,
  parallelConcurrency: 8,
  shareLan: false,
  upstreamSocks5: "",
  parallelDispatch: 0,
  logLevel: "info",
  showAuthKey: false,
  normalizeXTwitter: false,
  youtubeThroughRelay: false,
  blockQuic: true,
  blockStun: false,
};

function mhrvDir(): string {
  return path.join(app.getPath("userData"), "mhrv");
}

function configPath(): string {
  return path.join(mhrvDir(), "config.json");
}

export function loadConfig(): MhrvConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(patch: Partial<MhrvConfig>): MhrvConfig {
  const merged = { ...loadConfig(), ...patch };
  // Sanitize: ports stay 1..65535, script ids are strings, auth key trimmed.
  merged.listenPort = Math.min(65535, Math.max(1, Number(merged.listenPort) || 8085));
  merged.socksPort = Math.min(65535, Math.max(1, Number(merged.socksPort) || 8086));
  merged.scriptIds = (Array.isArray(merged.scriptIds) ? merged.scriptIds : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 16); // multi-ID round-robin pool (was 8)
  merged.authKey = String(merged.authKey || "");
  merged.googleIp = String(merged.googleIp || "").trim();
  merged.mode = merged.mode === "direct" ? "direct" : "apps_script";
  // Domain-list sanitizer: trimmed, lowercased, de-duplicated, capped.
  const cleanList = (v: unknown, cap: number): string[] => {
    const arr = Array.isArray(v) ? v : [];
    const out: string[] = [];
    for (const item of arr) {
      const s = String(item || "").trim().toLowerCase().replace(/\.+$/, "");
      if (s && !out.includes(s)) out.push(s);
      if (out.length >= cap) break;
    }
    return out;
  };
  // Front-domain manager semantics: frontDomain = ACTIVE value, which must
  // always be a member of the managed frontDomains list.
  merged.frontDomains = cleanList(merged.frontDomains, 48);
  if (!merged.frontDomains.length) merged.frontDomains = [...DEFAULT_FRONT_DOMAINS];
  merged.frontDomain =
    String(merged.frontDomain || "").trim().toLowerCase().replace(/\.+$/, "") ||
    "www.google.com";
  if (!merged.frontDomains.includes(merged.frontDomain)) {
    merged.frontDomains.push(merged.frontDomain);
  }
  // SNI pool: same discipline; falls back to the 13 well-known fronts.
  merged.sniPool = cleanList(merged.sniPool, 64);
  if (!merged.sniPool.length) merged.sniPool = [...DEFAULT_SNI_POOL];
  /* H-c additions: */
  merged.shareLan = merged.shareLan === true;
  merged.upstreamSocks5 = String(merged.upstreamSocks5 || "").trim().slice(0, 256);
  merged.parallelDispatch = Math.min(64, Math.max(0, Math.round(Number(merged.parallelDispatch) || 0)));
  merged.logLevel = ("error warn info debug".includes(String(merged.logLevel))
    ? merged.logLevel
    : "info") as MhrvLogLevel;
  merged.showAuthKey = merged.showAuthKey === true;
  merged.normalizeXTwitter = merged.normalizeXTwitter === true;
  merged.youtubeThroughRelay = merged.youtubeThroughRelay === true;
  merged.blockQuic = merged.blockQuic === true;
  merged.blockStun = merged.blockStun === true;
  try {
    fs.mkdirSync(mhrvDir(), { recursive: true });
    try { fs.chmodSync(mhrvDir(), 0o700); } catch { /* best-effort */ }
    fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
  return merged;
}

export function mhrvConfigPath(): string {
  return configPath();
}

/* ================================================================== */
/* Log ring buffer (mhrv-rs "Recent log" parity)                       */
/* ================================================================== */

const LOG_LEVEL_RANK: Record<MhrvLogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
export interface MhrvLogLine { ts: number; level: MhrvLogLevel; text: string; }
const logRing: MhrvLogLine[] = [];
const LOG_RING_MAX = 500;

/** One structured log line. Entries BELOW the configured verbosity are
 *  dropped at write time (log level semantics). Called at the important
 *  points only — lifecycle, failover, scans, CA, upstream — never per
 *  request (that would spam the ring within seconds). */
export function mlog(level: MhrvLogLevel, text: string): void {
  try {
    const cfgLevel = loadConfig().logLevel;
    if (LOG_LEVEL_RANK[level] > LOG_LEVEL_RANK[cfgLevel]) return;
  } catch { /* no config yet — keep the line */ }
  logRing.push({ ts: Date.now(), level, text: String(text || "") });
  if (logRing.length > LOG_RING_MAX) logRing.splice(0, logRing.length - LOG_RING_MAX);
}

/** Last N lines whose level is at least `level` (error>warn>info>debug). */
export function mhrvLogsGet(opts?: { level?: MhrvLogLevel; limit?: number }): MhrvLogLine[] {
  const min: MhrvLogLevel = opts?.level && opts.level in LOG_LEVEL_RANK ? opts.level : "debug";
  const limit = Math.max(1, Math.min(LOG_RING_MAX, Number(opts?.limit) || 200));
  return logRing
    .filter((l) => LOG_LEVEL_RANK[l.level] <= LOG_LEVEL_RANK[min])
    .slice(-limit)
    .map((l) => ({ ...l }));
}

export function mhrvLogsClear(): void {
  logRing.length = 0;
}

/** The full ring as a plain .log text — `[date] [HH:MM:SS.mmm] LEVEL text`. */
export function mhrvLogsText(): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return logRing
    .map((l) => {
      const d = new Date(l.ts);
      return `[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}] ` +
        `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}] ` +
        `${l.level.toUpperCase()} ${l.text}`;
    })
    .join("\n");
}

export interface MhrvStatus {
  running: boolean;
  mode: MhrvMode;
  httpPort: number;
  socksPort: number;
  googleIp: string;
  frontDomain: string;
  scriptsConfigured: boolean;
  authKeySet: boolean;
  caReady: boolean;
  uptimeMs: number;
  requestsRelayed: number;
  requestsFronted: number;
  lastError: string | null;
  /* H-c additions — honest state for the mhrv-rs-style UI: */
  shareLan: boolean;
  sniPoolSize: number;
  frontDomainsCount: number;
  upstreamSet: boolean;
  logLevel: MhrvLogLevel;
  deployCount: number;
  blockQuic: boolean;
  blockStun: boolean;
}

/* ================================================================== */
/* MITM CA (mitm.rs port) — node-forge                                 */
/* ================================================================== */

interface CaBundle { keyPem: string; certPem: string; }
let caBundle: CaBundle | null = null;
const hostCertCache = new Map<string, { keyPem: string; certPem: string }>();

function caDir(): string {
  return path.join(mhrvDir(), "ca");
}

/** Generate (once) or load the local CA. The key NEVER leaves the machine. */
export function ensureCa(): CaBundle {
  if (caBundle) return caBundle;
  const dir = caDir();
  const keyPath = path.join(dir, "memento-mhrv-ca.key.pem");
  const certPath = path.join(dir, "memento-mhrv-ca.crt");
  try {
    const keyPem = fs.readFileSync(keyPath, "utf8");
    const certPem = fs.readFileSync(certPath, "utf8");
    caBundle = { keyPem, certPem };
    return caBundle;
  } catch {
    /* generate below */
  }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01" + crypto.randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600e3);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600e3);
  const attrs = [
    { name: "commonName", value: "MasterHttpRelayVPN" },
    { name: "organizationName", value: "MEMENTO local relay" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);
  try {
    fs.mkdirSync(dir, { recursive: true });
    try { fs.chmodSync(dir, 0o700); } catch { /* best-effort */ }
    fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
    fs.writeFileSync(certPath, certPem);
  } catch {
    /* in-memory only (browser/dev) */
  }
  caBundle = { keyPem, certPem };
  return caBundle;
}

export function caStatus(): { ready: boolean; certPem: string | null; certPath: string | null } {
  try {
    const ca = ensureCa();
    return { ready: true, certPem: ca.certPem, certPath: path.join(caDir(), "memento-mhrv-ca.crt") };
  } catch {
    return { ready: false, certPem: null, certPath: null };
  }
}

/** Mint (and cache) a leaf certificate for a host, signed by the CA. */
function serverContextFor(host: string): tls.SecureContext {
  const ca = ensureCa();
  const cacheKey = host.toLowerCase();
  let entry = hostCertCache.get(cacheKey);
  if (!entry) {
    const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
    const caCert = forge.pki.certificateFromPem(ca.certPem);
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "02" + crypto.randomBytes(8).toString("hex");
    cert.validity.notBefore = new Date(Date.now() - 3600e3);
    cert.validity.notAfter = new Date(Date.now() + 90 * 24 * 3600e3);
    cert.setSubject([{ name: "commonName", value: cacheKey }]);
    cert.setIssuer(caCert.subject.attributes);
    cert.setExtensions([
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: cacheKey },
          { type: 2, value: "*." + cacheKey.replace(/^[^.]+\./, "") },
        ],
      },
    ]);
    cert.sign(caKey, forge.md.sha256.create());
    entry = {
      keyPem: forge.pki.privateKeyToPem(keys.privateKey),
      certPem: forge.pki.certificateToPem(cert),
    };
    if (hostCertCache.size > 512) hostCertCache.clear();
    hostCertCache.set(cacheKey, entry);
  }
  return tls.createSecureContext({ key: entry.keyPem, cert: entry.certPem });
}

/* ================================================================== */
/* Minimal upstream SOCKS5 client (no deps — raw net socket)            */
/* ================================================================== */

interface UpstreamSocks5 { host: string; port: number; user?: string; pass?: string; }

/** Parse "host:port" — also accepts "user:pass@host:port" and a
 *  socks5:// prefix. Returns null on anything else (caller falls back to
 *  direct and logs once). */
export function parseUpstreamSocks5(raw: string): UpstreamSocks5 | null {
  let t = String(raw || "").trim();
  if (!t) return null;
  t = t.replace(/^socks5h?:\/\//i, "").replace(/^socks?:\/\//i, "");
  let user: string | undefined;
  let pass: string | undefined;
  const at = t.lastIndexOf("@");
  if (at !== -1) {
    const [u, p] = t.slice(0, at).split(":");
    try {
      user = u ? decodeURIComponent(u) : undefined;
      pass = p ? decodeURIComponent(p) : undefined;
    } catch {
      user = u || undefined;
      pass = p || undefined;
    }
    t = t.slice(at + 1);
  }
  const m = t.match(/^\[([^\]]+)\]:(\d{1,5})$/) || t.match(/^([^:\s]+):(\d{1,5})$/);
  if (!m || !m[1]) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1], port, user, pass };
}

let lastUpstreamWarn = "";

/** The parsed upstream for this config — null = direct. Invalid values log
 *  ONCE per distinct value (never per request). */
function getUpstream(cfg: MhrvConfig): UpstreamSocks5 | null {
  const parsed = parseUpstreamSocks5(cfg.upstreamSocks5);
  if (cfg.upstreamSocks5 && !parsed) {
    if (lastUpstreamWarn !== cfg.upstreamSocks5) {
      lastUpstreamWarn = cfg.upstreamSocks5;
      mlog("error", `upstream SOCKS5 "${cfg.upstreamSocks5}" is not host:port — falling back to DIRECT.`);
    }
    return null;
  }
  if (parsed) lastUpstreamWarn = "";
  return parsed;
}

/** SOCKS5 CONNECT through an upstream proxy — greeting, optional RFC
 *  1929 user/pass auth, CONNECT (ATYP=domain), reply check. Resolves with
 *  the RAW connected socket (caller wraps in tls.connect({ socket })).
 *  Exported so the functional smoke can drive the wire format directly. */
export function socks5Connect(
  spec: UpstreamSocks5,
  targetHost: string,
  targetPort: number,
  timeoutMs = 15_000
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: spec.host, port: spec.port });
    socket.setTimeout(timeoutMs);
    let stage: "greet" | "auth" | "connect" = "greet";
    let buf: Buffer = Buffer.alloc(0);
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* best-effort */ }
      reject(new Error(msg));
    };
    const sendConnect = () => {
      stage = "connect";
      const hostBuf = Buffer.from(targetHost, "utf8");
      const head = Buffer.alloc(7 + hostBuf.length);
      head[0] = 0x05; head[1] = 0x01; head[2] = 0x00; head[3] = 0x03; head[4] = hostBuf.length;
      hostBuf.copy(head, 5);
      head.writeUInt16BE(targetPort & 0xffff, 5 + hostBuf.length);
      socket.write(head);
    };
    socket.on("connect", () => {
      stage = "greet";
      // Offer no-auth (+ user/pass when credentials exist).
      socket.write(spec.user ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    });
    socket.on("timeout", () => fail("upstream SOCKS5 timeout"));
    socket.on("error", (e) => fail(`upstream SOCKS5 ${spec.host}:${spec.port} failed: ${e.message}`));
    socket.on("close", () => { if (!settled) fail("upstream SOCKS5 closed before CONNECT completed"); });
    socket.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === "greet") {
        if (buf.length < 2) return;
        const method = buf[1];
        buf = Buffer.from(buf.subarray(2));
        if (method === 0x00) {
          sendConnect();
        } else if (method === 0x02 && spec.user) {
          stage = "auth";
          const u = Buffer.from(spec.user, "utf8");
          const p = Buffer.from(spec.pass || "", "utf8");
          const f = Buffer.alloc(3 + u.length + p.length);
          f[0] = 0x01; f[1] = u.length; u.copy(f, 2);
          f[2 + u.length] = p.length; p.copy(f, 3 + u.length);
          socket.write(f);
        } else {
          fail("upstream SOCKS5: no acceptable auth method");
        }
        return;
      }
      if (stage === "auth") {
        if (buf.length < 2) return;
        const ok = buf[1] === 0x00;
        buf = Buffer.alloc(0);
        if (!ok) { fail("upstream SOCKS5: username/password rejected"); return; }
        sendConnect();
        return;
      }
      // connect reply: VER REP RSV ATYP ADDR PORT
      if (buf.length < 5) return;
      const rep = buf[1];
      const atyp = buf[3];
      const need = atyp === 0x01 ? 10 : atyp === 0x04 ? 22 : 5 + (buf[4] ?? 0) + 2;
      if (buf.length < need) return;
      if (rep !== 0x00) {
        fail(`upstream SOCKS5 CONNECT rejected (reply 0x${rep.toString(16).padStart(2, "0")})`);
        return;
      }
      settled = true;
      socket.setTimeout(0);
      socket.removeAllListeners("data");
      socket.removeAllListeners("timeout");
      socket.removeAllListeners("error");
      socket.removeAllListeners("close");
      resolve(socket);
    });
  });
}

/* ================================================================== */
/* Relay client (domain_fronter.rs port)                               */
/* ================================================================== */

export interface RelayRequest {
  m: string;                      // method
  u: string;                      // full URL to fetch upstream
  h?: Record<string, string>;     // headers
  b?: string;                     // body (base64)
  ct?: string;                    // content-type
  r?: boolean;                    // follow redirects upstream-side
}
export interface RelayResponse {
  s?: number;
  h?: Record<string, string>;
  b?: string;                     // base64 body
  e?: string;
}

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
  "accept-encoding",
]);

function relayPayload(key: string, req: RelayRequest): Buffer {
  const body: Record<string, unknown> = { k: key, m: req.m, u: req.u, r: req.r !== false };
  const headers = req.h ?? {};
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    filtered[k] = v;
  }
  if (Object.keys(filtered).length) body.h = filtered;
  if (req.b) body.b = req.b;
  if (req.ct) body.ct = req.ct;
  // Random padding — mhrv-rs add_random_pad parity (defeats payload-length
  // fingerprinting of the relay POST).
  body._p = crypto.randomBytes(Math.floor(Math.random() * 96)).toString("base64");
  return Buffer.from(JSON.stringify(body), "utf8");
}

/** One POST to /macros/s/{id}/exec, following the /exec redirect chain
 *  (up to 5 hops, same as mhrv-rs). When googleIp is set the TCP
 *  connection is pinned to it with SNI + Host = script.google.com —
 *  classic domain fronting. When an upstream SOCKS5 is configured the
 *  outbound TLS rides the chained socket (createConnection parity with
 *  mhrv-rs's upstream dialer). */
export async function relayRequest(
  scriptId: string,
  req: RelayRequest,
  cfg: MhrvConfig,
  timeoutMs = 60_000
): Promise<RelayResponse> {
  const payload = relayPayload(cfg.authKey, req);
  let hopHost = "script.google.com";
  let hopPath = `/macros/s/${encodeURIComponent(scriptId)}/exec`;
  let hops = 0;
  for (;;) {
    const result = await relayPost(hopHost, hopPath, payload, cfg, timeoutMs);
    const { status, headers, body } = result;
    if (status >= 300 && status < 400) {
      const loc = headers["location"] || headers["Location"];
      if (loc && hops < 5) {
        hops++;
        const next = new URL(loc, `https://${hopHost}`);
        hopHost = next.hostname;
        hopPath = next.pathname + next.search;
        continue;
      }
      return { e: `redirect loop after ${hops} hops` };
    }
    if (status !== 200) {
      const text = body.toString("utf8").slice(0, 200);
      return { e: `Apps Script HTTP ${status}: ${text}` };
    }
    try {
      // Apps Script may wrap the JSON in a Google-frontend preamble —
      // mhrv-rs extracts the outermost JSON object (parse_relay_json).
      const text = body.toString("utf8");
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) {
        return { e: "Non-JSON body returned. The deployment may be deleted, not published to 'Anyone', or requires sign-in." };
      }
      const parsed = JSON.parse(text.slice(start, end + 1)) as RelayResponse;
      return parsed;
    } catch {
      return { e: "invalid relay JSON" };
    }
  }
}

function relayPost(
  host: string,
  requestPath: string,
  payload: Buffer,
  cfg: MhrvConfig,
  timeoutMs: number
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const connectIp = cfg.googleIp || host;
  return (async () => {
    // Upstream SOCKS5 chaining: dial connectIp:443 THROUGH the proxy, then
    // run TLS on top with SNI = the real google host (fronting preserved).
    const upstream = getUpstream(cfg);
    let tlsSocket: tls.TLSSocket | null = null;
    if (upstream) {
      const raw = await socks5Connect(upstream, connectIp, 443, Math.min(timeoutMs, 15_000));
      tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const s = tls.connect({ socket: raw, servername: host, rejectUnauthorized: cfg.verifySsl });
        s.once("secureConnect", () => resolve(s));
        s.once("error", (e) => reject(new Error(`upstream TLS failed: ${e.message}`)));
      });
    }
    return await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
      const reqOpts: https.RequestOptions = {
        host: connectIp,
        servername: host,          // SNI = the real google host (fronting)
        path: requestPath,
        method: "POST",
        headers: {
          "Host": host,            // GFE routes by Host — the fronting half
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MEMENTO-MHRV",
        },
        rejectUnauthorized: cfg.verifySsl,
        timeout: timeoutMs,
      };
      if (tlsSocket) {
        // agent stays undefined so node honors options.createConnection
        // (agent:false would spawn a fresh Agent and ignore it).
        reqOpts.createConnection = (() => tlsSocket) as https.RequestOptions["createConnection"];
      }
      const req = https.request(reqOpts, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => {
          chunks.push(d);
          if (chunks.reduce((n, c) => n + c.length, 0) > 64 * 1024 * 1024) {
            req.destroy(new Error("relay response too large"));
          }
        });
        res.on("end", () => {
          const flat: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            flat[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
          }
          resolve({ status: res.statusCode ?? 0, headers: flat, body: Buffer.concat(chunks) });
        });
      });
      req.on("timeout", () => req.destroy(new Error("relay timeout")));
      req.on("error", reject);
      req.end(payload);
    });
  })();
}

/* ---------------- Multi-ID round-robin with auto-failover ----------------
 * mhrv-rs parity: the relay walks the Deployment-ID pool IN ORDER starting
 * at the last-good index (module state — a real round-robin, not always
 * from [0]). A network failure, a non-2xx or a bad relay body moves the
 * pointer to the next id; every hop is logged.
 * ----------------------------------------------------------------------- */
let lastGoodDeployIndex = 0;

export async function relayWithFailover(
  req: RelayRequest,
  cfg: MhrvConfig,
  timeoutMs = 60_000
): Promise<RelayResponse> {
  const ids = (Array.isArray(cfg.scriptIds) ? cfg.scriptIds : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (!ids.length) {
    return { e: "no Apps Script deployment IDs configured — deploy the embedded Code.gs and paste at least one Deployment ID (one per line)." };
  }
  if (lastGoodDeployIndex >= ids.length) lastGoodDeployIndex = 0;
  let lastError = "";
  for (let n = 0; n < ids.length; n++) {
    const idx = (lastGoodDeployIndex + n) % ids.length;
    let res: RelayResponse;
    try {
      res = await relayRequest(ids[idx], req, cfg, timeoutMs);
    } catch (e: any) {
      res = { e: String(e?.message || e) };
    }
    if (!res.e) {
      lastGoodDeployIndex = idx;
      if (n > 0) {
        mlog("info", `relay recovered on deployment #${idx + 1} — round-robin pointer moved there`);
      }
      return res;
    }
    lastError = res.e;
    if (n + 1 < ids.length) {
      const next = (idx + 1) % ids.length;
      mlog("warn", `deployment #${idx + 1} failed (${res.e.slice(0, 140)}) → failover to #${next + 1}`);
    }
  }
  return { e: lastError || "all deployment IDs failed" };
}

/** Conservative X/Twitter GraphQL path normalization (apps_script mode).
 *
 *  Browsers call the GraphQL API through two shapes: `x.com/i/api/graphql/…`
 *  (the legacy web prefix) and `api.x.com/graphql/…` (the canonical API).
 *  Through the relay a mixed shape forces an extra redirect hop that the
 *  Apps Script must relay again — normalizing the legacy prefix away keeps
 *  one request. CONSERVATIVE by design:
 *    - only x.com / www.x.com / twitter.com / www.twitter.com hosts;
 *    - only the `/i/api/graphql` path prefix is rewritten (→ `/graphql`);
 *    - query, fragment and every other path pass through UNTOUCHED;
 *    - any parse failure returns the input unchanged.
 *  When the mode or the host doesn't apply, callers pass the URL through.
 */
export function normalizeXTwitterUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    const isX = host === "x.com" || host === "www.x.com" ||
      host === "twitter.com" || host === "www.twitter.com" ||
      host === "api.x.com" || host === "api.twitter.com";
    if (!isX) return rawUrl;
    if (u.pathname === "/i/api/graphql" || u.pathname.startsWith("/i/api/graphql/")) {
      u.pathname = u.pathname.replace(/^\/i\/api\/graphql/, "/graphql");
      return u.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/** The one-click end-to-end probe (test_cmd.rs port): one relayed request
 *  to an IP echo endpoint; the relay works when the response carries an
 *  `ip` field. In direct mode the same contract is honestly reported as
 *  not-wired (the upstream wording preserved). */
export async function testRelay(cfg: MhrvConfig): Promise<{ ok: boolean; detail: string; ip?: string }> {
  if (cfg.mode === "direct") {
    // Direct mode has no relay — probe the Google edge instead.
    const probe = await probeGoogleEdge(cfg.googleIp, cfg.frontDomain, cfg.googleIpValidation);
    return {
      ok: probe.ok,
      detail: probe.ok
        ? `direct mode: Google edge reachable via ${cfg.googleIp} (SNI=${cfg.frontDomain}, ${probe.ms} ms). Full-mode relay tests apply to apps_script mode.`
        : `Google edge unreachable via ${cfg.googleIp}: ${probe.error}`,
    };
  }
  if (!cfg.scriptIds.length) return { ok: false, detail: "script_id (or script_ids) is required — deploy Code.gs and paste its Deployment ID (one per line in the settings)." };
  if (!cfg.authKey) return { ok: false, detail: "auth_key must be set to a strong secret." };
  const started = Date.now();
  try {
    const res = await relayWithFailover({
      m: "GET",
      u: "https://api.ipify.org?format=json",
      h: { Accept: "application/json" },
      r: true,
    }, cfg, 45_000);
    const ms = Date.now() - started;
    if (res.e) {
      mlog("error", `relay test FAILED: ${res.e.slice(0, 200)}`);
      return { ok: false, detail: `Relay failed: ${res.e}` };
    }
    const body = res.b ? Buffer.from(res.b, "base64").toString("utf8") : "";
    let ip: string | undefined;
    try { ip = JSON.parse(body)?.ip; } catch { /* not json */ }
    if (ip) {
      mlog("info", `relay test OK (${ms} ms) — exit IP ${ip} via deployment #${lastGoodDeployIndex + 1}`);
      return { ok: true, detail: `Relay OK (${ms} ms) — exit IP: ${ip} (deployment #${lastGoodDeployIndex + 1})`, ip };
    }
    mlog("warn", "relay test: 200 with JSON but no 'ip' field");
    return {
      ok: false,
      detail: `200 OK with JSON but no recognisable 'ip' field. Likely the Apps Script ran but the upstream fetch failed. Body preview: ${body.slice(0, 120)}`,
    };
  } catch (e: any) {
    mlog("error", `relay test FAILED: ${String(e?.message || e).slice(0, 200)}`);
    return { ok: false, detail: `Relay failed: ${String(e?.message || e)}` };
  }
}

/* ================================================================== */
/* Google IP scanner (scan_ips.rs port)                                */
/* ================================================================== */

export interface IpScanRow {
  ip: string;
  latencyMs: number | null;
  error: string | null;
}

function tlsProbe(
  ip: string,
  sni: string,
  cfg: MhrvConfig,
  timeoutMs = 4000
): Promise<{ ok: boolean; ms: number; error: string | null; gws: boolean }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = tls.connect(
      {
        host: ip,
        port: 443,
        servername: sni,
        rejectUnauthorized: false, // NoVerify parity — the probe only checks reachability
        timeout: timeoutMs,
      },
      () => {
        socket.write(`HEAD / HTTP/1.1\r\nHost: ${sni}\r\nConnection: close\r\n\r\n`);
      }
    );
    let buf = "";
    let done = false;
    const finish = (ok: boolean, error: string | null) => {
      if (done) return;
      done = true;
      const lower = buf.toLowerCase();
      const gws = lower.includes("server: gws") || lower.includes("x-google-") || lower.includes("alt-svc: h3=");
      try { socket.destroy(); } catch { /* best-effort */ }
      resolve({ ok, ms: Date.now() - started, error, gws });
    };
    socket.on("data", (d: Buffer) => { buf += d.toString("utf8"); });
    socket.on("error", (e) => finish(false, String(e?.message || e)));
    socket.on("timeout", () => finish(false, "timeout"));
    socket.on("close", () => {
      if (!done) {
        if (buf.startsWith("HTTP/")) {
          finish(cfg.googleIpValidation ? buf.toLowerCase().includes("gws") || buf.toLowerCase().includes("x-google-") || buf.toLowerCase().includes("alt-svc: h3=") : true, null);
        } else {
          finish(false, "no HTTP response");
        }
      }
    });
  });
}

async function resolveFamousDomains(): Promise<string[]> {
  const dns = require("node:dns") as typeof import("node:dns");
  const ips = new Set<string>();
  const results = await Promise.allSettled(
    FAMOUS_GOOGLE_DOMAINS.map((d) => dns.promises.lookup(d, { all: true }))
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const a of r.value) {
        if (a.family === 4) ips.add(a.address);
      }
    }
  }
  return [...ips];
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const toU32 = (s: string): number | null => {
    const o = s.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  };
  const a = toU32(ip);
  const b = toU32(base);
  if (a === null || b === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (a & mask) === (b & mask);
}

function cidrToIps(cidr: string): string[] {
  const [base, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const o = base.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n))) return [];
  const b = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const hostBits = 32 - prefix;
  if (hostBits < 0 || hostBits > 32) return [];
  const numHosts = hostBits >= 32 ? 0xffffffff : (1 << hostBits) >>> 0;
  const limit = Math.min(numHosts, 256);
  if (limit < 3) return [];
  const out: string[] = [];
  for (let i = 1; i < limit - 1; i++) {
    const ip = (b + i) >>> 0;
    out.push(`${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`);
  }
  return out;
}

async function fetchGoogleCidrs(): Promise<string[]> {
  const res = await fetch("https://www.gstatic.com/ipranges/goog.json", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`goog.json HTTP ${res.status}`);
  const json = (await res.json()) as { prefixes?: Array<{ ipv4Prefix?: string }> };
  const cidrs: string[] = [];
  for (const p of json.prefixes ?? []) {
    if (typeof p.ipv4Prefix === "string") cidrs.push(p.ipv4Prefix);
  }
  return cidrs;
}

async function boundedMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** THE Google IP scan — the feature the user said was missing. Full port:
 *  famous-domain resolution -> goog.json CIDR fetch -> priority sampling ->
 *  batched TLS probes with Google-edge validation, sorted by latency. */
export async function scanGoogleIps(cfg: MhrvConfig): Promise<{ rows: IpScanRow[]; source: string }> {
  mlog("info", "Google IP scan started (famous domains → goog.json → batched TLS probes)");
  let candidates: string[] = [];
  let source = "static fallback list";
  try {
    const famous = await resolveFamousDomains();
    const cidrs = await fetchGoogleCidrs();
    const priority = cidrs.filter((c) => famous.some((ip) => ipInCidr(ip, c)));
    const others = cidrs.filter((c) => !priority.includes(c));
    const pick = (arr: string[]) => arr.flatMap(cidrToIps);
    const priorityIps = pick(priority);
    const otherIps = pick(others);
    // shuffle
    for (const arr of [priorityIps, otherIps]) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    candidates = [...priorityIps.slice(0, cfg.maxIpsToScan)];
    if (candidates.length < cfg.maxIpsToScan) {
      candidates = candidates.concat(otherIps.slice(0, cfg.maxIpsToScan - candidates.length));
    }
    source = `resolved ${famous.length} famous-domain IPs -> ${cidrs.length} goog.json CIDRs (${priority.length} priority)`;
  } catch {
    candidates = [];
  }
  if (!candidates.length) {
    candidates = [...CANDIDATE_IPS];
    source = "static fallback list (goog.json unreachable)";
  }

  // Batched validation (scan_batch_size), then the latency pass on the
  // survivors — the two-phase shape of scan_ips.rs. When the whole
  // sampled set fails (random CIDR picks can all be dead edges), the
  // KNOWN-GOOD static candidate list takes over — mhrv-rs fallback
  // parity ("No working IPs found in goog.json, using static fallback").
  const working: string[] = [];
  const validateChunk = async (chunk: string[]): Promise<string[]> => {
    const verdicts = await boundedMap(chunk, cfg.parallelConcurrency, async (ip) => {
      const r = await tlsProbe(ip, cfg.frontDomain, cfg, 2000);
      return r.ok ? ip : null;
    });
    return verdicts.filter((v): v is string => !!v);
  };
  for (let i = 0; i < candidates.length; i += cfg.scanBatchSize) {
    working.push(...(await validateChunk(candidates.slice(i, i + cfg.scanBatchSize))));
  }
  if (!working.length) {
    source += " + static fallback";
    for (let i = 0; i < CANDIDATE_IPS.length; i += cfg.scanBatchSize) {
      working.push(...(await validateChunk(CANDIDATE_IPS.slice(i, i + cfg.scanBatchSize))));
    }
  }
  if (!working.length) return { rows: [], source };

  const rows = await boundedMap(working, cfg.parallelConcurrency, async (ip): Promise<IpScanRow> => {
    const r = await tlsProbe(ip, cfg.frontDomain, cfg, 4000);
    return r.ok
      ? { ip, latencyMs: r.ms, error: null }
      : { ip, latencyMs: null, error: r.error ?? "failed" };
  });
  rows.sort((a, b) => (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER));
  mlog("info", `Google IP scan finished — ${rows.filter((r) => r.latencyMs !== null).length} working IPs (${source})`);
  return { rows, source };
}

/** SNI scan (scan_sni.rs port): probe candidate SNI names against the
 *  google_ip edge; a reset/blocked handshake = possible DPI interference. */
export interface SniScanRow { sni: string; ok: boolean; ms: number; note: string; }

export async function scanSniCandidates(cfg: MhrvConfig, limit = 40): Promise<SniScanRow[]> {
  // The probe set IS the managed SNI pool (the UI chip "SNI pool (n/n)"
  // reports healthy/total against exactly these names).
  const pool = (cfg.sniPool?.length ? cfg.sniPool : DEFAULT_SNI_POOL);
  const candidates = pool.slice(0, Math.max(8, limit));
  mlog("info", `SNI scan started — ${candidates.length} names from the pool via ${cfg.googleIp}`);
  const rows = await boundedMap(candidates, cfg.parallelConcurrency, async (sni): Promise<SniScanRow> => {
    const r = await tlsProbe(cfg.googleIp, sni, cfg, 3000);
    return {
      sni,
      ok: r.ok,
      ms: r.ms,
      note: r.ok
        ? "reachable via google_ip"
        : r.error === "timeout"
          ? "timeout — possible DPI drop"
          : `failed: ${r.error}`,
    };
  });
  rows.sort((a, b) => (a.ok === b.ok ? a.ms - b.ms : a.ok ? -1 : 1));
  mlog("info", `SNI scan finished — ${rows.filter((r) => r.ok).length}/${rows.length} reachable`);
  return rows;
}

async function probeGoogleEdge(ip: string, sni: string, validation: boolean): Promise<{ ok: boolean; ms: number; error?: string }> {
  const r = await tlsProbe(ip, sni, { ...loadConfig(), googleIpValidation: validation }, 4000);
  return { ok: r.ok, ms: r.ms, error: r.error ?? undefined };
}

/* ================================================================== */
/* The proxy server (proxy_server.rs port)                             */
/* ================================================================== */

class MhrvServer {
  private httpServer: http.Server | null = null;
  private socksServer: net.Server | null = null;
  private startedAt = 0;
  private lastError: string | null = null;
  private relayed = 0;
  private fronted = 0;

  get running(): boolean {
    return !!this.httpServer;
  }

  status(cfg: MhrvConfig): MhrvStatus {
    return {
      running: this.running,
      mode: cfg.mode,
      httpPort: cfg.listenPort,
      socksPort: cfg.socksPort,
      googleIp: cfg.googleIp,
      frontDomain: cfg.frontDomain,
      scriptsConfigured: cfg.scriptIds.length > 0,
      authKeySet: !!cfg.authKey,
      caReady: !!caBundle,
      uptimeMs: this.running ? Date.now() - this.startedAt : 0,
      requestsRelayed: this.relayed,
      requestsFronted: this.fronted,
      lastError: this.lastError,
      /* H-c additions — honest state: */
      shareLan: cfg.shareLan,
      sniPoolSize: cfg.sniPool.length,
      frontDomainsCount: cfg.frontDomains.length,
      upstreamSet: !!parseUpstreamSocks5(cfg.upstreamSocks5),
      logLevel: cfg.logLevel,
      deployCount: cfg.scriptIds.length,
      blockQuic: cfg.blockQuic,
      blockStun: cfg.blockStun,
    };
  }

  async start(cfg: MhrvConfig): Promise<void> {
    if (this.running) throw new Error("MHRV proxy is already running — stop it first.");
    this.lastError = null;
    if (cfg.mode === "apps_script" && (!cfg.scriptIds.length || !cfg.authKey)) {
      throw new Error(
        "apps_script mode needs the Deployment ID and the auth key — deploy the embedded Code.gs first (the GOOGLE SIDE tab walks you through it)."
      );
    }
    ensureCa();

    // shareLan: 0.0.0.0 exposes the HTTP+SOCKS listeners to the LAN (applied
    // on the NEXT start — a running proxy keeps its bind until restarted).
    const bindHost = cfg.shareLan ? "0.0.0.0" : "127.0.0.1";
    mlog(
      "info",
      `starting MHRV proxy — mode=${cfg.mode} http=${bindHost}:${cfg.listenPort} socks5=${bindHost}:${cfg.socksPort} ` +
      `deployments=${cfg.scriptIds.length}${cfg.shareLan ? " (shared with LAN devices)" : ""}`
    );
    if (cfg.upstreamSocks5) {
      const up = parseUpstreamSocks5(cfg.upstreamSocks5);
      if (up) {
        mlog("info", `upstream socks5 ${up.host}:${up.port}${up.user ? " (with auth)" : ""} — outbound TLS + SNI-rewrite dial through it`);
      } else {
        mlog("error", `upstream SOCKS5 "${cfg.upstreamSocks5}" invalid (expected host:port) — falling back to direct`);
      }
    }
    mlog("info", `front domain ${cfg.frontDomain} (pool of ${cfg.frontDomains.length}) · google_ip ${cfg.googleIp || "(resolve)"} · SNI pool ${cfg.sniPool.length}`);

    const busyPorts: number[] = [];
    for (const port of [cfg.listenPort, cfg.socksPort]) {
      const busy = await new Promise<boolean>((resolve) => {
        const probe = net.createServer();
        probe.once("error", () => resolve(true));
        probe.once("listening", () => probe.close(() => resolve(false)));
        probe.listen(port, "127.0.0.1");
      });
      if (busy) busyPorts.push(port);
    }
    if (busyPorts.length) {
      throw new Error(
        `Port ${busyPorts.join(", ")} already in use — close the other app (or a leftover mhrv-rs.exe) or change the MHRV ports in the settings.`
      );
    }

    const server = http.createServer((req, res) => {
      void this.handlePlain(req, res, cfg).catch(() => {
        try { res.destroy(); } catch { /* best-effort */ }
      });
    });
    server.on("connect", (req, clientSocket, head) => {
      // The connect event types the socket as Duplex; at runtime it is the
      // established net.Socket the handlers bridge on.
      const sock = clientSocket as net.Socket;
      void this.handleConnect(req, sock, head, cfg).catch(() => {
        try { sock.destroy(); } catch { /* best-effort */ }
      });
    });
    server.on("clientError", (_e, socket) => {
      try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch { /* best-effort */ }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(cfg.listenPort, bindHost, () => resolve());
    });

    const socks = this.startSocks(cfg);
    try {
      await new Promise<void>((resolve, reject) => {
        socks.once("error", reject);
        socks.listen(cfg.socksPort, bindHost, () => resolve());
      });
    } catch (e) {
      try { server.close(); } catch { /* best-effort */ }
      throw e;
    }

    this.httpServer = server;
    this.socksServer = socks;
    this.startedAt = Date.now();
    mlog("info", `MHRV proxy running — HTTP ${bindHost}:${cfg.listenPort} · SOCKS5 ${bindHost}:${cfg.socksPort}`);
  }

  stop(): void {
    try { this.httpServer?.close(); } catch { /* best-effort */ }
    try { this.socksServer?.close(); } catch { /* best-effort */ }
    this.httpServer = null;
    this.socksServer = null;
    mlog("info", `MHRV proxy stopped (relayed ${this.relayed} · fronted ${this.fronted} this session)`);
  }

  /* ---------------- plain HTTP ---------------- */

  private async handlePlain(req: http.IncomingMessage, res: http.ServerResponse, cfg: MhrvConfig): Promise<void> {
    const host = String(req.headers.host || "");
    if (!host) {
      res.writeHead(400).end();
      return;
    }
    const url = new URL(req.url || "/", `http://${host}`);
    if (cfg.mode === "direct") {
      // do_plain_http_passthrough parity
      this.fronted++;
      const upstream = http.request(
        { host: url.hostname, port: Number(url.port || 80), path: url.pathname + url.search, method: req.method, headers: { ...req.headers } },
        (ur) => {
          res.writeHead(ur.statusCode || 502, ur.headers);
          ur.pipe(res);
          // 3.1.8 live counters: request body up, response body down.
          mhrvCountBridge(req, ur);
        }
      );
      upstream.on("error", () => { try { res.writeHead(502).end(); } catch { /* best-effort */ } });
      req.pipe(upstream);
      return;
    }
    // apps_script relay — through the whole Deployment-ID pool with
    // auto-failover (never just scriptIds[0] anymore).
    this.relayed++;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const out = await relayWithFailover({
      m: req.method || "GET",
      // normalizeXTwitter: conservative GraphQL path rewrite (apps_script
      // mode only — see normalizeXTwitterUrl for the exact contract).
      u: cfg.normalizeXTwitter ? normalizeXTwitterUrl(url.toString()) : url.toString(),
      h: { ...(req.headers as Record<string, string>) },
      b: body.length ? body.toString("base64") : undefined,
      ct: String(req.headers["content-type"] || "") || undefined,
      r: true,
    }, cfg);
    if (out.e) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`MEMENTO MHRV relay error: ${out.e}`);
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(out.h || {})) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    }
    res.writeHead(out.s ?? 502, headers);
    const respBody = out.b ? Buffer.from(out.b, "base64") : undefined;
    // 3.1.8 live counters: relay path — request payload + response payload.
    liveUplink += body.length;
    if (respBody) liveDownlink += respBody.length;
    res.end(respBody);
  }

  /* ---------------- CONNECT dispatch ---------------- */

  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
    cfg: MhrvConfig
  ): Promise<void> {
    const [host, portStr] = String(req.url || "").split(":");
    const port = Number(portStr || 443);
    if (!host) {
      clientSocket.destroy();
      return;
    }

    // 1) Google-host traffic -> SNI-rewrite tunnel (both modes) — EXCEPT
    //    youtubeThroughRelay hosts (googlevideo/youtube/ytimg break on the
    //    GFE edge; they are relay-eligible instead).
    const youtubeRelayEligible = cfg.youtubeThroughRelay && matchesYoutubeRelay(host);
    if (port === 443 && matchesSniRewrite(host) && !youtubeRelayEligible) {
      this.fronted++;
      clientSocket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      void this.sniRewriteTunnel(clientSocket, head, host, port, cfg).catch(() => {
        try { clientSocket.destroy(); } catch { /* best-effort */ }
      });
      return;
    }

    // 2) apps_script mode -> MITM + per-request relay (full mode).
    //    youtubeThroughRelay exception: in DIRECT mode a YouTube host with
    //    a real deployment pool configured is ALSO relayed here (instead of
    //    the SNI rewrite above). Without a pool it honestly falls through
    //    to the raw direct passthrough below — no silent relay attempt.
    if (cfg.mode === "apps_script" || (youtubeRelayEligible && cfg.scriptIds.length > 0 && !!cfg.authKey)) {
      this.relayed++;
      clientSocket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      this.mitmRelayTunnel(clientSocket, head, host, port, cfg);
      return;
    }

    // 3) direct mode, non-Google -> raw passthrough (mhrv-rs parity:
    //    "anything not on the Google edge is forwarded direct").
    this.fronted++;
    clientSocket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    const upstream = net.connect(port, host);
    upstream.on("error", () => { try { clientSocket.destroy(); } catch { /* best-effort */ } });
    clientSocket.on("error", () => { try { upstream.destroy(); } catch { /* best-effort */ } });
    upstream.on("connect", () => {
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
      // 3.1.8 live counters (field report #5): direct passthrough bytes.
      mhrvCountBridge(clientSocket, upstream);
    });
  }

  /** do_sni_rewrite_tunnel_from_tcp port: MITM the browser, re-originate
   *  TLS to google_ip with SNI=front_domain, bridge the decrypted bytes —
   *  the Google edge routes by the inner Host header. With an upstream
   *  SOCKS5 configured, the outbound TCP dials through the chain first. */
  private async sniRewriteTunnel(clientSocket: net.Socket, head: Buffer, host: string, port: number, cfg: MhrvConfig): Promise<void> {
    let inbound: tls.TLSSocket;
    try {
      if (head?.length) clientSocket.unshift(head);
      inbound = new tls.TLSSocket(clientSocket, {
        isServer: true,
        secureContext: serverContextFor(host),
        ALPNProtocols: ["http/1.1"],
      });
    } catch {
      try { clientSocket.destroy(); } catch { /* best-effort */ }
      return;
    }
    let outbound: tls.TLSSocket;
    try {
      const upstream = getUpstream(cfg);
      if (upstream) {
        const raw = await socks5Connect(upstream, cfg.googleIp || cfg.frontDomain, port, 15_000);
        outbound = tls.connect({ socket: raw, servername: cfg.frontDomain, rejectUnauthorized: cfg.verifySsl });
      } else {
        outbound = tls.connect({
          host: cfg.googleIp,
          port,
          servername: cfg.frontDomain,
          rejectUnauthorized: cfg.verifySsl,
        });
      }
    } catch {
      try { inbound.destroy(); } catch { /* best-effort */ }
      return;
    }
    outbound.on("error", () => { try { inbound.destroy(); } catch { /* best-effort */ } });
    inbound.on("error", () => { try { outbound.destroy(); } catch { /* best-effort */ } });
    const bridge = () => {
      inbound.pipe(outbound);
      outbound.pipe(inbound);
      // 3.1.8 live counters (field report #5): observed ALONGSIDE the pipe.
      mhrvCountBridge(
        inbound as unknown as NodeJS.ReadableStream & { once?: (ev: string, cb: () => void) => unknown },
        outbound as unknown as NodeJS.ReadableStream
      );
    };
    outbound.once("secureConnect", () => {
      if (inbound.encrypted) bridge();
      else inbound.once("secureConnect", bridge);
    });
  }

  /** Full-mode HTTPS: MITM the browser, then relay every request through
   *  the Apps Script deployment. */
  private mitmRelayTunnel(clientSocket: net.Socket, head: Buffer, host: string, port: number, cfg: MhrvConfig): void {
    if (head?.length) clientSocket.unshift(head);
    let tlsSocket: tls.TLSSocket;
    try {
      tlsSocket = new tls.TLSSocket(clientSocket, {
        isServer: true,
        secureContext: serverContextFor(host),
        ALPNProtocols: ["http/1.1"],
      });
    } catch {
      try { clientSocket.destroy(); } catch { /* best-effort */ }
      return;
    }
    tlsSocket.on("error", () => { try { clientSocket.destroy(); } catch { /* best-effort */ } });
    const mitmServer = new http.Server((req, res) => {
      void this.handlePlain(req, res, cfg).catch(() => {
        try { res.destroy(); } catch { /* best-effort */ }
      });
    });
    mitmServer.on("clientError", (_e, s) => { try { s.destroy(); } catch { /* best-effort */ } });
    // Feeding an existing TLS socket to an http server instance — the
    // standard Node MITM recipe (mitm.rs accept path parity). The runtime
    // contract is "a connected socket"; node types only model the fresh
    // net.Socket case, so the emit is asserted once here.
    mitmServer.emit("connection", tlsSocket as unknown as net.Socket);
    tlsSocket.on("close", () => { try { mitmServer.close(); } catch { /* best-effort */ } });
    clientSocket.on("close", () => { try { mitmServer.close(); } catch { /* best-effort */ } });
  }

  /* ---------------- SOCKS5 ---------------- */

  private startSocks(cfg: MhrvConfig): net.Server {
    const server = net.createServer((socket) => {
      socket.once("error", () => { try { socket.destroy(); } catch { /* best-effort */ } });
      let stage: "greeting" | "request" = "greeting";
      socket.on("data", (buf: Buffer) => {
        if (stage === "greeting") {
          // [VER, NMETHOD, METHODS...]
          if (buf.length < 2 || buf[0] !== 5) { socket.destroy(); return; }
          socket.write(Buffer.from([0x05, 0x00])); // no auth
          stage = "request";
          return;
        }
        // CONNECT request: VER CMD RSV ATYP ADDR PORT
        // HONESTY about blockQuic/blockStun: this local SOCKS5 server is
        // TCP-CONNECT-ONLY. CMD=0x03 (UDP ASSOCIATE) — the only way UDP
        // could traverse a SOCKS5 proxy — is refused below with reply 0x07,
        // so NO UDP (QUIC 443 included) can pass through this proxy with
        // or without the flags. blockQuic/blockStun are therefore stored +
        // exposed in mhrv_status for the UI ("apply when a system-wide
        // tunnel is active"), NOT filter rules here — there is no UDP
        // datagram path to filter in the first place.
        // UDP ASSOCIATE explicitly refused — see the honesty note above.
        if (buf.length >= 7 && buf[0] === 5 && buf[1] === 0x03) {
          mlog("debug", "SOCKS5 client requested UDP ASSOCIATE — refused (TCP-CONNECT-only server)");
          socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.destroy();
          return;
        }
        if (buf.length < 7 || buf[0] !== 5 || buf[1] !== 0x01) {
          // 0x07 = command not supported (BIND and anything else).
          socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.destroy();
          return;
        }
        const atyp = buf[3];
        let host = "";
        let port = 0;
        if (atyp === 0x01) {
          host = [...buf.slice(4, 8)].join(".");
          port = buf.readUInt16BE(8);
        } else if (atyp === 0x03) {
          const len = buf[4];
          host = buf.slice(5, 5 + len).toString("utf8");
          port = buf.readUInt16BE(5 + len);
        } else if (atyp === 0x04) {
          host = `[${[...buf.slice(4, 20)].map((b) => b.toString(16).padStart(2, "0")).reduce((s, b, i) => s + b + (i % 2 === 1 && i < 15 ? ":" : ""), "")}]`;
          port = buf.readUInt16BE(20);
        } else {
          socket.destroy();
          return;
        }
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        const fakeReq = new http.IncomingMessage(null as never);
        fakeReq.url = `${host}:${port}`;
        fakeReq.headers = {};
        fakeReq.method = "CONNECT";
        void this.handleConnect(fakeReq, socket, Buffer.alloc(0), cfg).catch(() => {
          try { socket.destroy(); } catch { /* best-effort */ }
        });
      });
    });
    return server;
  }
}

const server = new MhrvServer();

/* ------------------------------------------------------------------ */
/* 3.1.8 — LIVE traffic counters (field report #5: "Live Connection
/* should not only work with xray"). The MHRV relay is an IN-PROCESS
/* engine (no child core, no stats API) — so the byte counters are
/* observed directly on its own sockets/pipes: uplink = app -> relay,
/* downlink = relay -> app. Payload bytes only (TLS overhead excluded
/* on MITM paths) — honest tunnel-level totals, never invented. */
/* ------------------------------------------------------------------ */

let liveUplink = 0;
let liveDownlink = 0;
let liveActiveTunnels = 0;
let liveTotalTunnels = 0;

/** One live-traffic observation pair. `clientSide` carries app->relay
 *  bytes (uplink), `serverSide` relay->app bytes (downlink). Listeners
 *  ride ALONGSIDE pipe() — a second "data" listener never interferes
 *  with the pipe's own consumption. */
function mhrvCountBridge(
  clientSide: NodeJS.ReadableStream & { once?: (ev: string, cb: () => void) => unknown },
  serverSide: NodeJS.ReadableStream
): void {
  liveTotalTunnels++;
  liveActiveTunnels++;
  const onUp = (d: Buffer) => { liveUplink += d.length; };
  const onDown = (d: Buffer) => { liveDownlink += d.length; };
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    liveActiveTunnels = Math.max(0, liveActiveTunnels - 1);
    clientSide.removeListener?.("data", onUp);
    serverSide.removeListener("data", onDown);
  };
  try {
    clientSide.on?.("data", onUp);
    serverSide.on("data", onDown);
    (clientSide as unknown as { once: (ev: string, cb: () => void) => void }).once("close", detach);
    (serverSide as unknown as { once: (ev: string, cb: () => void) => void }).once("close", detach);
    (serverSide as unknown as { once: (ev: string, cb: () => void) => void }).once("error", detach);
  } catch {
    detach();
  }
}

export interface MhrvLiveStats {
  atMs: number;
  running: boolean;
  /** Cumulative app -> relay bytes since app start. */
  uplink: number;
  /** Cumulative relay -> app bytes since app start. */
  downlink: number;
  activeTunnels: number;
  totalTunnels: number;
}

/** The live surface get_connection_stats reads when Google Side is the
 *  active connection (no core running, mhrv running). */
export function mhrvLiveStats(): MhrvLiveStats {
  let running = false;
  try {
    running = server.running;
  } catch {
    running = false;
  }
  return {
    atMs: Date.now(),
    running,
    uplink: liveUplink,
    downlink: liveDownlink,
    activeTunnels: liveActiveTunnels,
    totalTunnels: liveTotalTunnels,
  };
}

export function mhrvStatus(): MhrvStatus {
  return server.status(loadConfig());
}

export async function mhrvStart(): Promise<MhrvStatus> {
  try {
    await server.start(loadConfig());
  } catch (e: any) {
    mlog("error", `MHRV start failed: ${String(e?.message || e)}`);
    throw e;
  }
  return mhrvStatus();
}

export function mhrvStop(): MhrvStatus {
  server.stop();
  return mhrvStatus();
}

/* ================================================================== */
/* Embedded Code.gs (never a GitHub download)                          */
/* ================================================================== */

function resolveResourceMhrv(): string {
  try {
    const { resourceRoot } = require("./paths") as { resourceRoot(): string };
    return path.join(resourceRoot(), "mhrv");
  } catch {
    return "";
  }
}

/** Returns the embedded Code.gs (or the CFW variant), optionally with the
 *  user's auth key (and for CFW the Worker URL) ALREADY injected at the
 *  constants — the one-click "copy with my key" the user asked for. */
export function embeddedCodeGs(
  variant: "apps_script" | "cfw",
  authKey?: string | null,
  workerUrl?: string | null
): { text: string; source: string } | null {
  const file = variant === "cfw" ? "Code.cfw.gs" : "Code.gs";
  const candidates: string[] = [];
  const resDir = resolveResourceMhrv();
  if (resDir) candidates.push(path.join(resDir, file));
  candidates.push(path.join(__dirname, "..", "resources", "mhrv", file));
  candidates.push(path.join(app.getAppPath(), "resources", "mhrv", file));
  for (const p of candidates) {
    try {
      let text = fs.readFileSync(p, "utf8");
      const source = path.basename(p);
      if (authKey) {
        text = text.replace(
          /const\s+AUTH_KEY\s*=\s*"CHANGE_ME_TO_A_STRONG_SECRET"\s*;/,
          `const AUTH_KEY = ${JSON.stringify(authKey)};`
        );
        text = text.replace(
          /const\s+DEFAULT_AUTH_KEY\s*=\s*"CHANGE_ME_TO_A_STRONG_SECRET"\s*;/,
          `const DEFAULT_AUTH_KEY = ${JSON.stringify(authKey)};`
        );
      }
      if (variant === "cfw" && workerUrl) {
        text = text.replace(
          /const\s+WORKER_URL\s*=\s*"https:\/\/CHANGE_ME\.workers\.dev"\s*;/,
          `const WORKER_URL = ${JSON.stringify(workerUrl)};`
        );
        text = text.replace(
          /const\s+DEFAULT_WORKER_URL\s*=\s*"https:\/\/CHANGE_ME\.workers\.dev"\s*;/,
          `const DEFAULT_WORKER_URL = ${JSON.stringify(workerUrl)};`
        );
      }
      return { text, source };
    } catch {
      /* next candidate */
    }
  }
  return null;
}

const CA_FRIENDLY_NAME = "MasterHttpRelayVPN";

/** The per-user CA install: certutil -user -addstore Root (a Windows
 *  confirmation dialog, NO UAC). Firefox/NSS stores stay manual — the
 *  upstream wording is honest about that too. */
export function installCaToUserStore(): { ok: boolean; detail: string } {
  try {
    if (process.platform !== "win32") {
      return { ok: false, detail: "automatic install is implemented on Windows — import the exported CRT manually on this platform." };
    }
    const ca = ensureCa();
    const certPath = path.join(caDir(), "memento-mhrv-ca.crt");
    fs.writeFileSync(certPath, ca.certPem);
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const res = spawnSync("certutil", ["-user", "-addstore", "Root", certPath], {
      timeout: 60_000,
      windowsHide: false, // the confirmation dialog must be visible
    });
    if (res.status === 0) {
      mlog("info", "CA installed to the user Root store (certutil -user -addstore Root)");
      return { ok: true, detail: "CA installed to your user Root store — HTTPS sites will trust the MHRV relay after browser restart." };
    }
    const err = String(res.stderr || res.stdout || "").trim();
    mlog("warn", `CA install failed: ${err.slice(-140) || "dialog cancelled"}`);
    return { ok: false, detail: err ? `certutil: ${err.slice(-300)}` : "the Windows certificate dialog was cancelled." };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e) };
  }
}

/** H-c: remove the CA — deletes the generated files, resets the module
 *  cache and best-effort removes it from the user store:
 *  win32 `certutil -user -del store Root <friendly name>` (the SAME store
 *  and friendly name installCaToUserStore writes), darwin/linux = files
 *  only (no store write ever happened there). */
export function removeCaFromUserStore(): { ok: boolean; detail: string } {
  const parts: string[] = [];
  let ok = true;
  if (process.platform === "win32") {
    try {
      const { spawnSync } = require("child_process") as typeof import("child_process");
      const res = spawnSync("certutil", ["-user", "-del", "store", "Root", CA_FRIENDLY_NAME], {
        timeout: 60_000,
        windowsHide: true, // silent best-effort — a missing CA is not an error worth a dialog
      });
      if (res.status === 0) parts.push("removed from the user Root store (certutil)");
      else parts.push("not found in the user Root store (or certutil refused) — continuing");
    } catch (e: any) {
      parts.push(`certutil removal skipped: ${String(e?.message || e)}`);
    }
  }
  try {
    fs.rmSync(caDir(), { recursive: true, force: true });
    parts.push("CA key+cert files deleted from disk");
  } catch (e: any) {
    ok = false;
    parts.push(`could not delete the CA files: ${String(e?.message || e)}`);
  }
  // Reset the module caches — the next Start mints a FRESH CA.
  caBundle = null;
  hostCertCache.clear();
  const detail = parts.join("; ") + (process.platform === "win32" ? "." : ". No OS store entry existed to remove on this platform.") +
    (mhrvStatus().running ? " Restart the MHRV proxy so in-memory certs stop being used." : "");
  mlog("info", `CA removed — ${parts.join("; ")}`);
  return { ok, detail };
}

/** H-c: verify CA presence — win32 checks the user Root store via
 *  `certutil -user -store Root | findstr <friendly name>`; every other
 *  platform (and as a fallback everywhere) checks the generated files. */
export function checkCaInUserStore(): { ok: boolean; detail: string } {
  const certPath = path.join(caDir(), "memento-mhrv-ca.crt");
  const keyPath = path.join(caDir(), "memento-mhrv-ca.key.pem");
  const filesOk = fs.existsSync(certPath) && fs.existsSync(keyPath);
  if (process.platform === "win32") {
    try {
      const { spawnSync } = require("child_process") as typeof import("child_process");
      const res = spawnSync(
        "cmd.exe",
        ["/c", `certutil -user -store Root | findstr /i "${CA_FRIENDLY_NAME}"`],
        { timeout: 30_000, windowsHide: true, encoding: "utf8" }
      );
      const found = res.status === 0 && String(res.stdout || "").trim().length > 0;
      if (found) {
        return { ok: true, detail: `CA "${CA_FRIENDLY_NAME}" IS present in your user Root store (certutil lookup).` };
      }
      return {
        ok: false,
        detail: filesOk
          ? `Not in the user Root store yet — the CA files exist (${certPath}). Press Install CA to add it.`
          : "No CA found: not in the user Root store and no generated files — press Install CA.",
      };
    } catch (e: any) {
      return {
        ok: filesOk,
        detail: `certutil lookup failed (${String(e?.message || e)}) — file check only: ${filesOk ? "CA files exist" : "no CA files"}.`,
      };
    }
  }
  return {
    ok: filesOk,
    detail: filesOk
      ? `CA files exist (${certPath}) — on this platform the user-store install is manual (import the CRT).`
      : "No CA generated yet — it is minted on the first Start.",
  };
}

/* ================================================================== */
/* H-c: MEMENTO update check (the "Check for updates" button)          */
/* ==================================================================
 * Reuses the static facts from appUpdate.ts (current version + the pinned
 * releases URL) and probes the GitHub releases/latest REDIRECT — the same
 * quota-free trick updateCenter.ts uses for cores. USER-CLICK ONLY (no
 * timers here), never downloads, never swaps anything, NEVER THROWS: any
 * failure degrades to { latest: null, isNewer: false } plus the reason. */
function compareVersions(a: string, b: string): number {
  const pa = String(a || "").replace(/^v/i, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "").replace(/^v/i, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 4; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function mhrvUpdateCheck(): Promise<{
  current: string;
  latest: string | null;
  isNewer: boolean;
  releasesUrl: string;
  detail: string;
}> {
  try {
    const { appUpdateInfo, APP_RELEASES_URL } = require("./appUpdate") as
      typeof import("./appUpdate");
    const current = appUpdateInfo(app.getVersion()).appVersion || "0.0.0";
    const url = APP_RELEASES_URL + "/latest";
    const attempt = async (redirect: "manual" | "follow"): Promise<string | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(url, { redirect, signal: controller.signal });
        const finalUrl = redirect === "manual" ? res.headers.get("location") || "" : res.url;
        const m = finalUrl.match(/\/releases\/tag\/([^/?#]+)/);
        return m ? decodeURIComponent(m[1]) : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    const latest = (await attempt("manual")) ?? (await attempt("follow"));
    if (!latest) {
      mlog("warn", "update check: could not read the latest release tag (offline or blocked)");
      return {
        current,
        latest: null,
        isNewer: false,
        releasesUrl: APP_RELEASES_URL,
        detail: `Could not read the latest release tag from GitHub (offline, rate-limited or blocked). You are on ${current} — check ${APP_RELEASES_URL} in your browser.`,
      };
    }
    const isNewer = compareVersions(latest, current) > 0;
    mlog("info", `update check: current ${current}, latest ${latest} → ${isNewer ? "update available" : "up to date"}`);
    return {
      current,
      latest,
      isNewer,
      releasesUrl: APP_RELEASES_URL,
      detail: isNewer
        ? `Update available: ${latest} (you are on ${current}). Open the releases page to get it.`
        : `You are on the latest version (${current}).`,
    };
  } catch (e: any) {
    return {
      current: "unknown",
      latest: null,
      isNewer: false,
      releasesUrl: "https://github.com/epodonios/memento/releases",
      detail: `Update check failed: ${String(e?.message || e)}`,
    };
  }
}
