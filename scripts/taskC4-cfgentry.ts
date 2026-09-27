// Phase C4 functional/cfg/live-test entry — re-exports the REAL generator
// modules + routing/topology options (no store; ParsedConfig imports are
// type-only and erased by esbuild, same as taskC3-cfgentry.ts).
export { generateV2RayConfig } from "../src/utils/v2rayConfig";
export { generateSingBoxConfig } from "../src/utils/singBoxConfig";
export {
  DEFAULT_BUILDER_OPTIONS,
  type BuilderOptions,
} from "../src/utils/builderOptions";
export {
  DEFAULT_ROUTING_OPTIONS,
  routingNeedsGeo, requiredGeoFiles,
  buildXrayRouting, buildSingBoxRouting,
  type RoutingOptions,
} from "../src/utils/routingOptions";
export {
  DEFAULT_TOPOLOGY_OPTIONS, DEFAULT_TOPOLOGY_INPUT,
  TOPOLOGY_OPTIONS_STORAGE_KEY, loadTopologyOptions,
  CHAIN_HOP_TAG, BALANCER_TAG, MAX_BALANCER_EXTRAS,
  balancerMemberTags, trafficTagsFor,
  type TopologyOptions, type TopologyInput, type BalancerStrategy,
} from "../src/utils/topologyOptions";
