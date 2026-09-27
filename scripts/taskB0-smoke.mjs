#!/usr/bin/env node
/**
 * Phase B0 OFFICIAL FORMAL SMOKE (user-approved 2026-09-20 after the full
 * B0 file/line report: "گزارش کامل، بدون هیچ کد اجرایی TUN، دقیقاً طبق
 * D1/D3" — run the official smoke + zip + seal; after the seal, copy into
 * seals-archive/ and hash-verify in place).
 *
 * Batch B0 = wintun.dll 0.14.1 PROVENANCE ONLY (approved decisions D1/D3):
 * electron/wintunPin.ts (the ONE place), core-versions.json extension,
 * fetch-wintun.sh/.ps1 (official-source-only, hash-gated, ps1 adds
 * Authenticode), resources/wintun/README.md + wintun-LICENSE.txt (verbatim),
 * NOTICE.md attribution. ZERO executable TUN code — B1 brings the routing
 * session; the smoke ENFORCES that boundary.
 *
 * Gate structure (mirrors the C6 smoke; S1-S5 RE-RUN the full 982-assertion
 * battery as regression: 894 through C5 + 88 C6 — B0 touched no runtime
 * code path, so the whole battery must stay green):
 *   S0   real pinned-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 *        + fresh builds of BOTH frontend (vite) and main (tsc) + compiled
 *        artifacts incl. the NEW dist-electron/wintunPin.js.
 *   S0b  B0 LIVE provenance: fetch-wintun.sh re-run END-TO-END against the
 *        official source (zip-digest gate + dll-digest gate + placement),
 *        post-run on-disk dll hash == pin, audit-copy cross-check
 *        (scripts/b0-wintun-audit), byte sizes.
 *   S1   structural surface via taskC6-quickcheck.mjs (51) + C6 dist
 *        freshness + compiled C6 pins (regression — B0 touched none of it).
 *   S1b  B0 structural gates: wintunPin.ts all 8 constants (exact values)
 *        + constants-only negatives (NO imports/spawn/child_process — D3)
 *        + compiled wintunPin.js carries the digests + both fetch scripts'
 *        digest/publisher/REFUSED gates + resources/wintun/README.md
 *        provenance record + wintun-LICENSE.txt verbatim (84 lines) +
 *        NOTICE.md attribution + core-versions.json wintun pin + README
 *        Batch-B0 section + TESTING-CHECKLIST section 28 + digest
 *        uniqueness (only the 4 sanctioned files) + NOTHING imports
 *        wintunPin yet + B1 modules do NOT exist yet.
 *   S2   functional regression: taskC6-fntest.mjs (37).
 *   S3   config-level regression through the REAL cores (taskC4-cfgtest, 30).
 *   S4   LIVE behavioral regression: taskC5-live.mjs (12) + the C4
 *        TRACKED-LIMITATION canary (taskC4-uplink-probe).
 *   S5   regression suites: task13-selftest/cfgtest + task12-quickcheck +
 *        D1/D2/D3/D4 quickchecks + D2-cfgtest + D4 fntest + quit-cleanup +
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
  ok("S0 sing-box is pinned 1.14.0", /1\.14\.0/.test(sv), sv.slice(0, 80).replace(/\n/g, " "));

  const bf = run("npm", ["run", "build:frontend"], { cwd: APP });
  ok("S0 vite build exits clean", !/error/i.test(bf) || /built in/.test(bf), bf.slice(-200).replace(/\n/g, " "));
  const bm = run("npm", ["run", "build:main"], { cwd: APP });
  ok("S0 electron main tsc exits clean", !/error TS/i.test(bm), bm.slice(-200).replace(/\n/g, " "));
  ok("S0 dist-electron/wintunPin.js exists post-build (B0 constants ship compiled)",
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

/* ---------------- S0b: B0 LIVE provenance ---------------- */
console.log("\n== S0b B0 LIVE provenance (official-source fetch re-run + hash gates) ==");
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
  ok("S0b on-disk dll hash == pin (post-fetch, byte-exact)", fs.existsSync(dllPath) && sha256(dllPath) === WINTUN_DLL_SHA);
  ok("S0b on-disk dll size == 427,552 bytes (the pinned amd64 build)",
     fs.existsSync(dllPath) && fs.statSync(dllPath).size === 427552);

  // Sandbox audit copy (the ORIGINAL live-verification artifacts). If the
  // directory is absent on another machine, the gate degrades to a note —
  // on THIS run it exists and is verified hard.
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
  ok("S1 compiled preload (rebuilt): allowlist is 27 commands (C6 added exactly 4)",
     allow.length === 27 && allow.includes("aether_update_status") &&
     allow.includes("aether_update_check") && allow.includes("aether_update_apply") &&
     allow.includes("app_update_info"),
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

/* ---------------- S1b: B0 structural gates ---------------- */
console.log("\n== S1b B0 structural (wintunPin + fetch scripts + provenance docs + D3 boundary) ==");
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
  ok("S0b/S1b fetch-wintun.sh: official URL + both digests in lockstep with the pin",
     sh.includes("https://www.wintun.net/builds/wintun-0.14.1.zip") &&
     sh.includes(WINTUN_ZIP_SHA) && sh.includes(WINTUN_DLL_SHA) &&
     sh.includes("Keep in lockstep with electron/wintunPin.ts"));
  ok("S1b fetch-wintun.sh REFUSES on zip mismatch AND dll mismatch (build-time-fail)",
     sh.includes("REFUSED: zip sha256 mismatch") && sh.includes("REFUSED: dll sha256 mismatch") &&
     sh.includes("exit 1"));
  ok("S1b fetch-wintun.sh places the dll + refreshes the license text",
     sh.includes("placed verified wintun.dll -> resources/wintun/bin/amd64/wintun.dll") &&
     sh.includes('cp "$WORK/expanded/wintun/LICENSE.txt" "$APP/resources/wintun/wintun-LICENSE.txt"'));

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
  ok("S1b README Batch-B0 section: provenance-only + byte-cross-check + binaries-never-shipped",
     readme.includes("## Phase B — Batch B0 (wintun.dll provenance") &&
     readme.includes("zero executable TUN code") &&
     readme.includes("byte-identical to the independent reference pin") &&
     readme.includes("NOT committed and NOT zipped") &&
     readme.includes("THE ONE PLACE"));

  const checklist = fs.readFileSync(join(APP, "TESTING-CHECKLIST.md"), "utf8");
  ok("S1b TESTING-CHECKLIST section 28: real-Windows legs (ps1+Authenticode, tamper, no-behavior-change)",
     checklist.includes("## 28. Phase B0 — wintun.dll provenance") &&
     checklist.includes("Authenticode OK: signed by WireGuard LLC") &&
     checklist.includes("Tamper leg") &&
     checklist.includes("No TUN behavior exists yet"));

  // Digest uniqueness: the full digests may appear ONLY in the sanctioned
  // files — the ONE place, the two fetchers, the provenance README, and
  // the two B0 gate scripts (the checklist 28 grep item, automated).
  const sanctioned = new Set([
    join(APP, "electron", "wintunPin.ts"),
    join(APP, "scripts", "fetch-wintun.sh"),
    join(APP, "scripts", "fetch-wintun.ps1"),
    join(APP, "resources", "wintun", "README.md"),
    join(HERE, "taskB0-smoke.mjs"),   // the gates themselves carry the pins
    join(HERE, "taskB0-zip.mjs"),     // (same sanction as the fetch scripts)
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
  ok("S1b digest uniqueness: the wintun digests appear ONLY in the 6 sanctioned files",
     offenders.length === 0, offenders.join(", "));

  // D3 boundary: NOTHING imports wintunPin yet (B1 wires the spawn gate),
  // and the B1 modules do NOT exist yet.
  const importers = [];
  for (const dir of [join(APP, "electron"), join(ROOT, "src"), join(APP, "dist-electron")]) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { if (e.name === "node_modules") continue; walk(join(d, e.name)); }
        else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
          const p = join(d, e.name);
          if (p.endsWith("wintunPin.ts") || p.endsWith("wintunPin.js") || p.endsWith("taskB0-smoke.mjs")) continue;
          try { if (fs.readFileSync(p, "utf8").includes("wintunPin")) importers.push(p); } catch { /* ignore */ }
        }
      }
    })(dir);
  }
  ok("S1b D3 boundary: NOTHING imports wintunPin yet (B1 wires the spawn gate)",
     importers.length === 0, importers.join(", "));
  ok("S1b D3 boundary: no B1 modules exist yet (routingSession/routingHelper absent)",
     !fs.existsSync(join(APP, "electron", "routingSession.ts")) &&
     !fs.existsSync(join(APP, "electron", "routingHelper.ts")));
}

/* ---------------- S2: functional regression ---------------- */
console.log("\n== S2 functional (taskC6-fntest regression: table + hash gates + race) ==");
{
  const out = run("node", [join(HERE, "taskC6-fntest.mjs")], { cwd: HERE, timeout: 180000 });
  const m = out.match(/taskC6-fntest: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskC6-fntest 37 PASS / 0 FAIL", !!m && m[1] === "37" && m[2] === "0", out.slice(-500));
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

console.log(`\nFORMAL SMOKE B0: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
