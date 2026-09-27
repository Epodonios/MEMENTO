/**
 * MEMENTO — sing-box process manager (Task 11, approach B: second core).
 *
 * Mirrors xray.ts 1:1 — every F3/F9-era pattern is preserved:
 *
 *  - pendingChild + serialized start queue (F3): a spawn that has not yet
 *    passed the crash-grace check is invisible to getStatus() but can still
 *    be killed by a concurrent stop; two rapid connects can never interleave
 *    their stop/spawn/grace phases.
 *  - 900 ms grace period; if the process died, surface the LAST 8 lines of
 *    combined stdout+stderr as the error ("sing-box failed to start:\n...").
 *  - 300-line ring buffer of merged stdout/stderr, generation counter so
 *    stale readers of an older connection stop appending.
 *  - 任一时刻仅一个核心存活 is enforced one level up (cores.ts + ipc.ts
 *    stopOtherCore); this manager only ever manages its own child.
 *  - unconditional system-proxy set on start / clear on stop (same quirk
 *    as the Xray manager — the UI additionally sets it for system-proxy
 *    mode, identical to the Tauri-era behavior).
 *  - get_xray_status-equivalent reports hardcoded 10808/10809 while running.
 *
 * Differences from the Xray manager (all validated in Task 10 research):
 *  - NO auto-download: the binary is version-pinned and bundled in
 *    resources/sing-box/ (see that folder's README). A missing binary fails
 *    with a clear message instead of downloading.
 *  - spawn `sing-box run -c <config>` (no asset env needed).
 *  - traffic comes from experimental.clash_api (HTTP GET /connections with
 *    the Bearer secret captured from the generated config at start) —
 *    sing-box has NO `xray api statsquery` CLI equivalent, and clash_api +
 *    v2ray_api must never be enabled simultaneously (upstream issue #2742),
 *    so clash_api-only is a hard rule.
 *  - the active-core marker goes to the memento-active-core.json SIDECAR
 *    (sing-box rejects unknown root fields inside the config itself).
 */
import { ChildProcess, spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";
import { app } from "electron";
import { MAX_LOG_LINES, SING_BOX_VERSION, dataDir, findSingBox } from "./paths";
import {
  removeActiveCoreMeta,
  writeActiveCoreMeta,
} from "./coreOps";
import type { ConnectionStatus, TrafficStats } from "./coreTypes";
import { clearSystemProxy, setSystemProxy } from "./proxy";
import {
  adaptCoreConfigFromError,
  detectCoreVersion,
  isConfigBuildError,
  sanitizeCoreConfig,
} from "./coreCompat";
import { releaseSystemProxy, blockOnCoreExit } from "./killSwitch";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SingBoxManager {
  private child: ChildProcess | null = null;
  /** Spawned but not yet past the crash-grace period (F3 parity). */
  private pendingChild: ChildProcess | null = null;
  private configPath: string | null = null;
  /** Bearer secret for the clash_api, captured from the config at start. */
  private clashSecret: string | null = null;
  private logs: string[] = [];
  private generation = 0;
  private startQueue: Promise<unknown> = Promise.resolve();

  /* ---------------------------------------------------------------- */
  /*  start                                                            */
  /* ---------------------------------------------------------------- */

  startSingBox(
    configJson: string,
    socksPort: number,
    httpPort: number,
    apiPort: number
  ): Promise<ConnectionStatus> {
    // F3 parity: strictly one start at a time; the first call's error still
    // propagates to ITS caller.
    const run = this.startQueue.then(
      () => this.startInner(configJson, socksPort, httpPort, apiPort),
      () => this.startInner(configJson, socksPort, httpPort, apiPort)
    );
    this.startQueue = run.catch(() => {});
    return run;
  }

  private async startInner(
    configJson: string,
    socksPort: number,
    httpPort: number,
    apiPort: number
  ): Promise<ConnectionStatus> {
    this.stopInternal();

    // Resolve the bundled binary — never download (pinned distribution).
    const sbPath = findSingBox();
    if (!sbPath) {
      throw new Error(
        `sing-box v${SING_BOX_VERSION} was not found.\n` +
          `Hysteria2/TUIC configs run on the bundled sing-box core.\n` +
          `Place sing-box.exe in resources/sing-box/ — see resources/sing-box/README.md ` +
          `for the exact pinned download URL and SHA-256. Xray configs are unaffected.`
      );
    }

    // Busy-port probe incl. the clash_api port (same message as Xray).
    const busyPort = await firstBusyPortAsync([socksPort, httpPort, apiPort]);
    if (busyPort !== null) {
      throw new Error(
        `Port ${busyPort} is already in use by another program.\n` +
          `Close whatever is using it (another VPN/proxy app, or a leftover sing-box.exe in Task Manager) and try again,\n` +
          `or change the SOCKS/HTTP port in the connection settings.`
      );
    }

    // R3 task #6: same two-layer core compatibility as the xray manager —
    // L1 pre-sanitize for the detected sing-box version, then L2 the
    // error-driven adapt-and-retry (sing-box names removed/unknown fields
    // as `json: unknown field xyz`).
    const coreVer = detectCoreVersion(sbPath, "sing-box");
    const adaptNotes: string[] = [];
    {
      const pre = sanitizeCoreConfig("sing-box", coreVer.version, configJson);
      if (pre.removed.length > 0) {
        configJson = pre.configText;
        adaptNotes.push(
          `[MEMENTO] Config pre-adapted for sing-box ${coreVer.version ?? "unknown"}: removed removed-feature key(s) ${pre.removed.slice(0, 6).join(", ")}${pre.removed.length > 6 ? " …" : ""}`
        );
      }
    }

    let effectiveConfig = configJson;
    let pendingFailure: { output: string } | null = null;
    let lastReason: string | null = null;
    let winningChild: ChildProcess | null = null;
    let winningGeneration = 0;
    let winningCfgPath: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        if (!pendingFailure) break;
        const adapted = adaptCoreConfigFromError(effectiveConfig, pendingFailure.output);
        if (!adapted) break;
        effectiveConfig = adapted.configText;
        adaptNotes.push(
          `[MEMENTO] sing-box refused the config — auto-adapted for the updated core: removed ${adapted.removed.slice(0, 6).join(", ")}${adapted.removed.length > 6 ? " …" : ""}`
        );
      }

    // Write the active config + the active-core SIDECAR (same lifecycle).
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const cfgPath = path.join(dir, "memento-active-config.json");
    fs.writeFileSync(cfgPath, effectiveConfig, "utf8");
    writeActiveCoreMeta("sing-box", SING_BOX_VERSION);

    // Capture the clash_api secret from the generated config — traffic
    // polling authenticates with it (the endpoint 401s without it).
    this.clashSecret = extractClashSecret(effectiveConfig);

    // Spawn. windowsHide:true === Rust CREATE_NO_WINDOW (0x08000000).
    const myGeneration = ++this.generation;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    let child: ChildProcess;
    try {
      child = spawn(sbPath, ["run", "-c", cfgPath], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e: any) {
      removeActiveCoreMeta();
      throw new Error(`Cannot start sing-box: ${e?.message || e}`);
    }

    // Async spawn failures must never become uncaught exceptions.
    let spawnError: Error | null = null;
    child.on("error", (err: Error) => {
      spawnError = err;
    });

    // Drain stdout+stderr line-split into the crash bucket + ring buffer.
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

    // F3 parity: park in the PENDING slot until the grace check passes.
    this.pendingChild = child;
    this.configPath = cfgPath;

    await sleep(900);

    const spawnErr = spawnError as Error | null;

    if (this.pendingChild === child) this.pendingChild = null;

    const superseded = myGeneration !== this.generation;
    if (
      spawnErr ||
      superseded ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      if (!spawnErr && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill();
        } catch {
          /* best-effort */
        }
      }
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
        throw new Error(`Cannot start sing-box: ${spawnErr.message || spawnErr}`);
      }
      if (superseded && child.exitCode === null && child.signalCode === null) {
        throw new Error("Connection attempt was cancelled while starting.");
      }
      const combined = [stdoutLines.join("\n").trim(), stderrLines.join("\n").trim()]
        .filter((s) => s.length > 0)
        .join("\n");
      const reason = combined
        ? combined.split(/\r?\n/).slice(-8).join("\n")
        : `sing-box exited immediately (exit code: ${
            child.exitCode !== null
              ? child.exitCode
              : JSON.stringify(child.signalCode)
          }). The config may be invalid.`;

      // R3 task #6: one adaptation retry for config-build refusals.
      if (attempt === 0 && combined && isConfigBuildError(combined)) {
        pendingFailure = { output: combined };
        lastReason = `sing-box failed to start:\n${reason}`;
        continue;
      }

      throw new Error(`sing-box failed to start:\n${reason}`);
    }

    winningChild = child;
    winningGeneration = myGeneration;
    winningCfgPath = cfgPath;
    break;
    }

    if (!winningChild || !winningCfgPath) {
      throw new Error(
        lastReason ??
          "sing-box failed to start: the config could not be adapted automatically."
      );
    }

    const child = winningChild;
    const myGeneration = winningGeneration;
    const cfgPath = winningCfgPath;

    // Grace passed — commit the child (F3 parity with the Xray manager).
    this.child = child;
    this.configPath = cfgPath;

    this.logs = [];
    this.logs.push(`[MEMENTO] sing-box v${SING_BOX_VERSION} started (pid ${child.pid})`);
    for (const note of adaptNotes) {
      this.logs.push(note);
    }
    this.trimLogs();

    child.on("exit", (code, signal) => {
      if (myGeneration !== this.generation) return;
      if (this.child === child) {
        this.logs.push(
          `[MEMENTO] sing-box process exited (code: ${
            code !== null ? code : JSON.stringify(signal)
          }). If this keeps happening, check that your antivirus / Windows Defender is not blocking or quarantining sing-box.exe.`
        );
        this.trimLogs();
        this.child = null;
        // Phase C5 kill switch (same contract as the Xray manager): every
        // death of the current child while armed normalizes the proxy to
        // the BLOCKED state; quit-latch aware; best-effort.
        blockOnCoreExit();
      }
    });

    // Same Tauri-era quirk as the Xray manager.
    try {
      setSystemProxy(socksPort);
    } catch {
      /* best-effort */
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
    this.generation++;
    const child = this.child;
    this.child = null;
    const pending = this.pendingChild;
    this.pendingChild = null;
    for (const c of [child, pending]) {
      if (c && c.exitCode === null && c.signalCode === null) {
        try {
          c.kill();
        } catch {
          /* best-effort */
        }
      }
    }
    const cfgPath = this.configPath;
    this.configPath = null;
    this.clashSecret = null;
    if (cfgPath) {
      try {
        fs.rmSync(cfgPath, { force: true });
      } catch {
        /* best-effort */
      }
    }
    removeActiveCoreMeta();
  }

  /** Port of the stop command. Releases the proxy through the C5 kill
   *  switch (armed -> BLOCK, disarmed/quitting -> plain clear). */
  stopSingBox(): ConnectionStatus {
    this.stopInternal();
    try {
      releaseSystemProxy();
    } catch {
      /* best-effort */
    }
    return { running: false, pid: null, socks_port: 0, http_port: 0 };
  }

  cleanupOnExit(): void {
    this.stopInternal();
    try {
      clearSystemProxy();
    } catch {
      /* best-effort */
    }
  }

  /* ---------------------------------------------------------------- */
  /*  status / logs / liveness                                         */
  /* ---------------------------------------------------------------- */

  getStatus(): ConnectionStatus {
    const child = this.child;
    const running = !!child && child.exitCode === null && child.signalCode === null;
    return {
      running,
      pid: running ? child!.pid ?? null : null,
      // Same quirk as the Xray manager: hardcoded ports while running.
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

  /** Phase E1 (additive): read-only clash_api secret for the main-side
   *  connectionStats module. The secret stays INSIDE the main process —
   *  the renderer only ever receives normalized rows over the bridge. */
  getClashSecret(): string | null {
    return this.clashSecret;
  }

  /* ---------------------------------------------------------------- */
  /*  traffic (clash_api GET /connections)                             */
  /* ---------------------------------------------------------------- */

  /**
   * sing-box has no statsquery CLI, so traffic comes from the clash_api
   * HTTP endpoint that the generated config enables on the SAME api port
   * Xray uses for its Stats API. GET /connections returns CUMULATIVE
   * downloadTotal/uploadTotal — the same semantics the UI already expects
   * from `xray api statsquery`. Authenticated with the per-build secret
   * (the endpoint answers 401 without it). Same hard 1200 ms deadline as
   * the statsquery helper.
   */
  async getTraffic(apiPort: number): Promise<TrafficStats> {
    if (!this.clashSecret || !this.child) return { uplink: 0, downlink: 0 };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`http://127.0.0.1:${apiPort}/connections`, {
        headers: { Authorization: `Bearer ${this.clashSecret}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return { uplink: 0, downlink: 0 };
      const data: any = await res.json();
      const up = Number(data?.uploadTotal) || 0;
      const down = Number(data?.downloadTotal) || 0;
      return { uplink: up, downlink: down };
    } catch {
      return { uplink: 0, downlink: 0 };
    }
  }
}

/** Pulls experimental.clash_api.secret out of the generated config JSON. */
function extractClashSecret(configJson: string): string | null {
  try {
    const parsed = JSON.parse(configJson);
    const secret = parsed?.experimental?.clash_api?.secret;
    return typeof secret === "string" && secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

/** Same bind probe as the Xray manager (keeps the failure message shape). */
async function firstBusyPortAsync(ports: number[]): Promise<number | null> {
  for (const port of ports) {
    if (!port) continue;
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
    setTimeout(() => done(false), 500).unref();
  });
}

export const singBoxManager = new SingBoxManager();

// Ensure the app data dir exists early (mirrors xray.ts).
app.on("ready", () => {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
  } catch {
    /* ignore */
  }
});
