#!/usr/bin/env node
/**
 * Phase B2 OFFICIAL FORMAL SMOKE (user-approved 2026-09-20: the full B2
 * file/line report approved, BOTH bring-up product decisions confirmed
 * (UAC-pending counts as live + the 120 s self-heal), and the repair
 * anti-UAC-spam close addendum disclosed — run the official smoke + zip +
 * seal; after the seal, copy into seals-archive/ and hash-verify in place).
 *
 * Batch B2 = routingManager.ts + the 4 routing IPC commands + the
 * SOCKS/VPN Device segment in the Aether tab (the GUI half of the B1
 * machinery; the B1 modules and the C5 kill-switch choke points are
 * byte-untouched). NEW at close: the repair one-shot is anti-spam-gated
 * (refused while a TUN start elevation is pending + a 120 s window since
 * any repair launch — REPAIR_COOLDOWN_MS), so repeated clicks can never
 * stack UAC prompts.
 *
 * Gate structure (extends the B1 smoke; S1-S5 RE-RUN the full regression
 * battery — 982 through B0 + 145 B1 (fntest 98 + quickcheck 47) + 124 B2
 * (fntest 69 + quickcheck 55) = 1,251 embedded assertions):
 *   S0   real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *        + fresh builds of BOTH frontend (vite) and main (tsc) + compiled
 *        artifacts incl. the NEW dist-electron/routingManager.js beside
 *        routingSession.js and routingHelper.js.
 *   S0b  B0 LIVE provenance regression: fetch-wintun.sh re-run END-TO-END
 *        against the official source, post-run on-disk dll hash == pin,
 *        audit-copy cross-check (the B0 chain must stay live on the B2
 *        tree — the B1 spawn gate consumes exactly this artifact).
 *   S1   structural surface via taskC6-quickcheck.mjs (51) + C6 dist
 *        freshness + compiled C6 pins (regression — B2 touched none of it);
 *        the preload allowlist gate UPDATED 27 -> 31 per the approved B2
 *        report (the 4 routing commands).
 *   S1b  B0 structural regression: wintunPin.ts all 8 constants +
 *        constants-only negatives + compiled wintunPin.js + both fetch
 *        scripts + provenance docs + core-versions.json + digest
 *        uniqueness (NOW 11 sanctioned files — the B2 gate scripts join
 *        the B0/B1 set). The B1 gates RETAINED: wintunPin consumers are
 *        EXACTLY routingSession (B2's manager does not import it), and
 *        the B1 modules still exist at the reported size (537 + 673 —
 *        the helper count RE-POINTED for the approved B3 additions).
 *   S1c  B1 structural gates: taskB1-quickcheck.mjs (47) + direct
 *        compiled pins (routingSession/routingHelper/main wiring +
 *        electron-free at the compiled level); the renderer gate UPDATED
 *        for the approved B2 UI — the D5 names ship ONLY via the honest
 *        mock mirror + locale strings.
 *   S1d  B2 structural gates: taskB2-quickcheck.mjs (55) + direct
 *        compiled pins (routingManager factory/heal/anti-spam window,
 *        the 4 ipc handlers + the D6 gates + the core-transition guards,
 *        the main.ts wiring + cleanup order, the preload routing entries,
 *        the manager at its reported size — 535 lines, re-pointed for
 *        the approved B3 additions).
 *   S2   functional: taskB1-fntest.mjs (98 — the whole watchdog state
 *        machine, the REAL sing-box check, the tamper refusal) +
 *        taskB2-fntest.mjs (69 — the manager surface incl. the repair
 *        anti-UAC-spam window T16 + the pending-start cross-gate T17) +
 *        taskC6-fntest.mjs (37, regression).
 *   S3   config-level regression through the REAL cores (taskC4-cfgtest, 30).
 *   S4   LIVE behavioral regression: taskC5-live.mjs (12) + the C4
 *        TRACKED-LIMITATION canary (taskC4-uplink-probe).
 *   S5   regression suites: task13-selftest/cfgtest + task12-quickcheck +
 *        D1-D4 quickchecks + D2-cfgtest + D4 fntest + quit-cleanup +
 *        the full C1 (36/22/29/5) + C2 (54/39/41/9) + C3 (56/44/20/11) +
 *        C4 (58/52/30/21) + C5 (44/34) batteries.
 *
 * Env overrides: XRAY_BIN, SB_BIN
 * Exit code 0 = all hard assertions passed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");                       // memento-src
const APP = join(ROOT, "electron-app");              // electron-app
const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SINGBOX = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const AUDIT = "/home/z/my-project/scripts/b0-wintun-audit";

const WINTUN_ZIP_SHA = "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51";
const WINTUN_DLL_SHA = "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`); }
};
const run = (cmd, args, opts = {}) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 120000, ...opts }); }
  catch (e) { return (e.stdout || "") + (e.stderr || ""); }
};
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/* ---------------- S0: binary + build gates ---------------- */
console.log("\n== S0 binary + build gates ==");
{
  const xv = run(XRAY, ["version"]) + run(XRAY, ["-version"]);
  ok("S0 xray is pinned v25.1.1", /Xray 25\.1\.1/.test(xv), xv.slice(0, 80).replace(/\n/g, " "));
  const sv = run(SINGBOX, ["version"]);
  ok("S0 sing-box is pinned 1.14.0 (the D1 TUN engine)", /1\.14\.0/.test(sv), sv.slice(0, 80).replace(/\n/g, " "));

  const bf = run("npm", ["run", "build:frontend"], { cwd: APP });
  ok("S0 vite build exits clean", !/error/i.test(bf) || /built in/.test(bf), bf.slice(-200).replace(/\n/g, " "));
  const bm = run("npm", ["run", "build:main"], { cwd: APP });
  ok("S0 electron main tsc exits clean", !/error TS/i.test(bm), bm.slice(-200).replace(/\n/g, " "));
  ok("S0 dist-electron/routingSession.js exists post-build (the B1 session core ships compiled)",
     fs.existsSync(join(APP, "dist-electron", "routingSession.js")));
  ok("S0 dist-electron/routingHelper.js exists post-build (the B1 elevated side ships compiled)",
     fs.existsSync(join(APP, "dist-electron", "routingHelper.js")));
  ok("S0 dist-electron/routingManager.js exists post-build (the B2 manager ships compiled)",
     fs.existsSync(join(APP, "dist-electron", "routingManager.js")));
  ok("S0 dist-electron/wintunPin.js exists post-build (B0 regression)",
     fs.existsSync(join(APP, "dist-electron", "wintunPin.js")));
  ok("S0 dist-electron/aetherUpdate.js exists post-build (C6 regression)",
     fs.existsSync(join(APP, "dist-electron", "aetherUpdate.js")));
  ok("S0 dist-electron/appUpdate.js exists post-build (C6 regression)",
     fs.existsSync(join(APP, "dist-electron", "appUpdate.js")));
  ok("S0 dist-electron/aether-versions.json emitted post-build (C6 regression)",
     fs.existsSync(join(APP, "dist-electron", "aether-versions.json")));
  ok("S0 dist-electron/killSwitch.js exists post-build (C5 regression)", fs.existsSync(join(APP, "dist-electron", "killSwitch.js")));
  ok("S0 dist-electron/proxy.js exists post-build (C5 regression)", fs.existsSync(join(APP, "dist-electron", "proxy.js")));
  ok("S0 dist-electron/xray.js exists post-build (C4 regression)", fs.existsSync(join(APP, "dist-electron", "xray.js")));
}

/* ---------------- S0b: B0 LIVE provenance regression ---------------- */
console.log("\n== S0b B0 LIVE provenance regression (official-source fetch re-run + hash gates) ==");
{
  const fetched = run("bash", [join(APP, "scripts", "fetch-wintun.sh")], { timeout: 300000 });
  ok("S0b fetch-wintun.sh ran END-TO-END (DONE line reached)",
     fetched.includes("[fetch-wintun] DONE"), fetched.slice(-400).replace(/\n/g, " | "));
  ok("S0b official zip digest gate passed live (zip sha256 OK)",
     fetched.includes("zip sha256 OK: " + WINTUN_ZIP_SHA), fetched.slice(-400).replace(/\n/g, " | "));
  ok("S0b official dll digest gate passed live (dll sha256 OK)",
     fetched.includes("dll sha256 OK: " + WINTUN_DLL_SHA), fetched.slice(-400).replace(/\n/g, " | "));
  ok("S0b verified dll placed at resources/wintun/bin/amd64/wintun.dll",
     fetched.includes("placed verified wintun.dll -> resources/wintun/bin/amd64/wintun.dll"));

  const dllPath = join(APP, "resources", "wintun", "bin", "amd64", "wintun.dll");
  ok("S0b on-disk dll hash == pin (the artifact the B1 gate re-verifies every session)",
     fs.existsSync(dllPath) && sha256(dllPath) === WINTUN_DLL_SHA);
  ok("S0b on-disk dll size == 427,552 bytes (the pinned amd64 build)",
     fs.existsSync(dllPath) && fs.statSync(dllPath).size === 427552);

  if (fs.existsSync(join(AUDIT, "wintun-0.14.1.zip"))) {
    ok("S0b audit zip hash == pin (the 2026-09-20 live-verification copy)",
       sha256(join(AUDIT, "wintun-0.14.1.zip")) === WINTUN_ZIP_SHA);
    ok("S0b audit zip size == 750,540 bytes", fs.statSync(join(AUDIT, "wintun-0.14.1.zip")).size === 750540);
    ok("S0b audit dll hash == pin (two channels, one hash)",
       sha256(join(AUDIT, "wintun.dll")) === WINTUN_DLL_SHA);
  } else {
    ok("S0b audit copy absent outside the sandbox — live fetch above is the authority", true);
  }
}

/* ---------------- S1: structural + dist freshness (C6 regression) ---------------- */
console.log("\n== S1 structural (taskC6-quickcheck) + dist freshness + compiled pins (regression) ==");
{
  const out = run("node", [join(HERE, "taskC6-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/taskC6-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskC6-quickcheck 51 PASS / 0 FAIL", !!m && m[1] === "51" && m[2] === "0", out.slice(-400));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  for (const needle of [
    "aether.updateTitle",
    "aether.updateTableTitle",
    "aether.updateRunningBlocked",
    "set.appUpdateTitle",
    "set.appUpdateSteps",
    "never checks by itself",
    "sha256-verified against that table",
    "aether.prev.bak",
    "never replaces its own executable",
  ]) {
    ok(`S1 dist fresh: "${needle}" built in`, dist.includes(needle));
  }

  const compiledUpd = fs.readFileSync(join(APP, "dist-electron", "aetherUpdate.js"), "utf8");
  ok("S1 compiled aetherUpdate.js (rebuilt): service + table loader + full gate chain shipped",
     compiledUpd.includes("createAetherUpdateService") &&
     compiledUpd.includes("loadAetherVersionTable") &&
     compiledUpd.includes("pinned-newer") && compiledUpd.includes("unpinned-newer") &&
     compiledUpd.includes("blocked-running") &&
     compiledUpd.includes("sha256File"));
  const compiledApp = fs.readFileSync(join(APP, "dist-electron", "appUpdate.js"), "utf8");
  ok("S1 compiled appUpdate.js (rebuilt): static facts only — releases URL + selfUpdate:false",
     compiledApp.includes("epodonios/memento/releases") && compiledApp.includes("selfUpdate: false"));
  ok("S1 compiled appUpdate.js: ZERO require() calls at compiled level (static-only by construction)",
     !/\brequire\(/.test(compiledApp));
  const compiledIpc = fs.readFileSync(join(APP, "dist-electron", "ipc.js"), "utf8");
  ok("S1 compiled ipc.js (rebuilt): all 4 C6 handlers + running gate + swap dir wired",
     compiledIpc.includes('ipcMain.handle("aether_update_status"') &&
     compiledIpc.includes('ipcMain.handle("aether_update_check"') &&
     compiledIpc.includes('ipcMain.handle("aether_update_apply"') &&
     compiledIpc.includes('ipcMain.handle("app_update_info"') &&
     compiledIpc.includes("hasLiveChild()") &&
     compiledIpc.includes('swapTargetDir: () => path.join((0, paths_1.resourceRoot)(), "aether")'));
  ok("S1 compiled ipc.js (rebuilt): C2/C3/C5 handlers intact (regression)",
     compiledIpc.includes('ipcMain.handle("url_test"') &&
     compiledIpc.includes('ipcMain.handle("geo_status"') &&
     compiledIpc.includes('ipcMain.handle("clear_system_proxy"'));
  const compiledAether = fs.readFileSync(join(APP, "dist-electron", "aether.js"), "utf8");
  ok("S1 compiled aether.js (rebuilt): spawn-integrity gate extended with the table hashes",
     compiledAether.includes("allowedAetherTableHashes") &&
     compiledAether.includes("aether-versions.json") &&
     compiledAether.includes("allowedAetherTableHashes(process.platform)"));
  const compiledPreload = fs.readFileSync(join(APP, "dist-electron", "preload.js"), "utf8");
  const allow = [...compiledPreload.matchAll(/"([a-z_0-9]+)",/g)].map(mm => mm[1]);
  ok("S1 compiled preload (rebuilt): allowlist = 31 commands (B1's 27 + the 4 approved B2 routing commands)",
     allow.length === 31 && allow.includes("aether_update_status") &&
     allow.includes("aether_update_check") && allow.includes("aether_update_apply") &&
     allow.includes("app_update_info") && allow.includes("routing_start") &&
     allow.includes("routing_stop") && allow.includes("routing_status") &&
     allow.includes("routing_repair"),
     `got ${allow.length}`);
  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1 compiled main.js (rebuilt): C5 quit latch on BOTH paths + session-end hook intact (regression)",
     (compiledMain.match(/markQuitting/g) || []).length >= 2 &&
     compiledMain.includes('mainWindow.on("session-end"'));
  const compiledKs = fs.readFileSync(join(APP, "dist-electron", "killSwitch.js"), "utf8");
  ok("S1 compiled killSwitch.js (rebuilt): C5 choke points intact (regression)",
     compiledKs.includes("releaseSystemProxy") && compiledKs.includes("blockOnCoreExit") &&
     compiledKs.includes("resolveAuditAction"));
  const emittedTable = JSON.parse(fs.readFileSync(join(APP, "dist-electron", "aether-versions.json"), "utf8"));
  ok("S1 emitted table: authority header + 1.9.0 row with the byte-identical win32 binary pin",
     typeof emittedTable._header === "string" &&
     Array.isArray(emittedTable.versions) && emittedTable.versions.length === 1 &&
     emittedTable.versions[0].version === "1.9.0" &&
     emittedTable.versions[0].sha256.win32 === "ee400806bf73fe16e655e6478eb7442c2c4e0576c4c8ce1913ac474e846b36cd");
}

/* ---------------- S1b: B0 structural regression (two gates UPDATED for B1) ---------------- */
console.log("\n== S1b B0 structural regression (wintunPin + fetch scripts + provenance docs + D3 boundary) ==");
{
  const pin = fs.readFileSync(join(APP, "electron", "wintunPin.ts"), "utf8");
  ok("S1b wintunPin.ts WINTUN_VERSION == 0.14.1", pin.includes('export const WINTUN_VERSION = "0.14.1";'));
  ok("S1b wintunPin.ts WINTUN_OFFICIAL_URL == https://www.wintun.net/", pin.includes('export const WINTUN_OFFICIAL_URL = "https://www.wintun.net/";'));
  ok("S1b wintunPin.ts WINTUN_ZIP_URL == official builds URL", pin.includes('export const WINTUN_ZIP_URL = "https://www.wintun.net/builds/wintun-0.14.1.zip";'));
  ok("S1b wintunPin.ts WINTUN_ZIP_SHA256 byte-exact", pin.includes(`export const WINTUN_ZIP_SHA256 =\n  "${WINTUN_ZIP_SHA}";`));
  ok("S1b wintunPin.ts WINTUN_DLL_SHA256 byte-exact", pin.includes(`export const WINTUN_DLL_SHA256 =\n  "${WINTUN_DLL_SHA}";`));
  ok("S1b wintunPin.ts WINTUN_PUBLISHER == WireGuard LLC", pin.includes('export const WINTUN_PUBLISHER = "WireGuard LLC";'));
  ok("S1b wintunPin.ts WINTUN_DLL_RELATIVE_PATH == wintun/bin/amd64/wintun.dll", pin.includes('export const WINTUN_DLL_RELATIVE_PATH = "wintun/bin/amd64/wintun.dll";'));
  ok("S1b wintunPin.ts WINTUN_VERIFIED_AT == 2026-09-20", pin.includes('export const WINTUN_VERIFIED_AT = "2026-09-20";'));
  ok("S1b wintunPin.ts contract: B1 MUST re-verify the hash before the first spawn",
     pin.includes("MUST re-verify WINTUN_DLL_SHA256 before the") &&
     pin.includes("first spawn (spawn-integrity gate, C6-style)"));
  ok("S1b wintunPin.ts contract: B1 must ALSO gate the Authenticode publisher",
     pin.includes("WINTUN_PUBLISHER") && pin.includes("Authenticode publisher"));
  ok("S1b wintunPin.ts contract: bump = same-commit update of pin + README + core-versions.json",
     pin.includes("in the SAME reviewed commit"));
  ok("S1b wintunPin.ts is CONSTANTS-ONLY: no imports, no require, no spawn call, no fs (D3 boundary)",
     !/^\s*import\s/m.test(pin) && !pin.includes("require(") &&
     !pin.includes("spawn(") && !pin.includes('from "fs"') && !pin.includes('from "node:fs"') &&
     !pin.includes('from "child_process"') && !pin.includes('from "node:child_process"'));

  const compiledPin = fs.readFileSync(join(APP, "dist-electron", "wintunPin.js"), "utf8");
  ok("S1b compiled wintunPin.js carries both digests + publisher (the identity ships compiled)",
     compiledPin.includes(WINTUN_ZIP_SHA) && compiledPin.includes(WINTUN_DLL_SHA) &&
     compiledPin.includes("WireGuard LLC") && compiledPin.includes("0.14.1"));
  ok("S1b compiled wintunPin.js is also constants-only (no executable TUN code compiled in)",
     !/require\(/.test(compiledPin) && !/function\s/.test(compiledPin));

  const sh = fs.readFileSync(join(APP, "scripts", "fetch-wintun.sh"), "utf8");
  ok("S1b fetch-wintun.sh: official URL + both digests in lockstep with the pin",
     sh.includes("https://www.wintun.net/builds/wintun-0.14.1.zip") &&
     sh.includes(WINTUN_ZIP_SHA) && sh.includes(WINTUN_DLL_SHA) &&
     sh.includes("Keep in lockstep with electron/wintunPin.ts"));
  ok("S1b fetch-wintun.sh REFUSES on zip mismatch AND dll mismatch (build-time-fail)",
     sh.includes("REFUSED: zip sha256 mismatch") && sh.includes("REFUSED: dll sha256 mismatch") &&
     sh.includes("exit 1"));
  const ps1 = fs.readFileSync(join(APP, "scripts", "fetch-wintun.ps1"), "utf8");
  ok("S1b fetch-wintun.ps1: official URL + both digests + publisher in lockstep",
     ps1.includes("https://www.wintun.net/builds/wintun-0.14.1.zip") &&
     ps1.includes(WINTUN_ZIP_SHA) && ps1.includes(WINTUN_DLL_SHA) &&
     ps1.includes('"WireGuard LLC"'));
  ok("S1b fetch-wintun.ps1 verifies the Authenticode publisher and REFUSES otherwise",
     ps1.includes("Get-AuthenticodeSignature") &&
     ps1.includes('$Sig.Status -ne "Valid"') &&
     ps1.includes("REFUSED: Authenticode check failed"));

  const wreadme = fs.readFileSync(join(APP, "resources", "wintun", "README.md"), "utf8");
  ok("S1b resources/wintun/README.md: full provenance record (version/urls/digests/publisher/date)",
     wreadme.includes("**Version:** 0.14.1 (amd64, win32-x64 only)") &&
     wreadme.includes("https://www.wintun.net/") &&
     wreadme.includes("`" + WINTUN_ZIP_SHA + "`") &&
     wreadme.includes("`" + WINTUN_DLL_SHA + "`") &&
     wreadme.includes("`WireGuard LLC`") &&
     wreadme.includes("2026-09-20"));
  ok("S1b resources/wintun/README.md: byte-identical cross-check + the binary is NOT committed",
     wreadme.includes("byte-identical") && wreadme.includes("WINTUN_SHA256") &&
     wreadme.includes("NOT committed to this repository"));

  const lic = fs.readFileSync(join(APP, "resources", "wintun", "wintun-LICENSE.txt"), "utf8");
  const licLines = lic.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).length;
  ok("S1b wintun-LICENSE.txt committed verbatim: 84 lines", licLines === 84, `got ${licLines}`);
  ok("S1b wintun-LICENSE.txt: Prebuilt Binaries License + grant + restrictions intact",
     lic.startsWith("Prebuilt Binaries License") &&
     lic.includes("WireGuard LLC grants to you") &&
     lic.includes("Permitted API") &&
     lic.includes("remove any proprietary notices") &&
     lic.includes("wintun.net/builds"));

  const notice = fs.readFileSync(join(APP, "NOTICE.md"), "utf8");
  ok("S1b NOTICE.md: wintun attribution line + license + shipped-text pointer",
     notice.includes("## wintun.dll 0.14.1 (amd64)") &&
     notice.includes("Prebuilt Binaries License") &&
     notice.includes("resources/wintun/wintun-LICENSE.txt") &&
     notice.includes("WireGuard LLC"));
  ok("S1b NOTICE.md: THIRD-PARTY.json tracked as remaining work (user ruling 2026-09-20)",
     notice.includes("THIRD-PARTY.json") && notice.includes("remaining work"));

  const cv = JSON.parse(fs.readFileSync(join(APP, "electron", "core-versions.json"), "utf8"));
  ok("S1b core-versions.json: wintun 0.14.1 beside the three core pins (registry now xray/sing-box/aether/wintun)",
     cv.wintun === "0.14.1" && cv.xray === "v25.1.1" &&
     cv["sing-box"] === "1.14.0" && cv.aether === "1.9.0");

  const readme = fs.readFileSync(join(APP, "README.md"), "utf8");
  ok("S1b README Batch-B0 section intact (regression)",
     readme.includes("## Phase B — Batch B0 (wintun.dll provenance") &&
     readme.includes("zero executable TUN code") &&
     readme.includes("NOT committed and NOT zipped"));

  const checklist = fs.readFileSync(join(APP, "TESTING-CHECKLIST.md"), "utf8");
  ok("S1b TESTING-CHECKLIST section 28 intact (regression)",
     checklist.includes("## 28. Phase B0 — wintun.dll provenance") &&
     checklist.includes("Authenticode OK: signed by WireGuard LLC") &&
     checklist.includes("No TUN behavior exists yet"));

  // Digest uniqueness: the full digests may appear ONLY in the sanctioned
  // files — the ONE place, the two fetchers, the provenance README, the B0
  // gate scripts, the B1 gate scripts + the B1 fntest (its T6 asserts the
  // exported pin value byte-exactly), and NOW the B2 gate scripts.
  const sanctioned = new Set([
    join(APP, "electron", "wintunPin.ts"),
    join(APP, "scripts", "fetch-wintun.sh"),
    join(APP, "scripts", "fetch-wintun.ps1"),
    join(APP, "resources", "wintun", "README.md"),
    join(HERE, "taskB0-smoke.mjs"),
    join(HERE, "taskB0-zip.mjs"),
    join(HERE, "taskB1-fntest.mjs"),
    join(HERE, "taskB1-smoke.mjs"),
    join(HERE, "taskB1-zip.mjs"),
    join(HERE, "taskB2-smoke.mjs"),
    join(HERE, "taskB2-zip.mjs"),
  ]);
  const scanDirs = [join(APP, "electron"), join(APP, "scripts"), join(APP, "resources"),
                    join(ROOT, "src"), join(HERE)];
  const offenders = [];
  for (const dir of scanDirs) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith("task") && e.name.includes("-tmp")) continue;
          walk(join(d, e.name));
        } else if (/\.(ts|tsx|js|mjs|cjs|json|md|sh|ps1|txt|html|css|yml)$/.test(e.name)) {
          const p = join(d, e.name);
          if (sanctioned.has(p)) continue;
          try {
            const body = fs.readFileSync(p, "utf8");
            if (body.includes(WINTUN_ZIP_SHA) || body.includes(WINTUN_DLL_SHA)) offenders.push(p);
          } catch { /* unreadable */ }
        }
      }
    })(dir);
  }
  ok("S1b digest uniqueness: the wintun digests appear ONLY in the 11 sanctioned files",
     offenders.length === 0, offenders.join(", "));

  // D3 boundary UPDATED (per the approved B1 report): exactly
  // routingSession imports wintunPin — import-SHAPED scan (the B0 scan
  // counted bare mentions, which would now false-positive on the
  // routingHelper comment + the gate scripts).
  const importerFiles = [];
  for (const dir of [join(APP, "electron"), join(ROOT, "src"), join(APP, "dist-electron")]) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { if (e.name === "node_modules") continue; walk(join(d, e.name)); }
        else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
          const p = join(d, e.name);
          if (p.endsWith("wintunPin.ts") || p.endsWith("wintunPin.js")) continue;
          try {
            const body = fs.readFileSync(p, "utf8");
            if (/from ["']\.\/wintunPin["']/.test(body) || /require\(["']\.[/\\]wintunPin["']\)/.test(body))
              importerFiles.push(p);
          } catch { /* ignore */ }
        }
      }
    })(dir);
  }
  const rel = importerFiles.map((p) => p.slice(APP.length + 1).split("\\").join("/")).sort();
  ok("S1b wintunPin consumers: EXACTLY routingSession (source + compiled), nothing else",
     rel.join(",") === "dist-electron/routingSession.js,electron/routingSession.ts", rel.join(", "));

  // B0 gate INVERTED by B1: the two modules now EXIST at the reported size.
  const sessionLines = (fs.readFileSync(join(APP, "electron", "routingSession.ts"), "utf8").match(/\n/g) || []).length;
  const helperLines = (fs.readFileSync(join(APP, "electron", "routingHelper.ts"), "utf8").match(/\n/g) || []).length;
  ok("S1b B1 modules exist at the reported size (routingSession 537 + routingHelper 673 lines — re-pointed for B3)",
     sessionLines === 537 && helperLines === 673, `got ${sessionLines} + ${helperLines}`);
}

/* ---------------- S1c: B1 structural gates ---------------- */
console.log("\n== S1c B1 structural (taskB1-quickcheck + direct compiled pins) ==");
{
  const out = run("node", [join(HERE, "taskB1-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/taskB1-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1c taskB1-quickcheck 47 PASS / 0 FAIL", !!m && m[1] === "47" && m[2] === "0", out.slice(-400));

  const compiledSession = fs.readFileSync(join(APP, "dist-electron", "routingSession.js"), "utf8");
  ok("S1c compiled routingSession.js: D5 names + D7 clamp + the D4 builder shipped",
     compiledSession.includes('"MementoTun"') &&
     compiledSession.includes("memento-routing-recovery.json") &&
     compiledSession.includes("clampTunMtu") &&
     compiledSession.includes("172.19.0.1/30") &&
     compiledSession.includes("default_domain_resolver"));
  ok("S1c compiled routingSession.js: the B0 spawn-gate contract COMPILED IN (wintunPin consumed + hash + Authenticode)",
     compiledSession.includes("wintunPin_1") &&
     compiledSession.includes("WINTUN_DLL_SHA256") &&
     compiledSession.includes("integrity check FAILED") &&
     compiledSession.includes("Get-AuthenticodeSignature") &&
     compiledSession.includes("WINTUN_PUBLISHER"));
  ok("S1c compiled routingSession.js is ELECTRON-FREE (no require(electron) at compiled level)",
     !compiledSession.includes('require("electron")'));

  const compiledHelper = fs.readFileSync(join(APP, "dist-electron", "routingHelper.js"), "utf8");
  ok("S1c compiled routingHelper.js: D6 fork + repair + identity guard + memoized exit shipped",
     compiledHelper.includes("hold-reconnecting") &&
     compiledHelper.includes("teardown-restoring") &&
     compiledHelper.includes("--repair-network") &&
     compiledHelper.includes("exitPromise") &&
     compiledHelper.includes("hands off") &&
     compiledHelper.includes("MementoTunHelper"));
  ok("S1c compiled routingHelper.js is ELECTRON-FREE",
     !compiledHelper.includes('require("electron")'));

  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1c compiled main.js: helper mode wired BEFORE the lock (loop prevention compiled in)",
     compiledMain.indexOf("isHelperInvocation") !== -1 &&
     compiledMain.indexOf("isHelperInvocation") < compiledMain.indexOf("requestSingleInstanceLock") &&
     compiledMain.includes("startRoutingHelperMode"));
  ok("S1c compiled main.js: ALL FOUR lifecycle guards compiled (whenReady/before-quit/window-all-closed/process-exit)",
     (compiledMain.match(/HELPER_MODE/g) || []).length >= 6 &&
     (compiledMain.match(/if \(HELPER_MODE\)/g) || []).length >= 3 &&
     compiledMain.includes("if (!HELPER_MODE)"));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  ok("S1c renderer UPDATED for the approved B2 UI: the D5 names ship ONLY via the honest mock mirror + locale strings (source discipline enforced by taskB2-quickcheck S4)",
     dist.includes("MementoTun") && dist.includes("requires the Windows desktop app") &&
     dist.includes("aether.modeVpnDevice"));
}

/* ---------------- S1d: B2 structural gates ---------------- */
console.log("\n== S1d B2 structural (taskB2-quickcheck + direct compiled pins) ==");
{
  const out = run("node", [join(HERE, "taskB2-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/taskB2-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1d taskB2-quickcheck 55 PASS / 0 FAIL", !!m && m[1] === "55" && m[2] === "0", out.slice(-400));

  const mgrLines = (fs.readFileSync(join(APP, "electron", "routingManager.ts"), "utf8").match(/\n/g) || []).length;
  ok("S1d routingManager.ts at the reported size (535 lines — the B2 manager + the approved B3 staleness/C5-transition additions)",
     mgrLines === 535, `got ${mgrLines}`);

  const compiledMgr = fs.readFileSync(join(APP, "dist-electron", "routingManager.js"), "utf8");
  ok("S1d compiled routingManager.js: factory + the four commands + the D5 echo shipped (consumed via the routingSession imports — tsc keeps no literals)",
     compiledMgr.includes("createRoutingManager") &&
     compiledMgr.includes("startRouting") && compiledMgr.includes("stopRouting") &&
     compiledMgr.includes("getRoutingStatus") && compiledMgr.includes("repairRouting") &&
     compiledMgr.includes("routingSession_1.TUN_INTERFACE_NAME") &&
     compiledMgr.includes("routingSession_1.HELPER_ROLE_NAME"));
  ok("S1d compiled routingManager.js: UAC heal + the repair anti-spam window shipped (tsc preserves the ES2021 numeric separator)",
     /120_?000/.test(compiledMgr) &&
     compiledMgr.includes("launchPending") && compiledMgr.includes("lastRepairLaunchMs") &&
     compiledMgr.includes("repeated clicks must never queue multiple elevation prompts"));
  ok("S1d compiled routingManager.js is ELECTRON-FREE",
     !compiledMgr.includes('require("electron")'));

  const compiledIpc2 = fs.readFileSync(join(APP, "dist-electron", "ipc.js"), "utf8");
  ok("S1d compiled ipc.js: the 4 routing handlers + the D6 suppression gates + the core-transition guards",
     compiledIpc2.includes('"routing_start"') && compiledIpc2.includes('"routing_stop"') &&
     compiledIpc2.includes('"routing_status"') && compiledIpc2.includes('"routing_repair"') &&
     (compiledIpc2.split("isSystemProxySuppressed()").length - 1) === 2 &&
     (compiledIpc2.split("isSessionLive()").length - 1) === 2);

  const compiledMain2 = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1d compiled main.js: the factory wired + the cleanup order (TUN stop BEFORE the cores) [compiled call forms: (0, m)(args)]",
     compiledMain2.includes("createRoutingManager") &&
     compiledMain2.indexOf("requestStopBestEffort") !== -1 &&
     compiledMain2.indexOf("requestStopBestEffort") < compiledMain2.indexOf("(0, cores_1.cleanupAllCores)()") &&
     compiledMain2.includes("(0, ipc_1.registerIpcHandlers)(routingManager)"));

  const compiledPreload2 = fs.readFileSync(join(APP, "dist-electron", "preload.js"), "utf8");
  ok("S1d compiled preload: the 4 routing commands ride the allowlist exactly once each",
     (compiledPreload2.match(/routing_(start|stop|status|repair)/g) || []).length === 4);
}

/* ---------------- S2: functional ---------------- */
console.log("\n== S2 functional (taskB1-fntest 98 + taskB2-fntest 69 + taskC6-fntest 37) ==");
{
  const out = run("node", [join(HERE, "taskB1-fntest.mjs")], { cwd: HERE, timeout: 300000 });
  const m = out.match(/taskB1-fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskB1-fntest 98 PASS / 0 FAIL (the full watchdog state machine + REAL sing-box check)",
     !!m && m[1] === "98" && m[2] === "0", out.slice(-600));
  ok("S2 B1 tamper anchor: a wrong-hash dll is refused BEFORE any spawn (the B0 contract, behaviorally)",
     out.includes("== T12 "), out.slice(-300));
  ok("S2 B1 D6 anchors: fail-closed hold + fail-open teardown + quit boundary all green",
     out.includes("== T9 ") && out.includes("== T10 ") && out.includes("== T11 "), out.slice(-300));

  const outB2 = run("node", [join(HERE, "taskB2-fntest.mjs")], { cwd: HERE, timeout: 300000 });
  const mB2 = outB2.match(/taskB2-fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskB2-fntest 69 PASS / 0 FAIL (the manager surface + the repair anti-UAC-spam window)",
     !!mB2 && mB2[1] === "69" && mB2[2] === "0", outB2.slice(-600));
  ok("S2 B2 anchors: the anti-spam window (T16) + the pending-start cross-gate (T17) present and green",
     outB2.includes("== T16 ") && outB2.includes("== T17 "), outB2.slice(-300));

  const outC6 = run("node", [join(HERE, "taskC6-fntest.mjs")], { cwd: HERE, timeout: 180000 });
  const m6 = outC6.match(/taskC6-fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskC6-fntest 37 PASS / 0 FAIL (regression)", !!m6 && m6[1] === "37" && m6[2] === "0", outC6.slice(-500));
}

/* ---------------- S3: config-level regression (real cores) ---------------- */
console.log("\n== S3 config-level (taskC4-cfgtest regression: real xray -test + sing-box check) ==");
{
  const out = run("node", [join(HERE, "taskC4-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  const m = out.match(/C4-CFGTEST: (\d+) PASS \/ (\d+) FAIL/);
  ok("S3 taskC4-cfgtest 30 PASS / 0 FAIL", !!m && m[1] === "30" && m[2] === "0", out.slice(-600));
}

/* ---------------- S4: LIVE kill-switch regression + tracked-limitation canary ---------------- */
console.log("\n== S4 LIVE kill-switch regression (taskC5-live) + C4 uplink-gap canary ==");
{
  const out = run("node", [join(HERE, "taskC5-live.mjs")], { cwd: HERE, timeout: 300000 });
  const m = out.match(/C5-LIVE: (\d+) PASS \/ (\d+) FAIL/);
  ok("S4 taskC5-live 12 PASS / 0 FAIL", !!m && m[1] === "12" && m[2] === "0", out.slice(-600));
  ok("S4 fail-closed anchor: armed crash (SIGKILL of the REAL core) -> BLOCKED, never direct",
     out.includes("PASS  LIVE xa-armed-crash"), out.slice(-300));
  ok("S4 quit-boundary anchor: quit latch outranks the armed state (CLEAR wins)",
     out.includes("PASS  LIVE xa-quit-latch"), out.slice(-300));
  ok("S4 foreign hands-off anchor: a foreign proxy is NEVER touched",
     out.includes("PASS  LIVE audit-foreign"), out.slice(-300));
  const probe = run("node", [join(HERE, "taskC4-uplink-probe.mjs")], { cwd: HERE, timeout: 300000 });
  ok("S4 uplink probe ran to completion (X1/X2/X3 + UP-PROBE DONE)",
     probe.includes("X1-plain-vless") && probe.includes("X2-sockopt-nudge") &&
     probe.includes("X3-two-vless") && probe.includes("UP-PROBE DONE"), probe.slice(-400));
  ok("S4 tracked limitation still reproduces on the pinned v25.1.1 (vless uplink stays 0 under balancer)",
     /up=0/.test(probe), probe.slice(-400));
}

/* ---------------- S5: regression suites ---------------- */
console.log("\n== S5 regression suites ==");
{
  const suites = [
    ["task13-selftest", "RESULT: 25 PASS / 0 FAIL"],
    ["task13-cfgtest", "RESULT: 4 PASS / 0 FAIL"],
    ["taskD1-quickcheck", "RESULT: 29 PASS / 0 FAIL"],
    ["taskD2-quickcheck", "RESULT: 44 PASS / 0 FAIL"],
    ["taskD2-cfgtest", "RESULT: 36 PASS / 0 FAIL"],
    ["taskD3-quickcheck", "RESULT: 40 PASS / 0 FAIL"],
    ["taskD4-quickcheck", "D4 quickcheck: 41 PASS / 0 FAIL"],
    ["taskC5-quickcheck", "C5-QUICKCHECK: 44 PASS / 0 FAIL"],
    ["taskC5-fntest", "C5-FNTEST: 34 PASS / 0 FAIL"],
  ];
  for (const [name, want] of suites) {
    const out = run("node", [join(HERE, `${name}.mjs`)], { cwd: HERE });
    ok(`S5 ${name} (${want})`, out.includes(want), out.slice(-300));
  }
  const out12 = run("node", [join(HERE, "task12-quickcheck.mjs")], { cwd: HERE });
  ok("S5 task12-quickcheck (7 assertions)", /QUICK-CHECK: 7 assertions passed/.test(out12), out12.slice(-300));
  const outD4f = run("node", [join(HERE, "taskD4-fntest.mjs")], { cwd: HERE });
  ok("S5 taskD4-fntest (20 assertions)", /D4 fntest: 20 PASS \/ 0 FAIL/.test(outD4f), outD4f.slice(-300));
  const outD4q = run("node", [join(HERE, "taskD4-quitclean-fntest.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskD4-quitclean-fntest (31 assertions, both phases)",
     /D4 quit-cleanup fntest: 31 PASS \/ 0 FAIL \(both phases\)/.test(outD4q), outD4q.slice(-300));

  const outC1q = run("node", [join(HERE, "taskC1-quickcheck.mjs")], { cwd: HERE });
  ok("S5 taskC1-quickcheck (36 assertions)", /RESULT: 36 PASS \/ 0 FAIL/.test(outC1q), outC1q.slice(-300));
  const outC1f = run("node", [join(HERE, "taskC1-fntest.mjs")], { cwd: HERE });
  ok("S5 taskC1-fntest (22 assertions)", /RESULT: 22 PASS \/ 0 FAIL/.test(outC1f), outC1f.slice(-300));
  const outC1c = run("node", [join(HERE, "taskC1-cfgtest.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskC1-cfgtest (29 assertions)", /RESULT: 29 PASS \/ 0 FAIL/.test(outC1c), outC1c.slice(-300));
  const outC1l = run("node", [join(HERE, "taskC1-live.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskC1-live (5 assertions)", /RESULT: 5 PASS \/ 0 FAIL/.test(outC1l), outC1l.slice(-300));

  const outC2q = run("node", [join(HERE, "taskC2-quickcheck.mjs")], { cwd: HERE });
  ok("S5 taskC2-quickcheck (54 assertions)", /RESULT: 54 PASS \/ 0 FAIL/.test(outC2q), outC2q.slice(-300));
  const outC2f = run("node", [join(HERE, "taskC2-fntest.mjs")], { cwd: HERE });
  ok("S5 taskC2-fntest (39 assertions)", /RESULT: 39 PASS \/ 0 FAIL/.test(outC2f), outC2f.slice(-300));
  const outC2c = run("node", [join(HERE, "taskC2-cfgtest.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskC2-cfgtest (41 assertions)", /RESULT: 41 PASS \/ 0 FAIL/.test(outC2c), outC2c.slice(-300));
  const outC2l = run("node", [join(HERE, "taskC2-live.mjs")], { cwd: HERE, timeout: 180000 });
  ok("S5 taskC2-live (9 assertions)", /RESULT: 9 PASS \/ 0 FAIL/.test(outC2l), outC2l.slice(-300));

  const outC3q = run("node", [join(HERE, "taskC3-quickcheck.mjs")], { cwd: HERE });
  ok("S5 taskC3-quickcheck (56 assertions)", /RESULT: 56 PASS \/ 0 FAIL/.test(outC3q), outC3q.slice(-300));
  const outC3f = run("node", [join(HERE, "taskC3-fntest.mjs")], { cwd: HERE });
  ok("S5 taskC3-fntest (44 assertions)", /RESULT: 44 PASS \/ 0 FAIL/.test(outC3f), outC3f.slice(-300));
  const outC3c = run("node", [join(HERE, "taskC3-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  ok("S5 taskC3-cfgtest (20 assertions)", /RESULT: 20 PASS \/ 0 FAIL/.test(outC3c), outC3c.slice(-300));
  const outC3l = run("node", [join(HERE, "taskC3-live.mjs")], { cwd: HERE, timeout: 240000 });
  ok("S5 taskC3-live (11 assertions)", /RESULT: 11 PASS \/ 0 FAIL/.test(outC3l), outC3l.slice(-300));

  const outC4q = run("node", [join(HERE, "taskC4-quickcheck.mjs")], { cwd: HERE });
  ok("S5 taskC4-quickcheck (58 assertions)", /C4-QUICKCHECK: 58 PASS \/ 0 FAIL/.test(outC4q), outC4q.slice(-300));
  const outC4f = run("node", [join(HERE, "taskC4-fntest.mjs")], { cwd: HERE });
  ok("S5 taskC4-fntest (52 assertions)", /C4-FNTEST: 52 PASS \/ 0 FAIL/.test(outC4f), outC4f.slice(-300));
  const outC4c = run("node", [join(HERE, "taskC4-cfgtest.mjs")], { cwd: HERE, timeout: 240000 });
  ok("S5 taskC4-cfgtest (30 assertions)", /C4-CFGTEST: 30 PASS \/ 0 FAIL/.test(outC4c), outC4c.slice(-300));
  const outC4l = run("node", [join(HERE, "taskC4-live.mjs")], { cwd: HERE, timeout: 300000 });
  ok("S5 taskC4-live (21 assertions)", /C4-LIVE: 21 PASS \/ 0 FAIL/.test(outC4l), outC4l.slice(-300));
}

console.log(`\nFORMAL SMOKE B2: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
