import {
  createDefaultScenarioDataHealth,
  createDefaultScenarioHydrationHealthGate,
} from "../state/scenario_runtime_state.js";

function createScenarioLifecycleRuntime({
  state,
  countryNames,
  defaultCountryPalette,
  createDefaultScenarioReleasableIndex,
  ensureSovereigntyState,
  getScenarioDefaultCountryCode,
  getScenarioMapSemanticMode,
  markDirty,
  markLegacyColorStateDirty,
  normalizeScenarioId,
  recalculateScenarioOwnerControllerDiffCount,
  releaseScenarioAuditPayload,
  resetScenarioChunkRuntimeState,
  restoreScenarioDisplaySettingsAfterExit,
  restoreScenarioOceanFillAfterExit,
  runPostScenarioClearEffects,
  runPostScenarioResetEffects,
  scenarioDetailMinRatioStrict,
  setScenarioAuditUiState,
  syncResolvedDefaultCountryPalette,
  applyBlankScenarioPresentationDefaults,
} = {}) {
  function syncScenarioInspectorSelection(countryCode = "") {
    const normalized = String(countryCode || "").trim().toUpperCase();
    state.selectedInspectorCountryCode = normalized;
    state.inspectorHighlightCountryCode = normalized;
    state.inspectorExpansionInitialized = false;
    if (state.expandedInspectorContinents instanceof Set) {
      state.expandedInspectorContinents.clear();
    }
    if (state.expandedInspectorReleaseParents instanceof Set) {
      state.expandedInspectorReleaseParents.clear();
    }
  }

  function disableScenarioParentBorders() {
    if (!state.activeScenarioId && state.scenarioParentBorderEnabledBeforeActivate === null) {
      state.scenarioParentBorderEnabledBeforeActivate = {
        ...(state.parentBorderEnabledByCountry || {}),
      };
    }
    const next = {};
    Object.keys(state.parentBorderEnabledByCountry || {}).forEach((countryCode) => {
      next[countryCode] = false;
    });
    state.parentBorderEnabledByCountry = next;
    if (typeof state.updateParentBorderCountryListFn === "function") {
      state.updateParentBorderCountryListFn();
    }
  }

  function restoreParentBordersAfterScenario() {
    if (state.scenarioParentBorderEnabledBeforeActivate && typeof state.scenarioParentBorderEnabledBeforeActivate === "object") {
      state.parentBorderEnabledByCountry = {
        ...state.scenarioParentBorderEnabledBeforeActivate,
      };
    }
    state.scenarioParentBorderEnabledBeforeActivate = null;
    if (typeof state.updateParentBorderCountryListFn === "function") {
      state.updateParentBorderCountryListFn();
    }
  }

  function applyScenarioPaintMode() {
    if (!state.scenarioPaintModeBeforeActivate) {
      state.scenarioPaintModeBeforeActivate = {
        paintMode: String(state.paintMode || "visual") === "sovereignty" ? "sovereignty" : "visual",
        interactionGranularity: String(state.interactionGranularity || "subdivision") === "country"
          ? "country"
          : "subdivision",
        batchFillScope: String(state.batchFillScope || "parent") === "country" ? "country" : "parent",
        politicalEditingExpanded: !!state.ui?.politicalEditingExpanded,
      };
    }
    state.paintMode = "sovereignty";
    state.interactionGranularity = "subdivision";
    if (state.ui && typeof state.ui === "object") {
      state.ui.politicalEditingExpanded = false;
      state.ui.scenarioVisualAdjustmentsOpen = false;
    }
    if (typeof state.updatePaintModeUIFn === "function") {
      state.updatePaintModeUIFn();
    }
  }

  function restorePaintModeAfterScenario() {
    const previous = state.scenarioPaintModeBeforeActivate;
    if (previous && typeof previous === "object") {
      state.paintMode = previous.paintMode === "sovereignty" ? "sovereignty" : "visual";
      state.interactionGranularity = previous.interactionGranularity === "country"
        ? "country"
        : "subdivision";
      state.batchFillScope = previous.batchFillScope === "country" ? "country" : "parent";
      if (state.ui && typeof state.ui === "object") {
        state.ui.politicalEditingExpanded = !!previous.politicalEditingExpanded;
        state.ui.scenarioVisualAdjustmentsOpen = false;
      }
    }
    state.scenarioPaintModeBeforeActivate = null;
    if (typeof state.updatePaintModeUIFn === "function") {
      state.updatePaintModeUIFn();
    }
  }

  function resetToScenarioBaseline(
    {
      renderNow = true,
      markDirtyReason = "scenario-reset",
      showToastOnComplete = false,
      showToast = null,
      t = null,
    } = {}
  ) {
    if (!state.activeScenarioId || !state.scenarioBaselineOwnersByFeatureId) {
      return false;
    }
    const previousSelectedInspectorCountryCode = String(state.selectedInspectorCountryCode || "").trim().toUpperCase();
    const previousExpandedInspectorContinents = state.expandedInspectorContinents instanceof Set
      ? new Set(state.expandedInspectorContinents)
      : new Set();
    const previousExpandedInspectorReleaseParents = state.expandedInspectorReleaseParents instanceof Set
      ? new Set(state.expandedInspectorReleaseParents)
      : new Set();
    const previousInspectorExpansionInitialized = !!state.inspectorExpansionInitialized;
    state.sovereigntyByFeatureId = { ...(state.scenarioBaselineOwnersByFeatureId || {}) };
    state.scenarioControllersByFeatureId = { ...(state.scenarioBaselineControllersByFeatureId || {}) };
    state.scenarioAutoShellOwnerByFeatureId = {};
    state.scenarioAutoShellControllerByFeatureId = {};
    state.mapSemanticMode = getScenarioMapSemanticMode(state.activeScenarioManifest, state.mapSemanticMode);
    if (state.mapSemanticMode === "blank") {
      applyBlankScenarioPresentationDefaults();
    }
    state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
    state.scenarioViewMode = "ownership";
    recalculateScenarioOwnerControllerDiffCount();
    state.sovereigntyInitialized = false;
    ensureSovereigntyState({ force: true });
    state.parentBordersVisible = false;
    state.visualOverrides = {};
    state.featureOverrides = {};
    state.sovereignBaseColors = { ...(state.scenarioFixedOwnerColors || {}) };
    state.countryBaseColors = { ...state.sovereignBaseColors };
    markLegacyColorStateDirty();
    state.activeSovereignCode = state.mapSemanticMode === "blank"
      ? ""
      : (
        getScenarioDefaultCountryCode(
          state.activeScenarioManifest,
          state.scenarioCountriesByTag
        ) || String(state.activeSovereignCode || "").trim().toUpperCase()
      );
    if (state.ui && typeof state.ui === "object") {
      state.ui.scenarioVisualAdjustmentsOpen = false;
    }
    const restoredInspectorCode =
      previousSelectedInspectorCountryCode && state.scenarioCountriesByTag?.[previousSelectedInspectorCountryCode]
        ? previousSelectedInspectorCountryCode
        : state.activeSovereignCode;
    state.selectedInspectorCountryCode = restoredInspectorCode;
    state.inspectorHighlightCountryCode = restoredInspectorCode;
    state.expandedInspectorContinents = previousExpandedInspectorContinents;
    state.expandedInspectorReleaseParents = previousExpandedInspectorReleaseParents;
    state.inspectorExpansionInitialized =
      previousInspectorExpansionInitialized || previousExpandedInspectorContinents.size > 0;
    setScenarioAuditUiState({
      loading: false,
      errorMessage: "",
    });
    state.scenarioBorderMode = "scenario_owner_only";
    disableScenarioParentBorders();
    runPostScenarioResetEffects({
      scenarioId: state.activeScenarioId,
      renderNow,
    });
    if (markDirtyReason) {
      markDirty(markDirtyReason);
    }
    if (showToastOnComplete && typeof showToast === "function" && typeof t === "function") {
      showToast(t("Scenario reset to baseline.", "ui"), {
        title: t("Scenario reset", "ui"),
        tone: "success",
      });
    }
    return true;
  }

  function clearActiveScenario(
    {
      renderNow = true,
      markDirtyReason = "scenario-clear",
      showToastOnComplete = false,
      showToast = null,
      t = null,
    } = {}
  ) {
    const previousScenarioId = normalizeScenarioId(state.activeScenarioId);
    const hasBaselineRuntimeTopology = !!state.defaultRuntimePoliticalTopology?.objects?.political;
    const hasBaselineDetailTopology = !!state.topologyDetail?.objects?.political;
    if (state.runtimeChunkLoadState?.refreshTimerId) {
      globalThis.clearTimeout(state.runtimeChunkLoadState.refreshTimerId);
    }
    releaseScenarioAuditPayload(previousScenarioId, { syncUi: false });
    state.activeScenarioId = "";
    state.scenarioBorderMode = "canonical";
    state.activeScenarioManifest = null;
    state.activeScenarioMeshPack = null;
    state.scenarioCountriesByTag = {};
    state.scenarioFixedOwnerColors = {};
    state.scenarioRuntimeTopologyData = null;
    state.scenarioRuntimeTopologyVersionTag = "";
    state.scenarioPoliticalChunkData = null;
    state.scenarioLandMaskData = null;
    state.scenarioContextLandMaskData = null;
    state.scenarioLandMaskVersionTag = "";
    state.scenarioContextLandMaskVersionTag = "";
    state.mapSemanticMode = "blank";
    state.runtimePoliticalTopology = state.defaultRuntimePoliticalTopology || null;
    // startup coarse mode can still carry defaultRuntimePoliticalTopology while detail promotion remains deferred
    state.topologyBundleMode = hasBaselineDetailTopology ? "composite" : "single";
    state.detailDeferred = hasBaselineRuntimeTopology && !hasBaselineDetailTopology;
    state.detailPromotionInFlight = false;
    state.detailPromotionCompleted = hasBaselineDetailTopology;
    resetScenarioChunkRuntimeState({ scenarioId: "" });
    state.scheduleScenarioChunkRefreshFn = null;
    state.scenarioWaterRegionsData = null;
    state.scenarioWaterOverlayVersionTag = "";
    state.scenarioSpecialRegionsData = null;
    state.scenarioReliefOverlaysData = null;
    state.scenarioDistrictGroupsData = null;
    state.scenarioDistrictGroupByFeatureId = new Map();
    state.scenarioReliefOverlayRevision = (Number(state.scenarioReliefOverlayRevision) || 0) + 1;
    applyBlankScenarioPresentationDefaults();
    state.scenarioReleasableIndex = createDefaultScenarioReleasableIndex();
    state.releasableCatalog = state.defaultReleasableCatalog || null;
    state.scenarioImportAudit = null;
    state.scenarioBaselineHash = "";
    state.scenarioBaselineOwnersByFeatureId = {};
    state.scenarioControllersByFeatureId = {};
    state.scenarioAutoShellOwnerByFeatureId = {};
    state.scenarioAutoShellControllerByFeatureId = {};
    state.scenarioBaselineControllersByFeatureId = {};
    state.scenarioBaselineCoresByFeatureId = {};
    state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
    state.scenarioOwnerControllerDiffCount = 0;
    state.scenarioHydrationHealthGate = createDefaultScenarioHydrationHealthGate();
    state.scenarioDataHealth = createDefaultScenarioDataHealth(scenarioDetailMinRatioStrict);
    state.scenarioViewMode = "ownership";
    state.countryNames = { ...countryNames };
    state.selectedWaterRegionId = "";
    state.selectedSpecialRegionId = "";
    state.hoveredWaterRegionId = null;
    state.hoveredSpecialRegionId = null;
    state.sovereigntyByFeatureId = {};
    state.sovereigntyInitialized = false;
    state.visualOverrides = {};
    state.featureOverrides = {};
    const defaults = syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });
    state.sovereignBaseColors = { ...(defaults || state.resolvedDefaultCountryPalette || defaultCountryPalette) };
    state.countryBaseColors = { ...state.sovereignBaseColors };
    markLegacyColorStateDirty();
    state.activeSovereignCode = "";
    syncScenarioInspectorSelection("");
    restoreParentBordersAfterScenario();
    restorePaintModeAfterScenario();
    restoreScenarioOceanFillAfterExit();
    restoreScenarioDisplaySettingsAfterExit();
    runPostScenarioClearEffects({ renderNow });
    if (markDirtyReason) {
      markDirty(markDirtyReason);
    }
    if (showToastOnComplete && typeof showToast === "function" && typeof t === "function") {
      showToast(t("Scenario cleared.", "ui"), {
        title: t("Scenario cleared", "ui"),
        tone: "success",
      });
    }
  }

  return {
    applyScenarioPaintMode,
    clearActiveScenario,
    disableScenarioParentBorders,
    resetToScenarioBaseline,
    syncScenarioInspectorSelection,
  };
}

export {
  createScenarioLifecycleRuntime,
};
