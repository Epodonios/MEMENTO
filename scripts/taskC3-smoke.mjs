#!/usr/bin/env node
/**
 * Phase C3 FORMAL SMOKE (user-approved 2026-09-17, incl. the two review fixes).
 * Batch C3 = item 1 routing UI/presets/geo files + item 2 DNS/FakeDNS
 * + the user-approved review fixes: (a) transient geoPreparing state
 * (disabled "Preparing geo data…" button + re-entry guard + finally-clear)
 * and (b) parseDomainRule lowercases everything EXCEPT regexp:.
 *
 * Gates:
 *   S0  real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *       + fresh builds of BOTH frontend (vite) and main (tsc) so every
 *       later gate tests what actually ships.
 *   S1  structural surface via taskC3-quickcheck.mjs (56 assertions incl.
 *       the N15 fix pins) + dist freshness: the C3 i18n keys + the new
 *       connection.preparingGeo key + the geoPreparing wiring in the built
 *       singlefile; the COMPILED main process ships geoFiles.js with the
 *       geo_status/geo_ensure handlers and the COMPILED preload allowlist
 *       is 23 commands (+url_test, +geo pair); the D4 session-end hook
 *       stays intact on the freshly rebuilt compiled artifact (regression).
 *   S2  functional: taskC3-fntest.mjs (44 assertions incl. the regexp
 *       case-preservation fix) — parser matrices, geo-needs matrix, both
 *       builders incl. offline fallbacks, GOLDEN byte-identical legacy
 *       snapshots for both generators, forward-compat merge.
 *   S3  config-level: taskC3-cfgtest.mjs (20 assertions) — REAL xray -test
 *       on bypass-ir/ads/custom/secure/fakedns with real geo assets;
 *       NEGATIVE: same config with empty asset dir = fatal (the gate is
 *       load-bearing); REAL sing-box check on all shapes with
 *       LIVE-DOWNLOADED .srs; sanitized garbage never reaches the core.
 *   S4  LIVE behavioral proof (taskC3-live.mjs, 11 assertions): REAL
 *       two-instance vless topology — block rule swallowed by blackhole +
 *       access log [blocked]; direct rule bypasses the tunnel [direct];
 *       default path through the REAL tunnel [proxy]; bypass-ir geo config
 *       boots a real core and still forwards.
 *   S5  regression gates: task13-selftest/cfgtest + task12-quickcheck +
 *       taskD1/D2/D3/D4 quickchecks + taskD2-cfgtest + D4 fntest +
 *       quit-cleanup proof + the full C1 battery (36/22/29/5) + the full
 *       C2 battery (54/39/41/9).
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
  ok("S0 dist-electron/geoFiles.js exists post-build", fs.existsSync(join(APP, "dist-electron", "geoFiles.js")));
  ok("S0 dist-electron/urlTest.js exists post-build (C2 regression)", fs.existsSync(join(APP, "dist-electron", "urlTest.js")));
}

/* ---------------- S1: structural + dist freshness ---------------- */
console.log("\n== S1 structural (taskC3-quickcheck) + dist freshness ==");
{
  const out = run("node", [join(HERE, "taskC3-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskC3-quickcheck 56 PASS / 0 FAIL", !!m && m[1] === "56" && m[2] === "0", out.slice(-400));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  for (const needle of [
    "tab.routing",
    "rt.presetBypassIr", "rt.presetCustom", "rt.geoDesktopOnly", "rt.dnsFakedns",
    "connection.preparingGeo",                       // the approved review fix
    "Preparing geo data…",                            // en literal of the same fix
    "geoPreparing",                                   // store property name survives bundling
  ]) {
    ok(`S1 dist fresh: "${needle}" built in`, dist.includes(needle));
  }

  // C3 touched the main process (new geoFiles.ts + ipc handlers) and the
  // preload allowlist (21 -> 23) — pin BOTH on the COMPILED artifacts, plus
  // the D4 session-end hardening (regression). Lesson from C2 applied: the
  // geo handlers compile into ipc.js (main.js only imports).
  const compiledIpc = fs.readFileSync(join(APP, "dist-electron", "ipc.js"), "utf8");
  ok("S1 compiled ipc.js (rebuilt): geo_status + geo_ensure handlers shipped",
     compiledIpc.includes('ipcMain.handle("geo_status"') && compiledIpc.includes('ipcMain.handle("geo_ensure"'));
  ok("S1 compiled ipc.js (rebuilt): C2 url_test handler intact (regression)",
     compiledIpc.includes('ipcMain.handle("url_test"') && compiledIpc.includes("urlTestProbe"));
  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1 compiled main.js (rebuilt): window-level session-end hook intact",
     compiledMain.includes('mainWindow.on("session-end"') && !compiledMain.includes('app.on("session-end"'));
  const compiledPreload = fs.readFileSync(join(APP, "dist-electron", "preload.js"), "utf8");
  ok("S1 compiled preload (rebuilt): allowlist carries the geo pair",
     compiledPreload.includes('"geo_status"') && compiledPreload.includes('"geo_ensure"'));
}

/* ---------------- S2: functional ---------------- */
console.log("\n== S2 functional (taskC3-fntest: parsers + builders + golden legacy snapshots) ==");
{
  const out = run("node", [join(HERE, "taskC3-fntest.mjs")], { cwd: HERE });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskC3-fntest 44 PASS / 0 FAIL", !!m && m[1] === "44" && m[2] === "0", out.slice(-500));
  ok("S2 regexp case-preservation fix asserted (approved review fix)",
     out.includes("PASS  F1 C3-fix: regexp keeps case (no silent toLowerCase), other prefixes still normalize"), out.slice(-300));
}

/* ---------------- S3: config-level (real cores) ---------------- */
console.log("\n== S3 config-level (taskC3-cfgtest, real xray -test + sing-box check incl. live .srs) ==");
{
  const out = run("node", [join(HERE, "taskC3-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S3 taskC3-cfgtest 20 PASS / 0 FAIL", !!m && m[1] === "20" && m[2] === "0", out.slice(-600));
}

/* ---------------- S4: LIVE routing proof ---------------- */
console.log("\n== S4 LIVE routing proof (taskC3-live, two real xray instances + Xray access log) ==");
{
  const out = run("node", [join(HERE, "taskC3-live.mjs")], { cwd: HERE, timeout: 240000 });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S4 taskC3-live 11 PASS / 0 FAIL", !!m && m[1] === "11" && m[2] === "0", out.slice(-600));
  ok("S4 routing anchor: default path provably crossed the REAL vless tunnel",
     out.includes("PASS  L4 default path goes through the REAL vless tunnel (127.0.0.2 recorder hit)"), out.slice(-300));
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
}

console.log(`\nFORMAL SMOKE C3: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
