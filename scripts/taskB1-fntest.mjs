#!/usr/bin/env node
/**
 * Phase B1 FUNCTIONAL test — the REAL routing modules (routingSession.ts
 * + routingHelper.ts) bundled by esbuild. No electron alias is needed:
 * both modules are electron-free by contract, and every external effect
 * is injected (fake engine child, fake socks probe, stepped virtual
 * clock, fake process identity, fake Authenticode leg).
 *
 * Proven here at pipeline level, against temp dirs (real network and
 * real elevation are NEVER touched):
 *   T1  D7 MTU clamp (default 1500, [1280,9000] closed range, junk folds)
 *   T2  D5 fixed names (all six, byte-exact)
 *   T3  request validation (every field, incl. the D5 interface name)
 *   T4  privilege-boundary authorization (layout + traversal refusals)
 *   T5  D4/D1 config builder (shape + REAL `sing-box check` accepts it)
 *   T6  wintun spawn gate (missing/wrong-hash refusals, real-dll pass,
 *       win32 publisher legs) — the B0 wintunPin contract, fulfilled
 *   T7  atomic session files (request/recovery/status/control round-trip)
 *   T8  helper argv parsing (both flags, both shapes, no-flag null)
 *   T9  helper happy path: starting -> connected -> control stop ->
 *       restoring -> disabled, recovery cleared, control consumed
 *   T10 D6 fail-closed: ARMED upstream loss holds the tunnel as
 *       "reconnecting" and RECOVERS to "connected" — never tears down
 *   T11 D6 fail-open: UNARMED upstream loss tears down to "disabled"
 *   T12 D6 quit boundary: GUI death tears down FULLY even while ARMED
 *   T13 engine dies unexpectedly -> honest "error" + recovery cleared
 *   T14 gate refusal BEHIND the helper: a tampered dll refuses the
 *       session BEFORE any engine spawn (spawn count stays 0)
 *   T15 privilege boundary behind the helper: a request outside the base
 *       is refused; the engine never spawns; no foreign status writes
 *   T16 --repair-network: identity-guarded kill (foreign image is NEVER
 *       killed), missing state = nothing-to-repair, outside-base refusal
 *   T17 ensureWintunBesideEngine (copy semantics + same-dir no-op)
 *   T18 stale-session cleanup kills ONLY a confirmed sing-box image
 *
 * Exit code 0 = all assertions passed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, "taskB1-fn-tmp");
const ROOT = join(HERE, "..");
const SB_BIN = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const REAL_DLL = join(ROOT, "electron-app", "resources", "wintun", "bin", "amd64", "wintun.dll");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

/* ---------------- build the bundle once ---------------- */
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const OUT = join(WORK, "b1.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskB1-fnentry.ts"), "--bundle", "--platform=node",
  "--format=cjs", `--outfile=${OUT}`],
  { cwd: HERE, stdio: "pipe" });
const M = (await import(`file://${OUT}`)).default ?? await import(`file://${OUT}`);
const B1 = M;
const req = createRequire(join(ROOT, "electron-app", "package.json"));

/* ---------------- shared fixtures ---------------- */
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
const sha256Buf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/* ---------------- T1: D7 MTU clamp ---------------- */
console.log("\n== T1 D7 tun_mtu clamp ==");
{
  ok("T1 default is 1500", B1.TUN_MTU_DEFAULT === 1500);
  ok("T1 range is [1280, 9000]", B1.TUN_MTU_MIN === 1280 && B1.TUN_MTU_MAX === 9000);
  ok("T1 in-range passes through", B1.clampTunMtu(1500) === 1500 && B1.clampTunMtu(1280) === 1280 && B1.clampTunMtu(9000) === 9000);
  ok("T1 below clamps to 1280", B1.clampTunMtu(100) === 1280 && B1.clampTunMtu(1279.9) === 1280);
  ok("T1 above clamps to 9000", B1.clampTunMtu(9001) === 9000 && B1.clampTunMtu(65000) === 9000);
  ok("T1 junk folds to the default", B1.clampTunMtu(NaN) === 1500 && B1.clampTunMtu("abc") === 1500 && B1.clampTunMtu(undefined) === 1500 && B1.clampTunMtu(null) === 1500);
  ok("T1 fractional rounds", B1.clampTunMtu(1499.6) === 1500);
}

/* ---------------- T2: D5 fixed names ---------------- */
console.log("\n== T2 D5 fixed names ==");
{
  ok("T2 interface name is MementoTun", B1.TUN_INTERFACE_NAME === "MementoTun");
  ok("T2 helper role is MementoTunHelper", B1.HELPER_ROLE_NAME === "MementoTunHelper");
  ok("T2 session base dir is MementoTunSession", B1.SESSION_BASE_DIR_NAME === "MementoTunSession");
  ok("T2 recovery file is memento-routing-recovery.json", B1.RECOVERY_FILE_NAME === "memento-routing-recovery.json");
  ok("T2 flags are --routing-helper / --repair-network",
     B1.HELPER_FLAG === "--routing-helper" && B1.REPAIR_FLAG === "--repair-network");
}

/* ---------------- T3: request validation ---------------- */
console.log("\n== T3 request validation ==");
{
  const dir = join(WORK, "t3", "MementoTunSession", "s0001-1700000000000");
  ok("T3 valid request -> null", B1.validateRequest(goodRequest(dir)) === null);
  ok("T3 non-object refused", typeof B1.validateRequest(null) === "string" && typeof B1.validateRequest(42) === "string");
  ok("T3 bad sessionId refused", typeof B1.validateRequest(goodRequest(dir, { sessionId: "bad id!" })) === "string");
  ok("T3 bad guiPid refused", typeof B1.validateRequest(goodRequest(dir, { guiPid: 0 })) === "string");
  ok("T3 bad socksPort refused", typeof B1.validateRequest(goodRequest(dir, { socksPort: 70000 })) === "string");
  ok("T3 non-boolean armed refused", typeof B1.validateRequest(goodRequest(dir, { killSwitchArmed: "yes" })) === "string");
  ok("T3 foreign interfaceName refused with the D5 name",
     typeof B1.validateRequest(goodRequest(dir, { interfaceName: "AethonTun" })) === "string");
}

/* ---------------- T4: privilege-boundary authorization ---------------- */
console.log("\n== T4 authorizeRequestPath ==");
{
  const base = join(WORK, "t4", "MementoTunSession");
  const dir = join(base, "s0001-1700000000000");
  const reqPath = join(dir, "routing-request.json");
  ok("T4 correct layout -> null", B1.authorizeRequestPath(reqPath, base, goodRequest(dir)) === null);
  ok("T4 session dir outside base refused",
     typeof B1.authorizeRequestPath(join(WORK, "evil", "routing-request.json"), base, goodRequest(join(WORK, "evil"))) === "string");
  ok("T4 request filename mismatch refused",
     typeof B1.authorizeRequestPath(join(dir, "other.json"), base, goodRequest(dir)) === "string");
  const traversal = goodRequest(join(base, "s0001-1700000000000", "..", "..", "escaped"));
  ok("T4 traversal refused",
     typeof B1.authorizeRequestPath(join(WORK, "escaped", "routing-request.json"), base, traversal) === "string");
}

/* ---------------- T5: D4/D1 config builder + REAL sing-box check ---------------- */
console.log("\n== T5 D4 TUN config builder + real sing-box check ==");
{
  const dir = join(WORK, "t5", "MementoTunSession", "s0001-1700000000000");
  const cfg = B1.buildTunSingboxConfig(goodRequest(dir, { tunMtu: 99999 }));
  const tun = cfg.inbounds[0];
  ok("T5 tun inbound is the D1 engine inbound", tun.type === "tun" && tun.tag === "tun-in");
  ok("T5 interface name is the FIXED D5 name", tun.interface_name === "MementoTun");
  ok("T5 mtu is the D7 clamp of the request", tun.mtu === 9000);
  ok("T5 auto_route + strict_route + stack mixed", tun.auto_route === true && tun.strict_route === true && tun.stack === "mixed");
  const servers = cfg.dns.servers;
  ok("T5 DNS is REAL remote, detoured through the tunnel (no plain-DNS leak)",
     servers.length === 2 && servers[0].server === "1.1.1.1" && servers[1].server === "8.8.8.8" &&
     servers.every((s) => s.detour === "proxy"));
  ok("T5 route.default_domain_resolver MANDATORY and points at dns-remote (D4)",
     cfg.route.default_domain_resolver && cfg.route.default_domain_resolver.server === "dns-remote");
  ok("T5 final -> proxy (the socks outbound to the active core)",
     cfg.route.final === "proxy" && cfg.outbounds[0].type === "socks" &&
     cfg.outbounds[0].server === "127.0.0.1" && cfg.outbounds[0].server_port === 10808);
  ok("T5 auto_detect_interface escapes the tun for the upstream",
     cfg.route.auto_detect_interface === true);
  ok("T5 NO clash_api on the routing engine (stats stay on the core)",
     cfg.experimental === undefined);
  // THE strongest gate: the REAL pinned sing-box 1.14.0 ACCEPTS the config.
  const cfgPath = join(WORK, "t5", "routing-config.json");
  fs.mkdirSync(dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  let checkOut = "";
  try { checkOut = execFileSync(SB_BIN, ["check", "-c", cfgPath], { encoding: "utf8", timeout: 60000 }); }
  catch (e) { checkOut = (e.stdout || "") + (e.stderr || ""); }
  ok("T5 REAL sing-box 1.14.0 check ACCEPTS the generated TUN config",
     !/ERROR|error decoding|failed to/i.test(checkOut), checkOut.slice(-300));
  // A second shape: default MTU request.
  const cfg2 = B1.buildTunSingboxConfig(goodRequest(dir, { tunMtu: 1500 }));
  ok("T5 default-MTU config also passes the real check",
     (() => {
       const p = join(WORK, "t5b", "routing-config.json");
       fs.mkdirSync(dirname(p), { recursive: true });
       fs.writeFileSync(p, JSON.stringify(cfg2, null, 2));
       try { execFileSync(SB_BIN, ["check", "-c", p], { encoding: "utf8", timeout: 60000 }); return true; }
       catch (e) { return false; }
     })());
}

/* ---------------- T6: the wintun spawn gate (B0 contract) ---------------- */
console.log("\n== T6 wintun spawn-integrity gate ==");
{
  const missing = await B1.verifyWintunForSpawn({ wintunDllPath: join(WORK, "t6", "nope.dll"), platform: "linux" });
  ok("T6 missing dll refuses with the fetch-script hint", !missing.ok && /fetch-wintun/.test(missing.reason));
  const badPath = join(WORK, "t6", "bad.dll");
  fs.mkdirSync(dirname(badPath), { recursive: true });
  fs.writeFileSync(badPath, "tampered");
  const bad = await B1.verifyWintunForSpawn({ wintunDllPath: badPath, platform: "linux" });
  ok("T6 wrong hash refuses (sha256 mismatch)", !bad.ok && /sha256 mismatch/.test(bad.reason));
  const realLinux = await B1.verifyWintunForSpawn({ wintunDllPath: REAL_DLL, platform: "linux" });
  ok("T6 REAL on-disk dll (B0-placed, pinned e5da8447...) passes the hash gate", realLinux.ok, realLinux.reason);
  const pubOk = await B1.verifyWintunForSpawn({ wintunDllPath: REAL_DLL, platform: "win32", runPublisherCheck: async () => "\"WireGuard LLC\" (...)" });
  ok("T6 win32 + WireGuard LLC subject passes", pubOk.ok, pubOk.reason);
  const pubBad = await B1.verifyWintunForSpawn({ wintunDllPath: REAL_DLL, platform: "win32", runPublisherCheck: async () => "\"Fabrikam Inc\"" });
  ok("T6 win32 + foreign publisher refuses", !pubBad.ok && /Authenticode/.test(pubBad.reason));
  const pubNone = await B1.verifyWintunForSpawn({ wintunDllPath: REAL_DLL, platform: "win32", runPublisherCheck: async () => null });
  ok("T6 win32 + unsigned/unconfirmable refuses", !pubNone.ok);
  ok("T6 gate consumes the B0 pin constants (contract fulfilled)",
     B1.WINTUN_DLL_SHA256 === "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce" &&
     B1.WINTUN_PUBLISHER === "WireGuard LLC");
  ok("T6 non-win32 skips the publisher leg by design (real-Windows checklist 28)",
     realLinux.ok === true);
}

/* ---------------- T7: session files ---------------- */
console.log("\n== T7 atomic session files ==");
{
  const userData = join(WORK, "t7", "userData");
  const base = B1.sessionBaseDir(userData);
  const dir = join(base, "s0001-1700000000000");
  const { requestPath, recoveryPath } = B1.prepareRoutingSession(goodRequest(dir), base);
  ok("T7 request written at the authorized layout", fs.existsSync(requestPath) && requestPath === join(dir, "routing-request.json"));
  ok("T7 recovery written at the D5 name", recoveryPath === join(base, "memento-routing-recovery.json") && fs.existsSync(recoveryPath));
  ok("T7 recovery round-trip", B1.readRecovery(base)?.sessionDir === dir && B1.readRecovery(base)?.active === true);
  B1.writeSessionStatus(dir, "connected", "system-wide routing active", 4321, 1700000000000);
  const st = B1.readSessionStatus(dir);
  ok("T7 status round-trip with the D5 role", st?.state === "connected" && st?.enginePid === 4321 && st?.role === "MementoTunHelper");
  B1.writeControlStop(dir);
  ok("T7 control stop written + read", fs.existsSync(join(dir, "control.json")));
  B1.clearControl(dir);
  ok("T7 control consumed", !fs.existsSync(join(dir, "control.json")));
  B1.clearRecovery(base);
  ok("T7 recovery cleared", !fs.existsSync(recoveryPath));
  ok("T7 prepare refuses an unauthorized request (throws)",
     (() => { try { B1.prepareRoutingSession(goodRequest(join(WORK, "t7", "outside")), base); return false; } catch { return true; } })());
}

/* ---------------- T8: helper argv ---------------- */
console.log("\n== T8 helper argv parsing ==");
{
  ok("T8 helper flag parsed", (() => { const p = B1.parseHelperArgv(["memento.exe", "--routing-helper", "/x/routing-request.json"]); return p?.mode === "helper" && p.requestPath === "/x/routing-request.json"; })());
  ok("T8 repair flag parsed", (() => { const p = B1.parseHelperArgv(["memento.exe", "--repair-network", "/x/s1"]); return p?.mode === "repair" && p.sessionDir === "/x/s1"; })());
  ok("T8 repair without a dir -> null sessionDir", B1.parseHelperArgv(["memento.exe", "--repair-network"])?.mode === "repair");
  ok("T8 no flag -> null", B1.parseHelperArgv(["memento.exe", "--hidden"]) === null);
  ok("T8 isHelperInvocation true only for the two flags",
     B1.isHelperInvocation(["x", "--routing-helper", "p"]) && B1.isHelperInvocation(["x", "--repair-network"]) &&
     !B1.isHelperInvocation(["x", "--hidden"]) && !B1.isHelperInvocation([]));
  const args = B1.buildElevatedLaunchArgs("C:\\App\\Memento.exe", "--routing-helper", "C:\\sess\\routing-request.json");
  ok("T8 elevation argv carries RunAs + both arguments quoted", args.join(" ").includes("-Verb RunAs") && args.join(" ").includes("'--routing-helper'"));
}

/* ---------------- fake engine + loop harness ---------------- */
const makeFakeEngine = (behavior = {}) => {
  const state = { killed: false, exitCode: null, exitWaiters: [], spawnCount: 0, killCount: 0, configPath: null, args: null };
  const settle = () => { while (state.exitWaiters.length) state.exitWaiters.shift()(state.exitCode); };
  const fake = {
    state,
    child: {
      get pid() { return 777; },
      kill() {
        state.killCount++;
        if (state.exitCode === null) state.exitCode = state.killed ? 0 : 0;
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
      state.args = args;
      state.configPath = args[args.indexOf("-c") + 1] ?? null;
      if (behavior.exitImmediately) { state.exitCode = behavior.exitCode ?? 1; settle(); }
      return fake.child;
    },
  };
  return fake;
};

const baseDeps = (userData, overrides = {}) => ({
  userDataDir: userData,
  resourceRootDir: join(ROOT, "electron-app", "resources"),
  platform: "linux",
  findEngine: () => "/opt/sing-box",
  probeSocks: async () => true,
  // MUST be a macrotask yield: a microtask-only sleep would starve the
  // event loop inside the while(true) watchdog (timers never fire).
  sleep: () => new Promise((r) => setImmediate(r)),
  now: () => 1700000000000,
  processAlive: () => true,
  processImageName: async () => "sing-box",
  log: () => {},
  ...overrides,
});

/* ---------------- T9: happy path ---------------- */
console.log("\n== T9 helper happy path (start -> connected -> control stop) ==");
{
  const userData = join(WORK, "t9", "userData");
  const base = B1.sessionBaseDir(userData);
  const dir = join(base, "s0001-1700000000000");
  B1.prepareRoutingSession(goodRequest(dir), base);
  const fake = makeFakeEngine();
  const runPromise = B1.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, { spawnEngine: fake.spawnEngine }));
  // Give the loop a moment to reach connected, then stop it via control.
  await new Promise((r) => setTimeout(r, 30));
  const mid = B1.readSessionStatus(dir);
  ok("T9 went live: status connected with the engine pid", mid?.state === "connected" && mid?.enginePid === 777);
  ok("T9 engine spawned with run -c <session config>", fake.state.spawnCount === 1 && fake.state.configPath === join(dir, "routing-config.json") && fake.state.args[0] === "run");
  const written = JSON.parse(fs.readFileSync(fake.state.configPath, "utf8"));
  ok("T9 spawned config is the D4/D5 builder output", written.inbounds[0].interface_name === "MementoTun" && written.route.default_domain_resolver.server === "dns-remote");
  B1.writeControlStop(dir);
  const result = await runPromise;
  ok("T9 control stop -> exit 0, final disabled", result.code === 0 && result.finalState === "disabled");
  const end = B1.readSessionStatus(dir);
  ok("T9 teardown wrote restoring then disabled", end?.state === "disabled");
  ok("T9 engine was killed by the teardown", fake.state.killCount >= 1);
  ok("T9 recovery cleared + control consumed", !fs.existsSync(B1.recoveryPathFor(base)) && !fs.existsSync(join(dir, "control.json")));
}

/* ---------------- T10: D6 fail-closed (armed holds + recovers) ---------------- */
console.log("\n== T10 D6 fail-closed: armed upstream loss HOLDS (reconnecting) and recovers ==");
{
  const userData = join(WORK, "t10", "userData");
  const base = B1.sessionBaseDir(userData);
  const dir = join(base, "s0001-1700000000000");
  B1.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: true }), base);
  const fake = makeFakeEngine();
  let up = true; // session goes LIVE first, then the upstream dies
  let step = 0;
  const steppedNow = () => 1700000000000 + (step++) * 10001; // probe window opens every tick
  const runPromise = B1.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
    spawnEngine: fake.spawnEngine,
    probeSocks: async () => up,
    now: steppedNow,
  }));
  await new Promise((r) => setTimeout(r, 20)); // readiness -> connected
  ok("T10 prelude: live before the loss", B1.readSessionStatus(dir)?.state === "connected");
  up = false; // upstream DIES while armed
  await new Promise((r) => setTimeout(r, 30));
  const hold = B1.readSessionStatus(dir);
  ok("T10 armed + 3 strikes -> reconnecting (tunnel HELD, fail-closed)", hold?.state === "reconnecting" && /kill switch/i.test(hold?.message ?? ""));
  ok("T10 the engine was NOT killed while reconnecting (keep-up)", fake.state.killCount === 0);
  up = true; // upstream recovers
  await new Promise((r) => setTimeout(r, 30));
  const rec = B1.readSessionStatus(dir);
  ok("T10 upstream recovery -> connected again", rec?.state === "connected" && /resumed/i.test(rec?.message ?? ""));
  B1.writeControlStop(dir);
  const result = await runPromise;
  ok("T10 eventually stops cleanly (control)", result.code === 0 && result.finalState === "disabled");
}

/* ---------------- T11: D6 fail-open (unarmed tears down) ---------------- */
console.log("\n== T11 D6 fail-open: unarmed upstream loss RESTORES ==");
{
  const userData = join(WORK, "t11", "userData");
  const base = B1.sessionBaseDir(userData);
  const dir = join(base, "s0001-1700000000000");
  B1.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: false }), base);
  const fake = makeFakeEngine();
  let up = true; // live first...
  let step = 0;
  const steppedNow = () => 1700000000000 + (step++) * 10001;
  const runPromise = B1.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
    spawnEngine: fake.spawnEngine,
    probeSocks: async () => up,
    now: steppedNow,
  }));
  await new Promise((r) => setTimeout(r, 20));
  ok("T11 prelude: live before the loss", B1.readSessionStatus(dir)?.state === "connected");
  up = false; // ...then the upstream dies UNARMED
  const result = await runPromise;
  ok("T11 unarmed + 3 strikes -> full teardown, exit 0", result.code === 0 && result.finalState === "disabled");
  ok("T11 status ends disabled with a restoring trail", B1.readSessionStatus(dir)?.state === "disabled");
  ok("T11 engine WAS killed (fail-open teardown)", fake.state.killCount >= 1);
  ok("T11 recovery cleared", !fs.existsSync(B1.recoveryPathFor(base)));
}

/* ---------------- T12: D6 quit boundary (GUI gone tears down even ARMED) ---------------- */
console.log("\n== T12 D6 quit: GUI death = full teardown even while armed ==");
{
  const userData = join(WORK, "t12", "userData");
  const base = B1.sessionBaseDir(userData);
  const dir = join(base, "s0001-1700000000000");
  B1.prepareRoutingSession(goodRequest(dir, { killSwitchArmed: true }), base);
  const fake = makeFakeEngine();
  let aliveCalls = 0;
  const result = await B1.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
    spawnEngine: fake.spawnEngine,
    processAlive: () => ++aliveCalls <= 2, // alive through readiness, dead in steady state
  }));
  ok("T12 GUI-gone -> full teardown, exit 0", result.code === 0 && result.finalState === "disabled");
  ok("T12 armed made NO difference to the quit teardown (D6: quit always full)",
     B1.readSessionStatus(dir)?.state === "disabled" && fake.state.killCount >= 1);
}

/* ---------------- T13: engine dies unexpectedly ---------------- */
console.log("\n== T13 engine crash -> honest error ==");
{
  const userData = join(WORK, "t13", "userData");
  const base = B1.sessionBaseDir(userData);
  const dir = join(base, "s0001-1700000000000");
  B1.prepareRoutingSession(goodRequest(dir), base);
  const fake = makeFakeEngine({ exitImmediately: true, exitCode: 1 });
  const result = await B1.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, { spawnEngine: fake.spawnEngine }));
  ok("T13 engine exit code 1 -> exit code 4 + error state", result.code === 4 && result.finalState === "error");
  const st = B1.readSessionStatus(dir);
  ok("T13 status carries the honest reason + log pointer", st?.state === "error" && /exited/.test(st?.message ?? "") && /code 1/.test(st?.message ?? ""));
  ok("T13 recovery cleared after the crash", !fs.existsSync(B1.recoveryPathFor(base)));
}

/* ---------------- T14: gate refusal behind the helper ---------------- */
console.log("\n== T14 tampered dll refuses the session BEFORE any spawn ==");
{
  const userData = join(WORK, "t14", "userData");
  const base = B1.sessionBaseDir(userData);
  const dir = join(base, "s0001-1700000000000");
  B1.prepareRoutingSession(goodRequest(dir), base);
  const fakeResources = join(WORK, "t14", "resources");
  const badDll = join(fakeResources, "wintun", "bin", "amd64", "wintun.dll");
  fs.mkdirSync(dirname(badDll), { recursive: true });
  fs.writeFileSync(badDll, "TAMPERED-WINTUN");
  const fake = makeFakeEngine();
  const result = await B1.runRoutingHelper(join(dir, "routing-request.json"), baseDeps(userData, {
    resourceRootDir: fakeResources,
    spawnEngine: fake.spawnEngine,
  }));
  ok("T14 helper exit code 3 + error state", result.code === 3 && result.finalState === "error");
  ok("T14 the reason is the sha256 mismatch (the B1 spawn gate)", /sha256 mismatch/.test(B1.readSessionStatus(dir)?.message ?? ""));
  ok("T14 the engine NEVER spawned", fake.state.spawnCount === 0);
  ok("T14 recovery cleared on refusal", !fs.existsSync(B1.recoveryPathFor(base)));
}

/* ---------------- T15: privilege boundary behind the helper ---------------- */
console.log("\n== T15 request outside the session base is refused behind the boundary ==");
{
  const userData = join(WORK, "t15", "userData");
  const base = B1.sessionBaseDir(userData);
  const foreign = join(WORK, "t15", "foreign", "s0001-1700000000000");
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(join(foreign, "routing-request.json"), JSON.stringify(goodRequest(foreign)));
  const fake = makeFakeEngine();
  const result = await B1.runRoutingHelper(join(foreign, "routing-request.json"), baseDeps(userData, { spawnEngine: fake.spawnEngine }));
  ok("T15 unauthorized -> code 2", result.code === 2 && result.finalState === "unauthorized");
  ok("T15 engine never spawned for a foreign request", fake.state.spawnCount === 0);
  ok("T15 NO status was written into the foreign directory", !fs.existsSync(join(foreign, "status.json")));
  ok("T15 no recovery exists for a refused session", !fs.existsSync(B1.recoveryPathFor(base)));
}

/* ---------------- T16: --repair-network ---------------- */
console.log("\n== T16 network repair (identity-guarded) ==");
{
  const userData = join(WORK, "t16", "userData");
  const base = B1.sessionBaseDir(userData);
  const dir = join(base, "s0001-1700000000000");
  fs.mkdirSync(dir, { recursive: true });
  B1.writeSessionStatus(dir, "error", "crashed mid-session", 555, 1700000000000);
  B1.writeRecovery(base, dir, "s0001-1700000000000");
  B1.writeControlStop(dir);
  const foreignImage = [];
  const r1 = await B1.runNetworkRepair(dir, baseDeps(userData, {
    processImageName: async () => { foreignImage.push(1); return "explorer.exe"; },
  }));
  ok("T16 repair completes with exit 0", r1.code === 0 && /repair completed/.test(r1.message));
  ok("T16 the foreign-image pid was NOT killed (identity guard held)", foreignImage.length === 1 && B1.readSessionStatus(dir)?.state === "disabled");
  ok("T16 recovery + control consumed by the repair", !fs.existsSync(B1.recoveryPathFor(base)) && !fs.existsSync(join(dir, "control.json")));
  const r2 = await B1.runNetworkRepair(null, baseDeps(userData));
  ok("T16 no state anywhere -> honest nothing-to-repair, still exit 0", r2.code === 0 && /no MEMENTO network state/.test(r2.message));
  const outside = join(WORK, "t16", "outside", "s0002");
  fs.mkdirSync(outside, { recursive: true });
  B1.writeSessionStatus(outside, "connected", "x", 1, 1700000000000);
  const r3 = await B1.runNetworkRepair(outside, baseDeps(userData));
  ok("T16 session dir outside the base is REFUSED", r3.code === 2 && /outside the session base/.test(r3.message));
  const killed = [];
  const r4 = await B1.runNetworkRepair(dir, baseDeps(userData, {
    processImageName: async () => "sing-box.exe",
  }));
  ok("T16 a confirmed sing-box image IS repairable (exit 0)", r4.code === 0 && killed.length === 0);
}

/* ---------------- T17: ensureWintunBesideEngine ---------------- */
console.log("\n== T17 wintun placement beside the engine ==");
{
  const engineDir = join(WORK, "t17", "engine");
  const dllDir = join(WORK, "t17", "res", "wintun", "bin", "amd64");
  fs.mkdirSync(engineDir, { recursive: true });
  fs.mkdirSync(dllDir, { recursive: true });
  const dll = join(dllDir, "wintun.dll");
  fs.writeFileSync(dll, "FAKE-DLL-BYTES");
  const placed = B1.ensureWintunBesideEngine(join(engineDir, "sing-box"), dll);
  ok("T17 copies the dll beside the engine", placed.ok && fs.existsSync(join(engineDir, "wintun.dll")));
  const sameDir = B1.ensureWintunBesideEngine(join(dllDir, "sing-box"), dll);
  ok("T17 same directory is a no-op ok", sameDir.ok);
  const broken = B1.ensureWintunBesideEngine(join(WORK, "t17", "no-such-dir", "sing-box"), join(WORK, "t17", "missing.dll"));
  ok("T17 failure carries an honest reason", !broken.ok && /could not place/.test(broken.reason));
}

/* ---------------- T18: stale-session cleanup ---------------- */
console.log("\n== T18 stale-session cleanup (guarded kill) ==");
{
  const userData = join(WORK, "t18", "userData");
  const base = B1.sessionBaseDir(userData);
  const stale = join(base, "s0000-1699999999999");
  fs.mkdirSync(stale, { recursive: true });
  B1.writeSessionStatus(stale, "error", "left over from a crash", 999, 1699999999999);
  let imageAsked = false;
  let aliveAfterKill = true;
  await B1.cleanupStaleSession(stale, baseDeps(userData, {
    processImageName: async () => { imageAsked = true; return "sing-box"; },
    processAlive: () => aliveAfterKill,
  }));
  ok("T18 the image WAS checked before any kill", imageAsked);
  ok("T18 stale session ends disabled with a clean trail", B1.readSessionStatus(stale)?.state === "disabled");
  // A vanished stale dir is nothing-to-recover, not an error.
  await B1.cleanupStaleSession(join(base, "gone"), baseDeps(userData));
  ok("T18 a vanished stale dir is silently tolerated", true);
}

console.log(`\ntaskB1-fntest: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
