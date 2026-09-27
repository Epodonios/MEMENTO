/**
 * builderOptions.ts (Phase D2, item 9 — Builder toggles)
 *
 * The config generators (v2rayConfig.ts / singBoxConfig.ts) used to hardcode
 * every "builder" knob: sniffing on, BitTorrent blocked, loopback-only listen,
 * TLS allowInsecure=true, no mux, loglevel warning. This module owns the
 * user-toggles for exactly those knobs.
 *
 * HARD RULE: every default below reproduces the PREVIOUS hardcoded behavior
 * byte-for-byte, so an untouched install generates the exact same JSON as
 * before this feature existed. Nothing changes unless the user flips a switch.
 *
 * Lives as a STANDALONE module (no store import) so the config generators —
 * which are also bundled standalone by the smoke/quickcheck esbuild harnesses
 * (scripts/task13-cfgentry.ts, taskD2-cfgentry.ts) — can import it without
 * dragging zustand/localStorage into those bundles.
 */

export type BuilderLogLevel = "debug" | "info" | "warning" | "error";

/** Phase C1 (item 4): Xray TLS-fragment dialer tag. The fragment lives on a
 *  dedicated freedom outbound; the proxy outbound dials through it via
 *  streamSettings.sockopt.dialerProxy. Source-verified (Xray v25.1.1):
 *  proxy/freedom/freedom.go L194-197 wraps the TCP writer in FragmentWriter
 *  ONLY for a freedom outbound whose settings carry `fragment` — the
 *  streamSettings-level field the older docs mention is silently ignored by
 *  this version (probed live: whole ClientHello arrives unsplit). */
export const FRAGMENT_DIALER_TAG = "memento-frag-dialer";

/** "tlshello" (split only the TLS ClientHello) or an inclusive packet-index
 *  range "N-M" (fragment the Nth..Mth packet of the connection). */
export type FragmentPackets = string;

/** "A-B" numeric range (bytes or milliseconds, per field). */
export type FragmentRange = string;

/** Phase C1: range validation shared by the generator and the Settings UI.
 *  Bad input => null => the generator emits NO fragment (feature honestly
 *  off) instead of feeding the core a config it would mis-parse.
 *  Overloads: "tlshello" is only a possible result when the caller opts in,
 *  so length/interval call sites keep the plain {from,to} shape. */
export function parseFragmentRange(value: string): { from: number; to: number } | null;
export function parseFragmentRange(value: string, allowTlsHello: true): { from: number; to: number } | "tlshello" | null;
export function parseFragmentRange(value: string, allowTlsHello = false): { from: number; to: number } | "tlshello" | null {
  const v = String(value || "").trim();
  if (allowTlsHello && v === "tlshello") return "tlshello";
  const m = /^(\d+)-(\d+)$/.exec(v);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || from < 0 || to > 65535) return null;
  return { from, to };
}

export interface BuilderOptions {
  /** Xray inbound sniffing { enabled, destOverride:["http","tls"] } (was: always true). */
  sniffing: boolean;
  /** Routing rule protocol:["bittorrent"] -> "blocked" (was: always present). */
  blockBittorrent: boolean;
  /** Inbound listen address: false = 127.0.0.1 (old), true = 0.0.0.0 (LAN share). */
  allowLan: boolean;
  /** mux.cool on vmess/vless/trojan outbounds, concurrency 8 (was: absent). Auto-skipped for XTLS flows. */
  muxEnabled: boolean;
  /** tlsSettings.allowInsecure on vmess/vless/trojan (was: always true). Reality unaffected. */
  skipCertVerify: boolean;
  /** Xray log.loglevel / sing-box log.level (mapped) — was "warning"/"warn". */
  logLevel: BuilderLogLevel;
  /** Phase C1 (item 4): TLS ClientHello fragmentation for Xray TLS configs
   *  (the Iran anti-DPI knob). Default OFF = byte-identical old output.
   *  Applied ONLY to vmess/vless/trojan outbounds whose security is tls or
   *  reality; ss/socks and all sing-box (hysteria2/tuic, QUIC-based) paths
   *  have no ClientHello to split and are honestly skipped. */
  tlsFragment: boolean;
  /** Fragment packet selector: "tlshello" or packet-index range "N-M". */
  tlsFragmentPackets: FragmentPackets;
  /** Fragment size range in bytes, "A-B" (Xray FragmentWriter chunk cap). */
  tlsFragmentLength: FragmentRange;
  /** Delay between fragments in milliseconds, "A-B". */
  tlsFragmentInterval: FragmentRange;
}

export const DEFAULT_BUILDER_OPTIONS: BuilderOptions = {
  sniffing: true,          // old: sniffing { enabled: true, destOverride ["http","tls"] }
  blockBittorrent: true,   // old: bittorrent -> blocked rule always emitted
  allowLan: false,         // old: listen "127.0.0.1"
  muxEnabled: false,       // old: no mux object emitted
  skipCertVerify: true,    // old: allowInsecure: true
  logLevel: "warning",     // old: loglevel "warning"
  tlsFragment: false,                  // old: no fragment dialer outbound, no sockopt
  tlsFragmentPackets: "tlshello",      // classic Iran recipe: split only the ClientHello
  tlsFragmentLength: "100-200",        // fragment size bytes (v2rayNG-style default)
  tlsFragmentInterval: "10-20",        // ms between fragments
};

/** localStorage blob key — same persistence pattern as memento-auto-failover. */
export const BUILDER_OPTIONS_STORAGE_KEY = "memento-builder-options";

/** Merge saved (possibly older/partial) JSON over the defaults, forward-compat. */
export function loadBuilderOptions(): BuilderOptions {
  try {
    const saved = localStorage.getItem(BUILDER_OPTIONS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_BUILDER_OPTIONS, ...parsed };
    }
  } catch { /* storage unavailable (private mode/quota) — fall through */ }
  return { ...DEFAULT_BUILDER_OPTIONS };
}

/** sing-box uses "warn" where Xray says "warning" — same scale otherwise. */
export function singBoxLogLevel(level: BuilderLogLevel): string {
  return level === "warning" ? "warn" : level;
}
