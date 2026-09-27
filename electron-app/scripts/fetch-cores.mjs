#!/usr/bin/env node
/**
 * fetch-cores.mjs — download the REAL pinned proxy cores into resources/.
 *
 * The 3.1.5 build shipped resources/ with README stubs only (the win-unpacked
 * resources dir was 668 KB), so the packaged app had NO cores at all. This
 * script materializes the exact versions pinned in electron/core-versions.json:
 *
 *   xray      v25.1.1  https://github.com/XTLS/Xray-core/releases/download/v25.1.1/Xray-windows-64.zip
 *                      -> resources/xray/xray.exe (+ geoip.dat / geosite.dat at resources/)
 *   sing-box  1.14.0   https://github.com/SagerNet/sing-box/releases/download/v1.14.0/sing-box-1.14.0-windows-amd64.zip
 *                      -> resources/sing-box/sing-box.exe
 *   aether    1.9.0    https://github.com/CluvexStudio/Aether/releases/download/v1.9.0/aether-windows-x86_64.zip
 *                      -> resources/aether/aether.exe   (sha256-verified against
 *                         electron/aether-versions.json BEFORE it is accepted)
 *
 * Every artifact is size-floored, MZ-header checked, and the Aether zip must
 * match the pinned zip sha256. Idempotent: existing verified files are kept.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RES = path.join(ROOT, "resources");
const versions = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "core-versions.json"), "utf8"));
const aetherPins = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "aether-versions.json"), "utf8"));

const MIN_SIZES = { "xray.exe": 5 * 1024 * 1024, "sing-box.exe": 5 * 1024 * 1024, "aether.exe": 1 * 1024 * 1024, "geoip.dat": 1024 * 1024, "geosite.dat": 512 * 1024 };

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function assertPe(buf, name) {
  if (buf.length < 64 || buf[0] !== 0x4d || buf[1] !== 0x5a) throw new Error(`${name}: not a PE binary (missing MZ header)`);
}

async function download(url, { timeoutMs = 600_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new Error(`download too small (${buf.length} B): ${url}`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

function saveBin(dest, buf, name) {
  const min = MIN_SIZES[name] || 1024;
  if (buf.length < min) throw new Error(`${name}: ${buf.length} B is below the size floor ${min} B`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log(`  ✓ ${path.relative(ROOT, dest)} — ${(buf.length / 1024 ** 2).toFixed(1)} MB (sha256 ${sha256(buf).slice(0, 16)}…)`); // eslint-disable-line no-console
}

async function fetchXray() {
  const v = versions["xray"]; // v25.1.1
  const dest = path.join(RES, "xray", "xray.exe");
  if (fs.existsSync(dest) && fs.statSync(dest).size >= MIN_SIZES["xray.exe"]) {
    console.log(`= xray ${v} already present — skipping`); // eslint-disable-line no-console
    return;
  }
  console.log(`↓ xray ${v}`); // eslint-disable-line no-console
  const zip = new AdmZip(await download(`https://github.com/XTLS/Xray-core/releases/download/${v}/Xray-windows-64.zip`));
  let sawXray = false;
  for (const e of zip.getEntries()) {
    const base = path.basename(e.entryName);
    if (base === "xray.exe") {
      assertPe(e.getData(), "xray.exe");
      saveBin(dest, e.getData(), "xray.exe");
      sawXray = true;
    } else if (base === "geoip.dat" || base === "geosite.dat") {
      saveBin(path.join(RES, base), e.getData(), base);
    }
  }
  if (!sawXray) throw new Error("xray.exe not found inside the Xray asset");
}

async function fetchSingBox() {
  const v = versions["sing-box"]; // 1.14.0
  const dest = path.join(RES, "sing-box", "sing-box.exe");
  if (fs.existsSync(dest) && fs.statSync(dest).size >= MIN_SIZES["sing-box.exe"]) {
    console.log(`= sing-box ${v} already present — skipping`); // eslint-disable-line no-console
    return;
  }
  console.log(`↓ sing-box ${v}`); // eslint-disable-line no-console
  const zip = new AdmZip(await download(`https://github.com/SagerNet/sing-box/releases/download/v${v}/sing-box-${v}-windows-amd64.zip`));
  const entry = zip.getEntries().find((e) => path.basename(e.entryName) === "sing-box.exe");
  if (!entry) throw new Error("sing-box.exe not found inside the asset");
  assertPe(entry.getData(), "sing-box.exe");
  saveBin(dest, entry.getData(), "sing-box.exe");
}

async function fetchAether() {
  const pin = aetherPins.versions?.find((x) => x.version === versions["aether"]);
  if (!pin?.url?.win32 || !pin?.zipSha256?.win32) throw new Error("no pinned aether win32 URL/sha256 in aether-versions.json");
  const dest = path.join(RES, "aether", "aether.exe");
  if (fs.existsSync(dest) && fs.statSync(dest).size >= MIN_SIZES["aether.exe"]) {
    console.log(`= aether ${pin.version} already present — skipping`); // eslint-disable-line no-console
    return;
  }
  console.log(`↓ aether ${pin.version} (sha256-pinned)`); // eslint-disable-line no-console
  const zipBuf = await download(pin.url.win32);
  if (sha256(zipBuf) !== pin.zipSha256.win32) {
    throw new Error(`aether zip sha256 mismatch: got ${sha256(zipBuf)}, pinned ${pin.zipSha256.win32}`);
  }
  const zip = new AdmZip(zipBuf);
  const entry = zip.getEntries().find((e) => path.basename(e.entryName).toLowerCase() === "aether.exe");
  if (!entry) throw new Error("aether.exe not found inside the pinned asset");
  assertPe(entry.getData(), "aether.exe");
  saveBin(dest, entry.getData(), "aether.exe");
}

const steps = [
  ["xray", fetchXray],
  ["sing-box", fetchSingBox],
  ["aether", fetchAether],
];

let failed = [];
for (const [name, fn] of steps) {
  try {
    await fn();
  } catch (e) {
    failed.push(name);
    console.error(`✗ ${name}: ${e?.message || e}`); // eslint-disable-line no-console
  }
}
if (failed.length) {
  console.error(`fetch-cores FAILED for: ${failed.join(", ")}`); // eslint-disable-line no-console
  process.exit(1);
}
console.log("fetch-cores: all pinned cores present ✓"); // eslint-disable-line no-console
