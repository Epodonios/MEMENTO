#!/usr/bin/env node
/**
 * Phase B3 FUNCTIONAL test — the C5/F9 fusion with the TUN session,
 * driven against the REAL bundled modules (routingManager.ts +
 * routingHelper.ts + routingSession.ts + killSwitch.ts + appPrefs.ts).
 *
 * The bundle is compiled TWICE (the taskC5-fntest pattern):
 *   A) native linux, electron aliased to the proven stub — the manager
 *      (injected deps) staleness/transition/audit-surface proofs, the
 *      helper's fresh-armed fork + heartbeat against a REAL prefs file,
 *      the pure audit decision matrix, and the honest no-crash legs.
 *   B) --define:process.platform="win32" + a FAKE reg.exe on PATH —
 *      the OBSERVABLE blocked-write proofs: blockOnRoutingExit's truth
 *      table, applyRoutingAuditAction, and the replicated startup-audit
 *      guard order (disabled leg blocks; enabled leg stays hands-off;
 *      a fresh-live helper is never audited against).
 *
 * Exit code 0 = all assertions passed in BOTH bundles.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, "taskB3-fn-tmp");
const STUB = join(HERE, "taskC2-electron-stub.mts");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

const build = (outfile, extra = []) => {
  execFileSync("npx", ["esbuild", join(HERE, "taskB3-fnentry.ts"), "--bundle", "--platform=node",
    `--alias:electron=${STUB}`, "--format=cjs", `--outfile=${outfile}`, ...extra],
    { cwd: HERE, stdio: "pipe" });
};

/* ------------------------------------------------------------------ */
/*  Bundle A: native linux — the fused manager + helper + pure logic   */
/* ------------------------------------------------------------------ */
async function phaseA() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(join(WORK, "ud-a"), { recursive: true });
  (globalThis).__STUB_USERDATA = join(WORK, "ud-a");
  build(join(WORK, "b3a.cjs"));
  const M = (await import(`file://${join(WORK, "b3a.cjs")}`)).default ?? await import(`file://${join(WORK, "b3a.cjs")}`);
  const B3 = M;

  /* shared fixtures */
  const goodRequest = (sessionDir, overrides = {}) => ({
    sessionId: "s0001-1700000000000",
    createdAtMs: 1700000000000,
    guiPid: 424242,
    socksHost: "127.0.0.1",
    socksPort: 10808,
    killSwitchArmed: false,
    tunMtu: 1500,
    sessionDir,
    interfaceName: "MementoTun",
    previousSessionDir: null,
    ...overrides,
  });

  const makeFakeEngine = () => {
    const state = { killed: false, exitCode: null, exitWaiters: [], spawnCount: 0, killCount: 0 };
    const settle = () => { while (state.exitWaiters.length) state.exitWaiters.shift()(state.exitCode); };
    const fake = {
      state,
      child: {
        get pid() { return 777; },
        kill() {
          state.killCount++;
          if (state.exitCode === null) state.exitCode = 0;
          state.killed = true;
          settle();
          return true;
        },
        onExit() {
          if (state.exitCode !== null) return Promise.resolve(state.exitCode);
          return new Promise((res) => state.exitWaiters.push(res));
        },
      },
      spawnEngine(cmd, args) {
        state.spawnCount++;
        return fake.child;
      },
    };
    return fake;
  };

  const baseDeps = (userData, overrides = {}) => ({
    userDataDir: userData,
    resourceRootDir: join(HERE, "..", "electron-app", "resources"),
    platform: "linux",
    findEngine: () => "/opt/sing-box",
    probeSocks: async () => true,
    sleep: () => new Promise((r) => setImmediate(r)),
    now: () => 1700000000000,
    processAlive: () => true,
    processImageName: async () => "sing-box",
    log: () => {},
    ...overrides,
  });

  const waitFor = async (cond, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (cond()) return true;
      await new Promise((r) => setTimeout(r, 5));
    }
    return cond();
  };

  /* ---------------- T1: the status heartbeat (healthy session) -------- */
  console.log("\n== T1 B3 heartbeat: a healthy helper re-writes status.json at every probe tick ==");
  {
    const userData = join(WORK, "t1", "userData");
    const base = B3.sessionBaseDir(userData);
    const dir = join(base, "s0001-1700000000000");
    B3.prepareRoutingSession(goodRequest(dir), base);
    const fake = makeFakeEngine();
    let probeCount = 0;
    let t = 1700000000000;
    const snaps = {};
    const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
      spawnEngine: fake.spawnEngine,
      probeSocks: async () => {
        probeCount++;
        // Capture DURING the run: at probe N's call the last write is
        // probe N-1's heartbeat (deterministic, no polling races).
        if (probeCount === 4) snaps.at4 = B3.readSessionStatus(dir);
        if (probeCount === 6) snaps.at6 = B3.readSessionStatus(dir);
        return true;
      },
      now: () => (t += 10001),
    }));
    await waitFor(() => probeCount >= 6);
    ok("T1 still connected with NO state change across 6 probes",
       snaps.at6?.state === "connected" && fake.state.killCount === 0,
       JSON.stringify(snaps));
    ok("T1 updatedAtMs ADVANCED between probe 4 and probe 6 (the heartbeat, not a transition)",
       snaps.at4 != null && snaps.at6 != null && snaps.at6.updatedAtMs > snaps.at4.updatedAtMs,
       `${snaps.at4?.updatedAtMs} -> ${snaps.at6?.updatedAtMs}`);
    B3.writeControlStop(dir);
    const result = await runPromise;
    ok("T1 clean control stop afterwards (the heartbeat broke nothing)",
       result.code === 0 && result.finalState === "disabled");
  }

  /* ---------------- T2: the readiness heartbeat ------------------------ */
  console.log("\n== T2 the readiness loop keeps 'starting' fresh on refused upstreams ==");
  {
    const userData = join(WORK, "t2", "userData");
    const base = B3.sessionBaseDir(userData);
    const dir = join(base, "s0001-1700000000000");
    B3.prepareRoutingSession(goodRequest(dir), base);
    const fake = makeFakeEngine();
    let probeCount = 0;
    let t = 1700000000000;
    let probeSnap = null;
    const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
      spawnEngine: fake.spawnEngine,
      probeSocks: async () => { probeCount++; if (probeCount === 3) probeSnap = B3.readSessionStatus(dir); return false; },
      now: () => (t += 10001),
    }));
    await waitFor(() => probeCount >= 3);
    ok("T2 still 'starting' after 2 refused probes (no false error yet)",
       probeSnap?.state === "starting" && fake.state.killCount === 0,
       `captured at probe 3: ${JSON.stringify(probeSnap)}`);
    const runResult = await runPromise;
    ok("T2 the readiness deadline still ends in the honest error (unchanged B1 semantics)",
       runResult.code === 4 && runResult.finalState === "error" &&
       /never became reachable/.test(B3.readSessionStatus(dir)?.message ?? ""));
  }

  /* ---------------- T3: the flagship fresh-armed mid-session flip ------ */
  console.log("\n== T3 the D6 fork reads the FRESH prefs file: armed hold -> disarm -> fail-open teardown ==");
  {
    const userData = join(WORK, "t3", "userData");
    const base = B3.sessionBaseDir(userData);
    const dir = join(base, "s0001-1700000000000");
    B3.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: true }), base);
    // The REAL shared prefs file the helper's default reader consumes.
    fs.writeFileSync(join(userData, "memento-app-prefs.json"), JSON.stringify({ killSwitch: true }));
    const fake = makeFakeEngine();
    let t = 1700000000000;
    let up = true;
    // The deterministic pause: PARK the loop INSIDE the probe call — the
    // fork cannot run while the probe is suspended, so the hold is truly
    // frozen no matter what the clock does.
    let paused = false;
    let release = null;
    const parkProbe = () => new Promise((r) => { release = r; });
    const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
      spawnEngine: fake.spawnEngine,
      probeSocks: async () => {
        if (paused && release === null) await parkProbe();
        return up;
      },
      now: () => (t += 10001),
    }));
    await waitFor(() => B3.readSessionStatus(dir)?.state === "connected");
    up = false; // strikes accumulate: 3 -> the armed fork holds
    await waitFor(() => B3.readSessionStatus(dir)?.state === "reconnecting");
    paused = true; // the NEXT probe call parks — the hold is now frozen
    await waitFor(() => release !== null);
    ok("T3 armed + 3 strikes -> reconnecting (fail-closed hold)",
       B3.readSessionStatus(dir)?.state === "reconnecting" && fake.state.killCount === 0);
    // THE FLIP: the user disarms while the session is live (and parked).
    fs.writeFileSync(join(userData, "memento-app-prefs.json"), JSON.stringify({ killSwitch: false }));
    await new Promise((r) => setTimeout(r, 30));
    ok("T3 with the helper PARKED the hold is untouched (no spurious teardown)",
       B3.readSessionStatus(dir)?.state === "reconnecting",
       `parked read saw: ${JSON.stringify(B3.readSessionStatus(dir))}`);
    release?.(); // unpark: the probe returns false -> the fork re-reads the file
    const result = await runPromise;
    ok("T3 the disarm took effect at the NEXT fork decision -> fail-open teardown",
       result.code === 0 && result.finalState === "disabled");
    ok("T3 the engine was killed by the now-unarmed teardown",
       fake.state.killCount >= 1 && !fs.existsSync(B3.recoveryPathFor(base)));
  }

  /* ---------------- T4: the snapshot fallback matrix -------------------- */
  console.log("\n== T4 any read problem falls back to the request's start-time snapshot ==");
  {
    // (a) garbage prefs file + armed snapshot -> still holds.
    {
      const userData = join(WORK, "t4a", "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: true }), base);
      fs.writeFileSync(join(userData, "memento-app-prefs.json"), "{corrupted");
      const fake = makeFakeEngine();
      let t = 1700000000000;
      let advance = false;
      let up = true;
      const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
        spawnEngine: fake.spawnEngine,
        probeSocks: async () => up,
        now: () => (advance ? (t += 10001) : t),
      }));
      await waitFor(() => B3.readSessionStatus(dir)?.state === "connected");
      up = false;
      advance = true;
      await waitFor(() => B3.readSessionStatus(dir)?.state === "reconnecting");
      advance = false;
      ok("T4a garbage prefs file -> the ARMED SNAPSHOT governs (hold, no crash)",
         B3.readSessionStatus(dir)?.state === "reconnecting");
      B3.writeControlStop(dir);
      const result = await runPromise;
      ok("T4a clean control stop afterwards", result.code === 0 && result.finalState === "disabled");
    }
    // (b) non-boolean killSwitch + armed snapshot -> fallback to the snapshot.
    {
      const userData = join(WORK, "t4b", "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: true }), base);
      fs.writeFileSync(join(userData, "memento-app-prefs.json"), JSON.stringify({ killSwitch: "yes" }));
      const fake = makeFakeEngine();
      let t = 1700000000000;
      let advance = false;
      let up = true;
      const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
        spawnEngine: fake.spawnEngine,
        probeSocks: async () => up,
        now: () => (advance ? (t += 10001) : t),
      }));
      await waitFor(() => B3.readSessionStatus(dir)?.state === "connected");
      up = false;
      advance = true;
      await waitFor(() => B3.readSessionStatus(dir)?.state === "reconnecting");
      advance = false;
      ok("T4b a non-boolean killSwitch is ignored (=== true semantics) -> snapshot governs",
         B3.readSessionStatus(dir)?.state === "reconnecting");
      B3.writeControlStop(dir);
      await runPromise;
    }
    // (c) a THROWING injected reader -> fallback, never a hostage fork.
    {
      const userData = join(WORK, "t4c", "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: true }), base);
      const fake = makeFakeEngine();
      let t = 1700000000000;
      let advance = false;
      let up = true;
      const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
        spawnEngine: fake.spawnEngine,
        probeSocks: async () => up,
        now: () => (advance ? (t += 10001) : t),
        readKillSwitchArmed: () => { throw new Error("reader exploded"); },
      }));
      await waitFor(() => B3.readSessionStatus(dir)?.state === "connected");
      up = false;
      advance = true;
      await waitFor(() => B3.readSessionStatus(dir)?.state === "reconnecting");
      advance = false;
      ok("T4c a throwing injected reader falls back to the snapshot (hold survives)",
         B3.readSessionStatus(dir)?.state === "reconnecting");
      B3.writeControlStop(dir);
      await runPromise;
    }
  }

  /* ---------------- T5: fresh WINS over the snapshot, both directions --- */
  console.log("\n== T5 a static prefs file outranks the start-time snapshot in BOTH directions ==");
  {
    // (a) prefs ARMED + snapshot UNARMED -> the fresh read HOLDS.
    {
      const userData = join(WORK, "t5a", "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: false }), base);
      fs.writeFileSync(join(userData, "memento-app-prefs.json"), JSON.stringify({ killSwitch: true }));
      const fake = makeFakeEngine();
      let t = 1700000000000;
      let advance = false;
      let up = true;
      const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
        spawnEngine: fake.spawnEngine,
        probeSocks: async () => up,
        now: () => (advance ? (t += 10001) : t),
      }));
      await waitFor(() => B3.readSessionStatus(dir)?.state === "connected");
      up = false;
      advance = true;
      await waitFor(() => B3.readSessionStatus(dir)?.state === "reconnecting");
      advance = false;
      ok("T5a prefs(armed) beats the unarmed snapshot -> fail-closed hold",
         B3.readSessionStatus(dir)?.state === "reconnecting");
      B3.writeControlStop(dir);
      await runPromise;
    }
    // (b) prefs UNARMED + snapshot ARMED -> the fresh read TEARS DOWN.
    {
      const userData = join(WORK, "t5b", "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: true }), base);
      fs.writeFileSync(join(userData, "memento-app-prefs.json"), JSON.stringify({ killSwitch: false }));
      const fake = makeFakeEngine();
      let t = 1700000000000;
      let advance = false;
      let up = true;
      const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
        spawnEngine: fake.spawnEngine,
        probeSocks: async () => up,
        now: () => (advance ? (t += 10001) : t),
      }));
      await waitFor(() => B3.readSessionStatus(dir)?.state === "connected");
      up = false;
      advance = true;
      const result = await runPromise;
      ok("T5b prefs(disarmed) beats the armed snapshot -> fail-open teardown",
         result.code === 0 && result.finalState === "disabled" && fake.state.killCount >= 1);
    }
  }

  /* ---------------- T6: the manager staleness mapping ------------------- */
  console.log("\n== T6 a stale heartbeat maps the session to the honest error view ==");
  {
    const userData = join(WORK, "t6", "userData");
    const base = B3.sessionBaseDir(userData);
    const dir = join(base, "s0001-1700000000000");
    B3.prepareRoutingSession(goodRequest(dir), base);
    const NOW = 1700000000100;
    const { mgr } = mkManager(B3, userData, NOW);
    B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777, NOW - 10_000);
    let v = mgr.getRoutingStatus();
    ok("T6 a 10 s-old heartbeat is FRESH: connected + suppressed (D6 gates stay locked)",
       v.state === "connected" && v.suppressSystemProxy === true && v.active === true);
    B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777, NOW - 29_000);
    v = mgr.getRoutingStatus();
    ok("T6 the 29 s boundary is still fresh (below the 30 s staleness budget)",
       v.state === "connected" && v.suppressSystemProxy === true);
    B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777, NOW - 31_000);
    v = mgr.getRoutingStatus();
    ok("T6 a 31 s-old heartbeat is STALE: the honest error view + the repair guidance",
       v.state === "error" && /heartbeat lost/.test(v.message) && /network repair/.test(v.message));
    ok("T6 a stale session no longer suppresses the system proxy (D6 gates unlocked)",
       v.suppressSystemProxy === false);
    ok("T6 the recovery marker is still active (the residue is honestly visible)",
       v.active === true && v.sessionDir === dir);
    B3.writeSessionStatus(dir, "reconnecting", "kill switch is holding system traffic while the upstream recovers", 777, NOW - 40_000);
    v = mgr.getRoutingStatus();
    ok("T6 a held reconnecting state goes stale EXACTLY the same way",
       v.state === "error" && /heartbeat lost/.test(v.message));
  }

  /* ---------------- T7: the C5 transition fires EXACTLY ONCE ------------ */
  console.log("\n== T7 live -> terminal/stale fires onRoutingLiveLost exactly once ==");
  {
    // (a) the boot first-read NEVER fires (the F9 audit owns boot).
    {
      const userData = join(WORK, "t7a", "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.prepareRoutingSession(goodRequest(dir), base);
      B3.writeSessionStatus(dir, "disabled", "networking was restored", 0, 1700000000000);
      const { mgr, calls } = mkManager(B3, userData, 1700000000100);
      const v = mgr.getRoutingStatus();
      ok("T7a a terminal state on the FIRST read is not a transition (no fire)",
         v.state === "disabled" && calls.lost === 0);
    }
    // (b) live -> disabled fires once; further reads do not re-fire.
    {
      const userData = join(WORK, "t7b", "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.prepareRoutingSession(goodRequest(dir), base);
      let t = 1700000000000;
      const { mgr, calls } = mkManager(B3, userData, () => t);
      B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777, t);
      mgr.getRoutingStatus();
      ok("T7b live on the first read: no fire yet", calls.lost === 0);
      B3.writeSessionStatus(dir, "disabled", "networking was restored", 0, ++t * 1);
      mgr.getRoutingStatus();
      ok("T7b live -> disabled fires EXACTLY once", calls.lost === 1);
      mgr.getRoutingStatus();
      mgr.isSessionLive();
      mgr.isSystemProxySuppressed();
      ok("T7b three more reads do not re-fire (once per death, not per read)",
         calls.lost === 1);
    }
    // (c) live -> STALE (heartbeat lost) is a transition too.
    {
      const userData = join(WORK, "t7c", "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.prepareRoutingSession(goodRequest(dir), base);
      let t = 1700000000000;
      const { mgr, calls } = mkManager(B3, userData, () => t);
      B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777, t);
      mgr.getRoutingStatus();
      t += 31_000;
      const v = mgr.getRoutingStatus();
      ok("T7c a fresh session going stale fires the C5 transition once",
         v.state === "error" && calls.lost === 1);
    }
    // (d) a UAC-pending loss is NOT a C5 death (no adapter ever existed).
    {
      const launches = [];
      const userData = join(WORK, "t7d", "userData");
      let t = 1700000000000;
      const { mgr, calls } = mkManager(B3, userData, () => t, {
        launchElevated: (d) => { launches.push(d); return { launched: true }; },
      });
      mgr.startRouting(undefined);
      ok("T7d prelude: the pending launch counts as live (B2 guard parity)",
         mgr.isSessionLive() === true && calls.lost === 0);
      t += 121_000; // past the UAC heal deadline — the heal fires on the read
      const v = mgr.getRoutingStatus();
      ok("T7d the pending loss fired NOTHING (a UAC dialog owns no adapter)",
         v.state === "idle" && calls.lost === 0);
    }
  }

  /* ---------------- T8: stale lifts the gates, pending still guards ----- */
  console.log("\n== T8 staleness lifts the guards without unlocking the C5 contract ==");
  {
    const userData = join(WORK, "t8", "userData");
    const base = B3.sessionBaseDir(userData);
    const dir = join(base, "s0001-1700000000000");
    B3.prepareRoutingSession(goodRequest(dir), base);
    const NOW = 1700000000100;
    const { mgr } = mkManager(B3, userData, NOW);
    B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777, NOW - 31_000);
    ok("T8 stale: isSessionLive false (core-start guards lift)",
       mgr.isSessionLive() === false);
    ok("T8 stale: isSystemProxySuppressed false (D6 proxy gates lift)",
       mgr.isSystemProxySuppressed() === false);
    const rep = mgr.repairRouting();
    ok("T8 stale: the repair pass is launchable against the residue (one elevation)",
       rep.launched === true);
    // Pending parity (B2): a launch in flight still counts as live.
    const launches = [];
    const { mgr: m2 } = mkManager(B3, join(WORK, "t8b", "userData"), NOW, {
      launchElevated: (d) => { launches.push(d); return { launched: true }; },
    });
    m2.startRouting(undefined);
    ok("T8 launchPending still counts as live for the guards (B2 non-regression)",
       m2.isSessionLive() === true && m2.isSystemProxySuppressed() === false);
  }

  /* ---------------- T9: getLeftoverAuditState matrix -------------------- */
  console.log("\n== T9 the startup audit's input view (marker + fresh-live) ==");
  {
    const userData = join(WORK, "t9", "userData");
    const base = B3.sessionBaseDir(userData);
    const dir = join(base, "s0001-1700000000000");
    const NOW = 1700000000100;
    const { mgr } = mkManager(B3, userData, NOW);
    let a = mgr.getLeftoverAuditState();
    ok("T9a no residue at all -> { false, false } (the audit leaves everything)",
       a.markerActive === false && a.helperLiveFresh === false);
    B3.writeRecovery(base, dir, "s0001-1700000000000");
    B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777, NOW - 31_000);
    a = mgr.getLeftoverAuditState();
    ok("T9a marker + STALE live status -> { true, false } (the auditable crash residue)",
       a.markerActive === true && a.helperLiveFresh === false);
    B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777, NOW - 5_000);
    a = mgr.getLeftoverAuditState();
    ok("T9b marker + FRESH live status -> { true, true } (an orphan helper may still own the adapter)",
       a.markerActive === true && a.helperLiveFresh === true);
    B3.writeSessionStatus(dir, "error", "crashed mid-session", 555, NOW - 5_000);
    a = mgr.getLeftoverAuditState();
    ok("T9c marker + a fresh-but-TERMINAL status -> { true, false } (error is not live)",
       a.markerActive === true && a.helperLiveFresh === false);
    B3.clearRecovery(base);
    a = mgr.getLeftoverAuditState();
    ok("T9d no marker -> the manager is blind to the orphan dir (the marker IS the signal)",
       a.markerActive === false && a.helperLiveFresh === false);
  }

  /* ---------------- T10: B2 non-regression through the new code --------- */
  console.log("\n== T10 the B2 repair anti-spam + UAC heal still hold verbatim ==");
  {
    const launches = [];
    const userData = join(WORK, "t10", "userData");
    const base = B3.sessionBaseDir(userData);
    const dir = join(base, "s0001-1700000000000");
    B3.writeRecovery(base, dir, "s0001-1700000000000");
    let t = 1700000000000;
    const { mgr } = mkManager(B3, userData, () => t, {
      launchElevated: (d) => { launches.push(d); return { launched: true }; },
    });
    const r1 = mgr.repairRouting();
    ok("T10 the first repair against a residue launches",
       r1.launched === true && launches.length === 1);
    const r2 = mgr.repairRouting();
    ok("T10 the immediate re-repair is refused by the 120 s anti-spam window",
       r2.launched === false && /120 s ago/.test(r2.reason ?? "") && launches.length === 1);
    t += 121_000;
    const r3 = mgr.repairRouting();
    ok("T10 past the window it launches again (history never arms the gate)",
       r3.launched === true && launches.length === 2);
    // The UAC heal, driven by status reads ONLY (the main-side watchdog pattern).
    const { mgr: m2, calls } = mkManager(B3, join(WORK, "t10b", "userData"), () => t, {
      launchElevated: (d) => { launches.push(d); return { launched: true }; },
    });
    m2.startRouting(undefined);
    let v = m2.getRoutingStatus();
    ok("T10 the pending launch renders as 'starting (UAC)'",
       v.state === "starting" && /UAC/.test(v.message));
    t += 121_000;
    v = m2.getRoutingStatus();
    ok("T10 the unanswered elevation self-heals to idle via a pure status read (no renderer needed)",
       v.state === "idle" && v.active === false && calls.lost === 0);
  }

  /* ---------------- T11: the pure audit decision matrix ----------------- */
  console.log("\n== T11 resolveRoutingAuditAction: the pure 8-combo matrix ==");
  {
    ok("T11 armed + marker + stale -> block",
       B3.resolveRoutingAuditAction(true, true, false) === "block");
    ok("T11 armed + marker + FRESH helper -> leave (never audit a live session)",
       B3.resolveRoutingAuditAction(true, true, true) === "leave");
    ok("T11 armed + no marker -> leave (nothing to fail closed about)",
       B3.resolveRoutingAuditAction(true, false, false) === "leave");
    ok("T11 disarmed + marker + stale -> leave (no block for the unarmed)",
       B3.resolveRoutingAuditAction(false, true, false) === "leave");
    ok("T11 the full false matrix stays leave",
       B3.resolveRoutingAuditAction(false, false, false) === "leave" &&
       B3.resolveRoutingAuditAction(false, false, true) === "leave" &&
       B3.resolveRoutingAuditAction(false, true, true) === "leave" &&
       B3.resolveRoutingAuditAction(true, false, true) === "leave");
    ok("T11 the decision NEVER returns clear (the TUN audit only ever blocks)",
       ["block", "leave"].includes(B3.resolveRoutingAuditAction(true, true, false)));
  }

  /* ---------------- T12: honest no-crash legs on linux ------------------ */
  console.log("\n== T12 the best-effort wrappers never crash on the sandbox OS ==");
  {
    fs.writeFileSync(join(WORK, "ud-a", "memento-app-prefs.json"), JSON.stringify({ killSwitch: true }));
    ok("T12a blockOnRoutingExit (armed, linux) swallows the write throw — no crash",
       (() => { try { B3.blockOnRoutingExit(); return true; } catch { return false; } })());
    ok("T12b applyRoutingAuditAction(\"block\") swallows the throw — no crash",
       (() => { try { B3.applyRoutingAuditAction("block"); B3.applyRoutingAuditAction("leave"); return true; } catch { return false; } })());
    ok("T12c the quit latch starts UNSET in a fresh module",
       B3.isQuitting() === false);
  }

  /* ---------------- T13: D6 outcome semantics unchanged ----------------- */
  console.log("\n== T13 the D6 outcome strings and the teardown trail are byte-preserved ==");
  {
    const userData = join(WORK, "t13", "userData");
    const base = B3.sessionBaseDir(userData);
    const dir = join(base, "s0001-1700000000000");
    B3.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: true }), base);
    fs.writeFileSync(join(userData, "memento-app-prefs.json"), JSON.stringify({ killSwitch: true }));
    const fake = makeFakeEngine();
    let t = 1700000000000;
    let advance = false;
    let up = true;
    const runPromise = B3.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
      spawnEngine: fake.spawnEngine,
      probeSocks: async () => up,
      now: () => (advance ? (t += 10001) : t),
    }));
    await waitFor(() => B3.readSessionStatus(dir)?.state === "connected");
    up = false;
    advance = true;
    await waitFor(() => B3.readSessionStatus(dir)?.state === "reconnecting");
    advance = false;
    const held = B3.readSessionStatus(dir);
    ok("T13 the hold message is byte-identical to B1",
       held?.message === "kill switch is holding system traffic while the upstream recovers");
    up = true;
    advance = true;
    await waitFor(() => B3.readSessionStatus(dir)?.state === "connected");
    ok("T13 the recovery message is byte-identical to B1",
       B3.readSessionStatus(dir)?.message === "upstream recovered — system-wide routing resumed");
    B3.writeControlStop(dir);
    const result = await runPromise;
    ok("T13 the teardown trail is byte-identical (restoring -> disabled)",
       result.code === 0 && B3.readSessionStatus(dir)?.state === "disabled");
  }
}

/* ------- manager factory for bundle A (defined before use) -------- */
function mkManager(B3, userData, now, overrides = {}) {
  const calls = { lost: 0 };
  const launches = [];
  const mgr = B3.createRoutingManager({
    getUserDataDir: () => userData,
    getPlatform: () => "win32",
    getExePath: () => "/opt/memento/exe",
    getActiveSocks: () => ({ host: "127.0.0.1", port: 10808 }),
    isKillSwitchArmed: () => false,
    onRoutingLiveLost: () => { calls.lost++; },
    launchElevated: (d) => { launches.push(d); return { launched: true }; },
    ...(typeof now === "function" ? { now } : { now: () => now }),
    ...overrides,
  });
  return { mgr, calls, launches };
}

/* ------------------------------------------------------------------ */
/*  Bundle B: win32 define + FAKE reg.exe — observable blocked writes  */
/* ------------------------------------------------------------------ */
function phaseB() {
  fs.mkdirSync(join(WORK, "ud-b"), { recursive: true });
  (globalThis).__STUB_USERDATA = join(WORK, "ud-b");
  build(join(WORK, "b3b.cjs"), ['--define:process.platform="win32"']);

  // The FAKE reg.exe (the taskC5 technique): HKCU add/query state files
  // + the REAL reg-query output format, so readProxyState and every
  // blocked write behave like real Windows from the product's view.
  const fakebin = join(WORK, "fakebin");
  fs.mkdirSync(fakebin, { recursive: true });
  const en = join(WORK, "regstate.ProxyEnable");
  const sv = join(WORK, "regstate.ProxyServer");
  const failFlag = join(WORK, "regstate.FAIL");
  fs.writeFileSync(join(fakebin, "reg"), `#!/bin/sh
EN=${JSON.stringify(en)}
SV=${JSON.stringify(sv)}
FAIL=${JSON.stringify(failFlag)}
[ -f "$FAIL" ] && exit 1
if [ "$1" = "add" ]; then
  prev=""; name=""; val=""
  for a in "$@"; do
    if [ "$prev" = "/v" ]; then name="$a"; fi
    if [ "$prev" = "/d" ]; then val="$a"; fi
    prev="$a"
  done
  if [ "$name" = "ProxyEnable" ]; then printf '%s' "$val" > "$EN"; fi
  if [ "$name" = "ProxyServer" ]; then printf '%s' "$val" > "$SV"; fi
  exit 0
fi
if [ "$1" = "query" ]; then
  prev=""; name=""
  for a in "$@"; do
    if [ "$prev" = "/v" ]; then name="$a"; fi
    prev="$a"
  done
  if [ "$name" = "ProxyEnable" ]; then
    v=$(cat "$EN" 2>/dev/null)
    if [ "$v" = "1" ]; then echo "    ProxyEnable    REG_DWORD    0x1"
    else echo "    ProxyEnable    REG_DWORD    0x0"; fi
    exit 0
  fi
  if [ "$name" = "ProxyServer" ]; then
    [ -f "$SV" ] || exit 1
    v=$(cat "$SV")
    [ -n "$v" ] || exit 1
    echo "    ProxyServer    REG_SZ    $v"
    exit 0
  fi
fi
exit 1
`);
  fs.chmodSync(join(fakebin, "reg"), 0o755);
  process.env.PATH = fakebin + ":" + process.env.PATH;
  const state = () => ({
    enabled: fs.existsSync(en) && fs.readFileSync(en, "utf8").trim() === "1",
    server: fs.existsSync(sv) ? fs.readFileSync(sv, "utf8").trim() : "",
  });
  const resetReg = () => { try { fs.rmSync(en, { force: true }); } catch {} try { fs.rmSync(sv, { force: true }); } catch {} try { fs.rmSync(failFlag, { force: true }); } catch {} };

  const M = createRequire(join(WORK, "b3b.cjs"));
  const B3 = M(join(WORK, "b3b.cjs"));
  const flip = (armed) => B3.saveAppPrefs({ ...B3.loadAppPrefs(), killSwitch: armed });

  /* ---------------- T14: blockOnRoutingExit truth table ---------------- */
  console.log("\n== T14 blockOnRoutingExit: the C5 TUN twin with the observable blocked write ==");
  {
    // ORDER MATTERS: the quit latch leg must run LAST (markQuitting never
    // unlatches within one module instance).
    resetReg(); flip(false);
    B3.blockOnRoutingExit();
    ok("T14a DISARMED + not quitting -> NO write at all (byte-identical legacy)",
       state().enabled === false && state().server === "");

    resetReg(); flip(true);
    B3.blockOnRoutingExit();
    ok("T14b ARMED + not quitting -> the proxy is ENABLED at 127.0.0.1:9 (fail closed, NOT disabled)",
       state().enabled === true && state().server === "127.0.0.1:9", JSON.stringify(state()));
    ok("T14c the blocked state is observable through the REAL readProxyState query",
       B3.isKillSwitchArmed() === true &&
       (() => { const s = B3.loadAppPrefs(); return s.killSwitch === true; })());

    resetReg(); fs.writeFileSync(failFlag, "1");
    ok("T14d a failed BLOCK write is swallowed (best-effort, no crash)",
       (() => { try { B3.blockOnRoutingExit(); return true; } catch { return false; } })());
    fs.rmSync(failFlag, { force: true });

    resetReg(); flip(true); B3.markQuitting(); B3.blockOnRoutingExit();
    ok("T14e the QUIT LATCH outranks armed (quit always restores direct — no write)",
       state().enabled === false && state().server === "" && B3.isQuitting() === true);
  }

  /* ---------------- T15: applyRoutingAuditAction ------------------------ */
  console.log("\n== T15 applyRoutingAuditAction: only ever blocks, never clears ==");
  {
    resetReg();
    B3.applyRoutingAuditAction("leave");
    ok("T15a leave -> NO write", state().enabled === false && state().server === "");
    B3.applyRoutingAuditAction("block");
    ok("T15b block -> the enabled-but-dead 127.0.0.1:9 state lands",
       state().enabled === true && state().server === "127.0.0.1:9");
  }

  /* ---------------- T16: the startup audit guard order ------------------ */
  console.log("\n== T16 the replicated audit sequence: disabled blocks, enabled stays hands-off, fresh helper is never audited ==");
  {
    // NOTE: the isAnyCoreRunning guard lives in main.ts (the electron
    // entry is not bundleable here) — it is source-pinned by the
    // quickcheck. Everything below uses the REAL reads + decision +
    // applier in the REAL main.ts order.
    const auditSequence = (mgr, armed) => {
      // main.ts auditLeftoverRoutingSession, minus the win32/core guards:
      const { markerActive, helperLiveFresh } = mgr.getLeftoverAuditState();
      if (!markerActive || helperLiveFresh) return "leave";
      if (B3.readProxyState().enabled) return "leave"; // owned by the proxy audit
      const action = B3.resolveRoutingAuditAction(armed, markerActive, helperLiveFresh);
      if (action === "leave") return action;
      B3.applyRoutingAuditAction(action);
      return action;
    };
    const seedResidue = (name, fresh) => {
      const userData = join(WORK, name, "userData");
      const base = B3.sessionBaseDir(userData);
      const dir = join(base, "s0001-1700000000000");
      B3.writeRecovery(base, dir, "s0001-1700000000000");
      B3.writeSessionStatus(dir, "connected", "system-wide routing active", 777,
        fresh ? 1700000000100 : 1700000000000 - 31_000);
      const { mgr } = mkManager(B3, userData, 1700000000100);
      return { mgr, state: mgr.getLeftoverAuditState() };
    };

    // Scenario 1: armed + residue + DISABLED proxy leg -> the blocked write lands.
    resetReg(); flip(true);
    const s1 = seedResidue("t16a", false);
    ok("T16a prelude: the residue view is { marker, stale }",
       s1.state.markerActive === true && s1.state.helperLiveFresh === false);
    ok("T16a the audit BLOCKS the disabled proxy leg (fail closed at boot)",
       auditSequence(s1.mgr, true) === "block" &&
       state().enabled === true && state().server === "127.0.0.1:9", JSON.stringify(state()));

    // Scenario 2: armed + residue + an ENABLED (foreign) proxy leg -> hands off.
    resetReg();
    // Emulate a foreign enabled proxy (127.0.0.1:8888) via the fake reg:
    fs.writeFileSync(en, "1"); fs.writeFileSync(sv, "127.0.0.1:8888");
    const s2 = seedResidue("t16b", false);
    ok("T16b an ENABLED proxy leg is left to the proxy audit (no second write, foreign value intact)",
       auditSequence(s2.mgr, true) === "leave" && state().server === "127.0.0.1:8888");

    // Scenario 3: armed + residue + a FRESH-live helper -> never audited.
    resetReg(); flip(true);
    const s3 = seedResidue("t16c", true);
    ok("T16c a fresh-live helper (an orphan may own a live adapter) is NEVER audited against",
       auditSequence(s3.mgr, true) === "leave" && state().enabled === false);

    // Scenario 4: DISARMED + residue + disabled leg -> nothing happens.
    resetReg(); flip(false);
    const s4 = seedResidue("t16d", false);
    ok("T16d the disarmed user gets NO boot-time block",
       auditSequence(s4.mgr, false) === "leave" && state().enabled === false);
  }
}

/* ---------------- run both bundles ---------------- */
await phaseA();
phaseB();
console.log(`\ntaskB3-fntest: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
