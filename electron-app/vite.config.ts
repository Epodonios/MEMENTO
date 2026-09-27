import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MEMENTO — Electron frontend build.
 *
 * The React frontend lives in the repository root `src/` and is SHARED with
 * the legacy Tauri shell (`src-tauri/`, kept untouched for rollback). This
 * config simply builds that same source into `electron-app/dist/` as one
 * self-contained HTML file (vite-plugin-singlefile), which the Electron
 * main process loads via file:// in production and via the dev server
 * (http://localhost:5173) in development.
 */
export default defineConfig({
  root: path.resolve(__dirname, ".."),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "..", "src"),
    },
  },

  // Same fixed port the Tauri dev loop uses, so `npm run dev` here and
  // `cargo tauri dev` never fight over an unpredictable port.
  server: {
    port: 5173,
    strictPort: true,
  },

  clearScreen: false,
  envPrefix: ["VITE_"],

  build: {
    // Electron 44 ships Chromium >= 130 — es2021 output is fully supported.
    target: "es2021",
    // Emit into electron-app/dist (absolute, because `root` points at the
    // repo root and a relative outDir would resolve against the repo root).
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    // Prevent CSS code-splitting so everything lands in the single HTML file.
    cssCodeSplit: false,
  },
});
