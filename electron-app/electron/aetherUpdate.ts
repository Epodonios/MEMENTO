/**
 * MEMENTO — Aether pin-per-version update service (Phase C6, Option B —
 * approved by the user with strict constraints).
 *
 * The user-approved contract, enforced line by line below:
 *   1. USER-CLICK ONLY. There is no timer, no boot-time check, no
 *      background refresh anywhere in this module — the check and the
 *      install run strictly inside the two IPC handlers wired in ipc.ts.
 *   2. MANDATORY sha256 FROM THE TABLE. A version that is not listed in
 *      electron/aether-versions.json is refused (not-pinned). A download
 *      whose zip hash (when pinned) or extracted-binary hash differs from
 *      the table is refused and NOTHING is written (zip-hash-mismatch /
 *      hash-mismatch).
 *   3. RUNNING-LOCK. While the Aether manager owns a live (or
 *      grace-pending) child, BOTH the check and the install refuse with
 *      blocked-running — the running core is never swapped underneath
 *      itself. The gate is evaluated TWICE on install: before the
 *      download and again right before the final rename (a core started
 *      mid-download can never be replaced).
 *   4. OFFLINE DEFAULT = THE BUNDLED PIN. Without a successful explicit
 *      check the app simply keeps the bundled v1.9.0 binary; every
 *      failure path leaves the current binary untouched.
 *
 * ISOLATION CONTRACT (C2 parity — user re-confirmed for C6): the check
 * and download path NEVER touches the system state of the machine. No
 * registry access, no netsh, no WinINET, no Electron session/net usage,
 * no reading or writing of any system-configuration value — the only
 * network I/O is the injectable transport (default: Node's global fetch,
 * a direct connection that does not consult the Windows system proxy).
 *
 * ELECTRON-FREE like killSwitch.ts: no electron import here, so the whole
 * service is esbuild-bundleable for functional tests (taskC6-fntest) with
 * every dependency injected. The IPC wiring in ipc.ts supplies the real
 * binary paths and the live running-state probe from the manager.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import AdmZip from "adm-zip";
import coreVersionsJson from "./core-versions.json";
import bundledTableJson from "./aether-versions.json";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** One verified row of the pin-per-version table. */
export interface AetherVersionEntry {
  version: string;
  verified: string;
  notes?: string;
  /** sha256 of the EXTRACTED binary, per platform (same discipline as the
   *  spawn gate in aether.ts — the binary is the identity). */
  sha256: Record<string, string>;
  /** Optional sha256 of the release zip asset, per platform (Task-12
   *  provenance parity: verify the asset BEFORE extracting). */
  zipSha256?: Record<string, string>;
  /** Official release-asset URL, per platform. A platform without a URL
   *  is honestly NOT installable there (never a guessed link). */
  url?: Record<string, string>;
}

export interface AetherVersionTable {
  releasesPage: string;
  checkUrl: string;
  versions: AetherVersionEntry[];
}

export type AetherCheckKind =
  | "up-to-date"
  | "pinned-newer"
  | "unpinned-newer"
  | "blocked-running"
  | "error";

export interface AetherCheckOutcome {
  kind: AetherCheckKind;
  /** The upstream latest version when the check reached a valid manifest. */
  latest?: string;
  /** The version offered for install (pinned-newer only). */
  version?: string;
  /** Human-readable detail (i18n-free; the renderer maps kinds to keys). */
  detail?: string;
  /** The version the comparison was made against. */
  baseline?: string;
}

export type AetherApplyReason =
  | "ok"
  | "in-flight"
  | "blocked-running"
  | "not-pinned"
  | "not-newer"
  | "no-url"
  | "download-failed"
  | "zip-hash-mismatch"
  | "hash-mismatch"
  | "io-error"
  | "bad-table";

export interface AetherApplyOutcome {
  reason: AetherApplyReason;
  version?: string;
  detail?: string;
  /** The identified active version after the operation (best effort). */
  activeVersionAfter?: string | null;
}

export interface AetherUpdateStatus {
  bundledVersion: string;
  /** Version identified by hashing the CURRENT binary against the table. */
  activeVersion: string | null;
  /** True when the current binary's hash matched a table row. */
  activeIdentified: boolean;
  binaryFound: boolean;
  isRunning: boolean;
  releasesPage: string;
  table: {
    version: string;
    verified: string;
    /** Installable on THIS platform = pinned binary hash + pinned URL. */
    installable: boolean;
  }[];
}

/* ------------------------------------------------------------------ */
/*  Transport (the ONLY network seam — injectable for tests)           */
/* ------------------------------------------------------------------ */

export interface TransportResponse {
  ok: boolean;
  status: number;
  bytes: Buffer;
}

export type UpdateTransport = (
  url: string,
  timeoutMs: number
) => Promise<TransportResponse>;

/**
 * Default transport: Node 18+ global fetch — a DIRECT connection. Node's
 * fetch never consults the Windows system proxy, and this module never
 * reads proxy environment variables or any system configuration; the
 * request carries a descriptive User-Agent (the GitHub API requires one).
 */
export const defaultTransport: UpdateTransport = async (url, timeoutMs) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    headers: {
      "User-Agent": "MEMENTO-AetherUpdate",
      Accept: "application/vnd.github+json",
    },
  });
  return {
    ok: res.ok,
    status: res.status,
    bytes: Buffer.from(await res.arrayBuffer()),
  };
};

/* ------------------------------------------------------------------ */
/*  Table loading + strict validation                                  */
/* ------------------------------------------------------------------ */

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const KNOWN_PLATFORMS = new Set(["win32", "linux", "darwin"]);

/** Strict x.y.z semver compare; null when either side is not x.y.z. */
export function semverCompare(a: string, b: string): number | null {
  if (!VERSION_RE.test(a) || !VERSION_RE.test(b)) return null;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function isHttps(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("https://");
}

/**
 * Load + validate the pin table. With no argument the BUNDLED table is
 * used (the import is the sealed, shipped authority); a path override is
 * for tests. A malformed table is a hard error — the caller must refuse
 * to operate rather than guess (bad-table contract).
 */
export function loadAetherVersionTable(tablePath?: string): AetherVersionTable {
  let raw: unknown;
  if (tablePath) {
    raw = JSON.parse(fs.readFileSync(tablePath, "utf8"));
  } else {
    raw = bundledTableJson;
  }
  const t = raw as Partial<AetherVersionTable> | null;
  if (!t || typeof t !== "object") throw new Error("pin table is not an object");
  if (!isHttps(t.releasesPage)) throw new Error("pin table releasesPage must be https");
  if (!isHttps(t.checkUrl)) throw new Error("pin table checkUrl must be https");
  if (!Array.isArray(t.versions) || t.versions.length === 0) {
    throw new Error("pin table has no versions");
  }
  const seen = new Set<string>();
  for (const v of t.versions) {
    const entry = v as Partial<AetherVersionEntry> | null;
    if (!entry || typeof entry !== "object") throw new Error("bad table entry");
    if (typeof entry.version !== "string" || !VERSION_RE.test(entry.version)) {
      throw new Error(`bad version string: ${String(entry.version)}`);
    }
    if (seen.has(entry.version)) throw new Error(`duplicate version: ${entry.version}`);
    seen.add(entry.version);
    if (typeof entry.verified !== "string" || !entry.verified.trim()) {
      throw new Error(`entry ${entry.version}: missing verified date`);
    }
    if (!entry.sha256 || typeof entry.sha256 !== "object") {
      throw new Error(`entry ${entry.version}: missing sha256 map`);
    }
    for (const [plat, hash] of Object.entries(entry.sha256)) {
      if (!KNOWN_PLATFORMS.has(plat)) throw new Error(`entry ${entry.version}: unknown platform ${plat}`);
      if (typeof hash !== "string" || !HEX64_RE.test(hash)) {
        throw new Error(`entry ${entry.version}: bad sha256 for ${plat}`);
      }
    }
    if (entry.zipSha256) {
      for (const [plat, hash] of Object.entries(entry.zipSha256)) {
        if (!KNOWN_PLATFORMS.has(plat)) throw new Error(`entry ${entry.version}: unknown zip platform ${plat}`);
        if (typeof hash !== "string" || !HEX64_RE.test(hash)) {
          throw new Error(`entry ${entry.version}: bad zipSha256 for ${plat}`);
        }
      }
    }
    if (entry.url) {
      for (const [plat, link] of Object.entries(entry.url)) {
        if (!KNOWN_PLATFORMS.has(plat)) throw new Error(`entry ${entry.version}: unknown url platform ${plat}`);
        if (!isHttps(link)) throw new Error(`entry ${entry.version}: url for ${plat} must be https`);
      }
    }
  }
  return t as AetherVersionTable;
}

/* ------------------------------------------------------------------ */
/*  Hash helpers                                                       */
/* ------------------------------------------------------------------ */

export function sha256Bytes(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/* ------------------------------------------------------------------ */
/*  The service                                                        */
/* ------------------------------------------------------------------ */

export interface AetherUpdateDeps {
  /** True while the manager owns a live (or grace-pending) child. */
  isRunning: () => boolean;
  /** Resolved current aether binary path (may be null — not found). */
  binaryPath: () => string | null;
  /** Directory the swapped binary is installed into (the canonical
   *  bundled location, so findAether's first candidate resolves to it). */
  swapTargetDir: () => string;
  /** Platform key for table lookups (default: the real platform). */
  platform?: string;
  /** Table override for tests; default = the bundled table. */
  tablePath?: string;
  /** Network seam override for tests; default = direct Node fetch. */
  transport?: UpdateTransport;
  /** Binary name override for tests; default: aether.exe / aether. */
  binName?: string;
}

const CHECK_TIMEOUT_MS = 12_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export function createAetherUpdateService(deps: AetherUpdateDeps) {
  const platform = deps.platform || process.platform;
  const binName = deps.binName || (platform === "win32" ? "aether.exe" : "aether");
  const transport = deps.transport || defaultTransport;
  let inFlight = false;

  function loadTable(): AetherVersionTable {
    return loadAetherVersionTable(deps.tablePath);
  }

  /** Identify the CURRENT binary by its hash (the binary is the state —
   *  no sidecar pointer that could drift out of sync). */
  function identifyActive(table: AetherVersionTable): {
    binaryFound: boolean;
    activeVersion: string | null;
  } {
    const bin = deps.binaryPath();
    if (!bin) return { binaryFound: false, activeVersion: null };
    try {
      if (!fs.existsSync(bin) || !fs.statSync(bin).isFile()) {
        return { binaryFound: false, activeVersion: null };
      }
    } catch {
      return { binaryFound: false, activeVersion: null };
    }
    let hash = "";
    try {
      hash = sha256File(bin);
    } catch {
      return { binaryFound: true, activeVersion: null };
    }
    const entry = table.versions.find((v) => v.sha256[platform] === hash);
    return { binaryFound: true, activeVersion: entry ? entry.version : null };
  }

  function status(): AetherUpdateStatus {
    const table = loadTable();
    const { binaryFound, activeVersion } = identifyActive(table);
    return {
      bundledVersion: String(coreVersionsJson["aether"] || ""),
      activeVersion,
      activeIdentified: activeVersion !== null,
      binaryFound,
      isRunning: deps.isRunning(),
      releasesPage: table.releasesPage,
      table: table.versions.map((v) => ({
        version: v.version,
        verified: v.verified,
        installable:
          typeof v.sha256?.[platform] === "string" && typeof v.url?.[platform] === "string",
      })),
    };
  }

  /**
   * Explicit user-click check. BLOCKED while the core is running (the
   * user constraint: check and download are gated, not just the swap).
   * The upstream manifest is only ASKED — nothing is ever downloaded by
   * a check, and a version missing from the table is honestly reported
   * as unpinned instead of being offered.
   */
  async function check(): Promise<AetherCheckOutcome> {
    if (deps.isRunning()) {
      return {
        kind: "blocked-running",
        detail: "Aether is running — stop it before checking for updates.",
      };
    }
    let table: AetherVersionTable;
    try {
      table = loadTable();
    } catch (e: any) {
      return { kind: "error", detail: `Pin table is invalid: ${e?.message || e}` };
    }
    const { activeVersion } = identifyActive(table);
    const baseline = activeVersion || String(coreVersionsJson["aether"] || "");
    if (!baseline) {
      return { kind: "error", detail: "No baseline version (bundled pin missing)." };
    }
    let res: TransportResponse;
    try {
      res = await transport(table.checkUrl, CHECK_TIMEOUT_MS);
    } catch (e: any) {
      return {
        kind: "error",
        baseline,
        detail: `Check request failed (offline?): ${e?.message || e}`,
      };
    }
    if (!res.ok) {
      return { kind: "error", baseline, detail: `Check failed: HTTP ${res.status}` };
    }
    let latest = "";
    try {
      const manifest = JSON.parse(res.bytes.toString("utf8"));
      const tag = String(manifest?.tag_name || "");
      latest = tag.startsWith("v") ? tag.slice(1) : tag;
    } catch (e: any) {
      return { kind: "error", baseline, detail: `Unreadable check response: ${e?.message || e}` };
    }
    if (semverCompare(latest, "0.0.0") === null) {
      return { kind: "error", baseline, detail: `Manifest version is not x.y.z: "${latest}"` };
    }
    const cmp = semverCompare(latest, baseline);
    if (cmp === null || cmp <= 0) {
      return { kind: "up-to-date", latest, baseline };
    }
    const entry = table.versions.find((v) => v.version === latest);
    const installable =
      !!entry &&
      typeof entry.sha256?.[platform] === "string" &&
      typeof entry.url?.[platform] === "string";
    if (entry && installable) {
      return { kind: "pinned-newer", latest, version: latest, baseline };
    }
    // Honest fail-closed: the upstream release exists but THIS build has
    // not pinned+verified it — nothing is offered, nothing is downloaded.
    return { kind: "unpinned-newer", latest, baseline };
  }

  /**
   * Explicit user-click install: download -> verify zip hash (when
   * pinned) -> extract -> verify the BINARY hash against the table ->
   * re-check the running gate -> stage in the target dir -> backup ->
   * atomic-ish rename. Every failure leaves the current binary untouched.
   * The previous binary is kept as <bin>.prev.bak (a manual rollback
   * artifact, documented in the checklist).
   */
  async function apply(version: string): Promise<AetherApplyOutcome> {
    const v = String(version || "").trim();
    if (inFlight) {
      return { reason: "in-flight", version: v, detail: "Another install is already running." };
    }
    inFlight = true;
    try {
      return await applyInner(v);
    } finally {
      inFlight = false;
    }
  }

  async function applyInner(v: string): Promise<AetherApplyOutcome> {
    // Gate 1 (running lock) — before ANY work.
    if (deps.isRunning()) {
      return {
        reason: "blocked-running",
        version: v,
        detail: "Aether is running — the running core is never swapped. Stop it first.",
      };
    }
    let table: AetherVersionTable;
    try {
      table = loadTable();
    } catch (e: any) {
      return { reason: "bad-table", version: v, detail: e?.message || String(e) };
    }
    const { activeVersion } = identifyActive(table);
    if (activeVersion && activeVersion === v) {
      return { reason: "not-newer", version: v, detail: "That version is already the active binary." };
    }
    const entry = table.versions.find((x) => x.version === v);
    if (!entry) {
      // The core C6 constraint: the table is the ONLY install authority.
      return {
        reason: "not-pinned",
        version: v,
        detail: "Not in this build's pin table — refusing (pin-per-version contract).",
      };
    }
    const expectedBinHash = entry.sha256?.[platform];
    if (typeof expectedBinHash !== "string" || !HEX64_RE.test(expectedBinHash)) {
      return { reason: "not-pinned", version: v, detail: `No pinned binary hash for ${platform}.` };
    }
    const url = entry.url?.[platform];
    if (!url) {
      return { reason: "no-url", version: v, detail: `No pinned download URL for ${platform}.` };
    }
    const expectedZipHash = entry.zipSha256?.[platform];

    // Download.
    let zipBytes: Buffer;
    try {
      const res = await transport(url, DOWNLOAD_TIMEOUT_MS);
      if (!res.ok) {
        return { reason: "download-failed", version: v, detail: `HTTP ${res.status}` };
      }
      zipBytes = res.bytes;
    } catch (e: any) {
      return { reason: "download-failed", version: v, detail: e?.message || String(e) };
    }

    // Verify the ZIP asset hash when the table pins one (Task-12 parity:
    // verify the asset BEFORE extracting).
    if (expectedZipHash && sha256Bytes(zipBytes) !== expectedZipHash) {
      return { reason: "zip-hash-mismatch", version: v, detail: "Downloaded zip does not match the pinned asset hash." };
    }

    // Extract the binary from the zip.
    let archive: AdmZip;
    try {
      archive = new AdmZip(zipBytes);
    } catch (e: any) {
      return { reason: "download-failed", version: v, detail: `Not a readable zip: ${e?.message || e}` };
    }
    let data: Buffer | null = null;
    for (const zentry of archive.getEntries()) {
      const name = zentry.entryName;
      // Exact name, or nested under exactly one folder level — never a
      // loose substring match (a zip containing "notaether.exe" first
      // must not be picked; the hash gate would refuse it anyway, but
      // the picker itself stays precise).
      if (
        name === binName ||
        name.endsWith("/" + binName) ||
        name.endsWith("\\" + binName)
      ) {
        data = zentry.getData();
        break;
      }
    }
    if (!data) {
      return { reason: "download-failed", version: v, detail: `${binName} not found inside the downloaded zip.` };
    }

    // MANDATORY binary-hash verification (the contract's heart).
    if (sha256Bytes(data) !== expectedBinHash) {
      return { reason: "hash-mismatch", version: v, detail: "Extracted binary does not match the pinned table hash — nothing was installed." };
    }

    // Gate 2 (running lock) — re-checked RIGHT BEFORE the swap so a core
    // started while the download was in flight can never be replaced.
    if (deps.isRunning()) {
      return {
        reason: "blocked-running",
        version: v,
        detail: "Aether started while the download was in flight — install refused.",
      };
    }

    // Stage + swap. The tmp file lives INSIDE the target dir so the final
    // rename stays on one volume (Windows rename semantics).
    const dir = deps.swapTargetDir();
    const target = path.join(dir, binName);
    const tmp = target + ".incoming-tmp";
    const bak = target + ".prev.bak";
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, data);
      if (platform !== "win32") {
        try {
          fs.chmodSync(tmp, 0o755);
        } catch (e: any) {
          throw new Error(`Cannot set permissions: ${e?.message || e}`);
        }
      }
      // Verify what actually LANDED on disk (belt & suspenders).
      if (sha256File(tmp) !== expectedBinHash) {
        throw new Error("post-write hash mismatch");
      }
      const hadOld = fs.existsSync(target);
      if (hadOld) {
        fs.renameSync(target, bak);
      }
      try {
        fs.renameSync(tmp, target);
      } catch (renameErr) {
        // Restore the previous binary before reporting failure.
        if (hadOld) {
          try {
            fs.renameSync(bak, target);
          } catch {
            /* best-effort restore */
          }
        }
        throw renameErr;
      }
      return { reason: "ok", version: v, activeVersionAfter: v };
    } catch (e: any) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best-effort cleanup */
      }
      return { reason: "io-error", version: v, detail: e?.message || String(e) };
    }
  }

  return { status, check, apply };
}
