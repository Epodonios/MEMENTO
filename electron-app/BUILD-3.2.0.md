# MEMENTO 3.2.0 — BUILD & CHANGE DOCUMENT

> from EPODONIOS to A Who — built on the 3.1.8 feature round.
> Companion docs: `BUILD-3.1.8.md` (the six-change feature round), `BUILD-3.1.7.md` (the 2.0.4→2.0.6 installer saga), `TESTING-CHECKLIST.md`.

## What is 3.2.0

The complete 3.1.8 feature round, re-versioned as one coordinated release
(app **and** setup now share the same version number so a field install is
unambiguous), delivered after a full payload-content re-verification.

### Contents (identical feature set to 3.1.8 — verified inside the built artifacts)
1. **TUN mode fixed for xray/sing-box** — active-server bypass topology
   (`bypassDomains`/`bypassCidrs` → `direct` outbound + sniff rules +
   `route_exclude_address` on the tun inbound). Aether path unchanged.
2. **7 protocol cards** in Config Builder — VMess · VLESS · Trojan ·
   Shadowsocks · **Hysteria2** · **SOCKS5** · **TUIC** (links + JSON
   previews byte-compatible with the store parsers).
3. **Hint system** — `Hint.tsx` glass hover+icon tooltip, all 13 tabs +
   22 item hints, four languages (en/fa/zh/ar).
4. **Logging & error management** — `electron/logger.ts` (ring 800 + daily
   JSONL, 14-day retention, uncaught/rejection capture), renderer
   `errorLog.ts`, failed-IPC logging, Settings → "Logs & Errors" card.
5. **Live Connection multi-core** — xray per-outbound, sing-box
   per-connection, aether live sockets, google-side relay byte counters.
6. **Update Center pause/resume/cancel** — chunk-boundary switches, HTTP
   Range resume, partial-file staging/cleanup.

### 3.2.0 version surface
- root `package.json` → **3.2.0**
- `electron-app/package.json` → **3.2.0**
- `setup-app/package.json` → **3.2.0**
- `setup-app/electron/main.ts` `SETUP_VERSION` → **3.2.0**
- `UpdateCenterTab` fallback version string → **3.2.0**
- gates `taskG`/`taskH` artifact pins → **MEMENTO-3.2.0.exe /
  MementoSetup-3.2.0.exe**

## Verification (sandbox)
- Gates: `scripts/taskF-smoke.mjs` **91/0** · `scripts/taskG-smoke.mjs`
  **71/0** · `scripts/taskH-smoke.mjs` **184/0** (H7 checks the real
  3.2.0 artifacts + SFX integrity + live install-contract probes).
- Payload-content probe of the shipped exes (7z extraction + keyword scan):
  `hysteria2` ×46 · `tuic` ×69 · `logs_clear` ×3 in the renderer bundle,
  `route_exclude_address` + `bypassCidrs` + `log_event` + pause/cancel in
  `dist-electron`, `payload-meta.json appVersion = 3.2.0`.
- Real-Windows TUN/Defender behavior remains TESTABLE-ONLY-ON-WINDOWS —
  the structural gates verify shapes; the field report is answered by the
  standard server-bypass topology used by every mainstream TUN client.

## Build recipe (sandbox, 4 GB)
```bash
cd electron-app
ELECTRON_BUILDER_COMPRESSION_LEVEL=7 npm run dist          # MEMENTO-3.2.0.exe
cd ../setup-app
npm run sync:payload                                        # embed real payload
ELECTRON_BUILDER_COMPRESSION_LEVEL=7 npm run dist          # MementoSetup-3.2.0.exe
node ../scripts/taskF-smoke.mjs && node ../scripts/taskG-smoke.mjs \
  && node ../scripts/taskH-smoke.mjs
node ../scripts/taskH-zip.mjs                               # delivery folder + seals
```
