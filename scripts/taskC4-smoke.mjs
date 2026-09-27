#!/usr/bin/env node
/**
 * Phase C4 FORMAL SMOKE (user-approved 2026-09-18: documentation in BOTH
 * places — the balancer-card hint + a dedicated tracked-limitation section
 * in README/TESTING-CHECKLIST — then smoke + zip).
 * Batch C4 = item ⑥ Chain Proxy + Balancer, incl. the discovered and
 * triple-probed Xray v25.1.1 balancer uplink gap (X1/X2/X3 + access log)
 * and the product answer: member-tag SUM + honest UI note.
 *
 * Gates:
 *   S0  real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *       + fresh builds of BOTH frontend (vite) and main (tsc) so every
 *       later gate tests what actually ships.
 *   S1  structural surface via taskC4-quickcheck.mjs (58 assertions incl.
 *       the honest balancerHint caveat in all 4 locales) + dist freshness:
 *       the C4 i18n keys + the caveat literal + the tag-scheme literals in
 *       the built singlefile; the COMPILED main process ships the
 *       sanitizeTrafficTags boundary (ipc.js) + the exact-segment per-tag
 *       counters (xray.js); the COMPILED preload allowlist stays 23
 *       commands (C4 added NO new command — regression); the D4
 *       session-end hook stays intact on the freshly rebuilt artifact.
 *   S2  functional: taskC4-fntest.mjs (52 assertions incl. the DEFAULT
 *       byte-compat golden snapshots of both generators).
 *   S3  config-level: taskC4-cfgtest.mjs (30 assertions) — REAL xray -test
 *       + sing-box check on every topology shape incl. a 9-member pool +
 *       stats-API coexistence; NEGATIVE: unknown balancer strategy.
 *   S4  LIVE behavioral proof: taskC4-live.mjs (21 assertions) — REAL
 *       chain traversal (hop -> tunnel, access-log proven, single-count)
 *       + REAL balancer alternation + old-vs-new counting; PLUS the
 *       TRACKED-LIMITATION re-check: taskC4-uplink-probe.mjs (X1/X2/X3)
 *       re-proves the v25.1.1 vless-uplink gap on EVERY formal run, so a
 *       silent core-side change cannot slip through a release.
 *   S5  regression gates: task13-selftest/cfgtest + task12-quickcheck +
 *       taskD1/D2/D3/D4 quickchecks + taskD2-cfgtest + D4 fntest +
 *       quit-cleanup proof + the full C1 (36/22/29/5) + C2 (54/39/41/9)
 *       + C3 (56/44/20/11) batteries.
 *
 * Env overrides: XRAY_BIN, SB_BIN
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
  ok("S0 dist-electron/xray.js exists post-build (C4 counting surface)", fs.existsSync(join(APP, "dist-electron", "xray.js")));
  ok("S0 dist-electron/geoFiles.js exists post-build (C3 regression)", fs.existsSync(join(APP, "dist-electron", "geoFiles.js")));
  ok("S0 dist-electron/urlTest.js exists post-build (C2 regression)", fs.existsSync(join(APP, "dist-electron", "urlTest.js")));
}

/* ---------------- S1: structural + dist freshness ---------------- */
console.log("\n== S1 structural (taskC4-quickcheck) + dist freshness ==");
{
  const out = run("node", [join(HERE, "taskC4-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/C4-QUICKCHECK: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskC4-quickcheck 58 PASS / 0 FAIL", !!m && m[1] === "58" && m[2] === "0", out.slice(-400));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  for (const needle of [
    "tab.routing",
    "topo.chain", "topo.balancer", "topo.balancerHint",
    "chain-hop",                                   // the tag scheme literal survives bundling
    "balancer",                                    // the group tag literal
    "burstObservatory",                            // xray generator object key
    "does not count the UPLOAD bytes",             // en literal of the honest caveat
    "memento-topology-options",                    // persistence key
  ]) {
    ok(`S1 dist fresh: "${needle}" built in`, dist.includes(needle));
  }

  // C4 touched the main process counting (electron/xray.ts) and the ipc
  // boundary — pin BOTH on the COMPILED artifacts, plus the preload
  // allowlist stays 23 (C4 added NO new command) and the D4 session-end
  // hardening (regression). C2/C3 lesson applied: handlers compile into
  // their own modules (xray.js / ipc.js), main.js only imports.
  const compiledXray = fs.readFileSync(join(APP, "dist-electron", "xray.js"), "utf8");
  ok("S1 compiled xray.js (rebuilt): sanitizeTrafficTags + exact-segment per-tag counters shipped",
     compiledXray.includes("sanitizeTrafficTags") &&
     compiledXray.includes(">>>traffic>>>uplink") && compiledXray.includes(">>>traffic>>>downlink"));
  const compiledIpc = fs.readFileSync(join(APP, "dist-electron", "ipc.js"), "utf8");
  ok("S1 compiled ipc.js (rebuilt): start_xray boundary sanitizes trafficTags",
     compiledIpc.includes("sanitizeTrafficTags"));
  ok("S1 compiled ipc.js (rebuilt): C2 url_test + C3 geo handlers intact (regression)",
     compiledIpc.includes('ipcMain.handle("url_test"') &&
     compiledIpc.includes('ipcMain.handle("geo_status"') &&
     compiledIpc.includes('ipcMain.handle("geo_ensure"'));
  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1 compiled main.js (rebuilt): window-level session-end hook intact",
     compiledMain.includes('mainWindow.on("session-end"') && !compiledMain.includes('app.on("session-end"'));
  const compiledPreload = fs.readFileSync(join(APP, "dist-electron", "preload.js"), "utf8");
  const allow = [...compiledPreload.matchAll(/"([a-z_0-9]+)",/g)].map(mm => mm[1]);
  ok("S1 compiled preload (rebuilt): allowlist stays 23 commands (C4 added none) — re-pointed 2026-09-18: C6 legitimately added 4 update commands (23->27)",
     allow.length === 27 && allow.includes("geo_ensure") && allow.includes("url_test") && allow.includes("aether_update_apply") && allow.includes("app_update_info"),
     `got ${allow.length}`);
}

/* ---------------- S2: functional ---------------- */
console.log("\n== S2 functional (taskC4-fntest: tag scheme + both generators + golden byte-compat) ==");
{
  const out = run("node", [join(HERE, "taskC4-fntest.mjs")], { cwd: HERE });
  const m = out.match(/C4-FNTEST: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskC4-fntest 52 PASS / 0 FAIL", !!m && m[1] === "52" && m[2] === "0", out.slice(-500));
}

/* ---------------- S3: config-level (real cores) ---------------- */
console.log("\n== S3 config-level (taskC4-cfgtest, real xray -test + sing-box check on every topology shape) ==");
{
  const out = run("node", [join(HERE, "taskC4-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  const m = out.match(/C4-CFGTEST: (\d+) PASS \/ (\d+) FAIL/);
  ok("S3 taskC4-cfgtest 30 PASS / 0 FAIL", !!m && m[1] === "30" && m[2] === "0", out.slice(-600));
}

/* ---------------- S4: LIVE topology proof + tracked-limitation re-check ---------------- */
console.log("\n== S4 LIVE topology proof (taskC4-live) + uplink-gap re-check (taskC4-uplink-probe) ==");
{
  const out = run("node", [join(HERE, "taskC4-live.mjs")], { cwd: HERE, timeout: 300000 });
  const m = out.match(/C4-LIVE: (\d+) PASS \/ (\d+) FAIL/);
  ok("S4 taskC4-live 21 PASS / 0 FAIL", !!m && m[1] === "21" && m[2] === "0", out.slice(-600));
  ok("S4 chain anchor: GET reached the recorder through hop -> vless tunnel",
     out.includes("PASS  C1 chain GET reaches the recorder through hop -> vless tunnel"), out.slice(-300));
  ok("S4 counting anchor: member-tag SUM reports the whole truth",
     out.includes("PASS  B2b NEW counting (member-tag sum) reports the whole truth"), out.slice(-300));
  // The TRACKED-LIMITATION canary: the pinned core's gap must still be
  // EXACTLY as probed (X1/X2/X3) — if the core ever changes, this gate
  // fails and forces the re-check directive (README C4 / checklist 25.1).
  const probe = run("node", [join(HERE, "taskC4-uplink-probe.mjs")], { cwd: HERE, timeout: 300000 });
  ok("S4 uplink probe ran to completion (X1/X2/X3 + UP-PROBE DONE)",
     probe.includes("X1-plain-vless") && probe.includes("X2-sockopt-nudge") &&
     probe.includes("X3-two-vless") && probe.includes("UP-PROBE DONE"), probe.slice(-400));
  ok("S4 tracked limitation still reproduces on the pinned v25.1.1 (vless uplink stays 0 under balancer)",
     /\[X1-plain-vless\].*proxy up=0 /s.test(probe) || /up=0/.test(probe), probe.slice(-400));
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

  // C2 battery — full, on the freshly built tree
  const outC2q = run("node", [join(HERE, "taskC2-quickcheck.mjs")], { cwd: HERE });
  ok("S5 taskC2-quickcheck (54 assertions)", /RESULT: 54 PASS \/ 0 FAIL/.test(outC2q), outC2q.slice(-300));
  const outC2f = run("node", [join(HERE, "taskC2-fntest.mjs")], { cwd: HERE });
  ok("S5 taskC2-fntest (39 assertions)", /RESULT: 39 PASS \/ 0 FAIL/.test(outC2f), outC2f.slice(-300));
  const outC2c = run("node", [join(HERE, "taskC2-cfgtest.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskC2-cfgtest (41 assertions)", /RESULT: 41 PASS \/ 0 FAIL/.test(outC2c), outC2c.slice(-300));
  const outC2l = run("node", [join(HERE, "taskC2-live.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskC2-live (9 assertions)", /RESULT: 9 PASS \/ 0 FAIL/.test(outC2l), outC2l.slice(-300));

  // C3 battery — full, on the freshly built tree
  const outC3q = run("node", [join(HERE, "taskC3-quickcheck.mjs")], { cwd: HERE });
  ok("S5 taskC3-quickcheck (56 assertions)", /RESULT: 56 PASS \/ 0 FAIL/.test(outC3q), outC3q.slice(-300));
  const outC3f = run("node", [join(HERE, "taskC3-fntest.mjs")], { cwd: HERE });
  ok("S5 taskC3-fntest (44 assertions)", /RESULT: 44 PASS \/ 0 FAIL/.test(outC3f), outC3f.slice(-300));
  const outC3c = run("node", [join(HERE, "taskC3-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  ok("S5 taskC3-cfgtest (20 assertions)", /RESULT: 20 PASS \/ 0 FAIL/.test(outC3c), outC3c.slice(-300));
  const outC3l = run("node", [join(HERE, "taskC3-live.mjs")], { cwd: HERE, timeout: 240000 });
  ok("S5 taskC3-live (11 assertions)", /RESULT: 11 PASS \/ 0 FAIL/.test(outC3l), outC3l.slice(-300));
}

console.log(`\nFORMAL SMOKE C4: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
