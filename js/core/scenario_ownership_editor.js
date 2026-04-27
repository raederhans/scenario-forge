import { state as runtimeState } from "./state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import {
  refreshResolvedColorsForFeatures,
  requestInteractionRender,
  scheduleDynamicBorderRecompute,
} from "./map_renderer.js";
import { markDirty } from "./dirty_state.js";
import { recalculateScenarioOwnerControllerDiffCount } from "./scenario_owner_metrics.js";
import {
  getFeatureOwnerCode,
  normalizeOwnerCode,
  setFeatureOwnerCodes,
  shouldExcludeScenarioPoliticalFeature,
} from "./sovereignty_manager.js";
const state = runtimeState;

function uniqueIds(featureIds = []) {
  return Array.from(new Set(
    (Array.isArray(featureIds) ? featureIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function requestScenarioOwnershipRender(reason = "scenario-ownership") {
  return requestInteractionRender(reason);
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
  if (changed > 0) {
    refreshResolvedColorsForFeatures(matchedIds, { renderNow: false });
    scheduleDynamicBorderRecompute(recomputeReason, 90);
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
  if (render) {
    requestScenarioOwnershipRender("scenario-ownership-apply-owner");
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
  const baselineMap = runtimeState.scenarioBaselineOwnersByFeatureId
    && typeof runtimeState.scenarioBaselineOwnersByFeatureId === "object"
      ? runtimeState.scenarioBaselineOwnersByFeatureId
      : null;
  if (!runtimeState.activeScenarioId || !baselineMap) {
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
  if (changed > 0) {
    refreshResolvedColorsForFeatures(baselineTargetIds, { renderNow: false });
    scheduleDynamicBorderRecompute(recomputeReason, 90);
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
  if (render) {
    requestScenarioOwnershipRender("scenario-ownership-reset-baseline");
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

function applyOwnerControllerAssignmentsToFeatureIds(
  assignmentsByFeatureId = {},
  {
    render = true,
    historyKind = "feature-apply-owner-controller",
    dirtyReason = "feature-apply-owner-controller",
    recomputeReason = "feature-apply-owner-controller",
  } = {}
) {
  const entries = Object.entries(assignmentsByFeatureId || {})
    .map(([featureId, assignment]) => {
      const normalizedFeatureId = String(featureId || "").trim();
      const ownerCode = normalizeOwnerCode(assignment?.ownerCode);
      const controllerCode = normalizeOwnerCode(assignment?.controllerCode || assignment?.ownerCode);
      if (!normalizedFeatureId || !ownerCode || !controllerCode) return null;
      return {
        featureId: normalizedFeatureId,
        ownerCode,
        controllerCode,
      };
    })
    .filter(Boolean);

  if (!entries.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "ownership",
    };
  }

  const targetIds = filterEditableOwnershipFeatureIds(entries.map((entry) => entry.featureId)).matchedIds;
  if (!targetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: entries.length,
      missingCount: entries.length,
      reason: "empty-target",
      mode: "ownership",
    };
  }

  const before = captureHistoryState({
    sovereigntyFeatureIds: targetIds,
    scenarioControllerFeatureIds: targetIds,
  });
  runtimeState.scenarioControllersByFeatureId = runtimeState.scenarioControllersByFeatureId || {};
  const ownerFeatureIdsByCode = new Map();
  const changedFeatureIds = new Set();

  entries.forEach(({ featureId, ownerCode, controllerCode }) => {
    if (!targetIds.includes(featureId)) return;
    const currentOwnerCode = normalizeOwnerCode(runtimeState.sovereigntyByFeatureId?.[featureId]);
    const currentControllerCode = normalizeOwnerCode(
      runtimeState.scenarioControllersByFeatureId?.[featureId] || currentOwnerCode
    );
    if (currentOwnerCode !== ownerCode) {
      if (!ownerFeatureIdsByCode.has(ownerCode)) {
        ownerFeatureIdsByCode.set(ownerCode, []);
      }
      ownerFeatureIdsByCode.get(ownerCode).push(featureId);
      changedFeatureIds.add(featureId);
    }
    if (currentControllerCode !== controllerCode) {
      runtimeState.scenarioControllersByFeatureId[featureId] = controllerCode;
      changedFeatureIds.add(featureId);
    }
  });

  ownerFeatureIdsByCode.forEach((featureIds, ownerCode) => {
    setFeatureOwnerCodes(featureIds, ownerCode);
  });
  if (changedFeatureIds.size) {
    runtimeState.scenarioControllerRevision = (Number(runtimeState.scenarioControllerRevision) || 0) + 1;
    recalculateScenarioOwnerControllerDiffCount();
    refreshResolvedColorsForFeatures(Array.from(changedFeatureIds), { renderNow: false });
    scheduleDynamicBorderRecompute(recomputeReason, 90);
    markDirty(dirtyReason);
    pushHistoryEntry({
      kind: historyKind,
      before,
      after: captureHistoryState({
        sovereigntyFeatureIds: targetIds,
        scenarioControllerFeatureIds: targetIds,
      }),
      meta: {
        affectsSovereignty: true,
      },
    });
  }
  if (render) {
    requestScenarioOwnershipRender("scenario-ownership-apply-owner-controller");
  }
  return {
    applied: true,
    changed: changedFeatureIds.size,
    matchedCount: targetIds.length,
    requestedCount: entries.length,
    missingCount: Math.max(entries.length - targetIds.length, 0),
    reason: "",
    mode: "ownership",
  };
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

