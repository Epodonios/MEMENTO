#!/usr/bin/env node
/**
 * Phase C6 OFFICIAL FORMAL SMOKE (user-approved 2026-09-20: close C6
 * BEFORE B0 so the seal chain is current — smoke + zip + seal, then the
 * seal is copied into seals-archive/ and hash-verified there).
 *
 * Batch C6 = Aether pin-per-version updates (Option B: the table is the
 * ONLY authority) + the honest self-update assistant (Option A: static
 * facts, releases page in the USER's browser, never a self-swap).
 *
 * Gate structure (mirrors the C5 smoke; S1-S5 TOGETHER re-run the full
 * 982-assertion battery: 894 through C5 + 88 C6 — this run IS the
 * user-ordered health gate):
 *   S0  real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *       + fresh builds of BOTH frontend (vite) and main (tsc) + the C6
 *       compiled artifacts exist post-build (aetherUpdate.js, appUpdate.js,
 *       aether-versions.json emitted beside them).
 *   S1  structural surface via taskC6-quickcheck.mjs (51 assertions incl.
 *       the byte-identical 1.9.0 table pins, the running locks with ZERO
 *       transport calls, the isolation negatives, allowlist 27, i18n 25x4,
 *       honest mock, docs) + dist freshness (C6 panel keys + the en
 *       contract literals in the built singlefile) + COMPILED pins:
 *       aetherUpdate.js gate chain, appUpdate.js static-only (ZERO require
 *       calls at compiled level), ipc.js 4 handlers, aether.js gate
 *       extension, preload allowlist 27, C5/D4 regressions in main.js /
 *       killSwitch.js.
 *   S2  functional: taskC6-fntest.mjs (37 assertions: table validation,
 *       semver, hash identification, honest check states, ALL refusals
 *       incl. zip-hash + BINARY hash gates, happy path + .prev.bak +
 *       re-identification, GATE-2 RACE, in-flight, io-error survival).
 *   S3  config-level regression through the REAL cores (taskC4-cfgtest,
 *       30 assertions): C6 touched no generator, so the freshly built tree
 *       still produces core-valid configs (xray -test + sing-box check).
 *   S4  LIVE behavioral regression: taskC5-live.mjs (12 assertions, 9
 *       child phases — C6 edited files adjacent to the kill-switch
 *       surface: aether.ts gate + ipc.ts + preload) + the C4
 *       TRACKED-LIMITATION canary (taskC4-uplink-probe X1/X2/X3).
 *   S5  regression gates: task13-selftest/cfgtest + task12-quickcheck +
 *       D1/D2/D3/D4 quickchecks + D2-cfgtest + D4 fntest + quit-cleanup
 *       + the full C1 (36/22/29/5) + C2 (54/39/41/9) + C3 (56/44/20/11)
 *       + C4 (58/52/30/21) + C5 (44/34) batteries.
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
  ok("S0 dist-electron/aetherUpdate.js exists post-build (C6 service)", fs.existsSync(join(APP, "dist-electron", "aetherUpdate.js")));
  ok("S0 dist-electron/appUpdate.js exists post-build (C6 static helper)", fs.existsSync(join(APP, "dist-electron", "appUpdate.js")));
  ok("S0 dist-electron/aether-versions.json emitted post-build (the table ships)", fs.existsSync(join(APP, "dist-electron", "aether-versions.json")));
  ok("S0 dist-electron/killSwitch.js exists post-build (C5 regression)", fs.existsSync(join(APP, "dist-electron", "killSwitch.js")));
  ok("S0 dist-electron/proxy.js exists post-build (C5 regression)", fs.existsSync(join(APP, "dist-electron", "proxy.js")));
  ok("S0 dist-electron/xray.js exists post-build (C4 regression)", fs.existsSync(join(APP, "dist-electron", "xray.js")));
}

/* ---------------- S1: structural + dist freshness ---------------- */
console.log("\n== S1 structural (taskC6-quickcheck) + dist freshness + compiled pins ==");
{
  const out = run("node", [join(HERE, "taskC6-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/taskC6-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskC6-quickcheck 51 PASS / 0 FAIL", !!m && m[1] === "51" && m[2] === "0", out.slice(-400));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  for (const needle of [
    "aether.updateTitle",                 // the C6 panel heading key
    "aether.updateTableTitle",            // the pin-table heading key
    "aether.updateRunningBlocked",        // the running-lock banner key
    "set.appUpdateTitle",                 // Settings Section 5 heading key
    "set.appUpdateSteps",                 // the honest steps text key
    "never checks by itself",             // en contract literal (Option A)
    "sha256-verified against that table", // en contract literal (Option B)
    "aether.prev.bak",                    // the rollback file name in the en texts
    "never replaces its own executable",  // en contract literal (no self-swap)
  ]) {
    ok(`S1 dist fresh: "${needle}" built in`, dist.includes(needle));
  }

  // C6 added TWO new main-process modules + the table + handlers. Pin each
  // COMPILED artifact for what IT owns (C2/C3/C5 lesson).
  const compiledUpd = fs.readFileSync(join(APP, "dist-electron", "aetherUpdate.js"), "utf8");
  ok("S1 compiled aetherUpdate.js (rebuilt): service + table loader + full gate chain shipped",
     compiledUpd.includes("createAetherUpdateService") &&
     compiledUpd.includes("loadAetherVersionTable") &&
     compiledUpd.includes("pinned-newer") && compiledUpd.includes("unpinned-newer") &&
     compiledUpd.includes("blocked-running") &&
     compiledUpd.includes("sha256File"));
  const compiledApp = fs.readFileSync(join(APP, "dist-electron", "appUpdate.js"), "utf8");
  ok("S1 compiled appUpdate.js (rebuilt): static facts only — releases URL + selfUpdate:false",
     compiledApp.includes("epodonios/memento/releases") && compiledApp.includes("selfUpdate: false"));
  ok("S1 compiled appUpdate.js: ZERO require() calls at compiled level (static-only by construction)",
     !/\brequire\(/.test(compiledApp));
  const compiledIpc = fs.readFileSync(join(APP, "dist-electron", "ipc.js"), "utf8");
  ok("S1 compiled ipc.js (rebuilt): all 4 C6 handlers + running gate + swap dir wired",
     compiledIpc.includes('ipcMain.handle("aether_update_status"') &&
     compiledIpc.includes('ipcMain.handle("aether_update_check"') &&
     compiledIpc.includes('ipcMain.handle("aether_update_apply"') &&
     compiledIpc.includes('ipcMain.handle("app_update_info"') &&
     compiledIpc.includes("hasLiveChild()") &&
     compiledIpc.includes('swapTargetDir: () => path.join((0, paths_1.resourceRoot)(), "aether")'));
  ok("S1 compiled ipc.js (rebuilt): C2/C3/C5 handlers intact (regression)",
     compiledIpc.includes('ipcMain.handle("url_test"') &&
     compiledIpc.includes('ipcMain.handle("geo_status"') &&
     compiledIpc.includes('ipcMain.handle("clear_system_proxy"'));
  const compiledAether = fs.readFileSync(join(APP, "dist-electron", "aether.js"), "utf8");
  ok("S1 compiled aether.js (rebuilt): spawn-integrity gate extended with the table hashes",
     compiledAether.includes("allowedAetherTableHashes") &&
     compiledAether.includes("aether-versions.json") &&
     compiledAether.includes("allowedAetherTableHashes(process.platform)"));
  const compiledPreload = fs.readFileSync(join(APP, "dist-electron", "preload.js"), "utf8");
  const allow = [...compiledPreload.matchAll(/"([a-z_0-9]+)",/g)].map(mm => mm[1]);
  ok("S1 compiled preload (rebuilt): allowlist is 27 commands (C6 added exactly 4)",
     allow.length === 27 && allow.includes("aether_update_status") &&
     allow.includes("aether_update_check") && allow.includes("aether_update_apply") &&
     allow.includes("app_update_info"),
     `got ${allow.length}`);
  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1 compiled main.js (rebuilt): C5 quit latch on BOTH paths + session-end hook intact (regression)",
     (compiledMain.match(/markQuitting/g) || []).length >= 2 &&
     compiledMain.includes('mainWindow.on("session-end"'));
  const compiledKs = fs.readFileSync(join(APP, "dist-electron", "killSwitch.js"), "utf8");
  ok("S1 compiled killSwitch.js (rebuilt): C5 choke points intact (regression)",
     compiledKs.includes("releaseSystemProxy") && compiledKs.includes("blockOnCoreExit") &&
     compiledKs.includes("resolveAuditAction"));
  const emittedTable = JSON.parse(fs.readFileSync(join(APP, "dist-electron", "aether-versions.json"), "utf8"));
  ok("S1 emitted table: authority header + 1.9.0 row with the byte-identical win32 binary pin",
     typeof emittedTable._header === "string" &&
     Array.isArray(emittedTable.versions) && emittedTable.versions.length === 1 &&
     emittedTable.versions[0].version === "1.9.0" &&
     emittedTable.versions[0].sha256.win32 === "ee400806bf73fe16e655e6478eb7442c2c4e0576c4c8ce1913ac474e846b36cd");
}

/* ---------------- S2: functional ---------------- */
console.log("\n== S2 functional (taskC6-fntest: real bundled table + semver + hash gates + race) ==");
{
  const out = run("node", [join(HERE, "taskC6-fntest.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/taskC6-fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskC6-fntest 37 PASS / 0 FAIL", !!m && m[1] === "37" && m[2] === "0", out.slice(-500));
}

/* ---------------- S3: config-level regression (real cores) ---------------- */
console.log("\n== S3 config-level (taskC4-cfgtest regression: real xray -test + sing-box check, C6 touched no generator) ==");
{
  const out = run("node", [join(HERE, "taskC4-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  const m = out.match(/C4-CFGTEST: (\d+) PASS \/ (\d+) FAIL/);
  ok("S3 taskC4-cfgtest 30 PASS / 0 FAIL", !!m && m[1] === "30" && m[2] === "0", out.slice(-600));
}

/* ---------------- S4: LIVE kill-switch regression + tracked-limitation canary ---------------- */
console.log("\n== S4 LIVE kill-switch regression (taskC5-live) + C4 uplink-gap canary (taskC4-uplink-probe) ==");
{
  const out = run("node", [join(HERE, "taskC5-live.mjs")], { cwd: HERE, timeout: 300000 });
  const m = out.match(/C5-LIVE: (\d+) PASS \/ (\d+) FAIL/);
  ok("S4 taskC5-live 12 PASS / 0 FAIL", !!m && m[1] === "12" && m[2] === "0", out.slice(-600));
  ok("S4 fail-closed anchor: armed crash (SIGKILL of the REAL core) -> BLOCKED, never direct",
     out.includes("PASS  LIVE xa-armed-crash"), out.slice(-300));
  ok("S4 quit-boundary anchor: quit latch outranks the armed state (CLEAR wins)",
     out.includes("PASS  LIVE xa-quit-latch"), out.slice(-300));
  ok("S4 foreign hands-off anchor: a foreign proxy is NEVER touched",
     out.includes("PASS  LIVE audit-foreign"), out.slice(-300));
  // The C4 TRACKED-LIMITATION canary (README C4 / checklist 25.1): the
  // pinned core's gap must still be EXACTLY as probed — if the core ever
  // changes, this gate fails and forces the re-check directive.
  const probe = run("node", [join(HERE, "taskC4-uplink-probe.mjs")], { cwd: HERE, timeout: 300000 });
  ok("S4 uplink probe ran to completion (X1/X2/X3 + UP-PROBE DONE)",
     probe.includes("X1-plain-vless") && probe.includes("X2-sockopt-nudge") &&
     probe.includes("X3-two-vless") && probe.includes("UP-PROBE DONE"), probe.slice(-400));
  ok("S4 tracked limitation still reproduces on the pinned v25.1.1 (vless uplink stays 0 under balancer)",
     /up=0/.test(probe), probe.slice(-400));
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
    // C5 suites are REGRESSION for C6 (C6 edited adjacent surfaces)
    ["taskC5-quickcheck", "C5-QUICKCHECK: 44 PASS / 0 FAIL"],
    ["taskC5-fntest", "C5-FNTEST: 34 PASS / 0 FAIL"],
    // C6 suites were already gated in S1/S2 — this battery completes 982
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

  // C4 battery — full, on the freshly built tree
  const outC4q = run("node", [join(HERE, "taskC4-quickcheck.mjs")], { cwd: HERE });
  ok("S5 taskC4-quickcheck (58 assertions)", /C4-QUICKCHECK: 58 PASS \/ 0 FAIL/.test(outC4q), outC4q.slice(-300));
  const outC4f = run("node", [join(HERE, "taskC4-fntest.mjs")], { cwd: HERE });
  ok("S5 taskC4-fntest (52 assertions)", /C4-FNTEST: 52 PASS \/ 0 FAIL/.test(outC4f), outC4f.slice(-300));
  const outC4c = run("node", [join(HERE, "taskC4-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  ok("S5 taskC4-cfgtest (30 assertions)", /C4-CFGTEST: 30 PASS \/ 0 FAIL/.test(outC4c), outC4c.slice(-300));
  const outC4l = run("node", [join(HERE, "taskC4-live.mjs")], { cwd: HERE, timeout: 300000 });
  ok("S5 taskC4-live (21 assertions)", /C4-LIVE: 21 PASS \/ 0 FAIL/.test(outC4l), outC4l.slice(-300));
}

console.log(`\nFORMAL SMOKE C6: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
