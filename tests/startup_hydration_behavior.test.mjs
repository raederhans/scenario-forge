import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioStartupHydrationController } from "../js/core/scenario/startup_hydration.js";

test("startup hydration refreshes opening owner borders when full mesh pack arrives", () => {
  const calls = [];
  const promotionCalls = [];
  const state = {
    activeScenarioId: "tno_1962",
    scenarioBorderMode: "scenario_owner_only",
    scenarioViewMode: "ownership",
    activeScenarioMeshPack: null,
    runtimePoliticalTopology: null,
    scenarioRuntimeTopologyData: null,
    scenarioWaterRegionsData: null,
    scenarioSpecialRegionsData: null,
    scenarioPoliticalChunkData: { type: "FeatureCollection", features: [] },
    scenarioLandMaskData: null,
    scenarioContextLandMaskData: null,
    scenarioWaterOverlayVersionTag: "",
    scenarioLandMaskVersionTag: "",
    scenarioContextLandMaskVersionTag: "",
    scenarioGeoLocalePatchData: null,
    scenarioCityOverridesData: null,
    scenarioDistrictGroupByFeatureId: new Map(),
    defaultRuntimePoliticalTopology: null,
    renderPerfMetrics: {},
    defaultReleasableCatalog: null,
    releasableCatalog: null,
    scenarioReleasableIndex: null,
    scenarioAudit: null,
  };

  const { hydrateActiveScenarioBundle } = createScenarioStartupHydrationController({
    state,
    normalizeScenarioId: (value) => String(value || "").trim(),
    normalizeScenarioRuntimeTopologyPayload: (value) => value,
    normalizeScenarioGeoLocalePatchPayload: (value) => value,
    normalizeFeatureText: (value) => String(value || "").trim(),
    normalizeScenarioFeatureCollection: (value) => value,
    getScenarioRuntimePoliticalFeatureCount: () => 0,
    getScenarioDecodedCollection: () => null,
    getScenarioRuntimeMergedLayerPayloads: () => ({}),
    hasScenarioMergedLayerPayload: () => false,
    areScenarioFeatureCollectionsEquivalent: () => true,
    applyScenarioPoliticalChunkPayload: () => false,
    loadOptionalScenarioResource: async () => null,
    getScenarioGeoLocalePatchDescriptor: () => ({ url: "", language: "en", localeSpecific: false }),
    getLoadScenarioBundle: () => async () => null,
    syncScenarioLocalizationState: () => {},
    syncCountryUi: () => {},
    syncScenarioUi: () => {},
    setScenarioAuditUiState: () => {},
    mergeReleasableCatalogs: () => null,
    buildScenarioDistrictGroupByFeatureId: () => new Map(),
    buildScenarioReleasableIndex: () => null,
    invalidateContextLayerVisualStateBatch: () => {},
    invalidateOceanWaterInteractionVisualState: () => {},
    refreshColorState: () => {},
    refreshMapDataForScenarioChunkPromotion: (options) => {
      promotionCalls.push(options);
    },
    refreshScenarioOpeningOwnerBorders: (options) => {
      calls.push(options);
      return true;
    },
    flushRenderBoundary: () => {},
    enterScenarioFatalRecovery: () => {},
    consumeScenarioTestHook: () => false,
    t: (value) => value,
    showToast: () => {},
  });

  const hydrated = hydrateActiveScenarioBundle({
    manifest: { scenario_id: "tno_1962" },
    meshPackPayload: {
      meshes: {
        opening_owner_borders: {
          type: "MultiLineString",
          coordinates: [[[1, 1], [2, 2]]],
        },
      },
    },
  });

  assert.equal(hydrated, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.renderNow, false);
  assert.equal(calls[0]?.reason, "scenario-hydrate-opening");
  assert.equal(promotionCalls.length, 0);
});

test("startup hydration marks political promotion as changed when runtime political payload changes", () => {
  const promotionCalls = [];
  const state = {
    activeScenarioId: "tno_1962",
    scenarioBorderMode: "scenario_owner_only",
    scenarioViewMode: "ownership",
    activeScenarioMeshPack: null,
    runtimePoliticalTopology: null,
    scenarioRuntimeTopologyData: null,
    scenarioWaterRegionsData: null,
    scenarioSpecialRegionsData: null,
    scenarioPoliticalChunkData: { type: "FeatureCollection", features: [{ id: "old" }] },
    scenarioLandMaskData: null,
    scenarioContextLandMaskData: null,
    scenarioWaterOverlayVersionTag: "",
    scenarioLandMaskVersionTag: "",
    scenarioContextLandMaskVersionTag: "",
    scenarioGeoLocalePatchData: null,
    scenarioCityOverridesData: null,
    scenarioDistrictGroupByFeatureId: new Map(),
    defaultRuntimePoliticalTopology: null,
    renderPerfMetrics: {},
    defaultReleasableCatalog: null,
    releasableCatalog: null,
    scenarioReleasableIndex: null,
    scenarioAudit: null,
  };
  const changedPoliticalPayload = {
    type: "FeatureCollection",
    features: [{ id: "new" }],
  };

  const { hydrateActiveScenarioBundle } = createScenarioStartupHydrationController({
    state,
    normalizeScenarioId: (value) => String(value || "").trim(),
    normalizeScenarioRuntimeTopologyPayload: (value) => value,
    normalizeScenarioGeoLocalePatchPayload: (value) => value,
    normalizeFeatureText: (value) => String(value || "").trim(),
    normalizeScenarioFeatureCollection: (value) => value,
    getScenarioRuntimePoliticalFeatureCount: () => 1,
    getScenarioDecodedCollection: (_bundle, key) => (key === "politicalData" ? changedPoliticalPayload : null),
    getScenarioRuntimeMergedLayerPayloads: () => ({}),
    hasScenarioMergedLayerPayload: () => false,
    areScenarioFeatureCollectionsEquivalent: () => false,
    applyScenarioPoliticalChunkPayload: () => false,
    loadOptionalScenarioResource: async () => null,
    getScenarioGeoLocalePatchDescriptor: () => ({ url: "", language: "en", localeSpecific: false }),
    getLoadScenarioBundle: () => async () => null,
    syncScenarioLocalizationState: () => {},
    syncCountryUi: () => {},
    syncScenarioUi: () => {},
    setScenarioAuditUiState: () => {},
    mergeReleasableCatalogs: () => null,
    buildScenarioDistrictGroupByFeatureId: () => new Map(),
    buildScenarioReleasableIndex: () => null,
    invalidateContextLayerVisualStateBatch: () => {},
    invalidateOceanWaterInteractionVisualState: () => {},
    refreshColorState: () => {},
    createStartupHydrationRefreshPlan: ({ changedLayerKeys = [], hasPoliticalChange = true } = {}) => ({
      kind: "ScenarioRefreshPlan",
      source: "startup-hydration",
      changedLayerKeys,
      renderer: {
        kind: "RendererRefreshPlan",
        source: "startup-hydration",
        refreshOpeningOwnerBorders: hasPoliticalChange,
      },
    }),
    refreshMapDataForScenarioChunkPromotion: (options) => {
      promotionCalls.push(options);
    },
    refreshScenarioOpeningOwnerBorders: () => true,
    flushRenderBoundary: () => {},
    enterScenarioFatalRecovery: () => {},
    consumeScenarioTestHook: () => false,
    t: (value) => value,
    showToast: () => {},
  });

  const hydrated = hydrateActiveScenarioBundle({
    manifest: { scenario_id: "tno_1962" },
  });

  assert.equal(hydrated, true);
  assert.equal(promotionCalls.length, 1);
  assert.equal(promotionCalls[0]?.suppressRender, false);
  assert.equal(promotionCalls[0]?.hasPoliticalPayloadChange, true);
  assert.equal(promotionCalls[0]?.refreshPlan?.source, "startup-hydration");
  assert.deepEqual(promotionCalls[0]?.refreshPlan?.changedLayerKeys, ["political"]);
  assert.equal(promotionCalls[0]?.refreshPlan?.renderer?.refreshOpeningOwnerBorders, true);
});

test("startup hydration keeps political promotion safe when refresh plan factory is absent", () => {
  const promotionCalls = [];
  const changedPoliticalPayload = {
    type: "FeatureCollection",
    features: [{ id: "new" }],
  };
  const state = {
    activeScenarioId: "tno_1962",
    scenarioBorderMode: "scenario_owner_only",
    scenarioViewMode: "ownership",
    activeScenarioMeshPack: null,
    runtimePoliticalTopology: null,
    scenarioRuntimeTopologyData: null,
    scenarioWaterRegionsData: null,
    scenarioSpecialRegionsData: null,
    scenarioPoliticalChunkData: { type: "FeatureCollection", features: [{ id: "old" }] },
    scenarioLandMaskData: null,
    scenarioContextLandMaskData: null,
    scenarioWaterOverlayVersionTag: "",
    scenarioLandMaskVersionTag: "",
    scenarioContextLandMaskVersionTag: "",
    scenarioGeoLocalePatchData: null,
    scenarioCityOverridesData: null,
    scenarioDistrictGroupByFeatureId: new Map(),
    defaultRuntimePoliticalTopology: null,
    renderPerfMetrics: {},
    defaultReleasableCatalog: null,
    releasableCatalog: null,
    scenarioReleasableIndex: null,
    scenarioAudit: null,
  };

  const { hydrateActiveScenarioBundle } = createScenarioStartupHydrationController({
    state,
    normalizeScenarioId: (value) => String(value || "").trim(),
    normalizeScenarioRuntimeTopologyPayload: (value) => value,
    normalizeScenarioGeoLocalePatchPayload: (value) => value,
    normalizeFeatureText: (value) => String(value || "").trim(),
    normalizeScenarioFeatureCollection: (value) => value,
    getScenarioRuntimePoliticalFeatureCount: () => 1,
    getScenarioDecodedCollection: (_bundle, key) => (key === "politicalData" ? changedPoliticalPayload : null),
    getScenarioRuntimeMergedLayerPayloads: () => ({}),
    hasScenarioMergedLayerPayload: () => false,
    areScenarioFeatureCollectionsEquivalent: () => false,
    applyScenarioPoliticalChunkPayload: () => false,
    loadOptionalScenarioResource: async () => null,
    getScenarioGeoLocalePatchDescriptor: () => ({ url: "", language: "en", localeSpecific: false }),
    getLoadScenarioBundle: () => async () => null,
    syncScenarioLocalizationState: () => {},
    syncCountryUi: () => {},
    syncScenarioUi: () => {},
    setScenarioAuditUiState: () => {},
    mergeReleasableCatalogs: () => null,
    buildScenarioDistrictGroupByFeatureId: () => new Map(),
    buildScenarioReleasableIndex: () => null,
    invalidateContextLayerVisualStateBatch: () => {},
    invalidateOceanWaterInteractionVisualState: () => {},
    refreshColorState: () => {},
    refreshMapDataForScenarioChunkPromotion: (options) => {
      promotionCalls.push(options);
    },
    refreshScenarioOpeningOwnerBorders: () => true,
    flushRenderBoundary: () => {},
    enterScenarioFatalRecovery: () => {},
    consumeScenarioTestHook: () => false,
    t: (value) => value,
    showToast: () => {},
  });

  assert.equal(hydrateActiveScenarioBundle({ manifest: { scenario_id: "tno_1962" } }), true);
  assert.equal(promotionCalls.length, 1);
  assert.equal(promotionCalls[0]?.refreshPlan, null);
});

test("startup hydration overlay mismatch degrades overlays and keeps startup readonly off", async () => {
  const flushCalls = [];
  const scenarioUiCalls = [];
  const countryUiCalls = [];
  const toastCalls = [];
  const state = {
    activeScenarioId: "tno_1962",
    landData: {
      type: "FeatureCollection",
      features: [{ properties: { id: "feature-1" } }],
    },
    sovereigntyByFeatureId: {},
    scenarioRuntimeTopologyVersionTag: "runtime-v1",
    scenarioWaterRegionsData: { type: "FeatureCollection", features: [] },
    scenarioLandMaskData: { type: "FeatureCollection", features: [] },
    scenarioContextLandMaskData: { type: "FeatureCollection", features: [] },
    scenarioWaterOverlayVersionTag: "runtime-v1",
    scenarioLandMaskVersionTag: "runtime-v1",
    scenarioContextLandMaskVersionTag: "runtime-v1",
    startupReadonly: true,
    startupReadonlyReason: "scenario-health-gate",
    startupReadonlyUnlockInFlight: true,
    scenarioHydrationHealthGate: null,
  };

  const { enforceScenarioHydrationHealthGate } = createScenarioStartupHydrationController({
    state,
    normalizeScenarioId: (value) => String(value || "").trim(),
    normalizeScenarioRuntimeTopologyPayload: (value) => value,
    normalizeScenarioGeoLocalePatchPayload: (value) => value,
    normalizeFeatureText: (value) => String(value || "").trim(),
    normalizeScenarioFeatureCollection: (value) => value,
    getScenarioRuntimePoliticalFeatureCount: () => 1,
    getScenarioDecodedCollection: () => null,
    getScenarioRuntimeMergedLayerPayloads: () => ({}),
    hasScenarioMergedLayerPayload: () => false,
    areScenarioFeatureCollectionsEquivalent: () => true,
    applyScenarioPoliticalChunkPayload: () => false,
    loadOptionalScenarioResource: async () => null,
    getScenarioGeoLocalePatchDescriptor: () => ({ url: "", language: "en", localeSpecific: false }),
    getLoadScenarioBundle: () => async () => null,
    syncScenarioLocalizationState: () => {},
    syncCountryUi: (options) => {
      countryUiCalls.push(options);
    },
    syncScenarioUi: () => {
      scenarioUiCalls.push("sync");
    },
    setScenarioAuditUiState: () => {},
    mergeReleasableCatalogs: () => null,
    buildScenarioDistrictGroupByFeatureId: () => new Map(),
    buildScenarioReleasableIndex: () => null,
    invalidateContextLayerVisualStateBatch: () => {},
    invalidateOceanWaterInteractionVisualState: () => {},
    refreshColorState: () => {},
    refreshMapDataForScenarioChunkPromotion: () => {},
    refreshScenarioOpeningOwnerBorders: () => false,
    flushRenderBoundary: (reason) => {
      flushCalls.push(reason);
    },
    enterScenarioFatalRecovery: () => {},
    consumeScenarioTestHook: (name) => name === "forceHydrationHealthGateMaskMismatchOnce",
    t: (value) => value,
    showToast: (...args) => {
      toastCalls.push(args);
    },
  });

  const result = await enforceScenarioHydrationHealthGate({
    renderNow: false,
    reason: "test-mask-mismatch",
    autoRetry: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.degradedWaterOverlay, true);
  assert.equal(state.startupReadonly, false);
  assert.equal(state.startupReadonlyReason, "");
  assert.equal(state.startupReadonlyUnlockInFlight, false);
  assert.deepEqual(state.scenarioHydrationHealthGate, {
    status: "degraded",
    reason: "runtime-overlay-context-land-mask-version-mismatch",
    checkedAt: state.scenarioHydrationHealthGate.checkedAt,
    attemptedRetry: false,
    ownerFeatureOverlapRatio: 0,
    ownerFeatureOverlapCount: 0,
    ownerFeatureRenderedCount: 1,
    degradedWaterOverlay: true,
  });
  assert.equal(state.scenarioWaterRegionsData, null);
  assert.equal(state.scenarioLandMaskData, null);
  assert.equal(state.scenarioContextLandMaskData, null);
  assert.equal(flushCalls.length, 0);
  assert.equal(scenarioUiCalls.length, 1);
  assert.equal(countryUiCalls.length, 1);
  assert.equal(countryUiCalls[0]?.renderNow, false);
  assert.equal(toastCalls.length, 1);
});
