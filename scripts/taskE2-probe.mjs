#!/usr/bin/env node
/**
 * taskE2-probe.mjs — Phase E / Batch E2 DESIGN-TIME live probe (2026-09-21).
 *
 * Purpose: capture TODAY, against the PINNED cores, the exact live evidence
 * the E2 (ShadowTLS parser) design report needs — nothing inferred from docs
 * or old unsealed reports:
 *
 *   P0  pin re-verification: sing-box 1.14.0 + xray 25.1.1 version strings.
 *   P1  sing-box 1.14.0 shadowtls OUTBOUND schema matrix via `sing-box check`
 *       (required fields per version, accepted version range, strict
 *       unknown-field rejection — the generator's field contract).
 *   P2  xray 25.1.1 — live re-verification that ShadowTLS is REJECTED
 *       (the user's standing discovery, re-proven against today's binary).
 *   P3  sing-box shadowtls INBOUND without detour — schema + runtime
 *       acceptance (is a bare shadowtls server even runnable?).
 *   P4  FULL loopback E2E: client trojan-over-shadowtls (detour pair) ->
 *       server shadowtls-inbound detour trojan-in -> direct -> local HTTP
 *       origin, with a real HTTPS handshake origin for the camouflage.
 *       Proves the EXACT outbound pair the generator would emit.
 *   P5  bare shadowtls outbound (no inner protocol) against the SAME live
 *       server — documents WHY the MEMENTO scheme must carry an inner
 *       protocol (raw stream cannot terminate on the server).
 *
 * Everything is loopback, one foreground lifecycle per core, always killed
 * in finally. Exit 0 = probe completed and artifacts written (negative
 * cases "failing as expected" is EVIDENCE, not a probe failure).
 */
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import https from "node:https";

const TMP = "/home/z/my-project/scripts/taskE2-live-tmp";
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

const clip = (s, n = 4000) => String(s || "").slice(-n);

/* self-signed cert for the HTTPS handshake-camouflage origin */
const CERT = join(TMP, "camo-cert.pem");
const KEY = join(TMP, "camo-key.pem");
await sh("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", KEY,
  "-out", CERT, "-days", "2", "-nodes", "-subj", "/CN=camo.local"]);
const tlsOpts = { key: readFileSync(KEY), cert: readFileSync(CERT) };

/* ---------- origins: plain HTTP payload + HTTPS handshake target ---------- */
const BLOB = "E2PROBE".repeat(2048); // 14 KB per GET
const origin = createServer((_q, r) => { r.writeHead(200, { "content-type": "application/octet-stream" }); r.end(BLOB); });
const camo = https.createServer(tlsOpts, (_q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("camo-tls-origin"); });
await new Promise((res) => origin.listen(19010, "127.0.0.1", res));
await new Promise((res) => camo.listen(19011, "127.0.0.1", res));

const viaCurl = (proxyPort, timeoutS = 8) => sh("curl", [
  "-sS", "-o", "/dev/null", "-w", "%{http_code}:%{size_download}",
  "--max-time", String(timeoutS), "--proxy", `socks5://127.0.0.1:${proxyPort}`,
  "http://127.0.0.1:19010/blob"]);

const out = { probedAt: new Date().toISOString(), P0_pins: null, P1_sbOutboundMatrix: null,
  P2_xrayRejection: null, P3_serverNoDetour: null, P4_e2ePaired: null, P5_e2eBare: null };

/* ---------------- P0: pin re-verification ---------------- */
out.P0_pins = {
  singbox: (await sh(SB, ["version"])).split("\n")[0].trim(),
  xray: (await sh(XR, ["version"])).split("\n")[0].trim(),
};

/* ---------------- P1: shadowtls outbound schema matrix ---------------- */
{
  const v3 = (extra = {}, omit = {}) => ({
    log: { level: "warn" },
    outbounds: [{
      type: "shadowtls", tag: "proxy",
      server: "127.0.0.1", server_port: 19012,
      ...omit,
      ...(Object.keys(extra).length ? extra : {}),
    }],
  });
  const FULL = { version: 3, password: "e2-stls-pass",
    tls: { enabled: true, server_name: "camo.local" } };
  const cases = [
    { name: "A_v3_full",            cfg: v3(FULL),                              expect: "PASS" },
    { name: "A2_v3_fields_no_version_key", cfg: v3({ password: FULL.password, tls: FULL.tls }), expect: "?" },
    { name: "B_v3_no_password",     cfg: v3({ version: 3, tls: FULL.tls }),     expect: "FAIL" },
    { name: "C_v3_no_tls",          cfg: v3({ version: 3, password: "p" }),     expect: "?" },
    { name: "D_v1_minimal",         cfg: v3({ version: 1 }),                    expect: "?" },
    { name: "E_v2_password_no_tls", cfg: v3({ version: 2, password: "p" }),     expect: "?" },
    { name: "F_version_4",          cfg: v3({ version: 4, password: "p", tls: FULL.tls }), expect: "FAIL" },
    { name: "G_v3_bogus_field",     cfg: v3({ ...FULL, bogus_field: 1 }),       expect: "FAIL" },
  ];
  const results = [];
  for (const c of cases) {
    const p = join(TMP, `chk-${c.name}.json`);
    writeFileSync(p, JSON.stringify(c.cfg, null, 2));
    const r = await new Promise((res) => {
      execFile(SB, ["check", "-c", p], { timeout: 8000 }, (err, stdout, stderr) =>
        res({ exitCode: err ? (err.code ?? "ERR") : 0, ok: !err,
          text: clip((stderr || stdout || "").trim(), 400) }));
    });
    results.push({ name: c.name, expect: c.expect, ...r });
  }
  out.P1_sbOutboundMatrix = results;
}

/* ---------------- P2: xray 25.1.1 rejects shadowtls ---------------- */
{
  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [{ tag: "socks-in", listen: "127.0.0.1", port: 19040, protocol: "socks", settings: { auth: "noauth", udp: false } }],
    outbounds: [{ protocol: "shadowtls", tag: "proxy", settings: {} }],
  };
  const p = join(TMP, "x-e2.json");
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  out.P2_xrayRejection = await new Promise((res) => {
    execFile(XR, ["run", "-test", "-c", p], { timeout: 8000 }, (err, stdout, stderr) =>
      res({ exitCode: err ? (err.code ?? "ERR") : 0, ok: !err,
        text: clip((stderr || stdout || "").trim(), 600) }));
  });
}

/* ---------------- P3: server shadowtls inbound WITHOUT detour ---------------- */
{
  const cfg = {
    log: { level: "warn" },
    inbounds: [{
      type: "shadowtls", tag: "stls-in",
      listen: "127.0.0.1", listen_port: 19030,
      version: 3, users: [{ password: "e2-stls-pass" }],
      handshake: { server: "127.0.0.1", server_port: 19011 },
    }],
    outbounds: [{ type: "direct", tag: "direct" }],
  };
  const p = join(TMP, "srv-nodetour.json");
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  const chk = await new Promise((res) => {
    execFile(SB, ["check", "-c", p], { timeout: 8000 }, (err, stdout, stderr) =>
      res({ exitCode: err ? (err.code ?? "ERR") : 0, ok: !err, text: clip((stderr || stdout || "").trim(), 400) }));
  });
  let run = null;
  if (chk.ok) {
    const child = spawn(SB, ["run", "-c", p], { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    try {
      const started = await waitPort(19030, 4000);
      run = { started, log: clip(log, 800) };
    } finally { child.kill("SIGKILL"); }
  }
  out.P3_serverNoDetour = { check: chk, run };
}

/* -------- shared live server for P4/P5: shadowtls-in detour trojan-in ------- */
const STLS_PASS = "e2-stls-pass";
const TROJ_PASS = "e2-trojan-pass";
const srvCfg = {
  log: { level: "warn" },
  inbounds: [
    {
      type: "shadowtls", tag: "stls-in",
      listen: "127.0.0.1", listen_port: 19012,
      version: 3, users: [{ password: STLS_PASS }],
      handshake: { server: "127.0.0.1", server_port: 19011 },
      detour: "trojan-in",
    },
    {
      type: "trojan", tag: "trojan-in",
      listen: "127.0.0.1", listen_port: 19013,
      users: [{ password: TROJ_PASS }],
    },
  ],
  outbounds: [{ type: "direct", tag: "direct" }],
  route: { final: "direct" },
};
const srvPath = join(TMP, "srv-paired.json");
writeFileSync(srvPath, JSON.stringify(srvCfg, null, 2));
const srvChk = await new Promise((res) => {
  execFile(SB, ["check", "-c", srvPath], { timeout: 8000 }, (err, stdout, stderr) =>
    res({ exitCode: err ? (err.code ?? "ERR") : 0, ok: !err, text: clip((stderr || stdout || "").trim(), 400) }));
});
if (!srvChk.ok) throw new Error("P4 server config failed check: " + srvChk.text);
const srv = spawn(SB, ["run", "-c", srvPath], { stdio: ["ignore", "pipe", "pipe"] });
let srvLog = "";
srv.stdout.on("data", (d) => (srvLog += d));
srv.stderr.on("data", (d) => (srvLog += d));
try {
  const up = await waitPort(19012);
  if (!up) throw new Error("E2 server stls port never opened; log:\n" + clip(srvLog));

  /* -------- P4: client PAIRED (trojan detour shadowtls) — the real shape -- */
  {
    const cli = {
      log: { level: "warn" },
      inbounds: [{ type: "socks", tag: "socks-in", listen: "127.0.0.1", listen_port: 19020 }],
      outbounds: [
        {
          type: "trojan", tag: "proxy",
          server: "127.0.0.1", server_port: 19012,
          password: TROJ_PASS,
          detour: "stls-t",
        },
        {
          type: "shadowtls", tag: "stls-t",
          server: "127.0.0.1", server_port: 19012,
          version: 3, password: STLS_PASS,
          tls: { enabled: true, server_name: "camo.local", insecure: true },
        },
      ],
      route: { final: "proxy" },
    };
    const p = join(TMP, "cli-paired.json");
    writeFileSync(p, JSON.stringify(cli, null, 2));
    const chk = await new Promise((res) => {
      execFile(SB, ["check", "-c", p], { timeout: 8000 }, (err, stdout, stderr) =>
        res({ exitCode: err ? (err.code ?? "ERR") : 0, ok: !err, text: clip((stderr || stdout || "").trim(), 400) }));
    });
    let traffic = null, runLog = "";
    if (chk.ok) {
      const child = spawn(SB, ["run", "-c", p], { stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (d) => (runLog += d));
      child.stderr.on("data", (d) => (runLog += d));
      try {
        const upC = await waitPort(19020);
        if (upC) traffic = await viaCurl(19020).catch((e) => "CURL-FAIL: " + clip(e.stderr || e.message, 200));
      } finally { child.kill("SIGKILL"); }
    }
    out.P4_e2ePaired = { clientCheck: chk, traffic, clientLog: clip(runLog, 600) };
  }

  /* -------- P5: client BARE shadowtls (no inner protocol) ---------------- */
  {
    const cli = {
      log: { level: "warn" },
      inbounds: [{ type: "socks", tag: "socks-in", listen: "127.0.0.1", listen_port: 19021 }],
      outbounds: [{
        type: "shadowtls", tag: "proxy",
        server: "127.0.0.1", server_port: 19012,
        version: 3, password: STLS_PASS,
        tls: { enabled: true, server_name: "camo.local", insecure: true },
      }],
      route: { final: "proxy" },
    };
    const p = join(TMP, "cli-bare.json");
    writeFileSync(p, JSON.stringify(cli, null, 2));
    const chk = await new Promise((res) => {
      execFile(SB, ["check", "-c", p], { timeout: 8000 }, (err, stdout, stderr) =>
        res({ exitCode: err ? (err.code ?? "ERR") : 0, ok: !err, text: clip((stderr || stdout || "").trim(), 400) }));
    });
    let traffic = null, runLog = "";
    if (chk.ok) {
      const child = spawn(SB, ["run", "-c", p], { stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (d) => (runLog += d));
      child.stderr.on("data", (d) => (runLog += d));
      try {
        const upC = await waitPort(19021);
        if (upC) traffic = await viaCurl(19021, 6).catch((e) => "CURL-FAIL: " + clip(e.stderr || e.message, 200));
      } finally { child.kill("SIGKILL"); }
    }
    out.P5_e2eBare = { clientCheck: chk, traffic, clientLog: clip(runLog, 600),
      serverLogTail: clip(srvLog, 600) };
  }
} finally {
  srv.kill("SIGKILL");
  origin.close();
  camo.close();
}

const dst = join(TMP, "probe-e2.json");
writeFileSync(dst, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log("PROBE-ARTIFACT: " + dst);
