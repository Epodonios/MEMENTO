#!/usr/bin/env node
/**
 * Phase E / Batch E2 OFFICIAL FORMAL SMOKE (user-approved 2026-09-21 —
 * "تأیید کامل پیاده‌سازی E2"; the MEMENTO ShadowTLS parser, the THIRD
 * post-B register item; run the official smoke + zip + seal; after the
 * seal, copy into seals-archive/ and hash-verify in place).
 *
 * Batch E2 = an ADDITIVE runtime batch, GREENFIELD protocol support:
 * the proprietary memento-stls:// scheme (ShadowTLS is a TRANSPORT, not
 * a standalone proxy — live-probe P5 proved a bare shadowtls outbound
 * passes check but carries NO traffic — so the scheme's userinfo carries
 * the INNER trojan credential and the transport params ride the query
 * string). parseShadowTLS() in store.ts with the honest validation
 * (versions exactly 1..3 — probe P1 v4 FATAL; v2/v3 require stls-password
 * — probe P3: the server field is users[]), the paired-outbound generator
 * in singBoxConfig.ts (trojan primary detour:stls-t + the shadowtls
 * transport outbound, tag stls-t; probe P4 carried REAL loopback traffic
 * 200:14336 through exactly this pair), THREE honest connect-flow gates
 * in connectionActions.ts (shadowtls MAIN + topology aborts, shadowtls
 * hop aborts, shadowtls pool pick dropped with a reason) backed by the
 * generator-side defense (a shadowtls MAIN ignores topology wholesale —
 * a hop would overwrite the pair's detour and orphan the transport),
 * the amber NON-STANDARD disclosure in the Import tab (import.stlsNote
 * x4 languages — the scheme is proprietary MEMENTO, sing-box ONLY; the
 * pinned Xray 25.1.1 rejects the protocol, probe P2 "unknown config id:
 * shadowtls", exit 23), the ConfigsTab chip, ping/editor peripherals,
 * the electron-mock demo-de-stls config, README Batch-E2 + CHECKLIST
 * section 35. The whole electron/* surface is BYTE-STABLE (sha-pinned);
 * no export/QR (parity with hy2/tuic, approved).
 *
 * Gate structure (extends the E1 smoke; S1-S5 RE-RUN the full regression
 * battery chain — 982 through B0 + 145 B1 + 124 B2 + 123 B3 + 33 B4
 * (taskB4-quickcheck) + 45 L0 (taskL0-quickcheck) + 20 E1 (taskE1-fntest)
 * + 65 E1 (taskE1-quickcheck) + 26 E2 (taskE2-fntest) + 72 E2
 * (taskE2-quickcheck) = 1,635 embedded assertions at the E2 close gate):
 *   S0   real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *        + fresh builds of BOTH frontend (vite) and main (tsc) + compiled
 *        artifacts incl. dist-electron/connectionStats.js, the B1
 *        trio, routingManager.js, killSwitch.js.
 *   S0b  B0 LIVE provenance regression: fetch-wintun.sh re-run END-TO-END
 *        against the official source, post-run on-disk dll hash == pin,
 *        audit-copy cross-check (the B0 chain must stay live on the B4
 *        tree — the B1 spawn gate consumes exactly this artifact).
 *   S1   structural surface via taskC6-quickcheck.mjs (51) + C6 dist
 *        freshness + compiled C6 pins (regression — E2 touched none of
 *        it); the preload allowlist stays 32 (B1's 27 + B2's 4 routing
 *        + the E1 probe channel — E2 added NO IPC).
 *   S1b  B0 structural regression: wintunPin.ts all 8 constants +
 *        constants-only negatives + compiled wintunPin.js + both fetch
 *        scripts + provenance docs + core-versions.json + digest
 *        uniqueness (NOW 23 sanctioned files — the E2 smoke/zip gate
 *        scripts join the B0-B4 + L0 + E1 set). The B1 gates RETAINED:
 *        wintunPin consumers EXACTLY routingSession, the B1 modules at
 *        537 + 673 lines.
 *   S1c  B1 structural gates: taskB1-quickcheck.mjs (47) + direct
 *        compiled pins (routingSession/routingHelper/main wiring +
 *        electron-free at the compiled level).
 *   S1d  B2 structural gates: taskB2-quickcheck.mjs (55) + direct
 *        compiled pins (the factory/heal/anti-spam window, the 4 ipc
 *        handlers + the D6 gates, the cleanup order, the preload entries,
 *        the manager at 535 lines).
 *   S1e  B3 structural gates: taskB3-quickcheck.mjs (57) + direct
 *        compiled pins (the killSwitch TUN twin + the block-only audit
 *        pair, the manager staleness/observeLive/getLeftoverAuditState,
 *        the helper fresh-armed reader + the heartbeat, the main.ts
 *        audit order + the 2 s unref'd watchdog; killSwitch.ts 262 /
 *        main.ts 499 lines).
 *   S1f  B4 structural gates (regression): taskB4-quickcheck.mjs (33) +
 *        direct doc pins (README 1447 with the seal chain + the L0/E1/E2
 *        sections, TESTING-CHECKLIST 474 with the five sweep legs +
 *        sections 33/34/35, the probe at 212 lines with the B4 NOTE + the
 *        ORIGINAL S4 line retained + the byte-stable body + node
 *        --check, and the probe stays OUT of taskB4-battery).
 *   S1g  L0 structural gates (regression): taskL0-quickcheck.mjs (45) +
 *        direct pins (README 1447 + the register DONE lines, CHECKLIST
 *        474 + the seven legs, the manifest structure 16/2/4, the 7
 *        verbatim texts on disk, the NOTICE authority pointer, and the
 *        probe stays OUT of the taskL0-battery fork too).
 *   S1h  E1 structural gates (regression): taskE1-quickcheck.mjs (65,
 *        incl. the LIVE probe re-run G8) + direct pins (the two new
 *        files at their reported sizes 250 + 214, the compiled
 *        connectionStats.js electron-free with both mappers + the
 *        deadlines, the compiled ipc.js additive handler + aether
 *        honesty + the main-side secret handoff, the compiled preload
 *        allowlist 32, the dist freshness of the panel strings, and the
 *        E1 battery fork riding BOTH E1 suites while keeping the design
 *        probe OUT).
 *   S1i  NEW E2 structural gates: taskE2-quickcheck.mjs (72, incl. the
 *        LIVE probe re-run G8 — schema matrix + xray rejection + P4
 *        200:14336 + P5 bare fails) + direct pins (store.ts 1476 with
 *        parseShadowTLS + the dispatch + the pass-through; the generator
 *        at 318 with the STLS pair + allowStlsPair + the topology
 *        wholesale-ignore; the THREE connectionActions gates; the
 *        ImportTab chip + amber disclosure; the ConfigsTab chip;
 *        ping/editor peripherals; i18n import.stlsNote x4; the
 *        electron-mock demo-de-stls; v2rayConfig.ts + xray.ts carry NO
 *        shadowtls token at all; the dist freshness of the scheme
 *        strings; README Batch-E2 + CHECKLIST section 35; and the E2
 *        battery fork riding BOTH E2 suites while keeping BOTH design
 *        probes OUT).
 *   S2   functional: taskE2-fntest.mjs (26 — the REAL bundled renderer
 *        modules against the REAL pinned binary: F1 parse -> generate ->
 *        check -> run -> REAL traffic through the generated pair,
 *        F2 parse honesty, F3 scope honesty, F4 peripherals) +
 *        taskE1-fntest.mjs (20 — the REAL compiled connectionStats.js
 *        against BOTH pinned cores: the F1 live per-connection catch,
 *        the F2 per-outbound honesty, the F3 failure honesty) +
 *        taskB1-fntest.mjs (98 — the whole watchdog
 *        state machine, the REAL sing-box check, the tamper refusal) +
 *        taskB2-fntest.mjs (69 — the manager surface incl. the repair
 *        anti-UAC-spam window T16 + the pending-start cross-gate T17) +
 *        taskB3-fntest.mjs (66 — the heartbeat, the flagship fresh-armed
 *        flip, the once-only transition, the block-only audit, the boot
 *        guard order) + taskC6-fntest.mjs (37, regression).
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
  ok("S0 dist-electron/connectionStats.js exists post-build (the E1 stats module ships compiled)",
     fs.existsSync(join(APP, "dist-electron", "connectionStats.js")));
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
  ok("S1 compiled preload (rebuilt): allowlist = 32 commands (B1's 27 + the 4 approved B2 routing + EXACTLY the one E1 probe channel)",
     allow.length === 32 && allow.includes("aether_update_status") &&
     allow.includes("aether_update_check") && allow.includes("aether_update_apply") &&
     allow.includes("app_update_info") && allow.includes("routing_start") &&
     allow.includes("routing_stop") && allow.includes("routing_status") &&
     allow.includes("routing_repair") && allow.includes("get_connection_stats"),
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
  ok("S1b NOTICE.md: wintun attribution line + license + shipped-text pointer (bullet form since the approved L0 rewrite; content verbatim)",
     notice.includes("**wintun.dll 0.14.1 (amd64)**") &&
     notice.includes("Prebuilt Binaries License") &&
     notice.includes("resources/wintun/wintun-LICENSE.txt") &&
     notice.includes("WireGuard LLC"));
  ok("S1b NOTICE.md: THIRD-PARTY.json LANDED as the machine-readable authority (the B0 promise fulfilled at L0)",
     notice.includes("THIRD-PARTY.json") && notice.includes("MACHINE-READABLE authority") &&
     notice.includes("landed at Phase E Batch L0"));

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
  // exported pin value byte-exactly), the B2/B3/B4 gate scripts, and NOW
  // the L0 set: the manifest (its wintun entry pins both digests) + the
  // L0 gate scripts.
  const sanctioned = new Set([
    join(APP, "electron", "wintunPin.ts"),
    join(APP, "scripts", "fetch-wintun.sh"),
    join(APP, "scripts", "fetch-wintun.ps1"),
    join(APP, "resources", "wintun", "README.md"),
    join(APP, "resources", "THIRD-PARTY.json"),
    join(HERE, "taskB0-smoke.mjs"),
    join(HERE, "taskB0-zip.mjs"),
    join(HERE, "taskB1-fntest.mjs"),
    join(HERE, "taskB1-smoke.mjs"),
    join(HERE, "taskB1-zip.mjs"),
    join(HERE, "taskB2-smoke.mjs"),
    join(HERE, "taskB2-zip.mjs"),
    join(HERE, "taskB3-smoke.mjs"),
    join(HERE, "taskB3-zip.mjs"),
    join(HERE, "taskB4-smoke.mjs"),
    join(HERE, "taskB4-zip.mjs"),
    join(HERE, "taskL0-quickcheck.mjs"),
    join(HERE, "taskL0-smoke.mjs"),
    join(HERE, "taskL0-zip.mjs"),
    join(HERE, "taskE1-smoke.mjs"),
    join(HERE, "taskE1-zip.mjs"),
    join(HERE, "taskE2-smoke.mjs"),
    join(HERE, "taskE2-zip.mjs"),
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
  ok("S1b digest uniqueness: the wintun digests appear ONLY in the 23 sanctioned files (the E2 smoke/zip gate scripts join)",
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

/* ---------------- S1e: B3 structural gates (NEW) ---------------- */
console.log("\n== S1e B3 structural (taskB3-quickcheck + direct compiled pins) ==");
{
  const out = run("node", [join(HERE, "taskB3-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/taskB3-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1e taskB3-quickcheck 57 PASS / 0 FAIL", !!m && m[1] === "57" && m[2] === "0", out.slice(-400));

  const ksLines = (fs.readFileSync(join(APP, "electron", "killSwitch.ts"), "utf8").match(/\n/g) || []).length;
  ok("S1e killSwitch.ts at the reported size (262 lines — the C5 core + the B3 TUN twin/audit pair)",
     ksLines === 262, `got ${ksLines}`);
  const mainLines = (fs.readFileSync(join(APP, "electron", "main.ts"), "utf8").match(/\n/g) || []).length;
  ok("S1e main.ts at the reported size (499 lines — the B3 audit + watchdog + wiring included)",
     mainLines === 499, `got ${mainLines}`);

  const compiledKs = fs.readFileSync(join(APP, "dist-electron", "killSwitch.js"), "utf8");
  ok("S1e compiled killSwitch.js: the TUN twin + the TUN audit pair shipped, C5 originals intact",
     compiledKs.includes("blockOnRoutingExit") &&
     compiledKs.includes("resolveRoutingAuditAction") &&
     compiledKs.includes("applyRoutingAuditAction") &&
     compiledKs.includes("releaseSystemProxy") && compiledKs.includes("blockOnCoreExit") &&
     compiledKs.includes("resolveAuditAction") && compiledKs.includes("enforceKillSwitchAfterPrefChange"));
  const routingApplyBody = compiledKs.match(/function applyRoutingAuditAction\([\s\S]*?\n\}/);
  ok("S1e compiled killSwitch.js: applyRoutingAuditAction has NO clear branch (block-only by construction)",
     !!routingApplyBody && !routingApplyBody[0].includes("clearSystemProxy"));

  const compiledMgr = fs.readFileSync(join(APP, "dist-electron", "routingManager.js"), "utf8");
  ok("S1e compiled routingManager.js: the 30 s staleness budget + the once-only transition + the audit view shipped",
     /30_?000/.test(compiledMgr) && compiledMgr.includes("ROUTING_STATUS_STALE_MS") &&
     compiledMgr.includes("observeLive") && compiledMgr.includes("wasLive") &&
     compiledMgr.includes("getLeftoverAuditState") &&
     compiledMgr.includes("heartbeat lost") && compiledMgr.includes("onRoutingLiveLost"));

  const compiledHelper = fs.readFileSync(join(APP, "dist-electron", "routingHelper.js"), "utf8");
  ok("S1e compiled routingHelper.js: the fresh-armed reader + the heartbeat shipped (the D6 outcomes unchanged)",
     compiledHelper.includes("defaultReadKillSwitchArmed") &&
     compiledHelper.includes("memento-app-prefs.json") &&
     compiledHelper.includes("hold-reconnecting") && compiledHelper.includes("teardown-restoring"));

  const compiledMain = fs.readFileSync(join(APP, "dist-electron", "main.js"), "utf8");
  ok("S1e compiled main.js: the TUN audit runs AFTER the proxy audit in the SAME deferred tick",
     compiledMain.includes("auditLeftoverRoutingSession") &&
     compiledMain.includes("auditLeftoverProxy()") &&
     compiledMain.indexOf("auditLeftoverProxy()") < compiledMain.indexOf("auditLeftoverRoutingSession()"));
  ok("S1e compiled main.js: the 2 s unref'd watchdog + the C5 wiring shipped",
     /2_?000/.test(compiledMain) && compiledMain.includes("setInterval") &&
     compiledMain.includes("unref") && compiledMain.includes("onRoutingLiveLost") &&
     compiledMain.includes("blockOnRoutingExit"));

  const dist = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  ok("S1e renderer fresh: the kill-switch hint names the TUN hold + the silent-helper block (built in)",
     dist.includes("In VPN Device (TUN) mode the same switch drives the hold"));
}

/* ---------------- S1f: B4 structural gates (NEW — the closeout) ---------------- */
console.log("\n== S1f B4 structural (taskB4-quickcheck + direct doc pins + the probe battery exclusion) ==");
{
  const out = run("node", [join(HERE, "taskB4-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/taskB4-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1f taskB4-quickcheck 33 PASS / 0 FAIL", !!m && m[1] === "33" && m[2] === "0", out.slice(-400));

  const readmeLines = (fs.readFileSync(join(APP, "README.md"), "utf8").match(/\n/g) || []).length;
  ok("S1f README.md at the reported size (1447 lines — the Batch-B4 closeout + the Batch-L0/E1/E2 sections included)",
     readmeLines === 1447, `got ${readmeLines}`);
  const readme = fs.readFileSync(join(APP, "README.md"), "utf8");
  ok("S1f README Batch-B4 carries the FULL seal chain (B0/B1/B2/B3 fragments)",
     readme.includes("(seal `bef82af1…`)") && readme.includes("(seal `d7ca91c9…`)") &&
     readme.includes("`be226a11…`") && readme.includes("(seal `499fbe14…`)"));

  const checklistLines = (fs.readFileSync(join(APP, "TESTING-CHECKLIST.md"), "utf8").match(/\n/g) || []).length;
  ok("S1f TESTING-CHECKLIST.md at the reported size (474 lines — sections 32 + 33 + 34 + 35 included)",
     checklistLines === 474, `got ${checklistLines}`);
  const checklist = fs.readFileSync(join(APP, "TESTING-CHECKLIST.md"), "utf8");
  ok("S1f TESTING-CHECKLIST section 32 carries the five acceptance-sweep legs",
     checklist.includes("## 32. Phase B4 — Phase B closeout (real-Windows final acceptance sweep)") &&
     checklist.includes("- [ ] Provenance leg (B0):") &&
     checklist.includes("- [ ] Full lifecycle leg (B1+B2+B3, one continuous pass):") &&
     checklist.includes("- [ ] Crash-residue leg (B3 audit):") &&
     checklist.includes("- [ ] Documentation leg (B4):") &&
     checklist.includes("- [ ] Regression leg (pre-B parity):"));

  const probeBody = fs.readFileSync(join(ROOT, "scripts", "taskC4-probe.mjs"), "utf8");
  const probeLines = (probeBody.match(/\n/g) || []).length;
  ok("S1f taskC4-probe.mjs at the reported size (212 lines — the 16-line B4 NOTE header is the ONLY edit)",
     probeLines === 212, `got ${probeLines}`);
  ok("S1f probe header: the B4 NOTE recorded + the ORIGINAL S4 expectation line retained verbatim",
     probeBody.includes(" * B4 NOTE (2026-09-20, design-time artifact status):") &&
     probeBody.includes(" *     S4  NEGATIVE: urltest referencing a missing outbound must be REJECTED"));
  ok("S1f probe body byte-stable below the header (the executable semantics unchanged)",
     probeBody.includes('S4_NEG_missing_member: sbBase(') &&
     probeBody.includes('outbounds: ["proxy", "ghost"],') &&
     probeBody.includes("process.exit(fail ? 1 : 0);"));
  ok("S1f probe parses clean after the docstring edit (node --check)",
     (() => { try { execFileSync(process.execPath, ["--check", join(ROOT, "scripts", "taskC4-probe.mjs")], { stdio: "pipe" }); return true; } catch { return false; } })());
  const bat = fs.readFileSync(join(HERE, "taskB4-battery.mjs"), "utf8");
  ok("S1f the design-time probe stays OUT of the battery (the B4 disposition honored — list-entry-shaped negative)",
     bat.includes("taskB4-quickcheck.mjs") && !/^\s*\["taskC4-probe/m.test(bat));
}

/* ---------------- S1g: L0 structural gates (NEW — the license manifest) ---------------- */
console.log("\n== S1g L0 structural (taskL0-quickcheck + direct doc/manifest pins + the battery fork) ==");
{
  const out = run("node", [join(HERE, "taskL0-quickcheck.mjs")], { cwd: HERE });
  const m = out.match(/taskL0-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1g taskL0-quickcheck 45 PASS / 0 FAIL", !!m && m[1] === "45" && m[2] === "0", out.slice(-400));

  const readmeLinesL0 = (fs.readFileSync(join(APP, "README.md"), "utf8").match(/\n/g) || []).length;
  ok("S1g README.md at the post-E2 size (1447 lines — the post-B register advances)",
     readmeLinesL0 === 1447, `got ${readmeLinesL0}`);
  const readmeL0 = fs.readFileSync(join(APP, "README.md"), "utf8");
  ok("S1g README carries the Batch-L0 section + the historical L0 register block retained verbatim (E1/E2 struck later at E1/E2)",
     readmeL0.includes("## Phase E — Batch L0 (third-party license/origin manifest — the post-B register begins)") &&
     readmeL0.includes("~~THIRD-PARTY.json~~ — **DONE at this batch**") &&
     readmeL0.includes("**E1** per-connection stats;") && readmeL0.includes("**E2** ShadowTLS parser;") &&
     readmeL0.includes("**setup-app** the new installer;"));

  const checklistLinesL0 = (fs.readFileSync(join(APP, "TESTING-CHECKLIST.md"), "utf8").match(/\n/g) || []).length;
  ok("S1g TESTING-CHECKLIST.md at the post-E2 size (474 lines — sections 33 + 34 + 35 included)",
     checklistLinesL0 === 474, `got ${checklistLinesL0}`);
  const checklistL0 = fs.readFileSync(join(APP, "TESTING-CHECKLIST.md"), "utf8");
  ok("S1g TESTING-CHECKLIST section 33 carries the seven real-Windows legs",
     checklistL0.includes("## 33. Phase E — Batch L0 (license manifest — real-Windows verification)") &&
     checklistL0.includes("- [ ] Manifest rides:") && checklistL0.includes("- [ ] Pin cross-check:") &&
     checklistL0.includes("- [ ] Verbatim texts ride:") && checklistL0.includes("- [ ] GPL/AGPL source offers:") &&
     checklistL0.includes("- [ ] Attribution walk:") && checklistL0.includes("- [ ] Packaging leg:") &&
     checklistL0.includes("- [ ] Regression leg (inert data):"));

  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(join(APP, "resources", "THIRD-PARTY.json"), "utf8")); } catch { /* the gate below flags it */ }
  ok("S1g resources/THIRD-PARTY.json parses; manifestVersion 1 + the live evidence date + exactly 16 bundled + 2 runtimeFetched + 4 excluded",
     !!manifest && manifest.manifestVersion === 1 && manifest.liveEvidenceDate === "2026-09-20" &&
     Array.isArray(manifest.bundled) && manifest.bundled.length === 16 &&
     Array.isArray(manifest.runtimeFetched) && manifest.runtimeFetched.length === 2 &&
     Array.isArray(manifest.excluded) && manifest.excluded.length === 4);
  const licDir = join(APP, "resources", "licenses");
  const licFiles = ["Xray-core-v25.1.1-MPL-2.0.txt", "sing-box-v1.14.0-GPL-3.0.txt",
    "sing-box-v1.14.0-LICENSE-notice.txt", "Aether-v1.9.0-AGPL-3.0.txt",
    "jsqr-1.4.0-Apache-2.0.txt", "Inter-OFL-1.1.txt", "JetBrainsMono-OFL-1.1.txt"];
  ok("S1g all 7 verbatim license texts exist in resources/licenses/ (the wintun text stays at resources/wintun/)",
     licFiles.every((f) => fs.existsSync(join(licDir, f))) &&
     fs.existsSync(join(APP, "resources", "wintun", "wintun-LICENSE.txt")));
  const noticeBody = fs.readFileSync(join(APP, "NOTICE.md"), "utf8");
  ok("S1g NOTICE.md: the authority chain stated (machine-readable manifest / human NOTICE / verbatim texts)",
     noticeBody.includes("MACHINE-READABLE authority") &&
     noticeBody.includes("`resources/THIRD-PARTY.json`") &&
     noticeBody.includes("`resources/licenses/`") &&
     noticeBody.includes("landed at Phase E Batch L0, 2026-09-20"));
  const bat0 = fs.readFileSync(join(HERE, "taskL0-battery.mjs"), "utf8");
  ok("S1g the design-time probe stays OUT of the L0 battery fork too (list-entry-shaped negative)",
     bat0.includes('"taskL0-quickcheck.mjs", 45') && !/^\s*\["taskC4-probe/m.test(bat0));
}

/* ---------------- S1h: E1 structural gates (NEW — the per-connection stats) ---------------- */
console.log("\n== S1h E1 structural (taskE1-quickcheck + direct compiled/doc pins + the battery fork) ==");
{
  const out = run("node", [join(HERE, "taskE1-quickcheck.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/taskE1-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1h taskE1-quickcheck 65 PASS / 0 FAIL (incl. the LIVE probe re-run G8 against the pinned cores)",
     !!m && m[1] === "65" && m[2] === "0", out.slice(-400));

  const statsLines = (fs.readFileSync(join(APP, "electron", "connectionStats.ts"), "utf8").match(/\n/g) || []).length;
  ok("S1h connectionStats.ts at the reported size (250 lines — the ONE main-side stats module)",
     statsLines === 250, `got ${statsLines}`);
  const panelLines = (fs.readFileSync(join(ROOT, "src", "components", "ConnectionStatsPanel.tsx"), "utf8").match(/\n/g) || []).length;
  ok("S1h ConnectionStatsPanel.tsx at the reported size (214 lines — self-polling ONLY while expanded+connected)",
     panelLines === 214, `got ${panelLines}`);

  const readmeE1 = fs.readFileSync(join(APP, "README.md"), "utf8");
  ok("S1h README carries the Batch-E1 section + the register update (E1 DONE, E2/setup-app remain)",
     readmeE1.includes("## Phase E — Batch E1 (live per-connection stats") &&
     readmeE1.includes("~~E1~~ — **DONE at this batch**") &&
     readmeE1.includes("**E2** ShadowTLS parser;") && readmeE1.includes("**setup-app** the new installer;"));
  const checklistE1 = fs.readFileSync(join(APP, "TESTING-CHECKLIST.md"), "utf8");
  ok("S1h TESTING-CHECKLIST section 34 carries the real-Windows legs (both cores + aether + the regression leg)",
     checklistE1.includes("## 34. Phase E — Batch E1") &&
     checklistE1.includes("- [ ] sing-box leg:") && checklistE1.includes("- [ ] xray leg:") &&
     checklistE1.includes("- [ ] aether leg:") && checklistE1.includes("- [ ] Regression leg:"));

  const compiledStats = fs.readFileSync(join(APP, "dist-electron", "connectionStats.js"), "utf8");
  ok("S1h compiled connectionStats.js (rebuilt): BOTH mappers + the honest granularities + the 1200 ms deadlines + the 200-row cap shipped",
     compiledStats.includes("getConnectionStats") &&
     compiledStats.includes("per-connection") && compiledStats.includes("per-outbound") &&
     compiledStats.includes("abort()") && compiledStats.includes("1200") &&
     /MAX_ROWS = 200/.test(compiledStats));
  ok("S1h compiled connectionStats.js has NO direct require(\"electron\") (electron-free like the B1 modules; the fntest stub owns the boundary)",
     !compiledStats.includes('require("electron")'));
  const compiledIpcE1 = fs.readFileSync(join(APP, "dist-electron", "ipc.js"), "utf8");
  ok("S1h compiled ipc.js (rebuilt): the additive get_connection_stats handler + the aether honest-none + the secret handed MAIN-SIDE only",
     compiledIpcE1.includes('"get_connection_stats"') &&
     compiledIpcE1.includes('granularity: "none"') &&
     compiledIpcE1.includes("getClashSecret()"));
  const compiledPreloadE1 = fs.readFileSync(join(APP, "dist-electron", "preload.js"), "utf8");
  ok("S1h compiled preload (rebuilt): get_connection_stats rides the allowlist EXACTLY once",
     (compiledPreloadE1.match(/get_connection_stats/g) || []).length === 1);

  const distE1 = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  ok("S1h dist fresh: the panel's honest strings built in (per-outbound note + aether none + the live label)",
     distE1.includes("connections.perOutboundNote") && distE1.includes("connections.none") &&
     distE1.includes("connections.live"));

  const batE1 = fs.readFileSync(join(HERE, "taskE1-battery.mjs"), "utf8");
  ok("S1h the E1 battery fork rides BOTH E1 suites and keeps BOTH design probes OUT (list-entry-shaped negatives)",
     batE1.includes('"taskE1-quickcheck.mjs", 65') && batE1.includes('"taskE1-fntest.mjs", 20') &&
     !/^\s*\["taskE1-probe/m.test(batE1) && !/^\s*\["taskC4-probe/m.test(batE1));
}

/* ---------------- S1i: E2 structural gates (NEW — the ShadowTLS parser) ---------------- */
console.log("\n== S1i E2 structural (taskE2-quickcheck + direct source/doc pins + the battery fork) ==");
{
  const out = run("node", [join(HERE, "taskE2-quickcheck.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/taskE2-quickcheck: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1i taskE2-quickcheck 72 PASS / 0 FAIL (incl. the LIVE probe re-run G8: the P1 schema matrix + the P2 xray rejection + P4 200:14336 + P5 bare fails)",
     !!m && m[1] === "72" && m[2] === "0", out.slice(-400));

  const storeBody = fs.readFileSync(join(ROOT, "src", "store.ts"), "utf8");
  const storeLines = (storeBody.match(/\n/g) || []).length;
  ok("S1i store.ts at the reported size (1476 lines — the E2 parser additions included)",
     storeLines === 1476, `got ${storeLines}`);
  ok("S1i store.ts: ProtocolType + shadowtls and isSingBoxProtocol = EXACTLY hysteria2/tuic/shadowtls (the xray-path structural exclusion)",
     storeBody.includes('export type ProtocolType = "vmess" | "vless" | "trojan" | "ss" | "ssr" | "socks" | "hysteria2" | "tuic" | "shadowtls";') &&
     storeBody.includes('return protocol === "hysteria2" || protocol === "tuic" || protocol === "shadowtls";'));
  ok("S1i store.ts: ParsedConfig carries the ShadowTLS transport pair fields",
     storeBody.includes("stlsVersion?: string;") && storeBody.includes("stlsPassword?: string;"));
  ok("S1i store.ts: parseShadowTLS with the honest validation (version 1..3 only; v2/v3 require stls-password — the live probe contract)",
     storeBody.includes('const urlPart = raw.replace("memento-stls://", "");') &&
     storeBody.includes('const version = params.get("version") || "3";') &&
     storeBody.includes('"Invalid ShadowTLS version (expected 1, 2 or 3)"') &&
     storeBody.includes('"ShadowTLS v2/v3 requires stls-password"'));
  ok("S1i store.ts: the memento-stls:// dispatch in parseSingleLink + the pass-through fields (subscriptions inherit the scheme)",
     storeBody.includes('trimmed.startsWith("memento-stls://")') &&
     storeBody.includes("parsed = parseShadowTLS(trimmed);") &&
     storeBody.includes('parsed.protocol = "shadowtls";') &&
     storeBody.includes('stlsVersion: parsed.stlsVersion || "",') &&
     storeBody.includes('stlsPassword: parsed.stlsPassword || "",'));

  const sbBody = fs.readFileSync(join(ROOT, "src", "utils", "singBoxConfig.ts"), "utf8");
  const sbLines = (sbBody.match(/\n/g) || []).length;
  ok("S1i singBoxConfig.ts at the reported size (318 lines — the E2 generator additions included)",
     sbLines === 318, `got ${sbLines}`);
  ok("S1i singBoxConfig.ts: the paired outbounds — trojan primary detour:stls-t + the shadowtls transport (the live-proven P4 shape)",
     sbBody.includes('const STLS_TRANSPORT_TAG = "stls-t";') &&
     sbBody.includes('type: "trojan",') && sbBody.includes("detour: STLS_TRANSPORT_TAG,") &&
     sbBody.includes("type: \"shadowtls\",") &&
     sbBody.includes("version: Number(config.stlsVersion) || 3,") &&
     sbBody.includes("...(config.stlsPassword ? { password: config.stlsPassword } : {}),"));
  ok("S1i singBoxConfig.ts: allowStlsPair — the pair builds ONLY for the main connection (topology positions return null)",
     sbBody.includes("allowStlsPair = false,") &&
     sbBody.includes("if (!allowStlsPair) return null; // E2 v1 scope: main connection only") &&
     sbBody.includes("const outbound = buildSbOutbound(config, true);") &&
     sbBody.includes("const stlsTransport = config.protocol === \"shadowtls\" ? buildSbStlsTransport(config) : null;") &&
     sbBody.includes("...(stlsTransport ? [stlsTransport] : []), // Task E2: the paired transport"));
  ok("S1i singBoxConfig.ts: the generator-side topology defense — a shadowtls MAIN ignores topology wholesale (a hop would overwrite the pair's detour and orphan the transport)",
     sbBody.includes("? null // E2: a shadowtls MAIN is plain-only — a hop would overwrite the") &&
     sbBody.includes("? [] // E2: same for balancer members (feature-off, honest gate upstream)."));

  const caBody = fs.readFileSync(join(ROOT, "src", "utils", "connectionActions.ts"), "utf8");
  const caLines = (caBody.match(/\n/g) || []).length;
  ok("S1i connectionActions.ts at the reported size (375 lines — the THREE honest connect-flow gates included)",
     caLines === 375, `got ${caLines}`);
  ok("S1i connectionActions.ts: gate 1 shadowtls MAIN + chain/balancer enabled aborts; gate 2 shadowtls hop aborts; gate 3 shadowtls pool pick dropped with the honest reason",
     caBody.includes('if (config.protocol === "shadowtls" && (topo.chainEnabled || topo.balancerEnabled)) {') &&
     caBody.includes('"ShadowTLS connections run as a plain main connection — chain proxy and balancer are not supported for them yet.') &&
     caBody.includes('if (hop.protocol === "shadowtls") {') &&
     caBody.includes('"Chain proxy: ShadowTLS connections pair a transport with their inner trojan and run as the main connection only') &&
     caBody.includes('if (c.protocol === "shadowtls") { dropped.push(`${c.name}: ShadowTLS runs as a main connection only (transport + trojan pair), not as a pool member`); continue; }'));

  const impBody = fs.readFileSync(join(ROOT, "src", "components", "ImportTab.tsx"), "utf8");
  ok("S1i ImportTab.tsx: the memento-stls:// chip + the amber NON-STANDARD disclosure (import.stlsNote rendered)",
     impBody.includes('"tuic://", "memento-stls://"].map(proto =>') &&
     impBody.includes('{t("import.stlsNote", language)}'));
  const cfgBody = fs.readFileSync(join(ROOT, "src", "components", "ConfigsTab.tsx"), "utf8");
  ok("S1i ConfigsTab.tsx: the shadowtls chip entry (the Record<ProtocolType,string> type contract)",
     cfgBody.includes('shadowtls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",'));

  const i18n = fs.readFileSync(join(ROOT, "src", "i18n.ts"), "utf8");
  const stlsNoteCount = (i18n.match(/"import.stlsNote"/g) || []).length;
  ok("S1i i18n.ts: import.stlsNote present in EXACTLY the 4 languages, naming the scheme + the non-standard honesty",
     stlsNoteCount === 4 &&
     i18n.includes('"import.stlsNote": "memento-stls:// is a proprietary MEMENTO scheme for ShadowTLS (sing-box only) — it is NOT an industry standard and works only inside MEMENTO."'),
     `got ${stlsNoteCount}`);

  const pingBody = fs.readFileSync(join(ROOT, "src", "utils", "ping.ts"), "utf8");
  ok("S1i ping.ts: shadowtls rides the URI-branch target extraction + the memento-stls:// sniff",
     pingBody.includes('"tuic", "shadowtls"].includes(protocol)') &&
     pingBody.includes('if (l.startsWith("memento-stls://")) return "shadowtls";'));
  const edBody = fs.readFileSync(join(ROOT, "src", "utils", "editor.ts"), "utf8");
  ok("S1i editor.ts: the memento-stls Protocol member + sniff + the edit branch (scheme-agnostic host/port rewrite)",
     edBody.includes('"tuic" | "memento-stls" | "unknown"') &&
     edBody.includes('if (t.startsWith("memento-stls://")) return "memento-stls";') &&
     edBody.includes('case "memento-stls":'));

  const mockBody = fs.readFileSync(join(ROOT, "src", "electron-mock.ts"), "utf8");
  ok("S1i electron-mock.ts: the demo-de-stls config — a full memento-stls:// link in the browser preview",
     mockBody.includes('id: "demo-de-stls", protocol: "shadowtls",') &&
     mockBody.includes('raw: "memento-stls://memento-demo-trojan@de-01.demo.memento.app:443?version=3&stls-password=memento-demo-stls&sni=cdn.demo.memento.app#Demo%20%E2%96%B8%20Frankfurt%20%E2%80%94%20MEMENTO%20ShadowTLS",'));

  const xrBody = fs.readFileSync(join(ROOT, "src", "utils", "v2rayConfig.ts"), "utf8");
  const xrayCore = fs.readFileSync(join(APP, "electron", "xray.ts"), "utf8");
  ok("S1i xray-path exclusion: v2rayConfig.ts AND electron/xray.ts carry NO shadowtls token at all (the structural refusal, regression-verified)",
     !xrBody.includes("shadowtls") && !xrayCore.includes("shadowtls"));

  const distE2 = fs.readFileSync(join(APP, "dist", "index.html"), "utf8");
  ok("S1i dist fresh: the scheme chip + the disclosure key + the demo config built in",
     distE2.includes("memento-stls://") && distE2.includes("import.stlsNote") &&
     distE2.includes("demo-de-stls"));

  const readmeE2 = fs.readFileSync(join(APP, "README.md"), "utf8");
  ok("S1i README carries the Batch-E2 section + the register update (E2 DONE, only setup-app remains)",
     readmeE2.includes("## Phase E — Batch E2 (the MEMENTO ShadowTLS parser)") &&
     readmeE2.includes("~~E2~~ — **DONE at this batch** (this section);") &&
     readmeE2.includes("### The remaining-work register after E2") &&
     readmeE2.includes("- **setup-app** the new installer;"));
  const checklistE2 = fs.readFileSync(join(APP, "TESTING-CHECKLIST.md"), "utf8");
  ok("S1i TESTING-CHECKLIST section 35 carries the E2 real-Windows legs (import/scheme honesty/connect/versions/topology gates/xray exclusion/editor/ping/regression/preview)",
     checklistE2.includes("## 35. Phase E — Batch E2 (the MEMENTO ShadowTLS parser — real-Windows manual items)") &&
     checklistE2.includes("- [ ] Import leg:") && checklistE2.includes("- [ ] Scheme honesty leg:") &&
     checklistE2.includes("- [ ] Connect leg (sing-box):") && checklistE2.includes("- [ ] Version honesty leg:") &&
     checklistE2.includes("- [ ] Topology gate leg 1:") && checklistE2.includes("- [ ] Topology gate leg 2:") &&
     checklistE2.includes("- [ ] Xray-exclusion leg:") && checklistE2.includes("- [ ] Regression leg:"));

  const batE2 = fs.readFileSync(join(HERE, "taskE2-battery.mjs"), "utf8");
  ok("S1i the E2 battery fork rides BOTH E2 suites and keeps BOTH design probes OUT (list-entry-shaped negatives)",
     batE2.includes('"taskE2-quickcheck.mjs", 71') && batE2.includes('"taskE2-fntest.mjs", 26') &&
     !/^\s*\["taskE2-probe/m.test(batE2) && !/^\s*\["taskC4-probe/m.test(batE2));
}

/* ---------------- S2: functional ---------------- */
console.log("\n== S2 functional (taskE2-fntest 26 + taskE1-fntest 20 + taskB1-fntest 98 + taskB2-fntest 69 + taskB3-fntest 66 + taskC6-fntest 37) ==");
{
  const outE2 = run("node", [join(HERE, "taskE2-fntest.mjs")], { cwd: HERE, timeout: 300000 });
  const mE2 = outE2.match(/taskE2-fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskE2-fntest 26 PASS / 0 FAIL (the REAL bundled renderer modules against the REAL pinned binary)",
     !!mE2 && mE2[1] === "26" && mE2[2] === "0", outE2.slice(-600));
  ok("S2 E2 anchors: the F1 live pair (parse -> generate -> check -> run -> REAL traffic) + the F2 parse honesty + the F3 scope honesty + the F4 peripherals",
     outE2.includes("== F1 ") && outE2.includes("== F2 ") && outE2.includes("== F3 ") && outE2.includes("== F4 "), outE2.slice(-300));

  const outE1 = run("node", [join(HERE, "taskE1-fntest.mjs")], { cwd: HERE, timeout: 300000 });
  const mE1 = outE1.match(/taskE1-fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskE1-fntest 20 PASS / 0 FAIL (the REAL compiled connectionStats.js against BOTH pinned cores)",
     !!mE1 && mE1[1] === "20" && mE1[2] === "0", outE1.slice(-600));
  ok("S2 E1 anchors: the F1 per-connection catch + the F2 per-outbound honesty + the F3 failure honesty",
     outE1.includes("== F1 ") && outE1.includes("== F2 ") && outE1.includes("== F3 "), outE1.slice(-300));

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

  const outB3 = run("node", [join(HERE, "taskB3-fntest.mjs")], { cwd: HERE, timeout: 300000 });
  const mB3 = outB3.match(/taskB3-fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskB3-fntest 66 PASS / 0 FAIL (the C5/F9 fusion surface: heartbeat, fresh-armed, staleness, transition, audit)",
     !!mB3 && mB3[1] === "66" && mB3[2] === "0", outB3.slice(-600));
  ok("S2 B3 anchors: the flagship fresh-armed flip (T3) + the once-only transition (T7) + the observable blocked write (T14)",
     outB3.includes("== T3 ") && outB3.includes("== T7 ") && outB3.includes("== T14 "), outB3.slice(-300));
  ok("S2 B3 anchors: the pure audit matrix (T11) + the boot guard order (T16) present and green",
     outB3.includes("== T11 ") && outB3.includes("== T16 "), outB3.slice(-300));

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

console.log(`\nFORMAL SMOKE E2: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
