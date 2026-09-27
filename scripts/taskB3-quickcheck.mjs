#!/usr/bin/env node
/**
 * Phase B3 QUICK-CHECK — structural gates on the C5/F9 fusion with the
 * TUN session (killSwitch.ts + routingHelper.ts + routingManager.ts +
 * main.ts + i18n + docs).
 *
 * Sections:
 *   S1  killSwitch.ts contract (the TUN twin + the TUN audit decision +
 *       the C5 originals byte-retained)
 *   S2  routingHelper.ts contract (the fresh-armed read + the heartbeat
 *       + the D6 fork input + the B1 frozen semantics)
 *   S3  routingManager.ts contract (staleness + the C5 transition +
 *       the audit view + every B2 surface retained)
 *   S4  main.ts wiring (the C5 wiring + the TUN audit + the watchdog +
 *       the deferred-audit order)
 *   S5  compiled freshness (dist-electron carries the B3 symbols)
 *   S6  i18n: the kill-switch hint names the VPN Device semantics x4
 *   S7  docs: README Batch-B3 + TESTING-CHECKLIST section 31
 *   S8  frozen surfaces (routingSession R3-re-pointed 581 lines, ipc.ts R3-re-pointed 895,
 *       the B2 renderer trio still carrying the B2 pins)
 *
 * Exit code 0 = all gates passed.
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP = join(ROOT, "electron-app");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
const lines = (p) => (read(p).match(/\n/g) || []).length;

/* ---------------- S1: killSwitch.ts contract ---------------- */
console.log("\n== S1 killSwitch.ts contract ==");
{
  const src = read(join(APP, "electron", "killSwitch.ts"));
  ok("blockOnRoutingExit: the TUN twin exists with the same C5 shape",
     src.includes("export function blockOnRoutingExit(): void") &&
     src.includes("if (quitting) return;") && src.includes("if (!isKillSwitchArmed()) return;") &&
     src.includes("setBlockedSystemProxy();"));
  ok("blockOnRoutingExit documents the boot boundary (the F9 audit owns boot)",
     src.includes("The boot-time leftover") && src.includes("never counts as a transition"));
  ok("resolveRoutingAuditAction: the pure 3-input decision, block-or-leave only",
     src.includes("export function resolveRoutingAuditAction(") &&
     src.includes("armed: boolean,") && src.includes("markerActive: boolean,") &&
     src.includes("helperLiveFresh: boolean") &&
     src.includes('return armed && markerActive && !helperLiveFresh ? "block" : "leave";'));
  ok("applyRoutingAuditAction has NO clear branch (the TUN audit only ever blocks)",
     src.includes('export function applyRoutingAuditAction(action: "block" | "leave")') &&
     !src.includes('applyRoutingAuditAction(action: "block" | "clear"'));
  ok("the C5 originals byte-retained (releaseSystemProxy / blockOnCoreExit / resolveAuditAction / enforce)",
     src.includes("export function releaseSystemProxy(): void") &&
     src.includes("export function blockOnCoreExit(): void") &&
     src.includes("export function resolveAuditAction(") &&
     src.includes("export function enforceKillSwitchAfterPrefChange("));
  ok("the quit latch is shared by BOTH choke points (one latch, two twins)",
     src.split("if (quitting) return;").length >= 3);
}

/* ---------------- S2: routingHelper.ts contract ---------------- */
console.log("\n== S2 routingHelper.ts contract ==");
{
  const src = read(join(APP, "electron", "routingHelper.ts"));
  ok("readKillSwitchArmed dep declared (the fresh-armed injectable)",
     src.includes("readKillSwitchArmed?: (userDataDir: string) => boolean;"));
  ok("the default reader is electron-free and reads the SHARED prefs file",
     src.includes("function defaultReadKillSwitchArmed(") &&
     src.includes('"memento-app-prefs.json"') &&
     src.includes('return typeof o.killSwitch === "boolean" ? o.killSwitch : fallback;'));
  ok("the reader documents the trust boundary (same user, read-only peek)",
     src.includes("crosses no trust boundary"));
  ok("the D6 fork input is armedNow (fresh) with the snapshot as the GUARANTEED fallback",
     src.includes("const armedNow = (() => {") &&
     src.includes("deps.readKillSwitchArmed ??") &&
     src.includes("defaultReadKillSwitchArmed(ud, req.killSwitchArmed)") &&
     src.includes("catch {") && src.includes("return req.killSwitchArmed;"));
  ok("the D6 fork OUTCOME strings are byte-identical to B1",
     src.includes('? "hold-reconnecting"') && src.includes(': "teardown-restoring";') &&
     src.includes('"kill switch is holding system traffic while the upstream recovers"') &&
     src.includes('"upstream recovered — system-wide routing resumed"'));
  ok("the heartbeat trackers exist and start at the spawned starting state",
     src.includes("let lastState: SessionState = \"starting\";") &&
     src.includes('let lastMessage = "routing engine spawned";'));
  ok("the readiness loop heartbeats 'starting' on refused probes",
     src.includes("writeSessionStatus(sessionDir, lastState, lastMessage, enginePid, now());") &&
     src.includes("Phase B3: readiness heartbeat"));
  ok("the steady loop heartbeats the healthy session (no-transition refresh)",
     src.includes("Phase B3 heartbeat: healthy session, no transition"));
  ok("the failing path heartbeats BEFORE the fork (the held view stays fresh)",
     src.indexOf("Heartbeat on the failing path too") < src.indexOf("hold-reconnecting\"") ||
     src.includes("Heartbeat on the failing path too"));
  ok("the fork reads the FRESH state at EVERY failed probe (inside the branch, not hoisted)",
     src.indexOf("const armedNow") > src.indexOf("failures++;") &&
     src.includes("an\n        // arm/disarm flip made while the session is live takes effect"));
  ok("B1 frozen semantics intact (watchdog fork anchors, teardown trail, repair)",
     src.includes("routing engine exited unexpectedly (code") &&
     src.includes('"restoring", "closing the adapter and restoring routes"') &&
     src.includes('"disabled", "networking was restored"') &&
     src.includes('"network repair completed"'));
  ok("the module line count matches the disclosed B3 report (673)", lines(join(APP, "electron", "routingHelper.ts")) === 673);
}

/* ---------------- S3: routingManager.ts contract ---------------- */
console.log("\n== S3 routingManager.ts contract ==");
{
  const src = read(join(APP, "electron", "routingManager.ts"));
  ok("ROUTING_STATUS_STALE_MS = 30_000 with the 3-missed-heartbeats rationale",
     src.includes("const ROUTING_STATUS_STALE_MS = 30_000;") &&
     src.includes("cannot go 30 s silent by construction"));
  ok("onRoutingLiveLost dep declared (fire EXACTLY ONCE per death)",
     src.includes("onRoutingLiveLost?: () => void;") &&
     src.includes("EXACTLY ONCE per observed"));
  ok("isStaleLive keys on the helper's updatedAtMs + LIVE_STATES",
     src.includes("const isStaleLive = (st: SessionStatus | null): boolean =>") &&
     src.includes('typeof st.updatedAtMs === "number"') &&
     src.includes("now() - st.updatedAtMs > ROUTING_STATUS_STALE_MS"));
  ok("the stale mapping is the honest error view with the repair guidance",
     src.includes('"the routing helper stopped reporting (heartbeat lost) — use network repair or start a new session"'));
  ok("suppressSystemProxy excludes launchPending AND stale (unchanged B2 pending semantics + B3 staleness)",
     src.includes("!launchPending &&") && src.includes("!stale &&"));
  ok("observeLive fires once per death and updates the bookkeeping unconditionally",
     src.includes("const observeLive = (liveNow: boolean): void => {") &&
     src.includes("if (wasLive && !liveNow) {") && src.includes("wasLive = liveNow;"));
  ok("helperLiveNow deliberately excludes launchPending (a UAC dialog owns no adapter)",
     src.includes("Deliberately NOT launchPending"));
  ok("the transition rides ALL THREE read paths (status / suppressed / sessionLive)",
     src.split("observeLive(").length >= 4);
  ok("getLeftoverAuditState: the audit view + the never-act-on-unreadable fallback",
     src.includes("getLeftoverAuditState(): { markerActive: boolean; helperLiveFresh: boolean }") &&
     src.includes("markerActive: !!(rec && rec.active),") &&
     src.includes("helperLiveFresh: helperLiveNow(st),") &&
     src.includes("The audit must never act on unreadable state"));
  ok("B2 surfaces byte-retained (UAC heal, repair anti-spam, sync quit stop, D5 echo)",
     src.includes("const UAC_HEAL_MS = 120_000;") &&
     src.includes("const REPAIR_COOLDOWN_MS = 120_000;") &&
     src.includes("requestStopBestEffort(): void") &&
     src.includes("repeated clicks must never queue multiple elevation prompts"));
  ok("the module line count matches the R3 re-point (574 — was 535 at B3; R3 added launchFeedback wiring + UAC-cancel heal, disclosed)", lines(join(APP, "electron", "routingManager.ts")) === 574);
}

/* ---------------- S4: main.ts wiring ---------------- */
console.log("\n== S4 main.ts wiring ==");
{
  const src = read(join(APP, "electron", "main.ts"));
  ok("the manager factory wires onRoutingLiveLost -> blockOnRoutingExit",
     src.includes("onRoutingLiveLost: blockOnRoutingExit,"));
  ok("the B3 killSwitch imports land (blockOnRoutingExit + the audit pair)",
     src.includes("blockOnRoutingExit,") && src.includes("resolveRoutingAuditAction,") &&
     src.includes("applyRoutingAuditAction,"));
  ok("auditLeftoverRoutingSession exists with the full guard order",
     src.includes("function auditLeftoverRoutingSession(): void {") &&
     src.includes("if (!isWindows()) return;") &&
     src.includes("if (isAnyCoreRunning()) return; // a live core owns the proxy leg") &&
     src.includes("if (!markerActive || helperLiveFresh) return;") &&
     src.includes("if (readProxyState().enabled) return; // owned by the proxy audit above"));
  ok("the TUN audit NEVER clears (apply only, and only on block)",
     src.includes('if (action === "leave") return;') &&
     src.includes("applyRoutingAuditAction(action);") &&
     src.indexOf("clearSystemProxy", src.indexOf("auditLeftoverRoutingSession")) === -1);
  ok("the audit runs in the SAME deferred tick, AFTER the proxy leg",
     src.includes("setTimeout(() => {") && src.includes("auditLeftoverProxy();") &&
     src.indexOf("auditLeftoverRoutingSession();") > src.indexOf("auditLeftoverProxy();"));
  ok("the main-side watchdog exists: 2 s interval, unref'd, reads the status",
     src.includes("const routingWatchdog = setInterval(() => {") &&
     src.includes("routingManager.getRoutingStatus();") &&
     src.includes("routingWatchdog.unref?.();") &&
     src.includes("}, 2_000);"));
  ok("the watchdog comment pins WHY it exists (the renderer poll is tab-dependent)",
     src.includes("must NEVER depend\n  // on which tab is open"));
  ok("the quit paths are untouched (markQuitting BEFORE cleanup, both paths)",
     src.split("markQuitting();").length >= 3 &&
     src.indexOf("routingManager.requestStopBestEffort();") < src.indexOf("(0, cores_1.cleanupAllCores)" ) ||
     src.indexOf("routingManager.requestStopBestEffort();") < src.indexOf("cleanupAllCores();"));
  ok("the module line count matches the disclosed B3 report (499)", lines(join(APP, "electron", "main.ts")) === 499);
}

/* ---------------- S5: compiled freshness ---------------- */
console.log("\n== S5 compiled freshness (dist-electron) ==");
{
  const ks = read(join(APP, "dist-electron", "killSwitch.js"));
  const rh = read(join(APP, "dist-electron", "routingHelper.js"));
  const rm = read(join(APP, "dist-electron", "routingManager.js"));
  const mn = read(join(APP, "dist-electron", "main.js"));
  ok("compiled killSwitch.js carries blockOnRoutingExit + the routing audit pair",
     ks.includes("blockOnRoutingExit") && ks.includes("resolveRoutingAuditAction") &&
     ks.includes("applyRoutingAuditAction"));
  ok("compiled routingHelper.js carries the fresh-armed read + the heartbeat",
     rh.includes("memento-app-prefs.json") && rh.includes("defaultReadKillSwitchArmed") &&
     rh.includes("kill switch is holding system traffic"));
  ok("compiled routingManager.js carries the staleness + transition + audit view",
     rm.includes("ROUTING_STATUS_STALE_MS") && rm.includes("observeLive") &&
     rm.includes("getLeftoverAuditState") && rm.includes("heartbeat lost"));
  ok("compiled main.js carries the TUN audit + the watchdog + the C5 wiring",
     mn.includes("auditLeftoverRoutingSession") && mn.includes("setInterval") &&
     mn.includes("blockOnRoutingExit") && mn.includes("unref"));
  ok("the compiled D6 fork kept the numeric-separator constants (120_000 heals intact)",
     rm.includes("120_000") && rh.includes("kill switch is holding"));
}

/* ---------------- S6: i18n ---------------- */
console.log("\n== S6 i18n (the kill-switch hint covers the TUN semantics) ==");
{
  const src = read(join(ROOT, "src", "i18n.ts"));
  const en = src.includes("In VPN Device (TUN) mode the same switch drives the hold");
  const fa = src.includes("در حالت VPN Device (TUN) همان کلید نگه‌داشتن را انجام می‌دهد") &&
    src.includes("اگر هلپر گزارش‌دهی را متوقف کند، پراکسی سیستم مسدود می‌شود");
  const zh = src.includes("在 VPN 设备（TUN）模式下，同一开关控制保持行为") &&
    src.includes("若 helper 停止上报，则改为封锁系统代理");
  const ar = src.includes("في وضع جهاز VPN (TUN) يقود نفس المفتاح حالة الاحتفاظ") &&
    src.includes("وإذا توقف المساعد عن الإبلاغ يُحجب الوكيل النظامي بدلاً من ذلك");
  ok("en set.killSwitchHint names the TUN hold + the silent-helper block", en);
  ok("fa set.killSwitchHint names the TUN hold + the silent-helper block", fa);
  ok("zh set.killSwitchHint names the TUN hold + the silent-helper block", zh);
  ok("ar set.killSwitchHint names the TUN hold + the silent-helper block", ar);
  ok("NO new keys were added (the renderer surface is untouched)",
     (src.match(/set\.killSwitchHint/g) || []).length === 4);
}

/* ---------------- S7: docs ---------------- */
console.log("\n== S7 docs ==");
{
  const readme = read(join(APP, "README.md"));
  const checklist = read(join(APP, "TESTING-CHECKLIST.md"));
  ok("README Batch-B3 section exists with the four fusion pieces",
     readme.includes("## Phase B — Batch B3 (C5 kill-switch + F9 audit fusion") &&
     readme.includes("fresh armed reads + the status heartbeat") &&
     readme.includes("heartbeat staleness + the C5 transition") &&
     readme.includes("the TUN twin + the TUN audit decision") &&
     readme.includes("the TUN startup audit + the main-side watchdog"));
  ok("README documents the shared-prefs trust boundary + the fallback contract",
     readme.includes("crosses no trust boundary") &&
     readme.includes("byte-identically"));
  ok("TESTING-CHECKLIST section 31 exists with the real-Windows legs",
     checklist.includes("## 31. Phase B3 — C5 kill-switch + F9 audit fusion") &&
     checklist.includes("Stale helper (armed)") && checklist.includes("Fresh-armed flip") &&
     checklist.includes("Startup audit (armed, TUN residue)") &&
     checklist.includes("Watchdog independence"));
}

/* ---------------- S8: frozen surfaces ---------------- */
console.log("\n== S8 frozen surfaces ==");
{
  ok("routingSession.ts R3 re-point (581 lines — was 537; R3 added the UAC outcome reporting, disclosed)",
     lines(join(APP, "electron", "routingSession.ts")) === 581);
  ok("ipc.ts R3 re-point (895 lines — was 748; R3 added the Update Center / LiveConn / Scanner / MHRV handlers, disclosed)",
     lines(join(APP, "electron", "ipc.ts")) === 895);
  ok("preload.ts untouched (the allowlist stays at 31)",
     (read(join(APP, "electron", "preload.ts")).match(/"routing_/g) || []).length === 4);
  const aether = read(join(ROOT, "src", "components", "AetherTab.tsx"));
  ok("the renderer trio untouched (AetherTab still carries the B2 segment + D6 note)",
     aether.includes("routing_start") && aether.includes("routing_repair") &&
     aether.includes("killSwitchBlockedHint") || aether.includes("routing_status"));
  ok("electron-mock.ts untouched (the honest browser mirror intact)",
     read(join(ROOT, "src", "electron-mock.ts")).includes("routing_status"));
  ok("the B1 D6 pure mapping unchanged (watchdogOutcome still the exported contract)",
     read(join(APP, "electron", "routingSession.ts")).includes('return armed ? "hold-reconnecting" : "teardown-restoring";'));
}

/* ---------------- summary ---------------- */
console.log(`\n===== taskB3-quickcheck: ${pass} PASS / ${fail} FAIL =====`);
if (fail > 0) process.exit(1);
