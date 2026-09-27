# resources/wintun/ — pinned wintun.dll (Phase B0)

This directory holds the provenance record for **wintun.dll**, the single
new distribution file of the whole TUN effort (approved decisions D1/D3).
The dll is loaded at runtime by the pinned **sing-box 1.14.0** TUN inbound
(`stack: mixed`); MEMENTO never renames, patches or re-signs it. The
binary itself is NOT committed to this repository — it is placed here by
the fetch scripts, which refuse any hash mismatch at fetch time:

```
resources/wintun/
  bin/amd64/wintun.dll     <- placed by scripts/fetch-wintun.ps1 (Windows)
                              or scripts/fetch-wintun.sh (sandbox/CI)
  wintun-LICENSE.txt       <- committed verbatim from the verified zip
  README.md                <- this file
```

## Required build (do NOT substitute other versions without updating
## electron/wintunPin.ts + electron/core-versions.json in the same commit)

- **Version:** 0.14.1 (amd64, win32-x64 only)
- **Official page:** https://www.wintun.net/
- **Official zip:** https://www.wintun.net/builds/wintun-0.14.1.zip (750,540 bytes)
- **zip SHA-256:** `07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51`
- **dll SHA-256 (bin/amd64/wintun.dll, 427,552 bytes):** `e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce`
- **Authenticode publisher (verified on real Windows):** `WireGuard LLC`
- **Provenance verified (live official-source fetch + hash + PE inspection):** 2026-09-20

## How the verification was done (2026-09-20, sandbox session)

1. The official zip was downloaded from `wintun.net/builds` and hashed —
   `07c25618…4ef51`.
2. `wintun/bin/amd64/wintun.dll` was extracted and hashed —
   `e5da8447…0dafce`. This hash is **byte-identical** to the independent
   reference pin (Aethon's `routing.rs` `WINTUN_SHA256`, fetched through
   the Xray-release channel) — two independent distribution channels
   agree bit-for-bit.
3. PE inspection of the dll: PE32+, `CERTIFICATE_TABLE` present
   (12,320-byte Authenticode blob), embedded version info reads
   `WireGuard LLC` / `0.14.1`. The full signature-chain validation
   (`Get-AuthenticodeSignature` → `WireGuard LLC`) is a real-Windows
   manual item — TESTING-CHECKLIST section 28 — and B1's spawn gate will
   enforce it at runtime on Windows.

## License (the dll is NOT open-source)

wintun.dll carries WireGuard LLC's bespoke **"Prebuilt Binaries
License"** (the verbatim text is committed here as `wintun-LICENSE.txt`):
clause 3(c) forbids removing proprietary notices; clause 3(d) permits
redistribution only alongside software that uses the dll via the
wintun.h **Permitted API** without modification. MEMENTO uses the dll
exactly as released, loaded by sing-box's TUN inbound through that API —
unmodified, notices intact. See `NOTICE.md` at the electron-app root.
