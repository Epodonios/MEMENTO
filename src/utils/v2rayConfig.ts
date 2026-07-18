/**
 * v2rayConfig.ts
 *
 * Generates real v2ray-core / xray-core compatible JSON configs
 * from our ParsedConfig objects.  These are fed directly into
 * `xray run -c <file>` when MEMENTO runs inside Tauri.
 */

import type { ParsedConfig } from "../store";

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
): V2RayFullConfig | null {
  if (!config.isValid) return null;

  const outbound = buildOutbound(config);
  if (!outbound) return null;

  const inbounds = buildInbounds(inboundMode, localSocksPort, localHttpPort);

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
      loglevel: "warning",
    },
    dns: {
      servers: [
        "8.8.8.8",
        "1.1.1.1",
        "localhost",
      ],
    },
    inbounds,
    outbounds: [
      outbound,
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "blocked" },
    ],
    // IMPORTANT: Do NOT reference "geosite:" or "geoip:" categories here.
    // Those require geosite.dat/geoip.dat asset files to be present next
    // to xray-core. If they're missing (e.g. a portable xray.exe that was
    // manually placed by the user, or a fresh auto-download that only
    // grabbed the binary), xray-core throws a fatal startup error and
    // exits ~1-2 seconds after launching — which used to show up in the
    // UI as "Connected" flipping back to "Disconnected" a couple of
    // seconds later with no explanation. Protocol-based rules below don't
    // need any external data files, so they're always safe.
    routing: {
      domainStrategy: "AsIs",
      rules: [
        ...(statsApiPort ? [{
          type: "field",
          inboundTag: ["api"],
          outboundTag: "api",
        }] : []),
        {
          type: "field",
          outboundTag: "blocked",
          protocol: ["bittorrent"],
        },
      ],
    },
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

function buildInbounds(mode: InboundMode, socksPort: number, httpPort: number): Record<string, unknown>[] {
  const inbounds: Record<string, unknown>[] = [];

  if (mode === "socks-http" || mode === "socks-only") {
    inbounds.push({
      tag: "socks-in",
      port: socksPort,
      listen: "127.0.0.1",
      protocol: "socks",
      sniffing: { enabled: true, destOverride: ["http", "tls"] },
      settings: { auth: "noauth", udp: true },
    });
  }

  if (mode === "socks-http" || mode === "http-only") {
    inbounds.push({
      tag: "http-in",
      port: httpPort,
      listen: "127.0.0.1",
      protocol: "http",
      sniffing: { enabled: true, destOverride: ["http", "tls"] },
      settings: { auth: "noauth" },
    });
  }

  return inbounds;
}

/* ------------------------------------------------------------------ */
/*  Outbound builders (one per protocol)                              */
/* ------------------------------------------------------------------ */

function buildOutbound(config: ParsedConfig): Record<string, unknown> | null {
  switch (config.protocol) {
    case "vmess":   return buildVmessOutbound(config);
    case "vless":   return buildVlessOutbound(config);
    case "trojan":  return buildTrojanOutbound(config);
    case "ss":      return buildSSOutbound(config);
    default:        return null;
  }
}

/* ---------- VMess ---------- */

function buildVmessOutbound(c: ParsedConfig): Record<string, unknown> {
  const net = (c.network || "tcp").toLowerCase();
  const tls = c.security === "tls";

  const streamSettings: Record<string, unknown> = {
    network: net,
    security: tls ? "tls" : "none",
  };

  if (tls) {
    streamSettings.tlsSettings = {
      serverName: c.sni || c.address,
      allowInsecure: true,
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

  return {
    tag: "proxy",
    protocol: "vmess",
    settings: {
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

function buildVlessOutbound(c: ParsedConfig): Record<string, unknown> {
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
      allowInsecure: true,
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

  return {
    tag: "proxy",
    protocol: "vless",
    settings: {
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

function buildTrojanOutbound(c: ParsedConfig): Record<string, unknown> {
  const net = (c.network || "tcp").toLowerCase();

  const streamSettings: Record<string, unknown> = {
    network: net,
    security: "tls",
    tlsSettings: {
      serverName: c.sni || c.address,
      allowInsecure: true,
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

  return {
    tag: "proxy",
    protocol: "trojan",
    settings: {
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
