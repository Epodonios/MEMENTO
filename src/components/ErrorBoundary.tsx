import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches all React rendering errors so the app NEVER shows a blank white
 * page. Critical for production .exe builds where the user has no devtools.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console for devs, but never expose to user
    console.error("MEMENTO ErrorBoundary caught:", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="h-screen flex items-center justify-center bg-surface-950 p-6">
          <div className="max-w-md w-full rounded-3xl border border-emerald-500/20 bg-surface-900/80 p-8 shadow-2xl shadow-emerald-500/10 text-center backdrop-blur-xl">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/40 mb-5 floaty">
              <AlertTriangle className="w-8 h-8 text-black/80" strokeWidth={2.4} />
            </div>
            <h2 className="text-xl font-extrabold text-white mb-2">
              Something Went Off-Track
            </h2>
            <p className="text-sm text-ink-400 mb-5 leading-relaxed">
              MEMENTO encountered an unexpected error, but your data is safe.
              You can recover instantly without losing your work.
            </p>

            {this.state.error && (
              <details className="mb-5 text-left">
                <summary className="text-xs text-emerald-400 cursor-pointer hover:underline">
                  Technical details
                </summary>
                <pre className="mt-2 p-3 rounded-lg bg-surface-950 text-[10px] text-red-400 overflow-auto max-h-32 font-mono">
                  {this.state.error.message}
                </pre>
              </details>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-extrabold text-black/90 bg-gradient-to-r from-emerald-400 to-green-600 hover:brightness-110 shadow-lg shadow-emerald-500/30 transition-all hover:scale-[1.02]"
              >
                <RotateCcw className="w-4 h-4" />
                Recover
              </button>
              <button
                onClick={this.handleReload}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-ink-300 bg-surface-800 hover:bg-surface-700 transition-colors"
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
