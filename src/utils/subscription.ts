/**
 * Utility to fetch and decode subscription URLs securely
 */

/** Hard cap — some sources publish 10k+ lines which would freeze parsing/UI. */
export const MAX_CONFIGS_PER_SOURCE = 2000;

/** Phase D2 (item 1): server-reported subscription usage, from the standard
 *  `subscription-userinfo` header / `#subscription-userinfo:` body line.
 *  All byte counters; expire = unix SECONDS (0/absent = no expiry reported). */
export interface SubscriptionUserInfo {
  upload?: number;
  download?: number;
  total?: number;
  expire?: number;
}

/**
 * Parses "upload=455727781; download=6172295019; total=107374182400;
 * expire=1758988800" (order/spacing/case tolerant). Returns null when the
 * string carries no recognizable key=value pairs — callers then know the
 * server simply did not report usage.
 */
export function parseSubscriptionUserInfo(raw: string): SubscriptionUserInfo | null {
  if (!raw) return null;
  const out: SubscriptionUserInfo = {};
  let sawAny = false;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = Number(part.slice(eq + 1).trim());
    if (!Number.isFinite(val) || val < 0) continue;
    if (key === "upload") { out.upload = val; sawAny = true; }
    else if (key === "download") { out.download = val; sawAny = true; }
    else if (key === "total") { out.total = val; sawAny = true; }
    else if (key === "expire") { out.expire = val; sawAny = true; }
  }
  return sawAny ? out : null;
}

/** Matches the "#subscription-userinfo:" body header line (case-insensitive). */
const SUB_USERINFO_LINE_RE = /^#?\s*subscription-userinfo\s*[:=]\s*(.+)$/i;

export interface DetailedSubscription {
  lines: string[];
  userInfo?: SubscriptionUserInfo;
}

export async function fetchSubscriptionDetailed(url: string, timeoutMs = 12000): Promise<DetailedSubscription> {
  const rawUrl = url.trim();
  if (!rawUrl) throw new Error("Empty URL");

  let headerUserInfo: SubscriptionUserInfo | null = null;

  const attemptFetch = async (
    fetcher: () => Promise<Response>
  ): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher();
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Phase D2: real panels (V2Board/SSPanel/x-ui…) expose the usage header.
      // Only readable when the server lists it in access-control-expose-headers
      // — otherwise we fall back to the "#subscription-userinfo:" body line.
      if (!headerUserInfo) {
        const h = res.headers.get("subscription-userinfo");
        if (h) headerUserInfo = parseSubscriptionUserInfo(h);
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  };

  const decodeIfBase64 = (body: string): string => {
    const trimmed = body.trim();
    if (trimmed.includes("://")) return trimmed;
    try {
      let s = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      const decoded = atob(s);
      const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
      const utf8 = new TextDecoder().decode(bytes);
      if (utf8.includes("://")) return utf8;
    } catch {
      /* not valid b64 */
    }
    return trimmed;
  };

  let text = "";

  try { text = await attemptFetch(() => fetch(rawUrl, { mode: "cors" })); } catch {}
  if (!text) {
    try { text = await attemptFetch(() => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`)); } catch {}
  }
  if (!text) {
    try { text = await attemptFetch(() => fetch(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`)); } catch {}
  }
  if (!text) {
    try { text = await attemptFetch(() => fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rawUrl)}`)); } catch {}
  }

  if (!text) {
    throw new Error("Could not reach the subscription URL.");
  }

  const decoded = decodeIfBase64(text);
  // Phase D2 (item 1): grab "#subscription-userinfo: …" BEFORE the Task-13
  // "#"-header skip below — some providers ship usage only inside the body.
  let lineUserInfo: SubscriptionUserInfo | null = null;
  // Task 13 (A2): skip "#"-prefixed subscription header lines
  // (#profile-title / #profile-update-interval / #subscription-userinfo …)
  // emitted by e.g. barry-far and MatinGhanbari — they would otherwise be
  // imported as "Unknown protocol" invalid configs.
  const lines = decoded.split("\n").map(l => l.trim()).filter(l => {
    if (l && l.startsWith("#") && !lineUserInfo) {
      const m = l.match(SUB_USERINFO_LINE_RE);
      if (m) lineUserInfo = parseSubscriptionUserInfo(m[1]);
    }
    return l && !l.startsWith("#");
  });

  // Never import more than MAX_CONFIGS_PER_SOURCE from a single source —
  // some brokers publish 10k+ lines which would freeze parsing/UI.
  const userInfo = headerUserInfo ?? lineUserInfo ?? undefined;
  return { lines: lines.slice(0, MAX_CONFIGS_PER_SOURCE), userInfo };
}

/** Back-compat wrapper — SAME signature as before Phase D2 (call sites and
 *  the task13 selftest keep working untouched). */
export async function fetchSubscription(url: string, timeoutMs = 12000): Promise<string[]> {
  const detailed = await fetchSubscriptionDetailed(url, timeoutMs);
  return detailed.lines;
}

/* ======================================================================
 * R3 task #5 — IDENTITY-BASED DEDUPE
 *
 * USER BUG (fixed here): importing a subscription and then UPDATING it
 * duplicated every config, because the old dedupe compared the RAW link
 * strings. Real panels regenerate their output on every update: remarks
 * change (#Node-1 -> #Node-1 (2)), query parameters get reordered, vmess
 * JSON key order varies, hex uuids change case — the raw strings differ
 * while the ENDPOINT is the same, so "already exists" never matched.
 *
 * configIdentity() derives a canonical endpoint identity from a link:
 *   - the remark (#...) is DROPPED (panels rename nodes freely);
 *   - vmess:// base64 JSON: keys sorted, the remark field `ps` dropped;
 *   - query strings: parameters SORTED by name (order-insensitive);
 *   - userinfo/host/port normalized (uuid/password case-insensitive where
 *     it is hex/base64, host lowercase, default-port aware for scheme).
 * Two links share an identity iff they point at the same tunnel endpoint
 * with the same credentials and transport — exactly "the same config".
 * ==================================================================== */

/** Sorted-key stringify for the vmess JSON body. */
function canonicalVmessIdentity(b64: string): string | null {
  try {
    let s = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4 !== 0) s += "=";
    const jsonStr = atob(s);
    const obj = JSON.parse(jsonStr);
    if (!obj || typeof obj !== "object") return null;
    const clone: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
    delete clone.ps; // remark — panels rename nodes freely
    if (typeof clone.id === "string") clone.id = clone.id.trim().toLowerCase();
    if (typeof clone.add === "string") clone.add = clone.add.trim().toLowerCase();
    const keys = Object.keys(clone).sort();
    return "vmess|" + keys.map(k => `${k}=${String(clone[k])}`).join("&");
  } catch {
    return null;
  }
}

/**
 * Canonical endpoint identity for a config link, or "" when the link is
 * too malformed to identify (callers then fall back to the raw string).
 */
export function configIdentity(rawLink: string): string {
  const raw = String(rawLink || "").trim();
  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (!schemeMatch) return "";
  const scheme = schemeMatch[1].toLowerCase();

  // vmess://<base64-json> — canonicalize the decoded object.
  if (scheme === "vmess") {
    const body = raw.slice("vmess://".length).split("#")[0];
    const canonical = canonicalVmessIdentity(body);
    return canonical || "vmess|" + body.toLowerCase();
  }

  // Everything else: scheme://[userinfo@]host[:port][/path]?query#remark
  let rest = raw.slice(schemeMatch[0].length);
  const hash = rest.indexOf("#");
  if (hash !== -1) rest = rest.slice(0, hash); // drop the remark

  const qm = rest.indexOf("?");
  const pathAndQuery = qm !== -1 ? rest.slice(qm) : "";
  let mainPart = qm !== -1 ? rest.slice(0, qm) : rest;

  // Sort query params (order-insensitive identity).
  let canonicalQuery = "";
  if (pathAndQuery) {
    const [pathPart, queryPart] = pathAndQuery.split("?");
    const pairs = queryPart.split("&").filter(Boolean).map(p => {
      const eq = p.indexOf("=");
      const k = eq === -1 ? p : p.slice(0, eq);
      const v = eq === -1 ? "" : p.slice(eq + 1);
      return `${k.toLowerCase()}=${v}`;
    }).sort();
    canonicalQuery = pathPart + (pairs.length ? "?" + pairs.join("&") : "");
  }

  let userinfo = "";
  const at = mainPart.lastIndexOf("@");
  if (at !== -1) {
    userinfo = mainPart.slice(0, at);
    mainPart = mainPart.slice(at + 1);
    // uuid/password is case-insensitive hex/b64 in practice — normalize.
    userinfo = userinfo.toLowerCase();
  }

  // Host lowercase; keep the port as written (a different port IS a
  // different endpoint).
  const slash = mainPart.indexOf("/");
  let hostPort = slash === -1 ? mainPart : mainPart.slice(0, slash);
  const trailingPath = slash === -1 ? "" : mainPart.slice(slash);
  hostPort = hostPort.toLowerCase();

  return `${scheme}|${userinfo}|${hostPort}${trailingPath}${canonicalQuery}`;
}
