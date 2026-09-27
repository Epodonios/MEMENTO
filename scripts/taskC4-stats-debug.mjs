#!/usr/bin/env node
/** C4 debug: which dispatch path moves the vless outbound's UPLINK counter?
 *  V1 vless direct dial (no balancer/chain) — the pre-C4 shape
 *  V2 vless via dialerProxy (chain)         — known: up+down move
 *  V3 vless behind balancer (roundRobin)    — observed: down only
 *  V4 vless behind balancer, but pin members with distinct tags (no socks member)
 */
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WORK = "/home/z/my-project/scripts/taskC4-live-tmp";
fs.mkdirSync(WORK, { recursive: true });
const XRAY = "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const UUID = "b831381d-6324-4d53-ad4f-8cda48b30811";

const waitPort = (port, timeoutMs = 8000) => new Promise((resolve) => {
  const t0 = Date.now();
  const probe = () => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => { s.destroy(); if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(probe, 120); });
  };
  probe();
});
const alloc = () => new Promise((res, rej) => {
  const s = net.createServer(); s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});
async function recorder(bind, port) {
  const srv = net.createServer(sock => {
    sock.on("data", () => sock.end("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
    sock.on("error", () => {});
  });
  await new Promise(res => srv.listen(port, bind, res));
  return () => new Promise(res => srv.close(res));
}
async function socksGet(socksPort, ip, port) {
  return new Promise((resolve) => {
    const s = net.connect(socksPort, "127.0.0.1");
    let stage = 0, buf = Buffer.alloc(0);
    const done = (r) => { try { s.destroy(); } catch {} resolve(r); };
    const t = setTimeout(() => done("timeout(stage=" + stage + " tail=" + buf.toString("latin1").slice(0, 60) + ")"), 5000);
    s.on("error", e => { clearTimeout(t); done(String(e.code || e)); });
    s.on("data", d => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) { if (buf.length < 2) return; buf = buf.subarray(2); stage = 1;
        const h = Buffer.alloc(10); h[0]=5;h[1]=1;h[2]=0;h[3]=1;
        ip.split(".").forEach((o,i)=>h[4+i]=Number(o)); h.writeUInt16BE(port, 8); s.write(h);
      } else if (stage === 1) { if (buf.length < 4) return; buf = buf.subarray(10); stage = 2;
        s.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      } else { const m = buf.toString("latin1").match(/^HTTP\/1\.[01] (\d{3})/); if (m) { clearTimeout(t); done(m[1]); } }
    });
    s.on("connect", () => s.write(Buffer.from([5,1,0])));
  });
}
const spawnX = (f) => spawn(XRAY, ["run", "-c", f], { stdio: ["ignore","ignore","pipe"], windowsHide: true });
const stats = (port) => {
  const raw = execFileSync(XRAY, ["api","statsquery","-s",`127.0.0.1:${port}`], { encoding: "utf8" });
  const j = JSON.parse(raw);
  return { map: Object.fromEntries((j.stat || []).map(s => [s.name, s.value])), raw };
};
const showRaw = (label, r) => {
  console.log(label + " RAW:");
  console.log(r.raw);
};
const show = (label, r) => {
  console.log(label);
  for (const k of Object.keys(r.map).sort()) console.log("  ", k, "=", JSON.stringify(r.map[k]));
};

const serverPort = await alloc();
const carrierPort = await alloc();
const recPort = await alloc();
const closeRec = await recorder("127.0.0.2", recPort);
// recorder self-test: raw direct hit, bypassing every proxy
console.log("[selftest] recorder direct hit:", await new Promise((res) => {
  const s = net.connect(recPort, "127.0.0.2");
  const to = setTimeout(() => { s.destroy(); res("TIMEOUT"); }, 2000);
  s.on("data", d => { clearTimeout(to); s.destroy(); res(d.toString().split("\r\n")[0]); });
  s.on("error", e => { clearTimeout(to); res("ERR " + e.code); });
  s.on("connect", () => s.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
}));
// fresh server + carrier configs (this run's ports)
fs.writeFileSync(path.join(WORK, "server.json"), JSON.stringify({
  inbounds: [{ tag: "vless-in", port: serverPort, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" } }],
  outbounds: [{ protocol: "freedom", tag: "direct" }],
}));
fs.writeFileSync(path.join(WORK, "carrier.json"), JSON.stringify({
  inbounds: [{ tag: "socks-in", port: carrierPort, listen: "127.0.0.1", protocol: "socks", settings: { auth: "noauth", udp: false } }],
  outbounds: [{ protocol: "freedom", tag: "direct" }],
}));
const server = spawnX(path.join(WORK, "server.json"));
if (!await waitPort(serverPort)) console.log("SERVER FAILED");
const carrier = spawnX(path.join(WORK, "carrier.json"));
await waitPort(carrierPort);

const mkStats = (api) => ({
  api: { tag: "api", services: ["StatsService"] }, stats: {},
  policy: { levels: { "0": { statsUserUplink: true, statsUserDownlink: true } }, system: { statsOutboundUplink: true, statsOutboundDownlink: true } },
  inbounds2: { tag: "api", listen: "127.0.0.1", port: api, protocol: "dokodemo-door", settings: { address: "127.0.0.1" } },
});

async function runVariant(name, cfgObj, apiPort) {
  const cfg = JSON.parse(JSON.stringify(cfgObj));
  const s = mkStats(apiPort);
  cfg.api = s.api; cfg.stats = s.stats; cfg.policy = s.policy;
  cfg.inbounds.push(s.inbounds2);
  // the api rule is LOAD-BEARING for statsquery: without it the gRPC goes to the catch-all
  cfg.routing.rules.unshift({ type: "field", inboundTag: ["api"], outboundTag: "api" });
  cfg.log = { loglevel: "warning" };
  const f = path.join(WORK, `dbg-${name}.json`);
  fs.writeFileSync(f, JSON.stringify(cfg));
  let errTail = "";
  const child = spawn(XRAY, ["run", "-c", f], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  child.stderr.on("data", d => { errTail += String(d); });
  const okSocks = await waitPort(cfg.inbounds.find(i => i.protocol === "socks").port);
  if (!okSocks) { console.log(`${name}: FAILED TO BOOT:\n${errTail.slice(-500)}`); child.kill("SIGKILL"); return; }
  for (let i = 0; i < 4; i++) {
    const r = await socksGet(cfg.inbounds.find(i => i.protocol === "socks").port, "127.0.0.2", recPort);
    if (r !== "204") console.log(`  [${name}] GET#${i} -> ${r} | child stderr: ${errTail.slice(-400).replace(/\n/g, " | ")}`);
  }
  await new Promise(r => setTimeout(r, 300));
  try {
    const st = stats(apiPort);
    show(`--- ${name}`, st);
    if (name.startsWith("V3")) showRaw(name, st);
  } catch (e) {
    console.log(`${name}: statsquery failed: ${String(e.message).slice(0, 100)}; stderr: ${errTail.slice(-300)}`);
  }
  child.kill("SIGKILL");
}

const base = {
  inbounds: [
    { tag: "socks-in", port: await alloc(), listen: "127.0.0.1", protocol: "socks", sniffing: { enabled: true, destOverride: ["http","tls"] }, settings: { auth: "noauth", udp: true } },
    { tag: "http-in", port: await alloc(), listen: "127.0.0.1", protocol: "http", sniffing: { enabled: true, destOverride: ["http","tls"] }, settings: { auth: "noauth" } },
  ],
  outbounds: [],
  routing: { domainStrategy: "AsIs", rules: [] },
};
const vlessProxy = { tag: "proxy", protocol: "vless", settings: { vnext: [{ address: "127.0.0.1", port: serverPort, users: [{ id: UUID, flow: "", encryption: "none" }] }] }, streamSettings: { network: "tcp", security: "none" } };

// V1: direct dial
{
  const c = JSON.parse(JSON.stringify(base));
  c.outbounds = [vlessProxy, { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "blocked" }];
  await runVariant("V1-direct-dial", c, await alloc());
}
// V2: dialerProxy chain
{
  const c = JSON.parse(JSON.stringify(base));
  c.outbounds = [
    { ...vlessProxy, streamSettings: { network: "tcp", security: "none", sockopt: { dialerProxy: "chain-hop" } } },
    { tag: "chain-hop", protocol: "socks", settings: { servers: [{ address: "127.0.0.1", port: carrierPort }] } },
    { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "blocked" },
  ];
  await runVariant("V2-dialerproxy-chain", c, await alloc());
}
// V3: balancer roundRobin
{
  const c = JSON.parse(JSON.stringify(base));
  c.outbounds = [vlessProxy, { tag: "proxy2", protocol: "socks", settings: { servers: [{ address: "127.0.0.1", port: carrierPort }] } }, { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "blocked" }];
  c.routing = { domainStrategy: "AsIs", rules: [{ type: "field", network: "tcp,udp", balancerTag: "balancer" }], balancers: [{ tag: "balancer", selector: ["proxy"], strategy: { type: "roundRobin" } }] };
  await runVariant("V3-balancer-roundrobin", c, await alloc());
}
closeRec();
try { server.kill("SIGKILL"); } catch {}
try { carrier.kill("SIGKILL"); } catch {}
