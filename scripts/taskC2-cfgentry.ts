// Phase C2 functional/cfg/live-test entry — re-exports the REAL generator
// modules (no store; the ParsedConfig import in v2rayConfig is type-only
// and is erased by esbuild, same as taskC1-cfgentry.ts).
export { generateV2RayConfig } from "../src/utils/v2rayConfig";
export { generateSingBoxConfig } from "../src/utils/singBoxConfig";
export {
  DEFAULT_BUILDER_OPTIONS, FRAGMENT_DIALER_TAG,
  type BuilderOptions,
} from "../src/utils/builderOptions";
