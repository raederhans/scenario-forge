import {
  createDefaultScenarioDataHealth,
  createDefaultScenarioHydrationHealthGate,
} from "../state/scenario_runtime_state.js";

function createScenarioLifecycleRuntime({
  state = null,
  runtimeState: explicitRuntimeState = null,
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
  const runtimeState = explicitRuntimeState || state;

  function syncScenarioInspectorSelection(countryCode = "") {
    const normalized = String(countryCode || "").trim().toUpperCase();
    runtimeState.selectedInspectorCountryCode = normalized;
    runtimeState.inspectorHighlightCountryCode = normalized;
    runtimeState.inspectorExpansionInitialized = false;
    if (runtimeState.expandedInspectorContinents instanceof Set) {
      runtimeState.expandedInspectorContinents.clear();
    }
    if (runtimeState.expandedInspectorReleaseParents instanceof Set) {
      runtimeState.expandedInspectorReleaseParents.clear();
    }
  }

  function disableScenarioParentBorders() {
    if (!runtimeState.activeScenarioId && runtimeState.scenarioParentBorderEnabledBeforeActivate === null) {
      runtimeState.scenarioParentBorderEnabledBeforeActivate = {
        ...(runtimeState.parentBorderEnabledByCountry || {}),
      };
    }
    const next = {};
    Object.keys(runtimeState.parentBorderEnabledByCountry || {}).forEach((countryCode) => {
      next[countryCode] = false;
    });
    runtimeState.parentBorderEnabledByCountry = next;
    if (typeof runtimeState.updateParentBorderCountryListFn === "function") {
      runtimeState.updateParentBorderCountryListFn();
    }
  }

  function restoreParentBordersAfterScenario() {
    if (runtimeState.scenarioParentBorderEnabledBeforeActivate && typeof runtimeState.scenarioParentBorderEnabledBeforeActivate === "object") {
      runtimeState.parentBorderEnabledByCountry = {
        ...runtimeState.scenarioParentBorderEnabledBeforeActivate,
      };
    }
    runtimeState.scenarioParentBorderEnabledBeforeActivate = null;
    if (typeof runtimeState.updateParentBorderCountryListFn === "function") {
      runtimeState.updateParentBorderCountryListFn();
    }
  }

  function applyScenarioPaintMode() {
    if (!runtimeState.scenarioPaintModeBeforeActivate) {
      runtimeState.scenarioPaintModeBeforeActivate = {
        paintMode: String(runtimeState.paintMode || "visual") === "sovereignty" ? "sovereignty" : "visual",
        interactionGranularity: String(runtimeState.interactionGranularity || "subdivision") === "country"
          ? "country"
          : "subdivision",
        batchFillScope: String(runtimeState.batchFillScope || "parent") === "country" ? "country" : "parent",
        politicalEditingExpanded: !!runtimeState.ui?.politicalEditingExpanded,
      };
    }
    runtimeState.paintMode = "sovereignty";
    runtimeState.interactionGranularity = "subdivision";
    if (runtimeState.ui && typeof runtimeState.ui === "object") {
      runtimeState.ui.politicalEditingExpanded = false;
      runtimeState.ui.scenarioVisualAdjustmentsOpen = false;
    }
    if (typeof runtimeState.updatePaintModeUIFn === "function") {
      runtimeState.updatePaintModeUIFn();
    }
  }

  function restorePaintModeAfterScenario() {
    const previous = runtimeState.scenarioPaintModeBeforeActivate;
    if (previous && typeof previous === "object") {
      runtimeState.paintMode = previous.paintMode === "sovereignty" ? "sovereignty" : "visual";
      runtimeState.interactionGranularity = previous.interactionGranularity === "country"
        ? "country"
        : "subdivision";
      runtimeState.batchFillScope = previous.batchFillScope === "country" ? "country" : "parent";
      if (runtimeState.ui && typeof runtimeState.ui === "object") {
        runtimeState.ui.politicalEditingExpanded = !!previous.politicalEditingExpanded;
        runtimeState.ui.scenarioVisualAdjustmentsOpen = false;
      }
    }
    runtimeState.scenarioPaintModeBeforeActivate = null;
    if (typeof runtimeState.updatePaintModeUIFn === "function") {
      runtimeState.updatePaintModeUIFn();
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
    if (!runtimeState.activeScenarioId || !runtimeState.scenarioBaselineOwnersByFeatureId) {
      return false;
    }
    const previousSelectedInspectorCountryCode = String(runtimeState.selectedInspectorCountryCode || "").trim().toUpperCase();
    const previousExpandedInspectorContinents = runtimeState.expandedInspectorContinents instanceof Set
      ? new Set(runtimeState.expandedInspectorContinents)
      : new Set();
    const previousExpandedInspectorReleaseParents = runtimeState.expandedInspectorReleaseParents instanceof Set
      ? new Set(runtimeState.expandedInspectorReleaseParents)
      : new Set();
    const previousInspectorExpansionInitialized = !!runtimeState.inspectorExpansionInitialized;
    runtimeState.sovereigntyByFeatureId = { ...(runtimeState.scenarioBaselineOwnersByFeatureId || {}) };
    runtimeState.scenarioControllersByFeatureId = { ...(runtimeState.scenarioBaselineControllersByFeatureId || {}) };
    runtimeState.scenarioAutoShellOwnerByFeatureId = {};
    runtimeState.scenarioAutoShellControllerByFeatureId = {};
    runtimeState.mapSemanticMode = getScenarioMapSemanticMode(runtimeState.activeScenarioManifest, runtimeState.mapSemanticMode);
    if (runtimeState.mapSemanticMode === "blank") {
      applyBlankScenarioPresentationDefaults();
    }
    runtimeState.scenarioShellOverlayRevision = (Number(runtimeState.scenarioShellOverlayRevision) || 0) + 1;
    runtimeState.scenarioControllerRevision = (Number(runtimeState.scenarioControllerRevision) || 0) + 1;
    runtimeState.scenarioViewMode = "ownership";
    recalculateScenarioOwnerControllerDiffCount();
    runtimeState.sovereigntyInitialized = false;
    ensureSovereigntyState({ force: true });
    runtimeState.parentBordersVisible = false;
    runtimeState.visualOverrides = {};
    runtimeState.featureOverrides = {};
    runtimeState.sovereignBaseColors = { ...(runtimeState.scenarioFixedOwnerColors || {}) };
    runtimeState.countryBaseColors = { ...runtimeState.sovereignBaseColors };
    markLegacyColorStateDirty();
    runtimeState.activeSovereignCode = runtimeState.mapSemanticMode === "blank"
      ? ""
      : (
        getScenarioDefaultCountryCode(
          runtimeState.activeScenarioManifest,
          runtimeState.scenarioCountriesByTag
        ) || String(runtimeState.activeSovereignCode || "").trim().toUpperCase()
      );
    if (runtimeState.ui && typeof runtimeState.ui === "object") {
      runtimeState.ui.scenarioVisualAdjustmentsOpen = false;
    }
    const restoredInspectorCode =
      previousSelectedInspectorCountryCode && runtimeState.scenarioCountriesByTag?.[previousSelectedInspectorCountryCode]
        ? previousSelectedInspectorCountryCode
        : runtimeState.activeSovereignCode;
    runtimeState.selectedInspectorCountryCode = restoredInspectorCode;
    runtimeState.inspectorHighlightCountryCode = restoredInspectorCode;
    runtimeState.expandedInspectorContinents = previousExpandedInspectorContinents;
    runtimeState.expandedInspectorReleaseParents = previousExpandedInspectorReleaseParents;
    runtimeState.inspectorExpansionInitialized =
      previousInspectorExpansionInitialized || previousExpandedInspectorContinents.size > 0;
    setScenarioAuditUiState({
      loading: false,
      errorMessage: "",
    });
    runtimeState.scenarioBorderMode = "scenario_owner_only";
    disableScenarioParentBorders();
    runPostScenarioResetEffects({
      scenarioId: runtimeState.activeScenarioId,
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
    const previousScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    const hasBaselineRuntimeTopology = !!runtimeState.defaultRuntimePoliticalTopology?.objects?.political;
    const hasBaselineDetailTopology = !!runtimeState.topologyDetail?.objects?.political;
    if (runtimeState.runtimeChunkLoadState?.refreshTimerId) {
      globalThis.clearTimeout(runtimeState.runtimeChunkLoadState.refreshTimerId);
    }
    releaseScenarioAuditPayload(previousScenarioId, { syncUi: false });
    runtimeState.activeScenarioId = "";
    runtimeState.scenarioBorderMode = "canonical";
    runtimeState.activeScenarioManifest = null;
    runtimeState.activeScenarioMeshPack = null;
    runtimeState.scenarioCountriesByTag = {};
    runtimeState.scenarioFixedOwnerColors = {};
    runtimeState.scenarioRuntimeTopologyData = null;
    runtimeState.scenarioRuntimeTopologyVersionTag = "";
    runtimeState.scenarioPoliticalChunkData = null;
    runtimeState.scenarioLandMaskData = null;
    runtimeState.scenarioContextLandMaskData = null;
    runtimeState.scenarioLandMaskVersionTag = "";
    runtimeState.scenarioContextLandMaskVersionTag = "";
    runtimeState.mapSemanticMode = "blank";
    runtimeState.runtimePoliticalTopology = runtimeState.defaultRuntimePoliticalTopology || null;
    // startup coarse mode can still carry defaultRuntimePoliticalTopology while detail promotion remains deferred
    runtimeState.topologyBundleMode = hasBaselineDetailTopology ? "composite" : "single";
    runtimeState.detailDeferred = hasBaselineRuntimeTopology && !hasBaselineDetailTopology;
    runtimeState.detailPromotionInFlight = false;
    runtimeState.detailPromotionCompleted = hasBaselineDetailTopology;
    resetScenarioChunkRuntimeState({ scenarioId: "" });
    runtimeState.scheduleScenarioChunkRefreshFn = null;
    runtimeState.scenarioWaterRegionsData = null;
    runtimeState.scenarioWaterOverlayVersionTag = "";
    runtimeState.scenarioSpecialRegionsData = null;
    runtimeState.scenarioReliefOverlaysData = null;
    runtimeState.scenarioDistrictGroupsData = null;
    runtimeState.scenarioDistrictGroupByFeatureId = new Map();
    runtimeState.scenarioReliefOverlayRevision = (Number(runtimeState.scenarioReliefOverlayRevision) || 0) + 1;
    applyBlankScenarioPresentationDefaults();
    runtimeState.scenarioReleasableIndex = createDefaultScenarioReleasableIndex();
    runtimeState.releasableCatalog = runtimeState.defaultReleasableCatalog || null;
    runtimeState.scenarioImportAudit = null;
    runtimeState.scenarioBaselineHash = "";
    runtimeState.scenarioBaselineOwnersByFeatureId = {};
    runtimeState.scenarioControllersByFeatureId = {};
    runtimeState.scenarioAutoShellOwnerByFeatureId = {};
    runtimeState.scenarioAutoShellControllerByFeatureId = {};
    runtimeState.scenarioBaselineControllersByFeatureId = {};
    runtimeState.scenarioBaselineCoresByFeatureId = {};
    runtimeState.scenarioShellOverlayRevision = (Number(runtimeState.scenarioShellOverlayRevision) || 0) + 1;
    runtimeState.scenarioControllerRevision = (Number(runtimeState.scenarioControllerRevision) || 0) + 1;
    runtimeState.scenarioOwnerControllerDiffCount = 0;
    runtimeState.scenarioHydrationHealthGate = createDefaultScenarioHydrationHealthGate();
    runtimeState.scenarioDataHealth = createDefaultScenarioDataHealth(scenarioDetailMinRatioStrict);
    runtimeState.scenarioViewMode = "ownership";
    runtimeState.countryNames = { ...countryNames };
    runtimeState.selectedWaterRegionId = "";
    runtimeState.selectedSpecialRegionId = "";
    runtimeState.hoveredWaterRegionId = null;
    runtimeState.hoveredSpecialRegionId = null;
    runtimeState.sovereigntyByFeatureId = {};
    runtimeState.sovereigntyInitialized = false;
    runtimeState.visualOverrides = {};
    runtimeState.featureOverrides = {};
    const defaults = syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });
    runtimeState.sovereignBaseColors = { ...(defaults || runtimeState.resolvedDefaultCountryPalette || defaultCountryPalette) };
    runtimeState.countryBaseColors = { ...runtimeState.sovereignBaseColors };
    markLegacyColorStateDirty();
    runtimeState.activeSovereignCode = "";
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
