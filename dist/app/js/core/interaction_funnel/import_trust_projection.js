import { getFeatureId, normalizeFeatureOwnershipMap } from "../sovereignty_manager.js";

// Borrow geometry only while collecting identities. The result contains new
// string values, never topology objects or runtime feature payloads.
export function getScenarioImportValidFeatureIds(target, preparedScenario) {
  const staged = preparedScenario?.staged;
  const ids = new Set(Object.keys(staged?.resolvedOwners || {}));
  const add = value => { const id = String(value || "").trim(); if (id) ids.add(id); };
  if (staged && String(staged.scenarioId) === String(target.activeScenarioId)) {
    for (const id of Array.isArray(target.runtimeFeatureIds) ? target.runtimeFeatureIds : []) add(id);
    if (target.runtimeFeatureIndexById instanceof Map) {
      for (const id of target.runtimeFeatureIndexById.keys()) add(id);
    }
  }
  for (const topology of [
    staged ? staged.runtimeTopologyPayload : target.defaultRuntimePoliticalTopology,
    target.defaultRuntimePoliticalTopology,
    target.topologyPrimary || target.topology,
    // Plain projects retain base detail identities, never an outgoing scene's.
    !staged ? target.topologyDetail : null,
  ]) {
    const geometries = topology?.objects?.political?.geometries;
    for (const geometry of Array.isArray(geometries) ? geometries : []) add(getFeatureId(geometry));
  }
  return ids.size ? ids : null;
}

export function resolveImportedOwnershipState(data, scenarioState) {
  const importedOwnersByFeatureId = normalizeFeatureOwnershipMap(data.sovereigntyByFeatureId);
  return {
    sovereigntyByFeatureId: scenarioState.activeScenarioId
      ? { ...(scenarioState.scenarioBaselineOwnersByFeatureId || {}), ...importedOwnersByFeatureId }
      : importedOwnersByFeatureId,
    shouldRestoreScenarioBaselineControllers: false,
  };
}
