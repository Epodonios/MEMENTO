#!/usr/bin/env node
/**
 * Phase C5 FORMAL SMOKE (user-approved 2026-09-18: the C5 kill-switch
 * implementation report — fail-closed system proxy — then smoke + zip).
 * Batch C5 = item ⑦ Kill switch: armed && tunnel down => proxy FORCED to
 * 127.0.0.1:9 (enabled-but-dead, fail closed); armed && up => live ports;
 * disarmed => byte-identical pre-C5. Quitting the app always restores
 * direct (quit latch BEFORE cleanup on BOTH quit paths). Foreign proxies
 * are strictly hands-off. No UAC/netsh/WFP anywhere (pinned negative).
 *
 * Gates:
 *   S0  real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *       + fresh builds of BOTH frontend (vite) and main (tsc) so every
 *       later gate tests what actually ships + the NEW compiled module
 *       dist-electron/killSwitch.js exists post-build.
 *   S1  structural surface via taskC5-quickcheck.mjs (44 assertions incl.
 *       the decision-order pins + quit-always-direct negatives) + dist
 *       freshness: the C5 i18n keys + the real-contract hint literals +
 *       the store mirror in the built singlefile; the COMPILED main
 *       process ships the three choke points (killSwitch.js), the blocked
 *       state (proxy.js KILL_SWITCH_BLOCKED_PORT = 9), the ipc prefs
 *       enforcement, the markQuitting latch on BOTH quit paths (main.js);
 *       the COMPILED preload allowlist stays 23 commands (C5 added NO new
 *       command — the pref rides app_prefs_get/set); the D4 session-end
 *       hook stays intact on the freshly rebuilt artifact.
 *   S2  functional: taskC5-fntest.mjs (34 assertions, TWO esbuild
 *       bundles: native-linux honest throws + prefs lifecycle + pure
 *       audit matrix; win32 fake-reg observable-state proofs incl. the
 *       quit latch OUTRANKING the armed state).
 *   S3  config-level regression through the REAL cores (taskC4-cfgtest,
 *       30 assertions): C5 touched no generator, so this proves the
 *       freshly built tree still produces core-valid configs (xray -test
 *       + sing-box check on every topology shape).
 *   S4  LIVE behavioral proof: taskC5-live.mjs (12 assertions, 9 child
 *       phases) — REAL pinned cores through the REAL compiled managers:
 *       armed crash (SIGKILL) -> BLOCKED; armed manual stop -> BLOCKED;
 *       disarmed stop/crash -> exact legacy; quit latch -> CLEAR wins;
 *       the REAL deferred F9 audit normalizes armed / clears disarmed /
 *       hands-off foreign. PLUS the C4 TRACKED-LIMITATION canary
 *       (taskC4-uplink-probe X1/X2/X3) stays green on the pinned core.
 *   S5  regression gates: task13-selftest/cfgtest + task12-quickcheck +
 *       taskD1/D2/D3/D4 quickchecks + taskD2-cfgtest + D4 fntest +
 *       quit-cleanup proof + the full C1 (36/22/29/5) + C2 (54/39/41/9)
 *       + C3 (56/44/20/11) + C4 (58/52/30/21) batteries.
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
  ok("S0 dist-electron/killSwitch.js exists post-build (C5 choke points)", fs.existsSync(join(APP, "dist-electron", "killSwitch.js")));
  ok("S0 dist-electron/proxy.js exists post-build (C5 blocked state)", fs.existsSync(join(APP, "dist-electron", "proxy.js")));
  ok("S0 dist-electron/xray.js exists post-build (C4 counting surface)", fs.existsSync(join(APP, "dist-electron", "xray.js")));
  ok("S0 dist-electron/geoFiles.js exists post-build (C3 regression)", fs.existsSync(join(APP, "dist-electron", "geoFiles.js")));
  ok("S0 dist-electron/urlTest.js exists post-build (C2 regression)", fs.existsSync(join(APP, "dist-electron", "urlTest.js")));
}

/* ---------------- S1: structural + dist freshness ---------------- */
console.log("\n== S1 structural (taskC5-quickcheck) + dist freshness ==");
{
  const out = run("node", [join(HERE, "taskC5-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/C5-QUICKCHECK: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskC5-quickcheck 44 PASS / 0 FAIL", !!m && m[1] === "44" && m[2] === "0", out.slice(-400));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  for (const needle of [
    "set.killSwitch", "set.killSwitchHint",           // the Settings toggle texts
    "connection.killSwitchBlocked", "connection.killSwitchBlockedHint", // the banner texts
    "127.0.0.1:9",                                   // the REAL dead address in the en hint
    "blocks immediately",                            // arm-while-disconnected contract
    "Quitting the app always restores direct",       // the documented quit boundary
    "killSwitchArmed",                               // the store mirror literal survives bundling
  ]) {
    ok(`S1 dist fresh: "${needle}" built in`, dist.includes(needle));
  }

  // C5 added a NEW main-process module and touched the choke points in the
  // managers + ipc + main. C2/C3 lesson applied: handlers compile into
  // their own modules — pin each COMPILED artifact for what IT owns.
  const compiledKs = fs.readFileSync(join(APP, "dist-electron", "killSwitch.js"), "utf8");
  ok("S1 compiled killSwitch.js (rebuilt): all three choke points + audit decision + pref enforcement shipped",
     compiledKs.includes("releaseSystemProxy") && compiledKs.includes("blockOnCoreExit") &&
     compiledKs.includes("resolveAuditAction") && compiledKs.includes("enforceKillSwitchAfterPrefChange") &&
     compiledKs.includes("markQuitting"));
  const compiledProxy = fs.readFileSync(join(APP, "dist-electron", "proxy.js"), "utf8");
  ok("S1 compiled proxy.js (rebuilt): blocked state is ProxyEnable=1 + 127.0.0.1:9 (NOT ProxyEnable=0)",
     compiledProxy.includes("KILL_SWITCH_BLOCKED_PORT = 9") &&
     compiledProxy.includes("setBlockedSystemProxy") &&
     compiledProxy.includes("127.0.0.1:${exports.KILL_SWITCH_BLOCKED_PORT}"));
  const compiledIpc = fs.readFileSync(join(APP, "dist-electron", "ipc.js"), "utf8");
  ok("S1 compiled ipc.js (rebuilt): clear_system_proxy -> releaseSystemProxy + prefs enforcement wired",
     compiledIpc.includes("releaseSystemProxy") && compiledIpc.includes("enforceKillSwitchAfterPrefChange"));
  ok("S1 compiled ipc.js (rebuilt): C2 url_test + C3 geo handlers intact (regression)",
     compiledIpc.includes('ipcMain.handle("url_test"') &&
     compiledIpc.includes('ipcMain.handle("geo_status"') &&
     compiledIpc.includes('ipcMain.handle("geo_ensure"'));
  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1 compiled main.js (rebuilt): markQuitting latch on BOTH quit paths + kill-switch-aware audit",
     (compiledMain.match(/markQuitting/g) || []).length >= 2 &&
     compiledMain.includes("resolveAuditAction") && compiledMain.includes("applyAuditAction"));
  ok("S1 compiled main.js (rebuilt): window-level session-end hook intact (D4 regression)",
     compiledMain.includes('mainWindow.on("session-end"') && !compiledMain.includes('app.on("session-end"'));
  const compiledXray = fs.readFileSync(join(APP, "dist-electron", "xray.js"), "utf8");
  ok("S1 compiled xray.js (rebuilt): C4 counting boundary + C5 exit-handler block shipped",
     compiledXray.includes("sanitizeTrafficTags") &&
     compiledXray.includes("blockOnCoreExit") && compiledXray.includes("releaseSystemProxy"));
  const compiledPreload = fs.readFileSync(join(APP, "dist-electron", "preload.js"), "utf8");
  const allow = [...compiledPreload.matchAll(/"([a-z_0-9]+)",/g)].map(mm => mm[1]);
  ok("S1 compiled preload (rebuilt): allowlist stays 23 commands (C5 added none — the pref rides app_prefs_set) — re-pointed 2026-09-18: C6 legitimately added 4 update commands (23->27)",
     allow.length === 27 && allow.includes("app_prefs_set") && allow.includes("app_prefs_get") && allow.includes("aether_update_check") && allow.includes("app_update_info"),
     `got ${allow.length}`);
}

/* ---------------- S2: functional ---------------- */
console.log("\n== S2 functional (taskC5-fntest: real prefs file + pure audit matrix + win32 fake-reg state proofs) ==");
{
  const out = run("node", [join(HERE, "taskC5-fntest.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/C5-FNTEST: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskC5-fntest 34 PASS / 0 FAIL", !!m && m[1] === "34" && m[2] === "0", out.slice(-500));
}

/* ---------------- S3: config-level regression (real cores) ---------------- */
console.log("\n== S3 config-level (taskC4-cfgtest regression: real xray -test + sing-box check, C5 touched no generator) ==");
{
  const out = run("node", [join(HERE, "taskC4-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  const m = out.match(/C4-CFGTEST: (\d+) PASS \/ (\d+) FAIL/);
  ok("S3 taskC4-cfgtest 30 PASS / 0 FAIL", !!m && m[1] === "30" && m[2] === "0", out.slice(-600));
}

/* ---------------- S4: LIVE kill-switch proof + tracked-limitation canary ---------------- */
console.log("\n== S4 LIVE kill-switch proof (taskC5-live) + C4 uplink-gap canary (taskC4-uplink-probe) ==");
{
  const out = run("node", [join(HERE, "taskC5-live.mjs")], { cwd: HERE, timeout: 300000 });
  const m = out.match(/C5-LIVE: (\d+) PASS \/ (\d+) FAIL/);
  ok("S4 taskC5-live 12 PASS / 0 FAIL", !!m && m[1] === "12" && m[2] === "0", out.slice(-600));
  ok("S4 fail-closed anchor: armed crash (SIGKILL of the REAL core) -> BLOCKED, never direct",
     out.includes("PASS  LIVE xa-armed-crash"), out.slice(-300));
  ok("S4 quit-boundary anchor: quit latch outranks the armed state (CLEAR wins)",
     out.includes("PASS  LIVE xa-quit-latch"), out.slice(-300));
  ok("S4 audit anchor: the REAL F9 audit normalizes an armed leftover to BLOCKED",
     out.includes("PASS  LIVE audit-armed"), out.slice(-300));
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

console.log(`\nFORMAL SMOKE C5: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
