import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // Tauri expects a consistent port for dev
  server: {
    port: 5173,
    strictPort: true,
  },

  // Tauri release: don't clear the screen on each rebuild
  clearScreen: false,

  // Tauri requires `process.env.TAURI_ENV_*` to be available
  envPrefix: ["VITE_", "TAURI_ENV_"],

  build: {
    // Tauri uses Chromium — set minimum supported version
    target: "es2021",
    // Prevent CSS code-splitting so everything is in one file
    cssCodeSplit: false,
  },
});
