// Canonical writes for editor input state that map clicks change: the inspector
// selection and the recent-colors strip. Callers announce the change through
// state/changes.js; panels are not called from here.

const MAX_RECENT_COLORS = 4;

export function clearInspectorSelectionState(target) {
  const hadSelection = Boolean(target.selectedInspectorCountryCode);
  selectInspectorCountryState(target, "");
  return hadSelection;
}

export function selectInspectorCountryState(target, countryCode) {
  target.inspectorSelectionLevel = countryCode ? "country" : "";
  target.inspectorSelectionGroupId = "";
  target.inspectorSelectionFeatureId = "";
  target.selectedInspectorCountryCode = countryCode;
  target.inspectorHighlightCountryCode = countryCode;
  target.inspectorHighlightFeatureIds = [];
  target.inspectorHighlightGroupMode = false;
  target.inspectorHighlightLabel = "";
  target.inspectorOverlayDirty = true;
}

// Returns false when the color is already the most recent one.
export function pushRecentColorState(target, color) {
  const recent = Array.isArray(target.recentColors) ? target.recentColors : [];
  if (!color || recent[0] === color) return false;
  target.recentColors = [color, ...recent.filter((value) => value !== color)].slice(0, MAX_RECENT_COLORS);
  return true;
}

export function selectInspectorGroupState(target, countryCode, group) {
  selectInspectorCountryState(target, countryCode);
  target.inspectorSelectionLevel = "group";
  target.inspectorSelectionGroupId = group.id;
}

export function selectInspectorFeatureState(target, countryCode, featureId, group = null) {
  selectInspectorCountryState(target, countryCode);
  target.inspectorSelectionLevel = "feature";
  target.inspectorSelectionGroupId = group?.id || "";
  target.inspectorSelectionFeatureId = featureId;
}
