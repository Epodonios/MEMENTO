#!/usr/bin/env node
/**
 * Phase C2 cfg+binary test — the probe rewrite contract against REAL
 * generated configs and the REAL pinned cores: every rewritten probe
 * config must pass `xray run -test` / `sing-box check`.
 *
 * Golden rules asserted:
 *   - rewriteConfigForProbe (the COMPILED dist-electron module) leaves the
 *     outbound machinery untouched (fragment dialer, mux, reality) and
 *     ONLY replaces the socks inbound port + strips non-socks inbounds;
 *   - a stats-api inbound present pre-rewrite is dropped post-rewrite;
 *   - every rewritten config still passes the REAL binary acceptance;
 *   - generator defaults are untouched by C2 (D2 pins keep that job —
 *     here only the rewrite contract is proven).
 */
import fs from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(dirname(HERE), "electron-app");
const WORK = process.env.TC2_WORK || "/home/z/my-project/scripts/taskC2-cfg-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC2-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c2.cjs")}`], { cwd: HERE, stdio: "pipe" });
const {
  generateV2RayConfig, generateSingBoxConfig,
  DEFAULT_BUILDER_OPTIONS, FRAGMENT_DIALER_TAG,
} = await import(join(WORK, "c2.cjs"));

// the REAL COMPILED rewrite (quitclean-style electron seed)
const distDir = join(APP, "dist-electron");
const req = createRequire(join(distDir, "urlTest.js"));
const electronKey = req.resolve("electron");
const stubReq = createRequire(join(HERE, "taskC2-electron-stub.mts"));
const stubExports = stubReq(join(HERE, "taskC2-electron-stub.mts"));
req.cache[electronKey] = {
  id: electronKey, filename: electronKey, loaded: true, children: [], paths: [],
  exports: stubExports.default && stubExports.default.app ? stubExports : { ...stubExports, default: stubExports },
};
const { rewriteConfigForProbe } = req(join(distDir, "urlTest.js"));

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SINGBOX = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

const vmess = { id: "v", protocol: "vmess", name: "vm", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const vlessReality = { id: "vr", protocol: "vless", name: "vreal", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "reality", network: "tcp", publicKey: "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0", shortId: "0123456789abcdef", sni: "www.microsoft.com" };
const vlessFlow = { id: "vf", protocol: "vless", name: "vl", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp", flow: "xtls-rprx-vision" };
const vlessWs = { ...vmess, id: "vw", protocol: "vless", network: "ws", path: "/ws" };
const trojan = { id: "t", protocol: "trojan", name: "tr", isValid: true, address: "1.2.3.4", port: 443, password: "tr-pw", security: "tls", network: "tcp" };
const ss = { id: "s", protocol: "ss", name: "ss", isValid: true, address: "1.2.3.4", port: 443, method: "aes-256-gcm", password: "ss-pw" };
const socksCfg = { id: "k", protocol: "socks", name: "sk", isValid: true, address: "1.2.3.4", port: 1080 };
const hy2 = { id: "h", protocol: "hysteria2", name: "hy", isValid: true, address: "1.2.3.4", port: 443, password: "pw" };
const tuic = { id: "u", protocol: "tuic", name: "tu", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", password: "pw" };

const frag = () => ({ ...DEFAULT_BUILDER_OPTIONS, tlsFragment: true });
const muxOn = () => ({ ...DEFAULT_BUILDER_OPTIONS, muxEnabled: true });

const xrayTest = (json, label) => {
  const file = join(WORK, `${label}.json`);
  fs.writeFileSync(file, json, "utf8");
  const r = spawnSync(XRAY, ["run", "-test", "-c", file], { encoding: "utf8", timeout: 30000 });
  return ((r.stdout || "") + (r.stderr || "")).includes("Configuration OK") ? null : ((r.stdout || "") + (r.stderr || "")).slice(-160);
};
const sbCheck = (json, label) => {
  const file = join(WORK, `${label}.json`);
  fs.writeFileSync(file, json, "utf8");
  const r = spawnSync(SINGBOX, ["check", "-c", file], { encoding: "utf8", timeout: 30000 });
  return r.status === 0 ? null : ((r.stdout || "") + (r.stderr || "")).slice(-160);
};

/* ---------- 1) xray shapes: rewrite -> REAL xray -test ---------- */
{
  const cases = [
    ["vmess-tls-tcp", vmess, DEFAULT_BUILDER_OPTIONS],
    ["vless-reality", vlessReality, DEFAULT_BUILDER_OPTIONS],
    ["vless-vision", vlessFlow, DEFAULT_BUILDER_OPTIONS],
    ["vless-ws-tls", vlessWs, DEFAULT_BUILDER_OPTIONS],
    ["trojan-tls", trojan, DEFAULT_BUILDER_OPTIONS],
    ["ss", ss, DEFAULT_BUILDER_OPTIONS],
    ["socks-out", socksCfg, DEFAULT_BUILDER_OPTIONS],
    ["vmess-fragment", vmess, frag()],
    ["vless-mux", vlessFlow, muxOn()],
  ];
  for (const [label, cfg, opts] of cases) {
    // renderer contract: "socks-only" inbound mode for probes
    const gen = generateV2RayConfig(cfg, "socks-only", 10808, 10809, undefined, opts);
    check(`1 ${label}: generator produces a probe config`, !!gen?.json);
    if (!gen) continue;
    const r = rewriteConfigForProbe(gen.json, 40001);
    const parsed = JSON.parse(r.json);
    check(`1 ${label}: rewritten = exactly 1 socks inbound on the ephemeral port`,
      r.core === "xray" && parsed.inbounds.length === 1 && parsed.inbounds[0].port === 40001 && parsed.inbounds[0].protocol === "socks");
    const err = xrayTest(r.json, label);
    check(`1 ${label}: REAL xray run -test OK on the rewritten config`, err === null, err || "");
  }
}

/* ---------- 2) fragment dialer survives the rewrite ---------- */
{
  const gen = generateV2RayConfig(vmess, "socks-only", 10808, 10809, undefined, frag());
  const r = rewriteConfigForProbe(gen.json, 40002);
  const parsed = JSON.parse(r.json);
  check("2 fragment dialer outbound still present post-rewrite",
    parsed.outbounds.some(o => o.tag === FRAGMENT_DIALER_TAG));
  check("2 proxy sockopt.dialerProxy still points at the dialer",
    JSON.stringify(parsed.outbounds.find(o => o.tag === "proxy")?.streamSettings?.sockopt) === JSON.stringify({ dialerProxy: FRAGMENT_DIALER_TAG }));
  const err = xrayTest(r.json, "fragment-rewritten");
  check("2 REAL xray run -test OK on the rewritten fragment config", err === null, err || "");
}

/* ---------- 3) stats-api inbound: present pre-rewrite, dropped post ---------- */
{
  const gen = generateV2RayConfig(vmess, "socks-http", 10808, 10809, 10850, DEFAULT_BUILDER_OPTIONS);
  const pre = JSON.parse(gen.json);
  check("3 pre-rewrite: socks + http + api inbounds (3)", pre.inbounds.length === 3 && pre.inbounds.some(i => i.tag === "api"));
  const r = rewriteConfigForProbe(gen.json, 40003);
  const post = JSON.parse(r.json);
  check("3 post-rewrite: exactly the socks inbound, api+http dropped",
    post.inbounds.length === 1 && post.inbounds[0].protocol === "socks" && post.inbounds[0].port === 40003);
  const err = xrayTest(r.json, "statsapi-rewritten");
  check("3 REAL xray run -test OK without the api inbound", err === null, err || "");
}

/* ---------- 4) sing-box shapes: rewrite -> REAL sing-box check ---------- */
{
  for (const [label, cfg] of [["hysteria2", hy2], ["tuic", tuic]]) {
    const gen = generateSingBoxConfig(cfg, 10808, 10809, undefined, DEFAULT_BUILDER_OPTIONS);
    check(`4 ${label}: generator produces a probe config`, !!gen?.json);
    if (!gen) continue;
    const r = rewriteConfigForProbe(gen.json, 40004);
    const parsed = JSON.parse(r.json);
    check(`4 ${label}: rewritten = 1 socks inbound (listen_port), http dropped`,
      r.core === "sing-box" && parsed.inbounds.length === 1 && parsed.inbounds[0].listen_port === 40004 && !parsed.inbounds.some(i => i.type === "http"));
    const err = sbCheck(r.json, `sb-${label}`);
    check(`4 ${label}: REAL sing-box check OK on the rewritten config`, err === null, err || "");
  }
}

/* ---------- 5) no clash_api on probe configs ---------- */
{
  const gen = generateSingBoxConfig(hy2, 10808, 10809, 10850, DEFAULT_BUILDER_OPTIONS);
  check("5 pre-rewrite: clash_api present when statsApiPort given (connect flow)",
    JSON.parse(gen.json).experimental?.clash_api?.external_controller === "127.0.0.1:10850");
  const probe = generateSingBoxConfig(hy2, 10808, 10809, undefined, DEFAULT_BUILDER_OPTIONS);
  check("5 probe contract: renderer passes statsApiPort=undefined -> no clash_api",
    !JSON.parse(probe.json).experimental);
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
