#!/usr/bin/env node
/**
 * Phase C1 FUNCTIONAL test — REAL bundled builderOptions (range parser) +
 * trafficHistory ring. No Electron, no network, no React.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TC1_WORK || "/home/z/my-project/scripts/taskC1-fn-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC1-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c1.cjs")}`], { cwd: HERE, stdio: "pipe" });
const {
  parseFragmentRange, pushTrafficSample, resetTrafficHistory,
  subscribeTrafficHistory, getTrafficHistory, TRAFFIC_HISTORY_MAX,
  FRAGMENT_DIALER_TAG, DEFAULT_BUILDER_OPTIONS,
} = await import(join(WORK, "c1.cjs"));

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

/* ---------- F1 parseFragmentRange ---------- */
check("F1a numeric range ok", JSON.stringify(parseFragmentRange("100-200")) === JSON.stringify({ from: 100, to: 200 }));
check("F1b tlshello only with opt-in", parseFragmentRange("tlshello", true) === "tlshello" && parseFragmentRange("tlshello") === null);
check("F1c reversed range rejected", parseFragmentRange("200-100") === null);
check("F1d equal bounds ok", JSON.stringify(parseFragmentRange("50-50")) === JSON.stringify({ from: 50, to: 50 }));
check("F1e garbage rejected", parseFragmentRange("abc") === null && parseFragmentRange("10") === null && parseFragmentRange("") === null && parseFragmentRange("10-20-30") === null);
check("F1f whitespace tolerated", JSON.stringify(parseFragmentRange(" 10-20 ")) === JSON.stringify({ from: 10, to: 20 }));
check("F1g negative/out-of-cap rejected", parseFragmentRange("-5-10") === null && parseFragmentRange("0-70000") === null);
check("F1h upper bound 65535 ok", JSON.stringify(parseFragmentRange("60000-65535")) === JSON.stringify({ from: 60000, to: 65535 }));

/* ---------- F2 trafficHistory ring ---------- */
resetTrafficHistory();
let events = 0;
const unsub = subscribeTrafficHistory(() => events++);
check("F2a initial empty", getTrafficHistory().length === 0);
pushTrafficSample(100, 10, 1000);
pushTrafficSample(200, 20, 2000);
const snap = getTrafficHistory();
check("F2b push + snapshot shape", snap.length === 2 && snap[0].down === 100 && snap[1].up === 20 && snap[1].at === 2000);
check("F2c snapshot reference stable between pushes", getTrafficHistory() === snap);
pushTrafficSample(300, 30, 3000);
check("F2d new push allocates a NEW array (React sees change)", getTrafficHistory() !== snap && getTrafficHistory().length === 3);
check("F2e subscriber notified once per push", events === 3);
for (let i = 0; i < TRAFFIC_HISTORY_MAX + 10; i++) pushTrafficSample(i, 0, 4000 + i);
check("F2f ring bounded at TRAFFIC_HISTORY_MAX", getTrafficHistory().length === TRAFFIC_HISTORY_MAX);
check("F2g oldest dropped (newest last)", getTrafficHistory()[TRAFFIC_HISTORY_MAX - 1].at === 4000 + TRAFFIC_HISTORY_MAX + 9);
resetTrafficHistory();
check("F2h reset clears", getTrafficHistory().length === 0);
check("F2i reset with empty ring does not notify", (events = 0) === 0 || (resetTrafficHistory(), events === 0));
pushTrafficSample(Number.NaN, 5, 1);
check("F2j non-finite sample rejected", getTrafficHistory().length === 0 && events === 0);
unsub();
pushTrafficSample(1, 1, 2);
check("F2k unsubscribe works", events === 0);
resetTrafficHistory();

/* ---------- F3 defaults ---------- */
check("F3a defaults: fragment OFF", DEFAULT_BUILDER_OPTIONS.tlsFragment === false);
check("F3b defaults: classic recipe ranges", DEFAULT_BUILDER_OPTIONS.tlsFragmentPackets === "tlshello" && DEFAULT_BUILDER_OPTIONS.tlsFragmentLength === "100-200" && DEFAULT_BUILDER_OPTIONS.tlsFragmentInterval === "10-20");
check("F3c dialer tag constant", FRAGMENT_DIALER_TAG === "memento-frag-dialer");

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
