import { useStore } from "../store";
import { cn } from "../utils/cn";
import { t } from "../i18n";
import { Heart, Send, Mail, HeartHandshake } from "lucide-react";
import SectionHeader from "./SectionHeader";
import { openExternalLink } from "../utils/tauriBridge";

export default function ContactTab() {
  const { language } = useStore();
  const isRtl = language === "fa" || language === "ar";

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 fade-in">
      <SectionHeader titleKey="tab.contact" icon={HeartHandshake} />

      <div className="max-w-4xl mx-auto mt-8 relative">
        {/* Ambient background glows */}
        <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-emerald-500/10 blur-[100px] pointer-events-none mix-blend-screen" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-green-600/10 blur-[120px] pointer-events-none mix-blend-screen" />

        <div className={cn(
          "relative overflow-hidden rounded-[2rem] border border-emerald-500/20 bg-surface-900/60 backdrop-blur-2xl shadow-2xl p-8 sm:p-12 pop-in",
          isRtl && "text-right"
        )}>
          {/* Shine effect overlay */}
          <div className="absolute inset-0 shine opacity-50 pointer-events-none" />

          {/* Glowing heart header */}
          <div className="flex justify-center mb-8 floaty">
            <div className="relative group">
              <div className="absolute inset-0 bg-red-500/30 rounded-full blur-xl group-hover:bg-red-500/50 transition-all duration-500 pulse-glow" />
              <div className="relative w-20 h-20 bg-gradient-to-br from-red-400 to-pink-600 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 border border-white/10">
                <Heart className="w-10 h-10 text-white fill-white animate-pulse" />
              </div>
            </div>
          </div>

          {/* Dedication Text */}
          <div className="relative z-10 mb-12">
            <div className="absolute -top-4 -left-4 text-6xl text-emerald-500/10 font-serif select-none pointer-events-none">"</div>
            <div className="absolute -bottom-8 -right-4 text-6xl text-emerald-500/10 font-serif select-none pointer-events-none">"</div>
            
            <p className={cn(
              "text-lg sm:text-xl md:text-2xl leading-relaxed text-center font-medium text-white/90",
              isRtl ? "font-sans" : "font-serif tracking-wide"
            )}>
              {t("contact.dedication", language)}
            </p>
          </div>

          {/* Contact Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10 stagger">
            {/* Telegram Card */}
            <button
              type="button"
              onClick={() => openExternalLink("https://t.me/+NqWGD5-OGv1jOGU8")}
              className="group flex items-center gap-4 p-5 rounded-2xl bg-surface-950/50 border border-surface-700/50 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all duration-300 hover-lift cursor-pointer text-left"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300">
                <Send className="w-6 h-6 text-white" />
              </div>
              <div className={cn("flex-1", isRtl && "text-right")}>
                <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                  {t("contact.telegram", language)}
                </h3>
                <p className="text-xs text-surface-400 mt-1 font-mono break-all group-hover:text-blue-200/70 transition-colors">
                  t.me/+NqWGD5-OGv1jOGU8
                </p>
              </div>
            </button>

            {/* Email Card */}
            <button
              type="button"
              onClick={() => openExternalLink("mailto:Epodonios@gmail.com")}
              className="group flex items-center gap-4 p-5 rounded-2xl bg-surface-950/50 border border-surface-700/50 hover:border-orange-500/40 hover:bg-orange-500/10 transition-all duration-300 hover-lift cursor-pointer text-left"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shrink-0 shadow-lg shadow-orange-500/20 group-hover:scale-110 transition-transform duration-300">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <div className={cn("flex-1", isRtl && "text-right")}>
                <h3 className="text-sm font-bold text-white group-hover:text-orange-400 transition-colors">
                  {t("contact.email", language)}
                </h3>
                <p className="text-xs text-surface-400 mt-1 font-mono break-all group-hover:text-orange-200/70 transition-colors">
                  Epodonios@gmail.com
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Footer Credit under the card */}
        <div className="mt-8 text-center animate-fade-in" style={{ animationDelay: '0.6s' }}>
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-emerald-500/60">
            MEMENTO • FROM EPODONIOS TO A WHO
          </p>
        </div>
      </div>
    </div>
  );
}
