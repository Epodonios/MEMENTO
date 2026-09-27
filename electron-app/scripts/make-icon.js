#!/usr/bin/env node
/**
 * Generates build/icon.ico from the same 1024x1024 PNG the Tauri build uses
 * (src-tauri/icons/128x128.png — despite the filename it is 1024x1024).
 * electron-builder requires a real .ico for the portable exe icon/resource.
 *
 * Run once:  npm run make:icon
 */
const fs = require("fs");
const path = require("path");
const pngToIco = require("png-to-ico");

const candidates = [
  path.resolve(__dirname, "..", "build", "icon.png"), // 256x256 preferred
  path.resolve(__dirname, "..", "..", "src-tauri", "icons", "128x128.png"),
  path.resolve(__dirname, "..", "..", "src-tauri", "icons", "128x128@2x.png"),
];

const src = candidates.find((p) => fs.existsSync(p));
if (!src) {
  console.error(
    "[make-icon] No source PNG found. Drop a 256x256+ PNG at electron-app/build/icon.png"
  );
  process.exit(1);
}

(async () => {
  const mod = await import("png-to-ico");
  const pngToIco = mod.default?.default || mod.default || mod.pngToIco || mod;
  if (typeof pngToIco !== "function") {
    console.error("[make-icon] png-to-ico export not found:", Object.keys(mod));
    process.exit(1);
  }
  try {
    const buf = await pngToIco([src]);
    const out = path.resolve(__dirname, "..", "build", "icon.ico");
    fs.writeFileSync(out, buf);
    console.log(`[make-icon] ${src} -> ${out}`);
  } catch (e) {
    console.error("[make-icon] Failed:", e);
    process.exit(1);
  }
})();
