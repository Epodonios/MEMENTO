#!/usr/bin/env node
/**
 * Phase C2: rebuild download/MEMENTO-electron-migration.zip and run
 * in-archive verification for the Batch-C2 features (real URL-test in two
 * isolated probe modes + latency history in a standalone non-zustand slice
 * + the custom Test URL pref) AND the full regression pin chain (Task-13/12
 * + D1 + D2 + D3 + D4 + C1). Same exclusion rules as every previous phase;
 * binaries are never shipped.
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

// Phase-C2 key files
["src/utils/latencyHistory.ts", "src/utils/urlTest.ts", "electron-app/electron/urlTest.ts",
 "scripts/taskC2-quickcheck.mjs", "scripts/taskC2-fntest.mjs",
 "scripts/taskC2-cfgtest.mjs", "scripts/taskC2-live.mjs",
 "scripts/taskC2-entry.ts", "scripts/taskC2-cfgentry.ts", "scripts/taskC2-fnentry.ts",
 "scripts/taskC2-electron-stub.mts", "scripts/taskC2-i18n.cjs",
 "scripts/taskC2-smoke.mjs", "scripts/taskC2-zip.mjs"].forEach(must);

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

/* ---------- C2 feature needles: main-process probe (urlTest.ts) ---------- */

// the rewrite contract: our own generator shapes only, ephemeral port,
// aether guard, size cap
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

// the D1 ses.fetch recipe reused verbatim + both probe modes + hardening
contentOk("proxied GET + both probe modes shipped (C2)", "electron-app/electron/urlTest.ts", [
  "async function proxiedGetMs(socksPort: number, testUrl: string, timeoutMs: number): Promise<number> {",
  'await ses.setProxy({ mode: "fixed_servers", proxyRules: `socks5://127.0.0.1:${socksPort}` });',
  "const res = await ses.fetch(testUrl, { signal: AbortSignal.timeout(timeoutMs) });",
  "async function instanceProbe(configJson: string, testUrl: string, timeoutMs: number): Promise<UrlTestOutcome> {",
  "async function tunnelProbe(socksPort: number, testUrl: string, timeoutMs: number): Promise<UrlTestOutcome> {",
  "export async function urlTestProbe(args: {",
  "function sweepStaleTempConfigs(): void {",
  'path.join(os.tmpdir(), `${TEMP_PREFIX}${process.pid}-${crypto.randomBytes(4).toString("hex")}.json`)',
  'child = spawn(binPath, ["run", "-c", file], {',
]);
// ISOLATION negatives — API-shaped (the doc comments legitimately mention
// killAllOrphanedCores/the live VPN; the CODE must never touch them)
contentAbsent("probe spawns DIRECT: no manager, no orphan-kill, no proxy writes (C2 isolation)",
  "electron-app/electron/urlTest.ts",
  ['from "./coreOps"', "stopOtherCore(", "clearSystemProxy(", "killAllOrphanedCores("]);

// prefs: testUrl field can never be poisoned through IPC
contentOk("Test URL pref + main-side sanitizer shipped (C2)", "electron-app/electron/appPrefs.ts", [
  'export const URL_TEST_DEFAULT = "https://www.gstatic.com/generate_204";',
  "export function normalizeTestUrl(v: unknown): string | null {",
  "  testUrl: string;",
  "  testUrl: URL_TEST_DEFAULT,",
  "const testUrl = normalizeTestUrl(p.testUrl);",
  "testUrl: normalizeTestUrl(o.testUrl) ?? URL_TEST_DEFAULT, // Phase C2",
]);

// IPC wiring + allowlist
contentOk("url_test IPC handler shipped (C2)", "electron-app/electron/ipc.ts", [
  "urlTestProbe(args ?? {})",
]);
{
  const preload = zcat("electron-app/electron/preload.ts");
  const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
  if (allow.length !== 21 || !allow.includes("url_test") || !allow.includes("tray_status_set")) {
    console.error(`FAIL  preload allowlist = ${allow.length} commands (need 21, incl. url_test)`); bad++;
  } else console.log("PASS  preload allowlist ships 21 commands (C2 added exactly one: url_test)");
}

/* ---------- C2 feature needles: renderer side ---------- */

// standalone latency slice (C1 perf rule) — outside zustand, bounded, NaN guard
contentOk("standalone latencyHistory ring shipped (C2)", "src/utils/latencyHistory.ts", [
  "export const LATENCY_HISTORY_MAX = 20;",
  "export function pushLatencySample(configId: string, sample: LatencySample): void {",
  "if (sample.ms !== null && !Number.isFinite(sample.ms)) return;",
  "export function getLatencyHistory(configId: string): LatencySample[] {",
  "export function lastLatencySample(configId: string): LatencySample | null {",
  "export function clearLatencyHistory(configId?: string): void {",
  "export function subscribeLatencyHistory(listener: () => void): () => void {",
]);
contentAbsent("latencyHistory imports NOTHING from zustand/store (App.tsx:61-64 rule)",
  "src/utils/latencyHistory.ts",
  ['from "zustand"', "from '../store'", 'from "../store"']);

// renderer runner: real generators for probes + batch pool + tunnel mode
contentOk("renderer urlTest runner shipped (C2)", "src/utils/urlTest.ts", [
  "export const URL_TEST_CONCURRENCY = 4;",
  "export async function resolveTestUrl(): Promise<string> {",
  "export function invalidateTestUrlCache(): void {",
  "export function buildUrlTestConfigJson(config: ParsedConfig): string | null {",
  "export async function runUrlTest(config: ParsedConfig, timeoutMs = 10_000, recordHistory = true): Promise<UrlTestResult> {",
  "export async function runUrlTestBatch(",
  "export async function runTunnelUrlTest(",
  'tauriInvoke<UrlTestOutcome>("url_test", { configJson, testUrl, timeoutMs })',
  "const URL_TEST_FALLBACK = \"https://www.gstatic.com/generate_204\";",
]);

// ConfigsTab: batch button + per-row badge riding the standalone slice
contentOk("Configs tab URL-test UI shipped (C2)", "src/components/ConfigsTab.tsx", [
  'import { runUrlTest, runUrlTestBatch } from "../utils/urlTest";',
  "const handleUrlTestAll = useCallback(async () => {",
  "urlTestAbortRef.current?.abort();",
  "function UrlTestBadge({ configId, language }: {",
  "const samples = useSyncExternalStore(subscribeLatencyHistory, () => getLatencyHistory(configId));",
  "function LatencySparkline({ samples }: { samples: LatencySample[] }) {",
  "<UrlTestBadge configId={config.id} language={language} />",
]);

// Settings: custom Test URL draft state + invalidate on save
contentOk("custom Test URL field shipped (C2, Settings tab)", "src/components/SettingsTab.tsx", [
  'import { invalidateTestUrlCache } from "../utils/urlTest";',
  'const [testUrlDraft, setTestUrlDraft] = useState<string>("");',
  "await patchPrefs({ testUrl: testUrlDraft.trim() });",
  "invalidateTestUrlCache();",
  't("set.testUrlHint", language)',
]);

// Pinger: url mode with recordHistory bypass (identity-less targets)
contentOk("Pinger real-delay mode shipped (C2)", "src/components/PingerTab.tsx", [
  'import { runUrlTestBatch } from "../utils/urlTest";',
  'transport: "url",',
  "recordHistory: false,",
]);

// Connection tab: tunnel-mode button (works for all three cores)
contentOk("tunnel-mode real-delay button shipped (C2, Connection tab)", "src/components/ConnectionTab.tsx", [
  'import { runTunnelUrlTest } from "../utils/urlTest";',
  "await runTunnelUrlTest(connSocksPort, connConfigId);",
]);

// browser preview mock never invents a latency number
contentOk("mock url_test honestly fails (C2)", "src/electron-mock.ts", [
  "url_test: async (args: any) => {",
  'error: "Desktop only (mock preview)"',
]);

// i18n parity: 10 new keys x4 languages
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["configs.urlTest", "configs.urlTestAll", "configs.urlTesting", "configs.urlTestFail",
    "pinger.urlTest", "connection.urlTest", "connection.urlTestDone", "connection.urlTestFail",
    "set.testUrl", "set.testUrlHint"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
}

// docs
contentOk("README documents Batch C2", "electron-app/README.md", [
  "Phase C — Batch C2",
  "url_test",
  "https://www.gstatic.com/generate_204",
]);
contentOk("TESTING-CHECKLIST section 23 carries the C2 manual items", "electron-app/TESTING-CHECKLIST.md", [
  "23. Phase C2",
  "core exited during probe",
  "memento-urltest-*.json",
]);

/* ---------- C1 regression needles (unchanged by C2) ---------- */

contentOk("standalone trafficHistory ring shipped (C1)", "src/utils/trafficHistory.ts", [
  "export const TRAFFIC_HISTORY_MAX = 120;",
  "export function pushTrafficSample(down: number, up: number, at = Date.now()): void {",
  "if (!Number.isFinite(down) || !Number.isFinite(up)) return;",
  "export function resetTrafficHistory(): void {",
  "export function subscribeTrafficHistory(listener: () => void): () => void {",
  "export function getTrafficHistory(): TrafficSample[] {",
]);
contentOk("TrafficChart rides ONLY the standalone slice (perf contract)", "src/components/TrafficChart.tsx", [
  "useSyncExternalStore(subscribeTrafficHistory, getTrafficHistory)",
  't("connection.trafficTitle", language)',
  't("connection.trafficWaiting", language)',
  "<polyline",
]);
contentAbsent("TrafficChart: NO zustand/whole-store subscription (App.tsx:61-64 rule)", "src/components/TrafficChart.tsx",
  ["useStore(", 'from "zustand"', "from '../store'", 'from "../store"']);
contentOk("poll loop pushes samples into the slice (C1)", "src/components/ConnectionManager.tsx", [
  'import { pushTrafficSample, resetTrafficHistory } from "../utils/trafficHistory";',
  "pushTrafficSample(downSpeed, upSpeed, now);",
]);
contentOk("chart mounts ONLY while connected (C1)", "src/components/ConnectionTab.tsx", [
  '{status === "connected" && <TrafficChart language={language} />}',
]);
contentOk("fragment builder options + parser shipped (C1)", "src/utils/builderOptions.ts", [
  'export const FRAGMENT_DIALER_TAG = "memento-frag-dialer";',
  "export function parseFragmentRange(value: string, allowTlsHello = false): { from: number; to: number } | \"tlshello\" | null {",
  "tlsFragment: false,",
  'tlsFragmentPackets: "tlshello",',
  'tlsFragmentLength: "100-200",',
  'tlsFragmentInterval: "10-20",',
]);
contentOk("fragment dialer injection shipped (C1)", "src/utils/v2rayConfig.ts", [
  "const fragDialer = buildFragmentDialer(builderOptions);",
  "const useFragment = !!fragDialer && fragmentApplies(outbound);",
  "dialerProxy: FRAGMENT_DIALER_TAG,",
  'protocol: "freedom",',
  'domainStrategy: "AsIs",',
  "fragment: {",
]);
contentAbsent("noises honestly NOT shipped (UDP-only dead config in v25.1.1)", "src/utils/v2rayConfig.ts",
  ["noises:", '"noises"']);

/* ---------- D4/D3/D2/Task-13/12/D1 regression needles ---------- */

contentOk("close-to-tray interception + session-end hardening shipped (D4)", "electron-app/electron/main.ts", [
  "let quitting = false;",
  'mainWindow.on("session-end", () => {',
  'app.on("before-quit", () => {',
]);
contentOk("appPrefs D4 fields + sanitizer shipped", "electron-app/electron/appPrefs.ts", [
  "closeToTray: boolean;",
  "export function sanitizePrefsPatch",
]);
contentOk("Settings tab single home intact (D4)", "src/components/SettingsTab.tsx", [
  'titleKey="tab.settings"',
  't("set.closeToTray", language)',
  "BuilderOptionsPanel",
]);
contentOk("tray status push shipped (D4)", "src/components/ConnectionManager.tsx", [
  'tauriInvoke("tray_status_set", { connected })',
]);
contentOk("autostart portable fix shipped (D3)", "electron-app/electron/appPrefs.ts", [
  "process.env.PORTABLE_EXECUTABLE_FILE",
  'const AUTOSTART_ARGS = ["--hidden"]',
]);
contentOk("global hotkeys shipped (D3)", "electron-app/electron/appPrefs.ts", [
  'export const HOTKEY_SHOW_HIDE = "Control+Alt+V"',
  'export const HOTKEY_CONNECT = "Control+Alt+C"',
  "globalShortcut.unregisterAll()",
]);
contentOk("backup allowlist shipped (D3)", "src/utils/appBackup.ts", [
  'export const BACKUP_FORMAT = "memento-backup"',
  "export const BACKUP_VERSION = 1",
]);
contentOk("userinfo capture shipped (D2)", "src/utils/subscription.ts", [
  "export function parseSubscriptionUserInfo",
  'res.headers.get("subscription-userinfo")',
]);
contentOk("allowLan/mux gates shipped (D2)", "src/utils/v2rayConfig.ts", [
  'builderOptions.allowLan ? "0.0.0.0" : "127.0.0.1"',
  "if (!builderOptions.muxEnabled || flowEmitted) return null;",
]);
contentOk("socks parser + outbound shipped (Task-13)", "src/store.ts",
  ["function parseSocks(", "tryBase64Decode("]);
contentOk("core pins intact", "electron-app/electron/core-versions.json",
  ['"xray": "v25.1.1"', '"sing-box": "1.14.0"', '"aether": "1.9.0"']);
contentOk("net_check handler shipped (D1)", "electron-app/electron/ipc.ts",
  ['"net_check"', "session.fromPartition("]);
contentOk("speed + Connect Best + IP card shipped (D1)", "src/components/ConnectionTab.tsx",
  ["fmtSpeed(connDownSpeed)", "ipcheck.title"]);

if (bad > 0) { console.error(`ZIP VERIFICATION FAILED: ${bad} problem(s)`); process.exit(1); }
console.log("zip verification complete — ALL CHECKS PASSED");
