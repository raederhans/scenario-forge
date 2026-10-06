// Visibility, not data readiness, controls membership. A loading enabled layer
// must still participate in complete-frame preparation and coverage checks.
export function filterEnabledRenderPassNames(passNames, {
  showPhysical = false,
  physicalMode = "",
  showUrban = false,
  showRivers = false,
  showTransport = false,
  showStrategicResourceMarkers = false,
  showCityPoints = false,
  textureMode = "none",
  dayNightEnabled = false,
  populationHeatmapEnabled = false,
} = {}) {
  const enabled = {
    populationHeatmap: populationHeatmapEnabled,
    physicalBase: showPhysical && physicalMode !== "contours_only",
    contextBase: showPhysical || showUrban || showRivers,
    contextMarkers: showTransport || showStrategicResourceMarkers || showCityPoints,
    effects: textureMode === "paper",
    lineEffects: textureMode === "graticule" || textureMode === "draft_grid",
    textureLabels: textureMode === "graticule",
    dayNight: dayNightEnabled,
  };
  return passNames.filter((name) => !(name in enabled) || !!enabled[name]);
}
