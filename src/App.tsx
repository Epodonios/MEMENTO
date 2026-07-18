import { useEffect, useState } from "react";
import ThemeProvider from "./components/ThemeProvider";
import ToastProvider from "./components/ToastProvider";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import ErrorBoundary from "./components/ErrorBoundary";
import Sidebar from "./components/Sidebar";
import ImportTab from "./components/ImportTab";
import ConfigsTab from "./components/ConfigsTab";
import ConnectionTab from "./components/ConnectionTab";
import EditorTab from "./components/EditorTab";
import PingerTab from "./components/PingerTab";
import ScannerTab from "./components/ScannerTab";
import ExportTab from "./components/ExportTab";
import DonateTab from "./components/DonateTab";
import ContactTab from "./components/ContactTab";
import TitleBar from "./components/TitleBar";
import ConnectionManager from "./components/ConnectionManager";
import { useStore } from "./store";
import { cn } from "./utils/cn";
import { Menu, X, Eye } from "lucide-react";

import { fetchSubscription } from "./utils/subscription";
import toast from "react-hot-toast";

function TabContent() {
  const activeTab = useStore(s => s.activeTab);

  return (
    <div className={cn(
      "flex-1 flex flex-col overflow-hidden relative grid-bg",
      "dark:bg-surface-950/40 light:bg-transparent"
    )}>
      {/* Ambient glow blobs */}
      <div className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl spin-slow" />
      <div className="pointer-events-none absolute -bottom-32 left-1/4 w-80 h-80 rounded-full bg-green-600/8 blur-3xl floaty" />

      <ErrorBoundary>
        <div key={activeTab} className="relative flex-1 flex flex-col overflow-hidden">
          {activeTab === "import" && <ImportTab />}
          {activeTab === "configs" && <ConfigsTab />}
          {activeTab === "connection" && <ConnectionTab />}
          {activeTab === "editor" && <EditorTab />}
          {activeTab === "pinger" && <PingerTab />}
          {activeTab === "scanner" && <ScannerTab />}
          {activeTab === "export" && <ExportTab />}
          {activeTab === "donate" && <DonateTab />}
          {activeTab === "contact" && <ContactTab />}
        </div>
      </ErrorBoundary>
    </div>
  );
}

export default function App() {
  // Select only what the shell actually needs. Subscribing App to the
  // entire store caused the whole UI tree (including thousands of config
  // rows) to re-render every time live VPN traffic counters updated, which
  // looked like a hang and could eventually crash WebView2 under load.
  const language = useStore(s => s.language);
  const activeTab = useStore(s => s.activeTab);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Force dark mode always (light mode removed)
  useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    const isRtl = language === "fa" || language === "ar";
    document.documentElement.setAttribute("dir", isRtl ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", language);
  }, [language]);

  // Close mobile sidebar when user picks a tab
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [activeTab]);

  // Auto-Update Subscription Groups
  useEffect(() => {
    const checkUpdates = async () => {
      const state = useStore.getState();
      const now = Date.now();
      
      for (const group of state.subscriptionGroups) {
        if (!group.autoUpdate || !group.subscriptionUrl || !group.updateIntervalMinutes) continue;
        
        const intervalMs = group.updateIntervalMinutes * 60 * 1000;
        const lastUpdated = group.lastUpdated || 0;
        
        if (now - lastUpdated >= intervalMs) {
          try {
            console.log(`[MEMENTO] Auto-updating group: ${group.name}`);
            const lines = await fetchSubscription(group.subscriptionUrl);
            
            const before = useStore.getState().configs.length;
            useStore.getState().addConfigs(lines);
            const addedIds = useStore.getState().configs.slice(-(useStore.getState().configs.length - before)).map(c => c.id);
            
            if (addedIds.length > 0) {
              useStore.getState().addConfigsToGroup(group.id, addedIds);
              toast.success(`Auto-updated group "${group.name}": +${addedIds.length} configs`, {
                icon: "🔄"
              });
            }
            
            // Mark as updated
            useStore.getState().updateSubscriptionGroup(group.id, { lastUpdated: now });
          } catch (e) {
            console.warn(`[MEMENTO] Auto-update failed for group ${group.name}`, e);
          }
        }
      }
    };

    // Check every minute
    const timer = setInterval(checkUpdates, 60 * 1000);
    // Initial check after 5 seconds to not block startup
    const initTimer = setTimeout(checkUpdates, 5000);
    
    return () => {
      clearInterval(timer);
      clearTimeout(initTimer);
    };
  }, []);

  // Native Windows app feel: disable right-click menu & drag-selection of UI chrome
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Allow context menu only inside editable / selectable areas
      const isEditable =
        target.closest("input, textarea, [contenteditable], pre, code, .allow-select") !== null;
      if (!isEditable) e.preventDefault();
    };
    const onSelectStart = (e: Event) => {
      const target = e.target as HTMLElement;
      const isEditable =
        target.closest("input, textarea, [contenteditable], pre, code, .allow-select") !== null;
      if (!isEditable) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("selectstart", onSelectStart);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("selectstart", onSelectStart);
    };
  }, []);

  // Global safety nets — never let unhandled errors crash the .exe shell
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      console.warn("[MEMENTO] Suppressed window error:", e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      console.warn("[MEMENTO] Suppressed unhandled rejection:", e.reason);
      e.preventDefault();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const isRtl = language === "fa" || language === "ar";

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ToastProvider />
        <KeyboardShortcuts />
        <ConnectionManager />

        <div className="h-screen flex flex-col overflow-hidden dark:bg-surface-950">
          {/* Custom titlebar — only rendered inside the compiled desktop app */}
          <TitleBar />

          <div className="flex-1 flex overflow-hidden relative">

            {/* MOBILE TOP BAR — only visible <md */}
            <div className={cn(
              "md:hidden absolute top-0 left-0 right-0 z-30 h-14 px-4 flex items-center justify-between border-b border-emerald-500/10 backdrop-blur-xl bg-surface-950/80",
              isRtl && "flex-row-reverse"
            )}>
              <div className={cn("flex items-center gap-2.5", isRtl && "flex-row-reverse")}>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/40">
                  <Eye className="w-5 h-5 text-black/85" strokeWidth={2.4} />
                </div>
                <div className={cn(isRtl && "text-right")}>
                  <h1 className="text-base font-extrabold gradient-text leading-none">MEMENTO</h1>
                  <p className="text-[8px] text-emerald-400/80 font-extrabold tracking-wider uppercase mt-0.5">
                    from EPODONIOS to A Who
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMobileSidebarOpen(o => !o)}
                className="w-10 h-10 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 flex items-center justify-center text-emerald-400 transition-all active:scale-95"
                aria-label="Toggle menu"
              >
                {mobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>

            {/* SIDEBAR — drawer on mobile, fixed on desktop */}
            <div className={cn(
              "fixed md:relative inset-y-0 z-40 transition-transform duration-300 md:translate-x-0",
              isRtl ? "right-0" : "left-0",
              mobileSidebarOpen
                ? "translate-x-0"
                : isRtl ? "translate-x-full md:translate-x-0" : "-translate-x-full md:translate-x-0"
            )}>
              <Sidebar />
            </div>

            {/* Mobile overlay backdrop */}
            {mobileSidebarOpen && (
              <div
                onClick={() => setMobileSidebarOpen(false)}
                className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
              />
            )}

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col overflow-hidden pt-14 md:pt-0">
              <TabContent />
            </div>
          </div>
        </div>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
