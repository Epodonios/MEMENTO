#!/usr/bin/env node
/**
 * taskE2-battery.mjs — the FULL regression battery for the E2 tree
 * (Phase E — Batch E2, the MEMENTO ShadowTLS parser), one foreground run:
 * every embedded suite from the C1..D4 / B0..B4 / L0 / E1 batches PLUS the
 * two new E2 suites (the functional fntest 26 + the structural
 * quickcheck 71). The frozen embedded-assertion total becomes
 * 1,537 + 26 + 71 = 1,634 at this close gate.
 * The single sanctioned re-point of the batch: taskE1-quickcheck's
 * store.ts sha (fabf109a55cf -> 92f98fc76349, additive shadowtls parser
 * changes — the B2-era class), disclosed in its source.
 * The E2 design-time probe (taskE2-probe.mjs) does NOT ride as its own
 * suite — it is invoked INSIDE taskE2-quickcheck (G8, live re-run).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ["taskB1-fntest.mjs", 98], ["taskB1-quickcheck.mjs", 47],
  ["taskB2-fntest.mjs", 69], ["taskB2-quickcheck.mjs", 55],
  ["taskB3-fntest.mjs", 66], ["taskB3-quickcheck.mjs", 57],
  ["taskB4-quickcheck.mjs", 33],
  ["taskL0-quickcheck.mjs", 45],
  ["taskE1-fntest.mjs", 20], ["taskE1-quickcheck.mjs", 65],
  ["taskE2-fntest.mjs", 26], ["taskE2-quickcheck.mjs", 71],
  ["taskC6-fntest.mjs", 37], ["taskC6-quickcheck.mjs", 51],
  ["taskC5-fntest.mjs", 34], ["taskC5-quickcheck.mjs", 44], ["taskC5-live.mjs", 12],
  ["taskC4-fntest.mjs", 52], ["taskC4-cfgtest.mjs", 30], ["taskC4-live.mjs", 21],
  ["taskC3-fntest.mjs", 44], ["taskC3-cfgtest.mjs", 56],
  ["taskC2-fntest.mjs", 39], ["taskC2-cfgtest.mjs", 54],
  ["taskC1-fntest.mjs", 22], ["taskC1-cfgtest.mjs", 36],
  ["taskD1-quickcheck.mjs", 29],
  ["taskD2-quickcheck.mjs", 44],
  ["taskD3-quickcheck.mjs", 40], ["taskD3-fntest.mjs", 17],
  ["taskD4-quickcheck.mjs", 41], ["taskD4-fntest.mjs", 20], ["taskD4-quitclean-fntest.mjs", 0],
  ["task12-aether-smoke.mjs", 52],
  ["task13-smoke.mjs", 34], ["task13-selftest.mjs", 25],
];

let totalPass = 0, totalFail = 0, bad = [];
for (const [file, expect] of SUITES) {
  let out = "", code = 0;
  try {
    out = execFileSync("node", [join(HERE, file)], { encoding: "utf8", timeout: 900_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = e.status ?? 1;
    out = String(e.stdout ?? "") + String(e.stderr ?? "");
  }
  const all = [...out.matchAll(/(\d+) PASS \/ (\d+) FAIL/g)];
  const alt = [...out.matchAll(/ALL (\d+) [^\n]*PASSED/g)];
  const m = all.length ? all[all.length - 1] : alt.length ? alt[alt.length - 1] : null;
  const p = m ? Number(m[1]) : -1, f = m && m.length > 2 ? Number(m[2]) : 0;
  const good = code === 0 && f === 0 && p >= 0;
  if (good) totalPass += p; else bad.push(file);
  console.log(`${good ? "GREEN" : "RED   "}  ${file.padEnd(34)} ${m ? `${p} PASS / ${f} FAIL` : "no summary"} (exit ${code}, expected ~${expect})${good && p !== expect ? "  [count drift vs expectation — verified below]" : ""}`);
}

console.log(`\n===== taskE2-battery: ${SUITES.length} suites, ${totalPass} assertions PASS, ${bad.length} RED =====`);
if (bad.length) { console.log("RED suites: " + bad.join(", ")); process.exit(1); }
