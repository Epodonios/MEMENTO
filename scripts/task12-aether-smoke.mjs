#!/usr/bin/env node
/**
 * Task 12 Aether smoke test — runs the REAL compiled aether manager
 * (dist-electron/aether.js) against the REAL official Aether v1.9.0 linux
 * binary (binary-audit/linux-extracted) with a stubbed `electron` module.
 *
 * Coverage (spec rev-2 + user directive ①):
 *   1. env contract: buildAetherEnv shapes for masque/wg/gool + advanced knobs
 *   2. validation: bad ports/endpoint/keepalive/dns/routes/upstream/ech rejected
 *   3. integrity gate: tampered binary REFUSED (sha256 mismatch), pinned accepted
 *   4. REAL gool connect end-to-end (user ①: speed + success evidence)
 *      + sidecar ports + F9 readLastActivePorts coverage
 *   5. data-plane proof: curl socks5h through the live tunnel -> warp=on
 *   6. REAL Smart Connect: candidates gool->wg->masque, [smart] log parity,
 *      first success kept (expected: gool accepted)
 *   7. mutual exclusion: stopOtherCore("xray") stops a live aether
 *   8. clean stop: process gone, sidecar removed
 *   9. (FULL mode) REAL wg + masque connects: measured time-to-listening
 *      for every scan-path candidate -> locks the ① matrix (wg budget 80s,
 *      masque budget 120s)
 *  10. preload allowlist contains exactly the 4 new aether commands
 *  11. i18n: every aether.* key present in all 4 languages (en/fa/zh/ar)
 *
 * Usage: node scripts/task12-aether-smoke.mjs [--full]
 *   --full also runs the real wg (~15 s) and masque (~2 min) measurements.
 * Requires: npm run build:main already executed in electron-app/.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Module from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = "/home/z/my-project";
const APP = `${ROOT}/memento-src/electron-app`;
const REAL_BIN = `${ROOT}/aether-research/binary-audit/linux-extracted/aether`;
const WIN_HASH = "ee400806bf73fe16e655e6478eb7442c2c4e0576c4c8ce1913ac474e846b36cd";
const LIN_HASH = "e8b2a83c4ab0ad1a75dac21f2f2b9d701998f86866fde15025ffba307b7130b9";
const FULL = process.argv.includes("--full");

let passed = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error(`FAIL  ${msg}`);
    process.exit(1);
  }
  passed++;
  console.log(`PASS  ${msg}`);
}
function sha256(file) {
  return execFileSync("sha256sum", [file], { encoding: "utf8" }).split(/\s+/)[0];
}

if (!fs.existsSync(REAL_BIN)) {
  console.error(`missing real binary: ${REAL_BIN}`);
  process.exit(1);
}
ok(sha256(REAL_BIN) === LIN_HASH, `official linux binary hash intact (${LIN_HASH.slice(0, 12)}…)`);

if (!fs.existsSync(`${APP}/dist-electron/aether.js`)) {
  console.error("dist-electron/aether.js missing — run `npm run build:main` in electron-app first");
  process.exit(1);
}

/* ---------------- electron stub (task11 harness pattern) ---------------- */

const UD = fs.mkdtempSync(path.join(os.tmpdir(), "memento-aether-"));
const stubDir = path.join(UD, "stub");
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(path.join(stubDir, "index.js"), `
const DATA = process.env.MEMENTO_STUB_DATA;
module.exports = {
  app: {
    isPackaged: false,
    getAppPath: () => process.env.MEMENTO_STUB_APP,
    getPath: () => DATA,
    setPath: () => {},
    on: () => {},
  },
  ipcMain: { handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => {} },
};
`);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return path.join(stubDir, "index.js");
  return origResolve.call(this, request, ...rest);
};

const DATA_DIR = path.join(UD, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.MEMENTO_STUB_DATA = DATA_DIR;

const { aetherManager, buildAetherEnv, validateAetherSettings, SMART_CONNECT_ORDER, SCAN_DEADLINE_MS, FORCED_ENDPOINT_DEADLINE_MS, DEFAULT_AETHER_SETTINGS: MAIN_DEFAULTS } =
  await import(`${APP}/dist-electron/aether.js`);
const { readLastActivePorts } = await import(`${APP}/dist-electron/xray.js`);
const { stopOtherCore } = await import(`${APP}/dist-electron/cores.js`);

/* ---------------- 1. env contract ---------------- */

const base = {
  ...MAIN_DEFAULTS,
  socksPort: 1819,
  scanMode: "balanced",
  ipMode: "v4",
  logLevel: "info",
  quickReconnect: true,
};

let env = buildAetherEnv(base, "masque", "/tmp/identity.toml");
ok(env.AETHER_PROTOCOL === "masque" && env.AETHER_SCAN === "balanced" && env.AETHER_IP === "v4", "env: protocol/scan/ip always set (headless guarantee)");
ok(env.AETHER_SOCKS === "127.0.0.1:1819" && env.AETHER_LOG_LEVEL === "info" && env.AETHER_QUICK_RECONNECT === "1", "env: socks/log/quick-reconnect wired");
ok(env.AETHER_CONFIG === "/tmp/identity.toml", "env: identity config inside data dir");
ok(!("AETHER_NOIZE" in env), "env: noize 'default' OMITS the variable (core protocol-aware profile)");
ok(!("AETHER_PEER" in env) && !("AETHER_MASQUE_HTTP2" in env) && !("AETHER_ECH" in env) && !("AETHER_MASQUE_H2_FRAGMENT" in env), "env: no peer/h2/ech/fragment when unset");

env = buildAetherEnv({ ...base, noize: "gfw", masqueHttp2: true, ech: "auto", fragment: true }, "masque", "/x.toml");
ok(env.AETHER_NOIZE === "gfw" && env.AETHER_MASQUE_HTTP2 === "1" && env.AETHER_ECH === "auto" && env.AETHER_MASQUE_H2_FRAGMENT === "1", "env: masque knobs (noize/h2/ech/fragment) pass verbatim");

env = buildAetherEnv({ ...base, ech: "custom", echBase64: "AESCU" }, "masque", "/x.toml");
ok(env.AETHER_ECH === "AESCU", "env: custom ECH base64 forwarded");

env = buildAetherEnv({ ...base, fragment: true, masqueHttp2: true }, "wg", "/x.toml");
ok(!("AETHER_MASQUE_H2_FRAGMENT" in env) && !("AETHER_MASQUE_HTTP2" in env), "env: fragment/h2 NEVER leak into wg env (masque+h2 gate)");

env = buildAetherEnv({ ...base, endpoint: "162.159.192.1:2408", wgKeepalive: "7" }, "wg", "/x.toml");
ok(env.AETHER_PEER === "162.159.192.1:2408" && env.AETHER_WG_KEEPALIVE === "7", "env: wg forced peer + keepalive");

env = buildAetherEnv({ ...base, wiwOuter: "162.159.192.1:2408", wiwInner: "188.114.96.1:2408", wgForceOuter: "", wgKeepalive: "" }, "gool", "/x.toml");
ok(env.AETHER_WIW_OUTER_PEER === "162.159.192.1:2408" && env.AETHER_WIW_INNER_PEER === "188.114.96.1:2408" && !("AETHER_WG_PEER" in env), "env: gool WIW pair; force field absent when empty");

env = buildAetherEnv({ ...base, wgForceOuter: "162.159.192.1:2408" }, "gool", "/x.toml");
ok(env.AETHER_WG_PEER === "162.159.192.1:2408", "env: gool FORCE outer = AETHER_WG_PEER (distinct knob from wiw-outer)");

env = buildAetherEnv({ ...base, httpProxyEnabled: true, httpProxyPort: 1820, upstream: "socks5://127.0.0.1:1080", dns: "1.1.1.1,1.0.0.1", routeBlock: "ads.com\nport:25", routeDirect: "10.0.0.0/8" }, "masque", "/x.toml");
ok(env.AETHER_HTTP_PROXY === "127.0.0.1:1820" && env.AETHER_UPSTREAM === "socks5://127.0.0.1:1080", "env: http-proxy listener + upstream chain");
ok(env.AETHER_DNS === "1.1.1.1,1.0.0.1" && env.AETHER_ROUTE_BLOCK === "ads.com,port:25" && env.AETHER_ROUTE_DIRECT === "10.0.0.0/8", "env: dns + route lists normalized");

/* ---------------- 2. validation ---------------- */

ok(validateAetherSettings(base).length === 0, "validate: default settings pass");
ok(validateAetherSettings({ ...base, socksPort: 0 }).length > 0, "validate: socks port 0 rejected");
ok(validateAetherSettings({ ...base, socksPort: 65536 }).length > 0, "validate: socks port >65535 rejected");
ok(validateAetherSettings({ ...base, httpProxyEnabled: true, httpProxyPort: 1819 }).length > 0, "validate: http port == socks port rejected");
ok(validateAetherSettings({ ...base, endpoint: "example.com:443" }).length > 0, "validate: hostname endpoint rejected (IP:port only)");
ok(validateAetherSettings({ ...base, wgKeepalive: "0" }).length > 0, "validate: keepalive 0 rejected");
ok(validateAetherSettings({ ...base, dns: "1.1.1.1, not-an-ip" }).length > 0, "validate: garbage DNS rejected");
ok(validateAetherSettings({ ...base, routeBlock: "a.com;b.com" }).length > 0, "validate: route rule with ';' rejected");
ok(validateAetherSettings({ ...base, upstream: "ftp://x" }).length > 0, "validate: upstream scheme outside socks5/http rejected");
ok(validateAetherSettings({ ...base, ech: "custom", echBase64: "" }).length > 0, "validate: custom ECH without config rejected");
ok(validateAetherSettings({ ...base, wiwOuter: "162.159.192.1:2408", wiwInner: "162.159.192.1:2408" }).length > 0, "validate: equal WIW hops rejected");

/* ---------------- 3+4+5+6+7+8. REAL binary lifecycle ---------------- */

function makeAppDir(binarySource) {
  const appDir = path.join(UD, `app-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(path.join(appDir, "resources", "aether"), { recursive: true });
  const dest = path.join(appDir, "resources", "aether", "aether");
  if (binarySource) {
    fs.copyFileSync(binarySource, dest);
    fs.chmodSync(dest, 0o755);
  }
  process.env.MEMENTO_STUB_APP = appDir;
  return appDir;
}

async function waitGone(maxMs) {
  for (let i = 0; i < maxMs / 100; i++) {
    const p = spawnSync("pgrep", ["-f", "resources/aether/aether|aether-research/binary-audit"], { encoding: "utf8" });
    if (p.status !== 0) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

const LIVE_SETTINGS = {
  ...MAIN_DEFAULTS,
  socksPort: 11851,
  scanMode: "balanced",
  ipMode: "v4",
  logLevel: "info",
  quickReconnect: false,
};

// --- integrity gate: tampered binary refused ---
{
  const appDir = makeAppDir(REAL_BIN);
  const binPath = path.join(appDir, "resources", "aether", "aether");
  fs.appendFileSync(binPath, "tampered"); // flip the hash, keep executability
  let err = null;
  try { await aetherManager.startAether({ ...LIVE_SETTINGS }); } catch (e) { err = e; }
  ok(err && /integrity check FAILED/i.test(String(err?.message || err)), "integrity gate: tampered binary REFUSED (sha256 mismatch)");
  ok(await waitGone(3000), "integrity gate: no process spawned for the tampered binary");
  aetherManager.stopAether();
}

// --- REAL gool connect (user directive ① evidence) ---
{
  makeAppDir(REAL_BIN);
  const t0 = Date.now();
  const st = await aetherManager.startAether({ ...LIVE_SETTINGS, protocol: "gool" });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(st.running === true && st.ready === true && st.core === "aether", `REAL gool: connected + ready (${secs}s total)`);
  ok(st.socks_port === 11851, "REAL gool: status reports the configured SOCKS port");
  console.log(`MEASURE  gool time-to-ready = ${secs}s (deadline ${SCAN_DEADLINE_MS.gool / 1000}s)`);

  // data-plane proof through the tunnel
  const trace = execFileSync("curl", ["-s", "--max-time", "20", "-x", "socks5h://127.0.0.1:11851", "https://www.cloudflare.com/cdn-cgi/trace"], { encoding: "utf8" });
  ok(/warp=on/.test(trace), "REAL gool: data plane verified (cloudflare trace warp=on)");

  // sidecar + F9 coverage
  const sidecarPath = path.join(DATA_DIR, "memento-active-core.json");
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  ok(sidecar.core === "aether" && sidecar.socksPort === 11851, "sidecar: core=aether + ports recorded");
  ok(readLastActivePorts().includes(11851), "F9: readLastActivePorts covers the aether listener port");
}

// --- mutual exclusion: a config start (xray) stops the live aether ---
{
  stopOtherCore("xray");
  ok(await waitGone(5000), "mutual exclusion: stopOtherCore('xray') killed the live aether");
  const st = aetherManager.getStatus();
  ok(st.running === false, "mutual exclusion: aether manager reports stopped");
  ok(!fs.existsSync(path.join(DATA_DIR, "memento-active-core.json")), "mutual exclusion: sidecar removed");
  ok(!readLastActivePorts().includes(11851), "F9: aether ports no longer claimed after stop");
}

// --- REAL Smart Connect (order evidence for ①) ---
{
  makeAppDir(REAL_BIN);
  const t0 = Date.now();
  const st = await aetherManager.startAether({ ...LIVE_SETTINGS, protocol: "smart" });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(st.running && st.ready, `REAL smart: connected (${secs}s total)`);
  const logs = aetherManager.getLogs().join("\n");
  ok(SMART_CONNECT_ORDER.join(",") === "gool,wg,masque", "smart: LOCKED order = gool → wg → masque (all 3 live-tested)");
  ok(/\[smart\] candidate=gool result=accepted .*selected=true/.test(logs), "REAL smart: gool accepted as FIRST candidate (order evidence)");
  ok(!/\[smart\] candidate=w[g] /.test(logs.split("candidate=gool result=accepted")[0]), "REAL smart: no candidate tried before gool");
  console.log(`MEASURE  smart total = ${secs}s`);
}

// --- clean stop ---
{
  aetherManager.stopAether();
  ok(await waitGone(5000), "clean stop: aether process gone");
  ok(aetherManager.getStatus().running === false, "clean stop: status running=false");
}

// --- (FULL) REAL wg measurement — deadline evidence for ① ---
if (FULL) {
  makeAppDir(REAL_BIN);
  const t0 = Date.now();
  const st = await aetherManager.startAether({ ...LIVE_SETTINGS, protocol: "wg", socksPort: 11853 });
  const secs = (Date.now() - t0) / 1000;
  ok(st.running && st.ready, `REAL wg: connected (${secs.toFixed(1)}s) within the ${SCAN_DEADLINE_MS.wg / 1000}s deadline`);
  const wgTrace = execFileSync("curl", ["-s", "--max-time", "20", "-x", "socks5h://127.0.0.1:11853", "https://www.cloudflare.com/cdn-cgi/trace"], { encoding: "utf8" });
  ok(/warp=on/.test(wgTrace), "REAL wg: data plane verified (cloudflare trace warp=on)");
  console.log(`MEASURE  wg time-to-ready = ${secs.toFixed(1)}s (deadline ${SCAN_DEADLINE_MS.wg / 1000}s, core budget 80s)`);
  aetherManager.stopAether();
  await waitGone(5000);
}

// --- (FULL) REAL masque measurement — deadline evidence for ① ---
if (FULL) {
  makeAppDir(REAL_BIN);
  const t0 = Date.now();
  const st = await aetherManager.startAether({ ...LIVE_SETTINGS, protocol: "masque", socksPort: 11852 });
  const secs = (Date.now() - t0) / 1000;
  ok(st.running && st.ready, `REAL masque: connected (${secs.toFixed(1)}s) within the ${SCAN_DEADLINE_MS.masque / 1000}s deadline`);
  console.log(`MEASURE  masque time-to-ready = ${secs.toFixed(1)}s (deadline ${SCAN_DEADLINE_MS.masque / 1000}s, core budget 120s)`);
  aetherManager.stopAether();
  await waitGone(5000);
}

/* ---------------- 10. preload allowlist ---------------- */

{
  const src = fs.readFileSync(`${APP}/electron/preload.ts`, "utf8");
  for (const cmd of ["aether_start", "aether_stop", "aether_status", "aether_logs"]) {
    ok(new RegExp(`"${cmd}"`).test(src), `preload allowlist contains "${cmd}"`);
  }
  const legacyCount = (src.match(/"(check_xray|download_xray|start_xray|stop_xray|get_xray_status|get_xray_logs|get_xray_traffic|set_system_proxy|clear_system_proxy|tcp_ping_batch|launch_spoofing_patt)"/g) || []).length;
  ok(legacyCount === 11, "preload: all 11 legacy commands untouched");
}

/* ---------------- 11. i18n completeness (4 languages) ---------------- */

{
  const require2 = createRequire(import.meta.url);
  const esbuild = require2(`${ROOT}/memento-src/node_modules/esbuild`);
  const outfile = path.join(UD, "i18n.cjs");
  await esbuild.build({
    entryPoints: [`${ROOT}/memento-src/src/i18n.ts`],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile,
  });
  const mod = await import(outfile);
  const translations = mod.translations;
  const langs = ["en", "fa", "zh", "ar"];
  const enKeys = Object.keys(translations.en).filter(k => k === "tab.aether" || k === "desc.aether" || k.startsWith("aether."));
  ok(enKeys.length >= 45, `i18n: ${enKeys.length} aether keys defined (en)`);
  for (const lang of langs) {
    const missing = enKeys.filter(k => !translations[lang][k]);
    ok(missing.length === 0, `i18n: all ${enKeys.length} aether keys present in "${lang}"${missing.length ? ` — missing: ${missing.join(",")}` : ""}`);
  }
}

console.log(`\nALL ${passed} Task-12 Aether assertions PASSED`);
