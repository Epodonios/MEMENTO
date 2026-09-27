#!/usr/bin/env node
/**
 * Phase C1 FORMAL SMOKE (user-approved 2026-09-17).
 * Batch C1 = item 5 live traffic chart + item 4 TLS fragment (noises
 * deliberately NOT shipped — UDP-only in the pinned core, a dead toggle
 * on our TCP-tunnel topology).
 *
 * Gates:
 *   S0  real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *       + fresh builds of BOTH frontend (vite) and main (tsc) so every
 *       later gate tests what actually ships.
 *   S1  structural surface via taskC1-quickcheck.mjs (36 assertions)
 *       + dist freshness: C1 i18n keys + fragment dialer tag in the built
 *       singlefile; the D4 session-end hook still present in the freshly
 *       rebuilt compiled main.js (regression on the compiled artifact).
 *   S2  functional: taskC1-fntest.mjs (22 assertions) — real bundled
 *       parseFragmentRange classes + trafficHistory ring behavior
 *       (cap / stable snapshot / notify / unsubscribe / NaN guard).
 *   S3  config-level: taskC1-cfgtest.mjs (29 assertions) — shape matrix
 *       + REAL `xray run -test` on 9 fragment variants (incl. reality /
 *       vision / mux / stats-api coexistence) + sing-box check no-op.
 *   S4  LIVE behavioral fragment proof (taskC1-live.mjs, 5 assertions):
 *       `run -test` accepts even malformed fragment fields, so this gate
 *       observes REAL behavior — REAL generator output run by the REAL
 *       pinned Xray against a local chunk recorder: OFF = one unsplit
 *       hello; ON = first fragment <= cap, chunks spaced >= interval,
 *       total bytes preserved. NOTE: this proves correct splitting only;
 *       DPI pass-through itself is checklist 22's manual real-Windows +
 *       REAL-server item (user-side).
 *   S5  regression gates: task13-selftest/cfgtest + task12-quickcheck +
 *       taskD1/D2/D3 quickchecks + taskD2-cfgtest + the full D4 battery
 *       (quickcheck + fntest + quit-cleanup proof).
 *
 * Env overrides: XRAY_BIN, SB_BIN, TC1_WORK
 * Exit code 0 = all hard assertions passed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");                       // memento-src
const APP = join(ROOT, "electron-app");              // electron-app
const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SINGBOX = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`); }
};
const run = (cmd, args, opts = {}) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 120000, ...opts }); }
  catch (e) { return (e.stdout || "") + (e.stderr || ""); }
};

/* ---------------- S0: binary + build gates ---------------- */
console.log("\n== S0 binary + build gates ==");
{
  const xv = run(XRAY, ["version"]) + run(XRAY, ["-version"]);
  ok("S0 xray is pinned v25.1.1", /Xray 25\.1\.1/.test(xv), xv.slice(0, 80).replace(/\n/g, " "));
  const sv = run(SINGBOX, ["version"]);
  ok("S0 sing-box is pinned 1.14.0", /1\.14\.0/.test(sv), sv.slice(0, 80).replace(/\n/g, " "));

  const bf = run("npm", ["run", "build:frontend"], { cwd: APP });
  ok("S0 vite build exits clean", !/error/i.test(bf) || /built in/.test(bf), bf.slice(-200).replace(/\n/g, " "));
  const bm = run("npm", ["run", "build:main"], { cwd: APP });
  ok("S0 electron main tsc exits clean", !/error TS/i.test(bm), bm.slice(-200).replace(/\n/g, " "));
  ok("S0 dist-electron/main.js exists post-build", fs.existsSync(join(APP, "dist-electron", "main.js")));
}

/* ---------------- S1: structural ---------------- */
console.log("\n== S1 structural (taskC1-quickcheck) ==");
{
  const out = run("node", [join(HERE, "taskC1-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskC1-quickcheck 36 PASS / 0 FAIL", !!m && m[1] === "36" && m[2] === "0", out.slice(-400));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  for (const needle of [
    "connection.trafficTitle", "connection.trafficWaiting",
    "builder.fragment", "builder.fragmentHint", "builder.fragmentPackets",
    "builder.fragmentLength", "builder.fragmentInterval", "builder.fragmentBad",
    "memento-frag-dialer",
  ]) {
    ok(`S1 dist fresh: "${needle}" built in`, dist.includes(needle));
  }
  // C1 changed NO main-process file, but S0 rebuilt main — pin the D4
  // hardening on the COMPILED artifact so the fresh build is proven clean.
  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1 compiled main.js (rebuilt): window-level session-end hook intact",
     compiledMain.includes('mainWindow.on("session-end"') && !compiledMain.includes('app.on("session-end"'));
}

/* ---------------- S2: functional ---------------- */
console.log("\n== S2 functional (taskC1-fntest) ==");
{
  const out = run("node", [join(HERE, "taskC1-fntest.mjs")], { cwd: HERE });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskC1-fntest 22 PASS / 0 FAIL", !!m && m[1] === "22" && m[2] === "0", out.slice(-500));
}

/* ---------------- S3: config-level (real cores) ---------------- */
console.log("\n== S3 config-level (taskC1-cfgtest, real xray -test + sing-box check) ==");
{
  const out = run("node", [join(HERE, "taskC1-cfgtest.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S3 taskC1-cfgtest 29 PASS / 0 FAIL", !!m && m[1] === "29" && m[2] === "0", out.slice(-600));
}

/* ---------------- S4: LIVE behavioral fragment proof ---------------- */
console.log("\n== S4 LIVE fragment proof (taskC1-live, real generator + real xray vs chunk recorder) ==");
{
  const out = run("node", [join(HERE, "taskC1-live.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S4 taskC1-live 5 PASS / 0 FAIL", !!m && m[1] === "5" && m[2] === "0", out.slice(-600));
  ok("S4 OFF control: hello arrives UNsplit (negative control)",
     out.includes("PASS  L1 OFF control: ClientHello arrives as ONE unsplit chunk"), out.slice(-300));
}

/* ---------------- S5: regression gates ---------------- */
console.log("\n== S5 regression suites ==");
{
  const suites = [
    ["task13-selftest", "RESULT: 25 PASS / 0 FAIL"],
    ["task13-cfgtest", "RESULT: 4 PASS / 0 FAIL"],
    ["taskD1-quickcheck", "RESULT: 29 PASS / 0 FAIL"],
    ["taskD2-quickcheck", "RESULT: 44 PASS / 0 FAIL"],
    ["taskD2-cfgtest", "RESULT: 36 PASS / 0 FAIL"],
    ["taskD3-quickcheck", "RESULT: 40 PASS / 0 FAIL"],
    ["taskD4-quickcheck", "D4 quickcheck: 41 PASS / 0 FAIL"],
  ];
  for (const [name, want] of suites) {
    const out = run("node", [join(HERE, `${name}.mjs`)], { cwd: HERE });
    ok(`S5 ${name} (${want})`, out.includes(want), out.slice(-300));
  }
  const out12 = run("node", [join(HERE, "task12-quickcheck.mjs")], { cwd: HERE });
  ok("S5 task12-quickcheck (7 assertions)", /QUICK-CHECK: 7 assertions passed/.test(out12), out12.slice(-300));
  const outD4f = run("node", [join(HERE, "taskD4-fntest.mjs")], { cwd: HERE });
  ok("S5 taskD4-fntest (20 assertions)", /D4 fntest: 20 PASS \/ 0 FAIL/.test(outD4f), outD4f.slice(-300));
  const outD4q = run("node", [join(HERE, "taskD4-quitclean-fntest.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskD4-quitclean-fntest (31 assertions, both phases)",
     /D4 quit-cleanup fntest: 31 PASS \/ 0 FAIL \(both phases\)/.test(outD4q), outD4q.slice(-300));
}

console.log(`\nFORMAL SMOKE C1: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
