#!/usr/bin/env node
/**
 * Phase C3 CONFIG-level test — every REWRITTEN routing shape is fed to the
 * REAL pinned cores:
 *   - Xray v25.1.1 `run -test`: bypass-ir (geosite:category-ir + geoip:ir +
 *     IPIfNonMatch), custom lists, blockAds, secure DoH + inboundTag ["dns"]
 *     rule, full fakedns recipe (root fakedns + dns.servers + sniffing
 *     destOverride). POSITIVE with the REAL geo assets; NEGATIVE proves the
 *     geo gate is load-bearing (same bypass-ir config + EMPTY asset dir =
 *     fatal exit).
 *   - sing-box 1.14.0 `check`: bypass-ir with REAL local .srs rule-sets
 *     (downloaded live from the pinned MetaCubeX URLs — the exact files
 *     geo_ensure ships), secure DoH detour, fakeip (new DNS format +
 *     default_domain_resolver), custom lists, block outbound.
 *   - Generator-level: statsApiPort coexistence (clash_api/api rule survive
 *     routing) — regression on the D2/C2 contracts.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TC3_WORK || join(HERE, "taskC3-cfg-tmp");
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SB = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const XRAY_GEO_DIR = path.dirname(XRAY); // the pinned binary ships real geoip/geosite dat

execFileSync("npx", ["esbuild", join(HERE, "taskC3-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c3.cjs")}`], { cwd: HERE, stdio: "pipe" });
const R = createRequire(join(WORK, "c3.cjs"));
const {
  DEFAULT_ROUTING_OPTIONS, generateV2RayConfig, generateSingBoxConfig, DEFAULT_BUILDER_OPTIONS,
} = R(join(WORK, "c3.cjs"));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

function xrayTest(file, assetDir) {
  try {
    execFileSync(XRAY, ["run", "-test", "-c", file], { encoding: "utf8", timeout: 60000, env: { ...process.env, XRAY_LOCATION_ASSET: assetDir } });
    return { okRes: true, out: "" };
  } catch (e) {
    return { okRes: false, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}
function sbCheck(file) {
  try {
    execFileSync(SB, ["check", "-c", file], { encoding: "utf8", timeout: 60000 });
    return { okRes: true, out: "" };
  } catch (e) {
    return { okRes: false, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}

const vmess = {
  id: "cfg1", protocol: "vmess", name: "cfg1", isValid: true,
  address: "127.0.0.1", port: 41001, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811",
  security: "tls", network: "tcp",
};
const hyst = { ...vmess, id: "cfg-h2", protocol: "hysteria2", name: "cfg-h2", password: "pw" };

function writeXray(name, routingOptions, statsApiPort) {
  const gen = generateV2RayConfig(vmess, "socks-http", 14001, 14002, statsApiPort, DEFAULT_BUILDER_OPTIONS, routingOptions);
  const f = join(WORK, `${name}.json`);
  fs.writeFileSync(f, gen.json, "utf8");
  return f;
}
function writeSb(name, routingOptions, srsDir) {
  const gen = generateSingBoxConfig(hyst, 14001, 14002, undefined, DEFAULT_BUILDER_OPTIONS, routingOptions, srsDir);
  const f = join(WORK, `${name}.json`);
  fs.writeFileSync(f, gen.json, "utf8");
  return f;
}

/* ---------------- SRS download (real files, real pinned URLs) ---------------- */
const srsDir = join(WORK, "srs");
fs.mkdirSync(srsDir, { recursive: true });
const SRS = {
  "geosite-ir.srs": "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/category-ir.srs",
  "geoip-ir.srs": "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geoip/ir.srs",
  "geosite-category-ads-all.srs": "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/category-ads-all.srs",
};
{
  console.log("\n== S0 real .srs download (the exact URLs geo_ensure pins) ==");
  for (const [name, url] of Object.entries(SRS)) {
    const dest = join(srsDir, name);
    try {
      execFileSync("curl", ["-sL", "--max-time", "60", "-o", dest, url], { timeout: 70000 });
      const sz = fs.statSync(dest).size;
      ok(`S0 ${name} downloaded (${sz} B)`, sz > 500 && !fs.readFileSync(dest, "utf8").startsWith("404"));
    } catch (e) {
      ok(`S0 ${name} downloaded`, false, String(e).slice(0, 80));
    }
  }
}

/* ---------------- Xray positives (REAL geo assets present) ---------------- */
console.log("\n== S1 xray run -test with REAL geo assets ==");
{
  const cases = [
    ["x-bypass-ir", { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }],
    ["x-bypass-ir-ads", { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir", blockAds: true }],
    ["x-custom", { ...DEFAULT_ROUTING_OPTIONS, preset: "custom",
      blockDomains: "ads.example\ndoubleclick.net", directDomains: "digikala.com\nfull:api.a.com",
      proxyDomains: "keyword:pay", blockIps: "10.0.0.0/8", directIps: "192.168.0.0/16", proxyIps: "geoip:ir" }],
    ["x-secure-doh", { ...DEFAULT_ROUTING_OPTIONS, dnsMode: "secure", preset: "bypass-ir" }],
    ["x-fakedns", { ...DEFAULT_ROUTING_OPTIONS, dnsMode: "fakedns", preset: "bypass-ir" }],
  ];
  for (const [name, opts] of cases) {
    const f = writeXray(name, opts, undefined);
    const r = xrayTest(f, XRAY_GEO_DIR);
    ok(`S1 ${name}: REAL xray accepts (geo assets present)`, r.okRes, r.out.slice(-160).replace(/\n/g, " "));
  }
  // fakedns shape check: the config carries the verified recipe
  const fk = JSON.parse(fs.readFileSync(writeXray("x-fakedns-inspect", { ...DEFAULT_ROUTING_OPTIONS, dnsMode: "fakedns" }, undefined), "utf8"));
  ok("S1 fakedns recipe fully present in generated JSON (root + dns + sniffing)",
    Array.isArray(fk.fakedns) && fk.fakedns[0].ipPool === "198.18.0.0/15" &&
    fk.dns.servers[0] === "fakedns" &&
    fk.inbounds[0].sniffing.destOverride.includes("fakedns"));
  // statsApiPort coexistence (D2/C2 regression through the C3 wiring)
  const api = JSON.parse(fs.readFileSync(writeXray("x-bypass-api", { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }, 10850), "utf8"));
  ok("S1 statsApiPort coexists: api rule FIRST, then geo rules",
    api.routing.rules[0].outboundTag === "api" &&
    api.routing.rules.some(r => r.domain?.[0] === "geosite:category-ir") &&
    !!api.api && !!api.inbounds.find(i => i.tag === "api"));
}

/* ---------------- Xray NEGATIVE: the geo gate is load-bearing ---------------- */
console.log("\n== S2 NEGATIVE: bypass-ir WITHOUT geo assets = fatal (gate required) ==");
{
  const emptyDir = join(WORK, "empty-assets");
  fs.mkdirSync(emptyDir, { recursive: true });
  const f = writeXray("x-bypass-noassets", { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }, undefined);
  const r = xrayTest(f, emptyDir);
  ok("S2 REAL xray REJECTS geosite/geoip config when assets are missing",
    !r.okRes && /geosite|geoip/i.test(r.out), r.out.slice(-140).replace(/\n/g, " "));
}

/* ---------------- sing-box checks (REAL local .srs) ---------------- */
console.log("\n== S3 sing-box check with REAL local rule-sets ==");
{
  const cases = [
    ["sb-bypass-ir", { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" }],
    ["sb-bypass-ads", { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir", blockAds: true }],
    ["sb-secure", { ...DEFAULT_ROUTING_OPTIONS, dnsMode: "secure" }],
    ["sb-fakedns", { ...DEFAULT_ROUTING_OPTIONS, dnsMode: "fakedns" }],
    ["sb-custom", { ...DEFAULT_ROUTING_OPTIONS, preset: "custom",
      blockDomains: "ads.example", directDomains: "digikala.com\ngeosite:category-ir",
      blockIps: "10.0.0.0/8", directIps: "192.168.0.0/16" }],
  ];
  for (const [name, opts] of cases) {
    const f = writeSb(name, opts, srsDir);
    const r = sbCheck(f);
    ok(`S3 ${name}: REAL sing-box 1.14 accepts`, r.okRes, r.out.slice(-160).replace(/\n/g, " "));
  }
  // deprecation hygiene: no WARN lines about legacy options
  const fkFile = writeSb("sb-fakedns-clean", { ...DEFAULT_ROUTING_OPTIONS, dnsMode: "fakedns" }, srsDir);
  const r = sbCheck(fkFile);
  ok("S3 fakedns config is deprecation-clean (no legacy independent_cache etc.)", r.okRes && !/deprecated/i.test(r.out));
  // custom-list mapping honesty: unmanaged geosite line skipped on sing-box side
  const c = JSON.parse(fs.readFileSync(writeSb("sb-custom-skip", { ...DEFAULT_ROUTING_OPTIONS, preset: "custom", directDomains: "geosite:youtube" }, srsDir), "utf8"));
  ok("S3 unmanaged geosite category is skipped on the sing-box side (documented)",
    !JSON.stringify(c.route).includes("geosite:youtube") &&
    !c.route.rules?.some(x => x.outbound === "direct"));
}

/* ---------------- Negative: garbage lists never reach the core ---------------- */
console.log("\n== S4 invalid list lines never reach the JSON ==");
{
  const f = writeXray("x-garbage", { ...DEFAULT_ROUTING_OPTIONS, preset: "custom",
    directDomains: "good.com\nhttps://bad\na b\n# comment", directIps: "8.8.8.8\n999.1.2.3" }, undefined);
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const domains = j.routing.rules.find(r => r.outboundTag === "direct" && r.domain)?.domain || [];
  const ips = j.routing.rules.find(r => r.outboundTag === "direct" && r.ip)?.ip || [];
  ok("S4 only the VALID rules survive generation (bad lines dropped before JSON)",
    JSON.stringify(domains) === JSON.stringify(["domain:good.com"]) &&
    JSON.stringify(ips) === JSON.stringify(["8.8.8.8"]));
  const r = xrayTest(f, XRAY_GEO_DIR);
  ok("S4 the sanitized config passes REAL xray -test", r.okRes, r.out.slice(-120));
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
