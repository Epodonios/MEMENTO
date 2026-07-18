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

import { useStore } from "../store";
import { generateV2RayConfig } from "./v2rayConfig";
import { isTauri, tauriInvoke } from "./tauriBridge";
import toast from "react-hot-toast";

export async function connectToConfig(configId: string, opts?: { silent?: boolean }): Promise<boolean> {
  const state = useStore.getState();
  const config = state.configs.find(c => c.id === configId && c.isValid);

  if (!config) {
    if (!opts?.silent) toast.error("Config not found or invalid");
    return false;
  }

  const v2rayConfig = generateV2RayConfig(
    config,
    "socks-http",
    state.connSocksPort,
    state.connHttpPort,
    state.connApiPort,
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
    });

    if (result) {
      if (state.connMode === "system-proxy") {
        await tauriInvoke("set_system_proxy", { socksPort: state.connSocksPort });
      }
      useStore.getState().setConnState({
        connStatus: "connected",
        connPid: result.pid,
        connConfigId: configId,
        connStartedAt: Date.now(),
        connDownloadBytes: 0,
        connUploadBytes: 0,
        connLogs: [],
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
    useStore.getState().setConnState({ connStatus: "error" });
    if (!opts?.silent) {
      const msg = String(err?.message || err || "Unknown error");
      toast.error(msg, { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
    }
    return false;
  }
}

export async function disconnectConnection(opts?: { manual?: boolean }): Promise<void> {
  const state = useStore.getState();
  try {
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

export { isTauri };
