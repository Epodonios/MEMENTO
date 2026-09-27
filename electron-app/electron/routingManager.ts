/**
 * MEMENTO — routing manager (Phase B2, approved decisions D1-D7).
 *
 * The GUI-side owner of the TUN routing session — the thin wiring layer
 * the B1 modules were shaped for (routingSession.ts header: "the caller
 * (B2 manager) resolves the paths"). Responsibilities:
 *
 *   start   -> resolve the ACTIVE core's live local SOCKS inbound, build
 *              + validate + authorize the D5 request, write the session
 *              files (prepareRoutingSession) and hand
 *              `<exe> --routing-helper <requestPath>` to UAC;
 *   stop    -> write control.json { action: "stop" } — the elevated
 *              helper owns the actual teardown (D6 full teardown);
 *   status  -> the merged honest view the renderer renders: the helper's
 *              status.json + the recovery marker + the D6 system-proxy
 *              suppression mapping + the fresh kill-switch armed flag;
 *   repair  -> hand `<exe> --repair-network <sessionDir>` to UAC (the
 *              B1 identity-guarded one-shot; nothing to repair = no UAC;
 *              anti-UAC-spam: at most ONE unanswered elevation at a time);
 *   quit    -> a synchronous best-effort control stop so a real quit
 *              accelerates the helper teardown — the D6 gui-pid watchdog
 *              remains the GUARANTEED backstop for every death path.
 *
 * Phase B3 (C5/F9 fusion) — three additions:
 *   1. HEARTBEAT STALENESS: the B3 helper re-writes status.json on every
 *      probe tick (SOCKS_PROBE_INTERVAL_MS); a helper-reported LIVE state
 *      older than ROUTING_STATUS_STALE_MS is a DEAD session (crashed or
 *      killed helper) and maps to the honest "error" view + the repair
 *      path — a dead helper can never look live, a live one never dead.
 *   2. THE C5 TUN INVARIANT: every live-ness read runs the observed
 *      live -> terminal/stale transition EXACTLY ONCE into
 *      deps.onRoutingLiveLost (main.ts wires killSwitch.blockOnRoutingExit
 *      — armed users get the blocked proxy the moment the TUN can no
 *      longer be trusted). Boot-time leftovers never fire this (the F9
 *      audit owns boot); quit-time teardowns are latched out by the
 *      kill switch itself.
 *   3. getLeftoverAuditState(): the startup audit's input — recovery
 *      marker present + is the helper's last status FRESH-live.
 *
 * D6 enforcement point: while the session state is starting/connected/
 * reconnecting the system-proxy IPC writes are SUPPRESSED (the TUN
 * adapter owns system routing; WinINET writes are meaningless and would
 * only dangle). The suppression gate lives in ipc.ts and consults
 * isSystemProxySuppressed() here. Core lifecycle guards ride the same
 * signal: the TUN session tunnels into the ACTIVE core's local inbound —
 * a core start while the session is live would stopOtherCore() the very
 * upstream the tunnel feeds on, so starts REFUSE and stops fire the
 * control stop first (B2 report scope, disclosed).
 *
 * ELECTRON-FREE by construction (the routingSession/routingHelper
 * discipline): every platform path/version/exe is injected by main.ts,
 * so taskB2-fntest drives the full manager against fake deps. The
 * launcher itself is injectable; the default is the B1 launcher.
 */
import path from "path";
import {
  clampTunMtu,
  clearRecovery,
  HELPER_FLAG,
  isValidBypassCidr,
  isValidBypassDomain,
  launchElevatedHelper,
  prepareRoutingSession,
  readRecovery,
  readSessionStatus,
  REPAIR_FLAG,
  sessionBaseDir,
  SessionState,
  SessionStatus,
  TUN_INTERFACE_NAME,
  HELPER_ROLE_NAME,
  writeControlStop,
} from "./routingSession";
/* ------------------------------------------------------------------ */
/* wire types (mirrored in src/store.ts — renderer never imports this) */
/* ------------------------------------------------------------------ */

export interface RoutingStartResult {
  sessionId: string;
  sessionDir: string;
}

/** The states the renderer's pill understands. "idle" = no session at
 *  all (no status file, no recovery, nothing pending) — honest zero. */
export type RoutingViewState = SessionState | "idle";

export interface RoutingStatusView {
  /** The recovery marker is present (a session exists or existed). */
  active: boolean;
  state: RoutingViewState;
  message: string;
  enginePid: number;
  /** D5 fixed names, echoed so the renderer never hardcodes them. */
  interfaceName: string;
  helperRole: string;
  /** Fresh from appPrefs on every read (D6 input, never renderer-set). */
  killSwitchArmed: boolean;
  /** D6: true while the TUN session owns system routing. */
  suppressSystemProxy: boolean;
  sessionDir: string | null;
  updatedAtMs: number | null;
  /** R3 task #2: the elevation launcher's async outcome (UAC accepted /
   *  cancelled / failed). The renderer toasts a NEW entry exactly once
   *  (dedupe by atMs) — no more silent no-UAC mystery. */
  launchFeedback?: {
    ok: boolean;
    message: string;
    atMs: number;
  } | null;
}

export interface RoutingStopResult {
  stopped: boolean;
  state?: RoutingViewState;
  reason?: string;
}

export interface RoutingRepairResult {
  launched: boolean;
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* deps + factory                                                      */
/* ------------------------------------------------------------------ */

const LIVE_STATES: ReadonlySet<string> = new Set([
  "starting",
  "connected",
  "reconnecting",
]);

/** UAC-pending deadline: if the elevated helper produced NO evidence at
 *  all (no status write, and the recovery marker is the only trace) this
 *  long after the launch, the prompt was most likely denied/cancelled —
 *  the manager heals to honest idle instead of blocking core starts
 *  forever. SAFE by construction: a LATE-approved helper re-writes the
 *  recovery marker itself (the B1 helper repairs a missing marker) and
 *  writes its own status, so the view snaps back to reality. */
const UAC_HEAL_MS = 120_000;

/** The repair one-shot has NO status channel back to the GUI — the SAME
 *  120 s elevation budget therefore doubles as its anti-spam cooldown:
 *  one repair launch per window, and NEVER while a TUN start elevation
 *  is still unanswered (a hammered repair or connect button can never
 *  stack UAC prompts). The TUN start path needs no extra cooldown of its
 *  own: launchPending + the UAC heal above already cap it at one
 *  unanswered prompt per 120 s, and a COMPLETED session arms nothing. */
const REPAIR_COOLDOWN_MS = 120_000;

/** Phase B3: a helper-reported LIVE state whose heartbeat (status.json
 *  updatedAtMs) is older than this is a DEAD session. The B3 helper
 *  re-writes status at every probe tick (10 s + a 3 s probe deadline),
 *  so a live helper cannot go 30 s silent by construction; 3 missed
 *  heartbeats = the helper crashed or was killed. The mapping is the
 *  honest "error" view + the repair path — and, for an armed user, the
 *  once-only C5 block via onRoutingLiveLost. */
const ROUTING_STATUS_STALE_MS = 30_000;

/** 3.1.8 (field report #5): the ACTIVE server's endpoints for the TUN
 *  engine's server-bypass rules. The renderer sends the RAW server
 *  address; the MAIN process resolves domains to IPs (clean system DNS,
 *  before the adapter exists) and validates every entry — the request
 *  written behind the privilege boundary never carries raw user text. */
export interface RoutingBypassInput {
  /** The server address exactly as the connected config carries it. */
  serverHost?: string | null;
  /** Pre-resolved IPs (optional; main resolves domains itself too). */
  serverIps?: string[] | null;
}

export interface RoutingManagerDeps {
  getUserDataDir: () => string;
  getPlatform: () => string;
  /** The running exe the UAC relaunch spawns (process.execPath in prod). */
  getExePath: () => string;
  /** The ACTIVE core's live local SOCKS inbound, or null when no core
   *  is running (main.ts resolves it from the three managers). */
  getActiveSocks: () => { host: string; port: number } | null;
  /** Fresh kill-switch state on every call (killSwitch.isKillSwitchArmed). */
  isKillSwitchArmed: () => boolean;
  /** Phase B3 (C5 fusion): fired EXACTLY ONCE per observed
   *  live -> (terminal | stale) transition of the VPN Device session.
   *  main.ts wires killSwitch.blockOnRoutingExit here — the armed user's
   *  fail-closed write the moment the TUN session stops being trustworthy.
   *  Never fires on the first read after boot (the F9 audit owns boot)
   *  and never during a quit (the kill-switch quit latch no-ops it). */
  onRoutingLiveLost?: () => void;
  /** Injectable elevation launcher; default = routingSession's. */
  launchElevated?: typeof launchElevatedHelper;
  now?: () => number;
}

export interface RoutingManager {
  startRouting(tunMtuInput: unknown, bypass?: RoutingBypassInput): RoutingStartResult;
  stopRouting(): RoutingStopResult;
  getRoutingStatus(): RoutingStatusView;
  repairRouting(): RoutingRepairResult;
  /** D6: true while a live TUN session owns system routing. */
  isSystemProxySuppressed(): boolean;
  /** True when the session is live OR a launch is in flight (UAC
   *  pending) — the core start/stop guard signal. */
  isSessionLive(): boolean;
  /** Synchronous best-effort control stop. Used by the app-quit cleanup
   *  AND the core stop handlers (stop the TUN session BEFORE its
   *  upstream dies — never the reverse). Never throws. */
  requestStopBestEffort(): void;
  /** Phase B3 (F9 fusion): the startup audit's input — is there a TUN
   *  crash residue (active recovery marker), and is the helper's last
   *  status FRESH-live (an orphan elevated helper may still own a live
   *  adapter — the audit must never act against a possibly-alive
   *  session)? Best-effort: { false, false } on any read problem. */
  getLeftoverAuditState(): { markerActive: boolean; helperLiveFresh: boolean };
}

export function createRoutingManager(deps: RoutingManagerDeps): RoutingManager {
  const now = deps.now ?? Date.now;
  const launch = deps.launchElevated ?? launchElevatedHelper;

  // In-memory launch bookkeeping. lastSessionDir survives stop/start
  // cycles within one GUI lifetime; the recovery marker covers the
  // cross-restart cases (crashed GUI / crashed helper).
  let lastSessionDir: string | null = null;
  // R3 task #2: the last async elevation outcome, stamped with the time
  // it arrived so the renderer can toast it exactly once.
  let lastLaunchFeedback: { ok: boolean; message: string; atMs: number } | null = null;
  // True between a successful UAC hand-off and the helper's first
  // status write. Self-heals (see UAC_HEAL_MS) when neither a status
  // file nor evidence shows up (UAC denied/cancelled — honest idle).
  let launchPending = false;
  let lastLaunchMs = 0;
  // Anti-UAC-spam window for the repair one-shot (it has no evidence
  // channel of its own — see REPAIR_COOLDOWN_MS).
  let lastRepairLaunchMs = 0;
  // Phase B3: transition bookkeeping for the C5 TUN invariant. The FIRST
  // read after boot never fires (boot leftovers are the startup audit's
  // job); every read path funnels through observeLive so the block lands
  // exactly once per death, no matter which reader saw it first.
  let wasLive = false;
  const observeLive = (liveNow: boolean): void => {
    if (wasLive && !liveNow) {
      try {
        deps.onRoutingLiveLost?.();
      } catch {
        /* best-effort — the C5 write catches its own errors */
      }
    }
    wasLive = liveNow;
  };
  /** Phase B3: a helper-reported live state whose heartbeat is older
   *  than ROUTING_STATUS_STALE_MS is a DEAD session, not a live one. */
  const isStaleLive = (st: SessionStatus | null): boolean =>
    !!st &&
    LIVE_STATES.has(st.state) &&
    typeof st.updatedAtMs === "number" &&
    now() - st.updatedAtMs > ROUTING_STATUS_STALE_MS;
  /** The C5 transition's notion of "live": a helper-reported, FRESH live
   *  state. Deliberately NOT launchPending — a UAC dialog owns no adapter,
   *  so losing a pending launch is nothing to fail closed about. */
  const helperLiveNow = (st: SessionStatus | null): boolean =>
    !!st && !isStaleLive(st) && LIVE_STATES.has(st.state);

  const base = () => sessionBaseDir(deps.getUserDataDir());

  const current = (): {
    dir: string | null;
    st: SessionStatus | null;
    rec: ReturnType<typeof readRecovery>;
  } => {
    const rec = readRecovery(base());
    const dir =
      lastSessionDir ??
      (rec && rec.active ? path.resolve(rec.sessionDir) : null);
    const st = dir ? readSessionStatus(dir) : null;
    return { dir, st, rec };
  };

  /** Returns true when the heal FIRED (the caller must re-read current()). */
  const launchPendingHeal = (
    st: SessionStatus | null
  ): boolean => {
    if (!launchPending) return false;
    if (st && LIVE_STATES.has(st.state)) {
      launchPending = false; // the elevated helper took over
      return false;
    }
    if (st && (st.state === "disabled" || st.state === "error")) {
      launchPending = false; // the helper ran and finished — terminal
      return false;
    }
    if (!st && now() - lastLaunchMs >= UAC_HEAL_MS) {
      // UAC pending far past the deadline with NO helper evidence:
      // heal to idle and drop the marker (a late-approved helper
      // re-writes the marker itself — the B1 repair behavior).
      launchPending = false;
      clearRecovery(base());
      return true;
    }
    return false;
  };

  const manager: RoutingManager = {
    startRouting(tunMtuInput: unknown, bypass?: RoutingBypassInput): RoutingStartResult {
      if (deps.getPlatform() !== "win32") {
        throw new Error(
          "VPN Device (TUN) routing is only implemented on Windows — the MementoTun adapter and the elevated helper require win32."
        );
      }

      const { st, rec } = current();
      launchPendingHeal(st);
      const liveNow = (st && LIVE_STATES.has(st.state)) || launchPending;
      if (liveNow) {
        throw new Error(
          "A VPN Device (TUN) session is already active — disconnect it first."
        );
      }

      const socks = deps.getActiveSocks();
      if (!socks) {
        throw new Error(
          "No active core to tunnel into — connect in SOCKS mode first; the VPN Device routes system traffic into the active core's local inbound."
        );
      }

      // 3.1.8 (field report #5): the ACTIVE server's endpoints for the
      // engine's server-bypass rules. The IPC layer resolved the domain
      // to IPs BEFORE this call (async dns lookup on clean system DNS —
      // the manager itself stays synchronous + ELECTRON-FREE). Every
      // entry is re-validated here: the request file is read by an
      // elevated process, so nothing unsound may ride along.
      const bypassDomains: string[] = [];
      const bypassCidrs: string[] = [];
      const rawHost = String(bypass?.serverHost ?? "").trim().toLowerCase();
      if (rawHost && isValidBypassDomain(rawHost)) {
        bypassDomains.push(rawHost);
        if (rawHost.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(rawHost)) {
          // Literal-IP server address — a domain rule is useless there, the
          // CIDR rule carries the whole job.
          bypassCidrs.push(rawHost);
        }
      }
      for (const ip of Array.isArray(bypass?.serverIps) ? bypass.serverIps : []) {
        const s = String(ip ?? "").trim();
        if (s && isValidBypassCidr(s) && !bypassCidrs.includes(s) && bypassCidrs.length < 16) {
          bypassCidrs.push(s);
        }
      }

      // A crashed previous run leaves a recovery marker: hand the dir to
      // the helper for the best-effort guarded stale cleanup (B1).
      const previousSessionDir =
        rec && rec.active && rec.sessionDir ? path.resolve(rec.sessionDir) : null;

      const sessionId = `s-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const sessionDir = path.join(base(), sessionId);
      const request = {
        sessionId,
        createdAtMs: now(),
        guiPid: process.pid,
        socksHost: socks.host,
        socksPort: socks.port,
        killSwitchArmed: deps.isKillSwitchArmed(),
        tunMtu: clampTunMtu(tunMtuInput), // D7
        sessionDir,
        interfaceName: TUN_INTERFACE_NAME, // D5 fixed
        previousSessionDir,
        // 3.1.8 server-bypass — omitted entirely when empty so the request
        // file stays compatible with the pre-3.1.8 reader.
        ...(bypassDomains.length > 0 ? { bypassDomains } : {}),
        ...(bypassCidrs.length > 0 ? { bypassCidrs } : {}),
      };

      // validateRequest + authorizeRequestPath + atomic request + recovery.
      const { requestPath } = prepareRoutingSession(request, base());

      const launched = launch({
        exePath: deps.getExePath(),
        flag: HELPER_FLAG,
        arg: requestPath,
        platform: deps.getPlatform(),
        // R3 task #2: the UAC outcome is reported asynchronously. A
        // CANCELLED/failed prompt heals the manager to honest idle
        // IMMEDIATELY (no 120 s of zombie "starting") and carries the
        // exact reason to the renderer through launchFeedback.
        onResult: (r) => {
          if (r.launched) {
            lastLaunchFeedback = {
              ok: true,
              message: "Administrator approval received — the VPN Device helper is starting.",
              atMs: now(),
            };
            return;
          }
          lastLaunchFeedback = {
            ok: false,
            message: r.reason ?? "the elevation request failed",
            atMs: now(),
          };
          if (launchPending) {
            launchPending = false;
            try {
              clearRecovery(base());
            } catch {
              /* best-effort */
            }
          }
        },
      });
      if (!launched.launched) {
        // No helper will ever run — do not strand a recovery marker that
        // would make every later status look active.
        clearRecovery(base());
        throw new Error(launched.reason ?? "the elevated helper could not be launched");
      }

      lastSessionDir = sessionDir;
      launchPending = true;
      lastLaunchMs = now();
      return { sessionId, sessionDir };
    },

    stopRouting(): RoutingStopResult {
      const { dir, st } = current();
      if (!dir) {
        return { stopped: false, reason: "no VPN Device session exists" };
      }
      if (!st || !LIVE_STATES.has(st.state)) {
        return {
          stopped: false,
          state: st?.state ?? "idle",
          reason: "the VPN Device session is not live",
        };
      }
      // The helper polls control.json every HELPER_TICK_MS and performs
      // the D6 full teardown (engine down, adapter gone, recovery
      // cleared) — the GUI never kills anything itself.
      writeControlStop(dir);
      return { stopped: true, state: st.state };
    },

    getRoutingStatus(): RoutingStatusView {
      let { dir, st, rec } = current();
      if (launchPendingHeal(st)) {
        ({ dir, st, rec } = current()); // the heal dropped the marker — re-read
      }

      // Phase B3: a stale helper-reported live state is a DEAD session —
      // map it to the honest error view before anything else reads it.
      const stale = isStaleLive(st);

      let state: RoutingViewState;
      let message: string;
      let enginePid = 0;
      let updatedAtMs: number | null = null;

      if (st && stale) {
        state = "error";
        message =
          "the routing helper stopped reporting (heartbeat lost) — use network repair or start a new session";
        enginePid = st.enginePid;
        updatedAtMs = st.updatedAtMs;
      } else if (st) {
        state = st.state;
        message = st.message;
        enginePid = st.enginePid;
        updatedAtMs = st.updatedAtMs;
      } else if (launchPending) {
        state = "starting";
        message = "session prepared — waiting for the elevated helper (UAC)";
      } else if (rec && rec.active) {
        // A recovery marker with NO status file: a previous run died
        // between writing the marker and the helper's first status —
        // the crashed-session case the repair pass exists for.
        state = "error";
        message =
          "leftover session from a previous run — use network repair or start a new session";
      } else {
        state = "idle";
        message = "";
      }

      // Phase B3 (C5 fusion): the transition observation rides every
      // status read — the renderer's poll AND main.ts's watchdog both
      // funnel here, so the armed block lands exactly once per death.
      observeLive(helperLiveNow(st));

      return {
        active: !!(rec && rec.active),
        state,
        message,
        enginePid,
        interfaceName: TUN_INTERFACE_NAME,
        helperRole: HELPER_ROLE_NAME,
        killSwitchArmed: deps.isKillSwitchArmed(),
        // D6 suppression is TRUE only for helper-reported live states.
        // The manager-pending "starting" flavor (UAC dialog open, no
        // adapter yet) deliberately does NOT suppress: nothing owns
        // system routing until the elevated helper reports. A STALE live
        // state does not suppress either (Phase B3): an unconfirmed-dead
        // session must not keep the system-proxy gates locked.
        suppressSystemProxy:
          !launchPending &&
          !stale &&
          (state === "starting" || state === "connected" || state === "reconnecting"),
        sessionDir: dir,
        updatedAtMs,
        launchFeedback: lastLaunchFeedback,
      };
    },

    repairRouting(): RoutingRepairResult {
      let { dir, st, rec } = current();
      if (launchPendingHeal(st)) {
        ({ dir, st, rec } = current()); // a stale UAC pending heals like everywhere else
      }
      if (!dir && !(rec && rec.active)) {
        // Honest refusal WITHOUT a UAC prompt: there is no MEMENTO
        // network state to repair (the helper's own missing-state
        // contract, applied one step earlier).
        return { launched: false, reason: "no VPN Device state to repair" };
      }
      // Anti-UAC-spam (B2 close addendum, disclosed): the repair one-shot
      // has NO status evidence channel, so a hammered repair button would
      // queue ONE elevation prompt PER CLICK while the previous UAC dialog
      // is still unanswered. Two honest gates cap it at one unanswered
      // elevation at a time:
      //   (a) a TUN start elevation is still pending (its UAC may be up);
      //   (b) a repair launched inside the same 120 s budget as the UAC
      //       heal — the window every elevation already respects.
      // (A start right after a COMPLETED repair stays free — the gate
      // arms only on unanswered elevations, never on history.)
      if (launchPending) {
        return {
          launched: false,
          reason:
            "a VPN Device (TUN) start elevation is still pending — answer its UAC prompt (or let the 120 s heal fire) before launching a network repair.",
        };
      }
      if (now() - lastRepairLaunchMs < REPAIR_COOLDOWN_MS) {
        return {
          launched: false,
          reason:
            "a network repair was launched less than 120 s ago — answer its UAC prompt and let it finish before launching another one (repeated clicks must never queue multiple elevation prompts).",
        };
      }
      const launched = launch({
        exePath: deps.getExePath(),
        flag: REPAIR_FLAG,
        arg: dir ?? path.resolve((rec as { sessionDir: string }).sessionDir),
        platform: deps.getPlatform(),
      });
      if (launched.launched) lastRepairLaunchMs = now(); // arm the anti-spam window
      return launched.launched
        ? { launched: true }
        : { launched: false, reason: launched.reason ?? "the elevated repair could not be launched" };
    },

    isSystemProxySuppressed(): boolean {
      const { st } = current();
      // Phase B3: staleness-aware (a dead helper must not keep the D6
      // proxy gates locked) + the C5 transition observation rides here
      // too (the IPC guards read this even with no Aether tab mounted).
      const stale = isStaleLive(st);
      observeLive(helperLiveNow(st));
      return !!st && !stale && LIVE_STATES.has(st.state);
    },

    isSessionLive(): boolean {
      const { st } = current();
      launchPendingHeal(st); // a UAC-denied pending must never wedge this
      const stale = isStaleLive(st);
      // Phase B3: the transition observation rides the guard reads as
      // well — hotkey paths and core transitions run these even when no
      // renderer poll is mounted.
      observeLive(helperLiveNow(st));
      if (launchPending) return true;
      return !!st && !stale && LIVE_STATES.has(st.state);
    },

    requestStopBestEffort(): void {
      try {
        const { dir, st } = current();
        if (dir && st && LIVE_STATES.has(st.state)) {
          writeControlStop(dir);
        }
      } catch {
        /* best-effort — the gui-pid watchdog is the guaranteed backstop */
      }
    },

    getLeftoverAuditState(): { markerActive: boolean; helperLiveFresh: boolean } {
      try {
        let { st, rec } = current();
        if (launchPendingHeal(st)) {
          ({ st, rec } = current()); // a stale UAC pending heals like everywhere else
        }
        return {
          markerActive: !!(rec && rec.active),
          helperLiveFresh: helperLiveNow(st),
        };
      } catch {
        // The audit must never act on unreadable state — leave everything.
        return { markerActive: false, helperLiveFresh: false };
      }
    },
  };

  return manager;
}

/** Test/inspection surface: the D5 identity the manager always stamps. */
export const ROUTING_MANAGER_CONSTANTS = {
  interfaceName: TUN_INTERFACE_NAME,
  helperRole: HELPER_ROLE_NAME,
} as const;
