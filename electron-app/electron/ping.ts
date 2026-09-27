/**
 * MEMENTO — fast native TCP batch ping — Electron port of lib.rs
 * `tcp_ping_batch`.
 *
 * Real TCP connect per target (SYN/SYN-ACK/ACK), same technique v2rayN uses,
 * with a 64-slot concurrency semaphore. Result shape preserved:
 *   { id, ping: number | null, error: string | null }
 * (the Rust struct renamed `ms` -> `ping` via serde; we emit `ping` directly).
 */
import net from "net";

export interface PingTarget {
  id: string;
  host: string;
  port: number;
}

export interface PingOutcome {
  id: string;
  ping: number | null;
  error: string | null;
}

const CONCURRENCY = 64;

function pingOne(target: PingTarget, timeoutMs: number): Promise<PingOutcome> {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    const finish = (outcome: PingOutcome) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(outcome);
    };

    const socket = new net.Socket();

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({ id: target.id, ping: Date.now() - start, error: null });
    });
    socket.once("timeout", () => {
      finish({ id: target.id, ping: null, error: "Timeout" });
    });
    socket.once("error", (err: Error) => {
      finish({ id: target.id, ping: null, error: err.message || "Error" });
    });

    try {
      socket.connect({ host: target.host, port: target.port });
    } catch (e: any) {
      finish({ id: target.id, ping: null, error: e?.message || "Error" });
    }
  });
}

export async function tcpPingBatch(
  targets: PingTarget[],
  timeoutMs: number
): Promise<PingOutcome[]> {
  const results: PingOutcome[] = new Array(targets.length);

  // Simple index-based worker pool == tokio Semaphore(64).
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < targets.length) {
      const index = next++;
      const target = targets[index];
      if (
        !target ||
        typeof target.id !== "string" ||
        typeof target.host !== "string" ||
        typeof target.port !== "number" ||
        !Number.isFinite(target.port)
      ) {
        results[index] = { id: String(target?.id ?? ""), ping: null, error: "Invalid target" };
        continue;
      }
      results[index] = await pingOne(target, timeoutMs);
    }
  };

  const workers: Promise<void>[] = [];
  const n = Math.min(CONCURRENCY, Math.max(targets.length, 1));
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);

  return results;
}
