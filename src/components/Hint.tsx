/**
 * MEMENTO — 3.1.8 Hint (user request #3): a CUSTOM, stylish hover tooltip
 * system — a tiny "?" icon that reveals a rich, colloquial explanation in
 * the ACTIVE app language (all four: en / fa / zh / ar).
 *
 * Design goals (the user asked for "شیک و سفارشی و قشنگ"):
 *   - a soft emerald orb with a subtle glow ring, floating a hand-tuned
 *     bubble above it on hover AND keyboard focus (focus-within),
 *   - glass bubble: blurred dark surface, emerald hairline border, a
 *     little arrow, soft shadow — never a native title attribute,
 *   - pure CSS transitions (no deps, no portal): opacity + lift + a
 *     gentle scale, staggered by 60 ms so it feels deliberate,
 *   - fully RTL-aware: the text direction follows the page; the bubble
 *     stays centered above the icon in both layouts,
 *   - touch users: a tap focuses the orb (tabIndex=0) and reveals the
 *     bubble until focus moves away.
 */
import { HelpCircle } from "lucide-react";
import { cn } from "../utils/cn";

interface HintProps {
  /** ALREADY-TRANSLATED hint text (callers pass t("hint.xxx", language)). */
  text: string;
  /** Extra classes on the trigger orb. */
  className?: string;
  /** Bubble width preset — sm fits short lines, md (default) is comfy. */
  size?: "sm" | "md";
}

export default function Hint({ text, className, size = "md" }: HintProps) {
  if (!text) return null;
  return (
    <span
      className={cn("hint-orb group relative inline-flex items-center justify-center align-middle shrink-0", className)}
      tabIndex={0}
      role="note"
      aria-label={text}
    >
      <span className="pointer-events-none absolute inset-0 rounded-full bg-emerald-400/25 blur-[3px] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200" />
      <HelpCircle
        className={cn(
          "relative w-[13px] h-[13px] text-emerald-400/70 transition-all duration-200",
          "group-hover:text-emerald-300 group-hover:rotate-8 group-hover:scale-110",
          "group-focus-within:text-emerald-300"
        )}
      />
      <span
        dir="auto"
        className={cn(
          "hint-bubble pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50",
          "rounded-xl border border-emerald-400/25 bg-surface-950/95 backdrop-blur-xl",
          "shadow-xl shadow-black/40",
          "px-3 py-2 font-medium leading-relaxed text-ink-100",
          size === "sm" ? "text-[10.5px] max-w-[190px]" : "text-[11px] max-w-[260px]",
          "opacity-0 translate-y-1.5 scale-[0.97] group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100",
          "group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100",
          "transition-all duration-200 ease-out"
        )}
      >
        {text}
        {/* the little arrow */}
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-[5px] w-2.5 h-2.5 rotate-45 border-b border-e border-emerald-400/25 bg-surface-950/95" />
      </span>
    </span>
  );
}
