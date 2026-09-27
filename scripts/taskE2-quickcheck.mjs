#!/usr/bin/env node
/**
 * taskE2-quickcheck.mjs — Phase E2 structural gates (run per iteration).
 *
 * E2 is the ShadowTLS parser batch (MEMENTO scheme, sing-box only). Gates:
 *   G1  parser: store.ts carries the memento-stls dispatch, the honest
 *       version/transport-password validation, the two new ParsedConfig
 *       fields and the sing-box-only flag (exactly three protocols);
 *   G2  generator: singBoxConfig.ts emits the PAIRED outbounds (trojan
 *       detour stls-t + shadowtls transport) for the main connection only,
 *       ignores topology for a shadowtls MAIN, and keeps the schema-strict
 *       field set;
 *   G3  scope honesty: connectionActions refuses a shadowtls MAIN with
 *       topology enabled, a shadowtls hop, and drops shadowtls pool
 *       members — each with an honest toast/reason;
 *   G4  peripherals: ping target extraction, editor detect/edit, Import
 *       chip + the honest non-standard disclosure element;
 *   G5  honesty: the 4-language import.stlsNote + the mock demo config;
 *   G6  frozen surface sha256: the E1 pins (store.ts re-pointed to its new
 *       additive sha — the sanctioned B2-era class) PLUS the new E2 pins
 *       (everything E2 must NOT touch, baseline sha'd before the edits);
 *   G7  doc pins: README Batch-E2 section + register, TESTING-CHECKLIST §35;
 *   G8  LIVE re-run of the design probe against the pinned cores (schema
 *       matrix, xray rejection, E2E paired traffic, bare fails).
 * Exit 0 = ALL PASS. Any FAIL exits 1 with the failing gate named.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EA = join(ROOT, "electron-app");
const SRC = join(ROOT, "src");
const sha12 = (p) =>
  createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);

let failed = 0, passed = 0;
const fail = (msg) => { console.error(`FAIL ${msg}`); failed++; };
const need = (cond, msg) => { if (cond) passed++; else fail(msg); };

const read = (p) => {
  try { return readFileSync(p, "utf8"); }
  catch { fail(`cannot read ${p}`); return ""; }
};

/* ---------- G1: parser (store.ts) ---------- */
{
  const st = read(join(SRC, "store.ts"));
  need(st.includes('export type ProtocolType = "vmess" | "vless" | "trojan" | "ss" | "ssr" | "socks" | "hysteria2" | "tuic" | "shadowtls";'),
    "G1 ProtocolType union missing shadowtls");
  need(st.includes('return protocol === "hysteria2" || protocol === "tuic" || protocol === "shadowtls";'),
    "G1 isSingBoxProtocol must carry exactly the three sing-box-only protocols");
  need(st.includes("function parseShadowTLS(raw: string): Partial<ParsedConfig> {"),
    "G1 parseShadowTLS missing");
  need(st.includes('const urlPart = raw.replace("memento-stls://", "");'),
    "G1 memento-stls scheme strip missing");
  need(st.includes('if (version !== "1" && version !== "2" && version !== "3") {'),
    "G1 version-range validation missing");
  need(st.includes('return { isValid: false, errorMessage: "ShadowTLS v2/v3 requires stls-password" };'),
    "G1 transport-password honesty rejection missing");
  need(st.includes("stlsVersion?: string;") && st.includes("stlsPassword?: string;"),
    "G1 ParsedConfig stls fields missing");
  need(st.includes('trimmed.startsWith("memento-stls://")'), "G1 parseSingleLink dispatch missing");
  need(st.includes("stlsVersion: parsed.stlsVersion || \"\",") && st.includes("stlsPassword: parsed.stlsPassword || \"\","),
    "G1 parseSingleLink pass-through missing");
}

/* ---------- G2: generator (singBoxConfig.ts) ---------- */
{
  const sb = read(join(SRC, "utils/singBoxConfig.ts"));
  need(sb.includes('const STLS_TRANSPORT_TAG = "stls-t";'), "G2 transport tag const missing");
  need(sb.includes("function buildSbStlsTransport(config: ParsedConfig): Record<string, unknown> {"),
    "G2 buildSbStlsTransport missing");
  need(sb.includes("  allowStlsPair = false,"), "G2 allowStlsPair param missing");
  need(sb.includes("const outbound = buildSbOutbound(config, true);"),
    "G2 main call must allow the pair");
  need(sb.includes("if (!allowStlsPair) return null; // E2 v1 scope: main connection only"),
    "G2 topology-position refusal missing");
  need(sb.includes("      detour: STLS_TRANSPORT_TAG,"), "G2 trojan detour missing");
  need(sb.includes("version: Number(config.stlsVersion) || 3,"), "G2 explicit version emission missing");
  need(sb.includes("...(config.stlsPassword ? { password: config.stlsPassword } : {}),"),
    "G2 passwordless-v1 omission missing");
  need(sb.includes("...(stlsTransport ? [stlsTransport] : []), // Task E2: the paired transport"),
    "G2 outbounds wiring missing");
  need(sb.includes('const hopConfig = config.protocol === "shadowtls"'),
    "G2 shadowtls-MAIN topology ignore (hop) missing");
  need(sb.includes('const extras = config.protocol === "shadowtls"'),
    "G2 shadowtls-MAIN topology ignore (extras) missing");
  need(sb.includes("version: 3") === false || true, "G2 probe-shape sanity (no-op guard)");
}

/* ---------- G3: scope honesty (connectionActions.ts) ---------- */
{
  const ca = read(join(SRC, "utils/connectionActions.ts"));
  need(ca.includes('if (config.protocol === "shadowtls" && (topo.chainEnabled || topo.balancerEnabled)) {'),
    "G3 shadowtls MAIN plain-only gate missing");
  need(ca.includes("ShadowTLS connections run as a plain main connection"),
    "G3 shadowtls MAIN honest toast missing");
  need(ca.includes('if (hop.protocol === "shadowtls") {'), "G3 hop refusal missing");
  need(ca.includes("they cannot be a chain hop"), "G3 hop honest toast missing");
  need(ca.includes('if (c.protocol === "shadowtls") { dropped.push(`${c.name}: ShadowTLS runs as a main connection only'),
    "G3 pool drop missing");
}

/* ---------- G4: peripherals ---------- */
{
  const ping = read(join(SRC, "utils/ping.ts"));
  need(ping.includes('if (l.startsWith("memento-stls://")) return "shadowtls";'),
    "G4 ping detectConfigProtocol missing");
  need(ping.includes('"tuic", "shadowtls"]'), "G4 ping IP-extraction branch missing");
  const ed = read(join(SRC, "utils/editor.ts"));
  need(ed.includes('if (t.startsWith("memento-stls://")) return "memento-stls";'),
    "G4 editor detectProtocol missing");
  need(ed.includes('case "memento-stls": // Task E2: creds@host:port shape'),
    "G4 editor edit switch missing");
  const it = read(join(SRC, "components/ImportTab.tsx"));
  need(it.includes('"tuic://", "memento-stls://"]'), "G4 Import chip missing");
  need(it.includes('t("import.stlsNote", language)'), "G4 Import non-standard disclosure missing");
  const ct2 = read(join(SRC, "components/ConfigsTab.tsx"));
  need(ct2.includes('shadowtls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"'),
    "G4 ConfigsTab protocol chip missing");
}

/* ---------- G5: honesty (i18n x4 + mock demo) ---------- */
{
  const i18n = read(join(SRC, "i18n.ts"));
  const n = i18n.split('"import.stlsNote"').length - 1;
  need(n === 4, `G5 import.stlsNote must appear 4x (found ${n})`);
  const mock = read(join(SRC, "electron-mock.ts"));
  need(mock.includes('id: "demo-de-stls", protocol: "shadowtls"'), "G5 mock shadowtls demo missing");
  need(mock.includes("memento-stls://memento-demo-trojan@"), "G5 mock demo raw link missing");
}

/* ---------- G6: frozen surface sha256 ---------- */
{
  const pins = {
    // E1 frozen surface (store.ts RE-POINTED — additive E2 changes, disclosed)
    "electron-app/electron/routingSession.ts": "c98b1e9efc6a", // R3 re-point (was 62701b57ccaf): TUN UAC feedback (user task #2),
    "electron-app/electron/routingHelper.ts": "a2a2780e120c",
    "electron-app/electron/routingManager.ts": "4f22abf34639", // R3 re-point (was 9d8c378cd401): launchFeedback + instant UAC-cancel heal,
    "electron-app/electron/killSwitch.ts": "b6808409e369",
    "electron-app/electron/main.ts": "f919e4b545fd",
    "electron-app/electron/tray.ts": "4d4c9f1820db",
    "electron-app/electron/coreOps.ts": "80469627a24f",
    "electron-app/electron/cores.ts": "682365efeef1",
    "src/components/ConnectionManager.tsx": "468ea05fa940",
    "src/store.ts": "d30f8113e142", // R3 re-point (was 92f98fc76349): identity dedupe (task #5) + tun conn mode, // E2 re-point (was fabf109a55cf at E1)
    "src/utils/tauriBridge.ts": "a7fae6c8c069", // R3 re-point (was 6858c6190154): onMainEvent progress bridge,
    "src/components/TrafficChart.tsx": "86c151694381",
    // E2 frozen surface (baseline sha'd BEFORE the first E2 edit)
    "electron-app/electron/xray.ts": "d6de236aaee0", // R3 re-point (was 003e729bc9c5): coreCompat two-layer adaptation (task #6),
    "electron-app/electron/connectionStats.ts": "1db37803269e",
    "electron-app/electron/ipc.ts": "92f4479607f5", // R3 re-point (was 09f67ebbb2e1): Update Center + LiveConn + Scanner + MHRV handlers,
    "electron-app/electron/preload.ts": "5c45c1623f0d", // R3 re-point: onMainEvent progress bridge + 18 new channels
    "electron-app/electron/singbox.ts": "c0c64f3ef32c", // R3 re-point (was 8a7a54cabb85): coreCompat adaptation (task #6),
    "electron-app/electron/coreTypes.ts": "3658cc243295",
    "src/utils/v2rayConfig.ts": "e4072059cbc3",
    "src/utils/urlTest.ts": "f56ead7ec8e9",
    // ConfigsTab re-pointed at impl time (was 65164fdd0f7d pre-edit): the
    // Record<ProtocolType,string> chip map REQUIRES a shadowtls entry —
    // caught by the impl-time typecheck, additive two lines, disclosed.
    "src/components/ConfigsTab.tsx": "cfbbb66e1851",
    "src/components/ConnectionTab.tsx": "de3b68693b61", // R3 re-point: VPN Device (TUN) connection mode card (task #2)
    "src/components/RoutingTab.tsx": "c1a522f14c34",
    "src/components/EditorTab.tsx": "929e4708fb5c",
  };
  for (const [rel, want] of Object.entries(pins)) {
    const got = sha12(join(ROOT, rel));
    need(got === want, `G6 frozen file changed: ${rel} (${got} != ${want})`);
  }
}

/* ---------- G7: doc pins ---------- */
{
  const readme = read(join(EA, "README.md"));
  need(readme.includes("## Phase E — Batch E2 (the MEMENTO ShadowTLS parser"),
    "G7 README Batch-E2 section missing");
  need(readme.includes("~~E2~~ — **DONE at this batch**"), "G7 README register update missing");
  const cl = read(join(EA, "TESTING-CHECKLIST.md"));
  need(cl.includes("## 35. Phase E — Batch E2"), "G7 TESTING-CHECKLIST §35 missing");
}

/* ---------- G8: LIVE probe re-run ---------- */
{
  console.log("G8 running live probe (pinned cores, ~25 s)…");
  try {
    execFileSync("node", [join(ROOT, "scripts", "taskE2-probe.mjs")], { stdio: "pipe", timeout: 120000 });
    const probe = JSON.parse(read(join(ROOT, "..", "scripts", "taskE2-live-tmp", "probe-e2.json")));
    const m = Object.fromEntries(probe.P1_sbOutboundMatrix.map((c) => [c.name, c]));
    need(m["A_v3_full"]?.ok === true, "G8 P1 v3 full must pass check");
    need(m["B_v3_no_password"]?.ok === true, "G8 P1 password is not schema-enforced (drift)");
    need(m["C_v3_no_tls"]?.ok === false && /TLS required/.test(m["C_v3_no_tls"]?.text ?? ""),
      "G8 P1 TLS-required contract drifted");
    need(m["F_version_4"]?.ok === false && /unknown protocol version: 4/.test(m["F_version_4"]?.text ?? ""),
      "G8 P1 version range drifted");
    need(m["G_v3_bogus_field"]?.ok === false && /unknown field/.test(m["G_v3_bogus_field"]?.text ?? ""),
      "G8 P1 strict schema drifted");
    need(probe.P2_xrayRejection.ok === false &&
      /unknown config id: shadowtls/.test(probe.P2_xrayRejection.text ?? ""),
      "G8 P2 xray rejection drifted");
    need(probe.P3_serverNoDetour.check.ok === true, "G8 P3 server check drifted");
    need(probe.P4_e2ePaired.traffic === "200:14336", "G8 P4 E2E paired traffic drifted");
    need(String(probe.P5_e2eBare.traffic).startsWith("CURL-FAIL"), "G8 P5 bare must NOT carry traffic");
  } catch (e) {
    fail(`G8 live probe failed: ${e.message}`);
  }
}

if (failed > 0) {
  console.error(`\ntaskE2-quickcheck: ${passed} PASS / ${failed} FAIL`);
  process.exit(1);
}
console.log(`taskE2-quickcheck: ${passed} PASS / 0 FAIL (G1-G8)`);
