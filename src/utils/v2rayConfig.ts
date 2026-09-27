/**
 * v2rayConfig.ts
 *
 * Generates real v2ray-core / xray-core compatible JSON configs
 * from our ParsedConfig objects.  These are fed directly into
 * `xray run -c <file>` when MEMENTO runs inside Tauri.
 */

import type { ParsedConfig } from "../store";
import {
  type BuilderOptions, DEFAULT_BUILDER_OPTIONS,
  FRAGMENT_DIALER_TAG, parseFragmentRange,
} from "./builderOptions";
import {
  type RoutingOptions, DEFAULT_ROUTING_OPTIONS,
  buildXrayRouting,
} from "./routingOptions";
import {
  type TopologyInput, DEFAULT_TOPOLOGY_INPUT,
  CHAIN_HOP_TAG, BALANCER_TAG, MAX_BALANCER_EXTRAS,
  balancerMemberTags,
} from "./topologyOptions";

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export type InboundMode =
  | "socks-http"   // SOCKS5 :10808 + HTTP :10809
  | "socks-only"   // SOCKS5 :10808
  | "http-only"    // HTTP  :10809
  | "tun";         // Requires tun2socks (future)

export interface V2RayFullConfig {
  /** The raw JSON string to feed to xray-core */
  json: string;
  /** SOCKS port */
  socksPort: number;
  /** HTTP port */
  httpPort: number;
}

export function generateV2RayConfig(
  config: ParsedConfig,
  inboundMode: InboundMode = "socks-http",
  localSocksPort = 10808,
  localHttpPort = 10809,
  /**
   * Optional local port for xray-core's built-in Stats API. When provided,
   * MEMENTO can query real upload/download traffic via
   * `xray api statsquery -s 127.0.0.1:<apiPort>` (the same mechanism
   * v2rayN and other GUI clients use) instead of showing a static 0 MB.
   */
  statsApiPort?: number,
  /** Phase D2 (item 9): builder toggles. DEFAULT reproduces the previous
   *  hardcoded behavior byte-for-byte, so every existing caller (and the
   *  task13 smoke bundles that call with 4 args) stays identical. */
  builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS,
  /** Phase C3 (items 1+2): routing presets/lists + DNS/FakeDNS. DEFAULT
   *  reproduces the legacy dns/routing blocks byte-for-byte (see
   *  routingOptions.ts — the task13 smoke bundles calling with 4-6 args
   *  stay identical). Non-default options may reference geo data; the
   *  CONNECT FLOW owns the geo_ensure gate BEFORE any core spawn (missing
   *  geo files are fatal at xray startup). */
  routingOptions: RoutingOptions = DEFAULT_ROUTING_OPTIONS,
  /** Phase C4 (item ⑥): chain proxy + balancer. DEFAULT (no hop, no
   *  extras) reproduces the pre-C4 output byte-for-byte. The connect flow
   *  resolves + validates the hop/extras AGAINST the live config list
   *  (existence, valid flag, core compatibility, self-chain guard) and
   *  passes the RESOLVED ParsedConfigs here — this generator stays pure
   *  and defensively treats an absent hop / empty extras as feature-off. */
  topology: TopologyInput = DEFAULT_TOPOLOGY_INPUT,
): V2RayFullConfig | null {
  if (!config.isValid) return null;

  const outbound = buildOutbound(config, builderOptions);
  if (!outbound) return null;

  /* ---------------- Phase C1 (item 4): TLS fragment dialer ----------------
   * Source-verified against Xray v25.1.1 (proxy/freedom/freedom.go):
   *   L194-197 — the FragmentWriter (TCP ClientHello splitting) is applied
   *   ONLY when a FREEDOM outbound's settings carry `fragment`; the proxy
   *   outbound reaches it through streamSettings.sockopt.dialerProxy, which
   *   makes the freedom outbound the raw DIALER for the proxy connection.
   *   (The streamSettings-level `fragment` field is silently ignored by this
   *   core — probed live against the pinned binary: the ClientHello arrives
   *   as one unsplit segment, while the freedom+dialerProxy recipe splits it
   *   into real 100-200 B chunks spaced by `interval`.)
   *
   * Deliberately NOT shipped: the sibling `noises` knob. In v25.1.1 noises
   * run ONLY on the UDP branch (freedom.go L205-210 — NoisePacketWriter wraps
   * NewPacketWriter in the non-TCP arm, DNS port 53 exempted), so on our
   * topology (vless/vmess/trojan tunnels whose UDP payload rides INSIDE the
   * TCP stream, dialer dialing TCP only) it can never fire — a dead toggle.
   * Aether keeps its own independent noise knob (Aether tab).
   *
   * Guards: applied ONLY to vmess/vless/trojan outbounds with security
   * tls/reality (ss/socks have no TLS ClientHello; sing-box protocols never
   * reach this generator). Invalid range input => no fragment (off), never a
   * broken config. Default OFF reproduces the old output byte-for-byte. */
  const fragDialer = buildFragmentDialer(builderOptions);

  /* ---------------- Phase C4 (item ⑥): chain + balancer ----------------
   * Resolved/validated by the connect flow (see TopologyInput). Shapes
   * probed against the REAL pinned v25.1.1 binary (scripts/taskC4-probe.mjs):
   *   - chain: outbound.streamSettings.sockopt.dialerProxy -> CHAIN_HOP_TAG
   *     (the raw dial is made by the hop outbound); a 3-deep chain
   *     proxy -> hop -> fragment-dialer is accepted by the core.
   *   - balancer: routing.balancers [{ tag, selector:["proxy"], strategy }]
   *     + a LAST catch-all rule { network:"tcp,udp", balancerTag } so the
   *     default path (previously "first outbound wins") goes through the
   *     pool; the selector is a PREFIX match covering proxy/proxy2..proxyN
   *     while chain-hop / memento-frag-dialer / direct / blocked never match.
   *   - leastPing/leastLoad need burstObservatory (emitted at root).
   *
   * Dialer-slot priority ladder (one sockopt.dialerProxy per outbound):
   *   chain ON  -> the outbound dials through the HOP; if tlsFragment is
   *                ALSO on, the HOP itself dials through the fragment
   *                dialer (only when the hop carries tls/reality — the
   *                ClientHello being split is the hop's), giving the
   *                probe-verified 3-deep chain.
   *   chain OFF -> C1 behavior: tls/reality outbounds dial through the
   *                fragment dialer (main + every balancer member — each
   *                member makes its own direct TLS dial).
   * Stats contract: the carrier hop is NEVER a counted tag (it would
   * double-count every byte); balancer members ARE (see topologyOptions.
   * trafficTagsFor + xray.ts). */
  const hopConfig = topology.chainHop || null;
  const extras = (topology.balancerExtras || []).slice(0, MAX_BALANCER_EXTRAS);
  // TopologyInput intent is PRESENCE: resolved extras = balancer wanted, a
  // resolved hop = chain wanted (the connect flow already degraded any
  // disabled/invalid topology before calling).
  const balancerActive = extras.length > 0;

  // The carrier hop outbound — built from the hop's own ParsedConfig with
  // the SAME builder options EXCEPT mux (a muxed carrier inside a muxed
  // tunnel is pointless nesting; the carrier is a transport, not an exit).
  // Built BEFORE touching the main outbound: an unbuildable hop must
  // degrade to chain-OFF, never leave a dangling dialerProxy target.
  let hopOutbound: Record<string, unknown> | null = null;
  if (hopConfig) {
    const built = buildOutbound(hopConfig, { ...builderOptions, muxEnabled: false });
    if (built) {
      built.tag = CHAIN_HOP_TAG;
      if (fragDialer && fragmentApplies(built)) {
        (built.streamSettings as Record<string, unknown>).sockopt = {
          dialerProxy: FRAGMENT_DIALER_TAG,
        };
      }
      hopOutbound = built;
    }
  }

  const useFragment = !!fragDialer && fragmentApplies(outbound) && !hopOutbound;
  if (useFragment && fragDialer) {
    (outbound.streamSettings as Record<string, unknown>).sockopt = {
      dialerProxy: FRAGMENT_DIALER_TAG,
    };
  }
  if (hopOutbound) {
    // ss/socks mains have no streamSettings — create the generic shape
    // (probed: xray accepts streamSettings.sockopt.dialerProxy on a socks
    // outbound, which is exactly the socks->anything chain recipe).
    const ss = (outbound.streamSettings ?? (outbound.streamSettings = { network: "tcp" })) as Record<string, unknown>;
    ss.sockopt = { dialerProxy: CHAIN_HOP_TAG };
  }

  // Balancer pool extras: same protocol builders, renamed to the pooled
  // family tags ("proxy2"..) declared by balancerMemberTags — the SAME
  // helper the connect flow uses for the main-process stats tags.
  const memberTags = balancerMemberTags(extras.length);
  const extraOutbounds = extras.map((extra, i) => {
    const built = buildOutbound(extra, builderOptions);
    if (!built) return null;
    built.tag = memberTags[i + 1];
    if (hopOutbound) {
      const ss = (built.streamSettings ?? (built.streamSettings = { network: "tcp" })) as Record<string, unknown>;
      ss.sockopt = { dialerProxy: CHAIN_HOP_TAG };
    } else if (fragDialer && fragmentApplies(built)) {
      (built.streamSettings as Record<string, unknown>).sockopt = {
        dialerProxy: FRAGMENT_DIALER_TAG,
      };
    }
    return built;
  }).filter((o): o is Record<string, unknown> => o !== null);

  // The fragment-dialer outbound is emitted whenever ANY outbound actually
  // dials through it (main via the C1 slot, the hop, or a pool member) —
  // a referenced dialerProxy tag must always have its target in the config.
  const fragDialerUsed = !!fragDialer && (
    useFragment ||
    (hopOutbound as { streamSettings?: { sockopt?: { dialerProxy?: string } } } | null)?.streamSettings?.sockopt?.dialerProxy === FRAGMENT_DIALER_TAG ||
    extraOutbounds.some(o => (o.streamSettings as { sockopt?: { dialerProxy?: string } } | undefined)?.sockopt?.dialerProxy === FRAGMENT_DIALER_TAG)
  );

  /* ---------------- Phase C3 (items 1+2): routing + DNS/FakeDNS --------
   * DEFAULT (standard, no lists, dnsMode "default") emits the legacy
   * dns/routing blocks EXACTLY — verified by the fntest golden snapshot.
   * baseRules keep the always-safe rules first: the api inboundTag rule
   * must never be shadowed by a (later) blocked/direct rule. */
  const routingBaseRules: Record<string, unknown>[] = [
    ...(statsApiPort ? [{
      type: "field",
      inboundTag: ["api"],
      outboundTag: "api",
    }] : []),
    // Phase D2 (item 9): BitTorrent blocking is a builder toggle
    // (default ON = the old behavior). The rule needs no geo data files.
    ...(builderOptions.blockBittorrent ? [{
      type: "field",
      outboundTag: "blocked",
      protocol: ["bittorrent"],
    }] : []),
  ];
  const routingBuild = buildXrayRouting(routingOptions, routingBaseRules);

  // Phase C4: the balancer catch-all must be the LAST rule — every earlier
  // rule (api, bittorrent, custom/geo direct/block/proxy) keeps winning by
  // order; only the default fall-through now enters the pool. Custom-list
  // "proxy" rules stay pinned to the primary tunnel by design.
  if (balancerActive) {
    routingBuild.routing.rules.push({
      type: "field",
      network: "tcp,udp",
      balancerTag: BALANCER_TAG,
    });
    routingBuild.routing.balancers = [{
      tag: BALANCER_TAG,
      selector: ["proxy"],
      strategy: { type: topology.balancerStrategy || "random" },
    }];
  }

  const inbounds = buildInbounds(inboundMode, localSocksPort, localHttpPort, builderOptions, routingBuild.sniffingDestOverride);

  // The "api" tag must match an inbound's tag exactly — xray-core detects
  // this special tag and serves the gRPC Stats API on it instead of
  // proxying traffic through it, so no extra outbound/routing rule needed.
  if (statsApiPort) {
    inbounds.push({
      tag: "api",
      listen: "127.0.0.1",
      port: statsApiPort,
      protocol: "dokodemo-door",
      settings: { address: "127.0.0.1" },
    });
  }

  const fullConfig: Record<string, unknown> = {
    log: {
      access: "",
      error: "",
      loglevel: builderOptions.logLevel,
    },
    dns: routingBuild.dns,
    inbounds,
    outbounds: [
      outbound,
      ...(fragDialerUsed && fragDialer ? [fragDialer] : []),
      ...(hopOutbound ? [hopOutbound] : []),
      ...extraOutbounds,
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "blocked" },
    ],
    // Phase C3: geo-file rules (geosite:category-ir / geoip:ir / ads-all /
    // user lists) are emitted from routingOptions. They REQUIRE the geo
    // data files next to xray-core — the connect flow gates through the
    // main-process geo_ensure IPC before spawning (missing files used to
    // be a fatal startup exit ~1-2s after launch: the "connects then
    // disconnects" symptom class this comment used to warn about). With
    // DEFAULT routing options no geo reference is emitted at all, exactly
    // like every previous version.
    routing: routingBuild.routing,
    ...(routingBuild.fakedns ? { fakedns: routingBuild.fakedns } : {}),
    // Phase C4: leastPing/leastLoad read the burst observatory (probed:
    // accepted by the real binary WITH these strategies, and the strategies
    // are rejected without a working observatory data source).
    ...(balancerActive && (topology.balancerStrategy === "leastPing" || topology.balancerStrategy === "leastLoad")
      ? {
          burstObservatory: {
            subjectSelector: ["proxy"],
            pingConfig: {
              destination: "https://generate_204",
              connectivity: "https://www.google.com/generate_204",
              interval: "60s",
              sampling: 2,
              timeout: "5s",
            },
          },
        }
      : {}),
  };

  if (statsApiPort) {
    // Enables real traffic accounting for the "proxy" outbound (our tunnel).
    fullConfig.api = { tag: "api", services: ["StatsService"] };
    fullConfig.stats = {};
    fullConfig.policy = {
      levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
      system: {
        statsOutboundUplink: true,
        statsOutboundDownlink: true,
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
/*  Inbound builders                                                  */
/* ------------------------------------------------------------------ */

function buildInbounds(mode: InboundMode, socksPort: number, httpPort: number, builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS, sniffingDestOverride: string[] = ["http", "tls"]): Record<string, unknown>[] {
  const inbounds: Record<string, unknown>[] = [];

  // Phase D2 (item 9): allowLan=false keeps the historical loopback-only
  // binding; true rebinds BOTH inbounds to 0.0.0.0 so LAN devices can use
  // the local proxy ports (same knob v2rayN exposes as "Allow LAN").
  const listen = builderOptions.allowLan ? "0.0.0.0" : "127.0.0.1";

  if (mode === "socks-http" || mode === "socks-only") {
    inbounds.push({
      tag: "socks-in",
      port: socksPort,
      listen,
      protocol: "socks",
      sniffing: { enabled: builderOptions.sniffing, destOverride: sniffingDestOverride },
      settings: { auth: "noauth", udp: true },
    });
  }

  if (mode === "socks-http" || mode === "http-only") {
    inbounds.push({
      tag: "http-in",
      port: httpPort,
      listen,
      protocol: "http",
      sniffing: { enabled: builderOptions.sniffing, destOverride: sniffingDestOverride },
      settings: { auth: "noauth" },
    });
  }

  return inbounds;
}

/* ------------------------------------------------------------------ */
/*  Outbound builders (one per protocol)                              */
/* ------------------------------------------------------------------ */

function buildOutbound(config: ParsedConfig, builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS): Record<string, unknown> | null {
  switch (config.protocol) {
    case "vmess":   return buildVmessOutbound(config, builderOptions);
    case "vless":   return buildVlessOutbound(config, builderOptions);
    case "trojan":  return buildTrojanOutbound(config, builderOptions);
    case "ss":      return buildSSOutbound(config);
    case "socks":   return buildSocksOutbound(config);
    default:        return null;
  }
}

/* ---------- mux (Phase D2, item 9) ---------- */

/**
 * mux.cool object for the outbound settings. Offered for vmess/vless/trojan —
 * and NEVER when an XTLS flow would be emitted (mux + XTLS vision is an
 * invalid combination in xray-core: the outbound fails its first real
 * connection, exactly the "connects then dies" symptom class documented
 * below; flow is a vless-only concept, so vmess/trojan pass false).
 *
 * Why trojan is safe here (D2 review fix): in xray-core v25.1.1 the mux
 * client manager lives in the GENERIC outbound handler
 * (app/proxyman/outbound/handler.go L124-136: `Proxy: proxyHandler` is the
 * protocol-agnostic proxy.Outbound; L205-206: `h.mux.Dispatch(ctx, link)`
 * runs for EVERY link when enabled) — there is no per-protocol gate anywhere
 * in the client dispatch path, so trojan carries mux.cool exactly like
 * vmess/vless. Server-side demux is equally generic (inbound handlers detect
 * the mux.cool magic), and the toggle is opt-in with default OFF.
 * Default state = off = the old behavior (no mux object at all).
 */
function muxSettingsIfEnabled(builderOptions: BuilderOptions, flowEmitted: boolean): Record<string, unknown> | null {
  if (!builderOptions.muxEnabled || flowEmitted) return null;
  return { enabled: true, concurrency: 8 };
}

/* ---------- TLS fragment dialer (Phase C1, item 4) ---------- */

/**
 * The fragment dialer only makes sense for outbounds that actually open a
 * TCP+TLS/REALITY session to the server: vmess/vless/trojan with security
 * "tls" or "reality" (the ClientHello IS the thing being split). ss/socks
 * outbounds carry no TLS in this generator; sing-box protocols (hysteria2/
 * tuic) are QUIC-based and never reach this generator at all.
 */
function fragmentApplies(outbound: Record<string, unknown>): boolean {
  const ss = outbound.streamSettings as Record<string, unknown> | undefined;
  if (!ss) return false;
  return ss.security === "tls" || ss.security === "reality";
}

/**
 * Builds the freedom fragment-dialer outbound from user ranges, or null when
 * the feature is off / any range is invalid (invalid input = feature off —
 * never a config the core would mis-parse; the Settings UI surfaces the
 * validation error separately). Ranges are re-serialized from the validated
 * numbers so only sane "A-B"/"tlshello" strings can ever reach the JSON.
 */
function buildFragmentDialer(builderOptions: BuilderOptions): Record<string, unknown> | null {
  if (!builderOptions.tlsFragment) return null;
  const packets = parseFragmentRange(builderOptions.tlsFragmentPackets, true);
  const length = parseFragmentRange(builderOptions.tlsFragmentLength);
  const interval = parseFragmentRange(builderOptions.tlsFragmentInterval);
  if (!packets || !length || !interval) return null;
  return {
    tag: FRAGMENT_DIALER_TAG,
    protocol: "freedom",
    settings: {
      domainStrategy: "AsIs",
      fragment: {
        packets: packets === "tlshello" ? "tlshello" : `${packets.from}-${packets.to}`,
        length: `${length.from}-${length.to}`,
        interval: `${interval.from}-${interval.to}`,
      },
    },
  };
}

/* ---------- VMess ---------- */

function buildVmessOutbound(c: ParsedConfig, builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS): Record<string, unknown> {
  const net = (c.network || "tcp").toLowerCase();
  const tls = c.security === "tls";

  const streamSettings: Record<string, unknown> = {
    network: net,
    security: tls ? "tls" : "none",
  };

  if (tls) {
    streamSettings.tlsSettings = {
      serverName: c.sni || c.address,
      allowInsecure: builderOptions.skipCertVerify,
      ...(c.fingerprint ? { fingerprint: c.fingerprint } : {}),
    };
  }

  if (net === "ws") {
    streamSettings.wsSettings = {
      path: c.path || "/",
      headers: c.host ? { Host: c.host } : {},
    };
  } else if (net === "grpc") {
    streamSettings.grpcSettings = {
      serviceName: c.path || "",
    };
  } else if (net === "tcp" && c.type === "http") {
    streamSettings.tcpSettings = {
      header: {
        type: "http",
        request: {
          path: c.path ? c.path.split(",") : ["/"],
          headers: c.host
            ? { Host: c.host.split(",") }
            : {},
        },
      },
    };
  }

  const mux = muxSettingsIfEnabled(builderOptions, false); // vmess has no XTLS flow
  return {
    tag: "proxy",
    protocol: "vmess",
    settings: {
      ...(mux ? { mux } : {}),
      vnext: [
        {
          address: c.address,
          port: Number(c.port) || 443,
          users: [
            {
              id: c.uuid || "",
              alterId: Number(c.security === "auto" ? 0 : (c as any).alterId) || 0,
              security: c.encryption || "auto",
            },
          ],
        },
      ],
    },
    streamSettings,
  };
}

/* ---------- VLESS ---------- */

function buildVlessOutbound(c: ParsedConfig, builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS): Record<string, unknown> {
  const net = (c.network || "tcp").toLowerCase();
  const tls = c.security === "tls";
  const reality = c.security === "reality";

  const streamSettings: Record<string, unknown> = {
    network: net,
    security: c.security || "none",
  };

  if (tls) {
    streamSettings.tlsSettings = {
      serverName: c.sni || c.address,
      allowInsecure: builderOptions.skipCertVerify,
      ...(c.fingerprint ? { fingerprint: c.fingerprint } : {}),
      ...(c.alpn ? { alpn: c.alpn.split(",") } : {}),
    };
  } else if (reality) {
    streamSettings.realitySettings = {
      serverName: c.sni || c.address,
      fingerprint: c.fingerprint || "chrome",
      publicKey: (c as any).publicKey || "",
      shortId: (c as any).shortId || "",
      ...(c.spiderX ? { spiderX: c.spiderX } : {}),
    };
  }

  if (net === "ws") {
    streamSettings.wsSettings = {
      path: c.path || "/",
      headers: c.host ? { Host: c.host } : {},
    };
  } else if (net === "grpc") {
    streamSettings.grpcSettings = {
      serviceName: c.path || "",
    };
  } else if (net === "h2") {
    streamSettings.httpSettings = {
      path: c.path || "/",
      host: c.host ? [c.host] : [],
    };
  } else if (net === "xhttp" || net === "httpupgrade") {
    streamSettings[`${net}Settings`] = {
      path: c.path || "/",
      ...(c.host ? { host: c.host } : {}),
    };
  }

  // IMPORTANT: XTLS flow control (e.g. "xtls-rprx-vision") is ONLY valid
  // on a raw "tcp" transport with "tls" or "reality" security. Many public
  // VLESS links carry a leftover `flow` value even when combined with ws/
  // grpc/h2 transports or no TLS at all — xray-core accepts such a config
  // at *load* time (so our early crash-check doesn't catch it) but then
  // fails the very first real connection attempt and exits, which looks
  // exactly like "connects, then disconnects a couple seconds later".
  // Stripping an incompatible flow here makes the outbound actually work.
  const flowCompatible = net === "tcp" && (tls || reality);
  const safeFlow = flowCompatible ? (c.flow || "") : "";

  const mux = muxSettingsIfEnabled(builderOptions, safeFlow !== "");
  return {
    tag: "proxy",
    protocol: "vless",
    settings: {
      ...(mux ? { mux } : {}),
      vnext: [
        {
          address: c.address,
          port: Number(c.port) || 443,
          users: [
            {
              id: c.uuid || "",
              flow: safeFlow,
              encryption: c.encryption || "none",
            },
          ],
        },
      ],
    },
    streamSettings,
  };
}

/* ---------- Trojan ---------- */

function buildTrojanOutbound(c: ParsedConfig, builderOptions: BuilderOptions = DEFAULT_BUILDER_OPTIONS): Record<string, unknown> {
  const net = (c.network || "tcp").toLowerCase();

  const streamSettings: Record<string, unknown> = {
    network: net,
    security: "tls",
    tlsSettings: {
      serverName: c.sni || c.address,
      allowInsecure: builderOptions.skipCertVerify,
      ...(c.fingerprint ? { fingerprint: c.fingerprint } : {}),
      ...(c.alpn ? { alpn: c.alpn.split(",") } : {}),
    },
  };

  if (net === "ws") {
    streamSettings.wsSettings = {
      path: c.path || "/",
      headers: c.host ? { Host: c.host } : {},
    };
  } else if (net === "grpc") {
    streamSettings.grpcSettings = {
      serviceName: c.path || "",
    };
  }

  // Phase D2 review fix: mux applies to trojan too (generic outbound-handler
  // dispatch in xray-core v25.1.1 — see muxSettingsIfEnabled doc); no flow
  // guard needed since XTLS flow is a vless-only concept.
  const mux = muxSettingsIfEnabled(builderOptions, false);
  return {
    tag: "proxy",
    protocol: "trojan",
    settings: {
      ...(mux ? { mux } : {}),
      servers: [
        {
          address: c.address,
          port: Number(c.port) || 443,
          password: c.password || c.uuid || "",
        },
      ],
    },
    streamSettings,
  };
}

/* ---------- Shadowsocks ---------- */

function buildSSOutbound(c: ParsedConfig): Record<string, unknown> {
  return {
    tag: "proxy",
    protocol: "shadowsocks",
    settings: {
      servers: [
        {
          address: c.address,
          port: Number(c.port) || 443,
          method: c.method || c.encryption || "aes-256-gcm",
          password: c.password || c.uuid || "",
        },
      ],
    },
    streamSettings: {
      network: c.network || "tcp",
    },
  };
}

/* ---------- SOCKS5 (Task 13, A1) ---------- */

/**
 * Raw SOCKS5 outbound. Xray v25.1.1 schema (infra/conf/socks.go, verified):
 * the CLIENT config has ONLY { servers: [{ address, port, users? }] } — there
 * is NO udp flag on the outbound. UDP relay is native: proxy/socks/client.go
 * issues a SOCKS5 UDP ASSOCIATE automatically whenever routed traffic is UDP
 * (RequestCommandUDP -> ClientHandshake -> UDPWriter/UDPReader).
 * ("udp": true exists only on the INBOUND side — SocksServerConfig — and our
 * local socks-in inbound already sets it.) users[] is emitted ONLY when the
 * link carries credentials; no streamSettings is needed (verified -test OK).
 */
function buildSocksOutbound(c: ParsedConfig): Record<string, unknown> {
  const server: Record<string, unknown> = {
    address: c.address,
    port: Number(c.port) || 1080,
  };
  if (c.username) {
    server.users = [{ user: c.username, pass: c.password || "", level: 0 }];
  }
  return {
    tag: "proxy",
    protocol: "socks",
    settings: { servers: [server] },
  };
}
