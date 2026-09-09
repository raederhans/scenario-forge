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

export function commitUiVisibilityState(
  target,
  patch = {},
  { normalize = true } = {},
) {
  if (!isStateTarget(target) || !isStateTarget(patch)) return null;
  if (Object.hasOwn(patch, "showWaterRegions")) target.showWaterRegions = normalize ? !!patch.showWaterRegions : patch.showWaterRegions;
  if (Object.hasOwn(patch, "showOpenOceanRegions")) target.showOpenOceanRegions = normalize ? !!patch.showOpenOceanRegions : patch.showOpenOceanRegions;
  if (Object.hasOwn(patch, "allowOpenOceanSelect")) target.allowOpenOceanSelect = normalize ? !!patch.allowOpenOceanSelect : patch.allowOpenOceanSelect;
  if (Object.hasOwn(patch, "allowOpenOceanPaint")) target.allowOpenOceanPaint = normalize ? !!patch.allowOpenOceanPaint : patch.allowOpenOceanPaint;
  if (Object.hasOwn(patch, "showScenarioSpecialRegions")) target.showScenarioSpecialRegions = normalize ? !!patch.showScenarioSpecialRegions : patch.showScenarioSpecialRegions;
  if (Object.hasOwn(patch, "showScenarioAtlantropa")) target.showScenarioAtlantropa = normalize ? !!patch.showScenarioAtlantropa : patch.showScenarioAtlantropa;
  if (Object.hasOwn(patch, "showScenarioReliefOverlays")) target.showScenarioReliefOverlays = normalize ? !!patch.showScenarioReliefOverlays : patch.showScenarioReliefOverlays;
  if (Object.hasOwn(patch, "showCityPoints")) target.showCityPoints = normalize ? !!patch.showCityPoints : patch.showCityPoints;
  if (Object.hasOwn(patch, "showBlankFeatureLabels")) target.showBlankFeatureLabels = normalize ? !!patch.showBlankFeatureLabels : patch.showBlankFeatureLabels;
  if (Object.hasOwn(patch, "showStrategicResourceMarkers")) target.showStrategicResourceMarkers = normalize ? !!patch.showStrategicResourceMarkers : patch.showStrategicResourceMarkers;
  if (Object.hasOwn(patch, "showUrban")) target.showUrban = normalize ? !!patch.showUrban : patch.showUrban;
  if (Object.hasOwn(patch, "showPhysical")) target.showPhysical = normalize ? !!patch.showPhysical : patch.showPhysical;
  if (Object.hasOwn(patch, "showRivers")) target.showRivers = normalize ? !!patch.showRivers : patch.showRivers;
  if (Object.hasOwn(patch, "showTransport")) target.showTransport = normalize ? !!patch.showTransport : patch.showTransport;
  if (Object.hasOwn(patch, "showAirports")) target.showAirports = normalize ? !!patch.showAirports : patch.showAirports;
  if (Object.hasOwn(patch, "showPorts")) target.showPorts = normalize ? !!patch.showPorts : patch.showPorts;
  if (Object.hasOwn(patch, "showRail")) target.showRail = normalize ? !!patch.showRail : patch.showRail;
  if (Object.hasOwn(patch, "showRoad")) target.showRoad = normalize ? !!patch.showRoad : patch.showRoad;
  if (Object.hasOwn(patch, "showSpecialZones")) target.showSpecialZones = normalize ? !!patch.showSpecialZones : patch.showSpecialZones;
  if (Object.hasOwn(patch, "strategicChoroplethMetric")) {
    target.strategicChoroplethMetric = normalize
      ? String(patch.strategicChoroplethMetric || "").trim()
      : patch.strategicChoroplethMetric;
  }
  return captureUiVisibilityState(target);
}

export function restoreUiVisibilityState(target, snapshot = {}) {
  if (!isStateTarget(target) || !isStateTarget(snapshot)) return null;
  const detachedSnapshot = { ...snapshot };
  return commitUiVisibilityState(target, detachedSnapshot);
}

export function restoreImportedLayerVisibilityState(target, layerVisibility = null) {
  if (!isStateTarget(target) || !isStateTarget(layerVisibility)) return null;
  const detachedVisibility = { ...layerVisibility };
  return commitUiVisibilityState(target, detachedVisibility);
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "allowOpenOceanPaint")) target.allowOpenOceanPaint = patch.allowOpenOceanPaint;
  if (Object.hasOwn(patch, "allowOpenOceanSelect")) target.allowOpenOceanSelect = patch.allowOpenOceanSelect;
  if (Object.hasOwn(patch, "showAirports")) target.showAirports = patch.showAirports;
  if (Object.hasOwn(patch, "showBlankFeatureLabels")) target.showBlankFeatureLabels = patch.showBlankFeatureLabels;
  if (Object.hasOwn(patch, "showCityPoints")) target.showCityPoints = patch.showCityPoints;
  if (Object.hasOwn(patch, "showOpenOceanRegions")) target.showOpenOceanRegions = patch.showOpenOceanRegions;
  if (Object.hasOwn(patch, "showPhysical")) target.showPhysical = patch.showPhysical;
  if (Object.hasOwn(patch, "showPorts")) target.showPorts = patch.showPorts;
  if (Object.hasOwn(patch, "showRail")) target.showRail = patch.showRail;
  if (Object.hasOwn(patch, "showRivers")) target.showRivers = patch.showRivers;
  if (Object.hasOwn(patch, "showRoad")) target.showRoad = patch.showRoad;
  if (Object.hasOwn(patch, "showScenarioAtlantropa")) target.showScenarioAtlantropa = patch.showScenarioAtlantropa;
  if (Object.hasOwn(patch, "showScenarioReliefOverlays")) target.showScenarioReliefOverlays = patch.showScenarioReliefOverlays;
  if (Object.hasOwn(patch, "showScenarioSpecialRegions")) target.showScenarioSpecialRegions = patch.showScenarioSpecialRegions;
  if (Object.hasOwn(patch, "showSpecialZones")) target.showSpecialZones = patch.showSpecialZones;
  if (Object.hasOwn(patch, "showStrategicResourceMarkers")) target.showStrategicResourceMarkers = patch.showStrategicResourceMarkers;
  if (Object.hasOwn(patch, "showTransport")) target.showTransport = patch.showTransport;
  if (Object.hasOwn(patch, "showUrban")) target.showUrban = patch.showUrban;
  if (Object.hasOwn(patch, "showWaterRegions")) target.showWaterRegions = patch.showWaterRegions;
  if (Object.hasOwn(patch, "strategicChoroplethMetric")) target.strategicChoroplethMetric = patch.strategicChoroplethMetric;
}
