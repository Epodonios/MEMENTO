#!/usr/bin/env node
/**
 * Phase C4 LIVE proof — real pinned Xray v25.1.1 instances, real bytes,
 * real per-outbound stats (the exact mechanism behind the C1 speed chart
 * and the D1 totals):
 *
 *   CARRIER xray (socks-in :carrierPort -> freedom)   [the chain hop]
 *   SERVER  xray (vless-in :serverPort   -> freedom)  [the tunnel exit]
 *   CLIENT  xray (PRODUCT generator output, stats API on apiPort)
 *
 *   C1  chain traversal: client = vless(proxy) + sockopt.dialerProxy ->
 *       chain-hop(socks -> CARRIER). A GET through the client exits via
 *       SERVER, and the CARRIER's access log proves the server dial was
 *       made THROUGH the hop (target port = serverPort).
 *   C2  chain stats: BOTH `outbound>>>proxy` and `outbound>>>chain-hop`
 *       counters move for the same bytes — the double-count hazard is
 *       real, so the counted set must stay ["proxy"] (product contract).
 *   C3  chain NEGATIVE: killing the CARRIER kills the path (the hop is
 *       load-bearing, not decorative).
 *   B1  balancer alternation: client = vless(proxy) + socks(proxy2 ->
 *       CARRIER), strategy roundRobin, catch-all -> balancer. Eight GETs:
 *       access-log-proven 4/4 alternation; downlink counters move for
 *       BOTH members; the VLESS member's UPLINK counter is PINNED at 0
 *       (documented Xray v25.1.1 core gap, probed X1-X3 in
 *       taskC4-uplink-probe.mjs — its downlink and the socks member
 *       count fine).
 *   B2  THE REVIEW PROOF: from the SAME statsquery — old counting
 *       (">>>proxy>>>" only) under-reports the pool's uplink (misses the
 *       proxy2 share AND the core-uncounted vless uplink); the product's
 *       member-tag sum reports everything the core counts. Also pins the
 *       real stat name shape `outbound>>>proxy2>>>traffic>>>uplink`.
 */
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TC4_WORK || "/home/z/my-project/scripts/taskC4-live-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC4-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c4.cjs")}`], { cwd: HERE, stdio: "pipe" });
const { generateV2RayConfig, DEFAULT_BUILDER_OPTIONS } = await import(join(WORK, "c4.cjs"));

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

/** C2 raw socks5 client (byte-verified), IP targets only. */
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

function accessTagFor(accessFile, port) {
  try {
    const lines = fs.readFileSync(accessFile, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/accepted tcp:\S*:(\d+) \[([a-z-]+) (->|>>) ([a-z-]+)\]/);
      if (m && Number(m[1]) === port) return { inbound: m[2], outbound: m[4] };
    }
  } catch { /* not written yet */ }
  return null;
}

function spawnXray(cfgFile) {
  const child = spawn(XRAY, ["run", "-c", cfgFile], {
    env: { ...process.env, XRAY_LOCATION_ASSET: XRAY_GEO_DIR },
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  });
  let err = "";
  child.stderr.on("data", d => { err += String(d); });
  return { child, tail: () => err.slice(-200) };
}

/** Real `xray api statsquery` — the exact helper xray.ts shells out to. */
function statsQuery(apiPort) {
  const out = execFileSync(XRAY, ["api", "statsquery", "-s", `127.0.0.1:${apiPort}`], { encoding: "utf8", timeout: 8000 });
  return JSON.parse(out)?.stat ?? [];
}
const counterOf = (stats, tag, dir) =>
  stats.filter(s => s.name === `outbound>>>${tag}>>>traffic>>>${dir}`).reduce((a, s) => a + (Number(s.value) || 0), 0);
/** The PRODUCT counting rule (xray.ts): includes-based member-tag sum. */
const productCount = (stats, tags, dir) => {
  const ms = tags.map(t => `>>>${t}>>>traffic>>>${dir}`);
  return stats.filter(s => ms.some(m => String(s.name || "").includes(m))).reduce((a, s) => a + (Number(s.value) || 0), 0);
};

function writeCfg(name, cfg) { const f = join(WORK, `${name}.json`); fs.writeFileSync(f, JSON.stringify(cfg), "utf8"); return f; }

/* ---------------- instances ---------------- */
const recPort = await allocFreePort();
const rec = await recorder("127.0.0.2", recPort); // loopback alias = "the internet"
const recLocalPort = await allocFreePort();
const recLocal = await recorder("127.0.0.1", recLocalPort);

const serverPort = await allocFreePort();
const carrierPort = await allocFreePort();
const apiPort = await allocFreePort();

const serverAccess = join(WORK, "server-access.log");
const carrierAccess = join(WORK, "carrier-access.log");

let server = null, carrier = null, chainClient = null, balClient = null;
try {
  // SERVER: vless inbound -> freedom
  server = spawnXray(writeCfg("server", {
    log: { loglevel: "info", access: serverAccess },
    inbounds: [{ tag: "vless-in", port: serverPort, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" } }],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  }));
  check("S0 REAL vless server is up", await waitPort(serverPort), server.tail());

  const spawnCarrier = () => {
    const c = spawnXray(writeCfg("carrier", {
      log: { loglevel: "info", access: carrierAccess },
      inbounds: [{ tag: "socks-in", port: carrierPort, listen: "127.0.0.1", protocol: "socks", settings: { auth: "noauth", udp: false } }],
      outbounds: [{ protocol: "freedom", tag: "direct" }],
    }));
    return c;
  };
  carrier = spawnCarrier();
  check("S0b REAL carrier (chain hop) is up", await waitPort(carrierPort), carrier.tail());

  /* ---------------- C1/C2: CHAIN (product generator output) ---------------- */
  const chainGen = generateV2RayConfig(
    { id: "chain", protocol: "vless", name: "chain", isValid: true, address: "127.0.0.1", port: serverPort, uuid: UUID, security: "none", network: "tcp" },
    "socks-http", 14001, 14002, apiPort, { ...DEFAULT_BUILDER_OPTIONS, logLevel: "info" }, undefined,
    { chainHop: { id: "hop", protocol: "socks", name: "hop", isValid: true, address: "127.0.0.1", port: carrierPort }, balancerExtras: [] },
  );
  const chainCfg = JSON.parse(chainGen.json);
  chainCfg.log.access = join(WORK, "chain-access.log");
  chainCfg.inbounds.find(i => i.protocol === "socks").port = 14001;
  const chainClientFile = writeCfg("chain-client", chainCfg);
  chainClient = spawnXray(chainClientFile);
  check("C0 chained client (product output) boots with the Stats API", await waitPort(14001), chainClient.tail());

  const chainGet = await socksGetMs(14001, "127.0.0.2", recPort, "/memento-chain");
  check("C1 chain GET reaches the recorder through hop -> vless tunnel", chainGet.ok && /^2/.test(chainGet.status || ""), JSON.stringify(chainGet));
  const carrierHit = accessTagFor(carrierAccess, serverPort);
  check("C1b carrier access log proves the server dial went THROUGH the hop", carrierHit?.outbound === "direct", JSON.stringify(carrierHit));
  const serverHit = accessTagFor(serverAccess, recPort);
  check("C1c server access log shows the unwrapped target", serverHit?.outbound === "direct", JSON.stringify(serverHit));

  // C2: per-outbound counters — the double-count hazard is REAL
  let stats = statsQuery(apiPort);
  const pUp = counterOf(stats, "proxy", "uplink");
  const hopUp = counterOf(stats, "chain-hop", "uplink");
  const pDown = counterOf(stats, "proxy", "downlink");
  const hopDown = counterOf(stats, "chain-hop", "downlink");
  check("C2 chain: tunnel tag counter moved", pUp > 0 && pDown > 0, `proxy up=${pUp} down=${pDown}`);
  check("C2b chain: CARRIER tag counter ALSO moved (double-count hazard is real)",
    hopUp > 0 && hopDown > 0, `chain-hop up=${hopUp} down=${hopDown}`);
  check("C2c product rule counts [proxy] ONLY — never the sum (sum would inflate by the carrier copy)",
    productCount(stats, ["proxy"], "uplink") === pUp && productCount(stats, ["proxy"], "uplink") < pUp + hopUp);

  // C3: the hop is load-bearing — kill the carrier, the path dies
  try { carrier.child.kill("SIGKILL"); } catch { /* gone */ }
  await new Promise(r => setTimeout(r, 400));
  const deadHop = await socksGetMs(14001, "127.0.0.2", recPort, "/memento-dead-hop", 4000);
  check("C3 NEGATIVE: killing the carrier kills the chained path", !deadHop.ok, JSON.stringify(deadHop));
  carrier = spawnCarrier(); // restore for the balancer half
  check("C3b carrier restored", await waitPort(carrierPort), carrier.tail());

  /* ---------------- B1/B2: BALANCER (product generator output) ---------------- */
  const balGen = generateV2RayConfig(
    { id: "bal", protocol: "vless", name: "bal", isValid: true, address: "127.0.0.1", port: serverPort, uuid: UUID, security: "none", network: "tcp" },
    "socks-http", 14011, 14012, apiPort + 1, { ...DEFAULT_BUILDER_OPTIONS, logLevel: "info" }, undefined,
    { chainHop: null, balancerExtras: [{ id: "extra", protocol: "socks", name: "extra", isValid: true, address: "127.0.0.1", port: carrierPort }], balancerStrategy: "roundRobin" },
  );
  const balCfg = JSON.parse(balGen.json);
  balCfg.log.access = join(WORK, "bal-access.log");
  balCfg.inbounds.find(i => i.protocol === "socks").port = 14011;
  const balClientFile = writeCfg("bal-client", balCfg);
  check("B0 balancer config shape: catch-all -> balancer, members proxy+proxy2",
    balCfg.routing.balancers?.[0]?.tag === "balancer" && JSON.stringify(balCfg.routing.balancers[0].selector) === '["proxy"]' && balCfg.routing.rules.at(-1)?.balancerTag === "balancer");
  balClient = spawnXray(balClientFile);
  check("B0b balancer client (product output) boots", await waitPort(14011), balClient.tail());

  const gets = [];
  for (let i = 0; i < 8; i++) {
    gets.push(await socksGetMs(14011, "127.0.0.2", recPort, `/memento-bal-${i}`));
  }
  check("B1 eight GETs through the balancer all succeed", gets.every(g => g.ok), JSON.stringify(gets.filter(g => !g.ok)));

  stats = statsQuery(apiPort + 1);
  if (process.env.TC4_DEBUG) {
    console.log("  [DEBUG] raw stats on the balancer instance:");
    for (const s of stats) console.log("    ", s.name, "=", s.value);
  }
  const bProxyUp = counterOf(stats, "proxy", "uplink");
  const bProxyDown = counterOf(stats, "proxy", "downlink");
  const bProxy2Up = counterOf(stats, "proxy2", "uplink");
  const bProxy2Down = counterOf(stats, "proxy2", "downlink");
  // RoundRobin alternation is proven from the ACCESS LOG (deterministic:
  // 8 fresh connections -> exactly 4 selections per member). The COUNTER
  // half carries a documented Xray v25.1.1 core gap: a VLESS member
  // selected via a balancer never increments its UPLINK counter (its
  // downlink counts fine; non-vless members count both — probed X1-X3 in
  // taskC4-uplink-probe.mjs). So B1b2 asserts the DOWNLINK counters the
  // core does count, and B1b3 PINS the core gap itself (if a future core
  // fixes it, this pin fails and gets consciously re-pointed — the
  // established pin discipline).
  const acc = fs.readFileSync(join(WORK, "bal-access.log"), "utf8");
  const viaProxy = (acc.match(/\[socks-in -> proxy\]/g) || []).length;
  const viaProxy2 = (acc.match(/\[socks-in -> proxy2\]/g) || []).length;
  check("B1b roundRobin alternated 4/4 across the members (access-log proven)",
    viaProxy === 4 && viaProxy2 === 4, `via proxy=${viaProxy} proxy2=${viaProxy2}`);
  check("B1b2 BOTH members' downlink counters moved (the counted half of the pool)",
    bProxyDown > 0 && bProxy2Down > 0 && bProxy2Up > 0,
    `proxy down=${bProxyDown} proxy2 up=${bProxy2Up} down=${bProxy2Down}`);
  check("B1b3 CORE GAP pinned: balancer-selected VLESS member's uplink stays 0 while its downlink moved (Xray v25.1.1)",
    bProxyUp === 0 && bProxyDown > 0, `proxy up=${bProxyUp} down=${bProxyDown}`);
  check("B1c real stat name shape carries the proxy2 family tag",
    stats.some(s => s.name === "outbound>>>proxy2>>>traffic>>>uplink"));

  // B2: THE REVIEW PROOF — old counting vs the product's member-tag sum.
  // On the UPLINK leg the old ">>>proxy>>>"-only counting under-reports
  // twice over: it excludes the proxy2 share AND the core itself doesn't
  // count the vless member's uplink (B1b3). The member-tag sum captures
  // everything the core does count.
  const oldUp = productCount(stats, ["proxy"], "uplink");
  const newUp = productCount(stats, ["proxy", "proxy2"], "uplink");
  check("B2 OLD counting (proxy-only uplink) under-reports the pool (misses the proxy2 share AND the core-uncounted vless uplink)",
    oldUp < newUp, `old=${oldUp} new=${newUp}`);
  check("B2b NEW counting (member-tag sum) reports the whole truth", newUp === oldUp + bProxy2Up, `new=${newUp}`);
  const oldDown = productCount(stats, ["proxy"], "downlink");
  const newDown = productCount(stats, ["proxy", "proxy2"], "downlink");
  check("B2c same asymmetry on the downlink (D1 totals leg)", newDown > oldDown, `old=${oldDown} new=${newDown}`);
} finally {
  for (const inst of [chainClient, balClient, carrier, server]) {
    try { inst?.child.kill("SIGKILL"); } catch { /* gone */ }
  }
  await rec.close();
  await recLocal.close();
}

console.log(`\nC4-LIVE: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
