#!/usr/bin/env node
/**
 * Phase C6 STRUCTURAL quickcheck — Aether pin-per-version updates +
 * MEMENTO's honest self-update assistant (Option A).
 *
 * Pins the code FORM of the whole surface (the C1..C5 discipline):
 *   N1  aether-versions.json: the table IS the authority — real
 *       CluvexStudio checkUrl/releasesPage, the 1.9.0 row byte-identical
 *       to the Task-12 spawn pins, https everywhere.
 *   N2  aetherUpdate.ts: the approved contract in code form — user-click
 *       only (no timers), the running lock on BOTH check and apply plus
 *       the gate-2 re-check, the in-flight guard, the not-pinned refusal,
 *       the MANDATORY binary-hash gate, the same-dir tmp + .prev.bak
 *       swap, and the post-write verification.
 *   N3  isolation negatives (the user's re-confirmed C2-parity demand):
 *       the check/download path never touches system state — no electron,
 *       no ./proxy import, no reg/netsh/ProxyEnable, no net/session, no
 *       proxy env reading; appUpdate.ts has NO fs/network/electron at all.
 *   N4  aether.ts: the spawn gate EXTENDS to the table without loosening
 *       (union condition + preserved refusal messages + the consistency
 *       import).
 *   N5  ipc.ts: the 4 new handlers, the manager-truth isRunning wiring,
 *       the single-argument apply sanitization, the static app facts.
 *   N6  preload: the 4 new commands in the allowlist (23 -> 27);
 *       open-external REUSED (no new shell surface).
 *   N7  renderer: click-driven check (exactly ONE aether_update_check
 *       call site, no auto-poll), the running-lock banner, the table +
 *       offer-only-for-pinned-newer install path, the Settings section.
 *   N8  i18n: the 25 new keys in ALL FOUR locales; the en texts carry
 *       the honest contract literals.
 *   N9  electron-mock: honest mirror — a browser never fakes a download
 *       or a swap.
 *   N10 docs: README Batch C6 + TESTING-CHECKLIST §27 with the key
 *       needles; the bundled provenance README stays pinned at 1.9.0.
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
 *  doc prose (the C1 lesson). */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map(l => l.replace(/(^|[^:"'])\/\/.*$/, "$1")).join("\n");

const tableRaw = read(join(EL, "aether-versions.json"));
const table = JSON.parse(tableRaw);
const auCode = code(join(EL, "aetherUpdate.ts"));
const auAll = read(join(EL, "aetherUpdate.ts"));
const appUpdCode = code(join(EL, "appUpdate.ts"));
const aeCode = code(join(EL, "aether.ts"));
const ipcCode = code(join(EL, "ipc.ts"));
const preCode = code(join(EL, "preload.ts"));
const aetherTabCode = code(join(SRC, "components", "AetherTab.tsx"));
const aetherTabAll = read(join(SRC, "components", "AetherTab.tsx"));
const setCode = code(join(SRC, "components", "SettingsTab.tsx"));
const i18n = read(join(SRC, "i18n.ts"));
const mockCode = code(join(SRC, "electron-mock.ts"));
const readme = read(join(ROOT, "electron-app", "README.md"));
const checklist = read(join(ROOT, "electron-app", "TESTING-CHECKLIST.md"));
const aetherResReadme = read(join(ROOT, "electron-app", "resources", "aether", "README.md"));

/* ---------------- N1: the pin table ---------------- */
console.log("\n== N1 aether-versions.json: the table IS the authority ==");
ok("N1a the checkUrl is the pinned official CluvexStudio releases API and every page is https",
   table.checkUrl === "https://api.github.com/repos/CluvexStudio/Aether/releases/latest" &&
   table.releasesPage === "https://github.com/CluvexStudio/Aether/releases");
ok("N1b the 1.9.0 row exists, was verified 2026-09-16, and is the bundled pin",
   table.versions.length >= 1 && table.versions[0].version === "1.9.0" &&
   table.versions[0].verified === "2026-09-16");
ok("N1c the 1.9.0 binary hashes are byte-identical to the Task-12 spawn-gate pins",
   table.versions[0].sha256.win32 === "ee400806bf73fe16e655e6478eb7442c2c4e0576c4c8ce1913ac474e846b36cd" &&
   table.versions[0].sha256.linux === "e8b2a83c4ab0ad1a75dac21f2f2b9d701998f86866fde15025ffba307b7130b9");
ok("N1d the 1.9.0 Windows ASSET hash is recorded (Task-12 provenance parity)",
   table.versions[0].zipSha256.win32 === "5c64be2f2967469c53abdbec82599cb3c2ef005b8ef8efed79ba235d4ed3eb8d");
ok("N1e every URL in the table is https and points at the official release assets",
   Object.values(table.versions[0].url || {}).every((u) => u.startsWith("https://github.com/CluvexStudio/Aether/releases/download/")));

/* ---------------- N2: aetherUpdate.ts contract ---------------- */
console.log("\n== N2 aetherUpdate.ts: the approved contract in code form ==");
ok("N2a the service + table loader + semver + transport seam are the exported surface",
   auCode.includes("export function createAetherUpdateService") &&
   auCode.includes("export function loadAetherVersionTable") &&
   auCode.includes("export function semverCompare") &&
   auCode.includes("export const defaultTransport"));
ok("N2b USER-CLICK ONLY: no timer exists anywhere in the module (no setInterval, no setTimeout)",
   !auCode.includes("setInterval") && !auCode.includes("setTimeout"));
ok("N2c the RUNNING LOCK gates check AND apply (2x) plus the gate-2 re-check + the status probe = 4 isRunning call sites",
   (auCode.match(/deps\.isRunning\(\)/g) || []).length === 4);
ok("N2d the in-flight guard collapses concurrent applies into one swap",
   auCode.includes("let inFlight = false") && auCode.includes('reason: "in-flight"'));
ok("N2e the pin table is the ONLY install authority: a missing row is a typed refusal",
   auCode.includes('reason: "not-pinned"') && auCode.includes("table.versions.find"));
ok("N2f the MANDATORY binary-hash gate: the extracted binary must match the table BEFORE anything is written",
   auCode.includes("sha256Bytes(data) !== expectedBinHash") &&
   auCode.includes('reason: "hash-mismatch"'));
ok("N2g the zip-asset hash gate exists too (Task-12 provenance parity)",
   auCode.includes('reason: "zip-hash-mismatch"') && auCode.includes("expectedZipHash"));
ok("N2h the swap is staged INSIDE the target dir with a .prev.bak backup and an on-failure restore",
   auCode.includes('target + ".incoming-tmp"') && auCode.includes('target + ".prev.bak"') &&
   auCode.includes("fs.renameSync(tmp, target)") && auCode.includes("fs.renameSync(bak, target)"));
ok("N2i what LANDED on disk is re-verified before the rename (belt & suspenders)",
   auCode.includes("sha256File(tmp) !== expectedBinHash"));
ok("N2j the gate-2 race detail names the honest reason (a core started mid-download)",
   auCode.includes("Aether started while the download was in flight"));
ok("N2k an unpinned upstream release is honestly REPORTED, never offered (fail-closed check)",
   auCode.includes('kind: "unpinned-newer"') && auCode.includes('kind: "pinned-newer"') &&
   auCode.includes('kind: "up-to-date"'));

/* ---------------- N3: isolation negatives (C2 parity, re-confirmed) ---------------- */
console.log("\n== N3 isolation negatives: the update path never touches system state ==");
ok("N3a aetherUpdate.ts imports NO electron (electron-free like killSwitch.ts)",
   !auCode.includes('from "electron"') && !auCode.includes('require("electron")'));
ok("N3b aetherUpdate.ts never imports the proxy writer or mentions the registry mechanics",
   !auCode.includes('from "./proxy"') && !auCode.includes("setSystemProxy") &&
   !auCode.includes("clearSystemProxy") && !auCode.includes("reg add") &&
   !auCode.includes("netsh") && !auCode.includes("ProxyEnable"));
ok("N3c aetherUpdate.ts uses no Electron net/session and no raw net module",
   !auCode.includes('from "net"') && !auCode.includes('from "electron:getFrame"') &&
   !auCode.includes("session.") && !auCode.includes("ipcMain") && !auCode.includes("ipcRenderer"));
ok("N3d aetherUpdate.ts never reads proxy environment variables (direct fetch only)",
   !auCode.includes("HTTP_PROXY") && !auCode.includes("http_proxy") &&
   !auCode.includes("HTTPS_PROXY") && !auCode.includes("ALL_PROXY"));
ok("N3e appUpdate.ts is STATIC: no fs/network/child_process/electron IMPORTS and no fetch call",
   !appUpdCode.includes("from \"fs\"") && !appUpdCode.includes('from "https"') &&
   !appUpdCode.includes('from "http"') && !appUpdCode.includes("fetch(") &&
   !appUpdCode.includes("child_process") && !appUpdCode.includes('from "electron"') &&
   !appUpdCode.includes("require("));
ok("N3f no autoUpdater anywhere and no self-swap path in the helper",
   !auCode.includes("autoUpdater") && !appUpdCode.includes("autoUpdater") &&
   !appUpdCode.includes("self-swap") && !appUpdCode.includes("autoUpdater"));
ok("N3g the appUpdate surface is only version + releasesUrl + selfUpdate:false",
   appUpdCode.includes("export const APP_RELEASES_URL") &&
   appUpdCode.includes("selfUpdate: false"));

/* ---------------- N4: the aether.ts spawn gate extends, never loosens ---------------- */
console.log("\n== N4 aether.ts: table-extended integrity gate ==");
ok("N4a the gate imports the pin table and unions its hashes for the platform",
   aeCode.includes('from "./aether-versions.json"') &&
   aeCode.includes("function allowedAetherTableHashes"));
ok("N4b the union condition keeps the bundled pin first and adds table hashes",
   aeCode.includes("actualHash !== pin && !tablePins.includes(actualHash)"));
ok("N4c the original refusal messages are preserved byte-for-byte",
   aeCode.includes("No pinned Aether SHA-256 exists for platform") &&
   aeCode.includes("Aether binary integrity check FAILED (sha256 mismatch)"));
ok("N4d the C5 kill-switch wiring in aether.ts is untouched (exit-handler block)",
   aeCode.includes("blockOnCoreExit()"));

/* ---------------- N5: ipc.ts wiring ---------------- */
console.log("\n== N5 ipc.ts: the four additive handlers ==");
ok("N5a all four commands are registered (the apply handler is multi-line)",
   ipcCode.includes('ipcMain.handle("aether_update_status"') &&
   ipcCode.includes('ipcMain.handle("aether_update_check"') &&
   ipcCode.includes('"aether_update_apply"') && ipcCode.includes("aetherUpdate.apply(version)") &&
   ipcCode.includes('ipcMain.handle("app_update_info"'));
ok("N5b the running-lock truth is the MANAGER's (live OR grace-pending child)",
   ipcCode.includes("isRunning: () => aetherManager.hasLiveChild()"));
ok("N5c the binary and swap-target paths wire to the real resolution ladder",
   ipcCode.includes("binaryPath: () => findAether()") &&
   ipcCode.includes('swapTargetDir: () => path.join(resourceRoot(), "aether")'));
ok("N5d the apply handler accepts ONLY a version string (URLs/hashes come from the table)",
   ipcCode.includes('String(args?.version || "").trim().slice(0, 32)'));
ok("N5e the self-update handler is static facts from app.getVersion()",
   ipcCode.includes("appUpdateInfo(app.getVersion())"));

/* ---------------- N6: preload allowlist ---------------- */
// NOTE (Phase B2, user-approved batch): the allowlist grew 27 -> 31 with
// the four routing commands (routing_start/stop/status/repair). The C6
// gate is updated accordingly — the C6 additions themselves are unchanged.
console.log("\n== N6 preload: allowlist 23 -> 27 (now 31 after B2), open-external reused ==");
ok("N6a the four update commands are in ALLOWED_COMMANDS",
   preCode.includes('"aether_update_status"') && preCode.includes('"aether_update_check"') &&
   preCode.includes('"aether_update_apply"') && preCode.includes('"app_update_info"'));
{
  const m = preCode.match(/new Set\(\[([\s\S]*?)\]\)/);
  const entries = m ? (m[1].match(/"[a-z_0-9]+"/g) || []).length : -1;
  ok("N6b the allowlist holds exactly 50 commands (32 at E2 + 18 R3 — disclosed re-point: 4 update-center, 1 live-conn, 2 scanner, 12 mhrv, minus none)", entries === 50, `got ${entries}`);
}
ok("N6c open-external is REUSED for the releases page (no new shell surface)",
   preCode.includes('openExternal: (url: string)'));

/* ---------------- N7: renderer ---------------- */
console.log("\n== N7 renderer: click-driven, running-locked, honest ==");
ok("N7a the Aether panel drives all three update commands",
   aetherTabCode.includes('"aether_update_status"') &&
   aetherTabCode.includes('"aether_update_check"') &&
   aetherTabCode.includes('"aether_update_apply"'));
ok("N7b the check is click-driven: exactly ONE aether_update_check call site and NO new poll",
   (aetherTabCode.match(/aether_update_check/g) || []).length === 1 &&
   (aetherTabCode.match(/setInterval\(/g) || []).length === 1);
ok("N7c the running-lock banner is visible and honest while the core runs",
   aetherTabCode.includes("st?.isRunning") && aetherTabCode.includes("aether.updateRunningBlocked"));
ok("N7d the install button appears ONLY for a pinned-newer offer (never for unpinned-newer)",
   aetherTabCode.includes('offer?.kind === "pinned-newer"') &&
   aetherTabCode.includes("aether.updateInstallBtn"));
ok("N7e the pin table itself is rendered (the only installable versions)",
   aetherTabCode.includes("aether.updateTableTitle") && aetherTabCode.includes("row.installable"));
ok("N7f the Settings self-update section shows the version and opens the page EXTERNALLY",
   setCode.includes('"app_update_info"') && setCode.includes("openExternalLink") &&
   setCode.includes("set.appUpdateTitle"));

/* ---------------- N8: i18n ---------------- */
console.log("\n== N8 i18n: 25 keys x 4 locales, honest en contract literals ==");
{
  const keys = [
    "aether.updateTitle", "aether.updateHint", "aether.updateActive", "aether.updateBundled",
    "aether.updateBinaryMissing", "aether.updateNotIdentified", "aether.updateRunningBlocked",
    "aether.updateCheckBtn", "aether.updateChecking", "aether.updateUpToDate",
    "aether.updatePinnedNewer", "aether.updateUnpinnedNewer", "aether.updateCheckFailed",
    "aether.updateInstallBtn", "aether.updateInstalling", "aether.updateDone",
    "aether.updateErrHash", "aether.updateErrNotPinned", "aether.updateErrGeneric",
    "aether.updateTableTitle", "set.appUpdateTitle", "set.appUpdateHint",
    "set.appUpdateThisBuild", "set.appUpdateOpenBtn", "set.appUpdateSteps",
  ];
  const locales = ["en", "fa", "zh", "ar"];
  const localeSeg = (loc) => {
    const start = i18n.indexOf(`\n  ${loc}: {`);
    if (start === -1) return "";
    const end = i18n.indexOf("\n  },", start);
    return i18n.slice(start, end === -1 ? undefined : end);
  };
  const segs = locales.map(localeSeg);
  let parityOk = true;
  for (const key of keys) {
    const needle = `"${key}":`;
    const count = segs.filter((seg) => seg.includes(needle)).length;
    if (count !== 4) { parityOk = false; console.log(`        (${key}: ${count}/4)`); }
  }
  ok("N8a all 25 new keys exist in ALL FOUR locales (en/fa/zh/ar)", parityOk);
}
ok("N8b the en hint states the honest contract: never checks by itself + sha256 + bundled pin default",
   i18n.includes("The app never checks by itself") && i18n.includes("sha256-verified against that table") &&
   i18n.includes("the bundled pin stays active"));
ok("N8c the en done-message names the rollback artifact aether.prev.bak",
   i18n.includes("kept as aether.prev.bak"));
ok("N8d the en self-update hint carries the no-self-swap contract",
   i18n.includes("never replaces its own executable") && i18n.includes("never checks the network for itself"));

/* ---------------- N9: electron-mock honest mirror ---------------- */
console.log("\n== N9 electron-mock: honest in a browser ==");
ok("N9a the mock carries all four commands and NEVER fakes success",
   mockCode.includes("aether_update_status") && mockCode.includes("aether_update_check") &&
   mockCode.includes("aether_update_apply") && mockCode.includes("app_update_info") &&
   mockCode.includes('kind: "error"') && mockCode.includes('reason: "not-pinned"'));
ok("N9b the mock's self-update info pins selfUpdate false",
   mockCode.includes("selfUpdate: false"));

/* ---------------- N10: docs ---------------- */
console.log("\n== N10 docs: README Batch C6 + checklist 27 + provenance intact ==");
ok("N10a README documents the pin-per-version contract and the running lock",
   readme.includes("pin-per-version") && readme.includes("never swapped underneath") &&
   readme.includes("sha256 is mandatory") && readme.includes("Batch C6"));
ok("N10b README documents the honest assistant and the allowlist growth",
   readme.includes("no self-swap") && readme.includes("23 -> 27") &&
   readme.includes("no network check, no download step"));
ok("N10c TESTING-CHECKLIST section 27 covers the offline default, the running lock and rollback",
   checklist.includes("## 27. Phase C6") && checklist.includes("Offline default") &&
   checklist.includes("never swapped underneath itself") && checklist.includes("aether.prev.bak"));
ok("N10d the bundled provenance README is still pinned at 1.9.0 (untouched)",
   aetherResReadme.includes("**Version:** 1.9.0") &&
   aetherResReadme.includes("ee400806bf73fe16e655e6478eb7442c2c4e0576c4c8ce1913ac474e846b36cd"));

console.log(`\n==== taskC6-quickcheck: ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
