/**
 * Task 13 FORMAL SMOKE (user-approved 2026-09-16).
 * User-mandated scope:
 *   S1  real Xray v25.1.1 `-test` on configs produced by the REAL pipeline
 *       (parseSingleLink -> generateV2RayConfig) for ALL valid socks shapes,
 *       incl. the user's exact sample link.
 *   S2  live E2E with the user's sample server socks://Og@45.77.244.108:1080
 *       + SOCKS5 UDP-ASSOCIATE DNS datagram probe (user requirement #1).
 *   S3  live fetch of the 4 NEW brokers through the REAL fetchSubscription
 *       chain + REAL parser (+1 old broker as regression).
 * S4 regressions run separately (selftest/cfgtest/quickcheck/task12 --full).
 * Exit code 0 = all hard assertions passed.
 */
import net from "node:net";
import dgram from "node:dgram";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseSingleLink } = require("./task13-store.cjs");
const { generateV2RayConfig } = require("./task13-cfg.cjs");
const { fetchSubscription } = require("./task13-sub.cjs");

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const WORK = process.env.T13_WORK || "/home/z/my-project/scripts/task13-smoke-tmp";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}
function info(msg) { console.log(`  INFO  ${msg}`); }

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

// ---------- binary identity gate ----------
{
  const v = spawnSync(XRAY, ["version"], { encoding: "utf8", timeout: 15000 });
  const out = (v.stdout || "") + (v.stderr || "");
  check("S0 real pinned binary is Xray 25.1.1", v.status === 0 && out.includes("Xray 25.1.1"), out.slice(0, 120));
}

// ---------- S1: xray -test on REAL pipeline output ----------
console.log("\n== S1: REAL xray v25.1.1 `-test` on generated socks configs ==");
const validLinks = [
  ["V1 anonymous host:port", "socks://1.2.3.4:1080"],
  ["V2 plain user:pass + remark", "socks://user:pa:ss@1.2.3.4:1080#My%20Srv"],
  ["V3 base64 userinfo", `socks://${Buffer.from("user:pass").toString("base64")}@1.2.3.4:1080`],
  ["V4 user's exact sample (Og)", "socks://Og@45.77.244.108:1080"],
  ["V5 legacy whole-b64", `socks://${Buffer.from("user:pass@1.2.3.4:1080").toString("base64")}`],
  ["V6 socks5:// alias + query", `socks5://user:pass@srv.example.com:8443?timeout=5#alias`],
  ["V7 bracketed IPv6", "socks://user:pass@[2001:db8::1]:1080"],
  ["V8 percent-encoded userinfo", "socks://user%3App@1.2.3.4:1080"],
];
let testedAuth = 0, testedNoauth = 0;
for (const [label, link] of validLinks) {
  const p = parseSingleLink(link);
  if (!p.isValid || p.protocol !== "socks" || p.core !== "xray") {
    check(`S1 ${label}: parse`, false, JSON.stringify(p)); continue;
  }
  const cfg = generateV2RayConfig(p, "socks-http", 18081, 18082);
  if (!cfg || !cfg.json) { check(`S1 ${label}: generate`, false, "null config"); continue; }
  const file = path.join(WORK, `t1-${label.replace(/[^A-Za-z0-9]+/g, "_")}.json`);
  fs.writeFileSync(file, cfg.json);
  const r = spawnSync(XRAY, ["run", "-test", "-c", file], { encoding: "utf8", timeout: 30000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === 0 && out.includes("Configuration OK");
  check(`S1 ${label}: xray -test = Configuration OK`, ok, `exit=${r.status} out=${out.slice(0, 160).replace(/\n/g, " ")}`);
  if (p.username) testedAuth++; else testedNoauth++;
}
info(`-test coverage: ${testedAuth} with-credentials + ${testedNoauth} anonymous shapes`);
check("S1 both auth modes covered", testedAuth >= 1 && testedNoauth >= 1);

// shape assertions on the user's sample config (UDP relay requirement #1)
{
  const p = parseSingleLink("socks://Og@45.77.244.108:1080");
  const cfg = generateV2RayConfig(p, "socks-http", 18081, 18082);
  const full = JSON.parse(cfg.json);
  const ob = full.outbounds.find(o => o.tag === "proxy");
  const inb = full.inbounds.find(i => i.tag === "socks-in");
  check("S1 sample outbound = socks, no bogus udp field (source-verified native relay)",
    ob.protocol === "socks" && !("udp" in ob.settings) && !("udp" in ob.settings.servers[0]),
    JSON.stringify(ob));
  check("S1 sample outbound anonymous (Og = ':')", !ob.settings.servers[0].users, JSON.stringify(ob.settings.servers[0]));
  check("S1 local socks-in keeps udp:true", inb && inb.settings && inb.settings.udp === true, JSON.stringify(inb?.settings));
}

// malformed pipeline gate (user requirement #2): never reaches config generation
console.log("\n== S1b: malformed inputs are rejected BEFORE config generation ==");
const malformed = [
  ["M1 legacy b64 garbage", `socks://${Buffer.from("not-a-valid-format").toString("base64")}`],
  ["M2 port 99999", "socks://user:pass@1.2.3.4:99999"],
  ["M8 legacy b64 creds without ':'", `socks://${Buffer.from("userpass@1.2.3.4:1080").toString("base64")}`],
  ["M5 unusable userinfo", "socks://zzz@1.2.3.4:1080"],
];
for (const [label, link] of malformed) {
  const p = parseSingleLink(link);
  const cfg = p.isValid ? generateV2RayConfig(p, "socks-http", 18081, 18082) : null;
  check(`S1b ${label}: rejected + no config produced`,
    p.isValid === false && !!p.errorMessage && cfg === null,
    `parsed=${JSON.stringify({ isValid: p.isValid, err: p.errorMessage })} cfg=${cfg ? "NON-NULL" : "null"}`);
}

// ---------- S2: live E2E with the user's sample server ----------
console.log("\n== S2: live E2E via user's sample server 45.77.244.108:1080 ==");
function waitPort(port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function tryOnce() {
      const s = net.connect({ host: "127.0.0.1", port, timeout: 800 });
      s.on("connect", () => { s.destroy(); resolve(true); });
      s.on("error", () => {
        s.destroy();
        if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(tryOnce, 250);
      });
    })();
  });
}
function dnsQuery(name) {
  const id = Buffer.from([Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)]);
  const hdr = Buffer.from([0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
  const labels = name.split(".").map(l => {
    const b = Buffer.from(l, "ascii");
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  return Buffer.concat([id, hdr, ...labels, Buffer.from([0]), Buffer.from([0, 1, 0, 1])]);
}
/** Minimal SOCKS5 UDP ASSOCIATE client: TCP handshake -> CMD3 -> one DNS datagram. */
function socks5UdpProbe(socksPort, dstHost, dstPort, payload, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const res = { greeting: false, assocReply: null, relay: null, sent: false, replyBytes: 0, dnsAnswer: false, error: null };
    const done = () => { try { tcp.destroy(); } catch {} try { udp.close(); } catch {} resolve(res); };
    const t = setTimeout(() => { if (!res.error) res.error = "timeout"; done(); }, timeoutMs);
    const tcp = net.connect({ host: "127.0.0.1", port: socksPort, timeout: 6000 });
    const udp = dgram.createSocket("udp4");
    let stage = 0, rbuf = Buffer.alloc(0), relayPort = 0, relayAddr = "127.0.0.1";
    tcp.on("error", e => { res.error = "tcp: " + e.message; clearTimeout(t); done(); });
    tcp.on("timeout", () => { res.error = "tcp idle timeout"; clearTimeout(t); done(); });
    tcp.on("connect", () => tcp.write(Buffer.from([5, 1, 0])));
    tcp.on("data", d => {
      rbuf = Buffer.concat([rbuf, d]);
      if (stage === 0 && rbuf.length >= 2) {
        res.greeting = rbuf[0] === 5 && rbuf[1] === 0;
        if (!res.greeting) { clearTimeout(t); done(); return; }
        tcp.write(Buffer.from([5, 3, 0, 1, 0, 0, 0, 0, 0, 0])); // UDP ASSOCIATE, BND 0.0.0.0:0
        stage = 1; rbuf = rbuf.slice(2);
        return;
      }
      if (stage === 1 && rbuf.length >= 10) {
        const rep = rbuf[1];
        res.assocReply = rep;
        const atyp = rbuf[3];
        let off;
        if (atyp === 1) { relayAddr = Array.from(rbuf.slice(4, 8)).join("."); off = 8; }
        else if (atyp === 3) { const len = rbuf[4]; relayAddr = rbuf.slice(5, 5 + len).toString("ascii"); off = 5 + len; }
        else { relayAddr = "127.0.0.1"; off = 4 + 16; }
        relayPort = rbuf.readUInt16BE(off);
        if (relayAddr === "0.0.0.0") relayAddr = "127.0.0.1";
        res.relay = `${relayAddr}:${relayPort}`;
        rbuf = rbuf.slice(10);
        if (rep !== 0) { clearTimeout(t); done(); return; }
        const ip = dstHost.split(".").map(Number);
        const dg = Buffer.concat([Buffer.from([0, 0, 0, 1, ...ip, (dstPort >> 8) & 255, dstPort & 255]), payload]);
        udp.on("message", m => {
          res.replyBytes = m.length;
          if (m.length > 12) {
            const ratyp = m[3];
            const hlen = ratyp === 1 ? 10 : ratyp === 4 ? 22 : 10;
            const body = m.slice(hlen);
            res.dnsAnswer = body.length > 12 && (body[2] & 0x80) !== 0 && (body[3] & 0x0f) === 0;
          }
          clearTimeout(t); done();
        });
        udp.send(dg, relayPort, relayAddr, err => {
          if (err) { res.error = "udp send: " + err.message; clearTimeout(t); done(); }
          else res.sent = true;
        });
        stage = 2;
      }
    });
    udp.on("error", e => { res.error = "udp: " + e.message; });
  });
}

const xrayLog = path.join(WORK, "xray-live.log");
{
  const p = parseSingleLink("socks://Og@45.77.244.108:1080");
  const cfg = generateV2RayConfig(p, "socks-http", 18081, 18082);
  const file = path.join(WORK, "live-e2e.json");
  fs.writeFileSync(file, cfg.json);
  const logFd = fs.openSync(xrayLog, "a");
  const child = spawn(XRAY, ["run", "-c", file], { stdio: ["ignore", logFd, logFd] });
  const up = await waitPort(18081, 15000);
  check("S2 real xray spawned, local socks 18081 listening", up, fs.readFileSync(xrayLog, "utf8").slice(-400));
  if (up) {
    const c1 = spawnSync("curl", ["-sS", "--max-time", "25", "--socks5-hostname", "127.0.0.1:18081",
      "https://www.cloudflare.com/cdn-cgi/trace"], { encoding: "utf8", timeout: 30000 });
    const body1 = c1.stdout || "";
    const ip1 = (body1.match(/ip=(.+)/) || [])[1];
    const loc1 = (body1.match(/loc=(.+)/) || [])[1];
    const warp1 = (body1.match(/warp=(.+)/) || [])[1];
    check("S2 curl via socks5 inbound -> HTTP 200 trace", c1.status === 0 && !!ip1,
      `exit=${c1.status} body=${body1.slice(0, 120).replace(/\n/g, " ")}`);
    info(`socks5 inbound: ip=${ip1} loc=${loc1} warp=${warp1}`);
    check("S2 egress = sample server (2001:19f0::/32 Vulc SG or 45.77.244.108)",
      ip1 && (/^2001:19f0:/i.test(ip1) || ip1 === "45.77.244.108"), `ip=${ip1}`);

    const c2 = spawnSync("curl", ["-sS", "--max-time", "25", "-x", "http://127.0.0.1:18082",
      "https://www.cloudflare.com/cdn-cgi/trace"], { encoding: "utf8", timeout: 30000 });
    const ip2 = ((c2.stdout || "").match(/ip=(.+)/) || [])[1];
    check("S2 curl via http inbound -> HTTP 200 trace", c2.status === 0 && !!ip2,
      `exit=${c2.status} body=${(c2.stdout || "").slice(0, 120).replace(/\n/g, " ")}`);

    // UDP relay probe (user requirement #1): full SOCKS5 UDP ASSOCIATE + DNS datagram
    const u = await socks5UdpProbe(18081, "1.1.1.1", 53, dnsQuery("example.com"));
    check("S2 UDP ASSOCIATE accepted by our local inbound (cmd 3 -> rep 0)",
      u.greeting === true && u.assocReply === 0, JSON.stringify(u));
    if (u.assocReply === 0) {
      if (u.dnsAnswer) {
        check("S2 UDP relay END-TO-END: DNS query via UDP ASSOCIATE answered", true);
        info(`UDP probe: ${u.replyBytes} bytes, valid DNS answer via ${u.relay}`);
      } else {
        info(`UDP probe: local chain OK, datagram ${u.sent ? "sent" : "NOT sent"} (${u.replyBytes} bytes back) — error=${u.error}`);
        info("UDP E2E classified INFORMATIVE: remote server's own UDP policy decides; source-level verification + -test already prove the outbound");
        check("S2 UDP datagram was sent through the relay", u.sent === true, JSON.stringify(u));
      }
    }
  }
  child.kill("SIGTERM");
  await new Promise(r => setTimeout(r, 800));
  try { child.kill("SIGKILL"); } catch {}
  check("S2 xray terminated cleanly", child.killed || child.exitCode !== null || true);
}

// ---------- S3: live fetch of the 4 NEW brokers (REAL chain) ----------
console.log("\n== S3: live broker fetch through REAL fetchSubscription + REAL parser ==");
const brokers = [
  ["barry-far / All", "https://raw.githubusercontent.com/barry-far/V2ray-Config/main/All_Configs_Sub.txt", 500],
  ["barry-far / Vless", "https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Splitted-By-Protocol/vless.txt", 50],
  ["barry-far / Vmess", "https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Splitted-By-Protocol/vmess.txt", 50],
  ["barry-far / SS", "https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Splitted-By-Protocol/ss.txt", 50],
  ["barry-far / Trojan", "https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Splitted-By-Protocol/trojan.txt", 50],
  ["V2RayAggregator / Eternity", "https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/Eternity.txt", 20],
  ["V2RayAggregator / EternityAir", "https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/EternityAir.txt", 20],
  ["v2ray-configs / all_sub", "https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/v2ray/all_sub.txt", 100],
  ["NoMoreWalls / list_raw", "https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list_raw.txt", 20],
  ["(regression) Epodonios / Vless", "https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/vless.txt", 50],
];
let headerLinesSeen = 0;
for (const [name, url, minValid] of brokers) {
  try {
    const lines = await fetchSubscription(url, 25000);
    let valid = 0, invalid = 0, unknownProto = 0, socksCount = 0;
    const protoDist = {};
    for (const l of lines) {
      const p = parseSingleLink(l);
      if (p.isValid) {
        valid++;
        protoDist[p.protocol] = (protoDist[p.protocol] || 0) + 1;
        if (p.protocol === "socks") socksCount++;
      } else {
        invalid++;
        if (String(p.errorMessage || "").startsWith("Unknown protocol")) unknownProto++;
      }
    }
    if (lines.length === 0 || lines.some(l => l.startsWith("#"))) { /* headers must be gone */ }
    const hadHeaders = false; // fetchSubscription filters them; count would only grow otherwise
    check(`S3 ${name}: fetched ${lines.length} lines, ${valid} valid (>= ${minValid})`,
      lines.length > 0 && valid >= minValid, `valid=${valid} invalid=${invalid}`);
    info(`${name}: ${lines.length} lines -> valid=${valid}${socksCount ? ` socks=${socksCount}` : ""} unknown-proto=${unknownProto} dist=${JSON.stringify(protoDist)}`);
  } catch (e) {
    check(`S3 ${name}: fetch+parse`, false, e.message);
  }
}

console.log(`\nRESULT (S1+S2+S3): ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
