#!/usr/bin/env node
/**
 * Phase D2 cfg+binary test — REAL generateV2RayConfig / generateSingBoxConfig
 * with the new BuilderOptions, verified by shape assertions AND the REAL
 * pinned cores: `xray run -test` (v25.1.1) + `sing-box check` (1.14.0).
 *
 * Golden rule asserted: DEFAULT builder options reproduce the pre-D2
 * hardcoded output exactly; each toggle changes ONLY its own knob.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  generateV2RayConfig, generateSingBoxConfig,
  DEFAULT_BUILDER_OPTIONS, singBoxLogLevel, parseSubscriptionUserInfo,
} = require("./taskD2-cfg.cjs");

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SINGBOX = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const WORK = process.env.TD2_WORK || "/home/z/my-project/scripts/taskD2-cfg-tmp";

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

const vmess = { id: "v", protocol: "vmess", name: "vm", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const vlessFlow = { id: "vf", protocol: "vless", name: "vl", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp", flow: "xtls-rprx-vision" };
const vlessPlain = { ...vlessFlow, id: "vp", flow: "" };
const trojan = { id: "t", protocol: "trojan", name: "tr", isValid: true, address: "1.2.3.4", port: 443, password: "tr-pw", security: "tls", network: "tcp" };
const hy2 = { id: "h", protocol: "hysteria2", name: "hy", isValid: true, address: "1.2.3.4", port: 443, password: "pw" };

const full = (cfg) => JSON.parse(cfg.json);
const ob = (cfg) => full(cfg).outbounds.find(o => o.tag === "proxy");
const socksIn = (cfg) => full(cfg).inbounds.find(i => i.tag === "socks-in");
const httpIn = (cfg) => full(cfg).inbounds.find(i => i.tag === "http-in");
const rules = (cfg) => full(cfg).routing.rules;

/* ---------- 1) defaults reproduce pre-D2 output exactly ---------- */
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809);
  check("T1 default: loglevel warning", full(c).log.loglevel === "warning");
  check("T1 default: listen 127.0.0.1 both inbounds", socksIn(c).listen === "127.0.0.1" && httpIn(c).listen === "127.0.0.1");
  check("T1 default: sniffing enabled + destOverride", JSON.stringify(socksIn(c).sniffing) === JSON.stringify({ enabled: true, destOverride: ["http", "tls"] }));
  check("T1 default: bittorrent rule present", rules(c).some(r => r.protocol?.[0] === "bittorrent" && r.outboundTag === "blocked"));
  check("T1 default: allowInsecure true", ob(c).streamSettings.tlsSettings.allowInsecure === true);
  check("T1 default: NO mux object", ob(c).settings.mux === undefined, JSON.stringify(ob(c).settings));
}
{
  const c = generateSingBoxConfig(hy2, 10808, 10809);
  check("T1 default sing-box: level warn + loopback", JSON.parse(c.json).log.level === "warn" &&
    JSON.parse(c.json).inbounds.every(i => i.listen === "127.0.0.1"));
}

/* ---------- 2) each toggle changes only its knob ---------- */
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, muxEnabled: true });
  check("T2 mux on vmess: settings.mux {enabled,concurrency:8}", JSON.stringify(ob(c).settings.mux) === JSON.stringify({ enabled: true, concurrency: 8 }), JSON.stringify(ob(c).settings.mux));
}
{
  const c = generateV2RayConfig(vlessFlow, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, muxEnabled: true });
  check("T2 mux + XTLS vision: mux omitted (flow guard)", ob(c).settings.mux === undefined && ob(c).settings.vnext[0].users[0].flow === "xtls-rprx-vision");
}
{
  const c = generateV2RayConfig(vlessPlain, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, muxEnabled: true });
  check("T2 mux + plain vless: mux present", JSON.stringify(ob(c).settings.mux) === JSON.stringify({ enabled: true, concurrency: 8 }));
}
{
  // D2 review fix: mux coverage extended to trojan — xray v25.1.1 dispatches
  // mux in the GENERIC outbound handler (no per-protocol gate, source-verified).
  const cOff = generateV2RayConfig(trojan, "socks-http", 10808, 10809, undefined, DEFAULT_BUILDER_OPTIONS);
  const cOn = generateV2RayConfig(trojan, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, muxEnabled: true });
  check("T2 mux on trojan: OFF = absent (old behavior) / ON = present", ob(cOff).settings.mux === undefined && JSON.stringify(ob(cOn).settings.mux) === JSON.stringify({ enabled: true, concurrency: 8 }), JSON.stringify({ off: ob(cOff).settings.mux, on: ob(cOn).settings.mux }));
}
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, allowLan: true });
  check("T2 allowLan: 0.0.0.0 both inbounds", socksIn(c).listen === "0.0.0.0" && httpIn(c).listen === "0.0.0.0");
}
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, sniffing: false });
  check("T2 sniffing off: enabled:false kept destOverride", socksIn(c).sniffing.enabled === false && httpIn(c).sniffing.enabled === false &&
    JSON.stringify(socksIn(c).sniffing.destOverride) === JSON.stringify(["http", "tls"]));
}
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, blockBittorrent: false });
  check("T2 blockBt off: no bittorrent rule (api-less config keeps others)", !rules(c).some(r => r.protocol?.[0] === "bittorrent"));
}
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, skipCertVerify: false });
  check("T2 skipVerify off: allowInsecure false", ob(c).streamSettings.tlsSettings.allowInsecure === false);
}
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, logLevel: "debug" });
  check("T2 logLevel debug", full(c).log.loglevel === "debug");
}
{
  const c = generateSingBoxConfig(hy2, 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, allowLan: true, logLevel: "info" });
  const f = JSON.parse(c.json);
  check("T2 sing-box: allowLan + level mapping (info)", f.inbounds.every(i => i.listen === "0.0.0.0") && f.log.level === "info");
  check("T2 sing-box: no mux/sniff fields injected", !JSON.stringify(f).includes('"mux"') && !JSON.stringify(f).includes("sniff"));
}
check("T2 singBoxLogLevel warning->warn mapping helper", singBoxLogLevel("warning") === "warn" && singBoxLogLevel("debug") === "debug");

/* ---------- 3) parseSubscriptionUserInfo ---------- */
{
  const u = parseSubscriptionUserInfo("upload=455727781; download=6172295019; total=107374182400; expire=1758988800");
  check("T3 userinfo standard form", u?.upload === 455727781 && u?.download === 6172295019 && u?.total === 107374182400 && u?.expire === 1758988800, JSON.stringify(u));
  const u2 = parseSubscriptionUserInfo("EXPIRE=0;  TOTAL=0");
  check("T3 userinfo case/spacing + zeros", u2?.expire === 0 && u2?.total === 0, JSON.stringify(u2));
  check("T3 userinfo garbage -> null", parseSubscriptionUserInfo("no keys here") === null && parseSubscriptionUserInfo("") === null);
  const u3 = parseSubscriptionUserInfo("upload=abc; download=10");
  check("T3 invalid values skipped, valid kept", u3?.download === 10 && u3?.upload === undefined, JSON.stringify(u3));
}

/* ---------- 4) REAL binaries on every generated variant ---------- */
console.log("\n== REAL xray v25.1.1 -test / sing-box 1.14.0 check ==");
const xrayVariants = [
  ["defaults (vmess tls)", generateV2RayConfig(vmess, "socks-http", 18081, 18082)],
  ["mux on (vmess)", generateV2RayConfig(vmess, "socks-http", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, muxEnabled: true })],
  ["allowLan (vmess)", generateV2RayConfig(vmess, "socks-http", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, allowLan: true })],
  ["sniffing off (vmess)", generateV2RayConfig(vmess, "socks-http", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, sniffing: false })],
  ["blockBt off (vmess)", generateV2RayConfig(vmess, "socks-http", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, blockBittorrent: false })],
  ["skipVerify off + debug (vless plain)", generateV2RayConfig(vlessPlain, "socks-http", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, skipCertVerify: false, logLevel: "debug" })],
  ["mux+vision guard (vless flow)", generateV2RayConfig(vlessFlow, "socks-http", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, muxEnabled: true })],
  ["mux on (trojan) — review fix", generateV2RayConfig(trojan, "socks-http", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, muxEnabled: true })],
  ["defaults (trojan, no mux)", generateV2RayConfig(trojan, "socks-http", 18081, 18082)],
];
let tested = 0;
for (const [label, cfg] of xrayVariants) {
  if (!cfg?.json) { check(`B ${label}: generated`, false, "null"); continue; }
  const file = path.join(WORK, `x-${label.replace(/[^a-z0-9]+/gi, "_")}.json`);
  fs.writeFileSync(file, cfg.json);
  const r = spawnSync(XRAY, ["run", "-test", "-c", file], { encoding: "utf8", timeout: 30000 });
  const out = (r.stdout || "") + (r.stderr || "");
  check(`B xray -test OK: ${label}`, r.status === 0 && out.includes("Configuration OK"), out.slice(0, 140).replace(/\n/g, " "));
  tested++;
}
check("B xray variant coverage >= 9", tested >= 9);

{
  const c1 = generateSingBoxConfig(hy2, 18081, 18082, undefined, DEFAULT_BUILDER_OPTIONS);
  const c2 = generateSingBoxConfig(hy2, 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, allowLan: true, logLevel: "debug" });
  let sbOk = 0;
  for (const [label, cfg] of [["defaults", c1], ["allowLan+debug", c2]]) {
    const file = path.join(WORK, `sb-${label.replace(/[^a-z0-9]+/gi, "_")}.json`);
    fs.writeFileSync(file, cfg.json);
    const r = spawnSync(SINGBOX, ["check", "-c", file], { encoding: "utf8", timeout: 30000 });
    const out = (r.stdout || "") + (r.stderr || "");
    check(`B sing-box check OK: ${label}`, r.status === 0, out.slice(0, 140).replace(/\n/g, " "));
    if (r.status === 0) sbOk++;
  }
  check("B sing-box variant coverage = 2", sbOk === 2);
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
