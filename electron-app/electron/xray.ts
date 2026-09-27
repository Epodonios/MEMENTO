/**
 * MEMENTO — xray-core process manager.
 *
 * Electron port of the Rust XrayState + start_xray/stop_xray/get_xray_status/
 * get_xray_logs/get_xray_traffic/kill_orphaned_xray/first_busy_port logic in
 * src-tauri/src/lib.rs. Every behavior — including the quirks — is preserved:
 *
 *  - stop existing child, then kill ORPHANED xray.exe before each start
 *  - fail fast if a target port is already bound (clear multi-line message)
 *  - write memento-active-config.json into the app data dir
 *  - spawn `xray run -c <config>` with XRAY_LOCATION_ASSET=<data dir>
 *  - 900 ms grace period; if the process died, surface the LAST 8 lines of
 *    combined stdout+stderr as the error ("xray-core failed to start:\n...")
 *  - 300-line ring buffer of merged stdout/stderr, drained continuously so
 *    the OS pipe never fills and blocks xray
 *  - generation counter so stale readers of an older connection stop
 *    appending to the shared buffer after a reconnect
 *  - get_xray_status reports hardcoded 10808/10809 while running (Tauri quirk)
 *  - get_xray_traffic spawns a short-lived `xray api statsquery` helper with
 *    a hard 1200 ms timeout and sums the per-outbound traffic counters for
 *    the CONNECTED TOPOLOGY's member tags (Phase C4: default ["proxy"] —
 *    the historical behavior — extended to every balancer member so a pool
 *    selection can never silently zero the speed/total displays)
 *  - unconditional system-proxy set on start / clear on stop (Tauri quirk,
 *    preserved per migration decision)
 */
import { ChildProcess, spawn, spawnSync } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";
import { app } from "electron";
import {
  MAX_LOG_LINES,
  XRAY_BIN_NAME,
  XRAY_VERSION,
  dataDir,
  findXray,
  XrayInfo,
} from "./paths";
import { downloadXray } from "./download";
import { clearSystemProxy, setSystemProxy } from "./proxy";
import { releaseSystemProxy, blockOnCoreExit } from "./killSwitch";
import {
  adaptCoreConfigFromError,
  detectCoreVersion,
  isConfigBuildError,
  sanitizeCoreConfig,
} from "./coreCompat";
import {
  killAllOrphanedCores,
  killAllOrphanedCoresNow,
  readActiveCoreMeta,
  removeActiveCoreMeta,
  writeActiveCoreMeta,
} from "./coreOps";
import type { ConnectionStatus, TrafficStats } from "./coreTypes";

// Wire shapes moved to the shared coreTypes module (Task 11: the optional
// `core` field lives there; the key names are unchanged).
export type { ConnectionStatus, TrafficStats };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Phase C4: the outbound tags whose traffic counters this connection's
 * stats must sum. The renderer (which built the topology) sends its list
 * through start_xray; the default ["proxy"] reproduces the historical
 * counting byte-for-byte. Sanitized at the IPC boundary (ipc.ts) AND here
 * (defense in depth): only plain tag-shaped strings survive, bounded,
 * deduped, non-empty -> ["proxy"].
 */
const TRAFFIC_TAG_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function sanitizeTrafficTags(input: unknown): string[] {
  if (!Array.isArray(input)) return ["proxy"];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item === "string" && TRAFFIC_TAG_RE.test(item)) seen.add(item);
    if (seen.size >= 16) break;
  }
  return seen.size > 0 ? [...seen] : ["proxy"];
}

class XrayManager {
  private child: ChildProcess | null = null;
  /** Spawned but not yet past the crash-grace period (not visible to
   *  getStatus — same as Rust, which only committed the child to state
   *  after the grace check). stopXray still kills it. */
  private pendingChild: ChildProcess | null = null;
  private configPath: string | null = null;
  /** Merged stdout+stderr tail (bounded), same as the Rust VecDeque. */
  private logs: string[] = [];
  /** Bumped on every spawn/stop; stale line handlers stop touching `logs`. */
  private generation = 0;
  /** Serializes startXray calls so two rapid connects (double-click,
   *  failover during connecting) can never interleave their stop/spawn/
   *  grace phases and corrupt the child slot. */
  private startQueue: Promise<unknown> = Promise.resolve();
  /** Outbound tags summed by getTraffic (Phase C4 — set per start). */
  private trafficTags: string[] = ["proxy"];

  /* ---------------------------------------------------------------- */
  /*  start                                                            */
  /* ---------------------------------------------------------------- */

  startXray(
    configJson: string,
    socksPort: number,
    httpPort: number,
    apiPort: number,
    trafficTags?: string[]
  ): Promise<ConnectionStatus> {
    // Chain onto the previous start (and keep the chain alive even if a
    // start rejected, via the catch below) so starts run strictly one at
    // a time. The first call's error still propagates to ITS caller.
    const run = this.startQueue.then(
      () => this.startXrayInner(configJson, socksPort, httpPort, apiPort, trafficTags),
      () => this.startXrayInner(configJson, socksPort, httpPort, apiPort, trafficTags)
    );
    this.startQueue = run.catch(() => {});
    return run;
  }

  private async startXrayInner(
    configJson: string,
    socksPort: number,
    httpPort: number,
    apiPort: number,
    trafficTags?: string[]
  ): Promise<ConnectionStatus> {
    this.trafficTags = sanitizeTrafficTags(trafficTags);
    this.stopInternal();

    // Kill orphaned core binaries from a previous crashed/closed session —
    // otherwise the new spawn dies instantly with a bind error. Covers BOTH
    // binaries (coreOps) so a leftover sing-box.exe can't squat on 10808.
    await killAllOrphanedCores();

    // Fail fast if something else is squatting on our ports
    // (Rust: TcpListener::bind probe on 127.0.0.1 for each port).
    const busyPort = await firstBusyPortAsync([socksPort, httpPort, apiPort]);
    if (busyPort !== null) {
      throw new Error(
        `Port ${busyPort} is already in use by another program.\n` +
          `Close whatever is using it (another VPN/proxy app, or a leftover xray.exe in Task Manager) and try again,\n` +
          `or change the SOCKS/HTTP port in the connection settings.`
      );
    }

    // Resolve (or auto-download) the binary.
    let xrayPath = findXray();
    if (!xrayPath) {
      const info: XrayInfo = await downloadXray();
      xrayPath = info.path;
    }

    // R3 task #6: detect the INSTALLED core's version and pre-sanitize the
    // generated config for KNOWN removed features (xray 26.x removed
    // `allowInsecure` with no alias) before it is ever written to disk.
    // Keeps working no matter which xray version the user installed.
    const coreVer = detectCoreVersion(xrayPath, "xray");
    const adaptNotes: string[] = [];
    {
      const pre = sanitizeCoreConfig("xray", coreVer.version, configJson);
      if (pre.removed.length > 0) {
        configJson = pre.configText;
        adaptNotes.push(
          `[MEMENTO] Config pre-adapted for xray ${coreVer.version ?? "unknown"}: removed removed-feature key(s) ${pre.removed.slice(0, 6).join(", ")}${pre.removed.length > 6 ? " …" : ""}`
        );
      }
    }

    // R3 task #6: TWO-ATTEMPT spawn. When a NEW core refuses the config
    // (a feature got renamed/removed in an update), the core's own error
    // text is parsed, the named field(s) are deep-stripped and the start
    // is retried ONCE — the connection survives ANY core update instead
    // of dying with a cryptic wall of text.
    let effectiveConfig = configJson;
    let pendingFailure: { output: string } | null = null;
    let lastReason: string | null = null;
    let winningChild: ChildProcess | null = null;
    let winningGeneration = 0;
    let winningCfgPath: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        if (!pendingFailure) break; // unreachable in practice
        const adapted = adaptCoreConfigFromError(effectiveConfig, pendingFailure.output);
        if (!adapted) break; // nothing mappable — surface the original error
        effectiveConfig = adapted.configText;
        adaptNotes.push(
          `[MEMENTO] xray refused the config — auto-adapted for the updated core: removed ${adapted.removed.slice(0, 6).join(", ")}${adapted.removed.length > 6 ? " …" : ""}`
        );
      }

    // Write the active config next to the geo assets, exactly like Tauri,
    // plus the active-core SIDECAR (Task 11 — same crash-signature lifecycle).
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const cfgPath = path.join(dir, "memento-active-config.json");
    fs.writeFileSync(cfgPath, effectiveConfig, "utf8");
    writeActiveCoreMeta("xray", XRAY_VERSION);

    // Spawn. windowsHide:true === Rust CREATE_NO_WINDOW (0x08000000).
    const myGeneration = ++this.generation;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    let child: ChildProcess;
    try {
      child = spawn(xrayPath, ["run", "-c", cfgPath], {
        env: { ...process.env, XRAY_LOCATION_ASSET: dir },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e: any) {
      removeActiveCoreMeta();
      throw new Error(`Cannot start xray: ${e?.message || e}`);
    }

    // Spawn/exec failures (ENOENT, EACCES, antivirus lock, …) arrive ASYNC as
    // an 'error' event. ChildProcess is an EventEmitter: an 'error' event
    // with no listener is an uncaught exception that CRASHES the main
    // process. Record it and let the grace-period check below fail the
    // connection cleanly instead.
    let spawnError: Error | null = null;
    child.on("error", (err: Error) => {
      spawnError = err;
    });

    // Continuously drain stdout+stderr (line-split with pending-buffer) so
    // the OS pipe buffer never fills up and freezes xray. Lines flow into
    // (a) a per-connection bucket used for crash reporting and (b) the
    // shared ring buffer — but only while this generation is current.
    const drain = (stream: NodeJS.ReadableStream | null, bucket: string[]): void => {
      if (!stream) return;
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        pending += chunk;
        const parts = pending.split(/\r?\n/);
        pending = parts.pop() ?? "";
        for (const line of parts) this.appendLine(line, bucket, myGeneration);
      });
      stream.on("end", () => {
        if (pending.trim()) this.appendLine(pending, bucket, myGeneration);
      });
    };

    drain(child.stdout, stdoutLines);
    drain(child.stderr, stderrLines);

    // Park the child in the PENDING slot: a concurrent stopXray can still
    // kill it, but getStatus() reports not-running (Rust committed the
    // child to shared state only after the grace check passed).
    this.pendingChild = child;
    this.configPath = cfgPath;

    // 900 ms grace period — catch configs that are rejected immediately and
    // report the REAL reason instead of "connected" then silently dropping.
    await sleep(900);

    // Copy with a widening assertion: TS control-flow narrowing can't see
    // the callback assignment above and would otherwise believe this is
    // always `null` (property `message` on `never`).
    const spawnErr = spawnError as Error | null;

    if (this.pendingChild === child) this.pendingChild = null;

    const superseded = myGeneration !== this.generation;
    if (
      spawnErr ||
      superseded ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      // A stop (or newer action) raced us during the grace window and the
      // child is somehow still alive — finish the job before failing.
      if (
        !spawnErr &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        try {
          child.kill();
        } catch {
          /* best-effort */
        }
      }
      // Release our config-file slot ONLY if nothing newer owns it (a
      // concurrent start may already have replaced this.configPath).
      if (this.configPath === cfgPath) {
        this.configPath = null;
        try {
          fs.rmSync(cfgPath, { force: true });
        } catch {
          /* best-effort */
        }
        removeActiveCoreMeta();
      }
      if (spawnErr) {
        throw new Error(`Cannot start xray: ${spawnErr.message || spawnErr}`);
      }
      if (superseded && child.exitCode === null && child.signalCode === null) {
        // Cancelled mid-grace by an explicit stop — not a config failure.
        throw new Error("Connection attempt was cancelled while starting.");
      }
      // xray already exited — surface the last 8 combined output lines
      // (stdout first, then stderr — same combination order as Rust).
      const combined = [stdoutLines.join("\n").trim(), stderrLines.join("\n").trim()]
        .filter((s) => s.length > 0)
        .join("\n");
      const reason = combined
        ? combined.split(/\r?\n/).slice(-8).join("\n")
        : `xray-core exited immediately (exit code: ${
            child.exitCode !== null
              ? child.exitCode
              : JSON.stringify(child.signalCode)
          }). The config may be invalid.`;

      // R3 task #6: config-build failures get ONE adaptation retry before
      // the error surfaces — this is what keeps the app compatible with
      // any future xray update that removes another config feature.
      if (attempt === 0 && combined && isConfigBuildError(combined)) {
        pendingFailure = { output: combined };
        lastReason = `xray-core failed to start:\n${reason}`;
        continue;
      }

      throw new Error(`xray-core failed to start:\n${reason}`);
    }

    // R3 task #6: remember which child won so the success path commits it.
    winningChild = child;
    winningGeneration = myGeneration;
    winningCfgPath = cfgPath;
    break;
    }

    if (!winningChild || !winningCfgPath) {
      // Both attempts exhausted without a spawn survivor — surface the
      // ORIGINAL core error (the adaptation could not map it).
      throw new Error(
        lastReason ??
          "xray-core failed to start: the config could not be adapted automatically."
      );
    }

    const child = winningChild;
    const myGeneration = winningGeneration;
    const cfgPath = winningCfgPath;

    // Grace passed — NOW commit the child to the shared slot (Rust parity:
    // the state only ever holds a child that survived the grace check).
    this.child = child;
    this.configPath = cfgPath;

    // Fresh connection: clear the tail and record the start line. (Lines
    // streamed during the grace window are already in the ring buffer —
    // matching the Rust end-state where buffered pipe data is drained.)
    this.logs = [];
    this.logs.push(`[MEMENTO] xray-core started (pid ${child.pid})`);
    // R3 task #6: surface every adaptation that happened on the way —
    // AFTER the tail reset, so the user actually reads what was adapted.
    for (const note of adaptNotes) {
      this.logs.push(note);
    }
    this.trimLogs();

    child.on("exit", (code, signal) => {
      // Only the CURRENT connection may write to the shared log tail.
      if (myGeneration !== this.generation) return;
      if (this.child === child) {
        this.logs.push(
          `[MEMENTO] xray-core process exited (code: ${
            code !== null ? code : JSON.stringify(signal)
          }). If this keeps happening, check that your antivirus / Windows Defender is not blocking or quarantining xray.exe.`
        );
        this.trimLogs();
        this.child = null;
        // Phase C5 kill switch: EVERY death of the current child while
        // armed normalizes the now-dead tunnel proxy to the BLOCKED state
        // (fail closed — never direct). Quit-latch aware (markQuitting
        // during teardown silences this); best-effort by contract.
        blockOnCoreExit();
      }
    });

    // Tauri quirk preserved: the proxy is set unconditionally on start
    // (the UI additionally sets it when connMode === "system-proxy").
    try {
      setSystemProxy(socksPort);
    } catch {
      /* best-effort — identical to `let _ = set_system_proxy_inner(...)` */
    }

    return {
      running: true,
      pid: child.pid ?? null,
      socks_port: socksPort,
      http_port: httpPort,
    };
  }

  private appendLine(line: string, bucket: string[], myGeneration: number): void {
    if (!line.trim()) return;
    bucket.push(line);
    if (myGeneration === this.generation) {
      this.logs.push(line);
      this.trimLogs();
    }
  }

  private trimLogs(): void {
    while (this.logs.length > MAX_LOG_LINES) this.logs.shift();
  }

  /* ---------------------------------------------------------------- */
  /*  stop                                                             */
  /* ---------------------------------------------------------------- */

  private stopInternal(): void {
    this.generation++; // invalidate stale readers
    const child = this.child;
    this.child = null;
    const pending = this.pendingChild;
    this.pendingChild = null;
    for (const c of [child, pending]) {
      if (c && c.exitCode === null && c.signalCode === null) {
        try {
          c.kill(); // TerminateProcess on Windows — same as Rust Child::kill
        } catch {
          /* best-effort */
        }
      }
    }
    const cfgPath = this.configPath;
    this.configPath = null;
    if (cfgPath) {
      try {
        fs.rmSync(cfgPath, { force: true });
      } catch {
        /* best-effort */
      }
    }
    removeActiveCoreMeta();
  }

  /** Port of the stop_xray command. Releases the proxy through the C5
   *  kill switch (armed -> BLOCK, disarmed -> plain clear, quitting ->
   *  plain clear) instead of a raw unconditional clear. */
  stopXray(): ConnectionStatus {
    this.stopInternal();
    try {
      releaseSystemProxy();
    } catch {
      /* best-effort — Rust: `let _ = clear_system_proxy_inner();` */
    }
    return { running: false, pid: null, socks_port: 0, http_port: 0 };
  }

  /** Port of the WindowEvent::Destroyed cleanup (app shutdown path). */
  cleanupOnExit(): void {
    this.stopInternal();
    try {
      clearSystemProxy();
    } catch {
      /* best-effort */
    }
    try {
      killAllOrphanedCoresNow();
    } catch {
      /* best-effort */
    }
  }

  /* ---------------------------------------------------------------- */
  /*  status / logs                                                    */
  /* ---------------------------------------------------------------- */

  getStatus(): ConnectionStatus {
    // The `exit` event handler already cleared a dead child and appended the
    // diagnostic log line, so this just reads current state — the same
    // observable behavior as Rust's try_wait poll.
    const child = this.child;
    const running = !!child && child.exitCode === null && child.signalCode === null;
    return {
      running,
      pid: running ? child!.pid ?? null : null,
      // Tauri quirk preserved: hardcoded ports while running.
      socks_port: running ? 10808 : 0,
      http_port: running ? 10809 : 0,
    };
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  /** True while THIS manager owns a live (or grace-pending) child. */
  hasLiveChild(): boolean {
    const live = (c: ChildProcess | null) =>
      !!c && c.exitCode === null && c.signalCode === null;
    return live(this.child) || live(this.pendingChild);
  }

  /* ---------------------------------------------------------------- */
  /*  traffic (xray api statsquery)                                    */
  /* ---------------------------------------------------------------- */

  async getTraffic(apiPort: number): Promise<TrafficStats> {
    const xrayPath = findXray();
    if (!xrayPath) return { uplink: 0, downlink: 0 };
    try {
      return await queryXrayTraffic(xrayPath, apiPort, this.trafficTags);
    } catch {
      return { uplink: 0, downlink: 0 };
    }
  }
}

/**
 * Port of query_xray_traffic. Spawns `xray api statsquery -s 127.0.0.1:port`,
 * enforces the hard 1200 ms deadline (kills the helper on overrun — a blocked
 * Stats API must never pile up overlapping polls), then sums every stat whose
 * name carries one of the topology's member-tag traffic counters
 * (">>><tag>>>traffic>>>uplink" / "downlink" — default tag "proxy").
 */
async function queryXrayTraffic(
  xrayPath: string,
  apiPort: number,
  trafficTags: string[] = ["proxy"]
): Promise<TrafficStats> {
  const defaultStats = { uplink: 0, downlink: 0 };

  let child: ChildProcess;
  try {
    child = spawn(xrayPath, ["api", "statsquery", "-s", `127.0.0.1:${apiPort}`], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return defaultStats;
  }

  let outputText = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    outputText += chunk;
  });

  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });

  const timedOut = await Promise.race([
    closed.then(() => false),
    sleep(1200).then(() => true),
  ]);

  if (timedOut) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    return defaultStats;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return defaultStats;
  }

  let uplink = 0;
  let downlink = 0;
  const statArr = parsed?.stat;
  if (Array.isArray(statArr)) {
    // Phase C4: sum the counters of EVERY member tag of the connected
    // topology (single/chain -> ["proxy"]; balancer -> proxy + proxy2..N).
    // A balancer attributes each connection to exactly ONE selected member
    // (the balancer itself has no counters), so the sum never double-
    // counts; the chain carrier tag is deliberately NOT in the list (it
    // mirrors the same bytes the tunnel tag already counted — live-proven
    // in taskC4-live). Tag matching is exact-segment: ">>>proxy2>>>"
    // never matches the "proxy" pattern and vice versa.
    const upMatchers = trafficTags.map((t) => `>>>${t}>>>traffic>>>uplink`);
    const downMatchers = trafficTags.map((t) => `>>>${t}>>>traffic>>>downlink`);
    for (const item of statArr) {
      const name = typeof item?.name === "string" ? item.name : "";
      let value = 0;
      if (typeof item?.value === "number") value = item.value;
      else if (typeof item?.value === "string")
        value = parseInt(item.value, 10) || 0;

      if (upMatchers.some((m) => name.includes(m))) uplink += value;
      else if (downMatchers.some((m) => name.includes(m))) downlink += value;
    }
  }
  return { uplink, downlink };
}

/**
 * Port of first_busy_port: tries to bind 127.0.0.1:<port>; if the bind
 * fails something else is already listening there. Async because Node
 * listen() is evented. Returns the first busy port or null.
 */
async function firstBusyPortAsync(ports: number[]): Promise<number | null> {
  for (const port of ports) {
    if (!port) continue; // Rust skipped 0
    const free = await canBindAsync(port);
    if (!free) return port;
  }
  return null;
}

function canBindAsync(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    server.once("error", () => done(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => done(true));
    // Safety valve so a wedged bind can't hang the connect flow forever.
    setTimeout(() => done(false), 500).unref();
  });
}

/**
 * F9 startup-audit helper: recovers the REAL inbound ports of the last
 * connection from memento-active-config.json — the file startXray writes
 * (xray run -c <file>) and stopInternal deletes on every clean stop. So it
 * survives ONLY an unclean end (crash / force-kill), which is exactly the
 * leftover-proxy scenario: the file's ports are what the system proxy was
 * last pointed at. Covers user-configured custom ports, not just defaults.
 * Task 11: parses BOTH `port` (Xray inbounds) and `listen_port` (sing-box
 * inbounds use a different key) so the audit stays sighted after a sing-box
 * crash too. Returns [] when the file is absent (never connected, or cleaned
 * stop) — the caller then falls back to the canonical default ports.
 * Best-effort: any read/parse failure simply yields [].
 */
export function readLastActivePorts(): number[] {
  const ports: number[] = [];
  try {
    const cfgPath = path.join(dataDir(), "memento-active-config.json");
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const inbounds = parsed?.inbounds;
    if (Array.isArray(inbounds)) {
      for (const ib of inbounds) {
        const p = Number(ib?.port);
        const lp = Number(ib?.listen_port);
        if (Number.isInteger(p) && p > 0 && p <= 65535) ports.push(p);
        if (Number.isInteger(lp) && lp > 0 && lp <= 65535) ports.push(lp);
      }
    }
  } catch {
    /* no active config (or unparsable) — fall through to the sidecar */
  }
  // Task 12 F9 coverage: an AETHER connection has no config JSON (the core
  // is env-configured), so its listener ports travel in the active-core
  // SIDECAR instead (written by aether.ts at start, removed on clean stop —
  // same crash-signature lifecycle). Merge them into the audit port set so
  // a crashed Aether session's leftover system proxy is still recognized
  // as OURS and cleaned up.
  try {
    const meta = readActiveCoreMeta();
    for (const p of [meta?.socksPort, meta?.httpPort]) {
      if (Number.isInteger(p) && (p as number) > 0 && (p as number) <= 65535) {
        ports.push(p as number);
      }
    }
  } catch {
    /* best-effort */
  }
  return ports;
}

/**
 * (Task 11) The old image-wide isAnyXrayRunning / killOrphanedXray helpers
 * moved to coreOps.ts as isCoreProcessAlive / isAnyCoreRunning /
 * killAllOrphanedCores[Now] so they cover BOTH core binaries with identical
 * semantics (same /FI + /IM arguments, same 300 ms settle).
 */

export const xrayManager = new XrayManager();

// Ensure the app data dir exists early (mirrors fs::create_dir_all usage).
app.on("ready", () => {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
  } catch {
    /* ignore */
  }
});

export { XRAY_VERSION };
