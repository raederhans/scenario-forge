export { drawMapTitles, hasMapTitles } from "../renderer/map_title_render_owner.js";
export { drawThematicWgiExportLegend } from "../renderer/thematic_wgi_export_legend.js";
export { drawPopulationExportLegend } from "../renderer/population_export_legend.js";
export { drawPoliticalExportLegend, getPoliticalExportLegend } from "../renderer/political_export_legend.js";
// Stable app/UI facade for map_renderer.
// Internal bridge and core helper imports stay on ../map_renderer.js this round.
export {
  // App bootstrap and render lifecycle.
  buildInteractionInfrastructureAfterStartup,
  initMap,
  getPoliticalIdRasterDiagnostics,
  getVisibleMapLabels,
  getCountryLabelStatus,
  convertCountryLabelToMapLabel,
  freezeVisibleCountryLabels,
  applyMapLabelStyleToPreset,
  getPlacedMapLabels,
  getCountryLabelReadiness,
  setPoliticalIdRasterTrialEnabled,
  setPoliticalRenderMode,
  getPopulationHeatmapRenderReadiness,
  assertPopulationHeatmapReadyForExport,
  ensurePopulationHeatmapReadyForExport,
  render,
  setMapData,

  // Selection and fill tools.
  addFeatureToDevSelection,
  applyDevMacroFillCurrentCountry,
  applyDevMacroFillCurrentOwnerScope,
  applyDevMacroFillCurrentParentGroup,
  applyDevSelectionFill,
  fillSelectedParcels,
  autoFillMap,
  clearDevSelection,
  removeLastDevSelection,
  toggleFeatureInDevSelection,

  // Strategic overlay editing.
  cancelActiveStrategicInteractionModes,
  cancelOperationGraphicDraw,
  cancelOperationalLineDraw,
  cancelSpecialZoneDraw,
  cancelUnitCounterPlacement,
  deleteSelectedManualSpecialZone,
  deleteSelectedOperationGraphic,
  deleteSelectedOperationGraphicVertex,
  deleteSelectedOperationalLine,
  addScenarioDefenseLinePresets,
  deleteSelectedUnitCounter,
  finishOperationGraphicDraw,
  finishOperationalLineDraw,
  finishSpecialZoneDraw,
  selectOperationGraphicById,
  selectOperationalLineById,
  selectSpecialZoneById,
  selectUnitCounterById,
  startOperationGraphicDraw,
  startOperationalLineDraw,
  startSpecialZoneDraw,
  startUnitCounterPlacement,
  undoOperationGraphicVertex,
  undoOperationalLineVertex,
  undoSpecialZoneVertex,
  updateSelectedOperationGraphic,
  updateSelectedOperationalLine,
  updateSelectedUnitCounter,

  // Render invalidation and scenario/color refresh.
  invalidateAllRenderPasses,
  invalidateContextLayerVisualStateBatch,
  invalidateOceanBackgroundVisualState,
  invalidateOceanCoastalAccentVisualState,
  invalidateOceanVisualState,
  invalidateOceanWaterInteractionVisualState,
  recomputeDynamicBordersNow,
  reconcileDetailPromotionPoliticalPass,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  scheduleDynamicBorderRecompute,
  setInspectorFeatureHighlight,

  // Render products and diagnostics.
  getBathymetryPresetStyleDefaults,
  getEffectiveCityCollection,
  getWaterRegionColor,
  rebuildStaticMeshes,
  isExportRenderOverBudget,
  getOceanBaseFillColor,
  renderExportPassesToCanvas,
  ensurePaintContoursReady,
  ensureBathymetryReadyForExport,
  ensureCountryLabelsReadyForExport,
  renderLegend,
  RENDER_PASS_NAMES,

  // Queries used by the sidebar.
  getCachedEffectiveCityCollection,
  selectLandFeatureById,

  // Viewport.
  focusWaterRegionById,
  focusGeoBounds,
  focusRiverPaintParentById,
  applyRiverPaintCellById,
  getZoomPercent,
  panMapByPixels,
  resetZoomToFit,
  setDebugMode,
  setZoomPercent,
  zoomByStep,
} from "../map_renderer.js";
export { commitMapLabelMove, deleteMapLabel, placeMapLabel, updateMapLabel } from "../renderer/strategic_overlay_runtime/map_label_runtime_domain.js";
export { syncMapLabelHandles } from "../renderer/map_label_handles_owner.js";
