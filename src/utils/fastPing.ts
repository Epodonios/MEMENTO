// Fast ping: Tauri native TCP batch (like v2rayN) + browser fallback
import { isTauri, tauriInvoke } from "./tauriBridge";
import { pingIp } from "./ping";

export interface FastPingTarget {
  id: string;
  host: string;
  port: number;
}

export interface FastPingResult {
  id: string;
  ping: number | null;
  error?: string;
}

interface NativePingResult {
  id: string;
  ping?: number | null;
  ms?: number | null;
  error?: string | null;
}

const BROWSER_CONCURRENCY = 20;
const NATIVE_BATCH_SIZE = 400;

function normalizeNative(r: NativePingResult): FastPingResult {
  const ping = r.ping ?? r.ms ?? null;
  // Rust returns error: Some(String) on failure, None on success
  // Our UI treats ping=null or error as failed, ping=number as success
  return { id: r.id, ping: typeof ping === "number" ? ping : null, error: r.error || undefined };
}

export async function pingManyFast(
  targets: FastPingTarget[],
  timeoutMs: number,
  onBatch?: (results: FastPingResult[]) => void,
): Promise<FastPingResult[]> {
  if (targets.length === 0) return [];

  if (isTauri()) {
    const all: FastPingResult[] = [];
    for (let i = 0; i < targets.length; i += NATIVE_BATCH_SIZE) {
      const slice = targets.slice(i, i + NATIVE_BATCH_SIZE);
      try {
        const outcomes = await tauriInvoke<NativePingResult[]>("tcp_ping_batch", {
          targets: slice.map(t => ({ id: t.id, host: t.host, port: t.port })),
          timeoutMs,
        });
        if (outcomes && Array.isArray(outcomes)) {
          const normalized = outcomes.map(normalizeNative);
          all.push(...normalized);
          onBatch?.(normalized);
        } else {
          const fallback = slice.map(t => ({ id: t.id, ping: null, error: "No response" } as FastPingResult));
          all.push(...fallback);
          onBatch?.(fallback);
        }
      } catch (e) {
        // Fallback to browser method if native fails
        const fallback = await pingBrowserBatch(slice, timeoutMs, onBatch);
        all.push(...fallback);
      }
    }
    return all;
  }

  return pingBrowserBatch(targets, timeoutMs, onBatch);
}

async function pingBrowserBatch(
  targets: FastPingTarget[],
  timeoutMs: number,
  onBatch?: (results: FastPingResult[]) => void,
): Promise<FastPingResult[]> {
  const all: FastPingResult[] = [];
  for (let i = 0; i < targets.length; i += BROWSER_CONCURRENCY) {
    const slice = targets.slice(i, i + BROWSER_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (target): Promise<FastPingResult> => {
        try {
          const r = await pingIp(target.host, { timeoutMs, port: target.port });
          return { id: target.id, ping: r.ping, error: r.error };
        } catch {
          return { id: target.id, ping: null, error: "Internal error" };
        }
      }),
    );
    all.push(...results);
    onBatch?.(results);
  }
  return all;
}
