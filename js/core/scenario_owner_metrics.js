import { state } from "./state.js";

function countOwnerControllerSplit({
  ownersByFeatureId = state.sovereigntyByFeatureId || {},
  controllersByFeatureId = state.scenarioControllersByFeatureId || {},
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
  state.scenarioOwnerControllerDiffCount = state.activeScenarioId
    ? countOwnerControllerSplit({
      ownersByFeatureId: state.sovereigntyByFeatureId,
      controllersByFeatureId: state.scenarioControllersByFeatureId,
    })
    : 0;
  return state.scenarioOwnerControllerDiffCount;
}
