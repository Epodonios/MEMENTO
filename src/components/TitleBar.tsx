import { useEffect, useState } from "react";
import { useStore } from "../store";
import { cn } from "../utils/cn";
import { isTauri } from "../utils/tauriBridge";
import { Eye, Minus, Square, Copy as RestoreIcon, X } from "lucide-react";

/**
 * Custom title bar matching MEMENTO's dark green theme.
 * Native window decorations are disabled in tauri.conf.json
 * (decorations: false), so we draw our own minimize/maximize/close
 * buttons here and use `data-tauri-drag-region` to let the user drag
 * the window by clicking anywhere on the empty part of the bar.
 *
 * Only rendered inside the compiled Tauri desktop app — in a plain
 * browser (dev mode) there is no native window to control, so this
 * component renders nothing.
 */
export default function TitleBar() {
  const { language } = useStore();
  const isRtl = language === "fa" || language === "ar";
  const [mounted, setMounted] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [win, setWin] = useState<any>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const current = getCurrentWindow();
        setWin(current);
        setMounted(true);
        setIsMaximized(await current.isMaximized());

        unlisten = await current.onResized(async () => {
          try {
            setIsMaximized(await current.isMaximized());
          } catch {
            /* ignore */
          }
        });
      } catch (e) {
        console.warn("[MEMENTO] TitleBar: window API unavailable", e);
      }
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  if (!mounted || !win) return null;

  /**
   * Manual drag-start fallback.
   *
   * `data-tauri-drag-region` alone can silently fail to move the window on
   * some Windows/WebView2 combinations (a known upstream quirk, especially
   * when `dragDropEnabled` interferes with the native drag gesture). Calling
   * `win.startDragging()` ourselves on mousedown is the robust workaround
   * used by most Tauri apps with a custom titlebar — it works regardless of
   * whether the automatic attribute-based dragging kicks in.
   */
  const handleDragMouseDown = (e: React.MouseEvent) => {
    // Only the primary (left) button should start a window drag, and never
    // when the user is actually clicking one of the window control buttons.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    win.startDragging?.().catch(() => { /* ignore — attribute-based drag may still work */ });
  };

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      className={cn(
        "h-9 shrink-0 flex items-center justify-between select-none z-50 relative",
        "bg-surface-950 border-b border-emerald-500/10",
        isRtl && "flex-row-reverse"
      )}
    >
      {/* Brand (also draggable) */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        className={cn("flex items-center gap-2 px-3 h-full flex-1 min-w-0", isRtl && "flex-row-reverse")}
      >
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-700 flex items-center justify-center shrink-0 pointer-events-none">
          <Eye className="w-3 h-3 text-black/85" strokeWidth={2.6} />
        </div>
        <span className="text-[11px] font-bold tracking-wide text-surface-300 truncate pointer-events-none">
          MEMENTO
        </span>
      </div>

      {/* Window controls */}
      <div className={cn("flex items-center h-full shrink-0", isRtl && "flex-row-reverse")}>
        <button
          onClick={() => win.minimize()}
          title="Minimize"
          aria-label="Minimize"
          className="h-9 w-11 flex items-center justify-center text-surface-400 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={async () => {
            await win.toggleMaximize();
            try { setIsMaximized(await win.isMaximized()); } catch { /* ignore */ }
          }}
          title={isMaximized ? "Restore" : "Maximize"}
          aria-label="Maximize"
          className="h-9 w-11 flex items-center justify-center text-surface-400 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors cursor-pointer"
        >
          {isMaximized ? <RestoreIcon className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
        <button
          onClick={() => win.close()}
          title="Close"
          aria-label="Close"
          className="h-9 w-11 flex items-center justify-center text-surface-400 hover:bg-red-500 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
