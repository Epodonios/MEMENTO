/**
 * MEMENTO — 3.1.8 aether live sockets (field report #5: "Live Connection
 * should not only work with xray").
 *
 * The aether core exposes NO stats API at all (the honest limitation the
 * aggregate traffic path already answers zeros for) — but the OS socket
 * table still tells the truth: which remote endpoints aether.exe is
 * talking to RIGHT NOW. This module turns that snapshot into normalized
 * ConnectionStatsRow rows:
 *
 *   - granularity "sockets": live connections WITHOUT byte counters —
 *     download/upload are honestly 0 and the UI labels the surface
 *     "aether · live sockets (no byte counters)" instead of pretending.
 *   - sourcePort carries the LOCAL port so the renderer's existing
 *     port->owner join attributes every row to the aether process row in
 *     the per-app table — the same join sing-box rows already use.
 *
 * ELECTRON-FREE by construction (node builtins only) so gate scripts can
 * exercise the parser against recorded fixtures.
 */
import { spawnSync } from "child_process";

export interface AetherSocketRow {
  proto: "tcp" | "udp";
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  state: string;
}

/** Parse `netstat -ano -p tcp|udp` rows for ONE pid. Exported for the
 *  gate fixtures — the shape mirrors liveConn.ts's parseNetstat exactly
 *  (proto, local, remote, [state], pid — LAST numeric column is the PID). */
export function parseNetstatForPid(
  output: string,
  proto: "tcp" | "udp",
  pid: number
): AetherSocketRow[] {
  const rows: AetherSocketRow[] = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length < 4) continue;
    if (parts[0].toLowerCase() !== proto) continue;
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
    if (Number(pidStr) !== pid) continue;
    const splitAddr = (a: string): { addr: string; port: number } => {
      const i = a.lastIndexOf(":");
      if (i === -1) return { addr: a, port: 0 };
      const port = Number(a.slice(i + 1));
      return { addr: a.slice(0, i), port: Number.isFinite(port) ? port : 0 };
    };
    const l = splitAddr(parts[1] || "");
    const r = splitAddr(parts[2] || "");
    if (proto === "udp" && !r.addr) continue; // unbound UDP endpoint — noise
    rows.push({ proto, localPort: l.port, remoteAddr: r.addr, remotePort: r.port, state });
  }
  return rows;
}

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

/**
 * The live socket rows for ONE process pid (Windows: netstat; elsewhere:
 * ss filtered by pid — dev parity). Best-effort: failures -> empty.
 */
export function aetherSocketRows(pid: number): AetherSocketRow[] {
  if (!Number.isFinite(pid) || pid <= 0) return [];
  if (process.platform === "win32") {
    const tcp = parseNetstatForPid(run("netstat", ["-ano", "-p", "tcp"]), "tcp", pid);
    const udp = parseNetstatForPid(run("netstat", ["-ano", "-p", "udp"]), "udp", pid);
    return [...tcp, ...udp];
  }
  // Linux/dev parity: ss -tunap rows carry pid=NNN in the process column.
  const out = run("ss", ["-tunap"]);
  const rows: AetherSocketRow[] = [];
  for (const line of String(out || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /Netid|State\s+Recv-Q/.test(t)) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 6) continue;
    const proto = parts[0] === "tcp" ? "tcp" : parts[0] === "udp" ? "udp" : null;
    if (!proto) continue;
    const pidMatch = t.match(/pid=(\d+)/);
    if (!pidMatch || Number(pidMatch[1]) !== pid) continue;
    const splitAddr = (a: string): { addr: string; port: number } => {
      const i = a.lastIndexOf(":");
      if (i === -1) return { addr: a, port: 0 };
      const port = Number(a.slice(i + 1));
      return { addr: a.slice(0, i), port: Number.isFinite(port) ? port : 0 };
    };
    const l = splitAddr(parts[4] || "");
    const r = splitAddr(parts[5] || "");
    if (!r.addr || r.addr === "*") continue;
    rows.push({ proto, localPort: l.port, remoteAddr: r.addr, remotePort: r.port, state: parts[1] === "UNCONN" ? "" : parts[1] });
  }
  return rows;
}
