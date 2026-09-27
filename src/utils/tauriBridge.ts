/**
 * Shared helpers for talking to the desktop shell.
 *
 * MEMENTO is dual-shell: it runs inside the legacy Tauri 2.0 build
 * (src-tauri/, kept for rollback) AND inside the new Electron build
 * (electron-app/). Every component must import from here instead of
 * touching either shell's API directly — that's what makes the migration
 * a drop-in swap.
 *
 *   Tauri    -> window.__TAURI_INTERNALS__.invoke + @tauri-apps plugins
 *   Electron -> window.electronAPI.invoke (preload.ts contextBridge)
 *   Browser  -> graceful nulls / window.open fallbacks (dev-in-tab mode)
 */

/** Detect the legacy Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Detect the Electron desktop shell (preload.ts exposed electronAPI). */
export function isElectron(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).electronAPI?.invoke === "function" &&
    (window as any).electronAPI?.isElectron === true
  );
}

/** True inside ANY compiled desktop shell (Tauri OR Electron). */
export function isDesktop(): boolean {
  return isTauri() || isElectron();
}

/**
 * Call a desktop IPC command. Command names and argument keys are identical
 * in both shells (see electron-app/electron/ipc.ts). Returns null when
 * running as a plain web page (browser dev mode).
 */
export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  if (isElectron()) {
    try {
      return await (window as any).electronAPI.invoke(cmd, args);
    } catch (e: any) {
      // 3.1.8 (user request #4): EVERY failed IPC call lands in the main
      // log — inline (not via errorLog) to avoid an import cycle.
      try {
        void (window as any).electronAPI.invoke("log_event", {
          level: "error",
          scope: "ipc",
          message: `invoke '${cmd}' failed: ${String(e?.message || e)}`.slice(0, 1200),
        });
      } catch {
        /* best-effort — never mask the original error */
      }
      throw new Error(e?.message || String(e));
    }
  }
  if (isTauri()) {
    try {
      // @ts-expect-error injected at runtime by Tauri
      return await window.__TAURI_INTERNALS__.invoke(cmd, args);
    } catch (e: any) {
      throw new Error(e?.toString?.() || String(e));
    }
  }
  return null;
}

/**
 * Open a URL (http/https/mailto) in the user's default browser / mail
 * client. In Tauri, plain <a href target="_blank"> links are blocked by the
 * webview's navigation guard; in Electron they would open inside the
 * window — both shells need an explicit openExternal. In the browser we
 * fall back to window.open.
 */
export async function openExternalLink(url: string): Promise<void> {
  if (isElectron()) {
    try {
      await (window as any).electronAPI.openExternal(url);
      return;
    } catch (e) {
      console.warn("[MEMENTO] openExternal via electronAPI failed, falling back:", e);
    }
  }
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (e) {
      console.warn("[MEMENTO] openUrl via plugin-opener failed, falling back:", e);
    }
  }
  // Browser / fallback
  window.open(url, "_blank", "noopener,noreferrer");
}

/* ================================================================== */
/*  Unified window API (custom title bar)                              */
/* ================================================================== */

export interface DesktopWindowApi {
  minimize(): void;
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  close(): void;
  /** Subscribe to resize/maximize/unmaximize. Returns unsubscribe. */
  onResized(cb: () => void): () => void;
  /** Tauri-only drag fallback; undefined in Electron (CSS handles it). */
  startDragging?(): void;
}

/**
 * Normalized window controls for the custom title bar. Returns null in a
 * plain browser. Internally maps to window.electronAPI.window (Electron)
 * or @tauri-apps/api/window (Tauri) with identical behavior.
 */
export async function getDesktopWindow(): Promise<DesktopWindowApi | null> {
  if (isElectron()) {
    return (window as any).electronAPI.window as DesktopWindowApi;
  }
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    return {
      minimize: () => {
        w.minimize().catch(() => {});
      },
      toggleMaximize: async () => {
        await w.toggleMaximize();
      },
      isMaximized: () => w.isMaximized(),
      close: () => {
        w.close().catch(() => {});
      },
      onResized: (cb: () => void) => {
        w.onResized(() => cb()).catch(() => {});
        return () => {};
      },
      startDragging: () => {
        w.startDragging().catch(() => {});
      },
    };
  }
  return null;
}

/**
 * R3: subscribe to a main-process progress event (Update Center downloads,
 * Scanner scans, MHRV operations). Electron-only — returns a no-op
 * unsubscribe in the other shells (their flows never emit these events).
 */
export function onMainEvent(channel: string, cb: (payload: unknown) => void): () => void {
  if (isElectron() && typeof (window as any).electronAPI?.onMainEvent === "function") {
    try {
      return (window as any).electronAPI.onMainEvent(channel, cb) as () => void;
    } catch {
      return () => {};
    }
  }
  return () => {};
}
