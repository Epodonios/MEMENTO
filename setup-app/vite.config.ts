import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

/**
 * MementoSetup renderer build.
 *
 * The wizard ships as ONE self-contained index.html (singlefile — same
 * trick the MEMENTO renderer uses). Fonts + lucide are bundled locally:
 * the installer must render perfectly with ZERO network access.
 */
export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome130",
    assetsInlineLimit: 100_000_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
