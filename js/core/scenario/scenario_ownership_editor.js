import { normalizeStringList as uniqueIds } from "../renderer/string_list_normalizers.js";
import { state as runtimeState } from "../state.js";
import {
  getFeatureOwnerCode,
  normalizeOwnerCode,
  shouldExcludeScenarioPoliticalFeature,
} from "../sovereignty_manager.js";

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
  filterEditableOwnershipFeatureIds,
  summarizeOwnershipForFeatureIds,
};

