/**
 * MEMENTO — multi-binary process helpers (Task 11 dual-core, Task 12 triple-core).
 *
 * Xray, sing-box and aether are THREE separate executables, so every "is a
 * core running?" / "kill leftover cores" check must cover ALL image names.
 * These helpers are the single source of truth for that; xray.ts, singbox.ts,
 * aether.ts and main.ts all go through here so the binaries can never drift
 * apart in behavior.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { app } from "electron";
import { XRAY_BIN_NAME, SING_BOX_BIN_NAME, AETHER_BIN_NAME, dataDir } from "./paths";
import type { CoreKind } from "./coreTypes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*  Liveness                                                           */
/* ------------------------------------------------------------------ */

/** True when any process of the given binary name is currently alive. */
export function isCoreProcessAlive(binName: string): boolean {
  try {
    if (process.platform === "win32") {
      const res = spawnSync(
        "tasklist",
        ["/FI", `IMAGENAME eq ${binName}`, "/NH"],
        { windowsHide: true, encoding: "utf8", timeout: 5000 }
      );
      // No match prints "INFO: No tasks are running ..." — match the binary
      // name itself instead of parsing locales.
      const name = binName.replace(/\.exe$/i, "");
      return new RegExp(`\\b${name}\\.exe\\b`, "i").test(String(res.stdout ?? ""));
    }
    const res = spawnSync("pgrep", ["-f", binName], {
      encoding: "utf8",
      timeout: 5000,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * True when ANY core binary (xray.exe OR sing-box.exe OR aether.exe) is
 * alive. Used by the F9 startup audit: the audit must only fire when no
 * core owns the current system proxy.
 * Best-effort: on any failure reports "not running".
 */
export function isAnyCoreRunning(): boolean {
  return (
    isCoreProcessAlive(XRAY_BIN_NAME) ||
    isCoreProcessAlive(SING_BOX_BIN_NAME) ||
    isCoreProcessAlive(AETHER_BIN_NAME)
  );
}

/* ------------------------------------------------------------------ */
/*  Orphan kills                                                       */
/* ------------------------------------------------------------------ */

function killImage(binName: string): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/IM", binName, "/T"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      spawnSync("pkill", ["-f", binName], { stdio: "ignore" });
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Kills stray core processes our state doesn't know about (app crashed,
 * force-closed, previous session) — ALL THREE binaries. Best-effort.
 *
 * Scope note (inherited, NOT a new behavior class): the image-wide (/IM)
 * kill is safe because the Electron build enforces a single app instance
 * (main.ts requestSingleInstanceLock), and every start path first stops
 * its own child via stopInternal(). At that point any xray.exe /
 * sing-box.exe / aether.exe left is a true orphan of THIS app — it can
 * never be another instance's live VPN (Rust's original kill_orphaned_xray
 * had the same scope; this is the approved Phase-2 multi-instance-deficiency
 * fix extended to the second and third core binaries).
 */
export async function killAllOrphanedCores(): Promise<void> {
  killImage(XRAY_BIN_NAME);
  killImage(SING_BOX_BIN_NAME);
  killImage(AETHER_BIN_NAME);
  // Sleep so the OS actually releases the sockets before we re-bind —
  // mirrors the Rust sleep(300ms).
  await sleep(300);
}

/** Sync variant for shutdown paths (no settle sleep — app is quitting). */
export function killAllOrphanedCoresNow(): void {
  killImage(XRAY_BIN_NAME);
  killImage(SING_BOX_BIN_NAME);
  killImage(AETHER_BIN_NAME);
}

/* ------------------------------------------------------------------ */
/*  Active-core sidecar                                                */
/* ------------------------------------------------------------------ */

/**
 * SIDECAR file next to memento-active-config.json. sing-box STRICTLY
 * rejects unknown ROOT fields in its config (validated against the real
 * 1.14.0 binary: "core: json: unknown field"), so the "which core does the
 * active config belong to" marker cannot live inside the config itself.
 * It lives here instead, written on every start and deleted on every clean
 * stop by BOTH managers — the same crash-signature lifecycle as the config
 * file (F9 audit logic reads the config file; this sidecar exists purely
 * for provenance/diagnostics and future core-aware audits).
 */
export const ACTIVE_CORE_META_FILE = "memento-active-core.json";

function activeCoreMetaPath(): string {
  return path.join(dataDir(), ACTIVE_CORE_META_FILE);
}

export function writeActiveCoreMeta(
  core: CoreKind,
  version: string,
  ports?: { socksPort?: number; httpPort?: number }
): void {
  try {
    fs.writeFileSync(
      activeCoreMetaPath(),
      JSON.stringify(
        { core, version, writtenAt: new Date().toISOString(), ...ports },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    /* best-effort */
  }
}

export function removeActiveCoreMeta(): void {
  try {
    fs.rmSync(activeCoreMetaPath(), { force: true });
  } catch {
    /* best-effort */
  }
}

export function readActiveCoreMeta(): {
  core: CoreKind;
  version?: string;
  writtenAt?: string;
  socksPort?: number;
  httpPort?: number;
} | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(activeCoreMetaPath(), "utf8"));
    if (
      parsed?.core === "xray" ||
      parsed?.core === "sing-box" ||
      parsed?.core === "aether"
    ) {
      return {
        core: parsed.core,
        version: parsed.version,
        writtenAt: parsed.writtenAt,
        socksPort: parsed.socksPort,
        httpPort: parsed.httpPort,
      };
    }
    return null;
  } catch {
    return null;
  }
}
