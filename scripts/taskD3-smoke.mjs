#!/usr/bin/env node
/**
 * Phase D3 FORMAL SMOKE (autostart + global hotkeys + QR in/out + backup),
 * including the D3 review fixes: portable-exe autostart (PORTABLE_EXECUTABLE_FILE
 * -> `path` option) + honest read-back with the same path+args + the
 * "installed build" wording purge from all 4 languages.
 *
 * S0  real-binary version gates (Xray v25.1.1 + sing-box 1.14.0)
 * S1  structural: in-tree taskD3-quickcheck.mjs (40 assertions)
 *     + dist freshness (review-fix i18n wording inside the built singlefile)
 *     + main-process freshness (portable fix inside dist-electron/appPrefs.js)
 * S2  real bundled logic: taskD3-fntest.mjs (17 assertions on esbuild-bundled
 *     appBackup + qrShare with an in-memory localStorage stub)
 * S3  QR round-trip E2E + real-core validation:
 *     makeQrDataUrl(link) -> PNG -> pngjs decode -> jsQR -> byte-equal link
 *     recovery (the exact jsQR call shape decodeQrImageFile uses), payload
 *     split with the 2000 cap, and an `xray run -test` on a config generated
 *     from QR-recovered trojan parameters (REAL pinned binary)
 * S4  backup ALLOWLIST proof (real bundled module): hostile backup JSON with
 *     unknown keys / non-string values / >32MB blob -> parse keeps exactly
 *     the allowlisted keys, apply writes exactly those keys — nothing else
 *     ever lands in storage
 * S5  regression suite gates (task13 / task12 / D1 / D2)
 *
 * Env overrides: XRAY_BIN, SB_BIN, T13_WORK, TD3_WORK
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN_TREE = join(process.env.T13_WORK || HERE, "");
const XRAY = process.env.XRAY_BIN || "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SINGBOX = process.env.SB_BIN || "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const WORK = process.env.TD3_WORK || "/home/z/my-project/scripts/taskD3-smoke-tmp";
const DIST = process.env.T13_DIST || "/home/z/my-project/memento-src/dist/index.html";
const DIST_ELECTRON = "/home/z/my-project/memento-src/electron-app/dist-electron/appPrefs.js";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`); }
};
const run = (cmd, args, opts = {}) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 90000, ...opts }); }
  catch (e) { return (e.stdout || "") + (e.stderr || ""); }
};

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

/* ---------------- S0: binary gates ---------------- */
console.log("\n== S0 binary gates ==");
{
  const xv = run(XRAY, ["version"]) + run(XRAY, ["-version"]);
  ok("S0 xray is pinned v25.1.1", /Xray 25\.1\.1/.test(xv), xv.slice(0, 80).replace(/\n/g, " "));
  const sv = run(SINGBOX, ["version"]);
  ok("S0 sing-box is pinned 1.14.0", /1\.14\.0/.test(sv), sv.slice(0, 80).replace(/\n/g, " "));
}

/* ---------------- S1: structural ---------------- */
console.log("\n== S1 structural (taskD3-quickcheck) ==");
{
  const out = run("node", [join(IN_TREE, "taskD3-quickcheck.mjs")], { cwd: IN_TREE });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S1 taskD3-quickcheck 40 PASS / 0 FAIL", !!m && m[1] === "40" && m[2] === "0", out.slice(-500));

  const dist = fs.readFileSync(DIST, "utf8");
  ok("S1 dist fresh: autostart hint built in", dist.includes("appopt.autostartHint"));
  ok("S1 dist fresh: portable wording in all languages (fa/zh/ar needles)",
    dist.includes("پرتابل") && dist.includes("便携") && dist.includes("المحمول"));
  ok("S1 dist fresh: 'installed build' claim purged", !dist.includes("نصب‌شده") && !dist.includes("المثبتة"));
  ok("S1 dist fresh: QR import + backup marker built in",
    dist.includes("qr.importTitle") && dist.includes("memento-backup"));

  const prefsJs = fs.readFileSync(DIST_ELECTRON, "utf8");
  ok("S1 dist-electron fresh: PORTABLE_EXECUTABLE_FILE compiled in", prefsJs.includes("PORTABLE_EXECUTABLE_FILE"));
  ok("S1 dist-electron fresh: path option + same-args read-back compiled in",
    prefsJs.includes("{ path: p }") && prefsJs.includes("getLoginItemSettings({ path: p, args: AUTOSTART_ARGS })"));
}

/* ---------------- S2: real bundled backup/QR logic ---------------- */
console.log("\n== S2 functional (taskD3-fntest, real esbuild-bundled modules) ==");
{
  const out = run("node", [join(IN_TREE, "taskD3-fntest.mjs")], { cwd: IN_TREE, env: { ...process.env, TD3_WORK: join(WORK, "fntest") } });
  const m = out.match(/RESULT: (\d+) PASS \/ (\d+) FAIL/);
  ok("S2 taskD3-fntest 17 PASS / 0 FAIL", !!m && m[1] === "17" && m[2] === "0", out.slice(-500));
}

/* ---------------- S3: QR round-trip + real xray -test ---------------- */
console.log("\n== S3 QR round-trip (encode -> PNG decode -> jsQR) + real-core tie-in ==");
{
  execFileSync("npx", ["esbuild", join(IN_TREE, "taskD3-fnentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "taskD3-fn.cjs")}`],
    { cwd: IN_TREE, stdio: "pipe" });
  const fn = await import(join(WORK, "taskD3-fn.cjs"));
  const { PNG } = await import("pngjs");
  const jsQR = (await import("jsqr")).default;

  const vmessJson = Buffer.from(JSON.stringify({
    v: "2", ps: "qr-vmess", add: "203.0.113.10", port: "443",
    id: "b831381d-6324-4d53-ad4f-8cda48b30811", aid: "0",
    net: "tcp", type: "none", host: "", path: "", tls: "tls",
  })).toString("base64");
  const ssUserInfo = Buffer.from("aes-256-gcm:ss-pass").toString("base64");
  const links = [
    `vmess://${vmessJson}`,
    "trojan://tr-secret@203.0.113.20:443?security=tls&sni=example.com&type=tcp#qr-trojan",
    `ss://${ssUserInfo}@203.0.113.30:8388#qr-ss`,
  ];

  const decodePng = (dataUrl) => {
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const png = PNG.sync.read(Buffer.from(b64, "base64"));
    return jsQR(new Uint8ClampedArray(png.data.buffer), png.width, png.height, { inversionAttempts: "attemptBoth" });
  };

  for (const link of links) {
    const scheme = link.slice(0, link.indexOf(":"));
    try {
      const dataUrl = await fn.makeQrDataUrl(link);
      const decoded = decodePng(dataUrl);
      ok(`S3 QR round-trip byte-equal (${scheme})`, !!decoded && decoded.data === link,
        decoded ? `got ${decoded.data.slice(0, 60)}` : "jsQR returned null");
    } catch (e) {
      ok(`S3 QR round-trip byte-equal (${scheme})`, false, String(e?.message || e).slice(0, 120));
    }
  }

  const many = Array.from({ length: 2500 }, (_, i) => `${links[1].split("#")[0]}#n${i}`).join("\n");
  const capped = fn.qrPayloadToLinks(many);
  ok("S3 payload split honors the 2000 cap", capped.length === 2000, `got ${capped.length}`);
  const mixed = `  ${links[0]}  \n\nnot-a-link\n\n${links[2]}\n`;
  const clean = fn.qrPayloadToLinks(mixed);
  ok("S3 payload split trims/filters empties (and passes prose through to the store's parser)",
    clean.length === 3 && clean[0] === links[0] && clean[2] === links[2], JSON.stringify(clean).slice(0, 100));

  const { generateV2RayConfig, DEFAULT_BUILDER_OPTIONS } = await import(join(IN_TREE, "taskD2-cfg.cjs"));
  const gen = generateV2RayConfig(
    { id: "qr", name: "qr-trojan", protocol: "trojan", isValid: true, address: "203.0.113.20", port: 443, password: "tr-secret", security: "tls", network: "tcp", sni: "example.com" },
    "socks-only", 18081, 18082, undefined, { ...DEFAULT_BUILDER_OPTIONS });
  ok("S3 generator produced config from QR-recovered trojan parameters", !!gen?.json);
  const cfgFile = join(WORK, "qr-trojan.json");
  fs.writeFileSync(cfgFile, gen.json);
  const test = run(XRAY, ["run", "-test", "-c", cfgFile]);
  ok("S3 REAL xray v25.1.1 accepts the QR-sourced config", test.includes("Configuration OK"), test.slice(0, 140).replace(/\n/g, " "));
}

/* ---------------- S4: backup ALLOWLIST proof ---------------- */
console.log("\n== S4 backup allowlist (hostile keys can never land) ==");
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const fn = await import(join(WORK, "taskD3-fn.cjs"));
  store.set("memento-configs", JSON.stringify([{ id: "a", name: "keep", raw: "vmess://x" }]));
  store.set("memento-conn-socks-port", "10808");

  const big = "A".repeat(33 * 1024 * 1024); // > 32MB per-key cap
  // Built as RAW JSON text so the __proto__ key is really inside the file
  // (a JS object literal would set the prototype instead of emitting the key).
  const hostile = '{"format":"memento-backup","version":1,"exportedAt":"2026-09-17T00:00:00.000Z","counts":{"configs":1,"groups":0},"data":{'
    + `"memento-configs":${JSON.stringify(store.get("memento-configs"))},`
    + '"memento-conn-socks-port":"10808",'
    + '"__proto__":{"isAdmin":true},'
    + '"electron":{"nodeIntegration":true,"contextIsolation":false},'
    + '"devTools":true,'
    + '"memento-evil-payload":"rm -rf",'
    + '"memento-builder-options":{"json":42},'
    + `"memento-auto-failover":"${big}",`
    + '"v2ray-editor-language":"fa"}}';
  const parsed = fn.parseBackup(hostile);
  const keys = Object.keys(parsed.data).sort();
  ok("S4 parse keeps ONLY allowlisted string keys <= 32MB",
    JSON.stringify(keys) === JSON.stringify(["memento-configs", "memento-conn-socks-port", "v2ray-editor-language"]),
    JSON.stringify(keys));
  ok("S4 every parsed key is a member of BACKUP_KEYS",
    keys.every(k => fn.BACKUP_KEYS.includes(k)));
  ok("S4 parse rejects wrong version outright",
    (() => { try { fn.parseBackup('{"format":"memento-backup","version":99,"data":{}}'); return false; } catch { return true; } })());

  const restored = fn.applyBackup(parsed);
  ok("S4 apply restored exactly the allowlisted keys", restored === 3, `restored=${restored}`);
  ok("S4 hostile keys never landed in storage",
    !store.has("memento-evil-payload") && !store.has("electron") && !store.has("devTools") && !store.has("__proto__"));
  ok("S4 oversized key never landed", !store.has("memento-auto-failover"));
  ok("S4 backup round-trip preserves the stored blob byte-for-byte",
    store.get("memento-configs") === JSON.stringify([{ id: "a", name: "keep", raw: "vmess://x" }]));
}

/* ---------------- S5: regression gates ---------------- */
console.log("\n== S5 regression suites ==");
{
  const suites = [
    ["task13-selftest", "RESULT: 25 PASS / 0 FAIL"],
    ["task13-cfgtest", "RESULT: 4 PASS / 0 FAIL"],
    ["taskD1-quickcheck", "RESULT: 28 PASS / 0 FAIL"],
    ["taskD2-quickcheck", "RESULT: 44 PASS / 0 FAIL"],
  ];
  for (const [name, want] of suites) {
    const out = run("node", [join(IN_TREE, `${name}.mjs`)], { cwd: IN_TREE });
    ok(`S5 ${name} (${want})`, out.includes(want), out.slice(-300));
  }
  const out12 = run("node", [join(IN_TREE, "task12-quickcheck.mjs")], { cwd: IN_TREE });
  ok("S5 task12-quickcheck (7 assertions)", /QUICK-CHECK: 7 assertions passed/.test(out12), out12.slice(-300));
  const cfg = run("node", [join(IN_TREE, "taskD2-cfgtest.mjs")], {
    cwd: IN_TREE, env: { ...process.env, XRAY_BIN: XRAY, SB_BIN: SINGBOX, TD2_WORK: join(WORK, "cfgtest") },
  });
  ok("S5 taskD2-cfgtest 36 PASS / 0 FAIL (real binaries)", cfg.includes("RESULT: 36 PASS / 0 FAIL"), cfg.slice(-300));
}

console.log(`\nFORMAL SMOKE D3: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
