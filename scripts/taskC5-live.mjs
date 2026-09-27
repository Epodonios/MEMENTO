#!/usr/bin/env node
/**
 * Phase C5 LIVE proof — Kill switch decisions with the REAL COMPILED
 * main-process modules, REAL core processes, and a proxy RECORDER seeded
 * into require.cache (the D4-quitclean technique: the real reg.exe writes
 * are Windows-only — user-verified on real hardware — so the sandbox
 * observes the DECISION the product makes, which is exactly the surface
 * C5 changes).
 *
 * Each phase runs in its OWN child process (fresh module state + prefs):
 *   xray-armed-crash     REAL pinned xray spawned via the REAL
 *                        startXray() (findXray resolved from the stubbed
 *                        userData), then SIGKILLed -> the REAL exit
 *                        handler -> blockOnCoreExit -> RECORDER.blocked
 *                        (armed), clear stays 0.
 *   xray-armed-stop      armed + manual stopXray() -> releaseSystemProxy
 *                        -> BLOCKED (manual disconnect blocks too).
 *   xray-disarmed-stop   disarmed + stopXray() -> plain CLEAR (pre-C5
 *                        behavior byte-identical).
 *   xray-disarmed-crash  disarmed + SIGKILL -> NO proxy calls at all
 *                        (legacy: the exit handler never touched it).
 *   xray-quit-latch      armed + markQuitting() (the REAL compiled latch)
 *                        + stopXray + cleanupOnExit -> CLEAR only (quit
 *                        always restores direct; exit handler silent).
 *   singbox-armed-crash  same crash proof on the REAL sing-box manager.
 *   audit-armed          the REAL main.js boots under the stub with a
 *                        leftover proxy pointing at OUR port -> the REAL
 *                        deferred F9 audit NORMALIZES to BLOCKED.
 *   audit-disarmed       same leftover, disarmed -> the audit CLEARS
 *                        (pre-C5 behavior).
 *   audit-foreign        a leftover pointing at a FOREIGN port -> the
 *                        audit touches NOTHING (hands-off preserved).
 *
 * Exit code 0 = every phase green + structural pins hold.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "electron-app", "dist-electron");
const WORK = join(HERE, "taskC5-live-tmp");
const XRAY_BIN = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SB_BIN = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

const allocFreePort = () => new Promise((res) => {
  const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

/* ---------------- child mode ---------------- */
if (process.argv[2]) { await runPhase(process.argv[2]); process.exit(0); }

/* ---------------- parent: structural pins + phase fan-out ---------------- */
{
  const fresh = (compiled, source) => {
    try { return fs.statSync(compiled).mtimeMs >= fs.statSync(source).mtimeMs - 1000; }
    catch { return false; }
  };
  ok("P dist-electron fresh vs TS sources (xray.ts / killSwitch.ts / singbox.ts / main.ts)",
     fresh(join(DIST, "xray.js"), join(ROOT, "electron-app", "electron", "xray.ts")) &&
     fresh(join(DIST, "killSwitch.js"), join(ROOT, "electron-app", "electron", "killSwitch.ts")) &&
     fresh(join(DIST, "singbox.js"), join(ROOT, "electron-app", "electron", "singbox.ts")) &&
     fresh(join(DIST, "main.js"), join(ROOT, "electron-app", "electron", "main.ts")));
}

const PHASES = [
  ["xa-armed-crash", 2], ["xa-armed-stop", 2], ["xa-disarmed-stop", 2],
  ["xa-disarmed-crash", 1], ["xa-quit-latch", 3], ["sb-armed-crash", 2],
  ["audit-armed", 2], ["audit-disarmed", 2], ["audit-foreign", 1],
];
// NOTE: phase names deliberately contain NO core-binary substring — the
// managers' real orphan sweeps run `pkill -f xray` and would kill THIS
// child if its own argv matched (an actual first-run lesson).
for (const [phase, minPass] of PHASES) {
  const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url), phase],
    { encoding: "utf8", timeout: 90000, env: process.env });
  const m = (out.stdout || "").match(/C5LIVE-PHASE (\S+) (\d+) (\d+)/);
  const good = !!m && m[1] === phase && Number(m[2]) >= minPass && Number(m[3]) === 0;
  ok(`LIVE ${phase} (${m ? `${m[2]} pass / ${m[3]} fail` : "no result"})`,
     good, (out.stdout || "").slice(-300) + (out.stderr || "").slice(-300));
}
ok("P pinned REAL xray binary used for the spawn proofs", fs.existsSync(XRAY_BIN));
ok("P pinned REAL sing-box binary used for the spawn proofs", fs.existsSync(SB_BIN));

console.log(`\nC5-LIVE: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

/* ================================================================== */
/*  phase executor (child)                                             */
/* ================================================================== */
async function runPhase(phase) {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const userData = join(WORK, "ud");
  fs.mkdirSync(userData, { recursive: true });
  (globalThis).__STUB_USERDATA = userData;

  const armed = !phase.includes("disarmed") && !phase.includes("foreign");
  fs.writeFileSync(join(userData, "memento-app-prefs.json"),
    JSON.stringify({ hotkeyShowHide: true, hotkeyConnect: true, killSwitch: armed }));

  let p = 0, f = 0;
  const check = (name, cond, detail = "") => {
    if (cond) { p++; console.log(`  PASS  ${name}`); }
    else { f++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
  };

  /* ---- electron stub (quitclean shape) + proxy recorder ---- */
  const proxyCalls = { set: [], clear: 0, blocked: 0 };
  const auditLeftover = phase.startsWith("audit")
    ? (phase === "audit-foreign" ? { enabled: true, server: "127.0.0.1:8888" }
                                 : { enabled: true, server: "127.0.0.1:10808" })
    : { enabled: false, server: "" };
  const proxyRecorder = {
    isWindows: () => true,               // recorder replaces the module wholesale
    setSystemProxy: (port) => proxyCalls.set.push(port),
    clearSystemProxy: () => { proxyCalls.clear++; },
    setBlockedSystemProxy: () => { proxyCalls.blocked++; },
    readProxyState: () => auditLeftover,
  };
  class FakeBrowserWindow {
    constructor(_o) { this.webContents = { on() {}, send() {}, setWindowOpenHandler() {} }; }
    on() {} once() {} hide() {} show() {} focus() {} restore() {}
    isMinimized() { return false; } isVisible() { return true; } isDestroyed() { return false; }
    loadFile() {} loadURL() {}
    static getAllWindows() { return []; }
  }
  class FakeTray { constructor() {} setToolTip() {} on() {} popUpContextMenu() {} displayBalloon() {} destroy() {} }
  const electronStub = {
    app: {
      isPackaged: false,
      _l: new Map(),
      on(ev, cb) { (this._l.get(ev) ?? this._l.set(ev, []).get(ev)).push(cb); return this; },
      once(ev, cb) { return this.on(ev, cb); },
      off() {}, emit() { return false; },
      __emit(ev, ...a) { for (const cb of this._l.get(ev) ?? []) cb(...a); },
      getPath: (n) => userData,
      setPath() {}, getAppPath: () => join(ROOT, "electron-app"),
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      isReady: true,
      quit() {}, getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings() {},
    },
    BrowserWindow: FakeBrowserWindow, Tray: FakeTray,
    Menu: { buildFromTemplate: (t) => ({ template: t }) },
    globalShortcut: { register: () => true, unregister() {}, unregisterAll() {} },
    ipcMain: { handle() {}, on() {} },
    session: { fromPartition: () => ({ setProxy: async () => {}, fetch: async () => ({ text: async () => "" }) }) },
    shell: { openExternal: async () => {} },
    nativeImage: { createFromPath: () => ({}), createEmpty: () => ({}) },
  };

  const req = createRequire(join(DIST, "xray.js"));
  const reqSelf = createRequire(import.meta.url); // ESM-safe handle onto require.cache
  const seed = (key, ex) => { reqSelf.cache[key] = { id: key, filename: key, loaded: true, exports: ex, children: [], paths: [] }; };
  seed(req.resolve("electron"), electronStub);
  seed(req.resolve("./proxy"), proxyRecorder);

  const waitRecorder = async (want, timeoutMs = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (want()) return true;
      await new Promise((r) => setTimeout(r, 60));
    }
    return want();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- audit phases: boot the REAL main.js, wait out the F9 audit ---- */
  if (phase.startsWith("audit")) {
    const reqMain = createRequire(join(DIST, "main.js"));
    seed(reqMain.resolve("electron"), electronStub);
    seed(reqMain.resolve("./proxy"), proxyRecorder);
    reqMain(join(DIST, "main.js"));
    await sleep(1800); // the audit is deferred 300ms past whenReady
    if (phase === "audit-armed") {
      check("audit-armed: the REAL F9 audit NORMALIZED our leftover to the BLOCKED state",
            proxyCalls.blocked >= 1, JSON.stringify(proxyCalls));
      check("audit-armed: nothing was cleared (the armed user wants blocked, not direct)",
            proxyCalls.clear === 0, JSON.stringify(proxyCalls));
    } else if (phase === "audit-disarmed") {
      check("audit-disarmed: the REAL audit CLEARS our leftover (pre-C5 behavior)",
            proxyCalls.clear >= 1, JSON.stringify(proxyCalls));
      check("audit-disarmed: no blocked writes", proxyCalls.blocked === 0, JSON.stringify(proxyCalls));
    } else {
      check("audit-foreign: a foreign proxy is NEVER touched (no calls at all)",
            proxyCalls.clear === 0 && proxyCalls.blocked === 0 && proxyCalls.set.length === 0,
            JSON.stringify(proxyCalls));
    }
    console.log(`C5LIVE-PHASE ${phase} ${p} ${f}`);
    return;
  }

  /* ---- manager phases: REAL spawn through the REAL compiled manager ---- */
  const core = phase.startsWith("sb") ? "singbox" : "xray";
  const mgrMod = req(core === "singbox" ? "./singbox.js" : "./xray.js");
  const manager = core === "singbox" ? mgrMod.singBoxManager : mgrMod.xrayManager;

  // Seed the REAL pinned binary where findXray()/findSingBox() look first.
  const binDir = core === "singbox" ? join(userData, "sing-box") : join(userData, "xray");
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(core === "singbox" ? SB_BIN : XRAY_BIN, join(binDir, core === "singbox" ? "sing-box" : "xray"));
  fs.chmodSync(join(binDir, core === "singbox" ? "sing-box" : "xray"), 0o755);

  const socksPort = await allocFreePort();
  const httpPort = await allocFreePort();
  const apiPort = await allocFreePort();
  const cfg = core === "singbox"
    ? { log: { level: "warn" },
        inbounds: [
          { type: "socks", tag: "socks-in", listen: "127.0.0.1", listen_port: socksPort },
          { type: "http", tag: "http-in", listen: "127.0.0.1", listen_port: httpPort },
        ],
        outbounds: [{ type: "direct", tag: "direct" }] }
    : { log: { loglevel: "warning" },
        inbounds: [
          { tag: "socks-in", port: socksPort, listen: "127.0.0.1", protocol: "socks", settings: { udp: false } },
          { tag: "http-in", port: httpPort, listen: "127.0.0.1", protocol: "http", settings: {} },
        ],
        outbounds: [{ protocol: "freedom", tag: "direct" }] };

  const status = await (core === "singbox"
        ? manager.startSingBox(JSON.stringify(cfg), socksPort, httpPort, apiPort)
        : manager.startXray(JSON.stringify(cfg), socksPort, httpPort, apiPort));
  check("REAL core (pinned binary) started through the REAL compiled manager",
        !!status && status.running === true && !!status.pid, JSON.stringify(status));

  if (phase === "xa-armed-crash" || phase === "xa-disarmed-crash" || phase === "sb-armed-crash") {
    try { process.kill(status.pid, "SIGKILL"); } catch {}
    const hit = await waitRecorder(() => proxyCalls.blocked > 0 || proxyCalls.clear > 0, 6000);
    await sleep(200);
    if (armed) {
      check("CRASH (SIGKILL) while ARMED -> exit handler BLOCKED the proxy (fail-closed, never direct)",
            hit && proxyCalls.blocked >= 1 && proxyCalls.clear === 0, JSON.stringify(proxyCalls));
      check("no plain clear accompanied the armed crash", proxyCalls.clear === 0, JSON.stringify(proxyCalls));
    } else {
      check("CRASH while DISARMED -> the exit handler touches NOTHING (legacy stale-port behavior)",
            proxyCalls.blocked === 0 && proxyCalls.clear === 0, JSON.stringify(proxyCalls));
    }
  } else if (phase === "xa-armed-stop") {
    manager.stopXray();
    const hit = await waitRecorder(() => proxyCalls.blocked > 0, 6000);
    check("MANUAL disconnect while ARMED -> releaseSystemProxy BLOCKED (never direct)",
          hit && proxyCalls.blocked >= 1 && proxyCalls.clear === 0, JSON.stringify(proxyCalls));
    check("armed manual stop produced no plain clear", proxyCalls.clear === 0, JSON.stringify(proxyCalls));
  } else if (phase === "xa-disarmed-stop") {
    manager.stopXray();
    const hit = await waitRecorder(() => proxyCalls.clear > 0, 6000);
    check("MANUAL disconnect while DISARMED -> plain CLEAR (pre-C5 byte-identical)",
          hit && proxyCalls.clear >= 1 && proxyCalls.blocked === 0, JSON.stringify(proxyCalls));
    check("disarmed manual stop produced no blocked writes", proxyCalls.blocked === 0, JSON.stringify(proxyCalls));
  } else if (phase === "xa-quit-latch") {
    const ks = req("./killSwitch.js"); // SAME module instance xray.js imported
    ks.markQuitting();
    manager.stopXray();
    manager.cleanupOnExit();
    const hit = await waitRecorder(() => proxyCalls.clear >= 2, 6000);
    check("QUIT latch + armed: stop + cleanupOnExit both take the PLAIN CLEAR branch (quit restores direct)",
          hit && proxyCalls.clear >= 2 && proxyCalls.blocked === 0, JSON.stringify(proxyCalls));
    check("quit latch silenced the dying child's exit-handler block", proxyCalls.blocked === 0, JSON.stringify(proxyCalls));
    check("isQuitting() reports the latch", ks.isQuitting() === true);
  }

  try { manager.cleanupOnExit?.(); } catch {}
  console.log(`C5LIVE-PHASE ${phase} ${p} ${f}`);
}
