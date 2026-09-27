#!/usr/bin/env node
/**
 * Phase D4 FUNCTIONAL test — Quit-cleanup proof (user-mandated, pre-Smoke
 * review): "prove that after Quit from the Tray menu the system proxy AND
 * all three core processes are REALLY cleaned/killed — not just the window
 * hidden."
 *
 * Unlike taskD4-fntest (esbuild bundle of sources), this test loads the
 * REAL COMPILED dist-electron/*.js artifacts — exactly what ships — with
 * only two require.cache pre-seeds:
 *   - "electron"  -> a minimal recorder stub (so main.js/tray.js/etc. load
 *                    in plain node; BrowserWindow is an event-emitting fake
 *                    so main.js's createWindow() wiring really runs)
 *   - "./proxy"   -> a call RECORDER around the real proxy surface (the
 *                    real reg.exe writes are Windows-only — user-verified
 *                    on real hardware, same boundary as the D1 ses.fetch
 *                    precedent)
 *
 * The kill/cleanup chain itself is REAL: real spawned node stand-in
 * processes are attached to the REAL xrayManager / singBoxManager /
 * aetherManager singletons (same fields the start paths use), and the REAL
 * before-quit handler of the REAL compiled main.js runs the REAL
 * cleanupOnce -> cleanupAllCores -> 3x cleanupOnExit chain.
 *
 * Two phases (separate child processes — cleanupOnce is idempotent per
 * process, and the two paths must be proven independently):
 *
 *   Phase "quit" (the Tray Quit path):
 *     Q1  X-button close with close-to-tray ON + tray present -> window
 *         HIDDEN, one-shot balloon flag persisted, ZERO proxy calls, all
 *         core children STILL ALIVE  (the "not just hidden" contrast)
 *     Q2  app 'before-quit' (what tray Quit's app.quit() fires FIRST,
 *         before any window teardown) -> all 4 stand-in children DEAD,
 *         clearSystemProxy called exactly 2x (xray + sing-box
 *         cleanupOnExit), setSystemProxy never called, temp config file
 *         deleted, memento-active-core.json removed
 *     Q3  re-fire before-quit AND window session-end -> still 2 (cleanedUp
 *         idempotency — no double-kill / double-clear)
 *     Q4  window-all-closed -> app.quit() requested on the stub
 *     Q5  negative control: an UNATTACHED process survives cleanup (kills
 *         are scoped to the core managers, not the process tree)
 *
 *   Phase "session-end" (the Windows shutdown/logoff hardening added by
 *   the D4 review — before-quit is NOT guaranteed there):
 *     S1  window 'session-end' -> same full cleanup: children dead, proxy
 *         cleared 2x, files removed, balloon never fired
 *     S2  re-fire -> idempotent
 *
 *   Structural pins on the COMPILED artifacts (both phases):
 *     P1  tray.js: menu Quit item is literally app.quit()
 *     P2  main.js: before-quit sets `quitting = true` BEFORE cleanupOnce
 *         (the interception can never trap a real quit)
 *     P3  main.js: window-level session-end hook present; NO app-level
 *         'session-end' (removed from the Electron 44 typings) and the
 *         cancelable 'query-session-end' is never touched
 *     P4  dist-electron fresh (mtime >= the TS sources)
 *
 * Exit code 0 = all assertions passed in BOTH phases.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "electron-app", "dist-electron");
const reqSelf = createRequire(import.meta.url); // ESM-safe handle onto require.cache

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

/* ------------------------------------------------------------------ */
/*  child (phase) mode                                                 */
/* ------------------------------------------------------------------ */

async function runPhase(phase) {
  const WORK = process.env.TD4QC_WORK;
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  (globalThis).__STUB_USERDATA = WORK; // stub getPath("appData") -> WORK

  const userDataDir = join(WORK, "com.epodonios.memento"); // what main.js sets

  /* ---- electron stub (recorder) ---------------------------------- */
  const quitCalls = { n: 0 };
  const trayState = { constructed: false, balloonCalls: 0 };
  let appData = WORK;
  const fakeWindowInstances = [];

  class FakeBrowserWindow {
    constructor(_opts) {
      this.handlers = new Map();
      this.flags = { hidden: 0, shown: 0, minimized: 0 };
      this.webContents = { on() {}, send() {}, setWindowOpenHandler() {} };
      fakeWindowInstances.push(this);
    }
    on(ev, cb) { (this.handlers.get(ev) ?? this.handlers.set(ev, []).get(ev)).push(cb); return this; }
    once(ev, cb) { return this.on(ev, cb); }
    emit(ev, ...args) { for (const cb of this.handlers.get(ev) ?? []) cb(...args); return this; }
    loadFile() {} loadURL() {}
    hide() { this.flags.hidden++; } show() { this.flags.shown++; }
    minimize() { this.flags.minimized++; } restore() {} focus() {}
    isMinimized() { return false; } isVisible() { return this.flags.shown > 0; }
    isDestroyed() { return false; }
    static getAllWindows() { return fakeWindowInstances; }
  }

  class FakeTray {
    constructor() { trayState.constructed = true; }
    setToolTip() {}
    on() {}
    popUpContextMenu() {}
    displayBalloon() { trayState.balloonCalls++; }
    destroy() {}
  }

  const electronStub = {
    app: {
      isPackaged: false,
      _listeners: new Map(),
      on(ev, cb) { (this._listeners.get(ev) ?? this._listeners.set(ev, []).get(ev)).push(cb); return this; },
      once(ev, cb) { return this.on(ev, cb); },
      __emit(ev, ...args) { for (const cb of this._listeners.get(ev) ?? []) cb(...args); },
      listenerCount(ev) { return (this._listeners.get(ev) ?? []).length; },
      setPath(_n, p) { appData = p; },
      getPath(n) { return n === "userData" ? appData : WORK; },
      getAppPath: () => join(ROOT, "electron-app"), // dev-diagnostics block
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      quit: () => { quitCalls.n++; },
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: () => {},
    },
    BrowserWindow: FakeBrowserWindow,
    Tray: FakeTray,
    Menu: { buildFromTemplate: (tpl) => ({ template: tpl }) },
    globalShortcut: { register: () => true, unregister() {}, unregisterAll() {} },
    ipcMain: { handle() {}, on() {} },
    session: { fromPartition: () => ({ setProxy: async () => {}, fetch: async () => ({ text: async () => "" }) }) },
    shell: { openExternal: async () => {} },
  };

  /* ---- proxy recorder (replaces dist-electron/proxy.js) ---------- */
  const proxyCalls = { set: [], clear: 0 };
  const proxyRecorder = {
    isWindows: () => process.platform === "win32", // REAL semantics
    setSystemProxy: (port) => proxyCalls.set.push(port),
    clearSystemProxy: () => { proxyCalls.clear++; },
    readProxyState: () => ({ enabled: false, server: "" }),
  };

  /* ---- require.cache pre-seed, then load the REAL main.js -------- */
  const reqMain = createRequire(join(DIST, "main.js"));
  const electronKey = reqMain.resolve("electron");
  const proxyKey = reqMain.resolve("./proxy.js");
  const seed = (key, exportsObj) => {
    reqSelf.cache[key] = { id: key, filename: key, loaded: true, exports: exportsObj, children: [], paths: [] };
  };
  const exitListenersBefore = process.listenerCount("exit");
  seed(electronKey, electronStub);
  seed(proxyKey, proxyRecorder);
  reqMain(join(DIST, "main.js"));
  const mainCompiled = true; // requiring it at all is the smoke for P2/P3 loading

  // wait for whenReady() -> registerIpcHandlers + createTray + createWindow
  const t0 = Date.now();
  while (fakeWindowInstances.length === 0 && Date.now() - t0 < 2000) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const win = fakeWindowInstances[0];

  /* ---- structural pins on the COMPILED artifacts ----------------- */
  const mainSrc = fs.readFileSync(join(DIST, "main.js"), "utf8");
  const traySrc = fs.readFileSync(join(DIST, "tray.js"), "utf8");
  ok("P1 compiled tray Quit item = app.quit() (menu cannot hide instead of quit)",
     traySrc.includes("{ label: L.quit, click: () => electron_1.app.quit() }"));
  const bq = /on\("before-quit"[^]*?\n\}\);/.exec(mainSrc)?.[0] ?? "";
  const iQ = bq.indexOf("quitting = true;");
  const iC = bq.indexOf("cleanupOnce();");
  ok("P2 compiled before-quit: quitting=true FIRST, then cleanup (interception can never trap a quit)",
     iQ !== -1 && iC !== -1 && iQ < iC);
  ok("P3a compiled window-level session-end hook present",
     mainSrc.includes('mainWindow.on("session-end"'));
  ok("P3b no app-level session-end + cancelable query-session-end untouched (a user's shutdown is never blocked)",
     !mainSrc.includes('app.on("session-end"') && !mainSrc.includes('.on("query-session-end"'));
  ok("P3c compiled main.js registered a process 'exit' last-resort cleanup",
     process.listenerCount("exit") === exitListenersBefore + 1);
  const fresh = (compiled, source) => {
    try { return fs.statSync(compiled).mtimeMs >= fs.statSync(source).mtimeMs - 1000; }
    catch { return false; }
  };
  ok("P4 dist-electron fresh vs TS sources (main.ts/tray.ts)",
     fresh(join(DIST, "main.js"), join(ROOT, "electron-app", "electron", "main.ts")) &&
     fresh(join(DIST, "tray.js"), join(ROOT, "electron-app", "electron", "tray.ts")));

  /* ---- real stand-in children attached to the REAL managers ------ */
  const req = createRequire(join(DIST, "main.js"));
  const { xrayManager } = req("./xray.js");
  const { singBoxManager } = req("./singbox.js");
  const { aetherManager } = req("./aether.js");
  const standin = () => spawn(process.execPath, ["-e", "setInterval(()=>{},1000);"], { stdio: "ignore" });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const waitAllDead = async (pids, ms = 4000) => {
    const t = Date.now();
    while (Date.now() - t < ms && pids.some(alive)) await new Promise((r) => setTimeout(r, 80));
    return !pids.some(alive);
  };

  const cXray = standin();
  const cSing = standin();
  const cAeth = standin();
  const cAethPending = standin();
  const control = standin(); // negative control: NOT attached anywhere
  const corePids = [cXray.pid, cSing.pid, cAeth.pid, cAethPending.pid];

  xrayManager.child = cXray; // same fields the real start paths write
  const tmpCfg = join(WORK, "memento-active-config.json");
  fs.writeFileSync(tmpCfg, JSON.stringify({ standin: true }), "utf8");
  xrayManager.configPath = tmpCfg;
  singBoxManager.child = cSing;
  aetherManager.child = cAeth;
  aetherManager.pendingChild = cAethPending;
  fs.mkdirSync(userDataDir, { recursive: true });
  const metaFile = join(userDataDir, "memento-active-core.json");
  fs.writeFileSync(metaFile, JSON.stringify({ core: "xray", version: "25.1.1" }), "utf8");

  ok("T0 precondition: 4 core stand-ins + control all ALIVE before anything fires",
     [...corePids, control.pid].every(alive));

  /* ---- fire the phase event -------------------------------------- */
  if (phase === "quit") {
    // Q1: the X button with close-to-tray ON + tray present — HIDE, no cleanup
    win.emit("close", { preventDefault() {} });
    ok("Q1a close intercepted: window HIDDEN (not destroyed)", win.flags.hidden === 1);
    ok("Q1b close hides ONLY: zero proxy calls, cores still alive",
       proxyCalls.clear === 0 && proxyCalls.set.length === 0 && corePids.every(alive));
    let toastPersisted = false;
    try {
      toastPersisted = JSON.parse(fs.readFileSync(join(userDataDir, "memento-app-prefs.json"), "utf8")).closeTrayToastShown === true;
    } catch { /* file absent */ }
    ok("Q1c one-shot balloon flag persisted by main (renderer can never write it)", toastPersisted);
    ok("Q1d balloon itself is win32-only (honest on Linux: 0 displayBalloon calls)",
       trayState.balloonCalls === 0 && trayState.constructed);

    // Q2: Tray Quit -> app.quit() -> 'before-quit' fires FIRST (before any
    // window teardown). This is the exact event, the exact handler.
    electronStub.app.__emit("before-quit", { preventDefault() {} });
    const dead = await waitAllDead(corePids);
    ok("Q2a ALL THREE cores (xray + sing-box + aether child&pending) REALLY KILLED",
       dead, `still alive: ${corePids.filter(alive).join(",")}`);
    ok("Q2b system proxy CLEARED exactly 2x (xray + sing-box cleanupOnExit), never SET",
       proxyCalls.clear === 2 && proxyCalls.set.length === 0, `clear=${proxyCalls.clear} set=${proxyCalls.set.length}`);
    ok("Q2c active config file deleted (crash-signature lifecycle kept)", !fs.existsSync(tmpCfg));
    ok("Q2d memento-active-core.json removed", !fs.existsSync(metaFile));
    ok("Q2e negative control UNTOUCHED (kills scoped to the core managers)", alive(control.pid));

    // Q3: idempotency — a second before-quit and a stray session-end cannot
    // double-clear or resurrect anything
    electronStub.app.__emit("before-quit", { preventDefault() {} });
    win.emit("session-end", { reasons: ["shutdown"], preventDefault() {} });
    ok("Q3 cleanupOnce idempotent: still exactly 2 clears, no set", proxyCalls.clear === 2 && proxyCalls.set.length === 0);

    // Q4: the window then really closes -> window-all-closed -> app.quit()
    win.emit("closed");
    electronStub.app.__emit("window-all-closed");
    ok("Q4 window-all-closed requested app.quit() on the stub", quitCalls.n === 1);
  } else {
    // Phase session-end: Windows shutdown/logoff — before-quit NOT guaranteed.
    electronStub.app.__emit; // (no before-quit fired in this phase, ever)
    win.emit("session-end", { reasons: ["shutdown"], preventDefault() {} });
    const dead = await waitAllDead(corePids);
    ok("S1a session-end cleanup: ALL THREE cores REALLY KILLED", dead,
       `still alive: ${corePids.filter(alive).join(",")}`);
    ok("S1b session-end cleanup: proxy cleared exactly 2x, never set",
       proxyCalls.clear === 2 && proxyCalls.set.length === 0);
    ok("S1c active config + core-meta files removed",
       !fs.existsSync(tmpCfg) && !fs.existsSync(metaFile));
    ok("S1d no close happened -> no balloon, no hide", trayState.balloonCalls === 0 && win.flags.hidden === 0);
    ok("S1e negative control UNTOUCHED", alive(control.pid));
    win.emit("session-end", { reasons: ["shutdown"], preventDefault() {} });
    ok("S2 session-end cleanup idempotent (still exactly 2 clears)", proxyCalls.clear === 2);
  }

  control.kill("SIGKILL"); // teardown the negative control
  console.log(`PHASE-RESULT ${phase}: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ */
/*  parent mode: run both phases in fresh processes                    */
/* ------------------------------------------------------------------ */

if (!process.env.TD4QC_PHASE) {
  const WORKROOT = process.env.TD4QC_WORK || join(HERE, "taskD4-quitclean-tmp");
  let tp = 0, tf = 0;
  for (const phase of ["quit", "session-end"]) {
    console.log(`\n=== PHASE ${phase} (fresh process, fresh compiled modules) ===`);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TD4QC_PHASE: phase, TD4QC_WORK: join(WORKROOT, phase) },
      encoding: "utf8",
    });
    process.stdout.write(r.stdout ?? "");
    if (r.stderr?.trim()) process.stderr.write(r.stderr.split("\n").filter(l => !/Warning/.test(l)).join("\n"));
    const m = /PHASE-RESULT (\S+): (\d+) PASS \/ (\d+) FAIL/.exec(r.stdout ?? "");
    if (r.status === 0 && m) { tp += Number(m[2]); tf += Number(m[3]); }
    else { tf++; console.log(`  FAIL  phase ${phase} crashed (exit ${r.status})`); }
  }
  console.log(`\nD4 quit-cleanup fntest: ${tp} PASS / ${tf} FAIL (both phases)`);
  process.exit(tf === 0 ? 0 : 1);
} else {
  await runPhase(process.env.TD4QC_PHASE);
}
