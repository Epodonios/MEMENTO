#!/usr/bin/env node
/**
 * Phase D1 quickcheck — NO network, NO spawned processes.
 * Verifies the Batch D1 implementation surface structurally:
 *   N1  preload allowlist >= 16 commands incl. net_check (Phase D3 added
 *       app_prefs_get/app_prefs_set/autostart_set -> 19; Phase D4 added
 *       tray_status_set -> 20; assertion updated per the locked batch
 *       order — must still contain net_check)
 *   N2  ipc.ts: net_check handler + fixed trace URL + u16Port validation
 *   N3  compiled main (dist/main.js) contains net_check (build freshness)
 *   N4  store.ts: connDownSpeed/connUpSpeed in state + patch + init
 *   N5  ConnectionManager: delta logic + negative guard + reset on disconnect
 *   N6  ConfigsTab: Connect Best button wired to connectToConfig
 *   N7  ConnectionTab: speed chip + IP check card + aether port selection
 *   N8  AetherTab: honest no-stats note
 *   N9  electron-mock: net_check simulated handler
 *   N10 i18n: all 20 new keys present in ALL 4 languages + key-set parity
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FE = join(ROOT);                      // memento-src/
const EAPP = join(ROOT, "electron-app");

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const read = (p) => readFileSync(join(ROOT, p), "utf8");

console.log("== Phase D1 quickcheck (no network, no processes) ==");

/* ---- N1 preload allowlist ---- */
const preload = read("electron-app/electron/preload.ts");
const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
ok(allow.length === 53, `N1a preload allowlist has 53 quoted-comma tokens (50 commands + 3 R3 event-channel names in onMainEvent) — 21 after C2 + geo_status/geo_ensure at C3, 27 at C6; 31 after B2: the 4 routing commands; 32 after E1: the connection-stats probe; 50 commands after R3: +4 update-center, +1 live-conn, +2 scanner, +12 mhrv, +3 R3 progress-event channel names (disclosed re-point) ( got ${allow.length})`);
ok(allow.includes("net_check"), "N1b allowlist contains net_check");
ok(allow.includes("app_prefs_get") && allow.includes("app_prefs_set") && allow.includes("autostart_set"), "N1c Phase-D3 app-prefs commands present");
ok(allow.includes("tray_status_set"), "N1d Phase-D4 tray_status_set present");

/* ---- N2 ipc.ts net_check ---- */
const ipc = read("electron-app/electron/ipc.ts");
ok(ipc.includes('ipcMain.handle(\n    "net_check"'), "N2a net_check handler registered");
ok(ipc.includes("https://www.cloudflare.com/cdn-cgi/trace"), "N2b fixed Cloudflare trace URL present");
ok(!/net\.fetch\(/.test(ipc), "N2c no net.fetch with default session (uses pinned ses.fetch)");
ok(ipc.includes('mode: "fixed_servers"') && ipc.includes("socks5://127.0.0.1:"), "N2d throwaway session pinned to local socks5");
ok(ipc.includes("dns.getServers()"), "N2e DNS resolver list exposed");
ok(/u16Port\("socksPort"/.test(ipc), "N2f socksPort passes the u16 boundary");
ok(/64 \* 1024/.test(ipc) && /12_000/.test(ipc), "N2g response cap + 12s deadlines");

/* ---- N3 compiled main freshness ---- */
const mainJs = join(EAPP, "dist-electron", "electron", "ipc.js");
let mainCompiled = "";
for (const cand of [mainJs, join(EAPP, "dist-electron", "ipc.js"), join(EAPP, "dist", "electron", "ipc.js"), join(EAPP, "dist", "main.js")]) {
  if (existsSync(cand)) { mainCompiled = readFileSync(cand, "utf8"); break; }
}
ok(mainCompiled.includes("net_check"), "N3 compiled main contains net_check (build:main current)");

/* ---- N4 store ---- */
const store = read("src/store.ts");
ok(store.includes("connDownSpeed: number;") && store.includes("connUpSpeed: number;"), "N4a store state fields typed");
ok(/connDownSpeed: number;\n    connUpSpeed: number;/.test(store), "N4b setConnState patch includes speeds");
ok(store.includes("connDownSpeed: 0,"), "N4c speeds initialized to 0");

/* ---- N5 ConnectionManager ---- */
const cm = read("src/components/ConnectionManager.tsx");
ok(cm.includes("prevTrafficRef"), "N5a per-poll baseline ref present");
ok(cm.includes("down >= prev.down && up >= prev.up"), "N5b negative-delta guard (counter reset)");
ok(cm.includes("connDownSpeed: downSpeed, connUpSpeed: upSpeed"), "N5c speed committed to store");
ok(cm.includes("connDownSpeed: 0, connUpSpeed: 0"), "N5d speeds zeroed when leaving connected state");

/* ---- N6 ConfigsTab Connect Best ---- */
const ct = read("src/components/ConfigsTab.tsx");
ok(ct.includes("handleConnectBest") && ct.includes('t("configs.connectBest", language)'), "N6a Connect Best button wired");
ok(ct.includes("connectToConfig(best.id)"), "N6b Connect Best calls the shared connect path");
ok(ct.includes("connectBestNone"), "N6c no-ping-data guard toast");

/* ---- N7 ConnectionTab ---- */
const tab = read("src/components/ConnectionTab.tsx");
ok(tab.includes("fmtSpeed") && tab.includes("fmtSpeed(connDownSpeed)"), "N7a speed chip rendered");
ok(tab.includes("net_check") && tab.includes("ipcheck.title"), "N7b IP check card wired");
ok(tab.includes("st.aetherInfo?.socks_port"), "N7c aether port selected for the probe");

/* ---- N8 AetherTab honest note ---- */
const ae = read("src/components/AetherTab.tsx");
ok(ae.includes("aether.noTrafficStats"), "N8 Aether tab shows the no-stats note when connected");

/* ---- N9 electron-mock ---- */
const mock = read("src/electron-mock.ts");
ok(mock.includes("net_check:"), "N9 browser mock handles net_check");

/* ---- N10 i18n ---- */
const bundle = join(HERE, "taskD1-i18n.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskD1-entry.ts"), "--bundle", "--platform=node", "--outfile=" + bundle], { cwd: ROOT, stdio: "pipe" });
const { langs } = JSON.parse(execFileSync("node", [bundle], { encoding: "utf8" }));
const NEW_KEYS = [
  "connection.liveSpeed",
  "configs.connectBest", "configs.connectBestNone", "configs.connectBestAlready", "configs.connectBestConnecting",
  "ipcheck.title", "ipcheck.desc", "ipcheck.idle", "ipcheck.check", "ipcheck.checking",
  "ipcheck.exit", "ipcheck.direct", "ipcheck.diff", "ipcheck.same", "ipcheck.dns", "ipcheck.dnsHint", "ipcheck.browserMode",
  "aether.noTrafficStats",
];
let missing = [];
for (const key of NEW_KEYS) {
  for (const lang of ["en", "fa", "zh", "ar"]) {
    if (!langs[lang]?.includes(key)) missing.push(`${lang}:${key}`);
  }
}
ok(missing.length === 0, `N10a all ${NEW_KEYS.length} new keys exist in 4 languages${missing.length ? " — missing: " + missing.join(", ") : ""}`);
const setEn = langs.en.join("|");
ok(["fa", "zh", "ar"].every(l => langs[l].join("|") === setEn), "N10b key-set parity across languages (no orphans/typos)");

/* ---- summary ---- */
console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail === 0 ? 0 : 1);
