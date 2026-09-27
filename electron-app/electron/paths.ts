/**
 * MEMENTO — resource & path resolution (Electron port of lib.rs `find_xray`
 * and `find_spoofing_patt`).
 *
 * Mirrors the Tauri logic exactly:
 *   1. resource dir candidates (bundled layout, including the nested
 *      resources/resources/ quirk kept for byte-parity with Tauri mapping)
 *   2. app data dir candidates (auto-downloaded xray lives here)
 *   3. exe dir candidates
 *   4. PATH lookup (xray, then xray-core)
 */
import { app } from "electron";
import fs from "fs";
import path from "path";
import coreVersions from "./core-versions.json";

/** Single source of truth for pinned core versions (Task 11 + Task 12). */
export const XRAY_VERSION = coreVersions["xray"];
export const SING_BOX_VERSION = coreVersions["sing-box"];
export const AETHER_VERSION = coreVersions["aether"];
export const MAX_LOG_LINES = 300;

export const XRAY_BIN_NAME =
  process.platform === "win32"
    ? "xray.exe"
    : process.platform === "darwin"
      ? "xray"
      : "xray";

export const XRAY_ZIP_NAME =
  process.platform === "win32"
    ? "Xray-windows-64.zip"
    : process.platform === "darwin"
      ? "Xray-macos-64.zip"
      : "Xray-linux-64.zip";

export const SING_BOX_BIN_NAME =
  process.platform === "win32" ? "sing-box.exe" : "sing-box";

/** Task 12: the Aether core binary name (official releases ship `aether.exe`).
 *  Deliberately NOT named after the folder — same existsFile() discipline as
 *  sing-box (binary name must never collide with the resource folder name). */
export const AETHER_BIN_NAME =
  process.platform === "win32" ? "aether.exe" : "aether";

/** The folder that holds xray/, spoofing-patt/, domain-fronting/, geoip.dat… */
export function resourceRoot(): string {
  if (app.isPackaged) {
    // electron-builder extraResources: from "resources" to "resources"
    // -> <install>/resources/resources/... under process.resourcesPath
    return path.join(process.resourcesPath, "resources");
  }
  // Dev: electron-app/resources (synced from src-tauri/resources)
  return path.join(app.getAppPath(), "resources");
}

/** Persistent data dir. Overridden at startup to match Tauri's
 *  app_data_dir (%APPDATA%/com.epodonios.memento) so an existing
 *  MEMENTO install keeps its downloaded xray.exe and geo files. */
export function dataDir(): string {
  return app.getPath("userData");
}

/** Directory of the running executable (portable exe unpacks here at runtime). */
export function exeDir(): string {
  return path.dirname(app.getPath("exe"));
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Minimal PATH lookup — the equivalent of the Rust `which` crate. */
export function whichXray(bin: string): string | null {
  const pathEnv = process.env.PATH || process.env.Path || "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".exe").split(";")
      : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext.toLowerCase());
      const candidateRaw = path.join(dir, bin + ext);
      if (exists(candidateRaw)) return candidateRaw;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Electron port of `find_xray`. Same candidate order as lib.rs:
 *   resource_dir/xray/<bin>, resource_dir/<bin>,
 *   resource_dir/resources/xray/<bin>, resource_dir/resources/<bin>,
 *   data_dir/xray/<bin>, data_dir/<bin>,
 *   exe_dir/xray/<bin>, exe_dir/<bin>,
 *   which("xray"), which("xray-core")
 */
export function findXray(): string | null {
  const bin = XRAY_BIN_NAME;
  const candidates: string[] = [
    // R3 task #3: a binary installed by the UPDATE CENTER always wins —
    // this is the missing link that made old updates "never apply": the
    // bundled resource copy silently shadowed the downloaded one.
    path.join(dataDir(), "updates", "xray", bin),
    path.join(resourceRoot(), "xray", bin),
    path.join(resourceRoot(), bin),
    path.join(resourceRoot(), "resources", "xray", bin),
    path.join(resourceRoot(), "resources", bin),
    path.join(dataDir(), "xray", bin),
    path.join(dataDir(), bin),
    path.join(exeDir(), "xray", bin),
    path.join(exeDir(), bin),
  ];

  for (const p of candidates) {
    if (exists(p)) return p;
  }

  const onPath = whichXray("xray") || whichXray("xray-core");
  return onPath;
}

export interface XrayInfo {
  installed: boolean;
  path: string;
  version: string;
}

function existsFile(p: string): boolean {
  try {
    // Must be a FILE: on non-Windows the binary name ("sing-box") collides
    // with the resource FOLDER name ("resources/sing-box/") — a bare
    // exists() would resolve the directory and fail the spawn with EACCES.
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Task 11: locate the bundled sing-box binary. Candidate order mirrors
 * findXray, but there is NO auto-download for sing-box — phase 1 ships it
 * version-pinned in resources/sing-box/ (see that folder's README for the
 * exact URL + SHA-256). A missing binary simply disables Hysteria2/TUIC
 * with a clear error; Xray configs are unaffected.
 */
export function findSingBox(): string | null {
  const bin = SING_BOX_BIN_NAME;
  const candidates: string[] = [
    // R3 task #3: Update Center installs win over the bundled copy (same
    // resolution-priority contract as findXray above).
    path.join(dataDir(), "updates", "sing-box", bin),
    path.join(resourceRoot(), "sing-box", bin),
    path.join(resourceRoot(), bin),
    path.join(resourceRoot(), "resources", "sing-box", bin),
    path.join(resourceRoot(), "resources", bin),
    path.join(dataDir(), "sing-box", bin),
    path.join(dataDir(), bin),
    path.join(exeDir(), "sing-box", bin),
    path.join(exeDir(), bin),
  ];

  for (const p of candidates) {
    if (existsFile(p)) return p;
  }

  // Last resort: a sing-box on PATH (dev machines only, best-effort).
  return whichGeneric(bin);
}

/**
 * Task 12: locate the bundled Aether core binary. Same candidate ladder as
 * findSingBox (findSingBox's own existsFile discipline applies — the binary
 * name must resolve to a FILE, never to the resources/aether/ FOLDER).
 * NO auto-download: the core is version-pinned v1.9.0 and shipped in
 * resources/aether/ (see that folder's README for the exact URL + the
 * official SHA-256SUMS.txt provenance). A missing binary disables the
 * Aether tab with a clear error; Xray/sing-box flows are unaffected.
 */
export function findAether(): string | null {
  const bin = AETHER_BIN_NAME;
  const candidates: string[] = [
    path.join(resourceRoot(), "aether", bin),
    path.join(resourceRoot(), bin),
    path.join(resourceRoot(), "resources", "aether", bin),
    path.join(resourceRoot(), "resources", bin),
    path.join(dataDir(), "aether", bin),
    path.join(dataDir(), bin),
    path.join(exeDir(), "aether", bin),
    path.join(exeDir(), bin),
  ];

  for (const p of candidates) {
    if (existsFile(p)) return p;
  }

  // Last resort: an aether on PATH (dev machines only, best-effort).
  return whichGeneric(bin);
}

/** Minimal PATH lookup — the equivalent of the Rust `which` crate. */
function whichGeneric(bin: string): string | null {
  const pathEnv = process.env.PATH || process.env.Path || "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".exe").split(";")
      : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext.toLowerCase());
      const candidateRaw = path.join(dir, bin + ext);
      if (exists(candidateRaw)) return candidateRaw;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Electron port of `check_xray`. */
export function checkXray(): XrayInfo {
  const found = findXray();
  if (found) {
    return { installed: true, path: found, version: XRAY_VERSION };
  }
  return { installed: false, path: "", version: "" };
}

/** Preferred executable names for Spoofing Patt, then first .exe fallback. */
const SPOOFING_PREFERRED = [
  "spoofing patt.exe",
  "Spoofing Patt.exe",
  "spoofing-patt.exe",
  "spoofing_patt.exe",
];

/**
 * Electron port of `find_spoofing_patt`. The whole directory must stay
 * together: Spoofing Patt resolves its companion files relative to the
 * working directory of the exe.
 */
export function findSpoofingPatt(): string | null {
  const roots = [
    path.join(resourceRoot(), "spoofing-patt"),
    path.join(exeDir(), "spoofing-patt"),
  ];

  for (const root of roots) {
    for (const name of SPOOFING_PREFERRED) {
      const candidate = path.join(root, name);
      if (exists(candidate)) return candidate;
    }
    try {
      const entries = fs.readdirSync(root);
      for (const entry of entries) {
        if (entry.toLowerCase().endsWith(".exe")) {
          return path.join(root, entry);
        }
      }
    } catch {
      /* folder missing — try next root */
    }
  }
  return null;
}
