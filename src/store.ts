import { create } from "zustand";
import type { Language } from "./i18n";
import type { SubscriptionUserInfo } from "./utils/subscription";
import { configIdentity } from "./utils/subscription";
import {
  type BuilderOptions,
  DEFAULT_BUILDER_OPTIONS,
  loadBuilderOptions,
  BUILDER_OPTIONS_STORAGE_KEY,
} from "./utils/builderOptions";
import {
  type RoutingOptions,
  loadRoutingOptions,
  ROUTING_OPTIONS_STORAGE_KEY,
} from "./utils/routingOptions";
import {
  type TopologyOptions,
  loadTopologyOptions,
  TOPOLOGY_OPTIONS_STORAGE_KEY,
} from "./utils/topologyOptions";
import type { GeoStatus } from "./utils/routingOptions";
export type { GeoStatus };

export type { BuilderOptions, SubscriptionUserInfo };
export { DEFAULT_BUILDER_OPTIONS };
export type { RoutingOptions, GeoNeeds } from "./utils/routingOptions";
export { DEFAULT_ROUTING_OPTIONS, routingNeedsGeo } from "./utils/routingOptions";
export type { TopologyOptions, BalancerStrategy, TopologyInput } from "./utils/topologyOptions";
export { DEFAULT_TOPOLOGY_OPTIONS, balancerMemberTags, trafficTagsFor } from "./utils/topologyOptions";

export type ProtocolType = "vmess" | "vless" | "trojan" | "ss" | "ssr" | "socks" | "hysteria2" | "tuic" | "shadowtls";

/**
 * Task 11 dual-core: which core binary runs a config. Xray keeps everything
 * it ever supported; sing-box serves ONLY the protocols Xray never
 * supported natively (hysteria2, tuic, and since Task E2 the MEMENTO
 * ShadowTLS pair — Xray has no ShadowTLS at all, live-probed 2026-09-21).
 */
export type CoreKind = "xray" | "sing-box";

/** The sing-box-only protocols — kept in ONE place so the parser, the
 *  config generators, the badge and the Editor banner can never drift.
 *  Task E2 adds "shadowtls": live-probed 2026-09-21 against the pinned
 *  cores, Xray 25.1.1 has NO ShadowTLS at all (config test exits 23 with
 *  "infra/conf: unknown config id: shadowtls") and sing-box 1.14.0 carries
 *  it ONLY as a transport that must be paired with an inner protocol — the
 *  MEMENTO scheme (memento-stls://) always carries that inner trojan
 *  credential, so it is sing-box-only BY CONSTRUCTION. */
export function isSingBoxProtocol(protocol: string): boolean {
  return protocol === "hysteria2" || protocol === "tuic" || protocol === "shadowtls";
}

/**
 * Resolves the core for a config. Prefers the core field stamped at import
 * time, but falls back to the protocol so configs saved to localStorage by
 * OLDER app versions (no core field) still route correctly.
 */
export function configCore(c: Pick<ParsedConfig, "protocol" | "core">): CoreKind {
  if (c.core) return c.core;
  return isSingBoxProtocol(c.protocol) ? "sing-box" : "xray";
}

export interface ParsedConfig {
  id: string;
  protocol: ProtocolType;
  name: string;
  address: string;
  port: number | string;
  uuid?: string;
  password?: string;
  /** Task 13 (A1): SOCKS5 username — socks:// links only (password field reused). */
  username?: string;
  security?: string;
  encryption?: string;
  network?: string;
  flow?: string;
  sni?: string;
  host?: string;
  path?: string;
  type?: string;
  fingerprint?: string;
  publicKey?: string;
  shortId?: string;
  spiderX?: string;
  alpn?: string;
  method?: string;
  /** Task 11: which core runs this config (stamped at import time). */
  core?: CoreKind;
  /** Task 11: hysteria2 obfs transport ("salamander") + its password. */
  obfs?: string;
  obfsPassword?: string;
  /** Task 11: hysteria2 TLS-skip flag from the link (insecure=1/true). */
  insecure?: boolean;
  /** Task 11: tuic udp_relay_mode ("native" | "quic"). */
  udpRelayMode?: string;
  /** Task E2: ShadowTLS transport version ("1" | "2" | "3"; the generator
   *  ALWAYS emits it explicitly — the pinned binary accepts exactly 1..3). */
  stlsVersion?: string;
  /** Task E2: ShadowTLS TRANSPORT password (the server-side users[]
   *  credential). The link's userinfo is the INNER trojan password
   *  (password field); without the transport password v2/v3 can never
   *  authenticate, so the parser rejects those links loudly. */
  stlsPassword?: string;
  raw: string;
  isValid: boolean;
  errorMessage?: string;
}

export type Theme = "dark" | "light";

export interface PingResultEntry {
  ping: number | null;
  error?: string;
  timestamp: number;
}

export interface SubscriptionGroup {
  id: string;
  name: string;
  subscriptionUrl?: string;           // optional
  autoUpdate: boolean;                // on/off
  updateIntervalMinutes?: number;     // e.g. 60
  lastUpdated?: number;               // timestamp
  configIds: string[];                // IDs of configs belonging to this group
  /** Phase D2 (item 1): server-reported usage (upload/download/total bytes +
   *  expire unix-seconds). Absent = server never reported it. fetchedAt marks
   *  when the value was captured (stale data stays visible + honest). Groups
   *  are persisted as one JSON blob, so this field rides along for free. */
  userInfo?: SubscriptionUserInfo & { fetchedAt: number };
}

export type ConnStatus = "disconnected" | "connecting" | "connected" | "error";
export type ConnMode = "direct" | "system-proxy" | "tun";

/* ===================== Task 12: Aether (SOCKS5-only) =====================
 * Renderer-side mirror of electron/aether.ts — keep the shapes in sync.
 * "smart" is a MEMENTO-side candidate loop, NOT a core protocol value. */
export type AetherProtocolMode = "smart" | "masque" | "wg" | "gool";
export type AetherScanMode = "turbo" | "balanced" | "thorough" | "stealth" | "ironclad";
export type AetherIpMode = "v4" | "v6" | "both";
export type AetherNoize = "default" | "off" | "light" | "firewall" | "balanced" | "gfw" | "aggressive";
export type AetherLogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type AetherEchMode = "off" | "auto" | "custom";

export interface AetherSettings {
  protocol: AetherProtocolMode;
  scanMode: AetherScanMode;
  socksPort: number;
  endpoint: string;
  noize: AetherNoize;
  ipMode: AetherIpMode;
  dns: string;
  routeBlock: string;
  routeDirect: string;
  routesFile: string;
  httpProxyEnabled: boolean;
  httpProxyPort: number;
  upstream: string;
  ech: AetherEchMode;
  echBase64: string;
  fragment: boolean;
  masqueHttp2: boolean;
  quickReconnect: boolean;
  logLevel: AetherLogLevel;
  wiwOuter: string;
  wiwInner: string;
  wgForceOuter: string;
  wgKeepalive: string;
}

export const DEFAULT_AETHER_SETTINGS: AetherSettings = {
  protocol: "gool", // live-verified fastest (4.8 s vs masque 121.5 s) + Aethon GUI default parity
  scanMode: "balanced", // core default
  socksPort: 1819, // core default bind port
  endpoint: "",
  noize: "default", // omit AETHER_NOIZE → core's protocol-aware profile
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

/** Aether tab connection state — deliberately SEPARATE from the config-based
 *  conn* fields so the ConnectionManager watcher / auto-failover logic for
 *  config connections can never collide with the Aether session. */
export type AetherConnStatus = "disconnected" | "connecting" | "connected" | "error";

export interface AetherLiveInfo {
  running: boolean;
  pid: number | null;
  socks_port: number;
  http_port: number;
  core: "aether";
  ready: boolean;
  smart: boolean;
  candidate: string | null;
  candidateIndex: number;
  candidateTotal: number;
}


export interface AutoFailoverSettings {
  enabled: boolean;
  /** Pick replacement configs from the same subscription group as the one that failed, or from all configs. */
  scope: "group" | "all";
  /** Require the replacement config to use the exact same port as the one that failed. */
  matchPort: boolean;
}

/* ===================== Phase B2: VPN Device (TUN) routing =====================
 *
 * The Aether tab's routing segment chooses HOW the tunnel reaches apps:
 * "socks" (the pre-B2 behavior — local SOCKS5 listener + the optional
 * system-proxy toggle) or "vpn-device" (the B1 TUN machinery — a
 * MementoTun adapter routes ALL system traffic into the active core's
 * local inbound; UAC-elevated helper; D6 semantics).
 *
 * RoutingStatusViewWire mirrors electron/routingManager.ts's wire shape
 * (renderer NEVER imports main-process modules — the AetherLiveInfo
 * pattern). The D5 names (interfaceName/helperRole) arrive FROM the main
 * process; no renderer file hardcodes them.
 */
export type AetherRoutingMode = "socks" | "vpn-device";

export type RoutingViewStateWire =
  | "starting"
  | "connected"
  | "reconnecting"
  | "restoring"
  | "disabled"
  | "error"
  | "idle";

export interface RoutingStatusViewWire {
  active: boolean;
  state: RoutingViewStateWire;
  message: string;
  enginePid: number;
  interfaceName: string;
  helperRole: string;
  killSwitchArmed: boolean;
  suppressSystemProxy: boolean;
  sessionDir: string | null;
  updatedAtMs: number | null;
  /** R3 task #2: async elevation outcome (UAC accepted/cancelled/failed). */
  launchFeedback?: { ok: boolean; message: string; atMs: number } | null;
}

interface AppState {
  /* ===================== Live VPN Connection (global — survives tab switches) ===================== */
  connStatus: ConnStatus;
  connConfigId: string | null;
  connPid: number | null;
  connStartedAt: number | null;
  connMode: ConnMode;
  connSocksPort: number;
  connHttpPort: number;
  connApiPort: number;
  connDownloadBytes: number;
  connUploadBytes: number;
  /** Phase D1: live throughput in BYTES/SECOND, derived in ConnectionManager
   *  from the delta between consecutive traffic polls (3 s apart). Zero when
   *  idle/disconnected — never persisted, never restored. */
  connDownSpeed: number;
  connUpSpeed: number;
  connLogs: string[];
  /** True when the user explicitly clicked Disconnect — tells the auto-failover watcher to stay out of it. */
  connManualStop: boolean;
  autoFailover: AutoFailoverSettings;
  /** Phase D2 (item 9): user-toggles over the config-generator knobs.
   *  Defaults reproduce the previous hardcoded behavior exactly. */
  builderOptions: BuilderOptions;
  setBuilderOptions: (patch: Partial<BuilderOptions>) => void;
  /** Phase C3 (items 1+2): routing presets/lists + DNS/FakeDNS options.
   *  Same discipline as builderOptions: standalone module, localStorage
   *  persistence, defaults = the pre-C3 behavior byte-for-byte. */
  routingOptions: RoutingOptions;
  setRoutingOptions: (patch: Partial<RoutingOptions>) => void;
  /** Phase C4 (item ⑥): chain proxy + balancer toggles. Same discipline:
   *  standalone module, localStorage persistence, defaults = pre-C4
   *  behavior byte-for-byte (no hop, no pool, plain ["proxy"] stats). */
  topologyOptions: TopologyOptions;
  setTopologyOptions: (patch: Partial<TopologyOptions>) => void;
  /** Phase C3: last geo_status snapshot from the main process (null until
   *  the first geo_status roundtrip; browser preview stays null and the
   *  Routing tab shows the honest "Desktop only" card). */
  geoStatus: GeoStatus | null;
  setGeoStatus: (s: GeoStatus | null) => void;
  /** C3 fix (user-approved): true while connectToConfig is inside the geo
   *  gate (geo_ensure download). Drives the ConnectionTab "Preparing geo
   *  data…" disabled button + the connect-flow re-entry guard — the gate
   *  can take up to ~120s/file on a slow network and the UI must never
   *  look unresponsive during it. */
  geoPreparing: boolean;
  setGeoPreparing: (v: boolean) => void;
  /** Phase C5 (kill switch): UI mirror of the appPrefs.killSwitch field
   *  (the ENFORCEMENT lives main-side in killSwitch.ts — this boolean only
   *  drives the Settings toggle + the Connection-tab blocked banner). The
   *  immediate block/clear transition for arming/disarming while no core
   *  runs rides the serialized main-side app_prefs_set handler
   *  (fire-and-forget, serialized main-side). */
  killSwitchArmed: boolean;
  setKillSwitchArmed: (armed: boolean, opts?: { persist?: boolean }) => void;
  setConnState: (patch: Partial<{
    connStatus: ConnStatus;
    connConfigId: string | null;
    connPid: number | null;
    connStartedAt: number | null;
    connMode: ConnMode;
    connSocksPort: number;
    connHttpPort: number;
    connApiPort: number;
    connDownloadBytes: number;
    connUploadBytes: number;
    connDownSpeed: number;
    connUpSpeed: number;
    connLogs: string[];
    connManualStop: boolean;
  }>) => void;
  setAutoFailover: (patch: Partial<AutoFailoverSettings>) => void;

  /* ===================== Task 12: Aether (global — survives tab switches) ===================== */
  aetherSettings: AetherSettings;
  aetherStatus: AetherConnStatus;
  /** Last status snapshot from aether_status (readiness/smart-candidate). */
  aetherInfo: AetherLiveInfo | null;
  /** Monotonic attempt id — stale connect attempts must not clobber state. */
  aetherAttempt: number;
  /** Renderer-side system-proxy toggle for the AETHER session (default OFF
   *  per approved decision; the main process never touches the registry for
   *  aether — this renderer toggle owns set/clear_system_proxy). */
  aetherSystemProxy: boolean;
  /** Phase B2: the Aether tab's routing segment (persisted). Connect-time
   *  choice — switching mid-session is refused by the UI. */
  aetherMode: AetherRoutingMode;
  /** Phase B2: last routing_status snapshot (null until the first
   *  roundtrip; browser preview gets the honest idle mirror). */
  routingView: RoutingStatusViewWire | null;
  setAetherSettings: (patch: Partial<AetherSettings>) => void;
  setAetherMode: (mode: AetherRoutingMode) => void;
  setRoutingView: (v: RoutingStatusViewWire | null) => void;
  setAetherState: (patch: Partial<{
    aetherStatus: AetherConnStatus;
    aetherInfo: AetherLiveInfo | null;
    aetherAttempt: number;
    aetherSystemProxy: boolean;
  }>) => void;

  theme: Theme;
  language: Language;
  configs: ParsedConfig[];
  selectedIds: Set<string>;
  filter: string;
  searchTerm: string;
  activeTab: string;
  notificationMode: "none" | "toast" | "sound" | "both";
  /** Shared ping results: configId → PingResultEntry */
  pingResults: Record<string, PingResultEntry>;

  /** Subscription Groups (like V2RayN) */
  subscriptionGroups: SubscriptionGroup[];

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLanguage: (lang: Language) => void;
  setNotificationMode: (mode: "none" | "toast" | "sound" | "both") => void;
  addConfigs: (rawLinks: string[]) => void;
  clearConfigs: () => void;
  removeConfigs: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  setSelectedIds: (ids: Iterable<string>) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setFilter: (filter: string) => void;
  setSearchTerm: (term: string) => void;
  setActiveTab: (tab: string) => void;
  getFilteredConfigs: () => ParsedConfig[];
  /** Set ping result for a single config */
  setPingResult: (configId: string, ping: number | null, error?: string) => void;
  /** Bulk set ping results */
  setPingResults: (results: Record<string, PingResultEntry>) => void;
  /** Clear all ping results */
  clearPingResults: () => void;

  /** Subscription Group management */
  addSubscriptionGroup: (group: Omit<SubscriptionGroup, "id" | "configIds">) => string;
  removeSubscriptionGroup: (groupId: string) => void;
  updateSubscriptionGroup: (groupId: string, updates: Partial<SubscriptionGroup>) => void;
  addConfigsToGroup: (groupId: string, configIds: string[]) => void;
  removeConfigsFromGroup: (groupId: string, configIds: string[]) => void;
  getConfigsByGroup: (groupId: string) => ParsedConfig[];
}

function generateId(): string {
  return Math.random().toString(36).substr(2, 11);
}

function parseVmess(encodedData: string): Partial<ParsedConfig> {
  try {
    let padded = encodedData;
    if (padded.length % 4 > 0) {
      padded += "=".repeat(4 - (padded.length % 4));
    }
    const jsonStr = atob(padded);
    const obj = JSON.parse(jsonStr);
    return {
      protocol: "vmess",
      name: obj.ps || "",
      address: obj.add || "",
      port: obj.port || "",
      uuid: obj.id || "",
      security: obj.scy || obj.security || "auto",
      encryption: obj.scy || "auto",
      network: obj.net || "tcp",
      type: obj.type || "none",
      host: obj.host || "",
      path: obj.path || "",
      fingerprint: obj.fp || "",
      sni: obj.sni || "",
    };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode VMess config" };
  }
}

function parseVless(raw: string): Partial<ParsedConfig> {
  try {
    const urlPart = raw.replace("vless://", "");
    const hashIdx = urlPart.lastIndexOf("#");
    let name = "";
    let core = urlPart;
    if (hashIdx > -1) {
      name = decodeURIComponent(urlPart.slice(hashIdx + 1));
      core = urlPart.slice(0, hashIdx);
    }

    const [userAtHost, ...queryParts] = core.split("?");
    const queryStr = queryParts.join("?");
    const atIdx = userAtHost.lastIndexOf("@");
    if (atIdx === -1) throw new Error("Invalid VLESS URL");
    const uuid = userAtHost.slice(0, atIdx);
    const hostPort = userAtHost.slice(atIdx + 1);
    const colonIdx = hostPort.lastIndexOf(":");
    const address = hostPort.slice(0, colonIdx);
    const port = hostPort.slice(colonIdx + 1);

    const params = new URLSearchParams(queryStr);

    return {
      protocol: "vless",
      name,
      address,
      port,
      uuid,
      encryption: params.get("encryption") || "none",
      security: params.get("security") || "none",
      sni: params.get("sni") || "",
      flow: params.get("flow") || "",
      fingerprint: params.get("fp") || "",
      publicKey: params.get("pbk") || "",
      shortId: params.get("sid") || "",
      type: params.get("type") || "tcp",
      host: params.get("host") || "",
      path: params.get("path") || "",
      network: params.get("type") || "tcp",
    };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode VLESS config" };
  }
}

function parseTrojan(raw: string): Partial<ParsedConfig> {
  try {
    const urlPart = raw.replace("trojan://", "");
    const hashIdx = urlPart.lastIndexOf("#");
    let name = "";
    let core = urlPart;
    if (hashIdx > -1) {
      name = decodeURIComponent(urlPart.slice(hashIdx + 1));
      core = urlPart.slice(0, hashIdx);
    }

    const [passwordAtHost, ...queryParts] = core.split("?");
    const queryStr = queryParts.join("?");
    const atIdx = passwordAtHost.lastIndexOf("@");
    if (atIdx === -1) throw new Error("Invalid Trojan URL");
    const password = passwordAtHost.slice(0, atIdx);
    const hostPort = passwordAtHost.slice(atIdx + 1);
    const colonIdx = hostPort.lastIndexOf(":");
    const address = hostPort.slice(0, colonIdx);
    const port = hostPort.slice(colonIdx + 1);

    const params = new URLSearchParams(queryStr);

    return {
      protocol: "trojan",
      name,
      address,
      port,
      password,
      security: params.get("security") || "tls",
      sni: params.get("sni") || "",
      fingerprint: params.get("fp") || "",
      type: params.get("type") || "tcp",
      host: params.get("host") || "",
      path: params.get("path") || "",
      network: params.get("type") || "tcp",
    };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode Trojan config" };
  }
}

function parseSS(raw: string): Partial<ParsedConfig> {
  try {
    const urlPart = raw.replace("ss://", "");
    const hashIdx = urlPart.lastIndexOf("#");
    let name = "";
    let core = urlPart;
    if (hashIdx > -1) {
      name = decodeURIComponent(urlPart.slice(hashIdx + 1));
      core = urlPart.slice(0, hashIdx);
    }

    // Check if it's SIP002 format (contains @)
    if (core.includes("@")) {
      const [enc, hostPort] = core.split("@");
      let decodedEnc = enc;
      try {
        let padded = enc;
        if (padded.length % 4 > 0) padded += "=".repeat(4 - (padded.length % 4));
        decodedEnc = atob(padded);
      } catch {}
      const [method, password] = decodedEnc.split(":");
      const colonIdx = hostPort.lastIndexOf(":");
      const address = hostPort.slice(0, colonIdx);
      const port = hostPort.slice(colonIdx + 1);
      return { protocol: "ss", name, address, port, method, password };
    } else {
      // Legacy base64 format
      let padded = core;
      if (padded.length % 4 > 0) padded += "=".repeat(4 - (padded.length % 4));
      const decoded = atob(padded);
      const parts = decoded.split("@");
      if (parts.length === 2) {
        const [methodPass, hostPort] = parts;
        const [method, password] = methodPass.split(":");
        const colonIdx = hostPort.lastIndexOf(":");
        const address = hostPort.slice(0, colonIdx);
        const port = hostPort.slice(colonIdx + 1);
        return { protocol: "ss", name, address, port, method, password };
      } else {
        const [method, password, hostPort] = parts[0].split(":");
        const colonIdx = hostPort.lastIndexOf(":");
        // This path is fallback, unlikely to hit
        const address = hostPort.slice(0, colonIdx) || hostPort;
        const port = colonIdx > -1 ? hostPort.slice(colonIdx + 1) : "";
        return { protocol: "ss", name, address, port, method, password };
      }
    }
  } catch {
    return { isValid: false, errorMessage: "Failed to decode Shadowsocks config" };
  }
}

function parseSSR(raw: string): Partial<ParsedConfig> {
  try {
    const urlPart = raw.replace("ssr://", "");
    let padded = urlPart;
    if (padded.length % 4 > 0) padded += "=".repeat(4 - (padded.length % 4));
    const decoded = atob(padded);
    // ssr format: server:port:protocol:method:obfs:base64password/?params...
    const [core, ...queryParts] = decoded.split("/?");
    const parts = core.split(":");
    if (parts.length < 6) throw new Error("Invalid SSR format");

    const address = parts[0];
    const port = parts[1];
    const protocol = parts[2];
    const method = parts[3];
    const obfs = parts[4];
    const passwordB64 = parts[5];

    let password = passwordB64;
    try {
      let p = passwordB64;
      if (p.length % 4 > 0) p += "=".repeat(4 - (p.length % 4));
      password = atob(p);
    } catch {}

    // Parse query params for name
    const queryStr = queryParts.join("/?");
    const params = new URLSearchParams(queryStr);
    let name = "";
    const remarks = params.get("remarks");
    if (remarks) {
      try {
        let r = remarks;
        if (r.length % 4 > 0) r += "=".repeat(4 - (r.length % 4));
        name = atob(r);
      } catch {
        name = remarks;
      }
    }

    return {
      protocol: "ssr",
      name,
      address,
      port,
      method,
      password,
      type: obfs,
      network: protocol,
    };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode SSR config" };
  }
}

function parseHysteria2(raw: string): Partial<ParsedConfig> {
  try {
    const urlPart = raw.replace("hysteria2://", "").replace("hy2://", "");
    const hashIdx = urlPart.lastIndexOf("#");
    let name = "";
    let core = urlPart;
    if (hashIdx > -1) {
      name = decodeURIComponent(urlPart.slice(hashIdx + 1));
      core = urlPart.slice(0, hashIdx);
    }
    const [passwordAtHost, ...queryParts] = core.split("?");
    const queryStr = queryParts.join("?");
    const atIdx = passwordAtHost.lastIndexOf("@");
    const password = atIdx > -1 ? passwordAtHost.slice(0, atIdx) : "";
    const hostPort = atIdx > -1 ? passwordAtHost.slice(atIdx + 1) : passwordAtHost;
    const colonIdx = hostPort.lastIndexOf(":");
    const address = hostPort.slice(0, colonIdx);
    const port = hostPort.slice(colonIdx + 1);
    const params = new URLSearchParams(queryStr);

    return {
      protocol: "hysteria2",
      name,
      address,
      port,
      password,
      sni: params.get("sni") || "",
      // Task 11: obfs transport + password + TLS-skip flag.
      obfs: params.get("obfs") || "",
      obfsPassword: params.get("obfs-password") || "",
      insecure: params.get("insecure") === "1" || params.get("insecure") === "true",
      type: "hysteria2",
    };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode Hysteria2 config" };
  }
}

function parseTUIC(raw: string): Partial<ParsedConfig> {
  try {
    const urlPart = raw.replace("tuic://", "");
    const hashIdx = urlPart.lastIndexOf("#");
    let name = "";
    let core = urlPart;
    if (hashIdx > -1) {
      name = decodeURIComponent(urlPart.slice(hashIdx + 1));
      core = urlPart.slice(0, hashIdx);
    }
    const [credAtHost, ...queryParts] = core.split("?");
    const queryStr = queryParts.join("?");
    const atIdx = credAtHost.lastIndexOf("@");
    const creds = atIdx > -1 ? credAtHost.slice(0, atIdx) : "";
    const hostPort = atIdx > -1 ? credAtHost.slice(atIdx + 1) : credAtHost;
    const colonIdx = hostPort.lastIndexOf(":");
    const address = hostPort.slice(0, colonIdx);
    const port = hostPort.slice(colonIdx + 1);
    const [uuid, password] = creds.includes(":") ? creds.split(":") : [creds, ""];
    const params = new URLSearchParams(queryStr);

    return {
      protocol: "tuic",
      name,
      address,
      port,
      uuid,
      password,
      sni: params.get("sni") || "",
      // Task 11: udp_relay_mode + alpn (congestion_control keeps using type).
      udpRelayMode: params.get("udp_relay_mode") || "",
      alpn: params.get("alpn") || "",
      type: params.get("congestion_control") || "cubic",
    };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode TUIC config" };
  }
}

/**
 * Task E2: MEMENTO ShadowTLS scheme — NON-STANDARD by design (no
 * industrial-standard ShadowTLS URI exists; a fake "shadowtls://" would
 * mislead, so MEMENTO owns this scheme and the UI labels it as
 * proprietary). ShadowTLS is a TRANSPORT, not a standalone proxy
 * (live-probe P5: a bare shadowtls outbound passes `sing-box check` but
 * carries NO traffic — the inner stream must be terminated by a real
 * protocol), so the userinfo carries the INNER trojan credential and the
 * ShadowTLS transport parameters ride the query string:
 *
 *   memento-stls://<trojan-pass>@host:port?version=3
 *     &stls-password=<transport-pass>&sni=<camo-domain>
 *     &insecure=0|1&alpn=h2#Name
 *
 * Live contract (scripts/taskE2-live-tmp/probe-e2.json, pinned cores):
 *   - P1: sing-box 1.14.0 requires the outbound TLS block for EVERY
 *     version (1/2/3 all FATAL "TLS required" without it) and rejects
 *     version > 3; the schema strictly rejects unknown fields.
 *   - P2: Xray 25.1.1 does not know the protocol ("unknown config id:
 *     shadowtls", exit 23) — sing-box-only, enforced via isSingBoxProtocol.
 *   - P4: the exact paired outbound shape generated by singBoxConfig.ts
 *     from this parse carried real loopback traffic end-to-end (200:14336).
 */
function parseShadowTLS(raw: string): Partial<ParsedConfig> {
  try {
    const urlPart = raw.replace("memento-stls://", "");
    const hashIdx = urlPart.lastIndexOf("#");
    let name = "";
    let core = urlPart;
    if (hashIdx > -1) {
      name = decodeURIComponent(urlPart.slice(hashIdx + 1));
      core = urlPart.slice(0, hashIdx);
    }
    const [passAtHost, ...queryParts] = core.split("?");
    const queryStr = queryParts.join("?");
    const atIdx = passAtHost.lastIndexOf("@");
    const trojanPassword = atIdx > -1 ? passAtHost.slice(0, atIdx) : "";
    const hostPort = atIdx > -1 ? passAtHost.slice(atIdx + 1) : passAtHost;
    const colonIdx = hostPort.lastIndexOf(":");
    const address = hostPort.slice(0, colonIdx);
    const port = hostPort.slice(colonIdx + 1);
    const params = new URLSearchParams(queryStr);

    const version = params.get("version") || "3";
    const stlsPassword = params.get("stls-password") || "";
    // Honest validation (approved design E2-D2): the pinned binary accepts
    // exactly versions 1..3 (probe P1-F: v4 -> FATAL unknown protocol
    // version), and v2/v3 authenticate the transport with stls-password
    // (probe P3: the server field is users[], not password) — a v2/v3 link
    // without it can never connect, so it is rejected here, loudly.
    if (version !== "1" && version !== "2" && version !== "3") {
      return { isValid: false, errorMessage: "Invalid ShadowTLS version (expected 1, 2 or 3)" };
    }
    if ((version === "2" || version === "3") && !stlsPassword) {
      return { isValid: false, errorMessage: "ShadowTLS v2/v3 requires stls-password" };
    }

    return {
      protocol: "shadowtls",
      name,
      address,
      port,
      password: trojanPassword,
      stlsVersion: version,
      stlsPassword,
      sni: params.get("sni") || "",
      insecure: params.get("insecure") === "1" || params.get("insecure") === "true",
      alpn: params.get("alpn") || "",
      type: "shadowtls",
    };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode MEMENTO ShadowTLS config" };
  }
}

/**
 * Padding- and url-safe-tolerant atob (the parseSS pattern).
 * Returns null when the input is not decodable base64 — callers decide
 * whether that is a rejection or a fallback.
 */
function tryBase64Decode(s: string): string | null {
  try {
    let t = s.replace(/-/g, "+").replace(/_/g, "/");
    if (t.length % 4 > 0) t += "=".repeat(4 - (t.length % 4));
    return atob(t);
  } catch {
    return null;
  }
}

/**
 * Task 13 (A1): native SOCKS5 share links — socks:// and socks5://.
 *
 * The "socks" URI scheme is NOT registered at IANA (verified 2026-09);
 * the de-facto reference implemented here is v2rayN's SocksFmt.cs
 * (captured at scripts/socks-report/SocksFmt.cs):
 *
 *   URI form   socks://[userinfo@]host:port[#remark][?query]
 *     - userinfo is percent-decoded first, then:
 *         contains ":" -> plain user:pass, split at the FIRST colon
 *                         (the password may itself contain colons);
 *         otherwise    -> treated as base64 (unpadded / url-safe
 *                         tolerated) of user:pass — v2rayN's own export
 *                         emits base64url("user:pass"), so base64(":")
 *                         = "Og" = empty creds = anonymous (this is the
 *                         exact shape of the user's sample link);
 *         absent       -> anonymous.
 *     - deliberate deviation from v2rayN: when userinfo EXISTS but cannot
 *       be decoded into user:pass, v2rayN silently falls back to an
 *       ANONYMOUS profile; we REJECT with a clear error instead — a silent
 *       anonymous connect would only fail later at server auth with a
 *       misleading "server unreachable".
 *
 *   Legacy form (no "@" after the scheme): the whole body is base64 of
 *   "user:pass@host:port". The decoded payload must contain exactly one
 *   "@" and creds of exactly user:pass (v2rayN ResolveSocks parity).
 *
 * Malformed input never throws: every rejection returns
 * { isValid:false, errorMessage } with a human-readable reason, and the
 * host:port pair is built only after strict validation (no wrong-address
 * construction).
 */
function parseSocks(raw: string): Partial<ParsedConfig> {
  try {
    if (!/^socks5?:\/\//i.test(raw)) {
      return { isValid: false, errorMessage: "Invalid SOCKS link: missing socks:// scheme" };
    }
    let body = raw.replace(/^socks5?:\/\//i, "");

    // Remark = "#fragment" (percent-decoded); "?query" is tolerated and ignored.
    let name = "";
    const hashIdx = body.indexOf("#");
    if (hashIdx > -1) {
      try { name = decodeURIComponent(body.slice(hashIdx + 1)); }
      catch { name = body.slice(hashIdx + 1); }
      body = body.slice(0, hashIdx);
    }
    const qIdx = body.indexOf("?");
    if (qIdx > -1) body = body.slice(0, qIdx);
    if (!body) {
      return { isValid: false, errorMessage: "Invalid SOCKS link: empty host:port" };
    }

    let hostPort = "";
    let creds: string | null = null; // null = anonymous

    const atIdx = body.lastIndexOf("@");
    if (atIdx > -1) {
      // URI form with userinfo
      hostPort = body.slice(atIdx + 1);
      let userinfo = body.slice(0, atIdx);
      try { userinfo = decodeURIComponent(userinfo); } catch { /* keep raw */ }
      if (userinfo.includes(":")) {
        creds = userinfo;
      } else {
        const decoded = tryBase64Decode(userinfo);
        if (decoded === null || !decoded.includes(":")) {
          return {
            isValid: false,
            errorMessage: "Invalid SOCKS link: userinfo must be user:pass (plain or base64-encoded)",
          };
        }
        creds = decoded;
      }
    } else if (body.includes(":")) {
      // No userinfo — plain anonymous host:port (e.g. socks://1.2.3.4:1080)
      hostPort = body;
    } else {
      // Legacy whole-string base64: base64("user:pass@host:port")
      const decoded = tryBase64Decode(body);
      if (decoded === null || !decoded.includes("@")) {
        return {
          isValid: false,
          errorMessage:
            "Invalid SOCKS link: body is neither host:port nor valid base64 of user:pass@host:port",
        };
      }
      const parts = decoded.split("@");
      if (parts.length !== 2 || parts[0].split(":").length !== 2) {
        return {
          isValid: false,
          errorMessage: "Invalid SOCKS link: base64 payload must decode to user:pass@host:port",
        };
      }
      creds = parts[0];
      hostPort = parts[1];
    }

    // ---- host:port (shared by every variant; lastIndexOf for IPv6) ----
    const colonIdx = hostPort.lastIndexOf(":");
    if (colonIdx === -1) {
      return { isValid: false, errorMessage: "Invalid SOCKS link: missing port" };
    }
    let address = hostPort.slice(0, colonIdx).trim();
    const portStr = hostPort.slice(colonIdx + 1).trim();
    if (address.startsWith("[") && address.endsWith("]")) {
      address = address.slice(1, -1); // bracketed IPv6 -> bare address
    }
    if (!address) {
      return { isValid: false, errorMessage: "Invalid SOCKS link: empty host" };
    }
    if (!/^\d+$/.test(portStr)) {
      return { isValid: false, errorMessage: `Invalid SOCKS link: non-numeric port "${portStr.slice(0, 16)}"` };
    }
    const portNum = Number(portStr);
    if (portNum < 1 || portNum > 65535) {
      return { isValid: false, errorMessage: `Invalid SOCKS link: port out of range (${portStr.slice(0, 16)})` };
    }

    let username = "";
    let password = "";
    if (creds !== null) {
      const cIdx = creds.indexOf(":"); // FIRST colon — password may contain more (v2rayN Split(":", 2))
      username = creds.slice(0, cIdx);
      password = creds.slice(cIdx + 1);
    }

    return { protocol: "socks", name, address, port: portNum, username, password };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode SOCKS config" };
  }
}

export function parseSingleLink(rawLink: string): ParsedConfig {
  const trimmed = rawLink.trim();
  if (!trimmed) {
    return {
      id: generateId(),
      protocol: "vmess",
      name: "",
      address: "",
      port: "",
      raw: trimmed,
      isValid: false,
      errorMessage: "Empty link",
    };
  }

  let parsed: Partial<ParsedConfig> = {};

  if (trimmed.startsWith("vmess://")) {
    parsed = parseVmess(trimmed.replace("vmess://", ""));
    parsed.protocol = "vmess";
  } else if (trimmed.startsWith("vless://")) {
    parsed = parseVless(trimmed);
    parsed.protocol = "vless";
  } else if (trimmed.startsWith("trojan://")) {
    parsed = parseTrojan(trimmed);
    parsed.protocol = "trojan";
  } else if (trimmed.startsWith("ssr://")) {
    parsed = parseSSR(trimmed);
    parsed.protocol = "ssr";
  } else if (trimmed.startsWith("ss://")) {
    parsed = parseSS(trimmed);
    parsed.protocol = "ss";
  } else if (trimmed.startsWith("hysteria2://") || trimmed.startsWith("hy2://")) {
    parsed = parseHysteria2(trimmed);
    parsed.protocol = "hysteria2";
  } else if (trimmed.startsWith("tuic://")) {
    parsed = parseTUIC(trimmed);
    parsed.protocol = "tuic";
  } else if (trimmed.startsWith("memento-stls://")) {
    // Task E2: the MEMENTO ShadowTLS scheme (proprietary — see the
    // parseShadowTLS docblock; the UI discloses its non-standardness).
    parsed = parseShadowTLS(trimmed);
    parsed.protocol = "shadowtls";
  } else if (trimmed.startsWith("socks://") || trimmed.startsWith("socks5://")) {
    parsed = parseSocks(trimmed);
    parsed.protocol = "socks";
  } else {
    return {
      id: generateId(),
      protocol: "vmess",
      name: "",
      address: "",
      port: "",
      raw: trimmed,
      isValid: false,
      errorMessage: "Unknown protocol: " + trimmed.slice(0, 30),
    };
  }

  return {
    id: generateId(),
    protocol: parsed.protocol || "vmess",
    name: parsed.name || "",
    address: parsed.address || "",
    port: parsed.port || "",
    uuid: parsed.uuid || "",
    password: parsed.password || "",
    username: parsed.username || "",
    security: parsed.security || "",
    encryption: parsed.encryption || "",
    network: parsed.network || "",
    flow: parsed.flow || "",
    sni: parsed.sni || "",
    host: parsed.host || "",
    path: parsed.path || "",
    type: parsed.type || "",
    fingerprint: parsed.fingerprint || "",
    publicKey: parsed.publicKey || "",
    shortId: parsed.shortId || "",
    alpn: parsed.alpn || "",
    method: parsed.method || "",
    // Task 11: dual-core pass-through + core stamp by scheme.
    core: parsed.core || (isSingBoxProtocol(parsed.protocol || "") ? "sing-box" : "xray"),
    obfs: parsed.obfs || "",
    obfsPassword: parsed.obfsPassword || "",
    insecure: parsed.insecure,
    udpRelayMode: parsed.udpRelayMode || "",
    // Task E2: ShadowTLS transport pair (version always explicit downstream).
    stlsVersion: parsed.stlsVersion || "",
    stlsPassword: parsed.stlsPassword || "",
    raw: trimmed,
    isValid: parsed.isValid !== undefined ? parsed.isValid : true,
    errorMessage: parsed.errorMessage,
  };
}

// Decode a subscription (base64 encoded list of links)
function decodeSubscription(content: string): string[] {
  try {
    const trimmed = content.trim();
    let padded = trimmed;
    if (padded.length % 4 > 0) padded += "=".repeat(4 - (padded.length % 4));
    const decoded = atob(padded);
    return decoded.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  } catch {
    // Not a subscription, treat as single link
    return [content];
  }
}

/** Persist the subscription groups list to localStorage */
function saveGroups(groups: SubscriptionGroup[]) {
  try {
    localStorage.setItem("memento-subscription-groups", JSON.stringify(groups));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

/** Persist the configs list to localStorage so it survives app restarts */
function saveConfigs(configs: ParsedConfig[]) {
  try {
    localStorage.setItem("memento-configs", JSON.stringify(configs));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

/**
 * Removes references to configs that no longer exist from every group's
 * configIds array. This keeps the "count" shown next to each Subscription
 * Group perfectly in sync with the actual configs table — no matter how
 * configs were removed (Clear All, manual delete, etc).
 */
function pruneGroupConfigIds(configs: ParsedConfig[], groups: SubscriptionGroup[]): SubscriptionGroup[] {
  const validIds = new Set(configs.map(c => c.id));
  let changed = false;
  const pruned = groups.map(g => {
    const filteredIds = g.configIds.filter(id => validIds.has(id));
    if (filteredIds.length !== g.configIds.length) changed = true;
    return filteredIds.length !== g.configIds.length ? { ...g, configIds: filteredIds } : g;
  });
  return changed ? pruned : groups;
}

export const useStore = create<AppState>((set, get) => ({
  theme: (() => {
    try { return (localStorage.getItem("v2ray-editor-theme") as Theme) || "dark"; }
    catch { return "dark"; }
  })(),
  language: (() => {
    try { return (localStorage.getItem("v2ray-editor-language") as Language) || "en"; }
    catch { return "en"; }
  })(),
  configs: (() => {
    try {
      const saved = localStorage.getItem("memento-configs");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  })(),
  selectedIds: new Set<string>(),
  filter: "all",
  searchTerm: "",
  activeTab: "import",
  notificationMode: (() => {
    try { return (localStorage.getItem("v2ray-editor-notification") as any) || "both"; }
    catch { return "both"; }
  })(),
  pingResults: {},
  subscriptionGroups: (() => {
    try {
      const savedGroups = localStorage.getItem("memento-subscription-groups");
      const savedConfigs = localStorage.getItem("memento-configs");
      const groups: SubscriptionGroup[] = savedGroups ? JSON.parse(savedGroups) : [];
      const configs: ParsedConfig[] = savedConfigs ? JSON.parse(savedConfigs) : [];
      // Reconcile immediately on load in case a previous session left stale IDs
      const pruned = pruneGroupConfigIds(configs, groups);
      if (pruned !== groups) saveGroups(pruned);
      return pruned;
    } catch {
      return [];
    }
  })(),

  // Connection state always starts fresh on app launch — xray-core itself
  // never survives a full app restart (it's killed on window close), so
  // there is nothing meaningful to restore here. What matters is that this
  // lives in the GLOBAL store instead of a component's local useState, so
  // it survives switching between tabs while the app is running.
  connStatus: "disconnected",
  connConfigId: null,
  connPid: null,
  connStartedAt: null,
  connMode: (() => {
    try { return (localStorage.getItem("memento-conn-mode") as ConnMode) || "system-proxy"; }
    catch { return "system-proxy"; }
  })(),
  connSocksPort: (() => {
    try { return Number(localStorage.getItem("memento-conn-socks-port")) || 10808; }
    catch { return 10808; }
  })(),
  connHttpPort: (() => {
    try { return Number(localStorage.getItem("memento-conn-http-port")) || 10809; }
    catch { return 10809; }
  })(),
  connApiPort: 10850,
  connDownloadBytes: 0,
  connUploadBytes: 0,
  connDownSpeed: 0,
  connUpSpeed: 0,
  connLogs: [],
  connManualStop: false,
  autoFailover: (() => {
    try {
      const saved = localStorage.getItem("memento-auto-failover");
      return saved ? JSON.parse(saved) : { enabled: false, scope: "group", matchPort: false };
    } catch {
      return { enabled: false, scope: "group", matchPort: false };
    }
  })(),
  builderOptions: loadBuilderOptions(),
  routingOptions: loadRoutingOptions(),
  topologyOptions: loadTopologyOptions(),
  geoStatus: null,
  geoPreparing: false,
  killSwitchArmed: false, // Phase C5: boot-loaded from app_prefs_get (App.tsx)

  setBuilderOptions: (patch) => {
    set(state => {
      const next = { ...state.builderOptions, ...patch };
      try { localStorage.setItem(BUILDER_OPTIONS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return { builderOptions: next };
    });
  },

  setRoutingOptions: (patch) => {
    set(state => {
      const next = { ...state.routingOptions, ...patch };
      try { localStorage.setItem(ROUTING_OPTIONS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return { routingOptions: next };
    });
  },

  setTopologyOptions: (patch) => {
    set(state => {
      const next = { ...state.topologyOptions, ...patch };
      try { localStorage.setItem(TOPOLOGY_OPTIONS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return { topologyOptions: next };
    });
  },

  setGeoStatus: (s) => set({ geoStatus: s }),

  setGeoPreparing: (v) => set({ geoPreparing: v }),

  // Phase C5: the mirror only records the arm flag; the IMMEDIATE block/
  // clear transition for arming/disarming while no core is running is
  // main-side — the serialized app_prefs_set handler runs the immediate
  // arm/disarm transition).
  setKillSwitchArmed: (armed, opts) => {
    set({ killSwitchArmed: armed });
    // persist:false = the boot load (reply-is-authority): the value came
    // FROM the main process, so it must not be echoed back.
    if (opts?.persist === false) return;
    (window as any).electronAPI?.invoke("app_prefs_set", { patch: { killSwitch: armed } })?.catch(() => {});
  },

  setConnState: (patch) => {
    if ("connMode" in patch && patch.connMode) {
      try { localStorage.setItem("memento-conn-mode", patch.connMode); } catch { /* ignore */ }
    }
    if ("connSocksPort" in patch && patch.connSocksPort) {
      try { localStorage.setItem("memento-conn-socks-port", String(patch.connSocksPort)); } catch { /* ignore */ }
    }
    if ("connHttpPort" in patch && patch.connHttpPort) {
      try { localStorage.setItem("memento-conn-http-port", String(patch.connHttpPort)); } catch { /* ignore */ }
    }
    set(patch);
  },

  setAutoFailover: (patch) => {
    set(state => {
      const next = { ...state.autoFailover, ...patch };
      try { localStorage.setItem("memento-auto-failover", JSON.stringify(next)); } catch { /* ignore */ }
      return { autoFailover: next };
    });
  },

  /* ===================== Task 12: Aether ===================== */

  aetherSettings: (() => {
    // Single-blob persistence (memento-aether-settings) merged over the
    // defaults so settings saved by OLDER app versions (missing newer keys)
    // still load cleanly — the same forward-compat pattern as the configs.
    try {
      const saved = localStorage.getItem("memento-aether-settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_AETHER_SETTINGS, ...parsed };
      }
    } catch { /* fall through to defaults */ }
    return { ...DEFAULT_AETHER_SETTINGS };
  })(),
  aetherStatus: "disconnected",
  aetherInfo: null,
  aetherAttempt: 0,
  // Approved decision: system proxy defaults OFF for the Aether connection.
  aetherSystemProxy: false,
  // Phase B2: the routing segment defaults to the pre-B2 behavior.
  aetherMode: (() => {
    try {
      const v = localStorage.getItem("memento-aether-mode");
      if (v === "vpn-device" || v === "socks") return v as AetherRoutingMode;
    } catch { /* fall through to the default */ }
    return "socks" as AetherRoutingMode;
  })(),
  routingView: null,

  setAetherSettings: (patch) => {
    set(state => {
      const next = { ...state.aetherSettings, ...patch };
      try { localStorage.setItem("memento-aether-settings", JSON.stringify(next)); } catch { /* ignore */ }
      return { aetherSettings: next };
    });
  },

  setAetherState: (patch) => set(patch),

  setAetherMode: (mode) => {
    try { localStorage.setItem("memento-aether-mode", mode); } catch { /* ignore */ }
    set({ aetherMode: mode });
  },

  setRoutingView: (v) => set({ routingView: v }),

  setTheme: (theme) => {
    try { localStorage.setItem("v2ray-editor-theme", theme); } catch { /* storage unavailable (private mode/quota) — ignore */ }
    set({ theme });
  },

  toggleTheme: () => {
    const current = get().theme;
    const next = current === "dark" ? "light" : "dark";
    try { localStorage.setItem("v2ray-editor-theme", next); } catch { /* storage unavailable — ignore */ }
    set({ theme: next });
  },

  setLanguage: (lang) => {
    try { localStorage.setItem("v2ray-editor-language", lang); } catch { /* storage unavailable — ignore */ }
    set({ language: lang });
    // Phase D4: the tray menu + the one-time close balloon render in the
    // MAIN process, which has no access to localStorage — sync the UI
    // language into memento-app-prefs.json (fire-and-forget; ipc.ts
    // serializes concurrent app_prefs_set patches, so this can never race
    // with a Settings-tab toggle). Browser preview: no shell, skipped.
    try {
      (window as any).electronAPI?.invoke("app_prefs_set", { patch: { language: lang } })?.catch(() => {});
    } catch { /* browser preview — nothing to sync */ }
  },

  setNotificationMode: (mode) => {
    try { localStorage.setItem("v2ray-editor-notification", mode); } catch { /* storage unavailable — ignore */ }
    set({ notificationMode: mode });
  },

  addConfigs: (rawLinks) => {
    // R3 task #5 — IDENTITY-based dedupe (fixes the "subscription update
    // duplicates every config" bug). The old code compared RAW strings;
    // panels regenerate remarks/param-order on every update, so the raw
    // strings differed and every update re-imported the whole list.
    // Now: same canonical endpoint identity -> refresh IN PLACE (the id,
    // the group memberships and the ping history survive); genuinely new
    // endpoints -> appended; anything seen before (in the batch or in the
    // table) -> skipped.
    const existing = get().configs;
    const identityToIndex = new Map<string, number>();
    existing.forEach((c, i) => {
      const id = c.raw ? configIdentity(c.raw) : "";
      if (id && !identityToIndex.has(id)) identityToIndex.set(id, i);
    });

    const updated = [...existing];
    const newConfigs: ParsedConfig[] = [];
    const batchSeen = new Set<string>();
    let refreshed = 0;

    for (const link of rawLinks) {
      const decoded = decodeSubscription(link);
      for (const single of decoded) {
        if (!single) continue;
        const identity = configIdentity(single);
        if (identity) {
          if (batchSeen.has(identity)) continue;
          batchSeen.add(identity);
        }
        const parsed = parseSingleLink(single);
        const idx = identity ? identityToIndex.get(identity) : undefined;
        if (idx !== undefined) {
          // Same endpoint — refresh the stored fields, KEEP the identity
          // (id) so groups and ping results stay attached to it.
          const old = updated[idx];
          updated[idx] = { ...parsed, id: old.id };
          refreshed++;
        } else {
          if (identity) identityToIndex.set(identity, updated.length);
          updated.push(parsed);
          newConfigs.push(parsed);
        }
      }
    }

    if (newConfigs.length > 0 || refreshed > 0) {
      set({ configs: updated });
      saveConfigs(updated);
    }
  },

  clearConfigs: () => {
    // Wiping all configs — every group must lose its (now dangling) configIds too,
    // otherwise their displayed count would stay stuck at the old number.
    const clearedGroups = get().subscriptionGroups.map(g => ({ ...g, configIds: [] }));
    saveGroups(clearedGroups);
    saveConfigs([]);
    set({ configs: [], selectedIds: new Set(), subscriptionGroups: clearedGroups });
  },

  removeConfigs: (ids) => {
    const idSet = new Set(ids);
    const remainingConfigs = get().configs.filter(c => !idSet.has(c.id));
    // Strip the removed IDs from every group so counts stay accurate
    const updatedGroups = get().subscriptionGroups.map(g => {
      const filtered = g.configIds.filter(id => !idSet.has(id));
      return filtered.length !== g.configIds.length ? { ...g, configIds: filtered } : g;
    });
    saveConfigs(remainingConfigs);
    saveGroups(updatedGroups);
    set({
      configs: remainingConfigs,
      selectedIds: new Set(),
      subscriptionGroups: updatedGroups,
    });
  },

  toggleSelect: (id) => {
    const selected = new Set(get().selectedIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    set({ selectedIds: selected });
  },

  setSelectedIds: (ids) => set({ selectedIds: new Set(ids) }),

  selectAll: () => {
    const allIds = get().getFilteredConfigs().map(c => c.id);
    set({ selectedIds: new Set(allIds) });
  },

  deselectAll: () => set({ selectedIds: new Set() }),

  setFilter: (filter) => set({ filter }),
  setSearchTerm: (term) => set({ searchTerm: term }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  getFilteredConfigs: () => {
    const { configs, filter, searchTerm } = get();
    let result = [...configs];

    if (filter !== "all") {
      if (filter === "valid") result = result.filter(c => c.isValid);
      else if (filter === "invalid") result = result.filter(c => !c.isValid);
      else result = result.filter(c => c.protocol === filter);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(term) ||
        c.address.toLowerCase().includes(term) ||
        c.protocol.toLowerCase().includes(term) ||
        c.raw.toLowerCase().includes(term)
      );
    }

    return result;
  },

  setPingResult: (configId, ping, error) => {
    set(state => ({
      pingResults: {
        ...state.pingResults,
        [configId]: { ping, error, timestamp: Date.now() },
      },
    }));
  },

  setPingResults: (results) => {
    set(state => ({
      pingResults: { ...state.pingResults, ...results },
    }));
  },

  clearPingResults: () => set({ pingResults: {} }),

  /* ===================== Subscription Groups ===================== */

  addSubscriptionGroup: (groupData) => {
    const id = generateId();
    const newGroup: SubscriptionGroup = {
      ...groupData,
      id,
      configIds: [],
    };
    set(state => {
      const groups = [...state.subscriptionGroups, newGroup];
      saveGroups(groups);
      return { subscriptionGroups: groups };
    });
    return id;
  },

  removeSubscriptionGroup: (groupId) => {
    set(state => {
      const groups = state.subscriptionGroups.filter(g => g.id !== groupId);
      saveGroups(groups);
      return { subscriptionGroups: groups };
    });
  },

  updateSubscriptionGroup: (groupId, updates) => {
    set(state => {
      const groups = state.subscriptionGroups.map(g =>
        g.id === groupId ? { ...g, ...updates } : g
      );
      saveGroups(groups);
      return { subscriptionGroups: groups };
    });
  },

  addConfigsToGroup: (groupId, configIds) => {
    set(state => {
      // Only link IDs that correspond to configs that actually exist —
      // prevents orphaned/stale IDs from ever inflating a group's count.
      const validConfigIds = new Set(state.configs.map(c => c.id));
      const safeIncomingIds = configIds.filter(id => validConfigIds.has(id));

      const groups = state.subscriptionGroups.map(g => {
        if (g.id !== groupId) return g;
        const newIds = Array.from(new Set([...g.configIds, ...safeIncomingIds]));
        return { ...g, configIds: newIds };
      });
      saveGroups(groups);
      return { subscriptionGroups: groups };
    });
  },

  removeConfigsFromGroup: (groupId, configIds) => {
    set(state => {
      const groups = state.subscriptionGroups.map(g => {
        if (g.id !== groupId) return g;
        return { ...g, configIds: g.configIds.filter(id => !configIds.includes(id)) };
      });
      saveGroups(groups);
      return { subscriptionGroups: groups };
    });
  },

  getConfigsByGroup: (groupId) => {
    const group = get().subscriptionGroups.find(g => g.id === groupId);
    if (!group) return [];
    const idSet = new Set(group.configIds);
    return get().configs.filter(c => idSet.has(c.id));
  },

}));
