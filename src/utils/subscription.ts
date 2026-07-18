/**
 * Utility to fetch and decode subscription URLs securely
 */

/** Hard cap — some sources publish 10k+ lines which would freeze parsing/UI. */
export const MAX_CONFIGS_PER_SOURCE = 2000;

export async function fetchSubscription(url: string, timeoutMs = 12000): Promise<string[]> {
  const rawUrl = url.trim();
  if (!rawUrl) throw new Error("Empty URL");

  const attemptFetch = async (
    fetcher: () => Promise<Response>
  ): Promise<string> => {
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
  const lines = decoded.split("\n").map(l => l.trim()).filter(Boolean);

  // Never import more than MAX_CONFIGS_PER_SOURCE from a single source —
  // some brokers publish 10k+ lines which would freeze parsing/UI.
  return lines.slice(0, MAX_CONFIGS_PER_SOURCE);
}
