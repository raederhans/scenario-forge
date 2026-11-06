// Canonical writes for editor input state that map clicks change: the inspector
// selection and the recent-colors strip. Callers announce the change through
// state/changes.js; panels are not called from here.

const MAX_RECENT_COLORS = 4;

export function selectInspectorCountryState(target, countryCode) {
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
