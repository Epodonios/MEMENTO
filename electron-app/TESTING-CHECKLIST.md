# MEMENTO — Electron Migration Test Checklist

Every feature below was ported 1:1 from `src-tauri/src/lib.rs` to
`electron-app/electron/`. Tick each item on a real Windows 10/11 machine
after `npm run dist` in `electron-app/`.

## 0. Build & Launch
- [ ] `npm install` at repo root, `npm install` in `electron-app/`
- [ ] `npm run sync:resources` — xray/, spoofing-patt/, domain-fronting/, geoip.dat, geosite.dat land in `electron-app/resources/`
- [ ] `npm run make:icon` — `build/icon.ico` generated
- [ ] `npm run dist` produces `release/MEMENTO-2.0.0.exe` (single portable exe, no installer)
- [ ] Launching the exe shows the frameless window 1280×820 (min 480×600), centered
- [ ] Taskbar icon = MEMENTO eye logo; window title (Alt-Tab) = "MEMENTO — from EPODONIOS to A Who"

## 1. Custom title bar
- [ ] Drag the window by the empty bar area and the brand area
- [ ] Minimize button works
- [ ] Maximize toggles; icon switches Square ↔ Restore; double-click on bar toggles maximize
- [ ] Restore down keeps the min-size constraint
- [ ] Close button exits the app (and section 4 passes)
- [ ] RTL languages (fa/ar): bar and controls mirror correctly

## 2. xray-core lifecycle
- [ ] Connection tab shows "xray-core Ready ✓" with the bundled path (`resources/…` inside the unpacked portable dir)
- [ ] Delete/move the bundled xray → app auto-downloads v25.1.1 to `%APPDATA%\com.epodonios.memento\` and connects
- [ ] Connect with a real VMess/VLESS/Trojan config → status "Connected ✓", PID shown
- [ ] Live logs panel streams xray output (incl. lines from the first 900 ms)
- [ ] Connect with a deliberately invalid config → toast shows the REAL error (last lines of xray output, not "disconnected after 2 s")
- [ ] Connect while port 10808/10809/15490 is held by another program → clear multi-line "Port … is already in use" toast
- [ ] Leave an orphan xray.exe running (kill the app via Task Manager) → next Connect kills the orphan and succeeds
- [ ] Disconnect → process gone (Task Manager), `memento-active-config.json` deleted from the data dir
- [ ] Configs tab quick-connect and Connection tab agree on state; switching tabs never resets status
- [ ] xray dies mid-session (kill from Task Manager) → within ~3 s status flips to disconnected + antivirus-hint line appears in logs

## 3. Live traffic
- [ ] While connected and browsing through the proxy, Uplink/Downlink counters increase (Stats API `>>>proxy>>>traffic>>>…`)
- [ ] Counters survive the 3-second polling loop (no zeros flicker, no overlapping `xray api` helpers in Task Manager)

## 4. App-close cleanup (critical)
- [ ] Close the window while connected → xray.exe gone, proxy cleared, ports free
- [ ] Relaunch → "connects then immediately disconnects" bug does NOT appear

## 5. System proxy
- [ ] Connect in "System Proxy" mode → `HKCU\…\Internet Settings`: ProxyEnable=1, ProxyServer=127.0.0.1:<socks port>; browser traffic routed
- [ ] Disconnect → ProxyEnable=0
- [ ] Connect in "Direct" mode → proxy is still set (preserved Tauri quirk), manual Disconnect/Close clears it

## 6. Auto Failover
- [ ] Enable Auto Failover (group scope, match-port off) → kill the active server → toast "automatically switching…" and the best-ping candidate connects
- [ ] Same-port matching and "any config" scope behave as before
- [ ] With failover disabled → "xray-core stopped unexpectedly" toast only

## 7. Config Pinger (TCP batch ping)
- [ ] Ping all configs → latencies fill the table within 1–2 s for hundreds of targets (native path, 64-way concurrency)
- [ ] Unreachable hosts show "Timeout"/error, not a hang; batches of 400 stream progressively
- [ ] Pinger tab task completion chime + Windows notification still fire

## 8. IP Scanner
- [ ] Scan a range → results identical to the Tauri build (same native TCP ping backend)

## 9. Domain Fronting (Brokers)
- [ ] Brokers modal opens; fetching a broker source imports configs into a group (renderer fetch + CORS proxies)
- [ ] `domain-fronting/` tool folder is present in the packaged resources (manual use, no in-app launcher — per migration decision)

## 10. Spoofing Patt (UAC)
- [ ] Launch button → UAC prompt appears; accepting starts the tool with its own folder as working directory (companion files load)
- [ ] Cancelling the UAC prompt → "Administrator launch was cancelled or failed." toast
- [ ] With `spoofing-patt/` removed from resources → "Spoofing Patt was not found…" toast

## 11. Import / Export
- [ ] Import: clipboard paste, URL fetch (incl. CORS-proxy fallbacks), and file picker (.txt/.json/.yaml/.yml via FileReader)
- [ ] Export: copy to clipboard + `.txt` download
- [ ] Editor: file open (FileReader), copy, download — all browser APIs, unchanged

## 12. Persistence & misc
- [ ] Configs, subscription groups, theme, language, connection mode, ports survive app restart (localStorage in `%APPDATA%\com.epodonios.memento\Local Storage`)
- [ ] Existing Tauri-era data dir is reused (xray not re-downloaded after migration)
- [ ] Contact/Donate links open in the default browser (not inside the window)
- [ ] Keyboard shortcuts, toasts, RTL layouts, i18n (en/fa/zh/ar) unchanged
- [ ] Dropping a file onto the window does NOT navigate away (dragDropEnabled:false parity)
- [ ] Plain-browser dev (`npm run dev` → open localhost:5173 in a tab) still works: no title bar, browser-mode toasts, Image()-probe ping fallback

## 13. Regression guards
- [ ] No console window flashes when spawning xray/taskkill/powershell (windowsHide)
- [ ] Launching a second MEMENTO instance focuses the existing window instead of starting a competing process (approved Phase-2 single-instance lock — the legacy multi-instance behavior allowed one instance's connect to taskkill the other's live VPN)
- [ ] DevTools absent in the packaged build

## 14. Dual-core — sing-box (Hysteria2 / TUIC, Task 11)

Setup: place the pinned `sing-box.exe` v1.14.0 in `resources/sing-box/`
(see that folder's README for URL + SHA-256). Without it, the Hysteria2/TUIC
items below fail with a clear message and everything else is unaffected.

- [ ] Import `hysteria2://` and `tuic://` links (incl. `hy2://`, obfs + `obfs-password`, `insecure=1`, `udp_relay_mode`, `alpn`) → configs appear with the pink/cyan protocol chips and a Core: sing-box detail field
- [ ] Connect a Hysteria2/TUIC config → `sing-box.exe` appears in Task Manager (NOT xray.exe), status "Connected ✓" + small "sing-box" badge on the status card and next to the selected config
- [ ] Configs tab: the ACTIVE sing-box row shows the small "sing-box" badge next to its name (Xray rows show "Xray" when active)
- [ ] Logs tab streams sing-box output (`[MEMENTO] sing-box v1.14.0 started (pid …)`); an invalid TUIC/Hysteria2 config shows the REAL sing-box error (last output lines)
- [ ] Live traffic counters increase while browsing through a Hysteria2/TUIC connection (clash_api `/connections` totals — verified 401 without the secret, so no unauthenticated endpoint is left open)
- [ ] **Single live core:** connect an Xray config, then connect a Hysteria2/TUIC config → xray.exe disappears and sing-box.exe starts (and vice versa); exactly one core binary is ever present in Task Manager
- [ ] Disconnect / close the app → sing-box.exe gone, `memento-active-config.json` AND `memento-active-core.json` deleted from `%APPDATA%\com.epodonios.memento\`
- [ ] Kill the app via Task Manager while sing-box is live → relaunch cleans the leftover proxy AND kills the orphaned sing-box.exe on next start
- [ ] Editor: pasting hysteria2/tuic links shows the amber sing-box banner; generating skips them and the toast reports the skipped count; an all-sing-box input errors clearly without touching anything
- [ ] Crash toast names the right core: force-kill sing-box.exe while connected → toast says "sing-box stopped unexpectedly" (in the UI language); same for xray.exe → "Xray-core …"

## 15. Antivirus / Windows Defender (unsigned cores)

Both `xray.exe` and the bundled `sing-box.exe` are UNSIGNED upstream
binaries — proxy/VPN tooling is a classic false-positive target.

- [ ] If Defender quarantines a core on first connect, restore it and add an exclusion for the MEMENTO folder (`Windows Security → Virus & threat protection → Exclusions`), then reconnect
- [ ] Same for third-party AVs (Kaspersky/ESET/…): exclusion for `resources\` and `%APPDATA%\com.epodonios.memento\` is enough — no need to disable protection
- [ ] Verify the core hash instead of trusting an AV verdict: `Get-FileHash` the downloaded zip and compare with the pinned SHA-256 in `resources/sing-box/README.md` (sing-box) — a hash mismatch means a tampered binary: do NOT run it

## 16. Aether tab (Task 12, SOCKS5-only)

Setup: place the pinned official `aether.exe` v1.9.0 in `resources/aether/`
(see that folder's README for the URL, the zip/binary SHA-256 and the
official SHA256SUMS.txt provenance). Without it, the Aether tab fails with a
clear message and everything else is unaffected.

- [ ] Aether tab appears after Export in the sidebar (Orbit icon); the attribution line links to the official CluvexStudio/Aether repo
- [ ] Integrity gate: temporarily replace `aether.exe` with any other file → Connect refuses with the sha256-mismatch error and never spawns; restore the pinned binary → connects again
- [ ] Protocol dropdown defaults to GOOL (live-verified fastest); switching to MASQUE → `aether.exe` appears in Task Manager, the log shows the gateway hunt then `socks5 server listening on 127.0.0.1:<port>`, status flips connecting → connected, toast "Connected via masque ✓"
- [ ] Connect with protocol WG → same lifecycle; the log shows the WireGuard endpoint hunt then `wireguard tunnel validated`; cloudflare trace through the SOCKS port returns warp=on
- [ ] Connect with Smart Connect → the log shows `[smart] candidate=… result=…` lines and the status pill shows the live candidate progress (candidate i/n); the first successful candidate is kept
- [ ] Custom endpoint (masque/wg): enter `ip:port` → the log shows the forced-peer path (no gateway scan); invalid shapes (hostname, missing port) are rejected with a clear error
- [ ] gool: enter only the outer WIW hop → the scan finds the inner hop; enter both → no scan; equal outer/inner is rejected
- [ ] HTTP CONNECT listener: enable it → after connect `curl -x http://127.0.0.1:<http-port> https://www.cloudflare.com/cdn-cgi/trace` returns warp=on; system-proxy toggle then points the OS proxy at the HTTP port (registry check: ProxyServer = 127.0.0.1:<http-port>)
- [ ] System proxy OFF (default): after connect the registry ProxyEnable must stay 0 for the aether path (renderer-owned toggle, main never touches the registry for aether)
- [ ] Advanced section (collapsed by default) opens: noize profiles, IP mode, h2 transport, TLS fragment (enabled only with masque+h2), ECH 3-state, DNS, routing block/direct/file, upstream, quick-reconnect, log level — every value persists across an app restart (localStorage `memento-aether-settings`)
- [ ] Noize "default" omits AETHER_NOIZE (core picks firewall for MASQUE / balanced for WireGuard); a picked profile is passed verbatim
- [ ] Routing sanity: route block `port:25` + route direct `mybank.com` accepted; rules containing `;` `&` `|` rejected; DNS `1.1.1.1, 1.0.0.1` accepted, garbage rejected
- [ ] Upstream: `socks5://127.0.0.1:1080` accepted; wrong scheme (`ftp://…`) rejected at validation
- [ ] Mutual exclusion both ways: connect a config (Xray/sing-box) then Connect in the Aether tab → the config core disappears (exactly one core in Task Manager) and the Connection tab shows disconnected without a failover toast; connect a config while Aether is live → aether.exe disappears, Aether tab returns to "Disconnected"
- [ ] Traffic counters (Connection tab) stay 0 during an Aether session (honest limitation — the core has no stats API) while the Aether log pane keeps streaming
- [ ] Disconnect or close the app → aether.exe gone, `memento-active-core.json` deleted; kill the app via Task Manager while aether is live → relaunch kills the orphaned aether.exe and cleans a leftover system proxy that points at the Aether port
- [ ] Crash toast names the right core: force-kill aether.exe while connected → toast says "Aether stopped unexpectedly" (in the UI language)
- [ ] Language switch EN/فا/中/ع: every Aether label renders in the selected language (no raw keys)

## 17. SOCKS5 links + new brokers (Task 13)

Valid imports (Configs tab → slate "socks" chip, detail shows Core: xray):

- [ ] Anonymous `socks://1.2.3.4:1080` imports as a valid config with no credentials
- [ ] Plain creds `socks://user:pass@host:port` — incl. a password containing `:` (split at the FIRST colon)
- [ ] Base64 creds `socks://<base64(user:pass)>@host:port` — unpadded and url-safe forms both accepted
- [ ] `socks://Og@host:port` (base64 of ":") and the user's original sample link → anonymous profile, no crash
- [ ] Legacy `socks://<base64(user:pass@host:port)>` imports with user/pass/address intact
- [ ] `socks5://` alias behaves identically; `#remark` becomes the config name; `?query` is ignored
- [ ] Bracketed IPv6 `socks://user:pass@[2001:db8::1]:1080` parses to the bare address

Malformed imports (each becomes an INVALID row with a human-readable reason — never a crash, never a wrong address):

- [ ] Legacy base64 whose payload does NOT decode to `user:pass@host:port` (e.g. base64 of "not-a-valid-format")
- [ ] Port rejects: `0`, `99999`, non-numeric (`socks://host:abc`), missing port (`socks://1.2.3.4`)
- [ ] Empty host (`socks://:1080`), scheme-only (`socks5://`), body that is neither host:port nor valid base64
- [ ] Unusable userinfo (`socks://zzz@1.2.3.4:1080` where zzz is neither plain user:pass nor base64 of it) → rejected, NOT silently anonymous

Runtime & integration:

- [ ] Connect a socks config → xray.exe runs (sing-box must NOT start); an unreachable socks server shows the REAL xray error on stop
- [ ] Fast ping fills latencies for socks rows (incl. legacy-b64 links); raw/base64/json/clash (`type: socks5`)/sing-box (`version: "5"`) exports include socks correctly; Surge export excludes it (intentional)
- [ ] Bulk rename and the IP/port editor work on URI-form socks links; legacy-b64 links are left uncorrupted
- [ ] Brokers: fetch barry-far "All Configs" and MatinGhanbari "All (v2ray)" → configs imported, ZERO `#profile-title` invalid rows; the new brokers appear with rose/indigo/lime/teal icons

## 18. Phase D1 — live speed + Connect Best + IP check

Live speed (Connection tab, visible while connected):

- [ ] A second (cyan) chip appears next to the cumulative ↓/↑ chip showing `↓ x/s ↑ x/s`; values update every ~3 s poll and stay at `0 B/s` when idle
- [ ] Download a file through the tunnel → the ↓ value rises into KB/s or MB/s territory; totals keep counting independently
- [ ] Switch tabs and back → speed keeps updating (ConnectionManager is always mounted) and is never stale after a disconnect (resets to 0)
- [ ] Reconnect / failover mid-session → speed never shows a negative or absurd spike (counter-reset guarded)
- [ ] Aether session live → Connection-tab counters stay 0 as before AND the Aether tab shows the inline note that no traffic stats API exists for this core (honest limitation)

Connect Best (Configs tab, cyan button next to ⚡ Ping):

- [ ] With ping data present: picks the lowest-latency config of the CURRENT view (respects group tab + filter + search), switches to the Connection tab and connects; toast names the config + latency
- [ ] Already connected to the winner → green "already connected" toast, no reconnect
- [ ] No ping data → info toast telling the user to run ⚡ Ping first (the button never launches a silent multi-second ping sweep)
- [ ] The button does not fight the table's Ping sort — clicking the Ping header still sorts ascending (pre-existing feature, unchanged)

IP & Leak Check (Connection tab, right column card):

- [ ] (manual, live tunnel) The exit probe runs on a throwaway Electron session pinned to `socks5://127.0.0.1:<socksPort>` via `ses.fetch` (NOT net.fetch): with a LIVE Xray connection and the system proxy OFF, the Exit IP still equals the tunnel egress (hostname handed to SOCKS5 unresolved) — nothing else on the machine can explain the match
- [ ] Click Check while connected (system proxy on): Exit IP (via :socksPort) differs from Direct IP → green "proxy path active" verdict; country codes shown
- [ ] Click Check while disconnected: exit path fails with a clear connection-refused style error; direct IP still resolves
- [ ] Click Check during an Aether session: exit probe tests the AETHER socks port; for warp-based protocols an orange "WARP: on" chip appears
- [ ] Direct IP never goes through the proxy (Node https) even with system proxy on — the two IPs must differ while tunneled
- [ ] System DNS servers section lists the OS resolvers with the mode hint text; empty list renders "—"
- [ ] Language switch EN/فا/中/ع: every IP-check label, speed tooltip and Connect Best toast renders in the selected language

## 19. Phase D2 — subscription userinfo + builder toggles

Subscription usage (userinfo):

- [ ] Refresh a group whose server reports `subscription-userinfo` (real panel or local test server) → the Configs tab shows the usage bar for that group when active: used/total bytes, percent bar (amber >75%, red >90%), expiry date, capture timestamp
- [ ] A server that ships usage only in the `#subscription-userinfo:` body line is captured too (header-less sources); a server that reports nothing shows the explicit "does not report usage info" note in Manage Groups — and no usage bar on the table
- [ ] Auto-update (interval elapsed) and broker fetches also refresh the stored usage; a later fetch that does NOT expose the info keeps the previous value (fetchedAt unchanged)
- [ ] Expire=0 / missing expire renders "No expiry"; total=0 renders "no quota reported" with no percent
- [ ] Usage survives app restart (persisted with the group blob)

Builder toggles:

- [ ] Configs tab → "Builder Options" opens a collapsed panel; flipping nothing and connecting generates the SAME core JSON as before D2 (defaults = old hardcodes)
- [ ] Mux on + vmess/vless/trojan without flow → outbound `settings.mux {enabled:true, concurrency:8}`; XTLS-vision vless → mux silently omitted; hysteria2/tuic (sing-box) → mux never emitted
- [ ] Allow LAN on → both local inbounds listen 0.0.0.0 (Xray AND sing-box); off → 127.0.0.1; with LAN on, a second device can reach the socks port (firewall permitting)
- [ ] Allow LAN ON → amber security-warning banner appears under the Builder Options grid (and disappears when toggled off); text explains the unauthenticated LAN exposure + exit-IP sharing risk
- [ ] Sniffing off → `sniffing.enabled:false` on both Xray inbounds; Block BitTorrent off → the bittorrent routing rule disappears
- [ ] Skip TLS verify off → `allowInsecure:false` on vmess/vless/trojan TLS; reality settings untouched
- [ ] Log level select → Xray `log.loglevel` matches; sing-box maps warning→warn; debug level shows verbose core logs in the connection log viewer
- [ ] Toggles persist across restart (localStorage memento-builder-options) and "Reset to defaults" restores the exact defaults
- [ ] Toggles apply on the NEXT connect: a live session keeps its current config; after reconnect the new JSON (Connection tab preview shows it live) matches the toggles

## 20. Phase D3 — autostart + global hotkeys + QR + backup

- [ ] App Options panel opens from the Configs tab (collapsed by default) and shows current prefs read from the shell (not guessed)
- [ ] (manual, packaged Windows build) Start-with-Windows ON -> MEMENTO appears minimized after a re-login; OFF removes the login item. In dev/browser the toggle toasts "unsupported" honestly
- [ ] (manual, portable exe) ON -> the HKCU Run entry points at the PORTABLE exe path itself (not a %TEMP% unpack folder); move/rename the exe -> toggle OFF then ON -> the entry points at the new path (UI hint documents this)
- [ ] (manual, portable exe) With autostart ON, reopening App Options still shows the toggle as ON (read-back uses the same path+args that were registered)
- [ ] Ctrl+Alt+V hides the window (core keeps running, traffic continues) and brings it back focused; toggle OFF in App Options disables it system-wide
- [ ] Ctrl+Alt+C while connected -> disconnect; while idle with a last config -> reconnect; while idle with nothing -> "no config selected" toast; during an Aether session -> pointer to the Aether tab
- [ ] If another app owns a hotkey combo, App Options shows the amber "wanted ON, but owned" hint (hotkeysActive vs wanted)
- [ ] QR button on any config row -> QR modal; scanning it with a phone yields the exact same link; Copy link and Save PNG work
- [ ] Import tab -> QR image: a screenshot of a QR (even from another client) imports its config through the normal pipeline (dedupe + optional group assignment); an image with no QR gives a clear error
- [ ] Dropping an IMAGE onto the Import drop-zone goes to the QR decoder; dropping .txt still imports as text
- [ ] Export backup -> one memento-backup-*.json containing configs, groups, builder options, language/theme, connection mode/ports and auto-failover
- [ ] Restore: wrong file (not a backup / bad version) -> clear rejection toast; correct file -> confirmation with item count -> applied -> app reloads with the restored state; unrelated localStorage keys survive
- [ ] Hotkey/prefs file `memento-app-prefs.json` persists across restarts; unregistering happens on quit (no sticky global hotkey after app exit)

## 21. Phase D4 — Settings tab + tray + close-to-tray

- [ ] Settings tab appears in the sidebar (between Aether and Donate) and shows four sections: Window & Startup, Global Hotkeys, Connection Builder, Backup & Restore
- [ ] With Close-to-tray ON (default): clicking X hides the window, the VPN keeps running (traffic continues), and the tray icon brings the window back with a left click
- [ ] The FIRST hidden close shows the native Windows balloon/toast once ("MEMENTO is still running"); closing again does NOT repeat it; the flag survives restarts
- [ ] (manual) With the UI set to fa/zh/ar, the balloon + tray menu render in that language (language sync persists in memento-app-prefs.json)
- [ ] Close-to-tray OFF in Settings → clicking X really quits: xray is killed, system proxy cleared, orphan-killer ran (verify with task manager + registry)
- [ ] Tray right-click menu: Connect/Disconnect label matches the real state (connect, then check the label flips to Disconnect); the item toggles the connection like Ctrl+Alt+C; Quit exits the app fully
- [ ] Ctrl+Alt+V works while the window is hidden; tray left click while hidden brings it back focused
- [ ] (manual, packaged Windows) With autostart ON, a re-login starts MEMENTO fully HIDDEN with only the tray icon visible — tray click / Ctrl+Alt+V / relaunching the exe all restore it
- [ ] Launching the exe a second time while the window is hidden restores + focuses the window (single-instance path)
- [ ] Settings > Global Hotkeys: the amber "owned by another app" hint still appears when a combo is taken; toggles re-register instantly
- [ ] Settings > Connection Builder: mux/allowLan/etc. still write to the persisted store; the Connection tab JSON preview reflects them on the next render; allowLan ON still shows the amber security warning; Reset restores defaults
- [ ] Settings > Backup & Restore: export/import round-trip still works from the new home (rejection paths included); unrelated localStorage keys survive a restore

## 22. Phase C1 — live traffic chart + TLS fragment

- [ ] Connect to any config → the Connection tab shows the live traffic chart under the stats row; download (cyan) and upload (yellow) areas move with real traffic (open a website / run a speed test)
- [ ] The chart window is ~6 minutes: after ~6+ minutes connected, old samples roll out on the left while fresh ones arrive on the right; peak + max labels stay readable
- [ ] Disconnect → chart disappears; reconnect → the chart starts EMPTY (no residue from the previous session); switching configs mid-session resets it too
- [ ] Leave the Connection tab open while connected and browse the Configs tab with ~2000 configs: tab switching stays smooth (the chart must not re-render anything outside itself — perf contract)
- [ ] Browser preview (npm run dev in a plain browser): the chart never appears with stale data (no polling there; it can only sit in its waiting state while connected)
- [ ] Settings → Connection Builder: the new "TLS fragment (anti-DPI)" toggle is OFF by default; the Connection tab JSON preview has NO fragment dialer outbound and no sockopt
- [ ] Toggle fragment ON with a vmess/vless/trojan TLS (or reality) config selected → the JSON preview gains a `memento-frag-dialer` freedom outbound (after `proxy`) and the proxy's streamSettings carries `sockopt.dialerProxy: "memento-frag-dialer"`
- [ ] (manual, real Windows) With fragment ON, connect to a REAL server over a REAL (censored) path — not just a local/sandbox peer: confirm the fragmented ClientHello actually PASSES real DPI control (traffic flows on the fragmented config where the same config with fragment OFF is disrupted/blocked). The sandbox live test only proves correct byte-splitting; DPI pass-through can only be proven against a real server. Also confirm the fragmented handshake does not break: try a plain tcp+tls and a ws+tls config
- [ ] Select a hysteria2/tuic config → the sing-box JSON preview stays fragment-free (honest skip); same for ss/socks configs on the Xray path
- [ ] Enter an invalid range (e.g. length `abc` or packets `200-100`) → the amber warning appears in Settings and the JSON preview silently drops the dialer (feature off, never a broken config); fixing the range re-enables it
- [ ] The three range fields persist across restarts (localStorage `memento-builder-options`) and ride along in backup/restore round-trips

## 23. Phase C2 — real URL-test + latency history + custom Test URL

- [ ] Settings -> Connection Builder: the "Test URL" field shows the default `https://www.gstatic.com/generate_204`; entering garbage (no scheme, a space, >500 chars) turns the input red and Save stays disabled; a valid URL saves with a toast
- [ ] Enter an invalid URL that bypasses the UI (e.g. paste `ftp://x` after editing) -> the main-side sanitizer drops it and the field shows the previous value (never poisoned)
- [ ] Configs tab: each row has a small Activity (real-delay) button; testing one row shows a spinner on that button only, then a teal/yellow/red ms badge appears UNDER the TCP-ping badge (rows never tested stay clean)
- [ ] Test the same row twice -> a tiny sparkline appears next to the badge (>= 2 samples); a failed probe shows a red "Failed" badge with the error on hover
- [ ] The batch "URL-test" button runs over the CURRENT view with a live `n/total` counter; clicking it again cancels scheduling (in-flight probes finish); a completion toast/notification reports OK/failed counts
- [ ] While a URL-test batch runs, switch to the Configs tab and scroll 2000 rows: scrolling stays smooth (history lives outside zustand; only tested rows re-render — perf contract)
- [ ] Connect to a config and press "Real-delay test" on the Connection tab -> a toast shows the measured ms; the result also lands in that config's badge history (tunnel mode, nothing spawned)
- [ ] (honest limits) A hysteria2/tuic row is tested through a real sing-box instance; ss/socks rows through xray; the Aether session is testable via the Connection-tab tunnel button only (per-row tests are config-driven cores)
- [ ] Pinger tab: switch to "Real-Delay Test", paste links, run — results appear per line with `url` as transport; successful links can still be sent to the table; NO badges appear on the Configs tab for these pasted links (they have no identity)
- [ ] Start a URL-test and IMMEDIATELY connect to a config -> the in-flight probe may report a failure ("core exited during probe" / killed by the connect's orphan sweep); the connect itself is NEVER disturbed, no system-proxy writes from the probe at any time
- [ ] Restart the app -> badges/history are gone (ephemeral by design, like the TCP pings); the Test URL persists (appPrefs file) and the temp `memento-urltest-*.json` files do not linger (check `%TEMP%`)

## 24. Phase C3 — routing presets + custom rules + geo files + DNS/FakeDNS

- [ ] Routing tab: switching presets updates the live JSON preview instantly; `standard` shows EXACTLY the legacy dns/routing blocks (no fakedns, no geo, AsIs)
- [ ] Bypass-Iran with a real connection: Iranian sites (digikala.com, aparat.com) load WITHOUT the tunnel's exit IP (check an IP mirror inside Iran), foreign sites use the tunnel exit — then turn the preset off and confirm the flip
- [ ] Custom lists: a blocked domain actually refuses through the ports, a direct domain bypasses the tunnel, a proxied domain forces the tunnel; an invalid line (e.g. `https://foo`) shows `{n} invalid` and never reaches the core (check the JSON preview)
- [ ] Geo gate: rename/remove geoip.dat+geosite.dat from the data dir, select Bypass-Iran, press Connect -> an honest abort toast naming the missing file (NOT a connect that dies 2 seconds later); press "Download missing" on the geo card -> files appear with real sizes, connect then succeeds
- [ ] Offline geo: with airplane-mode networking and geo files already present, Bypass-Iran still connects (no forced download when files exist)
- [ ] sing-box (hysteria2/tuic) with Bypass-Iran: connect works with the local .srs rule-sets (delete dataDir/sing-box/*.srs first to exercise the download path)
- [ ] DNS secure: with the tunnel up, dnsleaktest.com shows ONLY the tunnel exit's resolvers (extended test); toggle back to default and observe the difference — this is the manual leg the sandbox cannot prove
- [ ] DNS fakedns: browse normally through the ports; then run an app with hardcoded 8.8.8.8:53 through the socks port and confirm it still resolves (hijack-dns); note the long-session caveat in the UI and verify apps survive an on/off toggle without stale fake IPs
- [ ] Block-ads toggle: with geo present, a known ad domain refuses; the JSON preview shows the category rule
- [ ] Aether session: confirm the Routing tab shows the "does not apply to Aether" note and the Aether tab's own routes knob still behaves as before
- [ ] Restart the app: preset/lists/dnsMode persist (localStorage), the geo card reflects on-disk files immediately after the first geo_status roundtrip

## 25. Phase C4 — chain proxy + balancer

- [ ] Default byte-compat: with NO chain and NO balancer selected, the Connection-tab JSON preview for both cores is byte-identical to the pre-C4 output (no extra outbounds, no balancers block, stats tags stay ["proxy"])
- [ ] Chain (xray): pick a shadowsocks/socks hop config + a vless tunnel; the preview shows the hop outbound, the tunnel's sockopt.dialerProxy = "chain-hop", and the hop BEFORE the tunnel; connect and confirm the exit IP is the hop's
- [ ] Chain + fragment composable: with TLS fragment ON and a chain selected, the xray preview shows the three layers (memento-frag-dialer -> chain-hop -> proxy) in the right order
- [ ] Chain (sing-box): the preview shows detour ladders with the same semantics; live connect reaches the internet through the hop
- [ ] Honest aborts: delete the hop config after selecting it (or pick a hop on the OTHER core) -> the connect aborts with the explicit chain toast, never a degraded config; a balancer with zero members also aborts honestly
- [ ] Balancer (xray): pick 2-3 members + roundRobin; the preview shows balancers[] with the prefix selector ["proxy"], the members proxy2..N, the last catch-all rule and burstObservatory; access-log (or real servers) shows alternation
- [ ] Balancer (sing-box): the preview shows the urltest group + route.final = balancer; members appear as real outbounds
- [ ] Member cap: selecting more than 8 extras is refused by the UI (cap indicator), and the generated config never exceeds the cap
- [ ] Traffic panel (single-count, chain): with a chain up, the traffic chart counts the tunnel's bytes exactly ONCE (the chain-hop carrier tag is deliberately NOT counted — no double counting)
- [ ] Traffic panel (member-sum, balancer): with a balancer up, the panel reports the SUM of all member tags; for VLESS members the UPLOAD stays 0 on the pinned v25.1.1 core (documented gap) — the panel never hides it and the balancer card says so in your language
- [ ] Persistence: chain/balancer choices survive an app restart (memento-topology-options), and a stale/unknown balancer strategy falls back to random honestly
- [ ] (manual, real Windows + real servers) the full chain leg: connect through a real foreign hop + real tunnel and verify the exit IP is the HOP's exit (the sandbox cannot prove multi-server routing)
- [ ] (manual, real Windows) balancer with real servers: observe requests alternating across members (server-side logs or the access log), traffic panel keeps counting, and switching strategies on the fly takes effect on the next connect

### 25.1 Xray core limitation tracker — balancer uplink gap (MUST re-check on every core pin bump)

Trigger: `electron-app/electron/core-versions.json` — the `"xray"` pin changed.

1. Run `node scripts/taskC4-uplink-probe.mjs` (X1 control / X2 sockopt nudge / X3 two vless members) against the NEW pinned binary.
2. If the gap is FIXED (vless uplink now increments under the balancer): re-point/retire the B1b3 CORE GAP pin in `scripts/taskC4-live.mjs`, update `topo.balancerHint` in all 4 locales (src/i18n.ts), and update the README "TRACKED LIMITATION" subsection — the UI hint must stop describing a gap that no longer exists.
3. If the gap is STILL present: nothing to change — the formal smoke (taskC4-smoke / taskC5-smoke) S4 re-runs the probe on EVERY formal run and fails the release if the documented behavior drifts.
4. Never edit the product's member-SUM counting to "compensate" for the gap: the panel reports what the core reports, summed over all members, with the honest note.

## 26. Phase C5 — kill switch (fail-closed system proxy)

- [ ] Settings → Window & Startup: the "Kill switch" toggle is OFF by default (fresh install AND after upgrading from an older build with an existing prefs file)
- [ ] Toggle it ON while disconnected → an honest feel of "blocked now": system-proxy apps stop reaching the internet (proxy = 127.0.0.1:9); the Connection tab shows the red "traffic is BLOCKED" banner
- [ ] Toggle it OFF again → direct access returns immediately (the blocked state was ours, so it is cleared); foreign proxy settings are never touched
- [ ] Connect normally with the switch ON → the tunnel works exactly as before (live ports in the system proxy); the banner is gone; speed/latency unaffected
- [ ] Kill the core externally while connected (e.g. Task Manager on xray.exe) → within one poll the status flips to disconnected and the banner appears; system-proxy apps fail (dead address), they do NOT fall back to direct — this is the crash leg the sandbox proves by decision; verify the real fail-closed feel on Windows
- [ ] (manual, real Windows) Disconnect manually with the switch ON → internet stays blocked at the proxy level; reconnect restores the tunnel; the banner disappears
- [ ] (manual, real Windows) While the switch is ON, quit the app (tray Quit) → the system proxy is RESTORED TO DIRECT after the app is gone (the documented quit boundary — a portable app must never strand the machine); relaunch → the banner shows again (armed persists)
- [ ] App-crash residue: kill the whole app (hard) while armed and connected → relaunch → the F9 audit normalizes the leftover to the blocked state (the banner is honest about it); with the switch OFF, the same crash leaves the pre-C5 cleanup behavior
- [ ] Another VPN/proxy tool's system proxy (a non-MEMENTO port) is NEVER touched by arming/disarming or by the audit (foreign = hands off)
- [ ] The switch persists across restarts (memento-app-prefs.json) and rides the backup/restore round-trip; a corrupted prefs file falls back to OFF
- [ ] Browser preview: the Settings toggle and the Connection-tab banner work off the mock honestly (no fake registry enforcement is claimed anywhere)
- [ ] (honest scope, confirmed in UI text) only apps honoring the Windows system proxy are covered; apps with their own proxy settings or hard-coded direct traffic bypass the kill switch; DNS of such apps is not covered

## 27. Phase C6 — Aether pin-per-version updates + the honest self-update assistant

Real-Windows manual items (the sandbox cannot prove the real feel):

- [ ] Offline default: open the Aether tab WITHOUT clicking anything — the panel shows the bundled pin (v1.9.0) as the bundled version and the current binary as identified (v1.9.0); NO network request is made anywhere (verify once with a firewall/airplane mode: the panel stays functional, nothing errors until you click Check)
- [ ] Click "Check for updates" with real internet: an honest state appears — up-to-date, pinned-newer (install offered), or unpinned-newer ("update MEMENTO itself first") — never a silent download
- [ ] Click "Check for updates" with airplane mode / blocked network: an honest error message; the app and the current binary are completely unaffected; the system proxy state (registry) is byte-identical before and after (the check never touches any system setting)
- [ ] While an Aether connection is ACTIVE: the update panel shows the amber running-lock banner, the Check button is disabled, and a direct IPC probe of aether_update_check/aether_update_apply returns blocked-running — the running core is never swapped underneath itself
- [ ] Race check (optional, advanced): start an install and start Aether while the download is in flight — the install must refuse with blocked-running and leave the current binary untouched
- [ ] Real install of a pinned-newer version (when a future build pins one): the download completes, the sha256 is verified, the panel reports the new active version after refresh, and aether.prev.bak exists next to the binary as the manual rollback artifact; the next Aether START uses the new version and passes the spawn integrity gate
- [ ] Tamper leg (optional): point a fake manifest at a wrong artifact — the install must refuse with a hash-mismatch error, NOTHING is written to disk, and the previous binary still starts
- [ ] Settings → "MEMENTO updates": shows this build's version and opens the pinned releases page in the DEFAULT BROWSER (external, not in-app); the app itself makes no network request for its own update — there is no in-app check at all
- [ ] Replace-the-exe leg: update MEMENTO manually per the panel's steps (close, replace, start) — prefs and cores survive, no self-modification of the running app happened at any point
- [ ] Allowlist check: the update commands work from the UI but nothing else changed — the C1-C5 behaviors (kill switch, proxy, hotkeys) are unaffected

## 28. Phase B0 — wintun.dll provenance (real-Windows manual items)

The sandbox proved: official zip + dll SHA-256 digests, the dll's
Authenticode blob presence, and the embedded `WireGuard LLC` / `0.14.1`
version info. These legs need real Windows:

- [ ] Run `scripts\fetch-wintun.ps1` on a real Windows machine: it prints the zip sha256 OK line, the dll sha256 OK line, and `Authenticode OK: signed by WireGuard LLC`, then places `resources\wintun\bin\amd64\wintun.dll`
- [ ] `(Get-AuthenticodeSignature .\resources\wintun\bin\amd64\wintun.dll)` shows Status `Valid` and a signer subject containing `WireGuard LLC` — the publisher B1's runtime gate will enforce
- [ ] Tamper leg: modify one byte of a copy of the dll and run the ps1 against it (temporarily pointing the constants is NOT needed — the zip-digest gate already refuses any modified archive; verify the refusal message appears)
- [ ] `resources\wintun\wintun-LICENSE.txt` rides the distribution unmodified (clause 3(c)); `NOTICE.md` carries the wintun attribution line
- [ ] `electron\core-versions.json` lists `"wintun": "0.14.1"` beside the three core pins, and `electron\wintunPin.ts` is the only file carrying the digests (grep check: no other hardcoded wintun hashes anywhere)
- [ ] No TUN behavior exists yet: connecting/disconnecting in every core (Xray, sing-box, Aether) behaves EXACTLY as in batch C6 — B0 adds no code paths (the adapter `MementoTun`, the routing session and the kill-switch integration all arrive in B1+)

## 29. Phase B1 — routing session (real-Windows manual items)

The sandbox proved: the full watchdog state machine against a fake
engine (all three D6 legs), the wintun hash gate, the privilege
boundary, the identity-guarded repair, and the generated config against
the REAL `sing-box check`. These legs need real Windows:

- [ ] Start a TUN session from B2's UI (or manually via the request file): the UAC consent dialog appears exactly once per session, and the elevated helper process runs with NO window, NO tray, NO hotkeys — only the engine child
- [ ] While the tunnel is live: the `MementoTun` adapter exists (ipconfig), traffic flows, and the system proxy settings are UNCHANGED (D6: TUN suppresses system-proxy writes)
- [ ] Armed leg: enable the kill switch, then kill the upstream core process — the tunnel stays UP (traffic blackholed, NOT leaked), status.json shows `reconnecting`; restart the core — status returns to `connected` without any user action
- [ ] Unarmed leg: with the kill switch off, kill the upstream core — the adapter is removed within seconds, normal direct networking is restored (fail-open), status.json shows `restoring` then `disabled`
- [ ] Quit leg: quit MEMENTO while the tunnel is live (armed or not) — the helper exits, the adapter is gone, `memento-routing-recovery.json` is removed
- [ ] Crash leg: kill the HELPER process (not the engine) — after relaunching MEMENTO, the stale session is detected via the recovery marker and the repair path removes the stale engine + adapter
- [ ] Tamper leg: replace `resources\wintun\bin\amd64\wintun.dll` with any other dll — the session refuses BEFORE spawning sing-box with the sha256-mismatch error; restore the pinned dll — the session starts (the B1 fulfillment of the B0 contract)
- [ ] `--repair-network` leg: run `MEMENTO.exe --repair-network` elevated after a simulated crash — stale engine (if any) is killed ONLY if its image name is sing-box, recovery marker cleared, status.json ends `disabled`
- [ ] MTU leg: with a stored `tun_mtu` of e.g. 9000 and 1280 the tunnel still comes up; a garbage value folds to 1500 (D7)

## 30. Phase B2 — routing manager + the SOCKS/VPN Device segment (real-Windows manual items)

The sandbox proved: the real manager start/stop/status/repair surface
against injected deps (69 fntest assertions), the D7 clamp passthrough,
the UAC self-heal, the suppression map, the honest refusals, the repair
anti-UAC-spam window, and the sequenced disconnect. These legs need real
Windows:

- [ ] Segment: switch to "VPN Device" in the Aether tab — the choice persists across restarts; switching back to "SOCKS" while DISCONNECTED works; while connected the segment is disabled (connect-time choice)
- [ ] VPN Device connect: press Connect — the aether core starts first, then ONE UAC prompt appears; approve → the pill switches to the routing states (Device starting → Device routing) and the whole system routes through the tunnel
- [ ] VPN Device connect refusal: click Cancel on the UAC prompt — the aether session STAYS UP in SOCKS mode (traffic via the system proxy toggle works), the honest toast names the refusal, and after ~2 minutes (the heal deadline) the VPN Device card returns to idle without restarting the app
- [ ] VPN Device with NO connection: press Connect with no core running — the honest "No active core to tunnel into" refusal, nothing elevated, no adapter
- [ ] D6 suppression UI: while the device routes, the system-proxy toggle is REPLACED by the honest note; attempt `set_system_proxy` from a config connect in another tab — the honest D6 refusal toast, no registry change
- [ ] Core-transition guard: while the device routes, a config connect in the VPN Connection tab is refused with the honest "VPN Device session is active" message; the tunnel keeps flowing
- [ ] Sequenced disconnect: press Disconnect while routing — the adapter is removed BEFORE the aether core stops (watch the icon/tray: routing state Restoring network → Device off, then the core stops); no window where the upstream dies under a live adapter
- [ ] Reconnecting banner (armed): arm the kill switch, start the device, kill the upstream — the pill and the card show the amber "Holding (reconnecting)" banner; restore the core — back to "Device routing" automatically
- [ ] Repair button: with everything healthy, press "Repair network (admin)" — the honest "no VPN Device state to repair" refusal WITHOUT a UAC prompt; after a simulated crash (kill the helper + GUI) it launches the elevated repair after the UAC approval; hammering the button launches at most ONE elevation per 120 s — re-clicks inside the window (or while a start UAC is unanswered) show the honest anti-spam refusal and never queue a second prompt
- [ ] Quit boundary: quit MEMENTO while routing — the same full teardown as B1's quit leg (adapter gone, recovery marker removed, direct networking restored); the SOCKS segment's behavior is byte-identical to pre-B2 (regression: connect, system-proxy toggle, disconnect)

## 31. Phase B3 — C5 kill-switch + F9 audit fusion with the TUN session (real-Windows manual items)

The sandbox proved: the heartbeat freshness mechanics, the fresh-armed
mid-session flip (armed hold → disarm → fail-open teardown), the
snapshot fallback matrix, the staleness mapping + boundary, the
once-only transition firing, the audit decision matrix, and the
observable blocked write through the win32 bundle. These legs need real
Windows:

- [ ] Heartbeat: while the device routes, watch the session status.json — updatedAtMs refreshes at least every ~10 s without any state change; the card never flickers to the error state on a healthy session
- [ ] Stale helper (armed): kill the elevated helper AND its sing-box engine from Task Manager while routing — within ~30 s the VPN Device card flips to the honest "heartbeat lost" error state, the system proxy lands on 127.0.0.1:9 (enabled-but-dead, fail closed), and internet dies for proxy apps instead of leaking
- [ ] Stale helper (disarmed): same kill with the kill switch OFF — the card shows the same honest error state, the proxy leg is NOT touched (no surprise block for an unarmed user), and "Repair network (admin)" cleans the residue
- [ ] Fresh-armed flip: start the device with the kill switch ON, kill the upstream (reconnecting hold appears), then turn the kill switch OFF in Settings — within one probe interval (~10 s) the session tears down (fail-open restore, adapter gone), honoring the CURRENT intent instead of the start-time snapshot
- [ ] Fresh-armed flip (reverse): start the device with the kill switch OFF, kill the upstream (the session tears down unarmed), restart with the switch ON — the new session HOLDS on the next upstream loss
- [ ] Startup audit (armed, TUN residue): arm the kill switch, start the device, hard-kill the helper + engine + GUI (or power off), relaunch MEMENTO — with the proxy leg DISABLED the app normalizes it to 127.0.0.1:9 (blocked) and the card shows the leftover-session error with the repair path
- [ ] Startup audit (no false positives): same residue with the kill switch OFF — nothing is blocked or cleared at boot beyond the pre-B3 proxy-audit rules; with an orphan helper still alive and reporting (fresh status) — the audit leaves everything alone and the session surfaces normally
- [ ] Startup audit (enabled proxy leg): armed + TUN residue + a leftover enabled OUR-proxy from the SOCKS phase — the proxy audit normalizes it to blocked (pre-C5 contract); the TUN audit adds no second write
- [ ] Quit boundary unchanged: quit while routing (armed) — still a FULL teardown to direct networking (the quit latch outranks the new TUN block; byte-identical to the B1/B2 quit contract)
- [ ] Watchdog independence: while routing, switch to another tab (or hide the window to tray), then kill the helper+engine — the blocked proxy still lands within ~30 s WITHOUT the Aether tab being open (the main-side watchdog, not the renderer poll, enforced it)
- [ ] Settings copy: the kill-switch hint in all four languages now names the VPN Device hold behavior (armed keeps the tunnel up; a silent helper blocks the proxy instead)

## 32. Phase B4 — Phase B closeout (real-Windows final acceptance sweep)

B4 ships no behavior, so there are no new mechanics to verify. What B4
adds is the one-pass FINAL ACCEPTANCE SWEEP over the whole Phase B
surface: sections 28-31 still carry the per-batch legs; this section is
the end-to-end walk the phase owes before it is called closed, plus the
documentation leg.

- [ ] Provenance leg (B0): on a clean machine, first VPN Device connect — the wintun.dll beside the binary passes the SHA-256 + Authenticode gates and the session starts; a tampered dll is REFUSED with the honest error and no adapter ever appears
- [ ] Full lifecycle leg (B1+B2+B3, one continuous pass): connect the aether core in SOCKS mode → press Connect on the VPN Device card → ONE UAC prompt → the MementoTun adapter appears and the whole system routes through the tunnel → the session status refreshes silently (~10 s heartbeat, no card flicker) → arm the kill switch mid-session → kill the upstream (amber "Holding (reconnecting)", proxy blocked fail-closed) → restore the core (auto-resume to "Device routing") → disarm the kill switch (fail-open teardown within one probe interval) → press Disconnect (adapter gone BEFORE the core stops)
- [ ] Crash-residue leg (B3 audit): with the switch ARMED, hard-kill the helper + engine + GUI mid-routing, then relaunch — the boot audit normalizes the proxy leg to 127.0.0.1:9 (blocked, NEVER cleared), the card shows the leftover-session error with the repair path, and "Repair network (admin)" cleans the residue after UAC
- [ ] Documentation leg (B4): `scripts/taskC4-probe.mjs` carries the B4 design-time note in its header (the S4 negative expectation does not hold against sing-box 1.14.0; the probe stays a design-time artifact outside every battery); README "Batch B4" closes the phase with the B0→B4 seal map and the post-Phase-B remaining-work register (E1/E2/THIRD-PARTY.json/setup-app)
- [ ] Regression leg (pre-B parity): one SOCKS-only pass — connect, system-proxy toggle, kill-switch arm, core kill → blocked proxy, disconnect, quit — byte-identical to the pre-B1 behavior (sections 26/31)

## 33. Phase E — Batch L0 (license manifest — real-Windows verification)

L0 ships no behavior — the app neither reads nor executes THIRD-PARTY.json.
What must be verified on real Windows is that the license surface actually
RIDES the distribution and the attribution chain holds offline:

- [ ] Manifest rides: the built portable exe contains `resources/THIRD-PARTY.json` (electron-builder `extraResources`); extract or run from the unpacked path and `ConvertFrom-Json` it — it parses and `manifestVersion` reads 1
- [ ] Pin cross-check: the manifest's core versions match `resources/../electron/core-versions.json` (xray v25.1.1 / sing-box 1.14.0 / aether 1.9.0 / wintun 0.14.1) and the wintun sha256 lines match `electron/wintunPin.ts`
- [ ] Verbatim texts ride: `resources/licenses/` carries all 7 files (MPL-2.0 373 lines / GPLv3 674 / sing-box notice 17 / AGPL-3.0 661 / Apache-2.0 202 / two OFL 93 each) and `Get-FileHash` matches the sha256 values pinned in the manifest; `resources/wintun/wintun-LICENSE.txt` is untouched
- [ ] GPL/AGPL source offers: the pinned-tag URLs recorded for sing-box and Aether in THIRD-PARTY.json + NOTICE.md open the official release pages (the complete-source-offer path), offline fallback = the URLs are printed in NOTICE.md itself
- [ ] Attribution walk: NOTICE.md lists every bundled component with its copyright line (react/Meta, lucide/ISC, toast/Timo Lins, zustand/Paul Henschel, qrcode/Ryan Day, jsqr/Apache, adm-zip, Electron, Tailwind) and both OFL font attributions; the About/help surface (if any) points at NOTICE.md
- [ ] Packaging leg: inside the built artifact, Electron's own `LICENSE` + `LICENSES.chromium.html` files are present next to the runtime (electron-builder carries them); if absent, file it as a packaging gap — do not hand-wave it
- [ ] Regression leg (inert data): one SOCKS connect pass with the manifest present — zero behavior change vs the B4 tree (the app never reads the manifest; the only consumer is the quickcheck)

## 34. Phase E — Batch E1 (live per-connection stats — real-Windows manual items)

E1 adds a read-only live connections panel (VPN tab, under the traffic
chart). The aggregate counters/speed/chart path must be regression-free —
if ANY of the legs below shows the old traffic numbers changed, that is a
FAIL, not a quirk:

- [ ] sing-box leg: connect a hysteria2/tuic config, expand Live Connections — per-connection rows appear within ~3 s; browse/download in a real browser and watch per-connection byte counters grow; closed connections disappear from the list
- [ ] xray leg: connect a vmess/vless/trojan config — the amber per-outbound note renders and rows are per tag (`proxy` = tunnel chip; `direct`/`blocked` zero rows honest); a C4 balancer pool connection shows `proxy2..N` member rows
- [ ] aether leg: start the Aether core — the panel renders the "this core does not expose a connection-stats API" note; the cumulative counters above stay at the established honest zeros
- [ ] Collapsed cost: with the panel collapsed, no per-connection polling happens (collapsed = zero IPC; verified structurally in the quickcheck)
- [ ] Lifecycle: disconnect -> the panel unmounts; reconnect (any core) -> no stale rows from the previous session; a mid-poll core switch renders the NEW core's granularity note on the next tick
- [ ] Failure honesty: kill the core process externally while the panel is expanded — the panel degrades to empty/none WITHOUT an error toast or crash, and recovers on the next successful session
- [ ] Regression leg: the aggregate surface (bytes totals, KB/s speeds, TrafficChart ring) behaves byte-identically to the B4 tree on both cores
- [ ] i18n leg: all four languages render the new strings; fa/ar RTL layout of the panel holds (table headers, chips, note lines)
- [ ] Preview leg: the browser preview (electron-mock) shows the mock per-connection rows for a sing-box demo config and the per-outbound rows for an xray demo config

## 35. Phase E — Batch E2 (the MEMENTO ShadowTLS parser — real-Windows manual items)

E2 adds the `memento-stls://` scheme (shadowtls transport + inner trojan,
sing-box ONLY, explicitly labeled non-standard). Structural honesty is
pinned by the quickcheck; the legs below need a real GUI session:

- [ ] Import leg: paste a `memento-stls://...` link — the config lands with the shadowtls protocol chip; the Import tab's amber non-standard disclosure is visible BEFORE and after the import (all four languages)
- [ ] Scheme honesty leg: the disclosure text says the scheme is proprietary and NOT an industry standard, and that it works only inside MEMENTO — no wording implies a standard `shadowtls://` URI exists
- [ ] Connect leg (sing-box): connect the shadowtls config — the core badge shows sing-box; real traffic flows; the Live Connections panel (E1) shows the trojan-over-shadowtls chain on the proxy rows
- [ ] Version honesty leg: a v2/v3 link without `stls-password` is rejected at import with the explicit reason; a v4 link is rejected; a passwordless v1 link imports (transport password omitted downstream)
- [ ] Topology gate leg 1: enable Chain & Balancer and try to connect the shadowtls config as MAIN — an honest toast aborts the connect (plain main connection only)
- [ ] Topology gate leg 2: with a hysteria2 MAIN, pick the shadowtls config as chain hop — an honest toast aborts; as a balancer pick it is dropped with the reason line
- [ ] Xray-exclusion leg: the shadowtls config NEVER offers/uses the xray path (core badge always sing-box; no route through the xray generator — structurally pinned by the quickcheck G6 v2rayConfig pin)
- [ ] Editor leg: Editor → change the host/port of a memento-stls link — scheme, inner credential, transport params and the fragment name survive the rewrite (the sing-box guard banner covers the link)
- [ ] Ping leg: the shadowtls config resolves a ping target (host/port extraction) like the other URI-scheme protocols
- [ ] Regression leg: hysteria2/tuic connect + stats + chain/balancer behave exactly as at E1 (the singBoxConfig topology paths for non-shadowtls mains are untouched — C4 fntest goldens hold)
- [ ] Preview leg: the browser preview (electron-mock) shows the demo-de-stls config; the non-standard disclosure renders in the Import tab

## 36. Setup 2.0.3 — AV / Windows Defender round (real-Windows manual items)

The 3.1.7 field report: on a REAL Windows machine the setup reports
"files were removed by the antivirus" — even with third-party AV off
(Windows Defender stays active independently). Code analysis (see
`setup-app/electron/installerCore.ts` header + `setup-app/README.md`)
confirms the pattern Defender's heuristics score: an unsigned SFX that
extracts to %TEMP%, byte-copies its OWN running exe, and writes unsigned
proxy cores. Setup 2.0.3 removes the self-copy (hardlink) and the third
write of the cores (move-staging) and runs elevated
(`requestedExecutionLevel: requireAdministrator`).

HONEST SCOPE: items below MUST be verified on a real Windows 10/11
machine. This sandbox has no Windows and cannot execute the SFX — a
green build/smoke here proves structure, not field behavior.

Setup behavior (needs a real Windows box):
- [ ] Double-click `MementoSetup-2.0.3.exe` → ONE UAC prompt appears (Yes → wizard opens; No → nothing runs)
- [ ] exe Properties → Compatibility shows "Run this program as an administrator" pre-checked (requireAdministrator manifest)
- [ ] Install completes to the default `%LOCALAPPDATA%\Programs\MEMENTO` with the same log flow as 2.0.2 (no regressions in dest validation, rollback, shortcuts, ARP entry)
- [ ] Install log contains the hardlink line: "runtime exe → MEMENTO.exe (linked — zero bytes of the running image re-written)" (same-volume install)
- [ ] Install log contains the honest unsigned-binary note; with a Defender-blocked core it flips to the error variant telling the user the Protection-history steps
- [ ] "Launch MEMENTO" on the finish page starts MEMENTO UNELEVATED (check Task Manager: MEMENTO.exe NOT "Elevated"; the wizard dropped its token via explorer.exe)
- [ ] Second double-click of the setup while the wizard is open: wizard still wins (single instance), install from the staged payload completes even though the second stub wiped %TEMP% (2.0.2 regression leg)
- [ ] Uninstall via the Start Menu entry still works per-user, no UAC, userData preserved

AV legs (the actual field complaint):
- [ ] On the machine that reported "files removed by antivirus": open Windows Security → Protection history and record the EXACT detection name (e.g. `Trojan:Win32/…!ml`) — this names the heuristic for the next round honestly
- [ ] With the recorded detection: Actions → Allow (or Restore) → re-run setup → install completes with ALL THREE cores present (xray/sing-box/aether logs green)
- [ ] Alternative leg: add folder exclusion `%LOCALAPPDATA%\Programs\MEMENTO` (see setup-app/README.md for the exact PowerShell command) → re-run setup → install completes; cores launch and connect
- [ ] MEMENTO portable (`MEMENTO-3.1.7.exe`) is untouched by this round — re-confirm its behavior separately if it also triggered Defender

## 37. Setup 2.0.4 — the app.asar incident (verify + hard gate + rollback)

Field report #2 (real Windows 11, setup 2.0.3): the install reached 100%
with an error line, and the app would not launch. Root cause, confirmed
by inspecting the installed folder: EVERYTHING landed except
`resources\app.asar` (the app's whole code) — Windows Defender removed it
mid-install and 2.0.3's tolerant copy skipped it silently, still reporting
success. 2.0.4 makes the app code a HARD requirement: contract gate before
the copy, verify+heal after it, and a rollback that leaves no trace.

HONEST SCOPE: the verify/heal/gate logic is LIVE-tested in
`scripts/taskH-smoke.mjs` (H9: contract gate, hard gate + rollback
restoring the previous install, honest non-critical miss, leave-no-trace,
happy path). What still needs a REAL Windows machine:

Setup behavior (real Windows box):
- [ ] Clean-machine install: the log ends with
      `verified N/N installed files against the payload manifest` and
      `C:\<dest>\resources\app.asar` EXISTS (size ≈ 4.1 MB) — this was the
      2.0.3 incident file
- [ ] Launch works after install (the 2.0.3 machine that could not start
      MEMENTO must now start it, once Defender allowed/excluded the file)
- [ ] Simulated quarantine leg (optional but the decisive one): set a
      Defender asmatically-blocked rule or temporarily remove the asar
      from the staged payload — the setup must abort with
      "the app code (resources/app.asar) …" + Protection-history steps,
      and the chosen destination folder must NOT be left half-installed
- [ ] Upgrade leg: install 2.0.3 (or delete `resources\app.asar` by hand),
      then re-run the 2.0.4 setup WITHOUT manual cleanup — the stage-aside
      rollback must replace the broken tree completely and the final
      verification must read N/N
- [ ] The abort dialog (Retry / back-to-destination) renders the honest
      message; Retry after adding the exclusion completes the install
- [ ] Regression leg: with Defender quiet, the install flow is identical
      to §36's expectations (UAC once, hardlink log line, unelevated
      launch, ARP entry, shortcuts)

## 38. Setup 2.0.5 — the unpacked app payload (field report #3, real-Windows manual items)

**HONEST SCOPE: this sandbox has no Windows and no Defender.** Everything
below must be verified on the machine that reproduced the quarantine.

Background: on the field machine, 2.0.4's contract gate fired exactly as
designed (1%, "the app code (resources/app.asar) is missing … Nothing was
installed") because Defender quarantined the single 4.1 MB app.asar during
SFX extraction. 2.0.5 ships the app code UNPACKED (`resources/app/` tree,
`asar: false`) so there is no asar blob left to kill wholesale — plus
one-click remediation buttons in the error row.

- [ ] `MEMENTO-3.1.7.exe` (app portable): `resources\app\` directory
      present with `package.json` + `dist-electron\main.js`; NO
      `resources\app.asar` anywhere; the app LAUNCHES from the portable exe
- [ ] `MementoSetup-2.0.5.exe`: payload contains `resources\app\**`
      (~114 files), icons and the three cores; NO `resources\app.asar`
      inside the payload
- [ ] Contract gate (updated): with `resources\app\package.json` removed
      from the staged payload, the setup aborts naming
      "resources/app/package.json" (NOT the old asar path) and installs
      nothing
- [ ] Quarantine leg (the decisive one): with NO exclusions, run the
      setup — record from Protection history WHICH file(s) Defender now
      removes (name + path + detection name). If the install completes:
      the unpacked layout survived real-time scanning ✓
- [ ] Heal leg: if exactly one app file is quarantined mid-install, the
      verify+heal pass must restore it from staging and print
      "verified N/N installed files"
- [ ] Error-row buttons: on any abort — "Copy paths for exclusions" puts
      the three candidate folders (setup extraction dir,
      %LOCALAPPDATA%\MementoSetup, install destination) on the clipboard;
      "Open Windows Security" opens ms-settings:windowsdefender; Retry and
      Back-to-destination behave as in §37
- [ ] Regression leg: UAC once (requireAdministrator stub manifest),
      hardlink runtime log line, de-elevated launch, ARP entry, desktop +
      Start-Menu shortcuts, uninstall preserves userData
- [ ] Record the Protection-history detection name and file here:
      ______________________________________________

### §38 addendum — setup 2.0.6 (cosmetic window fix)
- [ ] The wizard window has NO dark margin/halo around the panel — the
      window edge is the panel edge (900×640, square corners, hairline
      border), native OS shadow only
- [ ] No ENTER/ESC/928×640 hint row below the panel; content renders 1:1
      (nothing scaled down or cropped at 900×640, including on a
      125%/150% DPI display)

## 39. Setup 2.0.7 / App 3.1.8 — in-place destination (field report #4, real-Windows manual items)

**HONEST SCOPE: this sandbox has no Windows.** The in-place legs must be
verified on a real machine.

- [ ] Fresh install to a NON-existent custom folder works as before
- [ ] Install INTO an existing foreign folder (e.g. Downloads): no EPERM,
      log says "installing into it in place", the user's own files are
      untouched, app launches from that folder
- [ ] Failed in-place run (e.g. cancel mid-copy): only MEMENTO's files
      are removed; foreign files and the folder survive
- [ ] Upgrade leg: re-running the setup on a real previous install still
      stages it aside (sentinel detected) and completes
- [ ] Upgrade leg locked: with MEMENTO running / folder open in Explorer,
      the abort message names the causes (no bare EPERM)
- [ ] Uninstall (in-place install, app 3.1.8): only MEMENTO's own files
      disappear from the foreign folder; the folder and user files remain
- [ ] Uninstall (owned install): whole-dir removal contract unchanged
- [ ] Regressions: §36–§38 legs still pass (UAC once, no dark margin,
      contract gate, verify+heal N/N)
