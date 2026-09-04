// Canonical UI visibility mutations. Missing patch properties retain their current state.

const BOOLEAN_VISIBILITY_FIELDS = Object.freeze([
  "showWaterRegions",
  "showOpenOceanRegions",
  "allowOpenOceanSelect",
  "allowOpenOceanPaint",
  "showScenarioSpecialRegions",
  "showScenarioAtlantropa",
  "showScenarioReliefOverlays",
  "showCityPoints",
  "showBlankFeatureLabels",
  "showStrategicResourceMarkers",
  "showUrban",
  "showPhysical",
  "showRivers",
  "showTransport",
  "showAirports",
  "showPorts",
  "showRail",
  "showRoad",
  "showSpecialZones",
]);

function isStateTarget(target) {
  return !!target && typeof target === "object" && !Array.isArray(target);
}

export function captureUiVisibilityState(target) {
  if (!isStateTarget(target)) return {};
  const snapshot = {};
  BOOLEAN_VISIBILITY_FIELDS.forEach((field) => {
    if (Object.hasOwn(target, field)) snapshot[field] = !!target[field];
  });
  if (Object.hasOwn(target, "strategicChoroplethMetric")) {
    snapshot.strategicChoroplethMetric = String(
      target.strategicChoroplethMetric || "",
    ).trim();
  }
  return snapshot;
}

export function commitUiVisibilityState(target, patch = {}) {
  if (!isStateTarget(target) || !isStateTarget(patch)) return null;
  BOOLEAN_VISIBILITY_FIELDS.forEach((field) => {
    if (Object.hasOwn(patch, field)) target[field] = !!patch[field];
  });
  if (Object.hasOwn(patch, "strategicChoroplethMetric")) {
    target.strategicChoroplethMetric = String(patch.strategicChoroplethMetric || "").trim();
  }
  return captureUiVisibilityState(target);
}

export function restoreUiVisibilityState(target, snapshot = {}) {
  return commitUiVisibilityState(target, snapshot);
}

export function restoreImportedLayerVisibilityState(target, layerVisibility = null) {
  if (!isStateTarget(layerVisibility)) return null;
  return commitUiVisibilityState(target, layerVisibility);
}
