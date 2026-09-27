/**
 * MEMENTO — 3.1.8 logging & error management core (user request #4:
 * "a logging system that logs EVERY error").
 *
 * ONE module owns the whole surface:
 *   - a structured entry shape {ts, level, scope, message, detail} with a
 *     bounded in-memory ring buffer (the UI reads the recent tail),
 *   - daily append-only log files under <logDir>/memento-YYYY-MM-DD.log
 *     (JSON Lines — trivially greppable, trivially exportable),
 *   - a 14-day retention sweep at first use (old files deleted),
 *   - process-level capture: uncaughtException / unhandledRejection are
 *     logged (and never silently swallowed) with their stacks,
 *   - the renderer forwards ITS errors through the log_event IPC into the
 *     exact same pipeline — one place holds every error of the app.
 *
 * ELECTRON-FREE by construction (node builtins only): the log directory is
 * injected by main.ts; dialogs/open-path live in ipc.ts. Failure to log is
 * itself logged once to stderr and otherwise ignored — the logger must
 * never become the crash it exists to record.
 */

export type MementoLogLevel = "debug" | "info" | "warn" | "error";

export interface MementoLogEntry {
  /** ISO timestamp. */
  ts: string;
  level: MementoLogLevel;
  /** Short subsystem tag: "main", "ipc", "core:xray", "renderer", … */
  scope: string;
  message: string;
  /** Optional structured detail (error stack, sanitized object…). */
  detail?: string | null;
}

const RING_LIMIT = 800;
const RETENTION_DAYS = 14;
const MAX_LINE = 16 * 1024; // one entry can never bloat the file unbounded

const ring: MementoLogEntry[] = [];
let logDir = "";
let sweepDone = false;
let writeFailures = 0;

function todayStamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function logFilePath(): string {
  return `${logDir}/memento-${todayStamp()}.log`;
}

function toLine(e: MementoLogEntry): string {
  const line = JSON.stringify({ ...e, detail: e.detail ? e.detail.slice(0, 4000) : undefined });
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 3) + "..." : line;
}

/** Best-effort retention sweep: delete daily files older than the window. */
function sweepOldLogs(): void {
  if (sweepDone || !logDir) return;
  sweepDone = true;
  try {
    const fs = require("fs") as typeof import("fs");
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    for (const f of fs.readdirSync(logDir)) {
      const m = /^memento-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (!m) continue;
      const t = new Date(`${m[1]}T00:00:00Z`).getTime();
      if (Number.isFinite(t) && t < cutoff) {
        try { fs.rmSync(`${logDir}/${f}`, { force: true }); } catch { /* best-effort */ }
      }
    }
  } catch {
    /* best-effort — the sweep must never break startup */
  }
}

/** Write ONE entry: ring + daily file. Never throws. */
export function mementoLog(
  level: MementoLogLevel,
  scope: string,
  message: string,
  detail?: string | null
): MementoLogEntry {
  const entry: MementoLogEntry = {
    ts: new Date().toISOString(),
    level,
    scope: String(scope || "main").slice(0, 64),
    message: String(message ?? "").slice(0, 2000),
    detail: detail ? String(detail).slice(0, 4000) : null,
  };
  ring.push(entry);
  if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);

  if (logDir) {
    try {
      const fs = require("fs") as typeof import("fs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(logFilePath(), toLine(entry) + "\n", "utf8");
      sweepOldLogs();
    } catch (e) {
      // The logger must never become the crash it exists to record —
      // complain once per 20 failures, then stay silent.
      if (writeFailures % 20 === 0) {
        try { console.warn("[MEMENTO-LOG] write failed:", e); } catch { /* ignore */ }
      }
      writeFailures++;
    }
  }
  return entry;
}

export const logDebug = (scope: string, message: string, detail?: string | null): MementoLogEntry =>
  mementoLog("debug", scope, message, detail);
export const logInfo = (scope: string, message: string, detail?: string | null): MementoLogEntry =>
  mementoLog("info", scope, message, detail);
export const logWarn = (scope: string, message: string, detail?: string | null): MementoLogEntry =>
  mementoLog("warn", scope, message, detail);
export const logError = (scope: string, message: string, detail?: string | null): MementoLogEntry =>
  mementoLog("error", scope, message, detail);

/** Error helper: message + stack in one call. Accepts unknown throws. */
export function logException(scope: string, err: unknown, prefix?: string): MementoLogEntry {
  const e = err as { message?: string; stack?: string } | null | undefined;
  const message = prefix ? `${prefix}: ${String(e?.message ?? err)}` : String(e?.message ?? err);
  return logError(scope, message, e?.stack ?? null);
}

/** The recent tail (oldest first) the Logs UI renders. */
export function recentLogs(limit?: unknown): MementoLogEntry[] {
  const n = Math.max(1, Math.min(RING_LIMIT, Number(limit) || 200));
  return ring.slice(-n);
}

/** Clear the in-memory ring (files are historical records — untouched). */
export function clearRecentLogs(): void {
  ring.length = 0;
}

/** The full recent tail as ONE exportable text blob (JSON Lines). */
export function logsText(limit?: unknown): string {
  return recentLogs(limit).map(toLine).join("\n");
}

/** Install the process-level capture + the injected log directory. */
export function initMementoLogger(dir: string): void {
  logDir = String(dir || "");
  sweepOldLogs();
  logInfo("main", `logger ready — dir: ${logDir}`);

  process.on("uncaughtException", (err) => {
    logException("process", err, "uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    const e = reason as { message?: string; stack?: string } | null | undefined;
    logError("process", `unhandledRejection: ${String(e?.message ?? reason)}`, e?.stack ?? null);
  });
}

/** The log directory (ipc.ts resolves the export/save dialog targets). */
export function mementoLogDir(): string {
  return logDir;
}
