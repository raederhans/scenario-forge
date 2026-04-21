// Stable app/UI facade for map_renderer.
// Internal bridge and core helper imports stay on ../map_renderer.js this round.
export {
  // App bootstrap and render lifecycle.
  buildInteractionInfrastructureAfterStartup,
  initMap,
  render,
  setMapData,

  // Selection and fill tools.
  addFeatureToDevSelection,
  applyDevMacroFillCurrentCountry,
  applyDevMacroFillCurrentOwnerScope,
  applyDevMacroFillCurrentParentGroup,
  applyDevSelectionFill,
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
  invalidateContextLayerVisualStateBatch,
  invalidateOceanBackgroundVisualState,
  invalidateOceanCoastalAccentVisualState,
  invalidateOceanVisualState,
  invalidateOceanWaterInteractionVisualState,
  recomputeDynamicBordersNow,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  scheduleDynamicBorderRecompute,

  // Render products and diagnostics.
  getBathymetryPresetStyleDefaults,
  getEffectiveCityCollection,
  getWaterRegionColor,
  rebuildStaticMeshes,
  renderExportPassesToCanvas,
  renderLegend,
  RENDER_PASS_NAMES,

  // Viewport.
  getZoomPercent,
  resetZoomToFit,
  setDebugMode,
  setZoomPercent,
  zoomByStep,
} from "../map_renderer.js";
