#!/usr/bin/env node
/**
 * taskE1-quickcheck.mjs — Phase E1 structural gates (run per iteration).
 *
 * E1 is the first post-B batch that TOUCHES runtime source. The gate set:
 *   G1  new files exist at their expected sizes;
 *   G2  preload allowlist gains EXACTLY ONE channel + the docstring note;
 *   G3  ipc.ts: the aggregate get_xray_traffic handler body is byte-pinned,
 *       the new additive handler mirrors its routing + aether guard;
 *   G4  singbox.ts additive accessor only; xray.ts BYTE-STABLE;
 *   G5  the frozen Phase B / C / D surface is sha256-stable (13 files);
 *   G6  renderer pins: ConnectionTab mount needles, i18n 12 keys x 4
 *       languages, mock handler, store/ConnectionManager untouched;
 *   G7  doc pins: README Batch-E1 section + TESTING-CHECKLIST §34;
 *   G8  LIVE re-run of the design probe against the pinned cores
 *       (sing-box /connections shape + xray per-tag-only granularity).
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

/* ---------- G1: new files ---------- */
need(existsSync(join(EA, "electron/connectionStats.ts")), "G1 connectionStats.ts missing");
need(existsSync(join(SRC, "components/ConnectionStatsPanel.tsx")), "G1 ConnectionStatsPanel.tsx missing");
{
  const cs = read(join(EA, "electron/connectionStats.ts"));
  need(cs.includes("MAX_ROWS = 200"), "G1 MAX_ROWS cap missing");
  need(cs.includes('setTimeout(() => controller.abort(), 1200)'), "G1 sing-box fetch 1200ms deadline missing");
  need(cs.includes("sleep(1200)"), "G1 xray spawn 1200ms deadline missing");
  need(cs.includes("outbound>>>([^>]+)>>>traffic>>>(uplink|downlink)"), "G1 xray outbound-only counter filter missing");
  need(cs.includes('granularity: "per-connection"') && cs.includes('granularity: "per-outbound"'),
    "G1 granularity honesty missing");
  const panel = read(join(SRC, "components/ConnectionStatsPanel.tsx"));
  need(panel.includes("get_connection_stats"), "G1 panel probe channel missing");
  need(panel.includes("if (!open) return;"), "G1 collapsed=zero-IPC gate missing");
  need(panel.includes("perOutboundNote"), "G1 per-outbound honesty note missing");
  need(panel.includes("none"), "G1 aether-none rendering missing");
}

/* ---------- G2: preload ---------- */
{
  const p = read(join(EA, "electron/preload.ts"));
  const n = p.split('"get_connection_stats"').length - 1;
  need(n === 1, `G2 allowlist must carry get_connection_stats EXACTLY once (found ${n})`);
  need(p.includes("Phase-E1 connection-stats probe"), "G2 docstring note missing");
  // the four routing_ entries stay intact
  for (const ch of ["routing_start", "routing_stop", "routing_status", "routing_repair"])
    need(p.includes(`"${ch}"`), `G2 routing channel ${ch} lost`);
}

/* ---------- G3: ipc.ts ---------- */
{
  const ipc = read(join(EA, "electron/ipc.ts"));
  const n = ipc.split('"get_connection_stats"').length - 1;
  need(n === 1, `G3 get_connection_stats handler must be registered once (found ${n})`);
  need(ipc.includes("getConnectionStats"), "G3 module import missing");
  need(ipc.includes('getActiveCore() === "aether"'), "G3 aether guard missing");
  // byte-pin the WHOLE aggregate handler (must remain identical)
  const AGGREGATE = [
    '  ipcMain.handle(',
    '    "get_xray_traffic",',
    '    async (_e, args: { apiPort?: unknown }): Promise<TrafficStats> => {',
    '      const apiPort = u16Port("apiPort", args?.apiPort);',
    '      // Aether guard (honest limitation): the aether core exposes NO stats',
    '      // API at all (verified against the official binary + --help), so the',
    '      // cumulative-traffic counters answer zeros for an aether connection',
    '      // instead of silently returning another core\'s numbers.',
    '      if (getActiveCore() === "aether") {',
    '        return { uplink: 0, downlink: 0 };',
    '      }',
    '      // Xray → short-lived `xray api statsquery` helper; sing-box → HTTP',
    '      // GET /connections on the clash_api (same 1200 ms deadline, same',
    '      // cumulative-bytes wire semantics).',
    '      return getActiveCore() === "sing-box"',
    '        ? singBoxManager.getTraffic(apiPort)',
    '        : xrayManager.getTraffic(apiPort);',
    '    }',
    '  );',
  ].join("\n");
  need(ipc.includes(AGGREGATE), "G3 aggregate get_xray_traffic body is NOT byte-identical");
  need(ipc.includes('getConnectionStats("sing-box", apiPort, singBoxManager.getClashSecret())'),
    "G3 sing-box secret handoff missing");
  need(ipc.includes('getConnectionStats("xray", apiPort, null)'), "G3 xray routing missing");
}

/* ---------- G4: singbox additive + xray byte-stable ---------- */
{
  const sb = read(join(EA, "electron/singbox.ts"));
  need(sb.includes("getClashSecret(): string | null"), "G4 clash secret accessor missing");
  need(sb.includes("The secret stays INSIDE the main process"), "G4 accessor secrecy note missing");
  const xraySha = sha12(join(EA, "electron/xray.ts"));
  need(xraySha === "d6de236aaee0", `G4 xray.ts must be byte-stable (got ${xraySha})`); // R3 re-point (was 003e729bc9c5): coreCompat two-layer adaptation (task #6)
}

/* ---------- G5: frozen surface sha256 ---------- */
{
  const pins = {
    "electron-app/electron/routingSession.ts": "c98b1e9efc6a", // R3 re-point (was 62701b57ccaf): TUN UAC feedback (user task #2),
    "electron-app/electron/routingHelper.ts": "a2a2780e120c",
    "electron-app/electron/routingManager.ts": "4f22abf34639", // R3 re-point (was 9d8c378cd401): launchFeedback + instant UAC-cancel heal,
    "electron-app/electron/killSwitch.ts": "b6808409e369",
    "electron-app/electron/main.ts": "f919e4b545fd",
    "electron-app/electron/tray.ts": "4d4c9f1820db",
    "electron-app/electron/coreOps.ts": "80469627a24f",
    "electron-app/electron/cores.ts": "682365efeef1",
    "src/components/ConnectionManager.tsx": "468ea05fa940",
    "src/store.ts": "d30f8113e142", // R3 re-point (was 92f98fc76349): identity dedupe (task #5) + tun conn mode, // E2 re-point (was fabf109a55cf at E1): additive
    // shadowtls parser changes per the approved E2 design — the sanctioned
    // B2-era re-point class; E2 quickcheck re-pins the new sha plus all
    // remaining frozen surfaces.
    "src/utils/tauriBridge.ts": "a7fae6c8c069", // R3 re-point (was 6858c6190154): onMainEvent progress bridge,
    "src/components/TrafficChart.tsx": "86c151694381",
  };
  for (const [rel, want] of Object.entries(pins)) {
    const got = sha12(join(ROOT, rel));
    need(got === want, `G5 frozen file changed: ${rel} (${got} != ${want})`);
  }
}

/* ---------- G6: renderer pins ---------- */
{
  const ct = read(join(SRC, "components/ConnectionTab.tsx"));
  need(ct.includes('import ConnectionStatsPanel from "./ConnectionStatsPanel";'), "G6 panel import missing");
  need(ct.includes('{status === "connected" && <ConnectionStatsPanel language={language} />}'),
    "G6 panel mount missing / wrong condition");
  const i18n = read(join(SRC, "i18n.ts"));
  for (const k of ["connections.title", "connections.show", "connections.hide", "connections.live",
    "connections.destination", "connections.network", "connections.down", "connections.up",
    "connections.empty", "connections.none", "connections.perOutboundNote", "connections.more"]) {
    const n = i18n.split(`"${k}"`).length - 1;
    need(n === 4, `G6 i18n key ${k} must appear 4x (found ${n})`);
  }
  const mock = read(join(SRC, "electron-mock.ts"));
  need(mock.includes("get_connection_stats"), "G6 mock handler missing");
  need(mock.includes('granularity: "per-connection"') && mock.includes('granularity: "per-outbound"'),
    "G6 mock granularity honesty missing");
}

/* ---------- G7: doc pins ---------- */
{
  const readme = read(join(EA, "README.md"));
  need(readme.includes("## Phase E — Batch E1 (live per-connection stats"), "G7 README Batch-E1 section missing");
  need(readme.includes("~~E1~~ — **DONE at this batch**"), "G7 README register update missing");
  const cl = read(join(EA, "TESTING-CHECKLIST.md"));
  need(cl.includes("## 34. Phase E — Batch E1"), "G7 TESTING-CHECKLIST §34 missing");
}

/* ---------- G8: LIVE probe re-run ---------- */
{
  console.log("G8 running live probe (pinned cores, ~10 s)…");
  try {
    execFileSync("node", [join(ROOT, "scripts", "taskE1-probe.mjs")], { stdio: "pipe", timeout: 60000 });
    const probe = JSON.parse(read(join(ROOT, "..", "scripts", "taskE1-live-tmp", "probe-e1.json")));
    const p1 = probe.P1_singbox_connections;
    need(p1.httpStatus === 200, "G8 P1 /connections not 200");
    for (const k of ["connections", "downloadTotal", "memory", "uploadTotal"])
      need(p1.topKeys.includes(k), `G8 P1 top key ${k} missing`);
    need(typeof p1.totals.uploadTotal === "number" && typeof p1.totals.downloadTotal === "number",
      "G8 P1 totals missing");
    const p2 = probe.P2_xray_statsquery;
    need(p2.hasPerConnectionCounter === false, "G8 P2 granularity changed??");
    need(p2.counters.every((c) => /^outbound>>>[^>]+>>>traffic>>>(uplink|downlink)$/.test(c.name)),
      "G8 P2 counters are not purely per-outbound");
  } catch (e) {
    fail(`G8 live probe failed: ${e.message}`);
  }
}

if (failed > 0) {
  console.error(`\ntaskE1-quickcheck: ${passed} PASS / ${failed} FAIL`);
  process.exit(1);
}
console.log(`taskE1-quickcheck: ${passed} PASS / 0 FAIL (G1-G8)`);
