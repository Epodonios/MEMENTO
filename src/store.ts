import { create } from "zustand";
import type { Language } from "./i18n";

export type ProtocolType = "vmess" | "vless" | "trojan" | "ss" | "ssr" | "hysteria2" | "tuic";

export interface ParsedConfig {
  id: string;
  protocol: ProtocolType;
  name: string;
  address: string;
  port: number | string;
  uuid?: string;
  password?: string;
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
}

export type ConnStatus = "disconnected" | "connecting" | "connected" | "error";
export type ConnMode = "direct" | "system-proxy";

export interface AutoFailoverSettings {
  enabled: boolean;
  /** Pick replacement configs from the same subscription group as the one that failed, or from all configs. */
  scope: "group" | "all";
  /** Require the replacement config to use the exact same port as the one that failed. */
  matchPort: boolean;
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
  connLogs: string[];
  /** True when the user explicitly clicked Disconnect — tells the auto-failover watcher to stay out of it. */
  connManualStop: boolean;
  autoFailover: AutoFailoverSettings;
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
    connLogs: string[];
    connManualStop: boolean;
  }>) => void;
  setAutoFailover: (patch: Partial<AutoFailoverSettings>) => void;

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
      type: params.get("congestion_control") || "cubic",
    };
  } catch {
    return { isValid: false, errorMessage: "Failed to decode TUIC config" };
  }
}

function parseSingleLink(rawLink: string): ParsedConfig {
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
    method: parsed.method || "",
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

  setTheme: (theme) => {
    localStorage.setItem("v2ray-editor-theme", theme);
    set({ theme });
  },

  toggleTheme: () => {
    const current = get().theme;
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("v2ray-editor-theme", next);
    set({ theme: next });
  },

  setLanguage: (lang) => {
    localStorage.setItem("v2ray-editor-language", lang);
    set({ language: lang });
  },

  setNotificationMode: (mode) => {
    localStorage.setItem("v2ray-editor-notification", mode);
    set({ notificationMode: mode });
  },

  addConfigs: (rawLinks) => {
    const existingRaws = new Set(get().configs.map(c => c.raw));
    const newConfigs: ParsedConfig[] = [];

    for (const link of rawLinks) {
      const decoded = decodeSubscription(link);
      for (const single of decoded) {
        if (!single || existingRaws.has(single)) continue;
        existingRaws.add(single);
        const parsed = parseSingleLink(single);
        newConfigs.push(parsed);
      }
    }

    if (newConfigs.length > 0) {
      const updated = [...get().configs, ...newConfigs];
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
