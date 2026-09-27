#!/usr/bin/env node
/**
 * Phase C3 QUICK-CHECK — structural surface of routing presets + custom
 * rules + geo files + DNS/FakeDNS (file reads only, no processes). Lesson
 * from D4/C1/C2 applied: tsc keeps comments, so every pin matches CODE
 * FORM, never comment text; negative pins are import/call-shaped, never
 * bare words.
 *
 *   N1  routingOptions.ts: standalone module, legacy defaults, caps
 *   N2  builders: xray base-rules-first + geo constants; sing-box rule_set
 *   N3  v2rayConfig: 7th param + fakedns root spread + destOverride wiring
 *   N4  singBoxConfig: 6th/7th params + conditional dns + extra outbounds
 *   N5  connectionActions: geo gate BEFORE start_xray (code-order pin)
 *   N6  urlTest: probes inherit routing + one geo_ensure per family
 *   N7  geoFiles.ts: pinned sources, size sanity, atomic install
 *   N8  ipc.ts: geo handlers with family whitelist
 *   N9  preload: allowlist 23 incl. the geo pair
 *   N10 RoutingTab: presets/lists/dns/geo/preview all wired
 *   N11 store: routingOptions + geoStatus, no electron imports
 *   N12 App + Sidebar: the routing tab is registered
 *   N13 electron-mock: honest geo stubs
 *   N14 i18n: rt.* + tab.routing keys x4 with parity (fresh bundle)
 *   N15 C3-fix: geoPreparing transient state (guard + try/finally + UI)
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");
const EB = join(ROOT, "electron-app");

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };
const read = (f) => fs.readFileSync(f, "utf8");

/* ---- N1 routingOptions.ts: standalone + legacy defaults + caps ---- */
{
  const ro = read(join(SRC, "utils", "routingOptions.ts"));
  ok("N1 standalone module: no store/zustand imports (generator-bundle safe)",
     !ro.includes('from "../store"') && !ro.includes('from "zustand"'));
  ok("N1 DEFAULT = legacy byte-behavior (standard/default/empty)",
     ro.includes('preset: "standard"') && ro.includes('dnsMode: "default"') &&
     ro.includes('blockAds: false') && ro.includes('directDomains: "",'));
  ok("N1 list cap constant exported", ro.includes("export const ROUTING_LIST_MAX = 200;"));
  ok("N1 pure parsers exported",
     ro.includes("export function parseDomainRule(") && ro.includes("export function parseIpRule(") &&
     ro.includes("export function parseRuleList("));
  ok("N1 geo helpers exported",
     ro.includes("export function routingNeedsGeo(") && ro.includes("export function requiredGeoFiles("));
  ok("N1 GeoStatus mirror declared renderer-side (no electron import)",
     ro.includes("export interface GeoStatus {") && ro.includes("xrayDir: string;") && ro.includes("srsDir: string;"));
}

/* ---- N2 builders ---- */
{
  const ro = read(join(SRC, "utils", "routingOptions.ts"));
  ok("N2 xray Iran category = geosite:category-ir (bare geosite:ir NOT in official dat)",
     ro.includes('export const GEO_IR_XRAY_DOMAIN = "geosite:category-ir";') &&
     ro.includes('export const GEO_IR_XRAY_IP = "geoip:ir";'));
  ok("N2 xray builder: base rules stay FIRST (api never shadowed)",
     ro.includes("const rules: Record<string, unknown>[] = [...baseRules];"));
  ok("N2 xray geo => IPIfNonMatch (geoip needs resolved IPs)",
     ro.includes('const domainStrategy = needsGeo ? "IPIfNonMatch" : "AsIs";'));
  ok("N2 fakedns pool constant + root fakedns only in fakedns mode",
     ro.includes('export const FAKEDNS_POOL = "198.18.0.0/15";') &&
     ro.includes("if (opts.dnsMode === \"fakedns\") {"));
  ok("N2 sing-box builder: local binary rule_set + default_domain_resolver",
     ro.includes('{ type: "local", tag: GEO_IR_SRS_GEOSITE, format: "binary", path:') &&
     ro.includes("route.default_domain_resolver = defaultResolver;"));
  ok("N2 sing-box legacy byte-shape: empty rules => { final } only",
     ro.includes("rules.length ? { rules, final: \"proxy\" } : { final: \"proxy\" }"));
  ok("N2 sing-box offline fallbacks are honest (embedded list / keyword surrogate), no fake geo",
     ro.includes("domain_suffix: MINIMAL_IR_DOMAINS") && ro.includes("domain_keyword:"));
  ok("N2 custom-list mapping honesty: unmanaged geo lines filtered sing-box-side",
     ro.includes('filter(r => !r.startsWith("geosite:"))') && ro.includes('filter(r => !r.startsWith("geoip:"))'));
}

/* ---- N3 v2rayConfig wiring ---- */
{
  const vc = read(join(SRC, "utils", "v2rayConfig.ts"));
  ok("N3 routingOptions is the 7th parameter (older call sites unaffected)",
     vc.includes("routingOptions: RoutingOptions = DEFAULT_ROUTING_OPTIONS,"));
  ok("N3 dns/routing come from the build + fakedns spread only when present",
     vc.includes("dns: routingBuild.dns,") && vc.includes("routing: routingBuild.routing,") &&
     vc.includes("...(routingBuild.fakedns ? { fakedns: routingBuild.fakedns } : {}),"));
  ok("N3 base rules: api first, bittorrent builder toggle preserved",
     vc.includes("inboundTag: [\"api\"],") && vc.includes("builderOptions.blockBittorrent ? [{"));
  ok("N3 sniffing destOverride rides the build (fakedns override)",
     vc.includes("sniffingDestOverride: string[] = [\"http\", \"tls\"]") &&
     vc.includes("destOverride: sniffingDestOverride }"));
}

/* ---- N4 singBoxConfig wiring ---- */
{
  const sb = read(join(SRC, "utils", "singBoxConfig.ts"));
  ok("N4 routingOptions (6th) + srsDir (7th) parameters",
     sb.includes("routingOptions: RoutingOptions = DEFAULT_ROUTING_OPTIONS,") &&
     sb.includes('srsDir: string = "",'));
  ok("N4 extra outbounds + conditional dns + route from the build (C4 re-point: the outbounds array grew hop/pool members)",
     sb.includes("...(hopOutbound ? [hopOutbound] : []),") &&
     sb.includes("...extraOutbounds,") && sb.includes("...balancerGroup,") &&
     sb.includes("route: sbRouting.route,") && sb.includes("if (sbRouting.dns) fullConfig.dns = sbRouting.dns;"));
}

/* ---- N5 connectionActions: geo gate BEFORE start_xray (code order) ---- */
{
  const ca = read(join(SRC, "utils", "connectionActions.ts"));
  const gate = ca.indexOf('requiredGeoFiles(state.routingOptions, core)');
  const spawnInvoke = ca.indexOf('"start_xray"');
  ok("N5 geo gate code-order: requiredGeoFiles + geo_ensure run BEFORE start_xray",
     gate > -1 && spawnInvoke > -1 && gate < spawnInvoke);
  ok("N5 gate is core-aware (xray family vs srs family)",
     ca.includes('core === "sing-box" ? "srs" : "xray"'));
  ok("N5 gate failure aborts with the exact reason (never a doomed spawn)",
     ca.includes("connect aborted") && ca.includes("return false;"));
  ok("N5 both generators receive the routing options (+ srsDir sing-box side)",
     ca.includes("state.builderOptions,\n        state.routingOptions,") &&
     ca.includes("state.routingOptions,\n        srsDir,"));
  // --- C3-fix pins: transient geoPreparing state (user-approved) ---
  const gateEnsure = ca.indexOf('"geo_ensure"');
  const prepSet = ca.indexOf("useStore.getState().setGeoPreparing(true);");
  ok("N5 geoPreparing set BEFORE the geo_ensure invoke (code order)",
     prepSet > -1 && gateEnsure > -1 && prepSet < gateEnsure);
  ok("N5 re-entry guard: second connect while preparing bails before the gate",
     ca.indexOf("if (useStore.getState().geoPreparing)") > -1 &&
     ca.indexOf("if (useStore.getState().geoPreparing)") < prepSet);
  ok("N5 flag cleared in finally (no stuck flag on any exit path)",
     /} finally \{\s*\/\/ Cleared on EVERY path[\s\S]*?setGeoPreparing\(false\);/.test(ca));
}

/* ---- N6 urlTest probes inherit routing ---- */
{
  const ut = read(join(SRC, "utils", "urlTest.ts"));
  ok("N6 probe configs carry routingOptions + srsDir",
     ut.includes("state.builderOptions, state.routingOptions") &&
     ut.includes("state.builderOptions, state.routingOptions, srsDir)"));
  ok("N6 one geo_ensure per affected family before the pool",
     ut.includes("async function ensureGeoForProbes(") &&
     ut.includes('await ensureGeoForProbes(configs);') &&
     ut.includes('"xray" as const') && ut.includes('"srs" as const'));
}

/* ---- N7 geoFiles.ts (main process) ---- */
{
  const gf = read(join(EB, "electron", "geoFiles.ts"));
  ok("N7 xray dat sources pinned to the SAME release as the core",
     gf.includes("`https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/geoip.dat`"));
  ok("N7 srs sources pinned to the verified MetaCubeX sing branch (category naming)",
     gf.includes("meta-rules-dat/sing/geo/geosite/category-ir.srs") &&
     gf.includes("meta-rules-dat/sing/geo/geoip/ir.srs") &&
     gf.includes("geosite/category-ads-all.srs"));
  ok("N7 byte-size sanity per file (no truncated/error-page installs)",
     gf.includes("MIN_BYTES") && gf.includes("refusing to install"));
  ok("N7 atomic tmp+rename install", gf.includes(".memento-tmp") && gf.includes("renameSync"));
  ok("N7 srs live in dataDir/sing-box (xray dats in dataDir via XRAY_LOCATION_ASSET)",
     gf.includes('path.join(dataDir(), "sing-box")'));
  ok("N7 per-file errors reported, never thrown (UI shows the exact reason)",
     gf.includes("errors[name] ="));
}

/* ---- N8 ipc handlers ---- */
{
  const ipc = read(join(EB, "electron", "ipc.ts"));
  ok("N8 geo_status + geo_ensure handlers shipped",
     ipc.includes('ipcMain.handle("geo_status", () => geoStatus());') &&
     ipc.includes('"geo_ensure"'));
  ok("N8 family whitelist (xray|srs only)", ipc.includes('args?.family === "xray" || args?.family === "srs"'));
}

/* ---- N9 preload allowlist ---- */
{
  const preload = read(join(EB, "electron", "preload.ts"));
  const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
  ok("N9 allowlist = 32 commands incl. url_test + geo_status + geo_ensure (re-pointed 27 at C6; 31 after B2: the 4 routing commands; 32 after E1: the connection-stats probe)",
     allow.length === 32 && allow.includes("url_test") && allow.includes("geo_status") && allow.includes("geo_ensure") && allow.includes("app_update_info"),
     `got ${allow.length}`);
}

/* ---- N10 RoutingTab UI ---- */
{
  const rt = read(join(SRC, "components", "RoutingTab.tsx"));
  ok("N10 all three preset cards + custom preset gates the lists",
     rt.includes('id: "standard"') && rt.includes('id: "bypass-ir"') && rt.includes('id: "custom"') &&
     rt.includes('routingOptions.preset === "custom" && ('));
  ok("N10 DNS mode cards incl. the honest fakedns caveat",
     rt.includes('"fakedns"') && rt.includes("rt.fakednsNote"));
  ok("N10 geo card: desktop-only honest branch + real status rows + update button",
     rt.includes("rt.geoDesktopOnly") && rt.includes('tauriInvoke<GeoStatus>("geo_status")') &&
     rt.includes('ensureGeo("srs", true)'));
  ok("N10 live preview builds BOTH cores from the pure builders",
     rt.includes("buildXrayRouting(opts, [])") && rt.includes("buildSingBoxRouting(opts, [], geoStatus?.srsDir ?? \"\")"));
  ok("N10 Aether honesty note present", rt.includes("rt.aetherNote"));
}

/* ---- N11 store ---- */
{
  const st = read(join(SRC, "store.ts"));
  ok("N11 routingOptions + geoStatus state + persistence",
     st.includes("routingOptions: loadRoutingOptions(),") &&
     st.includes("ROUTING_OPTIONS_STORAGE_KEY, JSON.stringify(next)") &&
     st.includes("geoStatus: null,") && st.includes("setGeoStatus: (s) => set({ geoStatus: s }),"));
  ok("N11 C3-fix: geoPreparing transient flag + setter in the store",
     st.includes("geoPreparing: boolean;") && st.includes("setGeoPreparing: (v: boolean) => void;") &&
     st.includes("geoPreparing: false,") && st.includes("setGeoPreparing: (v) => set({ geoPreparing: v }),"));
  ok("N11 renderer store imports NO electron code (bundle safety)",
     !st.includes('from "../electron-app'));
}

/* ---- N12 App + Sidebar ---- */
{
  const app = read(join(SRC, "App.tsx"));
  const sb = read(join(SRC, "components", "Sidebar.tsx"));
  ok("N12 routing tab rendered in App", app.includes('{activeTab === "routing" && <RoutingTab />}'));
  ok("N12 sidebar entry with its own icon", sb.includes('{ id: "routing", label: "tab.routing", icon: Route'));
}

/* ---- N13 electron-mock honesty ---- */
{
  const mock = read(join(SRC, "electron-mock.ts"));
  ok("N13 mock geo_status reports all-missing + no data dir",
     mock.includes('xrayDir: "(browser preview — no data dir)"') && mock.includes('"geoip.dat": missing'));
  ok("N13 mock geo_ensure fails with the exact reason (never fakes a download)",
     mock.includes('errors: { _: "Desktop only (mock preview) — geo files live next to the cores" }'));
}

/* ---- N14 i18n parity (fresh bundle) ---- */
{
  const bundle = join(HERE, "taskC3-i18n.cjs");
  execFileSync("npx", ["esbuild", join(HERE, "taskC3-entry.ts"), "--bundle", "--platform=node", "--outfile=" + bundle], { cwd: HERE, stdio: "pipe" });
  const { langs } = JSON.parse(execFileSync("node", [bundle], { encoding: "utf8" }));
  const need = ["tab.routing", "connection.preparingGeo", "rt.hint", "rt.preset", "rt.presetStandard", "rt.presetStandardHint",
    "rt.presetBypassIr", "rt.presetBypassIrHint", "rt.presetCustom", "rt.presetCustomHint",
    "rt.blockAds", "rt.blockAdsHint", "rt.lists", "rt.listHint", "rt.blockDomains", "rt.directDomains",
    "rt.proxyDomains", "rt.blockIps", "rt.directIps", "rt.proxyIps", "rt.listBad", "rt.listGeoNote",
    "rt.dns", "rt.dnsDefault", "rt.dnsDefaultHint", "rt.dnsSecure", "rt.dnsSecureHint",
    "rt.dnsFakedns", "rt.dnsFakednsHint", "rt.fakednsNote", "rt.geo", "rt.geoXray", "rt.geoSrs",
    "rt.geoMissing", "rt.geoDownload", "rt.geoUpdate", "rt.geoDownloading", "rt.geoDone",
    "rt.geoUpdated", "rt.geoDesktopOnly", "rt.preview", "rt.previewXray", "rt.previewSingBox",
    "rt.aetherNote"];
  const names = Object.keys(langs);
  let parityOk = names.length === 4;
  for (const k of need) {
    const n = names.filter(l => langs[l].includes(k)).length;
    if (n !== 4) { parityOk = false; console.log(`        missing ${k} in ${4 - n} language(s)`); }
  }
  ok(`N14 ${need.length} new C3 keys present in ALL four languages`, parityOk);
  ok("N14 C2 keys untouched (regression)", names.filter(l => langs[l].includes("configs.urlTestAll")).length === 4);
  ok("N14 C1 keys untouched (regression)", names.filter(l => langs[l].includes("connection.trafficTitle")).length === 4);
}

/* ---- N15 C3-fix: ConnectionTab preparing state (user-approved fix) ---- */
{
  const ct = read(join(SRC, "components", "ConnectionTab.tsx"));
  ok("N15 explicit preparing branch FIRST (beats the idle Connect button)",
     ct.indexOf("geoPreparing ? (") > -1 &&
     ct.indexOf("geoPreparing ? (") < ct.indexOf('status === "disconnected" || status === "error" ? ('));
  ok("N15 preparing button: disabled + spinner (no dead-looking idle state)",
     ct.includes("<Loader2 className=\"w-6 h-6 animate-spin\" />") &&
     /geoPreparing \? \([\s\S]*?disabled\s*\n/.test(ct));
  ok("N15 preparing button is i18n-wired (connection.preparingGeo)",
     ct.includes('t("connection.preparingGeo", language)'));
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
