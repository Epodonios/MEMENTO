#!/usr/bin/env node
/**
 * taskE1-fntest.mjs — Phase E1 FUNCTIONAL test of the REAL compiled module
 * (dist-electron/connectionStats.js) against the REAL pinned cores, fully
 * loopback, single foreground lifecycle.
 *
 * The electron dependency of paths.ts is satisfied with a minimal stub
 * (app.isPackaged/getAppPath/getPath), and findXray() is steered to the
 * pinned xray binary through the dataDir() candidate (userData/xray/xray).
 *
 * F1: sing-box branch -> "per-connection" rows, live entries caught
 *     in-flight (slow held-open transfer), sorted by download desc.
 * F2: xray branch     -> "per-outbound" rows from statsquery, honest
 *     zero rows included, role hints tunnel/blocked.
 * F3: failure honesty -> wrong secret / dead port -> empty reply, never a
 *     throw.
 */
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import Module from "node:module";

const TMP = "/home/z/my-project/scripts/taskE1-fntest-tmp";
const SB = "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const XR = "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const MOD = "/home/z/my-project/memento-src/electron-app/dist-electron/connectionStats.js";

rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, "userdata", "xray"), { recursive: true });
symlinkSync(XR, join(TMP, "userdata", "xray", "xray"));

/* electron stub for paths.ts — patch Module._load BEFORE importing the
 * compiled CJS module: require('electron') inside dist-electron/*.js would
 * otherwise resolve to electron-app/node_modules/electron (which tries to
 * download a binary outside the electron runtime). */
const TMP_USERDATA = join(TMP, "userdata");
const STAMP = `E1FNT-${Date.now()}`;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        isPackaged: false,
        getAppPath: () => TMP,
        getPath: (k) => (k === "userData" ? TMP_USERDATA : TMP),
      },
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

/* loopback origin with a slow endpoint */
const BLOB = "E1FNT".repeat(8192);
const originSlow = createServer((_q, r) => {
  r.writeHead(200, { "content-type": "application/octet-stream" });
  let n = 0;
  const t = setInterval(() => { r.write(BLOB); if (++n > 10) { clearInterval(t); r.end(); } }, 300);
  _q.on("close", () => clearInterval(t));
});
await new Promise((res) => originSlow.listen(18960, "127.0.0.1", res));

const sh = (cmd, args) =>
  new Promise((res, rej) => execFile(cmd, args, { timeout: 9000 }, (err, stdout, stderr) =>
    err ? rej(Object.assign(err, { stdout, stderr })) : res(stdout)));

const waitPort = (port, ms = 6000) =>
  new Promise((res) => {
    const t0 = Date.now();
    const tick = () => {
      const net = spawn("bash", ["-c", `exec 3<>/dev/tcp/127.0.0.1/${port} && echo OPEN`], { stdio: "pipe" });
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

/* load the REAL compiled module with the electron stub active */
const { getConnectionStats } = await import(MOD);

let f1 = null, f2 = null, f3 = null;

/* ---- F1: sing-box per-connection through the real module -------------- */
{
  const cfg = {
    log: { level: "warn" },
    inbounds: [{ type: "http", tag: "http-in", listen: "127.0.0.1", listen_port: 18951 }],
    outbounds: [{ type: "direct", tag: "proxy" }],
    experimental: { clash_api: { external_controller: "127.0.0.1:18952", secret: "e1fnt" } },
  };
  const cfgPath = join(TMP, "sb.json");
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const child = spawn(SB, ["run", "-c", cfgPath], { stdio: ["ignore", "ignore", "pipe"] });
  let log = ""; child.stderr.on("data", (d) => (log += d));
  try {
    if (!(await waitPort(18952))) throw new Error("clash_api never opened: " + log);
    await sh("curl", ["-sS", "-o", "/dev/null", "--proxy", "http://127.0.0.1:18951", "http://127.0.0.1:18960/slow"]);
    const slow = sh("curl", ["-sS", "-o", "/dev/null", "--proxy", "http://127.0.0.1:18951", "http://127.0.0.1:18960/slow"]);
    await new Promise((r) => setTimeout(r, 1000)); // transfer in flight
    const reply = await getConnectionStats("sing-box", 18952, "e1fnt");
    await slow.catch(() => {});
    f1 = {
      core: reply.core,
      granularity: reply.granularity,
      totalLive: reply.totalLive,
      totalShown: reply.totalShown,
      rows: reply.connections.map((r) => ({
        label: r.label, network: r.network,
        download: r.download, upload: r.upload,
        chains: r.chains, rule: r.rule, role: r.role,
      })),
      sortedByDownloadDesc: reply.connections.every((r, i, a) =>
        i === 0 || (a[i - 1].download >= r.download)),
    };
  } finally { child.kill("SIGKILL"); }
}

/* ---- F2: xray per-outbound through the real module -------------------- */
{
  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks-in", listen: "127.0.0.1", port: 18953, protocol: "socks", settings: { auth: "noauth", udp: false } },
      { tag: "api", listen: "127.0.0.1", port: 18954, protocol: "dokodemo-door", settings: { address: "127.0.0.1" } },
    ],
    outbounds: [
      { protocol: "freedom", tag: "proxy" },
      { protocol: "blackhole", tag: "blocked" },
      { protocol: "freedom", tag: "direct" },
    ],
    routing: { rules: [{ type: "field", inboundTag: ["api"], outboundTag: "api" }] },
    api: { tag: "api", services: ["StatsService"] },
    stats: {},
    policy: { system: { statsOutboundUplink: true, statsOutboundDownlink: true } },
  };
  const cfgPath = join(TMP, "x.json");
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const child = spawn(XR, ["run", "-c", cfgPath], { stdio: ["ignore", "ignore", "pipe"] });
  let log = ""; child.stderr.on("data", (d) => (log += d));
  try {
    if (!(await waitPort(18954))) throw new Error("api never opened: " + log);
    for (let i = 0; i < 2; i++) {
      await sh("curl", ["-sS", "-o", "/dev/null", "--socks5", "127.0.0.1:18953", "http://127.0.0.1:18960/slow"]);
    }
    const reply = await getConnectionStats("xray", 18954, null);
    f2 = {
      core: reply.core,
      granularity: reply.granularity,
      totalLive: reply.totalLive,
      totalShown: reply.totalShown,
      rows: reply.connections.map((r) => ({
        label: r.label, role: r.role, download: r.download, upload: r.upload,
        network: r.network, chains: r.chains, start: r.start,
      })),
      sortedByDownloadDesc: reply.connections.every((r, i, a) =>
        i === 0 || (a[i - 1].download >= r.download)),
    };
  } finally { child.kill("SIGKILL"); }
}

/* ---- F3: failure honesty ---------------------------------------------- */
{
  const dead = await getConnectionStats("sing-box", 18999, "e1fnt");
  const noSecret = await getConnectionStats("sing-box", 18952, null);
  const deadX = await getConnectionStats("xray", 18999, null);
  f3 = {
    deadSingBox: { granularity: dead.granularity, connections: dead.connections, totalLive: dead.totalLive },
    nullSecret: { granularity: noSecret.granularity, connections: noSecret.connections },
    deadXray: { granularity: deadX.granularity, connections: deadX.connections, totalLive: deadX.totalLive },
  };
}

originSlow.close();
const out = { stamp: STAMP, F1_singbox: f1, F2_xray: f2, F3_failure_honesty: f3 };
writeFileSync(join(TMP, "fntest-e1.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

/* ---------- verdict: counted assertions over the captured evidence ------
 * (E1-close addendum: the evidence JSON above stays byte-identical in
 * shape; this block turns the harness into a counted battery suite with
 * the same "N PASS / M FAIL" contract as every other suite.) */
let vp = 0, vf = 0;
const vok = (label, cond) => {
  if (cond) { vp++; console.log(`  PASS  ${label}`); }
  else { vf++; console.log(`  FAIL  ${label}`); }
};

console.log("== F1 sing-box per-connection verdict ==");
vok("F1.core is sing-box", f1?.core === "sing-box");
vok("F1.granularity is per-connection", f1?.granularity === "per-connection");
vok("F1 at least one live row caught in-flight", (f1?.totalLive ?? 0) >= 1);
vok("F1 rows match totalShown", f1?.rows?.length === f1?.totalShown);
vok("F1 sorted by download desc", f1?.sortedByDownloadDesc === true);
vok("F1 at least one row carries transferred bytes", (f1?.rows ?? []).some((r) => r.download > 0));
vok("F1 every row has a non-empty label", (f1?.rows ?? []).every((r) => typeof r.label === "string" && r.label.length > 0));
vok("F1 chains name the proxy outbound", (f1?.rows ?? []).every((r) => Array.isArray(r.chains) && r.chains.includes("proxy")));

console.log("== F2 xray per-outbound verdict ==");
vok("F2.core is xray", f2?.core === "xray");
vok("F2.granularity is per-outbound", f2?.granularity === "per-outbound");
vok("F2 rows include proxy/blocked/direct tags",
  ["proxy", "blocked", "direct"].every((t) => (f2?.rows ?? []).some((r) => r.label === t)));
vok("F2 proxy row carries transferred bytes",
  (f2?.rows ?? []).some((r) => r.label === "proxy" && r.download > 0));
vok("F2 blocked row is an honest zero",
  (f2?.rows ?? []).some((r) => r.label === "blocked" && r.download === 0 && r.upload === 0));
vok("F2 direct row is an honest zero",
  (f2?.rows ?? []).some((r) => r.label === "direct" && r.download === 0));
vok("F2 role hints tunnel/blocked/direct",
  (f2?.rows ?? []).some((r) => r.label === "proxy" && r.role === "tunnel") &&
  (f2?.rows ?? []).some((r) => r.label === "blocked" && r.role === "blocked") &&
  (f2?.rows ?? []).some((r) => r.label === "direct" && r.role === "direct"));
vok("F2 sorted by download desc", f2?.sortedByDownloadDesc === true);
vok("F2 totalLive matches the row count", f2?.totalLive === f2?.rows?.length);

console.log("== F3 failure-honesty verdict ==");
vok("F3 dead sing-box port -> honest empty per-connection",
  f3?.deadSingBox?.granularity === "per-connection" &&
  Array.isArray(f3?.deadSingBox?.connections) && f3.deadSingBox.connections.length === 0 &&
  f3.deadSingBox.totalLive === 0);
vok("F3 null secret -> honest empty (no throw)",
  Array.isArray(f3?.nullSecret?.connections) && f3.nullSecret.connections.length === 0);
vok("F3 dead xray api -> honest empty per-outbound",
  f3?.deadXray?.granularity === "per-outbound" &&
  Array.isArray(f3?.deadXray?.connections) && f3.deadXray.connections.length === 0 &&
  f3.deadXray.totalLive === 0);

console.log(`taskE1-fntest: ${vp} PASS / ${vf} FAIL`);
process.exit(vf === 0 ? 0 : 1);
