import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioLifecycleRuntime } from "../js/core/scenario/lifecycle_runtime.js";
import { createScenarioApplyPipeline } from "../js/core/scenario/scenario_apply_pipeline.js";
import { captureScenarioReadinessState } from "../js/core/state/actions/scenario_readiness_actions.js";
import { state as appState } from "../js/core/state.js";
import { resolveScenarioShellOwnerCode } from "../js/core/scenario/scenario_shell_overlay.js";

test("scenario shell explicit hints outrank inferred neighbor majority", () => {
  const ownerVotes = new Map([
    ["NBR", 3],
    ["MIN", 1],
  ]);

  assert.equal(resolveScenarioShellOwnerCode({
    directOwnerCode: "DIR",
    ownerHintCode: "OWN",
    controllerHintCode: "CTL",
    ownerVotes,
    countryFallbackCode: "FBK",
  }), "DIR");
  assert.equal(resolveScenarioShellOwnerCode({
    ownerHintCode: "OWN",
    controllerHintCode: "CTL",
    ownerVotes,
    countryFallbackCode: "FBK",
  }), "OWN");
  assert.equal(resolveScenarioShellOwnerCode({
    controllerHintCode: "CTL",
    ownerVotes,
    countryFallbackCode: "FBK",
  }), "CTL");
  assert.equal(resolveScenarioShellOwnerCode({ ownerVotes, countryFallbackCode: "FBK" }), "NBR");
  assert.equal(resolveScenarioShellOwnerCode({ countryFallbackCode: "FBK" }), "FBK");
});
function createLifecycleRuntime(runtimeState, overrides = {}) {
  return createScenarioLifecycleRuntime({
    state: runtimeState,
    countryNames: { FR: "France", DE: "Germany" },
    defaultCountryPalette: { FR: "#00f", DE: "#000" },
    createDefaultScenarioReleasableIndex: () => ({ ids: [] }),
    ensureSovereigntyState: () => {},
    getScenarioDefaultCountryCode: () => "FR",
    getScenarioMapSemanticMode: () => "countries",
    markDirty: () => {},
    disableScenarioParentBorders: () => {},
    normalizeScenarioId: (value) => String(value || "").trim(),
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
    ui: {},
    ...overrides,
  };
}

function createRenderableScenarioTopology() {
  return {
    type: "Topology",
    objects: {
      political: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Polygon",
            properties: { id: "POL-A" },
            arcs: [],
          },
        ],
      },
    },
    arcs: [],
  };
}

function createApplyPipelineForRuntimeTest(runtimeState, overrides = {}) {
  return createScenarioApplyPipeline({
    runtimeState,
    countryNames: {},
    normalizeScenarioId: (value) => String(value || "").trim(),
    scenarioSupportsChunkedRuntime: () => false,
    scenarioBundleUsesChunkedLayer: () => false,
    scenarioBundleHasChunkedData: () => false,
    prepareScenarioDetailTopologyState: async () =>
      ({ detailPromoted: true, scenarioReadinessPatch: captureScenarioReadinessState(runtimeState).values }),
    hasUsablePoliticalTopology: () => true,
    scenarioNeedsDetailTopology: () => false,
    getScenarioDisplayName: () => "Sample",
    getScenarioTargetPaletteId: () => "default",
    hasActiveScenarioPaletteLoaded: () => true,
    applyActivePaletteState: () => {},
    setActivePaletteSource: async () => true,
    publishScenarioPaletteAndToolbarState: () => {},
    getScenarioDefaultCountryCode: () => "AAA",
    getScenarioMapSemanticMode: () => "political",
    buildScenarioReleasableIndex: () => ({}),
    getScenarioReleasableCountries: () => ({}),
    normalizeScenarioCoreMap: (value) => value || {},
    normalizeScenarioDistrictGroupsPayload: () => null,
    getActiveScenarioMergedChunkLayerPayload: () => undefined,
    getScenarioDecodedCollection: () => null,
    getScenarioTopologyFeatureCollection: () => null,
    getScenarioNameMap: () => ({ AAA: "Alpha" }),
    getMissingScenarioNameTags: () => [],
    getScenarioFixedOwnerColors: () => ({ AAA: "#111111" }),
    buildHoi4FarEastSovietOwnerBackfill: () => ({}),
    buildScenarioRuntimeVersionTag: () => "sample:sha",
    mergeReleasableCatalogs: () => null,
    buildScenarioDistrictGroupByFeatureId: () => new Map(),
    syncScenarioLocalizationState: () => {},
    applyBlankScenarioPresentationDefaults: () => {},
    setScenarioAuditUiState: () => {},
    getScenarioBaselineHashFromBundle: (bundle) => bundle?.manifest?.baseline_hash || "baseline",
    disableScenarioParentBorders: () => {},
    syncScenarioInspectorSelection: () => {},
    applyScenarioPaintMode: () => {},
    syncScenarioOceanFillForActivation: () => {},
    applyScenarioPerformanceHints: () => {},
    scheduleScenarioChunkRefresh: () => {},
    resetScenarioChunkRuntimeState: () => {},
    ensureRuntimeChunkLoadState: () => ({}),
    hasRenderableScenarioPoliticalTopology: () => true,
    normalizeScenarioFeatureCollection: (value) => value,
    cloneScenarioStateValue: (value) => value,
    ...overrides,
  });
}

function createScenarioApplyBundleForRuntimeTest(scenarioId = "sample") {
  return {
    manifest: {
      scenario_id: scenarioId,
      baseline_hash: `${scenarioId}:baseline`,
    },
    countriesPayload: {
      countries: {
        AAA: {
          display_name: "Alpha",
          color_hex: "#111111",
        },
      },
    },
    ownersPayload: {
      owners: {
        "AAA-1": "AAA",
      },
    },
    coresPayload: {
      cores: {
        "AAA-1": ["AAA"],
      },
    },
    runtimeTopologyPayload: createRenderableScenarioTopology(),
  };
}

test("default activation rollback restores localization, audit, and blank defaults with absent-key semantics", async () => {
  const model = createBaseState({
    activeScenarioId: "before-default-observer",
    mapSemanticMode: "political",
  });
  const pipeline = createApplyPipelineForRuntimeTest(model, {
    getScenarioMapSemanticMode: () => "blank",
    syncScenarioLocalizationState: () => {
      model.scenarioGeoLocalePatchData = { id: "geo-after" };
      model.scenarioCityOverridesData = { id: "cities-after" };
      model.cityLayerRevision = 42;
      model.locales = { geo: { After: { en: "After" } } };
      model.geoAliasToStableKey = { after: "After" };
    },
    applyBlankScenarioPresentationDefaults: () => {
      model.showCityPoints = false;
    },
    setScenarioAuditUiState: () => {
      model.scenarioAuditUi = {
        loading: false,
        loadedForScenarioId: "blank_target",
        errorMessage: "",
      };
    },
    disableScenarioParentBorders: () => {
      throw new Error("injected observer failure after localization");
    },
  });
  const bundle = createScenarioApplyBundleForRuntimeTest("blank_target");
  bundle.manifest.map_mode = "blank";
  const staged = await pipeline.prepareScenarioApplyState(bundle, {
    syncPalette: false,
  });

  assert.throws(
    () => pipeline.applyPreparedScenarioState(bundle, staged),
    /injected observer failure after localization/,
  );
  [
    "scenarioGeoLocalePatchData",
    "scenarioCityOverridesData",
    "cityLayerRevision",
    "scenarioAuditUi",
    "locales",
    "geoAliasToStableKey",
    "showCityPoints",
  ].forEach((key) => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(model, key),
      false,
      `${key} should remain absent after default rollback`,
    );
  });
});

test("deferred metadata cannot publish after a scenario switch", async (t) => {
  const { scheduleScenarioDeferredBundleMetadataLoad } = await import("../js/core/scenario/scenario_resources.js");
  const previous = appState.activeScenarioId;
  t.after(() => { appState.activeScenarioId = previous; });
  appState.activeScenarioId = "alpha";
  let timerCallback;
  t.mock.method(globalThis, "setTimeout", callback => { timerCallback = callback; return 1; });
  const bundle = { bundleLevel: "full", manifest: { scenario_id: "alpha", district_groups_url: "/districts.json" } };
  const payload = { scenario_id: "alpha", tags: { AAA: { districts: { d1: { feature_ids: ["feature-1"] } } } } };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload)));
  scheduleScenarioDeferredBundleMetadataLoad(bundle, { d3Client: { json: async () => payload }, isScenarioApplyRequestCurrent: () => true });
  appState.activeScenarioId = "beta";
  await timerCallback();
  await bundle.deferredMetadataLoadPromise;
  assert.equal(appState.scenarioDistrictGroupsData?.scenario_id === "alpha", false);
});

test('river paint is cleared on scenario exit before post effects', async () => {
  const { makeFixture } = await import('./helpers/river_paint_fixture.mjs');
  const { state: source } = await makeFixture();
  const runtimeState = createBaseState({ riverPaint: source.riverPaint });
  let observed = null;
  const lifecycle = createLifecycleRuntime(runtimeState, {
    runPostScenarioClearEffects: () => { observed = runtimeState.riverPaint; },
  });
  lifecycle.clearActiveScenario();
  assert.deepEqual(observed, { schemaVersion: 1, editMode: false, pack: null, overrides: {} });
});
