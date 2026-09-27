#!/usr/bin/env node
/**
 * Phase C3 LIVE proof — the routing engine actually DECIDES, observed on a
 * real pinned Xray v25.1.1 through its own access log:
 *
 *   raw socks5 client (fixed proxy) -> PROBE xray (generated config,
 *   custom routing: blockIps 198.18.0.0/15, directIps 127.0.0.1/32)
 *        |  rule match -> [blocked] blackhole  (L1: fast refusal)
 *        |  rule match -> [direct]  freedom    (L2: recorder on 127.0.0.1)
 *        |  no match  -> [proxy]    vless tunnel -> SERVER xray -> freedom
 *        |                                     (L3: recorder on 127.0.0.2)
 *   PLUS (L4): a bypass-ir config (geosite:category-ir + geoip:ir +
 *   IPIfNonMatch, REAL geo assets) boots a real core and still forwards.
 *
 * The access log carries the matched OUTBOUND TAG per connection — the
 * honest discriminator that the routing DECISION (not just connectivity)
 * is correct. No DNS anywhere: all targets are literal IPs, so the proof
 * is deterministic in the sandbox (real-DNS behavior stays a checklist
 * manual item, section 24).
 */
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(dirname(HERE), "electron-app");
const WORK = process.env.TC3_WORK || "/home/z/my-project/scripts/taskC3-live-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC3-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c3.cjs")}`], { cwd: HERE, stdio: "pipe" });
const { generateV2RayConfig, DEFAULT_BUILDER_OPTIONS, DEFAULT_ROUTING_OPTIONS } = await import(join(WORK, "c3.cjs"));

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const XRAY_GEO_DIR = path.dirname(XRAY);
const UUID = "b831381d-6324-4d53-ad4f-8cda48b30811";

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

const waitPort = (port, timeoutMs = 10000) => new Promise((resolve) => {
  const t0 = Date.now();
  const probe = () => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => { s.destroy(); if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(probe, 150); });
  };
  probe();
});

function allocFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** recorder bound to a SPECIFIC loopback address (0.0.0.0 would blur the
 *  direct-vs-tunnel distinction; per-address binds keep it sharp). */
async function recorder(bind, port) {
  const hits = [];
  const srv = net.createServer(sock => {
    sock.on("data", d => {
      hits.push(String(d));
      sock.end("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    sock.on("error", () => {});
  });
  await new Promise(res => srv.listen(port, bind, res));
  return { hits, close: () => new Promise(res => srv.close(res)) };
}

/** The C2 raw socks5 client (byte-verified handshake), IP targets only. */
function socksGetMs(socksPort, targetIp, targetPort, path_, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const done = (r) => { try { s.destroy(); } catch { /* gone */ } resolve(r); };
    const s = net.connect(socksPort, "127.0.0.1");
    let stage = 0;
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => done({ ok: false, ms: Date.now() - t0, error: "timeout" }), timeoutMs);
    s.on("error", (e) => { clearTimeout(timer); done({ ok: false, ms: Date.now() - t0, error: String(e.code || e) }); });
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 5 || buf[1] !== 0) { clearTimeout(timer); return done({ ok: false, ms: Date.now() - t0, error: "socks greeting refused" }); }
        buf = buf.subarray(2);
        stage = 1;
        const head = Buffer.alloc(10);
        head[0] = 5; head[1] = 1; head[2] = 0; head[3] = 1;
        targetIp.split(".").forEach((o, i) => { head[4 + i] = Number(o); });
        head.writeUInt16BE(targetPort, 8);
        s.write(head);
      } else if (stage === 1) {
        if (buf.length < 4) return;
        if (buf[1] !== 0) { clearTimeout(timer); return done({ ok: false, ms: Date.now() - t0, error: `socks connect refused (${buf[1]})` }); }
        buf = buf.subarray(buf.length >= 10 ? 10 : 4);
        stage = 2;
        s.write(`GET ${path_} HTTP/1.1\r\nHost: ${targetIp}\r\nConnection: close\r\n\r\n`);
      } else {
        const text = buf.toString("latin1");
        const m = text.match(/^HTTP\/1\.[01] (\d{3})/);
        if (m) { clearTimeout(timer); done({ ok: /^2/.test(m[1]), ms: Date.now() - t0, status: m[1] }); }
      }
    });
    s.on("connect", () => s.write(Buffer.from([5, 1, 0])));
  });
}

/** Read the probe's access log and return the OUTBOUND TAG of the last
 *  connection whose TARGET port matches. REAL v25.1.1 info access lines:
 *   "... accepted tcp:198.18.0.1:80 [socks-in -> blocked]"  (rule-matched)
 *   "... accepted tcp:127.0.0.2:P [socks-in >> proxy]"     (default path) */
function accessTagFor(accessFile, port) {
  try {
    const lines = fs.readFileSync(accessFile, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/accepted tcp:\S*:(\d+) \[socks-in (->|>>) ([a-z-]+)\]/);
      if (m && Number(m[1]) === port) return m[3];
    }
  } catch { /* not written yet */ }
  return null;
}

function spawnXray(cfgFile, logTag) {
  const child = spawn(XRAY, ["run", "-c", cfgFile], {
    env: { ...process.env, XRAY_LOCATION_ASSET: XRAY_GEO_DIR },
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  });
  let err = "";
  child.stderr.on("data", d => { err += String(d); });
  return { child, tail: () => err.slice(-200) };
}

/* ---------------- the pipeline ---------------- */
const recDirectPort = await allocFreePort();
const recTunnelPort = await allocFreePort();
const recDirect = await recorder("127.0.0.1", recDirectPort);
const recTunnel = await recorder("127.0.0.2", recTunnelPort);
const accessFile = join(WORK, "probe-access.log");
let server = null, probeChild = null, geoChild = null;
try {
  const serverPort = await allocFreePort();
  {
    const cfg = {
      log: { loglevel: "warning" },
      inbounds: [{ port: serverPort, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" } }],
      outbounds: [{ protocol: "freedom", tag: "direct" }],
    };
    const f = join(WORK, "server.json");
    fs.writeFileSync(f, JSON.stringify(cfg), "utf8");
    server = spawnXray(f);
  }
  check("L0 REAL vless server xray is up", await waitPort(serverPort), server.tail());

  // probe instance: REAL generator output + C3 routing options
  const vlessClient = {
    id: "live", protocol: "vless", name: "live", isValid: true,
    address: "127.0.0.1", port: serverPort, uuid: UUID,
    security: "none", network: "tcp",
  };
  const routing = { ...DEFAULT_ROUTING_OPTIONS, preset: "custom",
    blockIps: "198.18.0.0/15", directIps: "127.0.0.1/32" };
  const gen = generateV2RayConfig(vlessClient, "socks-http", 10808, 10809, undefined,
    { ...DEFAULT_BUILDER_OPTIONS, logLevel: "info" }, routing);
  const probePort = await allocFreePort();
  const probeCfg = JSON.parse(gen.json);
  probeCfg.log.access = accessFile; // harness-only: route the access log to a file
  const probeFile = join(WORK, "probe.json");
  fs.writeFileSync(probeFile, JSON.stringify(probeCfg), "utf8");

  // Harness-only port placement: bind the generated socks inbound to the
  // ephemeral probe port (the app does this via rewriteConfigForProbe).
  probeCfg.inbounds.find(i => i.protocol === "socks").port = probePort;
  fs.writeFileSync(probeFile, JSON.stringify(probeCfg), "utf8");

  probeChild = spawnXray(probeFile);
  check("L1 probe xray boots on the ephemeral port", await waitPort(probePort), probeChild.tail());

  // L2: BLOCK rule — 198.18.0.0/15 -> blackhole. REAL blackhole semantics:
  // the connection is silently SWALLOWED (the GET stalls until the client
  // gives up) — never an HTTP response, never a tunnel attempt.
  const blocked = await socksGetMs(probePort, "198.18.0.1", 80, "/memento-block", 4000);
  check("L2 block rule: GET swallowed by blackhole (timeout, no response)",
    !blocked.ok && blocked.error === "timeout", JSON.stringify(blocked));
  check("L2b access log: rule-matched to [blocked]", accessTagFor(accessFile, 80) === "blocked", accessTagFor(accessFile, 80));

  // L3: DIRECT rule — 127.0.0.1/32 -> freedom straight to the local recorder
  const direct = await socksGetMs(probePort, "127.0.0.1", recDirectPort, "/memento-direct");
  check("L3 direct rule: HTTP GET reaches the 127.0.0.1 recorder WITHOUT the tunnel",
    direct.ok && /^2/.test(direct.status || ""), JSON.stringify(direct));
  check("L3b access log tags it [direct]", accessTagFor(accessFile, recDirectPort) === "direct", accessTagFor(accessFile, recDirectPort));

  // L4: DEFAULT -> [proxy] through the REAL vless tunnel to 127.0.0.2
  const via = await socksGetMs(probePort, "127.0.0.2", recTunnelPort, "/memento-via-tunnel");
  check("L4 default path goes through the REAL vless tunnel (127.0.0.2 recorder hit)",
    via.ok && /^2/.test(via.status || ""), JSON.stringify(via));
  check("L4b access log tags it [proxy]", accessTagFor(accessFile, recTunnelPort) === "proxy", accessTagFor(accessFile, recTunnelPort));

  // L5: bypass-ir (geo rules + IPIfNonMatch) boots a REAL core and forwards
  const genGeo = generateV2RayConfig(vlessClient, "socks-http", 10808, 10809, undefined,
    DEFAULT_BUILDER_OPTIONS, { ...DEFAULT_ROUTING_OPTIONS, preset: "bypass-ir" });
  const geoPort = await allocFreePort();
  const geoCfg = JSON.parse(genGeo.json);
  geoCfg.log.access = join(WORK, "geo-access.log");
  geoCfg.inbounds.find(i => i.protocol === "socks").port = geoPort;
  const geoFile = join(WORK, "probe-geo.json");
  fs.writeFileSync(geoFile, JSON.stringify(geoCfg), "utf8");
  geoChild = spawnXray(geoFile);
  check("L5 bypass-ir config (geosite:category-ir + geoip:ir, IPIfNonMatch) boots a REAL core",
    await waitPort(geoPort), geoChild.tail());
  const viaGeo = await socksGetMs(geoPort, "127.0.0.2", recTunnelPort, "/memento-geo");
  check("L5b geo-configured core still forwards unmatched traffic through the tunnel",
    viaGeo.ok && /^2/.test(viaGeo.status || ""), JSON.stringify(viaGeo));
  check("L5c access log tags it [proxy] (geo rules do not swallow the default path)",
    accessTagFor(join(WORK, "geo-access.log"), recTunnelPort) === "proxy");
} finally {
  try { probeChild?.child.kill("SIGKILL"); } catch { /* gone */ }
  try { geoChild?.child.kill("SIGKILL"); } catch { /* gone */ }
  try { server?.child.kill("SIGKILL"); } catch { /* gone */ }
  await recDirect.close();
  await recTunnel.close();
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
