#!/usr/bin/env node
/**
 * Phase C2 FUNCTIONAL test — real modules under the electron stub
 * (taskC2-electron-stub.mts) + the REAL COMPILED dist-electron/urlTest.js
 * via createRequire (quitclean pattern). No core process is spawned.
 *
 *   F1  loadAppPrefs defaults incl. the C2 testUrl field
 *   F2  legacy D4 prefs file (no testUrl) -> C2 default filled in
 *   F3  save/load round-trip with a custom test URL
 *   F4  corrupt file -> defaults (tolerant load)
 *   F5  sanitizePrefsPatch: testUrl accepted / invalid dropped / the
 *       privileged closeTrayToastShown STILL dropped
 *   F6  normalizeTestUrl classes (http/https/trim vs ftp/whitespace/
 *       oversize/non-string)
 *   F7  latencyHistory ring: cap 20, reference-stable snapshots, notify /
 *       unsubscribe, NaN guard, clear(one/all), lastLatencySample
 *   F8  rewriteConfigForProbe (compiled): xray shape — socks kept+ported,
 *       http inbound dropped
 *   F9  rewriteConfigForProbe: sing-box shape — listen_port patched, http
 *       inbound dropped
 *   F10 rewriteConfigForProbe errors: no socks inbound / multiple socks /
 *       bad JSON / oversize
 *   F11 urlTestProbe validation chain (no spawn): both modes, invalid URL,
 *       bad socksPort, missing binary
 *   F12 dist-electron freshness (urlTest.js rebuilt from urlTest.ts)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP = join(ROOT, "electron-app");
const WORK = process.env.TC2_WORK || "/home/z/my-project/scripts/taskC2-fn-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

// 1) bundle the REAL modules under the electron stub
execFileSync(
  "npx",
  ["esbuild", join(HERE, "taskC2-fnentry.ts"), "--bundle", "--platform=node",
   `--alias:electron=${join(HERE, "taskC2-electron-stub.mts")}`,
   `--outfile=${join(WORK, "c2.cjs")}`],
  { cwd: HERE, stdio: "pipe" }
);

// 2) route the stub's userData into the temp dir BEFORE loading the bundle
(globalThis).__STUB_USERDATA = WORK;
const m = await import(join(WORK, "c2.cjs"));

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };
const prefsFile = join(WORK, "memento-app-prefs.json");

/* ---------- F1: fresh install defaults ---------- */
{
  const p = m.loadAppPrefs();
  check("F1 defaults: D4 trio intact", p.hotkeyShowHide === true && p.closeToTray === true && p.language === "en");
  check("F1 defaults: testUrl = URL_TEST_DEFAULT (gstatic generate_204)",
    p.testUrl === m.URL_TEST_DEFAULT && m.URL_TEST_DEFAULT === "https://www.gstatic.com/generate_204");
}

/* ---------- F2: legacy D4 file upgrade path ---------- */
{
  fs.writeFileSync(prefsFile, JSON.stringify({ hotkeyShowHide: false, hotkeyConnect: true, closeToTray: false, closeTrayToastShown: true, language: "fa" }), "utf8");
  const p = m.loadAppPrefs();
  check("F2 legacy: D4 fields kept", p.hotkeyShowHide === false && p.closeToTray === false && p.closeTrayToastShown === true && p.language === "fa");
  check("F2 legacy: missing testUrl filled with the default", p.testUrl === m.URL_TEST_DEFAULT);
}

/* ---------- F3: save/load round-trip with a custom URL ---------- */
{
  const custom = "https://www.gstatic.com/generate_204";
  const p0 = m.loadAppPrefs();
  m.saveAppPrefs({ ...p0, testUrl: "http://cp.cloudflare.com/" });
  const p1 = m.loadAppPrefs();
  check("F3 round-trip: custom http URL persisted", p1.testUrl === "http://cp.cloudflare.com/");
  m.saveAppPrefs({ ...p0, testUrl: custom });
  check("F3 round-trip: https URL persisted", m.loadAppPrefs().testUrl === custom);
}

/* ---------- F4: corrupt file ---------- */
{
  fs.writeFileSync(prefsFile, "{not json", "utf8");
  const p = m.loadAppPrefs();
  check("F4 corrupt file -> full defaults incl. testUrl", p.testUrl === m.URL_TEST_DEFAULT && p.language === "en");
}

/* ---------- F5: sanitizePrefsPatch testUrl discipline ---------- */
{
  const ok1 = m.sanitizePrefsPatch({ testUrl: " https://example.com/probe " });
  check("F5 valid URL accepted + trimmed", ok1.testUrl === "https://example.com/probe");
  const bad1 = m.sanitizePrefsPatch({ testUrl: "ftp://example.com" });
  const bad2 = m.sanitizePrefsPatch({ testUrl: "https://ex ample.com" });
  const bad3 = m.sanitizePrefsPatch({ testUrl: `https://a.com/${"x".repeat(600)}` });
  const bad4 = m.sanitizePrefsPatch({ testUrl: 42 });
  check("F5 invalid URLs dropped (ftp / whitespace / >500 / non-string)",
    bad1.testUrl === undefined && bad2.testUrl === undefined && bad3.testUrl === undefined && bad4.testUrl === undefined);
  const priv = m.sanitizePrefsPatch({ closeTrayToastShown: true, __proto__: { closeToTray: false } });
  check("F5 privileged balloon flag STILL dropped + prototype planting rejected",
    priv.closeTrayToastShown === undefined && priv.closeToTray === undefined);
  check("F5 patch without testUrl carries no testUrl key", m.sanitizePrefsPatch({ closeToTray: true }).testUrl === undefined);
}

/* ---------- F6: normalizeTestUrl classes ---------- */
{
  check("F6 http + https accepted", m.normalizeTestUrl("http://x.io/a") === "http://x.io/a" && m.normalizeTestUrl("https://x.io/") === "https://x.io/");
  check("F6 whitespace inside rejected, surrounding trimmed", m.normalizeTestUrl("https://a b.com") === null && m.normalizeTestUrl("  https://ok.io  ") === "https://ok.io");
  check("F6 >500 chars + empty + non-string rejected",
    m.normalizeTestUrl(`https://a.com/${"x".repeat(600)}`) === null && m.normalizeTestUrl("") === null && m.normalizeTestUrl(7) === null);
  check("F6 no-hostname and bad scheme rejected", m.normalizeTestUrl("https://") === null && m.normalizeTestUrl("file:///etc/passwd") === null);
}

/* ---------- F7: latencyHistory ring (real module) ---------- */
{
  m.clearLatencyHistory();
  let notified = 0;
  const unsub = m.subscribeLatencyHistory(() => { notified++; });
  check("F7 push + get + lastLatencySample",
    (m.getLatencyHistory("c1").length === 0) && (m.lastLatencySample("c1") === null));
  m.pushLatencySample("c1", { at: 1, ms: 100, mode: "instance" });
  m.pushLatencySample("c1", { at: 2, ms: 200, mode: "tunnel" });
  check("F7 two samples, last wins", m.getLatencyHistory("c1").length === 2 && m.lastLatencySample("c1").ms === 200);
  check("F7 snapshot reference-stable between pushes", m.getLatencyHistory("c1") === m.getLatencyHistory("c1"));
  const notifiedAt2 = notified;
  m.pushLatencySample("c1", { at: 3, ms: NaN, mode: "instance" });
  check("F7 NaN sample guarded (ring unchanged, listener not fired)",
    m.getLatencyHistory("c1").length === 2 && notified === notifiedAt2);
  for (let i = 0; i < 25; i++) m.pushLatencySample("c1", { at: 10 + i, ms: i, mode: "instance" });
  check("F7 cap 20 (LATENCY_HISTORY_MAX)", m.getLatencyHistory("c1").length === m.LATENCY_HISTORY_MAX && m.LATENCY_HISTORY_MAX === 20);
  const notifiedBaseline = notified; // still subscribed — all 25 fired
  unsub();
  m.pushLatencySample("c1", { at: 99, ms: 1, mode: "instance" });
  check("F7 unsubscribe stops notifications", notified === notifiedBaseline);
  m.pushLatencySample("c2", { at: 1, ms: 5, mode: "instance" });
  m.clearLatencyHistory("c1");
  check("F7 clear(one) keeps others", m.getLatencyHistory("c1").length === 0 && m.lastLatencySample("c2")?.ms === 5);
  m.clearLatencyHistory();
  check("F7 clear(all)", m.getLatencyHistory("c2").length === 0);
}

/* ---------- F8-F12: the COMPILED dist-electron/urlTest.js ---------- */
{
  const distDir = join(APP, "dist-electron");
  const compiledPath = join(distDir, "urlTest.js");
  const req = createRequire(join(distDir, "urlTest.js"));
  const electronKey = req.resolve("electron");
  // Seed the REAL electron module slot with the stub (quitclean pattern):
  // urlTest.js + its whole manager chain load without the electron binary.
  const stubReq = createRequire(join(HERE, "taskC2-electron-stub.mts"));
  const stubExports = stubReq(join(HERE, "taskC2-electron-stub.mts"));
  req.cache[electronKey] = {
    id: electronKey, filename: electronKey, loaded: true, children: [], paths: [],
    exports: stubExports.default && stubExports.default.app ? stubExports : { ...stubExports, default: stubExports },
  };
  const urlTest = req(compiledPath);

  // F8: xray shape
  {
    const xrayCfg = {
      log: { loglevel: "warning" },
      inbounds: [
        { tag: "socks-in", listen: "127.0.0.1", port: 10808, protocol: "socks", settings: { udp: true } },
        { tag: "http-in", listen: "127.0.0.1", port: 10809, protocol: "http", settings: {} },
      ],
      outbounds: [{ protocol: "freedom", tag: "direct" }],
    };
    const r = urlTest.rewriteConfigForProbe(JSON.stringify(xrayCfg), 40001);
    const parsed = JSON.parse(r.json);
    check("F8 core detected: xray", r.core === "xray");
    check("F8 socks inbound kept + port rewritten, udp setting preserved",
      parsed.inbounds.length === 1 && parsed.inbounds[0].port === 40001 && parsed.inbounds[0].protocol === "socks" && parsed.inbounds[0].settings.udp === true);
    check("F8 http inbound dropped", !parsed.inbounds.some(ib => ib.protocol === "http"));
  }

  // F9: sing-box shape
  {
    const sbCfg = {
      log: { level: "warn" },
      inbounds: [
        { type: "socks", tag: "socks-in", listen: "127.0.0.1", listen_port: 10808 },
        { type: "http", tag: "http-in", listen: "127.0.0.1", listen_port: 10809 },
      ],
      outbounds: [{ type: "hysteria2", tag: "proxy", server: "x", server_port: 443 }],
      route: { final: "proxy" },
    };
    const r = urlTest.rewriteConfigForProbe(JSON.stringify(sbCfg), 40002);
    const parsed = JSON.parse(r.json);
    check("F9 core detected: sing-box", r.core === "sing-box");
    check("F9 listen_port rewritten", parsed.inbounds.length === 1 && parsed.inbounds[0].listen_port === 40002 && parsed.inbounds[0].type === "socks");
    check("F9 http inbound dropped, outbounds untouched", !parsed.inbounds.some(ib => ib.type === "http") && parsed.outbounds.length === 1 && parsed.route.final === "proxy");
  }

  // F10: rewrite errors
  {
    let threw = "";
    try { urlTest.rewriteConfigForProbe(JSON.stringify({ inbounds: [{ protocol: "http", port: 1 }], outbounds: [] }), 1); }
    catch (e) { threw = String(e?.message || e); }
    check("F10 no socks inbound -> error", threw.includes("no socks inbound"));
    threw = "";
    try { urlTest.rewriteConfigForProbe(JSON.stringify({ inbounds: [{ protocol: "socks", port: 1 }, { protocol: "socks", port: 2 }], outbounds: [] }), 1); }
    catch (e) { threw = String(e?.message || e); }
    check("F10 multiple socks inbounds -> error", threw.includes("multiple socks inbounds"));
    threw = "";
    try { urlTest.rewriteConfigForProbe("{not json", 1); }
    catch (e) { threw = String(e?.message || e); }
    check("F10 bad JSON -> error", threw.includes("not valid JSON"));
    threw = "";
    try { urlTest.rewriteConfigForProbe("x".repeat(300 * 1024), 1); }
    catch (e) { threw = String(e?.message || e); }
    check("F10 oversize config -> error", threw.includes("oversize") || threw.includes("Invalid"));
  }

  // F11: urlTestProbe validation chain (never spawns)
  {
    const both = await urlTest.urlTestProbe({ configJson: "{}", socksPort: 10808, testUrl: "https://x.io" });
    check("F11 both modes -> rejected", both.ok === false && /not both/.test(both.error || ""));
    const badUrl = await urlTest.urlTestProbe({ socksPort: 10808, testUrl: "ftp://x.io" });
    check("F11 invalid test URL -> rejected", badUrl.ok === false && /Invalid test URL/.test(badUrl.error || ""));
    const badPort = await urlTest.urlTestProbe({ socksPort: 70000 });
    check("F11 bad socksPort -> rejected", badPort.ok === false && /socksPort/.test(badPort.error || ""));
    // stub userData is an empty temp dir -> findXray() is null -> honest
    // "binary not found" WITHOUT any spawn attempt
    const noBin = await urlTest.urlTestProbe({ configJson: JSON.stringify({ inbounds: [{ protocol: "socks", port: 1 }], outbounds: [{ protocol: "freedom", tag: "direct" }] }), testUrl: "https://x.io" });
    check("F11 missing binary -> honest error, no spawn", noBin.ok === false && /not found/.test(noBin.error || ""));
    const singNoBin = await urlTest.urlTestProbe({ configJson: JSON.stringify({ inbounds: [{ type: "socks", listen_port: 1 }], outbounds: [{ type: "hysteria2", tag: "proxy", server: "x", server_port: 443 }] }), testUrl: "https://x.io" });
    check("F11 sing-box missing binary -> honest error", singNoBin.ok === false && /sing-box core binary not found/.test(singNoBin.error || ""));
  }

  // F12: dist freshness
  {
    const ts = fs.statSync(join(APP, "electron", "urlTest.ts")).mtimeMs;
    const js = fs.statSync(compiledPath).mtimeMs;
    check("F12 dist-electron/urlTest.js is fresh (rebuilt from urlTest.ts)", js >= ts);
  }
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
