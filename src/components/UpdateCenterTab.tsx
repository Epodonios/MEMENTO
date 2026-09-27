/**
 * MEMENTO — Update Center tab (taskF3 — full redesign + bugfix surface).
 *
 * Four clear cards — MEMENTO, Xray, sing-box, Aether — each with:
 *   - the REAL installed version (main-side probes the actual live binary
 *     via paths.ts ladder — the bugfix; previously a bundled core could
 *     never show its version, so "up to date" could never be reported)
 *   - latest version (GitHub Releases redirect trick, no API quota)
 *   - a live phase/progress block during download (per-card, not global —
 *     the old UI shared ONE busy flag + ONE percent across all cores)
 *   - Check / Update / Rollback buttons that all work without dead states
 *
 * The MEMENTO card is the honest assistant (Option A): static facts +
 * the releases page in the USER's browser. The app never self-swaps.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import {
  RefreshCcw, Download, AlertTriangle, Cpu, Orbit, ArrowLeftRight,
  Search, ShieldCheck, ExternalLink, Loader2, ArrowUpCircle, Clock,
  Pause, Play, XCircle,
} from "lucide-react";
import { isDesktop, tauriInvoke, onMainEvent, openExternalLink } from "../utils/tauriBridge";

interface UpdateEntryWire {
  core: "xray" | "sing-box";
  binFound: boolean;
  binPath: string | null;
  installedVersion: string | null;
  source: "updates" | "bundled" | "none";
  lastCheckedAt: string | null;
  latestVersion: string | null;
  lastPhase: string;
  lastDetail: string | null;
  canRollback: boolean;
  canResume?: boolean;
}

interface AetherStatusWire {
  bundledVersion: string;
  activeVersion: string | null;
  activeIdentified: boolean;
  binaryFound: boolean;
  table: { version: string; installable: boolean }[];
}

interface AppUpdateInfoWire {
  appVersion: string;
  releasesUrl: string;
  selfUpdate: false;
}

/** Numeric-ish version compare: "1.14.0" vs "v1.15.2". */
function cmpVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function timeAgo(iso: string | null, L: (en: string, fa: string) => string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return L("just now", "همین حالا");
  if (m < 60) return L(`${m}m ago`, `${m} دقیقه پیش`);
  const h = Math.floor(m / 60);
  if (h < 24) return L(`${h}h ago`, `${h} ساعت پیش`);
  return L(`${Math.floor(h / 24)}d ago`, `${Math.floor(h / 24)} روز پیش`);
}

export default function UpdateCenterTab() {
  const { language } = useStore();
  const isRtl = language === "fa" || language === "ar";
  const L = useCallback((en: string, fa: string) => (language === "fa" ? fa : en), [language]);

  const [entries, setEntries] = useState<UpdateEntryWire[]>([]);
  const [aether, setAether] = useState<AetherStatusWire | null>(null);
  const [appInfo, setAppInfo] = useState<AppUpdateInfoWire | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Record<string, string>>({});
  const [percent, setPercent] = useState<Record<string, number | null>>({});

  const setBusyKey = (k: string | null) =>
    setBusy((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) next[key] = false;
      if (k) next[k] = true;
      return next;
    });

  const refresh = useCallback(async () => {
    if (!isDesktop()) return;
    try {
      const list = await tauriInvoke<UpdateEntryWire[]>("update_center_list");
      setEntries(Array.isArray(list) ? list : []);
    } catch {
      /* best-effort */
    }
    try {
      const st = await tauriInvoke<AetherStatusWire>("aether_update_status");
      setAether(st ?? null);
    } catch {
      /* best-effort */
    }
    try {
      const info = await tauriInvoke<AppUpdateInfoWire>("app_update_info");
      setAppInfo(info ?? null);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    refresh();
    const off = onMainEvent("update_center_progress", (payload) => {
      const ev = payload as { core?: string; phase?: string; percent?: number };
      if (!ev?.core) return;
      setPhase((p) => ({ ...p, [ev.core!]: ev.phase || "" }));
      setPercent((p) => ({ ...p, [ev.core!]: typeof ev.percent === "number" ? ev.percent : null }));
      if (ev.phase === "done" || ev.phase === "error" || ev.phase === "blocked-running" || ev.phase === "paused" || ev.phase === "cancelled") {
        refresh();
      }
    });
    return off;
  }, [refresh]);

  const check = async (core: "xray" | "sing-box") => {
    const key = `check-${core}`;
    setBusyKey(key);
    setPhase((p) => ({ ...p, [core]: "checking" }));
    try {
      const out = await tauriInvoke<{ latest: string | null }>("update_center_check", { core });
      if (out?.latest) {
        toast.success(L(`Latest ${core}: ${out.latest}`, `آخرین ${core}: ${out.latest}`));
      } else {
        toast.error(
          L(
            "Could not reach GitHub Releases — check the internet and try again.",
            "دسترسی به GitHub Releases نشد — اینترنت را چک کن و دوباره امتحان کن."
          )
        );
      }
      await refresh();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusyKey(null);
      setPhase((p) => ({ ...p, [core]: "" }));
    }
  };

  const checkAll = async () => {
    setBusyKey("check-all");
    try {
      await Promise.all([
        tauriInvoke("update_center_check", { core: "xray" }).catch(() => null),
        tauriInvoke("update_center_check", { core: "sing-box" }).catch(() => null),
      ]);
      await refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const update = async (core: "xray" | "sing-box", resume = false) => {
    const key = `update-${core}`;
    if (resume) setBusyKey(key); // a paused download shows its own resume button
    else {
      setBusyKey(key);
      setPercent((p) => ({ ...p, [core]: 0 }));
      setPhase((p) => ({ ...p, [core]: "downloading" }));
    }
    try {
      const res = await tauriInvoke<{ ok: boolean; phase: string; detail?: string; version?: string }>(
        "update_center_download",
        { core, resume }
      );
      if (res?.ok) {
        toast.success(
          L(
            `${core} updated to v${res.version} ✓ — it will be used on the next connection.`,
            `${core} به نسخه v${res.version} به‌روزرسانی شد ✓ — در اتصال بعدی استفاده می‌شود.`
          ),
          { duration: 8000 }
        );
      } else if (res?.phase === "paused") {
        toast(
          L(
            "Download paused — Resume continues from where it stopped.",
            "دانلود متوقف شد — ادامه از همان‌جا دوباره شروع می‌شود."
          ),
          { icon: "⏸️", duration: 6000 }
        );
      } else if (res?.phase === "cancelled") {
        toast(
          L("Download cancelled — the partial file was removed.", "دانلود لغو شد — فایل ناقص حذف شد."),
          { icon: "🗑️", duration: 5000 }
        );
      } else if (res?.phase === "blocked-running") {
        toast.error(
          L(
            "The core is running — disconnect first, then press Update again to install the downloaded version.",
            "هسته در حال اجراست — ابتدا قطع کن، بعد دوباره به‌روزرسانی را بزن تا نسخه دانلودشده نصب شود."
          ),
          { duration: 10000 }
        );
      } else if (res && res.phase !== "paused") {
        toast.error(`${L("Update failed", "به‌روزرسانی ناموفق بود")}: ${res?.detail ?? res?.phase ?? ""}`, {
          duration: 10000,
        });
      }
      await refresh();
    } catch (e: any) {
      toast.error(String(e?.message || e), { duration: 10000 });
    } finally {
      setBusyKey(null);
      setPercent((p) => ({ ...p, [core]: null }));
      if (phaseRef.current[core] !== "paused") setPhase((p) => ({ ...p, [core]: "" }));
    }
  };

  // mirror of the phase state for the finally-block above (no stale read)
  const phaseRef = useRef<Record<string, string>>({});
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  /** 3.1.8: pause the running download (the pipeline returns "paused"). */
  const pauseDownload = async (core: "xray" | "sing-box") => {
    try {
      await tauriInvoke("update_center_pause", { core });
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  /** 3.1.8: cancel the running/paused download + discard the partial.
   *  (When a download is RUNNING the pipeline itself returns "cancelled"
   *  and the update() invoke shows the toast — no duplicate here.) */
  const cancelDownload = async (core: "xray" | "sing-box") => {
    try {
      await tauriInvoke("update_center_cancel", { core });
      if (phaseRef.current[core] === "paused") {
        toast(
          L("Download cancelled — the partial file was removed.", "دانلود لغو شد — فایل ناقص حذف شد."),
          { icon: "🗑️", duration: 5000 }
        );
        setPhase((p) => ({ ...p, [core]: "" }));
      }
      await refresh();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const rollback = async (core: "xray" | "sing-box") => {
    const key = `rollback-${core}`;
    setBusyKey(key);
    try {
      const res = await tauriInvoke<{ ok: boolean; detail?: string }>("update_center_rollback", { core });
      if (res?.ok) {
        toast.success(L("Rolled back to the previous version ✓", "به نسخه قبلی برگشت ✓"));
      } else {
        toast.error(res?.detail || L("Rollback failed", "برگشت ناموفق بود"));
      }
      await refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const aetherCheck = async () => {
    setBusyKey("check-aether");
    try {
      const out = await tauriInvoke<any>("aether_update_check");
      if (out?.kind === "up-to-date") {
        toast.success(L("Aether is already the newest pinned version ✓", "Aether از قبل جدیدترین نسخه پین‌شده است ✓"));
      } else if (out?.kind === "pinned-newer") {
        // taskF3 bugfix: the old toast had a typo ("موجب است") + a doubled
        // "v" prefix — the version now renders exactly once.
        toast.success(L(`A newer pinned Aether is available: v${out.version}`, `نسخه پین‌شده جدیدی برای Aether موجود است: v${out.version}`));
      } else if (out?.kind === "blocked-running") {
        toast.error(L("Aether is running — disconnect first.", "Aether در حال اجراست — ابتدا قطع کن."));
      } else if (out?.detail) {
        toast(String(out.detail));
      }
      await refresh();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusyKey(null);
    }
  };

  const aetherApply = async (version: string) => {
    setBusyKey("update-aether");
    try {
      const out = await tauriInvoke<any>("aether_update_apply", { version });
      if (out?.reason === "ok") {
        toast.success(L(`Aether updated to v${out.version} ✓`, `Aether به نسخه v${out.version} به‌روزرسانی شد ✓`));
      } else if (out?.reason === "blocked-running") {
        toast.error(L("Aether is running — disconnect first.", "Aether در حال اجراست — ابتدا قطع کن."));
      } else {
        toast.error(`${L("Update failed", "به‌روزرسانی ناموفق بود")}: ${out?.reason ?? ""}`);
      }
      await refresh();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusyKey(null);
    }
  };

  /* ---------- per-card derived state ---------- */
  const cardState = (e: UpdateEntryWire) => {
    const installed = e.installedVersion ? e.installedVersion.replace(/^v/, "") : null;
    const latest = e.latestVersion ? e.latestVersion.replace(/^v/, "") : null;
    const upToDate = !!(installed && latest && cmpVersions(installed, latest) >= 0);
    const updateAvailable = !!(installed && latest && cmpVersions(installed, latest) < 0);
    const unknownLatest = !!(installed && latest === null);
    return { installed, latest, upToDate, updateAvailable, unknownLatest };
  };

  const pill = (text: string, cls: string) => (
    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap", cls)}>{text}</span>
  );

  const versionPill = (st: ReturnType<typeof cardState>) => {
    if (st.upToDate)
      return pill(L("Up to date", "به‌روز"), "bg-emerald-500/15 text-emerald-400");
    if (st.updateAvailable)
      return pill(L("Update available", "به‌روزرسانی موجود"), "bg-amber-500/15 text-amber-400");
    return pill(L("Unchecked", "بررسی نشده"), "bg-surface-700/60 text-ink-300");
  };

  const phaseText = (core: string): string => {
    const ph = phase[core] || "";
    switch (ph) {
      case "checking": return L("Checking…", "در حال بررسی…");
      case "downloading": {
        const pc = percent[core];
        return pc !== null && pc !== undefined && pc > 0
          ? L(`Downloading ${pc}%`, `در حال دانلود ${pc}٪`)
          : L("Downloading…", "در حال دانلود…");
      }
      case "paused": return L("Paused", "متوقف شد");
      case "cancelled": return L("Cancelled", "لغو شد");
      case "extracting": return L("Extracting…", "در حال استخراج…");
      case "verifying": return L("Verifying binary…", "تأیید باینری…");
      case "applying": return L("Installing…", "در حال نصب…");
      case "done": return L("Installed ✓", "نصب شد ✓");
      case "blocked-running": return L("Waiting for disconnect", "منتظر قطع اتصال");
      case "error": return L("Error", "خطا");
      default: return "";
    }
  };

  const anyBusy = Object.values(busy).some(Boolean);
  const glassCard = "rounded-2xl border border-surface-700/60 bg-surface-900/50 backdrop-blur-xl shadow-xl shadow-black/20 p-5";

  /* ---------- the four cards ---------- */
  const headerBtn =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-surface-600/80 hover:border-emerald-500/60 text-ink-200 disabled:opacity-50 disabled:pointer-events-none";
  const primaryBtn =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-gradient-to-r from-emerald-500 to-green-600 text-black/80 hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-emerald-500/20";

  const progressBlock = (core: string) =>
    phase[core] ? (
      <div className="mt-3">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
          {phase[core] === "paused" ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Loader2 className={cn("w-3.5 h-3.5", phase[core] !== "paused" && phase[core] !== "cancelled" && "animate-spin")} />
          )}
          {phaseText(core)}
        </div>
        {(phase[core] === "downloading" || phase[core] === "paused") && percent[core] !== null && (
          <div className="h-1.5 mt-1.5 rounded-full bg-surface-800 overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                phase[core] === "paused"
                  ? "bg-gradient-to-r from-amber-500 to-yellow-400"
                  : "bg-gradient-to-r from-emerald-500 to-green-400"
              )}
              style={{ width: `${Math.max(2, percent[core] || 0)}%` }}
            />
          </div>
        )}
        {/* 3.1.8: pause / resume / cancel controls — live during the
            download (NOT gated on the busy flag, which belongs to the
            Update button's own invoke) and after a pause. */}
        {(phase[core] === "downloading" || phase[core] === "paused") && (
          <div className={cn("flex items-center gap-2 mt-2", isRtl && "flex-row-reverse")}>
            {phase[core] === "downloading" ? (
              <button
                onClick={() => pauseDownload(core as "xray" | "sing-box")}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-all"
              >
                <Pause className="w-3 h-3" />
                {L("Pause", "توقف")}
              </button>
            ) : (
              <button
                onClick={() => update(core as "xray" | "sing-box", true)}
                disabled={anyBusy}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-50"
              >
                <Play className="w-3 h-3" />
                {L("Resume", "ادامه")}
              </button>
            )}
            <button
              onClick={() => cancelDownload(core as "xray" | "sing-box")}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all"
            >
              <XCircle className="w-3 h-3" />
              {L("Cancel", "لغو")}
            </button>
          </div>
        )}
      </div>
    ) : null;

  const coreCard = (e: UpdateEntryWire) => {
    const st = cardState(e);
    // BUGFIX (3.1.6): the old code assigned the component to a lowercase
    // `icon` variable and rendered <icon /> — JSX compiled that to a
    // literal unknown DOM element, so the Xray/sing-box cards showed an
    // EMPTY icon tile. Capitalized component reference renders it.
    const Icon = e.core === "xray" ? Cpu : Orbit;
    return (
      <div key={e.core} className={glassCard}>
        <div className={cn("flex items-start gap-3", isRtl && "flex-row-reverse")}>
          <div
            className={cn(
              "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
              e.core === "xray"
                ? "bg-gradient-to-br from-emerald-400 to-green-600"
                : "bg-gradient-to-br from-teal-400 to-emerald-600"
            )}
          >
            <Icon className="w-5 h-5 text-black/80" />
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
              <h3 className="font-extrabold text-base dark:text-white">{e.core === "xray" ? "xray-core" : "sing-box"}</h3>
              {e.source === "updates" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold">
                  {L("via Update Center", "از طریق به‌روزرسان")}
                </span>
              )}
              {versionPill(st)}
            </div>
            <p className="text-xs text-ink-400 mt-1.5 font-mono break-all flex items-center gap-2 flex-wrap" dir="ltr">
              <span>
                {e.installedVersion
                  ? `${L("Installed", "نصب‌شده")}: v${e.installedVersion}`
                  : L("not detected on this machine", "روی این سیستم پیدا نشد")}
              </span>
              {e.latestVersion && (
                <span className={cn(st.updateAvailable ? "text-amber-400" : st.upToDate ? "text-emerald-400" : "")}>
                  · {L("latest", "آخرین")}: {e.latestVersion}
                </span>
              )}
              {e.lastCheckedAt && (
                <span className="text-ink-600 flex items-center gap-1">
                  · <Clock className="w-3 h-3" /> {timeAgo(e.lastCheckedAt, L)}
                </span>
              )}
            </p>
            {st.unknownLatest && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {L("Press Check to query GitHub Releases.", "برای پرس‌وجو از GitHub Releases دکمه بررسی را بزن.")}
              </p>
            )}
            {e.lastPhase === "error" && !e.latestVersion && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {L(
                  "Could not reach GitHub Releases — check your internet, then press Check.",
                  "دسترسی به GitHub Releases نشد — اینترنت را چک کن و دوباره بررسی را بزن."
                )}
              </p>
            )}
            {progressBlock(e.core)}
          </div>
          <div className={cn("flex flex-col gap-2 shrink-0", isRtl && "items-end")}>
            <button onClick={() => check(e.core)} disabled={anyBusy} className={headerBtn}>
              <Search className="w-3.5 h-3.5" />
              {busy[`check-${e.core}`] ? L("Checking…", "بررسی…") : L("Check", "بررسی")}
            </button>
            {(st.updateAvailable || (e.latestVersion && !e.installedVersion)) && (
              <button onClick={() => update(e.core)} disabled={anyBusy} className={primaryBtn}>
                <Download className="w-3.5 h-3.5" />
                {percent[e.core] !== null && percent[e.core] !== undefined && percent[e.core]! > 0
                  ? L(`Downloading ${percent[e.core]}%`, `در حال دانلود ${percent[e.core]}٪`)
                  : L("Update", "به‌روزرسانی")}
              </button>
            )}
            {e.canRollback && (
              <button onClick={() => rollback(e.core)} disabled={anyBusy} className={headerBtn + " border-amber-500/40 text-amber-400 hover:bg-amber-500/10"}>
                <ArrowLeftRight className="w-3.5 h-3.5" />
                {L("Roll back", "برگشت به قبلی")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const aetherLatestInstallable = aether?.table
    ?.filter((v) => v.installable && (!aether.activeVersion || cmpVersions(v.version, aether.activeVersion) > 0))
    .sort((x, y) => cmpVersions(y.version, x.version))[0];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader titleKey="updateCenter.title" descKey="updateCenter.desc" hintKey="hint.updateCenter" icon={RefreshCcw} />

      <div className={cn("flex items-center justify-between flex-wrap gap-2", isRtl && "flex-row-reverse")}>
        <p className="text-xs text-ink-400">
          {L(
            "Downloads are verified (the new binary must run and report its version) and installed atomically with a .bak rollback.",
            "دانلودها تأیید می‌شوند (باینری جدید باید اجرا شود و نسخه‌اش را اعلام کند) و به‌صورت امن با قابلیت برگشت نصب می‌شوند."
          )}
        </p>
        <button onClick={checkAll} disabled={anyBusy || !isDesktop()} className={headerBtn}>
          <RefreshCcw className={cn("w-3.5 h-3.5", busy["check-all"] && "animate-spin")} />
          {L("Check all", "بررسی همه")}
        </button>
      </div>

      {!isDesktop() && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-5 text-sm text-yellow-300">
          {L("Update Center needs the desktop app.", "به‌روزرسان به برنامه دسکتاپ نیاز دارد.")}
        </div>
      )}

      {/* MEMENTO card — the honest assistant */}
      <div className={glassCard}>
        <div className={cn("flex items-start gap-3", isRtl && "flex-row-reverse")}>
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-black/80" />
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
              <h3 className="font-extrabold text-base dark:text-white">MEMENTO</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold font-mono" dir="ltr">
                v{appInfo?.appVersion || "3.2.0"}
              </span>
              {pill(L("Portable app", "برنامه پرتابل"), "bg-surface-700/60 text-ink-300")}
            </div>
            <p className="text-xs text-ink-400 mt-1.5 leading-relaxed">
              {L(
                "A portable app never replaces its own executable. New releases are published on the MEMENTO releases page — open it, download the new build, and run it. Your data survives every reinstall.",
                "یک برنامه پرتابل هرگز فایل اجرایی خودش را عوض نمی‌کند. نسخه‌های جدید در صفحه انتشار MEMENTO منتشر می‌شوند — بازش کن، نسخه جدید را بگیر و اجرا کن. داده‌های شما از هر نصب مجدد جان سالم به در می‌برند."
              )}
            </p>
          </div>
          <div className={cn("flex flex-col gap-2 shrink-0", isRtl && "items-end")}>
            <button
              onClick={() => appInfo && openExternalLink(appInfo.releasesUrl)}
              className={primaryBtn}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {L("Releases page", "صفحه انتشارها")}
            </button>
            {appInfo?.releasesUrl && (
              <a
                href={appInfo.releasesUrl}
                onClick={(ev) => {
                  ev.preventDefault();
                  void openExternalLink(appInfo.releasesUrl);
                }}
                className="text-[10px] text-ink-500 hover:text-emerald-400 font-mono text-center break-all max-w-44"
                dir="ltr"
              >
                {appInfo.releasesUrl.replace("https://", "")}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Xray + sing-box cards */}
      {entries.map(coreCard)}

      {/* Aether card — the pinned per-version service */}
      <div className={glassCard}>
        <div className={cn("flex items-start gap-3", isRtl && "flex-row-reverse")}>
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shrink-0">
            <Orbit className="w-5 h-5 text-black/80" />
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
              <h3 className="font-extrabold text-base dark:text-white">Aether</h3>
              {aether && aether.activeVersion && versionPill({
                installed: aether.activeVersion,
                latest: aetherLatestInstallable?.version ?? null,
                upToDate: !aetherLatestInstallable,
                updateAvailable: !!aetherLatestInstallable,
                unknownLatest: false,
              })}
            </div>
            <p className="text-xs text-ink-400 mt-1.5 font-mono break-all" dir="ltr">
              {aether
                ? `${L("Active", "فعلی")}: ${aether.activeVersion ? `v${aether.activeVersion}` : aether.bundledVersion}${aether.activeIdentified ? "" : ` (${L("bundled", "داخلی")})`}`
                : L("Aether update service unavailable", "سرویس به‌روزرسانی Aether در دسترس نیست")}
            </p>
            <p className="text-[10px] text-ink-500 mt-1 leading-relaxed">
              {L(
                "Aether updates are hash-pinned: only versions verified in the built-in table install.",
                "به‌روزرسانی Aether با هش پین‌شده است: فقط نسخه‌های تأییدشده در جدول داخلی نصب می‌شوند."
              )}
            </p>
            {aetherLatestInstallable && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <ArrowUpCircle className="w-3.5 h-3.5" />
                {L(`Pinned update available: v${aetherLatestInstallable.version}`, `به‌روزرسانی پین‌شده موجود است: v${aetherLatestInstallable.version}`)}
              </p>
            )}
          </div>
          <div className={cn("flex flex-col gap-2 shrink-0", isRtl && "items-end")}>
            <button onClick={aetherCheck} disabled={anyBusy} className={headerBtn}>
              <Search className="w-3.5 h-3.5" />
              {busy["check-aether"] ? L("Checking…", "بررسی…") : L("Check", "بررسی")}
            </button>
            {aetherLatestInstallable && (
              <button onClick={() => aetherApply(aetherLatestInstallable.version)} disabled={anyBusy} className={primaryBtn}>
                <Download className="w-3.5 h-3.5" />
                {L("Update", "به‌روزرسانی")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
