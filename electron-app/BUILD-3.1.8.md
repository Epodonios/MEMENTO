# MEMENTO 3.1.8 — BUILD & CHANGE DOCUMENT

> from EPODONIOS to A Who — built on the 3.1.7 contract-gate foundation.
> Companion docs: `BUILD-3.1.7.md` (the 2.0.4→2.0.6 installer saga), `TESTING-CHECKLIST.md`.

## What ships in 3.1.8

Six user-requested changes + the app in one coordinated release.

### 1. TUN mode fixed for xray/sing-box (field report #5)
**Symptom:** TUN ("تان مود") worked perfectly on Aether but on the VPN
Connection tab NO traffic passed at all.
**Root cause:** the TUN engine (`routingSession.buildTunSingboxConfig`) takes
over the default route via `auto_route` — the ACTIVE core's own packets to its
server were captured by the adapter and looped back into the tunnel. Aether
self-protects (its `AETHER_ROUTE_BLOCK/AETHER_ROUTE_DIRECT` env contract);
xray.exe / sing-box.exe have no such self-protection.
**Fix:** the ACTIVE server's endpoints are now EXCLUDED from the tunnel:
- the renderer passes the connected config's address (`routing_start {bypassHost}`),
- `ipc.ts` resolves the domain (clean system DNS, before the adapter exists),
- `routingManager` validates everything and writes `bypassDomains` /
  `bypassCidrs` into the D5 request (optional fields — a pre-3.1.8 request
  stays valid; malformed lists are refused behind the privilege boundary),
- the TUN engine adds: a `direct` outbound (binds to the physical NIC via
  route-level `auto_detect_interface`), a `sniff` rule-action + exact-domain
  + domain-suffix rules (catches TLS/QUIC dial targets even under polluted
  DNS), `ip_cidr` rules, and `route_exclude_address` on the tun inbound
  (kernel-level exclusion — those IPs never enter the adapter).
Without the lists the config is byte-identical to 3.1.7 (Aether path
unchanged — it already worked).

### 2. Three new protocols in Config Builder (per the repo reference image)
The protocol grid now mirrors the uploaded sheet — **7 cards**:
VMess · VLESS · Trojan · Shadowsocks · **Hysteria2** · **SOCKS5** · **TUIC**
- Hysteria2: password + salamander obfs (+obfs password), SNI, ALPN,
  insecure — `hysteria2://` link, sing-box outbound JSON preview.
- TUIC v5: UUID + token + congestion control (cubic/bbr) — `tuic://` link,
  sing-box outbound JSON preview.
- SOCKS5: optional user/pass (anonymous when both empty) — `socks://` link,
  xray socks-outbound JSON preview.
- All protocol cards carry four-language labels + hints (en/fa/zh/ar);
  generated links feed the SAME `addConfigs()` parser pipeline (the store's
  `parseHysteria2/parseTUIC/parseSocks` already knew these schemes).

### 3. Hint system — every section, four languages (user request #3)
- NEW `src/components/Hint.tsx`: a custom hover+icon tooltip — soft emerald
  orb, glass bubble with arrow, lift/scale transition, keyboard-focusable,
  RTL-safe, pure CSS (no deps, no portal).
- `SectionHeader` gained `hintKey` — all 13 tabs show a colloquial "?" hint
  next to their title: `hint.import / configs / connection / editor / pinger
  / scanner / routing / export / aether / updateCenter / googleSide /
  liveconn / settings` (+22 hint keys total) **in all four languages**.
- Item-level hints: VPN Connection's three mode cards (direct / system-proxy
  / TUN), Auto-Failover card, Import's Quick Import & Config Builder switch,
  Aether's VPN-Device mode card, Live Connection's pause control.

### 4. Logging & error management system (user request #4)
- NEW `electron/logger.ts`: ONE structured pipeline —
  `{ts, level, scope, message, detail}` entries in a bounded ring buffer
  (800) + daily JSONL files `<userData>/logs/memento-YYYY-MM-DD.log`
  with a 14-day retention sweep.
- Process-level capture: `uncaughtException` / `unhandledRejection` are
  logged with stacks and never crash the app silently.
- Renderer capture (`src/utils/errorLog.ts`): `window.onerror`,
  `unhandledrejection`, `console.error/warn` + React `ErrorBoundary`
  catches all flow into the SAME log (rate-guarded 30/10s, loop-guarded).
- Every failed IPC invoke is logged at the bridge (`tauriBridge.ts`) and
  connection/TUN/aether/update-center lifecycle events are logged main-side.
- Settings → **"Logs & Errors"** card: view the recent tail (level-colored,
  scrollable), refresh, copy, export (main-side save dialog), open folder,
  clear view. Files stay on disk as the forensic record.

### 5. Live Connection works with EVERY core (user request #5)
- **aether**: honest new granularity **"sockets"** — the live OS socket table
  of the aether process (netstat by PID) with local-port attribution; the UI
  labels it "aether · live sockets" and says plainly that byte counters do
  not exist for this core.
- **Google Side**: the MHRV relay is in-process — byte counters now observe
  its own tunnels (SNI-rewrite, direct passthrough, plain-HTTP and MITM
  relay paths). With no core running but Google Side active,
  `get_connection_stats` returns one honest "google-side · relay" row and
  the tab shows its cumulative relay bytes.
- Core badge now names whichever surface is live: `xray · per-outbound`,
  `sing-box · per-connection`, `aether · live sockets`,
  `google side · relay`.
- `ConnectionStatsPanel` (Connection tab) understands the new granularity.

### 6. Update Center: Pause / Resume / Cancel (user request #6)
- `updateCenter.ts`: the download loop polls pause/cancel switches between
  chunks. **Pause** aborts the fetch and stages the partial file
  (`incoming.asset.part`); **Resume** continues via HTTP `Range` (a server
  that ignores Range restarts clean); **Cancel** aborts AND deletes the
  partial. New phases: `paused` / `cancelled` (progress events + entry
  `canResume` flag).
- UpdateCenterTab: amber Pause + red Cancel live during download
  (not gated by the busy flag), Resume after a pause, honest toasts.

## Versions
- App: **3.1.8** (`electron-app/package.json`, root `package.json`)
- Setup: **2.0.7** (staging fix from field report #4 already inside:
  only a previous MEMENTO install is renamed aside — foreign folders like
  `Downloads` are installed INTO in place, leave-no-trace cleanup removes
  only files this run wrote)

## Verification (sandbox)
- Gates: `scripts/taskF-smoke.mjs` (91/0) · `scripts/taskG-smoke.mjs` ·
  `scripts/taskH-smoke.mjs` (the H7 artifact checks pass after the build)
- Renderer: `vite build` clean · Main: `tsc -p tsconfig.json` clean
- Real-Windows TUN/Defender behavior remains TESTABLE-ONLY-ON-WINDOWS —
  the structural gates verify shapes; the field report is answered by the
  standard server-bypass topology (route_exclude_address + direct outbound)
  used by every mainstream TUN client.

## Build recipe (sandbox, 4 GB)
```bash
cd electron-app
ELECTRON_BUILDER_COMPRESSION_LEVEL=7 npm run dist          # MEMENTO-3.1.8.exe
cd ../setup-app
npm run sync:payload                                        # embed real payload
ELECTRON_BUILDER_COMPRESSION_LEVEL=7 npm run dist          # MementoSetup-2.0.7.exe
node ../scripts/taskF-smoke.mjs && node ../scripts/taskG-smoke.mjs \
  && node ../scripts/taskH-smoke.mjs
```
