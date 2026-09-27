#!/usr/bin/env node
/**
 * Phase D1 FORMAL SMOKE (user-approved 2026-09-17).
 * Batch D1 = item 10 live speed (KB/s) + item 6 Connect Best + item 8 IP/leak check.
 *
 * User-mandated scope:
 *   S0  real pinned Xray v25.1.1 binary gate.
 *   S1  full D1 structural surface via taskD1-quickcheck.mjs (27 assertions,
 *       incl. build freshness of the compiled main).
 *   S2  LIVE E2E replicating the net_check handler's BOTH probe paths against
 *       a REAL xray tunnel (user's sample server socks://Og@45.77.244.108:1080):
 *         - exit path  : ses.fetch on a session pinned to socks5://127.0.0.1:PORT
 *                        passes hostnames to SOCKS5 unresolved — the exact Node
 *                        equivalent is `curl --socks5-hostname`, so the smoke
 *                        drives that through the spawned REAL xray.
 *         - direct path: Node https (never proxied) — the handler's httpsGetText.
 *         - differential verdict (exit.ip != direct.ip) as the UI computes it,
 *         - warp field parsing (WARP chip logic),
 *         - dead-port honesty path (nothing listening -> clean error),
 *         - dns.getServers() informational row.
 *       Known boundary (also stated in the report): the Electron ses.fetch glue
 *       itself is structurally verified only (no electron binary in sandbox);
 *       section 18 of TESTING-CHECKLIST covers it on real Windows.
 *   S3  regression suites: task13-selftest + task13-cfgtest + task12-quickcheck.
 * Exit code 0 = all hard assertions passed.
 */
import net from "node:net";
import https from "node:https";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseSingleLink } = require("./task13-store.cjs");
const { generateV2RayConfig } = require("./task13-cfg.cjs");

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const WORK = process.env.TD1_WORK || "/home/z/my-project/scripts/taskD1-smoke-tmp";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = "/home/z/my-project/memento-src"; // app source root (in-tree scripts live under ROOT/scripts)

const SOCKS_PORT = 18081;
const HTTP_PORT = 18082;
const DEAD_PORT = 18999;
const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const SAMPLE_SERVER_IP = "45.77.244.108";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}
function info(msg) { console.log(`  INFO  ${msg}`); }

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

/* ================= S0: binary identity gate ================= */
console.log("== S0: real pinned binary gate ==");
{
  const v = spawnSync(XRAY, ["version"], { encoding: "utf8", timeout: 15000 });
  const out = (v.stdout || "") + (v.stderr || "");
  check("S0 real pinned binary is Xray 25.1.1", v.status === 0 && out.includes("Xray 25.1.1"), out.slice(0, 120));
}

/* ================= S1: structural surface (quickcheck) ================= */
console.log("\n== S1: D1 structural surface (taskD1-quickcheck) ==");
{
  const r = spawnSync("node", [path.join(ROOT, "scripts", "taskD1-quickcheck.mjs")], {
    encoding: "utf8", timeout: 120000, cwd: ROOT,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/RESULT:\s*(\d+) PASS \/ (\d+) FAIL/);
  const p = m ? Number(m[1]) : 0, f = m ? Number(m[2]) : 1;
  check(`S1 taskD1-quickcheck all green (27 expected, got ${p} PASS / ${f} FAIL)`, r.status === 0 && f === 0 && p >= 27, out.slice(-400));
  pass += p; // aggregate suite passes only; a failed suite is already recorded by check() above
}

/* ================= S2: live E2E — both net_check probe paths ================= */
console.log("\n== S2: live E2E — net_check both probe paths through REAL xray tunnel ==");

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
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port, timeout: 500 });
    s.on("connect", () => { s.destroy(); resolve(false); });
    s.on("error", () => { s.destroy(); resolve(true); });
  });
}

/** EXACT copy of ipc.ts parseTrace — validated against live Cloudflare bodies. */
function parseTrace(body) {
  const out = {};
  for (const line of body.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k === "ip") out.ip = v;
    else if (k === "loc") out.loc = v;
    else if (k === "warp") out.warp = v;
  }
  return out;
}

/** EXACT equivalent of the handler's httpsGetText (Node https, never proxied). */
const httpsGetText = (url, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if ((res.statusCode ?? 0) !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; if (data.length > 64 * 1024) req.destroy(new Error("Response too large")); });
      res.on("end", () => resolve(data));
    });
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
  });

/** Exit-path equivalent: curl --socks5-hostname (hostname unresolved -> SOCKS5),
 *  the same semantics as ses.fetch on a session pinned to socks5://127.0.0.1:PORT. */
const tunnelGetText = (url, port, timeoutMs) => {
  const r = spawnSync("curl", ["-sS", "--max-time", String(Math.ceil(timeoutMs / 1000)),
    "--socks5-hostname", `127.0.0.1:${port}`, url], { encoding: "utf8", timeout: timeoutMs + 5000 });
  return { body: r.stdout || "", exit: r.status, err: (r.stderr || "").trim() };
};

let xrayProc = null;
try {
  // S2.1 spawn REAL xray on the REAL pipeline output for the user's sample link
  const p = parseSingleLink("socks://Og@45.77.244.108:1080");
  check("S2.1 sample link parses via REAL parser", p.isValid && p.protocol === "socks", JSON.stringify({ isValid: p.isValid, err: p.errorMessage }));
  if (p.isValid) {
    const cfg = generateV2RayConfig(p, "socks-http", SOCKS_PORT, HTTP_PORT);
    check("S2.1 config generated", !!cfg?.json, "null config");
    if (cfg?.json) {
      const file = path.join(WORK, "sample.json");
      fs.writeFileSync(file, cfg.json);
      const t = spawnSync(XRAY, ["run", "-test", "-c", file], { encoding: "utf8", timeout: 30000 });
      const tout = (t.stdout || "") + (t.stderr || "");
      check("S2.1 xray -test = Configuration OK", t.status === 0 && tout.includes("Configuration OK"), tout.slice(0, 120));
      xrayProc = spawn(XRAY, ["run", "-c", file], { stdio: ["ignore", "pipe", "pipe"] });
      const up = await waitPort(SOCKS_PORT, 10000);
      check("S2.1 real xray tunnel listening on local socks port", up);

      if (up) {
        // S2.2 direct probe (handler's exact Node https path)
        let direct = { ok: false };
        try {
          const body = await httpsGetText(TRACE_URL, 12000);
          const t2 = parseTrace(body);
          if (t2.ip) direct = { ok: true, ip: t2.ip, loc: t2.loc, warp: t2.warp, body };
        } catch (e) { direct = { ok: false, error: String(e?.message || e) }; }
        check("S2.2 direct probe (Node https, never proxied) returned a trace", direct.ok, JSON.stringify(direct.error || ""));
        check("S2.2 direct probe ip/loc parsed", direct.ok && !!direct.ip && !!direct.loc, JSON.stringify(direct));

        // S2.3 exit probe through the REAL tunnel (ses.fetch equivalent path)
        const tun = tunnelGetText(TRACE_URL, SOCKS_PORT, 15000);
        const tExit = tun.body ? parseTrace(tun.body) : {};
        check("S2.3 tunnel probe (curl socks5-hostname = ses.fetch pinned-proxy semantics) returned a trace",
          tun.exit === 0 && !!tExit.ip, `curl exit=${tun.exit} err=${tun.err.slice(0, 80)}`);
        check("S2.3 exit IP = sample server egress (traffic really exits through the tunnel)",
          tExit.ip === SAMPLE_SERVER_IP || tExit.ip === `2001:19f0:4401:6a9:5400:4ff:fe5f:d520`,
          `exit ip=${tExit.ip} expected ${SAMPLE_SERVER_IP}`);
        check("S2.3 exit loc = SG (sample server region)", tExit.loc === "SG", `loc=${tExit.loc}`);

        // S2.4 differential verdict exactly as the UI computes it
        const differ = direct.ok && !!tExit.ip && tExit.ip !== direct.ip;
        check("S2.4 differential verdict: exit.ip != direct.ip -> 'proxy active' path", differ,
          `exit=${tExit.ip} direct=${direct.ip}`);

        // S2.5 warp field parsing (WARP chip logic; plain socks exit => warp=off -> chip hidden)
        check("S2.5 warp field present in tunnel trace body", tun.body.includes("warp="), tun.body.slice(0, 80));
        check("S2.5 parseTrace extracts warp", tExit.warp !== undefined, JSON.stringify(tExit));
        info(`- tunnel trace: warp=${tExit.warp} loc=${tExit.loc} ip=${tExit.ip} (warp=off -> chip hidden, as designed for plain socks)`);
        check("S2.5 plain-socks exit shows warp=off (chip correctly hidden)", tExit.warp === "off", `warp=${tExit.warp}`);
      }
    }
  }

  // S2.6 dead-port honesty path (nothing listening -> clean error, no false positive)
  console.log("\n== S2.6: dead-port honesty path ==");
  {
    const free = await portFree(DEAD_PORT);
    check("S2.6 dead port really has nothing listening", free);
    const dead = tunnelGetText(TRACE_URL, DEAD_PORT, 12000);
    check("S2.6 dead port -> clean probe failure (honest 'nothing is proxying' answer)",
      dead.exit !== 0 || !parseTrace(dead.body || "").ip, `curl exit=${dead.exit}`);
  }

  // S2.7 dns.getServers() informational row
  {
    let dnsServers = [];
    try { dnsServers = dns.getServers(); } catch { /* resolver list unavailable */ }
    check("S2.7 dns.getServers() returns the OS resolver list (card's DNS row source)",
      Array.isArray(dnsServers) && dnsServers.length > 0, JSON.stringify(dnsServers));
    info(`- OS resolvers: ${dnsServers.join(", ")}`);
  }
} finally {
  if (xrayProc) { try { xrayProc.kill("SIGKILL"); } catch { /* already gone */ } }
}

/* ================= S3: regression suites ================= */
console.log("\n== S3: regression suites ==");
for (const [label, script, min] of [
  ["task13-selftest", "task13-selftest.mjs", 25],
  ["task13-cfgtest", "task13-cfgtest.mjs", 4],
  ["task12-quickcheck", "task12-quickcheck.mjs", 7],
]) {
  const r = spawnSync("node", [path.join(HERE, script)], { encoding: "utf8", timeout: 180000, cwd: HERE });
  const out = (r.stdout || "") + (r.stderr || "");
  // two suite formats exist: "RESULT: N PASS / M FAIL" (task13/taskD1) and
  // "QUICK-CHECK: N assertions passed" (task12)
  let p = 0, f = 1;
  const m1 = out.match(/RESULT:\s*(\d+) PASS \/ (\d+) FAIL/);
  const m2 = out.match(/QUICK-CHECK:\s*(\d+) assertions passed/);
  if (m1) { p = Number(m1[1]); f = Number(m1[2]); }
  else if (m2) { p = Number(m2[1]); f = 0; }
  check(`S3 ${label} all green (${min} expected)`, r.status === 0 && f === 0 && p >= min, out.slice(-300));
  pass += p; // aggregate suite passes only; a failed suite is already recorded by check() above
}

/* ================= summary ================= */
console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail === 0 ? 0 : 1);
