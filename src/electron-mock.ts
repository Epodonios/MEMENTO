/**
 * electron-mock.ts — BROWSER-PREVIEW SIMULATOR for the MEMENTO desktop shell.
 *
 * This module exists ONLY so the React frontend can be exercised inside a
 * plain web browser (live preview / UI walkthrough) without the real
 * Electron main process. It fabricates `window.electronAPI` — the exact
 * surface preload.ts exposes — and simulates the 11 xray IPC commands plus
 * the window controls, with the same quirks as the real backend:
 *
 *   - get_xray_status hardcodes socks 10808 / http 10809 while running
 *   - logs are a 300-line ring buffer, newest last
 *   - traffic is CUMULATIVE bytes since process start (xray stats API)
 *   - start_xray returns { running, pid, socks_port, http_port }
 *   - stop_xray / clear_system_proxy are best-effort void calls
 *
 * It is a strict NO-OP inside the real desktop shells:
 *   - Electron: preload.ts already installed window.electronAPI before
 *     this module loads, so the install guard sees it and bails.
 *   - Tauri:    window.__TAURI_INTERNALS__ exists, so the guard bails.
 * Shipping it inside the Electron bundle is therefore harmless.
 */

import type { ParsedConfig } from "./store";

/* ------------------------------------------------------------------ */
/*  Environment guard                                                  */
/* ------------------------------------------------------------------ */

const w = window as any;

function inPlainBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    !("__TAURI_INTERNALS__" in w) &&
    typeof w.electronAPI !== "object"
  );
}

if (inPlainBrowser()) {
  seedDemoData();
  installMock();
  // eslint-disable-next-line no-console
  console.info(
    "%c MEMENTO %c browser-preview mock active — Electron IPC is simulated (no real xray-core)",
    "background:#10b981;color:#000;font-weight:bold;border-radius:2px;padding:1px 4px",
    "color:#10b981",
  );
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* ------------------------------------------------------------------ */
/*  Demo data — seeded into localStorage on first visit only           */
/* ------------------------------------------------------------------ */

function makeVmessRaw(fields: Record<string, string>): string {
  return "vmess://" + btoa(JSON.stringify(fields));
}

function demoConfigs(): ParsedConfig[] {
  const de = makeVmessRaw({
    v: "2", ps: "Demo Frankfurt VMess WS-TLS",
    add: "de-01.demo.memento.app", port: "443",
    id: "b831381d-6324-4d53-ad4f-8cda48b30811", aid: "0",
    net: "ws", type: "none", host: "de-01.demo.memento.app",
    path: "/memento", tls: "tls", scy: "auto",
  });
  const ae = makeVmessRaw({
    v: "2", ps: "Demo Dubai VMess WS",
    add: "ae-01.demo.memento.app", port: "2052",
    id: "9c50c339-7cb1-4d2c-9e1a-5f1e63a90244", aid: "0",
    net: "ws", type: "none", host: "ae-01.demo.memento.app",
    path: "/memento", tls: "", scy: "auto",
  });

  return [
    {
      id: "demo-de-vmess", protocol: "vmess",
      name: "Demo ▸ Frankfurt — VMess · WS+TLS",
      address: "de-01.demo.memento.app", port: 443,
      uuid: "b831381d-6324-4d53-ad4f-8cda48b30811",
      security: "auto", encryption: "auto", network: "ws", type: "none",
      host: "de-01.demo.memento.app", path: "/memento",
      sni: "de-01.demo.memento.app", raw: de, isValid: true,
    },
    {
      id: "demo-nl-vless-reality", protocol: "vless",
      name: "Demo ▸ Amsterdam — VLESS · Reality",
      address: "nl-01.demo.memento.app", port: 443,
      uuid: "f3cc3e3a-2f56-4a3e-9a2e-8d0f5a77c1b9",
      encryption: "none", security: "reality", network: "tcp", type: "tcp",
      sni: "www.microsoft.com", flow: "xtls-rprx-vision", fingerprint: "chrome",
      publicKey: "SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc", shortId: "9d8f2a",
      raw: "vless://f3cc3e3a-2f56-4a3e-9a2e-8d0f5a77c1b9@nl-01.demo.memento.app:443?type=tcp&security=reality&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc&sid=9d8f2a&sni=www.microsoft.com&fp=chrome&flow=xtls-rprx-vision#Demo%20%E2%96%B8%20Amsterdam%20%E2%80%94%20VLESS%20%C2%B7%20Reality",
      isValid: true,
    },
    {
      id: "demo-sg-trojan", protocol: "trojan",
      name: "Demo ▸ Singapore — Trojan · TLS",
      address: "sg-01.demo.memento.app", port: 443,
      password: "memento-demo-password",
      security: "tls", network: "tcp", type: "none",
      sni: "sg-01.demo.memento.app",
      raw: "trojan://memento-demo-password@sg-01.demo.memento.app:443?security=tls&type=tcp&sni=sg-01.demo.memento.app#Demo%20%E2%96%B8%20Singapore%20%E2%80%94%20Trojan%20%C2%B7%20TLS",
      isValid: true,
    },
    {
      id: "demo-jp-ss", protocol: "ss",
      name: "Demo ▸ Tokyo — Shadowsocks",
      address: "jp-01.demo.memento.app", port: 8388,
      method: "aes-256-gcm", password: "memento-demo-pass",
      raw: "ss://" + btoa("aes-256-gcm:memento-demo-pass") + "@jp-01.demo.memento.app:8388#Demo%20Tokyo%20Shadowsocks",
      isValid: true,
    },
    {
      id: "demo-tr-hy2", protocol: "hysteria2",
      name: "Demo ▸ Istanbul — Hysteria2",
      address: "tr-01.demo.memento.app", port: 443,
      password: "memento-demo-hy2",
      sni: "cdn.demo.memento.app", type: "hysteria2",
      raw: "hysteria2://memento-demo-hy2@tr-01.demo.memento.app:443?sni=cdn.demo.memento.app#Demo%20%E2%96%B8%20Istanbul%20%E2%80%94%20Hysteria2",
      isValid: true,
    },
    {
      id: "demo-ch-tuic", protocol: "tuic",
      name: "Demo ▸ Zurich — TUIC",
      address: "ch-01.demo.memento.app", port: 443,
      uuid: "5f7c2b90-3a1e-4b6f-8e2d-0c9a7d4f1e83",
      password: "memento-demo-tuic",
      sni: "ch-01.demo.memento.app", type: "bbr",
      raw: "tuic://5f7c2b90-3a1e-4b6f-8e2d-0c9a7d4f1e83:memento-demo-tuic@ch-01.demo.memento.app:443?congestion_control=bbr&udp_relay_mode=native&sni=ch-01.demo.memento.app#Demo%20%E2%96%B8%20Zurich%20%E2%80%94%20TUIC",
      isValid: true,
    },
    {
      // Task E2: the MEMENTO ShadowTLS pair (shadowtls transport + inner
      // trojan). The scheme is PROPRIETARY — the Import tab carries the
      // honest non-standard disclosure (import.stlsNote, 4 languages).
      id: "demo-de-stls", protocol: "shadowtls",
      name: "Demo ▸ Frankfurt — MEMENTO ShadowTLS",
      address: "de-01.demo.memento.app", port: 443,
      password: "memento-demo-trojan",
      stlsVersion: "3", stlsPassword: "memento-demo-stls",
      sni: "cdn.demo.memento.app", type: "shadowtls",
      raw: "memento-stls://memento-demo-trojan@de-01.demo.memento.app:443?version=3&stls-password=memento-demo-stls&sni=cdn.demo.memento.app#Demo%20%E2%96%B8%20Frankfurt%20%E2%80%94%20MEMENTO%20ShadowTLS",
      isValid: true,
    },
    {
      id: "demo-ae-vmess", protocol: "vmess",
      name: "Demo ▸ Dubai — VMess · WS",
      address: "ae-01.demo.memento.app", port: 2052,
      uuid: "9c50c339-7cb1-4d2c-9e1a-5f1e63a90244",
      security: "auto", encryption: "auto", network: "ws", type: "none",
      host: "ae-01.demo.memento.app", path: "/memento",
      raw: ae, isValid: true,
    },
    {
      id: "demo-uk-vless-ws", protocol: "vless",
      name: "Demo ▸ London — VLESS · WS+TLS",
      address: "uk-01.demo.memento.app", port: 443,
      uuid: "c17d4a8e-93b0-4f5c-b6a1-2e8d9f0a3b47",
      encryption: "none", security: "tls", network: "ws", type: "ws",
      host: "uk-01.demo.memento.app", path: "/memento",
      sni: "uk-01.demo.memento.app",
      raw: "vless://c17d4a8e-93b0-4f5c-b6a1-2e8d9f0a3b47@uk-01.demo.memento.app:443?type=ws&security=tls&host=uk-01.demo.memento.app&path=%2Fmemento#Demo%20%E2%96%B8%20London%20%E2%80%94%20VLESS%20%C2%B7%20WS%2BTLS",
      isValid: true,
    },
  ];
}

function seedDemoData(): void {
  try {
    if (localStorage.getItem("memento-configs")) return;
    const configs = demoConfigs();
    localStorage.setItem("memento-configs", JSON.stringify(configs));
    if (!localStorage.getItem("memento-subscription-groups")) {
      localStorage.setItem(
        "memento-subscription-groups",
        JSON.stringify([{
          id: "demo-group",
          name: "Demo Servers",
          autoUpdate: false,
          configIds: configs.map(c => c.id),
        }]),
      );
    }
  } catch {
    /* storage unavailable — preview still works, just without demo data */
  }
}

/* ------------------------------------------------------------------ */
/*  Xray-core simulator                                                */
/* ------------------------------------------------------------------ */

const XRAY_PATH = "C:\\Users\\demo\\AppData\\Roaming\\com.epodonios.memento\\resources\\xray\\xray.exe";
const SING_BOX_PATH = "C:\\Users\\demo\\AppData\\Roaming\\com.epodonios.memento\\resources\\sing-box\\sing-box.exe";

const sim = {
  installed: true,
  running: false,
  pid: null as number | null,
  startedAt: 0,
  // Task 11: the simulated core (xray | sing-box | null) — parity with the
  // real backend, which reports the attempted core in lifecycle responses.
  core: null as "xray" | "sing-box" | null,
  logs: [] as string[],
  uplink: 0,
  downlink: 0,
  proxyActive: false,
  proxyPort: 0,
  tickers: [] as ReturnType<typeof setInterval>[],
};

function pushLog(line: string): void {
  sim.logs.push(line);
  if (sim.logs.length > 300) sim.logs.splice(0, sim.logs.length - 300); // ring buffer, like the backend
}

/* ---------------- Task 12: Aether simulator state ---------------- */

const mockAether = {
  running: false,
  pid: null as number | null,
  logs: [] as string[],
  status: {
    running: false, pid: null as number | null, socks_port: 0, http_port: 0,
    core: "aether" as const, ready: false, smart: false,
    candidate: null as string | null, candidateIndex: 0, candidateTotal: 0,
  },
  tickers: [] as ReturnType<typeof setInterval>[],
};

function pushAetherLog(line: string): void {
  mockAether.logs.push(line);
  if (mockAether.logs.length > 300) mockAether.logs.splice(0, mockAether.logs.length - 300);
}

function startAetherTickers(): void {
  const sites = ["www.google.com:443", "api.telegram.org:443", "github.com:443", "cloudflare.com:443"];
  let i = 0;
  const logTick = setInterval(() => {
    pushAetherLog(`[INFO] tunneling request to tcp:${sites[i++ % sites.length]} via WARP`);
  }, 3000);
  mockAether.tickers.push(logTick);
}

function stopAetherTickers(): void {
  mockAether.tickers.forEach(clearInterval);
  mockAether.tickers = [];
}

function startTickers(host: string): void {
  const sites = [
    "www.google.com:443", "api.telegram.org:443", "www.youtube.com:443",
    "github.com:443", "cloudflare-dns.com:443", "x.com:443",
    "www.reddit.com:443", "duckduckgo.com:443", "updates.memento.app:443",
  ];
  let i = 0;
  const logTick = setInterval(() => {
    const site = sites[i++ % sites.length];
    if (Math.random() < 0.08) {
      pushLog(`[WARNING] core: dial tcp:${site} — connection reset by peer, retrying`);
    } else {
      pushLog(`[INFO] proxy/outbound: tunneling request to tcp:${site} via ${host}`);
    }
  }, 2800);
  const trafficTick = setInterval(() => {
    sim.downlink += 60_000 + Math.floor(Math.random() * 2_400_000);
    sim.uplink += 8_000 + Math.floor(Math.random() * 400_000);
  }, 2000);
  sim.tickers.push(logTick, trafficTick);
}

function stopTickers(): void {
  sim.tickers.forEach(clearInterval);
  sim.tickers = [];
}

/* ------------------------------------------------------------------ */
/*  Main->renderer event bus (scanner / update-center progress)        */
/* ------------------------------------------------------------------ */

type MainEventCb = (payload: unknown) => void;
const mainEventBus = new Map<string, Set<MainEventCb>>();
let scannerStopped = false;

function emitMain(channel: string, payload: unknown): void {
  const subs = mainEventBus.get(channel);
  if (subs) for (const cb of [...subs]) {
    try { cb(payload); } catch { /* a broken sink never breaks the bus */ }
  }
}

/* taskF3: mutable update-center state so a simulated Check is reflected
 * by the next update_center_list (parity with the real main process). */
const mockUpdateState: Array<{
  core: "xray" | "sing-box";
  binFound: boolean;
  binPath: string;
  installedVersion: string;
  source: "bundled";
  lastCheckedAt: string | null;
  latestVersion: string | null;
  assetUrl: string | null;
  assetSize: number | null;
  lastPhase: string;
  lastDetail: string | null;
  canRollback: boolean;
}> = [
  {
    core: "xray", binFound: true, binPath: XRAY_PATH, installedVersion: "25.1.1",
    source: "bundled", lastCheckedAt: null, latestVersion: null, assetUrl: null,
    assetSize: null, lastPhase: "idle", lastDetail: null, canRollback: false,
  },
  {
    core: "sing-box", binFound: true, binPath: SING_BOX_PATH, installedVersion: "1.14.0",
    source: "bundled", lastCheckedAt: null, latestVersion: null, assetUrl: null,
    assetSize: null, lastPhase: "idle", lastDetail: null, canRollback: false,
  },
];
const mockUpdateEntries = () => mockUpdateState.map((e) => ({ ...e }));

/* H-c: the simulated MHRV engine state (config mirror + log ring). */
const mockMhrv = {
  cfg: {
    mode: "apps_script" as "apps_script" | "direct",
    scriptIds: [] as string[],
    authKey: "",
    cfwWorkerUrl: "",
    googleIp: "216.239.38.120",
    frontDomain: "www.google.com",
    frontDomains: [
      "www.google.com", "www.google.ad", "www.google.ae", "www.google.com.af",
      "www.google.com.ag", "www.google.com.ai", "www.google.al", "www.google.am",
      "www.google.co.ao", "www.google.com.ar", "www.google.as", "www.google.at",
      "www.google.com.au", "www.google.az", "www.google.ba", "www.google.com.bd",
    ] as string[],
    sniPool: [
      "www.google.com", "script.google.com", "www.googleapis.com", "www.gstatic.com",
      "ssl.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com",
      "translate.google.com", "maps.google.com", "play.google.com",
      "docs.google.com", "mail.google.com", "drive.google.com",
    ] as string[],
    listenPort: 8085,
    socksPort: 8086,
    verifySsl: true,
    googleIpValidation: true,
    maxIpsToScan: 128,
    scanBatchSize: 32,
    parallelConcurrency: 8,
    shareLan: false,
    upstreamSocks5: "",
    parallelDispatch: 0,
    logLevel: "info" as "error" | "warn" | "info" | "debug",
    showAuthKey: false,
    normalizeXTwitter: false,
    youtubeThroughRelay: false,
    blockQuic: true,
    blockStun: false,
  },
  running: false,
  startedAt: 0,
  relayed: 0,
  fronted: 0,
  caReady: false,
  lastError: null as string | null,
  logs: [] as Array<{ ts: number; level: "error" | "warn" | "info" | "debug"; text: string }>,
};

function mockMhrvLog(level: "error" | "warn" | "info" | "debug", text: string): void {
  mockMhrv.logs.push({ ts: Date.now(), level, text });
  if (mockMhrv.logs.length > 500) mockMhrv.logs.splice(0, mockMhrv.logs.length - 500);
}

/* ------------- R3 #4 + H-d: Live Connection (simulated) -------------
 * The browser has no netstat/tasklist and no OS socket table. The preview
 * fabricates a small plausible snapshot (fixed demo apps + fixed local
 * ports) and — through get_connection_stats — per-connection rows whose
 * metadata.sourcePort values MATCH those sockets and whose cumulative
 * byte counters GROW on every poll, so the LiveConnTab's per-app
 * attribution join (sourcePort <-> localPort), delta math and EMA speeds
 * are fully exercisable in a plain browser.
 * Honesty gates kept: with no core running the stats surface answers
 * "none" exactly like the real backend, and the xray branch keeps its
 * per-outbound (tunnel-level) granularity. */

interface MockLiveSocket {
  proto: "tcp" | "udp";
  localAddr: string;
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  state: string;
}
interface MockLiveAppSpec {
  app: string;
  pid: number;
  sockets: MockLiveSocket[];
}

const MOCK_LIVE_APPS: MockLiveAppSpec[] = [
  {
    app: "chrome.exe", pid: 8712,
    sockets: [
      { proto: "tcp", localAddr: "127.0.0.1", localPort: 51422, remoteAddr: "127.0.0.1", remotePort: 10808, state: "ESTABLISHED" },
      { proto: "tcp", localAddr: "127.0.0.1", localPort: 51423, remoteAddr: "127.0.0.1", remotePort: 10808, state: "ESTABLISHED" },
      { proto: "udp", localAddr: "127.0.0.1", localPort: 51424, remoteAddr: "8.8.8.8", remotePort: 53, state: "" },
    ],
  },
  {
    app: "Telegram.exe", pid: 9164,
    sockets: [
      { proto: "tcp", localAddr: "127.0.0.1", localPort: 51788, remoteAddr: "127.0.0.1", remotePort: 10808, state: "ESTABLISHED" },
      { proto: "udp", localAddr: "192.168.1.42", localPort: 51789, remoteAddr: "149.154.167.51", remotePort: 443, state: "" },
    ],
  },
  {
    app: "spotify.exe", pid: 7340,
    sockets: [
      { proto: "tcp", localAddr: "127.0.0.1", localPort: 52010, remoteAddr: "127.0.0.1", remotePort: 10808, state: "ESTABLISHED" },
    ],
  },
  {
    app: "steam.exe", pid: 5521,
    sockets: [
      { proto: "tcp", localAddr: "127.0.0.1", localPort: 53044, remoteAddr: "127.0.0.1", remotePort: 10808, state: "ESTABLISHED" },
      { proto: "tcp", localAddr: "192.168.1.42", localPort: 53045, remoteAddr: "162.254.196.84", remotePort: 27017, state: "ESTABLISHED" },
    ],
  },
  {
    app: "svchost.exe", pid: 2210,
    sockets: [
      { proto: "udp", localAddr: "127.0.0.1", localPort: 53101, remoteAddr: "1.1.1.1", remotePort: 53, state: "" },
      { proto: "udp", localAddr: "192.168.1.42", localPort: 53530, remoteAddr: "239.255.255.250", remotePort: 1900, state: "" },
      { proto: "tcp", localAddr: "0.0.0.0", localPort: 49152, remoteAddr: "0.0.0.0", remotePort: 0, state: "LISTENING" },
    ],
  },
  {
    // the honest OS idle placeholder (isSystem -> hidden by the system filter)
    app: "System", pid: 0,
    sockets: [
      { proto: "udp", localAddr: "0.0.0.0", localPort: 5353, remoteAddr: "*", remotePort: 0, state: "" },
    ],
  },
];

function mockLiveSnapshot(): unknown {
  const rows: Array<MockLiveSocket & { pid: number; app: string }> = [];
  const appsByKey = new Map<string, {
    app: string; pid: number; total: number; established: number;
    listening: number; udp: number; remoteTargets: string[]; isSystem: boolean;
  }>();
  for (const spec of MOCK_LIVE_APPS) {
    for (const s of spec.sockets) {
      const row = { ...s, pid: spec.pid, app: spec.app };
      rows.push(row);
      const key = `${spec.pid}|${spec.app}`;
      let a = appsByKey.get(key);
      if (!a) {
        a = { app: spec.app, pid: spec.pid, total: 0, established: 0, listening: 0, udp: 0, remoteTargets: [], isSystem: spec.pid === 0 };
        appsByKey.set(key, a);
      }
      a.total++;
      if (s.proto === "udp") a.udp++;
      if (s.state === "ESTABLISHED") a.established++;
      if (s.state === "LISTENING") a.listening++;
      if (s.remoteAddr && s.remoteAddr !== "*" && s.remoteAddr !== "0.0.0.0") {
        const t = `${s.remoteAddr}${s.remotePort ? ":" + s.remotePort : ""}`;
        if (!a.remoteTargets.includes(t) && a.remoteTargets.length < 24) a.remoteTargets.push(t);
      }
    }
  }
  const apps = [...appsByKey.values()].sort((x, y) => y.established - x.established || y.total - x.total);
  return {
    atMs: Date.now(),
    platform: "win32",
    rows,
    apps,
    totals: {
      tcp: rows.filter((r) => r.proto === "tcp").length,
      udp: rows.filter((r) => r.proto === "udp").length,
      established: rows.filter((r) => r.state === "ESTABLISHED").length,
      apps: apps.length,
    },
  };
}

/** Per-connection CUMULATIVE counters — the same contract the real
 * clash_api /connections endpoint reports, so the tab's delta math is
 * exercised against genuine cumulative-then-growing numbers. */
interface MockLiveConn {
  id: string;
  label: string;
  network: "tcp" | "udp";
  sourceIp: string;
  sourcePort: number;
  down: number;
  up: number;
  rateD: number;
  rateU: number;
  startAt: number;
  lastAt: number;
  bursty: boolean;
}

let mockLiveConns: MockLiveConn[] | null = null;

function ensureMockLiveConns(): MockLiveConn[] {
  if (mockLiveConns) return mockLiveConns;
  const now = Date.now();
  const mk = (n: number, label: string, network: "tcp" | "udp", sourceIp: string, sourcePort: number,
    seedDown: number, seedUp: number, rateD: number, rateU: number, bursty = false): MockLiveConn => ({
    id: `c1f0a2ee-${String(n).padStart(4, "0")}-4a1a-9e1e-5300000000${String(n).padStart(2, "0")}`,
    label, network, sourceIp, sourcePort,
    down: seedDown, up: seedUp, rateD, rateU,
    startAt: now - 47_000, lastAt: now, bursty,
  });
  mockLiveConns = [
    mk(1, "www.youtube.com:443", "tcp", "127.0.0.1", 51422, 187_500_000, 24_800_000, 920_000, 118_000),
    mk(2, "clients4.google.com:443", "tcp", "127.0.0.1", 51423, 38_400_000, 6_100_000, 175_000, 62_000),
    mk(3, "api.telegram.org:443", "tcp", "127.0.0.1", 51788, 22_900_000, 11_200_000, 68_000, 34_000),
    mk(4, "149.154.167.51:443", "udp", "192.168.1.42", 51789, 6_300_000, 5_900_000, 24_000, 28_000),
    mk(5, "audio-fa.scdn.co:443", "tcp", "127.0.0.1", 52010, 52_700_000, 4_300_000, 185_000, 11_000),
    mk(6, "store.steampowered.com:443", "tcp", "127.0.0.1", 53044, 9_800_000, 2_700_000, 55_000, 18_000, true),
    mk(7, "1.1.1.1:53", "udp", "127.0.0.1", 53101, 740_000, 96_000, 4_200, 900),
  ];
  return mockLiveConns;
}


/*  IPC command handlers (exact Tauri command names)                   */
/* ------------------------------------------------------------------ */

const handlers: Record<string, (args: any) => Promise<unknown>> = {
  check_xray: async () => {
    await sleep(120);
    return { installed: sim.installed, path: XRAY_PATH, version: "v25.1.1" };
  },

  download_xray: async () => {
    await sleep(400);
    sim.installed = true;
    return { installed: true, path: XRAY_PATH };
  },

  start_xray: async (args: any) => {
    const socksPort = Number(args?.socksPort) || 10808;
    const httpPort = Number(args?.httpPort) || 10809;
    const apiPort = Number(args?.apiPort) || 0;

    // Task 11 parity: the REAL backend detects the core from the config
    // JSON (any hysteria2/tuic outbound -> sing-box).
    let core: "xray" | "sing-box" = "xray";
    try {
      const cfg = JSON.parse(String(args?.configJson || "{}"));
      const obs = Array.isArray(cfg?.outbounds) ? cfg.outbounds : [];
      if (obs.some((o: any) => o?.type === "hysteria2" || o?.type === "tuic")) {
        core = "sing-box";
      }
    } catch { /* default xray */ }

    if (sim.running) {
      pushLog(`[MEMENTO] previous core instance terminated (pid ${sim.pid})`);
      stopTickers();
    }

    await sleep(260); // feel the "connecting" state
    sim.pid = 4000 + Math.floor(Math.random() * 4000);
    sim.running = true;
    sim.core = core;
    sim.startedAt = Date.now();
    sim.uplink = 0;
    sim.downlink = 0;

    // Fresh log buffer per process, mimicking each core's startup output.
    sim.logs = [];
    if (core === "sing-box") {
      pushLog(`[MEMENTO] sing-box v1.14.0 started (pid ${sim.pid})`);
      pushLog("WARN[0000] sing-box v1.14.0 started with "+"1"+" outbound(s)");
      pushLog(`INFO[0000] inbound/socks[socks-in]: tcp listener started at 127.0.0.1:${socksPort}`);
      pushLog(`INFO[0000] inbound/http[http-in]: tcp listener started at 127.0.0.1:${httpPort}`);
      if (apiPort) pushLog(`INFO[0000] experimental/clash_api: listening at 127.0.0.1:${apiPort}`);
      pushLog(`[MEMENTO] startup OK — server ${"demo.memento.app"} (hysteria2/tuic via sing-box)`);
    } else {
      pushLog(`[MEMENTO] xray-core started (pid ${sim.pid})`);
      pushLog("Xray 25.1.1 (V2Fly, a community-driven edition of V2Ray.) Custom (go1.24.5 windows/amd64)");
      pushLog("[INFO] app/stats: counter stats enabled");
      pushLog(`[INFO] inbound/socks[0]: listening on 127.0.0.1:${socksPort}`);
      pushLog(`[INFO] inbound/http[1]: listening on 127.0.0.1:${httpPort}`);
      if (apiPort) pushLog(`[INFO] app/proxyman/inbound: stats API on 127.0.0.1:${apiPort}`);
      pushLog("[MEMENTO] startup OK — geoip.dat / geosite.dat loaded");
    }

    const outboundHost =
      (() => {
        try {
          const cfg = JSON.parse(String(args?.configJson || "{}"));
          return cfg?.outbounds?.[0]?.settings?.vnext?.[0]?.address
            || cfg?.outbounds?.[0]?.settings?.servers?.[0]?.address
            || cfg?.outbounds?.[0]?.server
            || "demo.memento.app";
        } catch { return "demo.memento.app"; }
      })();
    startTickers(outboundHost);

    // Quirk preserved: status reports hardcoded 10808/10809 while running.
    return { running: true, pid: sim.pid, socks_port: 10808, http_port: 10809, core };
  },

  stop_xray: async () => {
    stopTickers();
    if (sim.running) {
      pushLog(sim.core === "sing-box" ? "[MEMENTO] sing-box stopped" : "[MEMENTO] xray-core stopped");
    }
    sim.running = false;
    sim.pid = null;
    sim.core = null;
    return { running: false, pid: null, socks_port: 0, http_port: 0, core: null };
  },

  get_xray_status: async () => {
    if (sim.running) {
      return { running: true, pid: sim.pid, socks_port: 10808, http_port: 10809, core: sim.core };
    }
    return { running: false, pid: null, socks_port: 0, http_port: 0, core: null };
  },

  get_xray_logs: async () => [...sim.logs],

  get_xray_traffic: async () => {
    if (!sim.running) return { uplink: 0, downlink: 0 };
    return { uplink: sim.uplink, downlink: sim.downlink };
  },

  // Phase E1 (additive) + H-d: mock per-connection stats — same granularity
  // honesty as the real backend (sing-box per-connection / xray
  // per-outbound / honest "none" when nothing runs — the mock's aether
  // surface keeps its own state object and never drives sim.running).
  // H-d: the sing-box rows now carry metadata.sourceIp/sourcePort joined to
  // the mock snapshot's local ports and CUMULATIVE counters that grow on
  // every poll, so per-app consumption attribution is demoable in-browser.
  get_connection_stats: async () => {
    if (!sim.running) {
      mockLiveConns = null; // next start = a fresh counting session
      return { core: sim.core ?? "xray", granularity: "none", connections: null, totalLive: 0, totalShown: 0 };
    }
    if (sim.core === "sing-box") {
      const conns = ensureMockLiveConns();
      const now = Date.now();
      // advance the cumulative counters by rate * elapsed (jittered), the
      // exact "cumulative counter" shape the real clash_api reports
      const elapsed = Math.min(15, Math.max(0.5, (now - conns[0].lastAt) / 1000));
      const rows = conns.map((c) => {
        const jitter = 0.35 + Math.random() * 1.3;
        const burst = c.bursty && Math.random() < 0.18 ? 4.2 : 1;
        c.down += Math.round(c.rateD * elapsed * jitter * burst);
        c.up += Math.round(c.rateU * elapsed * jitter * burst);
        c.lastAt = now;
        return {
          id: c.id, label: c.label, network: c.network,
          download: c.down, upload: c.up,
          start: new Date(c.startAt).toISOString(),
          chains: ["proxy"], rule: "final", role: null,
          sourceIp: c.sourceIp, sourcePort: String(c.sourcePort),
        };
      });
      rows.sort((a, b) => b.download - a.download || b.upload - a.upload);
      return { core: "sing-box", granularity: "per-connection", connections: rows, totalLive: rows.length, totalShown: rows.length };
    }
    const mkx = (tag: string, role: string, frac: number) => ({
      id: `outbound:${tag}`, label: tag, network: null,
      download: Math.round(sim.downlink * frac),
      upload: Math.round(sim.uplink * frac),
      start: null, chains: null, rule: null, role,
    });
    const rows = [
      mkx("proxy", "tunnel", 0.94),
      mkx("direct", "direct", 0.05),
      mkx("blocked", "blocked", 0),
    ];
    return { core: "xray", granularity: "per-outbound", connections: rows, totalLive: rows.length, totalShown: rows.length };
  },

  // R3 #4 + H-d (additive): simulated per-app socket snapshot. The demo
  // apps' local ports are the SAME ports the sing-box connection rows
  // above report as sourcePort — that is the join the real tab performs
  // against the OS socket table.
  live_conn_snapshot: async () => mockLiveSnapshot(),

  set_system_proxy: async (args: any) => {
    sim.proxyActive = true;
    sim.proxyPort = Number(args?.socksPort) || 10808;
    // eslint-disable-next-line no-console
    console.info(`[MEMENTO mock] system proxy -> 127.0.0.1:${sim.proxyPort} (registry simulated)`);
  },

  clear_system_proxy: async () => {
    sim.proxyActive = false;
    // eslint-disable-next-line no-console
    console.info("[MEMENTO mock] system proxy cleared (registry simulated)");
  },

  tcp_ping_batch: async (args: any) => {
    const targets: Array<{ id: string; host: string; port: number }> = args?.targets ?? [];
    await sleep(Math.min(220 + targets.length * 1.5, 520));
    return targets.map(t => {
      const h = hashStr(`${t.host}:${t.port}`);
      if (h % 8 === 0) return { id: t.id, ping: null, error: "connection timed out" };
      const base = 18 + (h % 240);
      return { id: t.id, ping: Math.max(8, Math.round(base * (0.9 + Math.random() * 0.25))), error: null };
    });
  },

  launch_spoofing_patt: async () => {
    await sleep(700);
    // eslint-disable-next-line no-console
    console.info("[MEMENTO mock] spoofing-patt launched via PowerShell -Verb RunAs (UAC simulated)");
  },

  /* ------------- Phase D1: net_check (simulated) ----------------
   * Browser preview has no main process, so both probes are simulated.
   * The exit path only reports an IP when the mock core is actually
   * running — mirroring the honest "connection refused" behavior of the
   * real handler against an unlistened port. */
  net_check: async (args: any) => {
    await sleep(900 + Math.floor(Math.random() * 600));
    const mockIps = ["198.51.100.7", "203.0.113.42", "192.0.2.115"];
    const directIp = "89.32.144.201"; // simulated ISP address
    const tunnelUp = sim.running || mockAether.running;
    const exitIp = tunnelUp ? mockIps[Math.floor(Math.random() * mockIps.length)] : null;
    return {
      exit: exitIp
        ? { ok: true, ip: exitIp, loc: ["NL", "DE", "SG"][Math.floor(Math.random() * 3)], warp: mockAether.running ? "on" : "off" }
        : { ok: false, error: `net::ERR_PROXY_CONNECTION_FAILED at 127.0.0.1:${Number(args?.socksPort) || 0} (mock — nothing is listening)` },
      direct: { ok: true, ip: directIp, loc: "IR" },
      dnsServers: ["127.0.0.1", "10.10.34.5"], // simulated OS resolver list
    };
  },

  /* ------------- Phase C2: url_test (simulated) ----------------
   * Browser preview has no core binaries to spawn and no real tunnel,
   * so EVERY probe honestly fails — the mock never invents a latency
   * number. Instance mode also refuses in a browser by construction
   * (isDesktop() gate in urlTest.ts means this is belt-and-braces). */
  url_test: async (args: any) => {
    await sleep(200);
    if (args?.configJson != null) {
      return { ok: false, ms: null, mode: "instance", error: "Desktop only (mock preview)" };
    }
    return {
      ok: false,
      ms: null,
      mode: "tunnel",
      error: `mock preview — nothing is listening on 127.0.0.1:${Number(args?.socksPort) || 0}`,
    };
  },

  /* ------------- Phase C3: geo_status / geo_ensure (simulated) ----------
   * The browser has no filesystem and no dataDir, so the mock reports an
   * all-missing status honestly and every ensure attempt fails with the
   * exact reason — the Routing tab geo card renders these verbatim. */
  geo_status: async () => {
    await sleep(100);
    const missing = { present: false, bytes: 0 };
    return {
      xrayDir: "(browser preview — no data dir)",
      xray: { "geoip.dat": missing, "geosite.dat": missing },
      srsDir: "(browser preview — no data dir)",
      srs: {
        "geosite-ir.srs": missing,
        "geoip-ir.srs": missing,
        "geosite-category-ads-all.srs": missing,
      },
    };
  },
  geo_ensure: async () => {
    await sleep(150);
    const missing = { present: false, bytes: 0 };
    return {
      status: {
        xrayDir: "(browser preview — no data dir)",
        xray: { "geoip.dat": missing, "geosite.dat": missing },
        srsDir: "(browser preview — no data dir)",
        srs: {
          "geosite-ir.srs": missing,
          "geoip-ir.srs": missing,
          "geosite-category-ads-all.srs": missing,
        },
      },
      errors: { _: "Desktop only (mock preview) — geo files live next to the cores" },
    };
  },

  /* ------------- Phase D3/D4: app prefs (simulated) ----------------
   * Browser preview has no OS: autostart is unsupported, hotkeys can't
   * really register, there is no tray. The mock echoes a stable state so
   * the Settings page is fully explorable in the preview. */
  app_prefs_get: async () => {
    return {
      hotkeyShowHide: true,
      hotkeyConnect: true,
      hotkeysActive: { showHide: false, connect: false },
      autostartSupported: false,
      autostartEnabled: false,
      closeToTray: true,
      closeTrayToastShown: false,
      language: "en",
      testUrl: "https://www.gstatic.com/generate_204",
      killSwitch: false, // Phase C5: the mock mirrors the real default (opt-in, off)
    };
  },

  app_prefs_set: async (args: any) => {
    await sleep(120);
    // Same field discipline as the real sanitizePrefsPatch: booleans, a
    // known language code + a well-formed test URL only; everything else
    // is ignored. An invalid testUrl is dropped (previous value survives).
    const lang = ["en", "fa", "zh", "ar"].includes(args?.patch?.language)
      ? args.patch.language : "en";
    let testUrl = "https://www.gstatic.com/generate_204";
    if (typeof args?.patch?.testUrl === "string") {
      const s = args.patch.testUrl.trim();
      if (s && s.length <= 500 && !/\s/.test(s)) {
        try {
          const u = new URL(s);
          if (u.protocol === "http:" || u.protocol === "https:") testUrl = s;
        } catch { /* invalid -> keep default */ }
      }
    }
    // Phase C5: echo a real boolean only (same discipline as the real
    // sanitizer). NO fake enforcement is claimed — there is no OS proxy
    // in a browser; the store mirror + banner are fully explorable, the
    // registry contract is not.
    const killSwitch = typeof args?.patch?.killSwitch === "boolean"
      ? args.patch.killSwitch : false;
    return {
      hotkeyShowHide: args?.patch?.hotkeyShowHide !== false,
      hotkeyConnect: args?.patch?.hotkeyConnect !== false,
      hotkeysActive: { showHide: false, connect: false },
      autostartSupported: false,
      autostartEnabled: false,
      closeToTray: args?.patch?.closeToTray !== false,
      closeTrayToastShown: false,
      language: lang,
      testUrl,
      killSwitch,
    };
  },

  autostart_set: async (args: any) => {
    await sleep(120);
    return { autostartSupported: false, autostartEnabled: args?.enabled === true };
  },

  // Phase D4: status push — nothing to update in a browser (no tray),
  // acknowledged so the fire-and-forget call resolves cleanly.
  tray_status_set: async (args: any) => {
    return { connected: args?.connected === true };
  },

  /* ---------------- Task 12: Aether (simulated) ---------------- */

  aether_start: async (args: any) => {
    const s = args?.settings ?? {};
    const protocol = String(s.protocol || "masque");
    const socksPort = Number(s.socksPort) || 1819;
    const httpProxyPort = s.httpProxyEnabled ? Number(s.httpProxyPort) || 1820 : 0;
    const smart = protocol === "smart";
    const candidates = smart ? ["gool", "wg", "masque"] : [protocol];

    mockAether.logs = [];
    mockAether.running = false;
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      mockAether.status = {
        running: true, pid: mockAether.pid, socks_port: socksPort, http_port: httpProxyPort,
        core: "aether", ready: false, smart, candidate: cand, candidateIndex: i + 1, candidateTotal: candidates.length,
      };
      if (smart) pushAetherLog(`[smart] candidate=${cand} result=pending`);
      pushAetherLog(`[*] hunting for a working ${cand.toUpperCase()} gateway...`);
      await sleep(700 + Math.floor(Math.random() * 500));
      if (smart) pushAetherLog(`[smart] candidate=${cand} result=accepted selected=true`);
    }
    mockAether.pid = 7000 + Math.floor(Math.random() * 1000);
    mockAether.running = true;
    mockAether.status = {
      running: true, pid: mockAether.pid, socks_port: socksPort, http_port: httpProxyPort,
      core: "aether", ready: true, smart: false, candidate: null, candidateIndex: 0, candidateTotal: 0,
    };
    pushAetherLog(`[MEMENTO] Aether connected via ${candidates[candidates.length - 1]} (mock, socks 127.0.0.1:${socksPort})`);
    startAetherTickers();
    return { ...mockAether.status };
  },

  aether_stop: async () => {
    stopAetherTickers();
    if (mockAether.running) pushAetherLog("[MEMENTO] Aether stopped");
    mockAether.running = false;
    mockAether.pid = null;
    mockAether.status = {
      running: false, pid: null, socks_port: 0, http_port: 0,
      core: "aether", ready: false, smart: false, candidate: null, candidateIndex: 0, candidateTotal: 0,
    };
    return { ...mockAether.status };
  },

  aether_status: async () => ({ ...mockAether.status }),

  aether_logs: async () => [...mockAether.logs],

  /* ---------------- Phase C6: updates (honest mirror) ----------------
   * A browser has no pin table and no update service — the mock reports
   * the honest static shape (bundled pin, nothing running, nothing to
   * install) and NEVER fakes a successful download or swap. */

  aether_update_status: async () => ({
    bundledVersion: "1.9.0",
    activeVersion: null,
    activeIdentified: false,
    binaryFound: false,
    isRunning: mockAether.running,
    releasesPage: "https://github.com/CluvexStudio/Aether/releases",
    table: [{ version: "1.9.0", verified: "2026-09-16", installable: false }],
  }),

  aether_update_check: async () => ({
    kind: "error",
    detail: "Browser preview: the Aether update service does not run here.",
  }),

  aether_update_apply: async (args: any) => ({
    reason: "not-pinned",
    version: String(args?.version || ""),
    detail: "Browser preview: nothing can be installed here.",
  }),

  /* ---------------- Phase B2: VPN Device routing (honest mirror) --------
   * A browser has no TUN adapter, no elevated helper and no UAC — the
   * mock reports the honest idle state and refuses every lifecycle
   * action with its real reason. Nothing here fakes a live session. */

  routing_start: async () => {
    throw new Error(
      "VPN Device (TUN) routing requires the Windows desktop app — the MementoTun adapter and the elevated helper do not exist in the browser preview."
    );
  },

  routing_stop: async () => ({
    stopped: false,
    state: "idle",
    reason: "no VPN Device session exists in the browser preview",
  }),

  routing_status: async () => ({
    active: false,
    state: "idle",
    message: "browser preview — no TUN session machinery here",
    enginePid: 0,
    interfaceName: "MementoTun",
    helperRole: "MementoTunHelper",
    killSwitchArmed: false,
    suppressSystemProxy: false,
    sessionDir: null,
    updatedAtMs: null,
  }),

  routing_repair: async () => ({
    launched: false,
    reason: "no VPN Device state to repair (browser preview)",
  }),

  app_update_info: async () => ({
    appVersion: "browser-preview",
    releasesUrl: "https://github.com/epodonios/memento/releases",
    selfUpdate: false,
  }),

  /* ---------------- taskF2: IP Scanner v2 (simulated sweep) ----------
   * A browser cannot open raw TCP sockets, so the preview runs a small
   * SIMULATED sweep: a fixed demo LAN with a router, a NAS, a printer,
   * a Windows box and offline hosts — streamed per-host exactly like the
   * real engine (scanner_host / scanner_progress) so the live UI is
   * fully exercisable. Copy/filter/sort/export behave identically. */

  scanner_local_subnet: async () => ({ cidr: "192.168.1.0/24", ip: "192.168.1.42" }),

  scanner_scan: async (args: any) => {
    const targetText = String(args?.targetText || "");
    const demoHosts: Array<{
      ip: string; hostname: string | null; online: boolean; ms: number | null;
      ports: Array<{ port: number; open: boolean; ms: number | null }>; tags: string[];
      geo: { country: string; countryCode: string; city: string; isp: string; as: string } | null;
    }> = [];
    const mk = (ip: string, hostname: string | null, online: boolean, ms: number | null,
      openPorts: number[], tags: string[],
      geo: { country: string; countryCode: string; city: string; isp: string; as: string } | null) => ({
      ip,
      hostname,
      online,
      ms,
      ports: openPorts.map((p) => ({ port: p, open: true, ms: ms === null ? null : ms + (p % 7) })),
      tags,
      geo,
    });
    const isLan = /192\.168\.1/.test(targetText) || /\//.test(targetText) || /-/.test(targetText);
    if (isLan) {
      demoHosts.push(
        mk("192.168.1.1", "fios-router.home", true, 2, [80, 443, 53], ["web", "dns", "router"],
          { country: "Iran", countryCode: "IR", city: "Tehran", isp: "Home LAN", as: "AS0 Local" }),
        mk("192.168.1.14", "desktop-nr5f221", true, 9, [445, 3389, 139], ["windows"], null),
        mk("192.168.1.23", "nas-rgtr45", true, 6, [22, 445, 5000], ["ssh", "windows"], null),
        mk("192.168.1.31", "hp-printer", true, 34, [80, 9100], ["web"], null),
        mk("192.168.1.42", null, true, 11, [10808, 10809], ["proxy"], null),
        mk("192.168.1.77", null, false, null, [], [], null),
        mk("192.168.1.99", null, false, null, [], [], null)
      );
    } else {
      demoHosts.push(
        mk("127.0.0.1", "localhost", true, 1, [80], ["web"],
          { country: "Local", countryCode: "", city: "", isp: "Loopback", as: "AS0" })
      );
    }
    const total = demoHosts.length;
    emitMain("scanner_progress", { phase: "scanning", scanned: 0, total, online: 0 });
    for (let i = 0; i < total; i++) {
      await sleep(420 + Math.random() * 380);
      if (scannerStopped) {
        scannerStopped = false;
        emitMain("scanner_progress", { phase: "cancelled", scanned: i, total, online: demoHosts.slice(0, i).filter((h) => h.online).length });
        return {
          results: demoHosts.slice(0, i), scanned: i,
          online: demoHosts.slice(0, i).filter((h) => h.online).length,
          elapsedMs: i * 500, cancelled: true,
        };
      }
      emitMain("scanner_host", demoHosts[i]);
      emitMain("scanner_progress", {
        phase: "scanning", scanned: i + 1, total,
        online: demoHosts.slice(0, i + 1).filter((h) => h.online).length,
      });
    }
    const online = demoHosts.filter((h) => h.online).length;
    emitMain("scanner_progress", { phase: "done", scanned: total, total, online });
    return { results: demoHosts, scanned: total, online, elapsedMs: total * 520, cancelled: false };
  },

  scanner_stop: async () => {
    scannerStopped = true;
    return { ok: true };
  },

  /* ------------- taskF3: Update Center (honest mirror) -------------
   * The preview can NEVER download or swap a core — the check simulates
   * the GitHub redirect lookup with the pinned versions, the list
   * reports the simulated bundled binaries. */

  update_center_list: async () => mockUpdateEntries(),

  update_center_check: async (args: any) => {
    await sleep(600);
    const core = args?.core === "sing-box" ? "sing-box" : "xray";
    const latest = core === "xray" ? "v25.1.1" : "v1.14.0";
    const entry = mockUpdateState.find((e) => e.core === core);
    if (entry) {
      entry.latestVersion = latest;
      entry.lastCheckedAt = new Date().toISOString();
    }
    return { latest };
  },

  update_center_download: async () => {
    throw new Error(
      "Browser preview: cores are never downloaded or swapped here — this needs the desktop app."
    );
  },

  update_center_rollback: async () => ({
    ok: false,
    detail: "Browser preview: no .bak exists here.",
  }),

  /* ------------- H-c: MHRV (simulated engine) -----------------
   * The full GOOGLE SIDE tab is explorable in the browser: a config
   * store in localStorage-backed memory, a simulated lifecycle, fake
   * IP/SNI sweeps, an honest relay test (fails without IDs + key like
   * the real engine), a log ring the console can poll, and CA/update
   * results that clearly state they are preview stubs. Nothing here
   * opens real sockets or touches a real certificate store. */

  mhrv_config_get: async () => ({
    ...mockMhrv.cfg,
    authKeySet: !!mockMhrv.cfg.authKey,
    authKey: undefined,
    configPath: "(browser preview)\\mhrv\\config.json",
  }),

  mhrv_config_set: async (args: any) => {
    const allowed = [
      "mode", "scriptIds", "authKey", "cfwWorkerUrl", "googleIp", "frontDomain",
      "frontDomains", "sniPool", "listenPort", "socksPort", "verifySsl",
      "googleIpValidation", "maxIpsToScan", "scanBatchSize", "parallelConcurrency",
      "shareLan", "upstreamSocks5", "parallelDispatch", "logLevel", "showAuthKey",
      "normalizeXTwitter", "youtubeThroughRelay", "blockQuic", "blockStun",
    ];
    for (const k of allowed) {
      if (k in (args ?? {})) (mockMhrv.cfg as any)[k] = args[k];
    }
    // frontDomain must stay a member of the managed list (real sanitizer parity)
    const fd = String(mockMhrv.cfg.frontDomain || "").trim().toLowerCase() || "www.google.com";
    mockMhrv.cfg.frontDomain = fd;
    if (!mockMhrv.cfg.frontDomains.includes(fd)) mockMhrv.cfg.frontDomains.push(fd);
    mockMhrvLog("info", "config saved");
    return { ok: true, config: { ...mockMhrv.cfg, authKeySet: true, authKey: undefined }, note: undefined };
  },

  mhrv_status: async () => ({
    running: mockMhrv.running,
    mode: mockMhrv.cfg.mode,
    httpPort: mockMhrv.cfg.listenPort,
    socksPort: mockMhrv.cfg.socksPort,
    googleIp: mockMhrv.cfg.googleIp,
    frontDomain: mockMhrv.cfg.frontDomain,
    scriptsConfigured: mockMhrv.cfg.scriptIds.length > 0,
    authKeySet: !!mockMhrv.cfg.authKey,
    caReady: mockMhrv.caReady,
    uptimeMs: mockMhrv.running ? Date.now() - mockMhrv.startedAt : 0,
    requestsRelayed: mockMhrv.relayed,
    requestsFronted: mockMhrv.fronted,
    lastError: mockMhrv.lastError,
    shareLan: mockMhrv.cfg.shareLan,
    sniPoolSize: mockMhrv.cfg.sniPool.length,
    frontDomainsCount: mockMhrv.cfg.frontDomains.length,
    upstreamSet: !!mockMhrv.cfg.upstreamSocks5,
    logLevel: mockMhrv.cfg.logLevel,
    deployCount: mockMhrv.cfg.scriptIds.length,
    blockQuic: mockMhrv.cfg.blockQuic,
    blockStun: mockMhrv.cfg.blockStun,
  }),

  mhrv_start: async () => {
    if (mockMhrv.running) throw new Error("MHRV proxy is already running — stop it first.");
    if (mockMhrv.cfg.mode === "apps_script" && (!mockMhrv.cfg.scriptIds.length || !mockMhrv.cfg.authKey)) {
      mockMhrvLog("error", "apps_script mode needs the Deployment ID and the auth key");
      throw new Error("apps_script mode needs the Deployment ID and the auth key — deploy the embedded Code.gs first.");
    }
    await sleep(500);
    mockMhrv.running = true;
    mockMhrv.startedAt = Date.now();
    const bind = mockMhrv.cfg.shareLan ? "0.0.0.0" : "127.0.0.1";
    mockMhrvLog("info", `starting MHRV proxy — mode=${mockMhrv.cfg.mode} http=${bind}:${mockMhrv.cfg.listenPort} socks5=${bind}:${mockMhrv.cfg.socksPort} deployments=${mockMhrv.cfg.scriptIds.length}`);
    if (mockMhrv.cfg.upstreamSocks5) mockMhrvLog("info", `upstream socks5 ${mockMhrv.cfg.upstreamSocks5}`);
    mockMhrv.caReady = true;
    mockMhrvLog("info", `MHRV proxy running — HTTP ${bind}:${mockMhrv.cfg.listenPort} · SOCKS5 ${bind}:${mockMhrv.cfg.socksPort} (browser preview: listeners are simulated)`);
    return { running: true };
  },

  mhrv_stop: async () => {
    mockMhrv.running = false;
    mockMhrvLog("info", "MHRV proxy stopped");
    return { running: false };
  },

  mhrv_scan_ips: async () => {
    mockMhrvLog("info", "Google IP scan started (simulated sweep in the browser preview)");
    await sleep(900);
    const rows = ["216.239.38.120", "216.239.34.120", "142.250.80.142", "172.217.16.142", "34.107.221.82"]
      .map((ip, i) => ({ ip, latencyMs: i === 3 ? null : 45 + i * 37 + Math.floor(Math.random() * 40), error: i === 3 ? "timeout" : null }));
    const ok = rows.filter((r) => r.latencyMs !== null).length;
    mockMhrvLog("info", `Google IP scan finished — ${ok} working IPs (browser-preview fixture)`);
    return { rows, source: "browser-preview fixture (no real probes here)" };
  },

  mhrv_scan_sni: async () => {
    mockMhrvLog("info", "SNI scan started — pool names via google_ip (simulated)");
    await sleep(700);
    const rows = mockMhrv.cfg.sniPool.map((sni, i) => ({
      sni,
      ok: i % 7 !== 3,
      ms: 60 + i * 22,
      note: i % 7 !== 3 ? "reachable via google_ip" : "timeout — possible DPI drop",
    }));
    mockMhrvLog("info", `SNI scan finished — ${rows.filter((r) => r.ok).length}/${rows.length} reachable`);
    return rows;
  },

  mhrv_test_relay: async () => {
    await sleep(600);
    if (mockMhrv.cfg.mode === "direct") {
      mockMhrvLog("info", `direct mode: Google edge probe via ${mockMhrv.cfg.googleIp} (simulated)`);
      return { ok: true, detail: `direct mode: Google edge reachable via ${mockMhrv.cfg.googleIp} (browser preview — simulated probe).` };
    }
    if (!mockMhrv.cfg.scriptIds.length) {
      mockMhrvLog("error", "relay test FAILED: no deployment IDs configured");
      return { ok: false, detail: "Relay failed: no Apps Script deployment IDs configured — paste at least one ID (one per line)." };
    }
    if (!mockMhrv.cfg.authKey) {
      mockMhrvLog("error", "relay test FAILED: auth key missing");
      return { ok: false, detail: "Relay failed: auth_key must be set to a strong secret." };
    }
    // Simulate a failover when the pool has more than one ID — the log
    // line the real engine emits, so the console demonstrates it.
    if (mockMhrv.cfg.scriptIds.length > 1) {
      mockMhrvLog("warn", "deployment #1 failed (simulated) → failover to #2");
      mockMhrvLog("info", "relay recovered on deployment #2 — round-robin pointer moved there");
    }
    mockMhrvLog("info", `relay test OK (${300 + Math.floor(Math.random() * 200)} ms) — exit IP 203.0.113.42 (browser preview)`);
    return { ok: true, detail: "Relay OK (412 ms) — exit IP: 203.0.113.42 (browser preview — simulated round-trip)", ip: "203.0.113.42" };
  },

  mhrv_codegs: async (args: any) => ({
    text:
      "// Browser preview sample — the REAL Code.gs ships embedded in the desktop build.\n" +
      `const AUTH_KEY = "${mockMhrv.cfg.authKey || "CHANGE_ME_TO_A_STRONG_SECRET"}";\n` +
      "function doPost(e) { /* relay {k,m,u,h,b,ct,r} -> {s,h,b} */ }\n",
    source: "Code.gs (browser-preview sample)",
    variant: args?.variant === "cfw" ? "cfw" : "apps_script",
  }),

  mhrv_ca_status: async () => ({ ready: mockMhrv.caReady, certPem: null, certPath: "(browser preview — no CA files)" }),

  mhrv_ca_install: async () => {
    mockMhrv.caReady = true;
    mockMhrvLog("info", "CA installed (browser preview — nothing touched)");
    return { ok: true, detail: "Browser preview: CA state flipped locally — the real certutil store install needs the desktop app." };
  },

  mhrv_ca_remove: async () => {
    mockMhrv.caReady = false;
    mockMhrvLog("info", "CA removed (browser preview — nothing touched)");
    return { ok: true, detail: "Browser preview: CA state reset locally — no real store or files were touched." };
  },

  mhrv_ca_check: async () => ({
    ok: mockMhrv.caReady,
    detail: mockMhrv.caReady
      ? "Browser preview: CA marked as generated (simulated)."
      : "Browser preview: no CA yet — press Install CA (simulated).",
  }),

  mhrv_logs_get: async (args: any) => {
    const rank: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
    const min = rank[args?.level] !== undefined ? rank[args?.level] : 2;
    return mockMhrv.logs.filter((l) => rank[l.level] <= min).slice(-(Number(args?.limit) || 200)).map((l) => ({ ...l }));
  },

  mhrv_logs_clear: async () => {
    mockMhrv.logs = [];
    return { ok: true };
  },

  mhrv_logs_save: async () => ({
    ok: false,
    path: null,
    detail: "Browser preview: the native save dialog needs the desktop app.",
  }),

  mhrv_update_check: async () => ({
    current: "browser-preview",
    latest: null,
    isNewer: false,
    detail: "Browser preview: the GitHub lookup runs in the desktop app.",
  }),
};

/* ------------------------------------------------------------------ */
/*  electronAPI installation (mirrors preload.ts)                      */
/* ------------------------------------------------------------------ */

function installMock(): void {
  let maximized = false;
  const resizeCbs = new Set<() => void>();

  const fireResized = () => resizeCbs.forEach(cb => cb());

  w.electronAPI = {
    isElectron: true,

    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      const h = handlers[cmd];
      if (!h) throw new Error(`Unhandled command: ${cmd}`);
      return h(args ?? {});
    },

    // taskF2/F3: the progress channels (scanner_host, scanner_progress,
    // update_center_progress) ride the same allow-listed names as preload.
    onMainEvent: (channel: string, cb: MainEventCb): (() => void) => {
      const ALLOWED = new Set(["update_center_progress", "scanner_progress", "scanner_host", "mhrv_progress"]);
      if (!ALLOWED.has(channel)) throw new Error(`Event channel not allowed: ${channel}`);
      let subs = mainEventBus.get(channel);
      if (!subs) {
        subs = new Set();
        mainEventBus.set(channel, subs);
      }
      subs.add(cb);
      return () => {
        subs!.delete(cb);
      };
    },

    openExternal: (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return Promise.resolve();
    },

    // Phase D3/D4: browser preview cannot register OS hotkeys or create a
    // tray — the channels exist with the same signatures so App.tsx needs
    // no shell branches.
    app: {
      onHotkeyToggleConnect: (_cb: () => void) => () => {},
      onTrayToggleConnect: (_cb: () => void) => () => {},
    },

    window: {
      minimize: () => {
        // eslint-disable-next-line no-console
        console.info("[MEMENTO mock] window minimize");
      },
      toggleMaximize: async () => {
        maximized = !maximized;
        fireResized();
        return maximized;
      },
      isMaximized: async () => maximized,
      close: () => {
        // eslint-disable-next-line no-console
        console.info("[MEMENTO mock] window close — disabled in browser preview");
      },
      onResized: (cb: () => void) => {
        resizeCbs.add(cb);
        const onWinResize = () => cb();
        window.addEventListener("resize", onWinResize);
        return () => {
          resizeCbs.delete(cb);
          window.removeEventListener("resize", onWinResize);
        };
      },
    },
  };

  w.__MEMENTO_MOCK__ = true;
}

/** Public marker so tests can assert the mock is present. */
export const isBrowserMockInstalled = (): boolean => !!(typeof window !== "undefined" && w.__MEMENTO_MOCK__);
export const mockSessionId = uid();
