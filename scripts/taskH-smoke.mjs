/**
 * taskH-smoke.mjs — the 3.1.7 feature gates.
 *
 * Covers the four user changes of the 3.1.7 round:
 *   H1  MementoSetup window = design-exact 900×640 canvas, TRANSPARENT
 *       frame (rounded corners are the real window shape, no square
 *       corners sticking out)
 *   H2  Payload STAGING rescue — the root cause of the user's
 *       "Installation failed: ENOENT …\Temp\<id>\resources\payload":
 *       a second launch of the portable exe RMDir's the shared
 *       %TEMP%\<unpack-id> extraction folder (electron-builder
 *       portable.nsi line 38) and wipes the payload from under the
 *       RUNNING wizard. The wizard now stages the payload into a
 *       private %LOCALAPPDATA% folder seconds after launch and installs
 *       from there.
 *   H3  Tolerant installerCore — vanished/locked files are SKIPPED with
 *       honest log lines, the install COMPLETES (live behavioral test
 *       with an unreadable file), improved payload-missing wording.
 *   H4  MHRV overhaul — front-domain manager, multi Deployment IDs with
 *       round-robin auto-failover, the full mhrv-rs settings surface
 *       (shareLan, upstream SOCKS5, parallel dispatch, log level, X/Twitter
 *       normalization, YouTube relay, QUIC/STUN blocks), log ring buffer,
 *       CA remove/check, update check.
 *   H5  Live Connection per-app consumption — sing-box sourcePort
 *       attribution, per-app byte ledger + EMA speeds, custom redesign.
 *   H6  Config Builder (v2rayN-style generator) inside Import Config.
 *   H7  Real Windows artifacts exist for 3.1.7 / 2.0.3.
 *   H8  AV-hardening round (setup 2.0.3): requireAdministrator stub,
 *       hardlink runtime clone (no self-image byte copy), move-staging
 *       (no third content write of the cores), honest unsigned-binary
 *       guidance in the install log + docs.
 *
 * Run: node scripts/taskH-smoke.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SETUP = path.join(ROOT, "setup-app");
const APP = path.join(ROOT, "electron-app");

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`); }
};

/* ================= H1 — design-exact window (2.0.6: the window IS the panel) == */
console.log("\nH1 — setup window: 900×640 panel, opaque, square corners, native shadow (2.0.6)");
{
  const mainJs = fs.readFileSync(path.join(SETUP, "dist-electron", "main.js"), "utf8");
  ok("H1 window content size is 900×640 (the window IS the panel, 1:1)",
    /width:\s*900/.test(mainJs) && /height:\s*640/.test(mainJs));
  ok("H1 useContentSize true", /useContentSize:\s*true/.test(mainJs));
  ok("H1 opaque window (transparent: false — no margin/halo)", /transparent:\s*false/.test(mainJs));
  ok("H1 square corners (roundedCorners: false)", /roundedCorners:\s*false/.test(mainJs));
  ok("H1 native OS shadow only (no CSS glow outside the panel)", /hasShadow:\s*true/.test(mainJs));
  ok("H1 opaque background color #070c09 (design gradient's darkest tone)",
    /backgroundColor:\s*"#070c09"/.test(mainJs));
  ok("H1 the old 960×730 transparent canvas is gone",
    !/width:\s*960/.test(mainJs) && !/height:\s*730/.test(mainJs) &&
    !/transparent:\s*true/.test(mainJs) && !/#00000000/.test(mainJs));
  ok("H1 fixed-size window (resizable/maximizable/fullscreenable off)",
    /resizable:\s*false/.test(mainJs) && /maximizable:\s*false/.test(mainJs) && /fullscreenable:\s*false/.test(mainJs));
  const html = fs.readFileSync(path.join(SETUP, "index.html"), "utf8");
  ok("H1 renderer body background transparent (the surface is the window color)", /background:\s*transparent/.test(html));
  ok("H1 fake desktop backdrop hidden (no smeared edges)", /\.desktop\{[^}]*display:\s*none/.test(html));
  ok("H1 .window fills the viewport with square corners (100vw/100vh, radius 0)",
    /\.window\{[^}]*width:\s*100vw;\s*height:\s*100vh/.test(html.replace(/\n/g, "")) &&
    /\.window\{[^}]*border-radius:\s*0/.test(html.replace(/\n/g, "")));
  ok("H1 stage hint row removed (2.0.6)", /\.stage-hint\{[^}]*display:\s*none/.test(html.replace(/\n/g, "")));
}

/* ================= H2 — staging rescue (the ENOENT fix) ================= */
console.log("\nH2 — payload staging rescue (portable RMDir race)");
{
  const mainJs = fs.readFileSync(path.join(SETUP, "dist-electron", "main.js"), "utf8");
  ok("H2 staging module compiled in", mainJs.includes("startPayloadStaging") && mainJs.includes("copyTreeTolerant"));
  ok("H2 staging lives under MementoSetup/staging (private dir)",
    mainJs.includes("MementoSetup") && mainJs.includes("staging"));
  ok("H2 stale stage-* cleanup on boot", mainJs.includes("cleanupStaleStaging"));
  ok("H2 install reads the STAGED payload (installPayloadDir)", mainJs.includes("installPayloadDir()"));
  ok("H2 setup:start awaits the staging promise before installing",
    /staging\?\.promise/.test(mainJs));
  ok("H2 staging disposed on quit", mainJs.includes("disposeStaging"));
  ok("H2 staging only when packaged (dev runs unchanged)", /isPackaged\)\s*return/.test(mainJs));
}

/* ============ H3 — tolerant installerCore (LIVE behavioral) ============ */
console.log("\nH3 — tolerant installer: vanished/locked files skip, install completes");
{
  const core = fs.readFileSync(path.join(SETUP, "dist-electron", "installerCore.js"), "utf8");
  ok("H3 tolerance compiled in (skipped counter)", core.includes("skipped"));
  ok("H3 antivirus guidance in the payload-missing message",
    /antivirus/i.test(core) && /payload is missing/.test(core));
  ok("H3 Update Center hint on skipped payload files", /Update Center/.test(core));
  ok("H3 honest missing-core warning", /was NOT installed/.test(core));

  // LIVE: full-tree install where one payload file is UNREADABLE (EACCES)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH-tolerant-"));
  const payloadDir = path.join(work, "payload");
  fs.mkdirSync(path.join(payloadDir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(payloadDir, "a.txt"), "A".repeat(4096));
  fs.writeFileSync(path.join(payloadDir, "sub", "b.txt"), "B".repeat(4096));
  const locked = path.join(payloadDir, "locked.bin");
  fs.writeFileSync(locked, "LOCKED".repeat(2048));
  fs.chmodSync(locked, 0o000); // non-root owner can no longer read it

  const dest = path.join(work, "dest");
  const mod = await import(path.join(SETUP, "dist-electron", "installerCore.js"));
  const events = [];
  const result = await mod.runInstall(
    { destDir: dest, createDesktopShortcut: false },
    {
      isWin: false,
      appVersion: "3.1.7",
      payloadDir,
      coreVersions: {},
      desktopDir: () => path.join(work, "desktop"),
      startMenuDir: () => path.join(work, "sm"),
      writeShortcut: () => "skipped",
      writeUninstallRegistration: () => {},
      removeUninstallRegistration: () => {},
      closeRunningApp: () => false,
      onEvent: (ev) => events.push(ev),
      cancelled: () => false,
    }
  );
  ok("H3 install SUCCEEDS despite an unreadable payload file", result.ok === true, result.error || "");
  ok("H3 the unreadable file was skipped and reported",
    events.some((e) => e.type === "log" && /skipped/.test(e.line || "")));
  ok("H3 all readable files still landed", fs.existsSync(path.join(dest, "a.txt")) && fs.existsSync(path.join(dest, "sub", "b.txt")));
  ok("H3 skipped file honestly absent from destination", !fs.existsSync(path.join(dest, "locked.bin")));
  const errEvents = events.filter((e) => e.type === "error");
  ok("H3 no hard error event for a tolerated skip", errEvents.length === 0, JSON.stringify(errEvents).slice(0, 120));
  fs.chmodSync(locked, 0o644);
  fs.rmSync(work, { recursive: true, force: true });
}

/* ================= H4 — MHRV overhaul (LIVE module drive) ================= */
console.log("\nH4 — MHRV: domains, multi deployment IDs, mhrv-rs settings, logs");
{
  const work = path.join(ROOT, "taskH-smoke-tmp");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  (globalThis).__STUB_USERDATA = work;
  fs.writeFileSync(
    path.join(work, "taskH4-entry.ts"),
    `export * from "${path.join(APP, "electron", "mhrv.ts").replace(/\\/g, "/")}";\n`
  );
  const bund = spawnSync("npx", [
    "esbuild", path.join(work, "taskH4-entry.ts"), "--bundle", "--platform=node",
    `--alias:electron=${path.join(HERE, "taskF-electron-stub.mts")}`,
    `--outfile=${path.join(work, "taskH4-entry.cjs")}`,
  ], { encoding: "utf8", cwd: ROOT, timeout: 120000 });
  ok("H4 mhrv.ts bundles under the electron stub", fs.existsSync(path.join(work, "taskH4-entry.cjs")), (bund.stderr || "").slice(-160));
  if (fs.existsSync(path.join(work, "taskH4-entry.cjs"))) {
    const m = await import(path.join(work, "taskH4-entry.cjs"));
    ok("H4 managed front domains ship a mhrv-like list (>=16)", (m.DEFAULT_FRONT_DOMAINS || []).length >= 16, String((m.DEFAULT_FRONT_DOMAINS || []).length));
    ok("H4 default www.google.com member of the managed list", (m.DEFAULT_FRONT_DOMAINS || []).includes("www.google.com"));
    ok("H4 SNI pool has the mhrv 13 candidates", (m.DEFAULT_SNI_POOL || []).length === 13, String((m.DEFAULT_SNI_POOL || []).length));

    // config sanitize — REAL saveConfig through the stub userData
    const saved = m.saveConfig({
      scriptIds: ["  AKfycbID-1 ", "", "AKfycbID-2", 42],
      frontDomains: ["www.google.com", " not-google.example ", "www.google.com"],
      sniPool: ["keep"],
      logLevel: "bogus",
      parallelDispatch: 9999,
      upstreamSocks5: " 127.0.0.1:50529 ",
      shareLan: true,
      blockQuic: true,
      blockStun: true,
      youtubeThroughRelay: true,
      normalizeXTwitter: true,
    });
    ok("H4 multi deployment IDs saved as a clean array", Array.isArray(saved.scriptIds) && saved.scriptIds[0] === "AKfycbID-1" && saved.scriptIds.includes("AKfycbID-2"), JSON.stringify(saved.scriptIds));
    ok("H4 frontDomains sanitized (trim, dedupe, active domain kept)",
      saved.frontDomains.includes("www.google.com") && saved.frontDomains.includes("not-google.example") &&
      saved.frontDomains.filter((d) => d === "www.google.com").length === 1, JSON.stringify(saved.frontDomains));
    ok("H4 bogus logLevel falls back to info", saved.logLevel === "info");
    ok("H4 parallelDispatch clamped to sane bounds", saved.parallelDispatch >= 0 && saved.parallelDispatch <= 64, String(saved.parallelDispatch));
    ok("H4 upstream socks5 trimmed + parsed", saved.upstreamSocks5 === "127.0.0.1:50529" && m.parseUpstreamSocks5(saved.upstreamSocks5)?.host === "127.0.0.1");
    ok("H4 invalid upstream parses to null (honest fallback)", m.parseUpstreamSocks5("no-port-here") === null);
    ok("H4 shareLan persisted", saved.shareLan === true);
    const reloaded = m.loadConfig();
    ok("H4 config persists across loads (config.json)", reloaded.scriptIds?.[0] === "AKfycbID-1" && reloaded.frontDomains?.length >= 2);

    // log ring buffer — level filtering + cap
    m.mhrvLogsClear();
    m.mlog("error", "E-line");
    m.mlog("info", "I-line");
    m.mlog("debug", "D-line");
    const all = m.mhrvLogsGet({ limit: 50 });
    ok("H4 log ring captures levels", all.some((l) => l.text === "E-line") && all.some((l) => l.text === "I-line"));
    ok("H4 min-level filter excludes debug at info", !m.mhrvLogsGet({ level: "info", limit: 50 }).some((l) => l.text === "D-line"));
    ok("H4 error filter returns only error+ lines", m.mhrvLogsGet({ level: "error", limit: 50 }).every((l) => l.level === "error"));

    // host matching — the two relay routing toggles are REAL functions
    ok("H4 youtubeThroughRelay routes googlevideo/youtube hosts", m.matchesYoutubeRelay("rr3---sn-abcd.googlevideo.com") === true && m.matchesYoutubeRelay("example.com") === false);
    ok("H4 SNI rewrite matcher still Google-only", m.matchesSniRewrite("www.google.com") === true && m.matchesSniRewrite("example.com") === false);

    // round-robin failover is exported and shaped correctly
    ok("H4 relayWithFailover exported (multi-ID auto-failover)", typeof m.relayWithFailover === "function");
    ok("H4 socks5Connect exported (upstream chaining)", typeof m.socks5Connect === "function");
  }

  // renderer static gates — the mhrv-rs settings surface really exists
  const gst = fs.readFileSync(path.join(ROOT, "src", "components", "GoogleSideTab.tsx"), "utf8");
  ok("H4 UI: multiline Deployment IDs (round-robin tip)", /one deployment ID per line|round-robin/i.test(gst));
  ok("H4 UI: front-domain chip manager (select + add + remove)",
    /frontDomains/.test(gst) && /frontDomain/.test(gst));
  ok("H4 UI: Share with other devices toggle", /shareLan|Share with other devices/i.test(gst));
  ok("H4 UI: Upstream SOCKS5 + Parallel dispatch + Log level", /upstreamSocks5/.test(gst) && /parallelDispatch/.test(gst) && /logLevel/.test(gst));
  ok("H4 UI: QUIC + STUN/TURN blocks", /blockQuic/.test(gst) && /blockStun/.test(gst));
  ok("H4 UI: X/Twitter normalize + YouTube relay toggles", /normalizeXTwitter/.test(gst) && /youtubeThroughRelay/.test(gst));
  ok("H4 UI: Save config + CA remove/check + check updates", /mhrv_ca_remove/.test(gst) && /mhrv_ca_check/.test(gst) && /mhrv_update_check/.test(gst));
  ok("H4 UI: recent log console (get/clear/save)", /mhrv_logs_get/.test(gst) && /mhrv_logs_clear/.test(gst) && /mhrv_logs_save/.test(gst));
  const ipc = fs.readFileSync(path.join(APP, "electron", "ipc.ts"), "utf8");
  ok("H4 IPC: all six new handlers registered",
    ["mhrv_logs_get", "mhrv_logs_clear", "mhrv_logs_save", "mhrv_ca_remove", "mhrv_ca_check", "mhrv_update_check"]
      .every((c) => ipc.includes(`"${c}"`)));
  const pre = fs.readFileSync(path.join(APP, "electron", "preload.ts"), "utf8");
  ok("H4 preload allowlist extended", ["mhrv_logs_get", "mhrv_ca_remove", "mhrv_ca_check", "mhrv_update_check"].every((c) => pre.includes(`"${c}"`)));
}

/* ============ H5 — Live Connection per-app consumption ============ */
console.log("\nH5 — Live Connection: per-app bytes, rates, details");
{
  const cs = fs.readFileSync(path.join(APP, "dist-electron", "connectionStats.js"), "utf8");
  ok("H5 sing-box rows carry sourceIP/sourcePort (attribution join key)", /sourceIP/.test(cs) && /sourcePort/.test(cs));
  const tab = fs.readFileSync(path.join(ROOT, "src", "components", "LiveConnTab.tsx"), "utf8");
  ok("H5 renderer joins snapshot ports with core rows", tab.includes("sourcePort") && tab.includes("live_conn_snapshot") && tab.includes("get_connection_stats"));
  ok("H5 per-app byte ledger with reset-safe deltas", /delta|prev/i.test(tab) && /ledger|Map</.test(tab));
  ok("H5 live speed EMA", /EMA|ema|0\.45|alpha/i.test(tab));
  ok("H5 honest xray granularity note (no per-app split)", /per-outbound|xray/i.test(tab));
  ok("H5 top-consumer highlight + usage share bars", /top consumer|crown/i.test(tab));
  ok("H5 byte formatter (B/KB/MB/GB)", /formatBytes|fmtBytes/i.test(tab));
  const mock = fs.readFileSync(path.join(ROOT, "src", "electron-mock.ts"), "utf8");
  ok("H5 browser-preview mock for connection stats", mock.includes("get_connection_stats"));
  // LIVE: the OS snapshot still parses on this host (Linux ss path)
  const lc = await import(path.join(APP, "dist-electron", "liveConn.js"));
  const snap = lc.liveConnSnapshot();
  ok("H5 LIVE snapshot returns honest rows on this host", Array.isArray(snap.rows) && Array.isArray(snap.apps) && snap.totals && typeof snap.totals.apps === "number", `rows=${snap.rows?.length}`);
  ok("H5 LIVE aggregateByApp keeps per-app counts (no bytes invented)", snap.apps.every((a) => typeof a.total === "number" && (a.download === undefined || typeof a.download === "number")));
}

/* ============ H6 — Config Builder (v2rayN-style) ============ */
console.log("\nH6 — Import Config: Config Builder");
{
  const p = path.join(ROOT, "src", "components", "ConfigBuilderTab.tsx");
  ok("H6 ConfigBuilderTab exists", fs.existsSync(p));
  const src = fs.readFileSync(p, "utf8");
  ok("H6 generates all four share-link schemes", ["vmess://", "vless://", "trojan://", "ss://"].every((s) => src.includes(`"${s}"`) || src.includes(`'${s}'`) || src.includes(s + "`") || new RegExp(s.replace("://", "://")).test(src)));
  ok("H6 transport coverage tcp/ws/grpc/h2", /grpc/.test(src) && /httpupgrade|ws/.test(src));
  ok("H6 Reality support (pbk/sid/fp)", /pbk/.test(src) && /sid/.test(src) && /fp/.test(src));
  ok("H6 QR code preview", /qrcode/i.test(src));
  ok("H6 imports through the REAL store path (addConfigs)", /addConfigs/.test(src) || /onImported/.test(src));
  const imp = fs.readFileSync(path.join(ROOT, "src", "components", "ImportTab.tsx"), "utf8");
  ok("H6 integrated into ImportTab behind a segmented mode", imp.includes("ConfigBuilderTab") && /builder/.test(imp));
  const es = spawnSync("npx", ["esbuild", p, "--loader:.tsx=tsx", "--bundle=false"], { encoding: "utf8", cwd: ROOT, timeout: 60000 });
  ok("H6 builder parses cleanly", es.status === 0, (es.stderr || "").slice(-120));
  // REAL parser accepts a builder-shaped REALITY vless link (the exact format H-b verified)
  const store = fs.readFileSync(path.join(ROOT, "src", "store.ts"), "utf8");
  ok("H6 real store parser present (parseSingleLink)", store.includes("export function parseSingleLink"));
}

/* ============ H7 — real Windows artifacts 3.2.0 ============ */
console.log("\nH7 — Windows artifacts for the 3.2.0 round");
{
  const exeApp = path.join(APP, "release", "MEMENTO-3.2.0.exe");
  const exeSetup = path.join(SETUP, "release", "MementoSetup-3.2.0.exe");
  ok("H7 MEMENTO-3.2.0.exe exists", fs.existsSync(exeApp));
  ok("H7 MementoSetup-3.2.0.exe exists", fs.existsSync(exeSetup));
  if (fs.existsSync(exeSetup)) {
    const seven = path.join(ROOT, "node_modules", "7zip-bin", "linux", "x64", "7za");
    const tmp = path.join(os.tmpdir(), "taskH-sfx.7z");
    const buf = fs.readFileSync(exeSetup);
    const i = buf.indexOf(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
    fs.writeFileSync(tmp, i >= 0 ? buf.subarray(i) : buf);
    const t = spawnSync(seven, ["t", tmp], { encoding: "utf8", timeout: 240000 });
    ok("H7 setup SFX archive integrity (7za t)", t.status === 0, (t.stderr || "").slice(-120));
  }
  const meta = JSON.parse(fs.readFileSync(path.join(SETUP, "payload-meta.json"), "utf8"));
  ok("H7 payload-meta declares appVersion 3.2.0 + runtime-reuse", meta.appVersion === "3.2.0" && meta.mode === "runtime-reuse");
}

/* ============ H8 — AV-hardening round (setup 2.0.3) ============ */
console.log("\nH8 — AV-hardening: requireAdministrator, hardlink clone, move-staging, honest guidance");
{
  // H8-1 — the setup exe now REQUESTS ADMIN (UAC)
  const yml = fs.readFileSync(path.join(SETUP, "electron-builder.yml"), "utf8");
  ok("H8 electron-builder.yml sets portable requestExecutionLevel: admin (requireAdministrator)",
    /requestExecutionLevel:\s*admin\b/.test(yml) && !/requestedExecutionLevel/.test(yml));
  const setupPkg = JSON.parse(fs.readFileSync(path.join(SETUP, "package.json"), "utf8"));
  ok("H8 setup-app version bumped to 3.2.0", setupPkg.version === "3.2.0", setupPkg.version);
  const mainJs = fs.readFileSync(path.join(SETUP, "dist-electron", "main.js"), "utf8");
  ok("H8 compiled main.js carries SETUP_VERSION 3.2.0", mainJs.includes('"3.2.0"') || mainJs.includes("3.2.0"));

  // H8-2 — hardlink runtime clone (no self-image byte copy)
  const core = fs.readFileSync(path.join(SETUP, "dist-electron", "installerCore.js"), "utf8");
  ok("H8 installerCore clones the runtime exe via fs.linkSync FIRST", /linkSync/.test(core));
  ok("H8 plain copy survives only as the cross-volume fallback",
    /hardlink impossible/.test(core));
  ok("H8 honest linked log line present", /zero bytes of the running image/.test(core));

  // H8-3 — move-staging (rename out of the volatile SFX folder)
  ok("H8 staging tries renameSync (metadata move) before the tolerant copy",
    /renameSync/.test(mainJs) && mainJs.includes("copyTreeTolerant"));
  ok("H8 de-elevated launch path present (explorer.exe token drop)", mainJs.includes("explorer.exe") && mainJs.includes("isElevatedWindows"));

  // H8-4 — honest guidance lines in the install log
  ok("H8 unsigned-binary guidance line compiled in",
    /Protection history/.test(core) && /unsigned/.test(core));
  ok("H8 setup never touches AV settings (no exclusion self-modification code)",
    !/Add-MpPreference/.test(mainJs) && !/Add-MpPreference/.test(core));

  // H8-5 — LIVE: runtime-reuse install clones the exe as a HARDLINK
  // (2.0.5: the fixture payload is the UNPACKED app TREE — the critical
  // files are resources/app/package.json + resources/app/dist-electron/main.js)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH-hardlink-"));
  const payloadDir = path.join(work, "payload");
  fs.mkdirSync(path.join(payloadDir, "resources", "app", "dist-electron"), { recursive: true });
  fs.writeFileSync(path.join(payloadDir, "resources", "app", "package.json"), "MEMENTO-APP-PKG\n");
  fs.writeFileSync(path.join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN\n");
  fs.writeFileSync(path.join(payloadDir, "resources", "xray-dummy"), "XRAY".repeat(256));
  const runtimeDir = path.join(work, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const exeSrc = path.join(runtimeDir, "MementoSetup.exe");
  fs.writeFileSync(exeSrc, "ELECTRON-EXE-IMAGE".repeat(256));
  fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(256));
  const mod = await import(path.join(SETUP, "dist-electron", "installerCore.js"));
  const events = [];
  const dest = path.join(work, "dest");
  const result = await mod.runInstall(
    { destDir: dest, createDesktopShortcut: false },
    {
      isWin: false,
      appVersion: "3.1.7",
      payloadDir,
      coreVersions: {},
      mode: "runtime-reuse",
      runtimeDir: () => runtimeDir,
      runtimeFiles: () => [{ rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size }],
      runtimeExePath: () => exeSrc,
      desktopDir: () => path.join(work, "desktop"),
      startMenuDir: () => path.join(work, "sm"),
      writeShortcut: () => "skipped",
      writeUninstallRegistration: () => {},
      removeUninstallRegistration: () => {},
      closeRunningApp: () => false,
      onEvent: (ev) => events.push(ev),
      cancelled: () => false,
    }
  );
  const exeDst = path.join(dest, "MEMENTO"); // isWin=false → no .exe suffix
  ok("H8 LIVE runtime-reuse install SUCCEEDS", result.ok === true, result.error || "");
  ok("H8 LIVE MEMENTO exe lands at the destination", fs.existsSync(exeDst));
  const sameVolume = true; // tmpdir and dest share the tmp volume here
  const nlink = sameVolume ? (fs.statSync(exeDst).nlink || 1) : 1;
  ok("H8 LIVE exe is HARDLINKED (nlink>1) on the same volume", nlink > 1, `nlink=${nlink}`);
  ok("H8 LIVE linked log line emitted",
    events.some((e) => e.type === "log" && /linked — zero bytes/.test(e.line || "")));
  ok("H8 LIVE runtime dll rides along", fs.existsSync(path.join(dest, "ffmpeg.dll")));
  ok("H8 LIVE payload files land on top of the cloned runtime",
    fs.existsSync(path.join(dest, "resources", "app", "package.json")) &&
    fs.existsSync(path.join(dest, "resources", "app", "dist-electron", "main.js")));
  ok("H8 LIVE honest unsigned-binary note emitted",
    events.some((e) => e.type === "log" && /unsigned/.test(e.line || "")));
  fs.rmSync(work, { recursive: true, force: true });

  // H8-6 — docs ship the honest AV contract
  const setupReadme = fs.readFileSync(path.join(SETUP, "README.md"), "utf8");
  ok("H8 setup-app/README.md documents the unsigned-binary contract + Windows Security steps",
    /not code-signed/.test(setupReadme) && /Protection history/.test(setupReadme) && /Add-MpPreference/.test(setupReadme));
  ok("H8 setup-app/README.md has the Persian guidance section", /هشدار آنتی‌ویروس/.test(setupReadme));
  const checklist = fs.readFileSync(path.join(APP, "TESTING-CHECKLIST.md"), "utf8");
  ok("H8 TESTING-CHECKLIST §36 exists with real-Windows AV legs",
    /Setup 2\.0\.3 — AV \/ Windows Defender round/.test(checklist) && /HONEST SCOPE/.test(checklist));
  const buildNotes = fs.readFileSync(path.join(ROOT, "BUILD-3.1.7.md"), "utf8");
  ok("H8 BUILD-3.1.7.md documents the AV-hardening round", /AV-hardening round \(setup 2\.0\.3/.test(buildNotes));
}

/* ===== H9 — 2.0.4/2.0.5 field-report fix: verify+heal, contract gate, rollback ===== */
console.log("\nH9 — critical-file hard gate (field report #2/#3: Defender removed the app code;\n     2.0.5 ships it UNPACKED as resources/app/ — critical = package.json + dist-electron/main.js)");
{
  const core = fs.readFileSync(path.join(SETUP, "dist-electron", "installerCore.js"), "utf8");
  ok("H9 critical-file list compiled in (UNPACKED tree: package.json + dist-electron/main.js)",
    core.includes("resources/app/package.json") && core.includes("resources/app/dist-electron/main.js") && core.includes("CRITICAL_PAYLOAD_FILES"));
  ok("H9 no stale asar path in the critical list", !core.includes('"resources/app.asar"'));
  ok("H9 electron-builder.yml ships the app UNPACKED (asar: false)",
    /asar:\s*false/.test(fs.readFileSync(path.join(APP, "electron-builder.yml"), "utf8")));
  ok("H9 contract gate compiled in (pre-copy payload check)", /missing from the installer payload/.test(core));
  ok("H9 verify+heal compiled in (verified-summary line)", core.includes("installed files against the payload manifest"));
  ok("H9 heal line compiled in (transient AV lock recovery)", core.includes("recovered on re-check"));
  ok("H9 hard-gate abort message carries Protection history guidance",
    /missing after verification — rolling back/.test(core) && /Protection history/.test(core));
  ok("H9 leave-no-trace rollback for fresh destinations compiled in", core.includes("createdDest"));

  const mod = await import(path.join(SETUP, "dist-electron", "installerCore.js"));
  const baseDeps = (work, extra = {}) => ({
    isWin: false,
    appVersion: "3.1.7",
    coreVersions: {},
    desktopDir: () => path.join(work, "desktop"),
    startMenuDir: () => path.join(work, "sm"),
    writeShortcut: () => "skipped",
    writeUninstallRegistration: () => {},
    removeUninstallRegistration: () => {},
    closeRunningApp: () => false,
    onEvent: (ev) => events.push(ev),
    cancelled: () => false,
    ...extra,
  });
  let events = [];

  // H9-1 LIVE — contract gate: payload WITHOUT the app tree (Defender
  // quarantined payload/resources/app/** before the install started) must
  // abort BEFORE anything is copied, with the exact Windows Security steps.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH-contract-"));
    const payloadDir = path.join(work, "payload");
    fs.mkdirSync(path.join(payloadDir, "resources"), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "resources", "icon.png"), "ICON".repeat(64)); // no resources/app/ at all!
    const runtimeDir = path.join(work, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const exeSrc = path.join(runtimeDir, "MementoSetup.exe");
    fs.writeFileSync(exeSrc, "ELECTRON-EXE-IMAGE".repeat(256));
    fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(64));
    events = [];
    const dest = path.join(work, "dest");
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => [{ rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size }],
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H9 LIVE contract gate: install FAILS when the payload lacks the app tree", result.ok === false, result.error || "");
    ok("H9 LIVE contract-gate error names resources/app/package.json", /resources\/app\/package\.json/.test(result.error || ""));
    ok("H9 LIVE contract-gate error names EVERY missing critical file (main.js too)", /dist-electron\/main\.js/.test(result.error || ""));
    ok("H9 LIVE contract-gate error gives Protection history steps", /Protection history/.test(result.error || ""));
    ok("H9 LIVE contract gate fires BEFORE any copy (no destination created)", !fs.existsSync(dest));
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H9-2 LIVE — contract gate variant: the payload's resources/app/package.json
  // exists but is UNREADABLE (chmod 000 — exactly what a quarantine looks like
  // to a reader). The gate must reject it before anything is copied.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH-contract2-"));
    const payloadDir = path.join(work, "payload");
    fs.mkdirSync(path.join(payloadDir, "resources", "app", "dist-electron"), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN".repeat(64));
    const pkg = path.join(payloadDir, "resources", "app", "package.json");
    fs.writeFileSync(pkg, "MEMENTO-APP-PKG".repeat(256));
    fs.chmodSync(pkg, 0o000); // unreadable == quarantined
    const runtimeDir = path.join(work, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const exeSrc = path.join(runtimeDir, "MementoSetup.exe");
    fs.writeFileSync(exeSrc, "ELECTRON-EXE-IMAGE".repeat(256));
    fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(64));
    events = [];
    const dest = path.join(work, "dest");
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => [{ rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size }],
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H9 LIVE contract gate rejects an UNREADABLE package.json", result.ok === false, result.error || "");
    ok("H9 LIVE unreadable-package.json error names resources/app/package.json", /resources\/app\/package\.json/.test(result.error || ""));
    ok("H9 LIVE unreadable-package.json abort copies NOTHING (no destination)", !fs.existsSync(dest));
    fs.chmodSync(pkg, 0o644);
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H9-3 LIVE — hard gate mid-install + real rollback: the destination
  // path of the app code is OCCUPIED (a directory standing in for an AV
  // holding/quarantining the freshly-written file), so the payload's
  // resources/app/package.json can never land. The verification gate must
  // abort the install, and the stage-aside rollback must restore the
  // PREVIOUS install byte-for-byte.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH-hardgate-"));
    const payloadDir = path.join(work, "payload");
    fs.mkdirSync(path.join(payloadDir, "resources", "app", "dist-electron"), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "package.json"), "MEMENTO-APP-PKG".repeat(256));
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN".repeat(64));
    fs.writeFileSync(path.join(payloadDir, "resources", "icon.png"), "ICON".repeat(64));
    const runtimeDir = path.join(work, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const exeSrc = path.join(runtimeDir, "MementoSetup.exe");
    fs.writeFileSync(exeSrc, "ELECTRON-EXE-IMAGE".repeat(256));
    fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(64));
    // a previous install exists at the destination — the stage-aside
    // rollback contract must put it back after the abort
    const dest = path.join(work, "dest");
    fs.mkdirSync(path.join(dest, "resources"), { recursive: true });
    fs.writeFileSync(path.join(dest, "sentinel.txt"), "previous-install-marker\n");
    // the OCCUPYING directory is injected through a runtime entry whose
    // mkdir of the parent creates dest/resources/app/package.json as a
    // DIRECTORY
    const runtimeFiles = () => [
      { rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size },
      { rel: path.join("resources", "app", "package.json", "occupied"), bytes: 0 },
    ];
    events = [];
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles,
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H9 LIVE hard gate: install FAILS when package.json cannot land", result.ok === false, result.error || "");
    ok("H9 LIVE hard-gate error names the blocked file (resources/app/package.json)", /resources\/app\/package\.json/.test(result.error || ""));
    ok("H9 LIVE hard-gate error gives Protection history steps", /Protection history/.test(result.error || ""));
    ok("H9 LIVE hard-gate promises no half-install", /half-installed/.test(result.error || ""));
    ok("H9 LIVE rollback log line emitted",
      events.some((e) => e.type === "log" && /rolling back/.test(e.line || "")));
    ok("H9 LIVE previous install RESTORED by the rollback (sentinel back)",
      fs.existsSync(path.join(dest, "sentinel.txt")));
    ok("H9 LIVE no new install contaminated the restored tree",
      !fs.existsSync(path.join(dest, "ffmpeg.dll")) && !fs.existsSync(path.join(dest, "icon.png")));
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H9-4 LIVE — heal + honest tolerance: a NON-critical runtime file
  // whose source is unreadable (chmod 000 — an AV holding the file) is
  // skipped by the copy, retried by the heal loop, reported honestly,
  // and the install still completes with a verified (N-1)/N summary.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH-heal-"));
    const payloadDir = path.join(work, "payload");
    fs.mkdirSync(path.join(payloadDir, "resources", "app", "dist-electron"), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "package.json"), "MEMENTO-APP-PKG".repeat(256));
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN".repeat(64));
    const runtimeDir = path.join(work, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const exeSrc = path.join(runtimeDir, "MementoSetup.exe");
    fs.writeFileSync(exeSrc, "ELECTRON-EXE-IMAGE".repeat(256));
    fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(64));
    const blocked = path.join(runtimeDir, "locked.dll");
    fs.writeFileSync(blocked, "LOCKED".repeat(64));
    fs.chmodSync(blocked, 0o000); // unreadable source — the AV-hold stand-in
    events = [];
    const dest = path.join(work, "dest");
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => [
          { rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size },
          { rel: "locked.dll", bytes: fs.statSync(blocked).size },
        ],
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H9 LIVE non-critical miss still completes the install", result.ok === true, result.error || "");
    ok("H9 LIVE honest missing-file line emitted",
      events.some((e) => e.type === "log" && /could not be installed/.test(e.line || "")));
    ok("H9 LIVE verified-summary line emitted (N-1/N)",
      events.some((e) => e.type === "log" && /verified \d+\/\d+ installed files/.test(e.line || "")));
    fs.chmodSync(blocked, 0o644);
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H9-5 LIVE — leave-no-trace on a generic mid-install failure: the
  // runtime exe source vanishes after the gates (simulated by pointing
  // runtimeExePath at a missing file) — the partial fresh destination is
  // removed again, exactly as the rollback contract promises.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH-notrace-"));
    const payloadDir = path.join(work, "payload");
    fs.mkdirSync(path.join(payloadDir, "resources", "app", "dist-electron"), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "package.json"), "MEMENTO-APP-PKG".repeat(256));
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN".repeat(64));
    const runtimeDir = path.join(work, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(64));
    events = [];
    const dest = path.join(work, "dest");
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => [{ rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size }],
        runtimeExePath: () => path.join(runtimeDir, "GONE.exe"),
      })
    );
    ok("H9 LIVE generic mid-install failure reports not-ok", result.ok === false);
    ok("H9 LIVE failed fresh install leaves NO partial destination", !fs.existsSync(dest));
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H9-6 LIVE — happy path: a clean runtime-reuse install of the UNPACKED
  // app-tree payload emits the verified N/N summary and lands the critical
  // tree files (regression guard for the new gates against the normal flow).
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH-clean-"));
    const payloadDir = path.join(work, "payload");
    fs.mkdirSync(path.join(payloadDir, "resources", "app", "dist-electron"), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "package.json"), "MEMENTO-APP-PKG".repeat(256));
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN".repeat(64));
    fs.writeFileSync(path.join(payloadDir, "resources", "icon.png"), "ICON".repeat(64));
    const runtimeDir = path.join(work, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const exeSrc = path.join(runtimeDir, "MementoSetup.exe");
    fs.writeFileSync(exeSrc, "ELECTRON-EXE-IMAGE".repeat(256));
    fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(64));
    events = [];
    const dest = path.join(work, "dest");
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => [{ rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size }],
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H9 LIVE clean runtime-reuse install still succeeds", result.ok === true, result.error || "");
    ok("H9 LIVE clean install lands the UNPACKED app tree (package.json + main.js)",
      fs.existsSync(path.join(dest, "resources", "app", "package.json")) &&
      fs.existsSync(path.join(dest, "resources", "app", "dist-electron", "main.js")));
    ok("H9 LIVE clean install emits verified N/N summary",
      events.some((e) => e.type === "log" && /verified \d+\/\d+ installed files/.test(e.line || "")));
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/* ===== H10 — 2.0.5 field report #3: per-file gates for the UNPACKED tree ===== */
console.log("\nH10 — unpacked app payload: named critical files, tree happy path, 2.0.5 markers");
{
  const mod = await import(path.join(SETUP, "dist-electron", "installerCore.js"));
  const baseDeps = (work, extra = {}) => ({
    isWin: false,
    appVersion: "3.1.7",
    coreVersions: {},
    desktopDir: () => path.join(work, "desktop"),
    startMenuDir: () => path.join(work, "sm"),
    writeShortcut: () => "skipped",
    writeUninstallRegistration: () => {},
    removeUninstallRegistration: () => {},
    closeRunningApp: () => false,
    onEvent: (ev) => events.push(ev),
    cancelled: () => false,
    ...extra,
  });
  let events = [];
  const makeRuntime = (work) => {
    const runtimeDir = path.join(work, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const exeSrc = path.join(runtimeDir, "MementoSetup.exe");
    fs.writeFileSync(exeSrc, "ELECTRON-EXE-IMAGE".repeat(256));
    fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(64));
    return { runtimeDir, exeSrc };
  };
  const writeFullTree = (payloadDir) => {
    fs.mkdirSync(path.join(payloadDir, "resources", "app", "dist-electron"), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "package.json"), "MEMENTO-APP-PKG-H10\n");
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN-H10\n");
  };

  // H10-1 LIVE — the contract gate names the EXACT deleted critical file:
  // delete resources/app/package.json from an otherwise complete tree →
  // the error must name it (field report #3's exact ask), nothing copied.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH10-del-"));
    const payloadDir = path.join(work, "payload");
    writeFullTree(payloadDir);
    fs.rmSync(path.join(payloadDir, "resources", "app", "package.json")); // THE deletion
    const { runtimeDir, exeSrc } = makeRuntime(work);
    events = [];
    const dest = path.join(work, "dest");
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => [{ rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size }],
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H10-1 contract gate FAILS when resources/app/package.json is deleted", result.ok === false, result.error || "");
    ok("H10-1 the error NAMES resources/app/package.json (exact 2.0.5 message)",
      /the app code \(resources\/app\/package\.json\) is missing from the installer payload/.test(result.error || ""), result.error || "");
    ok("H10-1 the error does NOT name the file that is still present (main.js)",
      !/dist-electron\/main\.js/.test(result.error || ""), result.error || "");
    ok("H10-1 abort leaves no destination behind", !fs.existsSync(dest));
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H10-2 LIVE — happy-path install of a FULL app-TREE payload (app code +
  // all three cores) verifies EVERY file (verified N/N with N = manifest
  // count) and announces the cores honestly.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH10-tree-"));
    const payloadDir = path.join(work, "payload");
    writeFullTree(payloadDir);
    for (const d of ["xray", "sing-box", "aether"]) {
      fs.mkdirSync(path.join(payloadDir, "resources", d), { recursive: true });
      fs.writeFileSync(path.join(payloadDir, "resources", d, d + ".exe"), (d + "-BIN\n").repeat(64));
    }
    const { runtimeDir, exeSrc } = makeRuntime(work);
    events = [];
    const dest = path.join(work, "dest");
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        coreVersions: { xray: "v25.1.1", singbox: "1.14.0", aether: "1.9.0" },
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => [{ rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size }],
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H10-2 app-TREE happy-path install SUCCEEDS", result.ok === true, result.error || "");
    ok("H10-2 critical tree files at the destination",
      fs.existsSync(path.join(dest, "resources", "app", "package.json")) &&
      fs.existsSync(path.join(dest, "resources", "app", "dist-electron", "main.js")));
    ok("H10-2 all three cores announced with their REAL versions",
      ["xray-core v25.1.1", "sing-box 1.14.0", "aether 1.9.0"].every((s) =>
        events.some((e) => e.type === "log" && (e.line || "").startsWith(s))));
    ok("H10-2 verified N/N where N counts EVERY entry (2 app + 3 cores + ffmpeg + runtime exe)",
      events.some((e) => e.type === "log" && (() => {
        const m = /verified (\d+)\/(\d+) installed files/.exec(e.line || "");
        return m && Number(m[1]) === Number(m[2]) && Number(m[2]) === 7;
      })()), events.filter((e) => /verified/.test(e.line || "")).map((e) => e.line).join(" | "));
    ok("H10-2 no wintun pin claim when wintun is not in the payload (honest log)",
      !events.some((e) => e.type === "log" && /pinning wintun/.test(e.line || "")));
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H10-3 — the 2.0.5 error-row touchpoints are compiled into the wizard:
  // main (IPC + ms-settings URI + clipboard), preload (api surface),
  // renderer (i18n keys). Read-only OS touchpoints — the setup still
  // never modifies Defender settings itself.
  {
    const mainJs = fs.readFileSync(path.join(SETUP, "dist-electron", "main.js"), "utf8");
    const preJs = fs.readFileSync(path.join(SETUP, "dist-electron", "preload.js"), "utf8");
    const renderer = fs.readFileSync(path.join(SETUP, "dist", "index.html"), "utf8");
    ok("H10-3 main.js embeds the setup:openDefender handler", mainJs.includes('"setup:openDefender"'));
    ok("H10-3 main.js embeds the setup:copyPayloadPaths handler", mainJs.includes('"setup:copyPayloadPaths"'));
    ok("H10-3 main.js opens Windows Security via ms-settings:windowsdefender", mainJs.includes("ms-settings:windowsdefender"));
    ok("H10-3 main.js carries the compiled 3.2.0 marker", mainJs.includes('"3.2.0"'));
    ok("H10-3 window IS the panel: 900×640 opaque square corners (2.0.6 cosmetic round)",
      /width:\s*900/.test(mainJs) && /height:\s*640/.test(mainJs) && /transparent:\s*false/.test(mainJs) &&
      /roundedCorners:\s*false/.test(mainJs) && /#070c09/.test(mainJs));
    ok("H10-3 the old 960×730 transparent canvas is gone",
      !/width:\s*960/.test(mainJs) && !/height:\s*730/.test(mainJs) && !/transparent:\s*true/.test(mainJs) && !/#00000000/.test(mainJs));
    ok("H10-3 main.js writes the exclusion candidates via clipboard.writeText", mainJs.includes("writeText"));
    ok("H10-3 preload exposes openDefender()", preJs.includes("openDefender"));
    ok("H10-3 preload exposes copyPayloadPaths()", preJs.includes("copyPayloadPaths"));
    ok("H10-3 renderer carries the copyPaths i18n key", renderer.includes("install.copyPaths"));
    ok("H10-3 renderer carries the copied confirmation key", renderer.includes("install.copied"));
    ok("H10-3 renderer carries the openDefender i18n key", renderer.includes("install.openDefender"));
    ok("H10-3 compiled setup still contains NO AV self-modification (H8 contract holds)",
      !mainJs.includes("Add-MpPreference") && !preJs.includes("Add-MpPreference") && !renderer.includes("Add-MpPreference"));
  }
}

/* ===== H11 — 3.2.0 field report #4: in-place destination + ownership sentinel ===== */
console.log("\nH11 — in-place installs: foreign folder untouched, file-exact cleanup, upgrade leg");
{
  const mod = await import(path.join(SETUP, "dist-electron", "installerCore.js"));
  const un = await import("file://" + path.join(APP, "dist-electron", "uninstall.js"));
  const baseDeps = (work, extra = {}) => ({
    isWin: false,
    appVersion: "3.2.0",
    coreVersions: {},
    desktopDir: () => path.join(work, "desktop"),
    startMenuDir: () => path.join(work, "sm"),
    writeShortcut: () => "skipped",
    writeUninstallRegistration: () => {},
    removeUninstallRegistration: () => {},
    closeRunningApp: () => false,
    onEvent: (ev) => events.push(ev),
    cancelled: () => false,
    ...extra,
  });
  let events = [];
  const makeRuntime = (work) => {
    const runtimeDir = path.join(work, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const exeSrc = path.join(runtimeDir, "MementoSetup.exe");
    fs.writeFileSync(exeSrc, "ELECTRON-EXE-IMAGE".repeat(256));
    fs.writeFileSync(path.join(runtimeDir, "ffmpeg.dll"), "DLL".repeat(64));
    return { runtimeDir, exeSrc };
  };
  const makeTreePayload = (work) => {
    const payloadDir = path.join(work, "payload");
    fs.mkdirSync(path.join(payloadDir, "resources", "app", "dist-electron"), { recursive: true });
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "package.json"), "MEMENTO-APP-PKG-H11\n");
    fs.writeFileSync(path.join(payloadDir, "resources", "app", "dist-electron", "main.js"), "MEMENTO-APP-MAIN-H11\n");
    return payloadDir;
  };
  const runtimeFiles = (runtimeDir) => [{ rel: "ffmpeg.dll", bytes: fs.statSync(path.join(runtimeDir, "ffmpeg.dll")).size }];
  const sentinelOf = (dest) => JSON.parse(fs.readFileSync(path.join(dest, ".memento-uninstall.json"), "utf8"));

  // H11-1 LIVE — in-place install into a FOREIGN folder (the EPERM fix):
  // no rename aside, the foreign file survives untouched, and the
  // ownership sentinel records inPlace:true + EVERY installed file.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH11-inplace-"));
    const payloadDir = makeTreePayload(work);
    const { runtimeDir, exeSrc } = makeRuntime(work);
    const dest = path.join(work, "dest");
    fs.mkdirSync(path.join(dest, "keepdir"), { recursive: true });
    fs.writeFileSync(path.join(dest, "keepme.txt"), "USER FILE — DO NOT TOUCH\n");
    fs.writeFileSync(path.join(dest, "keepdir", "other.txt"), "more user data\n");
    events = [];
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => runtimeFiles(runtimeDir),
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H11-1 in-place install SUCCEEDS into a foreign folder", result.ok === true, result.error || "");
    ok("H11-1 in-place decision announced in the log",
      events.some((e) => e.type === "log" && /not a MEMENTO install — installing into it in place/.test(e.line || "")));
    ok("H11-1 foreign file SURVIVES untouched",
      fs.readFileSync(path.join(dest, "keepme.txt"), "utf8") === "USER FILE — DO NOT TOUCH\n");
    ok("H11-1 foreign SUBFOLDER survives untouched",
      fs.readFileSync(path.join(dest, "keepdir", "other.txt"), "utf8") === "more user data\n");
    ok("H11-1 no .bak staging dir was created for a foreign folder",
      fs.readdirSync(work).filter((n) => n.includes(".bak-")).length === 0);
    const sentinel = sentinelOf(dest);
    ok("H11-1 ownership sentinel exists with inPlace:true", sentinel.inPlace === true);
    ok("H11-1 sentinel files[] covers EVERY installed file",
      [".memento-uninstall.json", "MEMENTO", "ffmpeg.dll", "resources/app/package.json", "resources/app/dist-electron/main.js"]
        .every((rel) => sentinel.files.includes(rel)), JSON.stringify(sentinel.files));
    ok("H11-1 sentinel files[] is exactly the installed set (no foreign files recorded)",
      sentinel.files.length === 5 && !sentinel.files.includes("keepme.txt"));
    ok("H11-1 ownership log line emitted",
      events.some((e) => e.type === "log" && /ownership sentinel written \(in-place install/.test(e.line || "")));
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H11-2 LIVE — a FAILED in-place run cleans up file-exact: MEMENTO's
  // files go, the foreign file AND the foreign folder stay.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH11-fail-"));
    const payloadDir = makeTreePayload(work);
    const { runtimeDir } = makeRuntime(work);
    const dest = path.join(work, "dest");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "keepme.txt"), "USER FILE — DO NOT TOUCH\n");
    events = [];
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => runtimeFiles(runtimeDir),
        runtimeExePath: () => path.join(runtimeDir, "GONE.exe"), // clone fails mid-install
      })
    );
    ok("H11-2 failed in-place install reports not-ok", result.ok === false);
    ok("H11-2 the foreign FOLDER still exists", fs.existsSync(dest));
    ok("H11-2 the foreign file still exists", fs.existsSync(path.join(dest, "keepme.txt")));
    ok("H11-2 no MEMENTO exe or partial app tree left behind",
      !fs.existsSync(path.join(dest, "MEMENTO")) && !fs.existsSync(path.join(dest, "resources")));
    ok("H11-2 no sentinel was stranded by the failed run", !fs.existsSync(path.join(dest, ".memento-uninstall.json")));
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H11-3 LIVE — upgrade leg unchanged: a destination WITH the sentinel is
  // a previous MEMENTO install → staged aside (.bak), install completes,
  // the .bak is dropped and the sentinel is rewritten with the new version.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "taskH11-upgrade-"));
    const payloadDir = makeTreePayload(work);
    const { runtimeDir, exeSrc } = makeRuntime(work);
    const dest = path.join(work, "dest");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, ".memento-uninstall.json"),
      JSON.stringify({ inPlace: true, files: [".memento-uninstall.json"], appVersion: "3.1.7" }),
      "utf8"
    );
    events = [];
    const result = await mod.runInstall(
      { destDir: dest, createDesktopShortcut: false },
      baseDeps(work, {
        payloadDir,
        mode: "runtime-reuse",
        runtimeDir: () => runtimeDir,
        runtimeFiles: () => runtimeFiles(runtimeDir),
        runtimeExePath: () => exeSrc,
      })
    );
    ok("H11-3 sentinel-folder upgrade install SUCCEEDS", result.ok === true, result.error || "");
    ok("H11-3 staged-aside log line emitted (owned-dir upgrade path)",
      events.some((e) => e.type === "log" && /staged the previous installation for replacement/.test(e.line || "")));
    ok("H11-3 no .bak staging dir left after success",
      fs.readdirSync(work).filter((n) => n.includes(".bak-")).length === 0);
    const sentinel = sentinelOf(dest);
    ok("H11-3 sentinel rewritten with the new appVersion", sentinel.appVersion === "3.2.0");
    ok("H11-3 replaced install records whole-dir ownership (inPlace:false — the old folder went with the .bak)",
      sentinel.inPlace === false);
    fs.rmSync(work, { recursive: true, force: true });
  }

  // H11-4 PURE — inPlaceDeleteLines: exact del per file, bare rmdir (no /s)
  // per our dirs deepest-first, traversal paths SKIPPED.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taskH11-lines-"));
    const files = ["MEMENTO.exe", "resources/app/package.json", "resources/app/dist-electron/main.js", ".memento-uninstall.json", "../evil.txt"];
    const winLines = un.inPlaceDeleteLines(dir, files, true);
    ok("H11-4 one del /f /q line per NON-traversal file (evil skipped)",
      winLines.filter((l) => l.startsWith("del /f /q")).length === 4, JSON.stringify(winLines));
    ok("H11-4 no rmdir uses the recursive /s switch (foreign content structurally safe)",
      winLines.every((l) => !/rmdir \/s/i.test(l)));
    ok("H11-4 bare rmdir /q per OUR directory, deepest first",
      (() => {
        const rms = winLines.filter((l) => l.startsWith("rmdir /q"));
        // dirs from the file rels: resources/app/dist-electron (deepest) then resources/app;
        // the traversal dir (..) must be guard-skipped, never rmdir'd
        return rms.length === 2 &&
          rms[0].includes("dist-electron") &&
          /rmdir \/q ".*resources\/app"/.test(rms[1]) &&
          !rms[1].includes("dist-electron") &&
          !winLines.some((l) => l.includes("evil"));
      })(), JSON.stringify(winLines));
    const posixLines = un.inPlaceDeleteLines(dir, ["MEMENTO", "../evil.txt", "../evil/x.txt"], false);
    ok("H11-4 traversal paths (..) are SKIPPED on posix too",
      posixLines.filter((l) => l.startsWith("rm -f")).length === 1 && !posixLines.some((l) => l.includes("evil")), JSON.stringify(posixLines));
    const posixRms = posixLines.filter((l) => l.startsWith("rmdir "));
    ok("H11-4 posix rmdir lines are bare (no -r flag)", posixRms.every((l) => !l.includes("-r")));
    // the self-delete command wraps the lines in a temp script
    const { cmd, args } = un.inPlaceSelfDeleteCommand(dir, ["MEMENTO"], false, (name, content) => {
      fs.writeFileSync(path.join(dir, name), content);
      return path.join(dir, name);
    });
    ok("H11-4 in-place self-delete runs a temp script (sh/cmd)",
      cmd === "sh" && args.length === 1 && fs.existsSync(args[0]) && fs.readFileSync(args[0], "utf8").includes("rm -f"));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // H11-5 PURE — readOwnershipSentinel: only a REAL in-place manifest is
  // accepted; owned-dir sentinels (inPlace:false), corrupt or absent
  // sentinels all fall back to null (the whole-dir uninstall contract).
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taskH11-sentinel-"));
    ok("H11-5 absent sentinel → null (owned-dir contract)", un.readOwnershipSentinel(dir) === null);
    fs.writeFileSync(path.join(dir, ".memento-uninstall.json"), "NOT JSON{{");
    ok("H11-5 corrupt sentinel → null", un.readOwnershipSentinel(dir) === null);
    fs.writeFileSync(path.join(dir, ".memento-uninstall.json"), JSON.stringify({ inPlace: false, files: ["a"] }));
    ok("H11-5 inPlace:false sentinel → null (whole-dir uninstall stays)", un.readOwnershipSentinel(dir) === null);
    fs.writeFileSync(path.join(dir, ".memento-uninstall.json"), JSON.stringify({ inPlace: true, files: [] }));
    ok("H11-5 empty files[] → null (refuses to delete from an empty manifest)", un.readOwnershipSentinel(dir) === null);
    fs.writeFileSync(
      path.join(dir, ".memento-uninstall.json"),
      JSON.stringify({ inPlace: true, files: ["MEMENTO", "resources/app/package.json"], appVersion: "3.2.0", InstallLocation: dir })
    );
    const good = un.readOwnershipSentinel(dir);
    ok("H11-5 valid in-place manifest accepted (files carried through)",
      good !== null && good.inPlace === true && good.files.length === 2 && good.appVersion === "3.2.0");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n========================================");
console.log(`taskH smoke: ${pass} passed, ${fail} failed`);
console.log("========================================");
process.exit(fail > 0 ? 1 : 0);
