/**
 * MEMENTO — wintun.dll build-time provenance constants (Phase B0).
 *
 * THE ONE PLACE the wintun artifact identity is recorded. Every value
 * below was LIVE-VERIFIED from the official source on 2026-09-20 and is
 * byte-cross-checked against the independent reference pin (Aethon's
 * routing.rs WINTUN_SHA256 — the two channels agree bit-for-bit).
 *
 * Contract (approved decision D1/D3, frozen):
 *   - wintun.dll 0.14.1 amd64 is the ONLY new distribution file of the
 *     whole TUN effort; the official zip itself is NEVER shipped — the
 *     extracted dll is placed by scripts/fetch-wintun.ps1 (Windows) /
 *     fetch-wintun.sh (sandbox/CI) and each script refuses ANY hash
 *     mismatch at fetch time.
 *   - sing-box 1.14.0 loads the dll at TUN inbound runtime; the file is
 *     never renamed, patched or re-signed by MEMENTO.
 *   - B1's routing session MUST re-verify WINTUN_DLL_SHA256 before the
 *     first spawn (spawn-integrity gate, C6-style) and B1 must also gate
 *     the Authenticode publisher (WINTUN_PUBLISHER) on Windows — the
 *     in-sandbox proof covers the hash + the embedded signature blob;
 *     the chain-to-"WireGuard LLC" validation is a real-Windows check
 *     (Get-AuthenticodeSignature, TESTING-CHECKLIST section 28).
 *   - Any version bump means: re-fetch from the official page, re-verify
 *     the publisher, update THIS file + resources/wintun/README.md +
 *     electron/core-versions.json in the SAME reviewed commit (the
 *     reference's build-time-fail lesson).
 *
 * License: the dll is NOT open-source — it carries WireGuard LLC's
 * bespoke "Prebuilt Binaries License" (clause 3(c): proprietary notices
 * must stay; clause 3(d): redistribution permitted alongside software
 * that uses it only via the wintun.h Permitted API — MEMENTO uses the
 * dll through sing-box's TUN inbound, unmodified). The verbatim text is
 * committed at resources/wintun/wintun-LICENSE.txt and MUST keep riding
 * the distribution. See NOTICE.md.
 */

export const WINTUN_VERSION = "0.14.1";
export const WINTUN_OFFICIAL_URL = "https://www.wintun.net/";
export const WINTUN_ZIP_URL = "https://www.wintun.net/builds/wintun-0.14.1.zip";
export const WINTUN_ZIP_SHA256 =
  "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51";
/** amd64 release dll — the only architecture MEMENTO ships (win32-x64). */
export const WINTUN_DLL_SHA256 =
  "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce";
/** Authenticode signer the dll MUST carry (verified on real Windows). */
export const WINTUN_PUBLISHER = "WireGuard LLC";
/** Path INSIDE resources/wintun/ where the verified dll must sit. */
export const WINTUN_DLL_RELATIVE_PATH = "wintun/bin/amd64/wintun.dll";
/** Date of the live official-source verification recorded in the README. */
export const WINTUN_VERIFIED_AT = "2026-09-20";
