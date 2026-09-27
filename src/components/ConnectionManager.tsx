import { useEffect, useRef } from "react";
import { useStore, configCore } from "../store";
import { t } from "../i18n";
import { isDesktop, tauriInvoke } from "../utils/tauriBridge";
import { connectToConfig, pickFailoverCandidate } from "../utils/connectionActions";
import { pushTrafficSample, resetTrafficHistory } from "../utils/trafficHistory";
import toast from "react-hot-toast";

/**
 * Always-mounted, invisible watcher for the live VPN connection.
 *
 * Rendered once at the App root (not inside any tab), so it keeps polling
 * xray-core's real status/logs/traffic and running the auto-failover logic
 * no matter which tab the user is currently looking at. This is what makes
 * the "Connected" state stay accurate even after navigating away from the
 * Connection tab and back (previously this polling lived inside
 * ConnectionTab itself and stopped the instant the tab unmounted).
 */
export default function ConnectionManager() {
  const status = useStore(s => s.connStatus);
  const failoverInProgress = useRef(false);
  const pollInProgress = useRef(false);
  // Phase D1 (live speed): the traffic counters are CUMULATIVE bytes — the
  // speed shown in the UI is the delta between two consecutive polls divided
  // by the real elapsed time. Refs (not state) so the poll loop stays
  // closure-free; baselines reset whenever the connection identity changes.
  const prevTrafficRef = useRef<{ down: number; up: number; at: number } | null>(null);

  // Phase D4: push connection state into the MAIN process so the tray menu
  // label honestly reads Connect vs Disconnect (tray_status_set ->
  // updateTrayStatus). "connecting" counts as active because the shared
  // toggle semantics treat it as disconnectable. Fire-and-forget — a failed
  // push costs nothing, the menu rebuilds on the next real flip.
  useEffect(() => {
    const connected = status === "connected" || status === "connecting";
    tauriInvoke("tray_status_set", { connected })?.catch(() => {});
  }, [status]);

  useEffect(() => {
    if (status !== "connected" || !isDesktop()) {
      // Leaving the connected state (disconnect/error/aether takeover):
      // zero the speed counters so the UI never shows a stale KB/s value.
      prevTrafficRef.current = null;
      // Phase C1: the chart's ring must not inherit a dead session's shape.
      resetTrafficHistory();
      const cur = useStore.getState();
      if (cur.connDownSpeed !== 0 || cur.connUpSpeed !== 0) {
        cur.setConnState({ connDownSpeed: 0, connUpSpeed: 0 });
      }
      return;
    }
    prevTrafficRef.current = null;
    resetTrafficHistory(); // Phase C1: fresh session -> fresh chart window

    let cancelled = false;
    // Give xray-core a moment after connecting before we start treating a
    // "not running" status as a real, unexpected disconnect.
    const graceUntil = Date.now() + 2500;

    const poll = async () => {
      if (cancelled || pollInProgress.current) return;
      pollInProgress.current = true;
      const { connApiPort } = useStore.getState();

      try {
        const [statusRes, logs, traffic] = await Promise.all([
          tauriInvoke<any>("get_xray_status"),
          tauriInvoke<string[]>("get_xray_logs"),
          tauriInvoke<any>("get_xray_traffic", { apiPort: connApiPort }),
        ]);
        if (cancelled) return;

        const current = useStore.getState();
        if (logs && (logs.length !== current.connLogs.length || logs[logs.length - 1] !== current.connLogs[current.connLogs.length - 1])) {
          current.setConnState({ connLogs: logs });
        }
        if (traffic) {
          const down = traffic.downlink || 0;
          const up = traffic.uplink || 0;
          if (down !== current.connDownloadBytes || up !== current.connUploadBytes) {
            current.setConnState({ connDownloadBytes: down, connUploadBytes: up });
          }

          // Phase D1: derive bytes/second from the counter delta. Edge cases:
          //  - first poll of a session (no baseline) -> speed 0, just arm it;
          //  - counter went BACKWARDS (core restart / failover re-connect)
          //    -> treat as a fresh baseline, never report a negative speed;
          //  - aether -> get_xray_traffic already answers {0,0}, so this
          //    path simply computes 0 and the Aether tab labels the gap.
          const now = Date.now();
          const prev = prevTrafficRef.current;
          let downSpeed = 0;
          let upSpeed = 0;
          if (prev && now > prev.at && down >= prev.down && up >= prev.up) {
            const dt = (now - prev.at) / 1000;
            downSpeed = Math.max(0, Math.round((down - prev.down) / dt));
            upSpeed = Math.max(0, Math.round((up - prev.up) / dt));
          }
          prevTrafficRef.current = { down, up, at: now };
          if (downSpeed !== current.connDownSpeed || upSpeed !== current.connUpSpeed) {
            current.setConnState({ connDownSpeed: downSpeed, connUpSpeed: upSpeed });
          }
          // Phase C1 (item 5): feed the chart's standalone slice — one sample
          // per poll, reusing the numbers computed above. Zero extra IPC;
          // only the mounted TrafficChart re-renders on this push.
          pushTrafficSample(downSpeed, upSpeed, now);
        }

        if (Date.now() < graceUntil) return;

        if (statusRes && !statusRes.running) {
          const state = useStore.getState();
          const wasManual = state.connManualStop;
          const failedConfigId = state.connConfigId;

          useStore.getState().setConnState({ connStatus: "disconnected", connPid: null });

          if (wasManual) return;

          if (state.autoFailover.enabled && failedConfigId && !failoverInProgress.current) {
            failoverInProgress.current = true;
            try {
              const nextId = pickFailoverCandidate(failedConfigId);
              if (nextId) {
                toast("Connection dropped — automatically switching to another config…", { icon: "🔁", duration: 5000 });
                await connectToConfig(nextId, { silent: false });
              } else {
                toast.error("Connection dropped, and no failover config is available.");
              }
            } finally {
              failoverInProgress.current = false;
            }
          } else {
            // Core-aware toast (user-approved): the message is labeled from
            // the status response's `core` field — which get_xray_status now
            // reports as the ATTEMPTED core even once the core has stopped,
            // i.e. exactly at this crash moment. Fallbacks: the connected
            // config's core (mirrors the main-side routing decision; covers
            // the browser-preview mock), then the legacy xray default.
            const cfg = failedConfigId
              ? state.configs.find(c => c.id === failedConfigId)
              : undefined;
            const coreKind:
              | "xray"
              | "sing-box"
              | "aether" =
              statusRes.core === "sing-box" || statusRes.core === "xray" || statusRes.core === "aether"
                ? statusRes.core
                : cfg
                  ? configCore(cfg)
                  : "xray";
            const coreLabel = coreKind === "sing-box" ? "sing-box" : coreKind === "aether" ? "Aether" : "Xray-core";
            toast.error(
              t("connection.stoppedUnexpectedly", state.language).replace("{core}", coreLabel),
              { duration: 6000 },
            );
          }
        }
      } catch {
        /* ignore transient IPC errors — next poll will retry */
      } finally {
        pollInProgress.current = false;
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status]);

  return null;
}
