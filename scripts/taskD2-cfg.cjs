"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// taskD2-cfgentry.ts
var taskD2_cfgentry_exports = {};
__export(taskD2_cfgentry_exports, {
  DEFAULT_BUILDER_OPTIONS: () => DEFAULT_BUILDER_OPTIONS,
  generateSingBoxConfig: () => generateSingBoxConfig,
  generateV2RayConfig: () => generateV2RayConfig,
  parseSubscriptionUserInfo: () => parseSubscriptionUserInfo,
  singBoxLogLevel: () => singBoxLogLevel
});
module.exports = __toCommonJS(taskD2_cfgentry_exports);

// ../src/utils/builderOptions.ts
var DEFAULT_BUILDER_OPTIONS = {
  sniffing: true,
  // old: sniffing { enabled: true, destOverride ["http","tls"] }
  blockBittorrent: true,
  // old: bittorrent -> blocked rule always emitted
  allowLan: false,
  // old: listen "127.0.0.1"
  muxEnabled: false,
  // old: no mux object emitted
  skipCertVerify: true,
  // old: allowInsecure: true
  logLevel: "warning"
  // old: loglevel "warning"
};
function singBoxLogLevel(level) {
  return level === "warning" ? "warn" : level;
}

// ../src/utils/v2rayConfig.ts
function generateV2RayConfig(config, inboundMode = "socks-http", localSocksPort = 10808, localHttpPort = 10809, statsApiPort, builderOptions = DEFAULT_BUILDER_OPTIONS) {
  if (!config.isValid) return null;
  const outbound = buildOutbound(config, builderOptions);
  if (!outbound) return null;
  const inbounds = buildInbounds(inboundMode, localSocksPort, localHttpPort, builderOptions);
  if (statsApiPort) {
    inbounds.push({
      tag: "api",
      listen: "127.0.0.1",
      port: statsApiPort,
      protocol: "dokodemo-door",
      settings: { address: "127.0.0.1" }
    });
  }
  const fullConfig = {
    log: {
      access: "",
      error: "",
      loglevel: builderOptions.logLevel
    },
    dns: {
      servers: [
        "8.8.8.8",
        "1.1.1.1",
        "localhost"
      ]
    },
    inbounds,
    outbounds: [
      outbound,
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "blocked" }
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
        ...statsApiPort ? [{
          type: "field",
          inboundTag: ["api"],
          outboundTag: "api"
        }] : [],
        // Phase D2 (item 9): BitTorrent blocking is now a builder toggle
        // (default ON = the old behavior). The rule needs no geo data files.
        ...builderOptions.blockBittorrent ? [{
          type: "field",
          outboundTag: "blocked",
          protocol: ["bittorrent"]
        }] : []
      ]
    }
  };
  if (statsApiPort) {
    fullConfig.api = { tag: "api", services: ["StatsService"] };
    fullConfig.stats = {};
    fullConfig.policy = {
      levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
      system: {
        statsOutboundUplink: true,
        statsOutboundDownlink: true
      }
    };
  }
  return {
    json: JSON.stringify(fullConfig, null, 2),
    socksPort: localSocksPort,
    httpPort: localHttpPort
  };
}
function buildInbounds(mode, socksPort, httpPort, builderOptions = DEFAULT_BUILDER_OPTIONS) {
  const inbounds = [];
  const listen = builderOptions.allowLan ? "0.0.0.0" : "127.0.0.1";
  if (mode === "socks-http" || mode === "socks-only") {
    inbounds.push({
      tag: "socks-in",
      port: socksPort,
      listen,
      protocol: "socks",
      sniffing: { enabled: builderOptions.sniffing, destOverride: ["http", "tls"] },
      settings: { auth: "noauth", udp: true }
    });
  }
  if (mode === "socks-http" || mode === "http-only") {
    inbounds.push({
      tag: "http-in",
      port: httpPort,
      listen,
      protocol: "http",
      sniffing: { enabled: builderOptions.sniffing, destOverride: ["http", "tls"] },
      settings: { auth: "noauth" }
    });
  }
  return inbounds;
}
function buildOutbound(config, builderOptions = DEFAULT_BUILDER_OPTIONS) {
  switch (config.protocol) {
    case "vmess":
      return buildVmessOutbound(config, builderOptions);
    case "vless":
      return buildVlessOutbound(config, builderOptions);
    case "trojan":
      return buildTrojanOutbound(config, builderOptions);
    case "ss":
      return buildSSOutbound(config);
    case "socks":
      return buildSocksOutbound(config);
    default:
      return null;
  }
}
function muxSettingsIfEnabled(builderOptions, flowEmitted) {
  if (!builderOptions.muxEnabled || flowEmitted) return null;
  return { enabled: true, concurrency: 8 };
}
function buildVmessOutbound(c, builderOptions = DEFAULT_BUILDER_OPTIONS) {
  const net = (c.network || "tcp").toLowerCase();
  const tls = c.security === "tls";
  const streamSettings = {
    network: net,
    security: tls ? "tls" : "none"
  };
  if (tls) {
    streamSettings.tlsSettings = {
      serverName: c.sni || c.address,
      allowInsecure: builderOptions.skipCertVerify,
      ...c.fingerprint ? { fingerprint: c.fingerprint } : {}
    };
  }
  if (net === "ws") {
    streamSettings.wsSettings = {
      path: c.path || "/",
      headers: c.host ? { Host: c.host } : {}
    };
  } else if (net === "grpc") {
    streamSettings.grpcSettings = {
      serviceName: c.path || ""
    };
  } else if (net === "tcp" && c.type === "http") {
    streamSettings.tcpSettings = {
      header: {
        type: "http",
        request: {
          path: c.path ? c.path.split(",") : ["/"],
          headers: c.host ? { Host: c.host.split(",") } : {}
        }
      }
    };
  }
  const mux = muxSettingsIfEnabled(builderOptions, false);
  return {
    tag: "proxy",
    protocol: "vmess",
    settings: {
      ...mux ? { mux } : {},
      vnext: [
        {
          address: c.address,
          port: Number(c.port) || 443,
          users: [
            {
              id: c.uuid || "",
              alterId: Number(c.security === "auto" ? 0 : c.alterId) || 0,
              security: c.encryption || "auto"
            }
          ]
        }
      ]
    },
    streamSettings
  };
}
function buildVlessOutbound(c, builderOptions = DEFAULT_BUILDER_OPTIONS) {
  const net = (c.network || "tcp").toLowerCase();
  const tls = c.security === "tls";
  const reality = c.security === "reality";
  const streamSettings = {
    network: net,
    security: c.security || "none"
  };
  if (tls) {
    streamSettings.tlsSettings = {
      serverName: c.sni || c.address,
      allowInsecure: builderOptions.skipCertVerify,
      ...c.fingerprint ? { fingerprint: c.fingerprint } : {},
      ...c.alpn ? { alpn: c.alpn.split(",") } : {}
    };
  } else if (reality) {
    streamSettings.realitySettings = {
      serverName: c.sni || c.address,
      fingerprint: c.fingerprint || "chrome",
      publicKey: c.publicKey || "",
      shortId: c.shortId || "",
      ...c.spiderX ? { spiderX: c.spiderX } : {}
    };
  }
  if (net === "ws") {
    streamSettings.wsSettings = {
      path: c.path || "/",
      headers: c.host ? { Host: c.host } : {}
    };
  } else if (net === "grpc") {
    streamSettings.grpcSettings = {
      serviceName: c.path || ""
    };
  } else if (net === "h2") {
    streamSettings.httpSettings = {
      path: c.path || "/",
      host: c.host ? [c.host] : []
    };
  } else if (net === "xhttp" || net === "httpupgrade") {
    streamSettings[`${net}Settings`] = {
      path: c.path || "/",
      ...c.host ? { host: c.host } : {}
    };
  }
  const flowCompatible = net === "tcp" && (tls || reality);
  const safeFlow = flowCompatible ? c.flow || "" : "";
  const mux = muxSettingsIfEnabled(builderOptions, safeFlow !== "");
  return {
    tag: "proxy",
    protocol: "vless",
    settings: {
      ...mux ? { mux } : {},
      vnext: [
        {
          address: c.address,
          port: Number(c.port) || 443,
          users: [
            {
              id: c.uuid || "",
              flow: safeFlow,
              encryption: c.encryption || "none"
            }
          ]
        }
      ]
    },
    streamSettings
  };
}
function buildTrojanOutbound(c, builderOptions = DEFAULT_BUILDER_OPTIONS) {
  const net = (c.network || "tcp").toLowerCase();
  const streamSettings = {
    network: net,
    security: "tls",
    tlsSettings: {
      serverName: c.sni || c.address,
      allowInsecure: builderOptions.skipCertVerify,
      ...c.fingerprint ? { fingerprint: c.fingerprint } : {},
      ...c.alpn ? { alpn: c.alpn.split(",") } : {}
    }
  };
  if (net === "ws") {
    streamSettings.wsSettings = {
      path: c.path || "/",
      headers: c.host ? { Host: c.host } : {}
    };
  } else if (net === "grpc") {
    streamSettings.grpcSettings = {
      serviceName: c.path || ""
    };
  }
  const mux = muxSettingsIfEnabled(builderOptions, false);
  return {
    tag: "proxy",
    protocol: "trojan",
    settings: {
      ...mux ? { mux } : {},
      servers: [
        {
          address: c.address,
          port: Number(c.port) || 443,
          password: c.password || c.uuid || ""
        }
      ]
    },
    streamSettings
  };
}
function buildSSOutbound(c) {
  return {
    tag: "proxy",
    protocol: "shadowsocks",
    settings: {
      servers: [
        {
          address: c.address,
          port: Number(c.port) || 443,
          method: c.method || c.encryption || "aes-256-gcm",
          password: c.password || c.uuid || ""
        }
      ]
    },
    streamSettings: {
      network: c.network || "tcp"
    }
  };
}
function buildSocksOutbound(c) {
  const server = {
    address: c.address,
    port: Number(c.port) || 1080
  };
  if (c.username) {
    server.users = [{ user: c.username, pass: c.password || "", level: 0 }];
  }
  return {
    tag: "proxy",
    protocol: "socks",
    settings: { servers: [server] }
  };
}

// ../src/utils/singBoxConfig.ts
function freshClashSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function generateSingBoxConfig(config, localSocksPort = 10808, localHttpPort = 10809, statsApiPort, builderOptions = DEFAULT_BUILDER_OPTIONS) {
  if (!config.isValid) return null;
  let outbound = null;
  if (config.protocol === "hysteria2") {
    const tls = {
      enabled: true,
      server_name: config.sni || config.address
    };
    if (config.insecure) tls.insecure = true;
    if (config.alpn) tls.alpn = config.alpn.split(",").map((s) => s.trim()).filter(Boolean);
    outbound = {
      type: "hysteria2",
      tag: "proxy",
      server: config.address,
      server_port: Number(config.port) || 443,
      password: config.password || "",
      ...config.obfs === "salamander" && config.obfsPassword ? { obfs: { type: "salamander", password: config.obfsPassword } } : {},
      tls
    };
  } else if (config.protocol === "tuic") {
    const tls = {
      enabled: true,
      server_name: config.sni || config.address
    };
    if (config.insecure) tls.insecure = true;
    if (config.alpn) tls.alpn = config.alpn.split(",").map((s) => s.trim()).filter(Boolean);
    outbound = {
      type: "tuic",
      tag: "proxy",
      server: config.address,
      server_port: Number(config.port) || 443,
      uuid: config.uuid || "",
      password: config.password || "",
      congestion_control: config.type && config.type !== "tuic" ? config.type : "cubic",
      ...config.udpRelayMode ? { udp_relay_mode: config.udpRelayMode } : {},
      tls
    };
  } else {
    return null;
  }
  const listen = builderOptions.allowLan ? "0.0.0.0" : "127.0.0.1";
  const inbounds = [
    {
      type: "socks",
      tag: "socks-in",
      listen,
      listen_port: localSocksPort
    },
    {
      type: "http",
      tag: "http-in",
      listen,
      listen_port: localHttpPort
    }
  ];
  const fullConfig = {
    log: { level: singBoxLogLevel(builderOptions.logLevel) },
    inbounds,
    outbounds: [outbound],
    route: { final: "proxy" }
  };
  if (statsApiPort) {
    fullConfig.experimental = {
      clash_api: {
        external_controller: `127.0.0.1:${statsApiPort}`,
        secret: freshClashSecret()
      }
    };
  }
  return {
    json: JSON.stringify(fullConfig, null, 2),
    socksPort: localSocksPort,
    httpPort: localHttpPort
  };
}

// ../src/utils/subscription.ts
function parseSubscriptionUserInfo(raw) {
  if (!raw) return null;
  const out = {};
  let sawAny = false;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = Number(part.slice(eq + 1).trim());
    if (!Number.isFinite(val) || val < 0) continue;
    if (key === "upload") {
      out.upload = val;
      sawAny = true;
    } else if (key === "download") {
      out.download = val;
      sawAny = true;
    } else if (key === "total") {
      out.total = val;
      sawAny = true;
    } else if (key === "expire") {
      out.expire = val;
      sawAny = true;
    }
  }
  return sawAny ? out : null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_BUILDER_OPTIONS,
  generateSingBoxConfig,
  generateV2RayConfig,
  parseSubscriptionUserInfo,
  singBoxLogLevel
});
