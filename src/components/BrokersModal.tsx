import { useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { fetchSubscription, MAX_CONFIGS_PER_SOURCE } from "../utils/subscription";
import {
  DatabaseZap,
  ArrowLeft,
  Download,
  Globe,
  X,
  CheckCircle2,
  Orbit,
  User,
  Skull,
  Cat,
  FolderTree,
  Boxes,
  Biohazard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import toast from "react-hot-toast";

/* ------------------------------------------------------------------ */
/*  Data model                                                         */
/* ------------------------------------------------------------------ */

interface BrokerLinkItem {
  name: string;
  url: string;
  desc?: string;
}

interface BrokerCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  iconBg: string;
  description: string;
  items: BrokerLinkItem[];
}

interface BrokerDef {
  id: string;
  name: string;
  icon: LucideIcon;
  iconBg: string;
  description: string;
  /** Flat list of fetchable links (used when there's no sub-category step) */
  items?: BrokerLinkItem[];
  /** Nested categories (e.g. Epodonios: Sorted-by-protocol vs Subs) */
  categories?: BrokerCategory[];
}

/* ------------------------------------------------------------------ */
/*  "A" glyph icon for Alirewa (no literal lucide icon fits the brand) */
/* ------------------------------------------------------------------ */

function LetterAIcon({ className }: { className?: string }) {
  return (
    <span className={cn("font-black leading-none select-none", className)} style={{ fontSize: "1.1em" }}>
      A
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Broker catalogue                                                    */
/* ------------------------------------------------------------------ */

const BROKERS: BrokerDef[] = [
  {
    id: "epodonios",
    name: "Epodonios",
    icon: Orbit, // Saturn-like ringed planet
    iconBg: "from-emerald-400 via-green-500 to-teal-600",
    description: "Curated V2Ray lists updated on GitHub. Choose sorted-by-protocol sources or full subscription sets.",
    categories: [
      {
        id: "protocols",
        label: "Sorted by Protocol",
        icon: FolderTree,
        iconBg: "from-cyan-400 to-blue-600",
        description: "Fetch one protocol at a time: Vless, Vmess, SS, SSR, Trojan.",
        items: [
          { name: "Vless", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/vless.txt" },
          { name: "Vmess", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/vmess.txt" },
          { name: "Ss", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/ss.txt" },
          { name: "Ssr", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/ssr.txt" },
          { name: "Trojan", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/trojan.txt" },
        ],
      },
      {
        id: "subs",
        label: "Subs",
        icon: Boxes,
        iconBg: "from-amber-400 to-orange-600",
        description: "Fetch complete subscription text files from Sub1 to Sub7.",
        items: [
          { name: "Sub1", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Sub1.txt" },
          { name: "Sub2", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Sub2.txt" },
          { name: "Sub3", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Sub3.txt" },
          { name: "Sub4", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Sub4.txt" },
          { name: "Sub5", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Sub5.txt" },
          { name: "Sub6", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Sub6.txt" },
          { name: "Sub7", url: "https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Sub7.txt" },
        ],
      },
    ],
  },
  {
    id: "0xradikal",
    name: "0xRadikal",
    icon: User,
    iconBg: "from-sky-400 via-blue-500 to-indigo-600",
    description: "Free V2Ray configs split into light, heavy, and full bundles.",
    items: [
      {
        name: "Light",
        url: "https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/refs/heads/main/light/configs.txt",
        desc: "High quality and smaller",
      },
      {
        name: "Heavy",
        url: "https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/refs/heads/main/heavy/configs.txt",
        desc: "Large and diverse",
      },
      {
        name: "All configs",
        url: "https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/refs/heads/main/all/configs.txt",
        desc: "Everything combined",
      },
    ],
  },
  {
    id: "argh94",
    name: "Argh94",
    icon: Skull,
    iconBg: "from-zinc-400 via-slate-500 to-neutral-700",
    description: "Auto-updated configs split strictly by protocol.",
    items: [
      { name: "ShadowSocks", url: "https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/ShadowSocks.txt" },
      { name: "ShadowSocksR", url: "https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/ShadowSocksR.txt" },
      { name: "Trojan", url: "https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/Trojan.txt" },
      { name: "Tuic", url: "https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/Tuic.txt" },
      { name: "Vless", url: "https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/Vless.txt" },
      { name: "Vmess", url: "https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/Vmess.txt" },
    ],
  },
  {
    id: "alirewa",
    name: "Alirewa",
    icon: LetterAIcon as unknown as LucideIcon,
    iconBg: "from-fuchsia-400 via-purple-500 to-violet-600",
    description: "Hand-picked, quality-ranked V2Ray subscriptions.",
    items: [
      {
        name: "Main",
        url: "https://raw.githubusercontent.com/Alirewa/V2ray-Configs/main/config.txt",
        desc: "2000 configs (raw, one per line)",
      },
      {
        name: "Sub 1",
        url: "https://raw.githubusercontent.com/Alirewa/V2ray-Configs/main/sub1.txt",
        desc: "Top 100 · Base64 · TLS / REALITY priority",
      },
      {
        name: "Sub 2",
        url: "https://raw.githubusercontent.com/Alirewa/V2ray-Configs/main/sub2.txt",
        desc: "Next 100 · Base64 · high quality",
      },
      {
        name: "Sub 3",
        url: "https://raw.githubusercontent.com/Alirewa/V2ray-Configs/main/sub3.txt",
        desc: "Next 100 · Base64 · good quality",
      },
    ],
  },
    {
    id: "iboxz",
    name: "iboxz",
    icon: Cat,
    iconBg: "from-orange-400 via-amber-500 to-yellow-500",
    description: "Free V2Ray collector, mixed or split by protocol.",
    items: [
      { name: "Mix (All in one)", url: "https://raw.githubusercontent.com/iboxz/free-v2ray-collector/main/main/mix.txt" },
      { name: "VLESS", url: "https://raw.githubusercontent.com/iboxz/free-v2ray-collector/main/main/vless.txt" },
      { name: "VMESS", url: "https://raw.githubusercontent.com/iboxz/free-v2ray-collector/main/main/vmess.txt" },
      { name: "Shadowsocks", url: "https://raw.githubusercontent.com/iboxz/free-v2ray-collector/main/main/shadowsocks.txt" },
      { name: "Trojan", url: "https://raw.githubusercontent.com/iboxz/free-v2ray-collector/main/main/trojan.txt" },
    ],
  },
  {
    id: "cbusifabcap",
    name: "cbusifabcap",
    icon: Biohazard,
    iconBg: "from-green-500 via-emerald-600 to-teal-700",
    description: "Daily free VPN updates from GitHub.",
    items: [
      { name: "All configs", url: "https://raw.githubusercontent.com/cbusifabcap/daily_free_vpn/refs/heads/main/Z.txt" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */

type View =
  | { level: "root" }
  | { level: "broker"; brokerId: string }
  | { level: "category"; brokerId: string; categoryId: string };

export default function BrokersModal({ onClose }: { onClose: () => void }) {
  const {
    language,
    addConfigs,
    addSubscriptionGroup,
    addConfigsToGroup,
    subscriptionGroups,
  } = useStore();

  const isRtl = language === "fa" || language === "ar";
  const [view, setView] = useState<View>({ level: "root" });
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [lastGroupName, setLastGroupName] = useState<string | null>(null);

  const currentBroker = view.level !== "root" ? BROKERS.find(b => b.id === view.brokerId) : undefined;
  const currentCategory =
    view.level === "category"
      ? currentBroker?.categories?.find(c => c.id === view.categoryId)
      : undefined;

  const handleFetchBroker = async (brokerName: string, item: BrokerLinkItem) => {
    const groupName = `Broker • ${brokerName} • ${item.name}`;
    setLoadingKey(item.name);
    try {
      const lines = await fetchSubscription(item.url);
      if (lines.length === 0) {
        toast("No configs found in this broker source", { icon: "⚠️" });
        setLoadingKey(null);
        return;
      }

      const before = useStore.getState().configs.length;
      addConfigs(lines);
      const after = useStore.getState().configs.length;
      const added = after - before;

      // Ensure a subscription group exists for this broker source
      let group = subscriptionGroups.find(g => g.name === groupName);
      let groupId: string;

      if (!group) {
        groupId = addSubscriptionGroup({
          name: groupName,
          subscriptionUrl: item.url,
          autoUpdate: false,
          updateIntervalMinutes: undefined,
        });
      } else {
        groupId = group.id;
      }

      if (added > 0) {
        const addedIds = useStore.getState().configs.slice(-added).map(c => c.id);
        addConfigsToGroup(groupId, addedIds);
      }

      setLastGroupName(groupName);

      const cappedNote = lines.length >= MAX_CONFIGS_PER_SOURCE ? ` (capped at ${MAX_CONFIGS_PER_SOURCE})` : "";
      toast.success(`Imported ${Math.max(added, 0)} config(s) into ${groupName}${cappedNote}`);
    } catch (err: any) {
      toast.error(`Broker fetch failed: ${err?.message || "Unknown error"}`);
    } finally {
      setLoadingKey(null);
    }
  };

  const goBack = () => {
    if (view.level === "category") {
      setView({ level: "broker", brokerId: view.brokerId });
    } else if (view.level === "broker") {
      setView({ level: "root" });
    }
  };

  const title =
    view.level === "root"
      ? "Brokers"
      : view.level === "broker"
        ? currentBroker?.name || "Broker"
        : `${currentBroker?.name} • ${currentCategory?.label}`;

  const activeItems: BrokerLinkItem[] | undefined =
    view.level === "broker" ? currentBroker?.items : view.level === "category" ? currentCategory?.items : undefined;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-fade-in overflow-y-auto">
      <div
        className={cn(
          "w-full max-w-3xl my-auto rounded-[2rem] border border-emerald-500/20 bg-surface-900/95 shadow-2xl shadow-black/80 relative overflow-hidden pop-in",
          isRtl && "text-right"
        )}
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Ambient glows */}
        <div className="absolute -top-16 -left-10 w-56 h-56 bg-emerald-500/10 blur-3xl rounded-full pointer-events-none" />
        <div className="absolute -bottom-16 -right-10 w-56 h-56 bg-green-600/10 blur-3xl rounded-full pointer-events-none" />

        {/* Header */}
        <div className={cn(
          "relative z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-5 border-b border-surface-800",
          isRtl && "flex-row-reverse"
        )}>
          <div className={cn("flex items-center gap-3 min-w-0", isRtl && "flex-row-reverse")}>
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 shrink-0 floaty">
              <DatabaseZap className="w-5 h-5 text-black/90" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-extrabold text-white truncate">{title}</h3>
              <p className="text-xs text-surface-400 mt-0.5 truncate">
                Curated live V2Ray config repositories with auto-grouping
              </p>
            </div>
          </div>

          <div className={cn("flex items-center gap-2 shrink-0", isRtl && "flex-row-reverse")}>
            {view.level !== "root" && (
              <button
                onClick={goBack}
                className="p-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 transition-colors active:scale-95"
                title="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 transition-colors active:scale-95"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="relative z-10 p-5 sm:p-6 max-h-[70vh] overflow-y-auto">
          {/* Success badge */}
          {lastGroupName && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">Linked to subscription group: {lastGroupName}</span>
            </div>
          )}

          {/* ROOT: broker cards */}
          {view.level === "root" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 stagger">
              {BROKERS.map(broker => {
                const Icon = broker.icon;
                return (
                  <button
                    key={broker.id}
                    onClick={() => setView({ level: "broker", brokerId: broker.id })}
                    className="group p-5 rounded-3xl border border-emerald-500/20 bg-surface-950/60 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all shadow-lg hover-lift text-left"
                  >
                    <div className={cn("flex items-start gap-4", isRtl && "flex-row-reverse text-right")}>
                      <div className={cn(
                        "w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center shrink-0 shadow-md group-hover:scale-110 transition-transform",
                        broker.iconBg
                      )}>
                        <Icon className="w-6 h-6 text-black/90" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-base font-extrabold text-white group-hover:text-emerald-300 transition-colors">
                          {broker.name}
                        </h4>
                        <p className="text-xs text-surface-400 mt-1 leading-relaxed">
                          {broker.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* BROKER level: either categories (Epodonios) or direct items */}
          {view.level === "broker" && currentBroker?.categories && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 stagger">
              {currentBroker.categories.map(cat => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setView({ level: "category", brokerId: currentBroker.id, categoryId: cat.id })}
                    className="group p-5 rounded-3xl border border-emerald-500/20 bg-surface-950/60 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all shadow-lg hover-lift text-left"
                  >
                    <div className={cn("flex items-start gap-4", isRtl && "flex-row-reverse text-right")}>
                      <div className={cn(
                        "w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center shrink-0 shadow-md group-hover:scale-110 transition-transform",
                        cat.iconBg
                      )}>
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="text-base font-extrabold text-white group-hover:text-cyan-300 transition-colors">{cat.label}</h4>
                        <p className="text-xs text-surface-400 mt-1">{cat.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Flat item grid — used for broker.items or category.items */}
          {activeItems && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
              {activeItems.map(item => {
                const brokerName = currentBroker?.name || "";
                const groupName = `Broker • ${brokerName} • ${item.name}`;
                return (
                  <button
                    key={item.name}
                    onClick={() => handleFetchBroker(brokerName, item)}
                    disabled={loadingKey !== null}
                    className={cn(
                      "group p-4 rounded-2xl border bg-surface-950/60 text-left transition-all shadow-md hover-lift",
                      loadingKey === item.name
                        ? "border-yellow-500/30 bg-yellow-500/5 cursor-wait"
                        : "border-surface-800 hover:border-emerald-500/40 hover:bg-emerald-500/5",
                      loadingKey !== null && loadingKey !== item.name && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className={cn("flex items-start gap-3", isRtl && "flex-row-reverse text-right")}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md transition-transform group-hover:scale-110 bg-gradient-to-br from-emerald-400 to-green-600">
                        {loadingKey === item.name ? (
                          <RefreshSpinner />
                        ) : (
                          <Download className="w-5 h-5 text-black/90" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-extrabold text-white truncate">{item.name}</h4>
                        {item.desc && (
                          <p className="text-[11px] text-emerald-300/80 mt-0.5 font-medium">{item.desc}</p>
                        )}
                        <p className="text-[11px] text-surface-400 mt-1 font-mono break-all line-clamp-2">
                          {item.url}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-300/80">
                          <Globe className="w-3 h-3" />
                          <span className="truncate">Auto-group → {groupName}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RefreshSpinner() {
  return (
    <div className="w-4 h-4 border-2 border-black/25 border-t-black/80 rounded-full animate-spin" />
  );
}
