#!/usr/bin/env node
/**
 * Phase C1 QUICKCHECK — structural pins on the REAL sources.
 *   N1  builderOptions: fragment fields/defaults/parser/dialer tag
 *   N2  v2rayConfig: dialer injection + guards + byte-identical default + noises verdict
 *   N3  trafficHistory: standalone ring slice (out of zustand)
 *   N4  TrafficChart: useSyncExternalStore ONLY (no useStore) — perf rule
 *   N5  ConnectionManager: push + reset wiring
 *   N6  ConnectionTab: chart mounted only while connected
 *   N7  SettingsTab: fragment toggle + range fields + invalid hint
 *   N8  singBoxConfig untouched by fragment (honest skip)
 *   N9  i18n: new keys x4 + parity
 *   N10 electron-mock honesty (browser preview has no traffic polling)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const ok = (c, l, d = "") => { c ? (pass++, console.log("  PASS  " + l)) : (fail++, console.log(`  FAIL  ${l}${d ? " — " + d : ""}`)); };

/* ---- N1 builderOptions ---- */
const bo = read("src/utils/builderOptions.ts");
ok(bo.includes('tlsFragment: false') && bo.includes('tlsFragmentPackets: "tlshello"') &&
   bo.includes('tlsFragmentLength: "100-200"') && bo.includes('tlsFragmentInterval: "10-20"'),
   "N1a defaults (OFF + classic recipe) — byte-identical old output");
ok(bo.includes("export const FRAGMENT_DIALER_TAG = \"memento-frag-dialer\";"), "N1b dialer tag constant");
ok(/export function parseFragmentRange\(value: string\): \{ from: number; to: number \} \| null;/.test(bo) &&
   bo.includes("allowTlsHello: true"), "N1c overload signatures (tlshello only when opted in)");
ok(bo.includes("from > to || from < 0 || to > 65535"), "N1d range sanity bounds");
ok(/v2rayConfig|v2rayConfig\.ts/.test("") || !bo.includes("from \"../store\""), "N1e standalone (no store import)");

/* ---- N2 v2rayConfig ---- */
const v2 = read("src/utils/v2rayConfig.ts");
ok(v2.includes("const fragDialer = buildFragmentDialer(builderOptions);") &&
   v2.includes("const useFragment = !!fragDialer && fragmentApplies(outbound) && !hopOutbound;"), "N2a injection gate (C4 re-point: gate also yields to an active chain hop)");
ok(v2.includes("dialerProxy: FRAGMENT_DIALER_TAG"), "N2b sockopt.dialerProxy set on the proxy outbound");
ok(v2.includes("...(fragDialerUsed && fragDialer ? [fragDialer] : []),"), "N2c dialer outbound spliced after proxy (C4 re-point: emitted when ANY outbound dials through it)");
ok(/ss\.security === "tls" \|\| ss\.security === "reality"/.test(v2), "N2d guard: tls/reality only");
ok(v2.includes("if (!packets || !length || !interval) return null;"), "N2e invalid ranges => feature off");
ok(!/"noises"/.test(v2.replace(/\/\/.*noises.*$/gm, "").replace(/\*[^*]*noises[^*]*$/gm, "")) ||
   (v2.includes("Deliberately NOT shipped") && v2.includes("UDP-only")), "N2f noises deliberately not shipped (UDP-only verdict documented)");
ok(v2.includes("Default OFF reproduces the old output byte-for-byte"), "N2g byte-identity contract documented");

/* ---- N3 trafficHistory ---- */
const th = read("src/utils/trafficHistory.ts");
ok(!/^import [^;]*from "\.\.\/store"/m.test(th) && !/^import .*zustand/m.test(th), "N3a standalone slice — NOT in the zustand store (App.tsx:61-64 rule)");
ok(th.includes("export const TRAFFIC_HISTORY_MAX = 120;"), "N3b bounded ring (120 samples ≈ 6 min @ 3 s poll)");
ok(th.includes("export function pushTrafficSample") && th.includes("export function resetTrafficHistory") &&
   th.includes("export function subscribeTrafficHistory") && th.includes("export function getTrafficHistory"), "N3c full surface");
ok(th.includes("listeners.forEach(l => l())") && th.includes("return () => listeners.delete(listener);"), "N3d listener notify + unsubscribe");
ok(th.includes("if (!Number.isFinite(down) || !Number.isFinite(up)) return;"), "N3e non-finite sample guard");

/* ---- N4 TrafficChart ---- */
const tc = read("src/components/TrafficChart.tsx");
ok(tc.includes("useSyncExternalStore(subscribeTrafficHistory, getTrafficHistory)"), "N4a data via useSyncExternalStore only");
ok(!/import .*useStore.*from "\.\.\/store"/.test(tc) && !/useStore\(/.test(tc), "N4b NO zustand subscription in the chart (selective-slice perf rule)");
ok(!tc.includes("useEffect") && !tc.includes("setInterval"), "N4c no own polling — reuses D1 poll data");
ok(tc.includes("<svg") && !/from "(recharts|chart\.js|d3)"/.test(tc), "N4d pure SVG, zero new chart deps");
ok(tc.includes("import { t } from \"../i18n\";"), "N4e i18n-aware");

/* ---- N5 ConnectionManager ---- */
const cm = read("src/components/ConnectionManager.tsx");
ok(cm.includes("import { pushTrafficSample, resetTrafficHistory } from \"../utils/trafficHistory\";"), "N5a imports");
ok(cm.includes("pushTrafficSample(downSpeed, upSpeed, now);"), "N5b one sample per poll, reusing D1 numbers");
ok(cm.split("resetTrafficHistory();").length >= 3, "N5c reset on BOTH disconnect and connected-arm branches");

/* ---- N6 ConnectionTab ---- */
const ct = read("src/components/ConnectionTab.tsx");
ok(ct.includes('import TrafficChart from "./TrafficChart";') &&
   /\{status === "connected" && <TrafficChart language=\{language\} \/>\}/.test(ct), "N6a chart mounted ONLY while connected");
ok(ct.includes("App.tsx:61-64 perf rule respected") || ct.includes("perf rule"), "N6b perf rationale documented at the mount point");

/* ---- N7 SettingsTab ---- */
const st = read("src/components/SettingsTab.tsx");
ok(st.includes("checked={options.tlsFragment}") && st.includes('t("builder.fragment", language)'), "N7a fragment toggle");
ok(st.includes('"tlsFragmentPackets"') && st.includes('"tlsFragmentLength"') && st.includes('"tlsFragmentInterval"'), "N7b three range inputs");
ok(st.includes("fragmentRangesInvalid(options)") && st.includes('t("builder.fragmentBad", language)'), "N7c invalid-range amber hint");
ok(st.includes("parseFragmentRange(o.tlsFragmentPackets, true) === null"), "N7d hint validation mirrors the generator");

/* ---- N8 singBoxConfig untouched ---- */
const sb = read("src/utils/singBoxConfig.ts");
ok(!sb.includes("fragment") && !sb.includes("FRAGMENT"), "N8a sing-box generator has no fragment (QUIC-based, honest skip)");
ok(sb.includes("allowLan") , "N8b sing-box generator still honors its own two toggles (allowLan/logLevel)");

/* ---- N9 i18n ---- */
const bundle = join(HERE, "taskC1-i18n.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskC1-entry.ts"), "--bundle", "--platform=node", "--outfile=" + bundle], { cwd: HERE, stdio: "pipe" });
const { langs } = JSON.parse(execFileSync("node", [bundle], { encoding: "utf8" }));
const NEW_KEYS = [
  "connection.trafficTitle", "connection.trafficWaiting",
  "builder.fragment", "builder.fragmentHint", "builder.fragmentPackets",
  "builder.fragmentLength", "builder.fragmentInterval", "builder.fragmentBad",
];
const missing = [];
for (const key of NEW_KEYS) {
  for (const lang of ["en", "fa", "zh", "ar"]) {
    if (!langs[lang]?.includes(key)) missing.push(`${lang}:${key}`);
  }
}
ok(missing.length === 0, `N9a all ${NEW_KEYS.length} new keys exist in 4 languages${missing.length ? " — missing: " + missing.join(", ") : ""}`);
const setEn = langs.en.join("|");
ok(["fa", "zh", "ar"].every(l => langs[l].join("|") === setEn), "N9b key-set parity across languages");

/* ---- N10 browser-preview honesty ---- */
/* The chart only ever shows samples produced by the desktop poll loop
 * (ConnectionManager gates on isDesktop()); in the browser preview there is
 * no polling, so the chart would honestly sit in its waiting state. */
ok(cm.includes('status !== "connected" || !isDesktop()'), "N10 polling stays desktop-gated (browser preview: no samples, chart honest-waiting)");

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
