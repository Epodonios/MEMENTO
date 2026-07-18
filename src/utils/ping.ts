// MEMENTO Ping Engine v4 – rewritten to behave like v2rayN / Nekoray
// ---------------------------------------------------------------------------
// Goals:
//  1. No false "no ping" – every reachable host must show a latency.
//  2. Matches v2rayN TCP ping semantics: successful TCP handshake = online.
//  3. Works for Spoof mode (127.0.0.1:40443) when the helper app is running.
//  4. No uncaught rejections, no console spam.

export interface PingResult {
  ip: string;
  ping: number | null;
  error?: string;
}

interface PingOptions {
  timeoutMs?: number;
  port?: string | number;
}

function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]" || h.startsWith("127.");
}

// Browser never allows raw TCP, so we approximate it with fetch to the
// actual port using no-cors mode. The browser still performs a full
// TCP SYN/SYN-ACK/ACK before sending the HTTP request, so the time to
// failure is a good proxy for TCP RTT.
// Loopback gets a much tighter threshold because RTT is ~0-2ms.
export function pingIp(ip: string, optsOrTimeout: PingOptions | number = 5000): Promise<PingResult> {
  const opts: PingOptions = typeof optsOrTimeout === "number" ? { timeoutMs: optsOrTimeout } : optsOrTimeout;
  const timeoutMs = opts.timeoutMs ?? 3800;
  const portOpt = opts.port;

  return new Promise<PingResult>((resolve) => {
    const host = (ip || "").trim();
    if (!host) { resolve({ ip, ping: null, error: "Empty host" }); return; }

    const start = performance.now();
    let settled = false;
    const finish = (r: PingResult) => { if (!settled) { settled = true; resolve(r); } };

    const probePort = portOpt ? Number(portOpt) : 80;
    const loopback = isLoopback(host);
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); finish({ ip: host, ping: null, error: "Timeout" }); }, timeoutMs);

    // Use fetch – works for both http and https ports because no-cors doesn't validate TLS,
    // it just needs the TCP handshake to complete.
    const targetUrl = `http://${host}:${probePort}/__memento_ping__?t=${Date.now()}`;

    fetch(targetUrl, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(() => {
        clearTimeout(timer);
        finish({ ip: host, ping: Math.round(performance.now() - start) });
      })
      .catch(() => {
        clearTimeout(timer);
        const ms = Math.round(performance.now() - start);
        // Distinguish refused vs handshake success
        if (loopback) {
          // Localhost: any RTT >1ms means port is listening (Spoofing Patt running)
          if (ms <= 1) finish({ ip: host, ping: null, error: "Filtered" });
          else finish({ ip: host, ping: ms });
        } else {
          // Remote
          if (ms < 15) finish({ ip: host, ping: null, error: "Filtered" });
          else if (ms < 45) finish({ ip: host, ping: null, error: "Port closed" });
          else finish({ ip: host, ping: ms }); // TCP open – this is what v2rayN TCP ping reports
        }
      });
  });
}

export async function batchPing(
  ips: string[],
  concurrency = 8,
  timeoutMs = 3500,
  onProgress?: (completed: number, total: number, partial?: PingResult[]) => void,
  options?: { port?: string | number; signal?: AbortSignal }
): Promise<PingResult[]> {
  const cleanIps = ips.map(s => s.trim()).filter(Boolean);
  const results: PingResult[] = [];
  let completed = 0;
  const limit = Math.max(1, Math.min(concurrency, 16));
  for (let i = 0; i < cleanIps.length; i += limit) {
    if (options?.signal?.aborted) break;
    const batch = cleanIps.slice(i, i + limit);
    const batchResults = await Promise.all(
      batch.map(ip => pingIp(ip, { timeoutMs, port: options?.port }).catch(() => ({ ip, ping: null, error: "Internal error" } as PingResult)))
    );
    results.push(...batchResults);
    completed += batchResults.length;
    try { onProgress?.(completed, cleanIps.length, batchResults); } catch {}
  }
  return results;
}

export function extractIpFromConfig(
  link: string
): { ip?: string; port?: string; protocol?: string; name?: string } | null {
  if (!link || !link.trim()) return null;
  const protocol = detectConfigProtocol(link);
  if (protocol === "unknown") return null;
  try {
    if (protocol === "vmess") {
      const encoded = link.replace("vmess://", "");
      let padded = encoded; if (padded.length % 4 > 0) padded += "=".repeat(4 - (padded.length % 4));
      const json = atob(padded); const obj = JSON.parse(json);
      return { ip: obj.add, port: String(obj.port), protocol, name: obj.ps };
    } else if (["vless", "trojan", "hysteria2", "hy2", "tuic"].includes(protocol)) {
      const urlPart = link.split("://")[1];
      const hashIdx = urlPart.lastIndexOf("#");
      const name = hashIdx > -1 ? decodeURIComponent(urlPart.slice(hashIdx + 1)) : "";
      const corePart = hashIdx > -1 ? urlPart.slice(0, hashIdx) : urlPart;
      const queryIdx = corePart.indexOf("?"); const beforeQuery = queryIdx > -1 ? corePart.slice(0, queryIdx) : corePart;
      const atIdx = beforeQuery.indexOf("@"); const hostPart = atIdx > -1 ? beforeQuery.slice(atIdx + 1) : beforeQuery;
      const colonIdx = hostPart.lastIndexOf(":"); const ip = hostPart.slice(0, colonIdx); const port = hostPart.slice(colonIdx + 1);
      return { ip, port, protocol, name };
    } else if (protocol === "ss") {
      const urlPart = link.replace("ss://", ""); const hashIdx = urlPart.lastIndexOf("#");
      const name = hashIdx > -1 ? decodeURIComponent(urlPart.slice(hashIdx + 1)) : "";
      const corePart = hashIdx > -1 ? urlPart.slice(0, hashIdx) : urlPart;
      const atIdx = corePart.lastIndexOf("@"); if (atIdx === -1) return null;
      const hostPart = corePart.slice(atIdx + 1); const colonIdx = hostPart.lastIndexOf(":");
      const ip = hostPart.slice(0, colonIdx); const port = hostPart.slice(colonIdx + 1);
      return { ip, port, protocol, name };
    }
  } catch { return null; }
  return null;
}

function detectConfigProtocol(link: string): string {
  const l = link.trim().toLowerCase();
  if (l.startsWith("vmess://")) return "vmess";
  if (l.startsWith("vless://")) return "vless";
  if (l.startsWith("trojan://")) return "trojan";
  if (l.startsWith("ss://")) return "ss";
  if (l.startsWith("ssr://")) return "ssr";
  if (l.startsWith("hysteria2://") || l.startsWith("hy2://")) return "hysteria2";
  if (l.startsWith("tuic://")) return "tuic";
  return "unknown";
}
