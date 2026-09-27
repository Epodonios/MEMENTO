#!/usr/bin/env node
/**
 * MementoSetup — payload sync v2 (3.1.6 runtime-reuse).
 *
 * THE 2.0.0 SIZE PROBLEM: the old payload was the ENTIRE win-unpacked tree
 * (373 MB) — it carried a SECOND copy of the Electron runtime (MEMENTO.exe
 * alone was 235 MB) even though the installer itself IS an Electron app of
 * the exact same runtime version. Two runtimes inside one portable exe is
 * why MementoSetup-2.0.0.exe weighed 255 MB.
 *
 * THE 2.0.1 FIX — runtime-reuse: the payload now ships ONLY the parts the
 * installer's own runtime cannot provide:
 *
 *   payload/resources/app/            (MEMENTO's app code — UNPACKED
 *                                      since 2.0.5 / field report #3:
 *                                      Defender scans inside .asar blobs,
 *                                      a quarantined app.asar was a total
 *                                      loss; a file tree is heal-able
 *                                      per-file by the 2.0.4 verify pass)
 *   payload/resources/icon.ico|png    (tray icon — resolved via resourcesPath)
 *   payload/resources/resources/**    (xray / sing-box / aether / wintun / geo)
 *
 * At install time the wizard clones ITS OWN runtime (dlls, paks, locales,
 * LICENSE, the running exe as MEMENTO.exe) into the destination and then
 * drops this payload on top — a complete MEMENTO install with ONE runtime
 * shipped. installerCore picks the mode from payload-meta.json; dev runs
 * and gate fixtures stay on the classic full-tree path (--stub unchanged).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP_ROOT = path.resolve(ROOT, "..", "electron-app");
const SRC = process.argv.includes("--stub") ? null : path.join(APP_ROOT, "release", "win-unpacked");
const DEST = path.join(ROOT, "payload");

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let files = 0, bytes = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      const sub = copyTree(s, d);
      files += sub.files;
      bytes += sub.bytes;
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
      const st = fs.statSync(d);
      files++;
      bytes += st.size;
    }
  }
  return { files, bytes };
}

// byte-count manifest for the wizard's space meters (the install-time
// SHA-256 manifest is computed live by installerCore)
function writeByteManifest() {
  let files = 0, bytes = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { files++; bytes += fs.statSync(p).size; }
    }
  };
  walk(DEST);
  fs.writeFileSync(
    path.join(ROOT, "payload-manifest.json"),
    JSON.stringify({ fileCount: files, totalBytes: bytes }, null, 2),
    "utf8"
  );
  return { files, bytes };
}

fs.rmSync(DEST, { recursive: true, force: true });

if (SRC && fs.existsSync(path.join(SRC, "resources", "app", "package.json"))) {
  // ---- runtime-reuse payload (lite) ----
  const stats = { files: 0, bytes: 0 };
  const addFile = (sub) => {
    fs.mkdirSync(path.dirname(path.join(DEST, sub)), { recursive: true });
    fs.copyFileSync(path.join(SRC, sub), path.join(DEST, sub));
    const st = fs.statSync(path.join(DEST, sub));
    stats.files += 1;
    stats.bytes += st.size;
  };
  const add = (sub) => {
    const r = copyTree(path.join(SRC, sub), path.join(DEST, sub));
    stats.files += r.files;
    stats.bytes += r.bytes;
  };
  add(path.join("resources", "app")); // unpacked app code (2.0.5)
  addFile(path.join("resources", "icon.ico"));
  addFile(path.join("resources", "icon.png"));
  add(path.join("resources", "resources"));
  const manifest = writeByteManifest();
  const coreVersions = JSON.parse(
    fs.readFileSync(path.join(APP_ROOT, "electron", "core-versions.json"), "utf8")
  );
  const appVersion = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version;
  fs.writeFileSync(
    path.join(ROOT, "payload-meta.json"),
    JSON.stringify(
      { appVersion, cores: coreVersions, mode: "runtime-reuse", files: manifest.files, bytes: manifest.bytes },
      null,
      2
    ),
    "utf8"
  );
  console.log(
    `[sync-payload] runtime-reuse payload: ${manifest.files} files · ${(manifest.bytes / 1024 ** 2).toFixed(1)} MB (was 373 MB with the duplicate runtime in 2.0.0)`
  );
} else if (SRC && fs.existsSync(path.join(SRC, "MEMENTO.exe"))) {
  // ---- full-tree fallback (a win-unpacked without an asar — legacy path) ----
  copyTree(SRC, DEST);
  const stats = writeByteManifest();
  const coreVersions = JSON.parse(
    fs.readFileSync(path.join(APP_ROOT, "electron", "core-versions.json"), "utf8")
  );
  const appVersion = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version;
  fs.writeFileSync(
    path.join(ROOT, "payload-meta.json"),
    JSON.stringify({ appVersion, cores: coreVersions, mode: "full-tree", files: stats.files, bytes: stats.bytes }, null, 2),
    "utf8"
  );
  console.log(`[sync-payload] full-tree payload: ${stats.files} files · ${(stats.bytes / 1024 ** 2).toFixed(1)} MB from win-unpacked`);
} else {
  // ---- fixture payload (pipeline tests on any OS) ----
  const fakeCores = path.join(DEST, "resources");
  for (const dir of ["xray", "sing-box", "aether", "wintun/bin/amd64"]) {
    fs.mkdirSync(path.join(fakeCores, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(fakeCores, "xray", "xray.exe"), "fixture-xray-core-binary\n");
  fs.writeFileSync(path.join(fakeCores, "sing-box", "sing-box.exe"), "fixture-sing-box-binary\n");
  fs.writeFileSync(path.join(fakeCores, "aether", "aether.exe"), "fixture-aether-binary\n");
  fs.writeFileSync(path.join(fakeCores, "wintun", "bin", "amd64", "wintun.dll"), "fixture-wintun\n");
  fs.writeFileSync(path.join(DEST, "MEMENTO.exe"), "fixture-memento-shell\n");
  fs.writeFileSync(path.join(DEST, "resources", "geoip.dat"), "fixture-geoip\n");
  const appVersion = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version;
  const coreVersions = JSON.parse(
    fs.readFileSync(path.join(APP_ROOT, "electron", "core-versions.json"), "utf8")
  );
  fs.writeFileSync(
    path.join(ROOT, "payload-meta.json"),
    JSON.stringify({ appVersion, cores: coreVersions, mode: "full-tree" }, null, 2),
    "utf8"
  );
  writeByteManifest();
  console.log("[sync-payload] fixture payload written (no win-unpacked build present)");
}
