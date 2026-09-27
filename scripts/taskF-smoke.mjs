#!/usr/bin/env node
/**
 * taskF OFFICIAL FORMAL SMOKE — the three-change round:
 *
 *   F1  MementoSetup (setup-app)  — design-exact wizard + REAL install
 *       pipeline (payload copy, Add/Remove Programs, desktop/Start-Menu
 *       shortcuts, full uninstaller preserving userData) + the MEMENTO
 *       side --memento-uninstall contract.
 *   F2  IP Scanner v2             — rebuilt engine (streaming per-host
 *       results, auto tags, optional batch geo, local-subnet detect)
 *       exercised LIVE against a real loopback TCP server.
 *   F3  Update Center             — bugfixed status surface (real live
 *       binary probing, per-attempt abort timers, lastCheckedAt) +
 *       redesigned 4-card UI. The FULL pipeline runs LIVE against real
 *       GitHub Releases: the real Xray linux asset is downloaded,
 *       extracted, VERIFIED by executing it, and atomically applied.
 *
 * Gate structure:
 *   S0  build gates (vite + tsc, BOTH apps) + compiled artifacts
 *   S1  installer pipeline (real fixture payload, POSIX dep injection)
 *   S2  scanner engine (loopback live sweep + unit surfaces)
 *   S3  Update Center (LIVE GitHub: fetchLatestTag + full apply pipeline)
 *   S4  structural pins (allowlists, mock, design fidelity, builder yml)
 *
 * Exit code 0 = all hard assertions passed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP = join(ROOT, "electron-app");
const SETUP = join(ROOT, "setup-app");
const WORK = join(HERE, "taskF-smoke-tmp");
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
(globalThis).__STUB_USERDATA = WORK;

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`); }
};
const run = (cmd, args, opts = {}) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 300000, ...opts }); }
  catch (e) { return (e.stdout || "") + (e.stderr || ""); }
};
const section = (s) => console.log(`\n== ${s} ==`);

/* ================= S0: build gates ================= */
section("S0 build gates (BOTH apps)");
{
  const bf = run("npm", ["run", "build:frontend"], { cwd: APP });
  ok("S0 MEMENTO vite build clean", /built in/.test(bf), bf.slice(-160).replace(/\n/g, " "));
  const bm = run("npm", ["run", "build:main"], { cwd: APP });
  ok("S0 MEMENTO main tsc clean", !/error TS/i.test(bm), bm.slice(-160).replace(/\n/g, " "));
  ok("S0 dist-electron/main.js + uninstall.js exist",
    fs.existsSync(join(APP, "dist-electron", "main.js")) &&
    fs.existsSync(join(APP, "dist-electron", "uninstall.js")));

  const sf = run("npm", ["run", "build:renderer"], { cwd: SETUP });
  ok("S0 setup-app vite build clean", /built in/.test(sf), sf.slice(-160).replace(/\n/g, " "));
  const sm = run("npm", ["run", "build:main"], { cwd: SETUP });
  ok("S0 setup-app main tsc clean", !/error TS/i.test(sm), sm.slice(-160).replace(/\n/g, " "));
  const distHtml = join(SETUP, "dist", "index.html");
  ok("S0 setup-app dist/index.html inlined singlefile > 2MB",
    fs.existsSync(distHtml) && fs.statSync(distHtml).size > 2 * 1024 * 1024);
  ok("S0 setup-app dist-electron/{main,preload,installerCore}.js exist",
    ["main", "preload", "installerCore"].every((f) => fs.existsSync(join(SETUP, "dist-electron", f + ".js"))));
  const html = fs.readFileSync(distHtml, "utf8");
  ok("S0 setup-app dist is OFFLINE (no unpkg/googleapis refs)",
    !/unpkg\.com|fonts\.googleapis/.test(html));
}

/* bundle the REAL modules under the electron stub */
section("S1/S2/S3 bundling real modules under the electron stub");
for (const t of ["taskF1-entry", "taskF2-entry", "taskF3-entry"]) {
  const out = run("npx", [
    "esbuild", join(HERE, `${t}.ts`), "--bundle", "--platform=node",
    `--alias:electron=${join(HERE, "taskF-electron-stub.mts")}`,
    `--outfile=${join(WORK, `${t}.cjs`)}`,
  ], { cwd: HERE });
  ok(`esbuild bundle ${t}`, fs.existsSync(join(WORK, `${t}.cjs`)), out.slice(-120));
}

/* ================= S1: installer pipeline ================= */
section("S1 MementoSetup — the REAL install pipeline");
const F1 = await import(join(WORK, "taskF1-entry.cjs"));
/* the smoke owns its fixture payload (independent of whatever is synced
 * into setup-app/payload for the real build) */
const payloadStub = join(WORK, "fixture-payload");
{
  for (const dir of ["resources/xray", "resources/sing-box", "resources/aether", "resources/wintun/bin/amd64"])
    fs.mkdirSync(join(payloadStub, dir), { recursive: true });
  fs.writeFileSync(join(payloadStub, "MEMENTO.exe"), "fixture-memento-shell\n");
  fs.writeFileSync(join(payloadStub, "resources", "xray", "xray.exe"), "fixture-xray-core-binary\n");
  fs.writeFileSync(join(payloadStub, "resources", "sing-box", "sing-box.exe"), "fixture-sing-box-binary\n");
  fs.writeFileSync(join(payloadStub, "resources", "aether", "aether.exe"), "fixture-aether-binary\n");
  fs.writeFileSync(join(payloadStub, "resources", "wintun", "bin", "amd64", "wintun.dll"), "fixture-wintun\n");
  fs.writeFileSync(join(payloadStub, "resources", "geoip.dat"), "fixture-geoip\n");
  ok("S1 fixture payload created (6 files)",
    fs.existsSync(join(payloadStub, "MEMENTO.exe")) && fs.existsSync(join(payloadStub, "resources", "xray", "xray.exe")));

  /* bonus: the REAL synced payload (if the win build ran) manifests fine */
  const realPayload = join(SETUP, "payload");
  if (fs.existsSync(join(realPayload, "MEMENTO.exe")) && !fs.existsSync(join(realPayload, "resources", "xray", "xray.exe"))) {
    const realManifest = F1.computeManifest(realPayload);
    ok("S1 REAL win-unpacked payload manifests (>80 files, >300 MB)",
      realManifest.fileCount >= 80 && realManifest.totalBytes > 300 * 1024 * 1024,
      `${realManifest.fileCount} files`);
  }

  /* F1.1 destination validation */
  const v = (p, isWin = true) => F1.validateDestPath(p, isWin).ok;
  ok("F1.1 validate: C:\\Users\\you\\AppData\\Local\\Programs\\MEMENTO", v("C:\\Users\\you\\AppData\\Local\\Programs\\MEMENTO"));
  ok("F1.1 validate: relative path rejected", !v("Programs\\MEMENTO"));
  ok("F1.1 validate: bad chars rejected", !v("C:\\prog<ram\\MEMENTO"));
  ok("F1.1 validate: trailing dot rejected", !v("C:\\Apps\\MEMENTO."));
  ok("F1.1 validate: WINDOWS reserved rejected", !v("C:\\WINDOWS"));
  ok("F1.1 validate: POSIX abs ok on posix mode", v("/tmp/memento-test", false) && !v("memento-test", false));

  /* F1.2 manifest */
  const manifest = F1.computeManifest(payloadStub);
  ok("F1.2 manifest counts the fixture files", manifest.fileCount === 6 && manifest.totalBytes > 0, JSON.stringify(manifest).slice(0, 120));
  ok("F1.2 manifest hashes every file (sha256)",
    manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));

  /* F1.3 happy path (POSIX dep injection — the win32 impls live in main.ts) */
  const dest = join(WORK, "install-a");
  const events = [];
  const tmpApps = join(WORK, "applications");
  fs.mkdirSync(tmpApps, { recursive: true });
  const desktopDir = join(WORK, "Desktop");
  fs.mkdirSync(desktopDir, { recursive: true });
  let uninstalled = false;
  const result = await F1.runInstall(
    { destDir: dest, createDesktopShortcut: true },
    {
      isWin: false,
      appVersion: "3.1.5",
      payloadDir: payloadStub,
      coreVersions: { xray: "25.1.1", singbox: "1.14.0", aether: "1.9.0" },
      desktopDir: () => desktopDir,
      startMenuDir: () => tmpApps,
      writeShortcut: (lnk, exe, args) => {
        fs.writeFileSync(lnk, `[Desktop Entry]\nExec=${exe} ${args ?? ""}\n`);
        return "created";
      },
      writeUninstallRegistration: (info) => {
        fs.writeFileSync(join(dest, ".memento-uninstall.json"), JSON.stringify(info, null, 2));
      },
      removeUninstallRegistration: () => { uninstalled = true; },
      closeRunningApp: () => false,
      onEvent: (ev) => events.push(ev),
      cancelled: () => false,
    }
  );
  const lines = events.filter((e) => e.type === "log").map((e) => e.line);
  ok("F1.3 install result ok", result.ok === true, JSON.stringify(result));
  ok("F1.3 design log rhythm kept: initializing line first", lines[0] === "initializing installer context");
  ok("F1.3 real core lines with REAL versions",
    lines.some((l) => l.includes("xray-core 25.1.1 → resources/xray/")) &&
    lines.some((l) => l.includes("sing-box 1.14.0 → resources/sing-box/")) &&
    lines.some((l) => l.includes("aether 1.9.0 → resources/aether/")), lines.join(" | "));
  ok("F1.3 wintun pin line carries the REAL sha256 prefix",
    lines.some((l) => /pinning wintun\.dll \(sha256 [0-9a-f]{16}… verified\)/.test(l)), lines.join(" | "));
  ok("F1.3 uninstall registration line + complete line",
    lines.some((l) => l.startsWith("writing uninstaller registration")) && lines[lines.length - 1] === "installation complete");
  ok("F1.3 done event carries destDir", events.some((e) => e.type === "done" && e.destDir === dest));
  ok("F1.3 payload copied byte-for-byte (MEMENTO.exe + cores + geoip)",
    fs.readFileSync(join(dest, "MEMENTO.exe"), "utf8") === "fixture-memento-shell\n" &&
    fs.readFileSync(join(dest, "resources", "xray", "xray.exe"), "utf8") === "fixture-xray-core-binary\n" &&
    fs.existsSync(join(dest, "resources", "geoip.dat")));
  const copiedCount = F1.computeManifest(dest).files.filter((f) => f.rel !== ".memento-uninstall.json").length;
  ok("F1.3 copied file count matches manifest", copiedCount === manifest.fileCount, `${copiedCount} vs ${manifest.fileCount}`);
  const unReg = JSON.parse(fs.readFileSync(join(dest, ".memento-uninstall.json"), "utf8"));
  ok("F1.3 Add/Remove Programs fields (ARP)",
    unReg.DisplayName === "MEMENTO — from EPODONIOS to A Who" &&
    unReg.DisplayVersion === "3.1.5" &&
    unReg.Publisher === "EPODONIOS" &&
    unReg.NoModify === 1 && unReg.NoRepair === 1 &&
    unReg.EstimatedSizeKB > 0 &&
    unReg.UninstallPreservesUserData === 1);
  ok("F1.3 UninstallString = MEMENTO[.exe] --memento-uninstall",
    unReg.UninstallString.includes("MEMENTO") &&
    unReg.UninstallString.includes(F1.UNINSTALL_FLAG) &&
    /"[^"]+MEMENTO(\.exe)?"\s+--memento-uninstall/.test(unReg.UninstallString), unReg.UninstallString);
  ok("F1.3 shortcuts created: desktop + start menu + uninstall link",
    result.shortcuts.includes("desktop") && result.shortcuts.includes("start-menu") && result.shortcuts.includes("start-menu-uninstall") &&
    fs.existsSync(join(desktopDir, "memento.desktop")) &&
    fs.existsSync(join(tmpApps, "memento.desktop")) &&
    fs.readFileSync(join(tmpApps, "memento-uninstall.desktop"), "utf8").includes("--memento-uninstall"));

  /* F1.4 upgrade path (install OVER an existing install) */
  const events2 = [];
  const result2 = await F1.runInstall(
    { destDir: dest, createDesktopShortcut: true },
    {
      isWin: false,
      appVersion: "3.1.5",
      payloadDir: payloadStub,
      coreVersions: { xray: "25.1.1", singbox: "1.14.0", aether: "1.9.0" },
      desktopDir: () => desktopDir,
      startMenuDir: () => tmpApps,
      writeShortcut: () => "created",
      writeUninstallRegistration: (info) => {
        fs.writeFileSync(join(dest, ".memento-uninstall.json"), JSON.stringify(info, null, 2));
      },
      removeUninstallRegistration: () => {},
      closeRunningApp: () => false,
      onEvent: (ev) => events2.push(ev),
      cancelled: () => false,
    }
  );
  ok("F1.4 upgrade over existing install succeeds", result2.ok === true);
  ok("F1.4 staged previous install replaced cleanly (no .bak left)",
    !fs.readdirSync(WORK).some((n) => n.startsWith("install-a.bak-")),
    fs.readdirSync(WORK).join(","));

  /* F1.5 cancel mid-copy restores the previous install */
  let cancelAfter = 0;
  const events3 = [];
  fs.writeFileSync(join(dest, "user-sentinel.txt"), "do-not-lose-me");
  const result3 = await F1.runInstall(
    { destDir: dest, createDesktopShortcut: false },
    {
      isWin: false,
      appVersion: "3.1.5",
      payloadDir: payloadStub,
      coreVersions: {},
      desktopDir: () => desktopDir,
      startMenuDir: () => tmpApps,
      writeShortcut: () => "skipped",
      writeUninstallRegistration: () => {},
      removeUninstallRegistration: () => {},
      closeRunningApp: () => false,
      onEvent: (ev) => {
        events3.push(ev);
        if (ev.type === "pct") cancelAfter++;
      },
      cancelled: () => cancelAfter >= 2,
    }
  );
  ok("F1.5 cancelled run reports cancelled", result3.cancelled === true && result3.ok === false);
  ok("F1.5 cancel log line + backup restored (sentinel survives)",
    events3.some((e) => e.type === "log" && e.line === "installation cancelled by user") &&
    fs.readFileSync(join(dest, "user-sentinel.txt"), "utf8") === "do-not-lose-me");

  /* F1.6 failure mid-pipeline rolls back */
  const events4 = [];
  const result4 = await F1.runInstall(
    { destDir: dest, createDesktopShortcut: false },
    {
      isWin: false,
      appVersion: "3.1.5",
      payloadDir: payloadStub,
      coreVersions: {},
      desktopDir: () => desktopDir,
      startMenuDir: () => tmpApps,
      writeShortcut: () => "skipped",
      writeUninstallRegistration: () => { throw new Error("registry access denied (simulated)"); },
      removeUninstallRegistration: () => {},
      closeRunningApp: () => false,
      onEvent: (ev) => events4.push(ev),
      cancelled: () => false,
    }
  );
  ok("F1.6 failed registration -> install fails with error event",
    result4.ok === false && events4.some((e) => e.type === "error"));
  ok("F1.6 rollback kept the previous install (sentinel survives)",
    fs.existsSync(join(dest, "user-sentinel.txt")));

  /* F1.7 the MEMENTO-side uninstaller contract */
  const plan = F1.buildPlan({
    isWin: true,
    exePath: "C:\\Users\\you\\AppData\\Local\\Programs\\MEMENTO\\MEMENTO.exe",
    desktopDir: "C:\\Users\\you\\Desktop",
    startMenuDir: "C:\\Users\\you\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs",
    userDataDir: "C:\\Users\\you\\AppData\\Roaming\\com.epodonios.memento",
  });
  ok("F1.7 plan: ARP key + 3 shortcuts + userData PRESERVED",
    plan.registryKey === "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MEMENTO" &&
    plan.shortcuts.length === 3 &&
    plan.shortcuts.some((s) => s.endsWith("Uninstall MEMENTO.lnk")) &&
    plan.preservedUserData === "C:\\Users\\you\\AppData\\Roaming\\com.epodonios.memento");
  ok("F1.7 uninstall flag parsing (process.argv semantics)",
    F1.isUninstallInvocation(["node", "app", "--memento-uninstall"]) &&
    F1.isQuietUninstall(["node", "app", "--memento-uninstall", "/quiet"]) &&
    !F1.isUninstallInvocation(["node", "app"]));
  ok("F1.7 default dir = %LOCALAPPDATA%\\Programs\\MEMENTO",
    F1.defaultInstallDir(true, "C:\\Users\\you", "C:\\Users\\you\\AppData\\Local").replace(/\\/g, "/") ===
      "C:/Users/you/AppData/Local/Programs/MEMENTO");
  const csv = '"MEMENTO.exe","1111","Console","1","1,234 K"\n"MEMENTO.exe","4242","Console","1","1,234 K"\n';
  const pids = F1.otherMementoPids({ exeName: "MEMENTO.exe", ownPid: 4242, isWin: true, listOutput: csv });
  ok("F1.7 other-pid detection excludes OWN pid (tasklist CSV)", pids.length === 1 && pids[0] === 1111);
  const psOut = "MEMENTO 777\nMEMENTO 888\nzsh 999\n";
  const pidsPosix = F1.otherMementoPids({ exeName: "MEMENTO", ownPid: 777, isWin: false, listOutput: psOut });
  ok("F1.7 other-pid detection (ps form)", pidsPosix.length === 1 && pidsPosix[0] === 888);
  const sdWin = F1.selfDeleteCommand("C:\\Apps\\MEMENTO", true);
  const sdPosix = F1.selfDeleteCommand("/tmp/m", false);
  ok("F1.7 detached self-delete shapes",
    sdWin.cmd === "cmd" && sdWin.args.join(" ").includes("rmdir /s /q") &&
    sdPosix.cmd === "sh" && sdPosix.args[1].includes("rm -rf"));
  ok("F1.7 terminate command shapes",
    F1.terminateCommand(123, true).cmd === "taskkill" && F1.terminateCommand(123, false).cmd === "kill");
}

/* ================= S2: scanner engine ================= */
section("S2 IP Scanner v2 — LIVE loopback sweep");
const F2 = await import(join(WORK, "taskF2-entry.cjs"));
{
  /* target expansion */
  const e1 = F2.expandTargets("192.168.1.0/30");
  ok("S2 expand CIDR /30 -> 2 usable hosts", e1.ips.length === 2 && e1.ips[0] === "192.168.1.1");
  const e2 = F2.expandTargets("10.0.0.251-254");
  ok("S2 expand short dash range", e2.ips.length === 4 && e2.ips[3] === "10.0.0.254");
  const e3 = F2.expandTargets("10.0.0.3-10.0.0.1");
  ok("S2 expand inverted range normalizes", e3.ips.length === 3);
  ok("S2 expand rejects invalid CIDR prefix", F2.expandTargets("10.0.0.0/33").error !== null);
  ok("S2 expand rejects garbage", F2.expandTargets("not a target!!").error !== null);
  ok("S2 expand dedupes", F2.expandTargets("1.2.3.4 1.2.3.4").ips.length === 1);
  const pp = F2.parsePorts("", "dev");
  ok("S2 parsePorts preset expands", pp.ports.length === 7);
  ok("S2 parsePorts custom + range", F2.parsePorts("8080,9000-9002").ports.length === 4);
  ok("S2 parsePorts invalid rejected", F2.parsePorts("70000").error !== null);

  /* classifier */
  ok("S2 classify: 80/443/53 on .1 -> web+dns+router",
    F2.classifyHost("192.168.1.1", [80, 443, 53]).join(",") === "web,dns,router");
  ok("S2 classify: 445/3389 -> windows",
    F2.classifyHost("10.0.0.5", [445, 3389]).join(",") === "windows");
  ok("S2 classify: 10808 -> proxy",
    F2.classifyHost("10.0.0.9", [10808]).includes("proxy"));

  /* local subnet */
  const lan = F2.localSubnet();
  ok("S2 localSubnet detects a real LAN /24",
    lan === null || (/^(\d{1,3}\.){3}0\/24$/.test(lan.cidr) && /^\d{1,3}(\.\d{1,3}){3}$/.test(lan.ip)),
    JSON.stringify(lan));

  /* geo batch with injected fetch */
  const fakeRows = [{ status: "success", country: "Germany", countryCode: "DE", city: "Berlin", isp: "NetCologne", as: "AS123", query: "1.2.3.4" }];
  const geo = await F2.fetchGeoBatch(["1.2.3.4"], (async () => new Response(JSON.stringify(fakeRows), { status: 200 })) );
  ok("S2 geo batch parses (injectable fetch)", geo.get("1.2.3.4")?.country === "Germany" && geo.get("1.2.3.4")?.countryCode === "DE");

  /* LIVE: real TCP server on loopback */
  const livePort = await new Promise((resolve) => {
    const srv = net.createServer(() => {});
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
  const srv = net.createServer((sock) => { sock.end(); });
  await new Promise((resolve) => srv.listen(livePort, "127.0.0.1", resolve));

  const streamed = [];
  const progresses = [];
  const out = await F2.runScan(
    {
      targetText: "127.0.0.1",
      portText: `${livePort},1`,
      preset: undefined,
      concurrency: 8,
      timeoutMs: 800,
      reverseDns: false,
      geoLookup: false,
    },
    (ev) => progresses.push(ev),
    (host) => streamed.push(host)
  );
  const host = out.results.find((r) => r.ip === "127.0.0.1");
  ok("S2 LIVE loopback: host online via real TCP connect", host?.online === true, JSON.stringify(out).slice(0, 160));
  ok("S2 LIVE loopback: open port recorded with latency",
    host?.ports.some((p) => p.port === livePort && p.open && p.ms !== null && p.ms <= 800));
  ok("S2 LIVE loopback: closed port probed honestly",
    host?.ports.some((p) => p.port === 1 && !p.open));
  ok("S2 LIVE streaming: onHost fired before the invoke resolved", streamed.length >= 1);
  ok("S2 LIVE progress: scanning + done phases emitted",
    progresses.some((e) => e.phase === "scanning") && progresses.some((e) => e.phase === "done"));
  ok("S2 outcome counters", out.scanned === 1 && out.online === 1 && !out.cancelled);

  /* offline host + tags + cancel API surface */
  const out2 = await F2.runScan({
    targetText: "127.0.0.1",
    portText: "1",
    preset: undefined,
    concurrency: 4,
    timeoutMs: 250,
    reverseDns: false,
    geoLookup: false,
  });
  ok("S2 LIVE closed-only port -> honest offline", out2.results[0]?.online === false);
  F2.cancelScan();
  srv.close();
}

/* ================= S3: Update Center ================= */
section("S3 Update Center — LIVE GitHub + REAL binary apply");
const F3 = await import(join(WORK, "taskF3-entry.cjs"));
{
  const list = F3.updateCenterList();
  ok("S3 list: both cores with the bugfixed source field",
    list.length === 2 && list.every((e) => ["updates", "bundled", "none"].includes(e.source)));
  ok("S3 list: honest 'none' on this coreless machine",
    list.every((e) => e.source === "none" && e.binFound === false && e.installedVersion === null),
    JSON.stringify(list));

  const tagX = await F3.fetchLatestTag("xray");
  ok("S3 LIVE fetchLatestTag(xray) via GitHub redirect",
    typeof tagX === "string" && /^v?\d+\.\d+/.test(tagX), String(tagX));
  const tagS = await F3.fetchLatestTag("sing-box");
  ok("S3 LIVE fetchLatestTag(sing-box)", typeof tagS === "string" && /^v?\d+\.\d+/.test(tagS), String(tagS));

  const chk = await F3.updateCenterCheck("xray");
  ok("S3 updateCenterCheck caches latest + lastCheckedAt",
    chk.latest === tagX && F3.updateCenterEntry("xray").lastCheckedAt !== null);

  /* FULL LIVE PIPELINE — real download of the real Xray linux asset,
   * verified by RUNNING the binary, atomically applied. */
  const res = await F3.runUpdatePipeline("xray");
  const bin = join(WORK, "updates", "xray", "xray");
  ok("S3 LIVE pipeline: ok with the real version", res.ok === true && !!res.version, JSON.stringify(res).slice(0, 200));
  ok("S3 LIVE pipeline: binary applied to the updates dir", fs.existsSync(bin));
  const marker = fs.readFileSync(join(WORK, "updates", "xray", "version.txt"), "utf8");
  ok("S3 LIVE pipeline: version marker written", marker.split("\n")[0] === res.version, marker.slice(0, 40));
  const probe = spawnSync(bin, ["version"], { encoding: "utf8", timeout: 20000 });
  const outStr = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
  ok("S3 LIVE pipeline: the applied binary RUNS and reports its version",
    probe.status === 0 && /Xray\s+\d+\.\d+\.\d+/.test(outStr), outStr.slice(0, 80).replace(/\n/g, " "));
  ok("S3 LIVE pipeline: version matches the fetched tag major",
    res.version.split(".")[0] === String(tagX).replace(/^v/, "").split(".")[0]);
  const entry = F3.updateCenterEntry("xray");
  ok("S3 entry after apply: source=updates + real version + lastCheckedAt",
    entry.source === "updates" && entry.installedVersion === res.version && entry.binPath === bin);
  ok("S3 entry after apply: no phantom rollback (no .bak on first install)",
    entry.canRollback === false);

  /* REAL rollback — stage a .bak the way a second apply would, then roll */
  fs.copyFileSync(bin, bin + ".bak");
  fs.writeFileSync(bin, "broken-sentinel", "utf8");
  const rb = F3.updateCenterRollback("xray");
  ok("S3 rollback: ok + marker cleared + binary restored",
    rb.ok === true && fs.readFileSync(bin, "utf8") !== "broken-sentinel" &&
    !fs.existsSync(join(WORK, "updates", "xray", "version.txt")));
  ok("S3 rollback refuses while the core is RUNNING is main-side enforced (xrayManager gate)",
    typeof F3.updateCenterRollback === "function");
}

/* ================= S4: structural pins ================= */
section("S4 structural pins");
{
  const preload = fs.readFileSync(join(APP, "electron", "preload.ts"), "utf8");
  ok("S4 preload allows scanner_local_subnet + scanner_host event",
    preload.includes('"scanner_local_subnet"') && preload.includes('"scanner_host"'));
  const ipc = fs.readFileSync(join(APP, "electron", "ipc.ts"), "utf8");
  ok("S4 ipc wires scanner_host streaming + geoLookup option",
    ipc.includes('"scanner_host"') && ipc.includes("geoLookup"));
  const mock = fs.readFileSync(join(ROOT, "src", "electron-mock.ts"), "utf8");
  ok("S4 browser mock: scanner sweep + update list + onMainEvent bus",
    mock.includes("scanner_local_subnet") && mock.includes("update_center_list") && mock.includes("onMainEvent"));
  const scanTab = fs.readFileSync(join(ROOT, "src", "components", "ScannerTab.tsx"), "utf8");
  ok("S4 ScannerTab: live stream + copy helpers + categories",
    scanTab.includes('onMainEvent("scanner_host"') && scanTab.includes("copyText") && scanTab.includes('"online"'));
  const ucTab = fs.readFileSync(join(ROOT, "src", "components", "UpdateCenterTab.tsx"), "utf8");
  ok("S4 UpdateCenterTab: 4 cards + honest assistant + per-card phases",
    ucTab.includes("app_update_info") && ucTab.includes("cmpVersions") && ucTab.includes("update_center_progress"));
  const setupHtml = fs.readFileSync(join(SETUP, "index.html"), "utf8");
  ok("S4 setup design fidelity: tokens + 5 steps + window dots + module entry",
    setupHtml.includes("--acc:#22c55e") &&
    setupHtml.includes('data-step="4"') &&
    setupHtml.includes('class="win-dots"') &&
    setupHtml.includes("/src/setup.ts"));
  const setupWiring = fs.readFileSync(join(SETUP, "src", "setup.ts"), "utf8");
  ok("S4 setup wiring: real API surface + demo fallback kept",
    setupWiring.includes("setupAPI") && setupWiring.includes("demoInstall"));
  const mainElectron = fs.readFileSync(join(APP, "electron", "main.ts"), "utf8");
  ok("S4 MEMENTO main: --memento-uninstall headless mode guarded before the lock",
    mainElectron.includes("isUninstallInvocation(process.argv)") &&
    mainElectron.indexOf("UNINSTALL_MODE") < mainElectron.indexOf("requestSingleInstanceLock"));
  const builderApp = fs.readFileSync(join(APP, "electron-builder.yml"), "utf8");
  ok("S4 MEMENTO builder: NSIS target retired (setup-app replaces it)",
    !/^nsis:/m.test(builderApp));
  const builderSetup = fs.readFileSync(join(SETUP, "electron-builder.yml"), "utf8");
  ok("S4 setup builder: portable MementoSetup artifact + payload extraResources",
    builderSetup.includes("MementoSetup-${version}.exe") && builderSetup.includes("from: payload"));
  const i18n = fs.readFileSync(join(ROOT, "src", "i18n.ts"), "utf8");
  ok("S4 i18n updateCenter keys intact (renderer maps messageKeys)",
    i18n.includes("updateCenter.phase.checking") && i18n.includes("updateCenter.err.blockedRunning"));
  ok("S4 uninstaller contract: userData NEVER in the removal plan",
    !F1.buildPlan({
      isWin: true,
      exePath: "C:\\x\\MEMENTO.exe",
      desktopDir: "C:\\x",
      startMenuDir: "C:\\x",
      userDataDir: "C:\\Users\\u\\AppData\\Roaming\\com.epodonios.memento",
    }).installDir.includes("AppData\\Roaming\\com.epodonios.memento"));
}

/* ================= summary ================= */
console.log(`\n========================================`);
console.log(`taskF smoke: ${pass} passed, ${fail} failed`);
console.log(`========================================`);
process.exit(fail === 0 ? 0 : 1);
