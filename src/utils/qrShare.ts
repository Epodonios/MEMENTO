/**
 * qrShare.ts (Phase D3, item 5 — QR export / import)
 *
 * Generation: `qrcode` draws a QR data-URL for a config's raw share link
 * (or any text). Decoding: `jsqr` reads a QR back from an image file the
 * user picks — pure JS, no camera needed (desktop use case: scan the QR
 * another client/phone shows on screen, or a screenshot).
 *
 * STANDALONE module: no store imports, so smoke harnesses can bundle it.
 */

import QRCode from "qrcode";
import jsQR from "jsqr";

/**
 * Render `text` as a PNG data-URL QR. High-contrast on purpose: dark
 * modules (#020617 = surface-950) on a white field scan reliably even from
 * a dim screen or a photo of one.
 */
export async function makeQrDataUrl(text: string, sizePx = 512): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: sizePx,
    color: { dark: "#020617", light: "#ffffff" },
  });
}

/**
 * Decode every link carried in a QR image. A single QR may encode a
 * multi-line payload (several share links, or a base64 subscription blob) —
 * the raw text is returned and the caller runs it through the SAME import
 * pipeline as clipboard/file/text imports.
 * Throws when the image cannot be read or carries no machine-readable QR.
 */
export async function decodeQrImageFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Not an image file");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const maxDim = 2048; // decode cap — huge screenshots are downscaled first
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const res = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (!res || !res.data) throw new Error("No QR code found in the image");
    return res.data;
  } finally {
    bitmap.close?.();
  }
}

/**
 * Split a decoded QR payload into candidate share links (same pre-filter
 * every import path applies before addConfigs takes over).
 */
export function qrPayloadToLinks(payload: string): string[] {
  return payload
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 2000);
}
