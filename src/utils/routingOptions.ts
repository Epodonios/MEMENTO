/**
 * routingOptions.ts (Phase C3 — items 1+2: Routing UI/presets/geo + DNS/FakeDNS)
 *
 * Owns the user-facing routing + DNS surface, in the SAME architecture as
 * builderOptions.ts (D2): a STANDALONE module with zero store imports so the
 * config generators — also bundled standalone by the smoke esbuild harnesses —
 * can use it without dragging zustand/localStorage into those bundles.
 *
 * HARD RULE (inherited): DEFAULT_ROUTING_OPTIONS reproduces the PREVIOUS
 * hardcoded behavior byte-for-byte:
 *   - Xray: dns { servers: ["8.8.8.8","1.1.1.1","localhost"] }, routing
 *     { domainStrategy: "AsIs", rules: [api?, bittorrent?] }, no fakedns.
 *   - sing-box: route { final: "proxy" } ONLY, no dns object at all.
 * Nothing changes unless the user leaves the defaults.
 *
 * Geo-file contract (verified against the REAL pinned binaries):
 *   - Xray v25.1.1: `geosite:ir` is NOT in the official v2fly geosite.dat
 *     shipped with the core ("list not found: IR") — the Iran category is
 *     `geosite:category-ir`; `geoip:ir` exists in the official geoip.dat.
 *     Missing geo files are FATAL at core start, so routingNeedsGeo() gates
 *     the connect flow through the main-process geo_ensure IPC BEFORE any
 *     core spawn.
 *   - sing-box 1.14.0: legacy geosite/geoip fields are gone; the replacement
 *     is local binary rule_set files (.srs). Verified shapes:
 *       route.rule_set: [{ type:"local", tag, format:"binary", path }]
 *       + rule { rule_set: [tag], outbound } + outbounds "direct"/"block".
 *   - FakeDNS (Xray, verified Configuration OK on v25.1.1):
 *       fakedns: [{ ipPool:"198.18.0.0/15", poolSize:65536 }]
 *       + dns.servers: ["fakedns", ...] + sniffing.destOverride ["fakedns"].
 *   - FakeDNS (sing-box 1.14, verified `check` clean): the fakeip server can
 *     NEVER be the first/default DNS server; 1.14 additionally requires
 *     route.default_domain_resolver when DNS servers exist. Deprecation
 *     warnings (independent_cache, legacy dns fields) are avoided entirely.
 */

/* ------------------------------------------------------------------ */
/*  Types + defaults                                                   */
/* ------------------------------------------------------------------ */

export type RoutingPreset = "standard" | "bypass-ir" | "custom";

/**
 * DNS modes:
 *  - "default": the legacy fixed block (8.8.8.8 / 1.1.1.1 / localhost).
 *  - "secure": encrypted resolvers (DoH), routed THROUGH the tunnel on the
 *    sing-box side (detour: "proxy" — verified) and via an explicit
 *    inboundTag ["dns"] rule on the Xray side (schema-verified; the actual
 *    on-the-wire behavior is checklist item 24's manual test).
 *  - "fakedns": FakeDNS + DNS hijack semantics (see module doc above).
 */
export type DnsMode = "default" | "secure" | "fakedns";

export interface RoutingOptions {
  preset: RoutingPreset;
  /** Adds the ads category -> blocked (geo-backed on both cores). */
  blockAds: boolean;
  /** Custom rule lists — one rule per line, "# comments" allowed. Only the
   *  custom preset reads these (bypass-ir/standard ignore them, honestly). */
  directDomains: string;
  proxyDomains: string;
  blockDomains: string;
  directIps: string;
  proxyIps: string;
  blockIps: string;
  dnsMode: DnsMode;
}

export const DEFAULT_ROUTING_OPTIONS: RoutingOptions = {
  preset: "standard",
  blockAds: false,
  directDomains: "",
  proxyDomains: "",
  blockDomains: "",
  directIps: "",
  proxyIps: "",
  blockIps: "",
  dnsMode: "default",
};

export const ROUTING_OPTIONS_STORAGE_KEY = "memento-routing-options";

/** Merge saved (possibly older/partial) JSON over the defaults, forward-compat. */
export function loadRoutingOptions(): RoutingOptions {
  try {
    const saved = localStorage.getItem(ROUTING_OPTIONS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_ROUTING_OPTIONS, ...parsed };
    }
  } catch { /* storage unavailable (private mode/quota) — fall through */ }
  return { ...DEFAULT_ROUTING_OPTIONS };
}

/* ------------------------------------------------------------------ */
/*  Rule parsing (pure; shared by the generators AND the Routing UI)   */
/* ------------------------------------------------------------------ */

/** Per-list hard cap — a typo'd paste of a 50k-line dump must never freeze
 *  the generator (and the core's rule engine) with a monster ruleset. */
export const ROUTING_LIST_MAX = 200;

const DOMAIN_PREFIXES = ["full:", "domain:", "keyword:", "regexp:", "geosite:"] as const;

/** One domain rule line -> normalized Xray form, or null when invalid.
 *  Accepted: "geosite:category-ir", "full:example.com", "domain:example.com",
 *  "keyword:example", "regexp:...", or a bare domain "example.com" (=> the
 *  subdomain-matching "domain:" form). Spaces/commas/protocol prefixes are
 *  rejected — paste hygiene, not pedantry. */
export function parseDomainRule(line: string): string | null {
  const v = String(line || "").trim();
  if (!v || v.startsWith("#")) return null;
  for (const p of DOMAIN_PREFIXES) {
    if (v.startsWith(p)) {
      // C3 fix (user-approved): regexp is case-SENSITIVE by nature — the old
      // blanket .toLowerCase() silently rewrote user patterns ([A-Z] classes
      // etc.); every other family (full/domain/keyword/geosite) is
      // case-insensitive and stays normalized to lowercase.
      const rest = p === "regexp:"
        ? v.slice(p.length).trim()
        : v.slice(p.length).trim().toLowerCase();
      if (!rest || /\s|,/.test(rest)) return null;
      if (p === "regexp:") {
        try { new RegExp(rest); } catch { return null; }
      } else if (p === "geosite:") {
        if (!/^[a-z0-9_-]+$/.test(rest)) return null;
      } else if (!/^[a-z0-9._*-]+$/.test(rest)) {
        return null;
      }
      return `${p}${rest}`;
    }
  }
  if (v.includes("://") || /\s|,/.test(v)) return null;
  const bare = v.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(bare)) return null;
  return `domain:${bare}`;
}

/** One IP rule line -> normalized form, or null. Accepted: IPv4, IPv6,
 *  CIDR either family, or "geoip:xx" (lowercase country/region code). */
export function parseIpRule(line: string): string | null {
  const v = String(line || "").trim();
  if (!v || v.startsWith("#")) return null;
  if (v.startsWith("geoip:")) {
    const rest = v.slice(6).trim().toLowerCase();
    if (!/^[a-z0-9-]{2,12}$/.test(rest)) return null;
    return `geoip:${rest}`;
  }
  if (v.includes("://") || /\s|,/.test(v)) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/.exec(v);
  if (v4) {
    const octets = [v4[1], v4[2], v4[3], v4[4]].map(Number);
    if (octets.some(o => o > 255)) return null;
    const prefix = v4[6] === undefined ? null : Number(v4[6]);
    if (prefix !== null && prefix > 32) return null;
    return prefix === null ? v : `${octets.join(".")}/${prefix}`;
  }
  // IPv6 (loose but real: hex groups, "::" allowed, optional /prefix)
  const v6 = /^([0-9a-fA-F:]+)(\/(\d{1,3}))?$/.exec(v);
  if (v6 && v6[1].includes(":") && /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/.test(v6[1])) {
    const prefix = v6[3] === undefined ? null : Number(v6[3]);
    if (prefix !== null && prefix > 128) return null;
    return prefix === null ? v6[1].toLowerCase() : `${v6[1].toLowerCase()}/${prefix}`;
  }
  return null;
}

export interface ParsedRuleList {
  ok: string[];
  bad: string[];
}

/** Parse one textarea into a validated, deduped rule list. */
export function parseRuleList(text: string, kind: "domain" | "ip"): ParsedRuleList {
  const parse = kind === "domain" ? parseDomainRule : parseIpRule;
  const ok: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (ok.length >= ROUTING_LIST_MAX) { bad.push(line); continue; }
    const rule = parse(line);
    if (rule === null) { bad.push(line); continue; }
    if (!seen.has(rule)) { seen.add(rule); ok.push(rule); }
  }
  return { ok, bad };
}

/* ------------------------------------------------------------------ */
/*  Geo file status (renderer-side MIRROR of electron/geoFiles.ts)     */
/* ------------------------------------------------------------------ */

/** The exact shape the main-process geo_status IPC returns. Duplicated
 *  here (same discipline as UrlTestOutcome) because the renderer and the
 *  Electron main process build from separate tsconfig roots — the fntest
 *  asserts both copies stay field-identical. */
export interface GeoFileInfo {
  present: boolean;
  bytes: number;
}

export interface GeoStatus {
  /** Xray asset dir (= dataDir) with geoip.dat / geosite.dat. */
  xrayDir: string;
  xray: Record<string, GeoFileInfo>;
  /** sing-box .srs dir (= dataDir/sing-box) + its files. */
  srsDir: string;
  srs: Record<string, GeoFileInfo>;
}

/* ------------------------------------------------------------------ */
/*  Geo needs (drives the connect-flow geo_ensure gate)                */
/* ------------------------------------------------------------------ */

export interface GeoNeeds {
  /** Xray geoip.dat / geosite.dat next to the core (dataDir). */
  xrayDat: boolean;
  /** sing-box local .srs rule-set files (dataDir/sing-box). */
  singBoxSrs: boolean;
}

/** True when the CURRENT options reference geo data at all (comments and
 *  invalid lines never count — the parse lists are the single truth). */
export function routingNeedsGeo(opts: RoutingOptions): GeoNeeds {
  const domainLists = [opts.blockDomains, opts.directDomains, opts.proxyDomains]
    .map(t => parseRuleList(t, "domain").ok).flat();
  const ipLists = [opts.blockIps, opts.directIps, opts.proxyIps]
    .map(t => parseRuleList(t, "ip").ok).flat();
  const referencesGeo =
    domainLists.some(r => r.startsWith("geosite:")) ||
    ipLists.some(r => r.startsWith("geoip:"));
  const xrayDat = opts.preset === "bypass-ir" || opts.blockAds || referencesGeo;
  return { xrayDat, singBoxSrs: xrayDat }; // same categories, delivered as .srs
}

/** The exact geo FILES the current options require for a given core.
 *  "xray" family: any geo reference needs BOTH dat files (geosite dat for
 *  domain categories, geoip dat for IP categories). "srs" family: the
 *  managed rule-set tags only. The connect flow uses this after geo_ensure
 *  to verify every required file is really present before spawning. */
export function requiredGeoFiles(opts: RoutingOptions, core: "xray" | "sing-box"): string[] {
  const needs = routingNeedsGeo(opts);
  if (core === "xray") return needs.xrayDat ? ["geoip.dat", "geosite.dat"] : [];
  if (!needs.singBoxSrs) return [];
  const files: string[] = [];
  if (opts.preset === "bypass-ir") { files.push("geosite-ir.srs", "geoip-ir.srs"); }
  if (opts.blockAds) { files.push("geosite-category-ads-all.srs"); }
  if (opts.preset === "custom") {
    // custom lists may reference the managed categories directly
    const d = [opts.blockDomains, opts.directDomains, opts.proxyDomains].map(t => parseRuleList(t, "domain").ok).flat();
    if (d.some(r => r === "geosite:category-ir")) files.push("geosite-ir.srs");
    if (d.some(r => r === "geosite:category-ads-all")) files.push("geosite-category-ads-all.srs");
    const i = [opts.blockIps, opts.directIps, opts.proxyIps].map(t => parseRuleList(t, "ip").ok).flat();
    if (i.some(r => r.startsWith("geoip:"))) files.push("geoip-ir.srs");
  }
  return [...new Set(files)];
}

/* ------------------------------------------------------------------ */
/*  Xray builders (verified shapes — see module doc)                   */
/* ------------------------------------------------------------------ */

export const GEO_IR_XRAY_DOMAIN = "geosite:category-ir";
export const GEO_IR_XRAY_IP = "geoip:ir";
export const GEO_ADS_XRAY_DOMAIN = "geosite:category-ads-all";
export const FAKEDNS_POOL = "198.18.0.0/15";

export interface XrayRoutingBuild {
  dns: Record<string, unknown>;
  routing: {
    domainStrategy: string;
    rules: Record<string, unknown>[];
    /** Phase C4: balancer pool — present ONLY when a balancer is active
     *  (the generator pushes the LAST catch-all rule + the group). */
    balancers?: Record<string, unknown>[];
  };
  /** Root-level fakedns field — present ONLY in fakedns mode. */
  fakedns?: Record<string, unknown>[];
  /** sniffing.destOverride for the local inbounds (["http","tls"] legacy or + fakedns). */
  sniffingDestOverride: string[];
  /** True when the build references geosite/geoip (connect-flow geo gate). */
  needsGeo: boolean;
}

/** The Xray DNS + routing build. `baseRules` carries the caller's own
 *  always-safe rules (api inboundTag, bittorrent protocol) FIRST — order
 *  matters (first match wins) and the api rule must never be shadowed. */
export function buildXrayRouting(opts: RoutingOptions, baseRules: Record<string, unknown>[]): XrayRoutingBuild {
  const needsGeo = routingNeedsGeo(opts).xrayDat;

  /* ---------------- DNS ---------------- */
  let dns: Record<string, unknown>;
  if (opts.dnsMode === "secure") {
    dns = {
      servers: [
        "https://8.8.8.8/dns-query",
        "https://1.1.1.1/dns-query",
        "localhost",
      ],
      queryStrategy: "UseIP",
    };
  } else if (opts.dnsMode === "fakedns") {
    dns = {
      servers: ["fakedns", "https://8.8.8.8/dns-query", "localhost"],
      queryStrategy: "UseIP",
    };
  } else {
    dns = { servers: ["8.8.8.8", "1.1.1.1", "localhost"] }; // legacy byte-shape
  }

  /* ---------------- domainStrategy ---------------- */
  // geoip rules can only match RESOLVED addresses -> IPIfNonMatch is the
  // documented Xray strategy for geo-based bypassing (v2rayN uses the same).
  const domainStrategy = needsGeo ? "IPIfNonMatch" : "AsIs";

  /* ---------------- rules (order = priority) ---------------- */
  const rules: Record<string, unknown>[] = [...baseRules];

  if (opts.preset === "custom") {
    const blockD = parseRuleList(opts.blockDomains, "domain").ok;
    const blockI = parseRuleList(opts.blockIps, "ip").ok;
    const directD = parseRuleList(opts.directDomains, "domain").ok;
    const directI = parseRuleList(opts.directIps, "ip").ok;
    const proxyD = parseRuleList(opts.proxyDomains, "domain").ok;
    const proxyI = parseRuleList(opts.proxyIps, "ip").ok;
    if (blockD.length) rules.push({ type: "field", outboundTag: "blocked", domain: blockD });
    if (blockI.length) rules.push({ type: "field", outboundTag: "blocked", ip: blockI });
    if (directD.length) rules.push({ type: "field", outboundTag: "direct", domain: directD });
    if (directI.length) rules.push({ type: "field", outboundTag: "direct", ip: directI });
    if (proxyD.length) rules.push({ type: "field", outboundTag: "proxy", domain: proxyD });
    if (proxyI.length) rules.push({ type: "field", outboundTag: "proxy", ip: proxyI });
  }

  if (opts.blockAds) {
    rules.push({ type: "field", outboundTag: "blocked", domain: [GEO_ADS_XRAY_DOMAIN] });
  }

  if (opts.preset === "bypass-ir") {
    // Iran direct: domains first, then resolved IPs (IPIfNonMatch resolves).
    rules.push({ type: "field", outboundTag: "direct", domain: [GEO_IR_XRAY_DOMAIN] });
    rules.push({ type: "field", outboundTag: "direct", ip: [GEO_IR_XRAY_IP] });
  }
  // Everything else falls through to the default outbound (proxy) — same
  // semantics as every previous MEMENTO version.

  const build: XrayRoutingBuild = { dns, routing: { domainStrategy, rules }, needsGeo, sniffingDestOverride: ["http", "tls"] };
  if (opts.dnsMode === "fakedns") {
    build.fakedns = [{ ipPool: FAKEDNS_POOL, poolSize: 65536 }];
    build.sniffingDestOverride = ["http", "tls", "fakedns"];
  }
  return build;
}

/* ------------------------------------------------------------------ */
/*  sing-box builders (verified shapes — see module doc)               */
/* ------------------------------------------------------------------ */

export const GEO_IR_SRS_GEOSITE = "geosite-ir";
export const GEO_IR_SRS_GEOIP = "geoip-ir";
export const GEO_ADS_SRS_GEOSITE = "geosite-category-ads-all";

export interface SingBoxRoutingBuild {
  /** Extra outbounds to append (caller dedupes by tag): "direct"/"blocked". */
  extraOutbounds: { type: string; tag: string }[];
  /** Root-level route.rule_set entries (local .srs) — present only when geo. */
  ruleSet: Record<string, unknown>[];
  route: Record<string, unknown>;
  /** Root-level dns object — present only for secure/fakedns modes. */
  dns?: Record<string, unknown>;
  needsGeo: boolean;
}

/**
 * The sing-box route/dns build. `baseRules` = caller's own rules (bittorrent
 * first, mirroring the Xray order). `srsDir` is the ABSOLUTE directory that
 * contains the downloaded .srs files (main-process geo_ensure owns it); when
 * geo is wanted but srsDir is empty the build degrades to the embedded
 * minimal fallback (see below) — the connect flow's geo_ensure gate makes
 * that a rare, visible path, never a silent fake of full geo coverage.
 *
 * Custom-list mapping honesty: Xray accepts ANY geosite:/geoip: category the
 * dat ships; sing-box custom lists only map to the two MANAGED rule-sets
 * (category-ir / category-ads-all) — every other geo line is skipped on the
 * sing-box side (the UI hint says so), while plain domain/CIDR rules map 1:1.
 */
export function buildSingBoxRouting(opts: RoutingOptions, baseRules: Record<string, unknown>[], srsDir: string): SingBoxRoutingBuild {
  const wantsGeo = routingNeedsGeo(opts).singBoxSrs;
  const geoReady = wantsGeo && !!srsDir;

  const extraOutbounds: { type: string; tag: string }[] = [];
  const ruleSet: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [...baseRules];
  let dns: Record<string, unknown> | undefined;
  let defaultResolver: string | null = null;

  const blockD = opts.preset === "custom" ? parseRuleList(opts.blockDomains, "domain").ok : [];
  const blockI = opts.preset === "custom" ? parseRuleList(opts.blockIps, "ip").ok : [];
  const directD = opts.preset === "custom" ? parseRuleList(opts.directDomains, "domain").ok : [];
  const directI = opts.preset === "custom" ? parseRuleList(opts.directIps, "ip").ok : [];
  const proxyD = opts.preset === "custom" ? parseRuleList(opts.proxyDomains, "domain").ok : [];
  const proxyI = opts.preset === "custom" ? parseRuleList(opts.proxyIps, "ip").ok : [];

  const wantDirect = opts.preset === "bypass-ir" || directD.length > 0 || directI.length > 0;
  const wantBlock = opts.blockAds || opts.preset === "bypass-ir" || blockD.length > 0 || blockI.length > 0;
  if (wantDirect) extraOutbounds.push({ type: "direct", tag: "direct" });
  if (wantBlock) extraOutbounds.push({ type: "block", tag: "blocked" });

  if (opts.preset === "custom") {
    const blockDPlain = blockD.filter(r => !r.startsWith("geosite:"));
    const blockIPlain = blockI.filter(r => !r.startsWith("geoip:"));
    const directDPlain = directD.filter(r => !r.startsWith("geosite:"));
    const directIPlain = directI.filter(r => !r.startsWith("geoip:"));
    if (blockDPlain.length) rules.push({ outbound: "blocked", ...domainRuleSet(blockDPlain) });
    if (blockIPlain.length) rules.push({ outbound: "blocked", ip_cidr: blockIPlain });
    if (directDPlain.length) rules.push({ outbound: "direct", ...domainRuleSet(directDPlain) });
    if (directIPlain.length) rules.push({ outbound: "direct", ip_cidr: directIPlain });
    if (proxyD.length) rules.push({ outbound: "proxy", ...domainRuleSet(proxyD.filter(r => !r.startsWith("geosite:"))) });
    if (proxyI.length) rules.push({ outbound: "proxy", ip_cidr: proxyI.filter(r => !r.startsWith("geoip:")) });
  }

  if (opts.blockAds) {
    if (geoReady) {
      ruleSet.push({ type: "local", tag: GEO_ADS_SRS_GEOSITE, format: "binary", path: `${srsDir}/${GEO_ADS_SRS_GEOSITE}.srs` });
      rules.push({ outbound: "blocked", rule_set: [GEO_ADS_SRS_GEOSITE] });
    } else {
      // Offline-safe surrogate: block the dominant ad NETWORKS by keyword —
      // honest partial coverage, never a silent claim of full geo blocking.
      rules.push({ outbound: "blocked", domain_keyword: ["doubleclick", "googlesyndication", "googleadservices", "adservice"] });
    }
  }

  if (opts.preset === "bypass-ir") {
    if (geoReady) {
      ruleSet.push({ type: "local", tag: GEO_IR_SRS_GEOSITE, format: "binary", path: `${srsDir}/${GEO_IR_SRS_GEOSITE}.srs` });
      ruleSet.push({ type: "local", tag: GEO_IR_SRS_GEOIP, format: "binary", path: `${srsDir}/${GEO_IR_SRS_GEOIP}.srs` });
      rules.push({ outbound: "direct", rule_set: [GEO_IR_SRS_GEOSITE] });
      rules.push({ outbound: "direct", rule_set: [GEO_IR_SRS_GEOIP] });
    } else {
      // Geo files unavailable: embedded minimal Iran apex-domain fallback —
      // partial by design. IP rules are NOT approximated (a hand-picked
      // CIDR list would be dangerous fiction).
      rules.push({ outbound: "direct", domain_suffix: MINIMAL_IR_DOMAINS });
    }
  }

  /* ---------------- DNS modes ---------------- */
  if (opts.dnsMode === "secure") {
    dns = {
      servers: [
        { type: "https", tag: "dns-remote", server: "8.8.8.8", detour: "proxy" },
        { type: "https", tag: "dns-remote2", server: "1.1.1.1", detour: "proxy" },
      ],
      final: "dns-remote",
    };
    defaultResolver = "dns-remote";
  } else if (opts.dnsMode === "fakedns") {
    dns = {
      servers: [
        { type: "udp", tag: "dns-remote", server: "8.8.8.8", detour: "proxy" },
        { type: "fakeip", tag: "dns-fakeip", inet4_range: FAKEDNS_POOL },
      ],
      rules: [
        { inbound: ["socks-in"], server: "dns-fakeip" },
        { inbound: ["http-in"], server: "dns-fakeip" },
      ],
      final: "dns-remote",
    };
    // FakeDNS needs the sniff action to recover real domains from the fake
    // IPs, and hijack-dns to catch apps hardcoding 8.8.8.8:53 through us.
    rules.unshift({ action: "sniff", inbound: ["socks-in", "http-in"] });
    rules.unshift({ action: "hijack-dns", protocol: "dns" });
    defaultResolver = "dns-remote";
  }

  // Legacy byte-shape: with DEFAULT options (no rules at all) the route
  // object must stay exactly { final: "proxy" } — no empty rules key.
  const route: Record<string, unknown> = rules.length ? { rules, final: "proxy" } : { final: "proxy" };
  if (ruleSet.length) route.rule_set = ruleSet;
  if (defaultResolver) route.default_domain_resolver = defaultResolver;

  return { extraOutbounds, ruleSet, route, dns, needsGeo: wantsGeo };
}

/** Xray-form domain rules -> sing-box match fields (subdomain match mirrors
 *  the Xray "domain:" semantics; geosite: never lands here — rule_set path). */
function domainRuleSet(rules: string[]): Record<string, unknown> {
  const suffix: string[] = [];
  const full: string[] = [];
  const keyword: string[] = [];
  const regex: string[] = [];
  for (const r of rules) {
    if (r.startsWith("full:")) full.push(r.slice(5));
    else if (r.startsWith("keyword:")) keyword.push(r.slice(8));
    else if (r.startsWith("regexp:")) regex.push(r.slice(7));
    else suffix.push(r.replace(/^domain:/, ""));
  }
  const out: Record<string, unknown> = {};
  if (suffix.length) out.domain_suffix = suffix;
  if (full.length) out.domain = full;
  if (keyword.length) out.domain_keyword = keyword;
  if (regex.length) out.domain_regex = regex;
  return out;
}

/** Embedded minimal Iran apex-domain fallback (hand-curated, intentionally
 *  SHORT — real coverage comes from the .srs files; this is the degraded
 *  offline path only). */
export const MINIMAL_IR_DOMAINS: string[] = [
  "ac.ir", "aparat.com", "bale.ai", "bmi.ir", "digikala.com", "divar.ir",
  "dolat.ir", "edu.ir", "government.ir", "id.ir", "ir", "irancell.ir",
  "mci.ir", "mfa.ir", "sb24.com", "shaparak.ir", "snapp.ir", "tci.ir",
  "telewebion.com", "varzesh3.com", "yjc.ir",
];
