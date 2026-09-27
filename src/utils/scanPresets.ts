/**
 * scanPresets.ts — the v3 scanner's built-in target catalog.
 *
 * The scanner's "nature" (per the 3.1.6 rebuild brief): one-click provider
 * target groups — Cloudflare, Google, Vercel, AWS CloudFront, Azure,
 * Oracle, DigitalOcean, Hetzner, GitHub, ArvanCloud, public DNS anycast —
 * plus the user's own list. Selecting a preset toggles its published CIDR
 * blocks into the target textarea (the textarea stays the single source of
 * truth, so the user can trim any block before scanning).
 *
 * Every list is curated to stay inside the scanner's 65,536-host cap
 * (MAX_SCAN_HOSTS in the main-process engine) while covering the ranges
 * the CDN/subscription community actually probes. hostCount() is exact
 * (2^(32-prefix) - 2 for CIDR, inclusive dash arithmetic for ranges).
 */

export interface ScanTargetPreset {
  id: string;
  nameEn: string;
  nameFa: string;
  noteEn: string;
  noteFa: string;
  /** Tailwind accent gradient for the chip icon tile. */
  accent: string;
  ranges: string[];
}

export const SCAN_PRESETS: ScanTargetPreset[] = [
  {
    id: "cloudflare",
    nameEn: "Cloudflare",
    nameFa: "کلودفلر",
    noteEn: "CDN edge networks — the classic ranges for scanning clean vless/vmess IPs.",
    noteFa: "شبکه‌های لبه CDN — بازه‌های کلاسیک برای پیدا کردن آی‌پی تمیز vless/vmess.",
    accent: "from-orange-400 to-amber-600",
    ranges: [
      "104.16.0.0/20", "104.17.0.0/20", "104.18.0.0/20", "104.19.0.0/20",
      "104.20.0.0/20", "104.21.0.0/20", "104.22.0.0/20", "104.24.0.0/20",
      "104.25.0.0/20", "104.26.0.0/20", "104.27.0.0/20", "104.28.0.0/20",
      "172.64.0.0/20", "172.65.0.0/20", "188.114.96.0/22",
    ],
  },
  {
    id: "google",
    nameEn: "Google",
    nameFa: "گوگل",
    noteEn: "Google Cloud + DNS anycast (8.8.8.0/24, 8.8.4.0/24).",
    noteFa: "گوگل کلود + دی‌ان‌اس آنیکست (8.8.8.0/24 و 8.8.4.0/24).",
    accent: "from-emerald-400 to-green-600",
    ranges: [
      "34.64.0.0/20", "34.72.0.0/20", "34.80.0.0/20", "34.88.0.0/20",
      "34.116.0.0/20", "34.124.0.0/20", "35.184.0.0/20", "35.192.0.0/20",
      "35.200.0.0/20", "35.208.0.0/20", "8.8.8.0/24", "8.8.4.0/24",
    ],
  },
  {
    id: "vercel",
    nameEn: "Vercel",
    nameFa: "ورسل",
    noteEn: "Vercel edge anycast — small, fast, low-jitter ranges.",
    noteFa: "رجانیست لبه Vercel — بازه‌های کوچک، سریع و کم‌نوسان.",
    accent: "from-slate-300 to-slate-500",
    ranges: ["76.76.21.0/24", "76.76.19.0/24", "76.223.0.0/20", "66.33.60.0/22"],
  },
  {
    id: "aws",
    nameEn: "AWS CloudFront",
    nameFa: "آمازون CloudFront",
    noteEn: "CloudFront edge blocks across US/EU/Apocorridors.",
    noteFa: "بازه‌های لبه CloudFront در آمریکا/اروپا/آسیا.",
    accent: "from-yellow-400 to-orange-500",
    ranges: [
      "13.224.0.0/20", "13.225.0.0/20", "13.226.0.0/20", "13.227.0.0/20",
      "18.64.0.0/20", "18.65.0.0/20", "52.84.0.0/20", "99.84.0.0/20",
      "143.204.0.0/20", "205.251.192.0/20",
    ],
  },
  {
    id: "azure",
    nameEn: "Microsoft Azure",
    nameFa: "مایکروسافت Azure",
    noteEn: "Azure public regions.",
    noteFa: "مناطق عمومی Azure.",
    accent: "from-sky-400 to-cyan-600",
    ranges: [
      "20.1.0.0/20", "20.10.0.0/20", "20.36.0.0/20", "20.42.0.0/20",
      "20.50.0.0/20", "20.60.0.0/20", "13.64.0.0/20", "13.70.0.0/20",
    ],
  },
  {
    id: "oracle",
    nameEn: "Oracle Cloud",
    nameFa: "اورکل کلود",
    noteEn: "Oracle Cloud Infrastructure — generous free-tier ranges.",
    noteFa: "اورکل کلود — بازه‌های پرکاربرد رایگان.",
    accent: "from-red-400 to-rose-600",
    ranges: [
      "129.146.0.0/20", "129.150.0.0/20", "130.61.0.0/20", "132.145.0.0/20",
      "140.238.0.0/20", "152.67.0.0/20", "158.101.0.0/20", "193.122.0.0/20",
    ],
  },
  {
    id: "digitalocean",
    nameEn: "DigitalOcean",
    nameFa: "دیجیتال‌اوشن",
    noteEn: "DO droplet ranges — popular for self-hosted proxies.",
    noteFa: "بازه‌های دروپلت DO — محبوب برای پراکسی شخصی.",
    accent: "from-blue-400 to-indigo-500",
    ranges: [
      "104.131.0.0/20", "104.236.0.0/20", "134.209.0.0/20", "138.68.0.0/20",
      "139.59.0.0/20", "159.65.0.0/20", "161.35.0.0/20", "165.22.0.0/20",
      "165.227.0.0/20", "167.71.0.0/20", "167.99.0.0/20", "174.138.0.0/20",
      "178.128.0.0/20", "206.189.0.0/20",
    ],
  },
  {
    id: "hetzner",
    nameEn: "Hetzner",
    nameFa: "هتزنر",
    noteEn: "Hetzner Germany/Finland — cheap VPS ranges.",
    noteFa: "هتزنر آلمان/فنلاند — بازه‌های وی‌پی‌اس اقتصادی.",
    accent: "from-red-300 to-rose-500",
    ranges: [
      "5.9.0.0/20", "5.75.0.0/20", "78.46.0.0/20", "88.99.0.0/20",
      "95.216.0.0/20", "116.202.0.0/20", "135.181.0.0/20", "159.69.0.0/20",
      "168.119.0.0/20",
    ],
  },
  {
    id: "github",
    nameEn: "GitHub",
    nameFa: "گیت‌هاب",
    noteEn: "GitHub + GitHub Pages edges.",
    noteFa: "گیت‌هاب و لبه‌های GitHub Pages.",
    accent: "from-purple-400 to-fuchsia-600",
    ranges: ["140.82.112.0/20", "143.55.64.0/20", "185.199.108.0/22", "192.30.252.0/22"],
  },
  {
    id: "arvan",
    nameEn: "ArvanCloud",
    nameFa: "آروان کلود",
    noteEn: "Iranian CDN — domestic ranges that stay reachable without a tunnel.",
    noteFa: "CDN ایرانی — بازه‌های داخلی که بدون تونل هم در دسترس‌اند.",
    accent: "from-lime-400 to-green-600",
    ranges: ["151.232.0.0/17", "185.51.200.0/22", "185.143.232.0/22"],
  },
  {
    id: "dns",
    nameEn: "Public DNS",
    nameFa: "دی‌ان‌اس عمومی",
    noteEn: "Anycast resolvers: Cloudflare, Google, Quad9, OpenDNS, AdGuard.",
    noteFa: "رجالوورهای آنیکست: کلودفلر، گوگل، Quad9، OpenDNS، AdGuard.",
    accent: "from-teal-400 to-emerald-600",
    ranges: [
      "1.1.1.0/24", "1.0.0.0/24", "8.8.8.0/24", "8.8.4.0/24", "9.9.9.0/24",
      "149.112.112.0/24", "208.67.222.0/24", "208.67.220.0/24", "185.228.168.0/22",
    ],
  },
];

/** Exact host count of one target token (CIDR block or dash range). */
export function tokenHostCount(token: string): number {
  const t = token.trim();
  const cidr = t.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (cidr) {
    const prefix = Number(cidr[2]);
    if (prefix < 8 || prefix > 32) return 0;
    const size = 2 ** (32 - prefix);
    return size > 2 ? size - 2 : 0;
  }
  const range = t.match(/^(\d{1,3}(?:\.\d{1,3}){3})-(\d{1,3}(?:\.\d{1,3}){3}|\d{1,3})$/);
  if (range) {
    const u = (ip: string) =>
      ip.split(".").reduce((n, o) => ((n << 8) + Number(o)) >>> 0, 0);
    let a = u(range[1]);
    let b = range[2].includes(".")
      ? u(range[2])
      : u(`${range[1].split(".").slice(0, 3).join(".")}.${range[2]}`);
    if (b < a) [a, b] = [b, a];
    return b - a + 1;
  }
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(t) ? 1 : 0;
}

/** Host count of a whole preset (sum of its exact block sizes). */
export function presetHostCount(preset: ScanTargetPreset): number {
  return preset.ranges.reduce((n, r) => n + tokenHostCount(r), 0);
}

/** Approximate host count of a free-form target textarea (display only). */
export function estimateTargetHosts(targetText: string): number {
  return String(targetText || "")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .reduce((n, t) => n + tokenHostCount(t), 0);
}

/** The scanner's hard cap (mirrors MAX_SCAN_HOSTS in electron/scanner.ts). */
export const SCAN_HOST_CAP = 65536;
