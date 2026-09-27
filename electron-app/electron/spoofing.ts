/**
 * MEMENTO — Spoofing Patt elevated launcher — Electron port of lib.rs
 * `launch_spoofing_patt`.
 *
 * Uses the exact same elevation mechanism as the Tauri build (PowerShell
 * `Start-Process -Verb RunAs`), so the UAC prompt, the working-directory
 * contract (companion files resolved relative to the exe's folder) and the
 * "cancelled" error message are byte-for-byte identical. This IS the Windows
 * equivalent of sudo-prompt — chosen deliberately for behavior parity.
 */
import { spawn, spawnSync } from "child_process";
import path from "path";
import { findSpoofingPatt } from "./paths";

export function launchSpoofingPatt(): void {
  const exe = findSpoofingPatt();
  if (!exe) {
    throw new Error(
      "Spoofing Patt was not found. Put its .exe AND all companion files in src-tauri/resources/spoofing-patt/ before building MEMENTO."
    );
  }
  const workDir = path.dirname(exe);

  if (process.platform === "win32") {
    const escapePs = (value: string) => value.replace(/'/g, "''");
    const script =
      `Start-Process -FilePath '${escapePs(exe)}' ` +
      `-WorkingDirectory '${escapePs(workDir)}' -Verb RunAs`;

    let status: number | null = null;
    try {
      const res = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        { windowsHide: true, encoding: "utf8" }
      );
      if (res.error) {
        throw new Error(`Could not request Administrator launch: ${res.error.message}`);
      }
      status = res.status;
    } catch (e: any) {
      if (String(e?.message || "").startsWith("Could not request Administrator launch")) {
        throw e;
      }
      throw new Error(`Could not request Administrator launch: ${e?.message || e}`);
    }

    if (status !== 0) {
      throw new Error("Administrator launch was cancelled or failed.");
    }
    return;
  }

  // Non-Windows: plain detached spawn (same as the Rust cfg(not(windows)) arm).
  try {
    const child = spawn(exe, [], { cwd: workDir, detached: true, stdio: "ignore" });
    child.unref();
  } catch (e: any) {
    throw new Error(`Could not launch Spoofing Patt: ${e?.message || e}`);
  }
}
