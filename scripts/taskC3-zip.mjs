#!/usr/bin/env node
/**
 * Phase C3: rebuild download/MEMENTO-electron-migration.zip and run
 * in-archive verification for the Batch-C3 features (routing presets +
 * custom rule lists + geo file lifecycle + DNS/FakeDNS + the two
 * user-approved review fixes: geoPreparing transient state and regexp
 * case preservation) AND the full regression pin chain (Task-13/12
 * + D1 + D2 + D3 + D4 + C1 + C2). Same exclusion rules as every previous
 * phase; binaries are never shipped.
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

// Phase-C3 key files
["src/utils/routingOptions.ts", "src/components/RoutingTab.tsx",
 "electron-app/electron/geoFiles.ts",
 "scripts/taskC3-quickcheck.mjs", "scripts/taskC3-fntest.mjs",
 "scripts/taskC3-cfgtest.mjs", "scripts/taskC3-live.mjs",
 "scripts/taskC3-entry.ts", "scripts/taskC3-cfgentry.ts", "scripts/taskC3-i18n.cjs",
 "scripts/taskC3-smoke.mjs", "scripts/taskC3-zip.mjs"].forEach(must);

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

/* ---------- C3 feature needles: main-process geo lifecycle ---------- */

contentOk("geo file lifecycle shipped (C3)", "electron-app/electron/geoFiles.ts", [
  "`https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/geoip.dat`",
  "meta-rules-dat/sing/geo/geosite/category-ir.srs",
  "meta-rules-dat/sing/geo/geoip/ir.srs",
  "meta-rules-dat/sing/geo/geosite/category-ads-all.srs",
  "const MIN_BYTES: Record<string, number> = {",
  "refusing to install a corrupt/truncated geo dataset",
  "signal: AbortSignal.timeout(120_000)",
  "const tmp = `${dest}.memento-tmp`;",
  "fs.renameSync(tmp, dest);",
  "errors[name] = String((e as Error)?.message || e);",
]);

contentOk("geo IPC handlers shipped (C3)", "electron-app/electron/ipc.ts", [
  'ipcMain.handle("geo_status", () => geoStatus());',
  '"geo_ensure"',
  'args?.family === "xray" || args?.family === "srs"',
]);
{
  const preload = zcat("electron-app/electron/preload.ts");
  const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
  if (allow.length !== 23 || !allow.includes("url_test") || !allow.includes("geo_status") || !allow.includes("geo_ensure")) {
    console.error(`FAIL  preload allowlist = ${allow.length} commands (need 23, incl. url_test + geo pair)`); bad++;
  } else console.log("PASS  preload allowlist ships 23 commands (C2 added url_test, C3 added the geo pair)");
}

/* ---------- C3 feature needles: renderer routing engine ---------- */

contentOk("routing presets + parsers shipped (C3)", "src/utils/routingOptions.ts", [
  'export type RoutingPreset = "standard" | "bypass-ir" | "custom";',
  'export type DnsMode = "default" | "secure" | "fakedns";',
  "export const ROUTING_LIST_MAX = 200;",
  "export function parseDomainRule(line: string): string | null {",
  "export function parseIpRule(line: string): string | null {",
  "export function parseRuleList(text: string, kind: \"domain\" | \"ip\"): ParsedRuleList {",
  "if (!/^[a-z0-9._*-]+$/.test(rest)) {",
  "/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(bare)",
  "if (!/^[a-z0-9_-]+$/.test(rest)) return null;",
  "if (octets.some(o => o > 255)) return null;",
]);

// THE APPROVED REVIEW FIX: regexp keeps case, everything else normalizes
contentOk("regexp case-preservation fix shipped (C3 review fix)", "src/utils/routingOptions.ts", [
  'const rest = p === "regexp:"',
  ": v.slice(p.length).trim().toLowerCase();",
]);

contentOk("xray routing builder shipped (C3)", "src/utils/routingOptions.ts", [
  "const rules: Record<string, unknown>[] = [...baseRules];",
  '{ type: "field", outboundTag: "blocked", domain: blockD }',
  '{ type: "field", outboundTag: "direct", domain: [GEO_IR_XRAY_DOMAIN] }',
  '{ type: "field", outboundTag: "direct", ip: [GEO_IR_XRAY_IP] }',
  'const domainStrategy = needsGeo ? "IPIfNonMatch" : "AsIs";',
  'export const FAKEDNS_POOL = "198.18.0.0/15";',
  "build.sniffingDestOverride = [\"http\", \"tls\", \"fakedns\"];",
]);

contentOk("sing-box routing builder shipped (C3)", "src/utils/routingOptions.ts", [
  '{ type: "local", tag: GEO_IR_SRS_GEOSITE, format: "binary", path:',
  "route.default_domain_resolver = defaultResolver;",
  "rules.length ? { rules, final: \"proxy\" } : { final: \"proxy\" }",
  "domain_suffix: MINIMAL_IR_DOMAINS",
  'domain_keyword: ["doubleclick", "googlesyndication", "googleadservices", "adservice"]',
  'filter(r => !r.startsWith("geosite:"))',
  '{ outbound: "blocked", ip_cidr: blockIPlain }',
]);

// JSON injection safety: values only ever enter via object construction +
// one whole-config JSON.stringify (never string-built JSON)
contentOk("config JSON built from objects via a single stringify (C3 injection safety)",
  "src/utils/v2rayConfig.ts",
  ["json: JSON.stringify(fullConfig, null, 2),", "routing: routingBuild.routing,", "dns: routingBuild.dns,"]);
contentOk("sing-box JSON built from objects via a single stringify (C3 injection safety)",
  "src/utils/singBoxConfig.ts",
  ["json: JSON.stringify(fullConfig, null, 2),", "route: sbRouting.route,", "if (sbRouting.dns) fullConfig.dns = sbRouting.dns;"]);

/* ---------- C3 feature needles: connect flow geo gate + the review fix ---------- */

contentOk("connect-time geo gate shipped (C3)", "src/utils/connectionActions.ts", [
  "const needed = requiredGeoFiles(state.routingOptions, core);",
  'await tauriInvoke<{ status: GeoStatus; errors: Record<string, string> }>("geo_ensure", { family });',
  '`missing: ${missing.join(", ")}`',
  "connect aborted",
]);

// THE APPROVED REVIEW FIX: transient preparing state + re-entry guard
contentOk("geoPreparing transient state shipped (C3 review fix)", "src/utils/connectionActions.ts", [
  "if (useStore.getState().geoPreparing) {",
  "useStore.getState().setGeoPreparing(true);",
  "useStore.getState().setGeoPreparing(false);",
]);
{
  const ca = zcat("src/utils/connectionActions.ts");
  const gate = ca.indexOf('requiredGeoFiles(state.routingOptions, core)');
  const set = ca.indexOf("useStore.getState().setGeoPreparing(true);");
  const ensure = ca.indexOf('"geo_ensure"');
  const clear = ca.indexOf("useStore.getState().setGeoPreparing(false);");
  if (!(gate > -1 && set > -1 && ensure > -1 && clear > -1 && set < ensure && clear > ensure)) {
    console.error("FAIL  geo gate code order: setGeoPreparing(true) must precede geo_ensure, clear must follow it"); bad++;
  } else console.log("PASS  geo gate code order: preparing flag wraps the geo_ensure gate");
}

contentOk("preparing button state shipped (C3 review fix)", "src/components/ConnectionTab.tsx", [
  "geoPreparing, // C3 fix: explicit \"Preparing geo data…\" state during the connect-time geo gate",
  "{geoPreparing ? (",
  '<Loader2 className="w-6 h-6 animate-spin" />',
  't("connection.preparingGeo", language)',
  'aria-live="polite"',
]);

contentOk("store carries routing + geo + preparing state (C3)", "src/store.ts", [
  "routingOptions: loadRoutingOptions(),",
  "ROUTING_OPTIONS_STORAGE_KEY, JSON.stringify(next)",
  "geoStatus: null,",
  "setGeoStatus: (s) => set({ geoStatus: s }),",
  "geoPreparing: boolean;",
  "setGeoPreparing: (v: boolean) => void;",
  "geoPreparing: false,",
  "setGeoPreparing: (v) => set({ geoPreparing: v }),",
]);

contentOk("Routing tab UI shipped (C3)", "src/components/RoutingTab.tsx", [
  'id: "bypass-ir"',
  'id: "custom"',
  'routingOptions.preset === "custom" && (',
  "buildXrayRouting(opts, [])",
  'buildSingBoxRouting(opts, [], geoStatus?.srsDir ?? "")',
  't("rt.geoDesktopOnly", language)',
]);

contentOk("mock geo stubs stay honest (C3)", "src/electron-mock.ts", [
  'errors: { _: "Desktop only (mock preview) — geo files live next to the cores" }',
]);

// i18n parity: the new fix key + representative C3 keys x4 languages
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["connection.preparingGeo", "tab.routing", "rt.presetBypassIr",
    "rt.dnsFakedns", "rt.geoDesktopOnly", "rt.geoDownload"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
}

// docs
contentOk("README documents Batch C3", "electron-app/README.md", [
  "Phase C — Batch C3",
  "geo_ensure",
]);
contentOk("TESTING-CHECKLIST section 24 carries the C3 manual items", "electron-app/TESTING-CHECKLIST.md", [
  "24. Phase C3",
]);

/* ---------- C2 regression needles (unchanged by C3) ---------- */

contentOk("probe config rewrite shipped (C2)", "electron-app/electron/urlTest.ts", [
  "export function rewriteConfigForProbe(configJson: string, port: number): RewrittenConfig {",
  "const RESERVED_PORTS = new Set([10808, 10809, 10850, 1819]);",
  'if (core === "xray") ib.port = port;',
  "else ib.listen_port = port;",
  "if (kept !== 1) {",
  'throw new Error(kept === 0 ? "Test config has no socks inbound" : "Test config has multiple socks inbounds");',
  'throw new Error("Aether is not a config-driven core");',
  "const CONFIG_MAX_BYTES = 256 * 1024;",
]);
contentAbsent("probe spawns DIRECT: no manager, no orphan-kill, no proxy writes (C2 isolation)",
  "electron-app/electron/urlTest.ts",
  ['from "./coreOps"', "stopOtherCore(", "clearSystemProxy(", "killAllOrphanedCores("]);
contentOk("Test URL pref + main-side sanitizer shipped (C2)", "electron-app/electron/appPrefs.ts", [
  'export const URL_TEST_DEFAULT = "https://www.gstatic.com/generate_204";',
  "export function normalizeTestUrl(v: unknown): string | null {",
  "  testUrl: string;",
]);
contentOk("standalone latencyHistory ring shipped (C2)", "src/utils/latencyHistory.ts", [
  "export const LATENCY_HISTORY_MAX = 20;",
  "export function pushLatencySample(configId: string, sample: LatencySample): void {",
  "if (sample.ms !== null && !Number.isFinite(sample.ms)) return;",
  "export function subscribeLatencyHistory(listener: () => void): () => void {",
]);
contentAbsent("latencyHistory imports NOTHING from zustand/store (App.tsx:61-64 rule)",
  "src/utils/latencyHistory.ts",
  ['from "zustand"', "from '../store'", 'from "../store"']);
contentOk("renderer urlTest runner shipped (C2)", "src/utils/urlTest.ts", [
  "export const URL_TEST_CONCURRENCY = 4;",
  "export function buildUrlTestConfigJson(config: ParsedConfig): string | null {",
  "export async function runUrlTestBatch(",
  "export async function runTunnelUrlTest(",
]);
contentOk("Configs tab URL-test UI shipped (C2)", "src/components/ConfigsTab.tsx", [
  "function UrlTestBadge({ configId, language }: {",
  "const samples = useSyncExternalStore(subscribeLatencyHistory, () => getLatencyHistory(configId));",
]);

/* ---------- C1 regression needles (unchanged by C3) ---------- */

contentOk("standalone trafficHistory ring shipped (C1)", "src/utils/trafficHistory.ts", [
  "export const TRAFFIC_HISTORY_MAX = 120;",
  "export function pushTrafficSample(down: number, up: number, at = Date.now()): void {",
  "if (!Number.isFinite(down) || !Number.isFinite(up)) return;",
  "export function subscribeTrafficHistory(listener: () => void): () => void {",
]);
contentOk("TrafficChart rides ONLY the standalone slice (perf contract)", "src/components/TrafficChart.tsx", [
  "useSyncExternalStore(subscribeTrafficHistory, getTrafficHistory)",
  "<polyline",
]);
contentAbsent("TrafficChart: NO zustand/whole-store subscription (App.tsx:61-64 rule)", "src/components/TrafficChart.tsx",
  ["useStore(", 'from "zustand"', "from '../store'", 'from "../store"']);
contentOk("chart mounts ONLY while connected (C1)", "src/components/ConnectionTab.tsx", [
  '{status === "connected" && <TrafficChart language={language} />}',
]);
contentOk("fragment builder options + parser shipped (C1)", "src/utils/builderOptions.ts", [
  'export const FRAGMENT_DIALER_TAG = "memento-frag-dialer";',
  "tlsFragment: false,",
  'tlsFragmentPackets: "tlshello",',
]);
contentOk("fragment dialer injection shipped (C1)", "src/utils/v2rayConfig.ts", [
  "const fragDialer = buildFragmentDialer(builderOptions);",
  "dialerProxy: FRAGMENT_DIALER_TAG,",
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
contentOk("autostart portable fix shipped (D3)", "electron-app/electron/appPrefs.ts", [
  "process.env.PORTABLE_EXECUTABLE_FILE",
]);
contentOk("core pins intact", "electron-app/electron/core-versions.json",
  ['"xray": "v25.1.1"', '"sing-box": "1.14.0"', '"aether": "1.9.0"']);
contentOk("socks parser + outbound shipped (Task-13)", "src/store.ts",
  ["function parseSocks(", "tryBase64Decode("]);
contentOk("net_check handler shipped (D1)", "electron-app/electron/ipc.ts",
  ['"net_check"', "session.fromPartition("]);
contentOk("tray status push shipped (D4)", "src/components/ConnectionManager.tsx", [
  'tauriInvoke("tray_status_set", { connected })',
]);

if (bad > 0) { console.error(`ZIP VERIFICATION FAILED: ${bad} problem(s)`); process.exit(1); }
console.log("zip verification complete — ALL CHECKS PASSED");
