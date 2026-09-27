/**
 * MEMENTO — routing helper (Phase B1, approved decisions D1-D6).
 *
 * The ELEVATED side of the TUN routing session. The GUI relaunches THIS
 * exe with `--routing-helper <requestPath>` (UAC) or `--repair-network
 * <sessionDir>`; this module is that headless second process. It shares
 * ZERO surface with the normal app: no window, no tray, no hotkeys, no
 * cores, no system-proxy writes, no single-instance lock — the
 * process-based loop prevention (D6). The session directory is the ONLY
 * communication channel (request/status/control/recovery files).
 *
 * Helper loop (mirrors the reference watchdog, mapped onto D6):
 *   - every HELPER_TICK_MS: exit when control.json appears OR the GUI pid
 *     died (D6: quitting ALWAYS ends in a full teardown);
 *   - engine died -> "error" + full cleanup;
 *   - every SOCKS_PROBE_INTERVAL_MS: TCP-probe the ACTIVE core's socks
 *     and write a status HEARTBEAT (Phase B3 — the GUI's staleness
 *     detector needs the helper to touch status.json at least once per
 *     probe interval, state change or not);
 *     after SOCKS_FAILURE_LIMIT strikes the D6 fork decides, reading the
 *     FRESH kill-switch state (Phase B3 C5 fusion — the shared prefs
 *     file, with the request's start-time snapshot as the fallback):
 *       ARMED   -> status "reconnecting", tunnel STAYS UP (fail-closed),
 *                  probing continues until the upstream recovers
 *                  ("connected" again) or a stop arrives;
 *       UNARMED -> status "restoring" + full teardown (fail-open).
 *   - clean end: kill engine, remove the MementoTun adapter via the
 *     engine's own exit, status "disabled", recovery.json removed.
 *
 * Repair (--repair-network): identity-guarded stale-engine kill (a pid
 * is only ever killed when its image name is the pinned sing-box — an
 * unprivileged-edited status.json must NOT become a kill-any-process
 * primitive), stale control.json removal, recovery.json cleared, status
 * "disabled". A missing session dir is nothing-to-recover, not an error.
 *
 * ELECTRON-FREE by construction: node builtins only; main.ts resolves
 * the platform paths and injects them (HelperDeps). The engine spawn and
 * the socks probe are injectable so taskB1-fntest drives the whole loop
 * against a FAKE engine.
 */
import { spawn as nodeSpawn, execFile } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import {
  authorizeRequestPath,
  buildTunSingboxConfig,
  clearControl,
  clearRecovery,
  CONFIG_FILE_NAME,
  CONTROL_FILE_NAME,
  HELPER_FLAG,
  HELPER_TICK_MS,
  LOG_FILE_NAME,
  RecoveryRecord,
  readJsonFile,
  readRecovery,
  readSessionStatus,
  REPAIR_FLAG,
  sessionBaseDir,
  SessionState,
  SOCKS_FAILURE_LIMIT,
  SOCKS_PROBE_INTERVAL_MS,
  STATUS_FILE_NAME,
  RoutingRequest,
  SessionStatus,
  validateRequest,
  verifyWintunForSpawn,
  wintunDllPathFor,
  writeRecovery,
  writeSessionStatus,
} from "./routingSession";

/* ------------------------------------------------------------------ */
/* argv                                                                */
/* ------------------------------------------------------------------ */

export type HelperInvocation =
  | { mode: "helper"; requestPath: string }
  | { mode: "repair"; sessionDir: string | null };

/** D5 loop prevention, step one: recognize the helper argv BEFORE the
 *  single-instance lock, the window, the tray, the hotkeys, the cores. */
export function isHelperInvocation(argv: string[]): boolean {
  return parseHelperArgv(argv) !== null;
}

export function parseHelperArgv(argv: string[]): HelperInvocation | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === HELPER_FLAG) {
      const arg = argv[i + 1];
      return { mode: "helper", requestPath: arg ?? "" };
    }
    if (argv[i] === REPAIR_FLAG) {
      const arg = argv[i + 1];
      return { mode: "repair", sessionDir: arg ?? null };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* injectable runtime surface                                          */
/* ------------------------------------------------------------------ */

/** Minimal engine-child surface (real ChildProcess or a fake). */
export interface EngineChild {
  pid: number | undefined;
  kill(): boolean;
  /** Resolves with the exit code (null = signal). */
  onExit(): Promise<number | null>;
}

export interface HelperDeps {
  userDataDir: string;
  resourceRootDir: string;
  platform: string;
  /** Locates the pinned sing-box binary (paths.findSingBox in prod). */
  findEngine: () => string | null;
  /** Injectable engine spawn; default = child_process.spawn. */
  spawnEngine?: (cmd: string, args: string[]) => EngineChild;
  /** Injectable upstream probe; default = TCP dial the socks address. */
  probeSocks?: (host: string, port: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Injectable process-liveness (default: kill(pid, 0)). */
  processAlive?: (pid: number) => boolean;
  /** Injectable image-name lookup for the identity guard. */
  processImageName?: (pid: number) => Promise<string | null>;
  /** Injectable publisher leg (routingSession verifies hash itself). */
  runPublisherCheck?: (dllPath: string) => Promise<string | null>;
  /** Phase B3 (C5 fusion): FRESH kill-switch read for the D6 fork.
   *  Default = tolerant electron-free read of the SHARED prefs file
   *  (<userDataDir>/memento-app-prefs.json) — the same file the GUI
   *  writes on every arm/disarm flip, in the same user profile (the
   *  elevated helper runs as the SAME user; the file is the user's own
   *  data, so a read-only peek crosses no trust boundary — and the user
   *  editing their own arm flag is their right, not an attack). ANY read
   *  problem (missing file, torn non-atomic GUI write, garbage) falls
   *  back to the request's start-time snapshot — the B1 behavior,
   *  byte-identical, so a D6 decision can never hang on an I/O error. */
  readKillSwitchArmed?: (userDataDir: string) => boolean;
  log?: (line: string) => void;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Phase B3 default fresh-armed reader: tolerant electron-free read of
 *  the shared prefs file. Mirrors loadAppPrefs' killSwitch semantics
 *  (strictly === true / false) and its tolerant-fallback discipline — a
 *  missing file or a torn mid-write read (the GUI's saveAppPrefs is a
 *  plain writeFileSync) returns the request's start-time snapshot; the
 *  next fork decision re-reads. The file has carried the killSwitch
 *  field since Phase C5, so a pre-C5 file simply reads as the snapshot. */
function defaultReadKillSwitchArmed(userDataDir: string, fallback: boolean): boolean {
  try {
    const raw = fs.readFileSync(
      path.join(userDataDir, "memento-app-prefs.json"),
      "utf8"
    );
    const o = JSON.parse(raw) as { killSwitch?: unknown };
    return typeof o.killSwitch === "boolean" ? o.killSwitch : fallback;
  } catch {
    return fallback;
  }
}

function defaultProcessImageName(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { timeout: 10000 },
        (err, stdout) => {
          if (err) return resolve(null);
          const m = String(stdout).match(/^"([^"]+)"/);
          resolve(m ? m[1] : null);
        }
      );
    } else {
      try {
        resolve(fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim() || null);
      } catch {
        resolve(null);
      }
    }
  });
}

function realProbeSocks(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(3000);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

/** Real engine spawn: `sing-box run -c <config>` with merged stdio into
 *  the session routing.log (the helper's diagnostic trail). */
function realSpawnEngine(cmd: string, args: string[], logPath: string): EngineChild {
  const fsOk = (() => {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      return true;
    } catch {
      return false;
    }
  })();
  const child = nodeSpawn(cmd, args, {
    stdio: fsOk ? ["ignore", fs.openSync(logPath, "a"), fs.openSync(logPath, "a")] : "ignore",
    windowsHide: true,
  });
  // Memoized ONCE: the watchdog races this promise every tick — a fresh
  // promise per call would pile up 'close' listeners on long sessions.
  const exitPromise = new Promise<number | null>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("close", (code) => resolve(code));
  });
  return {
    pid: child.pid,
    kill: () => child.kill(),
    onExit: () => exitPromise,
  };
}

/* ------------------------------------------------------------------ */
/* wintun placement                                                    */
/* ------------------------------------------------------------------ */

/** The engine loads wintun.dll from ITS OWN directory on Windows — copy
 *  the verified dll beside the sing-box binary (reference's
 *  ensure_wintun_beside). Only ever copies FROM the B0-verified location
 *  TO the engine dir, never the reverse, never a rename. */
export function ensureWintunBesideEngine(
  enginePath: string,
  wintunDllPath: string
): { ok: boolean; reason?: string } {
  if (path.dirname(enginePath) === path.dirname(wintunDllPath)) return { ok: true };
  try {
    fs.copyFileSync(wintunDllPath, path.join(path.dirname(enginePath), "wintun.dll"));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `could not place wintun.dll beside the engine: ${String(e)}` };
  }
}

/* ------------------------------------------------------------------ */
/* identity-guarded engine kill                                        */
/* ------------------------------------------------------------------ */

const ENGINE_IMAGE_RE = /^sing-box(\.exe)?$/i;

/** Kill the pid ONLY when its image name is the pinned engine. The pid
 *  comes from status.json — a user-writable file — so the image check is
 *  what stops a tampered pid from becoming kill-any-process. */
export async function killEnginePidGuarded(
  pid: number,
  deps: Pick<HelperDeps, "processImageName">
): Promise<{ killed: boolean; reason?: string }> {
  const image = await (deps.processImageName ?? defaultProcessImageName)(pid);
  if (!image) return { killed: false, reason: `pid ${pid} image could not be confirmed` };
  if (!ENGINE_IMAGE_RE.test(path.basename(image))) {
    return { killed: false, reason: `pid ${pid} is '${image}', not the engine — hands off` };
  }
  try {
    process.kill(pid);
    return { killed: true };
  } catch (e) {
    return { killed: false, reason: `kill failed: ${String(e)}` };
  }
}

/* ------------------------------------------------------------------ */
/* the helper main loop                                                */
/* ------------------------------------------------------------------ */

export interface HelperRunResult {
  code: number;
  finalState: SessionState | "no-invocation" | "unauthorized" | "invalid-request";
  message?: string;
}

/** Entry used by main.ts (`--routing-helper <requestPath>`). Returns the
 *  process exit code. EVERY rejection path writes status.json "error"
 *  first so the GUI-side poller can surface an honest reason. */
export async function runRoutingHelper(
  requestPath: string,
  deps: HelperDeps
): Promise<HelperRunResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const alive = deps.processAlive ?? defaultProcessAlive;
  const base = sessionBaseDir(deps.userDataDir);

  const fail = async (state: SessionState, code: number, message: string, dir: string): Promise<HelperRunResult> => {
    writeSessionStatus(dir, state, message, 0, now());
    clearRecovery(base);
    return { code, finalState: state === "error" ? "error" : state, message };
  };

  if (!requestPath) {
    // No path at all — nowhere to write status; exit honestly.
    return { code: 2, finalState: "invalid-request", message: "no request path given" };
  }

  const raw = readJsonFile<RoutingRequest>(requestPath);
  if (!raw) {
    // An unreadable request names no trustworthy directory — write NO
    // status anywhere (our elevated process must never touch a path the
    // argv pointed at), just exit honestly.
    return { code: 2, finalState: "invalid-request", message: `request unreadable: ${requestPath}` };
  }
  const invalid = validateRequest(raw);
  if (invalid) {
    return { code: 2, finalState: "invalid-request", message: `request invalid: ${invalid}` };
  }
  const req: RoutingRequest = raw;

  // Privilege-boundary authorization (repeated behind the boundary —
  // the reference lesson).
  const unauthorized = authorizeRequestPath(requestPath, base, req);
  if (unauthorized) {
    return { code: 2, finalState: "unauthorized", message: unauthorized };
  }
  const sessionDir = path.resolve(req.sessionDir);

  // Stale previous session (crashed run): best-effort guarded cleanup.
  if (req.previousSessionDir) {
    await cleanupStaleSession(req.previousSessionDir, deps);
  }

  // THE B1 SPAWN GATE (wintunPin contract): hash always, publisher on
  // win32 — refuse BEFORE any engine exists.
  const gate = await verifyWintunForSpawn({
    wintunDllPath: wintunDllPathFor(deps.resourceRootDir),
    platform: deps.platform,
    runPublisherCheck: deps.runPublisherCheck,
  });
  if (!gate.ok) {
    return fail("error", 3, gate.reason ?? "wintun gate failed", sessionDir);
  }

  const engine = deps.findEngine();
  if (!engine) {
    return fail("error", 3, "sing-box binary not found — the D1 engine is missing", sessionDir);
  }
  const placed = ensureWintunBesideEngine(engine, wintunDllPathFor(deps.resourceRootDir));
  if (!placed.ok && deps.platform === "win32") {
    return fail("error", 3, placed.reason ?? "wintun placement failed", sessionDir);
  }

  const config = buildTunSingboxConfig(req);
  const configPath = path.join(sessionDir, CONFIG_FILE_NAME);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

  // Recovery marker (D5): written by prepareRoutingSession on the GUI
  // side; the helper REPAIRS it here if the GUI crashed between writing
  // the request and writing recovery.
  const rec = readRecovery(base);
  if (!rec || rec.sessionDir !== sessionDir) {
    writeRecovery(base, sessionDir, req.sessionId);
  }

  clearControl(sessionDir);
  writeSessionStatus(sessionDir, "starting", "routing engine starting", 0, now());

  const logPath = path.join(sessionDir, LOG_FILE_NAME);
  const child = deps.spawnEngine
    ? deps.spawnEngine(engine, ["run", "-c", configPath])
    : realSpawnEngine(engine, ["run", "-c", configPath], logPath);
  const enginePid = child.pid ?? 0;
  writeSessionStatus(sessionDir, "starting", "routing engine spawned", enginePid, now());

  // Phase B3 heartbeat trackers: the CURRENT session state/message, so
  // every probe tick can re-write status.json even without a transition
  // (the GUI's staleness detector keys on updatedAtMs — a healthy helper
  // must never look dead, and a dead helper must never look healthy).
  let lastState: SessionState = "starting";
  let lastMessage = "routing engine spawned";

  const probe = deps.probeSocks ?? realProbeSocks;
  let failures = 0;
  let down = false;
  let lastProbe = now();
  let exitReason: "control" | "gui-gone" | null = null;

  // Initial readiness: the tunnel is "connected" only once the upstream
  // socks actually answers (a slow start is a deadline, not a delay).
  // Engine death is checked every tick via the exit race.
  while (true) {
    if (fs.existsSync(path.join(sessionDir, CONTROL_FILE_NAME))) {
      exitReason = "control";
      break;
    }
    if (!alive(req.guiPid)) {
      exitReason = "gui-gone";
      break;
    }
    const exited = await Promise.race([child.onExit(), sleep(0).then(() => null)]);
    if (exited !== null) {
      return fail(
        "error",
        4,
        `routing engine exited before the tunnel went live (code ${exited}) — see routing.log`,
        sessionDir
      );
    }
    if (now() - lastProbe >= SOCKS_PROBE_INTERVAL_MS || failures === 0) {
      lastProbe = now();
      const up = await probe(req.socksHost, req.socksPort);
      if (up) {
        if (down || failures > 0) {
          down = false;
          failures = 0;
          writeSessionStatus(sessionDir, "connected", "system-wide routing active", enginePid, now());
        } else if (readSessionStatus(sessionDir)?.state !== "connected") {
          writeSessionStatus(sessionDir, "connected", "system-wide routing active", enginePid, now());
        }
        break; // readiness achieved — hand over to the steady-state loop
      }
      failures++;
      // Phase B3: readiness heartbeat — a slow (or refusing) upstream
      // keeps the "starting" status FRESH so the GUI's staleness detector
      // never mistakes a long readiness for a dead helper.
      writeSessionStatus(sessionDir, lastState, lastMessage, enginePid, now());
      if (failures >= SOCKS_FAILURE_LIMIT) {
        return fail(
          "error",
          4,
          "upstream socks never became reachable — tunnel refused to go live",
          sessionDir
        );
      }
    }
    await sleep(HELPER_TICK_MS);
  }

  if (exitReason) {
    // Stopped before it ever went live.
    await teardown(child, sessionDir, enginePid, deps, now);
    return { code: 0, finalState: "disabled", message: "stopped before ready" };
  }

  // Steady state. The trackers start at the live state the readiness
  // loop just confirmed.
  lastState = "connected";
  lastMessage = "system-wide routing active";
  while (true) {
    if (fs.existsSync(path.join(sessionDir, CONTROL_FILE_NAME))) {
      exitReason = "control";
      break;
    }
    if (!alive(req.guiPid)) {
      exitReason = "gui-gone";
      break;
    }
    const code = await Promise.race([child.onExit(), sleep(0).then(() => null)]);
    if (code !== null) {
      return fail(
        "error",
        4,
        `routing engine exited unexpectedly (code ${code}) — see routing.log`,
        sessionDir
      );
    }
    if (now() - lastProbe >= SOCKS_PROBE_INTERVAL_MS) {
      lastProbe = now();
      const up = await probe(req.socksHost, req.socksPort);
      if (up) {
        failures = 0;
        if (down) {
          down = false;
          lastState = "connected";
          lastMessage = "upstream recovered — system-wide routing resumed";
          writeSessionStatus(
            sessionDir,
            lastState,
            lastMessage,
            enginePid,
            now()
          );
        } else {
          // Phase B3 heartbeat: healthy session, no transition — refresh
          // updatedAtMs so the GUI knows the helper is alive.
          writeSessionStatus(sessionDir, lastState, lastMessage, enginePid, now());
        }
      } else {
        failures++;
        // Phase B3 (C5 fusion): the D6 fork reads the FRESH armed state
        // (the shared prefs file via the injectable reader) — an
        // arm/disarm flip made while the session is live takes effect at
        // the NEXT fork decision (within one probe interval), not at the
        // next session start. The start-time snapshot is the guaranteed
        // fallback (an injected reader that throws, or any read problem,
        // must never take the D6 decision hostage).
        const armedNow = (() => {
          try {
            const read =
              deps.readKillSwitchArmed ??
              ((ud: string) => defaultReadKillSwitchArmed(ud, req.killSwitchArmed));
            return read(deps.userDataDir);
          } catch {
            return req.killSwitchArmed;
          }
        })();
        // Heartbeat on the failing path too — the held/reconnecting view
        // stays fresh while the fork holds.
        writeSessionStatus(sessionDir, lastState, lastMessage, enginePid, now());
        const outcome =
          failures < SOCKS_FAILURE_LIMIT
            ? "keep-waiting"
            : armedNow
              ? "hold-reconnecting"
              : "teardown-restoring";
        if (outcome === "hold-reconnecting") {
          down = true;
          lastState = "reconnecting";
          lastMessage = "kill switch is holding system traffic while the upstream recovers";
          // D6 fail-closed: the tunnel stays UP and keeps swallowing
          // traffic while the upstream is down.
          writeSessionStatus(
            sessionDir,
            lastState,
            lastMessage,
            enginePid,
            now()
          );
        } else if (outcome === "teardown-restoring") {
          down = true;
          // D6 fail-open: restore normal networking.
          break;
        }
      }
    }
    await sleep(HELPER_TICK_MS);
  }

  await teardown(child, sessionDir, enginePid, deps, now);
  return { code: 0, finalState: "disabled", message: exitReason === "control" ? "stopped by control" : "stopped (GUI gone)" };
}

/** D6 full teardown: engine down, adapter removed by the engine exit,
 *  status "disabled", recovery cleared, control file consumed. */
async function teardown(
  child: EngineChild,
  sessionDir: string,
  enginePid: number,
  deps: HelperDeps,
  now: () => number
): Promise<void> {
  writeSessionStatus(sessionDir, "restoring", "closing the adapter and restoring routes", enginePid, now());
  try {
    child.kill();
  } catch {
    /* already dead */
  }
  if (child.onExit) await child.onExit();
  writeSessionStatus(sessionDir, "disabled", "networking was restored", 0, now());
  clearRecovery(sessionBaseDir(deps.userDataDir));
  clearControl(sessionDir);
}

/** Best-effort cleanup of a PREVIOUS crashed session (stale engine +
 *  stale files). Never fatal: a stale dir that is simply gone is nothing
 *  to recover. */
export async function cleanupStaleSession(
  staleDir: string,
  deps: HelperDeps
): Promise<void> {
  try {
    const status = readSessionStatus(staleDir);
    if (status && status.enginePid > 0) {
      await killEnginePidGuarded(status.enginePid, deps);
    }
    clearControl(staleDir);
    writeSessionStatus(staleDir, "disabled", "cleaned up by a newer session", 0, deps.now?.() ?? Date.now());
  } catch {
    /* nothing to recover */
  }
}

/* ------------------------------------------------------------------ */
/* --repair-network                                                    */
/* ------------------------------------------------------------------ */

export interface RepairResult {
  code: number;
  message: string;
}

/** One-shot elevated repair: kill a stale engine (identity-guarded),
 *  clear the stale control file, close the recovery marker, write an
 *  honest final status. A missing session dir + missing recovery marker
 *  = "no network state was found to repair" (still exit 0 — that IS the
 *  healthy state). */
export async function runNetworkRepair(
  sessionDir: string | null,
  deps: HelperDeps
): Promise<RepairResult> {
  const base = sessionBaseDir(deps.userDataDir);
  const now = deps.now ?? Date.now;

  let dir = sessionDir ? path.resolve(sessionDir) : null;
  if (!dir) {
    const rec: RecoveryRecord | null = readRecovery(base);
    if (rec) dir = path.resolve(rec.sessionDir);
  }

  if (!dir || !fs.existsSync(path.join(dir, STATUS_FILE_NAME))) {
    clearRecovery(base);
    return { code: 0, message: "no MEMENTO network state was found to repair" };
  }

  // The dir must still be inside the base (never repair a foreign tree).
  if (path.dirname(dir) !== path.resolve(base)) {
    return { code: 2, message: "session dir is outside the session base — refusing" };
  }

  const status = readSessionStatus(dir);
  if (status && status.enginePid > 0) {
    const killed = await killEnginePidGuarded(status.enginePid, deps);
    if (!killed.killed && killed.reason) {
      writeSessionStatus(dir, "disabled", `repair: ${killed.reason}`, 0, now());
    }
  }

  clearControl(dir);
  clearRecovery(base);
  writeSessionStatus(dir, "disabled", "network repair completed", 0, now());
  return { code: 0, message: "network repair completed" };
}

/* ------------------------------------------------------------------ */
/* entry dispatch (main.ts calls this after whenReady)                 */
/* ------------------------------------------------------------------ */

/** Dispatch a helper invocation to its runner. Returns the process exit
 *  code. NEVER touches electron — main.ts owns the app lifecycle. */
export async function runHelperInvocation(
  argv: string[],
  deps: HelperDeps
): Promise<number> {
  const invocation = parseHelperArgv(argv);
  if (!invocation) return 0;
  if (invocation.mode === "repair") {
    const r = await runNetworkRepair(invocation.sessionDir, deps);
    deps.log?.(`[MementoTunHelper] repair: ${r.message}`);
    return r.code;
  }
  const r = await runRoutingHelper(invocation.requestPath, deps);
  deps.log?.(`[MementoTunHelper] helper: ${r.finalState}${r.message ? " — " + r.message : ""}`);
  return r.code;
}
