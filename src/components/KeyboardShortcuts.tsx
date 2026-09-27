import { useEffect } from "react";
import { useStore } from "../store";

/**
 * Global keyboard shortcuts.
 *
 * NOTE: Ctrl+V / Cmd+V is intentionally NOT handled here. The global
 * "paste = import configs" handler used to fight the context-aware Ctrl+V
 * handler in ConfigsTab.tsx: with a subscription-group tab open, a single
 * paste was processed TWICE (imported into the general pool AND into the
 * group, with duplicate toasts). The context-aware logic in ConfigsTab
 * (copy selected rows / paste into the active group) is the single owner
 * of Ctrl+V now.
 */
export default function KeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K - Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const activeTab = useStore.getState().activeTab;
        if (activeTab === "configs") {
          const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
          searchInput?.focus();
        }
      }

      // Ctrl+1,2,3,4,5,6 - Switch tabs
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "6") {
        e.preventDefault();
        const tabs = ["import", "configs", "editor", "pinger", "scanner", "export"];
        const idx = parseInt(e.key) - 1;
        useStore.getState().setActiveTab(tabs[idx]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}
