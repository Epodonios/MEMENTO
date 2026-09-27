#!/usr/bin/env node
/**
 * Phase C5 STRUCTURAL quickcheck — Kill switch (fail-closed system proxy).
 *
 * Pins the code FORM of the whole surface (the C1..C4 discipline):
 *   N1  proxy.ts: the blocked state (ProxyEnable=1 + 127.0.0.1:9) with the
 *       same no-elevation reg.exe mechanics; the port is NEVER 0/never
 *       ProxyEnable=0 (that would be the leak itself).
 *   N2  killSwitch.ts: the three choke points with their exact decision
 *       order (quitting -> clear FIRST; armed -> block; disarmed -> clear),
 *       the pure audit decision matrix, the quit latch, and the honest
 *       limits in the header.
 *   N3  xray.ts + singbox.ts: exit handlers call blockOnCoreExit INSIDE the
 *       current-child guard; stop paths use releaseSystemProxy;
 *       cleanupOnExit keeps the RAW clearSystemProxy (quit always direct).
 *   N4  aether.ts: blockOnCoreExit rides its exit handler (renderer-owned
 *       proxy note preserved).
 *   N5  ipc.ts: clear_system_proxy -> releaseSystemProxy; the prefs patch
 *       accepts killSwitch and the enforcement runs AFTER saveAppPrefs.
 *   N6  main.ts: markQuitting() precedes cleanupOnce() on BOTH quit paths;
 *       the F9 audit is kill-switch aware with a strict hands-off branch.
 *   N7  appPrefs.ts: field + default OFF + sanitizer + tolerant load.
 *   N8-N11 renderer: store mirror + boot load + Settings toggle + the
 *       Connection-tab blocked banner (role="alert").
 *   N12 i18n: the 4 new keys in ALL FOUR locales, the en hint states the
 *       real contract (127.0.0.1:9, block-on-arm, quit restores direct).
 *   N13 electron-mock: honest mirror (no fake enforcement in a browser).
 *   N14 isolation negatives: killSwitch.ts never imports electron, never
 *       imports the orphan-killers, and never persists prefs itself;
 *       urlTest.ts keeps its C2 proxy-write isolation untouched.
 *
 * Exit code 0 = all pins hold.
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const EL = join(ROOT, "electron-app", "electron");
const SRC = join(ROOT, "src");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
/** Strip // line comments and /* block comments so pins match CODE, not
 *  doc prose (the C1 lesson: legitimate comments may mention anything). */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map(l => l.replace(/(^|[^:"'])\/\/.*$/, "$1")).join("\n");

const proxyTs = read(join(EL, "proxy.ts"));
const proxyCode = code(join(EL, "proxy.ts"));
const ksCode = code(join(EL, "killSwitch.ts"));
const ksAll = read(join(EL, "killSwitch.ts"));
const xrayCode = code(join(EL, "xray.ts"));
const sbCode = code(join(EL, "singbox.ts"));
const aeCode = code(join(EL, "aether.ts"));
const aeAll = read(join(EL, "aether.ts"));
const ipcCode = code(join(EL, "ipc.ts"));
const mainCode = code(join(EL, "main.ts"));
const mainAll = read(join(EL, "main.ts"));
const prefsCode = code(join(EL, "appPrefs.ts"));
const storeCode = code(join(SRC, "store.ts"));
const appCode = code(join(SRC, "App.tsx"));
const setCd = code(join(SRC, "components", "SettingsTab.tsx"));
const setCdAll = read(join(SRC, "components", "SettingsTab.tsx"));
const ctCode = code(join(SRC, "components", "ConnectionTab.tsx"));
const ctAll = read(join(SRC, "components", "ConnectionTab.tsx"));
const i18n = read(join(SRC, "i18n.ts"));
const mockCode = code(join(SRC, "electron-mock.ts"));
const utCode = read(join(SRC, "utils", "urlTest.ts"));

/* ---------------- N1: the blocked state (proxy.ts) ---------------- */
console.log("\n== N1 proxy.ts: fail-closed blocked state ==");
ok("N1a blocked port is 9 and the state is ProxyEnable=1 + 127.0.0.1:9 (NOT ProxyEnable=0)",
   proxyCode.includes("export const KILL_SWITCH_BLOCKED_PORT = 9;") &&
   /setBlockedSystemProxy[\s\S]*?ProxyEnable[\s\S]*?"1"[\s\S]*?127\.0\.0\.1:\$\{KILL_SWITCH_BLOCKED_PORT\}/.test(proxyCode));
ok("N1b blocked write uses the same no-elevation reg.exe path (no sudo/netsh/admin anywhere)",
   proxyCode.includes('spawnSync("reg"') && !/netsh|advfirewall|sudo|runas/i.test(proxyCode));
ok("N1c honest error mapping distinct from the live-proxy writer",
   proxyCode.includes('"Cannot enable blocked proxy"') && proxyCode.includes('"Cannot set blocked proxy server"'));

/* ---------------- N2: killSwitch.ts choke points ---------------- */
console.log("\n== N2 killSwitch.ts: decisions ==");
{
  const rel = /export function releaseSystemProxy\(\): void \{[\s\S]*?\n\}/.exec(ksCode)?.[0] ?? "";
  const iQ = rel.indexOf("if (quitting)");
  const iC = rel.indexOf("clearSystemProxy();");
  const iA = rel.indexOf("isKillSwitchArmed()");
  const iB = rel.indexOf("setBlockedSystemProxy();");
  ok("N2a releaseSystemProxy order: quitting->clear FIRST, then armed->block, else clear",
     iQ !== -1 && iC !== -1 && iA !== -1 && iB !== -1 &&
     iQ < iA && iA < iB && iQ < iC);
  const bex = /export function blockOnCoreExit\(\): void \{[\s\S]*?\n\}/.exec(ksCode)?.[0] ?? "";
  ok("N2b blockOnCoreExit: quitting guard + armed guard + best-effort try/catch",
     bex.includes("if (quitting) return;") &&
     bex.indexOf("if (quitting) return;") < bex.indexOf("isKillSwitchArmed()") &&
     /try \{[\s\S]*setBlockedSystemProxy\(\);[\s\S]*\} catch/.test(bex));
  ok("N2c resolveAuditAction pure matrix: ours->block|clear by armed, foreign->leave",
     /armed \? "block" : "clear"/.test(ksCode) && /return "leave";/.test(ksCode) &&
     ksCode.includes("serverPort === KILL_SWITCH_BLOCKED_PORT || ourPorts.has(serverPort)"));
  const enf = /export function enforceKillSwitchAfterPrefChange[\s\S]*?\n\}/.exec(ksCode)?.[0] ?? "";
  ok("N2d pref enforcement: live core short-circuits FIRST, arm normalizes, disarm only OUR state",
     enf.includes("isAnyCoreRunning()") &&
     enf.indexOf("isAnyCoreRunning()") < enf.indexOf("isKillSwitchArmed()") &&
     enf.includes("if (!enabled) setBlockedSystemProxy();") &&
     enf.includes("clearSystemProxy();"));
  ok("N2e quit latch exported both ways (main.ts can only SET it, enforcement reads it)",
     ksCode.includes("export function markQuitting") && ksCode.includes("export function isQuitting"));
  ok("N2f armed view is a tolerant read over appPrefs (default false on any failure)",
     /loadAppPrefs\(\)\.killSwitch === true/.test(ksCode) && /catch \{[\s\S]*return false;/.test(ksCode));
  ok("N2g honest limits documented in the header (system-proxy apps only, not a firewall)",
     /only apps honoring the\s*\*?\s*Windows[\s\S]*not a firewall/.test(ksAll));
}

/* ---------------- N3: managers ---------------- */
console.log("\n== N3 xray/singbox: exit handlers + stop paths ==");
for (const [name, c] of [["xray.ts", xrayCode], ["singbox.ts", sbCode]]) {
  const ex = /child\.on\("exit"[\s\S]*?\n    \}\);/.exec(c)?.[0] ?? "";
  const guard = ex.indexOf("this.child === child");
  const blk = ex.indexOf("blockOnCoreExit();");
  ok(`N3 ${name}: exit handler blocks INSIDE the current-child generation guard`,
     guard !== -1 && blk !== -1 && guard < blk);
}
for (const [name, c] of [["xray.ts", xrayCode], ["singbox.ts", sbCode]]) {
  const stop = /stop(?:Xray|SingBox)\(\): ConnectionStatus \{[\s\S]*?\n  \}/.exec(c)?.[0] ?? "";
  ok(`N3 ${name}: stop path releases through the kill switch (not a raw clear)`,
     stop.includes("releaseSystemProxy();") && !/stop(?:Xray|SingBox)[\s\S]*clearSystemProxy\(\)/.test(stop));
  const clean = /cleanupOnExit\(\): void \{[\s\S]*?\n  \}/.exec(c)?.[0] ?? "";
  ok(`N3 ${name}: cleanupOnExit keeps the RAW clear (quit always restores direct)`,
     clean.includes("clearSystemProxy();") && !clean.includes("releaseSystemProxy"));
}

/* ---------------- N4: aether ---------------- */
console.log("\n== N4 aether.ts: exit handler contract ==");
{
  const ex = /child\.on\("exit"[\s\S]*?\n        \}\);/.exec(aeCode)?.[0] ?? "";
  ok("N4 aether exit handler calls blockOnCoreExit (main-wide contract, renderer-owned proxy preserved)",
     ex.includes("blockOnCoreExit();") && aeAll.includes("the kill-switch CONTRACT is main-wide"));
}

/* ---------------- N5: ipc.ts boundary ---------------- */
console.log("\n== N5 ipc.ts: commands + prefs ==");
{
  const h = /ipcMain\.handle\("clear_system_proxy"[\s\S]*?\n  \}\);/.exec(ipcCode)?.[0] ?? "";
  ok("N5a clear_system_proxy routes through releaseSystemProxy (armed -> BLOCK, not direct)",
     h.includes("releaseSystemProxy();") && !/clear_system_proxy[\s\S]*?\{[\s\S]*?clearSystemProxy\(\);/.test(ipcCode.split('ipcMain.handle("set_system_proxy"')[1] ?? ""));
  const set = ipcCode.split('ipcMain.handle(\n    "app_prefs_set"')[1] ?? ipcCode.split('"app_prefs_set"')[1] ?? "";
  const save = set.indexOf("saveAppPrefs(prefs);");
  const ks = set.indexOf('prefs.killSwitch = patch.killSwitch;');
  const enf = set.indexOf("enforceKillSwitchAfterPrefChange(");
  ok("N5b prefs patch applies killSwitch and enforcement runs AFTER the save (transition acts on persisted state)",
     ks !== -1 && save !== -1 && enf !== -1 && ks < save && save < enf);
  ok("N5c enforcement gets the our-ports set (canonical defaults + last session's real ports)",
     /enforceKillSwitchAfterPrefChange\(\s*new Set\(\[10808, 10809, \.\.\.readLastActivePorts\(\)\]\)/.test(ipcCode));
}

/* ---------------- N6: main.ts quit latch + audit ---------------- */
console.log("\n== N6 main.ts: latch order + kill-switch-aware audit ==");
{
  const bq = /on\("before-quit"[^]*?\n\}\);/.exec(mainAll)?.[0] ?? "";
  const se = /on\("session-end"[^]*?\n  \}\);/.exec(mainAll)?.[0] ?? "";
  for (const [nm, blk] of [["before-quit", bq], ["session-end", se]]) {
    const iq = blk.indexOf("quitting = true;");
    const im = blk.indexOf("markQuitting();");
    const ic = blk.indexOf("cleanupOnce();");
    ok(`N6a ${nm}: markQuitting() between the D4 flag and cleanup (latch before any child can die)`,
       iq !== -1 && im !== -1 && ic !== -1 && iq < im && im < ic);
  }
  const aud = /function auditLeftoverProxy[\s\S]*?\n\}/.exec(mainCode)?.[0] ?? "";
  ok("N6b audit: pure decision + leave branch + apply (armed normalizes to BLOCK, disarmed clears)",
     aud.includes("resolveAuditAction(") && aud.includes('action === "leave"') &&
     aud.includes("applyAuditAction(action);") && mainCode.includes("isKillSwitchArmed()"));
  ok("N6c audit hands-off set includes the blocked port itself (our own crash residue)",
     mainCode.includes("new Set([...ourPorts, KILL_SWITCH_BLOCKED_PORT])"));
}

/* ---------------- N7: appPrefs.ts ---------------- */
console.log("\n== N7 appPrefs.ts: field + sanitizer + load ==");
ok("N7a killSwitch field + default OFF (strictly opt-in)",
   prefsCode.includes("killSwitch: boolean;") && prefsCode.includes("killSwitch: false,"));
ok("N7b sanitizer accepts ONLY a real boolean (poison-proof IPC boundary)",
   prefsCode.includes('if (typeof p.killSwitch === "boolean") out.killSwitch = p.killSwitch;'));
ok("N7c tolerant load defaults to false (=== true, legacy files safe)",
   prefsCode.includes("killSwitch: o.killSwitch === true,"));

/* ---------------- N8-N11: renderer ---------------- */
console.log("\n== N8-N11 renderer: mirror + boot + toggle + banner ==");
ok("N8a store mirror init false + persist-optional setter",
   storeCode.includes("killSwitchArmed: false,") &&
   storeCode.includes("setKillSwitchArmed: (armed, opts) => {") &&
   storeCode.includes('if (opts?.persist === false) return;'));
ok("N8b store setter persists via app_prefs_set fire-and-forget (serialized main-side)",
   /setKillSwitchArmed[\s\S]*?app_prefs_set[\s\S]*?killSwitch: armed/.test(storeCode));
ok("N9 App.tsx boot-loads the mirror with reply-is-authority (typeof guard + persist:false)",
   appCode.includes('invoke("app_prefs_get")') &&
   appCode.includes('typeof p.killSwitch === "boolean"') &&
   appCode.includes("setKillSwitchArmed(p.killSwitch, { persist: false })"));
ok("N10 SettingsTab toggle reads the mirror and persists through the same setter",
   setCd.includes("const killSwitchArmed = useStore(s => s.killSwitchArmed);") &&
   setCd.includes("onChange={v => setKillSwitchArmed(v)}") &&
   setCdAll.includes('t("set.killSwitch", language)') &&
   setCdAll.includes('t("set.killSwitchHint", language)'));
ok("N11a ConnectionTab banner: armed AND (disconnected|error) only, role=alert",
   ctCode.includes('killSwitchArmed && (status === "disconnected" || status === "error")') &&
   ctAll.includes('role="alert"'));
ok("N11b banner carries both texts + the alert icon",
   ctAll.includes('t("connection.killSwitchBlocked", language)') &&
   ctAll.includes('t("connection.killSwitchBlockedHint", language)') &&
   ctCode.includes("<ShieldAlert"));

/* ---------------- N12: i18n ---------------- */
console.log("\n== N12 i18n: 4 keys x 4 locales with the real contract ==");
for (const k of ["set.killSwitch", "set.killSwitchHint",
  "connection.killSwitchBlocked", "connection.killSwitchBlockedHint"]) {
  const n = (i18n.match(new RegExp(`"${k}":`, "g")) || []).length;
  ok(`N12 ${k} x${n} (4 languages)`, n === 4, `got ${n}`);
}
{
  const enHint = (i18n.match(/"set\.killSwitchHint": "([^"]*)"/) || [])[1] ?? "";
  ok("N12b en hint states the REAL dead address (127.0.0.1:9)", enHint.includes("127.0.0.1:9"), enHint.slice(0, 60));
  ok("N12c en hint: arming while disconnected blocks immediately",
     enHint.includes("blocks immediately"));
  ok("N12d en hint: quitting the app always restores direct (documented boundary)",
     enHint.includes("Quitting the app always restores direct"));
}

/* ---------------- N13: mock ---------------- */
console.log("\n== N13 electron-mock: honest mirror ==");
ok("N13 mock get returns killSwitch:false default; set echoes a real boolean only; NO fake enforcement",
   mockCode.includes("killSwitch: false,") &&
   /const killSwitch = typeof args\?\.patch\?\.killSwitch === "boolean"/.test(mockCode) &&
   /killSwitch,\n    \};/.test(mockCode));

/* ---------------- N14: isolation negatives ---------------- */
console.log("\n== N14 isolation negatives ==");
ok("N14a killSwitch.ts imports NO electron (testable), NO orphan-killers, and never writes prefs",
   !ksCode.includes('from "electron"') && !ksCode.includes("killAllOrphanedCores") &&
   !ksCode.includes("saveAppPrefs"));
ok("N14b urlTest.ts keeps its C2 proxy-write isolation (kill switch adds nothing there)",
   !utCode.includes("killSwitch") && !utCode.includes("setSystemProxy") && !utCode.includes("clearSystemProxy"));
ok("N14c no admin/UAC path anywhere in the C5 surface (netsh/advfirewall/runas absent from new code)",
   !/netsh|advfirewall|runas/i.test(ksCode) && !/netsh|advfirewall|runas/i.test(proxyCode));

console.log(`\nC5-QUICKCHECK: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
