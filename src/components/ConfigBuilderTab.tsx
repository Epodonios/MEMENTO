/**
 * ConfigBuilderTab (Task H-b) — the v2rayN-style config generator.
 *
 * Lets the user BUILD a config from scratch instead of importing one:
 * protocol cards (VMess / VLESS / Trojan / Shadowsocks), a dynamic field
 * form (core credentials, transport, TLS/Reality security), a live
 * terminal-style share-link preview (plus a client-JSON view), an inline
 * QR card, and a one-click "Add to MEMENTO" that feeds the generated
 * link through the SAME addConfigs() pipeline as every other import path.
 *
 * Renderer-only: no IPC, no new dependencies. Fully bilingual (en/fa via
 * the local L() pattern) and RTL-safe. Design language matches the app's
 * dark emerald glassmorphism exactly.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import toast from "react-hot-toast";
import { makeQrDataUrl } from "../utils/qrShare";
import {
  Boxes, Fingerprint, KeyRound, EyeOff, Zap, Gauge, ArrowLeftRight, // protocol icons
  Server, Waves, Layers, Globe2, Rocket, ArrowLeftRight, // transport icons
  ShieldCheck, ScanLine, Cpu, Check, CheckCircle2,        // step icons
  Dices, Wand2, RotateCcw, Copy, Download, Zap,           // actions
  Terminal, Braces, ChevronDown, AlertTriangle, QrCode, Lock,
} from "lucide-react";

/* ================================================================ types */

type Proto = "vmess" | "vless" | "trojan" | "ss" | "hy2" | "tuic" | "socks";
type Network = "tcp" | "ws" | "grpc" | "h2" | "httpupgrade";
type StepId = "protocol" | "core" | "transport" | "security" | "review";

interface BuilderForm {
  proto: Proto;
  // core
  address: string;
  port: string;
  remarks: string;
  // vmess
  uuid: string;
  alterId: string;
  vmessSecurity: "auto" | "none" | "aes-128-gcm" | "chacha20-poly1305";
  // vless
  flow: "none" | "xtls-rprx-vision";
  // trojan / ss
  password: string;
  // ss
  method: string;
  ssPlugin: "" | "obfs-local" | "v2ray-plugin";
  ssObfsMode: "http" | "tls";
  ssPluginHost: string;
  ssPluginPath: string;
  // 3.1.8 — hysteria2 / tuic / socks (the protocol-card expansion)
  socksUsername: string;
  hy2Obfs: "" | "salamander";
  hy2ObfsPassword: string;
  tuicCongestion: "cubic" | "bbr";
  // transport
  network: Network;
  tcpHeader: "none" | "http";
  wsPath: string;
  wsHost: string;
  grpcService: string;
  grpcAuthority: string;
  h2Path: string;
  h2Host: string;
  httpupPath: string;
  httpupHost: string;
  // security
  tls: boolean;
  sni: string;
  alpn: string[];
  allowInsecure: boolean;
  fp: string;
  // reality (vless only)
  reality: boolean;
  pbk: string;
  sid: string;
  spiderX: string;
}

const freshForm = (): BuilderForm => ({
  proto: "vmess",
  address: "",
  port: "443",
  remarks: "",
  uuid: "",
  alterId: "0",
  vmessSecurity: "auto",
  flow: "none",
  password: "",
  method: "aes-256-gcm",
  ssPlugin: "",
  ssObfsMode: "http",
  ssPluginHost: "",
  ssPluginPath: "",
  socksUsername: "",
  hy2Obfs: "",
  hy2ObfsPassword: "",
  tuicCongestion: "cubic",
  network: "tcp",
  tcpHeader: "none",
  wsPath: "",
  wsHost: "",
  grpcService: "",
  grpcAuthority: "",
  h2Path: "",
  h2Host: "",
  httpupPath: "",
  httpupHost: "",
  tls: false,
  sni: "",
  alpn: [],
  allowInsecure: false,
  fp: "chrome",
  reality: false,
  pbk: "",
  sid: "",
  spiderX: "",
});

/* ============================================================ constants */

/* 3.1.8: four-language labels (the card grid mirrors the reference sheet —
 * the three new cards match the uploaded repository image exactly). */
const PROTOS: {
  id: Proto;
  scheme: string;
  icon: React.ElementType;
  en: string; fa: string; zh: string; ar: string;
  hintEn: string; hintFa: string; hintZh: string; hintAr: string;
  tile: string;
}[] = [
  {
    id: "vmess", scheme: "vmess://", icon: Boxes,
    en: "VMess", fa: "VMess", zh: "VMess", ar: "VMess",
    hintEn: "V2Ray classic — UUID + alterId, maximum compatibility",
    hintFa: "V2Ray کلاسیک — UUID و alterId، بیشترین سازگاری",
    hintZh: "V2Ray 经典 — UUID + alterId，兼容性最强",
    hintAr: "V2Ray الكلاسيكي — UUID وalterId، أوسع توافق",
    tile: "from-emerald-400 to-green-600",
  },
  {
    id: "vless", scheme: "vless://", icon: Fingerprint,
    en: "VLESS", fa: "VLESS", zh: "VLESS", ar: "VLESS",
    hintEn: "Next-gen protocol — Reality & Vision ready",
    hintFa: "نسل جدید — آماده برای Reality و Vision",
    hintZh: "次世代协议 — 支持 Reality 与 Vision",
    hintAr: "بروتوكول الجيل الجديد — جاهز لـ Reality وVision",
    tile: "from-green-400 to-teal-600",
  },
  {
    id: "trojan", scheme: "trojan://", icon: KeyRound,
    en: "Trojan", fa: "Trojan", zh: "Trojan", ar: "Trojan",
    hintEn: "Password authentication over mandatory TLS",
    hintFa: "احراز هویت با رمز عبور روی TLS همیشگی",
    hintZh: "密码认证 + 强制 TLS",
    hintAr: "مصادقة بكلمة مرور فوق TLS إلزامي",
    tile: "from-teal-400 to-emerald-600",
  },
  {
    id: "ss", scheme: "ss://", icon: EyeOff,
    en: "Shadowsocks", fa: "Shadowsocks", zh: "Shadowsocks", ar: "Shadowsocks",
    hintEn: "Shadowsocks AEAD / 2022 ciphers, optional plugin",
    hintFa: "Shadowsocks با رمزهای AEAD و 2022 و افزونه اختیاری",
    hintZh: "AEAD / 2022 加密，可选插件",
    hintAr: "تشفير AEAD / 2022 مع إضافة اختيارية",
    tile: "from-lime-400 to-emerald-600",
  },
  {
    id: "hy2", scheme: "hysteria2://", icon: Zap,
    en: "Hysteria2", fa: "Hysteria2", zh: "Hysteria2", ar: "Hysteria2",
    hintEn: "QUIC-based brute-force speed — salamander obfs, runs on sing-box",
    hintFa: "سرعت خشن روی QUIC — obfs سالامندر، اجرا روی sing-box",
    hintZh: "基于 QUIC 的暴力速度 — salamander 混淆，跑在 sing-box 上",
    hintAr: "سرعة عنيفة فوق QUIC — obfs سالامندر، يعمل على sing-box",
    tile: "from-amber-400 to-orange-600",
  },
  {
    id: "socks", scheme: "socks://", icon: ArrowLeftRight,
    en: "SOCKS5", fa: "SOCKS5", zh: "SOCKS5", ar: "SOCKS5",
    hintEn: "Classic SOCKS proxy — anonymous or user/pass auth",
    hintFa: "پروکسی کلاسیک SOCKS — ناشناس یا با نام کاربری/رمز",
    hintZh: "经典 SOCKS 代理 — 匿名或用户名/密码认证",
    hintAr: "بروكسي SOCKS الكلاسيكي — مجهول أو باسم مستخدم/كلمة مرور",
    tile: "from-yellow-400 to-amber-600",
  },
  {
    id: "tuic", scheme: "tuic://", icon: Gauge,
    en: "TUIC", fa: "TUIC", zh: "TUIC", ar: "TUIC",
    hintEn: "QUIC v5 proxy with 0-RTT — BBR congestion control, runs on sing-box",
    hintFa: "پروکسی QUIC v5 با 0-RTT — کنترل ازدحام BBR، اجرا روی sing-box",
    hintZh: "QUIC v5 代理 + 0-RTT — BBR 拥塞控制，跑在 sing-box 上",
    hintAr: "بروكسي QUIC v5 مع 0-RTT — تحكم ازدحام BBR، يعمل على sing-box",
    tile: "from-orange-400 to-red-600",
  },
];

/** 4-language pick for a PROTOS entry. */
function protoLabel(p: (typeof PROTOS)[number], language: string): string {
  return language === "fa" ? p.fa : language === "zh" ? p.zh : language === "ar" ? p.ar : p.en;
}
function protoHint(p: (typeof PROTOS)[number], language: string): string {
  return language === "fa" ? p.hintFa : language === "zh" ? p.hintZh : language === "ar" ? p.hintAr : p.hintEn;
}

const NETWORKS: { id: Network; icon: React.ElementType; en: string; fa: string }[] = [
  { id: "tcp", icon: ArrowLeftRight, en: "TCP", fa: "TCP" },
  { id: "ws", icon: Waves, en: "WebSocket", fa: "WebSocket" },
  { id: "grpc", icon: Layers, en: "gRPC", fa: "gRPC" },
  { id: "h2", icon: Globe2, en: "HTTP/2", fa: "HTTP/2" },
  { id: "httpupgrade", icon: Rocket, en: "HTTPUpgrade", fa: "HTTPUpgrade" },
];

const SS_METHODS = [
  "aes-256-gcm",
  "chacha20-ietf-poly1305",
  "aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "none",
];

const FINGERPRINTS = ["chrome", "firefox", "safari", "ios", "randomized"];
const ALPN_OPTIONS = ["h2", "http/1.1", "h3"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* =============================================================== helpers */

/** UTF-8-safe base64 (vmess payload holds Persian remarks too). */
function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** URL-safe, unpadded base64 — SIP002 userinfo alphabet. */
function b64UrlNoPad(s: string): string {
  return b64Utf8(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * JSON.stringify, then escape every non-ASCII char as \uXXXX. The emitted
 * payload is pure ASCII, so base64 round-trips byte-exact through clients
 * that decode with Latin-1-atob (MEMENTO's own parser) AND UTF-8-atob
 * (v2rayN, NekoBox, …). JSON.parse on either side restores the real chars.
 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-\uFFFF]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  try {
    crypto.getRandomValues(b);
  } catch {
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return b;
}

function genUuid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fall through to manual v4 */ }
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const PWD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_";

/** Raw-bytes base64 (NO UTF-8 re-encoding) — for binary keys like SS2022. */
function b64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function genPassword(method: string): string {
  // SIP002 2022 ciphers need a base64 key: 32 bytes for aes-256, 16 for aes-128.
  if (method.startsWith("2022-blake3-aes-256")) {
    return b64FromBytes(randomBytes(32));
  }
  if (method.startsWith("2022-blake3-aes-128")) {
    return b64FromBytes(randomBytes(16));
  }
  const bytes = randomBytes(18);
  return Array.from(bytes, (b) => PWD_ALPHABET[b % PWD_ALPHABET.length]).join("");
}

/** Bracket IPv6 literals so host:port stays parseable everywhere. */
function hostForLink(address: string): string {
  const a = address.trim();
  if (a.includes(":") && !a.startsWith("[")) return `[${a}]`;
  return a;
}

function setParam(q: URLSearchParams, key: string, val: string | undefined | null): void {
  const v = (val ?? "").trim();
  if (v) q.set(key, v);
}

/* ============================================================ generation */

interface LinkParts {
  link: string;
  json: string;
  ok: boolean;
}

function buildLink(f: BuilderForm, portNum: number, effSec: "none" | "tls" | "reality"): LinkParts {
  const address = f.address.trim();
  const host = hostForLink(address);
  const fragment = f.remarks.trim() ? `#${encodeURIComponent(f.remarks.trim())}` : "";

  const transportQs = (): [string, string][] => {
    switch (f.network) {
      case "tcp":
        return f.tcpHeader === "http" ? [["headerType", "http"]] : [];
      case "ws":
        return [["path", f.wsPath.trim() || "/"], ["host", f.wsHost.trim()]];
      case "grpc":
        return [["serviceName", f.grpcService.trim()], ["authority", f.grpcAuthority.trim()]];
      case "h2":
        return [["path", f.h2Path.trim() || "/"], ["host", f.h2Host.trim()]];
      case "httpupgrade":
        return [["path", f.httpupPath.trim() || "/"], ["host", f.httpupHost.trim()]];
    }
  };

  const applySecurityQs = (q: URLSearchParams) => {
    if (effSec === "tls") {
      q.set("security", "tls");
      setParam(q, "sni", f.sni);
      setParam(q, "fp", f.fp);
      if (f.alpn.length) q.set("alpn", f.alpn.join(","));
      if (f.allowInsecure) q.set("allowInsecure", "1");
    } else if (effSec === "reality") {
      q.set("security", "reality");
      q.set("sni", f.sni.trim());
      q.set("pbk", f.pbk.trim());
      setParam(q, "sid", f.sid);
      setParam(q, "spx", f.spiderX);
      setParam(q, "fp", f.fp);
    } else {
      q.set("security", "none");
    }
  };

  let link = "";

  if (f.proto === "vmess") {
    const hostPath = (() => {
      switch (f.network) {
        case "ws": return { host: f.wsHost.trim(), path: f.wsPath.trim() || "/" };
        case "h2": return { host: f.h2Host.trim(), path: f.h2Path.trim() || "/" };
        case "httpupgrade": return { host: f.httpupHost.trim(), path: f.httpupPath.trim() || "/" };
        case "grpc": return { host: f.grpcAuthority.trim(), path: f.grpcService.trim() };
        default: return { host: "", path: "" };
      }
    })();
    const payload = {
      v: "2",
      ps: f.remarks.trim(),
      add: address,
      port: String(portNum),
      id: f.uuid.trim(),
      aid: String(parseInt(f.alterId.trim() || "0", 10) || 0),
      scy: f.vmessSecurity,
      net: f.network,
      type: f.network === "tcp" ? f.tcpHeader : "",
      host: hostPath.host,
      path: hostPath.path,
      tls: effSec === "none" ? "" : effSec,
      sni: f.sni.trim(),
      alpn: f.alpn.join(","),
      fp: f.fp.trim(),
    };
    // Escape every non-ASCII char as \uXXXX BEFORE base64. The result is a
    // pure-ASCII JSON payload, which decodes identically in every client —
    // including parsers that read atob() as Latin-1 instead of UTF-8 (the
    // mojibake trap for Persian remarks). JSON \u escapes are 100% standard.
    link = `vmess://${b64Utf8(asciiJson(payload))}`;
  } else if (f.proto === "vless") {
    const q = new URLSearchParams();
    q.set("type", f.network);
    applySecurityQs(q);
    q.set("encryption", "none");
    if (f.flow !== "none") q.set("flow", f.flow);
    for (const [k, v] of transportQs()) setParam(q, k, v);
    link = `vless://${f.uuid.trim()}@${host}:${portNum}?${q.toString()}${fragment}`;
  } else if (f.proto === "trojan") {
    const q = new URLSearchParams();
    q.set("security", "tls"); // trojan is TLS by definition
    q.set("type", f.network);
    setParam(q, "sni", f.sni);
    setParam(q, "fp", f.fp);
    if (f.alpn.length) q.set("alpn", f.alpn.join(","));
    if (f.allowInsecure) q.set("allowInsecure", "1");
    for (const [k, v] of transportQs()) setParam(q, k, v);
    link = `trojan://${encodeURIComponent(f.password)}@${host}:${portNum}?${q.toString()}${fragment}`;
  } else if (f.proto === "hy2") {
    // Hysteria2 — hysteria2://password@host:port?sni=…&obfs=…&insecure=1#name
    const q = new URLSearchParams();
    setParam(q, "sni", f.sni);
    if (f.hy2Obfs === "salamander") {
      q.set("obfs", "salamander");
      if (f.hy2ObfsPassword.trim()) q.set("obfs-password", f.hy2ObfsPassword.trim());
    }
    if (f.alpn.length) q.set("alpn", f.alpn.join(","));
    if (f.allowInsecure) q.set("insecure", "1");
    const qs = q.toString();
    link = `hysteria2://${encodeURIComponent(f.password)}@${host}:${portNum}${qs ? `?${qs}` : ""}${fragment}`;
  } else if (f.proto === "tuic") {
    // TUIC v5 — tuic://uuid:password@host:port?congestion_control=…&sni=…#name
    const q = new URLSearchParams();
    q.set("congestion_control", f.tuicCongestion);
    q.set("alpn", "h3");
    setParam(q, "sni", f.sni);
    if (f.allowInsecure) q.set("insecure", "1");
    const qs = q.toString();
    link = `tuic://${encodeURIComponent(f.uuid.trim())}:${encodeURIComponent(f.password)}@${host}:${portNum}${qs ? `?${qs}` : ""}${fragment}`;
  } else if (f.proto === "socks") {
    // SOCKS5 — socks://[user:pass@]host:port#name (anonymous when empty)
    const creds = f.socksUsername.trim()
      ? `${encodeURIComponent(f.socksUsername.trim())}:${encodeURIComponent(f.password)}@`
      : "";
    link = `socks://${creds}${host}:${portNum}${fragment}`;
  } else {
    // Shadowsocks — SIP002: websafe-b64(method:password)@host:port?plugin=…#name
    const userinfo = b64UrlNoPad(`${f.method}:${f.password}`);
    const q = new URLSearchParams();
    if (f.ssPlugin === "obfs-local") {
      let opts = `obfs-local;obfs=${f.ssObfsMode}`;
      if (f.ssPluginHost.trim()) opts += `;obfs-host=${f.ssPluginHost.trim()}`;
      q.set("plugin", opts);
    } else if (f.ssPlugin === "v2ray-plugin") {
      let opts = "v2ray-plugin;mode=websocket";
      if (f.tls) opts += ";tls";
      if (f.ssPluginHost.trim()) opts += `;host=${f.ssPluginHost.trim()}`;
      if (f.ssPluginPath.trim()) opts += `;path=${f.ssPluginPath.trim()}`;
      q.set("plugin", opts);
    }
    const qs = q.toString();
    link = `ss://${userinfo}@${host}:${portNum}${qs ? `?${qs}` : ""}${fragment}`;
  }

  return { link, json: buildJson(f, portNum, effSec), ok: true };
}

/** Minimal v2ray-style client JSON (pretty-printed) for the preview pane. */
function buildJson(f: BuilderForm, portNum: number, effSec: "none" | "tls" | "reality"): string {
  const address = f.address.trim();

  const streamSettings: Record<string, unknown> = { network: f.network, security: effSec };

  if (effSec === "tls") {
    const tlsSettings: Record<string, unknown> = { serverName: f.sni.trim() || address };
    if (f.alpn.length) tlsSettings.alpn = f.alpn;
    if (f.fp.trim()) tlsSettings.fingerprint = f.fp.trim();
    if (f.allowInsecure) tlsSettings.allowInsecure = true;
    streamSettings.tlsSettings = tlsSettings;
  } else if (effSec === "reality") {
    streamSettings.realitySettings = {
      serverName: f.sni.trim(),
      fingerprint: f.fp.trim() || "chrome",
      publicKey: f.pbk.trim(),
      shortId: f.sid.trim() || undefined,
      spiderX: f.spiderX.trim() || undefined,
    };
  }

  switch (f.network) {
    case "ws":
      streamSettings.wsSettings = {
        path: f.wsPath.trim() || "/",
        headers: f.wsHost.trim() ? { Host: f.wsHost.trim() } : undefined,
      };
      break;
    case "grpc":
      streamSettings.grpcSettings = {
        serviceName: f.grpcService.trim(),
        authority: f.grpcAuthority.trim() || undefined,
      };
      break;
    case "h2":
      streamSettings.httpSettings = {
        path: f.h2Path.trim() || "/",
        host: f.h2Host.trim() ? [f.h2Host.trim()] : undefined,
      };
      break;
    case "httpupgrade":
      streamSettings.httpupgradeSettings = {
        path: f.httpupPath.trim() || "/",
        host: f.httpupHost.trim() || undefined,
      };
      break;
    default:
      if (f.tcpHeader === "http") streamSettings.tcpSettings = { header: { type: "http" } };
      break;
  }

  // 3.1.8: the QUIC pair previews as its sing-box outbound shape, socks as
  // the xray socks outbound — same JSON the respective core would run.
  if (f.proto === "hy2" || f.proto === "tuic") {
    const tls: Record<string, unknown> = { enabled: true, server_name: f.sni.trim() || address };
    if (f.alpn.length) tls.alpn = f.alpn;
    if (f.allowInsecure) tls.insecure = true;
    const outbound: Record<string, unknown> =
      f.proto === "hy2"
        ? {
            type: "hysteria2", tag: "proxy", server: address, server_port: portNum,
            password: f.password,
            ...(f.hy2Obfs === "salamander" && f.hy2ObfsPassword.trim()
              ? { obfs: { type: "salamander", password: f.hy2ObfsPassword.trim() } } : {}),
            tls,
          }
        : {
            type: "tuic", tag: "proxy", server: address, server_port: portNum,
            uuid: f.uuid.trim(), password: f.password,
            congestion_control: f.tuicCongestion,
            tls,
          };
    return JSON.stringify({ outbounds: [outbound] }, null, 2);
  }
  if (f.proto === "socks") {
    const server: Record<string, unknown> = { address, port: portNum };
    if (f.socksUsername.trim()) {
      server.users = [{ user: f.socksUsername.trim(), pass: f.password, level: 0 }];
    }
    return JSON.stringify({ outbounds: [{ tag: "proxy", protocol: "socks", settings: { servers: [server] } }] }, null, 2);
  }

  const settings: Record<string, unknown> =
    f.proto === "vmess"
      ? { vnext: [{ address, port: portNum, users: [{ id: f.uuid.trim(), alterId: parseInt(f.alterId.trim() || "0", 10) || 0, security: f.vmessSecurity }] }] }
      : f.proto === "vless"
        ? { vnext: [{ address, port: portNum, users: [{ id: f.uuid.trim(), encryption: "none", flow: f.flow !== "none" ? f.flow : undefined }] }] }
        : f.proto === "trojan"
          ? { servers: [{ address, port: portNum, password: f.password }] }
          : { servers: [{ address, port: portNum, method: f.method, password: f.password }] };

  const outbound: Record<string, unknown> = {
    tag: "proxy",
    protocol: f.proto === "ss" ? "shadowsocks" : f.proto,
    settings,
    streamSettings,
    mux: { enabled: false },
  };

  if (f.proto === "ss" && f.ssPlugin) {
    outbound.plugin = f.ssPlugin;
    outbound.pluginOpts =
      f.ssPlugin === "obfs-local"
        ? `obfs=${f.ssObfsMode};obfs-host=${f.ssPluginHost.trim()}`
        : `mode=websocket${f.tls ? ";tls" : ""}${f.ssPluginHost.trim() ? `;host=${f.ssPluginHost.trim()}` : ""}${f.ssPluginPath.trim() ? `;path=${f.ssPluginPath.trim()}` : ""}`;
  }

  return JSON.stringify({ outbounds: [outbound] }, null, 2);
}

/* ========================================================= small widgets */

const inputCls = cn(
  "w-full px-3 py-2 rounded-xl text-sm border transition-all duration-200",
  "dark:bg-surface-950/70 dark:border-surface-700/60 dark:text-ink-100 dark:placeholder:text-surface-600",
  "light:bg-white light:border-surface-300 light:text-ink-900 light:placeholder:text-surface-400",
  "focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/60",
  "hover:dark:border-surface-600 hover:light:border-surface-400",
);

interface FieldProps {
  label: string;
  tech?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ok?: boolean;
  mono?: boolean;
  hint?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal";
  onEnter?: () => void;
  action?: { icon: React.ElementType; title: string; onClick: () => void };
}

function Field(p: FieldProps) {
  const Icon = p.action?.icon;
  return (
    <label className="block min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium dark:text-ink-200 light:text-ink-600 truncate">
          {p.label}
          {p.tech && (
            <code className="px-1 py-px rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono shrink-0">
              {p.tech}
            </code>
          )}
        </span>
        <Check
          className={cn(
            "w-3.5 h-3.5 shrink-0 transition-all duration-300",
            p.ok ? "opacity-100 scale-100 text-emerald-400" : "opacity-0 scale-50",
          )}
        />
      </div>
      <div className="relative">
        <input
          type={p.type || "text"}
          inputMode={p.inputMode}
          value={p.value}
          dir={p.mono ? "ltr" : undefined}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && p.onEnter?.()}
          placeholder={p.placeholder}
          className={cn(
            inputCls,
            p.mono && "font-mono text-xs tracking-tight pr-9",
            !p.mono && p.action && "pr-9",
          )}
        />
        {p.action && Icon && (
          <button
            type="button"
            title={p.action.title}
            onClick={(e) => {
              e.preventDefault();
              p.action!.onClick();
            }}
            className="absolute inset-y-0 right-1.5 my-auto w-7 h-7 flex items-center justify-center rounded-lg
                       text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
          >
            <Icon className="w-4 h-4" />
          </button>
        )}
      </div>
      {p.hint && <p className="mt-1 text-[10px] leading-relaxed dark:text-surface-500 light:text-surface-400">{p.hint}</p>}
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  tech?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}

function SelectField(p: SelectFieldProps) {
  return (
    <label className="block min-w-0">
      <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium dark:text-ink-200 light:text-ink-600">
        {p.label}
        {p.tech && (
          <code className="px-1 py-px rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">{p.tech}</code>
        )}
      </div>
      <div className="relative" dir="ltr">
        <select
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          className={cn(inputCls, "appearance-none pr-8 font-mono text-xs cursor-pointer")}
        >
          {p.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
      </div>
      {p.hint && <p className="mt-1 text-[10px] leading-relaxed dark:text-surface-500 light:text-surface-400">{p.hint}</p>}
    </label>
  );
}

function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      dir="ltr"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-all duration-300 shrink-0",
        on ? "bg-gradient-to-r from-emerald-500 to-green-600 glow-green" : "dark:bg-surface-700/80 light:bg-surface-300/70",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300",
          on && "translate-x-5",
        )}
      />
    </button>
  );
}

interface GroupCardProps {
  stepId: StepId;
  icon: React.ElementType;
  title: string;
  sub: string;
  done: boolean;
  registerRef: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}

function GroupCard({ stepId, icon: Icon, title, sub, done, registerRef, children }: GroupCardProps) {
  return (
    <section
      id={`builder-step-${stepId}`}
      ref={registerRef}
      className={cn(
        "rounded-2xl border p-5 backdrop-blur-xl transition-all duration-300 scroll-mt-24",
        "dark:bg-surface-900/50 dark:border-surface-700/60 dark:shadow-xl dark:shadow-black/20",
        "light:bg-white/70 light:border-surface-200 light:shadow-sm",
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="relative shrink-0">
          {done && (
            <div className="absolute inset-0 rounded-xl bg-emerald-500/30 blur-md transition-opacity" />
          )}
          <div
            className={cn(
              "relative w-9 h-9 rounded-xl flex items-center justify-center border transition-all duration-300",
              done
                ? "bg-gradient-to-br from-emerald-400 to-green-600 border-transparent shadow-md shadow-emerald-500/30"
                : "dark:bg-surface-800/70 dark:border-surface-700/60 light:bg-surface-100 light:border-surface-200",
            )}
          >
            <Icon className={cn("w-4 h-4", done ? "text-black/80" : "text-emerald-400")} />
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold dark:text-white light:text-ink-900 truncate">{title}</h3>
          <p className="text-[11px] dark:text-surface-500 light:text-surface-400 truncate">{sub}</p>
        </div>
        <CheckCircle2
          className={cn(
            "w-5 h-5 ml-auto shrink-0 transition-all duration-300",
            done ? "text-emerald-400 opacity-100 scale-100" : "dark:text-surface-700 light:text-surface-300 opacity-70 scale-90",
          )}
        />
      </div>
      {children}
    </section>
  );
}

/* ================================================================ steps */

const STEP_ORDER: StepId[] = ["protocol", "core", "transport", "security", "review"];

/* ================================================================= main */

export default function ConfigBuilderTab({ onImported }: { onImported?: (added: number) => void }) {
  const { language, addConfigs, configs } = useStore();
  const isRtl = language === "fa" || language === "ar";
  const L = useCallback((en: string, fa: string) => (language === "fa" ? fa : en), [language]);

  const [f, setF] = useState<BuilderForm>(freshForm);
  const [activeStep, setActiveStep] = useState<StepId>("protocol");
  const [view, setView] = useState<"link" | "json">("link");
  const [typing, setTyping] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sectionRefs = useRef<Partial<Record<StepId, HTMLElement | null>>>({});
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useCallback((p: Partial<BuilderForm>) => {
    setF((prev) => ({ ...prev, ...p }));
    // terminal caret pulse while typing
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1100);
  }, []);

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  /* ---------------------------------------------------------- validation */

  const portNum = parseInt(f.port.trim(), 10);
  const portOk = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const addressOk = f.address.trim().length > 0;
  const uuidOk = UUID_RE.test(f.uuid.trim());
  const passwordOk = f.password.trim().length > 0;

  const effSec: "none" | "tls" | "reality" =
    f.proto === "vless" && f.reality ? "reality" : f.tls ? "tls" : "none";

  interface BuilderError { step: StepId; en: string; fa: string }

  const errors = useMemo<BuilderError[]>(() => {
    const core: BuilderError[] = [];
    const transport: BuilderError[] = [];
    const security: BuilderError[] = [];

    if (!addressOk) core.push({ step: "core", en: "Server address is required", fa: "آدرس سرور لازم است" });
    if (!portOk) core.push({ step: "core", en: "Port must be a number between 1 and 65535", fa: "پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد" });
    if ((f.proto === "vmess" || f.proto === "vless" || f.proto === "tuic") && !uuidOk)
      core.push({ step: "core", en: "A valid UUID is required (format 8-4-4-4-12)", fa: "UUID معتبر لازم است (قالب 8-4-4-4-12)" });
    if ((f.proto === "trojan" || f.proto === "ss" || f.proto === "hy2" || f.proto === "tuic") && !passwordOk)
      core.push({ step: "core", en: "Password is required", fa: "رمز عبور لازم است" });

    if (f.network === "grpc" && !f.grpcService.trim())
      transport.push({ step: "transport", en: "gRPC serviceName is required", fa: "نام سرویس gRPC (serviceName) لازم است" });

    if (effSec === "reality") {
      if (!f.pbk.trim())
        security.push({ step: "security", en: "Reality publicKey (pbk) is required", fa: "کلید عمومی Reality (pbk) لازم است" });
      if (!f.sni.trim())
        security.push({ step: "security", en: "Reality needs an SNI domain to masquerade as", fa: "Reality برای پوشش، به دامنه SNI نیاز دارد" });
    }

    return [...core, ...transport, ...security];
  }, [f, addressOk, portOk, uuidOk, passwordOk, effSec]);

  const coreErrors = errors.filter((e) => e.step === "core");
  const transportErrors = errors.filter((e) => e.step === "transport");
  const securityErrors = errors.filter((e) => e.step === "security");
  const linkValid = errors.length === 0;

  const stepDone: Record<StepId, boolean> = {
    protocol: true,
    core: coreErrors.length === 0,
    transport: transportErrors.length === 0,
    security: securityErrors.length === 0,
    review: linkValid,
  };

  /* ----------------------------------------------------------- artifacts */

  const generated = useMemo(
    () => (linkValid && addressOk && portOk ? buildLink(f, portNum, effSec) : null),
    [f, portNum, effSec, linkValid, addressOk, portOk],
  );
  const link = generated?.link || "";
  const json = generated?.json || "";

  // QR generation — reuse the exact pipeline QrModal uses (qrcode package).
  useEffect(() => {
    let alive = true;
    if (!link) { setQr(null); return; }
    makeQrDataUrl(link, 512)
      .then((u) => { if (alive) setQr(u); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [link]);

  /* ------------------------------------------------------------- actions */

  const jumpTo = useCallback((id: StepId) => {
    setActiveStep(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const copyText = useCallback(async (text: string, msgEn: string, msgFa: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success(L(msgEn, msgFa));
  }, [L]);

  const handleAdd = useCallback(() => {
    if (!link || !linkValid) return;
    const before = configs.length;
    addConfigs([link]);
    const added = useStore.getState().configs.length - before;
    if (added > 0) {
      toast.success(L("Config added to MEMENTO ✓", "کانفیگ به MEMENTO اضافه شد ✓"));
      onImported?.(added);
    } else {
      toast(L("This config already exists in your list", "این کانفیگ قبلاً در فهرست شما وجود دارد"), { icon: "⚠️" });
    }
  }, [link, linkValid, addConfigs, configs.length, L, onImported]);

  const handleCopyLink = useCallback(() => {
    if (!link) return;
    copyText(link, "Link copied to clipboard", "لینک در کلیپ‌بورد کپی شد");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [link, copyText]);

  const handleSavePng = useCallback(() => {
    if (!qr) return;
    const name = (f.remarks.trim() || f.address.trim() || "config").replace(/[^\w.-]+/g, "_");
    const a = document.createElement("a");
    a.href = qr;
    a.download = `${name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [qr, f.remarks, f.address]);

  const handleSaveJson = useCallback(() => {
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(f.remarks.trim() || "memento-config").replace(/[^\w.-]+/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [json, f.remarks]);

  const handleReset = useCallback(() => {
    setF(freshForm());
    setView("link");
    setActiveStep("protocol");
    toast(L("Builder reset", "سازنده بازنشانی شد"), { icon: "↩️" });
  }, [L]);

  /* --------------------------------------------------------- step labels */

  const stepMeta: Record<StepId, { icon: React.ElementType; en: string; fa: string; subEn: string; subFa: string }> = {
    protocol: { icon: Cpu, en: "Protocol", fa: "پروتکل", subEn: "Pick your engine", subFa: "موتور خود را انتخاب کنید" },
    core: { icon: Server, en: "Core fields", fa: "مشخصات اصلی", subEn: "Address, port, credentials", subFa: "آدرس، پورت و اعتبارنامه" },
    transport: { icon: Waves, en: "Transport", fa: "ترنسپورت", subEn: "How traffic is carried", subFa: "نحوه حمل ترافیک" },
    security: { icon: ShieldCheck, en: "Security", fa: "امنیت", subEn: "TLS / Reality hardening", subFa: "سخت‌سازی با TLS / Reality" },
    review: { icon: ScanLine, en: "Review & add", fa: "بازبینی و افزودن", subEn: "Link, JSON, QR", subFa: "لینک، JSON و QR" },
  };

  /* ============================================================== render */

  const showTls = effSec !== "none";
  // 3.1.8: the QUIC pair (hy2/tuic) and plain socks carry no wire transport.
  const noTransport = f.proto === "hy2" || f.proto === "tuic" || f.proto === "socks";

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="fade-in">
      {/* ---- builder intro strip ---- */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-5 mb-6 grid-bg",
          "dark:bg-surface-900/40 dark:border-surface-700/50",
          "light:bg-white/70 light:border-surface-200",
        )}
      >
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 shrink-0">
            <Wand2 className="w-5 h-5 text-black/80" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-extrabold dark:text-white light:text-ink-900">
              {L("Build a config from scratch", "کانفیگ را خودت بساز")}
            </h3>
            <p className="text-xs dark:text-surface-400 light:text-surface-500 mt-0.5">
              {L(
                "Fill the steps — your share link, JSON and QR are forged live.",
                "مرحله‌ها را پر کنید — لینک، JSON و بارکد به‌صورت زنده ساخته می‌شوند.",
              )}
            </p>
          </div>
          <code dir="ltr" className="hidden sm:block px-2.5 py-1 rounded-lg text-[11px] font-mono
                        dark:bg-surface-950/80 dark:text-emerald-400 dark:border dark:border-surface-700/60
                        light:bg-surface-100 light:text-emerald-600 light:border light:border-surface-200">
            memento://forge/{f.proto}
          </code>
          <button
            onClick={handleReset}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all",
              "dark:bg-surface-800/60 dark:text-surface-300 dark:border dark:border-surface-700/60 dark:hover:border-emerald-500/40 dark:hover:text-white",
              "light:bg-surface-100 light:text-surface-600 light:border light:border-surface-200 light:hover:text-surface-900",
            )}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {L("Reset", "بازنشانی")}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ---- step rail (desktop) ---- */}
        <aside className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-6 space-y-1">
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest dark:text-surface-500 light:text-surface-400">
              {L("Steps", "مرحله‌ها")}
            </p>
            {STEP_ORDER.map((id, i) => {
              const meta = stepMeta[id];
              const done = stepDone[id];
              const active = activeStep === id;
              return (
                <div key={id} className="relative">
                  <button
                    onClick={() => jumpTo(id)}
                    className={cn(
                      "group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-300 border",
                      active
                        ? "dark:bg-emerald-500/10 dark:border-emerald-500/40 glow-green light:bg-emerald-500/10 light:border-emerald-500/40"
                        : "border-transparent hover:dark:bg-surface-800/50 hover:light:bg-surface-100",
                    )}
                  >
                    <span
                      className={cn(
                        "relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-300 border",
                        done
                          ? "bg-gradient-to-br from-emerald-400 to-green-600 text-black/80 border-transparent shadow-md shadow-emerald-500/30"
                          : active
                            ? "border-emerald-400 text-emerald-300 dark:text-emerald-300 light:text-emerald-600"
                            : "dark:border-surface-600 dark:text-surface-500 light:border-surface-300 light:text-surface-400",
                      )}
                    >
                      {done ? <Check className="w-4 h-4" /> : i + 1}
                      {active && !done && (
                        <span className="absolute inset-0 rounded-full border border-emerald-400/60 radar-ring" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={cn(
                        "block text-xs font-semibold truncate",
                        active ? "dark:text-white light:text-ink-900" : "dark:text-surface-300 light:text-surface-600",
                      )}>
                        {L(meta.en, meta.fa)}
                      </span>
                      <span className="block text-[10px] dark:text-surface-500 light:text-surface-400 truncate">
                        {done ? L("done", "انجام شد") : L(meta.subEn, meta.subFa)}
                      </span>
                    </span>
                  </button>
                  {i < STEP_ORDER.length - 1 && (
                    <span
                      className={cn(
                        "absolute top-full ms-6 w-px h-2 transition-colors",
                        done ? "bg-emerald-500/50" : "dark:bg-surface-700 light:bg-surface-300",
                      )}
                    />
                  )}
                </div>
              );
            })}
            <div className={cn(
              "mt-4 mx-3 p-3 rounded-xl border text-[10px] leading-relaxed",
              "dark:bg-surface-950/60 dark:border-surface-700/50 dark:text-surface-500",
              "light:bg-surface-50 light:border-surface-200 light:text-surface-400",
            )}>
              <Terminal className="w-3 h-3 inline-block me-1 text-emerald-500" />
              {L(
                "Steps auto-check as soon as their fields are valid.",
                "مرحله‌ها به محض معتبر شدن فیلدها خودکار تیک می‌خورند.",
              )}
            </div>
          </div>
        </aside>

        {/* ---- content column ---- */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* mobile step chips */}
          <div className={cn(
            "lg:hidden sticky top-0 z-10 -mx-1 px-1 py-2 backdrop-blur-xl rounded-xl",
            "dark:bg-surface-950/70 light:bg-white/80",
          )}>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {STEP_ORDER.map((id, i) => {
                const meta = stepMeta[id];
                const done = stepDone[id];
                const active = activeStep === id;
                return (
                  <button
                    key={id}
                    onClick={() => jumpTo(id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all",
                      active
                        ? "bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 border-transparent"
                        : done
                          ? "dark:border-emerald-500/40 dark:text-emerald-300 dark:bg-emerald-500/10 light:border-emerald-500/40 light:text-emerald-600"
                          : "dark:border-surface-700 dark:text-surface-400 light:border-surface-300 light:text-surface-500",
                    )}
                  >
                    {done ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
                    {L(meta.en, meta.fa)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ============ STEP 1 · PROTOCOL ============ */}
          <GroupCard
            stepId="protocol"
            icon={Cpu}
            title={L("Protocol", "پروتکل")}
            sub={L("Pick the engine your server speaks", "موتوری که سرور شما صحبت می‌کند را انتخاب کنید")}
            done={stepDone.protocol}
            registerRef={(el) => { sectionRefs.current.protocol = el; }}
          >
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {PROTOS.map((p) => {
                const Icon = p.icon;
                const on = f.proto === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (f.proto === p.id) return;
                      // Trojan/SS are TLS-native — pre-enable to save a click;
                      // Reality only survives when the new protocol can use it.
                      patch({
                        proto: p.id,
                        // TLS-native pre-enable: trojan/ss only — the QUIC
                        // pair (hy2/tuic) carries its own TLS, socks has none.
                        tls: f.tls || p.id === "trojan" || p.id === "ss",
                        reality: p.id === "vless" ? f.reality : false,
                      });
                    }}
                    className={cn(
                      "group relative rounded-2xl border p-4 text-start transition-all duration-300 hover-lift shine overflow-hidden",
                      on
                        ? "border-emerald-500/70 bg-gradient-to-br from-emerald-500/15 to-green-600/5 glow-green"
                        : "dark:border-surface-700/50 dark:bg-surface-900/40 dark:hover:border-emerald-500/40 light:border-surface-200 light:bg-white light:hover:border-emerald-500/40",
                    )}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md transition-all duration-300",
                        on ? cn(p.tile, "shadow-emerald-500/40 scale-110") : "dark:bg-surface-800 dark:shadow-none light:bg-surface-100",
                      )}>
                        <Icon className={cn("w-5 h-5 transition-colors", on ? "text-black/80" : "text-emerald-400")} />
                      </div>
                      <CheckCircle2
                        className={cn(
                          "w-4 h-4 transition-all duration-300",
                          on ? "text-emerald-400 opacity-100 scale-100" : "opacity-0 scale-50",
                        )}
                      />
                    </div>
                    <div className={cn("text-sm font-bold", on ? "dark:text-white light:text-ink-900" : "dark:text-surface-200 light:text-ink-700")}>
                      {protoLabel(p, language)}
                    </div>
                    <code dir="ltr" className={cn(
                      "block text-[10px] font-mono mt-0.5",
                      on ? "text-emerald-400" : "dark:text-surface-500 light:text-surface-400",
                    )}>
                      {p.scheme}
                    </code>
                    <p className={cn("text-[10px] leading-relaxed mt-2", "dark:text-surface-500 light:text-surface-400")}>
                      {protoHint(p, language)}
                    </p>
                  </button>
                );
              })}
            </div>
          </GroupCard>

          {/* ============ STEP 2 · CORE FIELDS ============ */}
          <GroupCard
            stepId="core"
            icon={Server}
            title={L("Core fields", "مشخصات اصلی")}
            sub={L("Where the server lives and how you log in", "سرور کجاست و چطور وارد می‌شوید")}
            done={stepDone.core}
            registerRef={(el) => { sectionRefs.current.core = el; }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field
                label={L("Server address", "آدرس سرور")}
                tech="add"
                value={f.address}
                onChange={(v) => patch({ address: v })}
                placeholder="example.com · 1.2.3.4 · ::1"
                ok={addressOk}
                mono
              />
              <Field
                label={L("Port", "پورت")}
                tech="port"
                value={f.port}
                onChange={(v) => patch({ port: v.replace(/[^\d]/g, "") })}
                placeholder="443"
                ok={portOk}
                mono
                inputMode="numeric"
                hint={portOk ? undefined : L("1 – 65535", "۱ تا ۶۵۵۳۵")}
              />
              <Field
                label={L("Remarks (optional)", "نام کانفیگ (اختیاری)")}
                tech="ps"
                value={f.remarks}
                onChange={(v) => patch({ remarks: v })}
                placeholder={L("My server", "سرور من")}
                ok={f.remarks.trim().length > 0}
              />

              {f.proto === "vmess" && (
                <>
                  <Field
                    label="UUID"
                    tech="id"
                    value={f.uuid}
                    onChange={(v) => patch({ uuid: v })}
                    placeholder="0f5e7b0e-…"
                    ok={uuidOk}
                    mono
                    action={{
                      icon: Dices,
                      title: L("Generate a random UUID", "ساخت UUID تصادفی"),
                      onClick: () => patch({ uuid: genUuid() }),
                    }}
                  />
                  <Field
                    label={L("Alter ID", "Alter ID")}
                    tech="aid"
                    value={f.alterId}
                    onChange={(v) => patch({ alterId: v.replace(/[^\d]/g, "") })}
                    placeholder="0"
                    ok={f.alterId.trim().length > 0 && Number.isInteger(parseInt(f.alterId, 10))}
                    mono
                    inputMode="numeric"
                    hint={L("Modern servers use 0", "سرورهای امروزی از 0 استفاده می‌کنند")}
                  />
                  <SelectField
                    label={L("Encryption", "رمزنگاری")}
                    tech="scy"
                    value={f.vmessSecurity}
                    onChange={(v) => patch({ vmessSecurity: v as BuilderForm["vmessSecurity"] })}
                    options={[
                      { value: "auto", label: "auto" },
                      { value: "none", label: "none" },
                      { value: "aes-128-gcm", label: "aes-128-gcm" },
                      { value: "chacha20-poly1305", label: "chacha20-poly1305" },
                    ]}
                  />
                </>
              )}

              {f.proto === "vless" && (
                <>
                  <Field
                    label="UUID"
                    tech="id"
                    value={f.uuid}
                    onChange={(v) => patch({ uuid: v })}
                    placeholder="0f5e7b0e-…"
                    ok={uuidOk}
                    mono
                    action={{
                      icon: Dices,
                      title: L("Generate a random UUID", "ساخت UUID تصادفی"),
                      onClick: () => patch({ uuid: genUuid() }),
                    }}
                  />
                  <SelectField
                    label="Flow"
                    tech="flow"
                    value={f.flow}
                    onChange={(v) => patch({ flow: v as BuilderForm["flow"] })}
                    options={[
                      { value: "none", label: "none" },
                      { value: "xtls-rprx-vision", label: "xtls-rprx-vision" },
                    ]}
                    hint={L("Vision pairs best with Reality + TCP", "Vision با Reality و TCP بهترین جفت را دارد")}
                  />
                  <div className="sm:col-span-2 lg:col-span-1 flex items-center gap-2 px-3 py-2 rounded-xl border
                                  dark:bg-surface-950/50 dark:border-surface-700/50 light:bg-surface-50 light:border-surface-200">
                    <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-[11px] dark:text-surface-400 light:text-surface-500">
                      {L("Encryption is fixed to", "رمزنگاری ثابت است روی")} <code className="font-mono text-emerald-400">none</code>
                    </span>
                  </div>
                </>
              )}

              {(f.proto === "trojan" || f.proto === "ss") && (
                <Field
                  label={f.proto === "trojan" ? L("Password", "رمز عبور") : L("Password", "رمز عبور")}
                  tech={f.proto === "trojan" ? "password" : "password"}
                  value={f.password}
                  onChange={(v) => patch({ password: v })}
                  placeholder="••••••••••"
                  ok={passwordOk}
                  mono
                  action={{
                    icon: Wand2,
                    title: L("Generate a strong random password", "ساخت رمز تصادفی قوی"),
                    onClick: () => patch({ password: genPassword(f.method) }),
                  }}
                />
              )}

              {f.proto === "hy2" && (
                <>
                  <Field
                    label={L("Password (auth)", "رمز عبور (احراز هویت)")}
                    tech="password"
                    value={f.password}
                    onChange={(v) => patch({ password: v })}
                    placeholder="••••••••••"
                    ok={passwordOk}
                    mono
                    action={{
                      icon: Wand2,
                      title: L("Generate a strong random password", "ساخت رمز تصادفی قوی"),
                      onClick: () => patch({ password: genPassword(f.method) }),
                    }}
                  />
                  <SelectField
                    label={L("Obfuscation", "مبهم‌سازی")}
                    tech="obfs"
                    value={f.hy2Obfs}
                    onChange={(v) => patch({ hy2Obfs: v as BuilderForm["hy2Obfs"] })}
                    options={[
                      { value: "", label: L("None", "بدون مبهم‌سازی") },
                      { value: "salamander", label: "salamander" },
                    ]}
                    hint={L("Must match the server's obfs settings", "باید با تنظیمات obfs سرور یکی باشد")}
                  />
                  {f.hy2Obfs === "salamander" && (
                    <Field
                      label={L("Obfs password", "رمز مبهم‌سازی")}
                      tech="obfs-password"
                      value={f.hy2ObfsPassword}
                      onChange={(v) => patch({ hy2ObfsPassword: v })}
                      placeholder="••••••••••"
                      mono
                      ok={f.hy2ObfsPassword.trim().length > 0}
                    />
                  )}
                </>
              )}

              {f.proto === "tuic" && (
                <>
                  <Field
                    label="UUID"
                    tech="id"
                    value={f.uuid}
                    onChange={(v) => patch({ uuid: v })}
                    placeholder="0f5e7b0e-…"
                    ok={uuidOk}
                    mono
                    action={{
                      icon: Dices,
                      title: L("Generate a random UUID", "ساخت UUID تصادفی"),
                      onClick: () => patch({ uuid: genUuid() }),
                    }}
                  />
                  <Field
                    label={L("Password (token)", "رمز عبور (توکن)")}
                    tech="password"
                    value={f.password}
                    onChange={(v) => patch({ password: v })}
                    placeholder="••••••••••"
                    ok={passwordOk}
                    mono
                  />
                  <SelectField
                    label={L("Congestion control", "کنترل ازدحام")}
                    tech="congestion_control"
                    value={f.tuicCongestion}
                    onChange={(v) => patch({ tuicCongestion: v as BuilderForm["tuicCongestion"] })}
                    options={[
                      { value: "cubic", label: "cubic" },
                      { value: "bbr", label: "bbr" },
                    ]}
                    hint={L("BBR shines on lossy links", "BBR روی شبکه‌های پرِ‌لاس می‌درخشد")}
                  />
                </>
              )}

              {f.proto === "socks" && (
                <>
                  <Field
                    label={L("Username (optional)", "نام کاربری (اختیاری)")}
                    tech="user"
                    value={f.socksUsername}
                    onChange={(v) => patch({ socksUsername: v })}
                    placeholder={L("empty = anonymous", "خالی = ناشناس")}
                    ok={f.socksUsername.trim().length > 0 || !f.password.trim()}
                  />
                  <Field
                    label={L("Password (optional)", "رمز عبور (اختیاری)")}
                    tech="password"
                    value={f.password}
                    onChange={(v) => patch({ password: v })}
                    placeholder={L("empty = anonymous", "خالی = ناشناس")}
                    mono
                    ok={f.socksUsername.trim().length > 0 || !f.password.trim()}
                  />
                </>
              )}

              {f.proto === "ss" && (
                <SelectField
                  label={L("Method", "روش رمزنگاری")}
                  tech="method"
                  value={f.method}
                  onChange={(v) => patch({ method: v })}
                  options={SS_METHODS.map((m) => ({ value: m, label: m }))}
                />
              )}
            </div>

            {/* SS plugin subgroup */}
            {f.proto === "ss" && (
              <div className="mt-4 pt-4 border-t dark:border-surface-700/40 light:border-surface-200">
                <div className="flex items-center gap-2 mb-3">
                  <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-semibold dark:text-surface-200 light:text-ink-700">
                    {L("SIP003 plugin (optional)", "افزونه SIP003 (اختیاری)")}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <SelectField
                    label={L("Plugin", "افزونه")}
                    tech="plugin"
                    value={f.ssPlugin}
                    onChange={(v) => patch({ ssPlugin: v as BuilderForm["ssPlugin"] })}
                    options={[
                      { value: "", label: L("None", "بدون افزونه") },
                      { value: "obfs-local", label: "obfs-local (simple-obfs)" },
                      { value: "v2ray-plugin", label: "v2ray-plugin" },
                    ]}
                  />
                  {f.ssPlugin === "obfs-local" && (
                    <SelectField
                      label={L("Obfs mode", "حالت Obfs")}
                      tech="obfs"
                      value={f.ssObfsMode}
                      onChange={(v) => patch({ ssObfsMode: v as BuilderForm["ssObfsMode"] })}
                      options={[
                        { value: "http", label: "http" },
                        { value: "tls", label: "tls" },
                      ]}
                    />
                  )}
                  {f.ssPlugin && (
                    <Field
                      label="Host"
                      tech={f.ssPlugin === "obfs-local" ? "obfs-host" : "host"}
                      value={f.ssPluginHost}
                      onChange={(v) => patch({ ssPluginHost: v })}
                      placeholder="cdn.example.com"
                      mono
                      ok={f.ssPluginHost.trim().length > 0}
                    />
                  )}
                  {f.ssPlugin === "v2ray-plugin" && (
                    <Field
                      label="Path"
                      tech="path"
                      value={f.ssPluginPath}
                      onChange={(v) => patch({ ssPluginPath: v })}
                      placeholder="/ws"
                      mono
                    />
                  )}
                </div>
              </div>
            )}
          </GroupCard>

          {/* ============ STEP 3 · TRANSPORT ============ */}
          <GroupCard
            stepId="transport"
            icon={Waves}
            title={L("Transport", "ترنسپورت")}
            sub={L("How the traffic is disguised on the wire", "ترافیک روی سیم چطور پنهان می‌شود")}
            done={stepDone.transport}
            registerRef={(el) => { sectionRefs.current.transport = el; }}
          >
            {noTransport && (
              <p className="text-[11px] leading-relaxed dark:text-surface-400 light:text-surface-500 flex items-start gap-2 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                {f.proto === "socks"
                  ? L("Plain SOCKS5 has no transport layer — nothing to disguise here.", "SOCKS5 ساده لایه‌ی ترنسپورت ندارد — چیزی برای پنهان‌کردن نیست.")
                  : L("QUIC-based protocol — TLS + transport ride inside QUIC itself; nothing to pick here.", "پروتکل مبتنی بر QUIC است — TLS و ترنسپورت داخل خود QUIC هستند؛ چیزی برای انتخاب نیست.")}
              </p>
            )}
            {!noTransport && ( <>
            <div className="flex flex-wrap gap-2 mb-4">
              {NETWORKS.map((n) => {
                const Icon = n.icon;
                const on = f.network === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => patch({ network: n.id })}
                    className={cn(
                      "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-300",
                      on
                        ? "bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 border-transparent shadow-lg shadow-emerald-500/25 scale-105"
                        : "dark:border-surface-700/60 dark:text-surface-300 dark:bg-surface-900/40 dark:hover:border-emerald-500/40 light:border-surface-200 light:bg-white light:text-surface-600 light:hover:border-emerald-500/40",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {n.en}
                    {on && <Check className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {f.network === "tcp" && (
                <>
                  <SelectField
                    label={L("Header type", "نوع هدر")}
                    tech="header"
                    value={f.tcpHeader}
                    onChange={(v) => patch({ tcpHeader: v as BuilderForm["tcpHeader"] })}
                    options={[
                      { value: "none", label: "none" },
                      { value: "http", label: "http" },
                    ]}
                    hint={L("http masquerade needs matching server settings", "حالت http به تنظیمات هماهنگ سمت سرور نیاز دارد")}
                  />
                  {f.proto === "vmess" && (
                    <p className="text-[11px] self-end dark:text-surface-500 light:text-surface-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                      {L("Emitted into the vmess payload (type field).", "در payload مربوط به vmess (فیلد type) قرار می‌گیرد.")}
                    </p>
                  )}
                </>
              )}

              {f.network === "ws" && (
                <>
                  <Field
                    label={L("Path", "مسیر")}
                    tech="path"
                    value={f.wsPath}
                    onChange={(v) => patch({ wsPath: v })}
                    placeholder="/ray"
                    mono
                    ok={f.wsPath.trim().length > 0}
                  />
                  <Field
                    label={L("Host header", "هدر Host")}
                    tech="Host"
                    value={f.wsHost}
                    onChange={(v) => patch({ wsHost: v })}
                    placeholder="cdn.example.com"
                    mono
                  />
                </>
              )}

              {f.network === "grpc" && (
                <>
                  <Field
                    label={L("Service name", "نام سرویس")}
                    tech="serviceName"
                    value={f.grpcService}
                    onChange={(v) => patch({ grpcService: v })}
                    placeholder="GunService"
                    mono
                    ok={f.grpcService.trim().length > 0}
                    hint={L("Must match the server exactly", "باید دقیقاً با سرور یکی باشد")}
                  />
                  <Field
                    label={L("Authority (optional)", "Authority (اختیاری)")}
                    tech="authority"
                    value={f.grpcAuthority}
                    onChange={(v) => patch({ grpcAuthority: v })}
                    placeholder="cdn.example.com"
                    mono
                  />
                </>
              )}

              {f.network === "h2" && (
                <>
                  <Field
                    label={L("Path", "مسیر")}
                    tech="path"
                    value={f.h2Path}
                    onChange={(v) => patch({ h2Path: v })}
                    placeholder="/h2"
                    mono
                  />
                  <Field
                    label={L("Host", "Host")}
                    tech="host"
                    value={f.h2Host}
                    onChange={(v) => patch({ h2Host: v })}
                    placeholder="cdn.example.com"
                    mono
                  />
                </>
              )}

              {f.network === "httpupgrade" && (
                <>
                  <Field
                    label={L("Path", "مسیر")}
                    tech="path"
                    value={f.httpupPath}
                    onChange={(v) => patch({ httpupPath: v })}
                    placeholder="/upgrade"
                    mono
                  />
                  <Field
                    label={L("Host", "Host")}
                    tech="host"
                    value={f.httpupHost}
                    onChange={(v) => patch({ httpupHost: v })}
                    placeholder="cdn.example.com"
                    mono
                  />
                </>
              )}
            </div>
            </> )}
          </GroupCard>

          {/* ============ STEP 4 · SECURITY ============ */}
          <GroupCard
            stepId="security"
            icon={ShieldCheck}
            title={L("Security", "امنیت")}
            sub={L("TLS, Reality and certificate hardening", "TLS و Reality و سخت‌سازی گواهی")}
            done={stepDone.security}
            registerRef={(el) => { sectionRefs.current.security = el; }}
          >
            {noTransport && f.proto !== "socks" && (
              <p className="text-[11px] leading-relaxed dark:text-surface-400 light:text-surface-500 flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                {L("QUIC encrypts everything already — just set the SNI mask (and the insecure switch for self-signed certs).", "QUIC خودش همه‌چیز را رمز می‌کند — فقط ماسک SNI را بده (و برای گواهی خودامضا، کلید insecure را روشن کن).")}
              </p>
            )}
            {f.proto === "socks" && (
              <p className="text-[11px] leading-relaxed dark:text-surface-400 light:text-surface-500 flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                {L("SOCKS5 has no TLS of its own — pair it with a local tunnel if you need encryption.", "SOCKS5 خودش TLS ندارد — اگر رمزنگاری می‌خواهی با یک تونل محلی جفتش کن.")}
              </p>
            )}
            {/* security mode cards */}
            {!noTransport && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {/* none */}
              <button
                onClick={() => patch({ tls: false, reality: false })}
                disabled={f.proto === "trojan"}
                className={cn(
                  "relative rounded-xl border p-3.5 text-start transition-all duration-300",
                  effSec === "none"
                    ? "border-emerald-500/70 bg-emerald-500/10 glow-green"
                    : "dark:border-surface-700/50 dark:bg-surface-900/40 hover:dark:border-emerald-500/40 light:border-surface-200 light:bg-white",
                  f.proto === "trojan" && "opacity-40 cursor-not-allowed",
                )}
              >
                <div className="text-xs font-bold dark:text-surface-200 light:text-ink-700">{L("None", "بدون رمز")}</div>
                <div className="text-[10px] mt-0.5 dark:text-surface-500 light:text-surface-400">security=none</div>
                {f.proto === "trojan" && (
                  <div className="text-[10px] mt-1 text-amber-500 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> {L("Trojan is always TLS", "Trojan همیشه TLS است")}
                  </div>
                )}
              </button>

              {/* tls */}
              <button
                onClick={() => patch({ tls: true, reality: false })}
                disabled={f.proto === "trojan"}
                className={cn(
                  "relative rounded-xl border p-3.5 text-start transition-all duration-300",
                  effSec === "tls"
                    ? "border-emerald-500/70 bg-emerald-500/10 glow-green"
                    : "dark:border-surface-700/50 dark:bg-surface-900/40 hover:dark:border-emerald-500/40 light:border-surface-200 light:bg-white",
                  f.proto === "trojan" && "opacity-90",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold dark:text-surface-200 light:text-ink-700">TLS</div>
                  {f.proto === "trojan" && <Lock className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
                <div className="text-[10px] mt-0.5 dark:text-surface-500 light:text-surface-400">security=tls</div>
              </button>

              {/* reality — vless only */}
              {f.proto === "vless" ? (
                <button
                  onClick={() => patch({ tls: true, reality: true })}
                  className={cn(
                    "relative rounded-xl border p-3.5 text-start transition-all duration-300 overflow-hidden",
                    effSec === "reality"
                      ? "border-emerald-500/70 bg-emerald-500/10 glow-green"
                      : "dark:border-surface-700/50 dark:bg-surface-900/40 hover:dark:border-emerald-500/40 light:border-surface-200 light:bg-white",
                  )}
                >
                  {effSec === "reality" && (
                    <span className="absolute inset-x-0 top-0 h-px scan-line bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
                  )}
                  <div className="text-xs font-bold gradient-text">Reality</div>
                  <div className="text-[10px] mt-0.5 dark:text-surface-500 light:text-surface-400">security=reality</div>
                  <div className="text-[10px] mt-1 text-emerald-400">{L("XTLS anti-detection", "ضد تشخیص XTLS")}</div>
                </button>
              ) : (
                <div className={cn(
                  "rounded-xl border p-3.5 flex items-center gap-2",
                  "dark:bg-surface-950/40 dark:border-surface-800 dark:opacity-60 light:bg-surface-50 light:border-surface-200",
                )}>
                  <Lock className="w-3.5 h-3.5 text-surface-500 shrink-0" />
                  <span className="text-[10px] dark:text-surface-500 light:text-surface-400">
                    {L("Reality is VLESS-exclusive", "Reality فقط برای VLESS است")}
                  </span>
                </div>
              )}
            </div>
            )}

            {/* 3.1.8: QUIC pair — SNI mask + insecure + ALPN (no mode cards) */}
            {(f.proto === "hy2" || f.proto === "tuic") && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field
                  label={L("SNI / server name", "SNI / نام سرور")}
                  tech="sni"
                  value={f.sni}
                  onChange={(v) => patch({ sni: v })}
                  placeholder="example.com"
                  mono
                  hint={L("Defaults to the address if left empty", "در صورت خالی بودن، از آدرس سرور استفاده می‌شود")}
                />
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border self-start
                                dark:bg-surface-950/50 dark:border-surface-700/50 light:bg-surface-50 light:border-surface-200">
                  <Switch on={f.allowInsecure} onChange={(v) => patch({ allowInsecure: v })} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium dark:text-surface-200 light:text-ink-700">
                      {L("Allow insecure", "پذیرش گواهی نامعتبر")}
                    </div>
                    <div className="text-[10px] dark:text-surface-500 light:text-surface-400">insecure=1</div>
                  </div>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-medium dark:text-ink-200 light:text-ink-600">
                    {L("ALPN", "ALPN")}
                    <code className="px-1 py-px rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">alpn</code>
                    <span className="text-[10px] dark:text-surface-500 light:text-surface-400">
                      ({L("optional — toggle the protocols to advertise", "اختیاری — پروتکل‌های تبلیغ‌شده را انتخاب کنید")})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ALPN_OPTIONS.map((a) => {
                      const on = f.alpn.includes(a);
                      return (
                        <button
                          key={a}
                          onClick={() =>
                            patch({ alpn: on ? f.alpn.filter((x) => x !== a) : [...f.alpn, a] })
                          }
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-all",
                            on
                              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                              : "dark:border-surface-700/60 dark:text-surface-400 light:border-surface-200 light:text-surface-500",
                          )}
                        >
                          {a}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {showTls && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field
                  label={L("SNI / server name", "SNI / نام سرور")}
                  tech="sni"
                  value={f.sni}
                  onChange={(v) => patch({ sni: v })}
                  placeholder={f.proto === "vless" && f.reality ? "www.microsoft.com" : "example.com"}
                  mono
                  ok={f.sni.trim().length > 0}
                  hint={
                    f.proto === "vless" && f.reality
                      ? L("Must be a real TLS site the server can borrow", "باید یک سایت TLS واقعی باشد که سرور بتواند از آن پوشش بگیرد")
                      : L("Defaults to the address if left empty", "در صورت خالی بودن، از آدرس سرور استفاده می‌شود")
                  }
                />
                <SelectField
                  label={L("Fingerprint", "اثر انگشت")}
                  tech="fp"
                  value={f.fp}
                  onChange={(v) => patch({ fp: v })}
                  options={FINGERPRINTS.map((x) => ({ value: x, label: x }))}
                  hint={L("uTLS browser impersonation", "تقلید مرورگر با uTLS")}
                />
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border self-start
                                dark:bg-surface-950/50 dark:border-surface-700/50 light:bg-surface-50 light:border-surface-200">
                  <Switch on={f.allowInsecure} onChange={(v) => patch({ allowInsecure: v })} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium dark:text-surface-200 light:text-ink-700">
                      {L("Allow insecure", "پذیرش گواهی نامعتبر")}
                    </div>
                    <div className="text-[10px] dark:text-surface-500 light:text-surface-400">allowInsecure=1</div>
                  </div>
                </div>

                {/* ALPN chips */}
                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-medium dark:text-ink-200 light:text-ink-600">
                    {L("ALPN", "ALPN")}
                    <code className="px-1 py-px rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">alpn</code>
                    <span className="text-[10px] dark:text-surface-500 light:text-surface-400">
                      ({L("optional — toggle the protocols to advertise", "اختیاری — پروتکل‌های تبلیغ‌شده را انتخاب کنید")})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ALPN_OPTIONS.map((a) => {
                      const on = f.alpn.includes(a);
                      return (
                        <button
                          key={a}
                          onClick={() =>
                            patch({ alpn: on ? f.alpn.filter((x) => x !== a) : [...f.alpn, a] })
                          }
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-mono border transition-all duration-300",
                            on
                              ? "bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 border-transparent shadow-md shadow-emerald-500/25"
                              : "dark:border-surface-700/60 dark:text-surface-400 dark:bg-surface-900/40 dark:hover:border-emerald-500/40 light:border-surface-200 light:bg-white light:text-surface-500",
                          )}
                        >
                          {a}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Reality fields */}
            {effSec === "reality" && (
              <div className="mt-5 pt-4 border-t dark:border-surface-700/40 light:border-surface-200">
                <div className="flex items-center gap-2 mb-3">
                  <Fingerprint className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-semibold gradient-text">{L("Reality parameters", "پارامترهای Reality")}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Field
                    label={L("Public key", "کلید عمومی")}
                    tech="pbk"
                    value={f.pbk}
                    onChange={(v) => patch({ pbk: v })}
                    placeholder="jkkI1Lgk…"
                    mono
                    ok={f.pbk.trim().length > 0}
                    hint={L("From `xray x25519` on the server", "از دستور xray x25519 روی سرور")}
                  />
                  <Field
                    label={L("Short ID", "شناسه کوتاه")}
                    tech="sid"
                    value={f.sid}
                    onChange={(v) => patch({ sid: v })}
                    placeholder="01ab"
                    mono
                    hint={L("Hex — leave empty only if the server allows", "هگز — فقط اگر سرور اجازه دهد خالی بگذارید")}
                  />
                  <Field
                    label="spiderX"
                    tech="spx"
                    value={f.spiderX}
                    onChange={(v) => patch({ spiderX: v })}
                    placeholder="/"
                    mono
                    hint={L("Optional crawler path", "مسیر خزنده (اختیاری)")}
                  />
                </div>
              </div>
            )}
          </GroupCard>

          {/* ============ STEP 5 · REVIEW ============ */}
          <GroupCard
            stepId="review"
            icon={ScanLine}
            title={L("Review & add", "بازبینی و افزودن")}
            sub={L("Live link, JSON, QR — then one click in", "لینک و JSON و بارکد زنده — بعد یک کلیک")}
            done={stepDone.review}
            registerRef={(el) => { sectionRefs.current.review = el; }}
          >
            {/* summary chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { k: L("protocol", "پروتکل"), v: f.proto === "hy2" ? "hysteria2" : f.proto },
                { k: L("endpoint", "مقصد"), v: `${hostForLink(f.address.trim()) || "—"}:${f.port || "—"}` },
                { k: L("transport", "ترنسپورت"), v: f.proto === "hy2" || f.proto === "tuic" ? "quic" : f.proto === "socks" ? "—" : f.network },
                {
                  k: L("security", "امنیت"),
                  v: f.proto === "trojan" || f.proto === "hy2" || f.proto === "tuic"
                    ? "tls"
                    : f.proto === "socks" ? "none" : effSec,
                },
                ...(f.proto === "ss" && f.ssPlugin ? [{ k: L("plugin", "افزونه"), v: f.ssPlugin }] : []),
              ].map((c) => (
                <span
                  key={c.k}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border",
                    "dark:bg-surface-950/60 dark:border-surface-700/50 light:bg-surface-50 light:border-surface-200",
                  )}
                >
                  <span className="dark:text-surface-500 light:text-surface-400">{c.k}</span>
                  <code dir="ltr" className="font-mono text-emerald-400">{c.v}</code>
                </span>
              ))}
            </div>

            {/* terminal */}
            <div className="relative rounded-2xl overflow-hidden border border-emerald-500/25 bg-surface-950 shadow-inner">
              {/* scanline */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-16 scan-line bg-gradient-to-b from-emerald-500/10 to-transparent" />

              <div className="relative flex items-center gap-2 px-4 py-2.5 border-b border-surface-800/80 bg-surface-900/60">
                <span className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                </span>
                <Terminal className="w-3.5 h-3.5 text-emerald-500 ms-1" />
                <span className="text-[11px] font-mono text-surface-500">memento://builder</span>

                <div className="ms-auto flex items-center gap-1">
                  <button
                    onClick={() => setView("link")}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                      view === "link" ? "bg-emerald-500/15 text-emerald-300" : "text-surface-500 hover:text-surface-300",
                    )}
                  >
                    <Terminal className="w-3 h-3" />
                    {L("Link", "لینک")}
                  </button>
                  <button
                    onClick={() => setView("json")}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                      view === "json" ? "bg-emerald-500/15 text-emerald-300" : "text-surface-500 hover:text-surface-300",
                    )}
                  >
                    <Braces className="w-3 h-3" />
                    JSON
                  </button>
                  {view === "link" && (
                    <button
                      onClick={handleCopyLink}
                      disabled={!link}
                      title={L("Copy link", "کپی لینک")}
                      className="p-1 rounded-lg text-surface-500 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-30"
                    >
                      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  {view === "json" && (
                    <button
                      onClick={handleSaveJson}
                      disabled={!json}
                      title={L("Save JSON", "ذخیره JSON")}
                      className="p-1 rounded-lg text-surface-500 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-30"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <pre
                dir="ltr"
                className={cn(
                  "allow-select relative px-4 py-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all",
                  "max-h-60 overflow-auto min-h-[76px]",
                )}
              >
                {linkValid && generated ? (
                  <span className={view === "link" ? "text-emerald-300/90" : "text-surface-300"}>
                    {view === "link" ? generated.link : generated.json}
                    {typing && (
                      <span className="inline-block w-1.5 h-3.5 align-middle bg-emerald-400 animate-pulse ms-0.5" />
                    )}
                  </span>
                ) : (
                  <span className="text-amber-500/90">
                    {"// "}
                    {errors[0]
                      ? L(errors[0].en, errors[0].fa)
                      : L("Fill the steps above to forge your link…", "مرحله‌های بالا را پر کنید تا لینک ساخته شود…")}
                    {typing && (
                      <span className="inline-block w-1.5 h-3.5 align-middle bg-amber-500 animate-pulse ms-0.5" />
                    )}
                  </span>
                )}
              </pre>
            </div>

            {/* QR + actions */}
            <div className="mt-5 flex flex-col md:flex-row gap-5 items-start">
              {/* QR card */}
              <div
                className={cn(
                  "flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 shrink-0",
                  qr
                    ? "dark:border-emerald-500/30 dark:bg-surface-950/60 light:bg-white light:border-surface-200"
                    : "dark:border-surface-700/40 dark:bg-surface-900/30 opacity-50 light:bg-surface-100 light:border-surface-200",
                )}
              >
                <div className="w-36 h-36 rounded-xl bg-white p-2 flex items-center justify-center overflow-hidden">
                  {qr ? (
                    <img src={qr} alt="QR" className="w-full h-full pop-in" />
                  ) : (
                    <QrCode className="w-10 h-10 text-surface-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold dark:text-surface-200 light:text-ink-700 mb-1">
                    <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                    {L("Scan from any client", "با هر کلاینتی اسکن کنید")}
                  </div>
                  <p className="text-[10px] leading-relaxed dark:text-surface-500 light:text-surface-400 mb-2.5">
                    {L("The QR updates live as you type.", "بارکد همزمان با تایپ شما به‌روز می‌شود.")}
                  </p>
                  <button
                    onClick={handleSavePng}
                    disabled={!qr}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40",
                      "bg-emerald-500/90 hover:bg-emerald-500 text-black",
                    )}
                  >
                    <Download className="w-3 h-3" />
                    {L("Save PNG", "ذخیره PNG")}
                  </button>
                </div>
              </div>

              {/* action column */}
              <div className="flex-1 min-w-0 w-full">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleAdd}
                    disabled={!linkValid}
                    className={cn(
                      "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all duration-300",
                      "bg-gradient-to-r from-emerald-500 to-green-600 text-black/80",
                      "hover:from-emerald-400 hover:to-green-500 hover:scale-105 active:scale-100",
                      "shadow-lg shadow-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none",
                    )}
                  >
                    <Zap className="w-4 h-4" />
                    {L("Add to MEMENTO", "افزودن به MEMENTO")}
                  </button>
                  <button
                    onClick={handleCopyLink}
                    disabled={!link}
                    className={cn(
                      "flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold border transition-all",
                      "dark:bg-surface-800/60 dark:text-surface-300 dark:border-surface-700/60 dark:hover:border-emerald-500/40 dark:hover:text-white",
                      "light:bg-white light:text-surface-600 light:border-surface-200 light:hover:text-surface-900",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                    )}
                  >
                    {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {L("Copy link", "کپی لینک")}
                  </button>
                </div>

                {/* inline validation state */}
                {!linkValid && errors[0] && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-amber-500 pop-in">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                    <div className="min-w-0">
                      <p>{L(errors[0].en, errors[0].fa)}</p>
                      {errors.length > 1 && (
                        <p className="text-[10px] mt-0.5 dark:text-surface-500 light:text-surface-400">
                          {L(`${errors.length - 1} more item(s) to fix`, `${errors.length - 1} مورد دیگر برای اصلاح`)}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {linkValid && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400 pop-in">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {L("All set — this link is valid and ready to import.", "همه‌چیز آماده است — این لینک معتبر است و می‌توانید واردش کنید.")}
                  </div>
                )}
              </div>
            </div>
          </GroupCard>
        </div>
      </div>
    </div>
  );
}
