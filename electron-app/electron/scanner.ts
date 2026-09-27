/**
 * MEMENTO — the rebuilt IP Scanner engine v2 (taskF2).
 *
 * Modeled on Advanced IP Scanner / Angry IP Scanner, ELECTRON-FREE
 * (node builtins only — the gate scripts exercise it against loopback
 * fixtures):
 *
 *   TARGETS   single IP, CIDR (192.168.1.0/24), dash ranges
 *             (192.168.1.1-192.168.1.254 / 192.168.1.1-254), hostnames,
 *             pasted/imported lists — parsed, expanded, size-capped.
 *   PORTS     preset profiles or a custom list/ranges (parsePorts).
 *   PROBES    TCP connect probe on every (host, port) pair with a bounded
 *             concurrency pool + per-probe timeout; per-host best latency.
 *   STREAM    every finished host is pushed to onHost IMMEDIATELY — the
 *             UI appends live rows while the scan is still running.
 *   TAGS      automatic, deterministic classification from open ports
 *             (web/ssh/windows/db/dev/game/torrent/router/media/mail).
 *   GEO       optional batch geo lookup for ONLINE hosts only
 *             (ip-api.com batch endpoint, 100/req, injectable fetch —
 *             offline = unknown, never blocks the scan).
 *   LOCAL     localSubnet() suggests the LAN /24 from os.networkInterfaces.
 *   CONTROL   progress per host, live cancel (scanner_stop), structured
 *             results for the UI to render/copy/export.
 */
import net from "net";
import dns from "node:dns";
import os from "node:os";

export interface ScanPortResult {
  port: number;
  open: boolean;
  ms: number | null;
}

export interface ScanGeo {
  country: string | null;
  countryCode: string | null;
  city: string | null;
  isp: string | null;
  as: string | null;
}

export interface ScanHostResult {
  ip: string;
  hostname: string | null;
  online: boolean;
  ms: number | null;
  ports: ScanPortResult[];
  tags: string[];
  geo: ScanGeo | null;
}

export interface ScanOptions {
  targetText: string;
  portText: string;
  preset?: string;
  concurrency: number;
  timeoutMs: number;
  reverseDns: boolean;
  geoLookup: boolean;
}

export interface ScanProgressEvent {
  phase: "expanding" | "scanning" | "geo" | "done" | "error" | "cancelled";
  scanned: number;
  total: number;
  online: number;
  detail?: string;
}

export interface ScanOutcome {
  results: ScanHostResult[];
  scanned: number;
  online: number;
  elapsedMs: number;
  cancelled: boolean;
}

/* ------------------------------------------------------------------ */
/* Target expansion                                                    */
/* ------------------------------------------------------------------ */

export const MAX_SCAN_HOSTS = 65536;

export function expandTargets(targetText: string): { ips: string[]; error: string | null } {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (ip: string) => {
    if (!seen.has(ip) && out.length < MAX_SCAN_HOSTS) {
      seen.add(ip);
      out.push(ip);
    }
  };

  const tokens = String(targetText || "")
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const octetsOk = (m: RegExpMatchArray) => m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);

  for (const token of tokens) {
    // CIDR
    if (token.includes("/")) {
      const [base, prefixStr] = token.split("/");
      const m = base.match(ipv4);
      const prefix = Number(prefixStr);
      if (!m || !octetsOk(m) || !Number.isInteger(prefix) || prefix < 8 || prefix > 32) {
        return { ips: [], error: `invalid CIDR: ${token}` };
      }
      const baseU = ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
      const size = 2 ** (32 - prefix);
      if (size > MAX_SCAN_HOSTS) return { ips: [], error: `CIDR ${token} expands to ${size} hosts — the cap is ${MAX_SCAN_HOSTS}` };
      const mask = (0xffffffff << (32 - prefix)) >>> 0;
      const net = (baseU & mask) >>> 0;
      for (let i = 1; i < size - 1; i++) {
        const ip = (net + i) >>> 0;
        push(`${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`);
      }
      continue;
    }
    // Dash range
    const rangeMatch = token.match(/^(.+)-(.+)$/);
    if (rangeMatch && rangeMatch[1].includes(".")) {
      const a = rangeMatch[1];
      const b = rangeMatch[2];
      const ma = a.match(ipv4);
      if (!ma || !octetsOk(ma)) return { ips: [], error: `invalid range start: ${a}` };
      let endIp: string;
      if (b.includes(".")) {
        const mb = b.match(ipv4);
        if (!mb || !octetsOk(mb)) return { ips: [], error: `invalid range end: ${b}` };
        endIp = b;
      } else {
        // 192.168.1.1-254 -> last octet range
        endIp = `${ma[1]}.${ma[2]}.${ma[3]}.${b}`;
        const mb = endIp.match(ipv4);
        if (!mb || !octetsOk(mb)) return { ips: [], error: `invalid range end: ${b}` };
      }
      const u = (s: string) => {
        const mm = s.match(ipv4)!;
        return ((Number(mm[1]) << 24) | (Number(mm[2]) << 16) | (Number(mm[3]) << 8) | Number(mm[4])) >>> 0;
      };
      let ua = u(a);
      let ub = u(endIp);
      if (ub < ua) {
        const tmp = ua;
        ua = ub;
        ub = tmp;
      }
      if (ub - ua + 1 > MAX_SCAN_HOSTS) return { ips: [], error: `range ${token} is larger than the ${MAX_SCAN_HOSTS}-host cap` };
      for (let v = ua; v <= ub && out.length < MAX_SCAN_HOSTS; v++) {
        push(`${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`);
      }
      continue;
    }
    // Single IPv4
    const single = token.match(ipv4);
    if (single && octetsOk(single)) {
      push(token);
      continue;
    }
    // Hostname — resolve synchronously-ish (main process, bounded)
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(token)) {
      // resolution is async; handled by the caller via expandTargetsAsync
      push(token);
      continue;
    }
    return { ips: [], error: `unrecognized target: ${token}` };
  }
  return { ips: out, error: null };
}

/** Async target expansion — resolves hostnames the sync pass deferred. */
export async function expandTargetsAsync(targetText: string, timeoutMs = 6000): Promise<{ ips: string[]; error: string | null }> {
  const sync = expandTargets(targetText);
  if (sync.error) return sync;
  const out: string[] = [];
  for (const t of sync.ips) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) {
      out.push(t);
    } else {
      try {
        const addrs = await Promise.race([
          dns.promises.lookup(t, { all: true }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
        ]);
        for (const a of addrs) if (a.family === 4) out.push(a.address);
      } catch {
        /* unresolvable hostname — skipped */
      }
    }
  }
  return { ips: out, error: null };
}

/** The LAN /24 that hosts this machine's primary IPv4 — the one-click
 *  "scan my network" suggestion. Returns { cidr, ip } or null. */
export function localSubnet(): { cidr: string; ip: string } | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const it of ifaces[name] || []) {
      if (!it || it.internal || it.family !== "IPv4") continue;
      const m = it.address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (!m) continue;
      const oct = m.slice(1).map(Number);
      if (oct.some((o) => o > 255)) continue;
      // 169.254.x.x is link-local, never a useful suggestion
      if (oct[0] === 169 && oct[1] === 254) continue;
      return { cidr: `${oct[0]}.${oct[1]}.${oct[2]}.0/24`, ip: it.address };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Port parsing + presets                                              */
/* ------------------------------------------------------------------ */

export const PORT_PRESETS: Record<string, string> = {
  ping: "80,443",
  web: "80,443,8080,8443",
  windows: "445,3389,139,135",
  dev: "22,3000,5432,3306,6379,8080,9000",
  gaming: "27015-27036,3074,25565",
  torrent: "6881-6889,51413",
  top30: "21,22,23,25,53,80,110,135,139,143,443,445,993,995,1433,1723,3306,3389,5900,6379,8080,8443,8888,9200,27017,32400,5432,25565,11211,1900",
  all: "1-65535",
};

export function parsePorts(portText: string, preset?: string): { ports: number[]; error: string | null } {
  const effective = String(portText || "").trim() || (preset && PORT_PRESETS[preset]) || PORT_PRESETS.ping;
  const out = new Set<number>();
  for (const part of effective.split(/[,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d{1,5})-(\d{1,5})$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > 65535 || a > b) {
        return { ports: [], error: `invalid port range: ${part}` };
      }
      if (b - a + 1 > 65535) return { ports: [], error: `port range ${part} too large` };
      for (let p = a; p <= b; p++) out.add(p);
      continue;
    }
    const p = Number(part);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return { ports: [], error: `invalid port: ${part}` };
    }
    out.add(p);
  }
  return { ports: [...out].sort((x, y) => x - y), error: null };
}

/* ------------------------------------------------------------------ */
/* Automatic tagging (deterministic, from open ports)                  */
/* ------------------------------------------------------------------ */

const TAG_RULES: Array<{ tag: string; ports: number[] }> = [
  { tag: "web", ports: [80, 443, 8080, 8443, 8000, 8888] },
  { tag: "ssh", ports: [22] },
  { tag: "windows", ports: [445, 139, 135, 3389] },
  { tag: "db", ports: [3306, 5432, 1433, 27017, 6379] },
  { tag: "dev", ports: [3000, 9000, 5173, 4200] },
  { tag: "game", ports: [27015, 27016, 25565, 3074] },
  { tag: "torrent", ports: [6881, 6882, 6883, 6889, 51413] },
  { tag: "media", ports: [32400, 1900, 8200] },
  { tag: "mail", ports: [25, 110, 143, 993, 995, 587] },
  { tag: "dns", ports: [53] },
  { tag: "ftp", ports: [21] },
  { tag: "proxy", ports: [10808, 10809, 1080, 3128] },
];

export function classifyHost(ip: string, openPorts: number[]): string[] {
  const tags = new Set<string>();
  const portSet = new Set(openPorts);
  for (const rule of TAG_RULES) {
    if (rule.ports.some((p) => portSet.has(p))) tags.add(rule.tag);
  }
  // Router/gateway heuristics: the well-known .1 / .254 gateways that
  // answer on a management port.
  const lastOctet = Number(ip.split(".")[3]);
  if ((lastOctet === 1 || lastOctet === 254) && (portSet.has(80) || portSet.has(443) || portSet.has(8080) || portSet.has(23))) {
    tags.add("router");
  }
  return [...tags];
}

/* ------------------------------------------------------------------ */
/* Optional geo lookup (batch, online hosts only, injectable fetch)     */
/* ------------------------------------------------------------------ */

const GEO_ENDPOINT = "http://ip-api.com/batch?fields=status,country,countryCode,city,isp,as,query";

export async function fetchGeoBatch(
  ips: string[],
  fetchImpl: typeof fetch
): Promise<Map<string, ScanGeo>> {
  const out = new Map<string, ScanGeo>();
  for (let i = 0; i < ips.length; i += 100) {
    const batch = ips.slice(i, i + 100);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetchImpl(GEO_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) break;
      const rows = (await res.json()) as Array<any>;
      for (const r of rows) {
        if (!r?.query) continue;
        out.set(String(r.query), {
          country: typeof r.country === "string" ? r.country : null,
          countryCode: typeof r.countryCode === "string" ? r.countryCode : null,
          city: typeof r.city === "string" ? r.city : null,
          isp: typeof r.isp === "string" ? r.isp : null,
          as: typeof r.as === "string" ? r.as : null,
        });
      }
    } catch {
      break; // offline / rate-limited — geo stays unknown, scan unaffected
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Probing                                                             */
/* ------------------------------------------------------------------ */

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<{ open: boolean; ms: number | null }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ open, ms: open ? Date.now() - started : null });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

async function reverseResolve(ip: string, timeoutMs = 2500): Promise<string | null> {
  try {
    const names = await Promise.race([
      dns.promises.reverse(ip),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    return names?.[0] ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The scan session                                                    */
/* ------------------------------------------------------------------ */

let activeSession: { cancelled: boolean } | null = null;

export function cancelScan(): void {
  if (activeSession) activeSession.cancelled = true;
}

export async function runScan(
  opts: ScanOptions,
  onProgress?: (ev: ScanProgressEvent) => void,
  onHost?: (host: ScanHostResult) => void,
  fetchImpl: typeof fetch = fetch
): Promise<ScanOutcome> {
  const started = Date.now();
  const session = { cancelled: false };
  if (activeSession) activeSession.cancelled = true; // a new scan supersedes
  activeSession = session;

  const concurrency = Math.min(2048, Math.max(1, Number(opts.concurrency) || 256));
  const timeoutMs = Math.min(10_000, Math.max(50, Number(opts.timeoutMs) || 1200));

  onProgress?.({ phase: "expanding", scanned: 0, total: 0, online: 0 });
  const expanded = await expandTargetsAsync(opts.targetText);
  if (expanded.error || !expanded.ips.length) {
    onProgress?.({ phase: "error", scanned: 0, total: 0, online: 0, detail: expanded.error || "no targets" });
    activeSession = null;
    return { results: [], scanned: 0, online: 0, elapsedMs: Date.now() - started, cancelled: false };
  }
  const ports = parsePorts(opts.portText, opts.preset);
  if (ports.error || !ports.ports.length) {
    onProgress?.({ phase: "error", scanned: 0, total: 0, online: 0, detail: ports.error || "no ports" });
    activeSession = null;
    return { results: [], scanned: 0, online: 0, elapsedMs: Date.now() - started, cancelled: false };
  }

  const ips = expanded.ips;
  const results: ScanHostResult[] = [];
  let scanned = 0;
  let online = 0;
  const total = ips.length;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (session.cancelled) return;
      const i = cursor++;
      if (i >= ips.length) return;
      const ip = ips[i];
      const hostResult: ScanHostResult = { ip, hostname: null, online: false, ms: null, ports: [], tags: [], geo: null };
      for (const port of ports.ports) {
        if (session.cancelled) break;
        const r = await tcpProbe(ip, port, timeoutMs);
        hostResult.ports.push({ port, open: r.open, ms: r.ms });
        if (r.open) {
          hostResult.online = true;
          if (hostResult.ms === null || (r.ms ?? 1e9) < hostResult.ms) hostResult.ms = r.ms;
        }
      }
      if (hostResult.online) {
        if (opts.reverseDns) hostResult.hostname = await reverseResolve(ip);
        hostResult.tags = classifyHost(ip, hostResult.ports.filter((p) => p.open).map((p) => p.port));
        online++;
      }
      scanned++;
      results.push(hostResult);
      // STREAM: the UI appends this row immediately — live results.
      try {
        onHost?.(hostResult);
      } catch {
        /* the sink must never break the scan */
      }
      if (scanned % 4 === 0 || scanned === total) {
        onProgress?.({ phase: "scanning", scanned, total, online });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, ips.length)) }, worker));

  /* Geo pass — online hosts only, AFTER the sweep (batched; the scan
   * itself is never slowed by it). */
  if (!session.cancelled && opts.geoLookup && online > 0) {
    onProgress?.({ phase: "geo", scanned, total, online });
    const onlineIps = results.filter((r) => r.online).map((r) => r.ip);
    const geo = await fetchGeoBatch(onlineIps, fetchImpl);
    for (const r of results) {
      if (r.online) r.geo = geo.get(r.ip) ?? null;
    }
  }

  onProgress?.({ phase: session.cancelled ? "cancelled" : "done", scanned, total, online });
  activeSession = null;
  return {
    results,
    scanned,
    online,
    elapsedMs: Date.now() - started,
    cancelled: session.cancelled,
  };
}
