import { useEffect, useState } from "react";
import { X, Copy, Download, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { makeQrDataUrl } from "../utils/qrShare";
import { t } from "../i18n";
import { useStore } from "../store";

/**
 * QrModal (Phase D3, item 5 — QR export).
 *
 * Shows the QR for a config's raw share link with a copy-link shortcut and
 * a Save-PNG download. Renderer-only: no IPC, no shell dependency — works
 * in Electron AND the browser preview.
 */
export default function QrModal({ link, name, onClose }: {
  link: string;
  name: string;
  onClose: () => void;
}) {
  const language = useStore(s => s.language);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    makeQrDataUrl(link)
      .then((u) => { if (alive) setDataUrl(u); })
      .catch((e) => { if (alive) setError(String(e?.message || e)); });
    return () => { alive = false; };
  }, [link]);

  const savePng = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${name.replace(/[^\w.-]+/g, "_") || "config"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("qr.copyLink", language));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-surface-700/60 bg-surface-900 p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-white truncate">{name}</p>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-center rounded-xl bg-white p-3 min-h-[240px]">
          {dataUrl ? (
            <img src={dataUrl} alt="QR" className="w-56 h-56" />
          ) : error ? (
            <p className="text-xs text-red-600 px-4 text-center">{error}</p>
          ) : (
            <p className="text-xs text-surface-500 animate-pulse">…</p>
          )}
        </div>

        <p className="text-[11px] text-surface-500 break-all line-clamp-2">{link}</p>

        <div className="flex gap-2">
          <button
            onClick={copyLink}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-surface-800 hover:bg-surface-700 text-surface-200 transition-colors"
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t("qr.copied", language) : t("qr.copyLink", language)}
          </button>
          <button
            onClick={savePng}
            disabled={!dataUrl}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-500/90 hover:bg-emerald-500 text-black transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            {t("qr.savePng", language)}
          </button>
        </div>
      </div>
    </div>
  );
}
