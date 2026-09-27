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

// ../scripts/task13-cfgentry.ts
var task13_cfgentry_exports = {};
__export(task13_cfgentry_exports, {
  generateV2RayConfig: () => generateV2RayConfig
});
module.exports = __toCommonJS(task13_cfgentry_exports);

// src/utils/v2rayConfig.ts
function generateV2RayConfig(config, inboundMode = "socks-http", localSocksPort = 10808, localHttpPort = 10809, statsApiPort) {
  if (!config.isValid) return null;
  const outbound = buildOutbound(config);
  if (!outbound) return null;
  const inbounds = buildInbounds(inboundMode, localSocksPort, localHttpPort);
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
      loglevel: "warning"
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
        {
          type: "field",
          outboundTag: "blocked",
          protocol: ["bittorrent"]
        }
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
function buildInbounds(mode, socksPort, httpPort) {
  const inbounds = [];
  if (mode === "socks-http" || mode === "socks-only") {
    inbounds.push({
      tag: "socks-in",
      port: socksPort,
      listen: "127.0.0.1",
      protocol: "socks",
      sniffing: { enabled: true, destOverride: ["http", "tls"] },
      settings: { auth: "noauth", udp: true }
    });
  }
  if (mode === "socks-http" || mode === "http-only") {
    inbounds.push({
      tag: "http-in",
      port: httpPort,
      listen: "127.0.0.1",
      protocol: "http",
      sniffing: { enabled: true, destOverride: ["http", "tls"] },
      settings: { auth: "noauth" }
    });
  }
  return inbounds;
}
function buildOutbound(config) {
  switch (config.protocol) {
    case "vmess":
      return buildVmessOutbound(config);
    case "vless":
      return buildVlessOutbound(config);
    case "trojan":
      return buildTrojanOutbound(config);
    case "ss":
      return buildSSOutbound(config);
    case "socks":
      return buildSocksOutbound(config);
    default:
      return null;
  }
}
function buildVmessOutbound(c) {
  const net = (c.network || "tcp").toLowerCase();
  const tls = c.security === "tls";
  const streamSettings = {
    network: net,
    security: tls ? "tls" : "none"
  };
  if (tls) {
    streamSettings.tlsSettings = {
      serverName: c.sni || c.address,
      allowInsecure: true,
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
function buildVlessOutbound(c) {
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
      allowInsecure: true,
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
              encryption: c.encryption || "none"
            }
          ]
        }
      ]
    },
    streamSettings
  };
}
function buildTrojanOutbound(c) {
  const net = (c.network || "tcp").toLowerCase();
  const streamSettings = {
    network: net,
    security: "tls",
    tlsSettings: {
      serverName: c.sni || c.address,
      allowInsecure: true,
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
  return {
    tag: "proxy",
    protocol: "trojan",
    settings: {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  generateV2RayConfig
});
