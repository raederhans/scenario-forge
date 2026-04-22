import { state as runtimeState } from "./state.js";
const state = runtimeState;

function countOwnerControllerSplit({
  ownersByFeatureId = runtimeState.sovereigntyByFeatureId || {},
  controllersByFeatureId = runtimeState.scenarioControllersByFeatureId || {},
} = {}) {
  let split = 0;
  const seen = new Set();
  Object.entries(ownersByFeatureId || {}).forEach(([featureId, owner]) => {
    const normalizedId = String(featureId || "").trim();
    if (!normalizedId) return;
    seen.add(normalizedId);
    const ownerTag = String(owner || "").trim().toUpperCase();
    const controllerTag = String(controllersByFeatureId?.[normalizedId] || ownerTag || "").trim().toUpperCase();
    if (ownerTag && controllerTag && ownerTag !== controllerTag) {
      split += 1;
    }
  });
  Object.entries(controllersByFeatureId || {}).forEach(([featureId, controller]) => {
    const normalizedId = String(featureId || "").trim();
    if (!normalizedId || seen.has(normalizedId)) return;
    const controllerTag = String(controller || "").trim().toUpperCase();
    const ownerTag = String(ownersByFeatureId?.[normalizedId] || controllerTag || "").trim().toUpperCase();
    if (ownerTag && controllerTag && ownerTag !== controllerTag) {
      split += 1;
    }
  });
  return split;
}

export function recalculateScenarioOwnerControllerDiffCount() {
  runtimeState.scenarioOwnerControllerDiffCount = runtimeState.activeScenarioId
    ? countOwnerControllerSplit({
      ownersByFeatureId: runtimeState.sovereigntyByFeatureId,
      controllersByFeatureId: runtimeState.scenarioControllersByFeatureId,
    })
    : 0;
  return runtimeState.scenarioOwnerControllerDiffCount;
}

