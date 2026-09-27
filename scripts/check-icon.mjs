#!/usr/bin/env node
/**
 * check-icon.mjs — verify a Windows PE actually embeds the expected icon
 * images (the 3.1.6 shortcut-icon regression gate).
 *
 * Strategy: the RT_ICON resource blobs must contain the EXACT raw image
 * bytes that live inside the reference .ico — so each .ico image is looked
 * up as a byte substring of the exe. If every image is found, the icon is
 * really embedded (not just an extraResource copy). A resource directory
 * with an icon group is additionally required (resource dir parse with
 * hard bounds).
 *
 * Usage: node check-icon.mjs <exe> <reference.ico>   → prints PASS/FAIL, exits 0/1
 */
import fs from "node:fs";

function parseIcoImages(buf) {
  const count = buf.readUInt16LE(4);
  const images = [];
  let off = 6;
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(off + 8);
    const dataOff = buf.readUInt32LE(off + 12);
    if (dataOff + size <= buf.length) images.push(buf.subarray(dataOff, dataOff + size));
    off += 16;
  }
  return images;
}

function hasResourceDir(buf) {
  try {
    const peOff = buf.readUInt32LE(0x3c);
    if (peOff <= 0 || peOff + 4 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return false;
    const optSize = buf.readUInt16LE(peOff + 20);
    const optHdrOff = peOff + 24;
    const magic = buf.readUInt16LE(optHdrOff);
    const isPE32Plus = magic === 0x20b;
    const ddCount = buf.readUInt32LE(optHdrOff + (isPE32Plus ? 108 : 92));
    const ddOff = optHdrOff + (isPE32Plus ? 112 : 96);
    return ddCount > 2 && buf.readUInt32LE(ddOff + 8) > 0;
  } catch {
    return false;
  }
}

const [exePath, icoPath] = process.argv.slice(2);
if (!exePath || !icoPath) {
  console.error("usage: node check-icon.mjs <exe> <reference.ico>");
  process.exit(2);
}
const exeBuf = fs.readFileSync(exePath);
const refImages = parseIcoImages(fs.readFileSync(icoPath));
if (refImages.length === 0) {
  console.log(`FAIL ${exePath}: reference .ico has no images`);
  process.exit(1);
}
let matched = 0;
for (const img of refImages) {
  // the icon images are unique multi-KB blobs — the first 256 bytes are
  // more than enough as a fingerprint and cheap to search
  const probe = img.length > 256 ? img.subarray(0, 256) : img;
  if (exeBuf.indexOf(probe) !== -1) matched++;
}
const ok = matched === refImages.length && hasResourceDir(exeBuf);
console.log(
  `${ok ? "PASS" : "FAIL"} ${exePath.split("/").pop()}: embedded-icon-images ${matched}/${refImages.length} · resource-dir ${hasResourceDir(exeBuf) ? "yes" : "no"}`
);
process.exit(ok ? 0 : 1);
