# NOTICE — third-party attributions (MEMENTO electron distribution)

MEMENTO — V2Ray Config Editor by Epodonios (MIT). This file is the
HUMAN-READABLE attribution registry. The MACHINE-READABLE authority is
`resources/THIRD-PARTY.json` (landed at Phase E Batch L0, 2026-09-20) —
it records, per component: origin, pinned version, SPDX license id,
delivery path, pin authority and compliance notes. The verbatim license
texts that ride every distribution live in `resources/licenses/`
(wintun's bespoke text stays at `resources/wintun/wintun-LICENSE.txt`).

## Bundled binaries — proxy cores + driver

- **Xray-core v25.1.1** — MPL-2.0. Upstream https://github.com/XTLS/Xray-core
  (tag v25.1.1). Verbatim text: `resources/licenses/Xray-core-v25.1.1-MPL-2.0.txt`.
  Delivered bundled (`resources/xray/xray.exe`) and/or auto-downloaded from the
  official XTLS releases (`electron/download.ts`) — both pinned to v25.1.1 by
  `electron/core-versions.json`.
- **sing-box 1.14.0** — GPL-3.0-or-later. Upstream
  https://github.com/SagerNet/sing-box (tag v1.14.0). The upstream LICENSE file
  is the GPL notice header (`resources/licenses/sing-box-v1.14.0-LICENSE-notice.txt`,
  verbatim); the full canonical GPLv3 text rides as
  `resources/licenses/sing-box-v1.14.0-GPL-3.0.txt`. MEMENTO spawns the
  unmodified `sing-box.exe` as a separate process (no linking). Corresponding
  source for the pinned binary: the release page above (complete-source-offer).
  Bundled, version-pinned, no auto-download (see `resources/sing-box/README.md`).
- **Aether 1.9.0** — AGPL-3.0 (the repo carries the verbatim GNU AGPL-3.0 text;
  no explicit "or later" grant found — SPDX reading AGPL-3.0-only). Upstream
  https://github.com/CluvexStudio/Aether (tag v1.9.0). Verbatim text:
  `resources/licenses/Aether-v1.9.0-AGPL-3.0.txt`. MEMENTO spawns the
  unmodified `aether.exe` via its documented AETHER_* environment interface.
  Corresponding source: the release page above. "Aether" is a project by
  CluvexStudio; MEMENTO is an unofficial wrapper — independent UI, no
  affiliation; the upstream TRADEMARK.md reserves the name.
- **wintun.dll 0.14.1 (amd64)**

- **Copyright / licensor:** WireGuard LLC (www.wintun.net)
- **License:** Wintun "Prebuilt Binaries License" — bespoke, NOT an
  open-source licence. Verbatim text shipped at
  `resources/wintun/wintun-LICENSE.txt` and riding every distribution.
- **Restrictions honored:** proprietary notices kept intact (clause 3(c));
  redistribution only alongside software using the dll via the wintun.h
  Permitted API, unmodified (clause 3(d)) — MEMENTO loads the dll through
  sing-box's TUN inbound and never modifies or re-signs it.
- **Provenance:** sha256-pinned in `electron/wintunPin.ts`
  (`e5da8447…0dafce`), fetched only from `https://www.wintun.net/builds/`,
  Authenticode publisher `WireGuard LLC`.

## Electron shell (inside the portable exe)

- **Electron 44.3.0** — MIT — Copyright (c) Electron contributors;
  Copyright (c) 2013-2020 GitHub Inc. The embedded Chromium/Node/V8
  components carry their own licenses, which ride per Electron's
  LICENSES.chromium.html (verified as a real-Windows checklist item).
- **adm-zip 0.5.18** — MIT — Copyright (c) 2012 Another-D-Mention Software
  and other contributors. The only production npm dependency (zip extraction
  for the Xray auto-download and update flows); rides inside the asar.

## Renderer bundle (compiled into dist/, singlefile)

- **react 19.2.6 / react-dom 19.2.6** — MIT — Copyright (c) Meta Platforms,
  Inc. and affiliates.
- **lucide-react 1.18.0** — ISC — Copyright (c) 2026 Lucide Icons and
  Contributors.
- **react-hot-toast 2.6.0** — MIT — Copyright (c) 2020 Timo Lins.
- **zustand 5.0.14** — MIT — Copyright (c) 2019 Paul Henschel.
- **qrcode 1.5.4** — MIT — Copyright (c) 2012 Ryan Day; based on Kazuhiko
  Arase's "QRCode for JavaScript" (MIT).
- **jsqr 1.4.0** — Apache-2.0 — upstream https://github.com/cozmo/jsQR.
  Verbatim text: `resources/licenses/jsqr-1.4.0-Apache-2.0.txt`.
- **tailwindcss 4.1.17** — MIT — Copyright (c) Tailwind Labs, Inc. (the
  compiled utility CSS rides; the tool itself is dev-time only).
- **Inter (via @fontsource/inter 5.3.0)** — SIL OFL 1.1 — Copyright 2016 The
  Inter Project Authors (https://github.com/rsms/inter). The woff2 files are
  inlined into the single-file build, so the typeface rides the distribution;
  verbatim license text: `resources/licenses/Inter-OFL-1.1.txt`.
- **JetBrains Mono (via @fontsource/jetbrains-mono 5.3.0)** — SIL OFL 1.1 —
  Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono). Verbatim text:
  `resources/licenses/JetBrainsMono-OFL-1.1.txt`.

## Runtime-fetched data (installed into the user data dir)

- **geoip.dat / geosite.dat** — fetched on demand from the pinned Xray-core
  v25.1.1 release assets (`electron/geoFiles.ts`). Lineage attribution: built
  by XTLS from the v2fly datasets — v2fly/geoip (CC BY-SA 4.0) and
  v2fly/domain-list-community (MIT); GeoLite2-derived records carry MaxMind's
  own attribution requirements.
- **sing-box .srs rule-sets** (geosite-ir.srs, geoip-ir.srs,
  geosite-category-ads-all.srs) — fetched on demand from
  MetaCubeX/meta-rules-dat, branch "sing". NO standalone license file is
  published on that branch (verified 2026-09-20 — recorded honestly in
  THIRD-PARTY.json); the datasets are community redistributions of the same
  v2fly lineage.

## Out of scope (see THIRD-PARTY.json "excluded" for the exact reasons)

The dev toolchain (vite, typescript, electron-builder, …); packages declared
but never imported (clsx, tailwind-merge, @tauri-apps/* — legacy Tauri
leftovers); the first-party companion tools (`resources/spoofing-patt/`,
`resources/domain-fronting/`); and Aethon (internal provenance cross-reference
channel, never shipped).
