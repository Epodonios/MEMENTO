#!/usr/bin/env node
/**
 * Copies the bundled desktop resources from the legacy Tauri project into
 * this Electron project, so both shells can be built side by side without
 * duplicating the source-of-truth files.
 *
 *   src-tauri/resources/  ->  electron-app/resources/
 *
 * Expected contents (same layout Tauri bundles today):
 *   resources/xray/xray.exe      (Xray-core v25.1.1)
 *   resources/geoip.dat
 *   resources/geosite.dat
 *   resources/spoofing-patt/     (tool + its companion files)
 *   resources/domain-fronting/   (manual-use tool, not launched by code)
 */
const fs = require("fs");
const path = require("path");

const src = path.resolve(__dirname, "..", "..", "src-tauri", "resources");
const dest = path.resolve(__dirname, "..", "resources");

if (!fs.existsSync(src)) {
  console.warn(
    `[sync-resources] Source not found: ${src}\n` +
      `[sync-resources] Nothing to copy. If you already keep resources/ in\n` +
      `[sync-resources] electron-app/, you can ignore this warning.`
  );
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true, force: true });

const size = (p) => {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    total += e.isDirectory() ? size(full) : fs.statSync(full).size;
  }
  return total;
};

console.log(
  `[sync-resources] Copied ${src} -> ${dest} (${(size(dest) / 1024 / 1024).toFixed(1)} MB)`
);
