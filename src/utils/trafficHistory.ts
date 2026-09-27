/**
 * trafficHistory.ts (Phase C1, item 5 — live traffic chart data slice)
 *
 * A tiny STANDALONE ring-buffer store for live throughput samples, kept
 * COMPLETELY OUTSIDE the zustand store on purpose:
 *
 *  - ConnectionManager already computes bytes/sec every 3 s poll (Phase D1);
 *    the chart reuses those numbers — zero extra IPC, zero extra polling.
 *  - The App-wide perf rule (App.tsx:61-64: subscribing the shell to the
 *    whole store re-renders thousands of config rows on every traffic
 *    update) means traffic data must NEVER ride in the zustand store. This
 *    module is its own slice with its own subscribers: only the mounted
 *    TrafficChart re-renders when a sample lands (useSyncExternalStore).
 *  - The ring is bounded (MAX_SAMPLES) so a long session cannot grow it;
 *    snapshots are reference-stable between pushes so React bails out of
 *    re-renders when nothing changed.
 *
 * Ephemeral by design: never persisted, never restored — same lifecycle as
 * the D1 speed counters (store.ts:204-208).
 */

export interface TrafficSample {
  /** bytes/second download (derived from the D1 poll delta). */
  down: number;
  /** bytes/second upload. */
  up: number;
  /** Wall-clock ms of the poll that produced this sample. */
  at: number;
}

/** 3 s poll cadence => 120 samples ≈ the last 6 minutes. */
export const TRAFFIC_HISTORY_MAX = 120;

let ring: TrafficSample[] = [];

const listeners = new Set<() => void>();

/** Push one sample; drops the oldest beyond the cap. No-op guard: samples
 *  must be finite (a NaN from a malformed poll must not poison the chart). */
export function pushTrafficSample(down: number, up: number, at = Date.now()): void {
  if (!Number.isFinite(down) || !Number.isFinite(up)) return;
  const next = ring.length >= TRAFFIC_HISTORY_MAX
    ? [...ring.slice(ring.length - TRAFFIC_HISTORY_MAX + 1), { down, up, at }]
    : [...ring, { down, up, at }];
  ring = next;
  listeners.forEach(l => l());
}

/** Clear the ring — called by ConnectionManager whenever the connection
 *  identity changes (connected arm + every non-connected state), so a new
 *  session never inherits the previous session's shape. */
export function resetTrafficHistory(): void {
  if (ring.length === 0) return;
  ring = [];
  listeners.forEach(l => l());
}

/** useSyncExternalStore-compatible subscribe. */
export function subscribeTrafficHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore-compatible snapshot — reference-stable between
 *  pushes (a fresh array is ONLY allocated inside push/reset). */
export function getTrafficHistory(): TrafficSample[] {
  return ring;
}
