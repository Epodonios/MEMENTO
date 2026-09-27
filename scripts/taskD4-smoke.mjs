#!/usr/bin/env node
/**
 * Phase D4 FORMAL SMOKE (user-approved 2026-09-17).
 * Batch D4 = item 8 dedicated Settings tab + item 3 Tray + Close-to-tray
 * (one-time balloon), PLUS the pre-Smoke review hardening: win32
 * session-end cleanup hook (before-quit is not guaranteed on Windows
 * shutdown/logoff).
 *
 * User-mandated scope:
 *   S0  real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *       + fresh builds of BOTH frontend (vite) and main (tsc) so every
 *       later gate tests what actually ships.
 *   S1  structural surface via taskD4-quickcheck.mjs (41 assertions)
 *       + dist freshness: D4 i18n keys + tray bridge in the built
 *       singlefile, session-end hook in the compiled main.js.
 *   S2  QUIT-CLEANUP PROOF (explicit user demand): taskD4-quitclean-fntest
 *       (31 assertions, 2 phases) on the REAL COMPILED dist-electron
 *       modules with REAL processes — Tray Quit (app.quit -> before-quit)
 *       REALLY kills all three cores and clears the system proxy while a
 *       plain close only HIDES the window; plus the session-end path.
 *   S3  prefs functional: taskD4-fntest.mjs (20 assertions) — real
 *       appPrefs.ts under the electron stub: defaults, legacy upgrade,
 *       sanitize gate (incl. prototype planting + privileged-flag drop),
 *       tray label model.
 *   S4  LIVE real-Xray orphan-cleanup E2E: spawn the REAL pinned xray,
 *       prove the COMPILED coreOps.killAllOrphanedCoresNow() (the layer
 *       every cleanupOnExit calls) actually kills the real binary and
 *       drops its port.
 *   S5  regression gates: task13-selftest/cfgtest + task12-quickcheck +
 *       taskD1/D2/D3 quickchecks + taskD2-cfgtest.
 *
 * Env overrides: XRAY_BIN, SB_BIN, TD4_WORK
 * Exit code 0 = all hard assertions passed.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");                       // memento-src
const APP = join(ROOT, "electron-app");              // electron-app
const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SINGBOX = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const WORK = process.env.TD4_WORK || "/home/z/my-project/scripts/taskD4-smoke-tmp";
const reqSelf = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`); }
};
const run = (cmd, args, opts = {}) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 120000, ...opts }); }
  catch (e) { return (e.stdout || "") + (e.stderr || ""); }
};

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

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
console.log("\n== S1 structural (taskD4-quickcheck) ==");
{
  const out = run("node", [join(HERE, "taskD4-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/D4 quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskD4-quickcheck 41 PASS / 0 FAIL", !!m && m[1] === "41" && m[2] === "0", out.slice(-400));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  for (const needle of ["tab.settings", "set.closeToTray", "set.closeToTrayHint", "set.sectionWindow", "tray_status_set"]) {
    ok(`S1 dist fresh: "${needle}" built in`, dist.includes(needle));
  }
  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1 compiled main.js: window-level session-end hook built in",
     compiledMain.includes('mainWindow.on("session-end"') && !compiledMain.includes('app.on("session-end"'));
  const compiledTray = fs.readFileSync(join(APP, "dist-electron", "tray.js"), "utf8");
  ok("S1 compiled tray.js: Quit item is app.quit()",
     compiledTray.includes("{ label: L.quit, click: () => electron_1.app.quit() }"));
}

/* ---------------- S2: QUIT-CLEANUP PROOF (user-mandated) ---------------- */
console.log("\n== S2 quit-cleanup proof (taskD4-quitclean-fntest, REAL compiled modules + REAL processes) ==");
{
  const out = run("node", [join(HERE, "taskD4-quitclean-fntest.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/D4 quit-cleanup fntest: (\d+) PASS \/ (\d+) FAIL \(both phases\)/);
  ok("S2 quit-clean fntest 31 PASS / 0 FAIL (both phases)", !!m && m[1] === "31" && m[2] === "0", out.slice(-600));
  ok("S2 phase quit: tray-Quit cleanup proven (cores killed + proxy cleared, close only hides)",
     /PHASE-RESULT quit: \d+ PASS \/ 0 FAIL/.test(out));
  ok("S2 phase session-end: shutdown-path cleanup proven",
     /PHASE-RESULT session-end: \d+ PASS \/ 0 FAIL/.test(out));
}

/* ---------------- S3: prefs functional ---------------- */
console.log("\n== S3 prefs functional (taskD4-fntest) ==");
{
  const out = run("node", [join(HERE, "taskD4-fntest.mjs")], { cwd: HERE });
  const m = out.match(/D4 fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S3 taskD4-fntest 20 PASS / 0 FAIL", !!m && m[1] === "20" && m[2] === "0", out.slice(-500));
}

/* ---------------- live helpers (S4) ---------------- */
const waitPort = (port, timeoutMs = 15000) => new Promise((resolve) => {
  const t0 = Date.now();
  const probe = () => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => {
      s.destroy();
      if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(probe, 250);
    });
  };
  probe();
});
const waitPortClosed = (port, timeoutMs = 10000) => new Promise((resolve) => {
  const t0 = Date.now();
  const probe = () => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(probe, 250); });
    s.once("error", () => { s.destroy(); resolve(true); });
  };
  probe();
});
const pgrepFinds = (name) => spawnSync("pgrep", ["-f", name], { encoding: "utf8" }).status === 0;
// pkill returns after SIGNALING, not after the victim exits — poll until gone.
const waitProcessGone = async (name, timeoutMs = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && pgrepFinds(name)) await new Promise((r) => setTimeout(r, 150));
  return !pgrepFinds(name);
};

/* ---------------- S4: LIVE real-Xray orphan-cleanup E2E ---------------- */
console.log("\n== S4 LIVE real-Xray killed by the COMPILED orphan-cleanup layer ==");
{
  // Minimal-but-real config: the same shape the app generates (socks+http in,
  // freedom out). `run -test` gates it with the pinned binary first.
  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks-in", listen: "127.0.0.1", port: 18081, protocol: "socks", settings: { udp: true } },
      { tag: "http-in", listen: "127.0.0.1", port: 18082, protocol: "http", settings: {} },
    ],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  };
  const cfgFile = join(WORK, "orphan-e2e.json");
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  const test = run(XRAY, ["run", "-test", "-c", cfgFile]);
  ok("S4 config passes real `xray run -test`", test.includes("Configuration OK"), test.slice(0, 140).replace(/\n/g, " "));

  const child = spawn(XRAY, ["run", "-c", cfgFile], { stdio: ["ignore", "ignore", "pipe"] });
  let xrayLog = "";
  child.stderr.on("data", (d) => { xrayLog += d; });
  try {
    ok("S4 real xray came up (socks port listening)", await waitPort(18081), xrayLog.slice(-160));
    ok("S4 pgrep sees the real xray process", pgrepFinds("xray"));

    // Load the COMPILED coreOps (what cleanupOnExit actually calls) with only
    // the electron module stubbed — killAllOrphanedCoresNow is REAL.
    const distDir = join(APP, "dist-electron");
    const reqCore = createRequire(join(distDir, "coreOps.js"));
    const electronKey = reqCore.resolve("electron");
    reqSelf.cache[electronKey] = {
      id: electronKey, filename: electronKey, loaded: true, children: [], paths: [],
      exports: { app: { isPackaged: false, getPath: () => WORK, getAppPath: () => APP } },
    };
    const { killAllOrphanedCoresNow } = reqCore(join(distDir, "coreOps.js"));
    killAllOrphanedCoresNow();

    ok("S4 real xray process REALLY killed by compiled cleanup (pgrep empty)", await waitProcessGone("xray"));
    ok("S4 socks port actually closed after the kill", await waitPortClosed(18081));
  } finally {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
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
  ];
  for (const [name, want] of suites) {
    const out = run("node", [join(HERE, `${name}.mjs`)], { cwd: HERE });
    ok(`S5 ${name} (${want})`, out.includes(want), out.slice(-300));
  }
  const out12 = run("node", [join(HERE, "task12-quickcheck.mjs")], { cwd: HERE });
  ok("S5 task12-quickcheck (7 assertions)", /QUICK-CHECK: 7 assertions passed/.test(out12), out12.slice(-300));
}

console.log(`\nFORMAL SMOKE D4: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
