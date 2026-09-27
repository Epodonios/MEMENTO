/**
 * MEMENTO — Live Connection (R3 task #4).
 *
 * A real, per-application snapshot of who is using the internet RIGHT NOW:
 * every TCP/UDP socket the OS reports, attributed to the process that owns
 * it, aggregated per app with live counters. The renderer renders this as
 * the stylish "Live Connection" section — searchable, sortable, auto-
 * refreshing, with honest totals.
 *
 * HOW (all stock Windows tooling — no admin, no drivers, no new deps):
 *   - sockets : `netstat -ano -p tcp` / `-p udp`  (works on every Win10/11,
 *               gives proto/local/remote/state/PID, ~50-150 ms per call)
 *   - names   : `tasklist /FO CSV /NH`             (PID -> image name,
 *               cached for 5 s — the map is the expensive call)
 * On Linux (dev sandbox) the same contract is served by `ss -tunap`.
 *
 * PRIVACY: read-only, never kills anything, never leaves the machine.
 *
 * ELECTRON-FREE by construction (node builtins) so the gate scripts can
 * exercise the parsers against recorded fixtures.
 */
import { spawnSync } from "child_process";

export interface LiveSocketRow {
  proto: "tcp" | "udp";
  localAddr: string;
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  /** TCP states (LISTENING, ESTABLISHED, TIME_WAIT, …); "" for UDP. */
  state: string;
  pid: number;
  app: string;
}

export interface LiveAppRow {
  app: string;
  pid: number;
  total: number;
  established: number;
  listening: number;
  udp: number;
  /** Distinct remote endpoints (top first) — the real "where does it talk to". */
  remoteTargets: string[];
  /** True when this app is the OS idle placeholder (PID 0). */
  isSystem: boolean;
}

export interface LiveSnapshot {
  atMs: number;
  platform: string;
  rows: LiveSocketRow[];
  apps: LiveAppRow[];
  totals: { tcp: number; udp: number; established: number; apps: number };
}

/* ------------------------------------------------------------------ */
/* netstat (Windows)                                                   */
/* ------------------------------------------------------------------ */

function run(cmd: string, args: string[], timeoutMs = 8000): string {
  try {
    const res = spawnSync(cmd, args, {
      timeout: timeoutMs,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return `${res.stdout ?? ""}`;
  } catch {
    return "";
  }
}

/** Parse `netstat -ano -p tcp|udp` (English or localized state column —
 *  we only rely on the LAST numeric column being the PID). */
export function parseNetstat(output: string, proto: "tcp" | "udp"): LiveSocketRow[] {
  const rows: LiveSocketRow[] = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s{2,}|\s+/).filter(Boolean);
    // Proto  Local  Remote  [State]  PID
    if (parts.length < 4) continue;
    if (parts[0].toLowerCase() !== proto) continue;
    const local = parts[1] || "";
    const remote = parts[2] || "";
    const tail = parts.slice(3);
    let state = "";
    let pidStr = "";
    if (proto === "tcp" && tail.length >= 2) {
      state = tail[0];
      pidStr = tail[1];
    } else if (tail.length >= 1) {
      state = "";
      pidStr = tail[0];
    } else {
      continue;
    }
    const pid = Number(pidStr);
    if (!Number.isFinite(pid)) continue;
    const splitAddr = (a: string): { addr: string; port: number } => {
      const i = a.lastIndexOf(":");
      if (i === -1) return { addr: a, port: 0 };
      const port = Number(a.slice(i + 1));
      return { addr: a.slice(0, i), port: Number.isFinite(port) ? port : 0 };
    };
    const l = splitAddr(local);
    const r = splitAddr(remote);
    rows.push({
      proto,
      localAddr: l.addr,
      localPort: l.port,
      remoteAddr: r.addr,
      remotePort: r.port,
      state,
      pid,
      app: "",
    });
  }
  return rows;
}

/** Parse `tasklist /FO CSV /NH` -> Map<pid, imageName>. */
export function parseTasklist(output: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of String(output || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('"')) continue;
    // "name","pid","session name","session num","mem"
    const cells = t.match(/"((?:[^"\\]|\\.)*)"/g);
    if (!cells || cells.length < 2) continue;
    const name = cells[0].slice(1, -1);
    const pid = Number(cells[1].slice(1, -1));
    if (Number.isFinite(pid) && name) map.set(pid, name);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* ss (Linux sandbox / dev parity)                                     */
/* ------------------------------------------------------------------ */

export function parseSs(output: string): LiveSocketRow[] {
  const rows: LiveSocketRow[] = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /Netid|State\s+Recv-Q/.test(t)) continue;
    const parts = t.split(/\s+/);
    // Netid State Recv-Q Send-Q Local Peer Process
    if (parts.length < 6) continue;
    const proto = parts[0] === "tcp" ? "tcp" : parts[0] === "udp" ? "udp" : null;
    if (!proto) continue;
    const state = parts[1] === "UNCONN" ? "" : parts[1];
    const local = parts[4] || "";
    const remote = parts[5] || "";
    const pidMatch = t.match(/pid=(\d+)/);
    const procMatch =
      t.match(/\(\("([^"]+)"/) || t.match(/process=("([^"]+)"|([^\s,]+))/);
    const appName = procMatch
      ? procMatch[1] || procMatch[2] || procMatch[3] || ""
      : "";
    const splitAddr = (a: string): { addr: string; port: number } => {
      // [::1]:53 or 1.2.3.4:443 or *:*
      const i = a.lastIndexOf(":");
      if (i === -1) return { addr: a, port: 0 };
      const port = Number(a.slice(i + 1));
      return { addr: a.slice(0, i), port: Number.isFinite(port) ? port : 0 };
    };
    const l = splitAddr(local);
    const r = splitAddr(remote);
    rows.push({
      proto,
      localAddr: l.addr,
      localPort: l.port,
      remoteAddr: r.addr === "*" ? "" : r.addr,
      remotePort: r.port,
      state,
      pid: pidMatch ? Number(pidMatch[1]) : 0,
      app: appName,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

let tasklistCache: { atMs: number; map: Map<number, string> } | null = null;

function pidNameMap(): Map<number, string> {
  const now = Date.now();
  if (tasklistCache && now - tasklistCache.atMs < 5000) return tasklistCache.map;
  const map =
    process.platform === "win32"
      ? parseTasklist(run("tasklist", ["/FO", "CSV", "/NH"], 10000))
      : new Map<number, string>();
  tasklistCache = { atMs: now, map };
  return map;
}

/** Aggregate raw socket rows into the per-app view the UI renders. */
export function aggregateByApp(rows: LiveSocketRow[]): LiveAppRow[] {
  const byApp = new Map<string, LiveAppRow>();
  for (const r of rows) {
    const key = `${r.app || (r.pid ? `pid:${r.pid}` : "system")}|${r.pid}`;
    let entry = byApp.get(key);
    if (!entry) {
      entry = {
        app: r.app || (r.pid ? `pid:${r.pid}` : "System"),
        pid: r.pid,
        total: 0,
        established: 0,
        listening: 0,
        udp: 0,
        remoteTargets: [],
        isSystem: r.pid === 0,
      };
      byApp.set(key, entry);
    }
    entry.total++;
    if (r.proto === "udp") entry.udp++;
    if (r.state === "ESTABLISHED") entry.established++;
    if (r.state === "LISTENING" || r.state === "LISTEN") entry.listening++;
    if (r.remoteAddr && r.remoteAddr !== "*" && r.remoteAddr !== "0.0.0.0" && r.remoteAddr !== "[::]") {
      const target = `${r.remoteAddr}${r.remotePort ? ":" + r.remotePort : ""}`;
      if (!entry.remoteTargets.includes(target) && entry.remoteTargets.length < 24) {
        entry.remoteTargets.push(target);
      }
    }
  }
  return [...byApp.values()].sort((a, b) => b.established - a.established || b.total - a.total);
}

/** One full snapshot — the live_conn_snapshot handler's body. */
export function liveConnSnapshot(): LiveSnapshot {
  let rows: LiveSocketRow[] = [];
  if (process.platform === "win32") {
    const tcp = parseNetstat(run("netstat", ["-ano", "-p", "tcp"]), "tcp");
    const udp = parseNetstat(run("netstat", ["-ano", "-p", "udp"]), "udp");
    rows = [...tcp, ...udp];
    const names = pidNameMap();
    for (const r of rows) r.app = names.get(r.pid) || (r.pid === 0 ? "System Idle" : "");
  } else {
    const out = run("ss", ["-tunap"], 8000);
    if (out) {
      rows = parseSs(out);
    } else {
      // Fall back to netstat-style output on minimal systems.
      const out2 = run("netstat", ["-tunp"], 8000);
      rows = parseNetstat(out2.replace(/^tcp6?/gm, (m) => (m.startsWith("tcp6") ? "tcp" : "tcp")), "tcp")
        .concat(parseNetstat(out2.replace(/^udp6?/gm, "udp"), "udp"));
    }
  }

  const apps = aggregateByApp(rows);
  return {
    atMs: Date.now(),
    platform: process.platform,
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
