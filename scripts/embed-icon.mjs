#!/usr/bin/env node
/**
 * embed-icon.mjs — embed the REAL MEMENTO icon + version info into Windows
 * executables, pure JavaScript (resedit + pe-library — NO wine required).
 *
 * WHY THIS EXISTS (the 3.1.5 icon bug): both electron-builder configs set
 * `signAndEditExecutable: false` (the standard Linux-build contract), so
 * the packaged MEMENTO.exe kept Electron's default icon. Windows derives
 * the desktop/Start-Menu shortcut icon FROM THE EXE RESOURCES, so every
 * installed shortcut showed the wrong icon even though icon.ico rode
 * along as an extraResource.
 *
 * WHAT IT DOES
 *   - replaces / adds the RT_GROUP_ICON + RT_ICON resources from the .ico
 *   - updates (or creates) the VERSIONINFO resource: FileDescription,
 *     ProductName, FileVersion, ProductVersion, OriginalFilename, …
 *   - PRESERVES the overlay: portable-target exes are 7z-SFX stubs with
 *     the archive appended after the last PE section, and pe-library's
 *     generate() DROPS appended data — so we slice the overlay off before
 *     patching and re-append it after. The SFX stub locates its archive by
 *     scanning backwards from EOF, so a shifted offset is fine; the smoke
 *     still verifies the archive bytes byte-for-byte + `7za t` integrity.
 *
 * Usage: node embed-icon.mjs <exe> <ico> \
 *          --name MEMENTO --desc "MEMENTO — V2Ray Config Editor" \
 *          --version 3.1.6 [--orig MEMENTO.exe] [--company EPODONIOS]
 */
import fs from "node:fs";
import * as PE from "pe-library";
import * as ResEdit from "resedit";

function parsePeOverlayStart(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE file (MZ)");
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error("not a PE file (PE\\0\\0)");
  const numSections = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const sectionOff = peOff + 24 + optSize;
  let end = 0;
  for (let i = 0; i < numSections; i++) {
    const s = sectionOff + i * 40;
    const rawPtr = buf.readUInt32LE(s + 20);
    const rawSize = buf.readUInt32LE(s + 16);
    if (rawPtr + rawSize > end) end = rawPtr + rawSize;
  }
  // also account for the certificate table (overlay usually starts after it)
  const ddOff = peOff + 24 + 128; // data directory[4] = certificate (PE32+ layout offset handled loosely)
  try {
    const certRva = buf.readUInt32LE(ddOff);
    const certSize = buf.readUInt32LE(ddOff + 4);
    if (certRva > 0 && certSize > 0) {
      // cert entries are file offsets in practice for the table position we read
      const certEnd = certRva + certSize;
      if (certEnd > end && certEnd <= buf.length) end = certEnd;
    }
  } catch { /* best-effort */ }
  return end < buf.length ? end : buf.length;
}

const args = process.argv.slice(2);
const exePath = args[0];
const icoPath = args[1];
if (!exePath || !icoPath || !fs.existsSync(exePath) || !fs.existsSync(icoPath)) {
  console.error("usage: node embed-icon.mjs <exe> <ico> --name N --desc D --version V [--orig O] [--company C]");
  process.exit(2);
}
const opt = (k, d = "") => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? args[i + 1] : d;
};
const appName = opt("name", "MEMENTO");
const desc = opt("desc", "MEMENTO — V2Ray Config Editor");
const version = opt("version", "3.1.6").replace(/^v/, "");
const origName = opt("orig", exePath.split(/[\\/]/).pop());
const company = opt("company", "EPODONIOS");

const original = fs.readFileSync(exePath);
const overlayStart = parsePeOverlayStart(original);
const overlay = original.subarray(overlayStart);

const exe = PE.NtExecutable.from(original, { ignoreCert: true });
const res = PE.NtExecutableResource.from(exe);

/* ---- icons ---- */
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const existingGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries).map((e) => e.id);
const groupId = existingGroups[0] ?? 1;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  groupId,
  1033,
  iconFile.icons.map((item) => item.data)
);

/* ---- version info ---- */
const [mj, mn, pa] = version.split(".").map((x) => parseInt(x, 10) || 0);
const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const vi = viList[0] || ResEdit.Resource.VersionInfo.createEmpty();
vi.setFileVersion(mj, mn, pa, 0, 1033);
vi.setProductVersion(mj, mn, pa, 0, 1033);
vi.setStringValues(
  { lang: 1033, codepage: 1200 },
  {
    FileDescription: desc,
    ProductName: appName,
    OriginalFilename: origName,
    CompanyName: company,
    LegalCopyright: `${company} · MIT`,
    ProductVersion: version,
  }
);
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);
let patched = Buffer.from(exe.generate());
if (overlay.length > 0) {
  patched = Buffer.concat([patched, overlay]);
}
fs.writeFileSync(exePath, patched);

console.log(
  `[embed-icon] ${exePath.split(/[\\/]/).pop()}: icon group ${groupId} (${iconFile.icons.length} images) + version ${version} · overlay ${overlay.length > 0 ? `re-attached (${(overlay.length / 1024 ** 2).toFixed(1)} MB)` : "none"} · ${(patched.length / 1024 ** 2).toFixed(1)} MB`
);
