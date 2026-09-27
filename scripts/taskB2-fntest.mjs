#!/usr/bin/env node
/**
 * Phase B2 FUNCTIONAL test — the REAL routingManager.ts bundled by esbuild
 * (electron-free factory; every effect injected). Against temp dirs —
 * real network and real elevation are NEVER touched:
 *
 *   T1  happy start: request file (all D5/D7 fields, guiPid, armed flag),
 *       recovery marker, launcher argv (--routing-helper + requestPath),
 *       pending view = "starting" + suppression + fresh armed mirror
 *   T2  D7 passthrough: tunMtu clamped main-side (99999 -> 9000, junk -> 1500)
 *   T3  non-win32 refusal: throw + NO session files written
 *   T4  no active core: throw + no recovery marker
 *   T5  already-live refusals: (a) recovery + status "connected" on a
 *       fresh manager, (b) double start on the same manager (UAC pending)
 *   T6  UAC-denied self-heal: no helper evidence -> "starting" holds,
 *       past the 120 s deadline heals to "idle" + recovery cleared, and
 *       a new start is possible again (heal does NOT fire early)
 *   T7  helper took over: status "starting"/"connected" clears the pending
 *       state; suppression true for starting/connected/reconnecting only
 *   T8  stop: live session -> control.json {action:"stop"} + stopped:true;
 *       fresh manager -> honest stopped:false
 *   T9  stop on a terminal status (disabled) -> stopped:false, not live
 *   T10 repair: known dir -> launcher --repair-network + dir; nothing
 *       known -> { launched:false } and the launcher is NEVER called
 *       (no UAC for show); recovery-only -> arg = the recovery dir
 *   T11 requestStopBestEffort: live -> control written; idle -> no file,
 *       never throws (including on a tree that does not exist)
 *   T12 previousSessionDir: a stale recovery marker is handed to the
 *       helper via the request (B1 stale cleanup chains through B2)
 *   T13 launcher failure: {launched:false, reason} -> honest throw AND
 *       the recovery marker is cleared (no stranded "active" view)
 *   T14 leftover recovery with NO status file -> honest "error" view
 *       naming the repair path (the crashed-GUI case)
 *   T15 isSessionLive: false fresh, true pending, true connected,
 *       false after terminal status
 *   T16 repair anti-UAC-spam: the first repair launches (the stale
 *       start-pending heals away); an immediate re-click is REFUSED
 *       with the honest anti-spam reason and makes NO launcher call;
 *       still refused at +119 s; launches again past the 120 s window
 *   T17 repair vs a pending TUN start elevation: refused while the
 *       start's UAC may be unanswered (one unanswered elevation at a
 *       time), launcher untouched
 *
 * Exit code 0 = all assertions passed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, "taskB2-fn-tmp");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

/* ---------------- build the bundle once ---------------- */
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const OUT = join(WORK, "b2.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskB2-fnentry.ts"), "--bundle", "--platform=node",
  "--format=cjs", `--outfile=${OUT}`],
  { cwd: HERE, stdio: "pipe" });
const M = (await import(`file://${OUT}`)).default ?? await import(`file://${OUT}`);
const B2 = M;

/* ---------------- fixture helpers ---------------- */
/** A manager over an isolated temp userData with captured launches.
 *  overrides.userData rebinds the tree (a "second GUI lifetime" over the
 *  SAME session files but FRESH in-memory bookkeeping); every other
 *  override replaces a dep outright. */
function makeManager(overrides = {}) {
  const userData = overrides.userData ?? join(WORK, `ud-${Math.random().toString(36).slice(2, 8)}`);
  const { userData: _rebind, ...depOverrides } = overrides;
  const captured = [];
  let clock = 1_700_000_000_000;
  const deps = {
    getUserDataDir: () => userData,
    getPlatform: () => "win32",
    getExePath: () => "C:\\Program Files\\MEMENTO\\MEMENTO.exe",
    getActiveSocks: () => ({ host: "127.0.0.1", port: 10808 }),
    isKillSwitchArmed: () => false,
    launchElevated: (args) => { captured.push(args); return { launched: true }; },
    now: () => clock,
    ...depOverrides,
  };
  return {
    mgr: B2.createRoutingManager(deps),
    deps,
    captured,
    userData,
    base: B2.sessionBaseDir(userData),
    tick: (ms) => { clock += ms; },
  };
}

const readReq = (sessionDir) => B2.readJsonFile(join(sessionDir, B2.REQUEST_FILE_NAME));

/* ---------------- T1: happy start ---------------- */
console.log("\n== T1 happy start: request + recovery + launch + pending view ==");
{
  const f = makeManager({ isKillSwitchArmed: () => true });
  let res;
  try { res = f.mgr.startRouting(undefined); } catch (e) { ok("T1 startRouting throws", false, String(e)); }
  ok("T1 returns a sessionId + sessionDir", !!res && typeof res.sessionId === "string" && res.sessionId.length > 0 && typeof res.sessionDir === "string");
  ok("T1 sessionDir is <base>/<sessionId>", res && f.base && dirname(res.sessionDir) === f.base);
  const req = res ? readReq(res.sessionDir) : null;
  ok("T1 request file written at <sessionDir>/routing-request.json", !!req);
  ok("T1 request carries the D5 fixed interface name", req?.interfaceName === "MementoTun");
  ok("T1 request carries the GUI pid", req?.guiPid === process.pid);
  ok("T1 request carries the active core's SOCKS inbound", req?.socksHost === "127.0.0.1" && req?.socksPort === 10808);
  ok("T1 request carries the FRESH armed flag (true)", req?.killSwitchArmed === true);
  ok("T1 D7 default MTU (unset folds to 1500)", req?.tunMtu === 1500);
  ok("T1 previousSessionDir null on a clean tree", req?.previousSessionDir === null);
  const rec = B2.readRecovery(f.base);
  ok("T1 recovery marker written + active + points at the session", !!rec && rec.active === true && rec.sessionDir === res?.sessionDir);
  ok("T1 launcher got exactly one call", f.captured.length === 1);
  ok("T1 launcher argv: <exe> --routing-helper <requestPath>",
     f.captured[0]?.flag === "--routing-helper" &&
     f.captured[0]?.exePath === "C:\\Program Files\\MEMENTO\\MEMENTO.exe" &&
     f.captured[0]?.arg === join(res?.sessionDir ?? "", B2.REQUEST_FILE_NAME));
  ok("T1 launcher platform forwarded (win32)", f.captured[0]?.platform === "win32");
  const view = f.mgr.getRoutingStatus();
  ok("T1 pending view: state starting", view.state === "starting");
  ok("T1 pending view: active true, D5 names echoed, armed mirrored",
     view.active === true && view.interfaceName === "MementoTun" && view.helperRole === "MementoTunHelper" && view.killSwitchArmed === true);
  ok("T1 pending view: message names the UAC wait", /UAC|elevated/i.test(view.message));
  ok("T1 pending view: D6 suppression FALSE (no adapter exists until the helper reports)", view.suppressSystemProxy === false);
  ok("T1 isSessionLive true while pending", f.mgr.isSessionLive() === true);
  ok("T1 suppression FALSE while pending (no adapter exists yet — only the helper's live states suppress)",
     f.mgr.isSystemProxySuppressed() === false);
}

/* ---------------- T2: D7 passthrough ---------------- */
console.log("\n== T2 D7 clamp passthrough ==");
{
  const fA = makeManager();
  const rA = fA.mgr.startRouting(99999);
  ok("T2 99999 clamps to 9000 in the request", readReq(rA.sessionDir)?.tunMtu === 9000);
  const fB = makeManager();
  const rB = fB.mgr.startRouting("not-a-number");
  ok("T2 junk folds to the default 1500", readReq(rB.sessionDir)?.tunMtu === 1500);
  const fC = makeManager();
  const rC = fC.mgr.startRouting(1420);
  ok("T2 in-range value passes through", readReq(rC.sessionDir)?.tunMtu === 1420);
}

/* ---------------- T3: non-win32 refusal ---------------- */
console.log("\n== T3 non-win32 refusal ==");
{
  const f = makeManager({ getPlatform: () => "linux" });
  let threw = null;
  try { f.mgr.startRouting(undefined); } catch (e) { threw = String(e?.message || e); }
  ok("T3 throws with the honest win32-only reason", !!threw && /only implemented on Windows/i.test(threw));
  ok("T3 no session base was even created", !fs.existsSync(f.base));
  ok("T3 no launcher call", f.captured.length === 0);
}

/* ---------------- T4: no active core ---------------- */
console.log("\n== T4 no active core refusal ==");
{
  const f = makeManager({ getActiveSocks: () => null });
  let threw = null;
  try { f.mgr.startRouting(undefined); } catch (e) { threw = String(e?.message || e); }
  ok("T4 throws naming the missing upstream", !!threw && /No active core/i.test(threw));
  ok("T4 no recovery marker stranded", B2.readRecovery(f.base) === null);
  ok("T4 no launcher call", f.captured.length === 0);
}

/* ---------------- T5: already-live refusals ---------------- */
console.log("\n== T5 already-live refusals ==");
{
  // (a) a fresh manager over a live leftover (recovery + status connected)
  const f = makeManager();
  const started = f.mgr.startRouting(undefined);
  B2.writeSessionStatus(started.sessionDir, "connected", "leftover live session", 1234, f.deps.now());
  const f2 = makeManager({ userData: f.userData });
  let threw = null;
  try { f2.mgr.startRouting(undefined); } catch (e) { threw = String(e?.message || e); }
  ok("T5a recovery+connected on a fresh manager refuses", !!threw && /already active/i.test(threw));
  ok("T5a no extra launcher call", f2.captured.length === 0);
  // (b) double start on the SAME manager (UAC pending counts as live)
  const g = makeManager();
  g.mgr.startRouting(undefined);
  let threw2 = null;
  try { g.mgr.startRouting(undefined); } catch (e) { threw2 = String(e?.message || e); }
  ok("T5b double start refuses while UAC is pending", !!threw2 && /already active/i.test(threw2));
  ok("T5b still exactly one launch", g.captured.length === 1);
}

/* ---------------- T6: UAC-denied self-heal ---------------- */
console.log("\n== T6 UAC-denied self-heal (120 s deadline) ==");
{
  const f = makeManager();
  f.mgr.startRouting(undefined);
  f.tick(10_000);
  let v = f.mgr.getRoutingStatus();
  ok("T6 pending holds BEFORE the deadline", v.state === "starting" && v.active === true);
  f.tick(111_000); // total 121 s since the launch
  v = f.mgr.getRoutingStatus();
  ok("T6 past the 120 s deadline heals to idle", v.state === "idle" && v.active === false);
  ok("T6 healing cleared the stranded recovery marker", B2.readRecovery(f.base) === null);
  ok("T6 a new start is possible after the heal", (() => {
    try { f.mgr.startRouting(undefined); return f.captured.length === 2; } catch { return false; }
  })());
}

/* ---------------- T7: helper took over ---------------- */
console.log("\n== T7 helper takeover clears pending; suppression map ==");
{
  const f = makeManager();
  const started = f.mgr.startRouting(undefined);
  B2.writeSessionStatus(started.sessionDir, "starting", "routing engine spawned", 555, f.deps.now());
  let v = f.mgr.getRoutingStatus();
  ok("T7 helper status wins over pending", v.state === "starting" && v.enginePid === 555 && v.updatedAtMs === f.deps.now());
  ok("T7 helper-reported starting DOES suppress (the adapter is coming up)", v.suppressSystemProxy === true);
  B2.writeSessionStatus(started.sessionDir, "connected", "system-wide routing active", 555, f.deps.now());
  v = f.mgr.getRoutingStatus();
  ok("T7 connected: suppression true", v.state === "connected" && v.suppressSystemProxy === true);
  B2.writeSessionStatus(started.sessionDir, "reconnecting", "kill switch holding", 555, f.deps.now());
  v = f.mgr.getRoutingStatus();
  ok("T7 reconnecting: suppression true (D6 fail-closed hold)", v.state === "reconnecting" && v.suppressSystemProxy === true);
  B2.writeSessionStatus(started.sessionDir, "restoring", "closing the adapter", 555, f.deps.now());
  v = f.mgr.getRoutingStatus();
  ok("T7 restoring: suppression released (fail-open teardown underway)", v.state === "restoring" && v.suppressSystemProxy === false);
  B2.writeSessionStatus(started.sessionDir, "disabled", "networking was restored", 0, f.deps.now());
  v = f.mgr.getRoutingStatus();
  ok("T7 disabled: terminal + no suppression", v.state === "disabled" && v.suppressSystemProxy === false);
}

/* ---------------- T8: stop flow ---------------- */
console.log("\n== T8 stop: control.json written only for a live session ==");
{
  const f = makeManager();
  let r = f.mgr.stopRouting();
  ok("T8 fresh manager: honest stopped:false", r.stopped === false && /no VPN Device session/i.test(r.reason ?? ""));
  const started = f.mgr.startRouting(undefined);
  B2.writeSessionStatus(started.sessionDir, "connected", "system-wide routing active", 555, f.deps.now());
  r = f.mgr.stopRouting();
  ok("T8 live session: stopped:true with the state echoed", r.stopped === true && r.state === "connected");
  const control = B2.readJsonFile(join(started.sessionDir, B2.CONTROL_FILE_NAME));
  ok("T8 control.json = { action: \"stop\" }", !!control && control.action === "stop");
  ok("T8 the GUI never touches the engine itself (no status rewrite by the stopper)",
     B2.readSessionStatus(started.sessionDir)?.state === "connected");
}

/* ---------------- T9: stop on terminal status ---------------- */
console.log("\n== T9 stop on a terminal (disabled) status ==");
{
  const f = makeManager();
  const started = f.mgr.startRouting(undefined);
  B2.writeSessionStatus(started.sessionDir, "disabled", "networking was restored", 0, f.deps.now());
  const r = f.mgr.stopRouting();
  ok("T9 disabled session: stopped:false + reason", r.stopped === false && r.state === "disabled" && /not live/i.test(r.reason ?? ""));
}

/* ---------------- T10: repair ---------------- */
console.log("\n== T10 repair: launcher, honest nothing, recovery arg ==");
{
  const f = makeManager();
  let r = f.mgr.repairRouting();
  ok("T10 nothing known: launched:false WITHOUT any UAC call", r.launched === false && f.captured.length === 0 && /no VPN Device state/i.test(r.reason ?? ""));
  const started = f.mgr.startRouting(undefined);
  B2.writeSessionStatus(started.sessionDir, "connected", "stale adapter", 555, f.deps.now());
  r = f.mgr.repairRouting();
  ok("T10 known dir: launched:true, --repair-network + the dir", r.launched === true && f.captured.length === 2 &&
     f.captured[1].flag === "--repair-network" && f.captured[1].arg === started.sessionDir);
  // recovery-only (GUI restarted, memory empty): the marker names the dir
  const g = makeManager();
  const started2 = g.mgr.startRouting(undefined);
  const marker = B2.readRecovery(g.base);
  const g2 = makeManager({ userData: g.userData });
  const r2 = g2.mgr.repairRouting();
  ok("T10 recovery-only: arg = the recovery dir",
     r2.launched === true && g2.captured.length === 1 && g2.captured[0].arg === marker?.sessionDir && marker?.sessionDir === started2.sessionDir);
}

/* ---------------- T11: requestStopBestEffort ---------------- */
console.log("\n== T11 requestStopBestEffort: sync, guarded, never throws ==");
{
  const f = makeManager();
  let threw = null;
  try { f.mgr.requestStopBestEffort(); } catch (e) { threw = e; }
  ok("T11 idle tree: no throw, no files", threw === null && !fs.existsSync(f.base));
  const started = f.mgr.startRouting(undefined);
  B2.writeSessionStatus(started.sessionDir, "connected", "live", 555, f.deps.now());
  f.mgr.requestStopBestEffort();
  const control = B2.readJsonFile(join(started.sessionDir, B2.CONTROL_FILE_NAME));
  ok("T11 live session: control.json written synchronously", !!control && control.action === "stop");
}

/* ---------------- T12: stale recovery -> previousSessionDir ---------------- */
console.log("\n== T12 previousSessionDir chains B1's stale cleanup ==");
{
  const f = makeManager();
  const stale = f.mgr.startRouting(undefined);
  // the crashed-session shape: recovery marker present, NO status file
  const f2 = makeManager({ userData: f.userData });
  const started = f2.mgr.startRouting(undefined);
  const req = readReq(started.sessionDir);
  ok("T12 request carries the stale dir for the helper's guarded cleanup",
     req?.previousSessionDir === stale.sessionDir);
}

/* ---------------- T13: launcher failure ---------------- */
console.log("\n== T13 launcher failure: honest throw + no stranded marker ==");
{
  const f = makeManager({
    launchElevated: () => ({ launched: false, reason: "elevation spawn failed: boom" }),
  });
  let threw = null;
  try { f.mgr.startRouting(undefined); } catch (e) { threw = String(e?.message || e); }
  ok("T13 throws the launcher's honest reason", threw === "elevation spawn failed: boom");
  ok("T13 recovery marker cleared behind the failure", B2.readRecovery(f.base) === null);
  ok("T13 view is idle again (active:false)", f.mgr.getRoutingStatus().active === false);
}

/* ---------------- T14: leftover recovery, no status ---------------- */
console.log("\n== T14 leftover recovery with no status = crashed-session view ==");
{
  const f = makeManager();
  const started = f.mgr.startRouting(undefined);
  const f2 = makeManager({ userData: f.userData });
  const v = f2.mgr.getRoutingStatus();
  ok("T14 state error with the repair guidance", v.state === "error" && /repair|start a new session/i.test(v.message));
  ok("T14 active:true (the marker exists), no engine pid", v.active === true && v.enginePid === 0 && v.sessionDir === started.sessionDir);
}

/* ---------------- T15: isSessionLive truth table ---------------- */
console.log("\n== T15 isSessionLive truth table ==");
{
  const f = makeManager();
  ok("T15 fresh: false", f.mgr.isSessionLive() === false);
  f.mgr.startRouting(undefined);
  ok("T15 UAC pending: true", f.mgr.isSessionLive() === true);
  const f2 = makeManager();
  const s2 = f2.mgr.startRouting(undefined);
  B2.writeSessionStatus(s2.sessionDir, "connected", "live", 1, f2.deps.now());
  ok("T15 connected: true", f2.mgr.isSessionLive() === true);
  B2.writeSessionStatus(s2.sessionDir, "disabled", "done", 0, f2.deps.now());
  ok("T15 disabled: false", f2.mgr.isSessionLive() === false);
}

/* ---------------- T16: repair anti-UAC-spam cooldown ---------------- */
console.log("\n== T16 repair anti-spam: one launch per 120 s window ==");
{
  const f = makeManager();
  const started = f.mgr.startRouting(undefined);
  B2.writeSessionStatus(started.sessionDir, "connected", "stale adapter", 555, f.deps.now());
  let r = f.mgr.repairRouting();
  ok("T16 first repair launches (the stale start-pending heals away; window fresh)",
     r.launched === true && f.captured.length === 2 && f.captured[1].flag === "--repair-network");
  r = f.mgr.repairRouting();
  ok("T16 immediate second repair REFUSED with the anti-spam reason",
     r.launched === false && /120 s|never queue/i.test(r.reason ?? ""));
  ok("T16 the refused re-click made NO launcher call (no second UAC)", f.captured.length === 2);
  f.tick(119_000);
  r = f.mgr.repairRouting();
  ok("T16 still inside the window: refused, still no launcher call",
     r.launched === false && f.captured.length === 2);
  f.tick(2_000); // 121 s since the repair launch
  r = f.mgr.repairRouting();
  ok("T16 past the window: the repair launches again",
     r.launched === true && f.captured.length === 3 && f.captured[2].arg === started.sessionDir);
}

/* ---------------- T17: repair vs a pending TUN start elevation ---------------- */
console.log("\n== T17 repair refuses while a TUN start elevation is pending ==");
{
  const f = makeManager();
  f.mgr.startRouting(undefined); // UAC pending — no helper evidence yet
  const r = f.mgr.repairRouting();
  ok("T17 repair refuses while the start elevation may be unanswered",
     r.launched === false && /pending/i.test(r.reason ?? ""));
  ok("T17 exactly one launcher call (the start's) — repair added none",
     f.captured.length === 1);
}

/* ---------------- summary ---------------- */
console.log(`\n===== taskB2-fntest: ${pass} PASS / ${fail} FAIL =====`);
if (fail > 0) process.exit(1);
