// This action owns only project fields without a pre-existing domain owner.
// Cross-domain coordination lives in the import workflow.
export function captureProjectImportState(target) {
  return {
    activeSovereignCode: target.activeSovereignCode,
    allowOpenOceanPaint: target.allowOpenOceanPaint,
    allowOpenOceanSelect: target.allowOpenOceanSelect,
    annotationView: target.annotationView,
    appearancePresets: target.appearancePresets,
    batchFillScope: target.batchFillScope,
    countryBaseColors: target.countryBaseColors,
    customPresets: target.customPresets,
    devClipboardFallbackText: target.devClipboardFallbackText,
    devClipboardPreviewFormat: target.devClipboardPreviewFormat,
    devHoverHit: target.devHoverHit,
    devSelectedHit: target.devSelectedHit,
    devSelectionFeatureIds: target.devSelectionFeatureIds,
    devSelectionOrder: target.devSelectionOrder,
    dynamicBordersDirty: target.dynamicBordersDirty,
    dynamicBordersDirtyReason: target.dynamicBordersDirtyReason,
    expandedInspectorContinents: target.expandedInspectorContinents,
    expandedInspectorReleaseParents: target.expandedInspectorReleaseParents,
    exportWorkbenchUi: target.exportWorkbenchUi,
    featureOverrides: target.featureOverrides,
    inspectorExpansionInitialized: target.inspectorExpansionInitialized,
    inspectorHighlightCountryCode: target.inspectorHighlightCountryCode,
    intensityFields: target.intensityFields,
    interactionGranularity: target.interactionGranularity,
    manualSpecialZones: target.manualSpecialZones,
    mapSemanticMode: target.mapSemanticMode,
    operationGraphics: target.operationGraphics,
    operationGraphicsDirty: target.operationGraphicsDirty,
    operationGraphicsEditor: target.operationGraphicsEditor,
    operationalLineEditor: target.operationalLineEditor,
    operationalLines: target.operationalLines,
    operationalLinesDirty: target.operationalLinesDirty,
    paintMode: target.paintMode,
    parentBorderEnabledByCountry: target.parentBorderEnabledByCountry,
    parentBordersVisible: target.parentBordersVisible,
    recentColors: target.recentColors,
    referenceImageState: target.referenceImageState,
    releasableBoundaryVariantByTag: target.releasableBoundaryVariantByTag,
    scenarioCountriesByTag: target.scenarioCountriesByTag,
    scenarioReleasableIndex: target.scenarioReleasableIndex,
    selectedInspectorCountryCode: target.selectedInspectorCountryCode,
    showAirports: target.showAirports,
    showBlankFeatureLabels: target.showBlankFeatureLabels,
    showCityPoints: target.showCityPoints,
    showOpenOceanRegions: target.showOpenOceanRegions,
    showPhysical: target.showPhysical,
    showPorts: target.showPorts,
    showRail: target.showRail,
    showRivers: target.showRivers,
    showRoad: target.showRoad,
    showScenarioAtlantropa: target.showScenarioAtlantropa,
    showScenarioReliefOverlays: target.showScenarioReliefOverlays,
    showScenarioSpecialRegions: target.showScenarioSpecialRegions,
    showSpecialZones: target.showSpecialZones,
    showStrategicResourceMarkers: target.showStrategicResourceMarkers,
    showTransport: target.showTransport,
    showUrban: target.showUrban,
    showWaterRegions: target.showWaterRegions,
    sovereignBaseColors: target.sovereignBaseColors,
    sovereigntyByFeatureId: target.sovereigntyByFeatureId,
    sovereigntyInitialized: target.sovereigntyInitialized,
    specialRegionOverrides: target.specialRegionOverrides,
    specialZoneEditor: target.specialZoneEditor,
    specialZoneLayers: target.specialZoneLayers,
    specialZoneMembershipBrushMode: target.specialZoneMembershipBrushMode,
    specialZones: target.specialZones,
    strategicChoroplethMetric: target.strategicChoroplethMetric,
    strategicOverlayUi: target.strategicOverlayUi,
    styleConfig: target.styleConfig,
    transportWorkbenchPointDeltas: target.transportWorkbenchPointDeltas,
    transportWorkbenchUi: target.transportWorkbenchUi,
    unitCounterEditor: target.unitCounterEditor,
    unitCounters: target.unitCounters,
    unitCountersDirty: target.unitCountersDirty,
    visualOverrides: target.visualOverrides,
    waterRegionOverrides: target.waterRegionOverrides,
  };
}

export function applyProjectImportPatch(target, patch) {
  if (Object.hasOwn(patch, "annotationView")) target.annotationView = patch.annotationView;
  if (Object.hasOwn(patch, "customPresets")) target.customPresets = patch.customPresets;
  if (Object.hasOwn(patch, "devClipboardFallbackText")) target.devClipboardFallbackText = patch.devClipboardFallbackText;
  if (Object.hasOwn(patch, "devClipboardPreviewFormat")) target.devClipboardPreviewFormat = patch.devClipboardPreviewFormat;
  if (Object.hasOwn(patch, "devHoverHit")) target.devHoverHit = patch.devHoverHit;
  if (Object.hasOwn(patch, "devSelectedHit")) target.devSelectedHit = patch.devSelectedHit;
  if (Object.hasOwn(patch, "devSelectionFeatureIds")) target.devSelectionFeatureIds = patch.devSelectionFeatureIds;
  if (Object.hasOwn(patch, "devSelectionOrder")) target.devSelectionOrder = patch.devSelectionOrder;
  if (Object.hasOwn(patch, "recentColors")) target.recentColors = patch.recentColors;
  if (Object.hasOwn(patch, "releasableBoundaryVariantByTag")) target.releasableBoundaryVariantByTag = patch.releasableBoundaryVariantByTag;
  if (Object.hasOwn(patch, "specialRegionOverrides")) target.specialRegionOverrides = patch.specialRegionOverrides;
  if (Object.hasOwn(patch, "specialZones")) target.specialZones = patch.specialZones;
  if (Object.hasOwn(patch, "transportWorkbenchPointDeltas")) target.transportWorkbenchPointDeltas = patch.transportWorkbenchPointDeltas;
}
