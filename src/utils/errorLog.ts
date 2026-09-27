/**
 * MEMENTO — 3.1.8 renderer-side error capture (user request #4:
 * "a logging system that logs EVERY error").
 *
 * The MAIN process owns the log pipeline (logger.ts); this module is the
 * renderer's funnel into it:
 *   - window "error" + "unhandledrejection" events,
 *   - console.error / console.warn calls (React's error spam included),
 *   - failed tauriInvoke calls (the app's ONE IPC entry point — see
 *     tauriBridge.ts — so every IPC failure is recorded with its command).
 *
 * Safety properties:
 *   - fire-and-forget: logEvent never awaits, never throws, never toasts;
 *   - loop-guard: messages coming FROM the log pipeline are ignored;
 *   - rate-guard: at most ~30 events / 10 s reach main (a render-loop
 *     error storm can never flood the log file);
 *   - browser mode (no desktop shell) is a silent no-op.
 */
import { isDesktop, tauriInvoke } from "./tauriBridge";

export type ErrorLogLevel = "debug" | "info" | "warn" | "error";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10_000;
const SUPPRESSED_SCOPE = "error-log";

let installed = false;
let rateCount = 0;
let rateWindowStart = 0;

function underRateLimit(): boolean {
  const now = Date.now();
  if (now - rateWindowStart > RATE_WINDOW_MS) {
    rateWindowStart = now;
    rateCount = 0;
  }
  rateCount++;
  return rateCount <= RATE_LIMIT;
}

/** ONE entry point: push a log entry into the main-side pipeline. */
export function logEvent(
  level: ErrorLogLevel,
  scope: string,
  message: string,
  detail?: string | null
): void {
  if (!isDesktop()) return;
  if (!underRateLimit()) return;
  try {
    void tauriInvoke("log_event", {
      level,
      scope: scope || "renderer",
      message: String(message ?? ""),
      detail: detail ?? null,
    });
  } catch {
    /* best-effort — logging must never break the UI */
  }
}

/** Normalize an unknown throw into {message, stack}. */
function errParts(e: unknown): { message: string; detail: string | null } {
  if (e instanceof Error) return { message: e.message, detail: e.stack ?? null };
  const msg = typeof e === "string" ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
  return { message: msg, detail: null };
}

/**
 * Install the global capture. Call ONCE from App.tsx's module scope or a
 * top-level useEffect. Idempotent.
 */
export function installRendererErrorLogging(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (ev) => {
    // Resource-load errors carry no error object worth a stack.
    if (ev?.error) {
      const { message, detail } = errParts(ev.error);
      logEvent("error", "renderer", `window error: ${message || ev.message}`, detail ?? (ev.filename ? `${ev.filename}:${ev.lineno}` : null));
    } else if (ev?.message) {
      logEvent("error", "renderer", `window error: ${ev.message}`, ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : null);
    }
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const { message, detail } = errParts(ev?.reason);
    logEvent("error", "renderer", `unhandled rejection: ${message}`, detail);
  });

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      if (args[0] && typeof args[0] === "string" && args[0].includes(SUPPRESSED_SCOPE)) {
        /* loop-guard: never log the logger */
      } else {
        const first = args[0] instanceof Error ? args[0] : null;
        const { message, detail } = first
          ? errParts(first)
          : { message: args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ").slice(0, 1200), detail: null };
        logEvent("error", "renderer", `console.error: ${message}`, detail);
      }
    } catch {
      /* ignore */
    }
    origError(...args);
  };

  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    try {
      if (!(args[0] && typeof args[0] === "string" && args[0].includes(SUPPRESSED_SCOPE))) {
        const message = args
          .map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
          .join(" ")
          .slice(0, 800);
        logEvent("warn", "renderer", `console.warn: ${message}`, null);
      }
    } catch {
      /* ignore */
    }
    origWarn(...args);
  };

  logEvent("info", SUPPRESSED_SCOPE, "renderer error capture installed");
}
