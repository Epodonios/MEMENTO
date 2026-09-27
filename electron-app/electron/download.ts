/**
 * MEMENTO — xray-core auto-download — Electron port of lib.rs `download_xray`.
 *
 *  - Downloads Xray-<platform>-64.zip v25.1.1 from the XTLS GitHub releases.
 *  - Extracts xray.exe (+ geoip.dat / geosite.dat if bundled in the zip).
 *  - Geo databases are ALSO fetched as separate release assets as a silent
 *    best-effort fallback (they are published outside the platform zip).
 *  - All failure messages match the Rust strings the UI already displays.
 */
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { XRAY_BIN_NAME, XRAY_VERSION, XRAY_ZIP_NAME, dataDir, findXray, XrayInfo } from "./paths";

function releaseUrl(asset: string): string {
  return `https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/${asset}`;
}

export async function downloadXray(): Promise<XrayInfo> {
  // Already installed? (same early-exit as Rust)
  const existing = findXray();
  if (existing) {
    return { installed: true, path: existing, version: XRAY_VERSION };
  }

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const xrayDest = path.join(dir, XRAY_BIN_NAME);

  // Download the platform zip.
  let zipBytes: Buffer;
  try {
    const response = await fetch(releaseUrl(XRAY_ZIP_NAME));
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`);
    }
    zipBytes = Buffer.from(await response.arrayBuffer());
  } catch (e: any) {
    const msg = e?.message || String(e);
    throw new Error(msg.startsWith("Download failed:") ? msg : `Download failed: ${msg}`);
  }

  // Extract xray binary from the zip.
  let archive: AdmZip;
  try {
    archive = new AdmZip(zipBytes);
  } catch (e: any) {
    throw new Error(`Failed to open zip: ${e?.message || e}`);
  }

  let found = false;
  for (const entry of archive.getEntries()) {
    const name = entry.entryName;
    if (name === XRAY_BIN_NAME || name.endsWith(XRAY_BIN_NAME)) {
      const data = entry.getData();
      fs.writeFileSync(xrayDest, data);
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(xrayDest, 0o755);
        } catch (e: any) {
          throw new Error(`Cannot set permissions: ${e?.message || e}`);
        }
      }
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error(`${XRAY_BIN_NAME} not found in the downloaded zip`);
  }

  // Also extract geoip.dat / geosite.dat if bundled inside the platform zip
  // (some releases include them, some don't). Silent best-effort.
  for (const name of ["geoip.dat", "geosite.dat"]) {
    for (const entry of archive.getEntries()) {
      if (entry.entryName.endsWith(name)) {
        try {
          fs.writeFileSync(path.join(dir, name), entry.getData());
        } catch {
          /* silent */
        }
        break;
      }
    }
  }

  // Geo databases are published as SEPARATE release assets on most
  // Xray-core releases. Fetch them directly, silently ignoring failures —
  // MEMENTO's default config does not require these files to run.
  for (const name of ["geoip.dat", "geosite.dat"]) {
    const dest = path.join(dir, name);
    if (fs.existsSync(dest)) continue;
    try {
      const resp = await fetch(releaseUrl(name));
      if (resp.ok) {
        const bytes = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(dest, bytes);
      }
    } catch {
      /* silent — same as Rust */
    }
  }

  return { installed: true, path: xrayDest, version: XRAY_VERSION };
}
