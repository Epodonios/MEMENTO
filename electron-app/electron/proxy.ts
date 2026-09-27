/**
 * MEMENTO — system proxy (Windows registry) — Electron port of lib.rs
 * `set_system_proxy_inner` / `clear_system_proxy_inner`.
 *
 * The Tauri version wrote directly via the `winreg` crate:
 *   HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
 *     ProxyEnable = 1 (DWORD)      ProxyServer = 127.0.0.1:<port> (SZ)
 *     ProxyEnable = 0 (DWORD)      (clear)
 *
 * The Electron version performs the exact same HKCU writes through
 * Windows' built-in `reg.exe` (no elevation required for HKCU, no native
 * Node modules needed). All failures surface with Rust-style messages so
 * the toasts in the UI look identical.
 */
import { spawnSync } from "child_process";

const INTERNET_SETTINGS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

function regAdd(args: string[]): void {
  const res = spawnSync("reg", ["add", INTERNET_SETTINGS, ...args], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (res.error) {
    throw new Error(`Cannot open registry: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(
      `Cannot write registry value: exit code ${res.status} ${res.stderr || ""}`.trim()
    );
  }
}

/**
 * THE R3 FIX (user bug report #1): a bare `reg add` updates the registry
 * but NEVER notifies WinINET — running applications (browsers, UWP, most
 * Windows apps) keep the OLD proxy state until they are restarted, so the
 * user sees "the system does not consider it a proxy". The documented
 * remedy is to fire the two WinINET notifications after every write:
 *   InternetSetOption(NULL, INTERNET_OPTION_SETTINGS_CHANGED = 39, ...)
 *   InternetSetOption(NULL, INTERNET_OPTION_REFRESH           = 37, ...)
 * rundll32 dispatches both in one call, no elevation, no new dependencies.
 * Best-effort: a failed broadcast must never fail the actual write.
 */
function broadcastProxyChange(): void {
  try {
    if (!isWindows()) return;
    spawnSync(
      "rundll32.exe",
      ["wininet.dll,InternetSetOption", "0", "39", "0", "0"],
      { windowsHide: true, stdio: "ignore", timeout: 5000 }
    );
    spawnSync(
      "rundll32.exe",
      ["wininet.dll,InternetSetOption", "0", "37", "0", "0"],
      { windowsHide: true, stdio: "ignore", timeout: 5000 }
    );
  } catch {
    /* best-effort — the registry write itself already succeeded */
  }
}

export function isWindows(): boolean {
  return process.platform === "win32";
}

/** Port of set_system_proxy_inner(port) + the R3 WinINET broadcast. */
export function setSystemProxy(port: number): void {
  if (!isWindows()) {
    throw new Error("System proxy is only supported on Windows");
  }
  try {
    regAdd(["/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "1", "/f"]);
  } catch (e: any) {
    throw new Error(String(e?.message || e).replace("Cannot write registry value", "Cannot enable proxy"));
  }
  try {
    regAdd(["/v", "ProxyServer", "/t", "REG_SZ", "/d", `127.0.0.1:${port}`, "/f"]);
  } catch (e: any) {
    throw new Error(String(e?.message || e).replace("Cannot write registry value", "Cannot set proxy server"));
  }
  // R3: make running applications PICK UP the new proxy immediately
  // (browsers, UWP, WinINET-based apps) — without this the user's system
  // "does not see" the proxy until every app is restarted.
  broadcastProxyChange();
}

/** Port of clear_system_proxy_inner() + the R3 WinINET broadcast. */
export function clearSystemProxy(): void {
  if (!isWindows()) {
    throw new Error("System proxy is only supported on Windows");
  }
  try {
    regAdd(["/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "0", "/f"]);
  } catch (e: any) {
    throw new Error(String(e?.message || e).replace("Cannot write registry value", "Cannot disable proxy"));
  }
  broadcastProxyChange();
}

/**
 * The kill-switch BLOCKED port (Phase C5): TCP port 9 (discard) on
 * loopback — a port nothing in MEMENTO ever listens on, so a proxy pointed
 * at it fails closed instantly for every system-proxy app.
 */
export const KILL_SWITCH_BLOCKED_PORT = 9;

/**
 * The kill-switch BLOCKED state (Phase C5): the Windows proxy is ENABLED
 * but pointed at 127.0.0.1:9 (TCP discard port — apps fail closed instead
 * of silently falling back to direct; ProxyEnable=0 would BE the leak).
 * Written as ProxyEnable=1 + ProxyServer=127.0.0.1:9. Same HKCU/no-elevation
 * mechanics as every other write here (reg.exe, no netsh, no admin), with
 * DISTINCT error mappings so a failed BLOCK write is distinguishable from
 * a failed live/clear write in tests and logs.
 */
export function setBlockedSystemProxy(): void {
  if (!isWindows()) {
    throw new Error("System proxy is only supported on Windows");
  }
  try {
    regAdd(["/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "1", "/f"]);
  } catch (e: any) {
    throw new Error(String(e?.message || e).replace("Cannot write registry value", "Cannot enable blocked proxy"));
  }
  try {
    regAdd(["/v", "ProxyServer", "/t", "REG_SZ", "/d", `127.0.0.1:${KILL_SWITCH_BLOCKED_PORT}`, "/f"]);
  } catch (e: any) {
    throw new Error(String(e?.message || e).replace("Cannot write registry value", "Cannot set blocked proxy server"));
  }
  broadcastProxyChange();
}

/**
 * Startup audit helper (F9): reads the current ProxyEnable / ProxyServer
 * values back from the registry so the app can detect a proxy LEFTOVER
 * from a previous crashed/killed session. Never throws — a failed query
 * just reports disabled/empty (identical to "nothing to clean up").
 */
export function readProxyState(): { enabled: boolean; server: string } {
  if (!isWindows()) return { enabled: false, server: "" };
  let enabled = false;
  let server = "";
  try {
    const res = spawnSync(
      "reg",
      ["query", INTERNET_SETTINGS, "/v", "ProxyEnable"],
      { windowsHide: true, encoding: "utf8", timeout: 5000 }
    );
    // Output line looks like: "    ProxyEnable    REG_DWORD    0x1"
    if (res.status === 0 && /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(res.stdout ?? "")) {
      enabled = true;
    }
  } catch {
    /* treat as disabled */
  }
  if (enabled) {
    try {
      const res = spawnSync(
        "reg",
        ["query", INTERNET_SETTINGS, "/v", "ProxyServer"],
        { windowsHide: true, encoding: "utf8", timeout: 5000 }
      );
      const m = String(res.stdout ?? "").match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
      if (m) server = m[1];
    } catch {
      /* treat as unknown server */
    }
  }
  return { enabled, server };
}
