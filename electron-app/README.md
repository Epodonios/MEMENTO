# electron-app — MEMENTO on Electron

Side-by-side Electron port of the Tauri backend. The Tauri build
(`../src-tauri/`) is untouched and remains the rollback path; the React
frontend (`../src/`) is shared by both shells via a runtime-detecting
bridge (`../src/utils/tauriBridge.ts`).

## Commands

```bash
npm install            # once
npm run sync:resources # copy ../src-tauri/resources -> ./resources
npm run make:icon      # build/icon.ico from src-tauri icons
npm run dev            # Vite (5173) + Electron with hot reload
npm run dist           # portable Windows exe -> release/MEMENTO-2.0.0.exe
npm run dist:dir       # unpacked build (faster smoke test)
```

## Layout

```
electron/           TypeScript main process
  main.ts           window (frameless 1280x820, min 480x600), lifecycle,
                    app-close cleanup (stop cores + clear proxy + kill
                    orphans — both binaries)
  preload.ts        contextBridge -> window.electronAPI (contextIsolation on,
                    nodeIntegration off)
  ipc.ts            the 11 legacy Tauri commands + core routing + window
                    controls + openExternal
  xray.ts           process manager: spawn/pipes/300-line ring buffer/generation
                    counter, 900ms crash-grace, port probes, active-config +
                    sidecar lifecycle, traffic via `xray api statsquery`
  singbox.ts        sing-box manager (Task 11): mirrors xray.ts 1:1 (F3
                    pendingChild, grace, ring buffer); traffic via clash_api
                    GET /connections with the Bearer secret; NO auto-download
  cores.ts          routing coordinator: config JSON decides the core,
                    attempted-core tracking, stopOtherCore, cleanupAllCores
  coreOps.ts        dual-binary helpers: liveness probe (tasklist/pgrep),
                    orphan kill (both binaries, 300ms settle), the
                    memento-active-core.json sidecar (sing-box rejects unknown
                    root fields, so the core marker lives next to the config)
  coreTypes.ts      shared wire shapes (ConnectionStatus now carries `core`)
  core-versions.json  pinned core versions (xray v25.1.1 / sing-box 1.14.0)
  download.ts       auto-download Xray v25.1.1 + geoip/geosite (adm-zip)
  proxy.ts          system proxy via reg.exe on HKCU (no native modules)
  ping.ts           native TCP batch ping, 64-way concurrency
  spoofing.ts       Spoofing Patt UAC launcher (PowerShell Start-Process -Verb RunAs)
  paths.ts          resource/data/exe path resolution (find_xray + findSingBox)
resources/          xray/, sing-box/ (pinned v1.14.0, see its README),
                    spoofing-patt/, domain-fronting/, geoip.dat, geosite.dat
build/icon.ico      generated Windows icon
dist/               built frontend (singlefile, loaded via file://)
dist-electron/      compiled main process
release/            electron-builder output (portable exe)
```

## Why electron-builder (not forge)

First-class `portable` Windows target (single exe, no install — matching the
Tauri distribution), mature `extraResources` handling for the executables,
and built-in `.ico` packaging. Forge would need custom hooks for all three.

## Dual-core (Task 11 — approach B, user-approved)

Xray-core remains the ONLY core for vmess/vless/trojan/ss/socks — its path is
byte-identical to the pre-Task-11 build. hysteria2:// and tuic:// links
(the only protocols Xray never supported natively) route to a bundled,
pinned sing-box v1.14.0 placed in `resources/sing-box/`:

- Routing happens in the main process by inspecting the generated config —
  no new IPC commands, the preload allowlist is untouched.
- Only ONE core is ever alive: starting either core stops a live other core.
- sing-box traffic stats come from `experimental.clash_api` (HTTP), with a
  fresh 256-bit secret generated per config build (`crypto.getRandomValues`)
  and sent as `Authorization: Bearer …` on every poll — the endpoint 401s
  without it. clash_api is the only experimental API enabled (never pair it
  with v2ray_api — upstream issue #2742).
- Every lifecycle response carries a `core` field ("xray" | "sing-box"),
  consumed by the small UI badge and the localized unexpected-stop toast.
- Xray auto-download is unchanged; sing-box is NEVER auto-downloaded — the
  pinned binary is bundled (see `resources/sing-box/README.md`).

## Behavioral parity notes

- System proxy is set/cleared unconditionally by start/stop_xray exactly as
  the Rust code did (Tauri quirk preserved by decision).
- `get_xray_status` returns the hardcoded 10808/10809 while running.
- Data dir stays `%APPDATA%\com.epodonios.memento` (Tauri's app_data_dir) so
  existing installs keep their downloaded xray + geo files.
- There is no tray (the Tauri build enabled the feature flag but had no tray
  code) and no QR feature exists in the source.

## Aether tab (Task 12 — third core, SOCKS5-only)

The Aether tab adds the official **Aether core v1.9.0** as a third, config-
independent connection: WARP-in-WARP (default, live-verified fastest at
4.8 s vs masque 121.5 s in the Task-12 smoke), MASQUE, classic WireGuard,
plus a Smart Connect loop that tries protocols in order and keeps the first
that connects. Everything the core supports is exposed in the UI: scan mode,
noize profile, IP version, custom endpoint, DNS, routing block/direct/file
lists, a second HTTP CONNECT listener (recommended for the Windows system
proxy), upstream chaining, quick-reconnect and the log level.

- Spawn parity with the Aethon GUI: zero CLI arguments, 100% `AETHER_*` env
  config, headless-guaranteed (protocol/scan/ip always set).
- Integrity gate before every start: the binary's SHA-256 must equal the
  pinned official hash (Aethon parity) or the start is refused.
- Only ONE core is ever alive, in both directions (config ⇄ aether).
- The system proxy for an Aether session is renderer-owned (default OFF);
  when enabled it points at the HTTP listener port if that listener is on,
  else at the SOCKS port.
- Honest limitation: the aether core has no traffic-stats API, so the
  cumulative counters stay at 0 during an Aether session; the log pane and
  the readiness/status flow are fully live.
- TUN/VPN, the routing-helper, wintun.dll and Psiphon are deliberately out
  of scope for this phase.
- Binary placement + hashes: `resources/aether/README.md`.

## SOCKS5 share links + broker expansion (Task 13)

**A1 — `socks://` / `socks5://` links are first-class.** There is no IANA
"socks" URI scheme; parsing follows the de-facto v2rayN convention
(`SocksFmt.cs`, captured in `scripts/socks-report/`):

- Variants: anonymous `socks://host:port`, plain `user:pass@` (first-colon
  split — passwords may contain `:`), base64 `user:pass@` (unpadded and
  url-safe tolerated — v2rayN's own export shape, so `Og` = anonymous),
  legacy whole-string `base64(user:pass@host:port)`, and the `socks5://`
  alias. `#remark` becomes the config name; `?query` is ignored.
- Deliberate strictness: userinfo that exists but cannot be decoded into
  `user:pass` is REJECTED with a clear error (v2rayN would silently import
  an anonymous profile); malformed links never crash and never build a
  wrong address — every rejection is an invalid row with the reason.
- Runtime: Xray-core (outbound schema verified against
  `infra/conf/socks.go` @ v25.1.1 — `users[]` only when creds exist, no
  streamSettings). **UDP relay needs no outbound flag**: Xray performs a
  SOCKS5 UDP ASSOCIATE automatically when routed traffic is UDP; `udp:true`
  is an inbound-only flag and our local socks-in already sets it.
- Integrated everywhere the other protocols are: slate protocol chip, TCP
  fast-ping, link editor (URI form), bulk rename, raw/base64/json/clash
  (type `socks5`)/sing-box (`version: "5"`) exports. Surge export
  intentionally excludes socks (unverified Surge line format).

**A2 — Brokers modal grew from 6 to 10 sources** (all re-verified live
2026-09-16): barry-far/V2ray-Config (all + per-protocol),
mahdibland/V2RayAggregator (Eternity + Eternity Air), MatinGhanbari
v2ray-configs (all_sub, refreshed every 15 min) and peasoft/NoMoreWalls
(list_raw). Subscription header lines starting with `#`
(`#profile-title`, `#subscription-userinfo`, …) are skipped on import so
they never land as invalid configs.

## Phase D — Batch D1 (live speed, Connect Best, IP check)

- **Live throughput (KB/s):** the cumulative ↓/↑ traffic counters gain a
  cyan sibling chip showing bytes-per-second, derived in
  `ConnectionManager` from the delta between consecutive 3 s polls (with
  guard rails: no negative speed when the counters reset on reconnect, and
  a zero-baseline on the first poll). No new core APIs — Xray's statsquery
  and sing-box's clash_api already answer cumulative bytes.
- **Connect Best:** a cyan button next to ⚡ Ping connects the
  lowest-latency config of the CURRENT view (subscription-group tab,
  protocol filter and search all respected) using existing fast-ping data.
  It never runs a silent ping sweep itself: with no latency data it asks
  the user to ping first. Ping-column sorting of the table is a
  pre-existing feature and unchanged.
- **IP & Leak Check:** a Connection-tab card probes Cloudflare's trace
  endpoint twice — once through a throwaway session pinned to
  `socks5://127.0.0.1:<socksPort>` (the tunnel path; the port is the
  config connection's, or the Aether core's while an Aether session is
  live), and once via Node https which never touches the system proxy —
  plus the OS resolver list (`dns.getServers()`). A verdict chip compares
  the two IPs; a WARP chip appears when Cloudflare reports warp=on/plus
  (Aether warp protocols). New IPC command `net_check` (preload allowlist
  updated, 16 entries) uses fixed URLs only and caps the response body.
- **Aether honesty:** the Aether core has no stats API, so live speed is
  exempt for it — an inline note in the Aether tab says exactly that
  (complementing the footer note).

## Phase D — Batch D2 (subscription userinfo + builder toggles)

- **Subscription usage (userinfo):** subscription servers report quota via
  the standard `subscription-userinfo` value (`upload=…; download=…;
  total=…; expire=…`, bytes + unix-seconds). MEMENTO now captures it from
  BOTH carriers — the HTTP response header (readable when the server lists
  it in `access-control-expose-headers`) and the `#subscription-userinfo:`
  body header line (parsed before the Task-13 `#`-line skip) — and stores
  it on the subscription group (`userInfo`, persisted with the group blob).
  Capture happens on manual group refresh, auto-update, and broker fetches.
  The Configs tab shows a usage bar for the ACTIVE group (used/total,
  percent with amber/red thresholds, expiry date, capture timestamp) and
  the Manage-Groups modal shows a compact used/total line — or an explicit
  "this server does not report usage info" note when nothing was ever
  received. Stale values are kept (never erased by a later fetch that
  simply didn't expose the header); `fetchedAt` makes staleness visible.
  `fetchSubscription` keeps its exact old signature (thin wrapper over the
  new `fetchSubscriptionDetailed`), so existing call sites/tests are
  untouched.
- **Builder toggles (item 9):** the config generators used to hardcode five
  knobs; they are now user-toggles persisted in
  `memento-builder-options`, with every default reproducing the previous
  hardcoded behavior byte-for-byte (an untouched install generates the
  same JSON as before):
  - `sniffing` (was always on), `blockBittorrent` (was always on),
    `allowLan` (was loopback-only; on = listen 0.0.0.0 on both local
    inbounds — while ON, the panel shows an amber security warning: the
    proxy is then reachable unauthenticated by every device on the
    network, so enable only on trusted LANs), `skipCertVerify` (was
    allowInsecure:true; reality untouched), `logLevel` (was "warning";
    mapped to sing-box's "warn").
  - `muxEnabled` (was absent) emits `settings.mux {enabled,concurrency:8}`
    on vmess/vless/trojan outbounds — and never when an XTLS flow is
    emitted (mux+vision is invalid in xray-core; flow is a vless-only
    concept, so vmess/trojan never need the guard). Trojan coverage was
    added after a D2 review against the pinned source: xray v25.1.1
    dispatches mux in the GENERIC outbound handler
    (`app/proxyman/outbound/handler.go` — `Proxy: proxyHandler` is the
    protocol-agnostic `proxy.Outbound`; `h.mux.Dispatch` runs for every
    link when enabled), so there is no per-protocol gate; the earlier
    vmess/vless-only restriction was a conservative v2ray-era carry-over.
    The sing-box generator (hysteria2/tuic only) applies just allowLan +
    log level: Xray-style sniffing/bittorrent/mux do not exist there and
    `insecure` stays link-driven (documented contract).
  - Toggles live in a collapsed "Builder Options" panel on the Configs
    tab (interim home — the D4 Settings tab is the final home) and apply
    at connect time: the JSON preview and the real connect both read the
    same store state; a live session keeps its current config.

## Phase D — Batch D3 (autostart + global hotkeys + QR + backup)

- **Start with Windows (item 2):** `app.setLoginItemSettings` on any
  packaged Windows build — the PORTABLE exe included (`app.isPackaged` is
  true for it; only the dev/browser shell reports "unsupported"). Two
  portable-specific traps are handled explicitly:
  (1) a portable run unpacks into a fresh %TEMP% folder every launch, so
  `process.execPath` is a throwaway path — the launcher's real exe
  (`PORTABLE_EXECUTABLE_FILE`, verified in electron-builder's
  portable.nsi: `PORTABLE_EXECUTABLE_FILE=$EXEPATH`) is registered instead
  via the `path` option;
  (2) the login item is read back with the SAME path+args it was written
  with (Electron app.md: openAtLogin matching needs the same arguments),
  so the toggle never shows a false OFF.
  If the exe is later moved or renamed, the Run entry goes stale — the UI
  hint says to toggle the option off/on once to re-register. Enabled
  logins launch with `--hidden`, which the main process maps to START
  MINIMIZED — until the tray exists (D4), a fully hidden start would
  strand the user, so "silent" is minimized, never invisible.
- **Global hotkeys (item 4):** `Ctrl+Alt+V` toggles window visibility
  (show/focus or hide — the core keeps running either way) and
  `Ctrl+Alt+C` toggles the current connection. Both are registered by the
  MAIN process at boot from `userData/memento-app-prefs.json` (no
  renderer round-trip needed) and each can be switched off in the UI.
  `Ctrl+Alt+C` semantics live in the renderer: connected -> disconnect;
  idle with a last config -> reconnect it; idle with nothing -> honest
  toast; an Aether session points you to its tab. Combos avoid the
  in-app shortcuts (Ctrl+K, Ctrl+1-6) and Windows' own Ctrl+V-family
  (the F7 lesson). If another app owns a combo, the UI says so
  (`hotkeysActive` vs wanted state).
- **QR export / import (item 5):** every config row gains a QR button —
  the config's raw share link rendered as a high-contrast QR (pure-JS
  `qrcode`), with copy-link and Save-PNG. Import: a new quick action on
  the Import tab (and image drops on the drop-zone) decodes a QR from a
  screenshot/photo with `jsqr` and feeds the SAME pipeline as every
  other import path (dedupe, optional group assignment, 2000 cap).
  No camera, no new native deps — two pure-JS libraries (+~180 kB
  bundled).
- **Backup / restore (item 7):** one versioned JSON file
  (`memento-backup-YYYYMMDD-HHmmss.json`) with ALL persisted state —
  configs, subscription groups, theme/language/notifications, connection
  mode/ports, auto-failover, builder options. Restore validates strictly
  (format marker, version range, string-only + 32 MB/key cap, unknown
  keys dropped), asks for confirmation, writes the blobs back and
  reloads so the store re-reads everything.
- **Where the UI lives:** a collapsed "App Options" panel on the Configs
  tab (same interim-home pattern as Builder Options — the D4 Settings
  tab is the final home). Preload allowlist grows 16 -> 19
  (`app_prefs_get`, `app_prefs_set`, `autostart_set`); every reply
  carries the full new state so the UI can never drift from the OS.

## Phase D — Batch D4 (Settings tab + tray + close-to-tray)

The last batch of the Phase-D quick wins completes the tray era that D3's
interim placements were explicitly built around.

- **Dedicated Settings tab (item 8):** a new sidebar entry hosts four
  sections — Window & Startup (Close-to-tray + Start-with-Windows), Global
  Hotkeys (Ctrl+Alt+V / Ctrl+Alt+C), Connection Builder (the D2 builder
  toggles, migrated verbatim incl. the allowLan amber warning and Reset),
  and Backup & Restore (D3 backup export/import). Both interim Configs-tab
  panels moved to this, their locked final home; the QR button/modal stays
  on the Configs tab untouched.
- **System tray (item 3):** the tray icon ships via extraResources
  (resourcesPath/icon.ico on Windows, icon.png elsewhere; build/ files in
  dev). Left click toggles the window, right click opens the menu:
  Show/Hide, Connect/Disconnect, Quit. The Connect item rides the same
  command-bus pattern as the Ctrl+Alt+C hotkey
  (`memento:tray-toggle-connect`) so one shared renderer handler owns the
  toggle semantics; the menu label follows the real connection state via a
  one-way `tray_status_set` push from ConnectionManager. Menu + balloon
  texts render in the UI language — the renderer syncs every language
  change into `memento-app-prefs.json`, and the menu rebuilds main-side.
- **Close-to-tray (with one-time toast):** the X button now HIDES the
  window instead of quitting — closing a VPN manager must not silently
  kill a live VPN. The FIRST hidden close fires a native Windows balloon
  ("still running — reopen via the tray icon"; Win10+ renders it as a
  toast), once per userData via the `closeTrayToastShown` flag that ONLY
  the main process can write (the IPC sanitizer drops it). The behavior
  can be reverted with the Settings toggle; with the toggle off — or if
  the tray itself could not be created — the classic quit-on-close path
  is kept, so the user can never be stranded. The tray Quit item (and
  every OS-initiated quit) bypasses the interception via a `quitting`
  flag flipped in before-quit.
- **Cleanup on every real exit path (pre-Smoke review hardening):** the
  full teardown (kill all three cores + clear the system proxy) runs
  synchronously in `before-quit` — the first stage of every `app.quit()`
  (tray Quit included), before any window teardown — and redundantly on
  `closed` / `window-all-closed` / process `exit`. The one path that
  never fires `before-quit`, Windows shutdown/restart/logoff, is covered
  by the win32 window-level `session-end` hook (Electron 44 moved the
  event from `app` to `BaseWindow`; it cannot be prevented and we
  deliberately do not touch the cancelable `query-session-end`, so a
  user's shutdown is never blocked). Hard kills (Task Manager, power
  loss) stay physically uncoverable in-process — the F9 startup audit
  plus the orphan sweep in every start path remain the backstop.
- **Silent launch completed:** since the tray now exists, the
  autostart `--hidden` launch starts fully hidden (D3 had to settle for
  minimized). A second launch while hidden restores AND focuses the
  window (second-instance handler gained `show()`).
- **Prefs hardening:** `app_prefs_set` now runs every patch through
  `sanitizePrefsPatch` (own-enumerable properties only, so prototype-chain
  planting is dead on arrival) and serializes concurrent patches through
  a promise chain — the fire-and-forget language sync can no longer race
  a Settings toggle and drop a field. Preload allowlist grows 19 -> 20
  (`tray_status_set`).

## Phase C — Batch C1 (live traffic chart + TLS fragment)

The first batch of the anti-censorship phase pairs the highest-value DPI
bypass (item 4) with the highest-visibility D1 payoff (item 5). Both ride
infrastructure that already existed — no new IPC, no new npm deps, no
main-process changes at all.

- **Live traffic chart (item 5):** the Connection tab now draws a rolling
  ~6-minute area chart (pure SVG, cyan = download, yellow = upload) of the
  bytes/second values D1 already computes every 3 s poll. The data lives in
  a standalone `trafficHistory` ring (120 samples, capped, never persisted)
  that is deliberately OUTSIDE the zustand store — the App.tsx:61-64 perf
  rule (whole-store subscription re-renders thousands of config rows on
  every traffic update) stays intact: a new sample re-renders ONLY the
  chart, via `useSyncExternalStore`, and only while it is mounted
  (Connection tab + connected). ConnectionManager pushes one sample per
  poll and resets the ring whenever the connection identity changes. No
  chart library, no canvas, no extra polling.
- **TLS fragment (item 4, Xray):** a new Builder toggle in Settings ->
  Connection Builder splits the TLS ClientHello into small chunks — the
  classic Iran anti-DPI recipe. Source-verified against the pinned
  Xray v25.1.1 (`proxy/freedom/freedom.go`): the FragmentWriter is applied
  ONLY to a **freedom outbound whose settings carry `fragment`**, reached
  from the proxy outbound via `streamSettings.sockopt.dialerProxy`; the
  streamSettings-level `fragment` field many older guides mention is
  silently ignored by this core (probed live — the hello arrives unsplit).
  The generator therefore injects a `memento-frag-dialer` freedom outbound
  (packets `tlshello` or `N-M`, length/interval ranges) and points the
  proxy's sockopt at it. Applied ONLY to vmess/vless/trojan with
  tls/reality security; ss/socks and all sing-box (hysteria2/tuic, QUIC)
  configs are honestly skipped; invalid range input disables the feature
  (amber hint in Settings) instead of emitting a broken config. Defaults
  keep the old output byte-for-byte.
- **Noises verdict (item 4, deliberately not shipped):** in v25.1.1 the
  sibling `noises` knob runs ONLY on the UDP branch of the freedom outbound
  (`NoisePacketWriter`, DNS port 53 exempted) — on MEMENTO's topology the
  UDP payload rides INSIDE the TCP tunnel and the dialer only ever dials
  TCP, so a noises toggle could never fire. Shipping a dead switch would
  violate the honesty rule; Aether keeps its own independent noise knob.
- **Live proof:** the smoke-level `taskC1-live.mjs` runs the REAL generator
  output through the REAL pinned xray against a local recorder and proves
  the ClientHello is really split (first fragment <= 205 B, fragments
  spaced >= interval-min, total ~= one hello; OFF control arrives unsplit).
  Note: `xray run -test` accepts even malformed fragment/noises fields, so
  config-level acceptance alone proves nothing.

## Phase C — Batch C2 (real URL-test + latency history + custom Test URL)

Item 3 of the anti-censorship package: the v2rayN-style "real delay" —
one HTTP GET through an ACTUAL core, timed to the response headers —
plus a per-config latency history and the Test URL that D4 deferred to
this batch. One new IPC command (`url_test`), one new preload allowlist
entry (20 -> 21), no new npm deps.

- **Real URL-test (`url_test`), two probe modes (electron/urlTest.ts):**
  - *Instance mode* (`{ configJson }`): the renderer regenerates the
    target config with the SAME generators + builder options as connect
    (the C1 fragment dialer is measured when enabled), in "socks-only"
    inbound mode. The main process allocates a free ephemeral port,
    rewrites the socks inbound to it (our two documented shapes only:
    xray `port` / sing-box `listen_port`), strips every non-socks inbound
    (http/api can never collide with a live session), spawns a TEMPORARY
    xray or sing-box instance, waits for the port, runs one proxied HTTP
    GET through it, and kills the instance in a `finally` block.
  - *Tunnel mode* (`{ socksPort }`): probes an ALREADY RUNNING inbound —
    the connected session's socks port (works for all three cores) or any
    socks port the user points at. Nothing is spawned.
  - The HTTP probe is the reviewed D1 net_check recipe verbatim: a
    throwaway in-memory session per probe, `setProxy(fixed_servers,
    socks5://127.0.0.1:P)`, `ses.fetch()`. Latency = time to response
    headers (handshake included); any HTTP status counts as reachable —
    only network errors/timeouts fail.
  - ISOLATION is hard-wired: the probe spawns DIRECTLY (never through the
    core managers), never runs the image-wide orphan kill, never touches
    the system proxy, and writes its temp configs to `os.tmpdir()`
    (never next to `memento-active-config.json` — the F9 audit and the
    cleanup chain cannot see probe leftovers). A stale-file sweep runs at
    module load. A Connect pressed mid-test kills the probe by image name;
    the probe surfaces that honestly as a failed test.
- **Latency history (`src/utils/latencyHistory.ts`):** per-config bounded
  ring (20 samples), a standalone slice OUTSIDE zustand — the same
  architecture rule as C1's trafficHistory (App.tsx:61-64 perf contract):
  a new sample re-renders only the row that subscribes via
  `useSyncExternalStore`. Never persisted; failures are recorded too
  (a red badge is information).
- **UI:** Configs tab — a per-row real-delay button, a stacked result
  badge under the TCP-ping badge (never-tested rows stay clean) and a
  pure-SVG sparkline (>= 2 samples); a batch "URL-test" button over the
  current view (worker pool, concurrency 4, click again to cancel
  scheduling, progress on the button). Connection tab — a "Real-delay
  test" button that probes the LIVE tunnel (tunnel mode) and toasts the
  result. Pinger tab — a TCP / Real-Delay mode toggle for pasted links
  (identity-less targets intentionally bypass the history slice).
  Deliberately NOT changed: Connect Best and auto-failover still sort on
  TCP ping; the URL badges are a separate, end-to-end semantics.
- **Custom Test URL (the D4 deferral):** `appPrefs.testUrl`
  (default `https://www.gstatic.com/generate_204`), persisted in the
  prefs file, editable in Settings -> Connection Builder with main-side
  validation (`normalizeTestUrl`: absolute http/https, no whitespace,
  <= 500 chars; invalid values are dropped and the previous value
  survives). Every probe resolves the pref (lazily cached, invalidated
  on save). The browser preview mock honestly fails every probe.

## Phase C — Batch C3 (routing presets + custom rules + geo files + DNS/FakeDNS)

Items 1+2 of the anti-censorship package — the largest batch of the phase.
A new **Routing tab** owns the whole surface; both config generators consume
it via a 7th (xray) / 6th+7th (sing-box) parameter whose DEFAULT reproduces
the pre-C3 JSON byte-for-byte (golden-snapshot tested). Two new IPC commands
(`geo_status`, `geo_ensure`), preload allowlist 21 -> 23, no new npm deps.

- **Presets (`src/utils/routingOptions.ts`):** `standard` (legacy behavior),
  `bypass-ir` (Iranian sites/IPs direct, rest through the tunnel), `custom`
  (six validated lists: block/direct/proxy × domains/IPs, applied in that
  order), plus a geo-backed `blockAds` toggle. Rule lists accept
  `full:`/`domain:`/`keyword:`/`regexp:`/`geosite:` domain forms and
  IP/CIDR/`geoip:` forms; invalid lines are counted in the UI and NEVER
  reach the core; every list is capped at 200 rules.
- **Geo facts verified against the REAL pinned binaries:**
  - Xray v25.1.1: the Iran category is `geosite:category-ir` (a bare
    `geosite:ir` is NOT in the official geosite.dat — "list not found: IR");
    `geoip:ir` exists. Geo rules switch routing to `domainStrategy:
    "IPIfNonMatch"` (geoip needs resolved addresses).
  - sing-box 1.14.0: legacy geo fields are gone — Iran rules use LOCAL
    binary rule_set files (`{type:"local", format:"binary", path}` +
    `rule_set:[tag]` rules, `block` outbound). The fakeip server can never
    be the default DNS server, and 1.14 requires
    `route.default_domain_resolver` once DNS servers exist (deprecation
    warnings avoided entirely).
- **Geo files lifecycle (`electron/geoFiles.ts` + `geo_status`/`geo_ensure`):**
  Xray's geoip.dat/geosite.dat download from the PINNED XTLS release (the
  same URLs download.ts best-effort fetches — here explicitly, with byte-size
  sanity checks and atomic tmp+rename installs); sing-box gets
  geosite-ir/geoip-ir/category-ads-all `.srs` from the MetaCubeX meta-rules-dat
  "sing" branch into `dataDir/sing-box/`. The CONNECT FLOW gates on this:
  when the routing options reference geo, `geo_ensure` runs BEFORE any spawn
  and a failure aborts the connect with the exact reason — a missing geo file
  used to be a fatal core exit ~2s after launch ("connects then disconnects").
- **DNS modes:** `default` (the legacy 8.8.8.8/1.1.1.1/localhost block,
  byte-identical), `secure` (DoH resolvers; sing-box side detours them
  through the tunnel — verified), `fakedns` (Xray: fakedns pool
  198.18.0.0/15 + `dns.servers ["fakedns", ...]` + sniffing `destOverride
  ["http","tls","fakedns"]`; sing-box: fakeip server + sniff + hijack-dns
  route actions — both verified `check`-clean against the real binaries).
- **UI (`src/components/RoutingTab.tsx`, new sidebar tab):** preset cards,
  live-validated rule list textareas (invalid count per list), DNS mode
  cards with honest topology hints (FakeDNS ships an explicit long-session
  caveat), the geo files card with real per-file bytes + download/update,
  and a LIVE JSON preview of the exact dns/routing blocks each core will
  receive. Aether is config-less and keeps its own independent routes knob
  (Aether tab) — stated in the UI.
- **URL-test probes inherit routing:** probes regenerate configs with the
  SAME routing options (the tested path IS the real path) and run one
  `geo_ensure` per affected family before the batch; a missing geo file
  fails a probe honestly, never a fake latency.


## Phase C — Batch C4 (chain proxy + balancer)

Item ⑥ of the anti-censorship package. A new "Topology" surface on the
Routing tab lets the user route the tunnel THROUGH a first hop (chain) or
across several member configs (balancer), on BOTH cores. The single source
of truth for every tag is `src/utils/topologyOptions.ts`; the DEFAULT
(no chain, no balancer) reproduces the pre-C4 JSON byte-for-byte.

- **The tag scheme (why it looks like this):** the main outbound KEEPS its
  tag `proxy` (byte-compat + every legacy rule/traffic matcher keeps
  working); balancer EXTRAS are `proxy2..proxyN` (capped at
  `MAX_BALANCER_EXTRAS = 8`); the chain-hop carrier is `chain-hop` —
  deliberately NOT `proxy`-prefixed, because Xray's balancer `selector` is
  a PREFIX match and a "proxy"-prefixed hop would be swallowed by the
  pool. `trafficTagsFor()` derives the EXACT tag set the stats layer must
  count for the chosen topology (balancer -> all member tags; otherwise
  `["proxy"]`), and `connectionActions` passes it into `start_xray`.
- **Generators:** xray chain = the shadowsocks/hop outbound carries
  `sockopt.dialerProxy: "chain-hop"` (composable with the C1 fragment
  ladder: frag dialer -> chain-hop -> proxy — three layers, byte-proven);
  xray balancer = `routing.balancers[]` with the prefix `selector:
  ["proxy"]`, a LAST catch-all rule pointing at the balancer tag, and
  `burstObservatory` for leastPing/leastLoad. sing-box chain = `detour`
  ladders; sing-box balancer = a real `urltest` group outbound + `route.
  final: "balancer"` (same generate_204 URL as the C2 test).
- **Resolution honesty (`connectionActions`):** a chain hop that no longer
  exists, a hop on a DIFFERENT core than the tunnel, or a balancer with no
  members selected is an explicit abort toast — never a silently degraded
  config. Members are deduped and capped before generation.
- **Counting boundary:** `electron/xray.ts` gained `sanitizeTrafficTags`
  (regex-bounded, deduped, capped at 16, fallback `["proxy"]`) at the IPC
  boundary and per-tag EXACT-segment matchers (`>>>proxy2>>>traffic>>>
  uplink`) so tags can never cross-count or silently zero each other.
- **UI:** chain card (hop picker), balancer card (strategy cards
  random/roundRobin/leastPing/leastLoad + member list + cap indicator),
  and an honest hint under the balancer card — see the tracked limitation
  below, also rendered in-product in all 4 locales
  (`topo.balancerHint`).

### Xray v25.1.1 balancer uplink gap — TRACKED LIMITATION (re-check on every core pin bump)

**Behavior:** with a balancer active, a VLESS outbound selected THROUGH the
balancer registers its `>>>tag>>>traffic>>>uplink` counter but the core
NEVER increments it; downlink counts normally. A socks member counts BOTH
directions; the same VLESS reached by rule dispatch (chain or plain) counts
both directions too. Evidence is triple: X1 (vless+socks control pool —
vless uplink stays 0), X2 (sockopt nudge — no change), X3 (a second vless
member — same), cross-checked with the access log showing the round-robin
alternation 4/4 with all probes succeeding (the bytes really flowed).

**Product decision:** the traffic panel sums ALL member tags — everything
the core itself counts — and never hides or invents numbers; the balancer
card carries an honest note in all 4 locales stating exactly this gap
("the core does not count the UPLOAD bytes of VLESS members selected
through the balancer"). The UI therefore never lies: it shows the sum of
what the core reports and says so.

**RE-CHECK DIRECTIVE:** whenever `core-versions.json`'s xray pin changes,
re-run `node scripts/taskC4-uplink-probe.mjs` (X1/X2/X3). If the gap is
FIXED in the new core: re-point/retire the B1b3 pin in taskC4-live.mjs,
update `topo.balancerHint` in all 4 locales, and update this section +
TESTING-CHECKLIST §25.1. If still present: the formal smoke's S4 canary
(re-run on EVERY formal run) keeps proving the gap is exactly as
documented, so the docs can never silently drift from the core's real
behavior. The stats layer sums ALL member tags either way — the product
answer does not depend on which branch the core takes.

## Phase C — Batch C5 (kill switch — fail-closed system proxy)

Item 7 of the anti-censorship package — the last anti-censorship feature
before C6. MEMENTO tunnels through local SOCKS/HTTP inbounds and steers apps
via the Windows system proxy (HKCU); there is no TUN adapter and no admin
requirement anywhere in the product, so a WFP/firewall-class kill switch is
out of scope BY DESIGN. What IS honestly implementable — and what C5
implements — is the classic user-mode contract, enforced by a new main
module (`electron/killSwitch.ts`) over the existing reg.exe proxy surface:

- **The invariant:** `armed && tunnel down` => the system proxy is FORCED to
  `127.0.0.1:9` (enabled but dead — apps fail closed instead of silently
  falling back to a direct, unprotected connection). `armed && tunnel up`
  => proxy = the live tunnel ports (unchanged). `disarmed` => every path is
  byte-identical to pre-C5. The blocked state is deliberately NOT
  ProxyEnable=0 — that would BE the leak.
- **Every tunnel-down path is covered:** manual disconnect (stop paths +
  the renderer's `clear_system_proxy`), unexpected core death (all three
  managers' exit handlers call `blockOnCoreExit`), and the F9 startup audit
  (a leftover proxy from OUR crashed session is NORMALIZED to the blocked
  state instead of cleared — a FOREIGN proxy is still strictly hands-off).
- **One deliberate boundary, stated in the UI:** quitting the APP always
  restores direct access (a portable app must never strand the user's
  internet after it is gone). A quit latch (`markQuitting`) is set BEFORE
  the D4 cleanup on BOTH quit paths (before-quit + window session-end), so
  the dying cores' exit handlers cannot re-block during teardown.
- **Arming acts immediately:** arming while disconnected blocks NOW;
  disarming while blocked restores direct — but only if the current proxy
  state is OURS (tunnel ports or the blocked port); another tool's proxy is
  never touched (real `enforceKillSwitchAfterPrefChange`).
- **Honest limits (in the UI, not hidden):** covers only apps honoring the
  Windows system proxy; apps with their own proxy settings or hard-coded
  direct traffic bypass it; this is proxy-level fail-closing, not a
  firewall. No UAC, no driver, no service — same no-elevation reg.exe
  mechanics as every other proxy write.
- **State & surface:** `killSwitch` boolean in appPrefs (default OFF,
  strictly opt-in; the sanitizer accepts only a real boolean; tolerant
  load). No new IPC command — the pref rides `app_prefs_get/set` and the
  enforcement lives main-side. Renderer: a store mirror boot-loaded from
  the prefs, a Settings toggle (Window & Startup section) whose hint states
  the full contract, and a red `role="alert"` banner on the Connection tab
  whenever the switch is armed and the tunnel is down. Browser preview:
  the mock mirrors the field honestly (no fake enforcement — there is no
  OS proxy in a browser), so the toggle + banner are fully explorable.
- **Proofs (taskC5-live, real pinned cores):** armed crash (SIGKILL of the
  REAL xray/sing-box child through the REAL compiled manager) -> BLOCKED;
  armed manual stop -> BLOCKED; disarmed stop/crash -> the exact legacy
  behavior (plain clear / no call at all); quit latch -> CLEAR wins; the
  REAL deferred F9 audit normalizes an armed leftover, clears a disarmed
  one, and never touches a foreign proxy.

## Phase C — Batch C6 (Aether pin-per-version updates + the honest self-update assistant)

Two user-approved decisions implemented as one batch.

### Aether core updates — Option B: the pin-per-version table

The third core's update mechanism is a **table, not a channel**:
`electron/aether-versions.json` is the ONLY install authority the update
service accepts. What that means, line by line:

- **User-click only.** There is no timer, no boot-time check, no background
  refresh anywhere — the check and the install run strictly inside the two
  IPC handlers. With no explicit click, the offline default IS the bundled
  pin (v1.9.0): nothing is fetched, nothing changes.
- **sha256 is mandatory and comes from the table.** A version that is not a
  table row is refused (`not-pinned`), no matter what it claims to be. A
  download whose pinned zip hash (when the table records one) or whose
  EXTRACTED-binary hash differs from the table is refused and NOTHING is
  written to disk (`zip-hash-mismatch` / `hash-mismatch`). The binary hash
  is the same discipline the spawn gate has enforced since Task 12 — the
  binary is the identity.
- **The running core is never swapped underneath itself.** While the
  manager owns a live (or grace-pending) child, BOTH the check and the
  install refuse with `blocked-running` (the check is read-only, but the
  honest gate keeps the panel single-minded), and the install gate is
  evaluated a SECOND time right before the final rename — a core started
  while the download was in flight can never be replaced. The panel shows
  an amber banner explaining this.
- **Isolation (C2 parity, re-confirmed):** the check/download path is a
  plain DIRECT fetch in the main process. It never touches the registry,
  netsh, WinINET, or any Electron session/net API, and never reads or
  writes any system-configuration value — a check with the VPN up or down
  cannot alter a single system setting. `aetherUpdate.ts` is electron-free
  (like `killSwitch.ts`) so the whole service is functionally testable
  with every dependency injected.
- **Honest states, no silent fallbacks:** `up-to-date` / `pinned-newer`
  (install offered) / `unpinned-newer` (the upstream release exists but
  THIS build has not pinned+verified it — update MEMENTO itself to get it
  pinned; nothing is downloaded) / `error` (offline, HTTP failure,
  unreadable manifest). A check NEVER downloads an artifact; only an
  explicit install click does.
- **Swap mechanics:** download -> verify zip hash -> extract -> verify the
  binary hash -> re-check the running gate -> stage `aether.incoming-tmp`
  INSIDE the target dir (same-volume rename) -> verify what landed on disk
  -> backup the previous binary to `aether.prev.bak` (a manual rollback
  artifact) -> rename. Any failure leaves the current binary untouched.
  The active version is identified by HASHING the current binary against
  the table (no sidecar pointer that could drift); an unrecognized binary
  is reported as "unknown (hash not in the pin table)" — never guessed.
- **The spawn gate extends, never loosens:** `aether.ts` now accepts the
  bundled pin PLUS every table hash for the running platform. The 1.9.0
  table entries are pinned-by-test to be byte-identical to
  `AETHER_SHA256_PINS`; an unknown hash is refused exactly as before.
- **Provenance:** the 1.9.0 row carries the Task-12 verified values (zip
  `5c64be2f…eb8d`, binary `ee400806…b36cd` win32, `e8b2a83c…30b9` linux,
  verified live 2026-09-16 from the official CluvexStudio release assets).
  No linux download URL is listed because Task 12 verified the linux
  binary directly, not a release asset — an install on linux therefore
  refuses with the honest `no-url` reason. New rows are added by hand only
  after re-verifying the official assets (the permanent provenance rule).

### MEMENTO's own updates — Option A: the honest assistant (no self-swap)

The app never updates itself. `electron/appUpdate.ts` carries STATIC facts
only — this build's version and the pinned releases page — and the Settings
tab shows them with a button that opens the page in the USER's browser
(through the existing `open-external` shell command). There is no
autoUpdater, no network check, no download step, no self-swap: a portable
app must never modify the files of the very process it runs from (the C5
portable principle, extended to updates). Option B (an in-app check with a
pinned manifest + guided manual flow) is postponed, not cancelled. IPC:
`app_update_info` returns the static facts; the renderer adds zero network
calls of its own.

### Surface

Four new additive IPC commands (allowlist 23 -> 27): `aether_update_status`
(the identified active version, the bundled pin, the table, the running
lock), `aether_update_check`, `aether_update_apply { version }` (a pinned
version string is the ONLY argument; URLs and hashes come from the table),
and `app_update_info`. UI: an update card at the bottom of the Aether tab
and a "MEMENTO updates" section in Settings. Browser preview: the mock
mirrors the shapes honestly (no fake download/swap in a browser).

## Phase B — Batch B0 (wintun.dll provenance — the ONLY new distribution file of the TUN effort)

Approved decisions D1/D3, frozen: the TUN engine is the already-pinned
**sing-box 1.14.0** (inbound `tun`, `auto_route`+`strict_route`,
`stack: mixed`); its one runtime dependency on Windows is **wintun.dll
0.14.1 (amd64)**, which sing-box loads from disk at TUN inbound start.
Batch B0 ships the PROVENANCE ONLY — zero executable TUN code (that is
B1: routingSession/routingHelper).

### The artifact (live-verified 2026-09-20 from the official source)

- **Official zip:** `https://www.wintun.net/builds/wintun-0.14.1.zip`
  (750,540 bytes), SHA-256 `07c25618…4ef51`.
- **dll (bin/amd64, 427,552 bytes):** SHA-256
  `e5da8447…0dafce` — byte-identical to the independent reference pin
  (Aethon's `routing.rs` `WINTUN_SHA256`): two distribution channels,
  one hash.
- **Authenticode:** signed by **WireGuard LLC** (chain validation is a
  real-Windows check; the sandbox proved the signature blob + the
  embedded `WireGuard LLC` / `0.14.1` version info).
- **License:** WireGuard LLC's bespoke "Prebuilt Binaries License"
  (NOT open-source). The verbatim text is COMMITTED at
  `resources/wintun/wintun-LICENSE.txt` (the reference's SBOM-5 lesson:
  never ship a redistributed dll without its tracked notice), and
  `NOTICE.md` records the attribution line. Clause 3(d) applies: the dll
  rides the app unmodified and is used only through the wintun.h
  Permitted API (via sing-box's TUN inbound).

### What B0 actually adds (nothing else — no code paths change)

- `electron/wintunPin.ts` — THE ONE PLACE the artifact identity lives
  (version, official URLs, both SHA-256 digests, publisher, relative
  path, verification date) + the contract comments (B1 must re-verify
  the hash AND the publisher before the first TUN spawn — the C6-style
  spawn-integrity gate extension).
- `electron/core-versions.json` — the shipped-binary pin registry gains
  `"wintun": "0.14.1"` beside xray/sing-box/aether.
- `scripts/fetch-wintun.sh` + `scripts/fetch-wintun.ps1` — fetch from
  the official page ONLY, verify the zip digest, verify the dll digest,
  (ps1) verify the Authenticode publisher, place
  `resources/wintun/bin/amd64/wintun.dll` + refresh the license text.
  Any mismatch REFUSES at fetch time — a bumped version that misses a
  constant fails at build, not on a user's machine.
- `resources/wintun/README.md` — the provenance record (how the
  verification was done, the cross-check, the license obligations).
- The dll itself is NOT committed and NOT zipped (the standing
  "binaries are never shipped" rule); it lands via the fetch script on
  the build machine, exactly like the other pinned cores.

## Phase B — Batch B1 (routingSession + routingHelper — the TUN session machinery, no UI yet)

Approved decisions D1–D7, frozen. B1 delivers the two electron-free
machinery modules of the TUN effort; the manager/IPC/UI wiring arrives
in B2, the C5 kill-switch fusion in B3. NOTHING user-visible changes in
B1 — the renderer, the IPC surface and the preload allowlist are
untouched (enforced by gates).

### The fixed names (D5)

- **TUN interface:** `MementoTun` — deliberately CONSTANT (the reference
  derives a per-session dynamic name; a fixed name makes stale-adapter
  detection deterministic).
- **Helper role:** `MementoTunHelper` — written into every status.json.
- **Session base directory:** `<userData>/MementoTunSession` — derived
  identically by the GUI and the elevated helper (same user profile
  after UAC).
- **Recovery marker:** `memento-routing-recovery.json` at the base.
- **Elevation argv:** `--routing-helper <requestPath>` /
  `--repair-network <sessionDir>`.

### The two modules

- `electron/routingSession.ts` (GUI side, ~490 lines): the D5 constants,
  the request schema + validation + privilege-boundary authorization,
  atomic session files (request/status/control/recovery), the TUN
  sing-box config builder, the wintun spawn-integrity gate (the B0
  wintunPin contract fulfilled: EVERY session re-verifies
  `WINTUN_DLL_SHA256`, and on Windows the `Get-AuthenticodeSignature`
  publisher `WireGuard LLC`, BEFORE sing-box ever runs), the elevation
  launcher (PowerShell `Start-Process -Verb RunAs` — no new
  dependencies), and the D6 semantic mapping.
- `electron/routingHelper.ts` (elevated side, ~600 lines): argv
  recognition + dispatch, the watchdog loop (400 ms ticks, 10 s upstream
  probes, 3-strike budget), the D6 fork, the full teardown, the
  identity-guarded stale-engine kill (a pid from the user-writable
  status.json is killed ONLY when its image name is the pinned
  sing-box), the `--repair-network` one-shot, and wintun placement
  beside the engine.

### The TUN config (D1/D4/D7)

sing-box 1.14.0 runs `tun-in` (interface `MementoTun`,
`auto_route`+`strict_route`, `stack: mixed`, `mtu` = D7 clamp) and
forwards everything into the ACTIVE core's local SOCKS inbound. DNS is
REAL remote (`1.1.1.1` / `8.8.8.8`) DETOURED through the tunnel — no
plain-DNS leak — and `route.default_domain_resolver` is mandatory by
construction. The routing engine carries NO clash_api (traffic stats
stay on the core). The generated config is proven against the REAL
pinned binary (`sing-box check`) in the B1 functional test.

### The D6 semantics (frozen)

- Upstream loss + kill switch ARMED → status `reconnecting`, the tunnel
  STAYS UP (fail-closed: `auto_route` keeps swallowing traffic into a
  dead tunnel) and probing continues until the upstream recovers.
- Upstream loss + UNARMED → status `restoring` + full teardown
  (fail-open).
- The GUI dying (pid gone) or a `control.json` stop → ALWAYS a full
  teardown (`disabled`), recovery marker cleared.
- The helper NEVER touches the system proxy; the app-side suppression
  mapping (`suppressSystemProxyWrites`) ships for B2/B3 wiring.

### Loop prevention (process-based)

main.ts checks `isHelperInvocation(argv)` BEFORE the single-instance
lock: the elevated helper process acquires no lock, creates no
window/tray/hotkeys/IPC, spawns no cores, touches no proxy — every
normal-app lifecycle hook (`whenReady`, `before-quit`,
`window-all-closed`, the process-exit cleanup) is HELPER_MODE-guarded,
so the helper can never kill the GUI's live cores (the very upstream
the tunnel feeds on).

### Validation

- `scripts/taskB1-fntest.mjs` — 98 assertions on the REAL bundled
  modules with injected engine/probe/clock/identity (T1–T18), including
  the real `sing-box check`, the tampered-dll refusal before ANY spawn,
  the privilege boundary behind the helper, and all three D6 legs.
- `scripts/taskB1-quickcheck.mjs` — structural gates (D5/D6/D7 pins,
  electron-free contract, hook ordering, untouched surfaces, docs).

## Phase B — Batch B2 (routingManager + the 4 IPC commands + the SOCKS/VPN Device segment)

B2 is the GUI-side half of the B1 machinery: the manager that owns the
session lifecycle, four additive IPC commands, and the Aether-tab segment
that switches the connection between the classic SOCKS behavior and the
full-system VPN Device (TUN) routing. The B1 modules are byte-untouched.

### routingManager.ts (NEW — the thin wiring layer B1 was shaped for)

- `createRoutingManager(deps)` — ELECTRON-FREE factory (the B1
  discipline): main.ts injects the userData dir, the platform, the exe
  path, the ACTIVE core's live SOCKS inbound (resolved from the three
  managers), the fresh kill-switch flag, and the elevation launcher.
  `taskB2-fntest` drives the real factory with fake deps.
- **start** — refuses honestly (non-win32 / no active core / session
  already active), builds the D5 request ENTIRELY main-side (the
  renderer can never forge pids, ports, paths or the kill-switch flag),
  D7-clamps `tunMtu` at the boundary, writes the request + recovery via
  `prepareRoutingSession`, and hands `<exe> --routing-helper
  <requestPath>` to UAC. A failed launch clears the recovery marker (no
  stranded "active" view).
- **UAC self-heal** — a launch the elevated helper never answers (UAC
  denied/cancelled) heals to honest idle after a 120 s deadline with no
  helper evidence; a late-approved helper re-writes the marker itself
  (B1 behavior), so the heal is always safe.
- **stop** — control.json `{action:"stop"}` ONLY; the B1 helper owns
  the teardown (the GUI never kills anything).
- **status** — the merged honest view: helper status.json + recovery
  marker + fresh armed flag + the D6 suppression mapping + the D5 names
  ECHOED (the renderer never hardcodes them). A leftover recovery with
  no status file reports the crashed-session "error" with the repair
  guidance.
- **repair** — the elevated `--repair-network` one-shot; nothing to
  repair = `{launched:false}` WITHOUT a UAC prompt (honest, and no
  elevation for show). **Anti-UAC-spam:** a repair is refused while a
  TUN start elevation is still pending, and for 120 s after any repair
  launch (`REPAIR_COOLDOWN_MS` — the same budget as the UAC heal), so
  repeated clicks can never queue multiple elevation prompts. (The TUN
  start path needs no extra cooldown: UAC-pending counts as live and
  the 120 s self-heal already caps it at one unanswered prompt.)
- **requestStopBestEffort** — synchronous control stop for the quit
  path; the D6 gui-pid watchdog remains the guaranteed backstop.

### The 4 IPC commands (additive; preload allowlist 27 → 31)

`routing_start` / `routing_stop` / `routing_status` / `routing_repair`.

D6 enforcement points added around them (disclosed scope):

- `set_system_proxy` + `clear_system_proxy` REFUSE while a helper-reported
  live session owns system routing (starting/connected/reconnecting) —
  WinINET writes are meaningless under a TUN adapter and would only
  dangle. The C5 armed/clear routing itself is untouched.
- `start_xray` + `aether_start` refuse while the session is live — the
  active core IS the tunnel's upstream; `stopOtherCore` would kill the
  feed under a live adapter.
- `stop_xray` + `aether_stop` fire the session's control stop FIRST (the
  reverse order is exactly the dead-upstream-under-live-adapter state
  D6 forbids).
- `cleanupOnce` (every real-quit path) stops the session before the
  cores.

### The Aether-tab segment (SOCKS / VPN Device)

- Persisted `aetherMode` (localStorage `memento-aether-mode`, default
  `socks` = the pre-B2 behavior byte-for-byte). Connect-time choice:
  disabled while busy/connected and in browser mode.
- VPN Device connect = `aether_start` THEN `routing_start` (the TUN
  tunnels into this session's SOCKS inbound). A refused TUN start is
  honest: the aether session STAYS UP in SOCKS mode and the toast names
  the reason; the system-proxy write is deliberately skipped in this
  mode.
- VPN Device disconnect = `routing_stop` → poll `routing_status` until a
  terminal state (≤ 12 s) → `aether_stop`. Main-side `aether_stop`
  carries the same fire-first guard as a backstop.
- The status pill shows the ROUTING state while a session is live —
  including the amber "Holding (reconnecting)" fail-closed banner (armed
  D6) — and the VPN Device card shows the helper's own message plus the
  elevated "Repair network (admin)" button.
- In VPN Device mode the system-proxy toggle is REPLACED by an honest
  note (the adapter routes all system traffic; writes are suppressed
  while live anyway).
- The renderer mirror of the wire shape lives in `store.ts`
  (`RoutingStatusViewWire` — the `AetherLiveInfo` pattern; no renderer
  file imports main-process modules). `electron-mock.ts` carries the
  honest browser-preview mirror (idle state, every action refused with
  its real reason).
- i18n: 21 new keys × 4 locales (en/fa/zh/ar).

### Validation

- `scripts/taskB2-fntest.mjs` — 62 assertions on the REAL bundled
  manager with injected platform/core/kill-switch/launcher/clock
  (T1–T15): the full start/stop/status/repair surface, the D7 clamp
  passthrough, both already-live refusals, the UAC self-heal, the
  suppression map, the stale-recovery chaining, and the launcher-failure
  cleanup.
- `scripts/taskB2-quickcheck.mjs` — structural gates (source contract,
  wiring, compiled freshness, renderer discipline, i18n parity, docs,
  B1 frozen surfaces).
- `scripts/taskB1-quickcheck.mjs` — the three B1 freeze gates UPDATED
  for the approved B2 additions (preload 27→31, the four routing
  handlers, the D5-name renderer discipline with the honest mock
  exception); everything else byte-intact.

## Phase B — Batch B3 (C5 kill-switch + F9 audit fusion — the TUN tunnel type joins the C5/F9 contracts)

B3 fuses the B1/B2 VPN Device (TUN) feature with the two system-safety
contracts that predate it: the C5 fail-closed kill switch and the F9
startup audits. Before B3 the kill switch only knew the SOCKS tunnel
type (the managers' exit paths + the system-proxy writes); the TUN
session had its own D6 fork but a START-TIME armed snapshot, and a
crashed/killed helper could leave an armed machine silently unprotected.
Four pieces close every gap, with the B2 UI byte-untouched.

### routingHelper.ts — fresh armed reads + the status heartbeat

- **The D6 fork now reads the FRESH kill-switch state** (Phase B3 C5
  fusion). The injectable `readKillSwitchArmed(userDataDir)` dep
  defaults to a tolerant electron-free read of the SHARED prefs file
  (`memento-app-prefs.json` — the same file the GUI writes on every
  arm/disarm flip; the elevated helper runs as the SAME user, so the
  read-only peek crosses no trust boundary). An arm/disarm made while a
  session is live therefore takes effect at the NEXT fork decision
  (≤ one probe interval), not at the next session start. The request's
  start-time snapshot stays the guaranteed fallback: a missing file, a
  torn mid-write read, or a throwing injected reader all fall back to
  the B1 behavior byte-identically.
- **The status heartbeat** (Phase B3): the helper re-writes status.json
  at EVERY probe tick (10 s) — readiness, healthy-connected, and
  held/reconnecting alike — so the GUI's staleness detector keys on
  real evidence: a live helper can never go 30 s silent by construction
  (probe interval + probe deadline), and a dead one can never look live.
- Everything else is byte-identical: the D6 outcome strings, the
  teardown trail, the repair pass, the spawn gate.

### routingManager.ts — heartbeat staleness + the C5 transition

- `ROUTING_STATUS_STALE_MS = 30_000` — a helper-reported LIVE state
  whose `updatedAtMs` is older is a DEAD session: `getRoutingStatus`
  maps it to the honest `error` view ("heartbeat lost — use network
  repair or start a new session"), and `suppressSystemProxy` /
  `isSessionLive` treat it as NOT live (a dead helper must not keep the
  D6 proxy gates locked nor the core-start guards wedged).
- `onRoutingLiveLost` dep — the observed live → terminal/stale
  transition fires EXACTLY ONCE into main.ts's wiring. Boot-time
  leftovers never fire it (the F9 audit owns boot; the first read after
  launch is never a "transition"); quit-time teardowns are latched out
  by the kill switch itself.
- `getLeftoverAuditState()` — the startup audit's input: recovery
  marker present + is the helper's last status FRESH-live (an orphan
  elevated helper may still own a live adapter; the audit must never
  act against a possibly-alive session).

### killSwitch.ts — the TUN twin + the TUN audit decision

- `blockOnRoutingExit()` — the `blockOnCoreExit` twin for the TUN
  tunnel type: quitting → no-op, disarmed → no-op, armed → the blocked
  proxy (127.0.0.1:9). Idempotent with the core-exit write (a TUN death
  that also kills the upstream core fires both).
- `resolveRoutingAuditAction(armed, markerActive, helperLiveFresh)` —
  the pure TUN-residue decision: armed + marker + no fresh helper →
  "block", anything else → "leave". NEVER clears anything; foreign
  proxies stay hands-off. `applyRoutingAuditAction` is the best-effort
  applier.

### main.ts — the TUN startup audit + the main-side watchdog

- `auditLeftoverRoutingSession()` (runs in the same deferred +300 ms
  tick as the proxy audit, right after it): win32 only, never while a
  core is running, never against a fresh-live helper, never when the
  proxy leg is already enabled (the proxy audit owns enabled states) —
  an armed user with a TUN crash residue and a disabled proxy leg gets
  the blocked proxy (fail closed) at startup.
- The 2 s main-side routing watchdog (`setInterval`, unref'd): the
  renderer's routing_status poll only runs while the Aether tab is
  mounted — the C5 transition enforcement and the UAC self-heal must
  never depend on which tab is open or on a hidden window. A late fire
  during quit is a no-op through the kill-switch latch.
- i18n: the `set.killSwitchHint` copy now documents the VPN Device
  semantics in all four locales (no new keys — the renderer is
  byte-untouched otherwise).

### Validation

- `scripts/taskB3-fntest.mjs` — the REAL bundled manager + helper +
  kill switch (two esbuild bundles: native linux + the win32 define
  with the fake reg.exe surface): the heartbeat freshness proofs, the
  fresh-armed mid-session flip (armed hold → disarm → fail-open
  teardown), the snapshot fallback matrix, the staleness mapping +
  boundary, the once-only transition firing, the audit snapshot, the
  blockOnRoutingExit truth table with the observable blocked write, the
  audit decision matrix, and the B2 non-regression pins.
- `scripts/taskB3-quickcheck.mjs` — structural gates (source contract
  on all four edit sites, main.ts wiring order, compiled freshness,
  i18n copy parity ×4, docs, B1/B2 frozen surfaces).
- `scripts/taskB1-smoke.mjs` / `taskB2-smoke.mjs` — the B1/B2 module
  size freeze gates re-pointed to the B3 line counts (disclosed,
  test-side only; the D6/D5/B2 behavioral pins all retained verbatim).

## Phase B — Batch B4 (Phase B closeout — the phase is closed)

B4 is the DOCUMENTATION-ONLY closeout of Phase B: zero runtime source
edits, zero behavior changes, zero dependency changes. Its job is to
close the phase honestly — the closure map with the seal chain, the
frozen surface at its final line counts, the one registered
documentation finding (the taskC4-probe.mjs design-time probe),
recorded where the probe lives, and the explicit remaining-work
register that survives Phase B. Every B0-B3 gate, needle and
behavioral pin stands verbatim; the embedded-assertion battery stays
1,374 all-green on the B4 tree (the only assertion-relevant edit is a
docstring header, which no gate reads).

### The Phase B closure map (B0 → B4)

- **B0 — wintun.dll provenance** (seal `bef82af1…`): the ONLY new
  distribution file of the whole TUN effort; official-source fetch
  behind the double digest gate + the Authenticode publisher check;
  `WINTUN_DLL_SHA256` re-verified before every helper spawn; and the
  standing `resources/wintun/bin/*` binary-never-ships zip gate. The
  LIVE provenance re-run remains part of every later batch's official
  smoke (S0b) — the B0 chain stays live on the tree.
- **B1 — routingSession + routingHelper** (seal `d7ca91c9…`): the D5
  fixed names (MementoTun / MementoTunHelper / the session layout /
  memento-routing-recovery.json / `--routing-helper` /
  `--repair-network`); the request schema + the privilege boundary;
  atomic session files + the recovery lifecycle; the D1 TUN sing-box
  config (D4 real remote DNS detoured through the tunnel + the
  mandatory `route.default_domain_resolver`); D7 clampTunMtu;
  verifyWintunForSpawn; the elevated helper launch (no new deps); the
  D6 fork semantics (armed=reconnecting hold fail-closed, disarmed
  =restoring teardown fail-open, TUN suppresses system-proxy writes,
  quit always full teardown).
- **B2 — routingManager + the 4 IPC commands + the segment UI** (seal
  `be226a11…`): the manager contract (spawn/supervise/status/
  disconnect) + the 4 IPC commands; the SOCKS/VPN Device segment in
  the Aether tab; UAC-pending suppression + the 120 s self-heal; the
  sequenced disconnect (adapter removed before the core stops); the
  core-transition guard; the D6 suppression UI.
- **B3 — C5 kill-switch + F9 audit fusion** (seal `499fbe14…`): the
  D6 fork now reads the FRESH kill-switch state from the shared prefs
  file (the start-time snapshot stays the guaranteed fallback);
  the 10 s status heartbeat + the 30 s staleness view; 
  `killSwitch.blockOnRoutingExit` (the TUN twin, fired exactly once
  per live→terminal/stale transition, boot never fires); the
  block-only boot audit `auditLeftoverRoutingSession` (never clears
  anything, never audits against a possibly-alive helper); the 2 s
  main-side unref'd watchdog. The three hole fixes closed: the D6
  stale snapshot, the silent helper death, F9 SOCKS-only.
- **B4 — this closeout** (documentation only): the phase map, the
  frozen surface, the taskC4-probe.mjs finding recorded, the
  remaining-work register restated. With the user's download
  confirmation of the B4 seal, Phase B is CLOSED.

### The frozen Phase B surface (as sealed at B3 — byte-identical at B4)

- `electron/routingSession.ts` 537 — the pure electron-free session
  machinery (schema + privilege boundary, config builder, D6 mapping,
  the wintun spawn gate).
- `electron/routingHelper.ts` 673 — the elevated helper (heartbeat,
  fresh-armed reads, probes, the D6 outcomes, the teardown trail).
- `electron/routingManager.ts` 535 — spawn/supervise/staleness/
  leftover-audit state, the B2 guards, the honest status views.
- `electron/killSwitch.ts` 262 — the C5 fail-closed core + the B3 TUN
  twin + the block-only audit decision pair.
- `electron/main.ts` 499 — the factory wiring, the deferred F9 tick
  order, the 2 s routing watchdog.
- `electron/ipc.ts` 724, `electron/preload.ts`, and the renderer trio
  — the B2 surface, byte-untouched through B3 and B4.
- Battery: 1,374 embedded assertions all-green (982 pre-B + 145 B1 +
  124 B2 + 123 B3); the B3 official smoke 144/0 including the LIVE
  provenance re-run; the B3 zip 222 entries with the
  binary-never-ships gate retained.

### The taskC4-probe.mjs finding (registered at B3, documented at B4)

- `scripts/taskC4-probe.mjs` is the C4 DESIGN-TIME schema probe (12
  assertions: P1-P8 Xray + S1-S4 sing-box) that validated the C4
  config shapes BEFORE the C4 generator code was written — the
  established C3 discipline. It was never part of the C5/B-era
  batteries and no gate reads it.
- Re-run against the PINNED sing-box 1.14.0, its S4 negative
  expectation ("`sing-box check` rejects a urltest referencing a
  missing outbound") does NOT hold: `check` ACCEPTS such a config
  (exit 0). Dangling urltest members surface at RUNTIME, not at
  check time. Zero migration surface is involved — nothing in the
  config path ever relied on S4 holding, and the C4 generator ships
  its own live gates (taskC4-cfgtest against the real cores).
- Disposition (B4): the finding is recorded in the probe's own header
  docstring. The probe remains a C4 design-time artifact with
  byte-identical executable semantics — it is NOT "fixed", NOT wired
  into any battery, and re-running it today exits 1 on S4 by design.
  If a future core pin bump ever changes check-time validation, the
  header note is where the expectation gets revisited — never a
  silent flip.

### The remaining-work register AFTER Phase B (unchanged, user ruling)

Never sealed, never recovered — to be implemented FROM SCRATCH in
their own batches after Phase B; none of it is part of this closure:

- **E1** per-connection stats;
- **E2** ShadowTLS parser;
- **THIRD-PARTY.json** the license manifest;
- **setup-app** the new installer.

### Validation

- `scripts/taskB4-quickcheck.mjs` — the B4 structural gates: the three
  doc edit sites (README Batch-B4 with the seal chain, TESTING-CHECKLIST
  section 32, the probe header note), the zero-runtime-change proof
  (all seven Phase B electron files at their B3 line counts + the
  renderer trio pins), and the probe's executable body pinned
  byte-stable below its header.

## Phase E — Batch L0 (third-party license/origin manifest — the post-B register begins)

### What L0 is (and is not)

The first batch of the post-Phase-B register, per the user ruling (license
manifest, E1, E2, setup-app — in that order, each its own batch, the same
strict routine: full report -> user approval -> smoke -> zip -> seal ->
seals-archive). Phase B is CLOSED (seal `76a6f03c…`); L0 opens Phase E.

L0 ships **zero runtime behavior**: no electron file, no renderer file, no
core pin changes. It is a DATA + DOCS batch — the only code-adjacent surface
is `resources/`, which electron-builder's `extraResources` already copies
wholesale into the portable exe, so the manifest + license texts ride every
distribution automatically. Everything was rebuilt **FROM SCRATCH with the
live evidence of 2026-09-20** — the placement at `resources/THIRD-PARTY.json`
(the one thing kept from the pre-rollback design, because NOTICE.md already
promised it) is the only inheritance; every fact below was re-verified today.

### The authority chain (three layers, one truth)

1. **`resources/THIRD-PARTY.json`** (NEW, 233 lines) — the MACHINE-READABLE
   authority: manifestVersion 1; `app` block (MEMENTO, MIT, Epodonios);
   `scope` block (what is covered + the verification basis); **16 `bundled`
   entries**; **2 `runtimeFetched` entries**; **4 `excluded` entries with
   reasons**; an `authority` block naming every pin authority + the
   bump-discipline rule (a component bump re-verifies the license from the
   official source and updates manifest + NOTICE + texts in the SAME
   reviewed commit — the wintunPin discipline, generalized).
2. **`NOTICE.md`** (rewritten, 21 -> 101 lines) — the HUMAN-READABLE
   registry derived from the manifest; the wintun section is kept VERBATIM
   (B0 provenance untouched); every other component gets its license id,
   upstream, copyright line and text-file pointer.
3. **`resources/licenses/`** (NEW, 7 verbatim texts, each sha256-pinned in
   the manifest) — the license texts that MUST ride the distribution:
   `Xray-core-v25.1.1-MPL-2.0.txt` (373 lines, fetched from the pinned tag),
   `sing-box-v1.14.0-GPL-3.0.txt` (674 lines, the canonical GPLv3 — digest
   `8ceb4b9e…b65b903`, the well-known gnu.org text), 
   `sing-box-v1.14.0-LICENSE-notice.txt` (17 lines, the upstream LICENSE
   file verbatim, incl. sing-box's name-association clause),
   `Aether-v1.9.0-AGPL-3.0.txt` (661 lines, fetched from the pinned tag),
   `jsqr-1.4.0-Apache-2.0.txt` (202 lines), `Inter-OFL-1.1.txt` (93 lines),
   `JetBrainsMono-OFL-1.1.txt` (93 lines, both copied verbatim from the
   @fontsource packages).

### The live evidence base (verified 2026-09-20, not assumed)

- **Xray-core v25.1.1 = MPL-2.0** — LICENSE fetched at the pinned tag
  (373 lines); the repo README badge, deps.dev and pkg.go.dev all agree.
- **sing-box 1.14.0 = GPL-3.0-or-later** — the upstream LICENSE at tag
  v1.14.0 was fetched and is the 17-line GPL NOTICE HEADER ("version 3 …
  or (at your option) any later version", Copyright (C) 2022 nekohasekai)
  WITHOUT the full text embedded. So the full canonical GPLv3 text rides
  separately (fetched from the gcc-mirror/gcc `COPYING3` canonical copy
  because gnu.org is unreachable from the build sandbox — the digest
  `8ceb4b9e…` proves it is the canonical text byte-for-byte). Both files
  ship; the provenance of each is recorded in the manifest entry.
- **Aether 1.9.0 = AGPL-3.0** — the upstream LICENSE at tag v1.9.0 fetched
  verbatim (the FULL 661-line GNU AGPL-3.0 text); the repo README says only
  "See the LICENSE file", no explicit "or later" grant found -> the SPDX
  reading **AGPL-3.0-only**, recorded honestly in the manifest.
- **wintun 0.14.1** — unchanged: the bespoke "Prebuilt Binaries License",
  B0-provenance-pinned (zip `07c25618…`, dll `e5da8447…`, publisher
  `WireGuard LLC`).
- **Electron 44.3.0 = MIT** + **adm-zip 0.5.18 = MIT** — read from
  `electron-app/package-lock.json` + `node_modules/*/LICENSE` on disk.
- **Renderer inventory** — an import scan of `src/` enumerated the REAL
  bundled set: react (23 imports), lucide-react (21), react-hot-toast (17),
  react-dom / zustand / qrcode / jsqr (1 each); the fonts ARE bundled
  (`src/main.tsx` imports the @fontsource CSS at L5-11 and
  `assetsInlineLimit: 100_000_000` inlines the woff2 files into the
  single-file build) -> OFL entries are mandatory. clsx / tailwind-merge /
  @tauri-apps are NEVER imported -> excluded with that reason.
- **Geodata lineage** — v2fly/geoip LICENSE fetched: **CC BY-SA 4.0**;
  v2fly/domain-list-community: **MIT**; MetaCubeX/meta-rules-dat "sing"
  branch: **NO license file** (HTTP 404 on the branch — recorded honestly
  as a lineage-attribution entry, both in the manifest and in NOTICE.md).

### The inventory (16 bundled, one line each)

Xray-core v25.1.1 (MPL-2.0) · sing-box 1.14.0 (GPL-3.0-or-later) · Aether
1.9.0 (AGPL-3.0-only) · wintun.dll 0.14.1 (Wintun Prebuilt Binaries
License) · Electron 44.3.0 (MIT; Chromium/Node components ride per
LICENSES.chromium.html) · adm-zip 0.5.18 (MIT) · react + react-dom 19.2.6
(MIT) · lucide-react 1.18.0 (ISC) · react-hot-toast 2.6.0 (MIT) · zustand
5.0.14 (MIT) · qrcode 1.5.4 (MIT) · jsqr 1.4.0 (Apache-2.0) · tailwindcss
4.1.17 (MIT — compiled output rides) · Inter + JetBrains Mono via
@fontsource 5.3.0 (OFL-1.1, inlined woff2).

### The compliance decisions (why this is enough)

- **GPL-3.0 (sing-box) / AGPL-3.0 (Aether):** MEMENTO spawns each core as a
  SEPARATE, unmodified process through its documented CLI/config interface —
  no linking, an aggregate rather than a derivative; MEMENTO's own code
  stays MIT. The duties that remain are honored: the verbatim license text
  rides in `resources/licenses/`, and the corresponding source for the
  pinned binaries is publicly available at the pinned tag URLs recorded in
  the manifest + NOTICE (the complete-source-offer path). AGPL §13 adds
  nothing for a local child process.
- **MPL-2.0 (Xray-core):** file-level copyleft; upstream is untouched, the
  core is consumed as a separate executable.
- **Apache-2.0 (jsqr):** verbatim text rides + attribution in NOTICE.
- **OFL-1.1 (fonts):** unmodified font software + copyright + verbatim
  license text ride; MEMENTO makes no derivatives, so the Reserved Font
  Name rules are not engaged.
- **MIT / ISC (Electron, adm-zip, react family, tailwind, qrcode):**
  per-package copyright + license lines in NOTICE.md.
- **Wintun (bespoke):** clauses 3(c)/3(d) honored exactly as pinned at B0.

### The frozen Phase B surface (unchanged by L0)

All seven Phase B electron files stand at their frozen line counts
(routingSession 537 / routingHelper 673 / routingManager 535 / killSwitch
262 / main 499 / ipc 724, preload's 4 routing_ allowlist entries intact),
the renderer trio is byte-untouched, and `scripts/taskC4-probe.mjs` stays
exactly 212 lines with its B4 NOTE. L0 touches ONLY:
`resources/THIRD-PARTY.json` (new), `resources/licenses/` (new, 7 files),
`NOTICE.md` (rewrite), this README section, `TESTING-CHECKLIST.md` §33,
and `scripts/taskL0-quickcheck.mjs` (new).

### The remaining-work register after L0

- **E1** per-connection stats;
- **E2** ShadowTLS parser;
- **setup-app** the new installer;
- ~~THIRD-PARTY.json~~ — **DONE at this batch** (this section).

### Validation

- `scripts/taskL0-quickcheck.mjs` — the L0 structural gates: the manifest
  structure + counts, the manifest<->repo cross-checks (core-versions.json,
  wintunPin.ts, aether-versions.json, both package-lock.json files, the
  license-text sha256s recomputed live), the verbatim texts' content
  needles, the NOTICE/README/CHECKLIST doc pins, and the zero-runtime-
  change proof over the frozen Phase B surface.
- The full B-era battery re-run on the L0 tree (the Phase B battery rides
  untouched: 31 suites / 1,407 assertions).

## Phase E — Batch E1 (live per-connection stats — the second register item lands)

### What E1 is

A live, per-connection traffic view mounted under the VPN tab's traffic
chart, built FROM SCRATCH on today's live evidence (approved design
decisions D1-D6, 2026-09-21). The aggregate traffic path — `get_xray_traffic`,
`ConnectionManager`'s 3 s poll loop, the store counters, TrafficChart — is
byte-untouched; E1 adds a SEPARATE read-only surface beside it:

- sing-box 1.14.0 -> granularity `per-connection`: the clash_api
  `GET /connections` response already carries a live per-connection array;
  the aggregate path only ever read its totals. E1 maps the same
  endpoint's rows through the per-build Bearer secret, which stays
  INSIDE the main process (D2/D3) — the renderer receives normalized
  rows only.
- xray 25.1.1 -> granularity `per-outbound`: live-probed today, the Stats
  API exposes ONLY per-tag traffic counters (`outbound>>><tag>>>traffic>>>
  uplink/downlink`); there is NO per-connection counter anywhere on the
  surface. The UI says so — rows are per tunnel member, never dressed up
  as connections.
- aether -> granularity `none`: the established honest limitation, now
  rendered as its own note instead of silent zeros.

### The live evidence base (all captured 2026-09-20/21 against the PINNED cores)

- `scripts/taskE1-probe.mjs` — P1: sing-box `GET /connections` shape
  captured LIVE (id/upload/download/start/chains/rule/metadata{...}); P2:
  `xray api statsquery` returns exactly the per-tag counters and nothing
  finer. Artifacts: `scripts/taskE1-live-tmp/probe-e1.json`.
- Bonus live finding: sing-box 1.14.0 REJECTS the `freedom` outbound
  (removed 1.12+). The app is unaffected — its generator only emits
  hysteria2/tuic outbounds.
- `scripts/taskE1-fntest.mjs` — functional test of the REAL compiled
  `dist-electron/connectionStats.js` against both pinned cores over real
  loopback traffic: F1 per-connection rows caught in-flight, F2
  per-outbound rows with honest zero rows, F3 failure honesty (dead port /
  null secret -> empty reply, never a throw).
  Artifacts: `scripts/taskE1-fntest-tmp/fntest-e1.json`.

### The implementation map (additive only)

- NEW `electron/connectionStats.ts` (250 lines): the whole per-connection
  surface in one main-side module — sing-box mapper (1200 ms deadline,
  defensive normalization, download-desc sort, 200-row cap with honest
  pre-cap counts), xray mapper (same spawn pattern as queryXrayTraffic,
  per-tag rows + role hints), failure -> honest empty.
- `electron/coreTypes.ts` 30 -> 73: the three wire shapes
  (ConnectionStatsGranularity / ConnectionStatsRow / ConnectionStatsReply).
- `electron/singbox.ts` 430 -> 437: ONE additive read-only accessor
  (`getClashSecret`) — the only frozen-file touch on the sing-box side.
- `electron/ipc.ts` 724 -> 748: the additive `get_connection_stats`
  handler mirroring `get_xray_traffic`'s active-core routing + aether
  guard; the aggregate handler body is byte-identical.
- `electron/preload.ts` 154 -> 159: the allowlist gains exactly one
  channel (`get_connection_stats`); the hardening docstring is updated.
- `electron/xray.ts` 626 -> 626: BYTE-STABLE (the module reuses
  `findXray()` directly; no getter needed — strictly less surface than
  the approved plan's +3).
- NEW `src/components/ConnectionStatsPanel.tsx` (214 lines): self-polling
  (only while expanded AND connected; collapsed = zero IPC), local state
  only, granularity-honest rendering, per-outbound note, 200-row cap note,
  role chips.
- `src/components/ConnectionTab.tsx` 1210 -> 1216: the import + the mount
  under the TrafficChart anchor (connected-only).
- `src/i18n.ts` 1703 -> 1755: 12 `connections.*` keys x 4 languages.
- `src/electron-mock.ts` 739 -> 777: the mock handler — the browser
  preview shows the same granularity honesty.
- `TESTING-CHECKLIST.md` §34.

### The frozen Phase B surface after E1

Byte-stable (sha256-gated in the quickcheck): routingSession 537 /
routingHelper 673 / routingManager 535 / killSwitch 262 / main 499 /
xray 626 / tray / coreOps / cores, the renderer's ConnectionManager 175 /
store 1378 / TrafficChart, tauriBridge, and every C/D-era module. The
ONLY frozen-file edits are ipc.ts and preload.ts, additive-only, as
declared at design time and approved.

### The remaining-work register after E1

- **E2** ShadowTLS parser;
- **setup-app** the new installer;
- ~~E1~~ — **DONE at this batch** (this section);
- ~~THIRD-PARTY.json~~ — DONE at L0.

### Validation

- `scripts/taskE1-quickcheck.mjs` — the E1 structural gates: new-file
  presence, the allowlist needle (exactly one `get_connection_stats`),
  the aggregate-handler byte pin, the frozen-surface sha256 pins, the
  renderer pins, the i18n key parity (12 keys in all 4 languages), and
  the live probe re-run.
- The full battery re-run on the E1 tree rides the L0-era battery set.

## Phase E — Batch E2 (the MEMENTO ShadowTLS parser)

ShadowTLS arrives as a **transport paired with a trojan inner protocol**,
reachable ONLY through a proprietary **`memento-stls://` scheme that the UI
explicitly labels non-standard** (no industrial-standard ShadowTLS URI
exists; a fake `shadowtls://` would mislead). Sing-box ONLY: the pinned
Xray 25.1.1 rejects the protocol outright, re-proven live at design time
(`infra/conf: unknown config id: shadowtls`, exit 23).

### Design-time live evidence (2026-09-21, pinned cores — scripts/taskE2-probe.mjs)

- P1 outbound schema matrix (`sing-box check`): the TLS block is REQUIRED
  for every version (v1/v2/v3 all FATAL "TLS required" without it); the
  accepted version range is exactly 1..3 (v4 FATAL "unknown protocol
  version: 4"); the password is NOT schema-enforced; the schema STRICTLY
  rejects unknown fields.
- P2 xray rejection (above) — sing-box-only by construction.
- P3 the server-side auth field is `users[]` (first run FATAL "missing
  users" taught this); a detour-less server runs but is useless alone.
- P4 FULL loopback E2E: client pair {trojan detour stls-t} + {shadowtls
  transport} -> server {shadowtls-in detour trojan-in}: real traffic
  `200:14336`.
- P5 a BARE shadowtls outbound passes check but carries NO traffic
  (curl 52; server "bad request: fallback disabled") — hence the scheme
  always carries the inner trojan credential.

### Implementation (additive; the whole electron/* surface byte-stable)

- `src/store.ts` 1379 -> 1476: `ProtocolType` + `shadowtls`;
  `isSingBoxProtocol` now carries exactly hysteria2/tuic/shadowtls;
  `ParsedConfig` + `stlsVersion`/`stlsPassword`; `parseShadowTLS()` with
  the honest validation (version range 1..3; v2/v3 require
  `stls-password`); the `memento-stls://` dispatch in
  `parseSingleLink` (subscriptions inherit it via the same path).
- `src/utils/singBoxConfig.ts` 244 -> 318: `buildSbStlsTransport()` (tag
  `stls-t`; explicit version; password omitted for passwordless v1;
  `insecure` only from the link) + the trojan primary with
  `detour: "stls-t"`; `buildSbOutbound(..., allowStlsPair)` refuses the
  pair in topology positions; a shadowtls MAIN ignores topology wholesale
  (a hop would overwrite the pair's detour and orphan the transport).
- `src/utils/connectionActions.ts` 352 -> 375: three honest gates — a
  shadowtls MAIN with chain/balancer enabled aborts with a toast, a
  shadowtls hop aborts, a shadowtls pool pick is dropped with a reason.
- `src/utils/ping.ts` 176 -> 179, `src/utils/editor.ts` 356 -> 360,
  `src/components/ImportTab.tsx` 541 -> 546 (chip + the amber
  non-standard disclosure), `src/components/ConfigsTab.tsx` 1264 -> 1266
  (the `Record<ProtocolType, string>` chip map REQUIRES a shadowtls
  entry — caught by the impl-time typecheck; additive two lines),
  `src/i18n.ts` 1755 -> 1759 (`import.stlsNote` x4 languages),
  `src/electron-mock.ts` 777 -> 790 (the demo-de-stls config).
- Byte-stable (sha-pinned): xray.ts, connectionStats.ts, ipc.ts,
  preload.ts, singbox.ts, coreTypes.ts, v2rayConfig.ts (its
  `default: return null` outbound switch is the structural xray-path
  refusal), urlTest.ts, ConnectionTab/RoutingTab/EditorTab,
  ConnectionManager.tsx, tauriBridge.ts, TrafficChart.tsx and the whole
  B-era electron core. store.ts and ConfigsTab.tsx re-pointed (both
  additive, the sanctioned B2-era class).

### The remaining-work register after E2

- **setup-app** the new installer;
- ~~E2~~ — **DONE at this batch** (this section);
- ~~E1~~ — DONE at E1; ~~THIRD-PARTY.json~~ — DONE at L0.

### Validation

- `scripts/taskE2-fntest.mjs` — the REAL bundled renderer modules against
  the REAL pinned binary: F1 parse -> generate -> `sing-box check` ->
  run -> real traffic through the generated pair; F2 parse honesty
  (v4 / v2·v3-without-transport-password rejections, v1 passwordless);
  F3 scope honesty (topology ignored/refused, xray null); F4 peripherals
  (editor round-trip, ping extraction, the 4-language note).
- `scripts/taskE2-quickcheck.mjs` — the E2 structural gates (parser,
  generator, the three honest toasts, peripherals, i18n parity, the
  frozen sha256 surface with the store.ts re-point, docs, and the LIVE
  probe re-run incl. the bare-outbound negativity).
