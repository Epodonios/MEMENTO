/**
 * MEMENTO — geo data files (Phase C3, items 1+2).
 *
 * Routing rules that reference geo categories (geosite:category-ir,
 * geoip:ir, category-ads-all — and sing-box's .srs rule-set twins) need
 * DATA FILES on disk, and a missing file is FATAL at xray startup (the
 * "connects then dies in 2s" symptom class documented in v2rayConfig.ts).
 * This module owns the honest lifecycle:
 *
 *   geoStatus()  — what exists right now (per file, with byte sizes),
 *   geoEnsure()  — download whatever is missing (or force-refresh), with
 *                  size sanity checks and atomic tmp+rename writes.
 *
 * Sources (pinned, same philosophy as core-versions.json):
 *   - Xray geoip.dat / geosite.dat: the official XTLS Xray-core release
 *     assets for the PINNED core version — the exact files download.ts
 *     already best-effort fetches; here the download is explicit and
 *     verified (non-best-effort), because geo rules depend on them.
 *   - sing-box .srs rule-sets: MetaCubeX/meta-rules-dat "sing" branch
 *     (community standard distribution). Verified live: geosite
 *     "category-ir.srs" + geoip "ir.srs" (a bare "ir.srs" geosite does
 *     NOT exist — mirrors the Xray-side category naming).
 *
 * Files land in dataDir() (Xray reads XRAY_LOCATION_ASSET=dataDir) and
 * dataDir()/sing-box/ for .srs (absolute paths are baked into configs at
 * generation time).
 */
import fs from "fs";
import path from "path";
import { XRAY_VERSION, dataDir } from "./paths";

/* ------------------------------------------------------------------ */
/*  Pinned sources                                                     */
/* ------------------------------------------------------------------ */

const XRAY_GEO_URLS: Record<string, string> = {
  "geoip.dat": `https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/geoip.dat`,
  "geosite.dat": `https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/geosite.dat`,
};

const SRS_URLS: Record<string, string> = {
  "geosite-ir.srs": "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/category-ir.srs",
  "geoip-ir.srs": "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geoip/ir.srs",
  "geosite-category-ads-all.srs": "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/category-ads-all.srs",
};

/** Smallest real files observed live (geoip-ir.srs = 14,023 B). A download
 *  under this is an error page / truncated response, never a dataset. */
const MIN_BYTES: Record<string, number> = {
  "geoip.dat": 1024 * 1024,      // observed: ~15.3 MB
  "geosite.dat": 512 * 1024,     // observed: ~2.2 MB
  "geosite-ir.srs": 512,         // observed: 1,496 B
  "geoip-ir.srs": 4096,          // observed: 14,023 B
  "geosite-category-ads-all.srs": 100 * 1024, // ads-all is a LARGE category
};

export interface GeoFileInfo {
  present: boolean;
  bytes: number;
}

export interface GeoStatus {
  /** Xray asset dir (= dataDir) with geoip.dat / geosite.dat. */
  xrayDir: string;
  xray: Record<string, GeoFileInfo>;
  /** sing-box .srs dir (= dataDir/sing-box) + its files. */
  srsDir: string;
  srs: Record<string, GeoFileInfo>;
}

function srsDir(): string {
  return path.join(dataDir(), "sing-box");
}

function statFile(p: string): GeoFileInfo {
  try {
    const st = fs.statSync(p);
    return { present: st.isFile() && st.size > 0, bytes: st.isFile() ? st.size : 0 };
  } catch {
    return { present: false, bytes: 0 };
  }
}

export function geoStatus(): GeoStatus {
  const xd = dataDir();
  const sd = srsDir();
  const xray: Record<string, GeoFileInfo> = {};
  for (const name of Object.keys(XRAY_GEO_URLS)) xray[name] = statFile(path.join(xd, name));
  const srs: Record<string, GeoFileInfo> = {};
  for (const name of Object.keys(SRS_URLS)) srs[name] = statFile(path.join(sd, name));
  return { xrayDir: xd, xray, srsDir: sd, srs };
}

/* ------------------------------------------------------------------ */
/*  Download + install                                                 */
/* ------------------------------------------------------------------ */

async function fetchToFile(url: string, dest: string, minBytes: number): Promise<number> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (bytes.length < minBytes) {
    throw new Error(`Downloaded file is too small (${bytes.length} B < ${minBytes} B) — refusing to install a corrupt/truncated geo dataset`);
  }
  // Atomic install: write next to the target, then rename over it.
  const tmp = `${dest}.memento-tmp`;
  fs.writeFileSync(tmp, bytes);
  try {
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    throw e;
  }
  return bytes.length;
}

export type GeoFamily = "xray" | "srs";

/**
 * Download missing files for one family (or all when name omitted).
 * "force" re-downloads even present files (an explicit user "Update").
 * Returns the refreshed status; never throws for per-file network errors —
 * the per-file error is reported in the returned errors map so the UI can
 * show exactly which file failed.
 */
export async function geoEnsure(
  family: GeoFamily,
  opts: { force?: boolean; name?: string } = {}
): Promise<{ status: GeoStatus; errors: Record<string, string> }> {
  const urls = family === "xray" ? XRAY_GEO_URLS : SRS_URLS;
  const dir = family === "xray" ? dataDir() : srsDir();
  fs.mkdirSync(dir, { recursive: true });

  const errors: Record<string, string> = {};
  for (const [name, url] of Object.entries(urls)) {
    if (opts.name && opts.name !== name) continue;
    const dest = path.join(dir, name);
    const cur = statFile(dest);
    if (cur.present && !opts.force) continue;
    try {
      await fetchToFile(url, dest, MIN_BYTES[name] ?? 1024);
    } catch (e) {
      errors[name] = String((e as Error)?.message || e);
    }
  }
  return { status: geoStatus(), errors };
}
