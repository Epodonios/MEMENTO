// MEMENTO — Tauri 2.0 Backend
// Manages xray-core: auto-downloads if missing, runs as sidecar,
// controls Windows system proxy, provides live status/logs to the UI,
// and exposes a fast native TCP ping command (used instead of the slow
// browser Image() hack whenever the app runs as a real desktop app).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use std::process::{Child, Command, Stdio};
use std::fs;
use std::path::PathBuf;
use std::io::Read;

const XRAY_VERSION: &str = "v25.1.1";
const MAX_LOG_LINES: usize = 300;

#[cfg(target_os = "windows")]
const XRAY_ZIP_NAME: &str = "Xray-windows-64.zip";
#[cfg(target_os = "windows")]
const XRAY_BIN_NAME: &str = "xray.exe";

#[cfg(target_os = "linux")]
const XRAY_ZIP_NAME: &str = "Xray-linux-64.zip";
#[cfg(target_os = "linux")]
const XRAY_BIN_NAME: &str = "xray";

#[cfg(target_os = "macos")]
const XRAY_ZIP_NAME: &str = "Xray-macos-64.zip";
#[cfg(target_os = "macos")]
const XRAY_BIN_NAME: &str = "xray";

/// Shared state
struct XrayState {
    child: Mutex<Option<Child>>,
    config_path: Mutex<Option<PathBuf>>,
    /// Tail of xray-core's combined stdout+stderr, drained continuously by
    /// a background thread so the OS pipe never fills up and blocks xray.
    logs: Arc<Mutex<VecDeque<String>>>,
    /// Bumped every time start_xray spawns a new process. Used so a stale
    /// background log-draining thread from a previous connection knows to
    /// stop touching `logs` after a reconnect.
    generation: Arc<Mutex<u64>>,
}

#[derive(serde::Serialize, Clone)]
struct ConnectionStatus {
    running: bool,
    pid: Option<u32>,
    socks_port: u16,
    http_port: u16,
}

#[derive(serde::Serialize, Clone)]
struct XrayInfo {
    installed: bool,
    path: String,
    version: String,
}

/* ================================================================== */
/*  Check if xray-core is installed                                     */
/* ================================================================== */

#[tauri::command]
fn check_xray(app: AppHandle) -> XrayInfo {
    match find_xray(&app) {
        Some(path) => XrayInfo {
            installed: true,
            path: path.display().to_string(),
            version: XRAY_VERSION.to_string(),
        },
        None => XrayInfo {
            installed: false,
            path: String::new(),
            version: String::new(),
        },
    }
}

/* ================================================================== */
/*  Auto-download xray-core if missing                                  */
/* ================================================================== */

#[tauri::command]
fn download_xray(app: AppHandle) -> Result<XrayInfo, String> {
    // Already installed?
    if let Some(path) = find_xray(&app) {
        return Ok(XrayInfo {
            installed: true,
            path: path.display().to_string(),
            version: XRAY_VERSION.to_string(),
        });
    }

    // Download destination
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Cannot find app data dir: {e}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Cannot create data dir: {e}"))?;

    let xray_dest = data_dir.join(XRAY_BIN_NAME);
    let zip_url = format!(
        "https://github.com/XTLS/Xray-core/releases/download/{}/{}",
        XRAY_VERSION, XRAY_ZIP_NAME
    );

    // Download the zip
    let response = reqwest::blocking::get(&zip_url)
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let zip_bytes = response.bytes()
        .map_err(|e| format!("Failed to read download: {e}"))?;

    // Extract xray binary from zip
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to open zip: {e}"))?;

    let mut found = false;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {e}"))?;

        if file.name() == XRAY_BIN_NAME || file.name().ends_with(XRAY_BIN_NAME) {
            let mut outfile = fs::File::create(&xray_dest)
                .map_err(|e| format!("Cannot create xray file: {e}"))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Cannot write xray file: {e}"))?;
            found = true;

            // Make executable on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&xray_dest)
                    .map_err(|e| format!("Cannot read permissions: {e}"))?
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&xray_dest, perms)
                    .map_err(|e| format!("Cannot set permissions: {e}"))?;
            }

            break;
        }
    }

    if !found {
        return Err(format!("{} not found in the downloaded zip", XRAY_BIN_NAME));
    }

    // Also extract geoip.dat / geosite.dat if bundled inside the platform
    // zip (some releases include them, some don't).
    let cursor2 = std::io::Cursor::new(&zip_bytes);
    if let Ok(mut archive2) = zip::ZipArchive::new(cursor2) {
        for name in &["geoip.dat", "geosite.dat"] {
            for i in 0..archive2.len() {
                let mut file = match archive2.by_index(i) {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                if file.name().ends_with(name) {
                    let dest = data_dir.join(name);
                    if let Ok(mut outfile) = fs::File::create(&dest) {
                        let _ = std::io::copy(&mut file, &mut outfile);
                    }
                    break;
                }
            }
        }
    }

    // Geo databases are published as SEPARATE release assets (not inside
    // the platform zip) on most Xray-core releases. Fetch them directly as
    // a best-effort fallback so future geo-based routing rules never
    // crash the app due to missing data files. Failure here is silent —
    // MEMENTO's default config does not require these files to run.
    for name in &["geoip.dat", "geosite.dat"] {
        let dest = data_dir.join(name);
        if dest.exists() {
            continue;
        }
        let asset_url = format!(
            "https://github.com/XTLS/Xray-core/releases/download/{}/{}",
            XRAY_VERSION, name
        );
        if let Ok(resp) = reqwest::blocking::get(&asset_url) {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes() {
                    let _ = fs::write(&dest, &bytes);
                }
            }
        }
    }

    Ok(XrayInfo {
        installed: true,
        path: xray_dest.display().to_string(),
        version: XRAY_VERSION.to_string(),
    })
}

/* ================================================================== */
/*  Start xray-core                                                     */
/* ================================================================== */

#[tauri::command]
fn start_xray(
    app: AppHandle,
    state: State<XrayState>,
    config_json: String,
    socks_port: u16,
    http_port: u16,
    api_port: u16,
) -> Result<ConnectionStatus, String> {
    stop_xray_internal(&state);

    // Also clean up any ORPHANED xray.exe process from a previous run
    // (e.g. the app window was closed/crashed without a clean disconnect,
    // or a previous dev/build session left one behind). Without this, the
    // new xray-core we're about to spawn fails instantly with
    // "bind: Only one usage of each socket address is normally permitted"
    // because the old process is still holding the SOCKS/HTTP port —
    // which looks exactly like "connects then disconnects 2 seconds later"
    // with no obvious cause.
    kill_orphaned_xray();

    // Make sure our target ports are actually free before we even try to
    // spawn xray-core. If something else (not necessarily our own leftover
    // process) is squatting on the port, fail fast with a clear message
    // instead of letting xray crash and reporting a cryptic bind error.
    if let Some(busy_port) = first_busy_port(&[socks_port, http_port, api_port]) {
        return Err(format!(
            "Port {busy_port} is already in use by another program.\n\
             Close whatever is using it (another VPN/proxy app, or a leftover xray.exe in Task Manager) and try again,\n\
             or change the SOCKS/HTTP port in the connection settings."
        ));
    }

    // Auto-download if missing
    let xray_path = match find_xray(&app) {
        Some(p) => p,
        None => {
            let info = download_xray(app.clone())?;
            PathBuf::from(info.path)
        }
    };

    // Write config
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Cannot find app data dir: {e}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Cannot create data dir: {e}"))?;

    let config_path = data_dir.join("memento-active-config.json");
    fs::write(&config_path, &config_json)
        .map_err(|e| format!("Cannot write config: {e}"))?;

    // Set XRAY_LOCATION_ASSET so xray can find geoip.dat / geosite.dat
    // (only relevant if routing rules reference geo data; harmless otherwise).
    let asset_dir = data_dir.to_string_lossy().to_string();

    // Spawn xray-core. We pipe stdout/stderr so we can (a) detect an
    // immediate crash caused by a bad config and report the REAL reason
    // instead of silently flipping back to "disconnected" a couple of
    // seconds later, and (b) show live logs in the UI.
    let mut cmd = Command::new(&xray_path);
    cmd.arg("run")
        .arg("-c")
        .arg(&config_path)
        .env("XRAY_LOCATION_ASSET", &asset_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Windows: prevent CMD window from popping up
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("Cannot start xray: {e}"))?;

    let pid = child.id();

    // Take the pipes now — we'll either read them once (crash path) or
    // hand them to a background draining thread (success path).
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    // Give xray a brief moment to initialize so we can catch configs that
    // are rejected immediately (invalid routing, bad UUID, port already in
    // use, missing geo files, etc.) instead of reporting "Connected" and
    // then flipping back to "Disconnected" ~2s later with no explanation.
    std::thread::sleep(std::time::Duration::from_millis(900));

    match child.try_wait() {
        Ok(Some(status)) => {
            // xray already exited — surface the real error to the user.
            let mut combined = String::new();
            if let Some(mut out) = stdout_pipe {
                let mut s = String::new();
                let _ = out.read_to_string(&mut s);
                combined.push_str(&s);
            }
            if let Some(mut err) = stderr_pipe {
                let mut s = String::new();
                let _ = err.read_to_string(&mut s);
                if !s.trim().is_empty() {
                    if !combined.is_empty() { combined.push('\n'); }
                    combined.push_str(&s);
                }
            }
            let trimmed = combined.trim();
            let reason = if trimmed.is_empty() {
                format!("xray-core exited immediately (exit code: {:?}). The config may be invalid.", status.code())
            } else {
                let lines: Vec<&str> = trimmed.lines().rev().take(8).collect();
                lines.into_iter().rev().collect::<Vec<_>>().join("\n")
            };
            return Err(format!("xray-core failed to start:\n{reason}"));
        }
        Ok(None) => {
            // Still alive after the grace period — looks healthy.
        }
        Err(e) => {
            return Err(format!("Cannot verify xray-core status: {e}"));
        }
    }

    // Bump generation so any previous log-draining thread (from an older
    // connection) stops appending to the shared log buffer.
    let my_generation = {
        let mut gen_guard = state.generation.lock().unwrap();
        *gen_guard += 1;
        *gen_guard
    };

    {
        let mut logs = state.logs.lock().unwrap();
        logs.clear();
        logs.push_back(format!("[MEMENTO] xray-core started (pid {pid})"));
    }

    // Continuously drain stdout+stderr in background threads so the OS
    // pipe buffer never fills up (which would otherwise freeze xray after
    // it has logged a few KB of output).
    spawn_log_drainer(state.logs.clone(), state.generation.clone(), my_generation, stdout_pipe);
    spawn_log_drainer(state.logs.clone(), state.generation.clone(), my_generation, stderr_pipe);

    *state.child.lock().unwrap() = Some(child);
    *state.config_path.lock().unwrap() = Some(config_path);

    // Set system proxy
    let _ = set_system_proxy_inner(socks_port);

    Ok(ConnectionStatus {
        running: true,
        pid: Some(pid),
        socks_port,
        http_port,
    })
}

/// Reads lines from a child process pipe forever (until EOF/process exit)
/// and appends them to the shared ring buffer, bounded to MAX_LOG_LINES.
fn spawn_log_drainer(
    logs: Arc<Mutex<VecDeque<String>>>,
    generation: Arc<Mutex<u64>>,
    my_generation: u64,
    pipe: Option<impl Read + Send + 'static>,
) {
    let Some(mut pipe) = pipe else { return };
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(&mut pipe);
        for line in reader.lines() {
            // Stop if a newer connection has replaced this one.
            if *generation.lock().unwrap() != my_generation {
                break;
            }
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let mut guard = logs.lock().unwrap();
            guard.push_back(line);
            while guard.len() > MAX_LOG_LINES {
                guard.pop_front();
            }
        }
    });
}

/* ================================================================== */
/*  Live logs                                                           */
/* ================================================================== */

#[tauri::command]
fn get_xray_logs(state: State<XrayState>) -> Vec<String> {
    state.logs.lock().unwrap().iter().cloned().collect()
}

/* ================================================================== */
/*  Stop xray-core                                                      */
/* ================================================================== */

#[tauri::command]
fn stop_xray(state: State<XrayState>) -> Result<ConnectionStatus, String> {
    stop_xray_internal(&state);
    let _ = clear_system_proxy_inner();

    Ok(ConnectionStatus {
        running: false,
        pid: None,
        socks_port: 0,
        http_port: 0,
    })
}

fn stop_xray_internal(state: &XrayState) {
    // Invalidate the current generation so background log drainers exit.
    {
        let mut gen_guard = state.generation.lock().unwrap();
        *gen_guard += 1;
    }

    let mut child_guard = state.child.lock().unwrap();
    if let Some(ref mut child) = *child_guard {
        let _ = child.kill();
        let _ = child.wait();
    }
    *child_guard = None;

    let mut cfg_guard = state.config_path.lock().unwrap();
    if let Some(ref path) = *cfg_guard {
        let _ = fs::remove_file(path);
    }
    *cfg_guard = None;
}

/// Kills any stray `xray.exe` (or `xray` on Unix) process left running from
/// a previous session that our current `XrayState` doesn't know about —
/// e.g. the app crashed, was force-closed, or a dev rebuild happened while
/// a connection was active. Best-effort: failures are silently ignored,
/// since it's fine if there was nothing to kill.
fn kill_orphaned_xray() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", XRAY_BIN_NAME, "/T"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("pkill")
            .args(["-f", XRAY_BIN_NAME])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    // Give the OS a brief moment to actually release the socket after the
    // process dies — on Windows especially, the port isn't always
    // instantly free the millisecond taskkill returns.
    std::thread::sleep(std::time::Duration::from_millis(300));
}

/// Returns the first port from `ports` that is already occupied by another
/// process, or `None` if they're all free. We test this by trying to bind
/// a TCP listener to 127.0.0.1:<port> — if that fails, something else is
/// already listening there.
fn first_busy_port(ports: &[u16]) -> Option<u16> {
    use std::net::TcpListener;
    for &port in ports {
        if port == 0 {
            continue;
        }
        if TcpListener::bind(("127.0.0.1", port)).is_err() {
            return Some(port);
        }
    }
    None
}

/* ================================================================== */
/*  Live traffic stats (real uplink/downlink via xray-core's Stats API) */
/* ================================================================== */

#[derive(serde::Serialize, Clone, Default)]
struct TrafficStats {
    uplink: u64,
    downlink: u64,
}

#[tauri::command]
async fn get_xray_traffic(app: AppHandle, api_port: u16) -> TrafficStats {
    let Some(xray_path) = find_xray(&app) else {
        return TrafficStats::default();
    };

    // Querying stats starts a short-lived `xray api` helper process. Keep
    // all process I/O off Tauri's command/UI thread and enforce a hard
    // timeout: if the Stats API is temporarily unavailable, a blocking
    // `Command::output()` must never freeze WebView2 or pile up overlapping
    // polls until the app crashes.
    tauri::async_runtime::spawn_blocking(move || query_xray_traffic(xray_path, api_port))
        .await
        .unwrap_or_default()
}

fn query_xray_traffic(xray_path: PathBuf, api_port: u16) -> TrafficStats {

    let mut cmd = Command::new(&xray_path);
    cmd.args(["api", "statsquery", "-s", &format!("127.0.0.1:{api_port}")])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return TrafficStats::default(),
    };

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1200);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return TrafficStats::default();
            }
        }
    }

    let mut output_text = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut output_text);
    }

    let mut uplink: u64 = 0;
    let mut downlink: u64 = 0;

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&output_text) {
        if let Some(arr) = json.get("stat").and_then(|s| s.as_array()) {
            for item in arr {
                let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let value: u64 = item
                    .get("value")
                    .and_then(|v| {
                        v.as_u64()
                            .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                    })
                    .unwrap_or(0);

                // Our outbound is always tagged "proxy" (see v2rayConfig.ts) —
                // this reflects real traffic sent/received through the tunnel.
                if name.contains(">>>proxy>>>traffic>>>uplink") {
                    uplink += value;
                } else if name.contains(">>>proxy>>>traffic>>>downlink") {
                    downlink += value;
                }
            }
        }
    }

    TrafficStats { uplink, downlink }
}

/* ================================================================== */
/*  Status                                                              */
/* ================================================================== */

#[tauri::command]
fn get_xray_status(state: State<XrayState>) -> ConnectionStatus {
    let mut child_guard = state.child.lock().unwrap();

    let running = if let Some(ref mut child) = *child_guard {
        match child.try_wait() {
            Ok(Some(exit_status)) => {
                // Record why we think it died so the UI can show something
                // more useful than a silent "disconnected". Common real
                // causes on Windows: antivirus/Defender killing the
                // process shortly after launch (very common for
                // proxy/tunnel binaries like xray.exe), the upstream
                // server rejecting the handshake repeatedly, or a bad
                // config that only fails once traffic is attempted.
                let mut logs = state.logs.lock().unwrap();
                logs.push_back(format!(
                    "[MEMENTO] xray-core process exited (code: {:?}). If this keeps happening, check that your antivirus / Windows Defender is not blocking or quarantining xray.exe.",
                    exit_status.code()
                ));
                while logs.len() > MAX_LOG_LINES {
                    logs.pop_front();
                }
                *child_guard = None;
                false
            }
            Ok(None) => true,
            Err(_) => {
                *child_guard = None;
                false
            }
        }
    } else {
        false
    };

    let pid = child_guard.as_ref().map(|c| c.id());

    ConnectionStatus {
        running,
        pid,
        socks_port: if running { 10808 } else { 0 },
        http_port:  if running { 10809 } else { 0 },
    }
}

/* ================================================================== */
/*  System proxy (Windows)                                              */
/* ================================================================== */

#[tauri::command]
fn set_system_proxy(socks_port: u16) -> Result<(), String> {
    set_system_proxy_inner(socks_port)
}

#[tauri::command]
fn clear_system_proxy() -> Result<(), String> {
    clear_system_proxy_inner()
}

#[cfg(target_os = "windows")]
fn set_system_proxy_inner(port: u16) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            KEY_WRITE,
        )
        .map_err(|e| format!("Cannot open registry: {e}"))?;
    internet.set_value("ProxyEnable", &1u32)
        .map_err(|e| format!("Cannot enable proxy: {e}"))?;
    internet.set_value("ProxyServer", &format!("127.0.0.1:{port}"))
        .map_err(|e| format!("Cannot set proxy server: {e}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn clear_system_proxy_inner() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            KEY_WRITE,
        )
        .map_err(|e| format!("Cannot open registry: {e}"))?;
    internet.set_value("ProxyEnable", &0u32)
        .map_err(|e| format!("Cannot disable proxy: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_system_proxy_inner(_port: u16) -> Result<(), String> {
    Err("System proxy is only supported on Windows".into())
}

#[cfg(not(target_os = "windows"))]
fn clear_system_proxy_inner() -> Result<(), String> {
    Err("System proxy is only supported on Windows".into())
}

/* ================================================================== */
/*  Find xray binary – now supports bundled xray/ subfolder              */
/* ================================================================== */

fn find_xray(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("xray").join(XRAY_BIN_NAME)); // new: resources/xray/xray.exe
        candidates.push(resource_dir.join(XRAY_BIN_NAME)); // legacy: resources/xray.exe
        // Also check nested resources/resources/ due to Tauri mapping quirks
        candidates.push(resource_dir.join("resources").join("xray").join(XRAY_BIN_NAME));
        candidates.push(resource_dir.join("resources").join(XRAY_BIN_NAME));
    }

    if let Ok(data_dir) = app.path().app_data_dir() {
        candidates.push(data_dir.join("xray").join(XRAY_BIN_NAME));
        candidates.push(data_dir.join(XRAY_BIN_NAME));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("xray").join(XRAY_BIN_NAME));
            candidates.push(exe_dir.join(XRAY_BIN_NAME));
        }
    }

    for p in candidates {
        if p.exists() {
            return Some(p);
        }
    }

    if let Ok(path) = which::which("xray") {
        return Some(path);
    }
    if let Ok(path) = which::which("xray-core") {
        return Some(path);
    }

    None
}

/* ================================================================== */
/*  Bundled helper: Spoofing Patt (run elevated on Windows)            */
/* ================================================================== */

fn find_spoofing_patt(app: &AppHandle) -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join("spoofing-patt"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("spoofing-patt"));
        }
    }

    // Prefer a few conventional filenames, then fall back to the first
    // .exe in the folder. Keeping the whole directory together is critical:
    // Spoofing Patt's two companion files are resolved relative to its
    // working directory.
    let preferred = [
        "spoofing patt.exe",
        "Spoofing Patt.exe",
        "spoofing-patt.exe",
        "spoofing_patt.exe",
    ];
    for root in roots {
        for name in preferred {
            let candidate = root.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
        if let Ok(entries) = fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("exe")).unwrap_or(false) {
                    return Some(path);
                }
            }
        }
    }
    None
}

#[tauri::command]
fn launch_spoofing_patt(app: AppHandle) -> Result<(), String> {
    let exe = find_spoofing_patt(&app).ok_or_else(|| {
        "Spoofing Patt was not found. Put its .exe AND all companion files in src-tauri/resources/spoofing-patt/ before building MEMENTO.".to_string()
    })?;
    let work_dir = exe.parent().ok_or("Invalid Spoofing Patt path")?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let escape_ps = |value: &str| value.replace('\'', "''");
        let script = format!(
            "Start-Process -FilePath '{}' -WorkingDirectory '{}' -Verb RunAs",
            escape_ps(&exe.to_string_lossy()),
            escape_ps(&work_dir.to_string_lossy()),
        );
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .creation_flags(0x08000000)
            .status()
            .map_err(|e| format!("Could not request Administrator launch: {e}"))?;
        if !status.success() {
            return Err("Administrator launch was cancelled or failed.".into());
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new(&exe)
            .current_dir(work_dir)
            .spawn()
            .map_err(|e| format!("Could not launch Spoofing Patt: {e}"))?;
        Ok(())
    }
}

/* ================================================================== */
/*  Fast native TCP ping (real socket connect — same technique v2rayN   */
/*  uses — dramatically faster and more accurate than the browser's     */
/*  Image()-probe fallback used when running outside of Tauri).         */
/* ================================================================== */

#[derive(serde::Deserialize, Clone)]
struct PingTarget {
    id: String,
    host: String,
    port: u16,
}

#[derive(serde::Serialize, Clone)]
struct PingOutcome {
    id: String,
    // Frontend expects `ping`, not `ms`. The previous shape silently
    // produced `{ ms: 123 }`, so every native result reached React as
    // `ping === undefined` and the table rendered no latency at all.
    #[serde(rename = "ping")]
    ms: Option<i64>,
    error: Option<String>,
}

#[tauri::command]
async fn tcp_ping_batch(targets: Vec<PingTarget>, timeout_ms: u64) -> Vec<PingOutcome> {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration, Instant};
    use tokio::sync::Semaphore;

    // High concurrency is safe here: this is a real, short-lived TCP
    // connect (SYN/SYN-ACK/ACK) per target, not an HTTP request — the
    // same approach v2rayN and similar tools use to ping hundreds of
    // servers within a second or two.
    let semaphore = Arc::new(Semaphore::new(64));
    let mut handles = Vec::with_capacity(targets.len());

    for target in targets {
        let sem = semaphore.clone();
        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await;
            let addr = format!("{}:{}", target.host, target.port);
            let start = Instant::now();
            let result = timeout(Duration::from_millis(timeout_ms), TcpStream::connect(&addr)).await;
            match result {
                Ok(Ok(_stream)) => PingOutcome {
                    id: target.id,
                    ms: Some(start.elapsed().as_millis() as i64),
                    error: None,
                },
                Ok(Err(e)) => PingOutcome {
                    id: target.id,
                    ms: None,
                    error: Some(e.to_string()),
                },
                Err(_) => PingOutcome {
                    id: target.id,
                    ms: None,
                    error: Some("Timeout".into()),
                },
            }
        });
        handles.push(handle);
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(outcome) = handle.await {
            results.push(outcome);
        }
    }
    results
}

/* ================================================================== */
/*  Entry point                                                         */
/* ================================================================== */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(XrayState {
            child: Mutex::new(None),
            config_path: Mutex::new(None),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            generation: Arc::new(Mutex::new(0)),
        })
        .invoke_handler(tauri::generate_handler![
            check_xray,
            download_xray,
            start_xray,
            stop_xray,
            get_xray_status,
            get_xray_logs,
            get_xray_traffic,
            set_system_proxy,
            clear_system_proxy,
            tcp_ping_batch,
            launch_spoofing_patt,
        ])
        .on_window_event(|window, event| {
            // Make absolutely sure xray-core (and the system proxy it may
            // have enabled) never survives the app closing. Without this,
            // closing MEMENTO while connected leaves xray.exe running in
            // the background forever, permanently holding the SOCKS/HTTP
            // ports — which is exactly what caused the
            // "connects then immediately disconnects" bug on next launch.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<XrayState>();
                stop_xray_internal(&state);
                let _ = clear_system_proxy_inner();
                kill_orphaned_xray();
            }
        })
        .run(tauri::generate_context!())
        .expect("⚠️ MEMENTO failed to start");
}
