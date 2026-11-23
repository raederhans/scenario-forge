import { isRegionalScenario } from "../scenario/scenario_region.js";

export function resolvePoliticalCollectionSource(state) {
  const regional = isRegionalScenario(state.activeScenarioManifest);
  if (regional) return { regional, runtimeTopology: state.scenarioRuntimeTopologyData };
  const runtimeTopology = state.topologyBundleMode === "composite"
    ? (state.scenarioRuntimeTopologyData || state.runtimePoliticalTopology)
    : null;
  return { regional, runtimeTopology };
}

export function requiresPublicLeafDetail(state, policy) {
  return !!policy?.requiresComposite && state.interactionGranularity !== "country"
    && !isRegionalScenario(state.activeScenarioManifest);
}
