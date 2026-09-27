// Phase C1 functional/cfg/live-test entry — re-exports the REAL modules
// (no store; the ParsedConfig import in v2rayConfig is type-only and is
// erased by esbuild, same as taskD2-cfgentry.ts).
export { generateV2RayConfig } from "../src/utils/v2rayConfig";
export { generateSingBoxConfig } from "../src/utils/singBoxConfig";
export {
  DEFAULT_BUILDER_OPTIONS, FRAGMENT_DIALER_TAG, parseFragmentRange,
  type BuilderOptions,
} from "../src/utils/builderOptions";
export {
  pushTrafficSample, resetTrafficHistory, subscribeTrafficHistory,
  getTrafficHistory, TRAFFIC_HISTORY_MAX,
} from "../src/utils/trafficHistory";
