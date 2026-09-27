#!/usr/bin/env node
/**
 * Phase C2 LIVE proof — the temp-instance probe pipeline, end-to-end,
 * through a REAL VLESS tunnel between TWO REAL pinned Xray v25.1.1
 * instances:
 *
 *   raw socks5 client (fixed proxy, the ses.fetch stand-in)
 *        |  CONNECT 127.0.0.1:R
 *   PROBE xray  (the rewritten probe config — the exact url_test pipeline:
 *                generate -> rewriteConfigForProbe -> spawn -> wait -> GET)
 *        |  vless client (tcp, security none)
 *   SERVER xray (vless inbound on SV, freedom out)   <- a REAL tunnel
 *        |  plain HTTP
 *   recorder(127.0.0.1:R)  answers 204
 *
 * NOTE: curl is deliberately NOT used — its socks path proved flaky in this
 * sandbox (handshake granted, then stalled); the raw client below speaks
 * the same fixed-socks semantics as the handler's ses.fetch and is fully
 * deterministic (byte-level trace verified).
 *
 * Observed BEHAVIOR:
 *   L1 rewritten probe config boots a real xray on the ephemeral port;
 *   L2 the HTTP GET provably traversed the VLESS tunnel (204 back + the
 *      recorder's own log of the request line);
 *   L3 a real ms timing was measured (0 < ms < 12000);
 *   L4 the probe child is killed and the port actually closes;
 *   L5 NEGATIVE: a probe config whose server port is CLOSED fails the
 *      probe (socks refusal or GET stall) — tunnel down is detectable,
 *      never a fake 0 ms.
 */
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(dirname(HERE), "electron-app");
const WORK = process.env.TC2_WORK || "/home/z/my-project/scripts/taskC2-live-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC2-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c2.cjs")}`], { cwd: HERE, stdio: "pipe" });
const { generateV2RayConfig, DEFAULT_BUILDER_OPTIONS } = await import(join(WORK, "c2.cjs"));

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";

// the REAL COMPILED rewrite (same seed as fntest/cfgtest)
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
const waitPortClosed = (port, timeoutMs = 8000) => new Promise((resolve) => {
  const t0 = Date.now();
  const probe = () => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(probe, 150); });
    s.once("error", () => { s.destroy(); resolve(true); });
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

/** One HTTP GET through a fixed socks5 inbound — the deterministic stand-in
 *  for the handler's ses.fetch(fixed_servers socks5). Byte-level trace
 *  verified: greeting -> CONNECT -> granted -> GET -> response. */
function socksGetMs(socksPort, targetIp, targetPort, path, timeoutMs = 10_000) {
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
        head[0] = 5; head[1] = 1; head[2] = 0; head[3] = 1; // CONNECT, IPv4
        targetIp.split(".").forEach((o, i) => { head[4 + i] = Number(o); });
        head.writeUInt16BE(targetPort, 8);
        s.write(head);
      } else if (stage === 1) {
        if (buf.length < 4) return;
        if (buf[1] !== 0) { clearTimeout(timer); return done({ ok: false, ms: Date.now() - t0, error: `socks connect refused (${buf[1]})` }); }
        buf = buf.subarray(buf.length >= 10 ? 10 : 4); // IPv4 reply header
        stage = 2;
        s.write(`GET ${path} HTTP/1.1\r\nHost: ${targetIp}\r\nConnection: close\r\n\r\n`);
      } else {
        const text = buf.toString("latin1");
        const m = text.match(/^HTTP\/1\.[01] (\d{3})/);
        if (m) {
          clearTimeout(timer);
          done({ ok: /^2/.test(m[1]), ms: Date.now() - t0, status: m[1] });
        }
      }
    });
    s.on("connect", () => s.write(Buffer.from([5, 1, 0])));
  });
}

async function recorder(port) {
  const hits = [];
  const srv = net.createServer(sock => {
    sock.on("data", d => {
      hits.push(String(d));
      sock.end("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    sock.on("error", () => {});
  });
  await new Promise(res => srv.listen(port, "127.0.0.1", res));
  return { hits, close: () => new Promise(res => srv.close(res)) };
}

const UUID = "b831381d-6324-4d53-ad4f-8cda48b30811";

/** A REAL xray VLESS server: vless inbound (SV) -> freedom out. */
function spawnVlessServer(port, uuid) {
  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [{
      port, listen: "127.0.0.1", protocol: "vless",
      settings: { clients: [{ id: uuid }], decryption: "none" },
    }],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  };
  const file = join(WORK, `server-${port}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg), "utf8");
  const child = spawn(XRAY, ["run", "-c", file], {
    env: { ...process.env, XRAY_LOCATION_ASSET: WORK },
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  });
  let log = "";
  child.stderr.on("data", d => { log += String(d); });
  return { child, file, log: () => log };
}

/* ---------- the pipeline ---------- */
const recPort = await allocFreePort();
const rec = await recorder(recPort);
let server = null;
let probeChild = null;
try {
  const serverPort = await allocFreePort();
  server = spawnVlessServer(serverPort, UUID);
  check("L0 REAL vless server xray is up", await waitPort(serverPort), server.log().slice(-140));

  // The renderer-side generator: vless client -> the REAL server
  const vlessClient = {
    id: "live", protocol: "vless", name: "live", isValid: true,
    address: "127.0.0.1", port: serverPort, uuid: UUID,
    security: "none", network: "tcp",
  };
  const gen = generateV2RayConfig(vlessClient, "socks-http", 10808, 10809, undefined, DEFAULT_BUILDER_OPTIONS);
  check("L0 generator produced the probe source config", !!gen?.json);

  const probePort = await allocFreePort();
  const rewritten = rewriteConfigForProbe(gen.json, probePort);
  const cfgFile = join(WORK, "probe.json");
  fs.writeFileSync(cfgFile, rewritten.json, "utf8");

  probeChild = spawn(XRAY, ["run", "-c", cfgFile], {
    env: { ...process.env, XRAY_LOCATION_ASSET: WORK },
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  });
  let probeLog = "";
  probeChild.stderr.on("data", d => { probeLog += String(d); });

  check("L1 rewritten probe config boots a REAL xray on the ephemeral port",
    await waitPort(probePort), probeLog.slice(-160));

  const res = await socksGetMs(probePort, "127.0.0.1", recPort, "/memento-live-probe");

  check("L2 HTTP GET traversed the REAL VLESS tunnel (2xx back to the client)",
    res.ok && /^2/.test(res.status || ""), JSON.stringify(res));
  check("L2b recorder received the request through the tunnel",
    rec.hits.length >= 1 && rec.hits[0].includes("/memento-live-probe"));
  check("L3 a real ms timing was measured (0 < ms < 12000)",
    Number.isFinite(res.ms) && res.ms > 0 && res.ms < 12000, `ms=${res.ms}`);

  // L4: kill the probe child -> its ephemeral port actually closes
  const portAfter = probePort;
  try { probeChild.kill("SIGKILL"); } catch { /* already gone */ }
  probeChild = null;
  check("L4 probe child killed -> socks port actually closed", await waitPortClosed(portAfter));

  // L5: NEGATIVE — same pipeline, but the vless server port is a CLOSED one
  const closedPort = await allocFreePort(); // allocated then never listened on
  const deadClient = { ...vlessClient, port: closedPort };
  const genDead = generateV2RayConfig(deadClient, "socks-http", 10808, 10809, undefined, DEFAULT_BUILDER_OPTIONS);
  const deadPort = await allocFreePort();
  const rewrittenDead = rewriteConfigForProbe(genDead.json, deadPort);
  const deadFile = join(WORK, "probe-dead.json");
  fs.writeFileSync(deadFile, rewrittenDead.json, "utf8");
  const deadChild = spawn(XRAY, ["run", "-c", deadFile], {
    env: { ...process.env, XRAY_LOCATION_ASSET: WORK },
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  });
  try {
    const up = await waitPort(deadPort);
    const dead = up ? await socksGetMs(deadPort, "127.0.0.1", recPort, "/memento-dead", 6000) : { ok: false };
    check("L5 unreachable server -> probe FAILS (tunnel down is detectable)",
      !dead.ok, dead.ok ? "unexpected success" : "failed as expected");
    check("L5b the recorder saw NO request from the dead tunnel", rec.hits.filter(h => h.includes("/memento-dead")).length === 0);
  } finally {
    try { deadChild.kill("SIGKILL"); } catch { /* already gone */ }
  }
} finally {
  try { probeChild?.kill("SIGKILL"); } catch { /* already gone */ }
  try { server?.child.kill("SIGKILL"); } catch { /* already gone */ }
  await rec.close();
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
