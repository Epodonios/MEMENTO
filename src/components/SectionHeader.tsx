import { useStore } from "../store";
import { t } from "../i18n";
import { cn } from "../utils/cn";
import Hint from "./Hint";

interface SectionHeaderProps {
  titleKey: string;
  descKey?: string;
  /** 3.1.8 (user request #3): the colloquial "?" hint key (hint.* i18n
   *  namespace) shown next to the section title in ALL four languages. */
  hintKey?: string;
  icon: React.ElementType;
}

export default function SectionHeader({ titleKey, descKey, hintKey, icon: Icon }: SectionHeaderProps) {
  const language = useStore(s => s.language);
  const isRtl = language === "fa" || language === "ar";
  const descText = descKey ? t(descKey, language) : "";
  const hintText = hintKey ? t(hintKey, language) : "";

  return (
    <div className={cn("scale-in", isRtl && "text-right")} dir={isRtl ? "rtl" : "ltr"}>
      <div className={cn("flex items-center gap-3", isRtl && "flex-row-reverse")}>
        <div className="relative shrink-0">
          <div className="absolute inset-0 rounded-2xl bg-emerald-500/30 blur-lg" />
          <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 floaty">
            <Icon className="w-5 h-5 text-black/80" />
          </div>
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight dark:text-white light:text-ink-900">
          {t(titleKey, language)}
        </h2>
        {hintText && <Hint text={hintText} />}
      </div>
      {descText && descText.trim().length > 0 && (
        <p className={cn(
          "mt-3 text-sm leading-relaxed max-w-3xl",
          "dark:text-ink-300 light:text-ink-500",
          isRtl ? "mr-1" : "ml-1"
        )}>
          {descText}
        </p>
      )}
      <div className={cn(
        "mt-4 h-px w-full bg-gradient-to-r from-emerald-500/40 via-emerald-500/10 to-transparent",
        isRtl && "bg-gradient-to-l"
      )} />
    </div>
  );
}
