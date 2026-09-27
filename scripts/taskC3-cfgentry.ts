// Phase C3 functional/cfg/live-test entry — re-exports the REAL generator
// modules + the routing options module (no store; ParsedConfig imports are
// type-only and erased by esbuild, same as taskC2-cfgentry.ts).
export { generateV2RayConfig } from "../src/utils/v2rayConfig";
export { generateSingBoxConfig } from "../src/utils/singBoxConfig";
export {
  DEFAULT_BUILDER_OPTIONS,
  type BuilderOptions,
} from "../src/utils/builderOptions";
export {
  DEFAULT_ROUTING_OPTIONS, loadRoutingOptions, ROUTING_OPTIONS_STORAGE_KEY,
  parseDomainRule, parseIpRule, parseRuleList, ROUTING_LIST_MAX,
  routingNeedsGeo, requiredGeoFiles,
  buildXrayRouting, buildSingBoxRouting,
  GEO_IR_XRAY_DOMAIN, GEO_IR_XRAY_IP, GEO_ADS_XRAY_DOMAIN, FAKEDNS_POOL,
  GEO_IR_SRS_GEOSITE, GEO_IR_SRS_GEOIP, GEO_ADS_SRS_GEOSITE,
  MINIMAL_IR_DOMAINS,
  type RoutingOptions, type RoutingPreset, type DnsMode,
} from "../src/utils/routingOptions";
