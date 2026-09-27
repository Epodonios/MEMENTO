/**
 * MEMENTO — real URL-test (Phase C2, item 3): measure ACTUAL end-to-end
 * HTTP latency through a core, the v2rayN "real delay" semantics.
 *
 * Two probe modes, one command (`url_test`):
 *
 *  1. INSTANCE mode — { configJson }: the renderer generated a MEMENTO
 *     config for the target server (same generators as connect, including
 *     the C1 fragment dialer when enabled — the test then measures the
 *     fragmented path exactly as the user would run it). This module
 *     allocates a free ephemeral port, REWRITES the config's socks inbound
 *     to it (our own documented shapes only), strips every non-socks
 *     inbound (http/api would collide with a live session), spawns a
 *     TEMPORARY core instance (xray or sing-box — configs are never
 *     Aether; cores.ts routes configs only between the first two), waits
 *     for the port, runs one proxied HTTP GET, and kills the instance.
 *
 *     Isolation rules (hard-won, obeyed strictly):
 *       - the temp instance is spawned DIRECTLY here, never through the
 *         XrayManager/SingBoxManager — starting a probe must NOT touch the
 *         live VPN (no stopOtherCore, no system-proxy writes, no
 *         killAllOrphanedCores — that image-wide kill would murder the
 *         user's active tunnel);
 *       - the inverse is equally true: a Connect pressed mid-test runs
 *         killAllOrphanedCores, which kills this probe by image name. The
 *         probe treats any early child death as a failure ("core exited
 *         during probe") and cleans up — acceptable by design, tests are
 *         best-effort observations, a connect supersedes them;
 *       - temp configs live in os.tmpdir() (NEVER in dataDir next to
 *         memento-active-config.json — the F9 startup audit and the
 *         cleanup chain must not see probe leftovers), with a
 *         best-effort stale-file sweep older than 10 minutes on module
 *         load.
 *
 *  2. TUNNEL mode — { socksPort }: one proxied GET against an ALREADY
 *     RUNNING local inbound (the connected session's socks port, or an
 *     Aether session's). No process is spawned at all. This is the
 *     honest "how fast is the tunnel I am actually using" probe.
 *
 * The HTTP probe itself is the reviewed D1 net_check recipe, verbatim:
 * a throwaway in-memory session (a "persist:"-less partition) with
 * setProxy(fixed_servers, socks5://127.0.0.1:P) and ses.fetch() — NOT
 * net.fetch, which would ignore the per-session proxy. Latency is the
 * time to RESPONSE HEADERS of one GET through the tunnel (handshake
 * included), i.e. exactly what v2rayN's real-delay column means. Any
 * HTTP status counts as reachable (the response provably traversed the
 * tunnel); only network errors/timeouts are failures.
 */
import { ChildProcess, spawn } from "child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { session } from "electron";
import { detectCoreFromConfigJson } from "./cores";
import { findXray, findSingBox, dataDir } from "./paths";
import { URL_TEST_DEFAULT, normalizeTestUrl } from "./appPrefs";

export { URL_TEST_DEFAULT };

export interface UrlTestOutcome {
  ok: boolean;
  /** Milliseconds to response headers through the tunnel; null on failure. */
  ms: number | null;
  error?: string;
  /** Instance mode only: which core binary served the probe. */
  core?: "xray" | "sing-box";
  mode: "instance" | "tunnel";
}

/** App-owned ports the ephemeral allocator must never hand out. */
const RESERVED_PORTS = new Set([10808, 10809, 10850, 1819]);

const CONFIG_MAX_BYTES = 256 * 1024;
const PORT_WAIT_MS = 5000;
const TEMP_PREFIX = "memento-urltest-";

/* ------------------------------------------------------------------ */
/*  Free-port allocation                                               */
/* ------------------------------------------------------------------ */

function allocFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    // listen(0) = the OS hands us a genuinely free ephemeral port; we then
    // close the probe socket and race the core to bind it — the same small
    // race every proxy client accepts. Retry on the astronomically unlikely
    // collision with an app-owned fixed port.
    const srv = net.createServer();
    srv.on("error", (e) => reject(e));
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port && !RESERVED_PORTS.has(port) ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Config inbound rewrite (our own generator shapes ONLY)             */
/* ------------------------------------------------------------------ */

interface RewrittenConfig {
  json: string;
  core: "xray" | "sing-box";
}

/**
 * Rewrites the socks inbound of a MEMENTO-generated config to `port` and
 * strips every other inbound (http/api cannot share a machine with a live
 * session and are useless to a probe). Xray shape: inbounds[].protocol ===
 * "socks" with a `port` field. sing-box shape: inbounds[].type === "socks"
 * with `listen_port`. Anything else is rejected — this module never feeds
 * foreign JSON to a core.
 */
export function rewriteConfigForProbe(configJson: string, port: number): RewrittenConfig {
  if (typeof configJson !== "string" || configJson.length === 0 || configJson.length > CONFIG_MAX_BYTES) {
    throw new Error("Invalid or oversized test config");
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    throw new Error("Test config is not valid JSON");
  }
  const detected = detectCoreFromConfigJson(configJson);
  if (detected === "aether") {
    // Unreachable by construction (cores.ts: configs are never Aether) —
    // the check exists so the type system can narrow the union honestly.
    throw new Error("Aether is not a config-driven core");
  }
  const core: "xray" | "sing-box" = detected;
  const inbounds = parsed?.inbounds;
  if (!Array.isArray(inbounds) || inbounds.length === 0) {
    throw new Error("Test config has no inbounds");
  }

  let kept = 0;
  const keptInbounds: Record<string, unknown>[] = [];
  for (const ib of inbounds as Record<string, unknown>[]) {
    if (core === "xray" ? ib?.protocol === "socks" : ib?.type === "socks") {
      if (core === "xray") ib.port = port;
      else ib.listen_port = port;
      keptInbounds.push(ib);
      kept++;
    }
    // everything else (http inbound, dokodemo-door api, …) is dropped
  }
  if (kept !== 1) {
    throw new Error(kept === 0 ? "Test config has no socks inbound" : "Test config has multiple socks inbounds");
  }
  parsed.inbounds = keptInbounds;
  return { json: JSON.stringify(parsed), core };
}

/* ------------------------------------------------------------------ */
/*  The proxied GET (D1 net_check recipe, reused verbatim)             */
/* ------------------------------------------------------------------ */

async function proxiedGetMs(socksPort: number, testUrl: string, timeoutMs: number): Promise<number> {
  // "persist:"-less partition = in-memory session, thrown away after the
  // probe; one fresh session per probe so concurrent probes can never race
  // each other's setProxy (same discipline as the net_check handler).
  const ses = session.fromPartition(`urltest-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  await ses.setProxy({ mode: "fixed_servers", proxyRules: `socks5://127.0.0.1:${socksPort}` });
  const t0 = Date.now();
  const res = await ses.fetch(testUrl, { signal: AbortSignal.timeout(timeoutMs) });
  const ms = Date.now() - t0;
  // Drain the (tiny) body so the socket closes cleanly; status is NOT a
  // success criterion — any HTTP response proves the tunnel traversed.
  try { await res.arrayBuffer(); } catch { /* body read is best-effort */ }
  return ms;
}

/** Hardening wrapper: the test URL is user-configured BY DESIGN, but it
 *  still must pass the pure normalizeTestUrl rules (appPrefs) — absolute
 *  http(s), no whitespace, ≤500 chars — before it may ride a core. */
const validTestUrl = (url: unknown): url is string => normalizeTestUrl(url) !== null;

/* ------------------------------------------------------------------ */
/*  Stale temp-file sweep (crash leftovers, best-effort)               */
/* ------------------------------------------------------------------ */

function sweepStaleTempConfigs(): void {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!f.startsWith(TEMP_PREFIX) || !f.endsWith(".json")) continue;
      const p = path.join(os.tmpdir(), f);
      try {
        if (now - fs.statSync(p).mtimeMs > 10 * 60_000) fs.rmSync(p, { force: true });
      } catch { /* per-file best-effort */ }
    }
  } catch { /* tmpdir unreadable — probes still work */ }
}
sweepStaleTempConfigs();

/* ------------------------------------------------------------------ */
/*  Instance-mode plumbing                                             */
/* ------------------------------------------------------------------ */

function waitPortListening(port: number, child: ChildProcess, stderrTail: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const onExit = () => reject(new Error(`Core exited during probe.\n${stderrTail()}`));
    child.once("exit", onExit);
    const poll = () => {
      if (!child.pid) return; // exit handler owns the outcome
      const s = net.connect({ port, host: "127.0.0.1" });
      s.once("connect", () => { s.destroy(); child.off("exit", onExit); resolve(); });
      s.once("error", () => {
        s.destroy();
        if (Date.now() - t0 > PORT_WAIT_MS) {
          child.off("exit", onExit);
          reject(new Error(`Core did not open the probe port within ${PORT_WAIT_MS / 1000}s.\n${stderrTail()}`));
        } else setTimeout(poll, 100);
      });
    };
    poll();
  });
}

function killProbeChild(child: ChildProcess): void {
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
}

async function instanceProbe(configJson: string, testUrl: string, timeoutMs: number): Promise<UrlTestOutcome> {
  const port = await allocFreePort();
  const { json, core } = rewriteConfigForProbe(configJson, port);

  const binPath =
    core === "xray" ? findXray() : findSingBox();
  if (!binPath) {
    return { ok: false, ms: null, mode: "instance", error: `${core === "xray" ? "Xray" : "sing-box"} core binary not found (connect once to install it)` };
  }

  const file = path.join(os.tmpdir(), `${TEMP_PREFIX}${process.pid}-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(file, json, "utf8");

  const stderrLines: string[] = [];
  const stderrTail = () => stderrLines.slice(-6).join("\n");
  let child: ChildProcess | null = null;
  try {
    child = spawn(binPath, ["run", "-c", file], {
      env: { ...process.env, ...(core === "xray" ? { XRAY_LOCATION_ASSET: dataDir() } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stderr?.on("data", (d) => {
      stderrLines.push(String(d).trim());
      if (stderrLines.length > 32) stderrLines.shift();
    });
    child.on("error", () => { /* spawn exec failure -> exit/waitPort surfaces it */ });

    await waitPortListening(port, child, stderrTail);
    const ms = await proxiedGetMs(port, testUrl, timeoutMs);
    return { ok: true, ms, mode: "instance", core };
  } catch (err) {
    const raw = String((err as Error)?.message || err).replace(/^Error:\s*/, "");
    return { ok: false, ms: null, mode: "instance", core, error: raw };
  } finally {
    if (child) killProbeChild(child);
    try { fs.rmSync(file, { force: true }); } catch { /* best-effort */ }
  }
}

async function tunnelProbe(socksPort: number, testUrl: string, timeoutMs: number): Promise<UrlTestOutcome> {
  try {
    const ms = await proxiedGetMs(socksPort, testUrl, timeoutMs);
    return { ok: true, ms, mode: "tunnel" };
  } catch (err) {
    const raw = String((err as Error)?.message || err).replace(/^Error:\s*/, "");
    return { ok: false, ms: null, mode: "tunnel", error: raw };
  }
}

/* ------------------------------------------------------------------ */
/*  Command entry (ipc.ts)                                             */
/* ------------------------------------------------------------------ */

/**
 * The single `url_test` implementation. Exactly one of configJson /
 * socksPort must be provided; testUrl is validated here (main-side
 * hardening — renderer input is never trusted with arbitrary URLs).
 */
export async function urlTestProbe(args: {
  configJson?: unknown;
  socksPort?: unknown;
  testUrl?: unknown;
  timeoutMs?: unknown;
}): Promise<UrlTestOutcome> {
  const testUrl = typeof args?.testUrl === "string" && args.testUrl.trim() !== "" ? args.testUrl : URL_TEST_DEFAULT;
  if (!validTestUrl(testUrl)) {
    return { ok: false, ms: null, mode: args?.configJson != null ? "instance" : "tunnel", error: "Invalid test URL (http/https, no whitespace, ≤500 chars)" };
  }
  const timeoutRaw = Number(args?.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.min(30_000, Math.max(1_000, timeoutRaw)) : 10_000;

  if (args?.configJson != null) {
    if (args.socksPort != null) {
      return { ok: false, ms: null, mode: "instance", error: "Pass either configJson or socksPort, not both" };
    }
    return instanceProbe(String(args.configJson), testUrl, timeoutMs);
  }

  const portRaw = Number(args?.socksPort);
  if (!Number.isInteger(portRaw) || portRaw < 1 || portRaw > 65535) {
    return { ok: false, ms: null, mode: "tunnel", error: "url_test needs a configJson (instance probe) or a socksPort 1-65535 (tunnel probe)" };
  }
  return tunnelProbe(portRaw, testUrl, timeoutMs);
}
