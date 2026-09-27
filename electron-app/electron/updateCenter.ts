/**
 * MEMENTO — Update Center (R3 task #3 + the standing "download completes
 * but is never applied" bug).
 *
 * USER BUGS FIXED HERE:
 *   1. THE OLD FLOW downloaded a core and then... nothing. The downloaded
 *      file was never extracted/installed, so the SAME download button
 *      reappeared forever. This module owns the FULL pipeline:
 *      download -> verify (the staged binary must run and report the
 *      expected version) -> ATOMIC APPLY (old binary kept as .bak) ->
 *      version marker written. The button disappears because the update
 *      is REALLY installed and paths.ts resolves the new binary first.
 *   2. Unclear messaging (#3): every phase emits a structured progress
 *      event {phase, messageKey, detail} the renderer maps to clear
 *      Persian/English text — never a raw error wall again.
 *
 * Channels (no GitHub API — the unauthenticated API is rate-limited; the
 * releases/latest REDIRECT carries the tag without any quota):
 *   xray     https://github.com/XTLS/Xray-core/releases/latest
 *   sing-box https://github.com/SagerNet/sing-box/releases/latest
 *   aether   the existing pin-per-version service (aetherUpdate.ts) keeps
 *            its stricter user-approved contract — this module reports its
 *            status but does not bypass it.
 *
 * ISOLATION CONTRACT (C2/C6 parity): the only network I/O is the
 * injectable transport (Node fetch, direct — never the system proxy, no
 * registry, no netsh, no WinINET).
 *
 * RUNNING-LOCK: a core that is LIVE (or grace-pending) is never swapped
 * underneath itself — the download may run, but APPLY refuses with
 * `blocked-running` and a clear message until the user disconnects.
 *
 * ROLLBACK: the previous binary survives as <bin>.bak next to the new one
 * (`update_center_rollback`) — an update can always be undone.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { app } from "electron";
import AdmZip from "adm-zip";
import { dataDir, XRAY_BIN_NAME, SING_BOX_BIN_NAME, findXray, findSingBox } from "./paths";
import { detectCoreVersion, parseCoreVersion } from "./coreCompat";
import { xrayManager } from "./xray";
import { singBoxManager } from "./singbox";
import { mementoLog } from "./logger";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type UpdateCore = "xray" | "sing-box";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "downloading"
  | "paused"
  | "cancelled"
  | "extracting"
  | "verifying"
  | "applying"
  | "done"
  | "blocked-running"
  | "error";

export interface UpdateProgressEvent {
  core: UpdateCore;
  phase: UpdatePhase;
  /** 0..100 when meaningful (downloading), else omitted. */
  percent?: number;
  /** i18n message key for the renderer (updateCenter.* namespace). */
  messageKey: string;
  detail?: string;
}

export interface CoreUpdateEntry {
  core: UpdateCore;
  binFound: boolean;
  binPath: string | null;
  installedVersion: string | null;
  /** Where the live binary comes from: an Update Center install, the
   *  bundled resource copy, or nothing at all. taskF3 bugfix: the old
   *  entry ONLY looked at the updates dir, so a bundled core reported
   *  "bundled version (unknown)" forever and the card could never say
   *  "up to date". */
  source: "updates" | "bundled" | "none";
  /** ISO timestamp of the last successful latest-version check. */
  lastCheckedAt: string | null;
  latestVersion: string | null;
  assetUrl: string | null;
  assetSize: number | null;
  /** Latest check outcome / last operation state. */
  lastPhase: UpdatePhase;
  lastDetail: string | null;
  /** An APPLY that is finished but the old binary still running? (no —
   *  the running-lock guarantees this is always false after done). */
  canRollback: boolean;
  /** 3.1.8: a paused download's partial file exists -> Resume can continue
   *  from there (HTTP Range). Purely informational for the UI. */
  canResume?: boolean;
}

interface Channel {
  repo: string;
  releasesLatestUrl: string;
  /** Build the release-asset URL for a tag (windows x64). */
  assetUrl: (tag: string, platform: "win32" | "linux") => string | null;
}

const CHANNELS: Record<UpdateCore, Channel> = {
  xray: {
    repo: "XTLS/Xray-core",
    releasesLatestUrl: "https://github.com/XTLS/Xray-core/releases/latest",
    assetUrl: (tag, platform) =>
      `https://github.com/XTLS/Xray-core/releases/download/${tag}/Xray-${
        platform === "win32" ? "windows-64.zip" : "linux-64.zip"
      }`,
  },
  "sing-box": {
    repo: "SagerNet/sing-box",
    releasesLatestUrl: "https://github.com/SagerNet/sing-box/releases/latest",
    assetUrl: (tag, platform) => {
      const v = tag.replace(/^v/, "");
      return `https://github.com/SagerNet/sing-box/releases/download/${tag}/sing-box-${v}-${
        platform === "win32" ? "windows-amd64.zip" : "linux-amd64.tar.gz"
      }`;
    },
  },
};

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state: Record<UpdateCore, { lastPhase: UpdatePhase; lastDetail: string | null; latestVersion: string | null; assetUrl: string | null; assetSize: number | null; busy: boolean; lastCheckedAt: string | null }> = {
  xray: { lastPhase: "idle", lastDetail: null, latestVersion: null, assetUrl: null, assetSize: null, busy: false, lastCheckedAt: null },
  "sing-box": { lastPhase: "idle", lastDetail: null, latestVersion: null, assetUrl: null, assetSize: null, busy: false, lastCheckedAt: null },
};

/** 3.1.8: per-core pause/cancel switches the download loop polls between
 *  chunks. Set by the pause/cancel IPC commands, cleared at pipeline start. */
const ctrl: Record<UpdateCore, { pause: boolean; cancel: boolean }> = {
  xray: { pause: false, cancel: false },
  "sing-box": { pause: false, cancel: false },
};

/** The partial-download artifact (HTTP Range resume anchor). */
function partPathFor(core: UpdateCore): string {
  return path.join(updatesDirFor(core), "incoming.asset.part");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Internal sentinel: the download loop throws it when CANCEL was set. */
class UpdateCancelledError extends Error {
  constructor() { super("download cancelled by the user"); }
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

export function updatesDirFor(core: UpdateCore): string {
  return path.join(dataDir(), "updates", core);
}

function binNameFor(core: UpdateCore): string {
  return core === "xray" ? XRAY_BIN_NAME : SING_BOX_BIN_NAME;
}

function installedBinPath(core: UpdateCore): string {
  return path.join(updatesDirFor(core), binNameFor(core));
}

function versionMarkerPath(core: UpdateCore): string {
  return path.join(updatesDirFor(core), "version.txt");
}

function readVersionMarker(core: UpdateCore): string | null {
  try {
    const v = fs.readFileSync(versionMarkerPath(core), "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Latest-version probe (redirect trick — no API quota)                */
/* ------------------------------------------------------------------ */

export async function fetchLatestTag(core: UpdateCore, timeoutMs = 15000): Promise<string | null> {
  const url = CHANNELS[core].releasesLatestUrl;
  // taskF3 bugfix: the old code shared ONE AbortController + timer across
  // both attempts and cleared the timer after the first — a hanging second
  // fetch could never be aborted. Each attempt now owns its controller.
  const attempt = async (redirect: "manual" | "follow"): Promise<string | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect, signal: controller.signal });
      const finalUrl = redirect === "manual" ? res.headers.get("location") || "" : res.url;
      const m = finalUrl.match(/\/releases\/tag\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  // redirect:"manual" -> the Location header IS the answer:
  // https://github.com/<repo>/releases/tag/v26.3.27
  const manual = await attempt("manual");
  if (manual) return manual;
  // Some fetch stacks follow redirects before we can see them; a final
  // URL ending in /tag/<v> still works.
  return attempt("follow");
}

/* ------------------------------------------------------------------ */
/* Binary verification                                                 */
/* ------------------------------------------------------------------ */

function probeBinaryVersion(binPath: string, core: UpdateCore): string | null {
  try {
    const args = core === "xray" ? ["version"] : ["version"];
    const res = spawnSync(binPath, args, { timeout: 10000, encoding: "utf8", windowsHide: true });
    if (res.error || (res.status !== 0 && res.status !== null)) return null;
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    return parseCoreVersion(out);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Progress fan-out                                                    */
/* ------------------------------------------------------------------ */

type Emit = (ev: UpdateProgressEvent) => void;

function makeEmitter(core: UpdateCore): Emit {
  return (ev) => {
    // 3.1.8: every phase transition lands in the log (user request #4).
    mementoLog(
      ev.phase === "error" ? "error" : "info",
      "update-center",
      `${core}: ${ev.phase}${ev.percent != null ? ` ${ev.percent}%` : ""}`,
      ev.detail ?? null
    );
    try {
      const { BrowserWindow } = require("electron") as typeof import("electron");
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send("update_center_progress", ev);
      }
    } catch {
      /* best-effort — headless test mode has no windows */
    }
  };
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

function isCoreRunning(core: UpdateCore): boolean {
  const st = core === "xray" ? xrayManager.getStatus() : singBoxManager.getStatus();
  return !!(st && st.running);
}

/** 3.1.8: PAUSE the running download (the partial file is kept — Resume
 *  continues from there via HTTP Range). A paused pipeline returns
 *  { ok:false, phase:"paused" } to its invoker. */
export function updateCenterPause(core: UpdateCore): { ok: boolean; detail?: string } {
  if (!state[core].busy || state[core].lastPhase !== "downloading") {
    return { ok: false, detail: "no download is running" };
  }
  ctrl[core].pause = true;
  return { ok: true };
}

/** 3.1.8: CANCEL the running download AND delete the partial file. A
 *  paused-but-not-running download is cancelled by Resume-less discard:
 *  the partial file is removed so the next Update starts clean. */
export function updateCenterCancel(core: UpdateCore): { ok: boolean; detail?: string } {
  ctrl[core].cancel = true;
  if (!state[core].busy) {
    // Nothing in flight — discard any leftover partial right now.
    try { fs.rmSync(partPathFor(core), { force: true }); } catch { /* best-effort */ }
    state[core].lastPhase = "idle";
    state[core].lastDetail = null;
  }
  return { ok: true };
}
/** DOWNLOAD -> EXTRACT -> VERIFY -> APPLY. Every phase emits a progress
 *  event with an i18n key. Never leaves a half-installed state: the
 *  staged binary is verified BEFORE it replaces anything.
 *
 *  3.1.8 (user request #6): the download loop polls pause/cancel switches
 *  between chunks — PAUSE aborts the fetch, keeps the partial file and
 *  returns phase "paused"; RESUME (opts.resume) continues from the partial
 *  via an HTTP Range request (a server that ignores Range restarts clean);
 *  CANCEL aborts AND deletes the partial. Extraction/verify/apply phases
 *  are unchanged. */
export async function runUpdatePipeline(
  core: UpdateCore,
  tagOverride?: string,
  opts?: { resume?: boolean }
): Promise<{ ok: boolean; phase: UpdatePhase; detail?: string; version?: string }> {
  const st = state[core];
  if (st.busy) return { ok: false, phase: "error", detail: "another update is already in flight" };
  st.busy = true;
  ctrl[core] = { pause: false, cancel: false }; // fresh switches per run
  const emit = makeEmitter(core);
  const binName = binNameFor(core);
  const dir = updatesDirFor(core);
  try {
    fs.mkdirSync(dir, { recursive: true });

    /* 1 — resolve latest tag */
    st.lastPhase = "checking";
    st.lastDetail = null;
    emit({ core, phase: "checking", messageKey: "updateCenter.phase.checking" });
    const tag = tagOverride || st.latestVersion || (await fetchLatestTag(core));
    if (!tag) {
      st.lastPhase = "error";
      st.lastDetail = "cannot reach github releases";
      emit({ core, phase: "error", messageKey: "updateCenter.err.network" });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }
    st.latestVersion = tag;
    st.lastCheckedAt = new Date().toISOString();
    const platform = process.platform === "win32" ? "win32" : "linux";
    const url = CHANNELS[core].assetUrl(tag, platform);
    if (!url) {
      st.lastPhase = "error";
      st.lastDetail = "no asset for this platform";
      emit({ core, phase: "error", messageKey: "updateCenter.err.noAsset" });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }
    st.assetUrl = url;

    /* 2 — download (with progress + pause/cancel/resume) */
    st.lastPhase = "downloading";
    emit({ core, phase: "downloading", percent: 0, messageKey: "updateCenter.phase.downloading" });
    const zipPath = path.join(dir, "incoming.asset");
    const partPath = partPathFor(core);
    const resuming = !!opts?.resume && fs.existsSync(partPath) && fs.statSync(partPath).size > 0;
    let startAt = resuming ? fs.statSync(partPath).size : 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300_000);
      const headers: Record<string, string> = {};
      if (startAt > 0) headers["Range"] = `bytes=${startAt}-`;
      const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (startAt > 0 && res.status !== 206) {
        // The server ignored the Range request — start over cleanly.
        startAt = 0;
        try { fs.rmSync(partPath, { force: true }); } catch { /* best-effort */ }
      }
      const total = Number(res.headers.get("content-length") || 0) + startAt;
      let received = startAt;
      const reader = res.body?.getReader();
      if (!reader) throw new Error("empty response body");
      const fd = fs.openSync(partPath, startAt > 0 ? "a" : "w");
      try {
        for (;;) {
          if (ctrl[core].cancel) {
            controller.abort();
            throw new UpdateCancelledError();
          }
          if (ctrl[core].pause) {
            controller.abort();
            st.lastPhase = "paused";
            st.lastDetail = `${received} bytes staged for resume`;
            emit({
              core,
              phase: "paused",
              percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : undefined,
              messageKey: "updateCenter.phase.paused",
              detail: st.lastDetail,
            });
            return { ok: false, phase: "paused", detail: st.lastDetail };
          }
          const { done, value } = await reader.read();
          if (done) break;
          fs.writeSync(fd, value);
          received += value.byteLength;
          if (total > 0) {
            emit({
              core,
              phase: "downloading",
              percent: Math.min(100, Math.round((received / total) * 100)),
              messageKey: "updateCenter.phase.downloading",
            });
          }
        }
      } finally {
        try { fs.closeSync(fd); } catch { /* best-effort */ }
      }
      clearTimeout(timer);
      const size = fs.statSync(partPath).size;
      if (size < 1024) throw new Error(`download too small (${size} bytes)`);
      fs.renameSync(partPath, zipPath);
      st.assetSize = size;
    } catch (e: any) {
      if (e instanceof UpdateCancelledError) {
        // 3.1.8: CANCEL — partial file deleted, honest idle surface.
        try { fs.rmSync(partPath, { force: true }); } catch { /* best-effort */ }
        st.lastPhase = "cancelled";
        st.lastDetail = null;
        emit({ core, phase: "cancelled", messageKey: "updateCenter.phase.cancelled" });
        return { ok: false, phase: "cancelled" };
      }
      st.lastPhase = "error";
      st.lastDetail = String(e?.message || e);
      emit({ core, phase: "error", messageKey: "updateCenter.err.download", detail: st.lastDetail });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }

    /* 3 — extract (staged) */
    st.lastPhase = "extracting";
    emit({ core, phase: "extracting", messageKey: "updateCenter.phase.extracting" });
    const stagedDir = path.join(dir, "staged");
    try {
      fs.rmSync(stagedDir, { recursive: true, force: true });
      fs.mkdirSync(stagedDir, { recursive: true });
      if (url.endsWith(".tar.gz")) {
        // sing-box linux assets are tarballs — spawn the OS tar (sandbox/dev).
        const res = spawnSync("tar", ["-xzf", zipPath, "-C", stagedDir], { timeout: 120_000 });
        if (res.status !== 0) throw new Error("tar extraction failed");
      } else {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(stagedDir, true);
      }
    } catch (e: any) {
      st.lastPhase = "error";
      st.lastDetail = String(e?.message || e);
      emit({ core, phase: "error", messageKey: "updateCenter.err.extract", detail: st.lastDetail });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }

    // Locate the binary inside the staged tree (zip may nest a folder).
    let stagedBin: string | null = null;
    const findBin = (dirPath: string, depth: number): string | null => {
      if (depth > 4) return null;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const e of entries) {
        const p = path.join(dirPath, e.name);
        if (e.isFile() && e.name.toLowerCase() === binName.toLowerCase()) return p;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          const hit = findBin(path.join(dirPath, e.name), depth + 1);
          if (hit) return hit;
        }
      }
      return null;
    };
    stagedBin = findBin(stagedDir, 0);
    if (!stagedBin) {
      st.lastPhase = "error";
      st.lastDetail = `${binName} not found inside the downloaded asset`;
      emit({ core, phase: "error", messageKey: "updateCenter.err.noBinary", detail: st.lastDetail });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }

    /* 4 — VERIFY: the staged binary must run and report the tag's version */
    st.lastPhase = "verifying";
    emit({ core, phase: "verifying", messageKey: "updateCenter.phase.verifying" });
    if (platform === "linux") {
      try { fs.chmodSync(stagedBin, 0o755); } catch { /* best-effort */ }
    }
    const stagedVersion = probeBinaryVersion(stagedBin, core);
    const expected = tag.replace(/^v/, "");
    if (!stagedVersion) {
      st.lastPhase = "error";
      st.lastDetail = "the downloaded binary failed to run on this machine";
      emit({ core, phase: "error", messageKey: "updateCenter.err.verifyRun", detail: st.lastDetail });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }
    if (!expected.startsWith(stagedVersion.split(".")[0]) && !stagedVersion.startsWith(expected.split(".")[0])) {
      // Major mismatch = wrong asset; tolerate minor/patch drift in tags.
      st.lastPhase = "error";
      st.lastDetail = `binary reports v${stagedVersion}, expected ${tag}`;
      emit({ core, phase: "error", messageKey: "updateCenter.err.verifyVersion", detail: st.lastDetail });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }

    /* 5 — APPLY (running-lock + atomic swap with .bak) */
    if (isCoreRunning(core)) {
      st.lastPhase = "blocked-running";
      st.lastDetail = "the core is running — disconnect, then press Apply again";
      emit({ core, phase: "blocked-running", messageKey: "updateCenter.err.blockedRunning" });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }
    st.lastPhase = "applying";
    emit({ core, phase: "applying", messageKey: "updateCenter.phase.applying" });
    await sleep(50); // let the event reach the UI before the blocking renames

    const targetBin = installedBinPath(core);
    const bak = targetBin + ".bak";
    try {
      fs.rmSync(bak, { force: true });
      if (fs.existsSync(targetBin)) fs.renameSync(targetBin, bak);
      fs.copyFileSync(stagedBin, targetBin);
      try { fs.chmodSync(targetBin, 0o755); } catch { /* best-effort */ }
      fs.writeFileSync(versionMarkerPath(core), `${stagedVersion}\n${new Date().toISOString()}\n`, "utf8");
      fs.rmSync(stagedDir, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
    } catch (e: any) {
      // Roll the swap back before reporting.
      try {
        if (!fs.existsSync(targetBin) && fs.existsSync(bak)) fs.renameSync(bak, targetBin);
      } catch { /* best-effort */ }
      st.lastPhase = "error";
      st.lastDetail = String(e?.message || e);
      emit({ core, phase: "error", messageKey: "updateCenter.err.apply", detail: st.lastDetail });
      return { ok: false, phase: st.lastPhase, detail: st.lastDetail };
    }

    st.lastPhase = "done";
    st.lastDetail = null;
    emit({ core, phase: "done", messageKey: "updateCenter.phase.done" });
    return { ok: true, phase: "done", version: stagedVersion };
  } finally {
    st.busy = false;
  }
}

/* ------------------------------------------------------------------ */
/* Status surface                                                      */
/* ------------------------------------------------------------------ */

export function updateCenterEntry(core: UpdateCore): CoreUpdateEntry {
  const st = state[core];
  const targetBin = installedBinPath(core);
  const updated = fs.existsSync(targetBin);

  // taskF3 bugfix: resolve the LIVE binary through the SAME ladder the
  // managers use (paths.ts — updates dir first, then the bundled resource
  // copy), and probe ITS version by actually running it. Previously the
  // entry only knew about the updates dir, so a bundled core showed
  // "unknown" forever and "up to date" could never be reported.
  const livePath = updated ? targetBin : core === "xray" ? findXray() : findSingBox();
  const source: "updates" | "bundled" | "none" = updated
    ? "updates"
    : livePath
      ? "bundled"
      : "none";
  const liveVersion = livePath
    ? probeBinaryVersion(livePath, core) ?? (updated ? readVersionMarker(core) : null)
    : null;

  return {
    core,
    binFound: !!livePath,
    binPath: livePath,
    installedVersion: liveVersion,
    source,
    lastCheckedAt: st.lastCheckedAt,
    latestVersion: st.latestVersion,
    assetUrl: st.assetUrl,
    assetSize: st.assetSize,
    lastPhase: st.lastPhase,
    lastDetail: st.lastDetail,
    canRollback: updated && fs.existsSync(targetBin + ".bak"),
    // 3.1.8: a partial download exists -> the UI can offer Resume.
    canResume: fs.existsSync(partPathFor(core)),
  };
}

export function updateCenterList(): CoreUpdateEntry[] {
  return [updateCenterEntry("xray"), updateCenterEntry("sing-box")];
}

export function updateCenterRollback(core: UpdateCore): { ok: boolean; detail?: string } {
  const targetBin = installedBinPath(core);
  const bak = targetBin + ".bak";
  try {
    if (!fs.existsSync(bak)) return { ok: false, detail: "no backup to roll back to" };
    if (isCoreRunning(core)) return { ok: false, detail: "the core is running — disconnect first" };
    fs.rmSync(targetBin, { force: true });
    fs.renameSync(bak, targetBin);
    fs.rmSync(versionMarkerPath(core), { force: true });
    state[core].lastPhase = "idle";
    state[core].lastDetail = null;
    return { ok: true };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e) };
  }
}

/** Cache the fetched latest tag so the list can show it without re-probing
 *  the network on every open. Called by update_center_check. */
export async function updateCenterCheck(core: UpdateCore): Promise<{ latest: string | null }> {
  state[core].lastPhase = "checking";
  const latest = await fetchLatestTag(core);
  if (latest) {
    state[core].latestVersion = latest;
    state[core].lastPhase = "idle";
    state[core].lastDetail = null;
    state[core].lastCheckedAt = new Date().toISOString();
  } else {
    state[core].lastPhase = "error";
    state[core].lastDetail = "cannot reach github releases";
  }
  return { latest };
}
