import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { isTauri, tauriInvoke } from "../utils/tauriBridge";
import { connectToConfig, pickFailoverCandidate } from "../utils/connectionActions";
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

  useEffect(() => {
    if (status !== "connected" || !isTauri()) return;

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
            toast.error("xray-core stopped unexpectedly. The connection was dropped.", { duration: 6000 });
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
