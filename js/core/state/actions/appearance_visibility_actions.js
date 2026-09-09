import { getAppearancePresetLayerVisibilityFields } from "../appearance_preset_state.js";
import { commitUiVisibilityState } from "./ui_visibility_actions.js";

export const APPEARANCE_VISIBILITY_KEYS = Object.freeze([
  ...new Set([
    ...getAppearancePresetLayerVisibilityFields(),
    "showBlankFeatureLabels",
    "parentBordersVisible",
  ]),
]);
function assertTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) throw new TypeError("[appearance_visibility_actions] target must be an object");
}
function assertKey(key) { if (!APPEARANCE_VISIBILITY_KEYS.includes(key)) throw new RangeError(`[appearance_visibility_actions] unknown key: ${key}`); }
export function setAppearanceVisibilityState(target, key, value) {
  assertTarget(target);
  let admitted = false;
  for (const candidate of APPEARANCE_VISIBILITY_KEYS) {
    if (candidate === key) admitted = true;
  }
  if (!admitted) throw new RangeError(`[appearance_visibility_actions] unknown key: ${key}`);
  const next = key === "strategicChoroplethMetric"
    ? String(value || "")
    : Boolean(value);
  switch (key) {
    case "showWaterRegions": commitUiVisibilityState(target, { showWaterRegions: next }); break;
    case "showOpenOceanRegions": commitUiVisibilityState(target, { showOpenOceanRegions: next }); break;
    case "allowOpenOceanSelect": commitUiVisibilityState(target, { allowOpenOceanSelect: next }); break;
    case "allowOpenOceanPaint": commitUiVisibilityState(target, { allowOpenOceanPaint: next }); break;
    case "showScenarioSpecialRegions": commitUiVisibilityState(target, { showScenarioSpecialRegions: next }); break;
    case "showScenarioAtlantropa": commitUiVisibilityState(target, { showScenarioAtlantropa: next }); break;
    case "showScenarioReliefOverlays": commitUiVisibilityState(target, { showScenarioReliefOverlays: next }); break;
    case "showCityPoints": commitUiVisibilityState(target, { showCityPoints: next }); break;
    case "showStrategicResourceMarkers": commitUiVisibilityState(target, { showStrategicResourceMarkers: next }); break;
    case "strategicChoroplethMetric": commitUiVisibilityState(target, { strategicChoroplethMetric: next }, { normalize: false }); break;
    case "showUrban": commitUiVisibilityState(target, { showUrban: next }); break;
    case "showPhysical": commitUiVisibilityState(target, { showPhysical: next }); break;
    case "showRivers": commitUiVisibilityState(target, { showRivers: next }); break;
    case "showTransport": commitUiVisibilityState(target, { showTransport: next }); break;
    case "showSpecialZones": commitUiVisibilityState(target, { showSpecialZones: next }); break;
    case "showRoad": commitUiVisibilityState(target, { showRoad: next }); break;
    case "showRail": commitUiVisibilityState(target, { showRail: next }); break;
    case "showAirports": commitUiVisibilityState(target, { showAirports: next }); break;
    case "showPorts": commitUiVisibilityState(target, { showPorts: next }); break;
    case "showBlankFeatureLabels": commitUiVisibilityState(target, { showBlankFeatureLabels: next }); break;
    case "parentBordersVisible": target.parentBordersVisible = next; break;
  }
  return next;
}

export function setAppearanceVisibilitySnapshotState(target, key, value) {
  assertTarget(target);
  if (key !== "parentBordersVisible") {
    throw new RangeError(`[appearance_visibility_actions] unknown snapshot key: ${key}`);
  }
  target.parentBordersVisible = value;
  return value;
}
export function patchAppearanceVisibilityState(target, patch) {
  assertTarget(target); if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("[appearance_visibility_actions] patch must be an object");
  const entries = Object.entries(patch);
  entries.forEach(([key]) => assertKey(key));
  for (const [key, value] of entries) setAppearanceVisibilityState(target, key, value);
  return true;
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "parentBordersVisible")) target.parentBordersVisible = patch.parentBordersVisible;
}
