// Phase D2 self-test entry — re-exports the REAL generators (no store).
export { generateV2RayConfig } from "../src/utils/v2rayConfig";
export { generateSingBoxConfig } from "../src/utils/singBoxConfig";
export {
  DEFAULT_BUILDER_OPTIONS,
  singBoxLogLevel,
  type BuilderOptions,
} from "../src/utils/builderOptions";
export { parseSubscriptionUserInfo } from "../src/utils/subscription";
