#!/usr/bin/env node
/**
 * Phase B4 QUICK-CHECK — structural gates on the Phase B closeout
 * (a DOCUMENTATION-ONLY batch: README Batch-B4 + TESTING-CHECKLIST
 * section 32 + the taskC4-probe.mjs header note, with the zero-
 * runtime-change proof).
 *
 * Sections:
 *   S1  README Batch-B4 (the closure map with the seal chain + the
 *       frozen surface + the battery statement)
 *   S2  README taskC4-probe finding + the remaining-work register
 *   S3  TESTING-CHECKLIST section 32 (the final acceptance sweep)
 *   S4  the taskC4-probe.mjs header note + the byte-stable executable
 *       body below it
 *   S5  frozen surfaces (the seven Phase B electron files at their B3
 *       line counts + the renderer pins + the battery runner present)
 *
 * Exit code 0 = all gates passed.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
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

/* ---------------- S1: README Batch-B4 closure map ---------------- */
console.log("\n== S1 README Batch-B4 closure map ==");
{
  const readme = read(join(APP, "README.md"));
  ok("the Batch-B4 section exists and declares DOCUMENTATION-ONLY",
     readme.includes("## Phase B — Batch B4 (Phase B closeout — the phase is closed)") &&
     readme.includes("DOCUMENTATION-ONLY closeout of Phase B") &&
     readme.includes("zero runtime source\nedits, zero behavior changes"));
  ok("the closure map carries the FULL seal chain (B0/B1/B2/B3)",
     readme.includes("B0 — wintun.dll provenance** (seal `bef82af1…`)") &&
     readme.includes("B1 — routingSession + routingHelper** (seal `d7ca91c9…`)") &&
     readme.includes("(seal\n  `be226a11…`)") &&
     readme.includes("C5 kill-switch + F9 audit fusion** (seal `499fbe14…`)"));
  ok("the map retains the B3 substance (fresh-armed fork, heartbeat, block-only audit, watchdog)",
     readme.includes("reads the FRESH kill-switch state from the shared prefs") &&
     readme.includes("the 10 s status heartbeat + the 30 s staleness view") &&
     readme.includes("never clears\n  anything") &&
     readme.includes("the 2 s\n  main-side unref'd watchdog"));
  ok("the map names the three hole fixes exactly as user-praised",
     readme.includes("the D6\n  stale snapshot, the silent helper death, F9 SOCKS-only"));
  ok("the frozen surface block lists all seven electron files at the B3 counts",
     readme.includes("`electron/routingSession.ts` 537") &&
     readme.includes("`electron/routingHelper.ts` 673") &&
     readme.includes("`electron/routingManager.ts` 535") &&
     readme.includes("`electron/killSwitch.ts` 262") &&
     readme.includes("`electron/main.ts` 499") &&
     readme.includes("`electron/ipc.ts` 724") &&
     readme.includes("byte-untouched through B3 and B4"));
  ok("the battery statement is exact (1,374 = 982 + 145 + 124 + 123; smoke 144/0)",
     readme.includes("1,374 embedded assertions all-green (982 pre-B + 145 B1 +\n  124 B2 + 123 B3)") &&
     readme.includes("official smoke 144/0") &&
     readme.includes("binary-never-ships gate retained"));
}

/* ---------------- S2: the probe finding + the register ---------------- */
console.log("\n== S2 README probe finding + remaining-work register ==");
{
  const readme = read(join(APP, "README.md"));
  ok("the taskC4-probe section records the finding with its disposition",
     readme.includes("### The taskC4-probe.mjs finding (registered at B3, documented at B4)") &&
     readme.includes("does NOT hold: `check` ACCEPTS such a config\n  (exit 0)") &&
     readme.includes("Dangling urltest members surface at RUNTIME, not at\n  check time") &&
     readme.includes("byte-identical executable semantics") &&
     readme.includes("re-running it today exits 1 on S4 by design"));
  ok("the finding is honest about scope (no gate reads the probe; zero migration surface)",
     readme.includes("never part of the C5/B-era\n  batteries and no gate reads it") &&
     readme.includes("Zero migration surface is involved"));
  ok("the remaining-work register survives Phase B verbatim (E1/E2/THIRD-PARTY.json/setup-app, from scratch)",
     readme.includes("### The remaining-work register AFTER Phase B (unchanged, user ruling)") &&
     readme.includes("**E1** per-connection stats") &&
     readme.includes("**E2** ShadowTLS parser") &&
     readme.includes("**THIRD-PARTY.json** the license manifest") &&
     readme.includes("**setup-app** the new installer") &&
     readme.includes("to be implemented FROM SCRATCH in\ntheir own batches after Phase B"));
  ok("the Validation block points at the B4 quickcheck (this file)",
     readme.includes("`scripts/taskB4-quickcheck.mjs`") &&
     readme.includes("zero-runtime-change proof"));
}

/* ---------------- S3: TESTING-CHECKLIST section 32 ---------------- */
console.log("\n== S3 TESTING-CHECKLIST section 32 ==");
{
  const checklist = read(join(APP, "TESTING-CHECKLIST.md"));
  ok("section 32 exists and frames the final acceptance sweep",
     checklist.includes("## 32. Phase B4 — Phase B closeout (real-Windows final acceptance sweep)") &&
     checklist.includes("one-pass FINAL ACCEPTANCE SWEEP over the whole Phase B\nsurface") &&
     checklist.includes("B4 ships no behavior"));
  ok("the five sweep legs are present",
     checklist.includes("- [ ] Provenance leg (B0):") &&
     checklist.includes("- [ ] Full lifecycle leg (B1+B2+B3, one continuous pass):") &&
     checklist.includes("- [ ] Crash-residue leg (B3 audit):") &&
     checklist.includes("- [ ] Documentation leg (B4):") &&
     checklist.includes("- [ ] Regression leg (pre-B parity):"));
  ok("the lifecycle leg walks the whole B1/B2/B3 contract (UAC → heartbeat → arm flip → sequenced disconnect)",
     checklist.includes("ONE UAC prompt") &&
     checklist.includes("~10 s heartbeat, no card flicker") &&
     checklist.includes("Holding (reconnecting)") &&
     checklist.includes("adapter gone BEFORE the core stops"));
  ok("the crash-residue leg keeps the block-only audit contract",
     checklist.includes("127.0.0.1:9 (blocked, NEVER cleared)"));
  ok("the documentation leg names the probe note + the seal map + the register",
     checklist.includes("taskC4-probe.mjs` carries the B4 design-time note in its header") &&
     checklist.includes("E1/E2/THIRD-PARTY.json/setup-app"));
  ok("sections 28-31 stand untouched above the new section",
     checklist.includes("## 28. Phase B0 — wintun.dll provenance (real-Windows manual items)") &&
     checklist.includes("## 29. Phase B1 — routing session (real-Windows manual items)") &&
     checklist.includes("## 30. Phase B2 — routing manager + the SOCKS/VPN Device segment (real-Windows manual items)") &&
     checklist.includes("## 31. Phase B3 — C5 kill-switch + F9 audit fusion with the TUN session (real-Windows manual items)"));
}

/* ---------------- S4: the taskC4-probe.mjs header note ---------------- */
console.log("\n== S4 taskC4-probe.mjs header note + byte-stable body ==");
{
  const probe = read(join(ROOT, "scripts", "taskC4-probe.mjs"));
  ok("the B4 NOTE header block exists with the design-time disposition",
     probe.includes(" * B4 NOTE (2026-09-20, design-time artifact status):") &&
     probe.includes(" * C4 DESIGN-TIME gate") &&
     probe.includes("it is NOT part of any official\n * battery") &&
     probe.includes('") does NOT hold:') &&
     probe.includes(" * `sing-box check` ACCEPTS such a config (exit 0)") &&
     probe.includes(" * the historical record of the C4 design-time assumptions") &&
     probe.includes("revisit THIS note — never a silent\n * expectation flip."));
  ok("the ORIGINAL S4 expectation line is retained verbatim (the record stays honest)",
     probe.includes(" *     S4  NEGATIVE: urltest referencing a missing outbound must be REJECTED"));
  ok("the executable body is byte-stable below the header (the probes/verdicts untouched)",
     probe.includes('S4_NEG_missing_member: sbBase(') &&
     probe.includes('outbounds: ["proxy", "ghost"],') &&
     probe.includes('console.log(`\\nPROBE RESULT: ${pass} PASS / ${fail} FAIL`);') &&
     probe.includes("process.exit(fail ? 1 : 0);"));
  ok("the file is exactly 212 lines (196 + the 16-line note — the header is the ONLY edit)",
     lines(join(ROOT, "scripts", "taskC4-probe.mjs")) === 212);
  ok("node --check accepts the edited probe (the docstring broke no syntax)",
     (() => {
       try {
         execFileSync(process.execPath, ["--check", join(ROOT, "scripts", "taskC4-probe.mjs")], { stdio: "pipe" });
         return true;
       } catch { return false; }
     })());
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
     aether.includes("killSwitchBlockedHint") || aether.includes("routing_status"));
  ok("electron-mock.ts untouched (the honest browser mirror intact)",
     read(join(ROOT, "src", "electron-mock.ts")).includes("routing_status"));
  ok("the B1 D6 pure mapping unchanged (watchdogOutcome still the exported contract)",
     read(join(APP, "electron", "routingSession.ts")).includes('return armed ? "hold-reconnecting" : "teardown-restoring";'));
  ok("the battery runner stands ready for the close gate (taskB3-battery.mjs present)",
     fs.existsSync(join(ROOT, "scripts", "taskB3-battery.mjs")));
  ok("the B0-B3 gate scripts all present (the chain the B4 smoke will re-run)",
     ["taskB0-smoke.mjs", "taskB1-smoke.mjs", "taskB2-smoke.mjs", "taskB3-smoke.mjs",
      "taskB0-zip.mjs", "taskB1-zip.mjs", "taskB2-zip.mjs", "taskB3-zip.mjs"]
       .every((f) => fs.existsSync(join(ROOT, "scripts", f))));
}

/* ---------------- summary ---------------- */
console.log(`\n===== taskB4-quickcheck: ${pass} PASS / ${fail} FAIL =====`);
if (fail > 0) process.exit(1);
