#!/usr/bin/env node
/**
 * Phase C4 FUNCTIONAL test — the pure topology layer, bundled from the REAL
 * modules via esbuild (taskC4-cfgentry.ts), no mocks:
 *   T1  topologyOptions unit: balancerMemberTags / trafficTagsFor matrices,
 *       loadTopologyOptions forward-compat merge + defensive normalization.
 *   T2  Xray chain: proxy.sockopt.dialerProxy -> "chain-hop", hop outbound
 *       present, no fragment when off; ss/socks mains get a created
 *       streamSettings (the P9 probe shape).
 *   T3  Xray chain + TLS fragment composition: fragment moves to the HOP
 *       (only when the hop carries tls/reality); main keeps chain-hop.
 *   T4  Xray balancer: member tags proxy2..N, routing.balancers + LAST
 *       catch-all rule, strategy mapping, burstObservatory only for
 *       leastPing/leastLoad, extras cap at MAX_BALANCER_EXTRAS.
 *   T5  Xray chain + balancer combined (every member dials through the hop).
 *   T6  DEFAULT byte-compat: omitted topology == DEFAULT_TOPOLOGY_INPUT,
 *       and the output carries NO balancer/hop/observatory artifacts.
 *   T7  sing-box chain (detour) / balancer (urltest group + final) /
 *       combined / wrong-core hop defensively degrades to feature-off /
 *       DEFAULT byte-compat.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TC4_WORK || join(HERE, "taskC4-fn-tmp");
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC4-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c4.cjs")}`], { cwd: HERE, stdio: "pipe" });
const R = createRequire(join(WORK, "c4.cjs"));
const {
  DEFAULT_TOPOLOGY_OPTIONS, DEFAULT_TOPOLOGY_INPUT,
  CHAIN_HOP_TAG, BALANCER_TAG, MAX_BALANCER_EXTRAS,
  balancerMemberTags, trafficTagsFor, loadTopologyOptions,
  generateV2RayConfig, generateSingBoxConfig, DEFAULT_BUILDER_OPTIONS,
} = R(join(WORK, "c4.cjs"));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };
const parse = (g) => JSON.parse(g.json);

// ParsedConfig fixtures (xray family + sing-box family)
const vmessMain = { id: "m1", protocol: "vmess", name: "m1", isValid: true, address: "198.51.100.10", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const vlessHop = { id: "h1", protocol: "vless", name: "h1", isValid: true, address: "198.51.100.20", port: 443, uuid: "c831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const ssExtra = { id: "e1", protocol: "ss", name: "e1", isValid: true, address: "198.51.100.30", port: 8388, method: "aes-256-gcm", password: "pw" };
const vmessExtra = { id: "e2", protocol: "vmess", name: "e2", isValid: true, address: "198.51.100.40", port: 443, uuid: "d831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const socksExtra = { id: "e3", protocol: "socks", name: "e3", isValid: true, address: "198.51.100.50", port: 1080 };
const hystMain = { id: "s1", protocol: "hysteria2", name: "s1", isValid: true, address: "198.51.100.60", port: 443, password: "pw" };
const hystExtra = { id: "s2", protocol: "hysteria2", name: "s2", isValid: true, address: "198.51.100.70", port: 443, password: "pw" };
const hystExtra2 = { id: "s3", protocol: "tuic", name: "s3", isValid: true, address: "198.51.100.80", port: 443, uuid: "e831381d-6324-4d53-ad4f-8cda48b30811", password: "pw" };

/* ---------------- T1: topologyOptions unit ---------------- */
{
  ok("T1 memberTags 0 -> [proxy]", JSON.stringify(balancerMemberTags(0)) === '["proxy"]');
  ok("T1 memberTags 1 -> [proxy,proxy2]", JSON.stringify(balancerMemberTags(1)) === '["proxy","proxy2"]');
  ok("T1 memberTags 3 -> proxy2,proxy3,proxy4", JSON.stringify(balancerMemberTags(3)) === '["proxy","proxy2","proxy3","proxy4"]');
  ok(`T1 memberTags capped at ${MAX_BALANCER_EXTRAS} extras`, balancerMemberTags(50).length === MAX_BALANCER_EXTRAS + 1 && balancerMemberTags(-5).length === 1);
  ok("T1 trafficTagsFor single/chain -> [proxy]", JSON.stringify(trafficTagsFor({ ...DEFAULT_TOPOLOGY_OPTIONS }, 0)) === '["proxy"]' && JSON.stringify(trafficTagsFor({ ...DEFAULT_TOPOLOGY_OPTIONS, chainEnabled: true }, 0)) === '["proxy"]');
  ok("T1 trafficTagsFor balancer -> all members", JSON.stringify(trafficTagsFor({ ...DEFAULT_TOPOLOGY_OPTIONS, balancerEnabled: true }, 3)) === '["proxy","proxy2","proxy3","proxy4"]');
  ok("T1 trafficTagsFor balancer off ignores extras", JSON.stringify(trafficTagsFor({ ...DEFAULT_TOPOLOGY_OPTIONS }, 8)) === '["proxy"]');

  const saved = localStorageStub({ balancerEnabled: true, balancerStrategy: "leastLoad", balancerExtraIds: ["a", 5, null, "b"] });
  const merged = loadTopologyOptions();
  ok("T1 load merge keeps defaults + saved fields", merged.chainEnabled === false && merged.balancerEnabled === true && merged.balancerStrategy === "leastLoad");
  ok("T1 load normalizes extraIds to strings, drops garbage", JSON.stringify(merged.balancerExtraIds) === '["a","b"]');
  localStorageStub({ balancerStrategy: "yolo" });
  ok("T1 load rejects unknown strategy", loadTopologyOptions().balancerStrategy === "random");
  localStorageStub({ balancerExtraIds: "not-an-array" });
  ok("T1 load repairs non-array extraIds", Array.isArray(loadTopologyOptions().balancerExtraIds) && loadTopologyOptions().balancerExtraIds.length === 0);
  localStorageStub(null);
  ok("T1 load with no storage = defaults", JSON.stringify(loadTopologyOptions()) === JSON.stringify(DEFAULT_TOPOLOGY_OPTIONS));
}

function localStorageStub(blob) {
  // loadTopologyOptions reads global localStorage (node env: shim it)
  if (blob === null) { delete globalThis.localStorage; return; }
  globalThis.localStorage = {
    getItem: () => JSON.stringify(blob),
  };
}

/* ---------------- Xray generator ---------------- */
const genX = (main, opts = {}) => generateV2RayConfig(
  main, "socks-http", 14001, 14002, 14050,
  opts.builder ?? DEFAULT_BUILDER_OPTIONS,
  undefined,
  opts.topology,
);

/* ---------------- T2: Xray chain ---------------- */
{
  const c = parse(genX(vmessMain, { topology: { chainHop: socksExtra, balancerExtras: [] } }));
  const proxy = c.outbounds.find(o => o.tag === "proxy");
  const hop = c.outbounds.find(o => o.tag === CHAIN_HOP_TAG);
  ok("T2 proxy dials through chain-hop", proxy?.streamSettings?.sockopt?.dialerProxy === "chain-hop");
  ok("T2 chain-hop outbound is the hop's protocol (socks)", hop?.protocol === "socks" && JSON.stringify(hop?.settings?.servers?.[0]?.address) === JSON.stringify(socksExtra.address));
  ok("T2 no fragment artifacts when fragment off", !c.outbounds.some(o => o.tag === "memento-frag-dialer"));
  ok("T2 no balancer artifacts when balancer off", !c.routing.balancers && !c.outbounds.some(o => o.tag.startsWith("proxy2")));
  ok("T2 default outbounds intact (direct/blocked)", !!c.outbounds.some(o => o.tag === "direct") && !!c.outbounds.some(o => o.tag === "blocked"));

  const css = parse(genX({ ...vmessMain, protocol: "ss", method: "aes-256-gcm", password: "pw" }, { topology: { chainHop: socksExtra, balancerExtras: [] } }));
  ok("T2 ss main (no streamSettings) still chains via created streamSettings", css.outbounds.find(o => o.tag === "proxy")?.streamSettings?.sockopt?.dialerProxy === "chain-hop");
}

/* ---------------- T3: Xray chain + fragment composition ---------------- */
{
  const fragOn = { ...DEFAULT_BUILDER_OPTIONS, tlsFragment: true };
  // TLS hop: fragment rides the hop (3-deep, probe P6)
  const c = parse(genX(vmessMain, { builder: fragOn, topology: { chainHop: vlessHop, balancerExtras: [] } }));
  const proxy = c.outbounds.find(o => o.tag === "proxy");
  const hop = c.outbounds.find(o => o.tag === CHAIN_HOP_TAG);
  ok("T3 chain keeps main on chain-hop (frag does NOT steal the slot)", proxy?.streamSettings?.sockopt?.dialerProxy === "chain-hop");
  ok("T3 TLS hop dials through the fragment dialer", hop?.streamSettings?.sockopt?.dialerProxy === "memento-frag-dialer");
  ok("T3 fragment dialer outbound emitted", c.outbounds.some(o => o.tag === "memento-frag-dialer" && o.settings?.fragment?.packets === "tlshello"));

  // Non-TLS (socks) hop: no fragment anywhere, chain still up
  const c2 = parse(genX(vmessMain, { builder: fragOn, topology: { chainHop: socksExtra, balancerExtras: [] } }));
  ok("T3 socks hop: no fragment (no ClientHello to split)", !c2.outbounds.some(o => o.tag === "memento-frag-dialer") && c2.outbounds.find(o => o.tag === "proxy")?.streamSettings?.sockopt?.dialerProxy === "chain-hop");

  // No chain: C1 behavior intact (fragment on main)
  const c3 = parse(genX(vmessMain, { builder: fragOn, topology: { chainHop: null, balancerExtras: [] } }));
  ok("T3 no chain = C1 fragment on main", c3.outbounds.find(o => o.tag === "proxy")?.streamSettings?.sockopt?.dialerProxy === "memento-frag-dialer");
}

/* ---------------- T4: Xray balancer ---------------- */
{
  const topo = { chainHop: null, balancerExtras: [ssExtra, vmessExtra] };
  const c = parse(genX(vmessMain, { topology: topo }));
  const tags = c.outbounds.map(o => o.tag);
  ok("T4 members renamed proxy2/proxy3 in pool order", tags.includes("proxy2") && tags.includes("proxy3") && !tags.includes("proxy4"));
  ok("T4 member outbounds carry real configs (ss shape)", c.outbounds.find(o => o.tag === "proxy2")?.protocol === "shadowsocks" && c.outbounds.find(o => o.tag === "proxy3")?.protocol === "vmess");
  ok("T4 routing.balancers = [{tag, selector:[proxy], strategy}]", JSON.stringify(c.routing.balancers) === JSON.stringify([{ tag: BALANCER_TAG, selector: ["proxy"], strategy: { type: "random" } }]));
  const last = c.routing.rules[c.routing.rules.length - 1];
  ok("T4 catch-all balancerTag rule is LAST", last.type === "field" && last.network === "tcp,udp" && last.balancerTag === BALANCER_TAG);
  ok("T4 no burstObservatory for random", !c.burstObservatory);

  const c2 = parse(genX(vmessMain, { topology: { chainHop: null, balancerExtras: [] } }));
  const withStrat = (strategy) => parse(genX(vmessMain, { topology: { chainHop: null, balancerExtras: [ssExtra], balancerStrategy: strategy } })).routing.balancers[0].strategy.type;
  ok("T4 strategy mapping roundRobin", withStrat("roundRobin") === "roundRobin");
  ok("T4 strategy mapping leastPing", withStrat("leastPing") === "leastPing");
  ok("T4 strategy mapping leastLoad", withStrat("leastLoad") === "leastLoad");
  const lp = parse(genX(vmessMain, { topology: { chainHop: null, balancerExtras: [ssExtra], balancerStrategy: "leastPing" } }));
  ok("T4 leastPing emits burstObservatory(subjectSelector [proxy])", lp.burstObservatory?.subjectSelector?.[0] === "proxy" && !!lp.burstObservatory?.pingConfig?.destination);
  const ll = parse(genX(vmessMain, { topology: { chainHop: null, balancerExtras: [ssExtra], balancerStrategy: "leastLoad" } }));
  ok("T4 leastLoad emits burstObservatory too", !!ll.burstObservatory);
  ok("T4 balancerEnabled with 0 extras = feature off (no pool)", !c2.routing.balancers);

  const many = Array.from({ length: 12 }, (_, i) => ({ ...ssExtra, id: `x${i}`, name: `x${i}` }));
  const capped = parse(genX(vmessMain, { topology: { chainHop: null, balancerExtras: many } }));
  ok(`T4 extras capped at ${MAX_BALANCER_EXTRAS}`, capped.outbounds.filter(o => /^proxy\d+$/.test(o.tag)).length === MAX_BALANCER_EXTRAS);
}

/* ---------------- T5: Xray chain + balancer combined ---------------- */
{
  const c = parse(genX(vmessMain, { topology: { chainHop: socksExtra, balancerExtras: [ssExtra, vmessExtra] } }));
  ok("T5 members dial through the chain-hop", c.outbounds.find(o => o.tag === "proxy2")?.streamSettings?.sockopt?.dialerProxy === CHAIN_HOP_TAG && c.outbounds.find(o => o.tag === "proxy3")?.streamSettings?.sockopt?.dialerProxy === CHAIN_HOP_TAG);
  ok("T5 chain-hop emitted exactly once", c.outbounds.filter(o => o.tag === CHAIN_HOP_TAG).length === 1);
  ok("T5 pool + balancers + catch-all all present", !!c.routing.balancers?.length && c.routing.rules.at(-1)?.balancerTag === BALANCER_TAG);
}

/* ---------------- T6: Xray DEFAULT byte-compat ---------------- */
{
  const omitted = genX(vmessMain).json;
  const deflt = genX(vmessMain, { topology: DEFAULT_TOPOLOGY_INPUT }).json;
  ok("T6 omitted topology == DEFAULT_TOPOLOGY_INPUT (byte-identical)", omitted === deflt);
  const c = JSON.parse(deflt);
  ok("T6 legacy shape: no balancers / no pool / no hop / no observatory", !c.routing.balancers && !c.outbounds.some(o => /^proxy\d+$|^chain-hop$/.test(o.tag)) && !c.burstObservatory);
  ok("T6 legacy outbound tail [proxy, direct, blocked]", JSON.stringify(c.outbounds.map(o => o.tag)) === JSON.stringify(["proxy", "direct", "blocked"]));
}

/* ---------------- T7: sing-box topology ---------------- */
{
  const genS = (main, topology) => generateSingBoxConfig(main, 14001, 14002, 14050, DEFAULT_BUILDER_OPTIONS, undefined, "", topology);
  const chain = parse(genS(hystMain, { chainHop: hystExtra, balancerExtras: [] }));
  ok("T7 chain: main.detour = chain-hop", chain.outbounds.find(o => o.tag === "proxy")?.detour === CHAIN_HOP_TAG);
  ok("T7 chain: chain-hop outbound is hysteria2", chain.outbounds.find(o => o.tag === CHAIN_HOP_TAG)?.type === "hysteria2");
  ok("T7 chain: route.final stays proxy", chain.route.final === "proxy");

  const bal = parse(genS(hystMain, { chainHop: null, balancerExtras: [hystExtra, hystExtra2] }));
  const group = bal.outbounds.find(o => o.tag === BALANCER_TAG);
  ok("T7 balancer: urltest group with member tags", group?.type === "urltest" && JSON.stringify(group?.outbounds) === JSON.stringify(["proxy", "proxy2", "proxy3"]) && !!group?.url && group?.interval === "3m");
  ok("T7 balancer: route.final = balancer", bal.route.final === BALANCER_TAG);
  ok("T7 balancer: members keep their types (hysteria2/tuic)", bal.outbounds.find(o => o.tag === "proxy2")?.type === "hysteria2" && bal.outbounds.find(o => o.tag === "proxy3")?.type === "tuic");

  const both = parse(genS(hystMain, { chainHop: hystExtra, balancerExtras: [hystExtra2] }));
  ok("T7 chain+balancer: member detours through the hop", both.outbounds.find(o => o.tag === "proxy2")?.detour === CHAIN_HOP_TAG && both.outbounds.find(o => o.tag === BALANCER_TAG)?.outbounds?.includes("proxy2"));

  const wrongCore = parse(genS(hystMain, { chainHop: vmessMain, balancerExtras: [] }));
  ok("T7 wrong-core hop degrades to feature-off (no dangling detour)", wrongCore.outbounds.find(o => o.tag === "proxy")?.detour === undefined && !wrongCore.outbounds.some(o => o.tag === CHAIN_HOP_TAG));

  const manyS = Array.from({ length: 10 }, (_, i) => ({ ...hystExtra, id: `y${i}`, name: `y${i}` }));
  const cappedS = parse(genS(hystMain, { chainHop: null, balancerExtras: manyS }));
  ok("T7 sing-box extras capped too", cappedS.outbounds.filter(o => /^proxy\d+$/.test(o.tag)).length === MAX_BALANCER_EXTRAS);

  const omittedS = genS(hystMain, undefined).json;
  const defltS = genS(hystMain, DEFAULT_TOPOLOGY_INPUT).json;
  // NOTE: the two strings differ ONLY by the fresh clash_api secret —
  // compare the parsed configs with the secret normalized away.
  const stripSecret = (s) => { const c = JSON.parse(s); delete c.experimental?.clash_api?.secret; return JSON.stringify(c); };
  ok("T7 sing-box: omitted topology == DEFAULT (identical modulo the fresh clash secret)", stripSecret(omittedS) === stripSecret(defltS));
  const legacy = JSON.parse(defltS);
  ok("T7 sing-box legacy: no group / no detour / final proxy", !legacy.outbounds.some(o => o.tag === BALANCER_TAG) && legacy.route.final === "proxy" && !legacy.outbounds.some(o => o.detour));
}

console.log(`\nC4-FNTEST: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
