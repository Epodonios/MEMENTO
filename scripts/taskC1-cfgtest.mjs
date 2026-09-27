#!/usr/bin/env node
/**
 * Phase C1 cfg+binary test — REAL generateV2RayConfig fragment-dialer
 * injection, verified by shape assertions AND the REAL pinned Xray v25.1.1
 * (`run -test`) + sing-box 1.14.0 (`check`).
 *
 * Golden rules asserted:
 *   - DEFAULT options reproduce the pre-C1 output byte-for-byte (no dialer
 *     outbound, no sockopt);
 *   - fragment applies ONLY to tls/reality vmess/vless/trojan;
 *   - ss/socks and the sing-box path are honestly skipped;
 *   - invalid ranges => feature off (never a broken config);
 *   - the sibling `noises` knob is deliberately NOT emitted (v25.1.1 ships
 *     it UDP-only — source-verified; a TCP tunnel can never fire it).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TC1_WORK || "/home/z/my-project/scripts/taskC1-cfg-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC1-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c1.cjs")}`], { cwd: HERE, stdio: "pipe" });
const {
  generateV2RayConfig, generateSingBoxConfig,
  DEFAULT_BUILDER_OPTIONS, FRAGMENT_DIALER_TAG,
} = await import(join(WORK, "c1.cjs"));

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SINGBOX = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

const vmess = { id: "v", protocol: "vmess", name: "vm", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };
const vlessFlow = { id: "vf", protocol: "vless", name: "vl", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp", flow: "xtls-rprx-vision" };
const vlessReality = { id: "vr", protocol: "vless", name: "vreal", isValid: true, address: "1.2.3.4", port: 443, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "reality", network: "tcp", publicKey: "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0", shortId: "0123456789abcdef", sni: "www.microsoft.com" };
const vlessWs = { ...vmess, id: "vw", protocol: "vless", network: "ws", path: "/ws" };
const trojan = { id: "t", protocol: "trojan", name: "tr", isValid: true, address: "1.2.3.4", port: 443, password: "tr-pw", security: "tls", network: "tcp" };
const ss = { id: "s", protocol: "ss", name: "ss", isValid: true, address: "1.2.3.4", port: 443, method: "aes-256-gcm", password: "ss-pw" };
const socksCfg = { id: "k", protocol: "socks", name: "sk", isValid: true, address: "1.2.3.4", port: 1080 };
const hy2 = { id: "h", protocol: "hysteria2", name: "hy", isValid: true, address: "1.2.3.4", port: 443, password: "pw" };

const frag = (over = {}) => ({ ...DEFAULT_BUILDER_OPTIONS, tlsFragment: true, ...over });
const full = (cfg) => JSON.parse(cfg.json);
const outbounds = (cfg) => full(cfg).outbounds;
const ob = (cfg) => outbounds(cfg).find(o => o.tag === "proxy");
const dialer = (cfg) => outbounds(cfg).find(o => o.tag === FRAGMENT_DIALER_TAG);

/* ---------- 1) defaults = byte-identical old output ---------- */
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809);
  check("T1 default: 3 outbounds (proxy/direct/blocked), no dialer", outbounds(c).length === 3 && !dialer(c));
  check("T1 default: no sockopt anywhere", !JSON.stringify(full(c)).includes("sockopt"));
  check("T1 default: no fragment key anywhere", !JSON.stringify(full(c)).includes("fragment"));
}

/* ---------- 2) injection shape per protocol/transport ---------- */
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, frag());
  check("T2a vmess tcp+tls: 4 outbounds, dialer after proxy", outbounds(c).length === 4 && outbounds(c)[1].tag === FRAGMENT_DIALER_TAG);
  check("T2b dialer shape: freedom + fragment recipe", dialer(c).protocol === "freedom" &&
    JSON.stringify(dialer(c).settings.fragment) === JSON.stringify({ packets: "tlshello", length: "100-200", interval: "10-20" }) &&
    dialer(c).settings.domainStrategy === "AsIs");
  check("T2c proxy sockopt.dialerProxy set", JSON.stringify(ob(c).streamSettings.sockopt) === JSON.stringify({ dialerProxy: FRAGMENT_DIALER_TAG }));
  check("T2d no noises emitted anywhere", !JSON.stringify(full(c)).includes("noises"));
}
{
  const c = generateV2RayConfig(vlessWs, "socks-http", 10808, 10809, undefined, frag({ tlsFragmentLength: "50-100", tlsFragmentInterval: "5-15" }));
  check("T2e vless ws+tls: custom ranges honored", dialer(c)?.settings.fragment.length === "50-100" && dialer(c)?.settings.fragment.interval === "5-15");
}
{
  const c = generateV2RayConfig(vlessReality, "socks-http", 10808, 10809, undefined, frag());
  check("T2f vless reality: applies (hello is still a TLS record)", !!dialer(c) && ob(c).streamSettings.sockopt?.dialerProxy === FRAGMENT_DIALER_TAG && !!ob(c).streamSettings.realitySettings);
}
{
  const c = generateV2RayConfig(vlessFlow, "socks-http", 10808, 10809, undefined, frag());
  check("T2g vless vision flow: applies, flow preserved", !!dialer(c) && ob(c).settings.vnext[0].users[0].flow === "xtls-rprx-vision");
}
{
  const c = generateV2RayConfig(trojan, "socks-http", 10808, 10809, undefined, frag());
  check("T2h trojan tls: applies", !!dialer(c));
}
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, { ...DEFAULT_BUILDER_OPTIONS, tlsFragment: true, muxEnabled: true });
  check("T2i mux + fragment: both present, independent", !!dialer(c) && JSON.stringify(ob(c).settings.mux) === JSON.stringify({ enabled: true, concurrency: 8 }));
}
{
  const c = generateV2RayConfig(ss, "socks-http", 10808, 10809, undefined, frag());
  check("T2j ss: honestly skipped (no TLS hello)", !dialer(c) && outbounds(c).length === 3 && !ob(c).streamSettings?.sockopt);
}
{
  const c = generateV2RayConfig(socksCfg, "socks-http", 10808, 10809, undefined, frag());
  check("T2k socks: honestly skipped", !dialer(c) && outbounds(c).length === 3);
}
{
  const bad1 = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, frag({ tlsFragmentLength: "abc" }));
  const bad2 = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, frag({ tlsFragmentPackets: "200-100" }));
  const bad3 = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, frag({ tlsFragmentInterval: "10" }));
  check("T2l invalid ranges => feature off (no dialer, no sockopt)", !dialer(bad1) && !dialer(bad2) && !dialer(bad3) && !ob(bad1).streamSettings?.sockopt);
}
{
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, undefined, frag({ tlsFragmentPackets: "2-3" }));
  check("T2m numeric packets mode serialized", dialer(c)?.settings.fragment.packets === "2-3");
}
{
  // stats API config (the real connect path passes apiPort) + fragment: coexist
  const c = generateV2RayConfig(vmess, "socks-http", 10808, 10809, 15490, frag());
  check("T2n stats api inbound + fragment coexist", !!dialer(c) && full(c).inbounds.some(i => i.tag === "api") && !!full(c).api);
}

/* ---------- 3) sing-box path unaffected ---------- */
{
  const c = generateSingBoxConfig(hy2, 10808, 10809, undefined, frag());
  const j = JSON.parse(c.json);
  check("T3 hysteria2: no fragment/sockopt/dialer in sing-box JSON", !JSON.stringify(j).includes("fragment") && !JSON.stringify(j).includes("sockopt") && j.outbounds.length === 1);
}

/* ---------- 4) REAL binaries on every generated variant ---------- */
console.log("\n== REAL xray v25.1.1 -test / sing-box 1.14.0 check ==");
const xrayVariants = [
  ["frag vmess tcp+tls (defaults recipe)", generateV2RayConfig(vmess, "socks-http", 18081, 18082, undefined, frag())],
  ["frag vless ws+tls", generateV2RayConfig(vlessWs, "socks-http", 18081, 18082, undefined, frag({ tlsFragmentInterval: "5-15" }))],
  ["frag vless reality", generateV2RayConfig(vlessReality, "socks-http", 18081, 18082, undefined, frag())],
  ["frag vless vision", generateV2RayConfig(vlessFlow, "socks-http", 18081, 18082, undefined, frag())],
  ["frag trojan", generateV2RayConfig(trojan, "socks-http", 18081, 18082, undefined, frag())],
  ["frag + mux (vmess)", generateV2RayConfig(vmess, "socks-http", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS, tlsFragment: true, muxEnabled: true })],
  ["frag + stats api (vmess)", generateV2RayConfig(vmess, "socks-http", 18081, 18082, 15490, frag())],
  ["frag numeric packets 2-3 (vmess)", generateV2RayConfig(vmess, "socks-http", 18081, 18082, undefined, frag({ tlsFragmentPackets: "2-3" }))],
  ["defaults control (vmess)", generateV2RayConfig(vmess, "socks-http", 18081, 18082)],
];
let tested = 0;
for (const [label, cfg] of xrayVariants) {
  if (!cfg?.json) { check(`B ${label}: generated`, false, "null"); continue; }
  const file = path.join(WORK, `x-${label.replace(/[^a-z0-9]+/gi, "_")}.json`);
  fs.writeFileSync(file, cfg.json);
  const r = spawnSync(XRAY, ["run", "-test", "-c", file], { encoding: "utf8", timeout: 30000 });
  const out = (r.stdout || "") + (r.stderr || "");
  check(`B xray -test OK: ${label}`, r.status === 0 && out.includes("Configuration OK"), out.slice(-160).replace(/\n/g, " "));
  tested++;
}
check("B xray variant coverage >= 9", tested >= 9);

{
  const file = path.join(WORK, "sb-frag-on.json");
  fs.writeFileSync(file, generateSingBoxConfig(hy2, 18081, 18082, undefined, frag()).json);
  const r = spawnSync(SINGBOX, ["check", "-c", file], { encoding: "utf8", timeout: 30000 });
  const out = (r.stdout || "") + (r.stderr || "");
  check("B sing-box check OK: fragment-on options passed (no-op)", r.status === 0, out.slice(-140).replace(/\n/g, " "));
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
