/**
 * topologyOptions.ts (Phase C4 — item ⑥ Chain Proxy + Balancer)
 *
 * Owns the user-facing topology toggles: chain the connection through a
 * second config (front proxy) and/or load-balance across several configs.
 *
 * HARD RULE (same discipline as builderOptions/routingOptions): every
 * default reproduces the PRE-C4 behavior byte-for-byte — an untouched
 * install generates the exact same JSON as before. Nothing changes unless
 * the user flips a switch.
 *
 * Lives as a STANDALONE module (no store import — the `ParsedConfig` import
 * is type-only and erased at build) so the config generators — which are
 * also bundled standalone by the smoke/quickcheck esbuild harnesses — can
 * import it without dragging zustand/localStorage into those bundles.
 */

import type { ParsedConfig } from "../store";

/* ------------------------------------------------------------------ */
/*  Options shape + persistence                                       */
/* ------------------------------------------------------------------ */

/** Xray balancer strategies (infra/conf/router.go, probed against the real
 *  pinned v25.1.1 binary: all four accepted, unknown types rejected).
 *  leastPing/leastLoad read the burstObservatory the generator emits. */
export type BalancerStrategy = "random" | "roundRobin" | "leastPing" | "leastLoad";

export interface TopologyOptions {
  /** Route the tunnel's own dial through a second config (front proxy). */
  chainEnabled: boolean;
  /** id of the config used as the chain hop (must differ from the connected one). */
  chainHopId: string | null;
  /** Load-balance across the connected config + picked extras. */
  balancerEnabled: boolean;
  balancerStrategy: BalancerStrategy;
  /** ids of EXTRA configs in the pool (the connected config is always member #1). */
  balancerExtraIds: string[];
}

export const DEFAULT_TOPOLOGY_OPTIONS: TopologyOptions = {
  chainEnabled: false,
  chainHopId: null,
  balancerEnabled: false,
  balancerStrategy: "random",
  balancerExtraIds: [],
};

export const TOPOLOGY_OPTIONS_STORAGE_KEY = "memento-topology-options";

/** Merge saved (possibly older/partial) JSON over the defaults, forward-compat. */
export function loadTopologyOptions(): TopologyOptions {
  try {
    const saved = localStorage.getItem(TOPOLOGY_OPTIONS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const merged: TopologyOptions = { ...DEFAULT_TOPOLOGY_OPTIONS, ...parsed };
      // Defensive normalization: arrays stay arrays, ids stay strings, the
      // strategy must be one of the four known values.
      if (!Array.isArray(merged.balancerExtraIds)) merged.balancerExtraIds = [];
      merged.balancerExtraIds = merged.balancerExtraIds
        .filter((id): id is string => typeof id === "string")
        .slice(0, MAX_BALANCER_EXTRAS);
      if (!["random", "roundRobin", "leastPing", "leastLoad"].includes(merged.balancerStrategy)) {
        merged.balancerStrategy = "random";
      }
      if (typeof merged.chainHopId !== "string") merged.chainHopId = null;
      return merged;
    }
  } catch { /* storage unavailable (private mode/quota) — fall through */ }
  return { ...DEFAULT_TOPOLOGY_OPTIONS };
}

/* ------------------------------------------------------------------ */
/*  Tag scheme (single source of truth for generators AND the stats)  */
/* ------------------------------------------------------------------ */

/** Tag of the chain-carrier outbound (the hop the tunnel dials through).
 *  Deliberately does NOT start with "proxy" — the Xray balancer selector
 *  is a PREFIX match, and the carrier must never join the pool. */
export const CHAIN_HOP_TAG = "chain-hop";

/** Tag of the sing-box / Xray balancer group. */
export const BALANCER_TAG = "balancer";

/** Pool cap: primary + up to 8 extras. Keeps configs, UI lists and the
 *  stats-tag list bounded (the main-process sanitizer caps at 16). */
export const MAX_BALANCER_EXTRAS = 8;

/**
 * Member tags for a balancer pool: the primary outbound keeps its
 * historical tag "proxy" (byte-compat + every legacy pin), extras are
 * "proxy2".."proxyN" in pool order. The Xray selector ["proxy"] is a
 * PREFIX match, so one selector covers the whole family — verified against
 * the real binary (probe P1-P4, chain-hop/memento-frag-dialer excluded).
 */
export function balancerMemberTags(extrasCount: number): string[] {
  const n = Math.max(0, Math.min(MAX_BALANCER_EXTRAS, Math.floor(extrasCount) || 0));
  const tags: string[] = ["proxy"];
  for (let i = 2; i <= n + 1; i++) tags.push(`proxy${i}`);
  return tags;
}

/**
 * The per-outbound stats tags the MAIN PROCESS must sum for a topology —
 * the proportional extension of the historical ">>>proxy>>>traffic>>>"
 * counting (xray.ts). Without this, a balancer selecting "proxy2" would
 * silently report zero speed/totals (the exact failure the C4 review
 * flagged).
 *
 *   single/chain -> ["proxy"]          (chain: the carrier "chain-hop" is
 *                                       NEVER counted — it would double-
 *                                       count every byte; live-proven)
 *   balancer     -> every member tag   (each connection is attributed to
 *                                       exactly ONE selected member; the
 *                                       balancer itself has no counters)
 */
export function trafficTagsFor(opts: TopologyOptions, resolvedExtrasCount: number): string[] {
  return opts.balancerEnabled
    ? balancerMemberTags(resolvedExtrasCount)
    : ["proxy"];
}

/* ------------------------------------------------------------------ */
/*  Generator input (resolved by the connect flow, pure builders)     */
/* ------------------------------------------------------------------ */

/**
 * What the connect flow hands the PURE generators after validating the
 * topology against the live config list: the resolved hop config and the
 * resolved extra configs (already capped/deduped/core-checked). The
 * generators stay pure — no store access, no id lookup — and treat an
 * absent/invalid field as "feature off" (defensive, byte-compat default).
 */
export interface TopologyInput {
  /** Chain carrier config (dials the tunnel's own TCP through it). */
  chainHop?: ParsedConfig | null;
  /** Balancer pool extras (primary not included). */
  balancerExtras?: ParsedConfig[];
  /** Balancer strategy; defaults to "random" when absent/unknown
   *  (defense-in-depth — the connect flow always sends the real one). */
  balancerStrategy?: BalancerStrategy;
}

export const DEFAULT_TOPOLOGY_INPUT: TopologyInput = { chainHop: null, balancerExtras: [] };
