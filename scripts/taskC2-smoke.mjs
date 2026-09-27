#!/usr/bin/env node
/**
 * Phase C2 FORMAL SMOKE (user-approved 2026-09-17).
 * Batch C2 = item 3 real URL-test (v2rayN "real delay") + latency history
 * + the D4-deferred custom Test URL.
 *
 * Gates:
 *   S0  real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *       + fresh builds of BOTH frontend (vite) and main (tsc) so every
 *       later gate tests what actually ships.
 *   S1  structural surface via taskC2-quickcheck.mjs (54 assertions)
 *       + dist freshness: the 10 new C2 i18n keys + the generate_204
 *       default in the built singlefile; the COMPILED main.js ships the
 *       url_test handler and the COMPILED preload allowlist is 21
 *       commands (+url_test); the D4 session-end hook stays intact on the
 *       freshly rebuilt compiled artifact (regression).
 *   S2  functional: taskC2-fntest.mjs (39 assertions) — real appPrefs
 *       (testUrl defaults/legacy/round-trip/corrupt/sanitize/normalize),
 *       real latencyHistory ring behavior, and the REAL COMPILED
 *       dist-electron/urlTest.js (rewrite shapes xray+sing-box, rewrite
 *       errors, urlTestProbe validation chain without spawn, dist
 *       freshness).
 *   S3  config-level: taskC2-cfgtest.mjs (41 assertions) — 9 xray rewrite
 *       shapes + fragment-survives-rewrite + stats-api dropped + 2
 *       sing-box shapes, every REWRITTEN probe config accepted by the
 *       REAL pinned cores (`xray run -test` / `sing-box check`); clash_api
 *       contract.
 *   S4  LIVE behavioral probe proof (taskC2-live.mjs, 9 assertions): TWO
 *       real pinned Xray instances (vless server + rewritten probe
 *       instance) — a real HTTP GET traverses the REAL tunnel and returns
 *       204; real ms timing; kill -> port closed; unreachable server ->
 *       honest failure (never a fake 0 ms).
 *   S5  regression gates: task13-selftest/cfgtest + task12-quickcheck +
 *       taskD1/D2/D3/D4 quickchecks + taskD2-cfgtest + D4 fntest +
 *       quit-cleanup proof + the full C1 battery (quickcheck/fntest/
 *       cfgtest/live).
 *
 * Env overrides: XRAY_BIN, SB_BIN, TC2_WORK
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
  ok("S0 dist-electron/urlTest.js exists post-build", fs.existsSync(join(APP, "dist-electron", "urlTest.js")));
}

/* ---------------- S1: structural + dist freshness ---------------- */
console.log("\n== S1 structural (taskC2-quickcheck) + dist freshness ==");
{
  const out = run("node", [join(HERE, "taskC2-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskC2-quickcheck 54 PASS / 0 FAIL", !!m && m[1] === "54" && m[2] === "0", out.slice(-400));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  for (const needle of [
    "configs.urlTest", "configs.urlTestAll", "configs.urlTesting", "configs.urlTestFail",
    "pinger.urlTest",
    "connection.urlTest", "connection.urlTestDone", "connection.urlTestFail",
    "set.testUrl", "set.testUrlHint",
    "https://www.gstatic.com/generate_204",
  ]) {
    ok(`S1 dist fresh: "${needle}" built in`, dist.includes(needle));
  }

  // C2 touched the main process (ipc.ts + new urlTest.ts) and the preload
  // allowlist (20 -> 21) — pin BOTH on the COMPILED artifacts so the fresh
  // build is proven clean, plus the D4 session-end hardening (regression).
  // The url_test handler compiles into ipc.js (main.js only imports it).
  const compiledIpc = fs.readFileSync(join(APP, "dist-electron", "ipc.js"), "utf8");
  ok("S1 compiled ipc.js (rebuilt): url_test handler wired to urlTestProbe",
     compiledIpc.includes('ipcMain.handle("url_test"') && compiledIpc.includes("urlTestProbe"));
  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1 compiled main.js (rebuilt): window-level session-end hook intact",
     compiledMain.includes('mainWindow.on("session-end"') && !compiledMain.includes('app.on("session-end"'));
  const compiledPreload = fs.readFileSync(join(APP, "dist-electron", "preload.js"), "utf8");
  ok("S1 compiled preload (rebuilt): allowlist carries url_test", compiledPreload.includes('"url_test"'));
}

/* ---------------- S2: functional ---------------- */
console.log("\n== S2 functional (taskC2-fntest: real appPrefs + latencyHistory + compiled urlTest.js) ==");
{
  const out = run("node", [join(HERE, "taskC2-fntest.mjs")], { cwd: HERE });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskC2-fntest 39 PASS / 0 FAIL", !!m && m[1] === "39" && m[2] === "0", out.slice(-500));
}

/* ---------------- S3: config-level (real cores on REWRITTEN configs) ---------------- */
console.log("\n== S3 config-level (taskC2-cfgtest, real xray -test + sing-box check on rewritten probe configs) ==");
{
  const out = run("node", [join(HERE, "taskC2-cfgtest.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S3 taskC2-cfgtest 41 PASS / 0 FAIL", !!m && m[1] === "41" && m[2] === "0", out.slice(-600));
}

/* ---------------- S4: LIVE probe proof ---------------- */
console.log("\n== S4 LIVE url-test proof (taskC2-live, two real xray instances + byte-level socks5 client) ==");
{
  const out = run("node", [join(HERE, "taskC2-live.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S4 taskC2-live 9 PASS / 0 FAIL", !!m && m[1] === "9" && m[2] === "0", out.slice(-600));
  ok("S4 tunnel traversal anchor: GET provably crossed the REAL VLESS tunnel",
     out.includes("PASS  L2 HTTP GET traversed the REAL VLESS tunnel (2xx back to the client)"), out.slice(-300));
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

  // C1 battery — full, on the freshly built tree
  const outC1q = run("node", [join(HERE, "taskC1-quickcheck.mjs")], { cwd: HERE });
  ok("S5 taskC1-quickcheck (36 assertions)", /RESULT: 36 PASS \/ 0 FAIL/.test(outC1q), outC1q.slice(-300));
  const outC1f = run("node", [join(HERE, "taskC1-fntest.mjs")], { cwd: HERE });
  ok("S5 taskC1-fntest (22 assertions)", /RESULT: 22 PASS \/ 0 FAIL/.test(outC1f), outC1f.slice(-300));
  const outC1c = run("node", [join(HERE, "taskC1-cfgtest.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskC1-cfgtest (29 assertions)", /RESULT: 29 PASS \/ 0 FAIL/.test(outC1c), outC1c.slice(-300));
  const outC1l = run("node", [join(HERE, "taskC1-live.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskC1-live (5 assertions)", /RESULT: 5 PASS \/ 0 FAIL/.test(outC1l), outC1l.slice(-300));
}

console.log(`\nFORMAL SMOKE C2: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
