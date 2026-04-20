import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioLifecycleRuntime } from "../js/core/scenario/lifecycle_runtime.js";

function createLifecycleRuntime(state, overrides = {}) {
  return createScenarioLifecycleRuntime({
    state,
    countryNames: { FR: "France", DE: "Germany" },
    defaultCountryPalette: { FR: "#00f", DE: "#000" },
    createDefaultScenarioReleasableIndex: () => ({ ids: [] }),
    ensureSovereigntyState: () => {},
    getScenarioDefaultCountryCode: () => "FR",
    getScenarioMapSemanticMode: () => "countries",
    markDirty: () => {},
    markLegacyColorStateDirty: () => {},
    normalizeScenarioId: (value) => String(value || "").trim(),
    recalculateScenarioOwnerControllerDiffCount: () => {
      state.scenarioOwnerControllerDiffCount = 4;
      return 4;
    },
    releaseScenarioAuditPayload: () => {},
    resetScenarioChunkRuntimeState: () => {},
    restoreScenarioDisplaySettingsAfterExit: () => {},
    restoreScenarioOceanFillAfterExit: () => {},
    runPostScenarioClearEffects: () => {},
    runPostScenarioResetEffects: () => {},
    scenarioDetailMinRatioStrict: 0.75,
    setScenarioAuditUiState: () => {},
    syncResolvedDefaultCountryPalette: () => ({ FR: "#00f", DE: "#000" }),
    applyBlankScenarioPresentationDefaults: () => {},
    ...overrides,
  });
}

function createBaseState(overrides = {}) {
  return {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { scenario_id: "tno_1962" },
    activeScenarioMeshPack: {},
    selectedInspectorCountryCode: "DE",
    inspectorHighlightCountryCode: "DE",
    expandedInspectorContinents: new Set(["EU"]),
    expandedInspectorReleaseParents: new Set(["FR"]),
    inspectorExpansionInitialized: true,
    scenarioBaselineOwnersByFeatureId: { A: "FR", B: "DE" },
    scenarioBaselineControllersByFeatureId: { A: "FR", B: "FR" },
    scenarioCountriesByTag: { FR: {}, DE: {} },
    scenarioFixedOwnerColors: { FR: "#00f", DE: "#000" },
    scenarioBorderMode: "scenario_owner_only",
    scenarioShellOverlayRevision: 0,
    scenarioControllerRevision: 0,
    scenarioViewMode: "frontline",
    scenarioPaintModeBeforeActivate: {
      paintMode: "visual",
      interactionGranularity: "subdivision",
      batchFillScope: "parent",
      politicalEditingExpanded: false,
    },
    scenarioParentBorderEnabledBeforeActivate: null,
    scenarioDisplaySettingsBeforeActivate: null,
    scenarioOceanFillBeforeActivate: null,
    scenarioRuntimeTopologyData: { id: "scenario-runtime" },
    scenarioRuntimeTopologyVersionTag: "v1",
    scenarioPoliticalChunkData: { chunk: true },
    scenarioLandMaskData: { mask: true },
    scenarioContextLandMaskData: { mask: true },
    scenarioLandMaskVersionTag: "mask",
    scenarioContextLandMaskVersionTag: "mask-context",
    scenarioWaterRegionsData: { id: "water" },
    scenarioWaterOverlayVersionTag: "water-v1",
    scenarioSpecialRegionsData: { id: "special" },
    scenarioReliefOverlaysData: { id: "relief" },
    scenarioDistrictGroupsData: { id: "districts" },
    scenarioDistrictGroupByFeatureId: new Map([["A", "group"]]),
    scenarioReliefOverlayRevision: 0,
    scenarioReleasableIndex: { ids: ["FR"] },
    defaultReleasableCatalog: { ids: ["FR", "DE"] },
    releasableCatalog: { ids: ["FR"] },
    scenarioImportAudit: { status: "ok" },
    scenarioBaselineHash: "baseline",
    scenarioAutoShellOwnerByFeatureId: { A: "FR" },
    scenarioAutoShellControllerByFeatureId: { A: "FR" },
    scenarioBaselineCoresByFeatureId: { A: ["FR"] },
    scenarioOwnerControllerDiffCount: 999,
    scenarioHydrationHealthGate: { status: "ok" },
    scenarioDataHealth: { expectedFeatureCount: 12 },
    mapSemanticMode: "countries",
    countryNames: { FR: "France", DE: "Germany" },
    selectedWaterRegionId: "water-1",
    selectedSpecialRegionId: "special-1",
    hoveredWaterRegionId: "water-1",
    hoveredSpecialRegionId: "special-1",
    sovereigntyByFeatureId: { A: "FR", B: "DE" },
    sovereigntyInitialized: true,
    visualOverrides: { A: "#fff" },
    featureOverrides: { A: { color: "#fff" } },
    sovereignBaseColors: { FR: "#00f" },
    countryBaseColors: { FR: "#00f" },
    activeSovereignCode: "FR",
    parentBordersVisible: true,
    parentBorderEnabledByCountry: { FR: true, DE: true },
    paintMode: "sovereignty",
    interactionGranularity: "country",
    batchFillScope: "country",
    ui: {
      scenarioVisualAdjustmentsOpen: true,
      politicalEditingExpanded: true,
    },
    styleConfig: { ocean: { fillColor: "#123456" } },
    scheduleScenarioChunkRefreshFn: () => {},
    runtimeChunkLoadState: {},
    resolvedDefaultCountryPalette: { FR: "#00f", DE: "#000" },
    topologyDetail: null,
    defaultRuntimePoliticalTopology: { objects: { political: {} } },
    runtimePoliticalTopology: { objects: { political: { scenario: true } } },
    topologyBundleMode: "composite",
    detailDeferred: false,
    detailPromotionInFlight: true,
    detailPromotionCompleted: true,
    showCityPoints: true,
    showWaterRegions: true,
    showScenarioSpecialRegions: true,
    showScenarioReliefOverlays: true,
    dynamicBordersEnabled: true,
    renderProfile: "balanced",
    ...overrides,
  };
}

test("clearActiveScenario restores deferred coarse baseline when detail topology is still pending", () => {
  const state = createBaseState({
    topologyDetail: null,
    defaultRuntimePoliticalTopology: { objects: { political: {} } },
    topologyBundleMode: "composite",
    detailDeferred: false,
    detailPromotionCompleted: true,
  });
  const runtime = createLifecycleRuntime(state);

  runtime.clearActiveScenario({ renderNow: false, markDirtyReason: "" });

  assert.equal(state.activeScenarioId, "");
  assert.equal(state.topologyBundleMode, "single");
  assert.equal(state.detailDeferred, true);
  assert.equal(state.detailPromotionCompleted, false);
  assert.deepEqual(state.runtimePoliticalTopology, state.defaultRuntimePoliticalTopology);
});

test("clearActiveScenario keeps composite mode when baseline detail topology is already loaded", () => {
  const state = createBaseState({
    topologyDetail: { objects: { political: {} } },
    defaultRuntimePoliticalTopology: { objects: { political: {} } },
    topologyBundleMode: "composite",
    detailDeferred: false,
    detailPromotionCompleted: true,
  });
  const runtime = createLifecycleRuntime(state);

  runtime.clearActiveScenario({ renderNow: false, markDirtyReason: "" });

  assert.equal(state.topologyBundleMode, "composite");
  assert.equal(state.detailDeferred, false);
  assert.equal(state.detailPromotionCompleted, true);
});

test("resetToScenarioBaseline recalculates split count before UI refresh side effects", () => {
  const state = createBaseState();
  const seenCounts = [];
  const runtime = createLifecycleRuntime(state, {
    runPostScenarioResetEffects: () => {
      seenCounts.push(state.scenarioOwnerControllerDiffCount);
    },
  });

  const changed = runtime.resetToScenarioBaseline({
    renderNow: false,
    markDirtyReason: "",
    showToastOnComplete: false,
  });

  assert.equal(changed, true);
  assert.deepEqual(seenCounts, [4]);
  assert.equal(state.scenarioOwnerControllerDiffCount, 4);
});
