#!/usr/bin/env node
/**
 * Phase C1 LIVE fragment proof — the REAL MEMENTO generator output run by
 * the REAL pinned Xray v25.1.1 against a local recorder.
 *
 * `run -test` accepts even malformed fragment/noises fields (probed), so
 * config-level acceptance proves NOTHING. This harness observes BEHAVIOR:
 *
 *   recorder(127.0.0.1:P) <-- TLS ClientHello -- xray(socks :P+1000, vless+tls
 *   outbound with the C1 freedom fragment-dialer from taskC1-cfgentry)
 *
 * PASS criteria:
 *   ON : >= 2 recorder chunks, first chunk <= length cap + 5 (TLS record
 *        header), chunks arrive spaced >= interval-min ms;
 *   OFF: the whole ClientHello arrives as ONE chunk (negative control).
 */
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TC1_WORK || "/home/z/my-project/scripts/taskC1-live-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

execFileSync("npx", ["esbuild", join(HERE, "taskC1-cfgentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "c1.cjs")}`], { cwd: HERE, stdio: "pipe" });
const { generateV2RayConfig, DEFAULT_BUILDER_OPTIONS, FRAGMENT_DIALER_TAG } = await import(join(WORK, "c1.cjs"));

const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const vless = { id: "lv", protocol: "vless", name: "live", isValid: true, address: "127.0.0.1", port: 0, uuid: "b831381d-6324-4d53-ad4f-8cda48b30811", security: "tls", network: "tcp" };

async function measure(label, builderOptions, recPort, useDefaultInterval = false) {
  const hits = [];
  const t0 = Date.now();
  const srv = net.createServer(sock => sock.on("data", d => hits.push({ t: Date.now() - t0, n: d.length })));
  await new Promise(res => srv.listen(recPort, "127.0.0.1", res));

  // REAL generator, REAL options — length 100-200, interval spaced for the
  // recorder (default 10-20 ms would still split but coalesce reads on the
  // loopback path, so the live proof uses visible gaps; the CFGTEST pins the
  // default recipe's JSON shape and the REAL -test gate).
  const opts = useDefaultInterval
    ? builderOptions
    : { ...builderOptions, tlsFragmentLength: "100-200", tlsFragmentInterval: "400-600" };
  const cfg = generateV2RayConfig(vless, "socks-http", recPort + 1000, recPort + 1001, undefined, opts);
  const parsed = JSON.parse(cfg.json);
  parsed.outbounds.find(o => o.tag === "proxy").settings.vnext[0].port = recPort;
  const file = join(WORK, `live_${label}.json`);
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
  if (builderOptions.tlsFragment) {
    if (!parsed.outbounds.some(o => o.tag === FRAGMENT_DIALER_TAG)) {
      console.log(`  FAIL  ${label}: generator did not inject the dialer`);
      srv.close();
      return { hits, injected: false };
    }
  }

  const child = spawn(XRAY, ["run", "-c", file], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stderr.on("data", d => log += d);
  child.stdout.on("data", d => log += d);
  await wait(800);

  // push one SOCKS5 CONNECT through the inbound -> xray dials the outbound
  const s = net.connect(recPort + 1000, "127.0.0.1");
  let stage = 0;
  s.on("error", () => {});
  s.on("connect", () => s.write(Buffer.from([0x05, 0x01, 0x00])));
  s.on("data", () => { if (stage === 0) { stage = 1; s.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 1, 2, 3, 4, 0x01, 0xbb])); } });
  await wait(3500);
  try { s.destroy(); } catch {}
  child.kill("SIGKILL");
  srv.close();
  return { hits, log, injected: true };
}

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

/* ---- negative control: fragment OFF -> ONE chunk ---- */
const off = await measure("off", { ...DEFAULT_BUILDER_OPTIONS }, 19700);
check("L1 OFF control: ClientHello arrives as ONE unsplit chunk", off.hits.length === 1 && off.hits[0].n >= 300, JSON.stringify(off.hits));

/* ---- positive: fragment ON via the REAL generator -> SPLIT ---- */
const on = await measure("on", { ...DEFAULT_BUILDER_OPTIONS, tlsFragment: true }, 19750);
const firstCap = 205; // length cap 200 + 5-byte TLS record header
const gaps = on.hits.slice(1).map((h, i) => h.t - on.hits[i].t);
check("L2 ON: >= 2 chunks (really fragmented)", on.injected && on.hits.length >= 2, JSON.stringify(on.hits));
check("L3 ON: first fragment <= 205 B (length cap + record header)", on.hits.length >= 2 && on.hits[0].n <= firstCap, JSON.stringify(on.hits));
check("L4 ON: fragments spaced >= 400 ms (interval honored)", gaps.length > 0 && Math.min(...gaps) >= 350, `gaps=${JSON.stringify(gaps)}`);
const total = on.hits.reduce((a, h) => a + h.n, 0);
check("L5 ON: total bytes ~= one ClientHello (nothing invented/lost)", total >= off.hits[0].n - 120 && total <= off.hits[0].n + 120, `total=${total} off=${off.hits[0].n}`);

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
