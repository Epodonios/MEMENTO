#!/usr/bin/env node
/**
 * Phase D2: rebuild download/MEMENTO-electron-migration.zip and run
 * in-archive verification for BOTH Batch-D2 features (userinfo + builder
 * toggles incl. the D2 review fixes: trojan mux + allowLan security warning)
 * AND the Task-13/Task-12/D1 pins (full regression in one gate). Same
 * exclusion rules as every previous phase. Real core BINARIES are never
 * shipped in the source zip — resources/ README files document the pinned
 * downloads + hashes.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SRC = "/home/z/my-project/memento-src";
const OUT = "/home/z/my-project/download/MEMENTO-electron-migration.zip";

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "dist-electron", "release", "target"].includes(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      if (entry.name === ".gitignore" || [".tsbuildinfo", ".log"].includes(path.extname(entry.name))) continue;
      files.push(path.join(dir, entry.name));
    }
  }
})(SRC);

fs.rmSync(OUT, { force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const X = [
  "node_modules/*", "*/node_modules/*",
  "dist/*", "*/dist/*",
  "dist-electron/*", "*/dist-electron/*",
  "release/*", "*/release/*",
  "target/*", "*/target/*",
  "*.tsbuildinfo", "*.log",
];
execFileSync("zip", ["-q", "-r", OUT, ".", ...X.flatMap((p) => ["-x", p])], { cwd: SRC });

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`zip rebuilt: ${OUT}`);
console.log(`size: ${mb} MB`);

const listing = execFileSync("unzip", ["-Z1", OUT], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const entries = listing.split("\n").filter((l => l && !l.endsWith("/")));
console.log(`file entries: ${entries.length}`);

let bad = 0;
const must = (m) => {
  if (!entries.includes(m)) { console.error(`FAIL  missing key file in zip: ${m}`); bad++; return; }
  console.log(`PASS  zip contains ${m}`);
};

// Task-13 key files (regression)
["src/store.ts", "src/utils/v2rayConfig.ts", "src/components/BrokersModal.tsx",
 "src/utils/subscription.ts", "src/utils/editor.ts", "src/utils/ping.ts",
 "src/components/ConfigsTab.tsx", "src/components/ExportTab.tsx",
 "scripts/task13-smoke.mjs", "scripts/task13-selftest.mjs", "scripts/task13-cfgtest.mjs",
 "scripts/task13-remote-udp-probe.mjs", "scripts/task13-udp-finalize.mjs",
 "scripts/task13-store.cjs", "scripts/task13-cfg.cjs", "scripts/task13-sub.cjs",
 "electron-app/TESTING-CHECKLIST.md", "electron-app/README.md"].forEach(must);

// Task-12 key files (regression)
["electron-app/electron/aether.ts", "electron-app/electron/core-versions.json",
 "electron-app/resources/aether/README.md", "src/components/AetherTab.tsx",
 "scripts/task12-aether-smoke.mjs"].forEach(must);

// Phase-D1 key files (regression)
["electron-app/electron/ipc.ts", "electron-app/electron/preload.ts",
 "src/components/ConnectionManager.tsx", "src/components/ConnectionTab.tsx",
 "src/electron-mock.ts", "src/i18n.ts",
 "scripts/taskD1-quickcheck.mjs", "scripts/taskD1-entry.ts", "scripts/taskD1-i18n.cjs",
 "scripts/taskD1-smoke.mjs"].forEach(must);

// Phase-D2 key files
["src/utils/builderOptions.ts", "src/components/SubscriptionGroups.tsx",
 "src/utils/singBoxConfig.ts",
 "scripts/taskD2-quickcheck.mjs", "scripts/taskD2-cfgtest.mjs", "scripts/taskD2-entry.ts",
 "scripts/taskD2-cfgentry.ts", "scripts/taskD2-cfg.cjs", "scripts/taskD2-i18n.cjs",
 "scripts/taskD2-smoke.mjs"].forEach(must);

const zcat = (f) => execFileSync("unzip", ["-p", OUT, f], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const contentOk = (name, file, needles) => {
  const body = zcat(file);
  for (const n of needles) {
    if (!body.includes(n)) { console.error(`FAIL  ${name}: ${file} lacks ${JSON.stringify(n.slice(0, 40))}`); bad++; return; }
  }
  console.log(`PASS  ${name} (${needles.length} needles in ${file})`);
};

/* ---------- D2 feature needles ---------- */

// item 1: subscription userinfo
contentOk("userinfo capture shipped", "src/utils/subscription.ts", [
  "export interface SubscriptionUserInfo",
  "export function parseSubscriptionUserInfo",
  'res.headers.get("subscription-userinfo")',
  "export async function fetchSubscriptionDetailed",
  "export async function fetchSubscription(url: string, timeoutMs = 12000): Promise<string[]>",
]);
contentOk("userinfo store + builder options shipped", "src/store.ts", [
  "userInfo?: SubscriptionUserInfo & { fetchedAt: number };",
  "builderOptions: BuilderOptions;",
  "setBuilderOptions: (patch: Partial<BuilderOptions>) => void;",
  "builderOptions: loadBuilderOptions(),",
  'export type { BuilderOptions, SubscriptionUserInfo };',
]);
contentOk("usage carriers shipped", "src/components/ConfigsTab.tsx", [
  "SubscriptionUsageBar", "BuilderOptionsPanel", "fetchSubscriptionDetailed(group.subscriptionUrl)",
]);
contentOk("usage row in ManageGroups shipped", "src/components/SubscriptionGroups.tsx", [
  "fmtBytesShort", "subs.usageUnavailable",
]);
contentOk("auto-update + brokers capture usage", "src/App.tsx", [
  "fetchSubscriptionDetailed(group.subscriptionUrl)",
]);
contentOk("brokers capture usage", "src/components/BrokersModal.tsx", [
  "fetchSubscriptionDetailed(item.url)",
]);

// item 9: builder options module — defaults == pre-D2 hardcodes
contentOk("builderOptions module shipped", "src/utils/builderOptions.ts", [
  'sniffing: true,', 'blockBittorrent: true,', 'allowLan: false,', 'muxEnabled: false,',
  'skipCertVerify: true,', 'logLevel: "warning",',
  '"memento-builder-options"',
]);

// generator gates + D2 review fix: mux on vmess/vless/trojan
contentOk("v2ray generator gates shipped", "src/utils/v2rayConfig.ts", [
  "builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS,",
  "builderOptions.allowLan ? \"0.0.0.0\" : \"127.0.0.1\"",
  "if (!builderOptions.muxEnabled || flowEmitted) return null;",
  "allowInsecure: builderOptions.skipCertVerify,",
  "Phase D2 review fix: mux applies to trojan too",
]);
contentOk("sing-box gates shipped", "src/utils/singBoxConfig.ts", [
  "builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS",
  "builderOptions.allowLan ? \"0.0.0.0\" : \"127.0.0.1\"",
]);

// D2 review fix: allowLan security warning banner
contentOk("allowLan security warning shipped", "src/components/ConfigsTab.tsx", [
  "options.allowLan && (",
  't("builder.allowLanWarning", language)',
  "border-amber-500/30 bg-amber-500/10",
]);

// i18n: D2 keys x4 languages
{
  const i18n = zcat("src/i18n.ts");
  const countOf = (k) => (i18n.match(new RegExp(`"${k}"`, "g")) || []).length;
  for (const k of ["builder.title", "builder.allowLanWarning", "builder.muxHint", "subs.usage", "subs.usageUnavailable"]) {
    const n = countOf(k);
    if (n !== 4) { console.error(`FAIL  i18n ${k} x${n} (need 4 languages)`); bad++; }
    else console.log(`PASS  i18n ${k} x${n} (4 languages)`);
  }
  if (!/vmess\/vless\/trojan/.test(i18n)) { console.error("FAIL  muxHint does not list trojan"); bad++; }
  else console.log("PASS  muxHint lists vmess/vless/trojan in i18n");
}

// docs
contentOk("README documents Batch D2", "electron-app/README.md", [
  "Batch D2",
  "subscription-userinfo",
  "GENERIC outbound handler",
]);
contentOk("TESTING-CHECKLIST has section 19 + review-fix items", "electron-app/TESTING-CHECKLIST.md",
  ["19.", "security-warning banner", "vmess/vless/trojan"]);

/* ---------- Task-13 regression needles ---------- */
contentOk("socks parser shipped", "src/store.ts",
  ["function parseSocks(", "username?: string", "tryBase64Decode("]);
contentOk("socks outbound builder shipped", "src/utils/v2rayConfig.ts",
  ["buildSocksOutbound", 'case "socks":']);
{
  const cfg = zcat("src/utils/v2rayConfig.ts");
  const fn = cfg.slice(cfg.indexOf("function buildSocksOutbound"));
  const fnBody = fn.slice(0, fn.indexOf("}") + 1);
  if (fnBody.includes("udp")) { console.error("FAIL  buildSocksOutbound contains a udp field"); bad++; }
  else console.log("PASS  buildSocksOutbound body carries no udp flag (native relay, source-verified)");
  if (!/"udp"\s*:\s*true/.test(cfg)) { console.error("FAIL  local inbound udp:true missing"); bad++; }
  else console.log("PASS  local socks-in udp:true present");
}
{
  const bm = zcat("src/components/BrokersModal.tsx");
  const urls = bm.match(/https:\/\/raw\.githubusercontent\.com[^"]+/g) || [];
  if (urls.length !== 40) { console.error(`FAIL  expected 40 broker URLs in zip, got ${urls.length}`); bad++; }
  else console.log(`PASS  BrokersModal ships all 40 URLs`);
}
contentOk("# header filter shipped", "src/utils/subscription.ts",
  ["skip \"#\"-prefixed subscription header lines", "!l.startsWith(\"#\")"]);

/* ---------- Task-12 + D1 regression needles ---------- */
contentOk("core pins intact", "electron-app/electron/core-versions.json",
  ['"xray": "v25.1.1"', '"sing-box": "1.14.0"', '"aether": "1.9.0"']);
contentOk("net_check handler shipped (D1)", "electron-app/electron/ipc.ts",
  ['"net_check"', "socks5://127.0.0.1:", "session.fromPartition("]);
{
  const preload = zcat("electron-app/electron/preload.ts");
  const allow = [...preload.matchAll(/"([a-z_0-9]+)",/g)].map(m => m[1]);
  if (allow.length !== 16 || !allow.includes("net_check")) {
    console.error(`FAIL  preload allowlist = ${allow.length} commands, net_check=${allow.includes("net_check")}`); bad++;
  } else console.log("PASS  preload allowlist ships 16 commands incl. net_check");
}
contentOk("speed + Connect Best + IP card shipped (D1)", "src/components/ConnectionTab.tsx",
  ["fmtSpeed(connDownSpeed)", "ipcheck.title"]);
contentOk("Connect Best shipped (D1)", "src/components/ConfigsTab.tsx",
  ["handleConnectBest", 't("configs.connectBest", language)']);

if (bad > 0) { console.error(`ZIP VERIFICATION FAILED: ${bad} problem(s)`); process.exit(1); }
console.log("zip verification complete — ALL CHECKS PASSED");
