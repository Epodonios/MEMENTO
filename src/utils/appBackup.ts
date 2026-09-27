/**
 * appBackup.ts (Phase D3, item 7 — backup / restore)
 *
 * MEMENTO keeps every user datum in localStorage blobs (configs, subscription
 * groups, editor prefs, connection mode/ports, auto-failover, builder
 * options). Backup = pack those keys into ONE versioned JSON file; restore =
 * validate + write the blobs back and reload so the store's init() readers
 * pick everything up.
 *
 * STANDALONE module (no store import) — the same esbuild-friendliness rule
 * as builderOptions.ts, so the smoke harness can bundle and exercise the
 * real validation logic without zustand/localStorage.
 */

export const BACKUP_FORMAT = "memento-backup";
export const BACKUP_VERSION = 1;

/** The localStorage keys that carry user state (order = documentation). */
export const BACKUP_KEYS = [
  "memento-configs",
  "memento-subscription-groups",
  "v2ray-editor-theme",
  "v2ray-editor-language",
  "v2ray-editor-notification",
  "memento-conn-mode",
  "memento-conn-socks-port",
  "memento-conn-http-port",
  "memento-auto-failover",
  "memento-builder-options",
] as const;

export interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  counts: { configs: number; groups: number };
  data: Partial<Record<(typeof BACKUP_KEYS)[number], string>>;
}

/** Build the versioned backup object from the CURRENT localStorage. */
export function collectBackup(now = new Date()): BackupFile {
  const data: BackupFile["data"] = {};
  for (const key of BACKUP_KEYS) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) data[key] = v;
    } catch { /* storage unavailable — skip key */ }
  }
  let configs = 0, groups = 0;
  try { configs = (JSON.parse(data["memento-configs"] || "[]") as unknown[]).length; } catch { /* leave 0 */ }
  try { groups = (JSON.parse(data["memento-subscription-groups"] || "[]") as unknown[]).length; } catch { /* leave 0 */ }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    counts: { configs, groups },
    data,
  };
}

/** Suggested file name: memento-backup-YYYYMMDD-HHmmss.json */
export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `memento-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.json`;
}

/**
 * Validate a backup file's text. Returns the parsed file or throws with a
 * human-readable reason. Defensive on purpose: restore REPLACES user state.
 */
export function parseBackup(text: string): BackupFile {
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new Error("Not a valid JSON file"); }
  const o = obj as Partial<BackupFile>;
  if (!o || typeof o !== "object" || o.format !== BACKUP_FORMAT) {
    throw new Error(`Wrong file — expected format "${BACKUP_FORMAT}"`);
  }
  if (typeof o.version !== "number" || o.version < 1 || o.version > BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${String(o.version)}`);
  }
  if (!o.data || typeof o.data !== "object") throw new Error("Backup has no data section");
  const clean: BackupFile["data"] = {};
  for (const key of BACKUP_KEYS) {
    const v = (o.data as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length <= 32 * 1024 * 1024) clean[key] = v;
  }
  return {
    format: BACKUP_FORMAT,
    version: o.version,
    exportedAt: typeof o.exportedAt === "string" ? o.exportedAt : "",
    counts: {
      configs: Number(o.counts?.configs) || 0,
      groups: Number(o.counts?.groups) || 0,
    },
    data: clean,
  };
}

/**
 * Write a validated backup back into localStorage. Returns how many keys
 * were restored. The caller MUST reload the app afterwards so the store's
 * init() re-reads everything (a live core is NOT touched by a restore, but
 * its UI state is rebuilt by the reload).
 */
export function applyBackup(file: BackupFile): number {
  let restored = 0;
  for (const key of BACKUP_KEYS) {
    const v = file.data[key];
    try {
      if (v === undefined) continue; // key absent in the backup = keep current
      localStorage.setItem(key, v);
      restored++;
    } catch { /* storage unavailable/quota — count only what really landed */ }
  }
  return restored;
}

/** Trigger the browser download of the backup JSON (Electron + browser safe). */
export function downloadBackup(file: BackupFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
