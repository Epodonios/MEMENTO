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

// ../scripts/task13-subentry.ts
var task13_subentry_exports = {};
__export(task13_subentry_exports, {
  fetchSubscription: () => fetchSubscription
});
module.exports = __toCommonJS(task13_subentry_exports);

// src/utils/subscription.ts
var MAX_CONFIGS_PER_SOURCE = 2e3;
async function fetchSubscription(url, timeoutMs = 12e3) {
  const rawUrl = url.trim();
  if (!rawUrl) throw new Error("Empty URL");
  const attemptFetch = async (fetcher) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher();
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  };
  const decodeIfBase64 = (body) => {
    const trimmed = body.trim();
    if (trimmed.includes("://")) return trimmed;
    try {
      let s = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      const decoded2 = atob(s);
      const bytes = Uint8Array.from(decoded2, (c) => c.charCodeAt(0));
      const utf8 = new TextDecoder().decode(bytes);
      if (utf8.includes("://")) return utf8;
    } catch {
    }
    return trimmed;
  };
  let text = "";
  try {
    text = await attemptFetch(() => fetch(rawUrl, { mode: "cors" }));
  } catch {
  }
  if (!text) {
    try {
      text = await attemptFetch(() => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`));
    } catch {
    }
  }
  if (!text) {
    try {
      text = await attemptFetch(() => fetch(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`));
    } catch {
    }
  }
  if (!text) {
    try {
      text = await attemptFetch(() => fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rawUrl)}`));
    } catch {
    }
  }
  if (!text) {
    throw new Error("Could not reach the subscription URL.");
  }
  const decoded = decodeIfBase64(text);
  const lines = decoded.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return lines.slice(0, MAX_CONFIGS_PER_SOURCE);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fetchSubscription
});
