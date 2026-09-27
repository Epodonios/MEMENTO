/**
 * MementoSetup — the REAL installation engine.
 *
 * ELECTRON-FREE (node builtins only): every platform touchpoint is an
 * injected dependency (shortcuts, registry, process management), so the
 * gate scripts can drive the FULL pipeline against a fixture payload on
 * any OS. The Electron main supplies the Windows implementations:
 *
 *   shortcuts    -> shell.writeShortcutLink (MEMENTO.lnk, uninstall lnk)
 *   registry     -> HKCU\\...\\Uninstall\\MEMENTO via `reg add` (per-user,
 *                   no UAC) — Add/Remove Programs entry
 *   running app  -> taskkill /IM MEMENTO.exe (graceful upgrade path)
 *
 * Pipeline (each step streams design-styled log lines + pct):
 *   validate dest -> close running app -> stage clean destination
 *   -> clone runtime (HARDLINK the exe — no self-image byte copy) + copy
 *   payload (byte-exact, per-file progress) -> write uninstaller
 *   registration -> link shortcuts -> drop the staged backup.
 *
 * ROLLBACK: an existing install is renamed aside (dest.bak-<ts>) and
 * restored on ANY failure — a failed setup can never leave the machine
 * worse than it found it. userData (%APPDATA%/com.epodonios.memento) is
 * NEVER touched — uninstall/reinstall preserves profiles and settings.
 *
 * AV-HARDENING (setup 2.0.3): every behavior below that used to look
 * like a dropper to Windows Defender heuristics was reworked:
 *   - the running installer exe is NOT byte-copied anymore; a same-volume
 *     NTFS hardlink makes the new MEMENTO.exe directory entry point at the
 *     SAME data (zero bytes of the running image re-written). Plain copy
 *     remains only as the cross-volume fallback.
 *   - the payload (the unsigned xray/sing-box/aether cores) is MOVED out
 *     of the SFX extraction folder by main.ts (metadata rename, main side),
 *     so each core binary is written to disk one time fewer.
 *   - the completion log states the unsigned-binary contract and the exact
 *     Windows Security steps, instead of leaving the user with a bare
 *     "antivirus removed files" error. The setup NEVER touches AV settings
 *     itself — self-modifying exclusions is malware behavior.
 *
 * FIELD REPORT #2 (setup 2.0.4, real Windows machine): Windows Defender
 * removed the payload's app code DURING the install; the tolerant copy
 * "completed" to 100% anyway and the installed app could not launch at
 * all (Electron loads resources\app.asar first — without it the process
 * exits with "Cannot find module ...\resources\app.asar"). Tolerance is
 * right for the cores (Update Center heals them) and WRONG for the app
 * code. 2.0.4 closed that gap:
 *   - CONTRACT GATE: the runtime-reuse payload must contain the app
 *     code — if a critical file is missing/unreadable BEFORE the copy
 *     starts (quarantined inside the staging payload), the setup aborts
 *     with the exact Windows Security steps instead of installing a
 *     guaranteed-broken app;
 *   - VERIFY + HEAL: after the copy, EVERY file is checked against its
 *     source size, with a short re-copy loop that rescues files an AV
 *     briefly locked during its scan;
 *   - HARD GATE: still-missing CRITICAL files (or MEMENTO.exe) FAIL the
 *     install and ROLL BACK — no more broken "100% success";
 *   - LEAVE-NO-TRACE: a FRESH destination whose install fails is removed
 *     again — the machine is left exactly as the setup found it.
 *
 * FIELD REPORT #4 (setup 2.0.7, same real machine): the user picked an
 * EXISTING non-MEMENTO folder as the destination (C:\Users\…\Downloads)
 * and step 3 tried to rename the WHOLE folder aside — Windows refused
 * (EPERM: shell handles on special folders) and even a successful rename
 * would have MOVED the user's own files. Rule now: only a folder that
 * IS a previous MEMENTO install (its .memento-uninstall.json sentinel)
 * is staged aside; foreign folders are installed INTO in place — nothing
 * of theirs is renamed, moved, or deleted, and a failed in-place run
 * removes only the files the manifest says THIS setup wrote. The
 * ownership sentinel now also records `inPlace` + the exact installed
 * file list so MEMENTO's uninstaller can remove only its own files
 * instead of rmdir-ing the whole folder (which would be data loss inside
 * a foreign directory).
 *
 * FIELD REPORT #3 (setup 2.0.5, same real machine): the 2.0.4 gate fired
 * EXACTLY as designed at 1% — Defender had already quarantined the
 * payload's single 4.1 MB app.asar during SFX extraction, the setup named
 * the file and installed nothing. Root cause of the quarantine itself:
 * Defender scans INSIDE .asar archives; one opaque unsigned blob holding
 * the MHRV engine's certutil/PowerShell/netsh literals is a prime
 * content-detection target. 2.0.5 therefore ships the app code UNPACKED
 * (payload/resources/app/ tree — electron-builder asar:false): no asar
 * blob to kill wholesale, and a per-file quarantine is ONE small file
 * that VERIFY+HEAL restores from staging. The contract gate now checks
 * the critical files of the app TREE.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PayloadFile {
  rel: string;
  bytes: number;
  sha256: string;
}

export interface PayloadManifest {
  files: PayloadFile[];
  totalBytes: number;
  fileCount: number;
}

export interface UninstallInfo {
  DisplayName: string;
  DisplayVersion: string;
  Publisher: string;
  InstallLocation: string;
  DisplayIcon: string;
  UninstallString: string;
  QuietUninstallString: string;
  NoModify: number;
  NoRepair: number;
  EstimatedSizeKB: number;
  UninstallPreservesUserData: number;
}

export type InstallEvent =
  | { type: "log"; line: string; ts: string; verbose?: boolean; error?: boolean }
  | { type: "pct"; pct: number; sub?: string }
  | { type: "status"; text: string }
  | { type: "done"; destDir: string }
  | { type: "error"; message: string };

export type InstallMode = "full-tree" | "runtime-reuse";

/** One file of the running installer's OWN Electron runtime that must be
 *  copied to the destination (runtime-reuse mode). */
export interface RuntimeFileEntry {
  rel: string;
  bytes: number;
}

export interface InstallDeps {
  isWin: boolean;
  appVersion: string;
  payloadDir: string;
  coreVersions: { xray?: string; singbox?: string; aether?: string };
  desktopDir: () => string;
  startMenuDir: () => string;
  writeShortcut: (
    lnkPath: string,
    exePath: string,
    args: string | null,
    description: string
  ) => "created" | "skipped" | "failed";
  writeUninstallRegistration: (info: UninstallInfo) => Promise<void> | void;
  removeUninstallRegistration: () => Promise<void> | void;
  closeRunningApp: (exeName: string) => boolean;
  onEvent: (ev: InstallEvent) => void;
  cancelled: () => boolean;
  /** runtime-reuse: reuse the installer's OWN Electron runtime at the
   *  destination instead of shipping a second 235 MB copy inside the
   *  payload. The runtime files (dlls/paks/locales/LICENSE) are enumerated
   *  main-side; the running exe is copied as MEMENTO.exe. */
  mode?: InstallMode;
  runtimeDir?: () => string;
  runtimeFiles?: () => RuntimeFileEntry[];
  runtimeExePath?: () => string;
}

export interface InstallResult {
  ok: boolean;
  destDir: string;
  cancelled: boolean;
  shortcuts: string[];
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function nowStamp(d = new Date()): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function sha256File(p: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

const IGNORED = new Set(["payload-meta.json", ".DS_Store"]);

/* ------------------------------------------------------------------ */
/* 2.0.4 — install verification (the field-report fix)                 */
/* ------------------------------------------------------------------ */

/** The payload files the installed app CANNOT run without. Tolerant
 *  skipping is correct for the proxy cores (Update Center heals them
 *  after install) — it is NOT correct for the app's own code: a MEMENTO
 *  without its app code cannot even start, so a setup that lets an
 *  antivirus remove it must FAIL loudly and roll back instead of
 *  reporting a broken 100% success.
 *  2.0.5 (field report #3): the app code ships UNPACKED
 *  (payload/resources/app/ — see the electron-builder.yml rationale),
 *  so the critical set is the tree's load-bearing files, not one blob. */
export const CRITICAL_PAYLOAD_FILES = [
  "resources/app/package.json",
  "resources/app/dist-electron/main.js",
];

/** The ownership sentinel written into every successful install. Its
 *  presence marks the destination as OURS (eligible for the stage-aside
 *  upgrade path); its `inPlace` flag + `files` list drive the safe
 *  in-place uninstall contract (2.0.7). */
export const UNINSTALL_SENTINEL = ".memento-uninstall.json";

/** One file the verification pass checks at the destination. */
export interface VerifyEntry {
  rel: string;
  src: string;
  bytes: number;
  critical: boolean;
}

export interface VerifyResult {
  verified: number;
  total: number;
  healed: number;
  missing: VerifyEntry[];
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function filePresent(p: string, bytes: number): boolean {
  try {
    return fs.statSync(p).size === bytes;
  } catch {
    return false;
  }
}

/** Ground-truth check of what REALLY landed at the destination, with a
 *  short heal loop. Antivirus engines routinely hold a freshly-written
 *  file open (or hide it) for a few seconds while scanning; a re-copy
 *  attempt a beat later rescues exactly those transient cases. Files
 *  that stay missing are returned honestly — the caller decides whether
 *  they are tolerable (cores) or fatal (the app code). */
export async function verifyAndHealInstall(
  destDir: string,
  entries: VerifyEntry[],
  deps: Pick<InstallDeps, "cancelled">,
  rounds = 3
): Promise<VerifyResult> {
  const missingNow = () =>
    entries.filter((e) => !filePresent(path.join(destDir, e.rel), e.bytes));
  let healed = 0;
  let current = missingNow();
  for (let round = 1; round <= rounds && current.length > 0; round++) {
    await sleepMs(400 * round);
    for (const e of current) {
      if (deps.cancelled()) break;
      try {
        fs.copyFileSync(e.src, path.join(destDir, e.rel));
        try {
          fs.chmodSync(path.join(destDir, e.rel), 0o755);
        } catch {
          /* best-effort */
        }
        if (filePresent(path.join(destDir, e.rel), e.bytes)) healed++;
      } catch {
        /* stays missing — reported honestly by the caller */
      }
    }
    current = missingNow();
  }
  return {
    verified: entries.length - current.length,
    total: entries.length,
    healed,
    missing: current,
  };
}

/** Walk the payload tree and hash EVERY file — the manifest is the
 *  install contract (byte counts drive the progress meter). */
export function computeManifest(payloadDir: string, maxFiles = 200_000): PayloadManifest {
  const files: PayloadFile[] = [];
  const walk = (dir: string) => {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        if (IGNORED.has(e.name)) continue;
        let bytes = 0;
        let sha = "";
        try {
          bytes = fs.statSync(p).size;
          sha = sha256File(p);
        } catch {
          continue;
        }
        files.push({
          rel: path.relative(payloadDir, p).split(path.sep).join("/"),
          bytes,
          sha256: sha,
        });
      }
    }
  };
  walk(payloadDir);
  return {
    files,
    totalBytes: files.reduce((a, b) => a + b.bytes, 0),
    fileCount: files.length,
  };
}

/** Windows-absolute-path validator — same shape rules as the design's
 *  inline validation, enforced main-side too (defense in depth). */
export function validateDestPath(
  p: string,
  isWin: boolean
): { ok: boolean; reason?: string } {
  const v = String(p || "").trim();
  if (!v) return { ok: false, reason: "empty" };
  if (isWin) {
    if (!/^[A-Za-z]:\\/.test(v)) return { ok: false, reason: "not-absolute" };
    const tail = v.slice(3);
    if (!tail) return { ok: false, reason: "no-tail" };
    if (/[<>:"|?*]/.test(tail)) return { ok: false, reason: "bad-chars" };
    if (/[\s.]$/.test(v)) return { ok: false, reason: "bad-ending" };
    if (tail.toUpperCase() === "WINDOWS") return { ok: false, reason: "reserved" };
    return { ok: true };
  }
  if (!v.startsWith("/")) return { ok: false, reason: "not-absolute" };
  return { ok: true };
}

/** Free bytes on the volume that hosts `p` (fs.statfs — no wmic dance). */
export function freeDiskBytes(p: string): number | null {
  try {
    const probe = path.parse(path.resolve(p)).root || path.resolve(p);
    const st = (fs as any).statfsSync(probe);
    if (st && typeof st.bsize === "number" && typeof st.bavail === "number") {
      return st.bsize * st.bavail;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function emit(deps: InstallDeps, line: string, opts: { verbose?: boolean; error?: boolean } = {}) {
  deps.onEvent({ type: "log", line, ts: nowStamp(), verbose: opts.verbose, error: opts.error });
}

function pct(deps: InstallDeps, p: number, sub?: string) {
  deps.onEvent({ type: "pct", pct: Math.max(0, Math.min(100, p)), sub });
}

/* ------------------------------------------------------------------ */
/* Recursive copy with progress + cancel                               */
/* ------------------------------------------------------------------ */

function copyTreeWithProgress(
  srcRoot: string,
  dstRoot: string,
  manifest: PayloadManifest,
  deps: InstallDeps,
  basePct: number,
  spanPct: number
): { copied: number; cancelled: boolean; skipped: number } {
  let copied = 0;
  let skipped = 0;
  let nextEmit = 0;
  const copyDir = (src: string, dst: string): boolean => {
    if (deps.cancelled()) return false;
    let entries: fs.Dirent[];
    try {
      fs.mkdirSync(dst, { recursive: true });
      entries = fs.readdirSync(src, { withFileTypes: true });
    } catch (e: any) {
      // TOLERANCE (3.1.7): a vanished sub-folder (antivirus quarantine, a
      // second launch of the portable stub wiping %TEMP%) must NOT abort
      // the installation — skip it, tell the truth in the log, continue.
      skipped++;
      emit(deps, `skipped ${path.relative(srcRoot, src) || "."} (${String(e?.code || e)})`, { verbose: true, error: true });
      return true;
    }
    for (const e of entries) {
      if (deps.cancelled()) return false;
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (IGNORED.has(e.name)) continue;
      if (e.isDirectory()) {
        if (!copyDir(s, d)) return false;
      } else if (e.isFile()) {
        try {
          fs.copyFileSync(s, d);
          try {
            fs.chmodSync(d, 0o755);
          } catch {
            /* best-effort */
          }
        } catch (err: any) {
          skipped++;
          emit(deps, `skipped ${path.relative(srcRoot, s)} (${String(err?.code || err)})`, { verbose: true, error: true });
          continue;
        }
        copied++;
        if (manifest.totalBytes > 0 && copied >= nextEmit) {
          nextEmit = copied + 24;
          pct(deps, basePct + (copied / manifest.fileCount) * spanPct, "transferring payload");
        }
      }
    }
    return true;
  };
  const okFlag = copyDir(srcRoot, dstRoot);
  return { copied, cancelled: !okFlag && deps.cancelled(), skipped };
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

export async function runInstall(
  opts: { destDir: string; createDesktopShortcut: boolean },
  deps: InstallDeps
): Promise<InstallResult> {
  const destDir = String(opts.destDir || "").trim();
  const shortcuts: string[] = [];
  let backupDir: string | null = null;

  emit(deps, "initializing installer context", { verbose: true });
  deps.onEvent({ type: "status", text: "preparing" });
  pct(deps, 1);

  /* 1 — validate the destination (same rules as the wizard input) */
  const validity = validateDestPath(destDir, deps.isWin);
  if (!validity.ok) {
    const msg = `invalid destination (${validity.reason}): ${destDir}`;
    deps.onEvent({ type: "error", message: msg });
    return { ok: false, destDir, cancelled: false, shortcuts, error: msg };
  }
  // 3.1.6 runtime-reuse: the payload ships WITHOUT a second Electron
  // runtime — the destination reuses the installer's own. Resolve the
  // runtime inventory up-front so space checks and meters see the truth.
  const runtimeEntries =
    deps.mode === "runtime-reuse" && deps.runtimeFiles ? deps.runtimeFiles() : null;
  const runtimeTotalBytes = runtimeEntries
    ? runtimeEntries.reduce((a, b) => a + b.bytes, 0)
    : 0;
  // the cloned exe itself is not part of runtimeFiles() — count it too
  let runtimeExeBytes = 0;
  if (runtimeEntries && deps.runtimeExePath) {
    try {
      runtimeExeBytes = fs.statSync(deps.runtimeExePath()).size;
    } catch {
      /* best-effort — the space check still covers the rest */
    }
  }
  const free = freeDiskBytes(destDir);
  // 2.0.4 CONTRACT GATE (2.0.5: app-tree aware) — BEFORE the manifest:
  // the runtime-reuse payload MUST contain the app code. If an antivirus
  // quarantined payload/resources/app/** before the install even started,
  // a manifest-driven check alone would never notice (the files are
  // simply absent from the manifest — and when a critical file is the
  // ONLY payload casualty the generic "payload is missing" gate would
  // name no file at all), so the contract itself is enforced first, with
  // the exact file named.
  if (runtimeEntries) {
    const missingCritical: string[] = [];
    for (const rel of CRITICAL_PAYLOAD_FILES) {
      const src = path.join(deps.payloadDir, rel);
      let ok = false;
      try {
        ok = fs.statSync(src).size > 0 && fs.readFileSync(src).length > 0;
      } catch {
        ok = false; // unreadable == quarantined for our purposes
      }
      if (!ok) missingCritical.push(rel);
    }
    if (missingCritical.length > 0) {
      const msg =
        "the app code (" + missingCritical.join(", ") + ") is missing from the installer payload — your antivirus most likely removed it. " +
        "Open Windows Security → Protection history, allow/restore the removed file (or add the install folder to the exclusions), then re-run this setup. " +
        "Nothing was installed.";
      deps.onEvent({ type: "error", message: msg });
      return { ok: false, destDir, cancelled: false, shortcuts, error: msg };
    }
  }
  const manifest = computeManifest(deps.payloadDir);
  if (manifest.fileCount === 0) {
    // 3.1.7: honest, actionable wording — this is almost always an
    // antivirus quarantine or a second launch wiping the first one's
    // portable-extraction folder.
    const msg =
      "payload is missing — the installer package is broken (no files to install). " +
      "Your antivirus most likely removed the installer files, or the setup exe was launched twice. " +
      "Add an antivirus exclusion (or run this setup alone) and try again.";
    deps.onEvent({ type: "error", message: msg });
    return { ok: false, destDir, cancelled: false, shortcuts, error: msg };
  }
  if (runtimeEntries && runtimeEntries.length === 0) {
    const msg = "runtime-reuse mode is active but no runtime files were resolved";
    deps.onEvent({ type: "error", message: msg });
    return { ok: false, destDir, cancelled: false, shortcuts, error: msg };
  }
  const totalNeeded = manifest.totalBytes + runtimeTotalBytes + runtimeExeBytes;
  if (free !== null && free < totalNeeded + 64 * 1024 * 1024) {
    const msg = `not enough disk space: ${(totalNeeded / 1024 ** 2).toFixed(0)} MB needed, ${(free / 1024 ** 3).toFixed(1)} GB free`;
    deps.onEvent({ type: "error", message: msg });
    return { ok: false, destDir, cancelled: false, shortcuts, error: msg };
  }
  emit(
    deps,
    `destination ${destDir} · ${manifest.fileCount + (runtimeEntries?.length ?? 0)} files · ${(totalNeeded / 1024 ** 2).toFixed(1)} MB · free ${
      free === null ? "n/a" : (free / 1024 ** 3).toFixed(1) + " GB"
    }${runtimeEntries ? " · runtime-reuse" : ""}`
  );

  /* 2 — a running MEMENTO would hold file locks; close it gracefully */
  const exeName = deps.isWin ? "MEMENTO.exe" : "MEMENTO";
  if (deps.closeRunningApp(exeName)) {
    emit(deps, "closed a running MEMENTO instance");
  }

  /* 3 — stage a clean destination.
   * 2.0.7 (field report #4): ONLY a previous MEMENTO install — detected
   * by its sentinel — is renamed aside for rollback. A pre-existing
   * folder that is NOT ours (e.g. C:\Users\<you>\Downloads) is installed
   * INTO in place: renaming a foreign folder fails (EPERM — Explorer,
   * Telegram and the indexer hold handles on special folders) and would
   * move user files the setup does not own. */
  let inPlace = false;
  if (fs.existsSync(destDir)) {
    if (fs.existsSync(path.join(destDir, UNINSTALL_SENTINEL))) {
      backupDir = destDir + ".bak-" + Date.now();
      try {
        fs.renameSync(destDir, backupDir);
        emit(deps, "staged the previous installation for replacement");
      } catch (e: any) {
        const msg =
          "cannot stage the previous MEMENTO installation (" + String(e?.message || e) + "). " +
          "Close MEMENTO and any Explorer window showing this folder — an antivirus scan can also lock it — then retry, or pick a different destination.";
        deps.onEvent({ type: "error", message: msg });
        return { ok: false, destDir, cancelled: false, shortcuts, error: msg };
      }
    } else {
      inPlace = true;
      emit(deps, "destination exists and is not a MEMENTO install — installing into it in place (no existing files are renamed, moved or removed)");
    }
  }

  // whether THIS run created the destination from scratch (no previous
  // install was staged aside and no foreign folder was reused) — a failed
  // fresh install is removed again
  const createdDest = !backupDir && !inPlace;

  // 2.0.7: a failed IN-PLACE install removes ONLY the files this run
  // wrote (payload manifest + runtime entries + our exe + the sentinel)
  // — never the foreign folder's own content.
  const cleanupInPlaceFiles = () => {
    const rels = new Set<string>();
    for (const f of manifest.files) rels.add(f.rel);
    for (const r of runtimeEntries ?? []) rels.add(r.rel);
    rels.add(exeName);
    rels.add(UNINSTALL_SENTINEL);
    for (const rel of rels) {
      try {
        fs.rmSync(path.join(destDir, rel), { force: true });
      } catch {
        /* best-effort */
      }
    }
    // our now-empty directories, deepest first — rmdir refuses non-empty
    // dirs, so foreign content is structurally safe; root is never touched
    const dirs = new Set<string>();
    for (const rel of rels) {
      const d = path.dirname(rel);
      if (d && d !== "." && d !== "/") dirs.add(d);
    }
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
      try {
        const p = path.join(destDir, d);
        if (fs.existsSync(p) && fs.readdirSync(p).length === 0) fs.rmdirSync(p);
      } catch {
        /* best-effort */
      }
    }
  };

  const restoreBackup = () => {
    try {
      if (backupDir) {
        if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
        fs.renameSync(backupDir, destDir);
        backupDir = null;
      } else if (createdDest) {
        // 2.0.4 LEAVE-NO-TRACE: a FRESH install that failed must leave the
        // machine exactly as it found it — remove the partial tree this
        // run created instead of stranding a broken app on disk.
        if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
      } else if (inPlace) {
        cleanupInPlaceFiles();
      }
    } catch {
      /* best-effort */
    }
  };

  try {
    /* 4 — copy the payload (cores get their own design-styled lines) */
    emit(deps, "unpacking cores…");
    deps.onEvent({ type: "status", text: "transferring" });
    const coreDirs: Array<[string, string | undefined]> = [
      ["resources/xray", deps.coreVersions.xray],
      ["resources/sing-box", deps.coreVersions.singbox],
      ["resources/aether", deps.coreVersions.aether],
    ];

    if (runtimeEntries) {
      /* 4a — runtime-reuse: clone the installer's own Electron runtime
       * (the exe becomes MEMENTO.exe; dlls/paks/locales ride along). */
      const runtimeDir = deps.runtimeDir!();
      const exeSrc = deps.runtimeExePath!();
      const runtimeBytesTotal = Math.max(1, runtimeTotalBytes);
      let runtimeBytes = 0;
      let runtimeSkipped = 0;
      emit(deps, `reusing the installer runtime (${runtimeEntries.length} files · ${(runtimeTotalBytes / 1024 ** 2).toFixed(1)} MB)`);
      fs.mkdirSync(destDir, { recursive: true });
      // 2.0.3 AV-hardening: hardlink the running image instead of copying
      // it. A process byte-copying ITS OWN exe into a new name is one of
      // the strongest dropper heuristics there is; a hardlink writes ZERO
      // new file content (the directory entry just points at the same
      // data), so there is nothing for the heuristic to score. The plain
      // copy survives only as the cross-volume fallback.
      let exeClone: "linked" | "copied" = "copied";
      try {
        fs.linkSync(exeSrc, path.join(destDir, exeName));
        exeClone = "linked";
      } catch {
        fs.copyFileSync(exeSrc, path.join(destDir, exeName));
        try { fs.chmodSync(path.join(destDir, exeName), 0o755); } catch { /* best-effort */ }
      }
      emit(
        deps,
        exeClone === "linked"
          ? "runtime exe → " + exeName + " (linked — zero bytes of the running image re-written)"
          : "runtime exe → " + exeName + " (copied — different volume, hardlink impossible)",
        { verbose: exeClone === "copied" ? false : true }
      );
      runtimeBytes += fs.statSync(exeSrc).size;
      pct(deps, 6, "reusing installer runtime");
      for (const entry of runtimeEntries) {
        if (deps.cancelled()) {
          emit(deps, "installation cancelled by user", { error: true });
          restoreBackup();
          return { ok: false, destDir, cancelled: true, shortcuts, error: "cancelled" };
        }
        const src = path.join(runtimeDir, entry.rel);
        const dst = path.join(destDir, entry.rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        try {
          fs.copyFileSync(src, dst);
          try { fs.chmodSync(dst, 0o755); } catch { /* best-effort */ }
        } catch (err: any) {
          runtimeSkipped++;
          emit(deps, `skipped runtime file ${entry.rel} (${String(err?.code || err)})`, { verbose: true, error: true });
          continue;
        }
        runtimeBytes += entry.bytes;
        pct(deps, 6 + (runtimeBytes / runtimeBytesTotal) * 60, "reusing installer runtime");
      }
      if (runtimeSkipped > 0) {
        emit(deps, `${runtimeSkipped} runtime file(s) could not be copied — the installed app may not launch; re-run the installer`, { error: true });
      }
      emit(deps, "electron runtime cloned → MEMENTO.exe");
    }

    const res = copyTreeWithProgress(
      deps.payloadDir,
      destDir,
      manifest,
      deps,
      runtimeEntries ? 68 : 2,
      runtimeEntries ? 14 : 76
    );
    if (res.cancelled) {
      emit(deps, "installation cancelled by user", { error: true });
      restoreBackup();
      return { ok: false, destDir, cancelled: true, shortcuts, error: "cancelled" };
    }

    /* 4b — 2.0.4 VERIFY + HEAL: ground truth of what REALLY landed.
     * The field report proved "copy finished" is not "app installed":
     * Defender removed app.asar mid-install and 2.0.3 still reported a
     * green 100%. The entries are the payload manifest PLUS the
     * runtime-reuse contract files (app.asar, MEMENTO.exe) so a file the
     * antivirus removed before or during the copy can never slip through
     * silently. Transient AV scan-locks get a short heal loop; a still-
     * missing CRITICAL file aborts the whole install (rollback below). */
    const verifyEntries: VerifyEntry[] = [];
    for (const f of manifest.files) {
      verifyEntries.push({
        rel: f.rel,
        src: path.join(deps.payloadDir, ...f.rel.split("/")),
        bytes: f.bytes,
        critical: CRITICAL_PAYLOAD_FILES.includes(f.rel),
      });
    }
    if (runtimeEntries) {
      const runtimeDir = deps.runtimeDir!();
      for (const entry of runtimeEntries) {
        const segs = entry.rel.split(/[\\/]/);
        verifyEntries.push({
          rel: segs.join("/"),
          src: path.join(runtimeDir, ...segs),
          bytes: entry.bytes,
          critical: false,
        });
      }
      try {
        verifyEntries.push({
          rel: exeName,
          src: deps.runtimeExePath!(),
          bytes: fs.statSync(deps.runtimeExePath!()).size,
          critical: true,
        });
      } catch {
        /* stat failed — the clone step itself already proved the exe */
      }
    }
    const verification = await verifyAndHealInstall(destDir, verifyEntries, deps);
    if (verification.healed > 0) {
      emit(deps, `${verification.healed} file(s) recovered on re-check (transient antivirus lock)`);
    }
    if (deps.cancelled()) {
      emit(deps, "installation cancelled by user", { error: true });
      restoreBackup();
      return { ok: false, destDir, cancelled: true, shortcuts, error: "cancelled" };
    }
    const criticalMissing = verification.missing.filter((e) => e.critical);
    if (criticalMissing.length > 0) {
      const names = criticalMissing.map((e) => e.rel).join(", ");
      emit(deps, `installation aborted: ${names} missing after verification — rolling back`, { error: true });
      const msg =
        `these required files could not be installed: ${names}. Your antivirus most likely removed them during the install. ` +
        "Open Windows Security → Protection history, allow/restore the removed file (or add the install folder to the exclusions), then re-run this setup. " +
        "Nothing was left half-installed.";
      restoreBackup();
      deps.onEvent({ type: "error", message: msg });
      return { ok: false, destDir, cancelled: false, shortcuts, error: msg };
    }
    if (verification.missing.length > 0) {
      // Visible (non-verbose) honesty line — the user MUST know when the
      // antivirus ate files mid-install, and that Update Center can heal it.
      emit(
        deps,
        `${verification.missing.length} payload file(s) could not be installed (antivirus or locked source) — cores can be restored from Update Center after install`,
        { error: true }
      );
    }
    emit(
      deps,
      `verified ${verification.verified}/${verification.total} installed files against the payload manifest`
    );
    // announce the cores that REALLY shipped, with their REAL versions —
    // and warn (honestly) about the ones an antivirus removed
    let missingCores = 0;
    for (const [rel, ver] of coreDirs) {
      if (fs.existsSync(path.join(destDir, rel))) {
        const label =
          rel === "resources/xray" ? "xray-core" : rel === "resources/sing-box" ? "sing-box" : "aether";
        emit(deps, `${label}${ver ? " " + ver : ""} → ${rel}/`);
      } else {
        missingCores++;
        const label =
          rel === "resources/xray" ? "xray-core" : rel === "resources/sing-box" ? "sing-box" : "aether";
        emit(deps, `${label} was NOT installed (removed by antivirus?) — download it from Update Center`, { error: true });
      }
    }
    // 2.0.3: one always-visible, honest line about the unsigned-binary
    // contract — with the EXACT Windows Security steps — instead of
    // leaving the user alone with a bare "antivirus removed files" error.
    // The setup never modifies AV settings itself (that is malware
    // behavior); it tells the user how to do it in 20 seconds.
    emit(
      deps,
      missingCores > 0
        ? "binaries are unsigned: allow the removed file in Windows Security → Protection history (or add the install folder to exclusions), then re-run this setup"
        : "note: all shipped binaries are unsigned — if your antivirus ever removes one, allow it in Windows Security → Protection history or exclude the install folder",
      { error: missingCores > 0 }
    );
    pct(deps, 84, "payload copied");

    /* 5 — wintun pin line with the REAL hash (truthful log console) */
    const wintun = path.join(destDir, "resources", "wintun", "bin", "amd64", "wintun.dll");
    if (fs.existsSync(wintun)) {
      const h = sha256File(wintun);
      emit(deps, `pinning wintun.dll (sha256 ${h.slice(0, 16)}… verified)`);
    }

    /* 6 — uninstall registration (Add/Remove Programs, per-user) */
    emit(deps, "writing uninstaller registration (Add/Remove Programs)");
    deps.onEvent({ type: "status", text: "registering" });
    const exePath = path.join(destDir, exeName);
    const info: UninstallInfo = {
      DisplayName: "MEMENTO — from EPODONIOS to A Who",
      DisplayVersion: deps.appVersion,
      Publisher: "EPODONIOS",
      InstallLocation: destDir,
      DisplayIcon: exePath,
      UninstallString: `"${exePath}" --memento-uninstall`,
      QuietUninstallString: `"${exePath}" --memento-uninstall /quiet`,
      NoModify: 1,
      NoRepair: 1,
      EstimatedSizeKB: Math.max(1, Math.round(totalNeeded / 1024)),
      UninstallPreservesUserData: 1,
    };
    await deps.writeUninstallRegistration(info);
    pct(deps, 90, "uninstall registration written");

    /* 7 — shortcuts (desktop + start menu + uninstall link) */
    emit(deps, "linking start menu entries", { verbose: true });
    deps.onEvent({ type: "status", text: "linking" });
    if (opts.createDesktopShortcut) {
      const r = deps.writeShortcut(
        path.join(deps.desktopDir(), deps.isWin ? "MEMENTO.lnk" : "memento.desktop"),
        exePath,
        null,
        "MEMENTO — V2Ray Config Editor"
      );
      if (r === "created") shortcuts.push("desktop");
    }
    const smDir = deps.startMenuDir();
    try {
      fs.mkdirSync(smDir, { recursive: true });
    } catch {
      /* best-effort */
    }
    const smLink = path.join(smDir, deps.isWin ? "MEMENTO.lnk" : "memento.desktop");
    const smRes = deps.writeShortcut(smLink, exePath, null, "MEMENTO — V2Ray Config Editor");
    if (smRes === "created") shortcuts.push("start-menu");
    const unLink = path.join(smDir, deps.isWin ? "Uninstall MEMENTO.lnk" : "memento-uninstall.desktop");
    const unRes = deps.writeShortcut(unLink, exePath, "--memento-uninstall", "Uninstall MEMENTO");
    if (unRes === "created") shortcuts.push("start-menu-uninstall");
    pct(deps, 96, shortcuts.join(" + ") || "shortcuts skipped");

    /* 8 — success: drop the staged backup + write the ownership sentinel */
    if (backupDir) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        /* best-effort — stale .bak never blocks the install */
      }
      backupDir = null;
    }
    // 2.0.7 ownership sentinel — ALWAYS written (previously only the
    // POSIX gate twin existed): records whether this install OWNS the
    // folder or lives IN PLACE inside a foreign one, plus the exact
    // installed-file list the app's uninstaller must limit itself to.
    // MERGES with whatever the uninstall-registration twin already wrote
    // (order must never matter).
    try {
      const sentinelPath = path.join(destDir, UNINSTALL_SENTINEL);
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(fs.readFileSync(sentinelPath, "utf8"));
      } catch {
        /* no sentinel yet */
      }
      const sentinelFiles = new Set<string>();
      for (const f of manifest.files) sentinelFiles.add(f.rel);
      for (const r of runtimeEntries ?? []) sentinelFiles.add(r.rel);
      sentinelFiles.add(exeName);
      sentinelFiles.add(UNINSTALL_SENTINEL);
      fs.writeFileSync(
        sentinelPath,
        JSON.stringify(
          {
            ...existing,
            InstallLocation: destDir,
            appVersion: deps.appVersion,
            cores: deps.coreVersions,
            inPlace,
            installedAt: new Date().toISOString(),
            files: [...sentinelFiles].sort(),
          },
          null,
          2
        ),
        "utf8"
      );
      emit(deps, inPlace ? "ownership sentinel written (in-place install, file manifest recorded)" : "ownership sentinel written");
    } catch {
      /* best-effort — the uninstaller falls back to the owned-dir contract */
    }
    emit(deps, "installation complete");
    pct(deps, 100, "installation complete");
    deps.onEvent({ type: "done", destDir });
    return { ok: true, destDir, cancelled: false, shortcuts };
  } catch (e: any) {
    const msg = String(e?.message || e);
    emit(deps, `installation failed: ${msg}`, { error: true });
    restoreBackup();
    deps.onEvent({ type: "error", message: msg });
    return { ok: false, destDir, cancelled: false, shortcuts, error: msg };
  }
}

/* ------------------------------------------------------------------ */
/* Uninstall plan (pure — consumed by MEMENTO's --memento-uninstall)   */
/* ------------------------------------------------------------------ */

/** The full removal plan for an installed MEMENTO. userData is NEVER in
 *  the list — profiles/subscriptions/settings survive an uninstall. */
export function buildUninstallPlan(args: {
  installDir: string;
  isWin: boolean;
  desktopDir: string;
  startMenuDir: string;
  userDataDir: string;
}): { shortcuts: string[]; registryKey: string | null; appDir: string; preserved: string[] } {
  const { installDir, isWin, desktopDir, startMenuDir, userDataDir } = args;
  const shortcuts = isWin
    ? [
        path.join(desktopDir, "MEMENTO.lnk"),
        path.join(startMenuDir, "MEMENTO.lnk"),
        path.join(startMenuDir, "Uninstall MEMENTO.lnk"),
      ]
    : [
        path.join(desktopDir, "memento.desktop"),
        path.join(startMenuDir, "memento.desktop"),
        path.join(startMenuDir, "memento-uninstall.desktop"),
      ];
  return {
    shortcuts,
    registryKey: isWin
      ? "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MEMENTO"
      : null,
    appDir: installDir,
    preserved: [userDataDir],
  };
}
