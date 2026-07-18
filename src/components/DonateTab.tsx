import { useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import {
  Coffee, Copy, Check, ExternalLink, Sparkles, Bitcoin, Wallet
} from "lucide-react";
import toast from "react-hot-toast";
import SectionHeader from "./SectionHeader";
import { openExternalLink } from "../utils/tauriBridge";

const ADDRESS = "TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT";

function DonationCard({
  icon: Icon,
  label,
  address = ADDRESS,
  gradient,
}: {
  icon: React.ElementType;
  label: string;
  address?: string;
  gradient: string;
}) {
  const [copied, setCopied] = useState(false);
  const { language } = useStore();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t("donate.copied", language));
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className={cn(
      "group flex flex-col p-6 rounded-2xl border border-surface-700/50 bg-surface-950/60 hover:border-emerald-500/30 hover:bg-surface-900/80 transition-all duration-300 hover-lift shadow-lg hover:shadow-emerald-500/10",
      "relative overflow-hidden"
    )}>
      {/* Background glow */}
      <div className={cn(
        "absolute -top-10 -right-10 w-24 h-24 rounded-full blur-3xl opacity-30 group-hover:opacity-50 transition-opacity",
        gradient
      )} />

      <div className="flex items-center gap-3 mb-4 relative z-10">
        <div className={cn(
          "w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0 shadow-lg group-hover:scale-110 transition-transform",
          gradient
        )}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">
          {label}
        </h3>
      </div>

      <div className="flex-1 relative z-10">
        <p className="text-xs text-surface-400 font-mono break-all select-all bg-surface-950/80 p-3 rounded-xl border border-surface-800 group-hover:border-emerald-500/10 transition-colors">
          {address}
        </p>
      </div>

      <div className="mt-4 relative z-10">
        <button
          onClick={handleCopy}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer",
            copied
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-surface-800 text-surface-300 hover:bg-emerald-500/10 hover:text-emerald-400 border border-surface-700 hover:border-emerald-500/30"
          )}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              {t("donate.copied", language)}
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              {t("donate.copy", language)}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function DonateTab() {
  const { language } = useStore();
  const isRtl = language === "fa" || language === "ar";

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader titleKey="tab.donate" icon={Coffee} />

      <div className="max-w-5xl mx-auto mt-6">
        {/* Hero section with floating elements */}
        <div className="relative text-center mb-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
          <div className="absolute top-0 right-1/4 w-20 h-20 rounded-full bg-yellow-400/20 blur-2xl floaty pointer-events-none" style={{ animationDelay: "0s" }} />
          <div className="absolute bottom-0 left-1/4 w-16 h-16 rounded-full bg-amber-500/20 blur-2xl floaty pointer-events-none" style={{ animationDelay: "1.5s" }} />
          <div className="absolute top-1/2 right-1/3 w-12 h-12 rounded-full bg-emerald-300/30 blur-xl floaty pointer-events-none" style={{ animationDelay: "0.8s" }} />

          <div className="relative inline-block mb-6 scale-in">
            <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-amber-500/30 border border-white/10 floaty group">
              <Coffee className="w-12 h-12 text-white group-hover:rotate-12 transition-transform duration-300" />
              <Sparkles className="absolute -top-2 -right-2 w-8 h-8 text-yellow-300/80 animate-spin" style={{ animationDuration: "8s" }} />
            </div>
          </div>

          <h2 className={cn(
            "text-3xl sm:text-4xl font-extrabold text-white mb-4 tracking-tight relative",
            isRtl && "font-sans"
          )}>
            {t("donate.title", language)}
          </h2>
          <p className="text-sm sm:text-base text-surface-400 max-w-2xl mx-auto leading-relaxed">
            {t("donate.subtitle", language)}
          </p>
        </div>

        {/* Crypto Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger mb-8">
          <DonationCard
            icon={Wallet}
            label="Tron (TRC20)"
            gradient="from-red-500 to-pink-600"
          />
          <DonationCard
            icon={Wallet}
            label="Tether USDT (TRC20)"
            gradient="from-emerald-500 to-teal-600"
          />
          <DonationCard
            icon={Bitcoin}
            label="Bitcoin (TRC20)"
            gradient="from-orange-500 to-yellow-600"
          />
        </div>

        {/* Reymit Section */}
        <div className={cn(
          "relative overflow-hidden rounded-3xl border-2 border-dashed border-emerald-500/30 bg-surface-900/60 backdrop-blur-xl p-8 text-center group hover:border-emerald-500/60 transition-all duration-500 hover:scale-[1.01] shadow-xl",
        )}>
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-blue-500/5 pointer-events-none" />
          <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full bg-blue-500/10 blur-3xl pointer-events-none group-hover:bg-blue-500/20 transition-colors" />

          <div className="relative z-10">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-500/20 mb-5 group-hover:scale-110 transition-transform">
              <ExternalLink className="w-8 h-8 text-white" />
            </div>

            <h3 className="text-xl font-extrabold text-white mb-2">
              {t("donate.reymit", language)}
            </h3>
            <p className="text-xs text-surface-400 max-w-sm mx-auto mb-6">
              {t("donate.reymitDesc", language)}
            </p>

            <button
              type="button"
              onClick={() => openExternalLink("https://reymit.ir/epodonios")}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl text-sm font-extrabold bg-gradient-to-r from-blue-400 to-indigo-600 text-white hover:from-blue-300 hover:to-indigo-500 shadow-xl shadow-blue-500/20 transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              {t("donate.reymitButton", language)}
            </button>
          </div>
        </div>

        {/* Tiny thank-you note */}
        <p className="text-center text-[10px] text-surface-700 mt-6 tracking-wider font-mono opacity-60">
          ❤️ {t("app.by", language)} ❤️
        </p>
      </div>
    </div>
  );
}
