import { useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { ClearAllModal } from "./SubscriptionGroups";
import {
  Download, Table, Trash2, Eye, Wand2, HeartHandshake, Coffee,
  Activity, Radar, Share2, Bell, BellOff, Volume2, BellRing, Shield
} from "lucide-react";

const tabs = [
  { id: "import", label: "tab.import", icon: Download, color: "from-emerald-400 to-green-600" },
  { id: "configs", label: "tab.configs", icon: Table, color: "from-green-400 to-emerald-600" },
  { id: "connection", label: "tab.connection", icon: Shield, color: "from-emerald-400 via-green-500 to-emerald-600" },
  { id: "editor", label: "tab.editor", icon: Wand2, color: "from-teal-400 to-emerald-600" },
  { id: "pinger", label: "tab.pinger", icon: Activity, color: "from-emerald-400 to-teal-600" },
  { id: "scanner", label: "tab.scanner", icon: Radar, color: "from-emerald-400 via-green-500 to-emerald-600" },
  { id: "export", label: "tab.export", icon: Share2, color: "from-green-400 to-emerald-500" },
  { id: "donate", label: "tab.donate", icon: Coffee, color: "from-yellow-400 to-amber-600" },
  { id: "contact", label: "tab.contact", icon: HeartHandshake, color: "from-red-400 to-pink-600" },
];

const notifModes = [
  { id: "none", icon: BellOff },
  { id: "toast", icon: Bell },
  { id: "sound", icon: Volume2 },
  { id: "both", icon: BellRing },
] as const;

export default function Sidebar() {
  const {
    activeTab, setActiveTab, language, setLanguage,
    configs, notificationMode, setNotificationMode
  } = useStore();

  const [showClearModal, setShowClearModal] = useState(false);

  const validCount = configs.filter(c => c.isValid).length;
  const invalidCount = configs.filter(c => !c.isValid).length;
  const isRtl = language === "fa" || language === "ar";

  return (
    <aside
      className={cn(
        "flex flex-col w-72 sm:w-64 h-full shrink-0 z-20 relative shadow-2xl shadow-black/40 md:shadow-none",
        "dark:bg-ink-950/95 md:dark:bg-ink-950/80 light:bg-white/95",
        isRtl
          ? "border-l dark:border-emerald-500/10 light:border-emerald-500/15"
          : "border-r dark:border-emerald-500/10 light:border-emerald-500/15",
        "glass"
      )}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Logo */}
      <div className="p-5 pb-4 sm:p-6 sm:pb-5">
        <div className={cn("flex items-center gap-3", isRtl && "flex-row-reverse")}>
          <div className="relative group">
            <div className="absolute inset-0 rounded-2xl bg-emerald-500/40 blur-lg group-hover:bg-emerald-400/60 transition-all" />
            <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/40 overflow-hidden shine">
              {/* Eye icon */}
              <Eye className="w-6 h-6 text-black/85" strokeWidth={2.4} />
              {/* scanning line */}
              <div className="absolute inset-x-0 h-px bg-black/30 scan-line" />
            </div>
          </div>
          <div className={cn(isRtl && "text-right")}>
            <h1 className="text-xl font-extrabold tracking-tight gradient-text">
              MEMENTO
            </h1>
            <p className="text-[9px] dark:text-emerald-400/90 light:text-emerald-700 font-extrabold tracking-wider uppercase mt-0.5">
              from EPODONIOS to A Who
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="px-3 flex-1 space-y-1 overflow-y-auto">
        {tabs.map((tab, i) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{ animationDelay: `${i * 0.04}s` }}
              className={cn(
                "group w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden slide-in",
                isRtl && "flex-row-reverse text-right",
                isActive
                  ? "dark:bg-emerald-500/10 light:bg-emerald-500/10 dark:text-emerald-300 light:text-emerald-700 shadow-sm"
                  : "dark:text-ink-400 light:text-ink-500 hover:dark:text-emerald-200 hover:light:text-emerald-700 hover:dark:bg-emerald-500/5 hover:light:bg-emerald-500/5"
              )}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className={cn(
                  "absolute top-1/2 -translate-y-1/2 h-6 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-green-600 glow-green",
                  isRtl ? "right-0" : "left-0"
                )} />
              )}
              <span className={cn(
                "flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-300",
                isActive
                  ? `bg-gradient-to-br ${tab.color} shadow-md shadow-emerald-500/30`
                  : "dark:bg-ink-800/60 light:bg-ink-100 group-hover:scale-110"
              )}>
                <Icon className={cn("w-4 h-4", isActive ? "text-black/80" : "")} />
              </span>
              {t(tab.label, language)}
            </button>
          );
        })}
      </nav>

      {/* Stats */}
      <div className="px-5 py-4 space-y-2.5">
        <StatRow label={t("sidebar.total", language)} value={configs.length} dot="emerald" isRtl={isRtl} />
        <StatRow label={t("sidebar.valid", language)} value={validCount} dot="green" isRtl={isRtl} />
        <StatRow label={t("sidebar.invalid", language)} value={invalidCount} dot="red" isRtl={isRtl} />
      </div>

      {/* Bottom Controls */}
      <div className="px-3 pb-3 space-y-2">
        {/* Notification mode */}
        <div className={cn("px-1", isRtl && "text-right")}>
          <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider dark:text-ink-500 light:text-ink-400">
            {t("notification.title", language)}
          </p>
          <div className="flex gap-1 px-1">
            {notifModes.map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setNotificationMode(id)}
                className={cn(
                  "flex-1 flex items-center justify-center py-2 rounded-lg transition-all duration-200",
                  notificationMode === id
                    ? "bg-gradient-to-br from-emerald-400 to-green-600 text-black/80 shadow-md shadow-emerald-500/30 scale-105"
                    : "dark:bg-ink-800/60 light:bg-ink-100 dark:text-ink-400 light:text-ink-500 hover:dark:text-emerald-300 hover:light:text-emerald-700"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>

        {/* Language Selector */}
        <div className={cn("px-1", isRtl && "text-right")}>
          <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider dark:text-ink-500 light:text-ink-400">
            {t("sidebar.language", language)}
          </p>
          <div className="flex gap-1 px-1">
            {(["en", "fa", "zh", "ar"] as const).map(lang => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={cn(
                  "flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-all duration-200",
                  language === lang
                    ? "bg-gradient-to-br from-emerald-400 to-green-600 text-black/80 shadow-md shadow-emerald-500/30 scale-105"
                    : "dark:bg-ink-800/60 light:bg-ink-100 dark:text-ink-400 light:text-ink-500 hover:dark:text-emerald-300 hover:light:text-emerald-700"
                )}
              >
                {lang === "en" ? "EN" : lang === "fa" ? "فا" : lang === "zh" ? "中" : "ع"}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowClearModal(true)}
          className={cn(
            "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 group",
            isRtl && "flex-row-reverse text-right",
            "text-red-400 hover:bg-red-500/10"
          )}
        >
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-red-500/10 group-hover:scale-110 transition-transform">
            <Trash2 className="w-4 h-4" />
          </span>
          {t("sidebar.clearAll", language)}
        </button>
      </div>

      {/* Credits */}
      <div className="px-5 py-3 border-t dark:border-emerald-500/10 light:border-emerald-500/15">
        <p className="text-[10px] text-center dark:text-ink-500 light:text-ink-400">
          {t("app.by", language)}
        </p>
      </div>

      {showClearModal && <ClearAllModal onClose={() => setShowClearModal(false)} />}
    </aside>
  );
}

function StatRow({ label, value, dot, isRtl }: { label: string; value: number; dot: string; isRtl: boolean }) {
  const dotColor = dot === "emerald" ? "bg-emerald-400" : dot === "green" ? "bg-green-500" : "bg-red-500";
  return (
    <div className={cn("flex items-center justify-between text-xs", isRtl && "flex-row-reverse")}>
      <span className={cn("flex items-center gap-1.5 dark:text-ink-400 light:text-ink-500", isRtl && "flex-row-reverse")}>
        <span className={cn("w-2 h-2 rounded-full", dotColor, dot !== "red" && value > 0 && "pulse-glow")} />
        {label}
      </span>
      <span className="font-bold dark:text-white light:text-ink-900 tabular-nums">{value}</span>
    </div>
  );
}
