/**
 * MEMENTO — routing session core (Phase B1, approved decisions D1-D7).
 *
 * The NON-elevated side of the TUN routing session: fixed names (D5),
 * the TUN sing-box config builder (D1/D4/D7), the wintun spawn-integrity
 * gate (the B0 wintunPin contract: re-verify the hash — and on Windows
 * the Authenticode publisher — BEFORE the first TUN spawn), the session
 * file primitives (request/status/control/recovery, all atomic), the
 * elevation launcher and the D6 semantic mapping.
 *
 * ELECTRON-FREE by construction (the killSwitch.ts discipline): node
 * builtins only, every path/version injected by the caller. This keeps
 * the whole surface testable outside Electron (taskB1-fntest bundles it
 * directly) and keeps the B2 manager a thin wiring layer.
 *
 * D5 fixed names (frozen; the plan document was lost in the sandbox
 * rollback — the secondary name is RECONSTRUCTED as MementoTunHelper and
 * was disclosed for user approval in the B1 report):
 *   - TUN interface name:            MementoTun          (FIXED — the
 *     reference derives a per-session dynamic name; D5 deliberately
 *     pins a constant so stale-adapter detection is deterministic)
 *   - helper role identity:          MementoTunHelper
 *   - session base directory:        <userData>/MementoTunSession
 *   - recovery file:                 memento-routing-recovery.json
 *   - elevation argv:                --routing-helper <requestPath>
 *   - repair argv:                   --repair-network <sessionDir>
 *
 * D6 (frozen): kill switch ARMED + dead upstream -> status "reconnecting"
 * and the tunnel stays UP (fail-closed: auto_route keeps swallowing all
 * traffic into a dead tunnel = blocked); UNARMED -> status "restoring"
 * and full teardown (fail-open); system-proxy writes are suppressed for
 * the whole lifetime of a live TUN session; the GUI quitting (gui pid
 * gone) or an explicit control.json stop ALWAYS ends in a full teardown.
 *
 * D4 (frozen): the routing config carries REAL remote DNS (queries are
 * detoured through the tunnel, never plain-DNS from the real interface)
 * and `route.default_domain_resolver` is ALWAYS present — sing-box 1.14
 * requires it and the decision makes it mandatory by construction.
 *
 * D7 (frozen): tun_mtu defaults to 1500 and is clamped to [1280, 9000].
 */
import { createHash } from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  WINTUN_DLL_SHA256,
  WINTUN_DLL_RELATIVE_PATH,
  WINTUN_PUBLISHER,
} from "./wintunPin";

/* ------------------------------------------------------------------ */
/* D5 fixed names + session file names                                 */
/* ------------------------------------------------------------------ */

/** The TUN adapter name sing-box creates (D5: fixed, never derived). */
export const TUN_INTERFACE_NAME = "MementoTun";
/** Role identity written into every status.json by the elevated helper. */
export const HELPER_ROLE_NAME = "MementoTunHelper";
/** Session base directory UNDER userData (D5: the session directory). */
export const SESSION_BASE_DIR_NAME = "MementoTunSession";
/** Recovery marker file at the session base (D5 name). */
export const RECOVERY_FILE_NAME = "memento-routing-recovery.json";
/** Elevation flag: the GUI relaunches THIS exe elevated with it (D5). */
export const HELPER_FLAG = "--routing-helper";
/** Repair flag: an elevated one-shot network repair pass (D5). */
export const REPAIR_FLAG = "--repair-network";

export const REQUEST_FILE_NAME = "routing-request.json";
export const STATUS_FILE_NAME = "status.json";
export const CONTROL_FILE_NAME = "control.json";
export const CONFIG_FILE_NAME = "routing-config.json";
export const LOG_FILE_NAME = "routing.log";

/* ------------------------------------------------------------------ */
/* D7 MTU                                                              */
/* ------------------------------------------------------------------ */

export const TUN_MTU_DEFAULT = 1500;
export const TUN_MTU_MIN = 1280;
export const TUN_MTU_MAX = 9000;

/** D7: default 1500, clamped to the closed range [1280, 9000]. An UNSET
 *  value (null/undefined/"") folds to the DEFAULT; any other garbage
 *  (NaN, non-numeric strings) folds to a SAFE value instead of reaching
 *  sing-box. */
export function clampTunMtu(value: unknown): number {
  if (value === null || value === undefined || value === "") return TUN_MTU_DEFAULT;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return TUN_MTU_DEFAULT;
  if (n < TUN_MTU_MIN) return TUN_MTU_MIN;
  if (n > TUN_MTU_MAX) return TUN_MTU_MAX;
  return Math.round(n);
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** The request the GUI writes for the elevated helper (validate BEFORE
 *  the privilege boundary AND re-validate behind it — reference lesson:
 *  nothing unsound is ever handed to an elevated reader). */
export interface RoutingRequest {
  sessionId: string;
  createdAtMs: number;
  /** PID of the (non-elevated) GUI process — the helper exits when it dies. */
  guiPid: number;
  /** The ACTIVE core's local SOCKS inbound the tunnel forwards into. */
  socksHost: string;
  socksPort: number;
  /** D6: kill switch armed = fail-closed keep-up on upstream loss. */
  killSwitchArmed: boolean;
  tunMtu: number;
  sessionDir: string;
  interfaceName: string;
  /** A session left over by a crashed previous run (best-effort cleanup). */
  previousSessionDir?: string | null;
  /**
   * 3.1.8 (field report #5 — "TUN works on Aether but no traffic passes on
   * the VPN Connection tab"): the ACTIVE server's endpoints. Without them
   * the core's OWN traffic to its server is swallowed by auto_route and
   * loops back into the TUN -> total blackout. Aether protects itself via
   * its AETHER_ROUTE_* env vars; xray/sing-box have no such self-protection,
   * so the TUN engine must EXCLUDE the server: a `direct` outbound +
   * sniff/domain + ip_cidr rules + route_exclude_address. Domains are
   * resolved main-side BEFORE the adapter exists (clean system DNS) and
   * both lists are validated below + behind the privilege boundary.
   */
  bypassDomains?: string[];
  bypassCidrs?: string[];
}

export type SessionState =
  | "starting"
  | "connected"
  | "reconnecting"
  | "restoring"
  | "disabled"
  | "error";

export interface SessionStatus {
  state: SessionState;
  message: string;
  enginePid: number;
  role: string;
  updatedAtMs: number;
}

export interface RecoveryRecord {
  active: boolean;
  sessionDir: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Validation + path authorization                                     */
/* ------------------------------------------------------------------ */

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const HOST_RE = /^[A-Za-z0-9._-]{1,253}$/;
/** IPv4 or IPv6 (optionally CIDR-prefixed) — the server-IP exclusion list. */
const CIDR_RE = /^([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[0-9A-Fa-f:]{2,45})(?:\/(\d{1,3}))?$/;

/** Optional list fields: present -> must be a small array of clean strings. */
function validateBypassList(value: unknown, max: number, per: (s: string) => boolean): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > max) return false;
  return value.every((v) => typeof v === "string" && v.length > 0 && v.length <= 253 && per(v));
}

export function isValidBypassDomain(s: string): boolean {
  return HOST_RE.test(s);
}

export function isValidBypassCidr(s: string): boolean {
  const m = CIDR_RE.exec(s);
  if (!m) return false;
  if (m[2] !== undefined) {
    const prefix = Number(m[2]);
    if (m[1].includes(":")) return prefix <= 128; // IPv6
    return prefix <= 32; // IPv4
  }
  return true;
}

/** Returns an error string, or null when the request is sound. */
export function validateRequest(req: unknown): string | null {
  if (typeof req !== "object" || req === null) return "request is not an object";
  const r = req as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || !SESSION_ID_RE.test(r.sessionId))
    return "sessionId missing/malformed";
  if (!Number.isFinite(r.createdAtMs) || (r.createdAtMs as number) <= 0)
    return "createdAtMs missing";
  if (!Number.isInteger(r.guiPid) || (r.guiPid as number) <= 0)
    return "guiPid missing";
  if (typeof r.socksHost !== "string" || !HOST_RE.test(r.socksHost))
    return "socksHost missing/malformed";
  if (!Number.isInteger(r.socksPort) || (r.socksPort as number) < 1 || (r.socksPort as number) > 65535)
    return "socksPort out of range";
  if (typeof r.killSwitchArmed !== "boolean") return "killSwitchArmed must be boolean";
  if (typeof r.tunMtu !== "number") return "tunMtu must be a number";
  if (typeof r.sessionDir !== "string" || r.sessionDir.length < 1)
    return "sessionDir missing";
  if (r.interfaceName !== TUN_INTERFACE_NAME)
    return `interfaceName must be the fixed D5 name ${TUN_INTERFACE_NAME}`;
  // 3.1.8: the server-bypass lists are OPTIONAL — a request without them
  // (older caller) stays valid, but a MALFORMED list is refused everywhere.
  if (!validateBypassList(r.bypassDomains, 16, isValidBypassDomain))
    return "bypassDomains must be an array of clean hostnames (max 16)";
  if (!validateBypassList(r.bypassCidrs, 32, isValidBypassCidr))
    return "bypassCidrs must be an array of clean IP[/prefix] entries (max 32)";
  return null;
}

/** Privilege-boundary authorization: the request file MUST live at
 *  <base>/<sessionDirName>/<REQUEST_FILE_NAME> and the session dir MUST
 *  be a direct child of the base. Refuses every traversal — an elevated
 *  process must never read a file an unprivileged writer placed outside
 *  the session tree. Returns an error string, or null when authorized. */
export function authorizeRequestPath(
  requestPath: string,
  base: string,
  request: RoutingRequest
): string | null {
  const resolvedBase = path.resolve(base);
  const resolvedDir = path.resolve(request.sessionDir);
  const resolvedReq = path.resolve(requestPath);
  if (path.dirname(resolvedDir) !== resolvedBase)
    return "sessionDir is not a direct child of the session base";
  if (path.join(resolvedDir, REQUEST_FILE_NAME) !== resolvedReq)
    return "request path does not match <sessionDir>/routing-request.json";
  return null;
}

/* ------------------------------------------------------------------ */
/* D6 pure semantic mapping                                            */
/* ------------------------------------------------------------------ */

export const SOCKS_PROBE_INTERVAL_MS = 10_000;
export const SOCKS_FAILURE_LIMIT = 3;
export const HELPER_TICK_MS = 400;

/** D6: system-proxy writes are suppressed while a live TUN session owns
 *  the routing table (starting/connected/reconnecting). Teardown states
 *  restore normal proxy semantics. */
export function suppressSystemProxyWrites(state: SessionState): boolean {
  return state === "starting" || state === "connected" || state === "reconnecting";
}

/** D6 watchdog decision after a failed upstream probe batch:
 *  - still under the failure limit -> keep waiting (a slow start is not
 *    a failure — the budget is a deadline, not a delay);
 *  - ARMED  -> hold the tunnel UP as "reconnecting" (fail-closed);
 *  - UNARMED-> tear down as "restoring" (fail-open). */
export function watchdogOutcome(
  failures: number,
  armed: boolean
): "keep-waiting" | "hold-reconnecting" | "teardown-restoring" {
  if (failures < SOCKS_FAILURE_LIMIT) return "keep-waiting";
  return armed ? "hold-reconnecting" : "teardown-restoring";
}

/* ------------------------------------------------------------------ */
/* Session files (atomic)                                              */
/* ------------------------------------------------------------------ */

/** Write-then-rename atomicity: a reader (the elevated helper polls
 *  status.json hundreds of times) must never observe a torn JSON file. */
export function atomicWriteJson(file: string, value: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** D5: <userData>/MementoTunSession — derived identically on both sides
 *  (GUI + elevated helper share the same user profile after UAC). */
export function sessionBaseDir(userDataDir: string): string {
  return path.join(userDataDir, SESSION_BASE_DIR_NAME);
}

export function recoveryPathFor(base: string): string {
  return path.join(base, RECOVERY_FILE_NAME);
}

export function writeSessionStatus(
  sessionDir: string,
  state: SessionState,
  message: string,
  enginePid: number,
  nowMs = Date.now()
): void {
  const status: SessionStatus = {
    state,
    message,
    enginePid,
    role: HELPER_ROLE_NAME,
    updatedAtMs: nowMs,
  };
  atomicWriteJson(path.join(sessionDir, STATUS_FILE_NAME), status);
}

export function readSessionStatus(sessionDir: string): SessionStatus | null {
  const s = readJsonFile<SessionStatus>(path.join(sessionDir, STATUS_FILE_NAME));
  if (!s || typeof s.state !== "string") return null;
  return s;
}

export function writeControlStop(sessionDir: string): void {
  atomicWriteJson(path.join(sessionDir, CONTROL_FILE_NAME), { action: "stop" });
}

export function clearControl(sessionDir: string): void {
  try {
    fs.rmSync(path.join(sessionDir, CONTROL_FILE_NAME), { force: true });
  } catch {
    /* best-effort */
  }
}

export function writeRecovery(
  base: string,
  sessionDir: string,
  createdAt: string
): void {
  const rec: RecoveryRecord = { active: true, sessionDir, createdAt };
  atomicWriteJson(recoveryPathFor(base), rec);
}

export function readRecovery(base: string): RecoveryRecord | null {
  const r = readJsonFile<RecoveryRecord>(recoveryPathFor(base));
  if (!r || typeof r.sessionDir !== "string") return null;
  return r;
}

export function clearRecovery(base: string): void {
  try {
    fs.rmSync(recoveryPathFor(base), { force: true });
  } catch {
    /* best-effort */
  }
}

/** GUI-side session preparation: validate + authorize + write the request
 *  and the recovery marker. The caller (B2 manager) resolves the paths. */
export function prepareRoutingSession(
  req: RoutingRequest,
  base: string
): { requestPath: string; recoveryPath: string } {
  const invalid = validateRequest(req);
  if (invalid) throw new Error(`routing request invalid: ${invalid}`);
  const requestPath = path.join(req.sessionDir, REQUEST_FILE_NAME);
  const unauthorized = authorizeRequestPath(requestPath, base, req);
  if (unauthorized) throw new Error(`routing request unauthorized: ${unauthorized}`);
  fs.mkdirSync(req.sessionDir, { recursive: true });
  atomicWriteJson(requestPath, req);
  writeRecovery(base, req.sessionDir, req.sessionId);
  return { requestPath, recoveryPath: recoveryPathFor(base) };
}

/* ------------------------------------------------------------------ */
/* D1/D4/D7 — the TUN sing-box config builder                          */
/* ------------------------------------------------------------------ */

/** Build the routing engine config for sing-box 1.14.0 (the D1 engine).
 *  Topology: tun-in (MementoTun, auto_route+strict_route, stack mixed)
 *  -> socks outbound -> the ACTIVE core's local inbound. Domain names
 *  pass through the socks outbound (the core resolves them remotely);
 *  the DNS block exists for the resolver contract (D4): REAL remote
 *  servers, queries DETOURED through the tunnel, and
 *  route.default_domain_resolver always present.
 *
 *  3.1.8 server-bypass (field report #5): when the request carries the
 *  ACTIVE server's domains/IPs the engine additionally gets
 *    - a `direct` outbound (its sockets bind to the physical NIC via the
 *      route-level auto_detect_interface — loopback SOCKS to the core is
 *      unaffected, and the server's own packets EXIT instead of looping),
 *    - a sniff action + exact-domain rules (TLS/QUIC SNI of the server
 *      catches even polluted-DNS dial targets),
 *    - ip_cidr rules + tun route_exclude_address for the resolved IPs.
 *  Without the lists the config stays byte-identical to the pre-3.1.8
 *  shape (Aether keeps protecting itself via its AETHER_ROUTE_* env). */
export function buildTunSingboxConfig(req: RoutingRequest): Record<string, unknown> {
  const domains = Array.isArray(req.bypassDomains) ? req.bypassDomains.filter(isValidBypassDomain) : [];
  const cidrs = Array.isArray(req.bypassCidrs) ? req.bypassCidrs.filter(isValidBypassCidr) : [];
  const hasBypass = domains.length > 0 || cidrs.length > 0;

  const routeRules: Record<string, unknown>[] = [];
  const inbounds: Record<string, unknown> = {
    type: "tun",
    tag: "tun-in",
    interface_name: req.interfaceName,
    mtu: clampTunMtu(req.tunMtu),
    address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
    auto_route: true,
    strict_route: true,
    stack: "mixed",
  };

  if (hasBypass) {
    // Sniff first so a TLS/QUIC ClientHello to the server exposes its SNI
    // for the exact-domain matches below (covers non-resolvable addresses).
    routeRules.push({ action: "sniff" });
    if (domains.length > 0) {
      routeRules.push({ domain: [...domains], outbound: "direct" });
      // Sub-domains of the server host too (a CDN frontend may dial
      // <region>.<server-host>); exact match above stays first.
      const suffixes = domains.map((d) => ({ domain_suffix: "." + d, outbound: "direct" }));
      routeRules.push(...suffixes);
    }
    if (cidrs.length > 0) {
      routeRules.push({ ip_cidr: [...cidrs], outbound: "direct" });
      // Kernel-level exclusion: those IPs never even enter the adapter —
      // the strongest loop guard for the core's own dialer.
      inbounds.route_exclude_address = [...cidrs];
    }
  }

  const outbounds: Record<string, unknown>[] = [
    {
      type: "socks",
      tag: "proxy",
      server: req.socksHost,
      server_port: req.socksPort,
      version: "5",
    },
  ];
  if (hasBypass) outbounds.push({ type: "direct", tag: "direct" });

  return {
    log: { level: "warn" },
    inbounds: [inbounds],
    dns: {
      servers: [
        { type: "udp", tag: "dns-remote", server: "1.1.1.1", detour: "proxy" },
        { type: "udp", tag: "dns-remote-backup", server: "8.8.8.8", detour: "proxy" },
      ],
    },
    outbounds,
    route: {
      ...(hasBypass ? { rules: routeRules } : {}),
      final: "proxy",
      auto_detect_interface: true,
      default_domain_resolver: { server: "dns-remote" },
    },
  };
}

/* ------------------------------------------------------------------ */
/* B0 contract — the wintun spawn-integrity gate                       */
/* ------------------------------------------------------------------ */

export interface WintunGateResult {
  ok: boolean;
  reason?: string;
}

export interface WintunGateDeps {
  wintunDllPath: string;
  platform: string;
  /** Injectable for tests; default = node crypto sha256. */
  sha256File?: (file: string) => Promise<string>;
  /** Injectable for tests; default = PowerShell Authenticode on win32.
   *  Returns the signer subject, or null when the check cannot confirm. */
  runPublisherCheck?: (dllPath: string) => Promise<string | null>;
}

async function defaultSha256File(file: string): Promise<string> {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Default publisher check: a real Windows authenticodes the dll; the
 *  sandbox (linux) has no Authenticode — the pin contract explicitly
 *  scopes this leg to Windows (TESTING-CHECKLIST section 28). */
function defaultRunPublisherCheck(dllPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-AuthenticodeSignature -LiteralPath '${dllPath.replace(/'/g, "''")}').SignerCertificate.Subject`,
        ],
        { timeout: 20000 }
      );
      let out = "";
      child.stdout?.on("data", (d) => (out += String(d)));
      child.on("error", () => resolve(null));
      child.on("close", (code) => {
        if (code !== 0) return resolve(null);
        resolve(out.trim().length > 0 ? out.trim() : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** THE B1 SPAWN GATE (the wintunPin.ts contract, fulfilled): re-verify
 *  WINTUN_DLL_SHA256 before the first TUN spawn — every session, every
 *  time — and on Windows ALSO gate the Authenticode publisher. Any
 *  mismatch refuses the session BEFORE sing-box ever runs. */
export async function verifyWintunForSpawn(
  deps: WintunGateDeps
): Promise<WintunGateResult> {
  if (!fs.existsSync(deps.wintunDllPath)) {
    return {
      ok: false,
      reason:
        "wintun.dll is missing — run scripts/fetch-wintun.ps1 (Windows) or fetch-wintun.sh (sandbox/CI) to place the pinned artifact",
    };
  }
  const sha = deps.sha256File ?? defaultSha256File;
  const actual = await sha(deps.wintunDllPath);
  if (actual !== WINTUN_DLL_SHA256) {
    return {
      ok: false,
      reason: `wintun.dll integrity check FAILED (sha256 mismatch: expected ${WINTUN_DLL_SHA256}, got ${actual}) — refusing to start the TUN session with an unverified artifact`,
    };
  }
  if (deps.platform === "win32") {
    const subject = deps.runPublisherCheck
      ? await deps.runPublisherCheck(deps.wintunDllPath)
      : await defaultRunPublisherCheck(deps.wintunDllPath);
    if (!subject || !subject.includes(WINTUN_PUBLISHER)) {
      return {
        ok: false,
        reason: `wintun.dll Authenticode check FAILED (expected publisher '${WINTUN_PUBLISHER}', got '${subject ?? "none"}') — refusing the session`,
      };
    }
  }
  return { ok: true };
}

/** The dll path INSIDE a resolved resource root (the B0 placement). */
export function wintunDllPathFor(resourceRootDir: string): string {
  return path.join(resourceRootDir, WINTUN_DLL_RELATIVE_PATH);
}

/* ------------------------------------------------------------------ */
/* Elevation launcher (win32; no new dependencies)                     */
/* ------------------------------------------------------------------ */

function psQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/** The PowerShell command that relaunches the app elevated (UAC consent)
 *  with the given flag + argument. Returned as an argv array so the
 *  caller spawns it without a shell. */
export function buildElevatedLaunchArgs(
  exePath: string,
  flag: string,
  arg: string
): string[] {
  const inner = [
    "Start-Process",
    "-FilePath",
    psQuote(exePath),
    "-ArgumentList",
    `${psQuote(flag)},${psQuote(arg)}`,
    "-Verb",
    "RunAs",
  ].join(" ");
  return [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-Command",
    inner,
  ];
}

export interface ElevatedLaunchResult {
  launched: boolean;
  reason?: string;
  /** R3 task #2: true when the UAC prompt was explicitly DENIED/CANCELLED
   *  by the user (Windows error 1223) — distinct from a launch failure. */
  cancelled?: boolean;
}

/** R3 task #2 (user bug report: "هیچ UAC نمیاد که قبول یا کنسلش کنم" — the
 *  old fire-and-forget launcher gave ZERO feedback when PowerShell failed
 *  or the user cancelled): the launcher now WAITS for PowerShell to exit
 *  and reports the outcome through `onResult`:
 *    exit 0                          -> the elevation request was accepted
 *    "operation was canceled" / 1223 -> the UAC prompt was cancelled
 *    anything else                   -> the exact PowerShell error surfaces
 *  The spawn itself stays async (the UAC dialog can sit open for minutes —
 *  the MAIN PROCESS must never block on it). */
export function launchElevatedHelper(deps: {
  exePath: string;
  flag: string;
  arg: string;
  platform: string;
  spawnImpl?: typeof spawn;
  onResult?: (result: ElevatedLaunchResult) => void;
}): ElevatedLaunchResult {
  if (deps.platform !== "win32") {
    return { launched: false, reason: "elevation is only implemented on win32" };
  }
  const spawnImpl = deps.spawnImpl ?? spawn;
  try {
    const child = spawnImpl(
      "powershell.exe",
      buildElevatedLaunchArgs(deps.exePath, deps.flag, deps.arg),
      { detached: false, stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
    );
    const report = (result: ElevatedLaunchResult): void => {
      try {
        deps.onResult?.(result);
      } catch {
        /* best-effort */
      }
    };
    child.on("error", (err) => {
      report({ launched: false, reason: `elevation spawn failed: ${String(err?.message || err)}` });
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    child.on("close", (code) => {
      if (code === 0) {
        report({ launched: true });
        return;
      }
      const text = stderr.trim();
      if (
        /canceled by the user|cancelled by the user|operation was canceled|0x800704c7|\(1223\)/i.test(text)
      ) {
        report({
          launched: false,
          cancelled: true,
          reason: "The UAC prompt was cancelled — administrator approval is required for the VPN Device (TUN) adapter.",
        });
        return;
      }
      report({
        launched: false,
        reason: text
          ? `Elevation failed (PowerShell exit ${code ?? "?"}): ${text.split(/\r?\n/).slice(-3).join(" | ")}`
          : `Elevation failed (PowerShell exit ${code ?? "?"}).`,
      });
    });
    return { launched: true };
  } catch (e) {
    return { launched: false, reason: `elevation spawn failed: ${String(e)}` };
  }
}
