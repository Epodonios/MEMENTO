#!/usr/bin/env node
/**
 * Phase D3 FUNCTIONAL test — REAL bundled appBackup + qrShare modules.
 * No Electron, no network: localStorage is a faithful in-memory stub, and
 * qrcode's PNG encoder works headless in Node. The QR DECODE path needs a
 * browser canvas (createImageBitmap) and is structurally checked in the
 * quickcheck instead — decoded end-to-end on Windows (checklist §20).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.TD3_WORK || "/home/z/my-project/scripts/taskD3-fn-tmp";
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

// 1) bundle the real modules
execFileSync("npx", ["esbuild", join(HERE, "taskD3-fnentry.ts"), "--bundle", "--platform=node", `--outfile=${join(WORK, "d3.cjs")}`], { cwd: HERE, stdio: "pipe" });

// 2) in-memory localStorage stub (set BEFORE loading the bundle)
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const m = await import(join(WORK, "d3.cjs"));

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

/* ---------- backup round-trip on the REAL module ---------- */
store.set("memento-configs", JSON.stringify([{ id: "a", raw: "vmess://AAAA", isValid: true }]));
store.set("memento-subscription-groups", JSON.stringify([{ id: "g1", name: "grp" }]));
store.set("memento-builder-options", JSON.stringify({ allowLan: true }));
store.set("v2ray-editor-language", "fa");

const file = m.collectBackup(new Date("2026-09-17T12:00:00Z"));
check("F1 collect: format+version+exportedAt", file.format === m.BACKUP_FORMAT && file.version === m.BACKUP_VERSION && file.exportedAt === "2026-09-17T12:00:00.000Z");
check("F1 collect: counts from real blobs", file.counts.configs === 1 && file.counts.groups === 1, JSON.stringify(file.counts));
check("F1 collect: data carries 4 set keys", ["memento-configs", "memento-subscription-groups", "memento-builder-options", "v2ray-editor-language"].every(k => typeof file.data[k] === "string"));
check("F1 file name pattern", /^memento-backup-\d{8}-\d{6}\.json$/.test(m.backupFileName()));

check("F2 parse: accepts the real export", m.parseBackup(JSON.stringify(file)).data["v2ray-editor-language"] === "fa");
check("F2 parse: rejects garbage JSON", (() => { try { m.parseBackup("not json"); return false; } catch { return true; } })());
check("F2 parse: rejects wrong format", (() => { try { m.parseBackup(JSON.stringify({ format: "other", version: 1, data: {} })); return false; } catch { return true; } })());
check("F2 parse: rejects bad version", (() => { try { m.parseBackup(JSON.stringify({ format: m.BACKUP_FORMAT, version: 99, data: {} })); return false; } catch { return true; } })());
check("F2 parse: rejects missing data section", (() => { try { m.parseBackup(JSON.stringify({ format: m.BACKUP_FORMAT, version: 1 })); return false; } catch { return true; } })());
{
  const hostile = JSON.stringify({ format: m.BACKUP_FORMAT, version: 1, data: { "memento-configs": 42, "v2ray-editor-language": "en", evil: "nope" } });
  const p = m.parseBackup(hostile);
  check("F2 parse: drops non-string + unknown keys", !("memento-configs" in p.data) && p.data["v2ray-editor-language"] === "en" && !("evil" in p.data));
}

store.clear();
store.set("keep-me", "untouched");
const restored = m.applyBackup(file);
check("F3 apply: restores 4 keys and returns count", restored === 4, String(restored));
check("F3 apply: blob content byte-identical", store.get("memento-configs") === file.data["memento-configs"]);
check("F3 apply: unrelated keys untouched", store.get("keep-me") === "untouched");
const emptyApply = m.applyBackup(m.parseBackup(JSON.stringify({ format: m.BACKUP_FORMAT, version: 1, data: {} })));
check("F3 apply: empty backup touches nothing", emptyApply === 0);

/* ---------- QR generate + payload split on the REAL module ---------- */
const dataUrl = await m.makeQrDataUrl("vless://b831381d-6324-4d53-ad4f-8cda48b30811@example.com:443?security=tls#demo");
check("F4 makeQrDataUrl: PNG data-url produced", /^data:image\/png;base64,/.test(dataUrl) && dataUrl.length > 500);
const multi = ["vmess://A", "", "  ", "trojan://pw@h:443#x", "ss://YWVzLTI1Ni1nY206cHc@a:1#s"].join("\n");
const links = m.qrPayloadToLinks(multi);
check("F4 qrPayloadToLinks: trims + drops empties", links.length === 3 && links[1] === "trojan://pw@h:443#x", JSON.stringify(links));
const big = Array.from({ length: 5000 }, (_, i) => `ss://${i}`).join("\n");
check("F4 qrPayloadToLinks: 2000 cap", m.qrPayloadToLinks(big).length === 2000);

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
