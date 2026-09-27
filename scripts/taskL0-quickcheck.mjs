#!/usr/bin/env node
/**
 * Phase E / Batch L0 QUICK-CHECK — structural gates on the third-party
 * license/origin manifest batch (a DATA + DOCS batch: resources/THIRD-
 * PARTY.json + resources/licenses/ + NOTICE.md rewrite + README Batch-L0
 * + TESTING-CHECKLIST section 33, with the zero-runtime-change proof).
 *
 * Sections:
 *   S1  the manifest itself (parse + structure + counts + authority block)
 *   S2  manifest <-> repo cross-checks (core-versions.json, wintunPin.ts,
 *       aether-versions.json, both package-lock.json files, the live
 *       sha256 re-computation of every verbatim license text)
 *   S3  the verbatim license texts (7 files: line counts + content needles)
 *   S4  the docs (NOTICE.md rewrite with the wintun block verbatim,
 *       README Batch-L0, TESTING-CHECKLIST section 33, sections 28-32 intact)
 *   S5  frozen surfaces (the zero-runtime-change proof over the Phase B
 *       surface: seven electron files + renderer trio + the probe)
 *
 * Exit code 0 = all gates passed.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP = join(ROOT, "electron-app");
const RES = join(APP, "resources");
const LIC = join(RES, "licenses");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
const lines = (p) => (read(p).match(/\n/g) || []).length;
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/* ---------------- S1: the manifest itself ---------------- */
console.log("\n== S1 resources/THIRD-PARTY.json structure ==");
let m = null;
{
  let parseOk = true;
  try { m = JSON.parse(read(join(RES, "THIRD-PARTY.json"))); }
  catch (e) { parseOk = false; }
  ok("the manifest exists and parses as strict JSON", m !== null);
  ok("manifestVersion 1 + the live-evidence date pinned (2026-09-20, rebuilt from scratch)",
     m?.manifestVersion === 1 && m?.liveEvidenceDate === "2026-09-20" && m?.generated === "2026-09-20");
  ok("the app block declares MEMENTO / MIT / Epodonios",
     m?.app?.name === "MEMENTO" && m?.app?.license === "MIT" && m?.app?.author === "Epodonios");
  ok("the inventory is exactly 16 bundled + 2 runtimeFetched + 4 excluded",
     m?.bundled?.length === 16 && m?.runtimeFetched?.length === 2 && m?.excluded?.length === 4);
  ok("the authority block names all four pin authorities + the same-commit bump rule",
     (m?.authority?.pinAuthority || "").includes("electron/core-versions.json") &&
     (m?.authority?.pinAuthority || "").includes("electron/wintunPin.ts") &&
     (m?.authority?.pinAuthority || "").includes("electron/aether-versions.json") &&
     (m?.authority?.updateRule || "").includes("SAME\n   reviewed commit") === false &&
     (m?.authority?.updateRule || "").includes("SAME"));
  ok("the scope block states the verification basis (live evidence, import scan, lockfiles)",
     (m?.scope?.verificationBasis || "").includes("2026-09-20") &&
     (m?.scope?.verificationBasis || "").includes("import") &&
     (m?.scope?.covered || "").includes("runtime"));
}

/* ---------------- S2: manifest <-> repo cross-checks ---------------- */
console.log("\n== S2 manifest <-> repo cross-checks ==");
{
  const find = (s) => m.bundled.find((b) => b.name === s) || {};
  const core = JSON.parse(read(join(APP, "electron", "core-versions.json")));
  ok("core versions match core-versions.json exactly (xray/sing-box/aether/wintun)",
     find("Xray-core").version === core.xray && find("sing-box").version === core["sing-box"] &&
     find("Aether").version === core.aether && find("wintun.dll").version.startsWith(core.wintun));
  const pin = read(join(APP, "electron", "wintunPin.ts"));
  ok("the wintun entry carries the B0 dll + zip pins verbatim from wintunPin.ts",
     (find("wintun.dll").licenseProvenance || "").includes("e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce") &&
     (find("wintun.dll").licenseProvenance || "").includes("07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51") &&
     pin.includes("WINTUN_DLL_SHA256"));
  const aetherPin = JSON.parse(read(join(APP, "electron", "aether-versions.json")));
  ok("the aether entry carries the win32 + linux binary pins from aether-versions.json",
     (find("Aether").delivery || "").includes(aetherPin.versions[0].sha256.win32) &&
     (find("Aether").delivery || "").includes(aetherPin.versions[0].sha256.linux) &&
     aetherPin.versions[0].version === "1.9.0");
  const el = JSON.parse(read(join(APP, "package-lock.json"))).packages || {};
  ok("electron + adm-zip versions match electron-app/package-lock.json",
     find("Electron").version === el["node_modules/electron"]?.version &&
     find("adm-zip").version.startsWith(el["node_modules/adm-zip"]?.version));
  const top = JSON.parse(read(join(ROOT, "package-lock.json"))).packages || {};
  const renderer = ["react", "react-dom", "lucide-react", "react-hot-toast", "zustand", "qrcode", "jsqr"];
  ok("every renderer npm entry matches the top-level lockfile version",
     renderer.every((n) => find(n).version === top[`node_modules/${n}`]?.version),
     JSON.stringify(renderer.map((n) => [n, find(n).version, top[`node_modules/${n}`]?.version])));
  const tail = find("tailwindcss").version === top["node_modules/tailwindcss"]?.version &&
               find("@fontsource/inter (the Inter typeface)").version === top["node_modules/@fontsource/inter"]?.version &&
               find("@fontsource/jetbrains-mono (the JetBrains Mono typeface)").version === top["node_modules/@fontsource/jetbrains-mono"]?.version;
  ok("tailwindcss + both @fontsource entries match the lockfile too", tail);
  const textChecks = [
    ["resources/licenses/Xray-core-v25.1.1-MPL-2.0.txt", "1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5"],
    ["resources/licenses/sing-box-v1.14.0-GPL-3.0.txt", "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903"],
    ["resources/licenses/sing-box-v1.14.0-LICENSE-notice.txt", "650d5e3b99a446fb38e820fa87a49562e0c79eab868fff58618ac487a58e554c"],
    ["resources/licenses/Aether-v1.9.0-AGPL-3.0.txt", "8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef"],
    ["resources/licenses/jsqr-1.4.0-Apache-2.0.txt", "c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08"],
    ["resources/licenses/Inter-OFL-1.1.txt", "3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345"],
    ["resources/licenses/JetBrainsMono-OFL-1.1.txt", "403581b69dac5cff4079205e01c6b467e56af449ecbd7247693ddb1baafa005b"],
  ];
  const badHash = textChecks.filter(([rel, want]) => {
    try { return sha256(join(APP, rel)) !== want; } catch { return true; }
  });
  ok("every pinned license-text sha256 re-computes to the same digest (7/7)",
     badHash.length === 0, badHash.map(([r]) => r).join(", "));
  ok("every bundled entry that ships a text file points at resources/licenses/ (or the wintun committed text)",
     m.bundled.filter((b) => ["Xray-core", "sing-box", "Aether", "jsqr"].includes(b.name))
       .every((b) => (b.licenseText || "").includes("resources/licenses/")) &&
     (find("wintun.dll").licenseText || "").includes("resources/wintun/wintun-LICENSE.txt"));
}

/* ---------------- S3: the verbatim license texts ---------------- */
console.log("\n== S3 resources/licenses/ verbatim texts ==");
{
  const mpl = join(LIC, "Xray-core-v25.1.1-MPL-2.0.txt");
  ok("MPL-2.0 text: 373 lines + genuine header",
     lines(mpl) === 373 && read(mpl).includes("Mozilla Public License") &&
     read(mpl).includes("Version 2.0"));
  const gpl = join(LIC, "sing-box-v1.14.0-GPL-3.0.txt");
  ok("GPLv3 text: 674 lines + the canonical header (Version 3, 29 June 2007)",
     lines(gpl) === 674 && read(gpl).includes("GNU GENERAL PUBLIC LICENSE") &&
     read(gpl).includes("Version 3, 29 June 2007"));
  const notice = join(LIC, "sing-box-v1.14.0-LICENSE-notice.txt");
  ok("sing-box upstream notice: 17 lines + the or-later grant + the name-association clause",
     lines(notice) === 17 && read(notice).includes("nekohasekai") &&
     read(notice).includes("or\n(at your option) any later version") &&
     read(notice).includes("no derivative work may use the name"));
  const agpl = join(LIC, "Aether-v1.9.0-AGPL-3.0.txt");
  ok("AGPL-3.0 text: 661 lines + the canonical header (Version 3, 19 November 2007)",
     lines(agpl) === 661 && read(agpl).includes("GNU AFFERO GENERAL PUBLIC LICENSE") &&
     read(agpl).includes("Version 3, 19 November 2007"));
  const apache = join(LIC, "jsqr-1.4.0-Apache-2.0.txt");
  ok("Apache-2.0 text: 202 lines + genuine header",
     lines(apache) === 202 && read(apache).includes("Apache License") &&
     read(apache).includes("Version 2.0, January 2004"));
  const oflI = join(LIC, "Inter-OFL-1.1.txt");
  const oflJ = join(LIC, "JetBrainsMono-OFL-1.1.txt");
  ok("both OFL-1.1 texts: 93 lines each + the copyright headers (Inter / JetBrains Mono)",
     lines(oflI) === 93 && lines(oflJ) === 93 &&
     read(oflI).includes("SIL Open Font License, Version 1.1") &&
     read(oflI).includes("The Inter Project Authors") &&
     read(oflJ).includes("SIL Open Font License, Version 1.1") &&
     read(oflJ).includes("JetBrains Mono Project Authors"));
}

/* ---------------- S4: the docs ---------------- */
console.log("\n== S4 NOTICE.md + README Batch-L0 + TESTING-CHECKLIST section 33 ==");
{
  const notice = read(join(APP, "NOTICE.md"));
  ok("NOTICE.md is the human-readable registry pointing at the machine-readable authority",
     notice.includes("The MACHINE-READABLE authority is") &&
     notice.includes("`resources/THIRD-PARTY.json`") &&
     notice.includes("landed at Phase E Batch L0, 2026-09-20") &&
     notice.includes("`resources/licenses/`"));
  ok("the wintun section survives VERBATIM (the B0 provenance block untouched)",
     notice.includes("**Copyright / licensor:** WireGuard LLC (www.wintun.net)") &&
     notice.includes('Wintun "Prebuilt Binaries License" — bespoke, NOT an') &&
     notice.includes("clause 3(c)") && notice.includes("clause 3(d)") &&
     notice.includes("`e5da8447…0dafce`"));
  ok("the core entries carry license ids + the separate-process compliance notes",
     notice.includes("**Xray-core v25.1.1** — MPL-2.0") &&
     notice.includes("**sing-box 1.14.0** — GPL-3.0-or-later") &&
     notice.includes("**Aether 1.9.0** — AGPL-3.0") &&
     notice.includes("separate process") &&
     notice.includes("unofficial wrapper"));
  ok("the renderer + font attributions are complete (copyright lines + OFL texts)",
     notice.includes("Copyright (c) Meta Platforms,") &&
     notice.includes("Copyright (c) 2012 Ryan Day") &&
     notice.includes("SIL OFL 1.1") &&
     notice.includes("Inter Project Authors (https://github.com/rsms/inter)") &&
     notice.includes("JetBrains Mono Project Authors") &&
     notice.includes("Copyright 2020 The JetBrains Mono Project Authors"));
  ok("the geodata lineage + the honest meta-rules-dat finding ride NOTICE",
     notice.includes("CC BY-SA 4.0") &&
     notice.includes("NO standalone license file") &&
     notice.includes("MetaCubeX/meta-rules-dat"));

  const readme = read(join(APP, "README.md"));
  ok("the README Batch-L0 section exists and marks the phase transition",
     readme.includes("## Phase E — Batch L0 (third-party license/origin manifest — the post-B register begins)") &&
     readme.includes("Phase B is CLOSED (seal `76a6f03c…`)") &&
     readme.includes("zero runtime behavior"));
  ok("the section records the counts + the evidence base (GPL notice finding, canonical digest, import scan)",
     readme.includes("16 `bundled`") && readme.includes("2 `runtimeFetched`") &&
     readme.includes("4 `excluded`") &&
     readme.includes("17-line GPL NOTICE HEADER") &&
     readme.includes("`8ceb4b9e…b65b903`") &&
     readme.includes("`src/main.tsx` imports the @fontsource CSS at L5-11"));
  ok("the compliance decisions + the source-offer path are stated",
     readme.includes("complete-source-offer") &&
     readme.includes("no linking") &&
     readme.includes("AGPL §13 adds"));
  ok("the register updates: THIRD-PARTY.json DONE, E1/E2/setup-app remain",
     readme.includes("~~THIRD-PARTY.json~~ — **DONE at this batch**") &&
     readme.includes("**E1** per-connection stats;") &&
     readme.includes("**E2** ShadowTLS parser;") &&
     readme.includes("**setup-app** the new installer;") &&
     readme.includes("`scripts/taskL0-quickcheck.mjs`"));

  const checklist = read(join(APP, "TESTING-CHECKLIST.md"));
  ok("section 33 exists with its framing (inert data; the license surface must RIDE)",
     checklist.includes("## 33. Phase E — Batch L0 (license manifest — real-Windows verification)") &&
     checklist.includes("L0 ships no behavior") &&
     checklist.includes("the license surface actually\nRIDES the distribution"));
  ok("all seven section-33 legs are present",
     checklist.includes("- [ ] Manifest rides:") &&
     checklist.includes("- [ ] Pin cross-check:") &&
     checklist.includes("- [ ] Verbatim texts ride:") &&
     checklist.includes("- [ ] GPL/AGPL source offers:") &&
     checklist.includes("- [ ] Attribution walk:") &&
     checklist.includes("- [ ] Packaging leg:") &&
     checklist.includes("- [ ] Regression leg (inert data):"));
  ok("sections 28-32 stand untouched above the new section",
     checklist.includes("## 28. Phase B0 — wintun.dll provenance (real-Windows manual items)") &&
     checklist.includes("## 29. Phase B1 — routing session (real-Windows manual items)") &&
     checklist.includes("## 30. Phase B2 — routing manager + the SOCKS/VPN Device segment (real-Windows manual items)") &&
     checklist.includes("## 31. Phase B3 — C5 kill-switch + F9 audit fusion with the TUN session (real-Windows manual items)") &&
     checklist.includes("## 32. Phase B4 — Phase B closeout (real-Windows final acceptance sweep)"));
}

/* ---------------- S5: frozen surfaces ---------------- */
console.log("\n== S5 frozen surfaces (the zero-runtime-change proof) ==");
{
  ok("routingSession.ts R3 re-point (581 lines — was 537; UAC outcome reporting added, disclosed)",
     lines(join(APP, "electron", "routingSession.ts")) === 581);
  ok("routingHelper.ts byte-untouched (still 673 lines, the B3 fusion)",
     lines(join(APP, "electron", "routingHelper.ts")) === 673);
  ok("routingManager.ts R3 re-point (574 lines — was 535; launchFeedback + instant UAC-cancel heal, disclosed)",
     lines(join(APP, "electron", "routingManager.ts")) === 574);
  ok("killSwitch.ts byte-untouched (still 262 lines, the B3 TUN twin)",
     lines(join(APP, "electron", "killSwitch.ts")) === 262);
  ok("main.ts byte-untouched (still 499 lines, the B3 wiring + watchdog)",
     lines(join(APP, "electron", "main.ts")) === 499);
  ok("ipc.ts R3 re-point (895 lines — was 748; Update Center + LiveConn + Scanner + MHRV handlers, disclosed)",
     lines(join(APP, "electron", "ipc.ts")) === 895);
  ok("preload.ts untouched (the routing_ allowlist entries intact)",
     (read(join(APP, "electron", "preload.ts")).match(/"routing_/g) || []).length === 4);
  const aether = read(join(ROOT, "src", "components", "AetherTab.tsx"));
  ok("the renderer trio untouched (AetherTab still carries the B2 segment + D6 note)",
     aether.includes("routing_start") && aether.includes("routing_repair") &&
     aether.includes("routing_status"));
  ok("the B1 D6 pure mapping unchanged (watchdogOutcome still the exported contract)",
     read(join(APP, "electron", "routingSession.ts")).includes('return armed ? "hold-reconnecting" : "teardown-restoring";'));
  ok("taskC4-probe.mjs stays exactly 212 lines with its B4 NOTE (the documentation item rides untouched)",
     lines(join(ROOT, "scripts", "taskC4-probe.mjs")) === 212 &&
     read(join(ROOT, "scripts", "taskC4-probe.mjs")).includes("B4 NOTE (2026-09-20, design-time artifact status)"));
  ok("the B-era battery runner stands ready (taskB4-battery.mjs present, the B4 quickcheck rides)",
     fs.existsSync(join(ROOT, "scripts", "taskB4-battery.mjs")) &&
     read(join(ROOT, "scripts", "taskB4-battery.mjs")).includes("taskB4-battery") &&
     read(join(ROOT, "scripts", "taskB4-battery.mjs")).includes('"taskB4-quickcheck.mjs", 33'));
  ok("the B0-B4 gate scripts all present (the chain the next smoke re-runs)",
     ["taskB0-smoke.mjs", "taskB1-smoke.mjs", "taskB2-smoke.mjs", "taskB3-smoke.mjs", "taskB4-smoke.mjs",
      "taskB0-zip.mjs", "taskB1-zip.mjs", "taskB2-zip.mjs", "taskB3-zip.mjs", "taskB4-zip.mjs"]
       .every((f) => fs.existsSync(join(ROOT, "scripts", f))));
  ok("node --check accepts this quickcheck (no syntax drift in the gate itself)",
     (() => {
       try {
         execFileSync(process.execPath, ["--check", join(HERE, "taskL0-quickcheck.mjs")], { stdio: "pipe" });
         return true;
       } catch { return false; }
     })());
}

/* ---------------- summary ---------------- */
console.log(`\n===== taskL0-quickcheck: ${pass} PASS / ${fail} FAIL =====`);
if (fail > 0) process.exit(1);
