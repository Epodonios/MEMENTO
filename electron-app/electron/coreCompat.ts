/**
 * MEMENTO — core-version compatibility layer (R3 task #6).
 *
 * USER BUG (fixed here): after updating xray-core from the Update Center
 * (v25.1.1 -> 26.3.27), EVERY connection failed with:
 *   "Failed to build TLS config. > common/errors: The feature
 *    "allowInsecure" has been removed and migrated to
 *    "pinnedPeerCertSha256". Please update config(s)..."
 * The generated configs carry fields that a NEWER core may have REMOVED —
 * the core hard-refuses the whole config and the user cannot connect at
 * all. The app must be FLEXIBLE WITH ANY UPDATE, not just this one.
 *
 * Two-layer defense (both generic, so a future core change self-heals):
 *
 *   L1 — PRE-SANITIZE (known removals): before the config is written to
 *        disk, walk the JSON and strip the fields that are known to have
 *        been removed by the detected core version (e.g. xray >= 26
 *        removed `allowInsecure`).
 *
 *   L2 — ERROR-DRIVEN ADAPTATION (any removal, even unknown ones): when a
 *        core exits immediately with a config-build error, parse the
 *        error text — xray names the feature it refuses ("The feature
 *        "allowInsecure" has been removed..."), sing-box names the field
 *        ("json: unknown field xyz") — map the named feature to a JSON
 *        key, deep-strip it, and retry the spawn ONCE per start. The
 *        applied adaptations are reported back so the UI can tell the
 *        user exactly what happened (in Persian/English, no mystery).
 *
 * ELECTRON-FREE by construction (node builtins only) so the gate scripts
 * can exercise it directly.
 */
import { spawnSync } from "child_process";
import fs from "fs";

/* ------------------------------------------------------------------ */
/* Version detection (cached per path+mtime)                           */
/* ------------------------------------------------------------------ */

export interface CoreVersionInfo {
  version: string | null; // semver-ish string, e.g. "26.3.27"
  raw: string; // first meaningful output line
}

const versionCache = new Map<string, { mtimeMs: number; info: CoreVersionInfo }>();

function statMtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return -1;
  }
}

/** Parse the first "N[.N[.N...]]" token from a core's version output. */
export function parseCoreVersion(output: string): string | null {
  const m = String(output).match(/\b(\d{1,3}(?:\.\d{1,3}){1,4}(?:[-.][A-Za-z0-9.]+)?)\b/);
  return m ? m[1] : null;
}

/** Run `<core> version` (xray/sing-box spelling differs) and parse it.
 *  Never throws; a failed probe yields version:null (L1 then applies the
 *  most conservative known-removal set — L2 still self-heals live). */
export function detectCoreVersion(
  exePath: string,
  kind: "xray" | "sing-box" | "aether"
): CoreVersionInfo {
  const mtime = statMtime(exePath);
  const cached = versionCache.get(exePath);
  if (cached && cached.mtimeMs === mtime) return cached.info;

  const info: CoreVersionInfo = { version: null, raw: "" };
  try {
    // xray: `xray version` | sing-box: `sing-box version` | aether: `--version`
    const args = kind === "aether" ? ["--version"] : ["version"];
    const res = spawnSync(exePath, args, {
      timeout: 8000,
      encoding: "utf8",
      windowsHide: true,
    });
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
    info.raw = out.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    info.version = parseCoreVersion(out);
  } catch {
    /* keep version:null */
  }
  versionCache.set(exePath, { mtimeMs: mtime, info });
  return info;
}

/** Numeric semver compare ("26.3.27" vs "25.1.1"). Non-semver -> null. */
export function semverAtLeast(version: string | null, ref: string): boolean | null {
  if (!version) return null;
  const num = (s: string) =>
    s
      .split(".")
      .map((p) => parseInt(p, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const a = num(version);
  const b = num(ref);
  if (!a.length || !b.length) return null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Generic deep key stripper                                           */
/* ------------------------------------------------------------------ */

export interface StripResult {
  config: unknown;
  removed: string[]; // human-readable "path (key)" entries
}

/** Deep-walk a JSON tree and delete EVERY key whose name matches one of
 *  the given key names (case-insensitive, exact match) — at any nesting
 *  level, inside objects AND arrays of objects. Returns a new tree. */
export function deepStripKeys(root: unknown, keys: string[]): StripResult {
  const lower = new Set(keys.map((k) => k.toLowerCase()));
  const removed: string[] = [];
  const walk = (node: unknown, pathStr: string): unknown => {
    if (Array.isArray(node)) {
      return node.map((v, i) => walk(v, `${pathStr}[${i}]`));
    }
    if (node && typeof node === "object") {
      const src = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) {
        if (lower.has(k.toLowerCase())) {
          removed.push(`${pathStr ? pathStr + "." : ""}${k}`);
          continue; // DROP the removed feature key
        }
        out[k] = walk(v, pathStr ? `${pathStr}.${k}` : k);
      }
      return out;
    }
    return node;
  };
  return { config: walk(root, ""), removed };
}

/* ------------------------------------------------------------------ */
/* L1 — known removals (per core, per version threshold)               */
/* ------------------------------------------------------------------ */

/**
 * xray-core 26.x removed `allowInsecure` (all TLS-ish settings blocks)
 * and migrated it to `pinnedPeerCertSha256`. The field name is identical
 * in tlsSettings/realitySettings — one deep strip covers every location.
 */
export function knownRemovedKeysFor(
  kind: "xray" | "sing-box" | "aether",
  version: string | null
): string[] {
  if (kind === "xray") {
    // >= 24.9.30 deprecated, 26.x REMOVED (hard error). Applying the
    // strip for any >= 24.9 is safe: a core that still accepts the field
    // loses nothing (allowInsecure=false was the app default anyway).
    const atLeast = semverAtLeast(version, "24.9.0");
    if (atLeast !== false) return ["allowInsecure"];
    return [];
  }
  if (kind === "sing-box") {
    // 1.13/1.14 removed the legacy `outbounds[].tls.insecure` alias? No —
    // insecure still exists. Nothing known-removed yet; empty by default.
    return [];
  }
  return [];
}

/** L1 entry point: pre-sanitize a config for the detected core. */
export function sanitizeCoreConfig(
  kind: "xray" | "sing-box" | "aether",
  version: string | null,
  configText: string
): { configText: string; removed: string[] } {
  const keys = knownRemovedKeysFor(kind, version);
  if (!keys.length) return { configText, removed: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    return { configText, removed: [] }; // not ours to fix here
  }
  const res = deepStripKeys(parsed, keys);
  if (!res.removed.length) return { configText, removed: [] };
  return { configText: JSON.stringify(res.config, null, 2), removed: res.removed };
}

/* ------------------------------------------------------------------ */
/* L2 — error-driven adaptation                                        */
/* ------------------------------------------------------------------ */

/** Feature-name fragments the cores use when refusing a config. Each
 *  entry maps an error-text pattern to the JSON key(s) to strip. Ordered:
 *  the FIRST matching pattern wins (most specific). */
const ERROR_KEY_PATTERNS: Array<{ re: RegExp; keys: string[] }> = [
  {
    // xray: The feature "allowInsecure" has been removed and migrated to "pinnedPeerCertSha256"
    re: /The feature\s+"([A-Za-z0-9_-]+)"\s+has been removed/i,
    keys: [],
  }, // handled specially below (uses the captured feature name)
  {
    re: /json:\s*unknown field\s+"?([A-Za-z0-9_.-]+)"?/i, // sing-box / go json
    keys: [],
  },
  {
    re: /unknown field\s+"?([A-Za-z0-9_.-]+)"?/i,
    keys: [],
  },
  {
    re: /field\s+([A-Za-z0-9_.-]+)\s+is (?:not )?(?:allowed|supported|known)/i,
    keys: [],
  },
  {
    re: /(?:unsupported|unknown|deprecated|removed)\s+(?:field|feature|option)\s+"?([A-Za-z0-9_.-]+)"?/i,
    keys: [],
  },
];

/** Extract the JSON key(s) to strip from a core's error text. */
export function keysFromErrorText(errorText: string): string[] {
  const text = String(errorText || "");
  const special = text.match(/The feature\s+"([A-Za-z0-9_-]+)"\s+has been removed/i);
  if (special) return [special[1]];
  for (const p of ERROR_KEY_PATTERNS) {
    const m = text.match(p.re);
    if (m && m[1]) return [m[1]];
  }
  // xray's "failed to build TLS config" without a named feature — the
  // historical default: the allowInsecure family.
  if (/failed to build (?:TLS|stream) config/i.test(text)) return ["allowInsecure"];
  return [];
}

/** Is this output a CONFIG-BUILD failure (retry-able by adaptation)? */
export function isConfigBuildError(output: string): boolean {
  return /failed to (?:load config|build (?:outbound|inbound|TLS|stream|transport) config|build config)|infra\/conf|json:\s*unknown field|unknown field|has been removed|failed to parse (?:json|config)/i.test(
    String(output || "")
  );
}

/** L2 entry point: adapt a config based on the core's own error output.
 *  Returns null when the error text maps to nothing (do not retry). */
export function adaptCoreConfigFromError(
  configText: string,
  errorText: string
): { configText: string; removed: string[] } | null {
  const keys = keysFromErrorText(errorText);
  if (!keys.length) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    return null;
  }
  const res = deepStripKeys(parsed, keys);
  if (!res.removed.length) return null; // nothing matched — don't loop
  return { configText: JSON.stringify(res.config, null, 2), removed: res.removed };
}
