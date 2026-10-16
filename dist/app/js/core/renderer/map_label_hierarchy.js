const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function getMapLabelHierarchy(k, state = {}) {
  const numericScale = Number(k);
  const scale = Number.isFinite(numericScale) ? Math.max(0, numericScale) : 1;
  const countryLabelsEnabled = state.styleConfig?.countryLabels?.enabled !== false;
  const cityStyle = state.styleConfig?.cityPoints || {};
  const numericOpacity = Number(cityStyle.opacity ?? 1);
  const cityTextEnabled = !!state.showCityPoints && cityStyle.showLabels !== false
    && (!Number.isFinite(numericOpacity) || numericOpacity > 0);
  const cityProgress = clamp((scale - 1.8) / (4 - 1.8), 0, 1);
  const countryProgress = clamp((scale - 2.5) / (6 - 2.5), 0, 1);
  return {
    cityOpacity: cityTextEnabled ? (countryLabelsEnabled ? cityProgress : 1) : 0,
    capitalOpacity: cityTextEnabled ? (countryLabelsEnabled ? 0.5 + cityProgress * 0.5 : 1) : 0,
    countryOpacity: cityTextEnabled ? 1 - countryProgress : 1,
    preferCountries: countryLabelsEnabled && scale <= 3,
  };
}

export function getCountryLabelOpacity(hierarchy, screenTerritoryArea, viewportArea) {
  // Use the full largest contiguous component, not its visible intersection:
  // panning across a large nation must not bring its overview title back.
  // Below 2% of the map area retain identity; at 10% hand over fully to cities.
  const footprint = viewportArea > 0 ? screenTerritoryArea / viewportArea : 0;
  const localDetail = clamp((footprint - 0.02) / 0.08, 0, 1);
  return 1 - (1 - hierarchy.countryOpacity) * localDetail;
}
