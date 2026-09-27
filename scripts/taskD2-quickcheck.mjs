#!/usr/bin/env node
/**
 * Phase D2 quickcheck — NO network, NO spawned processes.
 * Structural surface for Batch D2 (item 1 userinfo + item 9 builder toggles):
 *   N1  builderOptions.ts module: defaults == pre-D2 hardcodes, storage key
 *   N2  store: builderOptions state + setter + persistence + SubscriptionGroup.userInfo
 *   N3  subscription.ts: fetchSubscriptionDetailed + header/#-line capture +
 *       back-compat wrapper (old signature intact)
 *   N4  v2rayConfig: opts param, sniffing/bt/lan/mux/cert/loglevel gates
 *   N5  singBoxConfig: opts param + documented non-applicability
 *   N6  callers: connectionActions + ConnectionTab preview pass builderOptions
 *   N7  ConfigsTab: usage bar + builder panel + detailed refresh
 *   N8  App.tsx auto-update + BrokersModal capture userInfo
 *   N9  ManageGroupsModal usage/unavailable lines
 *   N10 i18n: all 18 new keys x 4 languages + key-set parity
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = "/home/z/my-project/memento-src";   // app source root

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const read = (p) => readFileSync(join(ROOT, p), "utf8");

console.log("== Phase D2 quickcheck (no network, no processes) ==");

/* ---- N1 builderOptions module ---- */
const bo = read("src/utils/builderOptions.ts");
ok(bo.includes('sniffing: true') && bo.includes('blockBittorrent: true') &&
   bo.includes('allowLan: false') && bo.includes('muxEnabled: false') &&
   bo.includes('skipCertVerify: true') && bo.includes('logLevel: "warning"'),
  "N1a defaults reproduce pre-D2 hardcodes");
ok(bo.includes('"memento-builder-options"'), "N1b storage key");
ok(bo.includes('return { ...DEFAULT_BUILDER_OPTIONS, ...parsed }'), "N1c forward-compat merge over defaults");
ok(bo.includes('level === "warning" ? "warn" : level'), "N1d sing-box level mapping");

/* ---- N2 store ---- */
const store = read("src/store.ts");
ok(store.includes("builderOptions: BuilderOptions;") && store.includes("setBuilderOptions: (patch: Partial<BuilderOptions>) => void;"), "N2a state + setter typed");
ok(store.includes("builderOptions: loadBuilderOptions(),"), "N2b store init from loadBuilderOptions");
ok(/setBuilderOptions: \(patch\) => \{[\s\S]*?BUILDER_OPTIONS_STORAGE_KEY[\s\S]*?JSON\.stringify\(next\)/.test(store), "N2c setter persists the merged blob");
ok(store.includes("userInfo?: SubscriptionUserInfo & { fetchedAt: number };"), "N2d SubscriptionGroup.userInfo typed");
ok(store.includes('export type { BuilderOptions, SubscriptionUserInfo };'), "N2e re-exports");

/* ---- N3 subscription.ts ---- */
const sub = read("src/utils/subscription.ts");
ok(sub.includes("export interface SubscriptionUserInfo"), "N3a SubscriptionUserInfo exported");
ok(sub.includes("export function parseSubscriptionUserInfo"), "N3b parser exported");
ok(sub.includes('res.headers.get("subscription-userinfo")'), "N3c HTTP header captured");
ok(/SUB_USERINFO_LINE_RE[\s\S]*?subscription-userinfo\\s\*\[\\s\\S\]/.test(sub) || sub.includes("subscription-userinfo\\s*[:=]"), "N3d body # line pattern");
ok(sub.indexOf("if (l && l.startsWith(\"#\") && !lineUserInfo)") !== -1 && sub.indexOf("return l && !l.startsWith(\"#\")") !== -1, "N3e #-line parsed BEFORE the Task-13 skip");
ok(/export async function fetchSubscription\(url: string, timeoutMs = 12000\): Promise<string\[\]>/.test(sub), "N3f old fetchSubscription signature intact (back-compat)");
ok(sub.includes("return detailed.lines;"), "N3g wrapper delegates to detailed fetch");

/* ---- N4 v2rayConfig ---- */
const v2 = read("src/utils/v2rayConfig.ts");
ok(v2.includes("builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS,"), "N4a optional opts param (default = old behavior)");
ok(v2.includes("loglevel: builderOptions.logLevel,"), "N4b loglevel gate");
ok(v2.includes("builderOptions.allowLan ? \"0.0.0.0\" : \"127.0.0.1\""), "N4c listen gate");
ok(v2.includes("sniffing: { enabled: builderOptions.sniffing, destOverride: sniffingDestOverride }"), "N4d sniffing gate (re-pointed at C3: destOverride rides the routing build, legacy default [\"http\",\"tls\"])");
ok(v2.includes("...(builderOptions.blockBittorrent ? [{"), "N4e bittorrent rule gate");
ok(v2.includes("function muxSettingsIfEnabled(builderOptions: BuilderOptions, flowEmitted: boolean)") &&
   v2.includes("if (!builderOptions.muxEnabled || flowEmitted) return null;"), "N4f mux gate + flow guard");
ok(/protocol: "vmess",[\s\S]{0,400}?\.\.\.\(mux \? \{ mux \} : \{\}\),/.test(v2) &&
   /protocol: "vless",[\s\S]{0,400}?\.\.\.\(mux \? \{ mux \} : \{\}\),/.test(v2) &&
   /protocol: "trojan",[\s\S]{0,400}?\.\.\.\(mux \? \{ mux \} : \{\}\),/.test(v2),
  "N4h mux spread present on vmess + vless + trojan outbounds (D2 review fix)");
ok(v2.includes("allowInsecure: builderOptions.skipCertVerify,"), "N4g cert gate (vmess/vless/trojan)");

/* ---- N5 singBoxConfig ---- */
const sb = read("src/utils/singBoxConfig.ts");
ok(sb.includes("builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS"), "N5a opts param");
ok(sb.includes("log: { level: singBoxLogLevel(builderOptions.logLevel) }"), "N5b level mapping");
ok(sb.includes("builderOptions.allowLan ? \"0.0.0.0\" : \"127.0.0.1\""), "N5c listen gate");
ok(sb.includes("`insecure` stays driven by the LINK's") && sb.includes("own flag (documented contract)"), "N5d non-applicability documented");

/* ---- N6 callers ---- */
const ca = read("src/utils/connectionActions.ts");
ok(/generateSingBoxConfig\([\s\S]*?state\.builderOptions,/.test(ca) && /generateV2RayConfig\([\s\S]*?state\.builderOptions,/.test(ca), "N6a connect path passes builderOptions to BOTH generators");
const ct = read("src/components/ConnectionTab.tsx");
ok(ct.includes("connApiPort, builderOptions)"), "N6b JSON preview passes builderOptions");
ok(ct.includes("builderOptions]"), "N6c preview re-computes when toggles change");

/* ---- N7 ConfigsTab (+ builder panel home: Settings tab since Phase D4,
      per the D2 panel comment that pre-declared it the final home) ---- */
const cfgTab = read("src/components/ConfigsTab.tsx");
const setTab = read("src/components/SettingsTab.tsx");
ok(cfgTab.includes("SubscriptionUsageBar"), "N7a usage bar component");
ok(setTab.includes("BuilderOptionsPanel"), "N7b builder panel component (migrated to the D4 Settings tab)");
ok(cfgTab.includes("fetchSubscriptionDetailed(group.subscriptionUrl)"), "N7c refresh uses detailed fetch");
ok(cfgTab.includes("{ ...detailed.userInfo, fetchedAt: Date.now() }"), "N7d usage persisted with fetchedAt");
ok(cfgTab.includes("activeGroup?.userInfo && <SubscriptionUsageBar"), "N7e usage bar only when the ACTIVE group has data");
ok(setTab.includes('titleKey="builder.title"') && setTab.includes("setBuilderOptions"), "N7f panel wired to store (D4 Settings tab)");
ok(setTab.includes('options.allowLan && (') && setTab.includes('t("builder.allowLanWarning", language)') &&
   setTab.includes("border-amber-500/30 bg-amber-500/10"),
  "N7g allowLan ON renders amber security-warning banner (D2 review fix, D4 home)");

/* ---- N8 App + Brokers ---- */
const app = read("src/App.tsx");
ok(app.includes("fetchSubscriptionDetailed(group.subscriptionUrl)") && app.includes("userInfo: { ...detailed.userInfo, fetchedAt: Date.now() }"), "N8a auto-update captures usage");
const bm = read("src/components/BrokersModal.tsx");
ok(bm.includes("fetchSubscriptionDetailed(item.url)") && bm.includes("updateSubscriptionGroup(groupId, {\n          userInfo: { ...detailed.userInfo, fetchedAt: Date.now() }"), "N8b broker fetch captures usage");

/* ---- N9 ManageGroupsModal ---- */
const sg = read("src/components/SubscriptionGroups.tsx");
ok(sg.includes('t("subs.usageUnavailable", language)'), "N9a explicit not-reported note");
ok(sg.includes("g.userInfo.total ? ` / ${fmtBytesShort(g.userInfo.total)}`"), "N9b compact used/total line");

/* ---- N10 i18n ---- */
const bundle = join(HERE, "taskD2-i18n.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskD2-entry.ts"), "--bundle", "--platform=node", "--outfile=" + bundle], { cwd: HERE, stdio: "pipe" });
const { langs } = JSON.parse(execFileSync("node", [bundle], { encoding: "utf8" }));
const NEW_KEYS = [
  "subs.usage", "subs.usageUsed", "subs.usageExpire", "subs.usageNoExpire", "subs.usageNoTotal", "subs.usageUnavailable",
  "builder.title", "builder.hint", "builder.sniffing", "builder.blockBt", "builder.allowLan", "builder.allowLanHint", "builder.allowLanWarning",
  "builder.mux", "builder.muxHint", "builder.skipVerify", "builder.skipVerifyHint", "builder.logLevel", "builder.reset",
];
const missing = [];
for (const key of NEW_KEYS) {
  for (const lang of ["en", "fa", "zh", "ar"]) {
    if (!langs[lang]?.includes(key)) missing.push(`${lang}:${key}`);
  }
}
ok(missing.length === 0, `N10a all ${NEW_KEYS.length} new keys exist in 4 languages${missing.length ? " — missing: " + missing.join(", ") : ""}`);
const setEn = langs.en.join("|");
ok(["fa", "zh", "ar"].every(l => langs[l].join("|") === setEn), "N10b key-set parity across languages (no orphans/typos)");

/* ---- summary ---- */
console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
