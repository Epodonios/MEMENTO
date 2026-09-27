/**
 * urlTest.ts (Phase C2, item 3 — renderer side of the real-delay test)
 *
 * Wraps the main-process `url_test` command with the two things the main
 * process cannot do by itself:
 *
 *  1. CONFIG GENERATION — the generators live renderer-side (v2rayConfig /
 *     singBoxConfig). For every probe we regenerate a REAL config with the
 *     SAME generators + builder options (fragment dialer included) the
 *     connect flow would use, in "socks-only" inbound mode; the main
 *     process rewrites its port to a fresh ephemeral one and runs a
 *     temporary core instance. A tested config therefore measures exactly
 *     the path a real connection would take.
 *  2. BATCHING + HISTORY — a small worker pool (concurrency 4: each probe
 *     boots a whole core, so more parallelism just adds noise and load)
 *     with progress + abort, feeding every outcome into the standalone
 *     latencyHistory slice (per-config ring, outside zustand).
 *
 * Honest limits (surfaced in UI copy, not hidden):
 *   - Browser preview: no cores, no spawn — every probe reports
 *     "Desktop only" and nothing is written to the history.
 *   - Pasted links in the Pinger tab have no stable config id, so their
 *     URL-test results live in that tab's local state only (no history).
 */

import { isDesktop, tauriInvoke } from "./tauriBridge";
import { useStore, configCore, type ParsedConfig } from "../store";
import { generateV2RayConfig } from "./v2rayConfig";
import { generateSingBoxConfig } from "./singBoxConfig";
import { pushLatencySample } from "./latencyHistory";
import { routingNeedsGeo, type GeoStatus } from "./routingOptions";

export interface UrlTestOutcome {
  ok: boolean;
  ms: number | null;
  error?: string;
  core?: "xray" | "sing-box";
  mode: "instance" | "tunnel";
}

export interface UrlTestResult {
  id: string;
  ms: number | null;
  error?: string;
  core?: string;
}

/** Batch concurrency — 4 simultaneous temporary core instances. */
export const URL_TEST_CONCURRENCY = 4;

/* ------------------------------------------------------------------ */
/*  Test URL resolution (persisted pref, lazily cached)                */
/* ------------------------------------------------------------------ */

const URL_TEST_FALLBACK = "https://www.gstatic.com/generate_204";

let cachedTestUrl: string | null = null;

/** The persisted pref (appPrefs.testUrl) is the single source of truth;
 *  this cache just avoids an app_prefs_get per probe. SettingsTab calls
 *  invalidateTestUrlCache() after a successful save. */
export async function resolveTestUrl(): Promise<string> {
  if (cachedTestUrl) return cachedTestUrl;
  if (!isDesktop()) return URL_TEST_FALLBACK;
  try {
    const prefs = await tauriInvoke<{ testUrl?: string }>("app_prefs_get");
    cachedTestUrl = typeof prefs?.testUrl === "string" && prefs.testUrl ? prefs.testUrl : URL_TEST_FALLBACK;
  } catch {
    cachedTestUrl = URL_TEST_FALLBACK;
  }
  return cachedTestUrl;
}

export function invalidateTestUrlCache(): void {
  cachedTestUrl = null;
}

/* ------------------------------------------------------------------ */
/*  Config generation for the probe                                    */
/* ------------------------------------------------------------------ */

/** Generates the probe config for a parsed link — the exact connect-flow
 *  generators with the user's CURRENT builder options (so the C1 fragment
 *  dialer is measured when enabled), in "socks-only" inbound mode. The
 *  ports are placeholders: url_test rewrites the socks inbound to its own
 *  ephemeral port and strips every other inbound (documented contract). */
export function buildUrlTestConfigJson(config: ParsedConfig): string | null {
  if (!config.isValid) return null;
  const state = useStore.getState();
  const srsDir = state.geoStatus?.srsDir ?? "";
  return configCore(config) === "sing-box"
    ? generateSingBoxConfig(config, state.connSocksPort, state.connHttpPort, undefined, state.builderOptions, state.routingOptions, srsDir)?.json ?? null
    : generateV2RayConfig(config, "socks-only", state.connSocksPort, state.connHttpPort, undefined, state.builderOptions, state.routingOptions)?.json ?? null;
}

/** Phase C3: one geo_ensure per batch for each family the current routing
 *  options reference — probes run REAL cores, so a geo-referencing config
 *  needs the files on disk exactly like a connect does. Missing geo here
 *  makes the probe fail HONESTLY ("core exited during probe" + stderr),
 *  it can never fake a latency. */
async function ensureGeoForProbes(configs: ParsedConfig[]): Promise<void> {
  if (!isDesktop()) return;
  const routing = useStore.getState().routingOptions;
  const needs = routingNeedsGeo(routing);
  const mixed = configs.some(c => configCore(c) === "sing-box");
  const plain = configs.some(c => configCore(c) !== "sing-box");
  const families = [...new Set([
    ...(needs.xrayDat && plain ? ["xray" as const] : []),
    ...(needs.singBoxSrs && mixed ? ["srs" as const] : []),
  ])];
  for (const family of families) {
    try {
      const res = await tauriInvoke<{ status: GeoStatus }>("geo_ensure", { family });
      if (res) useStore.getState().setGeoStatus(res.status);
    } catch { /* probes will surface the real core-start failure */ }
  }
}

/* ------------------------------------------------------------------ */
/*  Single + batch runners                                             */
/* ------------------------------------------------------------------ */

/** One real-delay probe for one config — generation + invoke, NO history
 *  write. `recordHistory` is false for targets without a stable identity
 *  (pasted links in the Pinger tab); their results live in that tab's own
 *  local state instead of the latencyHistory slice. */
async function probeConfig(config: ParsedConfig, timeoutMs: number): Promise<UrlTestResult> {
  if (!isDesktop()) {
    return { id: config.id, ms: null, error: "Desktop only" };
  }
  const testUrl = await resolveTestUrl();
  let outcome: UrlTestOutcome;
  try {
    const configJson = buildUrlTestConfigJson(config);
    if (!configJson) {
      outcome = { ok: false, ms: null, mode: "instance", error: "Unsupported or invalid config" };
    } else {
      // Phase C3 null-guard: tauriInvoke resolves null when no bridge answers.
      outcome = (await tauriInvoke<UrlTestOutcome>("url_test", { configJson, testUrl, timeoutMs }))
        ?? { ok: false, ms: null, mode: "instance", error: "url_test returned nothing" };
    }
  } catch (err) {
    outcome = { ok: false, ms: null, mode: "instance", error: String((err as Error)?.message || err) };
  }
  return {
    id: config.id,
    ms: outcome.ok ? outcome.ms : null,
    error: outcome.ok ? undefined : outcome.error,
    core: outcome.core,
  };
}

/** One real-delay probe for one config, recorded in the latencyHistory
 *  slice (even failures — a red badge is information). */
export async function runUrlTest(config: ParsedConfig, timeoutMs = 10_000, recordHistory = true): Promise<UrlTestResult> {
  const r = await probeConfig(config, timeoutMs);
  if (recordHistory) {
    pushLatencySample(config.id, {
      at: Date.now(),
      ms: r.ms,
      error: r.ms === null ? r.error || "Failed" : undefined,
      mode: "instance",
    });
  }
  return r;
}

/** Batch real-delay test with a bounded worker pool, progress callback and
 *  abort support (abort stops SCHEDULING; in-flight probes finish or time
 *  out — a killed-by-connect probe surfaces its own transport error).
 *  `recordHistory: false` serves identity-less targets (Pinger tab); those
 *  results are consumed via `onResult` / the return value only. */
export async function runUrlTestBatch(
  configs: ParsedConfig[],
  opts: {
    concurrency?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    recordHistory?: boolean;
    onProgress?: (done: number, total: number) => void;
    onResult?: (r: UrlTestResult) => void;
  } = {}
): Promise<UrlTestResult[]> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? URL_TEST_CONCURRENCY, 8));
  const total = configs.length;
  const results: UrlTestResult[] = [];
  let next = 0;
  let done = 0;

  await ensureGeoForProbes(configs);

  const worker = async (): Promise<void> => {
    while (next < total) {
      if (opts.signal?.aborted) return;
      const config = configs[next++];
      const r = await runUrlTest(config, opts.timeoutMs, opts.recordHistory !== false);
      results.push(r);
      done++;
      try { opts.onResult?.(r); } catch { /* UI callback must not break the pool */ }
      try { opts.onProgress?.(done, total); } catch { /* UI callback must not break the pool */ }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(total, 1)) }, worker)
  );
  return results;
}

/* ------------------------------------------------------------------ */
/*  Tunnel mode (already-running inbound)                              */
/* ------------------------------------------------------------------ */

/** Probe an ALREADY RUNNING local inbound — the connected session's socks
 *  port (any of the three cores) — without spawning anything. The outcome
 *  is recorded in the history of `configId` when provided (the Connection
 *  tab passes the connected config's id; the Aether session has none). */
export async function runTunnelUrlTest(
  socksPort: number,
  configId: string | null,
  timeoutMs = 10_000
): Promise<UrlTestOutcome> {
  if (!isDesktop()) {
    return { ok: false, ms: null, mode: "tunnel", error: "Desktop only" };
  }
  const testUrl = await resolveTestUrl();
  let outcome: UrlTestOutcome;
  try {
    outcome = (await tauriInvoke<UrlTestOutcome>("url_test", { socksPort, testUrl, timeoutMs }))
      ?? { ok: false, ms: null, mode: "tunnel", error: "url_test returned nothing" };
  } catch (err) {
    outcome = { ok: false, ms: null, mode: "tunnel", error: String((err as Error)?.message || err) };
  }
  if (configId) {
    pushLatencySample(configId, {
      at: Date.now(),
      ms: outcome.ok ? outcome.ms : null,
      error: outcome.ok ? undefined : outcome.error || "Failed",
      mode: "tunnel",
    });
  }
  return outcome;
}
