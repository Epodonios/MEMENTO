#!/usr/bin/env node
/**
 * Phase D4 FUNCTIONAL test — the REAL main-process appPrefs.ts + the tray
 * label model, bundled with esbuild under a minimal electron stub
 * (taskD4-electron-stub.mts). Proves the D4 prefs surface with real code:
 *
 *   F1  loadAppPrefs: no file -> D4 defaults (closeToTray ON, balloon
 *       pending, en tray)
 *   F2  UPGRADE PATH: a legacy D3 prefs file (2 hotkey booleans only)
 *       loads with the D4 defaults filled in — no migration breakage
 *   F3  save/load round-trip incl. the three new fields
 *   F4  corrupt file -> defaults (tolerant load)
 *   F5  sanitizePrefsPatch: accepts ONLY the 4 user-facing fields; drops
 *       the privileged closeTrayToastShown, wrong types, unknown langs,
 *       arrays/null
 *   F6  normalizeLanguage + trayLabels: 4 languages non-empty, unknown
 *       language falls back to English
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TD4_WORK || "/home/z/my-project/scripts/taskD4-fn-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

// 1) bundle the REAL modules under the electron stub
execFileSync(
  "npx",
  ["esbuild", join(HERE, "taskD4-fnentry.ts"), "--bundle", "--platform=node",
   `--alias:electron=${join(HERE, "taskD4-electron-stub.mts")}`,
   `--outfile=${join(WORK, "d4.cjs")}`],
  { cwd: HERE, stdio: "pipe" }
);

// 2) route the stub's userData into the temp dir BEFORE loading the bundle
(globalThis).__STUB_USERDATA = WORK;
const m = await import(join(WORK, "d4.cjs"));

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };
const prefsFile = join(WORK, "memento-app-prefs.json");

/* ---------- F1: fresh install defaults ---------- */
{
  const p = m.loadAppPrefs();
  check("F1 defaults: hotkeys ON", p.hotkeyShowHide === true && p.hotkeyConnect === true);
  check("F1 defaults: closeToTray ON (D4)", p.closeToTray === true);
  check("F1 defaults: balloon pending", p.closeTrayToastShown === false);
  check("F1 defaults: tray language en", p.language === "en");
}

/* ---------- F2: legacy D3 file upgrade path ---------- */
{
  fs.writeFileSync(prefsFile, JSON.stringify({ hotkeyShowHide: false, hotkeyConnect: true }), "utf8");
  const p = m.loadAppPrefs();
  check("F2 legacy: kept D3 hotkey values", p.hotkeyShowHide === false && p.hotkeyConnect === true);
  check("F2 legacy: D4 defaults filled in", p.closeToTray === true && p.closeTrayToastShown === false && p.language === "en");
}

/* ---------- F3: round-trip with D4 fields ---------- */
{
  fs.writeFileSync(prefsFile, JSON.stringify({ hotkeyShowHide: true, hotkeyConnect: false, closeToTray: false, closeTrayToastShown: true, language: "fa" }), "utf8");
  const p = m.loadAppPrefs();
  check("F3 round-trip: all 5 fields respected",
    p.hotkeyShowHide === true && p.hotkeyConnect === false && p.closeToTray === false &&
    p.closeTrayToastShown === true && p.language === "fa");
  m.saveAppPrefs(p);
  const p2 = m.loadAppPrefs();
  check("F3 save/load: identical after round-trip", JSON.stringify(p2) === JSON.stringify(p));
}

/* ---------- F4: corrupt file ---------- */
{
  fs.writeFileSync(prefsFile, "{ not json !!!", "utf8");
  const p = m.loadAppPrefs();
  check("F4 corrupt file -> defaults", p.closeToTray === true && p.closeTrayToastShown === false && p.language === "en" && p.hotkeyShowHide === true);
  fs.rmSync(prefsFile, { force: true });
}

/* ---------- F5: sanitizePrefsPatch (the IPC gate) ---------- */
{
  const good = m.sanitizePrefsPatch({ hotkeyShowHide: false, hotkeyConnect: true, closeToTray: true, language: "zh" });
  check("F5 accepts the 4 user-facing fields",
    good.hotkeyShowHide === false && good.hotkeyConnect === true && good.closeToTray === true && good.language === "zh");

  check("F5 DROPS closeTrayToastShown (privileged one-shot flag)",
    !("closeTrayToastShown" in m.sanitizePrefsPatch({ closeTrayToastShown: true })));
  check("F5 DROPS wrong-typed booleans", !("closeToTray" in m.sanitizePrefsPatch({ closeToTray: "yes" })) && !("hotkeyConnect" in m.sanitizePrefsPatch({ hotkeyConnect: 1 })));
  check("F5 DROPS unknown language codes", !("language" in m.sanitizePrefsPatch({ language: "de" })) && !("language" in m.sanitizePrefsPatch({ language: 42 })));
  check("F5 DROPS hostile/odd payloads",
    Object.keys(m.sanitizePrefsPatch(null)).length === 0 &&
    Object.keys(m.sanitizePrefsPatch(["closeToTray"])).length === 0 &&
    Object.keys(m.sanitizePrefsPatch("closeToTray=false")).length === 0 &&
    Object.keys(m.sanitizePrefsPatch({ __proto__: { closeToTray: true }, evil: 1 })).length === 0);
  check("F5 never carries unknown keys",
    Object.keys(m.sanitizePrefsPatch({ evil: 1, admin: true, closeToTray: false })).length === 1);
}

/* ---------- F6: language + tray labels ---------- */
{
  check("F6 normalizeLanguage accepts the 4 UI languages",
    ["en", "fa", "zh", "ar"].every(l => m.normalizeLanguage(l) === l));
  check("F6 normalizeLanguage rejects everything else",
    m.normalizeLanguage("EN") === null && m.normalizeLanguage("") === null && m.normalizeLanguage(undefined) === null);

  const fields = ["showHide", "connect", "disconnect", "quit", "balloonTitle", "balloonBody"];
  const all = ["en", "fa", "zh", "ar"].map(l => m.trayLabels(l));
  check("F6 trayLabels: 4 languages, all 6 fields non-empty",
    all.every(o => fields.every(f => typeof o[f] === "string" && o[f].trim().length > 0)));
  check("F6 trayLabels: unknown language falls back to English",
    JSON.stringify(m.trayLabels("xx")) === JSON.stringify(m.trayLabels("en")));
  check("F6 trayLabels: the 4 languages are actually distinct surfaces",
    // "Quit" is coincidentally the same word (خروج) in Persian and Arabic —
    // compare on the longer showHide label instead, where all four differ.
    new Set(["en", "fa", "zh", "ar"].map(l => m.trayLabels(l).showHide)).size === 4);
}

console.log(`\nD4 fntest: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
