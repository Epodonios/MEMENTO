// Utilities for editing V2Ray config links: replace IP/host and port

export type Protocol = "vmess" | "vless" | "trojan" | "ss" | "ssr" | "hysteria2" | "hy2" | "tuic" | "unknown";

export function detectProtocol(link: string): Protocol {
  const t = link.trim();
  if (t.startsWith("vmess://")) return "vmess";
  if (t.startsWith("vless://")) return "vless";
  if (t.startsWith("trojan://")) return "trojan";
  if (t.startsWith("ssr://")) return "ssr";
  if (t.startsWith("ss://")) return "ss";
  if (t.startsWith("hysteria2://")) return "hysteria2";
  if (t.startsWith("hy2://")) return "hy2";
  if (t.startsWith("tuic://")) return "tuic";
  return "unknown";
}

function b64encode(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(str);
  }
}

function b64decode(str: string): string {
  let padded = str;
  if (padded.length % 4 > 0) padded += "=".repeat(4 - (padded.length % 4));
  try {
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return atob(padded);
  }
}

export interface EditOptions {
  newAddress?: string; // if set, replace host/ip
  newPort?: string;    // if set, replace port
  appendName?: string; // optional text to append to remark/name
}

/**
 * Edit a single V2Ray link's address and/or port.
 * Returns the rebuilt link, or the original link on failure.
 */
export function editLink(link: string, opts: EditOptions): string {
  const trimmed = link.trim();
  if (!trimmed) return link;

  const proto = detectProtocol(trimmed);

  try {
    switch (proto) {
      case "vmess":
        return editVmess(trimmed, opts);
      case "vless":
      case "trojan":
      case "hysteria2":
      case "hy2":
      case "tuic":
        return editUserAtHost(trimmed, opts);
      case "ss":
        return editSS(trimmed, opts);
      case "ssr":
        return editSSR(trimmed, opts);
      default:
        return link;
    }
  } catch {
    return link;
  }
}

function applyName(name: string, append?: string): string {
  if (!append) return name;
  return name ? `${name}${append}` : append.replace(/^\s*[-|·]\s*/, "");
}

function editVmess(link: string, opts: EditOptions): string {
  const encoded = link.replace("vmess://", "");
  const json = b64decode(encoded);
  const obj = JSON.parse(json);

  if (opts.newAddress) obj.add = opts.newAddress;
  if (opts.newPort) obj.port = opts.newPort;
  if (opts.appendName) obj.ps = applyName(obj.ps || "", opts.appendName);

  return "vmess://" + b64encode(JSON.stringify(obj));
}

/**
 * Handles vless://, trojan://, hysteria2://, tuic:// which all share:
 *   scheme://CREDENTIALS@HOST:PORT?query#name
 */
function editUserAtHost(link: string, opts: EditOptions): string {
  const schemeMatch = link.match(/^([a-z0-9]+:\/\/)/i);
  const scheme = schemeMatch ? schemeMatch[1] : "";
  let rest = link.slice(scheme.length);

  // Extract fragment (name)
  let fragment = "";
  const hashIdx = rest.lastIndexOf("#");
  if (hashIdx > -1) {
    fragment = rest.slice(hashIdx + 1);
    rest = rest.slice(0, hashIdx);
  }

  // Extract query
  let query = "";
  const qIdx = rest.indexOf("?");
  if (qIdx > -1) {
    query = rest.slice(qIdx); // includes leading ?
    rest = rest.slice(0, qIdx);
  }

  // rest = CREDENTIALS@HOST:PORT
  const atIdx = rest.lastIndexOf("@");
  const creds = atIdx > -1 ? rest.slice(0, atIdx + 1) : ""; // includes @
  let hostPort = atIdx > -1 ? rest.slice(atIdx + 1) : rest;

  // hostPort may be ipv6 in brackets: [::1]:443
  let host = "";
  let port = "";
  if (hostPort.startsWith("[")) {
    const closeIdx = hostPort.indexOf("]");
    host = hostPort.slice(0, closeIdx + 1);
    const after = hostPort.slice(closeIdx + 1);
    if (after.startsWith(":")) port = after.slice(1);
  } else {
    const colonIdx = hostPort.lastIndexOf(":");
    if (colonIdx > -1) {
      host = hostPort.slice(0, colonIdx);
      port = hostPort.slice(colonIdx + 1);
    } else {
      host = hostPort;
    }
  }

  if (opts.newAddress) host = formatHost(opts.newAddress);
  if (opts.newPort) port = opts.newPort;

  hostPort = port ? `${host}:${port}` : host;

  // Rebuild name
  let newFragment = fragment;
  if (opts.appendName) {
    const decoded = fragment ? decodeURIComponent(fragment) : "";
    newFragment = encodeURIComponent(applyName(decoded, opts.appendName));
  }

  let result = scheme + creds + hostPort + query;
  if (newFragment) result += "#" + newFragment;
  return result;
}

function formatHost(addr: string): string {
  // wrap raw ipv6 in brackets if it contains colons and isn't already bracketed
  if (addr.includes(":") && !addr.startsWith("[")) {
    return `[${addr}]`;
  }
  return addr;
}

function editSS(link: string, opts: EditOptions): string {
  let rest = link.replace("ss://", "");

  // fragment
  let fragment = "";
  const hashIdx = rest.lastIndexOf("#");
  if (hashIdx > -1) {
    fragment = rest.slice(hashIdx + 1);
    rest = rest.slice(0, hashIdx);
  }

  // query (plugin opts)
  let query = "";
  const qIdx = rest.indexOf("?");
  if (qIdx > -1) {
    query = rest.slice(qIdx);
    rest = rest.slice(0, qIdx);
  }

  if (rest.includes("@")) {
    // SIP002 format: base64(method:pass)@host:port
    const atIdx = rest.lastIndexOf("@");
    const creds = rest.slice(0, atIdx + 1);
    let hostPort = rest.slice(atIdx + 1);
    const { host, port } = splitHostPort(hostPort);
    const newHost = opts.newAddress ? formatHost(opts.newAddress) : host;
    const newPort = opts.newPort || port;
    hostPort = newPort ? `${newHost}:${newPort}` : newHost;

    let newFragment = fragment;
    if (opts.appendName) {
      const decoded = fragment ? decodeURIComponent(fragment) : "";
      newFragment = encodeURIComponent(applyName(decoded, opts.appendName));
    }

    let result = "ss://" + creds + hostPort + query;
    if (newFragment) result += "#" + newFragment;
    return result;
  } else {
    // legacy base64: base64(method:pass@host:port)
    const decoded = b64decode(rest);
    const atIdx = decoded.lastIndexOf("@");
    const credPart = decoded.slice(0, atIdx + 1);
    const { host, port } = splitHostPort(decoded.slice(atIdx + 1));
    const newHost = opts.newAddress || host;
    const newPort = opts.newPort || port;
    const rebuilt = `${credPart}${newHost}:${newPort}`;

    let newFragment = fragment;
    if (opts.appendName) {
      const decFrag = fragment ? decodeURIComponent(fragment) : "";
      newFragment = encodeURIComponent(applyName(decFrag, opts.appendName));
    }

    let result = "ss://" + b64encode(rebuilt) + query;
    if (newFragment) result += "#" + newFragment;
    return result;
  }
}

function editSSR(link: string, opts: EditOptions): string {
  const encoded = link.replace("ssr://", "");
  const decoded = b64decode(encoded);
  // server:port:protocol:method:obfs:base64pass/?params
  const slashIdx = decoded.indexOf("/?");
  const core = slashIdx > -1 ? decoded.slice(0, slashIdx) : decoded;
  const tail = slashIdx > -1 ? decoded.slice(slashIdx) : "";

  const parts = core.split(":");
  if (parts.length < 6) return "ssr://" + encoded;

  if (opts.newAddress) parts[0] = opts.newAddress;
  if (opts.newPort) parts[1] = opts.newPort;

  const rebuilt = parts.join(":") + tail;
  return "ssr://" + b64encode(rebuilt);
}

function splitHostPort(hostPort: string): { host: string; port: string } {
  if (hostPort.startsWith("[")) {
    const closeIdx = hostPort.indexOf("]");
    const host = hostPort.slice(0, closeIdx + 1);
    const after = hostPort.slice(closeIdx + 1);
    const port = after.startsWith(":") ? after.slice(1) : "";
    return { host, port };
  }
  const colonIdx = hostPort.lastIndexOf(":");
  if (colonIdx === -1) return { host: hostPort, port: "" };
  return { host: hostPort.slice(0, colonIdx), port: hostPort.slice(colonIdx + 1) };
}

/* ----------------- IP RANGE EXPANSION ----------------- */

/**
 * Parse an IP range input. Supports:
 *  - CIDR: 1.2.3.0/24
 *  - Range: 1.2.3.1-1.2.3.50  or 1.2.3.1-50
 *  - Comma / newline separated list of IPs or hosts
 * Returns a flat array of IP/host strings (capped to maxCount).
 */
export function expandIpRange(input: string, maxCount = 5000): string[] {
  const results: string[] = [];
  const tokens = input
    .split(/[\n,]+/)
    .map(t => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (results.length >= maxCount) break;

    if (token.includes("/")) {
      // CIDR
      const cidrIps = expandCIDR(token, maxCount - results.length);
      results.push(...cidrIps);
    } else if (token.includes("-")) {
      const rangeIps = expandDashRange(token, maxCount - results.length);
      results.push(...rangeIps);
    } else {
      results.push(token);
    }
  }

  return results.slice(0, maxCount);
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let val = 0;
  for (const p of parts) {
    const n = Number(p);
    if (isNaN(n) || n < 0 || n > 255) return null;
    val = val * 256 + n;
  }
  return val >>> 0;
}

function intToIp(int: number): string {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255,
  ].join(".");
}

function expandCIDR(cidr: string, limit: number): string[] {
  const [base, maskStr] = cidr.split("/");
  const mask = Number(maskStr);
  const baseInt = ipToInt(base);
  if (baseInt === null || isNaN(mask) || mask < 0 || mask > 32) return [];

  const hostBits = 32 - mask;
  const count = Math.min(Math.pow(2, hostBits), limit);
  const networkInt = (baseInt & (mask === 0 ? 0 : (0xffffffff << hostBits))) >>> 0;

  const ips: string[] = [];
  for (let i = 0; i < count; i++) {
    ips.push(intToIp((networkInt + i) >>> 0));
  }
  return ips;
}

function expandDashRange(range: string, limit: number): string[] {
  const [startStr, endStr] = range.split("-").map(s => s.trim());
  const startInt = ipToInt(startStr);
  if (startInt === null) return [];

  let endInt: number | null;
  if (endStr.includes(".")) {
    endInt = ipToInt(endStr);
  } else {
    // shorthand like 1.2.3.1-50 -> last octet end
    const lastOctet = Number(endStr);
    if (isNaN(lastOctet)) return [];
    endInt = (startInt & 0xffffff00) + lastOctet;
  }
  if (endInt === null || endInt < startInt) return [];

  const count = Math.min(endInt - startInt + 1, limit);
  const ips: string[] = [];
  for (let i = 0; i < count; i++) {
    ips.push(intToIp((startInt + i) >>> 0));
  }
  return ips;
}
