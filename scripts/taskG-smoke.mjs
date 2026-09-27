#!/usr/bin/env node
/**
 * taskG-smoke.mjs — the 3.1.7 regression gates.
 *
 * Covers exactly what this round changed:
 *   G1  setup ESM crash fix (main.js loads as CommonJS — the exact
 *       "exports is not defined in ES module scope" crash from 2.0.0)
 *   G2  runtime-reuse installer (lite payload + cloned runtime = a complete
 *       install; ARP registration; shortcuts; backup dropped; userData kept)
 *   G3  full-tree regression (fixture payload path unchanged)
 *   G4  scanner provider presets: every preset expands through the REAL
 *       engine parser, counts match the UI badges, all inside the cap
 *   G5  scanner engine live: real loopback TCP scan streams per-host events
 *   G6  Update Center LIVE: real GitHub latest-tag fetch for xray+sing-box,
 *       and the full download→extract→verify→apply→rollback pipeline on a
 *       REAL Xray linux binary
 *   G7  payload truth: real cores (MZ headers), aether sha256 pin match,
 *       payload-meta mode=runtime-reuse, appVersion 3.1.7
 *   G8  Windows artifacts: correct embedded icons (6/6 images), intact 7z
 *       archives, sizes
 *   G9  source guards: UC <icon/> bugfix present, presets wired, versions
 *   G10 version bump completeness (3.1.7 / setup 2.0.5)
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const APP = join(ROOT, "electron-app");
const SETUP = join(ROOT, "setup-app");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/* ================= G1 — setup ESM fix ================= */
console.log("\nG1 — MementoSetup ESM crash fix");
{
  const pkg = JSON.parse(fs.readFileSync(join(SETUP, "package.json"), "utf8"));
  ok("G1 setup package.json has no ESM type (CJS main loads)", pkg.type !== "module");
  ok("G1 setup main entry is dist-electron/main.js", pkg.main === "dist-electron/main.js");
  const mainJs = fs.readFileSync(join(SETUP, "dist-electron", "main.js"), "utf8");
  ok("G1 compiled main is CommonJS (exports/require present)", /exports|require\(/.test(mainJs));
  const stubDir = join(SETUP, ".g-stub");
  const res = spawnSync(process.execPath, [join(SETUP, "dist-electron", "main.js")], {
    env: { ...process.env, NODE_PATH: stubDir },
    timeout: 8000,
    encoding: "utf8",
  });
  const out = (res.stdout || "") + (res.stderr || "");
  ok("G1 main.js loads with NO 'exports is not defined' crash", !/exports is not defined in ES module scope/.test(out));
  ok("G1 no ReferenceError during load", !/ReferenceError/.test(out), out.slice(0, 200));
}

/* ================= G2 — runtime-reuse installer ================= */
console.log("\nG2 — runtime-reuse installer pipeline");
{
  const work = fs.mkdtempSync(join(os.tmpdir(), "taskG-runtime-"));
  // fake "installer runtime": an exe + dlls + locales + resources/elevate.exe
  const runtimeDir = join(work, "runtime");
  for (const d of ["locales", "resources"]) fs.mkdirSync(join(runtimeDir, d), { recursive: true });
  fs.writeFileSync(join(runtimeDir, "MementoSetup.exe"), "RUNTIME-EXE-BYTES-316\n".repeat(100));
  fs.writeFileSync(join(runtimeDir, "ffmpeg.dll"), "ffmpeg-bytes\n");
  fs.writeFileSync(join(runtimeDir, "icudtl.dat"), "icu-bytes\n");
  fs.writeFileSync(join(runtimeDir, "LICENSE.electron.txt"), "electron-license\n");
  fs.writeFileSync(join(runtimeDir, "resources", "app.asar"), "WIZARD-ASAR (must NOT be copied)\n");
  fs.writeFileSync(join(runtimeDir, "resources", "elevate.exe"), "elevate-bytes\n");
  fs.writeFileSync(join(runtimeDir, "locales", "en-US.pak"), "pak-bytes\n");
  fs.writeFileSync(join(runtimeDir, "payload-meta.json"), "{}\n"); // must NOT be copied
  // lite payload (what sync-payload v2 produces — 2.0.5: the app code is
  // an UNPACKED resources/app/ TREE, not an app.asar blob)
  const payloadDir = join(work, "payload");
  for (const d of ["resources/resources/xray", "resources/resources/sing-box", "resources/app/dist-electron"]) fs.mkdirSync(join(payloadDir, d), { recursive: true });
  fs.writeFileSync(join(payloadDir, "resources", "app", "package.json"), "MEMENTO-APP-PKG-317\n");
  fs.writeFileSync(join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN-317\n");
  fs.writeFileSync(join(payloadDir, "resources", "icon.ico"), "ico\n");
  fs.writeFileSync(join(payloadDir, "resources", "icon.png"), "png\n");
  fs.writeFileSync(join(payloadDir, "resources", "resources", "xray", "xray.exe"), "xray-bin\n");
  fs.writeFileSync(join(payloadDir, "resources", "resources", "sing-box", "sing-box.exe"), "singbox-bin\n");

  // compile installerCore fresh (tsc already ran; import the built cjs)
  const core = await import("file://" + join(SETUP, "dist-electron", "installerCore.js"));

  const destDir = join(work, "dest");
  fs.mkdirSync(join(work, "Desktop"), { recursive: true });
  fs.mkdirSync(join(work, "applications"), { recursive: true });
  const events = [];
  const userDataSentinel = join(work, "appdata", "com.epodonios.memento", "profiles.json");
  fs.mkdirSync(dirname(userDataSentinel), { recursive: true });
  fs.writeFileSync(userDataSentinel, "user data stays\n");

  const runtimeFiles = () => {
    const SKIP = new Set(["app.asar", "payload", "icon.ico", "icon.png", "payload-manifest.json", "payload-meta.json", ".memento-uninstall.json", "MementoSetup.exe", "MEMENTO.exe"]);
    const out = [];
    for (const e of fs.readdirSync(runtimeDir, { withFileTypes: true })) {
      if (e.isDirectory() || SKIP.has(e.name)) continue;
      out.push({ rel: e.name, bytes: fs.statSync(join(runtimeDir, e.name)).size });
    }
    for (const e of fs.readdirSync(join(runtimeDir, "locales"), { withFileTypes: true })) {
      if (e.isFile()) out.push({ rel: join("locales", e.name), bytes: fs.statSync(join(runtimeDir, "locales", e.name)).size });
    }
    out.push({ rel: join("resources", "elevate.exe"), bytes: fs.statSync(join(runtimeDir, "resources", "elevate.exe")).size });
    return out;
  };

  const result = await core.runInstall(
    { destDir, createDesktopShortcut: true },
    {
      isWin: false,
      appVersion: "3.2.0",
      payloadDir,
      coreVersions: { xray: "v25.1.1", singbox: "1.14.0", aether: "1.9.0" },
      desktopDir: () => join(work, "Desktop"),
      startMenuDir: () => join(work, "applications"),
      writeShortcut: (lnk) => { fs.writeFileSync(lnk, "lnk\n"); return "created"; },
      writeUninstallRegistration: (info) => {
        fs.writeFileSync(join(destDir, ".memento-uninstall.json"), JSON.stringify(info, null, 2), "utf8");
      },
      removeUninstallRegistration: () => {},
      closeRunningApp: () => false,
      onEvent: (ev) => events.push(ev),
      cancelled: () => false,
      mode: "runtime-reuse",
      runtimeDir: () => runtimeDir,
      runtimeFiles,
      runtimeExePath: () => join(runtimeDir, "MementoSetup.exe"),
    }
  );

  ok("G2 install reports ok", result.ok === true, JSON.stringify(result));
  const destExe = join(destDir, "MEMENTO"); // POSIX gate: the engine uses the platform-correct name
  ok("G2 MEMENTO.exe is a copy of the runtime exe", fs.readFileSync(destExe, "utf8").startsWith("RUNTIME-EXE-BYTES-316"));
  ok("G2 runtime dlls copied", fs.existsSync(join(destDir, "ffmpeg.dll")) && fs.existsSync(join(destDir, "icudtl.dat")));
  ok("G2 electron LICENSE carried", fs.existsSync(join(destDir, "LICENSE.electron.txt")));
  ok("G2 locales cloned", fs.existsSync(join(destDir, "locales", "en-US.pak")));
  ok("G2 elevate.exe cloned from runtime", fs.readFileSync(join(destDir, "resources", "elevate.exe"), "utf8") === "elevate-bytes\n");
  ok("G2 MEMENTO app code from the UNPACKED payload tree (package.json)", fs.readFileSync(join(destDir, "resources", "app", "package.json"), "utf8") === "MEMENTO-APP-PKG-317\n");
  ok("G2 app main.js from the payload tree (critical file #2)", fs.readFileSync(join(destDir, "resources", "app", "dist-electron", "main.js"), "utf8") === "MEMENTO-APP-MAIN-317\n");
  ok("G2 wizard asar NOT copied", !fs.existsSync(join(destDir, "resources", ".was-wizard")) && !fs.existsSync(join(destDir, "resources", "app.asar")));
  ok("G2 installer payload-meta.json NOT copied", !fs.existsSync(join(destDir, "payload-meta.json")));
  ok("G2 cores landed (xray + sing-box)", fs.existsSync(join(destDir, "resources", "resources", "xray", "xray.exe")) && fs.existsSync(join(destDir, "resources", "resources", "sing-box", "sing-box.exe")));
  ok("G2 verified N/N summary emitted (2.0.4 verify contract)", events.some((e) => e.type === "log" && /verified \d+\/\d+ installed files/.test(e.line || "")));
  ok("G2 ARP registration written with runtime-inclusive size", (() => {
    const info = JSON.parse(fs.readFileSync(join(destDir, ".memento-uninstall.json"), "utf8"));
    // exact expected size: payload tree + runtime tree (+ exe), in KB
    const sizeOf = (dir) => {
      let n = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else n += fs.statSync(p).size;
        }
      };
      walk(dir);
      return n;
    };
    const runtimeBytes = runtimeFiles().reduce((a, b) => a + b.bytes, 0) + fs.statSync(join(runtimeDir, "MementoSetup.exe")).size;
    const expectedKB = Math.max(1, Math.round((sizeOf(payloadDir) + runtimeBytes) / 1024));
    return info.DisplayVersion === "3.2.0" && info.EstimatedSizeKB === expectedKB && info.UninstallPreservesUserData === 1;
  })());
  ok("G2 shortcuts created (desktop + start menu + uninstall)", fs.existsSync(join(work, "Desktop", "memento.desktop")) && fs.existsSync(join(work, "applications", "memento.desktop")) && fs.existsSync(join(work, "applications", "memento-uninstall.desktop")));
  ok("G2 progress streamed to 100%", events.some((e) => e.type === "pct" && e.pct === 100) && events.some((e) => e.type === "done"));
  ok("G2 runtime-reuse announced in the log console", events.some((e) => e.type === "log" && /runtime-reuse|runtime/.test(e.line || "")));
  ok("G2 userData sentinel untouched", fs.readFileSync(userDataSentinel, "utf8") === "user data stays\n");
  ok("G2 no leftover .bak staging dir", fs.readdirSync(work).filter((n) => n.includes(".bak-")).length === 0);
  fs.rmSync(work, { recursive: true, force: true });
}

/* ================= G3 — full-tree regression ================= */
console.log("\nG3 — full-tree installer regression (fixtures / --stub)");
{
  const core = await import("file://" + join(SETUP, "dist-electron", "installerCore.js"));
  const work = fs.mkdtempSync(join(os.tmpdir(), "taskG-fulltree-"));
  const payloadDir = join(work, "payload");
  fs.mkdirSync(join(payloadDir, "resources", "xray"), { recursive: true });
  fs.writeFileSync(join(payloadDir, "MEMENTO.exe"), "FULL-TREE-EXE\n");
  fs.writeFileSync(join(payloadDir, "resources", "xray", "xray.exe"), "xray\n");
  const destDir = join(work, "dest");
  const result = await core.runInstall(
    { destDir, createDesktopShortcut: false },
    {
      isWin: false,
      appVersion: "3.2.0",
      payloadDir,
      coreVersions: { xray: "v25.1.1" },
      desktopDir: () => join(work, "Desktop"),
      startMenuDir: () => join(work, "applications"),
      writeShortcut: () => "skipped",
      writeUninstallRegistration: () => {},
      removeUninstallRegistration: () => {},
      closeRunningApp: () => false,
      onEvent: () => {},
      cancelled: () => false,
    }
  );
  ok("G3 full-tree install ok", result.ok === true);
  ok("G3 MEMENTO.exe came from the payload", fs.readFileSync(join(destDir, "MEMENTO.exe"), "utf8") === "FULL-TREE-EXE\n");
  ok("G3 xray landed", fs.existsSync(join(destDir, "resources", "xray", "xray.exe")));
  fs.rmSync(work, { recursive: true, force: true });
}

/* ================= G4 — scanner presets ================= */
console.log("\nG4 — scanner provider presets vs the REAL engine parser");
{
  const scanner = await import("file://" + join(APP, "dist-electron", "scanner.js"));
  // the renderer's preset list — parse the TS source (no runtime dep)
  const src = fs.readFileSync(join(ROOT, "src", "utils", "scanPresets.ts"), "utf8");
  const presetBlocks = [...src.matchAll(/id: "([a-z]+)"[\s\S]*?ranges: \[([^\]]+)\]/g)];
  ok("G4 presets found in scanPresets.ts (>= 8 providers)", presetBlocks.length >= 8, String(presetBlocks.length));
  let allValid = true, allWithinCap = true;
  for (const [, id, rangesSrc] of presetBlocks) {
    const ranges = [...rangesSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (!ranges.length) { allValid = false; continue; }
    const expanded = scanner.expandTargets(ranges.join("\n"));
    if (expanded.error || expanded.ips.length === 0) {
      allValid = false;
      console.log(`        preset ${id}: EXPANSION ERROR ${expanded.error}`);
      continue;
    }
    // every preset must fit the engine cap
    if (ranges.length && expanded.ips.length > 65536) allWithinCap = false;
    // dedupe check (no overlapping ranges inside one preset)
    if (new Set(expanded.ips).size !== expanded.ips.length) allValid = false;
  }
  ok("G4 every preset expands cleanly through the engine (no errors, no overlaps)", allValid);
  ok("G4 every preset fits inside the 65,536-host cap", allWithinCap);
  // exact count check for one known preset (cloudflare = 14×/20 + 1×/22)
  const cf = scanner.expandTargets("104.16.0.0/20\n104.17.0.0/20\n104.18.0.0/20\n104.19.0.0/20\n104.20.0.0/20\n104.21.0.0/20\n104.22.0.0/20\n104.24.0.0/20\n104.25.0.0/20\n104.26.0.0/20\n104.27.0.0/20\n104.28.0.0/20\n172.64.0.0/20\n172.65.0.0/20\n188.114.96.0/22");
  ok("G4 cloudflare preset = 58,338 hosts (matches the UI badge)", cf.ips.length === 58338, String(cf.ips.length));
  ok("G4 tag classifier still classifies (web+router on 104.16.0.1:80)", (() => {
    const tags = scanner.classifyHost("104.16.0.1", [80]);
    return tags.includes("web") && tags.includes("router");
  })());
  ok("G4 localSubnet() returns the real /24", (() => {
    const s = scanner.localSubnet();
    return !!s && /\/24$/.test(s.cidr);
  })());
}

/* ================= G5 — scanner engine live ================= */
console.log("\nG5 — scanner engine LIVE loopback scan");
{
  const scanner = await import("file://" + join(APP, "dist-electron", "scanner.js"));
  const server = net.createServer((s) => s.end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const hosts = [];
  let progressEvents = 0;
  const outcome = await scanner.runScan(
    {
      targetText: `127.0.0.1\n127.0.0.2`,
      portText: String(port),
      concurrency: 8,
      timeoutMs: 800,
      reverseDns: false,
      geoLookup: false,
    },
    () => progressEvents++,
    (h) => hosts.push(h)
  );
  server.close();
  ok("G5 live scan found the listening loopback", outcome.online >= 1 && hosts.some((h) => h.ip === "127.0.0.1" && h.online));
  ok("G5 per-host streaming fired (scanner_host contract)", hosts.length >= 2);
  ok("G5 progress events streamed", progressEvents >= 1);
  const hit = hosts.find((h) => h.ip === "127.0.0.1");
  ok("G5 latency + open port recorded", hit && hit.ms !== null && hit.ports.some((p) => p.port === port && p.open));
  // cancel path
  const server2 = net.createServer(() => {});
  await new Promise((r) => server2.listen(0, "127.0.0.1", r));
  const p2 = server2.address().port;
  const bigScan = scanner.runScan(
    { targetText: "127.0.0.0/29", portText: String(p2), concurrency: 4, timeoutMs: 500, reverseDns: false, geoLookup: false },
    null,
    null
  );
  scanner.cancelScan();
  const cancelled = await bigScan;
  server2.close();
  ok("G5 live cancel works", cancelled.cancelled === true);
}

/* ================= G6 — Update Center LIVE ================= */
console.log("\nG6 — Update Center LIVE (real GitHub + real binary pipeline)");
{
  // bundle the REAL updateCenter under the shared electron stub (same
  // pattern as taskF: esbuild --alias:electron=taskF-electron-stub.mts)
  const work = join(HERE, "taskG-smoke-tmp");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  (globalThis).__STUB_USERDATA = work;
  fs.writeFileSync(
    join(work, "taskG6-entry.ts"),
    `export * from "${join(APP, "electron", "updateCenter.ts").replace(/\\/g, "/")}";\n`
  );
  const bund = spawnSync("npx", [
    "esbuild", join(work, "taskG6-entry.ts"), "--bundle", "--platform=node",
    `--alias:electron=${join(HERE, "taskF-electron-stub.mts")}`,
    `--outfile=${join(work, "taskG6-entry.cjs")}`,
  ], { encoding: "utf8", cwd: HERE, timeout: 120000 });
  ok("G6 updateCenter bundles under the electron stub", fs.existsSync(join(work, "taskG6-entry.cjs")), (bund.stderr || "").slice(-160));
  const uc = await import(join(work, "taskG6-entry.cjs"));
  const xrayTag = await uc.fetchLatestTag("xray", 15000);
  const singTag = await uc.fetchLatestTag("sing-box", 15000);
  ok("G6 real latest tag fetched for xray (" + xrayTag + ")", /^v?\d+\.\d+\.\d+/.test(xrayTag || ""));
  ok("G6 real latest tag fetched for sing-box (" + singTag + ")", /^v?\d+\.\d+\.\d+/.test(singTag || ""));
  // full pipeline on linux xray (sandbox OS) — download → verify → apply → rollback
  // seed a fake previous binary so the apply produces a real .bak to roll back to
  const fakePrevDir = join(work, "updates", "xray");
  fs.mkdirSync(fakePrevDir, { recursive: true });
  fs.writeFileSync(join(fakePrevDir, "xray"), "PREVIOUS-FIXTURE-BINARY\n");
  const dl = await uc.runUpdatePipeline("xray");
  ok("G6 pipeline applied a real Xray binary (v" + (dl.version || "?") + ")", dl.ok === true && !!dl.version, JSON.stringify(dl));
  if (dl.ok) {
    const rb = uc.updateCenterRollback("xray");
    ok("G6 rollback restores the previous version", rb.ok === true && fs.readFileSync(join(fakePrevDir, "xray"), "utf8") === "PREVIOUS-FIXTURE-BINARY\n", JSON.stringify(rb));
  } else {
    ok("G6 rollback restores the previous version", false, "pipeline did not apply");
  }
  const list = uc.updateCenterList();
  ok("G6 list entries carry the bugfixed source + lastCheckedAt fields", list.length === 2 && list.every((e) => ["updates", "bundled", "none"].includes(e.source) && "lastCheckedAt" in e));
}

/* ================= G7 — payload truth ================= */
console.log("\nG7 — payload: real cores, pinned aether, runtime-reuse mode");
{
  const meta = JSON.parse(fs.readFileSync(join(SETUP, "payload-meta.json"), "utf8"));
  ok("G7 payload-meta appVersion = 3.2.0", meta.appVersion === "3.2.0");
  ok("G7 payload-meta mode = runtime-reuse", meta.mode === "runtime-reuse");
  ok("G7 payload is the LITE tree (< 160 MB, was 373 MB)", meta.bytes < 160 * 1024 * 1024, `${(meta.bytes / 1024 ** 2).toFixed(1)} MB`);
  const xray = join(SETUP, "payload", "resources", "resources", "xray", "xray.exe");
  const singbox = join(SETUP, "payload", "resources", "resources", "sing-box", "sing-box.exe");
  const aether = join(SETUP, "payload", "resources", "resources", "aether", "aether.exe");
  for (const [name, p] of [["xray.exe", xray], ["sing-box.exe", singbox], ["aether.exe", aether]]) {
    const buf = fs.readFileSync(p);
    ok(`G7 ${name} is a real PE binary (MZ + >5MB)`, buf.length > 5 * 1024 * 1024 && buf[0] === 0x4d && buf[1] === 0x5a, `${(buf.length / 1024 ** 2).toFixed(1)} MB`);
  }
  const aetherPin = JSON.parse(fs.readFileSync(join(APP, "electron", "aether-versions.json"), "utf8")).versions.find((v) => v.version === "1.9.0");
  ok("G7 aether.exe matches the pinned sha256", sha256(aether) === aetherPin.sha256.win32);
  ok("G7 geo files ride along (geoip.dat)", fs.existsSync(join(SETUP, "payload", "resources", "resources", "geoip.dat")) || fs.existsSync(join(APP, "resources", "geoip.dat")));
}

/* ================= G8 — Windows artifacts ================= */
console.log("\nG8 — Windows artifacts: icons + archives");
{
  const exeSetup = join(SETUP, "release", "MementoSetup-3.2.0.exe");
  const exeApp = join(APP, "release", "MEMENTO-3.2.0.exe");
  const exeUnpacked = join(APP, "release", "win-unpacked", "MEMENTO.exe");
  const icoApp = join(APP, "build", "icon.ico");
  const icoSetup = join(SETUP, "build", "icon.ico");
  const check = (exe, ico) => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "check-icon.mjs"), exe, ico], { encoding: "utf8" });
    return { okp: r.status === 0, line: (r.stdout || r.stderr || "").trim() };
  };
  for (const [label, exe, ico] of [
    ["G8 MementoSetup-3.2.0.exe embeds the MEMENTO icon", exeSetup, icoSetup],
    ["G8 MEMENTO-3.2.0.exe embeds the MEMENTO icon", exeApp, icoApp],
    ["G8 win-unpacked MEMENTO.exe embeds the MEMENTO icon", exeUnpacked, icoApp],
  ]) {
    const r = check(exe, ico);
    ok(label, r.okp, r.line);
  }
  // 7z archive integrity for both portable SFX exes
  const seven = join(ROOT, "node_modules", "7zip-bin", "linux", "x64", "7za");
  const testSfx = (exe, label) => {
    const b = fs.readFileSync(exe);
    const sig = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    const i = b.indexOf(sig);
    if (i < 0) { ok(label, false, "no 7z signature found"); return; }
    const tmp = join(os.tmpdir(), "sfx-" + path.basename(exe) + ".7z");
    fs.writeFileSync(tmp, b.subarray(i));
    const r = spawnSync(seven, ["t", tmp], { encoding: "utf8", timeout: 300000 });
    fs.rmSync(tmp, { force: true });
    ok(label, r.status === 0, (r.stderr || "").split("\n")[0]);
  };
  testSfx(exeSetup, "G8 MementoSetup SFX archive extracts cleanly (7za t)");
  testSfx(exeApp, "G8 MEMENTO portable SFX archive extracts cleanly (7za t)");
  const sSize = fs.statSync(exeSetup).size;
  const aSize = fs.statSync(exeApp).size;
  ok("G8 setup is meaningfully smaller than the 255.6 MB of 2.0.0", sSize < 200 * 1024 * 1024, `${(sSize / 1024 ** 2).toFixed(1)} MB`);
  ok("G8 portable app ships WITH cores (bigger than the old 101 MB core-less build)", aSize > 105 * 1024 * 1024, `${(aSize / 1024 ** 2).toFixed(1)} MB`);
}

/* ================= G9 — source guards ================= */
console.log("\nG9 — source guards (icon bugfix, presets, honest UI)");
{
  const ucSrc = fs.readFileSync(join(ROOT, "src", "components", "UpdateCenterTab.tsx"), "utf8");
  ok("G9 UpdateCenterTab no longer renders the literal <icon> element (JSX)", !/<icon\s+className/.test(ucSrc));
  ok("G9 UpdateCenterTab uses a capitalized Icon component", /<Icon className/.test(ucSrc));
  const scanSrc = fs.readFileSync(join(ROOT, "src", "components", "ScannerTab.tsx"), "utf8");
  ok("G9 ScannerTab wires the provider presets", scanSrc.includes("SCAN_PRESETS") && scanSrc.includes("togglePreset"));
  ok("G9 ScannerTab keeps the v2 feature set (copy/export/sort/filter/geo/advanced)", ["Copy IPs", "Copy rows", "exportCsv", "reverseDns", "geoLookup", "concurrency", "Start scan", "Stop"].every((s) => scanSrc.includes(s)));
  ok("G9 cap guard present in the UI", scanSrc.includes("SCAN_HOST_CAP") && scanSrc.includes("overCap"));
  const mockSrc = fs.readFileSync(join(ROOT, "src", "electron-mock.ts"), "utf8");
  ok("G9 browser mock still answers scanner + update IPC (preview parity)", mockSrc.includes("scanner_scan") && mockSrc.includes("update_center_list"));
  const embedSrc = fs.readFileSync(join(ROOT, "scripts", "embed-icon.mjs"), "utf8");
  ok("G9 embed-icon preserves the SFX overlay", embedSrc.includes("overlay"));
}

/* ================= G10 — versions ================= */
console.log("\nG10 — version bump completeness");
{
  const appPkg = JSON.parse(fs.readFileSync(join(APP, "package.json"), "utf8"));
  const setupPkg = JSON.parse(fs.readFileSync(join(SETUP, "package.json"), "utf8"));
  const rootPkg = JSON.parse(fs.readFileSync(join(ROOT, "package.json"), "utf8"));
  ok("G10 electron-app version 3.2.0", appPkg.version === "3.2.0");
  ok("G10 setup-app version 3.2.0", setupPkg.version === "3.2.0");
  ok("G10 root version 3.2.0", rootPkg.version === "3.2.0");
  const mainTs = fs.readFileSync(join(SETUP, "electron", "main.ts"), "utf8");
  ok("G10 SETUP_VERSION = 3.2.0", mainTs.includes('SETUP_VERSION = "3.2.0"'));
  const ucTab = fs.readFileSync(join(ROOT, "src", "components", "UpdateCenterTab.tsx"), "utf8");
  ok("G10 UC fallback version string bumped", ucTab.includes('"3.2.0"'));
  const coreV = JSON.parse(fs.readFileSync(join(APP, "electron", "core-versions.json"), "utf8"));
  ok("G10 pinned cores intact (xray v25.1.1 / sing-box 1.14.0 / aether 1.9.0)", coreV.xray === "v25.1.1" && coreV["sing-box"] === "1.14.0" && coreV.aether === "1.9.0");
}

console.log("\n========================================");
console.log(`taskG smoke: ${pass} passed, ${fail} failed`);
console.log("========================================");
process.exit(fail === 0 ? 0 : 1);
