#!/usr/bin/env node
/**
 * Phase C4 QUICK-CHECK — structural surface of Chain Proxy + Balancer
 * (file reads only, no processes). C3 discipline applied: every pin
 * matches CODE FORM, never comment text; negative pins are import/call
 * shaped, never bare words.
 *
 *   N1  topologyOptions.ts: standalone module, tag scheme, member-tag
 *       family, trafficTagsFor contract, cap, defensive load
 *   N2  v2rayConfig.ts chain: 8th param, hop outbound, dialerProxy slots,
 *       3-deep fragment ladder, ss/socks streamSettings creation
 *   N3  v2rayConfig.ts balancer: LAST catch-all rule, balancers[] with
 *       prefix selector ["proxy"], burstObservatory, member family tags
 *   N4  singBoxConfig.ts: detour chain, urltest group, route.final, member
 *       detours, wrong-core degrade shape
 *   N5  connectionActions.ts: hop resolution rules (self/missing/core),
 *       extras dedup+cap+core, trafficTagsFor in the start_xray payload
 *   N6  store.ts: topologyOptions state + setter + re-exports
 *   N7  electron xray.ts: TRAFFIC_TAG_RE, sanitizeTrafficTags, trafficTags
 *       field, per-tag matchers built from trafficTags (exact-segment)
 *   N8  ipc.ts: boundary sanitize + sing-box honest note (no per-tag stats)
 *   N9  RoutingTab.tsx: topology UI wiring (chain/hop/strategy/members/cap)
 *   N10 i18n: topo.* keys x4 parity + the honest vless-uplink caveat in
 *       every locale's balancerHint
 *   N11 default byte-compat: DEFAULT_TOPOLOGY_INPUT imported by BOTH
 *       generators (omitted topology == pre-C4 output)
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");
const EB = join(ROOT, "electron-app");

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };
const read = (f) => fs.readFileSync(f, "utf8");

/* ---- N1 topologyOptions.ts: standalone + tag scheme + contracts ---- */
{
  const to = read(join(SRC, "utils", "topologyOptions.ts"));
  ok("N1 standalone module: no store/zustand imports (generator-bundle safe)",
     !to.includes('from "../store"') || to.includes('import type { ParsedConfig } from "../store"'));
  ok("N1 chain-hop tag never collides with the proxy family (no \"proxy\" prefix)",
     to.includes('export const CHAIN_HOP_TAG = "chain-hop";'));
  ok("N1 balancer group tag constant", to.includes('export const BALANCER_TAG = "balancer";'));
  ok("N1 member family: primary keeps the historical \"proxy\" tag",
     to.includes('const tags: string[] = ["proxy"];') && to.includes("tags.push(`proxy${i}`)"));
  ok("N1 selector is a PREFIX match — comment-pinned contract stays near the code",
     to.includes('PREFIX match'));
  ok("N1 trafficTagsFor: balancer -> every member tag; else exactly [\"proxy\"]",
     to.includes("opts.balancerEnabled") && to.includes('balancerMemberTags(resolvedExtrasCount)') &&
     to.includes(': ["proxy"];'));
  ok("N1 pool cap exported (primary + 8 extras)", to.includes("export const MAX_BALANCER_EXTRAS = 8;"));
  ok("N1 defensive load: arrays stay arrays, strategy whitelisted, ids stringified",
     to.includes("Array.isArray(merged.balancerExtraIds)") &&
     to.includes('["random", "roundRobin", "leastPing", "leastLoad"].includes'));
  ok("N1 generator input is PRESENCE-shaped (pure builders, no store access)",
     to.includes("export interface TopologyInput {") &&
     to.includes("chainHop?: ParsedConfig | null;") && to.includes("balancerExtras?: ParsedConfig[];"));
}

/* ---- N2 v2rayConfig.ts chain ---- */
{
  const vc = read(join(SRC, "utils", "v2rayConfig.ts"));
  ok("N2 8th generator param with DEFAULT byte-compat",
     vc.includes("topology: TopologyInput = DEFAULT_TOPOLOGY_INPUT,"));
  ok("N2 hop outbound built with mux disabled (carrier is transport, not exit)",
     vc.includes("buildOutbound(hopConfig, { ...builderOptions, muxEnabled: false })"));
  ok("N2 hop tag reassigned to CHAIN_HOP_TAG before any dialer references it",
     vc.includes("built.tag = CHAIN_HOP_TAG;"));
  ok("N2 fragment moves to the HOP only when the hop carries tls/reality",
     vc.includes("if (fragDialer && fragmentApplies(built)) {"));
  ok("N2 main keeps the C1 fragment slot only when chain is OFF",
     vc.includes("const useFragment = !!fragDialer && fragmentApplies(outbound) && !hopOutbound;"));
  ok("N2 ss/socks mains get a created streamSettings (the probe-verified shape)",
     vc.includes('outbound.streamSettings ?? (outbound.streamSettings = { network: "tcp" })'));
  ok("N2 every pool member dials through the same hop when combined",
     vc.includes("if (hopOutbound) {\n      const ss = (built.streamSettings"));
}

/* ---- N3 v2rayConfig.ts balancer ---- */
{
  const vc = read(join(SRC, "utils", "v2rayConfig.ts"));
  ok("N3 member tags come from the SAME helper the stats use",
     vc.includes("const memberTags = balancerMemberTags(extras.length);") &&
     vc.includes("built.tag = memberTags[i + 1];"));
  ok("N3 catch-all balancer rule pushed LAST (earlier rules keep winning by order)",
     vc.includes("routingBuild.routing.rules.push({\n      type: \"field\",\n      network: \"tcp,udp\",\n      balancerTag: BALANCER_TAG,\n    });"));
  ok("N3 balancers[] with the prefix selector covering the whole family",
     vc.includes('selector: ["proxy"],') && vc.includes("strategy: { type: topology.balancerStrategy || \"random\" },"));
  ok("N3 burstObservatory emitted only for the probing strategies",
     vc.includes("burstObservatory: {"));
  ok("N3 unbuildable extras are filtered, never emitted as dangling references",
     vc.includes(".filter((o): o is Record<string, unknown> => o !== null);"));
}

/* ---- N4 singBoxConfig.ts topology ---- */
{
  const sc = read(join(SRC, "utils", "singBoxConfig.ts"));
  ok("N4 7th generator param with DEFAULT byte-compat",
     sc.includes("topology: TopologyInput = DEFAULT_TOPOLOGY_INPUT,"));
  ok("N4 chain = outbound.detour -> CHAIN_HOP_TAG (sing-box's dialerProxy)",
     sc.includes("outbound.detour = CHAIN_HOP_TAG;"));
  ok("N4 urltest group tagged \"balancer\" with the member family",
     sc.includes('tag: BALANCER_TAG,\n        outbounds: memberTags,') && sc.includes('interval: "3m",'));
  ok("N4 route.final enters the group only when a pool exists",
     sc.includes("if (balancerActive) sbRouting.route.final = BALANCER_TAG;"));
  ok("N4 wrong-core hop degrades to feature-off (no dangling detour)",
     sc.includes("const built = buildSbOutbound(hopConfig, false); // E2: no shadowtls pair in topology") &&
     sc.includes("let hopOutbound: Record<string, unknown> | null = null;"));
  ok("N4 members keep their own types (hysteria2/tuic stay buildable)",
     sc.includes("const built = buildSbOutbound(extra, false); // E2: no shadowtls pair in topology"));
}

/* ---- N5 connectionActions.ts resolution + stats payload ---- */
{
  const ca = read(join(SRC, "utils", "connectionActions.ts"));
  ok("N5 self-chain skipped with an honest notice (not an abort)",
     ca.includes("topo.chainHopId === configId") &&
     ca.includes("connecting without the chain"));
  ok("N5 missing/invalid hop aborts the connect (never a silent plain connect)",
     ca.includes("no longer exists or is invalid") && ca.includes("return false;"));
  ok("N5 hop core must match the connected core (mixed-core chain impossible)",
     ca.includes("configCore(hop) !== core"));
  ok("N5 extras deduped against the primary + each other, capped at MAX",
     ca.includes("topo.balancerExtraIds.slice(0, MAX_BALANCER_EXTRAS)") &&
     ca.includes("new Set<string>([configId])"));
  ok("N5 wrong-core extras dropped with names, zero usable picks aborts",
     ca.includes("configCore(c) !== core") &&
     ca.includes("none of the picked members can join this pool"));
  ok("N5 zero picks with balancer on aborts (a one-member \"pool\" is not a pool)",
     ca.includes("no member configs are picked"));
  ok("N5 the start_xray payload carries trafficTagsFor(topology)",
     ca.includes("trafficTags: trafficTagsFor(topo, balancerExtras.length),"));
}

/* ---- N6 store.ts state ---- */
{
  const st = read(join(SRC, "store.ts"));
  ok("N6 state field + loadTopologyOptions init (persisted via storage key)",
     st.includes("topologyOptions: TopologyOptions;") &&
     st.includes("topologyOptions: loadTopologyOptions(),"));
  ok("N6 setter merges patches over the current topology",
     st.includes("const next = { ...state.topologyOptions, ...patch };"));
  ok("N6 tag/stats helpers re-exported for the app surface",
     st.includes("export { DEFAULT_TOPOLOGY_OPTIONS, balancerMemberTags, trafficTagsFor } from \"./utils/topologyOptions\";"));
}

/* ---- N7 electron xray.ts stats extension ---- */
{
  const xr = read(join(EB, "electron", "xray.ts"));
  ok("N7 tag charset whitelist (plain tag-shaped strings only)",
     xr.includes('const TRAFFIC_TAG_RE = /^[A-Za-z0-9_-]{1,64}$/;'));
  ok("N7 sanitizer: bounded (16), deduped, non-empty -> [\"proxy\"] fallback",
     xr.includes("seen.size >= 16") && xr.includes(': ["proxy"];') &&
     xr.includes("export function sanitizeTrafficTags(input: unknown): string[] {"));
  ok("N7 manager carries the counted set per start (default [\"proxy\"])",
     xr.includes('private trafficTags: string[] = ["proxy"];') &&
     xr.includes("this.trafficTags = sanitizeTrafficTags(trafficTags);"));
  ok("N7 matchers built from the topology's tags (exact-segment, no bare word)",
     xr.includes("trafficTags.map((t) => `>>>${t}>>>traffic>>>uplink`)") &&
     xr.includes("trafficTags.map((t) => `>>>${t}>>>traffic>>>downlink`)"));
  ok("N7 includes-match with exact segments: proxy2 can never satisfy the proxy matcher",
     xr.includes('if (upMatchers.some((m) => name.includes(m))) uplink += value;'));
  ok("N7 queryXrayTraffic signature takes the counted set",
     xr.includes('trafficTags: string[] = ["proxy"]'));
  ok("N7 getTraffic routes through the per-start set",
     xr.includes("queryXrayTraffic(xrayPath, apiPort, this.trafficTags)"));
}

/* ---- N8 ipc.ts boundary ---- */
{
  const ip = read(join(EB, "electron", "ipc.ts"));
  ok("N8 trafficTags typed as unknown at the boundary (never trusted)",
     ip.includes("trafficTags?: unknown;"));
  ok("N8 sanitized at the IPC boundary too (defense in depth)",
     ip.includes("const trafficTags = sanitizeTrafficTags(args?.trafficTags);"));
  ok("N8 only the Xray manager receives the set; sing-box honestly ignores it",
     ip.includes("core === \"sing-box\"") &&
     ip.includes("xrayManager.startXray(configJson, socksPort, httpPort, apiPort, trafficTags)"));
}

/* ---- N9 RoutingTab.tsx UI wiring ---- */
{
  const rt = read(join(SRC, "components", "RoutingTab.tsx"));
  ok("N9 topology state subscribed from the store",
     rt.includes("const topologyOptions = useStore(s => s.topologyOptions);"));
  ok("N9 chain toggle + hop select gated behind chainEnabled",
     rt.includes("checked={topologyOptions.chainEnabled}") &&
     rt.includes("value={topologyOptions.chainHopId ?? \"\"}"));
  ok("N9 balancer toggle + strategy cards gated behind balancerEnabled",
     rt.includes("checked={topologyOptions.balancerEnabled}") &&
     rt.includes("const active = topologyOptions.balancerStrategy === s.id;"));
  ok("N9 member checkboxes enforce the cap (disabled at MAX, slices on add)",
     rt.includes("const atCap = !checked && topologyOptions.balancerExtraIds.length >= MAX_BALANCER_EXTRAS;") &&
     rt.includes("[...topologyOptions.balancerExtraIds, c.id].slice(0, MAX_BALANCER_EXTRAS)"));
  ok("N9 members count line bound to the cap",
     rt.includes('t("topo.membersCount", language)'));
}

/* ---- N10 i18n parity + honest caveat ---- */
{
  const i18n = read(join(SRC, "i18n.ts"));
  const countKey = (k) => (i18n.match(new RegExp(`"${k.replace(/\./g, "\\.")}"`, "g")) || []).length;
  ok("N10 topo.* core keys exist in ALL 4 locales",
     ["topo.title", "topo.chain", "topo.chainHint", "topo.chainHop", "topo.balancer",
      "topo.balancerHint", "topo.strategy", "topo.members", "topo.membersCount",
      "topo.memberPrimary", "topo.noConfigs"].every(k => countKey(k) === 4));
  ok("N10 strategy keys x4 (4 strategies + generic label)",
     ["topo.strategyRandom", "topo.strategyRoundRobin", "topo.strategyLeastPing", "topo.strategyLeastLoad"]
       .every(k => countKey(k) === 4));
  ok("N10 balancerHint carries the honest vless-uplink core caveat in all locales",
     (i18n.match(/"topo\.balancerHint": "[^"]*vless[^"]*"/g) || []).length === 4);
  ok("N10 the old \"no silent zeros\" over-promise is gone from every locale",
     !(i18n.includes("no silent zeros") || i18n.includes("هیچ صفرِ خاموشی") ||
       i18n.includes("不会静默归零") || i18n.includes("لا أصفار صامتة")));
}

/* ---- N11 default byte-compat guards ---- */
{
  const vc = read(join(SRC, "utils", "v2rayConfig.ts"));
  const sc = read(join(SRC, "utils", "singBoxConfig.ts"));
  ok("N11 BOTH generators import the DEFAULT topology input",
     vc.includes("DEFAULT_TOPOLOGY_INPUT,") && sc.includes("DEFAULT_TOPOLOGY_INPUT,"));
  ok("N11 presence-contract comment pinned in both builders (absent = feature off)",
     vc.includes("TopologyInput intent is PRESENCE") && sc.includes("TopologyInput intent is PRESENCE"));
}

console.log(`\nC4-QUICKCHECK: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
