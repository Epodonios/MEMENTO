/**
 * taskE2-fnentry.ts — esbuild entry for the Phase E2 functional test.
 * Bundles the REAL renderer modules under test (all electron-free):
 *
 *   - src/store.ts               parseSingleLink / isSingBoxProtocol /
 *                                configCore (the E2 parser surface; the
 *                                zustand store initializer runs at import,
 *                                so the harness polyfills localStorage)
 *   - src/utils/singBoxConfig.ts generateSingBoxConfig (the E2 paired-
 *                                outbound generator)
 *   - src/utils/v2rayConfig.ts   generateV2RayConfig (the xray-path
 *                                structural refusal must hold for shadowtls)
 *   - src/utils/editor.ts        detectProtocol / editLink
 *   - src/utils/ping.ts          extractIpFromConfig
 *   - src/i18n.ts                t / translations (the honest disclosure)
 */
export { parseSingleLink, isSingBoxProtocol, configCore } from "../src/store";
export { generateSingBoxConfig } from "../src/utils/singBoxConfig";
export { generateV2RayConfig } from "../src/utils/v2rayConfig";
export { detectProtocol, editLink } from "../src/utils/editor";
export { extractIpFromConfig } from "../src/utils/ping";
export { t, translations } from "../src/i18n";
