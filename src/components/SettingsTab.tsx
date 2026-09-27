import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { tauriInvoke, openExternalLink } from "../utils/tauriBridge";
import { invalidateTestUrlCache } from "../utils/urlTest";
import { collectBackup, parseBackup, applyBackup, downloadBackup } from "../utils/appBackup";
import { DEFAULT_BUILDER_OPTIONS, parseFragmentRange, type BuilderOptions } from "../utils/builderOptions";
import SectionHeader from "./SectionHeader";
import { Settings, AppWindow, Keyboard, Archive, Save, FolderInput, SlidersHorizontal, AlertTriangle, RotateCcw, Download, ScrollText, Trash2, RefreshCcw, Copy } from "lucide-react";
import toast from "react-hot-toast";

/** Phase C1: are any of the three fragment ranges malformed? (drives the
 *  amber hint; the generator independently treats bad ranges as OFF). */
function fragmentRangesInvalid(o: BuilderOptions): boolean {
  return parseFragmentRange(o.tlsFragmentPackets, true) === null
    || parseFragmentRange(o.tlsFragmentLength) === null
    || parseFragmentRange(o.tlsFragmentInterval) === null;
}

/**
 * Phase D4 — the dedicated Settings tab (quick-win item 8).
 *
 * Final home of the D3 interim "App Options" panel (auto-start, global
 * hotkeys, backup/restore — moved verbatim from ConfigsTab) plus the new
 * Close-to-tray toggle. Everything is a thin, honest mirror of the MAIN
 * process state (electron/appPrefs.ts): every app_prefs_get / app_prefs_set
 * reply REPLACES the local state, so this UI can never drift from what the
 * OS actually has. The browser preview (electron-mock.ts) simulates the
 * same shape so the page is fully explorable without a shell.
 *
 * Tray strings themselves live main-side (electron/tray.ts) because the
 * tray menu and the one-time balloon render without any renderer.
 */

interface PrefsView {
  hotkeyShowHide: boolean;
  hotkeyConnect: boolean;
  hotkeysActive?: { showHide: boolean; connect: boolean };
  autostartSupported: boolean;
  autostartEnabled: boolean;
  closeToTray: boolean;
  /** Phase C2: the real-delay test URL (appPrefs.testUrl). */
  testUrl: string;
}

/** Phase C6 (Option A): static facts for the honest self-update panel. */
interface AppUpdateInfoWire {
  appVersion: string;
  releasesUrl: string;
  selfUpdate: boolean;
}

export default function SettingsTab() {
  const language = useStore(s => s.language);
  const builderOptions = useStore(s => s.builderOptions);
  const setBuilderOptions = useStore(s => s.setBuilderOptions);
  // Phase C5: the kill-switch toggle reads the store MIRROR (boot-loaded
  // from app_prefs_get) and persists through the same setter — the toggle
  // itself never touches the prefs fetch shape.
  const killSwitchArmed = useStore(s => s.killSwitchArmed);
  const setKillSwitchArmed = useStore(s => s.setKillSwitchArmed);
  const isRtl = language === "fa" || language === "ar";
  const [prefs, setPrefs] = useState<PrefsView | null>(null);
  const [appUpd, setAppUpd] = useState<AppUpdateInfoWire | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    tauriInvoke<PrefsView>("app_prefs_get")
      .then(p => { if (alive && p) setPrefs(p); })
      .catch(() => { /* shell unreachable — page stays in its default shape */ });
    // Phase C6: static facts only — this triggers NO network activity and
    // NO update check (the app never checks for itself; the user opens
    // the releases page in their own browser when they want to).
    tauriInvoke<AppUpdateInfoWire>("app_update_info")
      .then(info => { if (alive && info) setAppUpd(info); })
      .catch(() => { /* shell unreachable — the section stays hidden-ish */ });
    return () => { alive = false; };
  }, []);

  const patchPrefs = async (patch: { hotkeyShowHide?: boolean; hotkeyConnect?: boolean; closeToTray?: boolean; testUrl?: string }) => {
    try {
      const next = await tauriInvoke<PrefsView>("app_prefs_set", { patch });
      if (next) setPrefs(next);
      return next;
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
      return null;
    }
  };

  // Phase C2: the test URL is a TEXT field, so it keeps a local draft —
  // every app_prefs reply replaces `prefs`, but typing must never fight
  // that async loop. Save commits the draft; if the main-side sanitizer
  // (normalizeTestUrl) drops an invalid URL, the reply carries the
  // PREVIOUS value back and the draft honestly reverts to it.
  const [testUrlDraft, setTestUrlDraft] = useState<string>("");
  const testUrlSyncedRef = useRef(false);
  useEffect(() => {
    if (prefs && !testUrlSyncedRef.current) {
      setTestUrlDraft(prefs.testUrl ?? "");
      testUrlSyncedRef.current = true;
    }
  }, [prefs]);
  const testUrlDraftValid = (() => {
    const s = testUrlDraft.trim();
    if (!s || s.length > 500 || /\s/.test(s)) return false;
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  })();
  const saveTestUrl = async () => {
    const next = await patchPrefs({ testUrl: testUrlDraft.trim() });
    if (next) {
      // Reply is the authority — an invalid draft shows its previous value.
      setTestUrlDraft(next.testUrl ?? testUrlDraft);
      // The probe runners cache the pref; force a re-read after a change.
      invalidateTestUrlCache();
      toast.success(t("set.testUrl", language));
    }
  };

  const toggleAutostart = async (enabled: boolean) => {
    if (prefs && !prefs.autostartSupported) {
      toast(t("appopt.autostartUnsupported", language), { icon: "ℹ️" });
      return;
    }
    try {
      const next = await tauriInvoke<{ autostartSupported: boolean; autostartEnabled: boolean }>("autostart_set", { enabled });
      if (next) setPrefs(p => (p ? { ...p, ...next } : p));
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    }
  };

  const handleExport = () => {
    try {
      downloadBackup(collectBackup());
      toast.success(t("appopt.backupExported", language));
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    }
  };

  const handleBackupFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let parsed;
      try {
        parsed = parseBackup(String(e.target?.result || ""));
      } catch (err) {
        toast.error(`${t("appopt.backupBad", language)} — ${String((err as Error)?.message || err)}`);
        return;
      }
      const n = parsed.counts.configs + parsed.counts.groups;
      if (!window.confirm(t("appopt.backupImportConfirm", language).replace("{n}", String(n)))) return;
      const restored = applyBackup(parsed);
      toast.success(`${t("appopt.backupRestored", language)} (${restored})`);
      // Reload so the store's init() re-reads every persisted blob.
      setTimeout(() => window.location.reload(), 700);
    };
    reader.readAsText(file);
  };

  const hotkeyStale = (wanted: boolean, active: boolean | undefined) =>
    wanted && active === false;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader titleKey="tab.settings" descKey="appopt.hint" hintKey="hint.settings" icon={Settings} />

      <div className={cn("max-w-4xl mx-auto space-y-4 relative", isRtl && "text-right")}>
        {/* ---------- Section 1: Window & Startup ---------- */}
        <SettingsSection icon={AppWindow} titleKey="set.sectionWindow" language={language}>
          {!prefs ? (
            <LoadingRow language={language} />
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              <PrefToggle
                label={t("set.closeToTray", language)}
                hint={t("set.closeToTrayHint", language)}
                checked={prefs.closeToTray}
                onChange={v => patchPrefs({ closeToTray: v })}
              />
              <PrefToggle
                label={t("appopt.autostart", language)}
                hint={t("appopt.autostartHint", language)}
                checked={prefs.autostartEnabled}
                onChange={toggleAutostart}
              />
              <PrefToggle
                label={t("set.killSwitch", language)}
                hint={t("hint.killSwitch", language)}
                checked={killSwitchArmed}
                onChange={v => setKillSwitchArmed(v)}
              />
            </div>
          )}
        </SettingsSection>

        {/* ---------- Section 2: Global Hotkeys ---------- */}
        <SettingsSection icon={Keyboard} titleKey="set.sectionHotkeys" language={language}>
          {!prefs ? (
            <LoadingRow language={language} />
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-700/50 bg-surface-900/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">{t("appopt.hotkeyShow", language)}</p>
                  <p className="text-[11px] text-surface-400 mt-0.5">{t("appopt.hotkeyShowHint", language)}</p>
                  {hotkeyStale(prefs.hotkeyShowHide, prefs.hotkeysActive?.showHide) && (
                    <p className="text-[11px] text-amber-400 mt-0.5">{t("appopt.hotkeyStolen", language)}</p>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" checked={prefs.hotkeyShowHide} onChange={e => patchPrefs({ hotkeyShowHide: e.target.checked })} className="sr-only peer" />
                  <div className="w-11 h-6 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-surface-700 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-700/50 bg-surface-900/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">{t("appopt.hotkeyConn", language)}</p>
                  <p className="text-[11px] text-surface-400 mt-0.5">{t("appopt.hotkeyConnHint", language)}</p>
                  {hotkeyStale(prefs.hotkeyConnect, prefs.hotkeysActive?.connect) && (
                    <p className="text-[11px] text-amber-400 mt-0.5">{t("appopt.hotkeyStolen", language)}</p>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" checked={prefs.hotkeyConnect} onChange={e => patchPrefs({ hotkeyConnect: e.target.checked })} className="sr-only peer" />
                  <div className="w-11 h-6 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-surface-700 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            </div>
          )}
        </SettingsSection>

        {/* ---------- Section 3: Connection Builder (moved from ConfigsTab,
                its locked D4 home per the D2 panel comment) ---------- */}
        <SettingsSection icon={SlidersHorizontal} titleKey="builder.title" language={language}>
          <BuilderOptionsPanel options={builderOptions} onChange={setBuilderOptions} language={language} />

          {/* Phase C2: custom test URL for the real-delay test — persisted as
              appPrefs.testUrl, used by every url_test probe (row, batch and
              the live-tunnel test on the Connection tab). */}
          {prefs && (
            <div className="mt-3 rounded-xl border border-surface-700/50 bg-surface-900/60 px-4 py-3">
              <p className="text-sm font-bold text-white">{t("set.testUrl", language)}</p>
              <p className="text-[11px] text-surface-400 mt-0.5">{t("set.testUrlHint", language)}</p>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  dir="ltr"
                  value={testUrlDraft}
                  onChange={e => setTestUrlDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && testUrlDraftValid && testUrlDraft.trim() !== (prefs.testUrl ?? "")) saveTestUrl(); }}
                  spellCheck={false}
                  className={cn(
                    "flex-1 min-w-0 rounded-lg bg-surface-950/80 border px-3 py-2 text-xs font-mono text-white outline-none transition-colors",
                    testUrlDraftValid ? "border-surface-700/50 focus:border-teal-500/50" : "border-red-500/60"
                  )}
                />
                <button
                  onClick={saveTestUrl}
                  disabled={!testUrlDraftValid || testUrlDraft.trim() === (prefs.testUrl ?? "")}
                  className={cn(
                    "px-3 py-2 rounded-lg text-xs font-bold shrink-0 transition-colors",
                    !testUrlDraftValid || testUrlDraft.trim() === (prefs.testUrl ?? "")
                      ? "bg-surface-800 text-surface-500 cursor-not-allowed"
                      : "bg-gradient-to-r from-teal-400 to-emerald-500 text-black/90 hover:brightness-110"
                  )}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </SettingsSection>

        {/* ---------- Section 4: Backup & Restore ---------- */}
        <SettingsSection icon={Archive} titleKey="set.sectionBackup" language={language}>
          {!prefs ? (
            <LoadingRow language={language} />
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-700/50 bg-surface-900/60 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">{t("appopt.backup", language)}</p>
                <p className="text-[11px] text-surface-400 mt-0.5">{t("appopt.backupHint", language)}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={handleExport}
                  className="p-2 rounded-lg text-xs font-medium bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-white transition-colors"
                  title={t("appopt.backupExport", language)}
                >
                  <Save className="w-4 h-4" />
                </button>
                <button
                  onClick={() => backupInputRef.current?.click()}
                  className="p-2 rounded-lg text-xs font-medium bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-white transition-colors"
                  title={t("appopt.backupImport", language)}
                >
                  <FolderInput className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          <input
            ref={backupInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleBackupFile(file);
              e.target.value = "";
            }}
          />
        </SettingsSection>

        {/* ---------- Section 5: MEMENTO updates (Phase C6, Option A) ----------
            The honest assistant: static facts + the pinned releases page.
            The app never checks the network for itself, never downloads,
            and never replaces its own executable (no self-swap — a portable
            app must never modify the files of the process it runs from). */}
        <SettingsSection icon={Download} titleKey="set.appUpdateTitle" language={language}>
          <div className="space-y-2">
            <p className="text-[11px] text-surface-400 leading-relaxed">{t("set.appUpdateHint", language)}</p>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-700/50 bg-surface-900/60 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">{t("set.appUpdateThisBuild", language)}</p>
                <p className="text-[11px] text-surface-400 mt-0.5 font-mono" dir="ltr">
                  {appUpd ? `v${appUpd.appVersion}` : "…"}
                </p>
              </div>
              <button
                onClick={() => {
                  const url = appUpd?.releasesUrl;
                  if (url) openExternalLink(url);
                }}
                disabled={!appUpd?.releasesUrl}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-bold shrink-0 transition-colors flex items-center gap-1.5",
                  appUpd?.releasesUrl
                    ? "bg-gradient-to-r from-teal-400 to-emerald-500 text-black/90 hover:brightness-110"
                    : "bg-surface-800 text-surface-500 cursor-not-allowed"
                )}
              >
                <Download className="w-3.5 h-3.5" />
                {t("set.appUpdateOpenBtn", language)}
              </button>
            </div>
            <p className="text-[11px] text-surface-400 leading-relaxed whitespace-pre-line">{t("set.appUpdateSteps", language)}</p>
          </div>
        </SettingsSection>

        {/* ---------- 3.1.8 Section: Logs & Errors ---------- */}
        <LogsSection language={language} isRtl={isRtl} />
      </div>
    </div>
  );
}

/** One section card: icon + heading + content rows. */
function SettingsSection({ icon: Icon, titleKey, language, children }: {
  icon: React.ElementType;
  titleKey: string;
  language: import("../i18n").Language;
  children: React.ReactNode;
}) {
  const isRtl = language === "fa" || language === "ar";
  return (
    <div className="rounded-2xl border border-surface-700/50 bg-surface-900/40 p-4 sm:p-5 space-y-3">
      <p className={cn(
        "text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2",
        isRtl && "flex-row-reverse"
      )}>
        <Icon className="w-4 h-4 shrink-0" />
        {t(titleKey, language)}
      </p>
      {children}
    </div>
  );
}

/** One toggle row (label + optional hint + switch) — same visual pattern
 *  as ConfigsTab's BuilderToggle, kept local so the two tabs stay decoupled. */
function PrefToggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-700/50 bg-surface-900/60 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-bold text-white">{label}</p>
        {hint && <p className="text-[11px] text-surface-400 mt-0.5">{hint}</p>}
      </div>
      <label className="relative inline-flex items-center cursor-pointer shrink-0">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
        <div className="w-11 h-6 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-surface-700 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
      </label>
    </div>
  );
}

function LoadingRow({ language }: { language: import("../i18n").Language }) {
  return (
    <div className="p-4 rounded-xl border border-surface-700/50 bg-surface-900/40">
      <p className="text-[11px] text-surface-500 animate-pulse">{t("appopt.loading", language)}</p>
    </div>
  );
}

/** Phase D2 (item 9) — the builder toggles, migrated verbatim from
 *  ConfigsTab. Every control writes straight into the persisted store — the
 *  generated core JSON picks it up on the NEXT connect (configs are
 *  generated at connect time; a live session keeps its current config). */
function BuilderOptionsPanel({ options, onChange, language }: {
  options: BuilderOptions;
  onChange: (patch: Partial<BuilderOptions>) => void;
  language: import("../i18n").Language;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-surface-400 flex items-center gap-1.5">
        <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        {t("builder.hint", language)}
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        <PrefToggle
          label={t("builder.sniffing", language)}
          checked={options.sniffing}
          onChange={v => onChange({ sniffing: v })}
        />
        <PrefToggle
          label={t("builder.blockBt", language)}
          checked={options.blockBittorrent}
          onChange={v => onChange({ blockBittorrent: v })}
        />
        <PrefToggle
          label={t("builder.allowLan", language)}
          hint={t("builder.allowLanHint", language)}
          checked={options.allowLan}
          onChange={v => onChange({ allowLan: v })}
        />
        <PrefToggle
          label={t("builder.mux", language)}
          hint={t("builder.muxHint", language)}
          checked={options.muxEnabled}
          onChange={v => onChange({ muxEnabled: v })}
        />
        {/* Phase C1 (item 4): TLS fragment — the Xray anti-DPI knob. When
            ON, three range fields appear; bad input shows an amber hint and
            the generator honestly skips the feature (never a broken config). */}
        <PrefToggle
          label={t("builder.fragment", language)}
          hint={t("builder.fragmentHint", language)}
          checked={options.tlsFragment}
          onChange={v => onChange({ tlsFragment: v })}
        />
        <PrefToggle
          label={t("builder.skipVerify", language)}
          hint={t("builder.skipVerifyHint", language)}
          checked={options.skipCertVerify}
          onChange={v => onChange({ skipCertVerify: v })}
        />
        <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-700/50 bg-surface-900/60 px-4 py-3">
          <p className="text-sm font-bold text-white">{t("builder.logLevel", language)}</p>
          <select
            value={options.logLevel}
            onChange={e => onChange({ logLevel: e.target.value as BuilderOptions["logLevel"] })}
            className="px-2 py-1.5 rounded-lg text-xs bg-surface-800 border border-surface-700 text-white outline-none focus:border-emerald-500"
          >
            {(["debug", "info", "warning", "error"] as const).map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      {/* Phase C1: fragment range fields + validation, only while ON. */}
      {options.tlsFragment && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2" dir="ltr">
            {([
              ["tlsFragmentPackets", "builder.fragmentPackets"],
              ["tlsFragmentLength", "builder.fragmentLength"],
              ["tlsFragmentInterval", "builder.fragmentInterval"],
            ] as const).map(([key, labelKey]) => (
              <label key={key} className="block">
                <span className="block text-[10px] font-bold text-surface-400 mb-1">{t(labelKey, language)}</span>
                <input
                  type="text"
                  value={options[key]}
                  onChange={e => onChange({ [key]: e.target.value } as Partial<BuilderOptions>)}
                  spellCheck={false}
                  className="w-full px-2 py-1.5 rounded-lg text-xs font-mono bg-surface-800 border border-surface-700 text-white outline-none focus:border-emerald-500"
                />
              </label>
            ))}
          </div>
          {fragmentRangesInvalid(options) && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed text-amber-300">
                {t("builder.fragmentBad", language)}
              </p>
            </div>
          )}
        </div>
      )}
      {/* Phase D2 review fix (per original Phase D plan): a REAL security
          warning while LAN sharing is on — the loopback binding keeps the
          proxy private, 0.0.0.0 exposes it unauthenticated to the whole
          broadcast domain. Shown only while the toggle is ON so the panel
          stays calm in the default state. */}
      {options.allowLan && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-amber-300">
            {t("builder.allowLanWarning", language)}
          </p>
        </div>
      )}
      <button
        onClick={() => onChange({ ...DEFAULT_BUILDER_OPTIONS })}
        className="px-3 py-1.5 rounded-lg text-xs font-medium text-surface-300 hover:text-white bg-surface-800 hover:bg-surface-700 transition-colors flex items-center gap-1.5"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        {t("builder.reset", language)}
      </button>
    </div>
  );
}

/* ==================================================================== */
/* 3.1.8 (user request #4) — the Logs & Errors section                   */
/* ==================================================================== */

interface LogEntryWire {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  detail?: string | null;
}

function LogsSection({ language, isRtl }: { language: import("../i18n").Language; isRtl: boolean }) {
  const [entries, setEntries] = useState<LogEntryWire[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const list = await tauriInvoke<LogEntryWire[]>("logs_get_recent", { limit: 200 });
      setEntries(Array.isArray(list) ? list : []);
    } catch {
      setEntries([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (expanded) void refresh();
  }, [expanded]);

  const levelColor = (l: string): string =>
    l === "error"
      ? "text-red-400"
      : l === "warn"
        ? "text-amber-400"
        : l === "debug"
          ? "text-surface-500"
          : "text-emerald-400";

  const exportLogs = async () => {
    try {
      const res = await tauriInvoke<{ ok: boolean; detail?: string }>("logs_export");
      if (res?.ok) toast.success(t("logs.exported", language));
      else if (res?.detail && res.detail !== "cancelled") toast.error(res.detail);
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    }
  };

  const clearLogs = async () => {
    try {
      await tauriInvoke("logs_clear");
      await refresh();
      toast.success(t("logs.cleared", language));
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    }
  };

  const copyLogs = async () => {
    try {
      const text = (entries ?? []).map(e => `[${e.ts}] ${e.level.toUpperCase()} [${e.scope}] ${e.message}${e.detail ? `\n  ${e.detail}` : ""}`).join("\n");
      await navigator.clipboard.writeText(text);
      toast.success(t("logs.copied", language));
    } catch {
      toast.error(t("logs.copyFail", language));
    }
  };

  const errCount = (entries ?? []).filter(e => e.level === "error").length;

  return (
    <SettingsSection icon={ScrollText} titleKey="logs.section" language={language}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11px] text-surface-400 leading-relaxed max-w-md">
          {t("logs.hint", language)}
          {entries && errCount > 0 && (
            <span className="text-red-400 font-bold"> · {t("logs.errCount", language).replace("{n}", String(errCount))}</span>
          )}
        </p>
        <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
          <button
            onClick={() => setExpanded(v => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-surface-600/80 text-ink-200 hover:border-emerald-500/60 transition-all flex items-center gap-1.5"
          >
            <ScrollText className="w-3.5 h-3.5" />
            {expanded ? t("logs.hide", language) : t("logs.view", language)}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2">
          <div className="max-h-96 overflow-y-auto rounded-xl border border-surface-800/70 bg-surface-950/80 p-3 logs-scroll" dir="ltr">
            {entries === null ? (
              <p className="text-[11px] text-surface-500 animate-pulse">{t("appopt.loading", language)}</p>
            ) : entries.length === 0 ? (
              <p className="text-[11px] text-surface-500">{t("logs.empty", language)}</p>
            ) : (
              <div className="space-y-1 font-mono text-[10.5px] leading-4">
                {entries.map((e, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-surface-600 shrink-0">{e.ts.slice(11, 19)}</span>
                    <span className={cn("uppercase font-bold shrink-0 w-10", levelColor(e.level))}>{e.level}</span>
                    <span className="text-teal-400/80 shrink-0 hidden sm:inline">[{e.scope}]</span>
                    <span className="text-ink-200 break-all">{e.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={cn("flex items-center gap-2 flex-wrap", isRtl && "flex-row-reverse")}>
            <button onClick={refresh} disabled={busy} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-surface-600/80 text-ink-200 hover:border-emerald-500/60 transition-all flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCcw className={cn("w-3 h-3", busy && "animate-spin")} />
              {t("logs.refresh", language)}
            </button>
            <button onClick={copyLogs} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-surface-600/80 text-ink-200 hover:border-emerald-500/60 transition-all flex items-center gap-1.5">
              <Copy className="w-3 h-3" />
              {t("logs.copy", language)}
            </button>
            <button onClick={exportLogs} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-surface-600/80 text-ink-200 hover:border-emerald-500/60 transition-all flex items-center gap-1.5">
              <Save className="w-3 h-3" />
              {t("logs.export", language)}
            </button>
            <button onClick={() => tauriInvoke("logs_open_folder").catch(() => null)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-surface-600/80 text-ink-200 hover:border-emerald-500/60 transition-all flex items-center gap-1.5">
              <FolderInput className="w-3 h-3" />
              {t("logs.openFolder", language)}
            </button>
            <button onClick={clearLogs} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all flex items-center gap-1.5">
              <Trash2 className="w-3 h-3" />
              {t("logs.clear", language)}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
