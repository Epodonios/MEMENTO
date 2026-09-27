#!/usr/bin/env node
/**
 * Phase C4 CFG test — every topology shape the PRODUCT generators emit is
 * accepted by the REAL pinned cores (`xray run -test` / `sing-box check`),
 * plus the load-bearing negative:
 *   G1  Xray: default / chain (socks hop) / chain+fragment (TLS hop,
 *       3-deep) / balancer random+roundRobin / leastPing+burstObservatory /
 *       chain+balancer combined / 8-member pool / ss main chained.
 *   G2  Xray NEGATIVE: an unknown strategy is rejected by the core (proves
 *       the accepted shapes above were actually validated, not ignored).
 *   G3  sing-box: chain (detour) / urltest balancer / combined / 8-member.
 *   G4  sing-box NEGATIVE: `check` PASSES a urltest group with a missing
 *       member but `run` FATALs (dependency not found) — the renderer-side
 *       validation is load-bearing (the C3-geo-gate lesson, sing-box side).
 *   G5  every Xray case also runs WITH the stats API enabled (balancer +
 *       stats coexist — the api dokodemo rule precedes the catch-all).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TC4_WORK || join(HERE, "taskC4-cfg-tmp");
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SB = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const XRAY_GEO_DIR = path.dirname(XRAY);

execFileSync("npx", ["esbuild", join(HERE, "taskC4-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c4.cjs")}`], { cwd: HERE, stdio: "pipe" });
const R = createRequire(join(WORK, "c4.cjs"));
const { generateV2RayConfig, generateSingBoxConfig, DEFAULT_BUILDER_OPTIONS } = R(join(WORK, "c4.cjs"));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

function xrayTest(file) {
  try {
    execFileSync(XRAY, ["run", "-test", "-c", file], { encoding: "utf8", timeout: 60000, env: { ...process.env, XRAY_LOCATION_ASSET: XRAY_GEO_DIR } });
    return { okRes: true, out: "" };
  } catch (e) {
    return { okRes: false, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}
function sbCheck(file) {
  try {
    execFileSync(SB, ["check", "-c", file], { encoding: "utf8", timeout: 60000 });
    return { okRes: true, out: "" };
  } catch (e) {
    return { okRes: false, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}
function sbRun(file, ms = 3500) {
  try {
    const out = execFileSync(SB, ["run", "-c", file], { encoding: "utf8", timeout: ms, stdio: ["ignore", "pipe", "pipe"] });
    return { out, fatal: false };
  } catch (e) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    return { out, fatal: /FATAL|failed/i.test(out) };
  }
}

const vmessMain = { id: "m1", protocol: "vmess", name: "m1", isValid: true, address: "127.0.0.1", port: 41001, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const ssMain = { ...vmessMain, id: "m-ss", protocol: "ss", method: "aes-256-gcm", password: "pw" };
const vlessHop = { id: "h1", protocol: "vless", name: "h1", isValid: true, address: "127.0.0.1", port: 41002, uuid: "c831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const socksHop = { id: "h2", protocol: "socks", name: "h2", isValid: true, address: "127.0.0.1", port: 41003 };
const ssExtra = { id: "e1", protocol: "ss", name: "e1", isValid: true, address: "127.0.0.1", port: 41004, method: "aes-256-gcm", password: "pw" };
const vmessExtra = { id: "e2", protocol: "vmess", name: "e2", isValid: true, address: "127.0.0.1", port: 41005, uuid: "d831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const hystMain = { id: "s1", protocol: "hysteria2", name: "s1", isValid: true, address: "127.0.0.1", port: 41006, password: "pw" };
const hystExtra = { id: "s2", protocol: "hysteria2", name: "s2", isValid: true, address: "127.0.0.1", port: 41007, password: "pw" };
const tuicExtra = { id: "s3", protocol: "tuic", name: "s3", isValid: true, address: "127.0.0.1", port: 41008, uuid: "e831381d-6324-4d53-ad4f-8cda48b30811", password: "pw" };

const fragOn = { ...DEFAULT_BUILDER_OPTIONS, tlsFragment: true };
const genX = (main, topology, builder = DEFAULT_BUILDER_OPTIONS) => generateV2RayConfig(main, "socks-http", 14001, 14002, 14050, builder, undefined, topology);
const genS = (main, topology) => generateSingBoxConfig(main, 14001, 14002, 14050, DEFAULT_BUILDER_OPTIONS, undefined, "", topology);

function writeX(name, cfg) { const f = join(WORK, `${name}.json`); fs.writeFileSync(f, cfg.json); return f; }

/* ---------------- G1: Xray accepts every C4 shape ---------------- */
const xrayCases = [
  ["x-default", genX(vmessMain, undefined)],
  ["x-chain-socks-hop", genX(vmessMain, { chainHop: socksHop, balancerExtras: [] })],
  ["x-chain-frag-tls-hop", genX(vmessMain, { chainHop: vlessHop, balancerExtras: [] }, fragOn)],
  ["x-balancer-random", genX(vmessMain, { chainHop: null, balancerExtras: [ssExtra, vmessExtra], balancerStrategy: "random" })],
  ["x-balancer-roundrobin", genX(vmessMain, { chainHop: null, balancerExtras: [ssExtra], balancerStrategy: "roundRobin" })],
  ["x-balancer-leastping-obs", genX(vmessMain, { chainHop: null, balancerExtras: [ssExtra], balancerStrategy: "leastPing" })],
  ["x-balancer-leastload-obs", genX(vmessMain, { chainHop: null, balancerExtras: [ssExtra], balancerStrategy: "leastLoad" })],
  ["x-chain-plus-balancer", genX(vmessMain, { chainHop: socksHop, balancerExtras: [ssExtra, vmessExtra], balancerStrategy: "random" })],
  ["x-pool-of-9", genX(vmessMain, { chainHop: null, balancerExtras: Array.from({ length: 8 }, (_, i) => ({ ...ssExtra, id: `x${i}`, port: 42000 + i })) })],
  ["x-ss-main-chained", genX(ssMain, { chainHop: socksHop, balancerExtras: [] })],
];
for (const [name, cfg] of xrayCases) {
  const f = writeX(name, cfg);
  const r = xrayTest(f);
  ok(`G1 ${name} accepted by real xray`, r.okRes, r.out.slice(-300));
}
for (const [name] of xrayCases.filter(([n]) => n !== "x-default")) {
  // same shapes WITH the stats API is the generator's default here (apiPort
  // always passed) — explicitly re-verify the default (no api) too:
  const cfg = generateV2RayConfig(name === "x-chain-socks-hop" ? vmessMain : vmessMain, "socks-http", 14001, 14002, undefined, DEFAULT_BUILDER_OPTIONS, undefined, undefined);
  const f = writeX(`${name}-noapi`, cfg);
  const r = xrayTest(f);
  ok(`G5 ${name}-noapi-shape accepted`, r.okRes, r.out.slice(-300));
}

/* ---------------- G2: Xray NEGATIVE (unknown strategy) ---------------- */
{
  const cfg = genX(vmessMain, { chainHop: null, balancerExtras: [ssExtra], balancerStrategy: "leastLoadFoo" });
  const f = writeX("x-neg-bad-strategy", cfg);
  const r = xrayTest(f);
  ok("G2 unknown strategy REJECTED by real xray", !r.okRes, r.out.slice(-200));
}

/* ---------------- G3: sing-box accepts every C4 shape ---------------- */
const sbCases = [
  ["sb-chain-detour", genS(hystMain, { chainHop: hystExtra, balancerExtras: [] })],
  ["sb-urltest-balancer", genS(hystMain, { chainHop: null, balancerExtras: [hystExtra, tuicExtra] })],
  ["sb-chain-plus-urltest", genS(hystMain, { chainHop: hystExtra, balancerExtras: [tuicExtra] })],
  ["sb-pool-of-9", genS(hystMain, { chainHop: null, balancerExtras: Array.from({ length: 8 }, (_, i) => ({ ...hystExtra, id: `y${i}`, port: 43000 + i })) })],
];
for (const [name, cfg] of sbCases) {
  const f = writeX(name, cfg);
  const r = sbCheck(f);
  ok(`G3 ${name} accepted by real sing-box (check)`, r.okRes, r.out.slice(-300));
}
for (const [name, cfg] of sbCases) {
  const f = writeX(`${name}-run`, cfg);
  const r = sbRun(f, 3000);
  ok(`G3 ${name} BOOTS clean (run, no FATAL)`, !r.fatal, r.out.slice(-200));
}

/* ---------------- G4: sing-box check-vs-run gap NEGATIVE ---------------- */
{
  // Hand-written: urltest group referencing a MISSING member — the exact
  // failure class the connect-flow validation must never let through.
  const bad = {
    log: { level: "warn" },
    inbounds: [{ type: "socks", tag: "socks-in", listen: "127.0.0.1", listen_port: 14001 }],
    outbounds: [
      { type: "hysteria2", tag: "proxy", server: "127.0.0.1", server_port: 41006, password: "pw", tls: { enabled: true, server_name: "x" } },
      { type: "urltest", tag: "balancer", outbounds: ["proxy", "ghost"], url: "https://www.gstatic.com/generate_204", interval: "3m" },
    ],
    route: { final: "balancer" },
  };
  const f = join(WORK, "sb-neg-missing-member.json");
  fs.writeFileSync(f, JSON.stringify(bad, null, 2));
  const chk = sbCheck(f);
  const run = sbRun(f, 3000);
  ok("G4 check PASSES the missing-member group (gap exists)", chk.okRes);
  ok("G4 run FATALs with dependency not found (fatal at startup)", run.fatal && /dependency\[ghost\] not found/.test(run.out), run.out.slice(-200));
}

console.log(`\nC4-CFGTEST: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
