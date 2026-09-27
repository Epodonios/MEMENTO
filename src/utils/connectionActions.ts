/**
 * Centralized VPN connect/disconnect/failover logic.
 *
 * This used to live entirely inside ConnectionTab's local component state,
 * which caused a real bug: switching away from the Connection tab and back
 * unmounted/remounted the component, silently resetting the displayed
 * status to "disconnected" even though xray-core was still tunneling all
 * traffic in the background. By keeping the actual connection state in the
 * global Zustand store and driving it from this shared module, every part
 * of the app (ConfigsTab's quick-connect button, ConnectionTab, and the
 * always-mounted ConnectionManager background watcher) reads/writes the
 * exact same source of truth.
 */

import { useStore, configCore } from "../store";
import { generateV2RayConfig } from "./v2rayConfig";
import { generateSingBoxConfig } from "./singBoxConfig";
import { requiredGeoFiles } from "./routingOptions";
import {
  MAX_BALANCER_EXTRAS, trafficTagsFor,
} from "./topologyOptions";
import { isDesktop, isTauri, tauriInvoke } from "./tauriBridge";
import toast from "react-hot-toast";
import type { GeoStatus } from "./routingOptions";
import type { ParsedConfig } from "../store";

export async function connectToConfig(configId: string, opts?: { silent?: boolean }): Promise<boolean> {
  const state = useStore.getState();
  const config = state.configs.find(c => c.id === configId && c.isValid);

  if (!config) {
    if (!opts?.silent) toast.error("Config not found or invalid");
    return false;
  }

  // Task 11 dual-core routing: hysteria2/tuic generate a sing-box config
  // (sent through the SAME start_xray invoke — the main process detects the
  // core from the JSON itself); everything else stays byte-identical.
  const core = configCore(config);

  /* ---------------- Phase C4 (item ⑥): topology resolution (FIRST) ------
   * Resolves the chain hop / balancer members from the persisted ids and
   * validates them BEFORE the geo gate (fail fast — no point waiting out a
   * geo download when the topology itself is broken). Hard rules:
   *   - a hop must exist, be valid, and run on the SAME core as the
   *     connection (xray/sing-box configs cannot be mixed — each generator
   *     only knows its own protocols; a mixed chain would be fatal at core
   *     startup, the exact "connects then dies" class C3 closed);
   *   - the hop being the CONNECTED config itself is the auto-failover
   *     case (the replacement may be the configured hop) — degrade to a
   *     plain connection with an honest toast instead of aborting;
   *   - balancer members: deduped against the primary + each other, capped
   *     at MAX_BALANCER_EXTRAS, invalid/wrong-core picks dropped with an
   *     honest toast; zero usable picks or zero picks at all -> abort.
   * Stats: the start_xray invoke carries trafficTagsFor(topology) so the
   * main process sums EVERY pool member's counters — without it a balancer
   * selecting proxy2 would silently zero the C1 speed chart and the D1
   * totals (the exact failure this batch was reviewed for). */
  const topo = state.topologyOptions;
  let chainHop: ParsedConfig | null = null;
  let balancerExtras: ParsedConfig[] = [];
  // Task E2 (approved scope decision): a ShadowTLS connection pairs a
  // transport outbound with its trojan primary — chain hop / balancer pool
  // would corrupt or orphan that pair, so a ShadowTLS MAIN runs plain-only.
  if (config.protocol === "shadowtls" && (topo.chainEnabled || topo.balancerEnabled)) {
    if (!opts?.silent) {
      toast.error("ShadowTLS connections run as a plain main connection — chain proxy and balancer are not supported for them yet.\nDisable Chain & Balancer in Routing → Chain & Balancer, or pick another config.", { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
    }
    return false;
  }
  if (topo.chainEnabled && topo.chainHopId) {
    if (topo.chainHopId === configId) {
      if (!opts?.silent) {
        toast("Chain hop equals the connected config — connecting without the chain", { icon: "ℹ️", duration: 6000 });
      }
    } else {
      const hop = state.configs.find(c => c.id === topo.chainHopId);
      if (!hop || !hop.isValid) {
        if (!opts?.silent) {
          toast.error("Chain proxy: the selected hop config no longer exists or is invalid — connect aborted.\nPick a different hop in Routing → Chain & Balancer.", { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
        }
        return false;
      }
      if (configCore(hop) !== core) {
        if (!opts?.silent) {
          toast.error(`Chain proxy: the hop runs on ${configCore(hop)} but this connection uses ${core} — the two cores cannot be mixed in one chain.\nPick a hop with a compatible protocol (same core as the connected config).`, { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
        }
        return false;
      }
      // Task E2 (approved scope decision): a ShadowTLS connection pairs a
      // transport outbound with its trojan primary and runs as the MAIN
      // connection only — as a hop it would silently lose the transport
      // outbound (the generator refuses to build it there), so it is
      // refused here with an honest toast instead.
      if (hop.protocol === "shadowtls") {
        if (!opts?.silent) {
          toast.error("Chain proxy: ShadowTLS connections pair a transport with their inner trojan and run as the main connection only — they cannot be a chain hop.\nPick a hysteria2 or tuic hop instead.", { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
        }
        return false;
      }
      chainHop = hop;
    }
  }
  if (topo.balancerEnabled) {
    const picked = topo.balancerExtraIds.slice(0, MAX_BALANCER_EXTRAS);
    const seen = new Set<string>([configId]);
    const dropped: string[] = [];
    for (const id of picked) {
      if (seen.has(id)) continue; // primary or duplicate pick — silently deduped
      seen.add(id);
      const c = state.configs.find(x => x.id === id);
      if (!c || !c.isValid) { dropped.push(`${id}: missing or invalid`); continue; }
      if (configCore(c) !== core) { dropped.push(`${c.name}: runs on ${configCore(c)}, pool needs ${core}`); continue; }
      // Task E2 (approved scope decision): ShadowTLS configs are main-
      // connection-only (transport + trojan pair) — dropped from a balancer
      // pool with the honest reason, exactly like a wrong-core pick.
      if (c.protocol === "shadowtls") { dropped.push(`${c.name}: ShadowTLS runs as a main connection only (transport + trojan pair), not as a pool member`); continue; }
      balancerExtras.push(c);
    }
    if (picked.length === 0) {
      if (!opts?.silent) {
        toast.error("Balancer is enabled but no member configs are picked — connect aborted.\nPick at least one extra member in Routing → Chain & Balancer.", { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
      }
      return false;
    }
    if (picked.length > 0 && balancerExtras.length === 0) {
      if (!opts?.silent) {
        toast.error(`Balancer: none of the picked members can join this pool — connect aborted.\n${dropped.join("\n")}`, { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
      }
      return false;
    }
    if (dropped.length > 0 && !opts?.silent) {
      toast(`Balancer: ${dropped.length} picked member(s) could not join the pool and were skipped.\n${dropped.join("\n")}`, { icon: "⚠️", duration: 8000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
    }
  }

  /* ---------------- Phase C3: geo-file gate (BEFORE any spawn) ----------
   * Geo-referencing routing options are FATAL at core startup when the
   * data files are missing (xray exits ~1-2s after launch). This gate
   * runs geo_ensure (download missing files) and verifies every required
   * file is on disk BEFORE start_xray; any failure aborts the connect
   * with the exact reason — never a doomed spawn. */
  let srsDir = useStore.getState().geoStatus?.srsDir ?? "";
  if (isDesktop()) {
    const needed = requiredGeoFiles(state.routingOptions, core);
    if (needed.length > 0) {
      // C3 fix (user-approved): re-entry guard — a second Connect click
      // (ConnectionTab button or ConfigsTab quick-connect) while the first
      // gate is still downloading must never start a parallel geo_ensure
      // download race. geoPreparing also drives the ConnectionTab
      // "Preparing geo data…" disabled button, so the UI is never silent
      // during a slow/censored download (up to ~120s per file).
      if (useStore.getState().geoPreparing) {
        if (!opts?.silent) {
          toast("Geo data preparation already in progress — one moment…", { icon: "⏳", duration: 4000 });
        }
        return false;
      }
      useStore.getState().setGeoPreparing(true);
      try {
        try {
          const family = core === "sing-box" ? "srs" : "xray";
          const res = await tauriInvoke<{ status: GeoStatus; errors: Record<string, string> }>("geo_ensure", { family });
          if (!res) throw new Error("geo_ensure returned nothing");
          useStore.getState().setGeoStatus(res.status);
          srsDir = res.status.srsDir ?? srsDir;
          const missing = needed.filter(n => !(res.status[core === "sing-box" ? "srs" : "xray"]?.[n]?.present));
          const errKeys = Object.keys(res.errors || {});
          if (missing.length > 0 || errKeys.length > 0) {
            const why = errKeys.length > 0
              ? errKeys.map(k => `${k}: ${res.errors[k]}`).join("; ")
              : `missing: ${missing.join(", ")}`;
            if (!opts?.silent) {
              toast.error(`Routing needs geo data files that are not available — connect aborted.\n${why}`, { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
            }
            useStore.getState().setConnState({ connStatus: "disconnected" });
            return false;
          }
        } catch (err) {
          if (!opts?.silent) {
            toast.error(`Geo data check failed — connect aborted.\n${String((err as Error)?.message || err)}`, { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
          }
          useStore.getState().setConnState({ connStatus: "disconnected" });
          return false;
        }
      } finally {
        // Cleared on EVERY path (gate passed / aborted / thrown) — a stuck
        // flag would permanently disable the Connect button.
        useStore.getState().setGeoPreparing(false);
      }
    }
  }

  const v2rayConfig = core === "sing-box"
    ? generateSingBoxConfig(
        config,
        state.connSocksPort,
        state.connHttpPort,
        state.connApiPort,
        // Phase D2 (item 9): builder toggles apply at connect time — the
        // generated JSON is what the core actually runs.
        state.builderOptions,
        // Phase C3 (items 1+2): routing presets/lists + DNS/FakeDNS + the
        // verified srs dir from the geo gate above.
        state.routingOptions,
        srsDir,
        // Phase C4 (item ⑥): resolved chain hop + balancer pool.
        { chainHop, balancerExtras, balancerStrategy: topo.balancerStrategy },
      )
    : generateV2RayConfig(
        config,
        "socks-http",
        state.connSocksPort,
        state.connHttpPort,
        state.connApiPort,
        state.builderOptions,
        state.routingOptions,
        // Phase C4 (item ⑥): resolved chain hop + balancer pool.
        { chainHop, balancerExtras, balancerStrategy: topo.balancerStrategy },
      );

  if (!v2rayConfig) {
    if (!opts?.silent) toast.error("Unsupported protocol for this config");
    return false;
  }

  useStore.getState().setConnState({
    connStatus: "connecting",
    connConfigId: configId,
    connManualStop: false,
  });

  try {
    const result = await tauriInvoke<any>("start_xray", {
      configJson: v2rayConfig.json,
      socksPort: state.connSocksPort,
      httpPort: state.connHttpPort,
      apiPort: state.connApiPort,
      // Phase C4: per-outbound stats tags for the main process (balancer
      // pool members; ["proxy"] otherwise). See topologyOptions.trafficTagsFor.
      trafficTags: trafficTagsFor(topo, balancerExtras.length),
    });

    if (result) {
      // Guard: only commit "connected" if THIS attempt is still the live
      // one. A disconnect (cancel) that landed between the main-process
      // grace check and this resolve must not flip the UI back to
      // "connected" — and the xray we just launched must be shut down
      // instead of running unowned with the system proxy set.
      const cur = useStore.getState();
      if (cur.connStatus !== "connecting" || cur.connConfigId !== configId) {
        try {
          await tauriInvoke("stop_xray");
        } catch {
          /* best-effort */
        }
        return false;
      }
      if (state.connMode === "system-proxy") {
        await tauriInvoke("set_system_proxy", { socksPort: state.connSocksPort });
      }
      // R3 task #2 (restored): the VPN Device (TUN) connection mode. The
      // core is now live — the TUN session tunnels into ITS local SOCKS
      // inbound. Refusals are honest (UAC denied, elevation failed,
      // wintun gate): the connection STAYS UP in SOCKS mode and the toast
      // says why; the system-proxy write is deliberately skipped (D6 —
      // the TUN adapter owns system routing, or nothing does).
      if (state.connMode === "tun") {
        try {
          await tauriInvoke("routing_start", {
            // 3.1.8 (field report #5): the ACTIVE server's address rides
            // along so the TUN engine can EXCLUDE it — without the bypass
            // the core's own packets to its server loop back into the
            // tunnel and NO traffic passes on xray/sing-box (Aether
            // self-protects via its AETHER_ROUTE_* env vars).
            bypassHost: config.address || null,
          });
        } catch (e: any) {
          toast.error(
            (state.language === "fa"
              ? "راه‌اندازی حالت TUN ناموفق بود:\n"
              : "VPN Device (TUN) failed to start:\n") + String(e?.message || e),
            { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } }
          );
        }
      }
      useStore.getState().setConnState({
        connStatus: "connected",
        connPid: result.pid,
        connConfigId: configId,
        connStartedAt: Date.now(),
        connDownloadBytes: 0,
        connUploadBytes: 0,
        connDownSpeed: 0, // Phase D1: fresh session -> speed counters start at zero
        connUpSpeed: 0,
        connLogs: [],
      });
      // Task 12: the main process just stopped a live Aether session
      // (three-way stopOtherCore) — keep the Aether tab's global state
      // truthful instead of leaving a stale "connected" badge there.
      useStore.getState().setAetherState({
        aetherStatus: "disconnected",
        aetherInfo: null,
      });
      if (!opts?.silent) toast.success("Connected ✓");
      return true;
    }

    // Browser (non-Tauri) mode — nothing to run, just surface the JSON.
    useStore.getState().setConnState({ connStatus: "disconnected" });
    if (!opts?.silent) {
      toast("Running in browser mode — copy the config JSON and run xray manually", {
        icon: "ℹ️",
        duration: 6000,
      });
    }
    return false;
  } catch (err: any) {
    // Guard: only surface "error" if THIS connect attempt is still the
    // live one. If the user cancelled (disconnected while "connecting") or
    // a newer connect attempt took over, the start_xray rejection (e.g.
    // "cancelled while starting") must not clobber the current state with
    // "error" — it used to end a manual cancel in a scary error state.
    const cur = useStore.getState();
    if (cur.connStatus === "connecting" && cur.connConfigId === configId) {
      cur.setConnState({ connStatus: "error" });
      if (!opts?.silent) {
        const msg = String(err?.message || err || "Unknown error");
        toast.error(msg, { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
      }
    }
    return false;
  }
}

export async function disconnectConnection(opts?: { manual?: boolean }): Promise<void> {
  const state = useStore.getState();
  try {
    // R3 task #2: in TUN mode the elevated helper owns the adapter — stop
    // the SESSION first and wait for the teardown, THEN stop the upstream
    // core (never the reverse: a dead upstream under a live adapter is
    // exactly what D6 forbids).
    if (state.connMode === "tun") {
      try { await tauriInvoke("routing_stop"); } catch { /* best-effort */ }
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        try {
          const rv = await tauriInvoke<any>("routing_status");
          if (!rv || rv.state === "disabled" || rv.state === "error" || rv.state === "idle") break;
        } catch {
          break; // status unavailable — do not block the disconnect forever
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    await tauriInvoke("stop_xray");
    if (state.connMode === "system-proxy") {
      await tauriInvoke("clear_system_proxy");
    }
  } catch {
    /* best-effort — always reset local state regardless */
  }
  useStore.getState().setConnState({
    connStatus: "disconnected",
    connPid: null,
    connStartedAt: null,
    connDownloadBytes: 0,
    connUploadBytes: 0,
    connDownSpeed: 0, // Phase D1: no live session -> no live speed
    connUpSpeed: 0,
    connLogs: [],
    connManualStop: opts?.manual ?? true,
  });
}

/**
 * Picks the best replacement config for auto-failover, honoring the user's
 * settings (same subscription group vs. any config, same port required or
 * not). Prefers configs with a known-good, low ping if any have been
 * tested, so failover tends to land on a fast server rather than a random
 * one.
 */
export function pickFailoverCandidate(failedConfigId: string): string | null {
  const state = useStore.getState();
  const failed = state.configs.find(c => c.id === failedConfigId);
  const { scope, matchPort } = state.autoFailover;

  let pool = state.configs.filter(c => c.isValid && c.id !== failedConfigId);

  if (scope === "group") {
    const group = state.subscriptionGroups.find(g => g.configIds.includes(failedConfigId));
    if (group) {
      const idSet = new Set(group.configIds);
      pool = pool.filter(c => idSet.has(c.id));
    } else {
      // The failed config wasn't part of any group — nothing sensible to
      // scope to, so fall back to considering all configs instead of
      // returning an empty pool.
    }
  }

  if (matchPort && failed) {
    pool = pool.filter(c => String(c.port) === String(failed.port));
  }

  pool.sort((a, b) => {
    const pa = state.pingResults[a.id];
    const pb = state.pingResults[b.id];
    const va = pa && pa.ping !== null && !pa.error ? pa.ping : Infinity;
    const vb = pb && pb.ping !== null && !pb.error ? pb.ping : Infinity;
    return va - vb;
  });

  return pool[0]?.id ?? null;
}

export { isTauri, isDesktop };
