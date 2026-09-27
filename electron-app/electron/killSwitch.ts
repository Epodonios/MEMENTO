/**
 * killSwitch.ts (Phase C5 — item ⑦ Kill switch)
 *
 * Fail-closed system proxy. MEMENTO tunnels through local SOCKS/HTTP
 * inbounds and steers apps via the Windows system proxy (HKCU) — there is
 * no TUN adapter and no admin requirement anywhere in the product. A WFP/
 * firewall-class kill switch is therefore out of scope BY DESIGN; what IS
 * honestly implementable — and what this module implements — is the
 * classic user-mode contract:
 *
 *   ARMED  && tunnel down  =>  system proxy is FORCED to 127.0.0.1:9
 *                              (enabled but dead — apps fail closed, the
 *                              real IP never leaks through the proxy leg)
 *   ARMED  && tunnel up    =>  proxy = the live tunnel ports (unchanged)
 *   DISARMED (any state)   =>  byte-identical legacy behavior everywhere
 *
 * The invariant holds for EVERY tunnel-down path: manual disconnect,
 * unexpected core death, and the F9 startup audit (a leftover proxy from a
 * crashed session is NORMALIZED to the blocked state instead of cleared).
 * One deliberate boundary, stated in the UI: quitting the APP always
 * restores direct access (a portable app must never strand the user's
 * internet after it is gone) — the quit latch below guarantees the exit
 * handlers cannot re-block during teardown.
 *
 * Honest limits (documented in the UI, not hidden): only apps honoring the
 * Windows system proxy are covered; apps with their own proxy settings or
 * hard-coded direct traffic bypass it; this is proxy-level fail-closing,
 * not a firewall.
 *
 * All registry writes go through proxy.ts (the single reg.exe choke
 * point); all persistence goes through appPrefs.ts (killSwitch boolean,
 * sanitized IPC patch — a compromised renderer can only ever set it to a
 * boolean, never forge the enforcement itself).
 */
import { clearSystemProxy, setBlockedSystemProxy, readProxyState, KILL_SWITCH_BLOCKED_PORT } from "./proxy";
import { loadAppPrefs } from "./appPrefs";
import { isAnyCoreRunning } from "./coreOps";

// Re-export for main.ts (the audit decision compares against the blocked
// port) — proxy.ts stays the single definition point.
export { KILL_SWITCH_BLOCKED_PORT };

/* ------------------------------------------------------------------ */
/*  Quit latch                                                         */
/* ------------------------------------------------------------------ */

/**
 * Set by main.ts on BOTH real-quit paths (before-quit + window
 * session-end) BEFORE cleanup runs. While latched:
 *   - releaseSystemProxy() degrades to a plain clear (quit restores direct)
 *   - the managers' exit handlers skip the blocked write entirely
 * so the D4 cleanup contract ("quit leaves the machine exactly as found")
 * stays byte-identical even when the kill switch is armed.
 */
let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

export function isQuitting(): boolean {
  return quitting;
}

/* ------------------------------------------------------------------ */
/*  Armed state (read-only views over appPrefs)                        */
/* ------------------------------------------------------------------ */

/** True when the user armed the kill switch. Tolerant by construction —
 *  loadAppPrefs defaults a missing/legacy field to false. */
export function isKillSwitchArmed(): boolean {
  try {
    return loadAppPrefs().killSwitch === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Choke points (the ONLY ways a tunnel-down path touches the proxy)   */
/* ------------------------------------------------------------------ */

/**
 * Replaces the plain clearSystemProxy() at every TUNNEL-DOWN call site
 * (stop_xray / stop handlers + the renderer's clear_system_proxy invoke).
 *   quitting   -> plain clear (the app is going away; never strand)
 *   armed      -> BLOCK (ProxyEnable=1 + 127.0.0.1:9)
 *   disarmed   -> plain clear (pre-C5 behavior, byte-identical)
 * Callers keep their existing best-effort try/catch — this throws nothing
 * new, it only chooses which proxy write to perform.
 */
export function releaseSystemProxy(): void {
  if (quitting) {
    clearSystemProxy();
    return;
  }
  if (isKillSwitchArmed()) {
    setBlockedSystemProxy();
    return;
  }
  clearSystemProxy();
}

/**
 * The managers' child 'exit' handlers call this on EVERY core death
 * (manual stop included — stopInternal kills the child first, then the
 * stop path releases; both writes are idempotent for the armed case).
 *   quitting -> no-op (quit cleanup owns the final state)
 *   armed    -> normalize the (now dead) tunnel proxy to the blocked state
 *   disarmed -> no-op (legacy behavior: the stale dead port stays until
 *               the stop path clears it — pre-C5 byte-identical)
 */
export function blockOnCoreExit(): void {
  if (quitting) return;
  if (!isKillSwitchArmed()) return;
  try {
    setBlockedSystemProxy();
  } catch {
    /* best-effort — same discipline as every proxy write in the managers */
  }
}

/**
 * Phase B3 (C5/F9 fusion): the TUN twin of blockOnCoreExit. Fired by the
 * routing manager (main.ts wires deps.onRoutingLiveLost = this) whenever
 * the manager OBSERVES the VPN Device session transition live -> terminal
 * or stale — the moment the TUN adapter can no longer be trusted to own
 * system routing (helper teardown, crashed engine, lost heartbeat). The
 * SAME C5 contract, applied to the TUN tunnel type:
 *   quitting -> no-op (the quit latch owns teardown; quit restores direct)
 *   armed    -> normalize the now-unprotected state to the blocked proxy
 *   disarmed -> no-op (byte-identical legacy behavior)
 * Idempotent with blockOnCoreExit (both produce the same blocked state —
 * a TUN death that also kills the upstream core fires both) and
 * best-effort like every proxy write in the app. The boot-time leftover
 * is deliberately NOT this function's job: the first read after launch
 * never counts as a transition — the F9 startup audit owns boot.
 */
export function blockOnRoutingExit(): void {
  if (quitting) return;
  if (!isKillSwitchArmed()) return;
  try {
    setBlockedSystemProxy();
  } catch {
    /* best-effort — same discipline as every proxy write in the managers */
  }
}

/* ------------------------------------------------------------------ */
/*  F9 startup audit decision                                          */
/* ------------------------------------------------------------------ */

/**
 * Pure decision for the F9 leftover-proxy audit (exported for
 * taskC5-fntest): a leftover proxy pointing at one of OUR ports (or at the
 * blocked port itself) is MEMENTO's own crash residue.
 *   armed  && ours -> "block"   (normalize to the fail-closed state — the
 *                                armed user wants blocked, not cleared)
 *   !armed && ours -> "clear"   (pre-C5 behavior, byte-identical)
 *   anything else  -> "leave"   (another app's proxy — hands off, always)
 */
export function resolveAuditAction(
  armed: boolean,
  serverPort: number,
  ourPorts: ReadonlySet<number>
): "block" | "clear" | "leave" {
  if (serverPort === KILL_SWITCH_BLOCKED_PORT || ourPorts.has(serverPort)) {
    return armed ? "block" : "clear";
  }
  return "leave";
}

/**
 * Applies the audit decision to a REAL leftover state (main.ts
 * auditLeftoverProxy). Best-effort like the audit itself.
 */
export function applyAuditAction(action: "block" | "clear" | "leave"): void {
  if (action === "block") {
    try { setBlockedSystemProxy(); } catch { /* best-effort */ }
  } else if (action === "clear") {
    try { clearSystemProxy(); } catch { /* best-effort */ }
  }
}

/* ------------------------------------------------------------------ */
/*  F9 startup audit decision — the TUN residue (Phase B3)             */
/* ------------------------------------------------------------------ */

/**
 * Pure decision for the TUN half of the startup audit (exported for
 * taskB3-fntest): a VPN Device session that died un-teardown'd (power
 * loss / force kill / helper crash) leaves the recovery marker behind.
 * For an ARMED user that marker is evidence of an interrupted PROTECTED
 * session — the fail-closed answer is to normalize the system proxy to
 * the blocked state (the same contract as the armed SOCKS leftover),
 * NEVER to clear anything:
 *   armed && marker && no fresh helper -> "block"
 *   anything else                      -> "leave"
 * The fresh-helper guard matters: an orphan elevated helper may still own
 * a live adapter — auditing against a possibly-alive session would be a
 * lie; the GUI surfaces that session and the user's disconnect/repair
 * owns the transitions. The caller (main.ts auditLeftoverRoutingSession)
 * additionally refuses when a core is running or the proxy leg is
 * already enabled — those states are owned by the existing enforcements.
 */
export function resolveRoutingAuditAction(
  armed: boolean,
  markerActive: boolean,
  helperLiveFresh: boolean
): "block" | "leave" {
  return armed && markerActive && !helperLiveFresh ? "block" : "leave";
}

/**
 * Applies the routing audit decision (main.ts auditLeftoverRoutingSession).
 * Only ever BLOCKS — this audit has no clear branch by construction.
 * Best-effort like the audit itself.
 */
export function applyRoutingAuditAction(action: "block" | "leave"): void {
  if (action === "block") {
    try { setBlockedSystemProxy(); } catch { /* best-effort */ }
  }
}

/* ------------------------------------------------------------------ */
/*  Pref-transition enforcement                                        */
/* ------------------------------------------------------------------ */

/**
 * Called by the app_prefs_set handler AFTER the patch is persisted.
 * Makes the invariant true the INSTANT the user flips the switch:
 *   arming   while no core is running -> block immediately
 *            (arming is "block me now", the UI says exactly that)
 *   arming   while a core IS running  -> nothing (the manager owns the
 *            live tunnel proxy; the invariant already holds)
 *   disarming while no core is running -> clear the proxy IF the current
 *            state is one of OURS (a tunnel port, or the blocked port) —
 *            a foreign proxy (another VPN tool) is never touched.
 *   disarming while a core IS running  -> nothing (live tunnel continues)
 */
export function enforceKillSwitchAfterPrefChange(ourPorts: ReadonlySet<number>): void {
  try {
    if (isAnyCoreRunning()) return; // live core owns the proxy either way
    const armed = isKillSwitchArmed();
    if (armed) {
      const { enabled } = readProxyState();
      if (!enabled) setBlockedSystemProxy(); // normalize to the blocked state
      return;
    }
    // Disarm: only undo a state THIS app created (our tunnel ports or the
    // blocked port) — never a foreign proxy setting.
    const { enabled, server } = readProxyState();
    if (!enabled) return;
    const m = server.match(/^127\.0\.0\.1:(\d+)$/);
    const port = m ? Number(m[1]) : NaN;
    if (port === KILL_SWITCH_BLOCKED_PORT || ourPorts.has(port)) {
      clearSystemProxy();
    }
  } catch {
    /* best-effort — a failed enforcement must never break the prefs save */
  }
}
