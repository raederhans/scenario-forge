import { state } from "./state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import * as mapRenderer from "./map_renderer.js";
import { markDirty } from "./dirty_state.js";
import {
  getFeatureOwnerCode,
  normalizeOwnerCode,
  setFeatureOwnerCodes,
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
  const landIndex = state.landIndex instanceof Map ? state.landIndex : null;
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

function applyOwnerToFeatureIds(
  targetIds = [],
  ownerCode,
  {
    render = true,
    historyKind = "feature-apply-ownership",
    dirtyReason = "feature-apply-ownership",
    recomputeReason = "scenario-ownership-editor-apply",
  } = {}
) {
  const { requestedIds, matchedIds, missingIds } = filterEditableOwnershipFeatureIds(targetIds);
  const normalizedOwnerCode = normalizeOwnerCode(ownerCode);
  if (!matchedIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "empty-target",
      mode: "ownership",
    };
  }
  if (!normalizedOwnerCode) {
    return {
      applied: false,
      changed: 0,
      matchedCount: matchedIds.length,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "missing-owner",
      mode: "ownership",
    };
  }

  const before = captureHistoryState({
    sovereigntyFeatureIds: matchedIds,
  });
  const changed = setFeatureOwnerCodes(matchedIds, normalizedOwnerCode);
  mapRenderer.refreshResolvedColorsForFeatures(matchedIds, { renderNow: false });
  if (changed > 0) {
    mapRenderer.scheduleDynamicBorderRecompute(recomputeReason, 90);
    markDirty(dirtyReason);
    pushHistoryEntry({
      kind: historyKind,
      before,
      after: captureHistoryState({
        sovereigntyFeatureIds: matchedIds,
      }),
      meta: {
        affectsSovereignty: true,
      },
    });
  }
  if (render && typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
  return {
    applied: true,
    changed,
    matchedCount: matchedIds.length,
    requestedCount: requestedIds.length,
    missingCount: missingIds.length,
    reason: "",
    mode: "ownership",
  };
}

function resetOwnersToScenarioBaselineForFeatureIds(
  targetIds = [],
  {
    render = true,
    historyKind = "feature-reset-scenario-ownership",
    dirtyReason = "feature-reset-scenario-ownership",
    recomputeReason = "scenario-ownership-editor-reset",
  } = {}
) {
  const { requestedIds, matchedIds, missingIds } = filterEditableOwnershipFeatureIds(targetIds);
  if (!matchedIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "empty-target",
      mode: "ownership",
    };
  }
  const baselineMap = state.scenarioBaselineOwnersByFeatureId
    && typeof state.scenarioBaselineOwnersByFeatureId === "object"
      ? state.scenarioBaselineOwnersByFeatureId
      : null;
  if (!state.activeScenarioId || !baselineMap) {
    return {
      applied: false,
      changed: 0,
      matchedCount: matchedIds.length,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "missing-scenario-baseline",
      mode: "ownership",
    };
  }

  const groupedIdsByOwner = new Map();
  const baselineTargetIds = [];
  const missingBaselineIds = [];
  matchedIds.forEach((id) => {
    const baselineOwnerCode = normalizeOwnerCode(baselineMap[id]);
    if (!baselineOwnerCode) {
      missingBaselineIds.push(id);
      return;
    }
    baselineTargetIds.push(id);
    if (!groupedIdsByOwner.has(baselineOwnerCode)) {
      groupedIdsByOwner.set(baselineOwnerCode, []);
    }
    groupedIdsByOwner.get(baselineOwnerCode).push(id);
  });
  if (!baselineTargetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: matchedIds.length,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length + missingBaselineIds.length,
      reason: "missing-scenario-baseline",
      mode: "ownership",
    };
  }

  const before = captureHistoryState({
    sovereigntyFeatureIds: baselineTargetIds,
  });
  let changed = 0;
  groupedIdsByOwner.forEach((featureIds, ownerCode) => {
    changed += setFeatureOwnerCodes(featureIds, ownerCode);
  });
  mapRenderer.refreshResolvedColorsForFeatures(baselineTargetIds, { renderNow: false });
  if (changed > 0) {
    mapRenderer.scheduleDynamicBorderRecompute(recomputeReason, 90);
    markDirty(dirtyReason);
    pushHistoryEntry({
      kind: historyKind,
      before,
      after: captureHistoryState({
        sovereigntyFeatureIds: baselineTargetIds,
      }),
      meta: {
        affectsSovereignty: true,
      },
    });
  }
  if (render && typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
  return {
    applied: true,
    changed,
    matchedCount: baselineTargetIds.length,
    requestedCount: requestedIds.length,
    missingCount: missingIds.length + missingBaselineIds.length,
    reason: "",
    mode: "ownership",
  };
}

function buildScenarioOwnershipSavePayload() {
  const scenarioId = String(state.activeScenarioId || "").trim();
  const baselineHash = String(state.scenarioBaselineHash || "").trim();
  const landIndex = state.landIndex instanceof Map ? state.landIndex : null;
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
    Object.entries(state.sovereigntyByFeatureId || {}).forEach(([featureId, ownerCode]) => {
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
  buildScenarioOwnershipSavePayload,
  filterEditableOwnershipFeatureIds,
  resetOwnersToScenarioBaselineForFeatureIds,
  summarizeOwnershipForFeatureIds,
};
