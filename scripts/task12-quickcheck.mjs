#!/usr/bin/env node
/** Task 12 QUICK self-check (NO network, NO real connect): env contract +
 *  validation + integrity refusal only. The FULL smoke runs after approval. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Module from "node:module";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = "/home/z/my-project";
const APP = `${ROOT}/memento-src/electron-app`;
const REAL_BIN = `${ROOT}/aether-research/binary-audit/linux-extracted/aether`;

let passed = 0;
const ok = (c, m) => { if (!c) { console.error(`FAIL  ${m}`); process.exit(1); } passed++; console.log(`PASS  ${m}`); };

const UD = fs.mkdtempSync(path.join(os.tmpdir(), "memento-quick-"));
const stubDir = path.join(UD, "stub");
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(path.join(stubDir, "index.js"), `
module.exports = { app: { isPackaged: false, getAppPath: () => process.env.MEMENTO_STUB_APP, getPath: () => process.env.MEMENTO_STUB_DATA, setPath: () => {}, on: () => {} }, ipcMain: { handle: () => {} }, BrowserWindow: { getAllWindows: () => [] }, shell: { openExternal: async () => {} } };`);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return path.join(stubDir, "index.js");
  return origResolve.call(this, request, ...rest);
};
const DATA = path.join(UD, "data");
fs.mkdirSync(DATA, { recursive: true });
process.env.MEMENTO_STUB_DATA = DATA;

// app dir with a TAMPERED binary -> integrity refusal, no spawn
const appDir = path.join(UD, "app");
fs.mkdirSync(path.join(appDir, "resources", "aether"), { recursive: true });
fs.copyFileSync(REAL_BIN, path.join(appDir, "resources", "aether", "aether"));
fs.appendFileSync(path.join(appDir, "resources", "aether", "aether"), "tampered");
fs.chmodSync(path.join(appDir, "resources", "aether", "aether"), 0o755);
process.env.MEMENTO_STUB_APP = appDir;

const { aetherManager, buildAetherEnv, validateAetherSettings, DEFAULT_AETHER_SETTINGS } = await import(`${APP}/dist-electron/aether.js`);

const env = buildAetherEnv({ ...DEFAULT_AETHER_SETTINGS, httpProxyEnabled: true, noize: "off" }, "masque", "/id.toml");
ok(env.AETHER_PROTOCOL === "masque" && env.AETHER_SOCKS === "127.0.0.1:1819" && env.AETHER_CONFIG === "/id.toml", "env contract: headless trio + socks + config");
ok(!("AETHER_NOIZE" in buildAetherEnv(DEFAULT_AETHER_SETTINGS, "masque", "/id.toml")), "env contract: noize=default omitted");
ok(env.AETHER_NOIZE === "off" && env.AETHER_HTTP_PROXY === "127.0.0.1:1820", "env contract: explicit noize + http listener forwarded");

ok(validateAetherSettings(DEFAULT_AETHER_SETTINGS).length === 0, "validation: defaults pass");
ok(validateAetherSettings({ ...DEFAULT_AETHER_SETTINGS, endpoint: "host.name:443" }).length > 0, "validation: hostname endpoint rejected");

let err = null;
try { await aetherManager.startAether({ ...DEFAULT_AETHER_SETTINGS, socksPort: 11861 }); } catch (e) { err = e; }
ok(err && /integrity check FAILED/i.test(String(err?.message || err)), `integrity gate: tampered binary refused (${String(err?.message || err).split("\n")[0]})`);
const pg = spawnSync("pgrep", ["-f", "resources/aether/aether"], { encoding: "utf8" });
ok(pg.status !== 0, "integrity gate: nothing spawned");
console.log(`\nQUICK-CHECK: ${passed} assertions passed`);
