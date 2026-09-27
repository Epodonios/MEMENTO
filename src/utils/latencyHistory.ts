/**
 * latencyHistory.ts (Phase C2, item 3 — real-delay test history slice)
 *
 * Per-config bounded ring of URL-test ("real delay") samples, kept
 * COMPLETELY OUTSIDE the zustand store — the same architecture decision as
 * trafficHistory.ts (C1): the App shell subscribes the whole store
 * (App.tsx:61-64), so high-frequency per-row data must never ride in it.
 * Only components that explicitly subscribe (useSyncExternalStore with a
 * per-config selector) re-render when a sample lands — and only for the
 * config that actually got tested.
 *
 * Samples are EPHEMERAL by design (same lifecycle as the TCP pingResults):
 * never persisted, never restored. The ring is bounded (20 samples per
 * config) so long testing sessions cannot grow it, and snapshots are
 * reference-stable between pushes so React bails out of re-renders when
 * nothing changed.
 */

export interface LatencySample {
  /** Wall-clock ms when the probe finished. */
  at: number;
  /** Milliseconds to response headers through the tunnel; null = failed. */
  ms: number | null;
  /** Failure reason (transport/timeout/generation), present when ms=null. */
  error?: string;
  /** Which probe produced this sample (url_test's two modes). */
  mode: "instance" | "tunnel";
}

/** 20 samples per config — enough for a readable sparkline + stats. */
export const LATENCY_HISTORY_MAX = 20;

/** Stable empty snapshot for configs that were never tested. */
const EMPTY: LatencySample[] = [];

const rings = new Map<string, LatencySample[]>();

const listeners = new Set<() => void>();

/** Push one sample for a config; drops the oldest beyond the cap.
 *  Malformed samples (non-finite ms) are ignored — a NaN must not poison
 *  the badge or the sparkline. */
export function pushLatencySample(configId: string, sample: LatencySample): void {
  if (!configId) return;
  if (sample.ms !== null && !Number.isFinite(sample.ms)) return;
  const ring = rings.get(configId) ?? [];
  const next =
    ring.length >= LATENCY_HISTORY_MAX
      ? [...ring.slice(ring.length - LATENCY_HISTORY_MAX + 1), sample]
      : [...ring, sample];
  rings.set(configId, next);
  listeners.forEach(l => l());
}

/** Reference-stable snapshot for useSyncExternalStore(getSnapshot). */
export function getLatencyHistory(configId: string): LatencySample[] {
  return rings.get(configId) ?? EMPTY;
}

/** Latest sample for a config (or null when never tested). */
export function lastLatencySample(configId: string): LatencySample | null {
  const ring = rings.get(configId);
  return ring && ring.length > 0 ? ring[ring.length - 1] : null;
}

/** Drop history — one config, or everything when no id is given
 *  (e.g. the store wipe action). */
export function clearLatencyHistory(configId?: string): void {
  if (configId) {
    if (!rings.has(configId)) return;
    rings.delete(configId);
  } else {
    if (rings.size === 0) return;
    rings.clear();
  }
  listeners.forEach(l => l());
}

/** useSyncExternalStore-compatible subscribe. */
export function subscribeLatencyHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
