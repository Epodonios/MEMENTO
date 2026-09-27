/**
 * MEMENTO — GOOGLE SIDE (R3 task #7, H-c overhaul) — the in-app MHRV.
 *
 * Two sub-tabs, matching the user's spec:
 *   MHRV       — the full native port of mhrv-rs: the 3-step setup with the
 *                EMBEDDED Code.gs (one-click copy with the auth key baked
 *                in), the mhrv-rs-v1.9.37-style settings (mode select, the
 *                MULTI Deployment-ID pool, auth key, network + front-domain
 *                manager, advanced group, recent-log console), the Google
 *                IP scanner, the SNI scanner, the relay test and the local
 *                proxy Start/Stop (HTTP 8085/SOCKS 8086).
 *   MHRV CFW   — the Cloudflare-Worker-exit variant of the same relay
 *                (Code.cfw.gs embedded) with its own slot in the ID pool.
 *
 * H-c: the settings card mirrors the mhrv-rs reference UI — a MANAGEABLE
 * front-domain chip list (click = select active, x = remove, + = add),
 * multi Deployment IDs with round-robin failover, share-on-LAN, upstream
 * SOCKS5 chaining, log level + a live recent-log console fed by
 * mhrv_logs_get (2s poll), CA install/remove/check and Check-for-updates.
 *
 * No GitHub download, no external program: everything happens here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import {
  Globe, Copy, Play, Square, Radar, ShieldCheck, ShieldOff, BadgeCheck,
  FlaskConical, Server, KeyRound, FileCode2, AlertCircle, CheckCircle2,
  Loader2, Zap, Eye, EyeOff, Plus, X, Check, ChevronDown, RefreshCw,
  Terminal, Save, Trash2,
} from "lucide-react";
import { isDesktop, tauriInvoke, openExternalLink } from "../utils/tauriBridge";

type MhrvModeWire = "apps_script" | "direct";
type LogLevelWire = "error" | "warn" | "info" | "debug";
type CardVariant = "apps_script" | "cfw";

interface MhrvConfigWire {
  mode: MhrvModeWire;
  scriptIds: string[];
  authKeySet: boolean;
  cfwWorkerUrl: string;
  googleIp: string;
  frontDomain: string;
  listenPort: number;
  socksPort: number;
  verifySsl: boolean;
  googleIpValidation: boolean;
  maxIpsToScan: number;
  scanBatchSize: number;
  parallelConcurrency: number;
  /* H-c additions (optional so stale desktop payloads never crash the UI): */
  frontDomains?: string[];
  sniPool?: string[];
  shareLan?: boolean;
  upstreamSocks5?: string;
  parallelDispatch?: number;
  logLevel?: LogLevelWire;
  showAuthKey?: boolean;
  normalizeXTwitter?: boolean;
  youtubeThroughRelay?: boolean;
  blockQuic?: boolean;
  blockStun?: boolean;
  configPath?: string;
}

interface MhrvStatusWire {
  running: boolean;
  mode: MhrvModeWire;
  httpPort: number;
  socksPort: number;
  googleIp: string;
  scriptsConfigured: boolean;
  authKeySet: boolean;
  caReady: boolean;
  uptimeMs: number;
  requestsRelayed: number;
  requestsFronted: number;
  lastError: string | null;
  /* H-c additions: */
  shareLan?: boolean;
  sniPoolSize?: number;
  frontDomainsCount?: number;
  upstreamSet?: boolean;
  logLevel?: LogLevelWire;
  deployCount?: number;
  blockQuic?: boolean;
  blockStun?: boolean;
}

interface IpScanRowWire { ip: string; latencyMs: number | null; error: string | null; }
interface SniScanRowWire { sni: string; ok: boolean; ms: number; note: string; }
interface LogLineWire { ts: number; level: LogLevelWire; text: string; }

const parseIdPool = (text: string): string[] =>
  text.split("\n").map((s) => s.trim()).filter(Boolean);

const fmtLogTs = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

export default function GoogleSideTab() {
  const { language } = useStore();
  const isRtl = language === "fa" || language === "ar";
  const L = useCallback((en: string, fa: string) => (language === "fa" ? fa : en), [language]);

  const [subTab, setSubTab] = useState<"mhrv" | "cfw">("mhrv");
  const [cfg, setCfg] = useState<MhrvConfigWire | null>(null);
  const [status, setStatus] = useState<MhrvStatusWire | null>(null);
  const [authKeyInput, setAuthKeyInput] = useState("");
  const [deployText, setDeployText] = useState("");
  const [cfwWorkerInput, setCfwWorkerInput] = useState("");
  const [newFrontInput, setNewFrontInput] = useState("");

  const [ipRows, setIpRows] = useState<IpScanRowWire[] | null>(null);
  const [ipSource, setIpSource] = useState("");
  const [ipScanning, setIpScanning] = useState(false);
  const [quickScanning, setQuickScanning] = useState(false);
  const [sniRows, setSniRows] = useState<SniScanRowWire[] | null>(null);
  const [sniScanning, setSniScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOut, setTestOut] = useState<string | null>(null);
  const [caReady, setCaReady] = useState(false);
  const [caBusy, setCaBusy] = useState<"install" | "remove" | "check" | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateOut, setUpdateOut] = useState<string | null>(null);

  // collapsibles + log console
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sniPoolOpen, setSniPoolOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<LogLineWire[]>([]);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    if (!isDesktop()) return;
    try {
      const c = await tauriInvoke<MhrvConfigWire>("mhrv_config_get");
      if (c) {
        setCfg(c);
        setDeployText((c.scriptIds ?? []).join("\n"));
        setCfwWorkerInput(c.cfwWorkerUrl || "");
      }
      const s = await tauriInvoke<MhrvStatusWire>("mhrv_status");
      setStatus(s ?? null);
      const ca = await tauriInvoke<{ ready: boolean }>("mhrv_ca_status");
      setCaReady(!!ca?.ready);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // live status while running
  useEffect(() => {
    if (!isDesktop()) return;
    const id = setInterval(async () => {
      try {
        const s = await tauriInvoke<MhrvStatusWire>("mhrv_status");
        setStatus(s ?? null);
      } catch { /* best-effort */ }
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // Recent log: 2s poll while the console is visible
  useEffect(() => {
    if (!logOpen || !isDesktop()) return;
    let alive = true;
    const pull = async () => {
      try {
        const rows = await tauriInvoke<LogLineWire[]>("mhrv_logs_get", {
          level: cfg?.logLevel ?? "info",
          limit: 200,
        });
        if (alive && rows) setLogs(rows);
      } catch { /* best-effort */ }
    };
    pull();
    const id = setInterval(pull, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [logOpen, cfg?.logLevel]);

  // auto-scroll the log console to the newest line
  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, logOpen]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      await tauriInvoke("mhrv_config_set", patch);
      await refresh();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const copyCodeGs = async (variant: CardVariant) => {
    try {
      const out = await tauriInvoke<{ text: string; source: string } | null>("mhrv_codegs", {
        variant,
        injectKey: true,
      });
      if (!out?.text) {
        toast.error(L("Embedded script not found in this build.", "اسکریپت داخلی در این بیلد پیدا نشد."));
        return;
      }
      await navigator.clipboard.writeText(out.text);
      toast.success(
        variant === "cfw"
          ? L("Code.cfw.gs copied WITH your auth key + Worker URL ✓ — paste it into Apps Script", "Code.cfw.gs همراه کلید شما + آدرس Worker کپی شد ✓ — در Apps Script پیست کن")
          : L("Code.gs copied WITH your auth key ✓ — paste it into Apps Script", "Code.gs همراه کلید شما کپی شد ✓ — در Apps Script پیست کن"),
        { duration: 6000 }
      );
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const startProxy = async () => {
    setStarting(true);
    try {
      await tauriInvoke("mhrv_start");
      const bind = (status?.shareLan ?? cfg?.shareLan) ? "0.0.0.0" : "127.0.0.1";
      toast.success(
        L(`MHRV proxy running — HTTP ${bind}:${cfg?.listenPort ?? 8085} · SOCKS5 ${bind}:${cfg?.socksPort ?? 8086}`, `پراکسی MHRV اجرا شد — HTTP ${bind}:${cfg?.listenPort ?? 8085} · SOCKS5 ${bind}:${cfg?.socksPort ?? 8086}`),
        { duration: 8000 }
      );
      await refresh();
    } catch (e: any) {
      toast.error(String(e?.message || e), { duration: 10000, style: { whiteSpace: "pre-line", maxWidth: 480 } });
    } finally {
      setStarting(false);
    }
  };

  const stopProxy = async () => {
    try {
      await tauriInvoke("mhrv_stop");
      toast(L("MHRV proxy stopped.", "پراکسی MHRV متوقف شد."));
      await refresh();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestOut(null);
    try {
      const out = await tauriInvoke<{ ok: boolean; detail: string; ip?: string }>("mhrv_test_relay");
      setTestOut(out?.detail ?? "");
      if (out?.ok) toast.success(L("Relay test passed ✓", "تست رله موفق بود ✓"));
      else toast.error(L("Relay test failed — see the detail line.", "تست رله ناموفق بود — متن خطا را ببین."));
    } catch (e: any) {
      setTestOut(String(e?.message || e));
    } finally {
      setTesting(false);
    }
  };

  const applyIpRows = async (out: { rows?: IpScanRowWire[]; source?: string } | null, autoPick: boolean) => {
    const rows = out?.rows ?? [];
    setIpRows(rows);
    setIpSource(out?.source ?? "");
    const best = rows.find((r) => r.latencyMs !== null);
    if (best) {
      if (autoPick) {
        await save({ googleIp: best.ip });
        toast.success(L(`Google IP set to ${best.ip} (${best.latencyMs} ms)`, `آی‌پی گوگل روی ${best.ip} تنظیم شد (${best.latencyMs} میلی‌ثانیه)`));
      } else {
        toast.success(L(`${rows.filter((r) => r.latencyMs !== null).length} working Google IPs found`, `${rows.filter((r) => r.latencyMs !== null).length} آی‌پی سالم گوگل پیدا شد`));
      }
    } else {
      toast.error(L("No working Google IPs from this network.", "هیچ آی‌پی سالمی از این شبکه پیدا نشد."));
    }
  };

  const runIpScan = async () => {
    setIpScanning(true);
    setIpRows(null);
    try {
      const out = await tauriInvoke<{ rows: IpScanRowWire[]; source: string }>("mhrv_scan_ips");
      await applyIpRows(out, false);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setIpScanning(false);
    }
  };

  // The small "scan IPs" button next to the Google IP field — scan AND
  // switch to the fastest working IP (mhrv-rs behavior).
  const quickScanIp = async () => {
    setQuickScanning(true);
    setIpRows(null);
    try {
      const out = await tauriInvoke<{ rows: IpScanRowWire[]; source: string }>("mhrv_scan_ips");
      await applyIpRows(out, true);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setQuickScanning(false);
    }
  };

  const runSniScan = async () => {
    setSniScanning(true);
    setSniRows(null);
    try {
      const out = await tauriInvoke<SniScanRowWire[]>("mhrv_scan_sni");
      setSniRows(out ?? []);
      const okN = (out ?? []).filter((r) => r.ok).length;
      if ((out ?? []).length) {
        toast.success(L(`SNI pool status: ${okN}/${out?.length} reachable`, `وضعیت استخر SNI: ${okN}/${out?.length} در دسترس`));
      }
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSniScanning(false);
    }
  };

  const useFastestIp = async () => {
    const best = (ipRows ?? []).find((r) => r.latencyMs !== null);
    if (!best) return;
    await save({ googleIp: best.ip });
    toast.success(L(`google_ip set to ${best.ip} (${best.latencyMs} ms)`, `google_ip روی ${best.ip} تنظیم شد (${best.latencyMs} میلی‌ثانیه)`));
  };

  /* ---------------- front-domain manager ---------------- */

  const addFrontDomain = async () => {
    const raw = newFrontInput.trim().toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/\.+$/, "");
    if (!raw || !raw.includes(".") || /\s/.test(raw)) {
      toast.error(L("Enter a valid domain like www.google.com", "یک دامنه معتبر مثل www.google.com وارد کن"));
      return;
    }
    const list = cfg?.frontDomains ?? [];
    const next = list.includes(raw) ? list : [...list, raw];
    await save({ frontDomains: next, frontDomain: raw });
    setNewFrontInput("");
    toast.success(L(`Front domain set to ${raw}`, `دامنه فرانت روی ${raw} تنظیم شد`));
  };

  const removeFrontDomain = async (d: string) => {
    const list = (cfg?.frontDomains ?? []).filter((x) => x !== d);
    const patch: Record<string, unknown> = { frontDomains: list };
    if (cfg?.frontDomain === d) patch.frontDomain = list[0] ?? "www.google.com";
    await save(patch);
  };

  /* ---------------- CA row + updates ---------------- */

  const caAction = async (kind: "install" | "remove" | "check") => {
    setCaBusy(kind);
    try {
      const r = await tauriInvoke<{ ok: boolean; detail: string }>(
        kind === "install" ? "mhrv_ca_install" : kind === "remove" ? "mhrv_ca_remove" : "mhrv_ca_check"
      );
      const detail = r?.detail || (r?.ok ? "OK" : L("failed", "ناموفق بود"));
      if (r?.ok) toast.success(detail, { duration: 6000 });
      else toast.error(detail, { duration: 8000 });
      if (kind === "install") setCaReady(true);
      if (kind === "remove") {
        setCaReady(false);
        await refresh();
      }
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setCaBusy(null);
    }
  };

  const runUpdateCheck = async () => {
    setUpdating(true);
    setUpdateOut(null);
    try {
      const r = await tauriInvoke<{ current: string; latest: string | null; isNewer: boolean; detail: string }>("mhrv_update_check");
      setUpdateOut(r?.detail ?? "");
      if (r?.isNewer) toast.success(L(`Update available: ${r.latest}`, `به‌روزرسانی موجود است: ${r.latest}`), { duration: 6000 });
      else if (r?.latest) toast.success(L("You are on the latest version ✓", "آخرین نسخه را دارید ✓"));
      else toast(L("Could not read the latest version — see the detail.", "نسخهٔ آخر خوانده نشد — متن خطا را ببین."));
    } catch (e: any) {
      setUpdateOut(String(e?.message || e));
    } finally {
      setUpdating(false);
    }
  };

  /* ---------------- Save config (explicit) ---------------- */

  const saveAll = async () => {
    const patch: Record<string, unknown> = {
      scriptIds: parseIdPool(deployText).slice(0, 16),
      mode: cfg?.mode ?? "apps_script",
      googleIp: (cfg?.googleIp ?? "").trim(),
      frontDomain: (cfg?.frontDomain ?? "").trim(),
      frontDomains: cfg?.frontDomains ?? [],
      listenPort: cfg?.listenPort ?? 8085,
      socksPort: cfg?.socksPort ?? 8086,
      verifySsl: cfg?.verifySsl ?? true,
      shareLan: cfg?.shareLan ?? false,
      upstreamSocks5: (cfg?.upstreamSocks5 ?? "").trim(),
      parallelDispatch: cfg?.parallelDispatch ?? 0,
      logLevel: cfg?.logLevel ?? "info",
      showAuthKey: cfg?.showAuthKey ?? false,
      normalizeXTwitter: cfg?.normalizeXTwitter ?? false,
      youtubeThroughRelay: cfg?.youtubeThroughRelay ?? false,
      blockQuic: cfg?.blockQuic ?? true,
      blockStun: cfg?.blockStun ?? false,
      cfwWorkerUrl: cfwWorkerInput.trim(),
    };
    if (authKeyInput.trim()) {
      patch.authKey = authKeyInput.trim();
      setAuthKeyInput("");
    }
    await save(patch);
    toast.success(L("MHRV config saved — port/bind changes apply on the next Start.", "تنظیمات MHRV ذخیره شد — تغییرات پورت/شبکه در استارت بعدی اعمال می‌شود."));
  };

  const inputCls = "w-full px-3 py-2 rounded-lg text-xs font-mono bg-surface-950/60 border border-surface-700/80 text-ink-200 outline-none focus:border-emerald-500/80 transition-colors";
  const btnGhost = "px-3 py-1.5 rounded-lg text-xs font-bold border border-surface-600/80 hover:border-emerald-500/60 text-ink-200 transition-colors";
  const chipCls = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono border transition-colors";

  /** a glass fieldset with the app's exact tokens */
  const fieldset = (title: string, icon: React.ReactNode, extra: React.ReactNode | null, body: React.ReactNode) => (
    <div className="rounded-2xl border border-surface-700/60 bg-surface-900/50 p-4 space-y-3">
      <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
        <span className="text-emerald-400 flex items-center">{icon}</span>
        <h4 className="text-xs font-extrabold text-white tracking-wide">{title}</h4>
        <span className="flex-1" />
        {extra}
      </div>
      {body}
    </div>
  );

  const checkRow = (
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    hint?: string
  ) => (
    <label className="flex items-start gap-2.5 cursor-pointer select-none" onClick={() => onChange(!checked)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
      />
      <span>
        <span className="text-xs text-ink-200 font-semibold">{label}</span>
        {hint && <span className="block text-[10px] text-ink-500 leading-4">{hint}</span>}
      </span>
    </label>
  );

  const deployCount = parseIdPool(deployText).length;
  const frontDomains = cfg?.frontDomains ?? [];
  const sniPool = cfg?.sniPool ?? [];
  const sniOkCount = sniRows ? sniRows.filter((r) => r.ok).length : null;
  const sniStatus = (sni: string): SniScanRowWire | undefined => sniRows?.find((r) => r.sni === sni);
  const configHint = (cfg?.configPath ?? "").split(/[\\/]/).slice(-2).join("/");

  const setupCard = (variant: CardVariant) => (
    <div className={cn("rounded-2xl border p-5 space-y-4", "dark:border-surface-700/60 dark:bg-surface-900/50")}>
      <h3 className={cn("flex items-center gap-2 font-extrabold dark:text-white text-sm", isRtl && "flex-row-reverse")}>
        <FileCode2 className="w-4 h-4 text-emerald-400" />
        {variant === "cfw"
          ? L("Step 1 · Deploy the CFW relay (Apps Script + Cloudflare Worker)", "مرحله ۱ · دیپلوی رله CFW (اسکریپت گوگل + Cloudflare Worker)")
          : L("Step 1 · Deploy the relay script (one-time, from inside MEMENTO)", "مرحله ۱ · دیپلوی اسکریپت رله (یک‌بار، از داخل مِمنتو)")}
      </h3>
      <ol className={cn("text-xs text-ink-300 space-y-1.5 list-decimal", isRtl ? "pr-5" : "pl-5")}>
        <li>
          {L("Open", "باز کن")}{" "}
          <button onClick={() => void openExternalLink("https://script.google.com")} className="text-emerald-400 underline">
            script.google.com
          </button>
          {" → "}{L("sign in → New project", "ورود → پروژه جدید")}
        </li>
        <li>{L("Press the copy button below — Code.gs is EMBEDDED in MEMENTO and your auth key is already injected. Paste it over the editor's default code, then Save.", "دکمه کپی پایین را بزن — Code.gs داخل مِمنتو امبد شده و کلید تو از قبل داخلش گذاشته شده. جای کد پیش‌فرض ادیتور پیست کن و ذخیره کن.")}</li>
        <li>{variant === "cfw"
          ? L("Create the Cloudflare Worker from the Worker template (the CF dashboard), paste its URL below, then Deploy → New deployment → Web app → Execute as Me → Anyone.", "در داشبورد Cloudflare یک Worker با قالب Worker بساز، آدرسش را پایین وارد کن، سپس Deploy → New deployment → Web app → Execute as Me → Anyone.")
          : L("Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy (approve the permissions).", "Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy (اجازه‌ها را تأیید کن).")}
        </li>
        <li>{L("Copy the Deployment ID it shows and paste it into the settings below (one per line — extra IDs give you round-robin failover).", "Deployment ID نمایش‌داده‌شده را کپی و در تنظیمات پایین پیست کن (هر خط یکی — شناسه‌های بیشتر یعنی رفت‌وبرگشتی با سوئیچ خودکار).")}
        </li>
      </ol>
      <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
        <button
          onClick={() => copyCodeGs(variant)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 hover:brightness-110 transition-all"
        >
          <Copy className="w-3.5 h-3.5" />
          {variant === "cfw" ? L("Copy Code.cfw.gs (with my key)", "کپی Code.cfw.gs (با کلید من)") : L("Copy Code.gs (with my key)", "کپی Code.gs (با کلید من)")}
        </button>
        <span className="text-[10px] text-ink-500">
          {L("No GitHub download — the script ships inside MEMENTO.", "نیازی به دانلود از گیت‌هاب نیست — اسکریپت داخل خود مِمنتو است.")}
        </span>
      </div>
    </div>
  );

  /* ================================================================
   * STEP 2 — the mhrv-rs v1.9.37-style settings card
   * ================================================================ */
  const settingsCard = (variant: CardVariant) => (
    <div className={cn("rounded-2xl border p-5 space-y-4", "dark:border-surface-700/60 dark:bg-surface-900/50")}>
      {/* header: engine + status dot (mhrv-rs "stopped/running" parity) */}
      <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
        <KeyRound className="w-4 h-4 text-emerald-400" />
        <h3 className="font-extrabold dark:text-white text-sm">
          {L("Step 2 · Relay settings", "مرحله ۲ · تنظیمات رله")}
        </h3>
        <span className={cn("w-2.5 h-2.5 rounded-full", status?.running ? "bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" : "bg-surface-600")} />
        <span className={cn("text-[10px] font-mono uppercase tracking-wider", status?.running ? "text-emerald-400" : "text-ink-500")}>
          {status?.running ? L("running", "فعال") : L("stopped", "متوقف")}
        </span>
      </div>

      {/* Mode */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">{L("Mode", "حالت")}</label>
          <select
            value={cfg?.mode ?? "apps_script"}
            onChange={(e) => save({ mode: e.target.value })}
            className={cn(inputCls, "appearance-none cursor-pointer")}
            dir="ltr"
          >
            <option value="apps_script">Apps Script (MTM)</option>
            <option value="direct">Direct (SNI rewrite)</option>
          </select>
        </div>
        {variant === "cfw" && (
          <div>
            <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">
              {L("Cloudflare Worker URL", "آدرس Cloudflare Worker")}
            </label>
            <input
              value={cfwWorkerInput}
              onChange={(e) => setCfwWorkerInput(e.target.value)}
              onBlur={() => save({ cfwWorkerUrl: cfwWorkerInput.trim() })}
              placeholder="https://my-relay.workers.dev"
              className={inputCls}
              dir="ltr"
            />
          </div>
        )}
      </div>

      {/* Apps Script relay group */}
      {fieldset(
        L("Apps Script relay", "رله اسکریپت گوگل"),
        <FileCode2 className="w-3.5 h-3.5" />,
        variant === "cfw" ? (
          <span className="text-[9px] text-ink-500">{L("the CFW ID is one line of the pool", "شناسه CFW یکی از خطوط همین استخر است")}</span>
        ) : null,
        <div className="space-y-3">
          <div>
            <div className={cn("flex items-center justify-between gap-2 mb-1.5 flex-wrap", isRtl && "flex-row-reverse")}>
              <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider">
                {L("Deployment IDs", "شناسه‌های Deployment")}
              </label>
              <span className={cn(
                chipCls,
                deployCount > 0
                  ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                  : "text-ink-500 border-surface-700/60"
              )} dir="ltr">
                {deployCount} {deployCount === 1 ? "ID" : "IDs"} · {L("round-robin", "رفت‌وبرگشت")}
              </span>
            </div>
            <textarea
              value={deployText}
              onChange={(e) => setDeployText(e.target.value)}
              onBlur={() => {
                const next = parseIdPool(deployText).slice(0, 16);
                setDeployText(next.join("\n"));
                save({ scriptIds: next });
              }}
              rows={3}
              spellCheck={false}
              placeholder={L("one deployment ID per line", "هر خط یک شناسه Deployment")}
              className={cn(inputCls, "resize-y leading-5")}
              dir="ltr"
            />
            <p className="text-[10px] text-ink-500 mt-1">
              {L("Tip: add more IDs for round-robin with auto-failover.", "نکته: چند شناسه اضافه کن تا رفت‌وبرگشتی با سوئیچ خودکار داشته باشی (خطا از یکی، بقیه جبران می‌کنند).")}
            </p>
          </div>
          <div>
            <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">
              {cfg?.authKeySet
                ? L("Auth key (already set)", "کلید احراز (ثبت شده)")
                : L("Auth key (the secret inside Code.gs)", "کلید احراز (همان رشته داخل Code.gs)")}
            </label>
            <div className="relative">
              <input
                type={cfg?.showAuthKey ? "text" : "password"}
                value={authKeyInput}
                onChange={(e) => setAuthKeyInput(e.target.value)}
                onBlur={() => {
                  if (authKeyInput.trim()) {
                    save({ authKey: authKeyInput.trim() });
                    setAuthKeyInput("");
                  }
                }}
                placeholder={cfg?.authKeySet ? "••••••••" : "a long random string"}
                className={cn(inputCls, "pr-10")}
                dir="ltr"
              />
              <button
                onClick={() => save({ showAuthKey: !cfg?.showAuthKey })}
                title={L("Show auth key", "نمایش کلید احراز")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-emerald-400 transition-colors"
              >
                {cfg?.showAuthKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Network group */}
      {fieldset(
        L("Network", "شبکه"),
        <Globe className="w-3.5 h-3.5" />,
        <span className={cn(chipCls, "text-ink-300 border-surface-600/60 bg-surface-950/40")} dir="ltr">
          {L("front domains", "دامنه فرانت")}: {frontDomains.length}
        </span>,
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">
                {L("Google IP (edge)", "آی‌پی لبه گوگل")}
              </label>
              <div className="flex gap-2">
                <input
                  value={cfg?.googleIp ?? ""}
                  onChange={(e) => setCfg((c) => (c ? { ...c, googleIp: e.target.value } : c))}
                  onBlur={() => save({ googleIp: (cfg?.googleIp ?? "").trim() })}
                  placeholder="216.239.38.120"
                  className={inputCls}
                  dir="ltr"
                />
                <button
                  onClick={quickScanIp}
                  disabled={quickScanning}
                  title={L("Scan and use the fastest Google IP", "اسکن و استفاده از سریع‌ترین آی‌پی گوگل")}
                  className={cn(btnGhost, "shrink-0 flex items-center gap-1.5", quickScanning && "opacity-60 pointer-events-none")}
                >
                  {quickScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radar className="w-3 h-3" />}
                  {L("scan IPs", "اسکن آی‌پی")}
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">
                {L("Front domain (active)", "دامنه فرانت (فعال)")}
              </label>
              <input
                value={cfg?.frontDomain ?? ""}
                onChange={(e) => setCfg((c) => (c ? { ...c, frontDomain: e.target.value } : c))}
                onBlur={() => {
                  const d = (cfg?.frontDomain ?? "").trim().toLowerCase().replace(/\.+$/, "");
                  if (d && d !== cfg?.frontDomain) save({ frontDomain: d });
                }}
                placeholder="www.google.com"
                className={inputCls}
                dir="ltr"
              />
            </div>
          </div>

          {/* SNI pool chip + collapsible list */}
          <div className="space-y-2">
            <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
              <button
                onClick={() => setSniPoolOpen(!sniPoolOpen)}
                className={cn(chipCls, "text-ink-200 border-surface-600/70 bg-surface-950/40 hover:border-emerald-500/50")}
                dir="ltr"
              >
                SNI pool ({sniOkCount ?? sniPool.length}/{sniPool.length})
                <ChevronDown className={cn("w-3 h-3 transition-transform", sniPoolOpen && "rotate-180")} />
              </button>
              <button onClick={runSniScan} disabled={sniScanning} className={cn(btnGhost, "flex items-center gap-1.5", sniScanning && "opacity-60 pointer-events-none")}>
                {sniScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radar className="w-3 h-3" />}
                {L("probe pool", "آزمایش استخر")}
              </button>
            </div>
            {sniPoolOpen && (
              <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-surface-950/50 border border-surface-800/60" dir="ltr">
                {sniPool.map((sni) => {
                  const st = sniStatus(sni);
                  return (
                    <span key={sni} className={cn(
                      chipCls,
                      st ? (st.ok ? "text-emerald-300 border-emerald-500/40" : "text-red-300 border-red-500/30") : "text-ink-300 border-surface-700/50"
                    )} title={st ? st.note : L("not probed yet", "هنوز آزمایش نشده")}>
                      {st?.ok && <Check className="w-2.5 h-2.5" />}
                      {sni}
                    </span>
                  );
                })}
                {!sniPool.length && <span className="text-[10px] text-ink-500">{L("pool empty", "استخر خالی")}</span>}
              </div>
            )}
          </div>

          {/* front-domain manager: chips = select/remove, plus = add */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider block">
              {L("Front domains — click to select, x to remove", "دامنه‌های فرانت — برای انتخاب کلیک کن، با × حذف کن")}
            </label>
            <div className="flex flex-wrap gap-1.5" dir="ltr">
              {frontDomains.map((d) => {
                const active = d === cfg?.frontDomain;
                return (
                  <span
                    key={d}
                    className={cn(
                      "group inline-flex items-center rounded-full border text-[10px] font-mono transition-colors overflow-hidden",
                      active
                        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                        : "border-surface-700/60 bg-surface-950/40 text-ink-300 hover:border-surface-500"
                    )}
                  >
                    <button onClick={() => save({ frontDomain: d })} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1" title={active ? L("active front domain", "دامنه فرانت فعال") : L("select as front domain", "انتخاب به‌عنوان دامنه فرانت")}>
                      {active && <Check className="w-2.5 h-2.5 text-emerald-400" />}
                      {d}
                    </button>
                    <button
                      onClick={() => removeFrontDomain(d)}
                      className="px-1.5 py-1 text-ink-500 hover:text-red-400 transition-colors"
                      title={L("remove from the list", "حذف از فهرست")}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
              {!frontDomains.length && (
                <span className="text-[10px] text-ink-500">{L("no domains yet — add one below", "هنوز دامنه‌ای نیست — از پایین اضافه کن")}</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={newFrontInput}
                onChange={(e) => setNewFrontInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void addFrontDomain(); }}
                placeholder={L("add a Google front domain…", "افزودن دامنه فرانت گوگل…")}
                className={inputCls}
                dir="ltr"
              />
              <button
                onClick={addFrontDomain}
                title={L("Add domain", "افزودن دامنه")}
                className="shrink-0 px-3 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* share on LAN + ports */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            {checkRow(
              cfg?.shareLan ?? false,
              (v) => save({ shareLan: v }),
              L("Share with other devices on my Wi-Fi/network", "هم‌رسانی با دستگاه‌های دیگر در وای‌فای/شبکه‌ی من"),
              L("applied on the next Start (listeners bind 0.0.0.0 instead of 127.0.0.1)", "در استارت بعدی اعمال می‌شود (گوش‌دهی روی 0.0.0.0 به‌جای 127.0.0.1)")
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">{L("HTTP port", "پورت HTTP")}</label>
                <input
                  type="number"
                  value={cfg?.listenPort ?? 8085}
                  onChange={(e) => setCfg((c) => (c ? { ...c, listenPort: Number(e.target.value) } : c))}
                  onBlur={() => save({ listenPort: cfg?.listenPort })}
                  className={inputCls}
                  dir="ltr"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">{L("SOCKS port", "پورت SOCKS")}</label>
                <input
                  type="number"
                  value={cfg?.socksPort ?? 8086}
                  onChange={(e) => setCfg((c) => (c ? { ...c, socksPort: Number(e.target.value) } : c))}
                  onBlur={() => save({ socksPort: cfg?.socksPort })}
                  className={inputCls}
                  dir="ltr"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Advanced (collapsible) */}
      <div className="rounded-2xl border border-surface-700/60 bg-surface-900/50 overflow-hidden">
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className={cn("w-full flex items-center gap-2 p-4 text-xs font-extrabold text-white tracking-wide hover:bg-surface-800/30 transition-colors", isRtl && "flex-row-reverse")}
        >
          <span className="text-emerald-400 flex items-center"><Server className="w-3.5 h-3.5" /></span>
          {L("Advanced", "پیشرفته")}
          <span className="flex-1" />
          <ChevronDown className={cn("w-4 h-4 text-ink-400 transition-transform", advancedOpen && "rotate-180")} />
        </button>
        {advancedOpen && (
          <div className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">{L("Upstream SOCKS5", "بالادست SOCKS5")}</label>
                <input
                  value={cfg?.upstreamSocks5 ?? ""}
                  onChange={(e) => setCfg((c) => (c ? { ...c, upstreamSocks5: e.target.value } : c))}
                  onBlur={() => save({ upstreamSocks5: (cfg?.upstreamSocks5 ?? "").trim() })}
                  placeholder={L("empty = direct; 127.0.0.1:50529 for local xray", "خالی = مستقیم؛ برای xray محلی 127.0.0.1:50529")}
                  className={inputCls}
                  dir="ltr"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">{L("Parallel dispatch", "ارسال موازی")}</label>
                  <input
                    type="number"
                    min={0}
                    value={cfg?.parallelDispatch ?? 0}
                    onChange={(e) => setCfg((c) => (c ? { ...c, parallelDispatch: Number(e.target.value) } : c))}
                    onBlur={() => save({ parallelDispatch: cfg?.parallelDispatch })}
                    className={inputCls}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider mb-1.5 block">{L("Log level", "سطح لاگ")}</label>
                  <select
                    value={cfg?.logLevel ?? "info"}
                    onChange={(e) => save({ logLevel: e.target.value })}
                    className={cn(inputCls, "appearance-none cursor-pointer")}
                    dir="ltr"
                  >
                    <option value="error">error</option>
                    <option value="warn">warn</option>
                    <option value="info">info</option>
                    <option value="debug">debug</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2.5">
              {checkRow(cfg?.verifySsl ?? true, (v) => save({ verifySsl: v }), L("Verify TLS server certificate (recommended)", "بررسی گواهی TLS سرور (توصیه‌شده)"))}
              {checkRow(cfg?.showAuthKey ?? false, (v) => save({ showAuthKey: v }), L("Show auth key", "نمایش کلید احراز"))}
              {checkRow(cfg?.normalizeXTwitter ?? false, (v) => save({ normalizeXTwitter: v }), L("Normalize X/Twitter GraphQL URLs", "نرمال‌سازی آدرس‌های GraphQL ایکس/توییتر"))}
              {checkRow(cfg?.youtubeThroughRelay ?? false, (v) => save({ youtubeThroughRelay: v }), L("Send YouTube through relay (no SNI rewrite)", "ارسال یوتیوب از رله (بدون بازنویسی SNI)"))}
              {checkRow(
                cfg?.blockQuic ?? true,
                (v) => save({ blockQuic: v }),
                L("Block QUIC (UDP/443)", "مسدود کردن QUIC (UDP/443)"),
                L("applied when a system-wide tunnel is active", "وقتی تونل سراسری فعال باشد اعمال می‌شود")
              )}
              {checkRow(
                cfg?.blockStun ?? false,
                (v) => save({ blockStun: v }),
                L("Block STUN/TURN UDP", "مسدود کردن STUN/TURN (UDP)"),
                L("applied when a system-wide tunnel is active", "وقتی تونل سراسری فعال باشد اعمال می‌شود")
              )}
            </div>

            {/* action rows (mhrv-rs parity) */}
            <div className={cn("flex items-center gap-2 flex-wrap pt-1", isRtl && "flex-row-reverse")}>
              <button
                onClick={saveAll}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 hover:brightness-110 transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                {L("Save config", "ذخیره تنظیمات")}
              </button>
              <button
                onClick={startProxy}
                disabled={starting}
                className={cn(btnGhost, "flex items-center gap-1.5 px-4 py-2", starting && "opacity-60 pointer-events-none")}
              >
                {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {L("Start", "شروع")}
              </button>
              <button
                onClick={runTest}
                disabled={testing}
                className={cn(btnGhost, "flex items-center gap-1.5 px-4 py-2", testing && "opacity-60 pointer-events-none")}
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                {L("Test relay", "تست رله")}
              </button>
              {configHint && (
                <span className="text-[9px] text-ink-600 font-mono truncate max-w-56" dir="ltr" title={cfg?.configPath}>
                  {configHint}
                </span>
              )}
            </div>
            <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
              <button onClick={() => caAction("install")} disabled={caBusy !== null} className={cn(btnGhost, "flex items-center gap-1.5", caBusy && "opacity-60 pointer-events-none")}>
                <ShieldCheck className="w-3.5 h-3.5" />
                {L("Install CA", "نصب گواهی")}
              </button>
              <button onClick={() => caAction("remove")} disabled={caBusy !== null} className={cn(btnGhost, "flex items-center gap-1.5", caBusy && "opacity-60 pointer-events-none")}>
                <ShieldOff className="w-3.5 h-3.5" />
                {L("Remove CA", "حذف گواهی")}
              </button>
              <button onClick={() => caAction("check")} disabled={caBusy !== null} className={cn(btnGhost, "flex items-center gap-1.5", caBusy && "opacity-60 pointer-events-none")}>
                <BadgeCheck className="w-3.5 h-3.5" />
                {L("Check CA", "بررسی گواهی")}
              </button>
              <button onClick={runUpdateCheck} disabled={updating} className={cn(btnGhost, "flex items-center gap-1.5", updating && "opacity-60 pointer-events-none")}>
                {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {L("Check for updates", "بررسی به‌روزرسانی")}
              </button>
              <span className={cn("w-2 h-2 rounded-full ml-1", caReady ? "bg-emerald-400" : "bg-amber-400")} title={caReady ? L("CA generated", "گواهی ساخته شده") : L("no CA yet", "هنوز گواهی‌ای نیست")} />
            </div>
            {updateOut && (
              <p className="text-[11px] font-mono rounded-xl border border-surface-700/60 bg-surface-950/70 p-2.5 text-ink-200" dir="ltr">
                {updateOut}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Recent log (mhrv-rs parity) */}
      <div className="rounded-2xl border border-surface-700/60 bg-surface-900/50 p-4 space-y-3">
        <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
          <span className="text-emerald-400 flex items-center"><Terminal className="w-3.5 h-3.5" /></span>
          <h4 className="text-xs font-extrabold text-white tracking-wide">{L("Recent log", "لاگ اخیر")}</h4>
          <span className="flex-1" />
          {checkRow(logOpen, (v) => setLogOpen(v), L("show", "نمایش"))}
          <button
            onClick={async () => {
              try {
                const r = await tauriInvoke<{ ok: boolean; path: string | null; detail: string }>("mhrv_logs_save");
                if (r?.ok && r.path) toast.success(L(`Log saved: ${r.path}`, `لاگ ذخیره شد: ${r.path}`), { duration: 6000 });
              } catch (e: any) {
                toast.error(String(e?.message || e));
              }
            }}
            disabled={!logOpen}
            className={cn(btnGhost, "flex items-center gap-1.5", !logOpen && "opacity-50 pointer-events-none")}
          >
            <Save className="w-3 h-3" />
            {L("save…", "ذخیره…")}
          </button>
          <button
            onClick={async () => {
              try {
                await tauriInvoke("mhrv_logs_clear");
                setLogs([]);
                toast(L("Log cleared.", "لاگ پاک شد."));
              } catch (e: any) {
                toast.error(String(e?.message || e));
              }
            }}
            disabled={!logOpen}
            className={cn(btnGhost, "flex items-center gap-1.5", !logOpen && "opacity-50 pointer-events-none")}
          >
            <Trash2 className="w-3 h-3" />
            {L("clear", "پاک کردن")}
          </button>
        </div>
        {logOpen && (
          <div
            ref={logBoxRef}
            className="max-h-56 overflow-y-auto rounded-xl bg-black/70 border border-surface-800/70 p-3 font-mono text-[10px] leading-4 space-y-0.5"
            dir="ltr"
          >
            {logs.map((l, i) => (
              <div
                key={`${l.ts}-${i}`}
                className={cn(
                  "whitespace-pre-wrap break-all",
                  l.level === "info" && "text-emerald-300",
                  l.level === "warn" && "text-amber-300",
                  l.level === "error" && "text-red-300",
                  l.level === "debug" && "text-ink-400"
                )}
              >
                [{fmtLogTs(l.ts)}] {l.level.toUpperCase()} {l.text}
              </div>
            ))}
            {!logs.length && (
              <div className="text-ink-500">{L("no log lines yet — start the proxy, scan or test the relay", "هنوز لاگی نیست — پراکسی را استارت کن، اسکن بگیر یا رله را تست کن")}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const scanCard = () => (
    <div className={cn("rounded-2xl border p-5 space-y-4", "dark:border-surface-700/60 dark:bg-surface-900/50")}>
      <h3 className={cn("flex items-center gap-2 font-extrabold dark:text-white text-sm", isRtl && "flex-row-reverse")}>
        <Radar className="w-4 h-4 text-emerald-400" />
        {L("Google IP scanner (like the original program)", "اسکنر آی‌پی گوگل (مثل خود برنامه اصلی)")}
      </h3>
      <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
        <button
          onClick={runIpScan}
          disabled={ipScanning}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 hover:brightness-110 transition-all",
            ipScanning && "opacity-60 pointer-events-none"
          )}
        >
          {ipScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {ipScanning ? L("Scanning Google edge…", "در حال اسکن لبه گوگل…") : L("Scan Google IPs", "اسکن آی‌پی‌های گوگل")}
        </button>
        <button
          onClick={runSniScan}
          disabled={sniScanning}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-surface-600/80 hover:border-emerald-500/60 text-ink-200",
            sniScanning && "opacity-60 pointer-events-none"
          )}
        >
          {sniScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}
          {sniScanning ? L("Probing SNI…", "در حال آزمایش SNI…") : L("Scan SNI names", "اسکن نام‌های SNI")}
        </button>
        {ipRows && ipRows.some((r) => r.latencyMs !== null) && (
          <button
            onClick={useFastestIp}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
          >
            {L("Use the fastest IP", "استفاده از سریع‌ترین آی‌پی")}
          </button>
        )}
      </div>
      {ipSource && <p className="text-[10px] text-ink-500">{L("scan source", "منبع اسکن")}: {ipSource}</p>}

      {ipRows && (
        <div className="rounded-xl border border-surface-700/50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs font-mono" dir="ltr">
              <thead className="bg-surface-950/80 text-ink-400 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">IP</th>
                  <th className="text-left px-3 py-2">{L("latency", "تأخیر")}</th>
                  <th className="text-left px-3 py-2">{L("status", "وضعیت")}</th>
                </tr>
              </thead>
              <tbody>
                {ipRows.slice(0, 60).map((r, i) => (
                  <tr key={r.ip} className={cn("border-t border-surface-800/60", i % 2 === 0 && "bg-surface-900/30")}>
                    <td className="px-3 py-1.5 text-ink-200">{r.ip}</td>
                    <td className={cn("px-3 py-1.5", r.latencyMs !== null ? (r.latencyMs < 200 ? "text-emerald-400" : r.latencyMs < 600 ? "text-yellow-400" : "text-orange-400") : "text-ink-500")}>
                      {r.latencyMs !== null ? `${r.latencyMs} ms` : "—"}
                    </td>
                    <td className="px-3 py-1.5">{r.latencyMs !== null ? <span className="text-emerald-400">OK · gws</span> : <span className="text-red-400">{r.error}</span>}</td>
                  </tr>
                ))}
                {ipRows.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-ink-500">{L("No results.", "نتیجه‌ای نیست.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sniRows && (
        <div className="rounded-xl border border-surface-700/50 overflow-hidden">
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-xs font-mono" dir="ltr">
              <thead className="bg-surface-950/80 text-ink-400 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">SNI</th>
                  <th className="text-left px-3 py-2">{L("latency", "تأخیر")}</th>
                  <th className="text-left px-3 py-2">{L("note", "یادداشت")}</th>
                </tr>
              </thead>
              <tbody>
                {sniRows.map((r) => (
                  <tr key={r.sni} className="border-t border-surface-800/60">
                    <td className="px-3 py-1.5 text-ink-200">{r.sni}</td>
                    <td className={cn("px-3 py-1.5", r.ok ? "text-emerald-400" : "text-ink-500")}>{r.ok ? `${r.ms} ms` : "—"}</td>
                    <td className={cn("px-3 py-1.5", r.ok ? "text-emerald-400" : "text-red-400")}>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const controlCard = () => (
    <div className={cn("rounded-2xl border p-5 space-y-4", status?.running ? "border-emerald-500/40 bg-emerald-500/5" : "dark:border-surface-700/60 dark:bg-surface-900/50")}>
      <h3 className={cn("flex items-center gap-2 font-extrabold dark:text-white text-sm", isRtl && "flex-row-reverse")}>
        <Server className="w-4 h-4 text-emerald-400" />
        {L("Step 3 · Connect (in-app proxy)", "مرحله ۳ · اتصال (پراکسی داخل برنامه)")}
      </h3>
      {status?.lastError && (
        <p className="text-xs text-red-400 flex items-start gap-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {status.lastError}
        </p>
      )}
      <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
        {status?.running ? (
          <button
            onClick={stopProxy}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-extrabold bg-gradient-to-r from-red-500 to-rose-600 text-white hover:brightness-110 transition-all"
          >
            <Square className="w-4 h-4" />
            {L("Stop proxy", "توقف پراکسی")}
          </button>
        ) : (
          <button
            onClick={startProxy}
            disabled={starting}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-extrabold bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 hover:brightness-110 transition-all",
              starting && "opacity-60 pointer-events-none"
            )}
          >
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {L("Start proxy", "شروع پراکسی")}
          </button>
        )}
        <button
          onClick={runTest}
          disabled={testing}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border border-surface-600/80 hover:border-emerald-500/60 text-ink-200",
            testing && "opacity-60 pointer-events-none"
          )}
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          {L("Test relay", "تست رله")}
        </button>
      </div>
      {testOut && (
        <p className={cn("text-xs font-mono rounded-xl border p-3", "border-surface-700/60 bg-surface-950/70 text-ink-200")} dir="ltr">
          {testOut}
        </p>
      )}
      {status?.running && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { k: L("HTTP", "HTTP"), v: `${status.shareLan ? "0.0.0.0" : "127.0.0.1"}:${status.httpPort}` },
            { k: L("SOCKS5", "SOCKS5"), v: `${status.shareLan ? "0.0.0.0" : "127.0.0.1"}:${status.socksPort}` },
            { k: L("relayed", "رله‌شده"), v: String(status.requestsRelayed) },
            { k: L("fronted", "فرانت‌شده"), v: String(status.requestsFronted) },
          ].map((s) => (
            <div key={s.k} className="rounded-xl bg-surface-950/60 border border-surface-700/40 p-2.5">
              <p className="text-[9px] text-ink-500 uppercase">{s.k}</p>
              <p className="text-xs font-mono text-ink-100 mt-0.5" dir="ltr">{s.v}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-ink-500">
        {L(
          "Point your browser (or MEMENTO's System-Proxy mode after connecting nothing else) at the HTTP port — or use the SOCKS5 port. In direct mode only Google-host traffic takes the fast SNI-rewrite path; everything else passes through unchanged.",
          "مرورگر را روی پورت HTTP بگذار — یا از پورت SOCKS5 استفاده کن. در حالت مستقیم فقط ترافیک سرویس‌های گوگل از مسیر سریع SNI می‌رود؛ بقیه ترافیک بدون تغییر رد می‌شود."
        )}
      </p>
    </div>
  );

  // H-c tsc fix: the card builders want "apps_script" | "cfw" — map the
  // UI sub-tab id ("mhrv") onto the relay variant explicitly.
  const cardVariant: CardVariant = subTab === "cfw" ? "cfw" : "apps_script";

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader titleKey="googleside.title" descKey="googleside.desc" hintKey="hint.googleSide" icon={Globe} />

      {/* sub-tabs */}
      <div className={cn("flex gap-2", isRtl && "flex-row-reverse")}>
        {([
          { id: "mhrv" as const, label: L("MHRV", "MHRV"), icon: Globe },
          { id: "cfw" as const, label: L("MHRV CFW", "MHRV CFW"), icon: Zap },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-extrabold transition-all",
              subTab === tab.id
                ? "bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 shadow-lg shadow-emerald-500/20"
                : "border border-surface-700/60 text-ink-300 hover:border-emerald-500/50"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {!isDesktop() && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-5 text-sm text-yellow-300">
          {L("GOOGLE SIDE needs the desktop app.", "گوگل ساید به برنامه دسکتاپ نیاز دارد.")}
        </div>
      )}

      {isDesktop() && (
        <>
          {setupCard(cardVariant)}
          {settingsCard(cardVariant)}
          {subTab === "mhrv" && scanCard()}
          {controlCard()}
          {cfg?.mode === "apps_script" && !cfg?.authKeySet && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                {L("Set the auth key (the same string that is now inside your pasted Code.gs) — the relay refuses requests without it.", "کلید احراز را وارد کن (همان رشته‌ای که الان داخل Code.gs پیست‌شده است) — رله بدون آن درخواست را رد می‌کند.")}
              </p>
            </div>
          )}
          {status?.running && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <p className="text-xs text-emerald-300">
                {L("MHRV proxy is live — apps using the HTTP/SOCKS port are relayed through Google now.", "پراکسی MHRV فعال است — برنامه‌هایی که از پورت HTTP/SOCKS استفاده می‌کنند از طریق گوگل رله می‌شوند.")}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
