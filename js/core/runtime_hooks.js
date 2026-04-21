function createDefaultUiRuntimeHooks() {
  return {
    updateRecentUI: null,
    updateHistoryUIFn: null,
    updateLegendUI: null,
    updateSwatchUIFn: null,
    updatePaletteSourceUIFn: null,
    updatePaletteLibraryUIFn: null,
    updateScenarioUIFn: null,
    renderPaletteFn: null,
    updateToolUIFn: null,
    updateToolbarInputsFn: null,
    updatePaintModeUIFn: null,
    updateActiveSovereignUIFn: null,
    updateDynamicBorderStatusUIFn: null,
    updateZoomUIFn: null,
    updateTextureUIFn: null,
    updateWaterInteractionUIFn: null,
    updateTransportAppearanceUIFn: null,
    updateFacilityInfoCardUiFn: null,
    syncFacilityInfoCardVisibilityFn: null,
    updateScenarioSpecialRegionUIFn: null,
    updateScenarioReliefOverlayUIFn: null,
    updateParentBorderCountryListFn: null,
    updateSpecialZoneEditorUIFn: null,
    updateStrategicOverlayUIFn: null,
    updateScenarioContextBarFn: null,
    updateWorkspaceStatusFn: null,
    updateDockCollapsedUiFn: null,
    triggerScenarioGuideFn: null,
    syncDeveloperModeUiFn: null,
  };
}

function createDefaultCommandRuntimeHooks() {
  return {
    toggleLeftPanelFn: null,
    toggleRightPanelFn: null,
    toggleDockFn: null,
    toggleDeveloperModeFn: null,
    setDevWorkspaceExpandedFn: null,
    openTransportWorkbenchFn: null,
    closeTransportWorkbenchFn: null,
    refreshTransportWorkbenchUiFn: null,
    openExportWorkbenchFn: null,
    closeExportWorkbenchFn: null,
    openScenarioVisualAdjustmentsFn: null,
    closeDockPopoverFn: null,
    restoreSupportSurfaceFromUrlFn: null,
    showOnboardingHintFn: null,
    dismissOnboardingHintFn: null,
    commitZoomInputValueFn: null,
    runZoomStepFn: null,
    runZoomResetFn: null,
    runToolSelectionFn: null,
    runBrushModeToggleFn: null,
    runHistoryActionFn: null,
    persistViewSettingsFn: null,
  };
}

function createDefaultDataRuntimeHooks() {
  return {
    setStartupReadonlyStateFn: null,
    ensureFullLocalizationDataReadyFn: null,
    getViewportGeoBoundsFn: null,
    scheduleScenarioChunkRefreshFn: null,
    ensureBaseCityDataFn: null,
    ensureContextLayerDataFn: null,
    ensureDetailTopologyFn: null,
  };
}

function createDefaultRenderRuntimeHooks() {
  return {
    renderCountryListFn: null,
    refreshCountryListRowsFn: null,
    refreshCountryInspectorDetailFn: null,
    renderWaterRegionListFn: null,
    renderSpecialRegionListFn: null,
    renderPresetTreeFn: null,
    renderScenarioAuditPanelFn: null,
    updateDevWorkspaceUIFn: null,
    refreshColorStateFn: null,
    recomputeDynamicBordersNowFn: null,
    getStrategicOverlayPerfCountersFn: null,
    renderNowFn: null,
    showToastFn: null,
  };
}

export function createDefaultRuntimeHooks() {
  return {
    ...createDefaultUiRuntimeHooks(),
    ...createDefaultCommandRuntimeHooks(),
    ...createDefaultDataRuntimeHooks(),
    ...createDefaultRenderRuntimeHooks(),
  };
}

function normalizeRuntimeHook(hook) {
  return typeof hook === "function" ? hook : null;
}

function readRuntimeHook(target, hookName) {
  if (!target || !hookName) return null;
  return normalizeRuntimeHook(target[hookName]);
}

function registerRuntimeHook(target, hookName, hook) {
  if (!target || !hookName) return null;
  const normalizedHook = normalizeRuntimeHook(hook);
  target[hookName] = normalizedHook;
  return normalizedHook;
}

function callRuntimeHook(target, hookName, ...args) {
  const hook = readRuntimeHook(target, hookName);
  if (!hook) return undefined;
  return hook(...args);
}

function callRuntimeHooks(target, hookNames, ...args) {
  const normalizedNames = Array.isArray(hookNames) ? hookNames : [];
  return normalizedNames.map((hookName) => callRuntimeHook(target, hookName, ...args));
}

export {
  callRuntimeHook,
  callRuntimeHooks,
  readRuntimeHook,
  registerRuntimeHook,
};
