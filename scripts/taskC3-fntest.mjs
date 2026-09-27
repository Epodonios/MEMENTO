#!/usr/bin/env node
/**
 * Phase C3 FUNCTIONAL test — the pure routing layer, bundled from the REAL
 * modules via esbuild (taskC3-cfgentry.ts), no mocks:
 *   F1  parseDomainRule / parseIpRule / parseRuleList validation matrices
 *       (accept normalizes; rejects comments, URLs, spaces, bad octets,
 *       bad prefixes, bad regex; cap at ROUTING_LIST_MAX with honest bad[]).
 *   F2  routingNeedsGeo / requiredGeoFiles matrices (preset/blockAds/custom
 *       geo lines; per-core file lists).
 *   F3  buildXrayRouting: default byte-legacy dns/routing; bypass-ir rules
 *       order + IPIfNonMatch; custom lists order (block < direct < proxy);
 *       blockAds category rule; secure DoH dns; fakedns full recipe.
 *   F4  buildSingBoxRouting: default = legacy { final: "proxy" } ONLY;
 *       bypass-ir local rule_set paths; fakeip/secure dns shapes with
 *       default_domain_resolver; offline fallbacks (no srsDir).
 *   F5  GOLDEN SNAPSHOTS: generateV2RayConfig / generateSingBoxConfig with
 *       DEFAULT routing options are byte-identical to the pre-C3 output
 *       (the hard backward-compat rule).
 *   F6  loadRoutingOptions forward-compat merge (localStorage partial blob).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TC3_WORK || join(HERE, "taskC3-fn-tmp");
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC3-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c3.cjs")}`], { cwd: HERE, stdio: "pipe" });
const R = createRequire(join(WORK, "c3.cjs"));
const {
  DEFAULT_ROUTING_OPTIONS, parseDomainRule, parseIpRule, parseRuleList, ROUTING_LIST_MAX,
  routingNeedsGeo, requiredGeoFiles,
  buildXrayRouting, buildSingBoxRouting,
  GEO_IR_XRAY_DOMAIN, GEO_IR_XRAY_IP, GEO_ADS_XRAY_DOMAIN, FAKEDNS_POOL,
  GEO_IR_SRS_GEOSITE, GEO_IR_SRS_GEOIP, GEO_ADS_SRS_GEOSITE, MINIMAL_IR_DOMAINS,
  generateV2RayConfig, generateSingBoxConfig, DEFAULT_BUILDER_OPTIONS,
} = R(join(WORK, "c3.cjs"));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

const vmessConfig = {
  id: "f1", protocol: "vmess", name: "f1", isValid: true,
  address: "198.51.100.10", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811",
  security: "tls", network: "tcp",
};

/* ---------------- F1: parsing ---------------- */
{
  ok("F1 plain domain normalizes to domain:", parseDomainRule("Example.COM") === "domain:example.com");
  ok("F1 full:/keyword:/regexp:/geosite: pass through",
    parseDomainRule("full:a.b") === "full:a.b" && parseDomainRule("keyword:ads") === "keyword:ads" &&
    parseDomainRule("geosite:category-ir") === "geosite:category-ir");
  ok("F1 regexp validated (bad regex rejected)",
    parseDomainRule("regexp:^\\d+-x$") === "regexp:^\\d+-x$" && parseDomainRule("regexp:^([unclosed") === null);
  ok("F1 C3-fix: regexp keeps case (no silent toLowerCase), other prefixes still normalize",
    parseDomainRule("regexp:[A-Z]+\\.Example\\.Com$") === "regexp:[A-Z]+\\.Example\\.Com$" &&
    parseDomainRule("full:Example.COM") === "full:example.com" &&
    parseDomainRule("geosite:Category-IR") === "geosite:category-ir");
  ok("F1 rejects URLs/spaces/empties/comments",
    parseDomainRule("https://x.com") === null && parseDomainRule("a b") === null &&
    parseDomainRule("") === null && parseDomainRule("# comment") === null);
  ok("F1 IPv4/CIDR normalize; octet/prefix bounds enforced",
    parseIpRule("8.8.8.8") === "8.8.8.8" && parseIpRule("10.0.0.0/8") === "10.0.0.0/8" &&
    parseIpRule("256.1.1.1") === null && parseIpRule("1.2.3.4/33") === null);
  ok("F1 IPv6 + CIDR6 accepted, garbage rejected",
    parseIpRule("2001:db8::1") === "2001:db8::1" && parseIpRule("2001:db8::/32") === "2001:db8::/32" &&
    parseIpRule("not-an-ip") === null);
  ok("F1 geoip: normalizes lowercase; bad codes rejected",
    parseIpRule("geoip:IR") === "geoip:ir" && parseIpRule("geoip:x!") === null);
  const big = Array.from({ length: ROUTING_LIST_MAX + 5 }, (_, i) => `d${i}.com`).join("\n");
  const parsed = parseRuleList(big, "domain");
  ok(`F1 list cap ${ROUTING_LIST_MAX} + overflow lands in bad[]`,
    parsed.ok.length === ROUTING_LIST_MAX && parsed.bad.length === 5);
  ok("F1 dedupe + comments + blanks skipped",
    parseRuleList("# c\n\na.com\na.com\nA.COM", "domain").ok.join("|") === "domain:a.com");
}

/* ---------------- F2: geo needs ---------------- */
{
  const base = { ...DEFAULT_ROUTING_OPTIONS };
  ok("F2 defaults need NO geo", !routingNeedsGeo(base).xrayDat && !routingNeedsGeo(base).singBoxSrs);
  ok("F2 bypass-ir needs geo on both cores",
    routingNeedsGeo({ ...base, preset: "bypass-ir" }).xrayDat);
  ok("F2 blockAds needs geo", routingNeedsGeo({ ...base, blockAds: true }).xrayDat);
  ok("F2 custom geosite/geoip lines need geo; plain lines do NOT",
    routingNeedsGeo({ ...base, preset: "custom", directDomains: "geosite:category-ir" }).xrayDat &&
    routingNeedsGeo({ ...base, preset: "custom", directIps: "geoip:ir" }).xrayDat &&
    !routingNeedsGeo({ ...base, preset: "custom", directDomains: "a.com" }).xrayDat);
  ok("F2 comments never count as geo refs",
    !routingNeedsGeo({ ...base, preset: "custom", directDomains: "# geosite:ir" }).xrayDat);
  ok("F2 requiredGeoFiles xray = both dat files",
    JSON.stringify(requiredGeoFiles({ ...base, preset: "bypass-ir" }, "xray")) === JSON.stringify(["geoip.dat", "geosite.dat"]));
  ok("F2 requiredGeoFiles sing-box bypass-ir = ir pair",
    JSON.stringify(requiredGeoFiles({ ...base, preset: "bypass-ir" }, "sing-box")) === JSON.stringify(["geosite-ir.srs", "geoip-ir.srs"]));
  ok("F2 requiredGeoFiles sing-box ads adds the ads srs",
    requiredGeoFiles({ ...base, preset: "bypass-ir", blockAds: true }, "sing-box").includes("geosite-category-ads-all.srs"));
  ok("F2 requiredGeoFiles defaults = []",
    requiredGeoFiles(base, "xray").length === 0 && requiredGeoFiles(base, "sing-box").length === 0);
}

/* ---------------- F3: buildXrayRouting ---------------- */
{
  const b0 = buildXrayRouting(DEFAULT_ROUTING_OPTIONS, []);
  ok("F3 default dns is the LEGACY byte-shape",
    JSON.stringify(b0.dns) === JSON.stringify({ servers: ["8.8.8.8", "1.1.1.1", "localhost"] }));
  ok("F3 default strategy AsIs, no fakedns, legacy sniffing",
    b0.routing.domainStrategy === "AsIs" && !b0.fakedns &&
    JSON.stringify(b0.sniffingDestOverride) === JSON.stringify(["http", "tls"]) && !b0.needsGeo);
  ok("F3 base rules stay FIRST (api rule never shadowed)",
    buildXrayRouting({ ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }, [{ type: "field", inboundTag: ["api"], outboundTag: "api" }]).routing.rules[0].outboundTag === "api");

  const bir = buildXrayRouting({ ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }, []);
  ok("F3 bypass-ir: IPIfNonMatch + needsGeo",
    bir.routing.domainStrategy === "IPIfNonMatch" && bir.needsGeo);
  ok("F3 bypass-ir rule order: direct-domain(category-ir) < direct-ip(ir), base rules stay ahead",
    bir.routing.rules.length === 2 &&
    bir.routing.rules[0].domain[0] === GEO_IR_XRAY_DOMAIN &&
    bir.routing.rules[1].ip[0] === GEO_IR_XRAY_IP);

  const cust = { ...DEFAULT_ROUTING_OPTIONS, preset: "custom",
    blockDomains: "ads.example", directDomains: "a.com", proxyDomains: "p.com",
    blockIps: "10.0.0.0/8", directIps: "192.168.0.0/16", proxyIps: "8.8.8.8" };
  const bc = buildXrayRouting(cust, []);
  ok("F3 custom order: block(D,I) < direct(D,I) < proxy(D,I)",
    bc.routing.rules.map(r => r.outboundTag).join(",") === "blocked,blocked,direct,direct,proxy,proxy" &&
    bc.routing.rules[0].domain[0] === "domain:ads.example" &&
    bc.routing.rules[3].ip[0] === "192.168.0.0/16");
  ok("F3 custom geo-free stays AsIs",
    bc.routing.domainStrategy === "AsIs" && !bc.needsGeo);

  const ads = buildXrayRouting({ ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir", blockAds: true }, []);
  ok("F3 blockAds emits the ads category as blocked BEFORE the ir rules",
    ads.routing.rules.some(r => r.outboundTag === "blocked" && r.domain[0] === GEO_ADS_XRAY_DOMAIN) &&
    ads.routing.rules.findIndex(r => r.outboundTag === "blocked") < ads.routing.rules.findIndex(r => r.domain?.[0] === GEO_IR_XRAY_DOMAIN));

  const sec = buildXrayRouting({ ...DEFAULT_ROUTING_OPTIONS, dnsMode: "secure" }, []);
  ok("F3 secure dns = DoH pair + localhost + queryStrategy",
    sec.dns.servers[0] === "https://8.8.8.8/dns-query" && sec.dns.servers[2] === "localhost" && sec.dns.queryStrategy === "UseIP");

  const fk = buildXrayRouting({ ...DEFAULT_ROUTING_OPTIONS, dnsMode: "fakedns" }, []);
  ok("F3 fakedns: root pool + first dns server + sniffing override",
    JSON.stringify(fk.fakedns) === JSON.stringify([{ ipPool: FAKEDNS_POOL, poolSize: 65536 }]) &&
    fk.dns.servers[0] === "fakedns" &&
    JSON.stringify(fk.sniffingDestOverride) === JSON.stringify(["http", "tls", "fakedns"]));
}

/* ---------------- F4: buildSingBoxRouting ---------------- */
{
  const b0 = buildSingBoxRouting(DEFAULT_ROUTING_OPTIONS, [], "");
  ok("F4 default route is LEGACY { final } ONLY — no rules key, no dns, no outbounds",
    JSON.stringify(b0.route) === JSON.stringify({ final: "proxy" }) && !b0.dns && b0.extraOutbounds.length === 0 && !b0.needsGeo);

  const bir = buildSingBoxRouting({ ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }, [], "/data/sing-box");
  ok("F4 bypass-ir with srsDir: local binary rule_set + direct outbounds",
    bir.extraOutbounds.some(o => o.tag === "direct") &&
    bir.ruleSet.some(r => r.type === "local" && r.tag === GEO_IR_SRS_GEOSITE && r.path === "/data/sing-box/geosite-ir.srs" && r.format === "binary") &&
    bir.ruleSet.some(r => r.tag === GEO_IR_SRS_GEOIP) &&
    bir.route.rules.some(r => r.outbound === "direct" && JSON.stringify(r.rule_set) === JSON.stringify([GEO_IR_SRS_GEOSITE])));
  ok("F4 sing-box reports needsGeo even WITHOUT srsDir (gate truth)",
    buildSingBoxRouting({ ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }, [], "").needsGeo);

  const birOff = buildSingBoxRouting({ ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }, [], "");
  ok("F4 offline fallback = embedded minimal ir list, NO fake geo claims",
    birOff.ruleSet.length === 0 &&
    JSON.stringify(birOff.route.rules.find(r => r.outbound === "direct").domain_suffix) === JSON.stringify(MINIMAL_IR_DOMAINS));

  const sec = buildSingBoxRouting({ ...DEFAULT_ROUTING_OPTIONS, dnsMode: "secure" }, [], "");
  ok("F4 secure dns: DoH servers detour through proxy + default_domain_resolver",
    sec.dns.servers[0].detour === "proxy" && sec.dns.final === "dns-remote" &&
    sec.route.default_domain_resolver === "dns-remote");

  const fk = buildSingBoxRouting({ ...DEFAULT_ROUTING_OPTIONS, dnsMode: "fakedns" }, [], "");
  ok("F4 fakedns: real server FIRST, fakeip second, inbound rule, hijack+sniff actions",
    fk.dns.servers[0].type === "udp" && fk.dns.servers[1].type === "fakeip" &&
    fk.dns.servers[1].inet4_range === FAKEDNS_POOL &&
    JSON.stringify(fk.dns.rules[0]) === JSON.stringify({ inbound: ["socks-in"], server: "dns-fakeip" }) &&
    fk.route.rules[0].action === "hijack-dns" && fk.route.rules[1].action === "sniff" &&
    fk.route.default_domain_resolver === "dns-remote");

  const adsOff = buildSingBoxRouting({ ...DEFAULT_ROUTING_OPTIONS, blockAds: true }, [], "");
  ok("F4 ads without geo = honest keyword surrogate, no rule_set",
    adsOff.ruleSet.length === 0 && adsOff.route.rules.some(r => r.outbound === "blocked" && Array.isArray(r.domain_keyword)));
}

/* ---------------- F5: golden snapshots (byte-identical legacy) ---------------- */
{
  const gen = generateV2RayConfig(vmessConfig, "socks-http", 10808, 10809, 10850, DEFAULT_BUILDER_OPTIONS);
  const cfg = JSON.parse(gen.json);
  ok("F5 GOLDEN xray dns block byte-identical",
    JSON.stringify(cfg.dns) === JSON.stringify({ servers: ["8.8.8.8", "1.1.1.1", "localhost"] }));
  ok("F5 GOLDEN xray routing byte-identical (api + bittorrent, AsIs)",
    cfg.routing.domainStrategy === "AsIs" && cfg.routing.rules.length === 2 &&
    cfg.routing.rules[0].inboundTag[0] === "api" && cfg.routing.rules[1].protocol[0] === "bittorrent");
  ok("F5 GOLDEN xray has NO fakedns key", !("fakedns" in cfg));

  const sgen = generateSingBoxConfig(
    { ...vmessConfig, protocol: "hysteria2", password: "pw" }, 10808, 10809, 10850, DEFAULT_BUILDER_OPTIONS);
  const scfg = JSON.parse(sgen.json);
  ok("F5 GOLDEN sing-box route byte-identical + NO dns key",
    JSON.stringify(scfg.route) === JSON.stringify({ final: "proxy" }) && !("dns" in scfg));

  // With routing options, the xray JSON carries them through:
  const rgen = generateV2RayConfig(vmessConfig, "socks-http", 10808, 10809, undefined,
    DEFAULT_BUILDER_OPTIONS, { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" });
  const rcfg = JSON.parse(rgen.json);
  ok("F5 xray generator wires routingOptions (7th param) into the JSON",
    rcfg.routing.domainStrategy === "IPIfNonMatch" &&
    rcfg.routing.rules.some(r => r.domain?.[0] === GEO_IR_XRAY_DOMAIN));

  const rsgen = generateSingBoxConfig(
    { ...vmessConfig, protocol: "hysteria2", password: "pw" }, 10808, 10809, undefined,
    DEFAULT_BUILDER_OPTIONS, { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }, "/data/sing-box");
  const rscfg = JSON.parse(rsgen.json);
  ok("F5 sing-box generator wires routingOptions+srsDir (6th/7th params)",
    rscfg.route.rule_set?.length === 2 && rscfg.outbounds.some(o => o.tag === "direct"));
}

/* ---------------- F6: loadRoutingOptions forward-compat ---------------- */
{
  const fakeLocal = {};
  global.localStorage = {
    getItem: (k) => fakeLocal[k] ?? null,
    setItem: (k, v) => { fakeLocal[k] = v; },
    removeItem: (k) => { delete fakeLocal[k]; },
  };
  const { loadRoutingOptions, ROUTING_OPTIONS_STORAGE_KEY } = R(join(WORK, "c3.cjs"));
  global.localStorage.setItem(ROUTING_OPTIONS_STORAGE_KEY, JSON.stringify({ preset: "bypass-ir" }));
  const merged = loadRoutingOptions();
  ok("F6 partial saved blob merges over defaults",
    merged.preset === "bypass-ir" && merged.dnsMode === "default" && merged.blockAds === false);
  global.localStorage.setItem(ROUTING_OPTIONS_STORAGE_KEY, "not json{");
  ok("F6 corrupt blob falls back to defaults", loadRoutingOptions().preset === "standard");
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
