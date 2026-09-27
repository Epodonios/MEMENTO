#!/usr/bin/env node
/**
 * Phase C4: rebuild download/MEMENTO-electron-migration.zip and run
 * in-archive verification for the Batch-C4 features (chain proxy +
 * balancer: the topologyOptions tag scheme, both generators, the
 * connect-flow resolution, the sanitizeTrafficTags counting boundary,
 * the RoutingTab UI, the honest balancerHint caveat, and the tracked
 * Xray v25.1.1 uplink-gap documentation in BOTH places — balancer card
 * + README/TESTING-CHECKLIST §25.1) AND the full regression pin chain
 * (Task-13/12 + D1 + D2 + D3 + D4 + C1 + C2 + C3). Same exclusion rules
 * as every previous phase; binaries are never shipped.
 *
 * Negative pins are API-shaped (imports / call forms), never bare words —
 * a C1 lesson: legitimate doc comments may mention the forbidden thing.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SRC = "/home/z/my-project/memento-src";
const OUT = "/home/z/my-project/download/MEMENTO-electron-migration.zip";

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "dist-electron", "release", "target"].includes(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      if (entry.name === ".gitignore" || [".tsbuildinfo", ".log"].includes(path.extname(entry.name))) continue;
      files.push(path.join(dir, entry.name));
    }
  }
})(SRC);

fs.rmSync(OUT, { force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const X = [
  "node_modules/*", "*/node_modules/*",
  "dist/*", "*/dist/*",
  "dist-electron/*", "*/dist-electron/*",
  "release/*", "*/release/*",
  "target/*", "*/target/*",
  "*.tsbuildinfo", "*.log",
  "scripts/taskD4-quitclean-tmp/*", "scripts/taskD4-smoke-tmp/*",
  "scripts/taskD4-fn-tmp/*", "scripts/taskD3-*-tmp/*", "scripts/taskD2-*-tmp/*",
  "scripts/taskC1-*-tmp/*", "scripts/taskC1-smoke-tmp/*",
  "scripts/taskC2-*-tmp/*", "scripts/taskC2-smoke-tmp/*",
  "scripts/taskC3-*-tmp/*", "scripts/taskC3-smoke-tmp/*",
  "scripts/taskC4-*-tmp/*", "scripts/taskC4-smoke-tmp/*", "scripts/taskC4-live-tmp/*",
];
execFileSync("zip", ["-q", "-r", OUT, ".", ...X.flatMap((p) => ["-x", p])], { cwd: SRC });

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`zip rebuilt: ${OUT}`);
console.log(`size: ${mb} MB`);

const listing = execFileSync("unzip", ["-Z1", OUT], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const entries = listing.split("\n").filter((l => l && !l.endsWith("/")));
console.log(`file entries: ${entries.length}`);

let bad = 0;
const must = (m) => {
  if (!entries.includes(m)) { console.error(`FAIL  missing key file in zip: ${m}`); bad++; return; }
  console.log(`PASS  zip contains ${m}`);
};

// Task-13 key files (regression)
["src/store.ts", "src/utils/v2rayConfig.ts", "src/components/BrokersModal.tsx",
 "src/utils/subscription.ts", "src/utils/editor.ts", "src/utils/ping.ts",
 "src/components/ConfigsTab.tsx", "src/components/ExportTab.tsx",
 "scripts/task13-smoke.mjs", "scripts/task13-selftest.mjs", "scripts/task13-cfgtest.mjs",
 "scripts/task13-remote-udp-probe.mjs", "scripts/task13-udp-finalize.mjs",
 "scripts/task13-store.cjs", "scripts/task13-cfg.cjs", "scripts/task13-sub.cjs",
 "electron-app/TESTING-CHECKLIST.md", "electron-app/README.md"].forEach(must);

// Task-12 key files (regression)
["electron-app/electron/aether.ts", "electron-app/electron/core-versions.json",
 "electron-app/resources/aether/README.md", "src/components/AetherTab.tsx",
 "scripts/task12-aether-smoke.mjs"].forEach(must);

// Phase-D1 key files (regression)
["electron-app/electron/ipc.ts", "electron-app/electron/preload.ts",
 "src/components/ConnectionManager.tsx", "src/components/ConnectionTab.tsx",
 "src/electron-mock.ts", "src/i18n.ts",
 "scripts/taskD1-quickcheck.mjs", "scripts/taskD1-entry.ts", "scripts/taskD1-i18n.cjs",
 "scripts/taskD1-smoke.mjs"].forEach(must);

// Phase-D2 key files (regression)
["src/utils/builderOptions.ts", "src/components/SubscriptionGroups.tsx",
 "src/utils/singBoxConfig.ts",
 "scripts/taskD2-quickcheck.mjs", "scripts/taskD2-cfgtest.mjs", "scripts/taskD2-entry.ts",
 "scripts/taskD2-cfgentry.ts", "scripts/taskD2-cfg.cjs", "scripts/taskD2-i18n.cjs",
 "scripts/taskD2-smoke.mjs", "scripts/taskD2-zip.mjs"].forEach(must);

// Phase-D3 key files (regression)
["src/utils/appBackup.ts", "src/utils/qrShare.ts", "src/components/QrModal.tsx",
 "src/components/ImportTab.tsx", "electron-app/electron/appPrefs.ts",
 "scripts/taskD3-quickcheck.mjs", "scripts/taskD3-fntest.mjs", "scripts/taskD3-entry.ts",
 "scripts/taskD3-fnentry.ts", "scripts/taskD3-i18n.cjs",
 "scripts/taskD3-smoke.mjs", "scripts/taskD3-zip.mjs"].forEach(must);

// Phase-D4 key files (regression)
["electron-app/electron/tray.ts", "electron-app/electron/main.ts",
 "src/components/SettingsTab.tsx",
 "scripts/taskD4-quickcheck.mjs", "scripts/taskD4-fntest.mjs",
 "scripts/taskD4-quitclean-fntest.mjs", "scripts/taskD4-electron-stub.mts",
 "scripts/taskD4-entry.ts", "scripts/taskD4-fnentry.ts", "scripts/taskD4-i18n.cjs",
 "scripts/taskD4-smoke.mjs", "scripts/taskD4-zip.mjs"].forEach(must);

// Phase-C1 key files (regression)
["src/utils/trafficHistory.ts", "src/components/TrafficChart.tsx",
 "scripts/taskC1-quickcheck.mjs", "scripts/taskC1-fntest.mjs",
 "scripts/taskC1-cfgtest.mjs", "scripts/taskC1-live.mjs",
 "scripts/taskC1-entry.ts", "scripts/taskC1-cfgentry.ts", "scripts/taskC1-i18n.cjs",
 "scripts/taskC1-smoke.mjs", "scripts/taskC1-zip.mjs"].forEach(must);

// Phase-C2 key files (regression)
["src/utils/latencyHistory.ts", "src/utils/urlTest.ts", "electron-app/electron/urlTest.ts",
 "scripts/taskC2-quickcheck.mjs", "scripts/taskC2-fntest.mjs",
 "scripts/taskC2-cfgtest.mjs", "scripts/taskC2-live.mjs",
 "scripts/taskC2-entry.ts", "scripts/taskC2-cfgentry.ts", "scripts/taskC2-fnentry.ts",
 "scripts/taskC2-electron-stub.mts", "scripts/taskC2-i18n.cjs",
 "scripts/taskC2-smoke.mjs", "scripts/taskC2-zip.mjs"].forEach(must);

// Phase-C3 key files (regression)
["src/utils/routingOptions.ts", "src/components/RoutingTab.tsx",
 "electron-app/electron/geoFiles.ts",
 "scripts/taskC3-quickcheck.mjs", "scripts/taskC3-fntest.mjs",
 "scripts/taskC3-cfgtest.mjs", "scripts/taskC3-live.mjs",
 "scripts/taskC3-entry.ts", "scripts/taskC3-cfgentry.ts", "scripts/taskC3-i18n.cjs",
 "scripts/taskC3-smoke.mjs", "scripts/taskC3-zip.mjs"].forEach(must);

// Phase-C4 key files
["src/utils/topologyOptions.ts",
 "scripts/taskC4-quickcheck.mjs", "scripts/taskC4-fntest.mjs",
 "scripts/taskC4-cfgtest.mjs", "scripts/taskC4-live.mjs",
 "scripts/taskC4-cfgentry.ts", "scripts/taskC4-uplink-probe.mjs",
 "scripts/taskC4-stats-debug.mjs",
 "scripts/taskC4-smoke.mjs", "scripts/taskC4-zip.mjs"].forEach(must);

const zcat = (f) => execFileSync("unzip", ["-p", OUT, f], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const contentOk = (name, file, needles) => {
  const body = zcat(file);
  for (const n of needles) {
    if (!body.includes(n)) { console.error(`FAIL  ${name}: ${file} lacks ${JSON.stringify(n.slice(0, 40))}`); bad++; return; }
  }
  console.log(`PASS  ${name} (${needles.length} needles in ${file})`);
};
const contentAbsent = (name, file, needles) => {
  const body = zcat(file);
  for (const n of needles) {
    if (body.includes(n)) { console.error(`FAIL  ${name}: ${file} must NOT contain ${JSON.stringify(n.slice(0, 40))}`); bad++; return; }
  }
  console.log(`PASS  ${name} (${needles.length} negative needles in ${file})`);
};

/* ---------- C4 feature needles: the tag scheme (single source of truth) ---------- */

contentOk("topology tag scheme shipped (C4)", "src/utils/topologyOptions.ts", [
  'export const CHAIN_HOP_TAG = "chain-hop";',
  'export const BALANCER_TAG = "balancer";',
  "export const MAX_BALANCER_EXTRAS = 8;",
  'const tags: string[] = ["proxy"];',
  "tags.push(`proxy${i}`);",
  "export function trafficTagsFor(opts: TopologyOptions, resolvedExtrasCount: number): string[] {",
  "? balancerMemberTags(resolvedExtrasCount)",
  ': ["proxy"];',
  "export interface TopologyInput {",
  "chainHop?: ParsedConfig | null;",
  "balancerExtras?: ParsedConfig[];",
  'export const TOPOLOGY_OPTIONS_STORAGE_KEY = "memento-topology-options";',
  'merged.balancerStrategy = "random";',
]);

/* ---------- C4 feature needles: both generators ---------- */

contentOk("xray chain + balancer generator shipped (C4)", "src/utils/v2rayConfig.ts", [
  "built.tag = CHAIN_HOP_TAG;",
  "ss.sockopt = { dialerProxy: CHAIN_HOP_TAG };",
  "const useFragment = !!fragDialer && fragmentApplies(outbound) && !hopOutbound;",
  "balancerTag: BALANCER_TAG,",
  "routingBuild.routing.balancers = [{",
  'selector: ["proxy"],',
  "burstObservatory: {",
]);

contentOk("sing-box chain + urltest generator shipped (C4)", "src/utils/singBoxConfig.ts", [
  "outbound.detour = CHAIN_HOP_TAG;",
  'type: "urltest",',
  "tag: BALANCER_TAG,",
  'url: BALANCER_URLTEST_URL,',
  "if (balancerActive) sbRouting.route.final = BALANCER_TAG;",
  "if (hopOutbound) built.detour = CHAIN_HOP_TAG;",
]);

// The C4 hard constraint: stats tags flow from trafficTagsFor into start_xray
contentOk("connect flow resolves topology + carries the member-tag sum (C4 constraint)",
  "src/utils/connectionActions.ts", [
  "if (topo.chainHopId === configId) {",
  "Chain proxy: the selected hop config no longer exists or is invalid",
  "the two cores cannot be mixed in one chain",
  "Balancer is enabled but no member configs are picked",
  "topo.balancerExtraIds.slice(0, MAX_BALANCER_EXTRAS)",
  "trafficTags: trafficTagsFor(topo, balancerExtras.length),",
]);

/* ---------- C4 feature needles: main-process counting boundary ---------- */

contentOk("traffic-tag sanitizer + per-tag exact-segment counters shipped (C4)",
  "electron-app/electron/xray.ts", [
  "const TRAFFIC_TAG_RE = /^[A-Za-z0-9_-]{1,64}$/;",
  "export function sanitizeTrafficTags(input: unknown): string[] {",
  'private trafficTags: string[] = ["proxy"];',
  "this.trafficTags = sanitizeTrafficTags(trafficTags);",
  "const upMatchers = trafficTags.map((t) => `>>>${t}>>>traffic>>>uplink`);",
  "const downMatchers = trafficTags.map((t) => `>>>${t}>>>traffic>>>downlink`);",
]);
contentOk("ipc boundary sanitizes trafficTags (C4)", "electron-app/electron/ipc.ts", [
  "sanitizeTrafficTags(args?.trafficTags)",
]);
contentOk("store persists topology options (C4)", "src/store.ts", [
  "topologyOptions: loadTopologyOptions(),",
  "TOPOLOGY_OPTIONS_STORAGE_KEY, JSON.stringify(next)",
  "setTopologyOptions: (patch) => {",
]);

/* ---------- C4 feature needles: UI + honest caveat ---------- */

contentOk("chain/balancer cards shipped (C4)", "src/components/RoutingTab.tsx", [
  'import { MAX_BALANCER_EXTRAS, type BalancerStrategy } from "../utils/topologyOptions";',
  '{t("topo.balancerHint", language)}',
  "topologyOptions.balancerExtraIds.length >= MAX_BALANCER_EXTRAS",
  'id: "roundRobin"',
  'id: "leastPing"',
  'id: "leastLoad"',
]);

// i18n parity: representative C4 keys x4 languages
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["topo.title", "topo.chain", "topo.chainHint", "topo.balancer",
    "topo.balancerHint", "topo.strategy", "topo.members", "topo.membersCount"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
  if ((i18n.match(/"topo\.balancerHint": "[^"]*vless[^"]*"/g) || []).length !== 4) {
    console.error("FAIL  i18n balancerHint lacks the honest vless-uplink caveat in some locale"); bad++;
  } else console.log("PASS  i18n balancerHint carries the vless-uplink caveat in all 4 locales");
}

/* ---------- C4 docs: the tracked limitation in BOTH places ---------- */

contentOk("README documents Batch C4 + the tracked uplink limitation", "electron-app/README.md", [
  "Phase C — Batch C4 (chain proxy + balancer)",
  "TRACKED LIMITATION (re-check on every core pin bump)",
  "scripts/taskC4-uplink-probe.mjs",
  "RE-CHECK DIRECTIVE",
  "re-point/retire the B1b3 pin",
  "sums ALL member tags",
]);
contentOk("TESTING-CHECKLIST section 25 + 25.1 carry the C4 manual items + limitation tracker",
  "electron-app/TESTING-CHECKLIST.md", [
  "25. Phase C4 — chain proxy + balancer",
  "25.1 Xray core limitation tracker — balancer uplink gap (MUST re-check on every core pin bump)",
  "node scripts/taskC4-uplink-probe.mjs",
  "B1b3 CORE GAP",
  "topo.balancerHint",
]);
contentOk("core pins intact (tracked-limitation trigger file)", "electron-app/electron/core-versions.json",
  ['"xray": "v25.1.1"', '"sing-box": "1.14.0"', '"aether": "1.9.0"']);

/* ---------- C3 regression needles (unchanged by C4) ---------- */

contentOk("geo file lifecycle shipped (C3)", "electron-app/electron/geoFiles.ts", [
  "`https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/geoip.dat`",
  "meta-rules-dat/sing/geo/geosite/category-ir.srs",
  "const MIN_BYTES: Record<string, number> = {",
  "signal: AbortSignal.timeout(120_000)",
  "fs.renameSync(tmp, dest);",
]);
contentOk("connect-time geo gate shipped (C3)", "src/utils/connectionActions.ts", [
  "const needed = requiredGeoFiles(state.routingOptions, core);",
  "useStore.getState().setGeoPreparing(true);",
  "useStore.getState().setGeoPreparing(false);",
]);
contentOk("regexp case-preservation fix shipped (C3 review fix)", "src/utils/routingOptions.ts", [
  'const rest = p === "regexp:"',
  ": v.slice(p.length).trim().toLowerCase();",
]);
contentOk("xray routing builder shipped (C3)", "src/utils/routingOptions.ts", [
  '{ type: "field", outboundTag: "blocked", domain: blockD }',
  "const domainStrategy = needsGeo ? \"IPIfNonMatch\" : \"AsIs\";",
  'export const FAKEDNS_POOL = "198.18.0.0/15";',
]);
contentOk("Routing tab core UI shipped (C3)", "src/components/RoutingTab.tsx", [
  'id: "bypass-ir"',
  'id: "custom"',
  "buildXrayRouting(opts, [])",
  'buildSingBoxRouting(opts, [], geoStatus?.srsDir ?? "")',
]);

/* ---------- C2 regression needles (unchanged by C4) ---------- */

contentOk("probe config rewrite shipped (C2)", "electron-app/electron/urlTest.ts", [
  "export function rewriteConfigForProbe(configJson: string, port: number): RewrittenConfig {",
  "const RESERVED_PORTS = new Set([10808, 10809, 10850, 1819]);",
  'if (core === "xray") ib.port = port;',
  'throw new Error("Aether is not a config-driven core");',
]);
contentAbsent("probe spawns DIRECT: no manager, no orphan-kill, no proxy writes (C2 isolation)",
  "electron-app/electron/urlTest.ts",
  ['from "./coreOps"', "stopOtherCore(", "clearSystemProxy(", "killAllOrphanedCores("]);
contentOk("standalone latencyHistory ring shipped (C2)", "src/utils/latencyHistory.ts", [
  "export const LATENCY_HISTORY_MAX = 20;",
  "if (sample.ms !== null && !Number.isFinite(sample.ms)) return;",
]);
contentAbsent("latencyHistory imports NOTHING from zustand/store (App.tsx:61-64 rule)",
  "src/utils/latencyHistory.ts",
  ['from "zustand"', "from '../store'", 'from "../store"']);

/* ---------- C1 regression needles (unchanged by C4) ---------- */

contentOk("standalone trafficHistory ring shipped (C1)", "src/utils/trafficHistory.ts", [
  "export const TRAFFIC_HISTORY_MAX = 120;",
  "if (!Number.isFinite(down) || !Number.isFinite(up)) return;",
]);
contentOk("TrafficChart rides ONLY the standalone slice (perf contract)", "src/components/TrafficChart.tsx", [
  "useSyncExternalStore(subscribeTrafficHistory, getTrafficHistory)",
  "<polyline",
]);
contentAbsent("TrafficChart: NO zustand/whole-store subscription (App.tsx:61-64 rule)", "src/components/TrafficChart.tsx",
  ["useStore(", 'from "zustand"', "from '../store'", 'from "../store"']);
contentOk("fragment builder options + parser shipped (C1)", "src/utils/builderOptions.ts", [
  'export const FRAGMENT_DIALER_TAG = "memento-frag-dialer";',
  "tlsFragment: false,",
]);

/* ---------- D4/D3/D2/Task-13/12/D1 regression needles ---------- */

contentOk("close-to-tray interception + session-end hardening shipped (D4)", "electron-app/electron/main.ts", [
  "let quitting = false;",
  'mainWindow.on("session-end", () => {',
  'app.on("before-quit", () => {',
]);
contentOk("global hotkeys shipped (D3)", "electron-app/electron/appPrefs.ts", [
  'export const HOTKEY_SHOW_HIDE = "Control+Alt+V"',
  'export const HOTKEY_CONNECT = "Control+Alt+C"',
  "globalShortcut.unregisterAll()",
]);
contentOk("socks parser + outbound shipped (Task-13)", "src/store.ts",
  ["function parseSocks(", "tryBase64Decode("]);
contentOk("net_check handler shipped (D1)", "electron-app/electron/ipc.ts",
  ['"net_check"', "session.fromPartition("]);
contentOk("tray status push shipped (D4)", "src/components/ConnectionManager.tsx", [
  'tauriInvoke("tray_status_set", { connected })',
]);

if (bad > 0) { console.error(`ZIP VERIFICATION FAILED: ${bad} problem(s)`); process.exit(1); }
console.log("zip verification complete — ALL CHECKS PASSED");
