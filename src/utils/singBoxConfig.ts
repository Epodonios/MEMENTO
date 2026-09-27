/**
 * singBoxConfig.ts (Task 11; extended by Task E2)
 *
 * Generates real sing-box compatible JSON configs from ParsedConfig objects
 * for the protocols Xray-core never supported natively: hysteria2 and tuic
 * (Task 11) plus the MEMENTO ShadowTLS pair (Task E2 — a shadowtls TRANSPORT
 * paired with a trojan inner protocol over the memento-stls:// scheme;
 * Xray 25.1.1 has no ShadowTLS at all, live-probed 2026-09-21). Everything
 * else keeps using v2rayConfig.ts unchanged.
 *
 * Shape contract (validated against the REAL sing-box v1.14.0 binary with
 * `sing-box check` — see scripts/task11-validate/):
 *   - two local inbounds on the SAME ports Xray uses (socks + http), so the
 *     system proxy, the F9 startup audit and user-configured ports behave
 *     identically no matter which core is live;
 *   - ONE outbound tagged "proxy" + route.final — mirrors the Xray
 *     generator's outbound tag so the traffic semantics stay familiar;
 *   - log level "warn" (sing-box writes its own timestamps);
 *   - experimental.clash_api on the SAME api port Xray uses for its Stats
 *     API, with a fresh 256-bit secret per build — the endpoint answers
 *     401 without the secret, so no unauthenticated local endpoint is left
 *     open. clash_api is the ONLY experimental API we enable (enabling
 *     v2ray_api alongside it is forbidden — upstream issue #2742);
 *   - NO unknown root fields: sing-box STRICTLY rejects them (the "core"
 *     marker lives in the memento-active-core.json sidecar instead);
 *   - TLS is always enabled on the outbound (both protocols are QUIC-based
 *     and require it); `insecure` is emitted ONLY from the link's flag.
 */

import type { ParsedConfig } from "../store";
import { type BuilderOptions, DEFAULT_BUILDER_OPTIONS, singBoxLogLevel } from "./builderOptions";
import { type RoutingOptions, DEFAULT_ROUTING_OPTIONS, buildSingBoxRouting } from "./routingOptions";
import {
  type TopologyInput, DEFAULT_TOPOLOGY_INPUT,
  CHAIN_HOP_TAG, BALANCER_TAG, MAX_BALANCER_EXTRAS,
  balancerMemberTags,
} from "./topologyOptions";

export interface SingBoxFullConfig {
  /** The raw JSON string to feed to `sing-box run -c <file>` */
  json: string;
  /** SOCKS port (same value the Xray generator would use) */
  socksPort: number;
  /** HTTP port */
  httpPort: number;
}

/** Fresh 256-bit hex secret for the clash_api (per config build). */
function freshClashSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shared URL for the urltest balancer group — identical to the C2 URL-test
 *  probe destination (one honest "is this server alive" answer everywhere). */
const BALANCER_URLTEST_URL = "https://www.gstatic.com/generate_204";

export function generateSingBoxConfig(
  config: ParsedConfig,
  localSocksPort = 10808,
  localHttpPort = 10809,
  /** Local port for the clash_api external_controller (traffic stats). */
  statsApiPort?: number,
  /** Phase D2 (item 9): only TWO builder toggles apply to the sing-box path
   *  (allowLan listen address + log level) — this generator exclusively serves
   *  the sing-box-only protocols (the QUIC-based hysteria2/tuic pair and the
   *  TCP-based Task-E2 shadowtls pair), where Xray-style sniffing/bittorrent
   *  routing/mux.cool do not exist, and `insecure` stays driven by the LINK's
   *  own flag (documented contract). Defaults keep the old output identical. */
  builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS,
  /** Phase C3 (items 1+2): routing presets/lists + DNS/FakeDNS. DEFAULT
   *  reproduces the legacy "route: { final: \"proxy\" }" output byte-for-byte
   *  (no dns object, no extra outbounds). Geo references become LOCAL .srs
   *  rule_set files under `srsDir` (main-process geo_ensure owns that
   *  directory; the connect flow gates on it BEFORE any spawn). */
  routingOptions: RoutingOptions = DEFAULT_ROUTING_OPTIONS,
  /** Absolute dir holding the downloaded .srs rule-set files ("" = none). */
  srsDir: string = "",
  /** Phase C4 (item ⑥): chain proxy + balancer. DEFAULT reproduces the
   *  pre-C4 output byte-for-byte. The connect flow resolves + validates
   *  the hop/extras against the live config list — on the sing-box path
   *  BOTH must be sing-box protocols (a wrong-core hop would be fatal at
   *  startup: probed `dependency not found`), with ONE Task-E2 exception:
   *  a shadowtls config is REFUSED in topology positions (buildSbOutbound
   *  returns null for it there and connectionActions toasts honestly) —
   *  the pair would silently lose its transport outbound. This generator
   *  defensively treats an absent/unbuildable hop or empty extras as
   *  feature-off. */
  topology: TopologyInput = DEFAULT_TOPOLOGY_INPUT,
): SingBoxFullConfig | null {
  if (!config.isValid) return null;

  // Task E2: allowStlsPair=true ONLY for the main connection — the ShadowTLS
  // pair (trojan primary + stls transport) is emitted as TWO outbounds and
  // topology positions (hop/pool members) would silently lose the transport.
  const outbound = buildSbOutbound(config, true);
  if (!outbound) return null;
  const stlsTransport = config.protocol === "shadowtls" ? buildSbStlsTransport(config) : null;

  /* ---------------- Phase C4 (item ⑥): chain + balancer ----------------
   * Shapes probed against the REAL pinned 1.14.0 binary
   * (scripts/taskC4-probe.mjs):
   *   - chain: outbound.detour -> CHAIN_HOP_TAG (sing-box's dialerProxy
   *     equivalent — the main server is dialed THROUGH the hop tunnel).
   *   - balancer: a urltest GROUP outbound tagged "balancer" whose members
   *     are the pooled family tags, and route.final -> "balancer". Group
   *     members are resolved at START (check passes even with a missing
   *     member but `run` FATALs: dependency not found) — the connect flow's
   *     validation is load-bearing, exactly like the C3 geo gate.
   *   - chain + balancer combine: every member dials through the same hop.
   * Traffic contract: clash_api /connections reports CUMULATIVE totals
   * across all outbounds (singbox.ts), so sing-box needs NO per-tag stats
   * extension — the balancer cannot zero the speed/total displays there. */
  const hopConfig = config.protocol === "shadowtls"
    ? null // E2: a shadowtls MAIN is plain-only — a hop would overwrite the
           // pair's detour (trojan -> stls-t) and orphan the transport.
    : (topology.chainHop || null);
  const extras = config.protocol === "shadowtls"
    ? [] // E2: same for balancer members (feature-off, honest gate upstream).
    : (topology.balancerExtras || []).slice(0, MAX_BALANCER_EXTRAS);
  // TopologyInput intent is PRESENCE (same contract as the Xray generator):
  // resolved extras = balancer wanted, a resolved hop = chain wanted.
  const balancerActive = extras.length > 0;

  let hopOutbound: Record<string, unknown> | null = null;
  if (hopConfig) {
    const built = buildSbOutbound(hopConfig, false); // E2: no shadowtls pair in topology
    if (built) {
      built.tag = CHAIN_HOP_TAG;
      outbound.detour = CHAIN_HOP_TAG;
      hopOutbound = built;
    }
  }

  const memberTags = balancerMemberTags(extras.length);
  const extraOutbounds = extras.map((extra, i) => {
    const built = buildSbOutbound(extra, false); // E2: no shadowtls pair in topology
    if (!built) return null;
    built.tag = memberTags[i + 1];
    if (hopOutbound) built.detour = CHAIN_HOP_TAG;
    return built;
  }).filter((o): o is Record<string, unknown> => o !== null);

  const balancerGroup = balancerActive
    ? [{
        type: "urltest",
        tag: BALANCER_TAG,
        outbounds: memberTags,
        url: BALANCER_URLTEST_URL,
        interval: "3m",
      }]
    : [];

  const listen = builderOptions.allowLan ? "0.0.0.0" : "127.0.0.1";
  const inbounds: Record<string, unknown>[] = [
    {
      type: "socks",
      tag: "socks-in",
      listen,
      listen_port: localSocksPort,
    },
    {
      type: "http",
      tag: "http-in",
      listen,
      listen_port: localHttpPort,
    },
  ];

  /* ---------------- Phase C3 (items 1+2): routing + DNS/FakeDNS --------
   * The route build may add direct/blocked outbounds, local rule_sets and
   * a dns object; with DEFAULT routingOptions the output is byte-identical
   * to the pre-C3 config (verified by the fntest golden snapshot). */
  const sbRouting = buildSingBoxRouting(routingOptions, [], srsDir);
  // Phase C4: with a balancer pool the DEFAULT route enters the group
  // instead of the primary tunnel; explicit C3 rules (direct/blocked/proxy
  // lists) keep their outbound tags — "proxy" still exists as member #1.
  if (balancerActive) sbRouting.route.final = BALANCER_TAG;

  const fullConfig: Record<string, unknown> = {
    log: { level: singBoxLogLevel(builderOptions.logLevel) },
    inbounds,
    outbounds: [
      outbound,
      ...(stlsTransport ? [stlsTransport] : []), // Task E2: the paired transport
      ...extraOutbounds,
      ...(hopOutbound ? [hopOutbound] : []),
      ...sbRouting.extraOutbounds,
      ...balancerGroup,
    ],
    route: sbRouting.route,
  };
  if (sbRouting.dns) fullConfig.dns = sbRouting.dns;

  if (statsApiPort) {
    fullConfig.experimental = {
      clash_api: {
        external_controller: `127.0.0.1:${statsApiPort}`,
        secret: freshClashSecret(),
      },
    };
  }

  return {
    json: JSON.stringify(fullConfig, null, 2),
    socksPort: localSocksPort,
    httpPort: localHttpPort,
  };
}

/* ------------------------------------------------------------------ */
/*  Outbound builders (hysteria2 / tuic / Task-E2 shadowtls — the ONLY  */
/*  sing-box protocols MEMENTO generates; shared by the main, chain-hop */
/*  and pool members)                                                   */
/* ------------------------------------------------------------------ */

/** Task E2: tag of the paired ShadowTLS TRANSPORT outbound (the trojan
 *  primary dials THROUGH it via detour; shape live-proven end-to-end —
 *  probe P4 carried real loopback traffic 200:14336 with exactly this
 *  pair on the pinned 1.14.0 binary). */
const STLS_TRANSPORT_TAG = "stls-t";

function buildSbOutbound(
  config: ParsedConfig,
  /** Task E2: true ONLY for the main connection. A shadowtls config in a
   *  topology position (chain hop / balancer member) returns null here so
   *  it degrades to feature-off instead of silently losing its transport
   *  outbound; the connect flow rejects it with an honest toast BEFORE the
   *  generator is even reached (connectionActions E2 gate). */
  allowStlsPair = false,
): Record<string, unknown> | null {
  if (config.protocol === "shadowtls") {
    if (!allowStlsPair) return null; // E2 v1 scope: main connection only
    // The INNER protocol is trojan (the scheme's userinfo credential);
    // it dials THROUGH the ShadowTLS transport, so it needs NO tls block
    // of its own — the transport provides the TLS camouflage (probe P4
    // ran exactly this pair against the pinned binary).
    return {
      type: "trojan",
      tag: "proxy",
      server: config.address,
      server_port: Number(config.port) || 443,
      password: config.password || "",
      detour: STLS_TRANSPORT_TAG,
    };
  }
  if (config.protocol === "hysteria2") {
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: config.sni || config.address,
    };
    if (config.insecure) tls.insecure = true;
    if (config.alpn) tls.alpn = config.alpn.split(",").map((s) => s.trim()).filter(Boolean);

    return {
      type: "hysteria2",
      tag: "proxy",
      server: config.address,
      server_port: Number(config.port) || 443,
      password: config.password || "",
      ...(config.obfs === "salamander" && config.obfsPassword
        ? { obfs: { type: "salamander", password: config.obfsPassword } }
        : {}),
      tls,
    };
  }
  if (config.protocol === "tuic") {
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: config.sni || config.address,
    };
    if (config.insecure) tls.insecure = true;
    if (config.alpn) tls.alpn = config.alpn.split(",").map((s) => s.trim()).filter(Boolean);

    return {
      type: "tuic",
      tag: "proxy",
      server: config.address,
      server_port: Number(config.port) || 443,
      uuid: config.uuid || "",
      password: config.password || "",
      congestion_control: config.type && config.type !== "tuic" ? config.type : "cubic",
      ...(config.udpRelayMode ? { udp_relay_mode: config.udpRelayMode } : {}),
      tls,
    };
  }
  // Not a sing-box protocol — the caller must use the Xray generator.
  return null;
}

/**
 * Task E2: the ShadowTLS TRANSPORT outbound paired with the trojan primary
 * (tag STLS_TRANSPORT_TAG). Schema contract from the live probe (P1): the
 * TLS block is REQUIRED for every version (1/2/3), versions outside 1..3
 * are FATAL, and the schema strictly rejects unknown fields — so only
 * known fields are ever emitted. `password` is omitted for a passwordless
 * v1 link (the server-side counterpart is users[]; probe P3). `insecure`
 * is emitted ONLY from the link's own flag (the L24 contract above).
 */
function buildSbStlsTransport(config: ParsedConfig): Record<string, unknown> {
  const tls: Record<string, unknown> = {
    enabled: true,
    server_name: config.sni || config.address,
  };
  if (config.insecure) tls.insecure = true;
  if (config.alpn) tls.alpn = config.alpn.split(",").map((s) => s.trim()).filter(Boolean);

  return {
    type: "shadowtls",
    tag: STLS_TRANSPORT_TAG,
    server: config.address,
    server_port: Number(config.port) || 443,
    version: Number(config.stlsVersion) || 3,
    ...(config.stlsPassword ? { password: config.stlsPassword } : {}),
    tls,
  };
}
