import { useEffect } from "react";
import { useStore } from "../store";
import toast from "react-hot-toast";

export default function KeyboardShortcuts() {
  const addConfigs = useStore(s => s.addConfigs);
  const configs = useStore(s => s.configs);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ctrl+V / Cmd+V - Paste from clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        const active = document.activeElement;
        // Don't intercept if user is typing in an input/textarea
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLElement && active.isContentEditable)
        ) {
          return;
        }

        try {
          const text = await navigator.clipboard.readText();
          if (!text.trim()) return;

          const lines = text
            .split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 0);

          const before = configs.length;
          addConfigs(lines);
          const after = useStore.getState().configs.length;
          const added = after - before;

          if (added > 0) {
            toast.success(`Imported ${added} config(s) via shortcut`);
          }
        } catch {
          // Clipboard access denied
        }
      }

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
  }, [addConfigs, configs.length]);

  return null;
}
