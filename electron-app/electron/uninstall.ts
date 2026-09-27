/**
 * MEMENTO — the complete uninstaller (--memento-uninstall).
 *
 * Registered in Add/Remove Programs by MementoSetup as
 *   "C:\…\MEMENTO.exe" --memento-uninstall
 *
 * CONTRACT (the installer's Notes step promises this — keep it true):
 *   REMOVED   program files (the install dir), desktop + Start Menu
 *             shortcuts, the ARP registration, any running core child.
 *   KEPT      userData (%APPDATA%\com.epodonios.memento) — profiles,
 *             subscriptions, routing rules, logs, downloaded cores. A
 *             reinstall picks up exactly where the user left off. A full
 *             purge stays available from Settings → Maintenance.
 *
 * Headless mode: no window, no tray, no single-instance lock fight —
 * argv is checked BEFORE requestSingleInstanceLock in main.ts.
 * The final self-delete runs detached (`cmd /c timeout & rmdir`) because
 * Windows cannot delete a running executable's own directory.
 *
 * The plan builder is ELECTRON-FREE for the gate scripts; the runner is
 * the Electron glue (dialogs + fs + child_process).
 */
import fs from "fs";
import path from "path";

export const UNINSTALL_FLAG = "--memento-uninstall";

export function isUninstallInvocation(argv: string[]): boolean {
  return argv.slice(2).includes(UNINSTALL_FLAG);
}

export function isQuietUninstall(argv: string[]): boolean {
  return argv.slice(2).includes("/quiet") || argv.slice(2).includes("--quiet");
}

export interface UninstallPlan {
  installDir: string;
  exeName: string;
  shortcuts: string[];
  registryKey: string | null;
  preservedUserData: string;
}

/** Where MementoSetup installs by default (per-user, mirrors setup-app). */
export function defaultInstallDir(isWin: boolean, home: string, localAppData?: string | null): string {
  if (isWin) {
    const lad = localAppData || path.join(home, "AppData", "Local");
    return path.join(lad, "Programs", "MEMENTO");
  }
  return path.join(home, ".local", "share", "memento-test");
}

/** Build the exact removal plan. ELECTRON-FREE. */
export function buildPlan(args: {
  isWin: boolean;
  exePath: string;
  desktopDir: string;
  startMenuDir: string;
  userDataDir: string;
}): UninstallPlan {
  const { isWin, exePath, desktopDir, startMenuDir, userDataDir } = args;
  const installDir = path.dirname(exePath);
  const exeName = path.basename(exePath);
  return {
    installDir,
    exeName,
    shortcuts: isWin
      ? [
          path.join(desktopDir, "MEMENTO.lnk"),
          path.join(startMenuDir, "MEMENTO.lnk"),
          path.join(startMenuDir, "Uninstall MEMENTO.lnk"),
        ]
      : [
          path.join(desktopDir, "memento.desktop"),
          path.join(startMenuDir, "memento.desktop"),
          path.join(startMenuDir, "memento-uninstall.desktop"),
        ],
    registryKey: isWin
      ? "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MEMENTO"
      : null,
    preservedUserData: userDataDir,
  };
}

/** The detached self-delete command (POSIX test twin included). */
export function selfDeleteCommand(installDir: string, isWin: boolean): { cmd: string; args: string[] } {
  if (isWin) {
    return {
      cmd: "cmd",
      args: ["/c", `timeout /t 2 /nobreak >nul & rmdir /s /q "${installDir}"`],
    };
  }
  return { cmd: "sh", args: ["-c", `sleep 1; rm -rf '${installDir.replace(/'/g, "'\\''")}'`] };
}

/**
 * Terminate every OTHER MEMENTO.exe (a running GUI would keep the install
 * dir locked). The uninstaller itself is MEMENTO.exe too, so the own pid
 * must be excluded — naive `taskkill /IM MEMENTO.exe /F` would suicide
 * mid-uninstall. Returns the pids that were terminated.
 */
export function otherMementoPids(
  opts: { exeName: string; ownPid: number; isWin: boolean; listOutput: string }
): number[] {
  const { exeName, ownPid, isWin, listOutput } = opts;
  const pids: number[] = [];
  if (isWin) {
    // tasklist /FI "IMAGENAME eq MEMENTO.exe" /FO CSV /NH
    for (const line of String(listOutput || "").split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (m && m[1].toLowerCase() === exeName.toLowerCase()) {
        const pid = Number(m[2]);
        if (Number.isInteger(pid) && pid > 0 && pid !== ownPid) pids.push(pid);
      }
    }
  } else {
    // ps -eo comm=,pid=
    for (const line of String(listOutput || "").split(/\r?\n/)) {
      const m = line.match(/^(.+?)\s+(\d+)$/);
      if (m && m[1].trim() === exeName) {
        const pid = Number(m[2]);
        if (pid !== ownPid) pids.push(pid);
      }
    }
  }
  return pids;
}

export function terminateCommand(pid: number, isWin: boolean): { cmd: string; args: string[] } {
  return isWin
    ? { cmd: "taskkill", args: ["/F", "/PID", String(pid), "/T"] }
    : { cmd: "kill", args: ["-9", String(pid)] };
}

/* ------------------------------------------------------------------ */
/* 2.0.7 / 3.1.8 — the in-place uninstall contract (field report #4)    */
/* ------------------------------------------------------------------ */

/** Shape of the ownership sentinel MementoSetup writes into every
 *  install. When `inPlace` is true the install lives INSIDE a foreign
 *  folder (e.g. the user's Downloads) and the uninstaller must remove
 *  ONLY the recorded files — never the whole directory. */
export interface OwnershipSentinel {
  inPlace: boolean;
  files: string[];
  InstallLocation?: string;
  appVersion?: string;
}

/** Read + validate the sentinel beside the exe. Returns null when it is
 *  absent, unreadable, or not an in-place manifest (→ owned-dir contract:
 *  the whole install dir may be removed as before). */
export function readOwnershipSentinel(installDir: string): OwnershipSentinel | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(installDir, ".memento-uninstall.json"), "utf8"));
    if (
      raw &&
      raw.inPlace === true &&
      Array.isArray(raw.files) &&
      raw.files.length > 0 &&
      raw.files.every((f: unknown) => typeof f === "string")
    ) {
      return { inPlace: true, files: raw.files.map(String), InstallLocation: raw.InstallLocation, appVersion: raw.appVersion };
    }
  } catch {
    /* absent/corrupt → owned-dir contract */
  }
  return null;
}

/** Pure: the per-line delete script for an in-place install. Files are
 *  deleted EXACTLY (no globbing, no recursion); our directories are then
 *  removed with bare rmdir, which structurally REFUSES non-empty dirs —
 *  foreign content cannot be touched even if the manifest were wrong.
 *  A path that escapes the install dir is skipped (traversal guard). */
export function inPlaceDeleteLines(installDir: string, files: string[], isWin: boolean): string[] {
  const root = path.resolve(installDir);
  const q = (p: string) => (isWin ? `"${p}"` : `'${p.replace(/'/g, "'\\''")}'`);
  const lines: string[] = [];
  for (const rel of files) {
    const full = path.resolve(path.join(installDir, rel));
    if (full !== root && !full.startsWith(root + path.sep)) continue;
    lines.push(isWin ? `del /f /q ${q(full)}` : `rm -f ${q(full)}`);
  }
  const dirs = new Set<string>();
  for (const rel of files) {
    const d = path.dirname(rel);
    if (d && d !== "." && d !== "/") dirs.add(d);
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    const full = path.resolve(path.join(installDir, d));
    if (!full.startsWith(root + path.sep)) continue;
    lines.push(isWin ? `rmdir /q ${q(full)}` : `rmdir ${q(full)}`);
  }
  return lines;
}

/** The detached self-delete command for an in-place install: a small
 *  temp script carries the exact lines (a single argv would risk the
 *  8191-char Windows limit at ~150 files). */
export function inPlaceSelfDeleteCommand(
  installDir: string,
  files: string[],
  isWin: boolean,
  writeTemp: (name: string, content: string) => string
): { cmd: string; args: string[] } {
  const lines = inPlaceDeleteLines(installDir, files, isWin);
  if (isWin) {
    const body = ["@echo off", "timeout /t 2 /nobreak >nul", ...lines, 'del /f /q "%~f0"'].join("\r\n");
    const bat = writeTemp(`memento-inplace-uninstall-${process.pid}.bat`, body);
    return { cmd: "cmd", args: ["/c", bat] };
  }
  const script = writeTemp(
    `memento-inplace-uninstall-${process.pid}.sh`,
    "#!/bin/sh\nsleep 1\n" + lines.join("\n") + "\n"
  );
  return { cmd: "sh", args: [script] };
}
