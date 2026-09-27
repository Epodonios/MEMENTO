import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (same families the Google-Fonts CDN provided, now bundled
// so the app renders identically offline / in restricted networks).
import "@fontsource/inter/latin-300.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/jetbrains-mono/latin-700.css";
// MUST be first: installs the browser-preview Electron mock (no-op inside
// real Electron/Tauri shells — see electron-mock.ts guard).
import "./electron-mock";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
