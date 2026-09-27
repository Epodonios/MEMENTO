#!/usr/bin/env node
/**
 * taskE1-probe.mjs — Phase E / Batch E1 DESIGN-TIME live probe (2026-09-21).
 *
 * Purpose: capture TODAY, against the PINNED cores, the exact live evidence
 * the E1 design report needs — nothing here is inferred from docs or old
 * reports:
 *
 *   P1  sing-box 1.14.0  — clash_api GET /connections response SHAPE
 *       (per-connection item fields + totals), populated by real loopback
 *       traffic through the proxy inbound.
 *   P2  xray 25.1.1      — `xray api statsquery` full counter LIST
 *       (granularity proof: per-inbound / per-outbound only, NO
 *       per-connection counter exists at the Stats API surface).
 *
 * Everything is loopback (proxy inbound -> freedom -> local http server),
 * single foreground lifecycle per core, always killed in finally.
 */
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TMP = "/home/z/my-project/scripts/taskE1-live-tmp";
const SB = "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const XR = "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
mkdirSync(TMP, { recursive: true });

const sh = (cmd, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(cmd, args, { timeout: 8000, ...opts }, (err, stdout, stderr) =>
      err ? rej(Object.assign(err, { stdout, stderr })) : res(stdout)));

const waitPort = (port, ms = 6000) =>
  new Promise((res) => {
    const t0 = Date.now();
    const tick = () => {
      const net = spawn("bash", ["-c", `exec 3<>/dev/tcp/127.0.0.1/${port} && echo OPEN`],
        { stdio: "pipe" });
      let ok = false;
      net.stdout.on("data", (d) => { if (String(d).includes("OPEN")) ok = true; });
      net.on("close", () => {
        if (ok) return res(true);
        if (Date.now() - t0 > ms) return res(false);
        setTimeout(tick, 250);
      });
    };
    tick();
  });

/* local origin server the proxy dials into (freedom outbound, loopback) */
import { createServer } from "node:http";
const BLOB = "E1PROBE".repeat(8192); // 56 KB per GET
const origin = createServer((_q, r) => { r.writeHead(200, { "content-type": "application/octet-stream" }); r.end(BLOB); });
// Slow endpoint: stays OPEN for ~4s so /connections catches it LIVE.
const originSlow = createServer((_q, r) => {
  r.writeHead(200, { "content-type": "application/octet-stream" });
  let n = 0;
  const t = setInterval(() => { r.write(BLOB); if (++n > 12) { clearInterval(t); r.end(); } }, 300);
  _q.on("close", () => clearInterval(t));
});
await new Promise((res) => origin.listen(18910, "127.0.0.1", res));
await new Promise((res) => originSlow.listen(18912, "127.0.0.1", res));

const viaProxy = (proxy) => sh("curl", ["-sS", "-o", "/dev/null", "-w", "%{size_download}", "--proxy", proxy, "http://127.0.0.1:18910/blob"]);

/* ---------------- P1: sing-box 1.14.0 — /connections shape ------------- */
let p1 = null;
{
  const cfg = {
    log: { level: "warn" },
    inbounds: [
      { type: "socks", tag: "socks-in", listen: "127.0.0.1", listen_port: 18901 },
      { type: "http", tag: "http-in", listen: "127.0.0.1", listen_port: 18911 },
    ],
    // sing-box 1.12+ removed "freedom" (live-verified today: FATAL unknown
    // outbound type) — the modern direct outbound is the loopback dialer.
    outbounds: [{ type: "direct", tag: "proxy" }],
    experimental: { clash_api: { external_controller: "127.0.0.1:18902", secret: "e1probe" } },
  };
  const cfgPath = join(TMP, "sb-e1.json");
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const child = spawn(SB, ["run", "-c", cfgPath], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  try {
    const up = await waitPort(18902);
    if (!up) throw new Error("clash_api port never opened; log:\n" + log);
    const sizes = [];
    for (let i = 0; i < 3; i++) sizes.push(await viaProxy("http://127.0.0.1:18911"));
    // Hold one connection OPEN while querying /connections:
    const slow = sh("curl", ["-sS", "-o", "/dev/null", "--proxy", "http://127.0.0.1:18911", "http://127.0.0.1:18912/slow"]);
    await new Promise((r) => setTimeout(r, 1200)); // transfer now in flight
    const res = await fetch("http://127.0.0.1:18902/connections", {
      headers: { Authorization: "Bearer e1probe" },
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json();
    const conns = Array.isArray(data.connections) ? data.connections : [];
    await slow.catch(() => {}); // let the slow transfer finish
    p1 = {
      httpStatus: res.status,
      topKeys: Object.keys(data).sort(),
      totals: { uploadTotal: data.uploadTotal, downloadTotal: data.downloadTotal },
      liveConnectionCount: conns.length,
      transferredViaProxyBytes: sizes.map(Number),
      firstItem: conns[0] ?? null,
      firstItemKeys: conns[0] ? Object.keys(conns[0]).sort() : [],
      secondItemKeys: conns[1] ? Object.keys(conns[1]).sort() : [],
    };
  } finally {
    child.kill("SIGKILL");
  }
}

/* ---------------- P2: xray 25.1.1 — statsquery counter list ------------ */
let p2 = null;
{
  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks-in", listen: "127.0.0.1", port: 18903, protocol: "socks", settings: { auth: "noauth", udp: false } },
      { tag: "http-in", listen: "127.0.0.1", port: 18913, protocol: "http", settings: {} },
      { tag: "api", listen: "127.0.0.1", port: 18904, protocol: "dokodemo-door", settings: { address: "127.0.0.1" } },
    ],
    outbounds: [
      { protocol: "freedom", tag: "proxy" },
      { protocol: "blackhole", tag: "blocked" },
    ],
    routing: { rules: [{ type: "field", inboundTag: ["api"], outboundTag: "api" }] },
    api: { tag: "api", services: ["StatsService"] },
    stats: {},
    policy: {
      levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsOutboundUplink: true, statsOutboundDownlink: true },
    },
  };
  const cfgPath = join(TMP, "x-e1.json");
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const child = spawn(XR, ["run", "-c", cfgPath], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  try {
    const up = await waitPort(18904);
    if (!up) throw new Error("api port never opened; log:\n" + log);
    const sizes = [];
    for (let i = 0; i < 3; i++) sizes.push(await viaProxy("socks5://127.0.0.1:18903"));
    const q = await sh(XR, ["api", "statsquery", "-s", "127.0.0.1:18904"]);
    const parsed = JSON.parse(q);
    const counters = (parsed.stat ?? []).map((s) => ({ name: s.name, value: s.value }));
    p2 = {
      transferredViaProxyBytes: sizes.map(Number),
      counterCount: counters.length,
      counters,
      hasPerConnectionCounter:
        counters.some((c) => !/^(inbound|outbound|user|system)>>>/i.test(c.name)),
    };
  } finally {
    child.kill("SIGKILL");
  }
}

origin.close();
originSlow.close();
const out = { probedAt: new Date().toISOString(), P1_singbox_connections: p1, P2_xray_statsquery: p2 };
writeFileSync(join(TMP, "probe-e1.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
