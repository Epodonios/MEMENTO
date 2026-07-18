/**
 * Shared helpers for talking to the Tauri desktop shell.
 * Every component should import from here instead of re-implementing
 * isTauri()/invoke() locally (previously duplicated in ConnectionTab).
 */

/** Detect if running inside Tauri (real desktop shell) vs plain browser. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Call a Tauri IPC command. Returns null if not running inside Tauri. */
export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    // @ts-expect-error injected at runtime by Tauri
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  } catch (e: any) {
    throw new Error(e?.toString?.() || String(e));
  }
}

/**
 * Open a URL (http/https/mailto) in the user's default browser / mail
 * client. Inside Tauri, plain <a href target="_blank"> links are blocked
 * by the webview's navigation guard and silently do nothing — we must use
 * the `opener` plugin instead. In the browser, we fall back to window.open.
 */
export async function openExternalLink(url: string): Promise<void> {
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
