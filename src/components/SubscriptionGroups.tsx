import { useState } from "react";
import { useStore, SubscriptionGroup } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { Table, Plus, Trash2, Edit3, Globe, Clock, X, Save, AlertOctagon, Activity } from "lucide-react";
import toast from "react-hot-toast";

export function ManageGroupsModal({ onClose }: { onClose: () => void }) {
  const {
    language, subscriptionGroups,
    addSubscriptionGroup, removeSubscriptionGroup, updateSubscriptionGroup,
  } = useStore();

  // Mode: 'list' | 'add' | 'edit'
  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [interval, setIntervalMinutes] = useState(60);

  const resetForm = () => {
    setName("");
    setUrl("");
    setAutoUpdate(false);
    setIntervalMinutes(60);
    setEditingId(null);
  };

  const openEditMode = (g: SubscriptionGroup) => {
    setEditingId(g.id);
    setName(g.name);
    setUrl(g.subscriptionUrl || "");
    setAutoUpdate(g.autoUpdate);
    setIntervalMinutes(g.updateIntervalMinutes || 60);
    setMode("edit");
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error("Group name is required");
      return;
    }
    addSubscriptionGroup({
      name: name.trim(),
      subscriptionUrl: url.trim() || undefined,
      autoUpdate,
      updateIntervalMinutes: autoUpdate ? interval : undefined,
    });
    toast.success("Group created ✓");
    resetForm();
    setMode("list");
  };

  const handleSaveEdit = () => {
    if (!editingId || !name.trim()) {
      toast.error("Group name is required");
      return;
    }
    updateSubscriptionGroup(editingId, {
      name: name.trim(),
      subscriptionUrl: url.trim() || undefined,
      autoUpdate,
      updateIntervalMinutes: autoUpdate ? interval : undefined,
    });
    toast.success("Group updated ✓");
    resetForm();
    setMode("list");
  };

  const inForm = mode === "add" || mode === "edit";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-2xl rounded-3xl border border-emerald-500/20 bg-surface-900/95 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-6 border-b border-surface-800">
          <h3 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Table className="w-5 h-5 text-emerald-400" />
            {mode === "add"
              ? "Add New Group"
              : mode === "edit"
                ? "Edit Group"
                : t("subs.groups", language) || "Subscription Groups"}
          </h3>
          <button
            onClick={inForm ? () => { resetForm(); setMode("list"); } : onClose}
            className="p-2 rounded-xl hover:bg-surface-800 text-surface-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {mode === "list" ? (
            <>
              <button
                onClick={() => setMode("add")}
                className="w-full py-4 rounded-2xl border-2 border-dashed border-emerald-500/30 text-emerald-400 font-bold flex items-center justify-center gap-2 hover:bg-emerald-500/5 transition-colors"
              >
                <Plus className="w-5 h-5" />
                {t("subs.addGroup", language) || "Add New Group"}
              </button>

              <div className="space-y-3">
                {subscriptionGroups.length === 0 ? (
                  <p className="text-center text-sm text-surface-500 py-6">No groups created yet.</p>
                ) : (
                  subscriptionGroups.map(g => (
                    <div key={g.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl border border-surface-800 bg-surface-950/50 gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-white truncate">{g.name}</h4>
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-[10px] font-mono shrink-0">
                            {g.configIds.length} configs
                          </span>
                        </div>
                        {g.subscriptionUrl && (
                          <p className="text-xs text-surface-500 font-mono mt-1 flex items-center gap-1 truncate">
                            <Globe className="w-3 h-3 shrink-0" />
                            <span className="truncate">{g.subscriptionUrl}</span>
                          </p>
                        )}
                        {g.autoUpdate && (
                          <p className="text-xs text-yellow-500 font-medium mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Auto-update every {g.updateIntervalMinutes} min
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Edit */}
                        <button
                          onClick={() => openEditMode(g)}
                          className="p-2 rounded-xl text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                          title="Edit group"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete "${g.name}"? Configs will not be deleted, just ungrouped.`)) {
                              removeSubscriptionGroup(g.id);
                              toast.success(`Group "${g.name}" removed`);
                            }
                          }}
                          className="p-2 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete group"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4 bg-surface-950/50 p-5 rounded-2xl border border-surface-800">
              <div>
                <label className="text-xs font-bold text-surface-400 block mb-1.5">Group Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm bg-surface-900 border border-surface-700 text-white focus:border-emerald-500 outline-none"
                  autoFocus
                  placeholder="My VPN Servers"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-surface-400 block mb-1.5">Subscription URL (optional)</label>
                <input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://example.com/sub"
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-mono bg-surface-900 border border-surface-700 text-emerald-300 focus:border-emerald-500 outline-none"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-surface-700 bg-surface-900 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-white">Auto Update</p>
                  <p className="text-xs text-surface-400">Fetch new configs automatically</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={autoUpdate} onChange={e => setAutoUpdate(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-surface-700 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
              {autoUpdate && (
                <div>
                  <label className="text-xs font-bold text-surface-400 block mb-1.5">Update interval (minutes)</label>
                  <input
                    type="number"
                    value={interval}
                    onChange={e => setIntervalMinutes(Math.max(5, Number(e.target.value)))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm bg-surface-900 border border-surface-700 text-white focus:border-emerald-500 outline-none"
                  />
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={mode === "edit" ? handleSaveEdit : handleCreate}
                  className="flex-1 py-2.5 rounded-xl font-bold bg-gradient-to-r from-emerald-400 to-green-600 text-black hover:brightness-110 flex items-center justify-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  {mode === "edit" ? "Save Changes" : "Create Group"}
                </button>
                <button
                  onClick={() => { resetForm(); setMode("list"); }}
                  className="flex-1 py-2.5 rounded-xl font-bold bg-surface-800 text-white hover:bg-surface-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SelectGroupModal({
  title,
  subtitle,
  onSelect,
  onCancel
}: {
  title: string;
  subtitle: string;
  onSelect: (groupId: string | null) => void;
  onCancel: () => void;
}) {
  const { subscriptionGroups } = useStore();

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-pop-in">
      <div className="w-full max-w-sm rounded-3xl border border-emerald-500/20 bg-surface-900/95 shadow-2xl p-6">
        <h3 className="text-lg font-extrabold text-white">{title}</h3>
        <p className="text-xs text-surface-400 mt-1 mb-5">{subtitle}</p>

        <div className="space-y-2 max-h-60 overflow-y-auto mb-5 pr-1">
          {subscriptionGroups.map(g => (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-surface-700 bg-surface-800 hover:bg-emerald-500/10 hover:border-emerald-500/40 transition-colors text-left group"
            >
              <span className="font-bold text-sm text-white group-hover:text-emerald-400">{g.name}</span>
              <span className="px-2 py-0.5 rounded text-[10px] bg-surface-950 text-surface-400">{g.configIds.length}</span>
            </button>
          ))}
          <button
            onClick={() => onSelect(null)}
            className="w-full flex items-center justify-between p-3 rounded-xl border border-surface-700 bg-surface-800 hover:bg-surface-700 transition-colors text-left"
          >
            <span className="font-bold text-sm text-surface-300">Don't add to any group</span>
          </button>
        </div>

        <button
          onClick={onCancel}
          className="w-full py-3 rounded-xl font-bold bg-surface-800 text-surface-300 hover:bg-surface-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ==================================================================== */
/*                       CLEAR ALL — Choice Modal                        */
/* ==================================================================== */

export function ClearAllModal({ onClose }: { onClose: () => void }) {
  const {
    configs, subscriptionGroups, pingResults,
    clearConfigs, clearPingResults, removeSubscriptionGroup, language
  } = useStore();

  const isRtl = language === "fa" || language === "ar";
  const configCount = configs.length;
  const groupCount = subscriptionGroups.length;
  const pingCount = Object.keys(pingResults).length;

  const clearOnlyConfigs = () => {
    clearConfigs();
    toast.success(language === "fa" ? `تمام ${configCount} کانفیگ پاک شد` : `Cleared ${configCount} configs`);
    onClose();
  };

  const clearConfigsAndGroups = () => {
    for (const g of subscriptionGroups) {
      removeSubscriptionGroup(g.id);
    }
    clearConfigs();
    toast.success(language === "fa" ? "تمام کانفیگ‌ها و گروه‌ها پاک شدند" : `Cleared ${configCount} configs & ${groupCount} groups`);
    onClose();
  };

  const clearOnlyPings = () => {
    clearPingResults();
    toast.success(language === "fa" ? "نتایج پینگ پاک شد" : `Cleared ${pingCount} ping results`);
    onClose();
  };

  const options = [
    {
      id: "configs",
      title: language === "fa" ? "فقط پاک‌سازی کانفیگ‌ها" : "Clear All Configs Only",
      desc: language === "fa"
        ? `حذف تمامی ${configCount} کانفیگ. گروه‌های سابسکریپشن حفظ می‌شوند.`
        : `Delete all ${configCount} configs. Your Subscription Groups will stay intact.`,
      badge: `${configCount} Configs`,
      badgeColor: "bg-red-500/15 text-red-400 border-red-500/30",
      icon: Trash2,
      color: "from-red-400 via-rose-500 to-red-600 shadow-red-500/25",
      action: clearOnlyConfigs,
      disabled: configCount === 0,
    },
    {
      id: "both",
      title: language === "fa" ? "پاک‌سازی کامل (کانفیگ‌ها + گروه‌ها)" : "Clear Everything (Fresh Start)",
      desc: language === "fa"
        ? `حذف تمامی ${configCount} کانفیگ و ${groupCount} گروه سابسکریپشن. بازگشت به تنظیمات اولیه.`
        : `Delete all ${configCount} configs AND all ${groupCount} Subscription Groups completely.`,
      badge: "All Data",
      badgeColor: "bg-orange-500/15 text-orange-400 border-orange-500/30",
      icon: AlertOctagon,
      color: "from-orange-400 via-amber-500 to-red-600 shadow-orange-500/25",
      action: clearConfigsAndGroups,
      disabled: configCount === 0 && groupCount === 0,
    },
    {
      id: "pings",
      title: language === "fa" ? "فقط پاک‌سازی نتایج پینگ" : "Clear Ping Results Only",
      desc: language === "fa"
        ? `حذف اطلاعات تاخیر (${pingCount} مورد تست‌شده). کانفیگ‌ها و سرورها دست‌نخورده می‌مانند.`
        : `Delete only the ${pingCount} saved ping latencies. Configs & groups remain unchanged.`,
      badge: `${pingCount} Pings`,
      badgeColor: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
      icon: Activity,
      color: "from-yellow-400 via-amber-500 to-orange-500 shadow-yellow-500/25",
      action: clearOnlyPings,
      disabled: pingCount === 0,
    },
  ];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-xl p-3 animate-fade-in overflow-y-auto">
      <div
        className={cn(
          "w-full max-w-[26rem] my-auto rounded-3xl border border-red-500/30 bg-surface-900/95 shadow-2xl shadow-black/80 p-4 pop-in relative overflow-hidden box-border",
          isRtl && "text-right"
        )}
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Ambient red glow */}
        <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-red-500/10 blur-3xl pointer-events-none" />

        {/* Header */}
        <div className={cn("flex items-center justify-between gap-2 pb-4 border-b border-surface-800", isRtl && "flex-row-reverse")}>
          <div className={cn("flex items-center gap-2.5 min-w-0", isRtl && "flex-row-reverse")}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-400 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/30 shrink-0">
              <Trash2 className="w-4 h-4 text-black/90" strokeWidth={2.4} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-white tracking-tight truncate">
                {language === "fa" ? "پاک‌سازی اطلاعات" : "Clear Data & Storage"}
              </h3>
              <p className="text-[11px] text-surface-400 mt-0.5 truncate">
                {language === "fa"
                  ? "غیرقابل بازگشت است"
                  : "This action cannot be undone"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-surface-800/80 hover:bg-surface-700 text-surface-400 hover:text-white transition-all shrink-0 active:scale-95"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options */}
        <div className="mt-4 space-y-2 max-h-[50vh] overflow-y-auto pr-0.5">
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={opt.action}
                disabled={opt.disabled}
                className={cn(
                  "w-full text-left p-3 rounded-2xl border transition-all duration-300 group relative overflow-hidden box-border",
                  isRtl && "text-right",
                  opt.disabled
                    ? "border-surface-800/60 bg-surface-950/40 opacity-45 cursor-not-allowed"
                    : "border-surface-700/80 bg-surface-950/80 hover:border-red-500/60 hover:bg-red-500/5 cursor-pointer active:scale-[0.98] shadow-md"
                )}
              >
                <div className={cn("flex items-center gap-2.5", isRtl && "flex-row-reverse")}>
                  <div className={cn(
                    "w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0 shadow-lg transition-transform duration-300 group-hover:scale-110",
                    opt.color
                  )}>
                    <Icon className="w-4 h-4 text-black/90" strokeWidth={2.4} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className={cn("flex items-center gap-1.5", isRtl && "flex-row-reverse")}>
                      <h4 className="text-xs font-extrabold text-white group-hover:text-red-400 transition-colors truncate min-w-0 flex-1">
                        {opt.title}
                      </h4>
                      <span className={cn(
                        "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full border shrink-0 whitespace-nowrap",
                        opt.badgeColor
                      )}>
                        {opt.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-surface-400 mt-0.5 leading-snug line-clamp-2">
                      {opt.desc}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer Cancel Button */}
        <div className="mt-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl font-bold text-xs bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-white transition-all shadow-lg active:scale-[0.98] cursor-pointer"
          >
            {language === "fa" ? "انصراف — چیزی پاک نشود" : "Cancel — Keep Everything"}
          </button>
        </div>
      </div>
    </div>
  );
}
