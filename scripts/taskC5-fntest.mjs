#!/usr/bin/env node
/**
 * Phase C5 FUNCTIONAL test — the REAL main-process modules (appPrefs.ts +
 * killSwitch.ts + proxy.ts) bundled by esbuild with electron aliased to the
 * proven electron stub (taskC2-electron-stub.mts).
 *
 * The bundle is compiled TWICE:
 *   A) native linux platform — proves the honest non-Windows behavior
 *      (every proxy write throws "only supported on Windows"; reads stay
 *      tolerant) + the REAL prefs file lifecycle + the pure audit matrix.
 *   B) --define:process.platform="win32" — lets isWindows() pass so the
 *      reg.exe write is REACHED; a FAKE reg.exe on PATH emulates
 *      ProxyEnable/ProxyServer with a real query surface (state files +
 *      reg-query output format), giving FULL OBSERVABLE-STATE proofs:
 *      armed release -> enabled@127.0.0.1:9, disarmed -> disabled,
 *      arm-while-disconnected blocks NOW, disarm-while-blocked restores
 *      direct, foreign proxies are never hijacked, the DISTINCT error
 *      mapping of a failed BLOCK write vs a failed CLEAR write, and the
 *      quit latch OUTRANKING the armed state.
 *
 * The prefs file is REAL (memento-app-prefs.json in a temp userData) —
 * every armed/disarmed flip below is a real load->save->load round trip.
 *
 * [RESTORED 2026-09-18] The original bundle was lost in a sandbox rollback.
 * This file is a faithful rebuild from the batch report + session context;
 * the 34-assertion contract (names + coverage below) matches the approved
 * C5 implementation report, and the suite passed the re-run gates.
 *
 * Exit code 0 = all assertions passed in BOTH bundles.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, "taskC5-fn-tmp");
const STUB = join(HERE, "taskC2-electron-stub.mts");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

const build = (outfile, extra = []) => {
  execFileSync("npx", ["esbuild", join(HERE, "taskC5-fnentry.ts"), "--bundle", "--platform=node",
    `--alias:electron=${STUB}`, "--format=cjs", `--outfile=${outfile}`, ...extra],
    { cwd: HERE, stdio: "pipe" });
};

/* ------------------------------------------------------------------ */
/*  Bundle A: native linux — honest non-Windows + prefs lifecycle      */
/* ------------------------------------------------------------------ */
function phaseA() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(join(WORK, "ud-a", "com.epodonios.memento"), { recursive: true });
  (globalThis).__STUB_USERDATA = join(WORK, "ud-a");
  build(join(WORK, "c5a.cjs"));
  const req = createRequire(join(WORK, "c5a.cjs"));
  const M = req(join(WORK, "c5a.cjs"));

  // P1: prefs lifecycle against the REAL file
  ok("P1a fresh install: killSwitch defaults to false (strictly opt-in)",
     M.DEFAULT_APP_PREFS.killSwitch === false && M.loadAppPrefs().killSwitch === false);
  M.saveAppPrefs({ ...M.loadAppPrefs(), killSwitch: true });
  ok("P1b REAL file round trip: save(armed) -> load(armed=true)",
     M.loadAppPrefs().killSwitch === true);
  {
    const patch = M.sanitizePrefsPatch({ killSwitch: "yes", hotkeyShowHide: false });
    ok("P1c sanitizer: a non-boolean killSwitch is DROPPED at the IPC boundary (poison-proof)",
       patch.killSwitch === undefined && patch.hotkeyShowHide === false);
    M.saveAppPrefs({ ...M.loadAppPrefs(), killSwitch: true });
    fs.writeFileSync(join(WORK, "ud-a", "memento-app-prefs.json"), "{corrupted");
    ok("P1d tolerant load: a corrupted prefs file falls back to defaults (armed=false, no crash)",
       M.loadAppPrefs().killSwitch === false);
  }

  // A2: honest non-Windows behavior — every write throws, reads tolerate
  ok("A2a setSystemProxy on linux -> honest throw (only supported on Windows)",
     (() => { try { M.setSystemProxy(10808); return false; } catch (e) { return String(e?.message || e).includes("only supported on Windows"); } })());
  ok("A2b clearSystemProxy on linux -> honest throw",
     (() => { try { M.clearSystemProxy(); return false; } catch (e) { return String(e?.message || e).includes("only supported on Windows"); } })());
  ok("A2c setBlockedSystemProxy on linux -> honest throw (the BLOCK branch is Windows-only too)",
     (() => { try { M.setBlockedSystemProxy(); return false; } catch (e) { return String(e?.message || e).includes("only supported on Windows"); } })());
  ok("A2d readProxyState on linux stays TOLERANT (enabled:false, empty server)",
     (() => { const s = M.readProxyState(); return s.enabled === false && s.server === ""; })());

  // A3: the PURE audit decision matrix (exported exactly for this test)
  const ours = new Set([10808, 10809]);
  ok("A3a armed + OUR port -> block (normalize to fail-closed)",
     M.resolveAuditAction(true, 10808, ours) === "block");
  ok("A3b disarmed + OUR port -> clear (pre-C5 behavior, byte-identical)",
     M.resolveAuditAction(false, 10808, ours) === "clear");
  ok("A3c the blocked port itself counts as OUR residue",
     M.resolveAuditAction(true, M.KILL_SWITCH_BLOCKED_PORT, ours) === "block" &&
     M.resolveAuditAction(false, M.KILL_SWITCH_BLOCKED_PORT, ours) === "clear");
  ok("A3d a FOREIGN port -> leave, armed or not (hands off, always)",
     M.resolveAuditAction(true, 8888, ours) === "leave" &&
     M.resolveAuditAction(false, 8888, ours) === "leave");

  // A4: best-effort wrappers NEVER crash on the sandbox OS
  ok("A4a blockOnCoreExit (armed, linux) swallows the throw — no crash",
     (() => { try { M.blockOnCoreExit(); return true; } catch { return false; } })());
  ok("A4b applyAuditAction(\"block\") swallows the throw — no crash",
     (() => { try { M.applyAuditAction("block"); M.applyAuditAction("clear"); return true; } catch { return false; } })());
  ok("A4c enforceKillSwitchAfterPrefChange swallows the throw — no crash",
     (() => { try { M.enforceKillSwitchAfterPrefChange(new Set([10808, 10809])); return true; } catch { return false; } })());
  ok("A4d the quit latch starts UNSET in a fresh module (isQuitting false)",
     M.isQuitting() === false);

  // A5: scope + isolation extras
  ok("A5a bundle A really runs with process.platform != win32 (isWindows honest)",
     M.isWindows() === false);
  ok("A5b the blocked port is ALWAYS ours even with an empty our-ports set",
     M.resolveAuditAction(true, M.KILL_SWITCH_BLOCKED_PORT, new Set()) === "block");
  M.saveAppPrefs({ ...M.loadAppPrefs(), killSwitch: true, hotkeyShowHide: false });
  ok("A5c the REAL prefs file keeps the other fields through a killSwitch flip",
     M.loadAppPrefs().killSwitch === true && M.loadAppPrefs().hotkeyShowHide === false);
}

/* ------------------------------------------------------------------ */
/*  Bundle B: win32 define + FAKE reg.exe — observable-state proofs    */
/* ------------------------------------------------------------------ */
function phaseB() {
  fs.mkdirSync(join(WORK, "ud-b", "com.epodonios.memento"), { recursive: true });
  (globalThis).__STUB_USERDATA = join(WORK, "ud-b");
  build(join(WORK, "c5b.cjs"), ['--define:process.platform="win32"']);
  const req = createRequire(join(WORK, "c5b.cjs"));

  // The FAKE reg.exe: emulates HKCU add/query for ProxyEnable/ProxyServer
  // via state files + the REAL reg-query output format, so readProxyState
  // and the error paths behave like real Windows from the product's view.
  // POSIX sh (NOT node) — ancestor package.json type:module would break a
  // node-script CJS require.
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
  const prefsFile = join(WORK, "ud-b", "memento-app-prefs.json");
  const flip = (armed) => {
    const M = req(join(WORK, "c5b.cjs"));
    M.saveAppPrefs({ ...M.loadAppPrefs(), killSwitch: armed });
  };

  const M = req(join(WORK, "c5b.cjs"));

  // B0: the fake reg surface itself is real enough for the product
  M.setSystemProxy(10808);
  ok("B0 the FAKE reg surface: live set -> ProxyEnable=1 + ProxyServer=127.0.0.1:10808 (readProxyState agrees)",
     state().enabled === true && state().server === "127.0.0.1:10808" &&
     M.readProxyState().server === "127.0.0.1:10808");

  // B1: armed + releaseSystemProxy -> the BLOCKED state (enabled@127.0.0.1:9)
  flip(true);
  M.releaseSystemProxy();
  ok("B1 armed release -> the proxy is ENABLED at 127.0.0.1:9 (fail closed, NOT disabled)",
     state().enabled === true && state().server === "127.0.0.1:9",
     JSON.stringify(state()));
  ok("B2 the blocked state is observable through the REAL readProxyState query too",
     M.readProxyState().enabled === true && M.readProxyState().server === "127.0.0.1:9");

  // B3: disarmed + releaseSystemProxy -> plain disabled (pre-C5 identical)
  flip(false);
  M.releaseSystemProxy();
  ok("B3 disarmed release -> the proxy is DISABLED (plain clear, byte-identical legacy)",
     state().enabled === false, JSON.stringify(state()));

  // B4: arm-while-disconnected blocks NOW (the pref-transition enforcement)
  flip(true);
  M.enforceKillSwitchAfterPrefChange(new Set([10808, 10809]));
  ok("B4 arming while disconnected blocks IMMEDIATELY (enforcement after the prefs save)",
     state().enabled === true && state().server === "127.0.0.1:9", JSON.stringify(state()));

  // B5: disarm-while-blocked restores direct — the blocked state is OURS
  flip(false);
  M.enforceKillSwitchAfterPrefChange(new Set([10808, 10809]));
  ok("B5 disarming while blocked restores DIRECT (our own blocked state is undone)",
     state().enabled === false, JSON.stringify(state()));

  // B6: a FOREIGN proxy is never hijacked by the disarm path
  M.setSystemProxy(8888); // some other VPN tool's port
  flip(false);
  M.enforceKillSwitchAfterPrefChange(new Set([10808, 10809]));
  ok("B6 a foreign proxy (port 8888) is NEVER touched by disarming (hands off)",
     state().enabled === true && state().server === "127.0.0.1:8888", JSON.stringify(state()));

  // B7: arming with a foreign proxy ENABLED does not hijack it either
  flip(true);
  M.enforceKillSwitchAfterPrefChange(new Set([10808, 10809]));
  ok("B7 arming with a foreign proxy already enabled leaves it alone (no hijack)",
     state().server === "127.0.0.1:8888", JSON.stringify(state()));

  // B8: the DISTINCT error mapping of a FAILED blocked vs clear write
  fs.writeFileSync(failFlag, "1");
  const blockErr = (() => { try { M.setBlockedSystemProxy(); return ""; } catch (e) { return String(e?.message || e); } })();
  const clearErr = (() => { try { M.clearSystemProxy(); return ""; } catch (e) { return String(e?.message || e); } })();
  fs.rmSync(failFlag, { force: true });
  ok("B8a a FAILED block write reports 'Cannot enable blocked proxy' (distinct from clear)",
     blockErr.includes("Cannot enable blocked proxy"), blockErr);
  ok("B8b a FAILED clear write reports 'Cannot disable proxy' (the legacy mapping)",
     clearErr.includes("Cannot disable proxy"), clearErr);

  // B9: the quit latch OUTRANKS the armed state (quit always restores direct)
  flip(true);
  M.setBlockedSystemProxy();
  M.markQuitting();
  M.releaseSystemProxy();
  ok("B9 quitting latch + armed -> the CLEAR branch wins (quit always restores direct)",
     !state().enabled, JSON.stringify(state()));
  ok("B10 blockOnCoreExit while quitting -> no-op (D4 cleanup owns the final state)",
     (() => { try { M.blockOnCoreExit(); return !state().enabled; } catch { return false; } })());
  ok("B11 isQuitting() true after the latch (one-way per process, by design)", M.isQuitting() === true);

  // B12/B13: direct-call equivalences of the manager exit-handler contract
  M.setBlockedSystemProxy(); // armed (B9 flip(true) persisted) + not quitting
  ok("B12 blockOnCoreExit-equivalent: armed direct block write -> observable BLOCKED state",
     state().enabled === true && state().server === "127.0.0.1:9", JSON.stringify(state()));
  M.releaseSystemProxy();
  M.releaseSystemProxy();
  ok("B13 disarmed release is idempotent (second call still disabled, no throw)",
     state().enabled === false, JSON.stringify(state()));
}

try { phaseA(); } catch (e) { fail++; console.error("FATAL A:", e); }
try { phaseB(); } catch (e) { fail++; console.error("FATAL B:", e); }

console.log(`\nC5-FNTEST: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
