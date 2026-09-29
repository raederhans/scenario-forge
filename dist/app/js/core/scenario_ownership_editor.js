import { ownershipEditingDisabledResult } from "./map_editing_policy.js";
import { state as runtimeState } from "./state.js";
import {
  getFeatureOwnerCode,
  normalizeOwnerCode,
  shouldExcludeScenarioPoliticalFeature,
} from "./sovereignty_manager.js";

function uniqueIds(featureIds = []) {
  return Array.from(new Set(
    (Array.isArray(featureIds) ? featureIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function filterEditableOwnershipFeatureIds(featureIds = []) {
  const requestedIds = uniqueIds(featureIds);
  if (!requestedIds.length) {
    return {
      requestedIds: [],
      matchedIds: [],
      missingIds: [],
    };
  }
  const landIndex = runtimeState.landIndex instanceof Map ? runtimeState.landIndex : null;
  if (!landIndex || landIndex.size === 0) {
    return {
      requestedIds,
      matchedIds: requestedIds,
      missingIds: [],
    };
  }
  const matchedIds = [];
  const missingIds = [];
  requestedIds.forEach((id) => {
    const feature = landIndex.get(id);
    if (feature && !shouldExcludeScenarioPoliticalFeature(feature, id)) {
      matchedIds.push(id);
      return;
    }
    missingIds.push(id);
  });
  return {
    requestedIds,
    matchedIds,
    missingIds,
  };
}

function applyOwnerToFeatureIds(targetIds = []) {
  return ownershipEditingDisabledResult(Array.isArray(targetIds) ? targetIds.length : 0);
}

function resetOwnersToScenarioBaselineForFeatureIds(targetIds = []) {
  return ownershipEditingDisabledResult(Array.isArray(targetIds) ? targetIds.length : 0);
}

function applyOwnerControllerAssignmentsToFeatureIds(assignmentsByFeatureId = {}) {
  return ownershipEditingDisabledResult(Object.keys(assignmentsByFeatureId || {}).length);
}

function buildScenarioOwnershipSavePayload() {
  const scenarioId = String(runtimeState.activeScenarioId || "").trim();
  const baselineHash = String(runtimeState.scenarioBaselineHash || "").trim();
  const landIndex = runtimeState.landIndex instanceof Map ? runtimeState.landIndex : null;
  const owners = {};

  if (landIndex && landIndex.size > 0) {
    landIndex.forEach((feature, featureId) => {
      const id = String(featureId || "").trim();
      if (!id || shouldExcludeScenarioPoliticalFeature(feature, id)) return;
      const ownerCode = normalizeOwnerCode(getFeatureOwnerCode(id));
      if (!ownerCode) return;
      owners[id] = ownerCode;
    });
  } else {
    Object.entries(runtimeState.sovereigntyByFeatureId || {}).forEach(([featureId, ownerCode]) => {
      const id = String(featureId || "").trim();
      const normalizedOwnerCode = normalizeOwnerCode(ownerCode);
      if (!id || !normalizedOwnerCode) return;
      owners[id] = normalizedOwnerCode;
    });
  }

  return {
    scenarioId,
    baselineHash,
    owners,
  };
}

function summarizeOwnershipForFeatureIds(featureIds = []) {
  const matchedIds = filterEditableOwnershipFeatureIds(featureIds).matchedIds;
  const owners = Array.from(new Set(
    matchedIds
      .map((featureId) => normalizeOwnerCode(getFeatureOwnerCode(featureId)))
      .filter(Boolean)
  )).sort();
  return {
    featureCount: matchedIds.length,
    ownerCodes: owners,
    isMixed: owners.length > 1,
    singleOwnerCode: owners.length === 1 ? owners[0] : "",
  };
}

export {
  applyOwnerToFeatureIds,
  applyOwnerControllerAssignmentsToFeatureIds,
  buildScenarioOwnershipSavePayload,
  filterEditableOwnershipFeatureIds,
  resetOwnersToScenarioBaselineForFeatureIds,
  summarizeOwnershipForFeatureIds,
};

