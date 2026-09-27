#!/usr/bin/env node
/**
 * taskH OFFICIAL ZIP + SEAL — builds download/MEMENTO-3.2.0/ with:
 *
 *   MEMENTO-3.2.0.exe                    (real portable build, icon embedded;
 *                                        3.2.0 = in-place-aware uninstaller)
 *   MementoSetup-3.2.0.exe               (real installer build, icon embedded,
 *                                        requireAdministrator + AV-hardened +
 *                                        install-verification gates + UNPACKED
 *                                        app payload + window-is-the-panel +
 *                                        in-place destination support)
 *   MEMENTO-3.2.0-source.zip             (source WITHOUT core binaries)
 *   MEMENTO-3.2.0-source-with-cores.zip  (source WITH the real pinned cores)
 *   SHA256SUMS.txt                       (hashes of all four)
 *   FINAL-SEAL-SHA256.txt                (sha256 of SHA256SUMS.txt — the seal)
 *
 * Zip invariants carried over from taskG: no node_modules / dist /
 * dist-electron / release / build tmp dirs. The WITHOUT-cores zip keeps the
 * user's 3.1.5 contract (no xray/sing-box/aether binaries, no geo dat files;
 * wintun.dll README rider). The WITH-cores zip adds the real fetched cores +
 * geo files exactly as the build shipped them.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const SRC = "/home/z/work/memento-src/extracted/source";
const OUTDIR = "/home/z/my-project/download/MEMENTO-3.2.0";
fs.rmSync(OUTDIR, { recursive: true, force: true });
fs.mkdirSync(OUTDIR, { recursive: true });

/* ---------- real built exes ---------- */
const exeApp = path.join(SRC, "electron-app", "release", "MEMENTO-3.2.0.exe");
const exeSetup = path.join(SRC, "setup-app", "release", "MementoSetup-3.2.0.exe");
for (const f of [exeApp, exeSetup]) {
  if (!fs.existsSync(f)) { console.error(`FAIL missing built exe: ${f}`); process.exit(1); }
}
fs.copyFileSync(exeApp, path.join(OUTDIR, "MEMENTO-3.2.0.exe"));
fs.copyFileSync(exeSetup, path.join(OUTDIR, "MementoSetup-3.2.0.exe"));

/* ---------- source zips ---------- */
const TMP = "/tmp/taskH-zip-work";
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const STAGE = path.join(TMP, "stage");
fs.mkdirSync(STAGE, { recursive: true });
execFileSync("rsync", [
  "-a",
  "--exclude=node_modules", "--exclude=dist/", "--exclude=dist-electron/",
  "--exclude=release/", "--exclude=target/", "--exclude=*.tsbuildinfo", "--exclude=*.log",
  "--exclude=bun.lock",
  "--exclude=resources/wintun/bin/",
  "--exclude=setup-app/payload/", "--exclude=setup-app/payload-meta.json", "--exclude=setup-app/payload-manifest.json",
  "--exclude=setup-app/.g-stub/",
  "--exclude=scripts/task*-tmp/", "--exclude=scripts/task*smoke-tmp/",
  "--exclude=taskF-smoke-tmp/", "--exclude=taskG-smoke-tmp/", "--exclude=taskH-smoke-tmp/",
  "--exclude=.git/", "--exclude=.github/", "--exclude=*.zip",
  "--exclude=.vite/", "--exclude=.cache/",
  `${SRC}/`, `${STAGE}/`,
]);

// sanity: everything needed to rebuild + re-verify always rides
const mustRide = [
  "electron-app/scripts/fetch-cores.mjs",
  "electron-app/electron-builder.yml",
  "electron-app/electron/core-versions.json",
  "electron-app/electron/aether-versions.json",
  "electron-app/build/icon.ico",
  "BUILD-3.1.7.md", "electron-app/BUILD-3.1.8.md", "electron-app/BUILD-3.2.0.md",
  "scripts/taskG-smoke.mjs", "scripts/taskG-zip.mjs",
  "scripts/taskH-smoke.mjs", "scripts/taskH-zip.mjs",
  "scripts/check-icon.mjs", "scripts/embed-icon.mjs",
  "src/utils/scanPresets.ts", "src/components/ScannerTab.tsx",
  "src/components/UpdateCenterTab.tsx",
  "src/components/ConfigBuilderTab.tsx", "src/components/ImportTab.tsx",
  "src/components/GoogleSideTab.tsx", "src/components/LiveConnTab.tsx",
  "src/components/ConnectionTab.tsx",
  "electron-app/electron/mhrv.ts", "electron-app/electron/connectionStats.ts",
  "electron-app/electron/liveConn.ts", "electron-app/electron/ipc.ts",
  "electron-app/electron/preload.ts",
  "setup-app/package.json", "setup-app/electron-builder.yml", "setup-app/electron/installerCore.ts", "setup-app/electron/main.ts",
  "setup-app/README.md", "electron-app/TESTING-CHECKLIST.md",
  "setup-app/scripts/sync-payload.js",
];
for (const m of mustRide) {
  if (!fs.existsSync(path.join(STAGE, m))) { console.error(`FAIL staged tree missing ${m}`); process.exit(1); }
}

const zip = (out, extraExcludes) => {
  const args = ["-q", "-r", out, "."];
  for (const x of extraExcludes) args.push("-x", x);
  execFileSync("zip", args, { cwd: STAGE });
};

/* zip 1 — WITHOUT cores (also strips the big geo data files) */
const zipNoCores = path.join(OUTDIR, "MEMENTO-3.2.0-source.zip");
zip(zipNoCores, [
  "electron-app/resources/xray/*",
  "electron-app/resources/sing-box/*",
  "electron-app/resources/aether/*",
  "electron-app/resources/geoip.dat",
  "electron-app/resources/geosite.dat",
]);

/* zip 2 — WITH the real cores (exactly what the build shipped) */
const zipWithCores = path.join(OUTDIR, "MEMENTO-3.2.0-source-with-cores.zip");
zip(zipWithCores, []);

/* ---------- verification gates on the zips ---------- */
let bad = 0;
const mustNot = (zipFile, frag, why) => {
  const listing = execFileSync("unzip", ["-Z1", zipFile], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const hits = listing.split("\n").filter((l) => l.includes(frag));
  if (hits.length) { console.error(`FAIL  ${path.basename(zipFile)} contains ${frag} (${why}): ${hits.slice(0, 4).join(", ")}`); bad++; return; }
  console.log(`PASS  ${path.basename(zipFile)} contains NO ${frag} (${why})`);
};
const mustHave = (zipFile, frag, why) => {
  const listing = execFileSync("unzip", ["-Z1", zipFile], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const hits = listing.split("\n").filter((l) => l.includes(frag));
  if (!hits.length) { console.error(`FAIL  ${path.basename(zipFile)} missing ${frag} (${why})`); bad++; return; }
  console.log(`PASS  ${path.basename(zipFile)} contains ${frag} (${why})`);
};

for (const z of [zipNoCores, zipWithCores]) {
  mustNot(z, "node_modules/", "deps never ship");
  mustNot(z, "setup-app/release/", "build artifacts never ship");
  mustHave(z, "electron-app/resources/wintun/README.md", "wintun rider (matches the user's own 3.1.5 zip)");
  mustHave(z, "BUILD-3.2.0.md", "3.2.0 build notes"),
  mustHave(z, "BUILD-3.1.7.md", "build notes");
  mustHave(z, "src/components/ConfigBuilderTab.tsx", "3.1.7 config builder ships");
  mustHave(z, "scripts/taskH-smoke.mjs", "3.1.7 gates ship");
}
mustNot(zipNoCores, "resources/xray/xray.exe", "core binaries never ship in the plain source zip");
mustNot(zipNoCores, "resources/aether/aether.exe", "core binaries never ship in the plain source zip");
mustHave(zipWithCores, "electron-app/resources/xray/xray.exe", "real core rides in the with-cores zip");
mustHave(zipWithCores, "electron-app/resources/sing-box/sing-box.exe", "real core rides in the with-cores zip");
mustHave(zipWithCores, "electron-app/resources/aether/aether.exe", "real core rides in the with-cores zip");
mustHave(zipWithCores, "electron-app/resources/geoip.dat", "geo data rides in the with-cores zip");
if (bad) process.exit(1);

/* ---------- SHA256SUMS + seal ---------- */
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const files = [
  "MEMENTO-3.2.0.exe",
  "MementoSetup-3.2.0.exe",
  "MEMENTO-3.2.0-source.zip",
  "MEMENTO-3.2.0-source-with-cores.zip",
];
const lines = files.map((f) => `${sha256(path.join(OUTDIR, f))}  ${f}`);
fs.writeFileSync(path.join(OUTDIR, "SHA256SUMS.txt"), lines.join("\n") + "\n", "utf8");
const seal = sha256(path.join(OUTDIR, "SHA256SUMS.txt"));
fs.writeFileSync(path.join(OUTDIR, "FINAL-SEAL-SHA256.txt"), `${seal}  SHA256SUMS.txt (MEMENTO 3.2.0 seal)\n`, "utf8");

console.log("\n=== download/MEMENTO-3.2.0/ ===");
for (const f of [...files, "SHA256SUMS.txt", "FINAL-SEAL-SHA256.txt"]) {
  const s = fs.statSync(path.join(OUTDIR, f)).size;
  console.log(`${(s / 1024 ** 2).toFixed(2).padStart(9)} MB  ${f}`);
}
console.log(`\nFINAL SEAL SHA-256: ${seal}`);
