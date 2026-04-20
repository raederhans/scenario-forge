import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioStartupHydrationController } from "../js/core/scenario/startup_hydration.js";

test("startup hydration refreshes opening owner borders when full mesh pack arrives", () => {
  const calls = [];
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
    refreshMapDataForScenarioChunkPromotion: () => {},
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
});
