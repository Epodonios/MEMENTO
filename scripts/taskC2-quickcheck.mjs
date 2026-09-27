#!/usr/bin/env node
/**
 * Phase C2 QUICK-CHECK — structural surface of the real-delay URL test
 * (file reads only, no processes). Lesson from D4/C1 applied: tsc keeps
 * comments, so every pin matches CODE FORM, never comment text.
 *
 *   N1  main urlTest.ts: appPrefs sourcing, inbound-rewrite shapes,
 *       temp-file discipline, kill semantics, isolation negatives
 *   N2  isolation: direct spawn (no manager start), no orphan-kill, no
 *       system-proxy writes, windowsHide
 *   N3  urlTestProbe entry: either-or guard, timeout clamp, URL validation
 *   N4  ipc.ts: url_test handler + prefs spread
 *   N5  preload: allowlist 23 incl. url_test + geo_status/geo_ensure (re-pointed at C3)
 *   N6  appPrefs.ts: testUrl field + normalizeTestUrl + sanitize branch
 *   N7  latencyHistory.ts: ring surface + outside-zustand negative
 *   N8  renderer urlTest.ts: generator contract + pool + tunnel mode
 *   N9  ConfigsTab: toolbar batch + per-row badge/sparkline + no pingResults write
 *   N10 ConnectionTab: live-tunnel probe wiring
 *   N11 PingerTab: url mode with identity-less results
 *   N12 SettingsTab: test URL field
 *   N13 electron-mock: honest failures
 *   N14 i18n: 10 new keys x4 with parity (real bundled translations)
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP = join(ROOT, "electron-app");

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };
const read = (p) => fs.readFileSync(join(ROOT, p), "utf8");

console.log("== Phase C2 quickcheck (no network, no processes) ==");

/* ---- N1 main urlTest.ts ---- */
{
  const ut = read("electron-app/electron/urlTest.ts");
  ok("N1 test URL default + validator sourced from appPrefs (single source of truth)",
     ut.includes('import { URL_TEST_DEFAULT, normalizeTestUrl } from "./appPrefs"'));
  ok("N1 app-owned ports reserved (10808/10809/10850/1819)",
     ut.includes("new Set([10808, 10809, 10850, 1819])"));
  ok("N1 xray shape patched via ib.port, sing-box via ib.listen_port",
     ut.includes("ib.port = port;") && ut.includes("ib.listen_port = port;"));
  ok("N1 non-socks inbounds dropped (http/api never collide with a live session)",
     ut.includes("keptInbounds.push(ib);") && ut.includes("parsed.inbounds = keptInbounds;"));
  ok("N1 temp configs in os.tmpdir() with the memento-urltest- prefix",
     ut.includes('const TEMP_PREFIX = "memento-urltest-"') && ut.includes("path.join(os.tmpdir()"));
  ok("N1 probe child killed with SIGKILL in finally",
     ut.includes('kill("SIGKILL")') && ut.includes("finally {"));
  ok("N1 stale temp-file sweep on module load",
     ut.includes("sweepStaleTempConfigs();") && ut.includes("10 * 60_000"));
}

/* ---- N2 isolation semantics ---- */
{
  const ut = read("electron-app/electron/urlTest.ts");
  // Comments deliberately discuss the forbidden APIs — strip them so the
  // pins match CODE FORM only (the D4/C1 lesson, generalized here).
  const utCode = ut.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("N2 spawns DIRECTLY (never through XrayManager/SingBoxManager)",
     !utCode.includes("xrayManager") && !utCode.includes("singBoxManager") && ut.includes("spawn(binPath"));
  ok("N2 probe never runs the image-wide orphan kill (the live VPN is untouchable)",
     !utCode.includes("killAllOrphanedCores"));
  ok("N2 probe never writes or clears the system proxy",
     !utCode.includes("setSystemProxy") && !utCode.includes("clearSystemProxy"));
  ok("N2 windowsHide:true (CREATE_NO_WINDOW parity)", ut.includes("windowsHide: true"));
  ok("N2 early child death surfaces the stderr tail",
     ut.includes("stderrTail()") && ut.includes('child.once("exit", onExit)'));
}

/* ---- N3 urlTestProbe entry ---- */
{
  const ut = read("electron-app/electron/urlTest.ts");
  ok("N3 either-or guard (configJson XOR socksPort)",
     ut.includes("Pass either configJson or socksPort, not both"));
  ok("N3 timeout clamped to 1s..30s with a 10s default",
     ut.includes("Math.min(30_000, Math.max(1_000, timeoutRaw))") && ut.includes("timeoutRaw"));
  ok("N3 main-side URL validation via normalizeTestUrl wrapper",
     ut.includes("normalizeTestUrl(url) !== null"));
  ok("N3 latency = time to response headers via the D1 net_check recipe (ses.fetch on a throwaway partition)",
     ut.includes('session.fromPartition(`urltest-${Date.now()}') && ut.includes("ses.setProxy") && ut.includes("ses.fetch"));
}

/* ---- N4 ipc.ts ---- */
{
  const ipc = read("electron-app/electron/ipc.ts");
  ok("N4 url_test handler registered", ipc.includes('"url_test"') && ipc.includes("urlTestProbe(args ?? {})"));
  ok("N4 app_prefs_get spreads the full prefs (testUrl rides along)",
     ipc.includes("...loadAppPrefs()"));
}

/* ---- N5 preload ---- */
{
  const preload = read("electron-app/electron/preload.ts");
  const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
  ok("N5a allowlist = 32 commands incl. url_test + geo pair (re-pointed 21->23 at C3, 27 at C6; 31 after B2: the 4 routing commands; 32 after E1: the connection-stats probe)",
     allow.length === 32 && allow.includes("url_test") && allow.includes("geo_status") && allow.includes("geo_ensure") && allow.includes("aether_update_check"));
  ok("N5b generic pass-through only (no dedicated url_test method surface)",
     preload.includes("if (!ALLOWED_COMMANDS.has(cmd))"));
}

/* ---- N6 appPrefs.ts ---- */
{
  const ap = read("electron-app/electron/appPrefs.ts");
  ok("N6 testUrl in the AppPrefs interface + default", ap.includes("testUrl: string;") && ap.includes('testUrl: URL_TEST_DEFAULT,'));
  ok("N6 canonical default is the gstatic generate_204 endpoint",
     ap.includes('export const URL_TEST_DEFAULT = "https://www.gstatic.com/generate_204";'));
  ok("N6 pure normalizeTestUrl (http/https, no whitespace, ≤500)",
     ap.includes("export function normalizeTestUrl(v: unknown): string | null"));
  ok("N6 sanitizer accepts testUrl and drops invalid values",
     ap.includes("const testUrl = normalizeTestUrl(p.testUrl);") && ap.includes("if (testUrl) out.testUrl = testUrl;"));
  ok("N6 tolerant load falls back to the default", ap.includes("testUrl: normalizeTestUrl(o.testUrl) ?? URL_TEST_DEFAULT"));
}

/* ---- N7 latencyHistory.ts ---- */
{
  const lh = read("src/utils/latencyHistory.ts");
  ok("N7 ring cap 20 + stable EMPTY snapshot + lastLatencySample",
     lh.includes("export const LATENCY_HISTORY_MAX = 20;") && lh.includes("const EMPTY: LatencySample[] = []") && lh.includes("export function lastLatencySample"));
  ok("N7 NaN guard + reference-stable next-ring allocation",
     lh.includes("Number.isFinite(sample.ms)") && lh.includes("rings.set(configId, next);"));
  ok("N7 NEGATIVE: a truly standalone module — no imports at all (C1 perf rule)",
     !/\bimport\s/.test(lh) && !lh.includes('from "../store"'));
  ok("N7 clear(one)/clear(all) + unsubscribe-capable subscribe",
     lh.includes("export function clearLatencyHistory(configId?: string): void") && lh.includes("return () => listeners.delete(listener);"));
}

/* ---- N8 renderer urlTest.ts ---- */
{
  const ut = read("src/utils/urlTest.ts");
  ok("N8 probe configs generated by the SAME generators + builder options",
     ut.includes('generateV2RayConfig(config, "socks-only"') && ut.includes("state.builderOptions"));
  ok("N8 statsApiPort deliberately undefined for probes (no api inbound to collide) — call form re-pointed at C3 (+routingOptions, srsDir)",
     ut.includes("generateSingBoxConfig(config, state.connSocksPort, state.connHttpPort, undefined, state.builderOptions, state.routingOptions, srsDir)"));
  ok("N8 pool concurrency 4 (whole core per probe)", ut.includes("export const URL_TEST_CONCURRENCY = 4;"));
  ok("N8 persisted pref resolved lazily + cache invalidation exported",
     ut.includes("export async function resolveTestUrl") && ut.includes("export function invalidateTestUrlCache"));
  ok("N8 recordHistory bypass for identity-less targets (Pinger tab)",
     ut.includes("recordHistory = true") && ut.includes("opts.recordHistory !== false"));
  ok("N8 tunnel mode probes a RUNNING inbound and records into configId when given",
     ut.includes("export async function runTunnelUrlTest(") && ut.includes("if (configId) {"));
  ok("N8 browser preview honest: probes fail without history writes",
     ut.includes("if (!isDesktop()) {") && ut.includes('"Desktop only"'));
}

/* ---- N9 ConfigsTab ---- */
{
  const ct = read("src/components/ConfigsTab.tsx");
  ok("N9 toolbar batch handler with click-again-to-cancel + progress state",
     ct.includes("const handleUrlTestAll = useCallback") && ct.includes("urlTestAbortRef.current?.abort();") && ct.includes("setUrlTestProgress({ done, total })"));
  ok("N9 batch results go to latencyHistory semantics — pingResults untouched",
     !/handleUrlTestAll[\s\S]{0,2400}setPingResult/.test(ct.split("const handleConnectBest")[0].split("handleUrlTestAll = useCallback")[1] || ""));
  ok("N9 badge subscribes ONLY the standalone slice (useSyncExternalStore)",
     ct.includes("useSyncExternalStore(subscribeLatencyHistory, () => getLatencyHistory(configId))"));
  ok("N9 pure-SVG sparkline, hidden on narrow viewports",
     ct.includes("function LatencySparkline") && ct.includes("<polyline") && ct.includes('className="hidden xl:block"'));
  ok("N9 toolbar button + per-row Activity button with the urlTest labels",
     ct.includes('t("configs.urlTestAll", language)') && ct.includes("onClick={handleUrlTestRow}") && ct.includes('title={t("configs.urlTest", language)}'));
}

/* ---- N10 ConnectionTab ---- */
{
  const cn = read("src/components/ConnectionTab.tsx");
  ok("N10 live-tunnel probe on the connected config's socks port",
     cn.includes("runTunnelUrlTest(connSocksPort, connConfigId)"));
  ok("N10 guarded to the connected state only", cn.includes('if (urlTesting || status !== "connected") return;'));
  ok("N10 toast feedback with the {ms}/{error} placeholders",
     cn.includes('t("connection.urlTestDone", language).replace("{ms}"') && cn.includes('t("connection.urlTestFail", language).replace("{error}"'));
}

/* ---- N11 PingerTab ---- */
{
  const pt = read("src/components/PingerTab.tsx");
  ok("N11 tcp/url mode toggle exists", pt.includes('useState<"tcp" | "url">("tcp")'));
  ok("N11 url mode parses pasted links via the store parser",
     pt.includes("parseSingleLink") && pt.includes("transport: \"url\","));
  ok("N11 identity-less probes: recordHistory:false + per-result mapping",
     pt.includes("recordHistory: false") && pt.includes("idToIdx"));
}

/* ---- N12 SettingsTab ---- */
{
  const st = read("src/components/SettingsTab.tsx");
  ok("N12 testUrl in the prefs view + draft state that never fights the async reply loop",
     st.includes("testUrl: string;") && st.includes("const [testUrlDraft, setTestUrlDraft] = useState<string>(\"\")"));
  ok("N12 save commits the draft, reverts to the reply value, invalidates the probe cache",
     st.includes("setTestUrlDraft(next.testUrl ?? testUrlDraft);") && st.includes("invalidateTestUrlCache();"));
  ok("N12 input carries the set.testUrl keys + red ring on invalid drafts",
     st.includes('t("set.testUrl", language)') && st.includes('t("set.testUrlHint", language)') && st.includes('"border-red-500/60"'));
}

/* ---- N13 electron-mock ---- */
{
  const mock = read("src/electron-mock.ts");
  ok("N13 url_test mock honestly fails — never invents a latency number",
     mock.includes('"Desktop only (mock preview)"') && /url_test: async \(args: any\) => \{[\s\S]{0,700}ok: false,\s*\n\s*ms: null,/.test(mock));
  ok("N13 mock prefs carry the testUrl field (get + set discipline)",
     mock.includes('testUrl: "https://www.gstatic.com/generate_204"') && mock.includes("let testUrl ="));
}

/* ---- N14 i18n parity (real bundled translations) ---- */
{
  const bundle = join(HERE, "taskC2-i18n.cjs");
  execFileSync("npx", ["esbuild", join(HERE, "taskC2-entry.ts"), "--bundle", "--platform=node", "--outfile=" + bundle], { cwd: HERE, stdio: "pipe" });
  const { langs } = JSON.parse(execFileSync("node", [bundle], { encoding: "utf8" }));
  const need = ["configs.urlTest", "configs.urlTestAll", "configs.urlTesting", "configs.urlTestFail",
    "pinger.urlTest", "connection.urlTest", "connection.urlTestDone", "connection.urlTestFail",
    "set.testUrl", "set.testUrlHint"];
  const names = Object.keys(langs);
  let parityOk = names.length === 4;
  for (const k of need) {
    const n = names.filter(l => langs[l].includes(k)).length;
    if (n !== 4) { parityOk = false; console.log(`        missing ${k} in ${4 - n} language(s)`); }
  }
  ok("N14 10 new C2 keys present in ALL four languages", parityOk);
  // sanity: C1 keys survived the edit
  ok("N14 C1 keys untouched (regression)", names.filter(l => langs[l].includes("connection.trafficTitle")).length === 4);
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
