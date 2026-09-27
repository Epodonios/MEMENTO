#!/usr/bin/env node
/**
 * Phase D2 FORMAL SMOKE (post review-fix: trojan mux + allowLan warning).
 *
 * S0  real-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 * S1  structural: in-tree taskD2-quickcheck.mjs (44 assertions)
 *     + dist freshness (new i18n keys present in the built singlefile)
 * S2  real-core config validation: taskD2-cfgtest.mjs (36 assertions,
 *     includes `xray run -test` on trojan+mux and sing-box check)
 * S3  LIVE mux data-path E2E (loopback, pinned binary):
 *     self-signed TLS trojan SERVER (xray) + REAL generator CLIENT with
 *     muxEnabled ON -> curl through the client's socks port must succeed;
 *     control run with mux OFF must also succeed. Proves the mux.cool
 *     client/server path end-to-end for the D2 review fix.
 * S4  LIVE allowLan E2E via the user's sample socks server:
 *     REAL generator (allowLan ON) -> xray -> /proc/net/tcp must show the
 *     socks port LISTENing on 00000000 (=0.0.0.0) -> curl trace through the
 *     tunnel must produce a differential exit IP (proxy active path).
 * S5  regression suite gates (task13-selftest / task13-cfgtest /
 *     task12-quickcheck / taskD1-quickcheck)
 *
 * Env overrides: XRAY_BIN, SB_BIN, T13_WORK, TD2_WORK
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN_TREE = join(process.env.T13_WORK || HERE, ""); // smoke runs from the in-tree copy
const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SINGBOX = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const WORK = process.env.TD2_WORK || "/home/z/my-project/scripts/taskD2-smoke-tmp";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`); }
};
const run = (cmd, args, opts = {}) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 60000, ...opts }); }
  catch (e) { return (e.stdout || "") + (e.stderr || ""); }
};

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

const SAMPLE = { id: "sample", name: "sample-socks", protocol: "socks", isValid: true, address: "45.77.244.108", port: 1080 };

/* ---------------- S0: binary gates ---------------- */
console.log("\n== S0 binary gates ==");
{
  const xv = run(XRAY, ["version"]) + run(XRAY, ["-version"]);
  ok("S0 xray is pinned v25.1.1", /Xray 25\.1\.1/.test(xv), xv.slice(0, 80).replace(/\n/g, " "));
  const sv = run(SINGBOX, ["version"]);
  ok("S0 sing-box is pinned 1.14.0", /1\.14\.0/.test(sv), sv.slice(0, 80).replace(/\n/g, " "));
}

/* ---------------- S1: structural ---------------- */
console.log("\n== S1 structural (taskD2-quickcheck) ==");
{
  const out = run("node", [join(IN_TREE, "taskD2-quickcheck.mjs")], { cwd: IN_TREE });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskD2-quickcheck 44 PASS / 0 FAIL", !!m && m[1] === "44" && m[2] === "0", out.slice(-400));
  const dist = fs.readFileSync(join(process.env.T13_DIST || "/home/z/my-project/memento-src/dist/index.html"), "utf8");
  ok("S1 dist fresh: allowLanWarning key built in", dist.includes("builder.allowLanWarning"));
  ok("S1 dist fresh: trojan listed in muxHint", dist.includes("vmess/vless/trojan"));
}

/* ---------------- S2: real-core config validation ---------------- */
console.log("\n== S2 real-core validation (taskD2-cfgtest) ==");
{
  const out = run("node", [join(IN_TREE, "taskD2-cfgtest.mjs")], {
    cwd: IN_TREE,
    env: { ...process.env, XRAY_BIN: XRAY, SB_BIN: SINGBOX, TD2_WORK: join(WORK, "cfgtest") },
  });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskD2-cfgtest 36 PASS / 0 FAIL (real binaries)", !!m && m[1] === "36" && m[2] === "0", out.slice(-500));
}

/* ---------------- live helpers ---------------- */
const waitPort = (port, timeoutMs = 15000) => new Promise((resolve) => {
  const t0 = Date.now();
  const probe = () => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => {
      s.destroy();
      if (Date.now() - t0 > timeoutMs) resolve(false); else setTimeout(probe, 250);
    });
  };
  probe();
});
const httpsGetText = (url, timeoutMs = 12000) => new Promise((resolve) => {
  const req = https.get(url, { timeout: timeoutMs, headers: { "User-Agent": "memento-d2-smoke" } }, (res) => {
    let body = ""; res.setEncoding("utf8");
    res.on("data", (c) => { body += c; if (body.length > 65536) req.destroy(); });
    res.on("end", () => resolve(body));
  });
  req.on("timeout", () => { req.destroy(new Error("timeout")); });
  req.on("error", (e) => resolve("ERR:" + e.message));
});
const curlSocks = (port, url, timeoutSec = 15) => {
  const r = spawnSync("curl", ["-s", "--max-time", String(timeoutSec), "--socks5-hostname", `127.0.0.1:${port}`, url], { encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
};
const parseTrace = (text) => {
  const kv = {};
  for (const line of text.split("\n")) { const i = line.indexOf("="); if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1); }
  return kv;
};
const spawnXray = (cfgFile, tag) => {
  const child = spawn(XRAY, ["run", "-c", cfgFile], { stdio: ["ignore", "pipe", "pipe"] });
  child.tag = tag;
  child.log = "";
  child.stdout.on("data", (d) => { child.log += d; });
  child.stderr.on("data", (d) => { child.log += d; });
  child.dead = new Promise((res) => child.once("exit", (code) => res(code)));
  return child;
};
const killTree = (child) => { try { child.kill("SIGKILL"); } catch { /* already gone */ } };

/* ---------------- S3: LIVE mux loopback E2E (trojan, REAL generator) ---------------- */
console.log("\n== S3 LIVE mux loopback (trojan server + REAL generator client) ==");
{
  const cert = join(WORK, "cert.pem"), key = join(WORK, "key.pem");
  const o = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert, "-days", "2", "-nodes", "-subj", "/CN=127.0.0.1"]);
  ok("S3 self-signed cert generated", o.status === 0 && fs.existsSync(cert) && fs.existsSync(key));

  const serverCfg = {
    log: { loglevel: "warning" },
    inbounds: [{
      tag: "trojan-in", listen: "127.0.0.1", port: 24443, protocol: "trojan",
      settings: { clients: [{ password: "tr-pw" }] },
      streamSettings: { network: "tcp", security: "tls", tlsSettings: { certificates: [{ certificateFile: cert, keyFile: key }] } },
    }],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  };
  const serverFile = join(WORK, "server-trojan.json");
  fs.writeFileSync(serverFile, JSON.stringify(serverCfg, null, 2));
  const srvTest = run(XRAY, ["run", "-test", "-c", serverFile]);
  ok("S3 server trojan config: xray -test OK", srvTest.includes("Configuration OK"), srvTest.slice(0, 140).replace(/\n/g, " "));

  const { generateV2RayConfig, DEFAULT_BUILDER_OPTIONS } = await import(join(IN_TREE, "taskD2-cfg.cjs"));
  const clientParsed = { id: "loop", name: "loop-trojan", protocol: "trojan", isValid: true, address: "127.0.0.1", port: 24443, password: "tr-pw", security: "tls", network: "tcp", sni: "127.0.0.1" };

  for (const muxOn of [true, false]) {
    const gen = generateV2RayConfig(clientParsed, "socks-only", 18081, 18082, undefined,
      { ...DEFAULT_BUILDER_OPTIONS, muxEnabled: muxOn });
    ok(`S3 generator produced client config (mux=${muxOn ? "ON" : "OFF"})`, !!gen?.json);
    const ob = JSON.parse(gen.json).outbounds.find(x => x.tag === "proxy");
    ok(`S3 client outbound shape (mux=${muxOn ? "ON" : "OFF"})`, muxOn
      ? JSON.stringify(ob.settings.mux) === JSON.stringify({ enabled: true, concurrency: 8 })
      : ob.settings.mux === undefined);
    const clientFile = join(WORK, `client-mux-${muxOn}.json`);
    fs.writeFileSync(clientFile, gen.json);
    const srv = spawnXray(serverFile, "server");
    try {
      ok(`S3 server port up (mux=${muxOn ? "ON" : "OFF"})`, await waitPort(24443));
      const cli = spawnXray(clientFile, "client");
      try {
        ok(`S3 client socks port up (mux=${muxOn ? "ON" : "OFF"})`, await waitPort(18081));
        const trace = parseTrace(curlSocks(18081, "https://www.cloudflare.com/cdn-cgi/trace"));
        ok(`S3 LIVE fetch through trojan${muxOn ? "+mux" : " plain"} tunnel`, !!trace.ip, JSON.stringify(trace).slice(0, 120));
        if (muxOn) console.log(`        (egress ip=${trace.ip || "?"} loc=${trace.loc || "?"} warp=${trace.warp || "?"})`);
      } finally { killTree(cli); await cli.dead; }
    } finally { killTree(srv); await srv.dead; }
  }
}

/* ---------------- S4: LIVE allowLan E2E via sample socks server ---------------- */
console.log("\n== S4 LIVE allowLan via sample server (0.0.0.0 binding + differential) ==");
{
  const { generateV2RayConfig, DEFAULT_BUILDER_OPTIONS } = await import(join(IN_TREE, "taskD2-cfg.cjs"));
  const gen = generateV2RayConfig(SAMPLE, "socks-http", 18081, 18082, undefined,
    { ...DEFAULT_BUILDER_OPTIONS, allowLan: true });
  ok("S4 generator produced allowLan config", !!gen?.json);
  const full = JSON.parse(gen.json);
  ok("S4 both inbounds listen 0.0.0.0 in JSON", full.inbounds.every(i => i.listen === "0.0.0.0"));
  const cfgFile = join(WORK, "allowlan.json");
  fs.writeFileSync(cfgFile, gen.json);
  const proc = spawnXray(cfgFile, "allowlan-xray");
  try {
    ok("S4 xray came up", await waitPort(18081));
    // /proc/net/tcp: columns = sl local_address rem_address st ... — LISTEN = st "0A".
    // 18081 = 0x46A1, 18082 = 0x46A2. IPv4 0.0.0.0 = "00000000"; also accept the
    // dual-stack tcp6 "::" row ("00000000000000000000000000000000") as 0.0.0.0.
    const readListenAddrs = (file) => {
      try {
        return fs.readFileSync(file, "utf8").split("\n").slice(1)
          .map(l => l.trim().split(/\s+/))
          .filter(c => c.length > 3 && c[3] === "0A")
          .map(c => c[1]);
      } catch { return []; }
    };
    const listen = [...readListenAddrs("/proc/net/tcp"), ...readListenAddrs("/proc/net/tcp6")];
    console.log(`        (LISTEN rows seen: ${listen.join(", ") || "none"})`);
    ok("S4 0.0.0.0 binding proven on socks port (kernel table)",
      listen.some(a => a === "00000000:46A1" || a === "00000000000000000000000000000000:46A1"));
    ok("S4 0.0.0.0 binding proven on http port (kernel table)",
      listen.some(a => a === "00000000:46A2" || a === "00000000000000000000000000000000:46A2"));
    const directText = await httpsGetText("https://www.cloudflare.com/cdn-cgi/trace");
    const direct = parseTrace(directText.startsWith("ERR:") ? "" : directText);
    const exit = parseTrace(curlSocks(18081, "https://www.cloudflare.com/cdn-cgi/trace"));
    ok("S4 differential verdict: exit IP != direct IP (proxy active)", !!exit.ip && !!direct.ip && exit.ip !== direct.ip,
      JSON.stringify({ exit: exit.ip, direct: direct.ip }));
    console.log(`        (tunnel egress ip=${exit.ip || "?"} loc=${exit.loc || "?"} warp=${exit.warp || "?"}; direct ip=${direct.ip || "?"} loc=${direct.loc || "?"})`);
  } finally { killTree(proc); await proc.dead; }
}

/* ---------------- S5: regression gates ---------------- */
console.log("\n== S5 regression suites ==");
{
  const suites = [
    ["task13-selftest", "RESULT: 25 PASS / 0 FAIL"],
    ["task13-cfgtest", "RESULT: 4 PASS / 0 FAIL"],
    ["taskD1-quickcheck", "RESULT: 27 PASS / 0 FAIL"],
  ];
  for (const [name, want] of suites) {
    const out = run("node", [join(IN_TREE, `${name}.mjs`)], { cwd: IN_TREE });
    ok(`S5 ${name} (${want})`, out.includes(want), out.slice(-300));
  }
  const out12 = run("node", [join(IN_TREE, "task12-quickcheck.mjs")], { cwd: IN_TREE });
  ok("S5 task12-quickcheck (7 assertions)", /QUICK-CHECK: 7 assertions passed/.test(out12), out12.slice(-300));
}

console.log(`\nFORMAL SMOKE D2: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
