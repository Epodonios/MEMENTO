#!/usr/bin/env node
/** C4 uplink probe — characterize the Xray v25.1.1 balancer uplink gap and
 *  test whether a benign sockopt flips it. Modeled EXACTLY on the proven
 *  taskC4-live.mjs building blocks (generator output boots + relays 204s).
 *
 *  X1 control:      balancer [vless proxy (plain), socks proxy2]  -> expect proxy uplink 0 (live-observed)
 *  X2 sockopt nudge: balancer [vless proxy + sockopt.tcpKeepAliveIdle, socks proxy2]
 *  X3 second vless: balancer [vless proxy, vless proxy3, socks proxy2] (all plain)
 */
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = "/home/z/my-project/scripts/taskC4-live-tmp";
fs.mkdirSync(WORK, { recursive: true });
execFileSync("npx", ["esbuild", path.join(HERE, "taskC4-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${path.join(WORK, "c4.cjs")}`], { cwd: HERE, stdio: "pipe" });
const { generateV2RayConfig, DEFAULT_BUILDER_OPTIONS } = await import(path.join(WORK, "c4.cjs"));

const XRAY = "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const UUID = "b831381d-6324-4d53-ad4f-8cda48b30811";

const allocFreePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});
async function recorder(bind, port) {
  const hits = [];
  const srv = net.createServer(sock => {
    sock.on("data", d => { hits.push(String(d)); sock.end("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); });
    sock.on("error", () => {});
  });
  await new Promise(res => srv.listen(port, bind, res));
  return { hits, close: () => new Promise(res => srv.close(res)) };
}
const waitPort = (port, timeoutMs = 8000) => new Promise((resolve) => {
  const t0 = Date.now();
  const probe = () => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => { s.destroy(); if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(probe, 120); });
  };
  probe();
});
function socksGetMs(socksPort, targetIp, targetPort, path_, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const done = (r) => { try { s.destroy(); } catch {} resolve(r); };
    const s = net.connect(socksPort, "127.0.0.1");
    let stage = 0, buf = Buffer.alloc(0);
    const timer = setTimeout(() => done({ ok: false, error: "timeout" }), timeoutMs);
    s.on("error", (e) => { clearTimeout(timer); done({ ok: false, error: String(e.code || e) }); });
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) { if (buf.length < 2) return; buf = buf.subarray(2); stage = 1;
        const head = Buffer.alloc(10); head[0] = 5; head[1] = 1; head[2] = 0; head[3] = 1;
        targetIp.split(".").forEach((o, i) => { head[4 + i] = Number(o); }); head.writeUInt16BE(targetPort, 8);
        s.write(head);
      } else if (stage === 1) { if (buf.length < 4) return; if (buf[1] !== 0) { clearTimeout(timer); return done({ ok: false, error: `refused ${buf[1]}` }); }
        buf = buf.subarray(10); stage = 2;
        s.write(`GET ${path_} HTTP/1.1\r\nHost: ${targetIp}\r\nConnection: close\r\n\r\n`);
      } else { const m = buf.toString("latin1").match(/^HTTP\/1\.[01] (\d{3})/); if (m) { clearTimeout(timer); done({ ok: /^2/.test(m[1]), status: m[1] }); } }
    });
    s.on("connect", () => s.write(Buffer.from([5, 1, 0])));
  });
}
const spawnXray = (cfgPath) => {
  const child = spawn(XRAY, ["run", "-c", cfgPath], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  child.tail = "";
  child.stderr.on("data", (d) => { child.tail += String(d); });
  return child;
};
const statsQuery = (apiPort) => {
  const out = execFileSync(XRAY, ["api", "statsquery", "-s", `127.0.0.1:${apiPort}`], { encoding: "utf8", timeout: 8000 });
  return JSON.parse(out)?.stat ?? [];
};
const counterOf = (stats, tag, dir) =>
  stats.filter(s => s.name === `outbound>>>${tag}>>>traffic>>>${dir}`).reduce((a, s) => a + (Number(s.value) || 0), 0);

/* ---------- shared infrastructure (live-harness proven shapes) ---------- */
const serverPort = await allocFreePort();
const carrierPort = await allocFreePort();
const recPort = await allocFreePort();
const rec = await recorder("127.0.0.2", recPort);
fs.writeFileSync(path.join(WORK, "up-server.json"), JSON.stringify({
  log: { loglevel: "warning" },
  inbounds: [{ tag: "vless-in", port: serverPort, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" } }],
  outbounds: [{ protocol: "freedom", tag: "direct" }],
}));
fs.writeFileSync(path.join(WORK, "up-carrier.json"), JSON.stringify({
  log: { loglevel: "warning" },
  inbounds: [{ tag: "socks-in", port: carrierPort, listen: "127.0.0.1", protocol: "socks", settings: { auth: "noauth", udp: false } }],
  outbounds: [{ protocol: "freedom", tag: "direct" }],
}));
const server = spawnXray(path.join(WORK, "up-server.json"));
if (!await waitPort(serverPort)) { console.log("SERVER FAILED TO BOOT:", server.tail.slice(-300)); process.exit(1); }
const carrier = spawnXray(path.join(WORK, "up-carrier.json"));
if (!await waitPort(carrierPort)) { console.log("CARRIER FAILED TO BOOT:", carrier.tail.slice(-300)); process.exit(1); }

const vlessMain = { id: "m", protocol: "vless", name: "m", isValid: true, address: "127.0.0.1", port: serverPort, uuid: UUID, security: "none", network: "tcp" };
const socksExtra = { id: "s", protocol: "socks", name: "s", isValid: true, address: "127.0.0.1", port: carrierPort };

async function runCase(label, mutateOutbound, extras, strategy = "roundRobin") {
  const apiPort = await allocFreePort();
  const socksPort = await allocFreePort();
  const gen = generateV2RayConfig({ ...vlessMain }, "socks-http", socksPort, await allocFreePort(), apiPort,
    { ...DEFAULT_BUILDER_OPTIONS, logLevel: "warning" }, undefined,
    { chainHop: null, balancerExtras: extras, balancerStrategy: strategy });
  const cfg = JSON.parse(gen.json);
  if (mutateOutbound) mutateOutbound(cfg);
  const f = path.join(WORK, `up-${label}.json`);
  fs.writeFileSync(f, JSON.stringify(cfg));
  const child = spawnXray(f);
  const up = await waitPort(socksPort);
  if (!up) { console.log(`[${label}] CLIENT FAILED TO BOOT:`, child.tail.slice(-300)); child.kill("SIGKILL"); return; }
  const gets = [];
  for (let i = 0; i < 8; i++) gets.push(await socksGetMs(socksPort, "127.0.0.2", recPort, `/up-${label}-${i}`));
  const okCount = gets.filter(g => g.ok).length;
  const st = statsQuery(apiPort);
  const fmt = (t) => `up=${counterOf(st, t, "uplink")} down=${counterOf(st, t, "downlink")}`;
  console.log(`[${label}] GETs ok=${okCount}/8 | proxy ${fmt("proxy")} | ` +
    [...cfg.outbounds.map(o => o.tag)].filter(t => /^proxy\d+$/.test(t)).map(t => `${t} ${fmt(t)}`).join(" | "));
  child.kill("SIGKILL");
  await new Promise(r => setTimeout(r, 200));
}

await runCase("X1-plain-vless", null, [socksExtra]);
await runCase("X2-sockopt-nudge", (cfg) => {
  const p = cfg.outbounds.find(o => o.tag === "proxy");
  p.streamSettings = { ...(p.streamSettings || {}), sockopt: { tcpKeepAliveIdle: 300 } };
}, [socksExtra]);
await runCase("X3-two-vless", null, [socksExtra, { ...vlessMain, id: "v3", name: "v3" }]);

rec.close();
try { server.kill("SIGKILL"); } catch {}
try { carrier.kill("SIGKILL"); } catch {}
console.log("UP-PROBE DONE");
