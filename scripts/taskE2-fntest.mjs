#!/usr/bin/env node
/**
 * taskE2-fntest.mjs — Phase E2 FUNCTIONAL test of the REAL renderer modules
 * (bundled by esbuild from taskE2-fnentry.ts) against the REAL pinned
 * sing-box 1.14.0 binary, fully loopback, single foreground lifecycle.
 *
 * F1  live pair: parse a real memento-stls:// link -> generateSingBoxConfig
 *     -> `sing-box check` on the REAL binary -> run the generated config ->
 *     real traffic through its socks inbound to the loopback origin,
 *     against a live shadowtls(transport)+trojan(inner) server — the FULL
 *     parser -> generator -> core -> traffic chain.
 * F2  parse honesty: v4 rejected, v2/v3 without stls-password rejected,
 *     v1 passwordless accepted with an empty transport password.
 * F3  scope honesty: shadowtls as chain hop / balancer member degrades to
 *     feature-off in the generator (no hop tag, no detour, no member);
 *     the xray generator structurally refuses shadowtls (null).
 * F4  peripherals: editor detect/edit round-trip, ping target extraction,
 *     the sing-box-only routing flags, the 4-language non-standard note.
 *
 * Exit code 0 = all counted assertions passed.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import https from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, "taskE2-fntest-tmp");
const SB = "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

/* ---- localStorage polyfill BEFORE the bundle import: the zustand store
 * initializer (store.ts) calls load*Options() which touch localStorage. */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.window = globalThis.window ?? globalThis;

/* ---------------- build the bundle once ---------------- */
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const OUT = join(WORK, "e2.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskE2-fnentry.ts"), "--bundle", "--platform=node",
  "--format=cjs", `--outfile=${OUT}`],
  { cwd: HERE, stdio: "pipe" });
const M = (await import(`file://${OUT}`)).default ?? await import(`file://${OUT}`);

/* ---------------- loopback origins + live server ---------------- */
const BLOB = "E2FNT".repeat(4096); // 20480 bytes per GET
const origin = createServer((_q, r) => { r.writeHead(200, { "content-type": "application/octet-stream" }); r.end(BLOB); });
const camo = https.createServer({
  key: fs.readFileSync("/home/z/my-project/scripts/taskE2-live-tmp/camo-key.pem"),
  cert: fs.readFileSync("/home/z/my-project/scripts/taskE2-live-tmp/camo-cert.pem"),
}, (_q, r) => { r.writeHead(200); r.end("camo"); });
await new Promise((res) => origin.listen(19050, "127.0.0.1", res));
await new Promise((res) => camo.listen(19051, "127.0.0.1", res));

const P_STLS = 19052, P_TROJ = 19053;
const TROJ_PASS = "fnt-trojan-pass", STLS_PASS = "fnt-stls-pass";
const srvCfg = {
  log: { level: "info" }, // diag: every connection phase visible in [diag]
  inbounds: [
    { type: "shadowtls", tag: "stls-in", listen: "127.0.0.1", listen_port: P_STLS,
      version: 3, users: [{ password: STLS_PASS }],
      handshake: { server: "127.0.0.1", server_port: 19051 },
      detour: "trojan-in" },
    { type: "trojan", tag: "trojan-in", listen: "127.0.0.1", listen_port: P_TROJ,
      users: [{ password: TROJ_PASS }] },
  ],
  outbounds: [{ type: "direct", tag: "direct" }],
  route: { final: "direct" },
};
const srvPath = join(WORK, "srv.json");
fs.writeFileSync(srvPath, JSON.stringify(srvCfg, null, 2));
const srv = spawn(SB, ["run", "-c", srvPath], { stdio: ["ignore", "ignore", "pipe"] });
let srvLog = ""; srv.stderr.on("data", (d) => (srvLog += d));

const waitPort = (port, ms = 6000) =>
  new Promise((res) => {
    const t0 = Date.now();
    const tick = () => {
      const net = spawn("bash", ["-c", `exec 3<>/dev/tcp/127.0.0.1/${port} && echo OPEN`], { stdio: "pipe" });
      let open = false;
      net.stdout.on("data", (d) => { if (String(d).includes("OPEN")) open = true; });
      net.on("close", () => {
        if (open) return res(true);
        if (Date.now() - t0 > ms) return res(false);
        setTimeout(tick, 250);
      });
    };
    tick();
  });

const sbCheck = (path) => {
  try { execFileSync(SB, ["check", "-c", path], { timeout: 9000, stdio: "pipe" }); return 0; }
  catch (e) { return e.status ?? 1; }
};

const LINK_V3 = `memento-stls://${TROJ_PASS}@127.0.0.1:${P_STLS}?version=3&stls-password=${STLS_PASS}&sni=camo.local&insecure=1#E2FNT-Live`;
const LINK_V1 = `memento-stls://inner-pass@127.0.0.1:${P_STLS}?version=1#E2FNT-v1`;

let f1 = null;
try {
  const up = await waitPort(P_STLS);
  if (!up) throw new Error("E2 server never opened: " + srvLog);

  /* ---------------- F1: the live parser -> generator -> core chain ------- */
  console.log("== F1 live pair: parse -> generate -> check -> run -> traffic ==");
  const parsed = M.parseSingleLink(LINK_V3);
  const gen = M.generateSingBoxConfig(parsed, 19060, 19061);
  f1 = { parsed, genJson: gen?.json ?? null };
  ok("F1 parse isValid", parsed.isValid === true);
  ok("F1 parse protocol", parsed.protocol === "shadowtls");
  ok("F1 core routes to sing-box", M.configCore(parsed) === "sing-box");
  ok("F1 generator produced a config", gen !== null);
  const cfgObj = JSON.parse(gen.json);
  const outs = cfgObj.outbounds;
  ok("F1 exactly 2 outbounds (pair)", Array.isArray(outs) && outs.length === 2,
    `got ${outs?.length}`);
  const trojan = outs.find((o) => o.type === "trojan");
  const transport = outs.find((o) => o.type === "shadowtls");
  ok("F1 trojan primary tagged proxy + detour stls-t",
    trojan?.tag === "proxy" && trojan?.detour === "stls-t");
  ok("F1 trojan carries the INNER credential, no own tls block",
    trojan?.password === TROJ_PASS && !("tls" in (trojan ?? {})));
  ok("F1 transport version/password/tls honest",
    transport?.tag === "stls-t" && transport?.version === 3 &&
    transport?.password === STLS_PASS &&
    transport?.tls?.enabled === true && transport?.tls?.server_name === "camo.local" &&
    transport?.tls?.insecure === true);
  const cfgPath = join(WORK, "cli.json");
  fs.writeFileSync(cfgPath, gen.json);
  ok("F1 REAL sing-box check exit 0", sbCheck(cfgPath) === 0);
  const cli = spawn(SB, ["run", "-c", cfgPath], { stdio: ["ignore", "ignore", "pipe"] });
  let cliLog = ""; cli.stderr.on("data", (d) => (cliLog += d));
  let traffic = "NO-PORT";
  // ASYNC curl (execFile): the loopback camo/origin servers live in THIS
  // node process — a blocking execFileSync here would freeze the event
  // loop and deadlock the very TLS handshake under test (probed the hard
  // way: a sync curl stalled the ShadowTLS handshake until timeout).
  const curlOnce = () => new Promise((res) => {
    execFile("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}:%{size_download}",
      "--max-time", "12", "--proxy", "socks5://127.0.0.1:19060", "http://127.0.0.1:19050/blob"],
      { timeout: 15000 }, (err, stdout, stderr) =>
        res(err ? "CURL-FAIL " + String(stderr ?? err.message).slice(0, 120) : stdout));
  });
  try {
    if (await waitPort(19060)) {
      await new Promise((r) => setTimeout(r, 300));
      traffic = await curlOnce();
      if (traffic.startsWith("CURL-FAIL")) {
        console.log(`  [diag] client log: ${cliLog.slice(-800)}`);
        console.log(`  [diag] server log: ${srvLog.slice(-800)}`);
      }
    } else { traffic = "cli port never opened: " + cliLog.slice(-300); }
  } finally { cli.kill("SIGKILL"); }
  ok("F1 REAL traffic through the generated pair", traffic === `200:${BLOB.length}`,
    `got ${traffic}`);
} catch (e) {
  ok("F1 harness error", false, String(e.message).slice(0, 200));
}

/* ---------------- F2: parse honesty ------------------------------------ */
console.log("== F2 parse honesty ==");
{
  const v4 = M.parseSingleLink(`memento-stls://p@h.example:443?version=4&stls-password=x#v4`);
  ok("F2 version 4 rejected", v4.isValid === false && /version/i.test(v4.errorMessage ?? ""));
  const v3np = M.parseSingleLink(`memento-stls://p@h.example:443?version=3#v3-no-pass`);
  ok("F2 v3 without stls-password rejected", v3np.isValid === false && /stls-password/.test(v3np.errorMessage ?? ""));
  const v2np = M.parseSingleLink(`memento-stls://p@h.example:443?version=2#v2-no-pass`);
  ok("F2 v2 without stls-password rejected", v2np.isValid === false && /stls-password/.test(v2np.errorMessage ?? ""));
  const v1 = M.parseSingleLink(LINK_V1);
  ok("F2 v1 passwordless accepted, empty transport password",
    v1.isValid === true && v1.stlsVersion === "1" && v1.stlsPassword === "");
  ok("F2 insecure flag only from the link",
    M.parseSingleLink(`memento-stls://p@h.example:443?version=3&stls-password=x&sni=c.example#n`).insecure !== true &&
    M.parseSingleLink(`memento-stls://p@h.example:443?version=3&stls-password=x&insecure=1#n`).insecure === true);
}

/* ---------------- F3: scope honesty (topology + xray) ------------------ */
console.log("== F3 scope honesty ==");
{
  const hy2 = M.parseSingleLink(`hysteria2://pw@hy.example:443?sni=hy.example#hy2`);
  const stls = M.parseSingleLink(LINK_V3);

  // (a) MAIN shadowtls + a resolved hy2 hop: topology is IGNORED wholesale —
  // the pair's detour (trojan -> stls-t) must survive uncorrupted.
  const genMain = M.generateSingBoxConfig(stls, 19062, 19063, undefined, undefined, undefined,
    { chainEnabled: true, balancerEnabled: false, chainHopId: "x", balancerExtraIds: [], chainHop: hy2, balancerExtras: [] });
  const mainJson = genMain ? JSON.parse(genMain.json) : null;
  const mainTrojan = mainJson?.outbounds.find((o) => o.type === "trojan");
  ok("F3 shadowtls MAIN ignores topology (no chain-hop outbound)",
    mainJson !== null && !mainJson.outbounds.some((o) => o.tag === "chain-hop"));
  ok("F3 shadowtls MAIN keeps its pair detour (trojan -> stls-t)",
    mainTrojan?.detour === "stls-t" &&
    mainJson.outbounds.some((o) => o.tag === "stls-t" && o.type === "shadowtls"));

  // (b) hy2 MAIN + a shadowtls HOP: the hop degrades to feature-off.
  const genHop = M.generateSingBoxConfig(hy2, 19062, 19063, undefined, undefined, undefined,
    { chainEnabled: true, balancerEnabled: false, chainHopId: "x", balancerExtraIds: [], chainHop: stls, balancerExtras: [] });
  const hopJson = genHop ? JSON.parse(genHop.json) : null;
  ok("F3 shadowtls hop degrades to feature-off (no chain-hop tag)",
    hopJson !== null && !hopJson.outbounds.some((o) => o.tag === "chain-hop"));
  ok("F3 primary keeps its own detour-free shape",
    hopJson !== null && hopJson.outbounds.find((o) => o.tag === "proxy")?.detour === undefined);

  // (c) hy2 MAIN + a shadowtls POOL member: the member is never built
  // (the connect-flow gate drops the pick upstream with an honest toast;
  // C4's urltest GROUP may still be emitted from presence semantics).
  const genPool = M.generateSingBoxConfig(hy2, 19062, 19063, undefined, undefined, undefined,
    { chainEnabled: false, balancerEnabled: true, chainHopId: null, balancerExtraIds: ["x"], chainHop: null, balancerExtras: [stls] });
  const poolJson = genPool ? JSON.parse(genPool.json) : null;
  ok("F3 shadowtls pool member never built (no trojan/shadowtls outbound)",
    poolJson !== null && !poolJson.outbounds.some((o) => o.type === "trojan" || o.type === "shadowtls"));

  ok("F3 xray generator structurally refuses shadowtls",
    M.generateV2RayConfig(stls) === null);
}

/* ---------------- F4: peripherals -------------------------------------- */
console.log("== F4 peripherals ==");
{
  ok("F4 editor detectProtocol", M.detectProtocol(LINK_V3) === "memento-stls");
  const edited = M.editLink(LINK_V3, { newAddress: "9.9.9.9", newPort: "8443" });
  ok("F4 editLink swaps host/port, keeps scheme+creds+query",
    edited.startsWith("memento-stls://") && edited.includes("9.9.9.9:8443") &&
    edited.includes(TROJ_PASS) && edited.includes("stls-password=") && edited.includes("camo.local"));
  const ip = M.extractIpFromConfig(LINK_V3);
  ok("F4 ping target extraction", ip?.ip === "127.0.0.1" && ip?.port === String(P_STLS) && ip?.protocol === "shadowtls");
  ok("F4 isSingBoxProtocol honesty",
    M.isSingBoxProtocol("shadowtls") === true && M.isSingBoxProtocol("trojan") === false);
  const langs = ["en", "fa", "zh", "ar"];
  const notes = langs.map((l) => M.t("import.stlsNote", l));
  ok("F4 non-standard note present in 4 languages, names the scheme",
    notes.every((s) => typeof s === "string" && s.includes("memento-stls://")));
}

srv.kill("SIGKILL");
origin.close();
camo.close();

fs.writeFileSync(join(WORK, "fntest-e2.json"), JSON.stringify({
  stamp: `E2FNT-${Date.now()}`, f1,
}, null, 2));

console.log(`taskE2-fntest: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
