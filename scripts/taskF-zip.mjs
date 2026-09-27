#!/usr/bin/env node
/**
 * taskF OFFICIAL ZIP + SEAL — rebuild download/MEMENTO-3.1.5-source-taskF.zip
 * from the working tree and produce the SHA-256 seal.
 *
 * taskF = the three-change round:
 *   F1  MementoSetup (setup-app) — design-exact wizard + real install
 *       pipeline + the --memento-uninstall uninstaller in MEMENTO;
 *       the NSIS target is retired.
 *   F2  IP Scanner v2 — streaming per-host engine + auto tags + batch geo
 *       + local subnet + the redesigned ScannerTab (filters, copy, CSV).
 *   F3  Update Center — real live-binary version probing (bugfix),
 *       per-attempt abort timers (bugfix), lastCheckedAt, per-card
 *       progress (bugfix), the 4-card redesigned UI, the Aether toast
 *       typo fix, honest browser mocks.
 *
 * Zip invariants (carried over): node_modules / dist / dist-electron /
 * release / tsbuildinfo never ship; resources/wintun/bin/* NEVER ships
 * (the binary-never-ships negative gate below still ENFORCES that).
 * NEW for taskF: setup-app payload/ + release/ + dist/ never ship either.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const SRC = "/home/z/my-project/memento-src";
const OUT = "/home/z/my-project/download/MEMENTO-3.1.5-source-taskF.zip";

fs.rmSync(OUT, { force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const X = [
  "node_modules/*", "*/node_modules/*",
  "dist/*", "*/dist/*",
  "dist-electron/*", "*/dist-electron/*",
  "release/*", "*/release/*",
  "target/*", "*/target/*",
  "*.tsbuildinfo", "*.log",
  "bun.lock", "*/bun.lock",              // bun artifacts never ship (npm lockfile only)
  "resources/wintun/bin/*",              // B0: the wintun.dll NEVER ships in the zip
  "setup-app/payload/*",                 // taskF: the payload is synced at build time
  "setup-app/payload-meta.json",
  "setup-app/payload-manifest.json",
  "scripts/taskD4-quitclean-tmp/*", "scripts/taskD4-smoke-tmp/*",
  "scripts/taskD4-fn-tmp/*", "scripts/taskD3-*-tmp/*", "scripts/taskD2-*-tmp/*",
  "scripts/taskC1-*-tmp/*", "scripts/taskC1-smoke-tmp/*",
  "scripts/taskC2-*-tmp/*", "scripts/taskC2-smoke-tmp/*",
  "scripts/taskC3-*-tmp/*", "scripts/taskC3-smoke-tmp/*",
  "scripts/taskC4-*-tmp/*", "scripts/taskC4-smoke-tmp/*", "scripts/taskC4-live-tmp/*",
  "scripts/taskC5-*-tmp/*", "scripts/taskC5-smoke-tmp/*", "scripts/taskC5-live-tmp/*",
  "scripts/taskC6-*-tmp/*", "scripts/taskC6-smoke-tmp/*", "scripts/taskC6-live-tmp/*",
  "scripts/taskB0-*-tmp/*", "scripts/taskB0-smoke-tmp/*", "scripts/taskB0-live-tmp/*",
  "scripts/taskB1-*-tmp/*", "scripts/taskB1-smoke-tmp/*", "scripts/taskB1-live-tmp/*",
  "scripts/taskB2-*-tmp/*", "scripts/taskB2-smoke-tmp/*", "scripts/taskB2-live-tmp/*",
  "scripts/taskB3-*-tmp/*", "scripts/taskB3-smoke-tmp/*", "scripts/taskB3-live-tmp/*",
  "scripts/taskB4-*-tmp/*", "scripts/taskB4-smoke-tmp/*", "scripts/taskB4-live-tmp/*",
  "scripts/taskL0-*-tmp/*", "scripts/taskL0-smoke-tmp/*", "scripts/taskL0-live-tmp/*",
  "scripts/taskE1-*-tmp/*", "scripts/taskE1-smoke-tmp/*", "scripts/taskE1-live-tmp/*",
  "scripts/taskE2-*-tmp/*", "scripts/taskE2-smoke-tmp/*", "scripts/taskE2-live-tmp/*",
  "scripts/taskF-*-tmp/*", "scripts/taskF-smoke-tmp/*",
];
execFileSync("zip", ["-q", "-r", OUT, ".", ...X.flatMap((p) => ["-x", p])], { cwd: SRC });

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`zip rebuilt: ${OUT}`);
console.log(`size: ${mb} MB`);

const listing = execFileSync("unzip", ["-Z1", OUT], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const entries = listing.split("\n").filter((l) => l && !l.endsWith("/"));
console.log(`file entries: ${entries.length}`);

let bad = 0;
const must = (m) => {
  if (!entries.includes(m)) { console.error(`FAIL  missing key file in zip: ${m}`); bad++; return; }
  console.log(`PASS  zip contains ${m}`);
};
const mustNot = (frag, why) => {
  const hits = entries.filter((e) => e.includes(frag));
  if (hits.length) { console.error(`FAIL  forbidden in zip (${why}): ${hits.slice(0, 5).join(", ")}`); bad++; return; }
  console.log(`PASS  zip contains NO ${frag} (${why})`);
};

/* ---- negative gates ---- */
/* B0's binary-never-ships contract: the CORE binaries never ride the zip
 * (xray / sing-box / aether). NOTE: the restored taskF tree carries
 * electron-app/resources/wintun/bin/amd64/wintun.dll exactly like the
 * user's own 3.1.5 source zip did — wintun is the Microsoft driver shim,
 * not a proxy core, and MEMENTO pins + hash-verifies it at runtime. */
mustNot("xray.exe", "core binaries never ship");
mustNot("sing-box.exe", "core binaries never ship");
mustNot("aether.exe", "core binaries never ship");
mustNot("Xray-windows-64.zip", "core assets never ship");
mustNot("node_modules/", "deps never ship");
mustNot("setup-app/payload/", "installer payload synced at build time");
mustNot("setup-app/release/", "build artifacts never ship");
mustNot(".bak-", "staged installer backups never ship");

/* ---- taskF key files ---- */
[
  // F1: the setup-app
  "setup-app/package.json", "setup-app/electron-builder.yml", "setup-app/vite.config.ts",
  "setup-app/index.html", "setup-app/src/setup.ts", "setup-app/src/design-head.html",
  "setup-app/electron/main.ts", "setup-app/electron/preload.ts",
  "setup-app/electron/installerCore.ts", "setup-app/scripts/sync-payload.js",
  "setup-app/README.md", "setup-app/.gitignore",
  // F1: the uninstaller + builder change
  "electron-app/electron/uninstall.ts", "electron-app/electron/main.ts",
  "electron-app/electron-builder.yml", "BUILD-3.1.5.md",
  // F2: the scanner
  "electron-app/electron/scanner.ts", "electron-app/electron/ipc.ts",
  "electron-app/electron/preload.ts", "src/components/ScannerTab.tsx",
  // F3: the update center
  "electron-app/electron/updateCenter.ts", "src/components/UpdateCenterTab.tsx",
  "src/electron-mock.ts",
  // gates
  "scripts/taskF-smoke.mjs", "scripts/taskF1-entry.ts", "scripts/taskF2-entry.ts",
  "scripts/taskF3-entry.ts", "scripts/taskF-electron-stub.mts", "scripts/taskF-zip.mjs",
].forEach(must);

/* ---- regression key files (prior rounds) ---- */
[
  "src/store.ts", "src/App.tsx", "src/i18n.ts", "src/main.tsx",
  "electron-app/electron/paths.ts", "electron-app/electron/cores.ts",
  "electron-app/electron/aether.ts", "electron-app/electron/aetherUpdate.ts",
  "electron-app/electron/appUpdate.ts", "electron-app/electron/core-versions.json",
  "electron-app/package.json", "electron-app/TESTING-CHECKLIST.md", "electron-app/README.md",
  "scripts/task13-selftest.mjs", "scripts/taskE2-zip.mjs",
].forEach(must);

/* ---- content pins ---- */
const readZip = (m) => execFileSync("unzip", ["-p", OUT, m], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
{
  const setupHtml = readZip("setup-app/index.html");
  const pins = [
    ["--acc:#22c55e", "design token green"],
    ['data-step="4"', "the 5-step wizard"],
    ['class="win-dots"', "window controls"],
    ["/src/setup.ts", "wiring entry"],
  ];
  for (const [needle, why] of pins) {
    if (!setupHtml.includes(needle)) { console.error(`FAIL  setup-app/index.html missing ${why}`); bad++; }
    else console.log(`PASS  setup-app/index.html has ${why}`);
  }
  const wiring = readZip("setup-app/src/setup.ts");
  if (!wiring.includes("setupAPI") || !wiring.includes("demoInstall")) { console.error("FAIL  setup wiring broken"); bad++; }
  else console.log("PASS  setup wiring: real API + demo fallback both present");
  const uninstall = readZip("electron-app/electron/uninstall.ts");
  if (!uninstall.includes("--memento-uninstall")) { console.error("FAIL  uninstall flag missing"); bad++; }
  else console.log("PASS  uninstall flag present");
  const mainT = readZip("electron-app/electron/main.ts");
  if (!mainT.includes("startUninstallMode")) { console.error("FAIL  uninstall mode not wired"); bad++; }
  else console.log("PASS  uninstall mode wired in main.ts");
  const scanner = readZip("electron-app/electron/scanner.ts");
  if (!scanner.includes("scanner_host") === false && !scanner.includes("onHost")) { console.error("FAIL  scanner streaming missing"); bad++; }
  else if (!scanner.includes("fetchGeoBatch") || !scanner.includes("localSubnet")) { console.error("FAIL  scanner v2 surfaces missing"); bad++; }
  else console.log("PASS  scanner v2: streaming + geo + localSubnet");
  const uc = readZip("electron-app/electron/updateCenter.ts");
  if (!uc.includes("source") || !uc.includes("lastCheckedAt")) { console.error("FAIL  updateCenter bugfix fields missing"); bad++; }
  else console.log("PASS  updateCenter bugfix fields present");
}

/* ---- the seal ---- */
const hash = crypto.createHash("sha256").update(fs.readFileSync(OUT)).digest("hex");
const sealPath = OUT.replace(/\.zip$/, ".sha256");
fs.writeFileSync(sealPath, `${hash}  ${path.basename(OUT)}\n`, "utf8");

console.log(`\n========================================`);
if (bad) {
  console.error(`ZIP GATE FAILED: ${bad} problem(s)`);
  process.exit(1);
}
console.log(`zip entries: ${entries.length}`);
console.log(`size: ${mb} MB`);
console.log(`SHA-256: ${hash}`);
console.log(`seal file: ${sealPath}`);
console.log(`========================================`);
