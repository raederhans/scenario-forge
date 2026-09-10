import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createScenarioLifecycleRuntime } from "../js/core/scenario/lifecycle_runtime.js";
import { createScenarioApplyPipeline } from "../js/core/scenario_apply_pipeline.js";
import { createScenarioOceanFillRestoreRuntime } from "../js/core/scenario/presentation_ocean_fill_restore.js";
import {
  evaluateScenarioDataHealth,
  refreshScenarioDataHealth,
} from "../js/core/scenario_data_health.js";
import {
  captureScenarioApplyRollbackSnapshot,
  restoreScenarioApplyRollbackSnapshot,
} from "../js/core/scenario_rollback.js";
import {
  applyActivePaletteState,
  setActivePaletteSource,
} from "../js/core/palette_manager.js";
import {
  hasPendingScenarioChunkWork,
  publishScenarioPaletteAndToolbarState,
  shouldSuppressChunkedPostApplyDataHealthSignals,
} from "../js/core/scenario_post_apply_effects.js";
import {
  createDefaultScenarioHydrationHealthGate,
} from "../js/core/state/scenario_runtime_state.js";
import {
  createPoliticalRasterWorkerIdentity,
  isPoliticalRasterWorkerResultCurrent,
} from "../js/core/political_raster_worker_client.js";
import {
  STATE_BUS_EVENTS,
  off,
  subscribeStateBusEvent,
} from "../js/core/state/index.js";
import {
  defaultCountryPalette,
  state as appState,
} from "../js/core/state.js";
import {
  resolveScenarioShellOwnerCode,
} from "../js/core/scenario_shell_overlay.js";

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
    markLegacyColorStateDirty: () => {},
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
    activeScenarioMeshPack: {},
    selectedInspectorCountryCode: "DE",
    inspectorHighlightCountryCode: "DE",
    expandedInspectorContinents: new Set(["EU"]),
    expandedInspectorReleaseParents: new Set(["FR"]),
    inspectorExpansionInitialized: true,
    scenarioBaselineOwnersByFeatureId: { A: "FR", B: "DE" },
    scenarioCountriesByTag: { FR: {}, DE: {} },
    scenarioFixedOwnerColors: { FR: "#00f", DE: "#000" },
    scenarioBorderMode: "scenario_owner_only",
    scenarioShellOverlayRevision: 0,
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
    scenarioBaselineCoresByFeatureId: { A: ["FR"] },
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

function withAppStatePatch(patch, callback) {
  const previousValues = {};
  Object.keys(patch).forEach((key) => {
    previousValues[key] = appState[key];
  });
  applyAppStatePatch(patch);
  try {
    return callback();
  } finally {
    Object.keys(previousValues).forEach((key) => {
      appState[key] = previousValues[key];
    });
  }
}

function applyAppStatePatch(patch) {
  Object.keys(patch).forEach((key) => {
    appState[key] = patch[key];
  });
}

function deleteAppStateKeys(keys) {
  keys.forEach((key) => {
    delete appState[key];
  });
}

function readAppStateValue(key) {
  return appState[key];
}

function hasAppStateKey(key) {
  return Object.prototype.hasOwnProperty.call(appState, key);
}

function withAppStateRestored(callback) {
  const compatAccessorKeys = new Set(
    Object.keys(appState).filter((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(appState, key);
      return typeof descriptor?.get === "function"
        && typeof descriptor?.set === "function";
    }),
  );
  const previousValues = Object.fromEntries(
    Object.entries(appState).filter(([key]) => !compatAccessorKeys.has(key)),
  );
  try {
    return callback();
  } finally {
    deleteAppStateKeys(
      Object.keys(appState).filter(
        (key) =>
          !compatAccessorKeys.has(key)
          && !Object.prototype.hasOwnProperty.call(previousValues, key),
      ),
    );
    Object.entries(previousValues).forEach(([key, value]) => {
      appState[key] = value;
    });
  }
}

async function withAppStateRestoredAsync(callback) {
  const compatAccessorKeys = new Set(
    Object.keys(appState).filter((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(appState, key);
      return typeof descriptor?.get === "function"
        && typeof descriptor?.set === "function";
    }),
  );
  const previousValues = Object.fromEntries(
    Object.entries(appState).filter(([key]) => !compatAccessorKeys.has(key)),
  );
  try {
    return await callback();
  } finally {
    deleteAppStateKeys(
      Object.keys(appState).filter(
        (key) =>
          !compatAccessorKeys.has(key)
          && !Object.prototype.hasOwnProperty.call(previousValues, key),
      ),
    );
    Object.entries(previousValues).forEach(([key, value]) => {
      appState[key] = value;
    });
  }
}

function createFeatures(count) {
  return Array.from({ length: count }, (_value, index) => ({
    type: "Feature",
    id: `feature-${index}`,
    properties: {},
    geometry: null,
  }));
}

test("scenario activation starts in visual paint mode and preserves the previous mode for exit", () => {
  const updates = [];
  const runtimeState = createBaseState({
    scenarioPaintModeBeforeActivate: null,
    updatePaintModeUIFn: () => updates.push(runtimeState.paintMode),
  });
  const lifecycle = createLifecycleRuntime(runtimeState);
  lifecycle.applyScenarioPaintMode();
  assert.equal(runtimeState.paintMode, "visual");
  assert.equal(runtimeState.interactionGranularity, "subdivision");
  assert.equal(runtimeState.ui.politicalEditingExpanded, false);
  assert.deepEqual(runtimeState.scenarioPaintModeBeforeActivate, {
    paintMode: "sovereignty",
    interactionGranularity: "country",
    batchFillScope: "country",
    politicalEditingExpanded: true,
  });
  lifecycle.applyScenarioPaintMode();
  assert.equal(runtimeState.scenarioPaintModeBeforeActivate.paintMode, "sovereignty");
  assert.deepEqual(updates, ["visual", "visual"]);
});

test("chunked coarse data health signals remain internal until full derived state settles", () => {
  assert.equal(shouldSuppressChunkedPostApplyDataHealthSignals({
    hasChunkedRuntime: true,
    prewarmFailed: false,
    chunkErrorCount: 0,
  }), true);
  assert.equal(shouldSuppressChunkedPostApplyDataHealthSignals({
    hasChunkedRuntime: true,
    prewarmFailed: true,
    chunkErrorCount: 0,
  }), false);
  assert.equal(shouldSuppressChunkedPostApplyDataHealthSignals({
    hasChunkedRuntime: true,
    prewarmFailed: false,
    chunkErrorCount: 1,
  }), false);
  assert.equal(shouldSuppressChunkedPostApplyDataHealthSignals({
    hasChunkedRuntime: false,
    prewarmFailed: false,
    chunkErrorCount: 0,
  }), false);
});

test("chunk health settle waits for scheduler loading deferred and post-commit states", () => {
  assert.equal(hasPendingScenarioChunkWork({ shellStatus: "loading" }), true);
  assert.equal(hasPendingScenarioChunkWork({ shellStatus: "ready", pendingReason: "zoom-end" }), true);
  assert.equal(hasPendingScenarioChunkWork({ shellStatus: "ready", pendingPostCommitRefresh: {} }), true);
  assert.equal(hasPendingScenarioChunkWork({
    shellStatus: "ready",
    pendingReason: "",
    refreshScheduled: false,
    promotionScheduled: false,
    promotionCommitInFlight: false,
    inFlightByChunkId: {},
  }), false);
});

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

const SCENARIO_READINESS_PATCH_KEYS = Object.freeze([
  "topologyDetail",
  "topologyBundleMode",
  "detailDeferred",
  "detailPromotionCompleted",
  "detailPromotionInFlight",
  "detailSourceRequested",
]);

function createScenarioReadinessStageResult(runtimeState, {
  detailPromoted = true,
} = {}) {
  return {
    detailPromoted,
    scenarioReadinessPatch: Object.fromEntries(
      SCENARIO_READINESS_PATCH_KEYS.map(
        (key) => [key, runtimeState[key]],
      ),
    ),
  };
}

test("scenario readiness stage fixture preserves the exact staged patch", () => {
  const stagedValues = Object.fromEntries(
    SCENARIO_READINESS_PATCH_KEYS.map(
      (key, index) => [key, { key, index }],
    ),
  );
  assert.deepEqual(
    createScenarioReadinessStageResult(
      stagedValues,
      { detailPromoted: false },
    ),
    {
      detailPromoted: false,
      scenarioReadinessPatch: stagedValues,
    },
  );
});

function createApplyPipelineForRuntimeTest(runtimeState, overrides = {}) {
  return createScenarioApplyPipeline({
    runtimeState,
    countryNames: {},
    normalizeScenarioId: (value) => String(value || "").trim(),
    scenarioSupportsChunkedRuntime: () => false,
    scenarioBundleUsesChunkedLayer: () => false,
    scenarioBundleHasChunkedData: () => false,
    prepareScenarioDetailTopologyState: async () =>
      createScenarioReadinessStageResult(runtimeState),
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
    markLegacyColorStateDirty: () => {},
    syncScenarioInspectorSelection: () => {},
    disableScenarioParentBorders: () => {},
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

function captureScenarioPrepareAuthorityState(model) {
  return structuredClone({
    topologyDetail: model.topologyDetail,
    topologyBundleMode: model.topologyBundleMode,
    detailDeferred: model.detailDeferred,
    detailPromotionCompleted: model.detailPromotionCompleted,
    detailPromotionInFlight: model.detailPromotionInFlight,
    detailSourceRequested: model.detailSourceRequested,
    activePaletteId: model.activePaletteId,
    activePaletteMeta: model.activePaletteMeta,
    activePalettePack: model.activePalettePack,
    activePaletteMap: model.activePaletteMap,
    currentPaletteTheme: model.currentPaletteTheme,
    activePaletteOceanMeta: model.activePaletteOceanMeta,
    fixedPaletteColorsByIso2: model.fixedPaletteColorsByIso2,
    resolvedDefaultCountryPalette: model.resolvedDefaultCountryPalette,
    paletteLibraryEntries: model.paletteLibraryEntries,
    paletteQuickSwatches: model.paletteQuickSwatches,
    paletteLoadErrorById: model.paletteLoadErrorById,
    legendLabels: model.legendLabels,
    legendConfig: model.legendConfig,
  });
}

function cloneScenarioTransactionValue(value, seen = new WeakMap()) {
  if (
    value === null
    || typeof value !== "object"
  ) {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);
    value.forEach((entryValue, entryKey) => {
      result.set(
        cloneScenarioTransactionValue(entryKey, seen),
        cloneScenarioTransactionValue(entryValue, seen),
      );
    });
    return result;
  }
  if (value instanceof Set) {
    const result = new Set();
    seen.set(value, result);
    value.forEach((entryValue) => {
      result.add(cloneScenarioTransactionValue(entryValue, seen));
    });
    return result;
  }
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    value.forEach((entryValue) => {
      result.push(cloneScenarioTransactionValue(entryValue, seen));
    });
    return result;
  }
  const result = {};
  seen.set(value, result);
  Object.entries(value).forEach(([key, entryValue]) => {
    result[key] = cloneScenarioTransactionValue(entryValue, seen);
  });
  return result;
}

const SCENARIO_ATOMIC_AUTHORITY_KEYS = Object.freeze([
  "activeScenarioId",
  "activeScenarioManifest",
  "mapSemanticMode",
  "scenarioCountriesByTag",
  "scenarioRuntimeTopologyData",
  "runtimePoliticalTopology",
  "runtimePoliticalMetaSeed",
  "runtimePoliticalFeatureCollectionSeed",
  "scenarioLandMaskData",
  "scenarioContextLandMaskData",
  "scenarioWaterRegionsData",
  "scenarioAtlantropaData",
  "scenarioSpecialRegionsData",
  "scenarioReliefOverlaysData",
  "scenarioDistrictGroupsData",
  "scenarioDistrictGroupByFeatureId",
  "releasableCatalog",
  "scenarioReleasableIndex",
  "scenarioBaselineHash",
  "scenarioBaselineOwnersByFeatureId",
  "sovereigntyByFeatureId",
  "countryNames",
  "topologyDetail",
  "topologyBundleMode",
  "detailDeferred",
  "detailPromotionCompleted",
  "detailPromotionInFlight",
  "detailSourceRequested",
  "scenarioParentBorderEnabledBeforeActivate",
  "scenarioDisplaySettingsBeforeActivate",
  "scenarioOceanFillBeforeActivate",
  "scenarioOceanStyleBeforeActivate",
  "scenarioPresentationStyleBeforeActivate",
  "showScenarioAtlantropa",
  "locales",
  "geoAliasToStableKey",
]);

function captureScenarioTransactionState(model) {
  const presentKeys = SCENARIO_ATOMIC_AUTHORITY_KEYS.filter(
    (key) => Object.prototype.hasOwnProperty.call(model, key),
  );
  const values = Object.fromEntries(
    presentKeys.map((key) => [
      key,
      cloneScenarioTransactionValue(model[key]),
    ]),
  );
  return { values, presentKeys };
}

function restoreScenarioTransactionState(model, snapshot) {
  const presentKeys = new Set(snapshot.presentKeys);
  SCENARIO_ATOMIC_AUTHORITY_KEYS.forEach((key) => {
    if (!presentKeys.has(key)) {
      delete model[key];
    }
  });
  Object.entries(snapshot.values).forEach(([key, value]) => {
    model[key] = cloneScenarioTransactionValue(value);
  });
}

function createRawStrategicValuesPayload() {
  return {
    version: 1,
    scenario_id: "hoi4_test",
    baseline_hash: "abc123",
    metrics: {
      steel: { kind: "additive", min: 0, max: 20, p95: 20 },
    },
    buckets: {
      s1: { state_id: 1, owner_tag: "POL", steel: 20 },
    },
    bucket_by_feature: {
      "POL-A": "s1",
    },
    victory_points: [
      {
        province_id: 3544,
        value: 25,
        state_id: 1,
        owner_tag: "POL",
        name: "Warsaw",
        host_feature_id: "POL-A",
      },
    ],
    resource_points: {
      type: "FeatureCollection",
      features: [],
    },
    diagnostics: {
      vp_total: 1,
      vp_matched: 1,
    },
  };
}

async function readJsonFixture(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

function normalizeOwnerCodeForTest(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{1,15}$/.test(code) ? code : "";
}

function addOwnerCodeForTest(target, value) {
  const code = normalizeOwnerCodeForTest(value);
  if (code) {
    target.add(code);
  }
}

function collectTnoRuntimePoliticalOwnerCodes({
  countriesPayload,
  ownersPayload,
  runtimeTopologyPayload,
  countryNames = {},
  baseTopologyPayload = null,
}) {
  const codes = new Set();
  Object.keys(countriesPayload?.countries || {}).forEach((tag) => addOwnerCodeForTest(codes, tag));
  Object.keys(countryNames || {}).forEach((tag) => addOwnerCodeForTest(codes, tag));
  Object.values(ownersPayload?.owners || {}).forEach((tag) => addOwnerCodeForTest(codes, tag));
  const collectTopologyCodes = (topologyPayload) => {
    const geometries = Array.isArray(topologyPayload?.objects?.political?.geometries)
      ? topologyPayload.objects.political.geometries
      : [];
    geometries.forEach((geometry) => {
      const props = geometry?.properties || {};
      [
        props.cntr_code,
        props.CNTR_CODE,
        props.country_code,
        props.countryCode,
        props.iso_a2,
        props.ISO_A2,
        props.iso_a2_eh,
        props.ISO_A2_EH,
        props.adm0_a2,
        props.ADM0_A2,
        props.scenario_shell_owner_hint,
        props.scenario_shell_controller_hint,
      ].forEach((value) => addOwnerCodeForTest(codes, value));
    });
  };
  collectTopologyCodes(runtimeTopologyPayload);
  collectTopologyCodes(baseTopologyPayload);
  return [...codes].sort();
}

test("scenario apply staging rejects unrenderable political runtime topology before commit", async () => {
  const runtimeState = createBaseState({ activeScenarioId: "previous" });
  const pipeline = createScenarioApplyPipeline({
    runtimeState,
    countryNames: {},
    normalizeScenarioId: (value) => String(value || "").trim(),
    scenarioSupportsChunkedRuntime: () => false,
    scenarioBundleUsesChunkedLayer: () => false,
    scenarioBundleHasChunkedData: () => false,
    prepareScenarioDetailTopologyState: async () =>
      createScenarioReadinessStageResult(runtimeState),
    hasUsablePoliticalTopology: () => true,
    scenarioNeedsDetailTopology: () => false,
    getScenarioDisplayName: () => "Sample",
    getScenarioTargetPaletteId: () => "default",
    hasActiveScenarioPaletteLoaded: () => true,
    applyActivePaletteState: () => {},
    setActivePaletteSource: async () => true,
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
    getScenarioBaselineHashFromBundle: () => "baseline",
    markLegacyColorStateDirty: () => {},
    syncScenarioInspectorSelection: () => {},
    disableScenarioParentBorders: () => {},
    applyScenarioPaintMode: () => {},
    syncScenarioOceanFillForActivation: () => {},
    applyScenarioPerformanceHints: () => {},
    scheduleScenarioChunkRefresh: () => {},
    resetScenarioChunkRuntimeState: () => {},
    ensureRuntimeChunkLoadState: () => ({}),
    hasRenderableScenarioPoliticalTopology: () => false,
    normalizeScenarioFeatureCollection: (value) => value,
    cloneScenarioStateValue: (value) => value,
  });

  await assert.rejects(
    pipeline.prepareScenarioApplyState({
      manifest: { scenario_id: "sample" },
      countriesPayload: { countries: { AAA: { display_name: "Alpha", color_hex: "#111111" } } },
      ownersPayload: { owners: { "1": "AAA" } },
      coresPayload: { cores: { "1": ["AAA"] } },
      runtimeTopologyPayload: {
        type: "Topology",
        objects: { political: { type: "GeometryCollection", geometries: [] } },
        arcs: [],
      },
    }, { syncPalette: false }),
    /runtime topology is not renderable/,
  );
  assert.equal(runtimeState.activeScenarioId, "previous");
  assert.equal(runtimeState.scenarioRuntimeTopologyData?.id, "scenario-runtime");
});

test("scenario prepare leaves readiness, palette, and observer state unchanged", async () => {
  const model = createBaseState({
    topologyDetail: null,
    topologyBundleMode: "single",
    detailDeferred: true,
    detailPromotionCompleted: false,
    detailPromotionInFlight: false,
    detailSourceRequested: "detail-before",
    activePaletteId: "palette-before",
    activePaletteMeta: { id: "palette-before" },
    activePalettePack: { id: "pack-before" },
    activePaletteMap: { AAA: "#111111" },
    currentPaletteTheme: "theme-before",
  });
  const observerEvents = [];
  const paletteStageOptions = [];
  const pipeline = createApplyPipelineForRuntimeTest(model, {
    prepareScenarioDetailTopologyState: async () => ({
      detailPromoted: true,
      scenarioReadinessPatch: {
        topologyDetail: { id: "prepared-detail" },
        topologyBundleMode: "composite",
        detailDeferred: false,
        detailPromotionCompleted: true,
        detailPromotionInFlight: false,
        detailSourceRequested: "detail-prepared",
      },
    }),
    hasActiveScenarioPaletteLoaded: () =>
      Boolean(model.__paletteLoaded),
    setActivePaletteSource: async (_paletteId, options) => {
      paletteStageOptions.push(options);
      model.activePaletteId = "palette-prepared";
      model.activePaletteMeta = { id: "palette-prepared" };
      model.activePalettePack = { id: "pack-prepared" };
      model.activePaletteMap = { AAA: "#abcdef" };
      model.currentPaletteTheme = "theme-prepared";
      model.__paletteLoaded = true;
      return true;
    },
    syncScenarioLocalizationState: () => observerEvents.push("localization"),
    applyBlankScenarioPresentationDefaults: () => observerEvents.push("presentation"),
    setScenarioAuditUiState: () => observerEvents.push("audit"),
  });
  const before = captureScenarioPrepareAuthorityState(model);

  await pipeline.prepareScenarioApplyState(
    createScenarioApplyBundleForRuntimeTest("prepare_atomic"),
    { syncPalette: true },
  );

  assert.deepEqual(captureScenarioPrepareAuthorityState(model), before);
  assert.deepEqual(observerEvents, []);
  assert.equal(paletteStageOptions.length, 1);
  assert.equal(paletteStageOptions[0]?.syncUI, false);
  assert.equal(paletteStageOptions[0]?.publishObservers, false);
  assert.equal(paletteStageOptions[0]?.syncDefaultPalette, false);
});

test("scenario palette publication waits for a validated commit and rollback keeps the previous default palette and UI", async () => {
  await withAppStateRestoredAsync(async () => {
    const previousDefaultPalette = { ...defaultCountryPalette };
    const paletteEvents = [];
    const listeners = [
      [
        STATE_BUS_EVENTS.RENDER_PALETTE,
        subscribeStateBusEvent(
          STATE_BUS_EVENTS.RENDER_PALETTE,
          (theme) => paletteEvents.push(`render:${theme}`),
        ),
      ],
      [
        STATE_BUS_EVENTS.UPDATE_PALETTE_LIBRARY,
        subscribeStateBusEvent(
          STATE_BUS_EVENTS.UPDATE_PALETTE_LIBRARY,
          () => paletteEvents.push("library"),
        ),
      ],
      [
        STATE_BUS_EVENTS.UPDATE_PALETTE_SOURCE,
        subscribeStateBusEvent(
          STATE_BUS_EVENTS.UPDATE_PALETTE_SOURCE,
          () => paletteEvents.push("source"),
        ),
      ],
    ];
    const applyPaletteBaseline = () => {
      applyAppStatePatch(createBaseState({
        activePaletteId: "palette-before",
        activePaletteMeta: { palette_id: "palette-before" },
        activePalettePack: { entries: {} },
        activePaletteMap: {},
        currentPaletteTheme: "Palette Before",
        fixedPaletteColorsByIso2: { AA: "#111111" },
        resolvedDefaultCountryPalette: { AA: "#111111" },
        paletteLibraryEntries: [],
        paletteQuickSwatches: [],
        paletteLoadErrorById: {},
        legendLabels: [],
        legendConfig: {},
      }));
      defaultCountryPalette.AA = "#111111";
    };
    const configurePaletteStage = () => ({
      hasActiveScenarioPaletteLoaded: () =>
        appState.activePaletteId === "palette-after",
      setActivePaletteSource: async () => {
        appState.activePaletteId = "palette-after";
        appState.activePaletteMeta = { palette_id: "palette-after" };
        appState.activePalettePack = {
          entries: { AAA: { map_hex: "#abcdef" } },
        };
        appState.activePaletteMap = { AAA: { iso2: "AA" } };
        appState.currentPaletteTheme = "Palette After";
        appState.fixedPaletteColorsByIso2 = { AA: "#abcdef" };
        appState.paletteLibraryEntries = [{ id: "AAA" }];
        appState.paletteQuickSwatches = ["#abcdef"];
        return true;
      },
      publishScenarioPaletteAndToolbarState,
    });

    try {
      applyPaletteBaseline();
      const phaseEvents = [];
      const successPipeline = createApplyPipelineForRuntimeTest(appState, {
        ...configurePaletteStage(),
        validateScenarioActivationCommitState: () => {
          phaseEvents.push("validate");
          assert.equal(appState.currentPaletteTheme, "Palette Before");
          assert.equal(defaultCountryPalette.AA, "#111111");
          assert.deepEqual(paletteEvents, []);
          return true;
        },
      });
      const successBundle =
        createScenarioApplyBundleForRuntimeTest("palette-success");
      const successStaged = await successPipeline.prepareScenarioApplyState(
        successBundle,
        { syncPalette: true },
      );
      assert.deepEqual(phaseEvents, []);
      assert.deepEqual(paletteEvents, []);
      assert.equal(defaultCountryPalette.AA, "#111111");

      successPipeline.applyPreparedScenarioState(
        successBundle,
        successStaged,
      );
      assert.deepEqual(phaseEvents, ["validate"]);
      assert.deepEqual(paletteEvents, [
        "render:Palette After",
        "library",
        "source",
      ]);
      assert.equal(appState.currentPaletteTheme, "Palette After");
      assert.equal(defaultCountryPalette.AA, "#abcdef");

      paletteEvents.length = 0;
      applyPaletteBaseline();
      const rollbackPipeline = createApplyPipelineForRuntimeTest(appState, {
        ...configurePaletteStage(),
        markLegacyColorStateDirty: () => {
          throw new Error("post-commit rollback");
        },
      });
      const rollbackBundle =
        createScenarioApplyBundleForRuntimeTest("palette-rollback");
      const rollbackStaged = await rollbackPipeline.prepareScenarioApplyState(
        rollbackBundle,
        { syncPalette: true },
      );
      assert.throws(
        () => rollbackPipeline.applyPreparedScenarioState(
          rollbackBundle,
          rollbackStaged,
        ),
        /post-commit rollback/,
      );
      assert.equal(appState.currentPaletteTheme, "Palette Before");
      assert.equal(defaultCountryPalette.AA, "#111111");
      assert.deepEqual(paletteEvents, []);
    } finally {
      listeners.forEach(([eventName, listener]) => {
        off(eventName, listener);
      });
      Object.keys(defaultCountryPalette).forEach((key) => {
        delete defaultCountryPalette[key];
      });
      Object.assign(defaultCountryPalette, previousDefaultPalette);
    }
  });
});

test("real scenario detail staging returns a readiness patch without focus, UI, overlay, or default-topology publication", async () => {
  const {
    prepareScenarioDetailTopologyState,
  } = await import("../js/core/scenario_manager.js");
  const events = [];
  const model = createBaseState({
    activeScenarioId: "",
    topologyDetail: null,
    runtimePoliticalTopology: null,
    defaultRuntimePoliticalTopology: { id: "default-before" },
    topologyBundleMode: "single",
    detailDeferred: true,
    detailPromotionCompleted: false,
    detailPromotionInFlight: false,
    detailSourceRequested: "detail-before",
    runtimeChunkLoadState: {
      focusCountryOverride: "FR",
      focusCountryOverrideSource: "before",
      focusCountryOverrideExpiresAt: 123,
    },
  });
  model.updateScenarioUIFn = () => events.push("ui");
  model.scheduleScenarioChunkRefreshFn = () => events.push("focus");

  const result = await prepareScenarioDetailTopologyState({
    targetState: model,
    loadDetailBundle: async () => ({
      topologyDetail: { objects: { political: { id: "detail" } } },
      runtimePoliticalTopology: { objects: { political: { id: "runtime" } } },
      topologyBundleMode: "composite",
      detailSourceUsed: "prepared-source",
    }),
    hasUsableTopology: (value) => !!value?.objects?.political,
    detailSourceFallbackOrder: ["fallback"],
  });

  assert.equal(result.detailPromoted, true);
  assert.deepEqual(result.scenarioReadinessPatch, {
    topologyDetail: { objects: { political: { id: "detail" } } },
    topologyBundleMode: "composite",
    detailDeferred: false,
    detailPromotionCompleted: true,
    detailPromotionInFlight: false,
    detailSourceRequested: "prepared-source",
  });
  assert.equal(model.topologyDetail, null);
  assert.equal(model.runtimePoliticalTopology, null);
  assert.deepEqual(model.defaultRuntimePoliticalTopology, { id: "default-before" });
  assert.deepEqual(model.runtimeChunkLoadState, {
    focusCountryOverride: "FR",
    focusCountryOverrideSource: "before",
    focusCountryOverrideExpiresAt: 123,
  });
  assert.deepEqual(events, []);

  const runtimeFallback = {
    objects: { political: { id: "runtime-fallback" } },
  };
  const fallbackResult = await prepareScenarioDetailTopologyState({
    targetState: {
      ...model,
      topologyDetail: null,
      runtimePoliticalTopology: null,
      topologyBundleMode: "single",
    },
    loadDetailBundle: async () => ({
      topologyDetail: null,
      runtimePoliticalTopology: runtimeFallback,
      topologyBundleMode: "single",
      detailSourceUsed: "runtime-fallback-source",
    }),
    hasUsableTopology: (value) => !!value?.objects?.political,
    detailSourceFallbackOrder: ["fallback"],
  });
  assert.equal(fallbackResult.detailPromoted, true);
  assert.equal(fallbackResult.scenarioReadinessPatch.topologyBundleMode, "composite");
  assert.equal(
    fallbackResult.scenarioReadinessPatch.topologyDetail,
    runtimeFallback,
  );

  const unavailableResult = await prepareScenarioDetailTopologyState({
    targetState: {
      ...model,
      topologyDetail: null,
      runtimePoliticalTopology: null,
      topologyBundleMode: "single",
    },
    loadDetailBundle: async () => ({
      topologyDetail: null,
      runtimePoliticalTopology: null,
      detailSourceUsed: null,
    }),
    hasUsableTopology: (value) => !!value?.objects?.political,
    detailSourceFallbackOrder: ["fallback"],
  });
  assert.equal(unavailableResult.detailPromoted, false);
  assert.equal(unavailableResult.scenarioReadinessPatch.detailDeferred, false);
  assert.equal(
    unavailableResult.scenarioReadinessPatch.detailPromotionInFlight,
    false,
  );
});

test("real scenario detail staging preserves unexpected loader failure diagnostics", async () => {
  const {
    prepareScenarioDetailTopologyState,
  } = await import("../js/core/scenario_manager.js");
  const cause = Object.assign(new Error("detail decoder exploded"), {
    code: "DETAIL_DECODER_BUG",
  });

  await assert.rejects(
    prepareScenarioDetailTopologyState({
      targetState: createBaseState({
        topologyDetail: null,
        runtimePoliticalTopology: null,
        topologyBundleMode: "single",
        detailDeferred: true,
        detailPromotionCompleted: false,
        detailPromotionInFlight: false,
        detailSourceRequested: "requested-source",
      }),
      loadDetailBundle: async () => {
        throw cause;
      },
      hasUsableTopology: (value) => !!value?.objects?.political,
      detailSourceFallbackOrder: ["fallback-a", "fallback-b"],
    }),
    (error) => {
      assert.equal(error.code, "SCENARIO_DETAIL_TOPOLOGY_STAGING_FAILED");
      assert.equal(error.cause, cause);
      assert.deepEqual(error.detailSourceKeys, [
        "requested-source",
        "fallback-a",
        "fallback-b",
      ]);
      assert.match(error.message, /requested-source, fallback-a, fallback-b/);
      return true;
    },
  );
});

test("real palette staging flags suppress default palette, render, library UI, and source-control observers", async () => {
  await withAppStateRestoredAsync(async () => {
    const previousDefaultPalette = { ...defaultCountryPalette };
    const events = [];
    try {
      applyAppStatePatch({
        activePaletteId: "before",
        activePaletteMeta: null,
        activePalettePack: null,
        activePaletteMap: null,
        currentPaletteTheme: "Before",
        paletteRegistry: {
          palettes: [{
            palette_id: "prepared",
            display_name: "Prepared",
          }],
        },
        palettePackCacheById: {
          prepared: {
            entries: {
              AAA: { map_hex: "#123456" },
            },
            quick_tags: ["AAA"],
          },
        },
        paletteMapCacheById: {
          prepared: {
            mapped: {
              AAA: { iso2: "AA" },
            },
          },
        },
        paletteLoadErrorById: {},
        renderPaletteFn: () => events.push("render"),
        updatePaletteLibraryUIFn: () => events.push("library-ui"),
        updatePaletteSourceUIFn: () => events.push("source-ui"),
      });

      const applied = await setActivePaletteSource("prepared", {
        syncUI: false,
        publishObservers: false,
        syncDefaultPalette: false,
        overwriteCountryPalette: false,
      });

      assert.equal(applied, true);
      assert.deepEqual(events, []);
      assert.deepEqual(defaultCountryPalette, previousDefaultPalette);
      applyActivePaletteState({
        overwriteCountryPalette: false,
        syncDefaultPalette: false,
      });
      assert.deepEqual(defaultCountryPalette, previousDefaultPalette);
    } finally {
      Object.keys(defaultCountryPalette).forEach((key) => {
        delete defaultCountryPalette[key];
      });
      Object.assign(defaultCountryPalette, previousDefaultPalette);
    }
  });
});

test("scenario activation validator failure commits no state and publishes no observers", async () => {
  const model = createBaseState({
    activeScenarioId: "before-validator",
    runtimePoliticalMetaSeed: { id: "meta-before" },
    runtimePoliticalFeatureCollectionSeed: { id: "features-before" },
    scenarioAtlantropaData: { id: "atlantropa-before" },
  });
  const observerEvents = [];
  const pipeline = createApplyPipelineForRuntimeTest(model, {
    validateScenarioActivationCommitState: () => {
      throw new Error("injected activation validator failure");
    },
    syncScenarioLocalizationState: () => observerEvents.push("localization"),
    setScenarioAuditUiState: () => observerEvents.push("audit"),
    markLegacyColorStateDirty: () => observerEvents.push("legacy-color"),
  });
  const bundle = createScenarioApplyBundleForRuntimeTest("validator_target");
  const staged = await pipeline.prepareScenarioApplyState(bundle, { syncPalette: false });
  const before = captureScenarioTransactionState(model);

  assert.throws(
    () => pipeline.applyPreparedScenarioState(bundle, staged),
    /injected activation validator failure/,
  );
  assert.deepEqual(captureScenarioTransactionState(model), before);
  assert.deepEqual(observerEvents, []);
});

test("scenario activation restores the complete snapshot when a post-commit observer throws", async () => {
  const model = createBaseState({
    activeScenarioId: "before-observer",
    runtimePoliticalMetaSeed: { id: "meta-before" },
    runtimePoliticalFeatureCollectionSeed: { id: "features-before" },
    scenarioAtlantropaData: { id: "atlantropa-before" },
    scenarioPresentationStyleBeforeActivate: undefined,
    showScenarioAtlantropa: false,
    topologyDetail: { id: "detail-before" },
    topologyBundleMode: "composite",
    detailDeferred: false,
    detailPromotionCompleted: true,
    detailPromotionInFlight: false,
    detailSourceRequested: "detail-before",
  });
  delete model.scenarioPresentationStyleBeforeActivate;
  const pipeline = createApplyPipelineForRuntimeTest(model, {
    captureScenarioActivationTransactionState: () => captureScenarioTransactionState(model),
    restoreScenarioActivationTransactionState: (snapshot) => {
      restoreScenarioTransactionState(model, snapshot);
    },
    validateScenarioActivationCommitState: () => true,
    markLegacyColorStateDirty: () => {
      throw new Error("injected post-commit observer failure");
    },
  });
  const bundle = createScenarioApplyBundleForRuntimeTest("observer_target");
  const staged = await pipeline.prepareScenarioApplyState(bundle, { syncPalette: false });
  const before = captureScenarioTransactionState(model);

  assert.throws(
    () => pipeline.applyPreparedScenarioState(bundle, staged),
    /injected post-commit observer failure/,
  );
  assert.deepEqual(captureScenarioTransactionState(model), before);
  assert.equal(
    Object.prototype.hasOwnProperty.call(model, "scenarioPresentationStyleBeforeActivate"),
    false,
  );
});

test("default activation rollback restores localization, audit, and blank defaults with absent-key semantics", async () => {
  const model = createBaseState({
    activeScenarioId: "before-default-observer",
    mapSemanticMode: "political",
  });
  [
    "scenarioGeoLocalePatchData",
    "scenarioCityOverridesData",
    "cityLayerRevision",
    "scenarioAuditUi",
    "locales",
    "geoAliasToStableKey",
    "showCityPoints",
  ].forEach((key) => {
    delete model[key];
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
    markLegacyColorStateDirty: () => {
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

test("deferred scenario metadata fake timer fences old scenario, epoch, and request while accepting the current request", async () => {
  const {
    scheduleScenarioDeferredBundleMetadataLoad,
  } = await import("../js/core/scenario_resources.js");
  const originalSetTimeout = globalThis.setTimeout;
  const originalFetch = globalThis.fetch;
  const runCase = async ({
    scheduledScenarioId = "alpha",
    scheduledEpoch = 10,
    scheduledRequestId = 20,
    activeScenarioId = scheduledScenarioId,
    currentEpoch = scheduledEpoch,
    currentRequestId = scheduledRequestId,
    expectedApplied,
  }) => withAppStateRestoredAsync(async () => {
    let timerCallback = null;
    globalThis.setTimeout = (callback) => {
      timerCallback = callback;
      return 1;
    };
    applyAppStatePatch({
      activeScenarioId,
      currentScenarioApplyRequestId: currentRequestId,
      renderTransactionDiagnostics: {
        scenarioApplyEpochByScenarioId: {
          [activeScenarioId]: currentEpoch,
        },
      },
      scenarioDistrictGroupsData: { id: "before" },
      scenarioDistrictGroupByFeatureId: new Map([["before", "before"]]),
    });
    const bundle = {
      bundleLevel: "full",
      manifest: {
        scenario_id: scheduledScenarioId,
        district_groups_url: `/data/${scheduledScenarioId}/districts.json`,
      },
      loadDiagnostics: {
        optionalResources: {
          district_groups: {},
        },
      },
    };
    scheduleScenarioDeferredBundleMetadataLoad(bundle, {
      d3Client: {
        json: async () => ({
          scenario_id: scheduledScenarioId,
          tags: {
            AAA: {
              districts: {
                d1: {
                  feature_ids: ["feature-1"],
                },
              },
            },
          },
        }),
      },
      scenarioApplyEpoch: scheduledEpoch,
      scenarioApplyRequestId: scheduledRequestId,
      isScenarioApplyRequestCurrent: () => true,
    });
    assert.equal(typeof timerCallback, "function");
    await timerCallback();
    await bundle.deferredMetadataLoadPromise;
    assert.equal(
      appState.scenarioDistrictGroupsData?.scenario_id === scheduledScenarioId,
      expectedApplied,
    );
  });

  try {
    globalThis.fetch = async (url) => {
      const scenarioId = /\/data\/([^/]+)\//.exec(String(url || ""))?.[1] || "";
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          scenario_id: scenarioId,
          tags: {
            AAA: {
              districts: {
                d1: {
                  feature_ids: ["feature-1"],
                },
              },
            },
          },
        }),
      };
    };
    await runCase({
      activeScenarioId: "beta",
      expectedApplied: false,
    });
    await runCase({
      currentEpoch: 11,
      expectedApplied: false,
    });
    await runCase({
      currentRequestId: 21,
      expectedApplied: false,
    });
    await runCase({
      expectedApplied: true,
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("deferred scenario metadata shares one fetch while a same-scenario retry owns the current commit lease", async () => {
  const {
    scheduleScenarioDeferredBundleMetadataLoad,
  } = await import("../js/core/scenario_resources.js");
  const originalSetTimeout = globalThis.setTimeout;
  const originalFetch = globalThis.fetch;

  try {
    await withAppStateRestoredAsync(async () => {
      let deferredTimerCallback = null;
      let fetchCount = 0;
      let commitCount = 0;
      globalThis.setTimeout = (callback, delayMs) => {
        if (Number(delayMs) === 1200 && !deferredTimerCallback) {
          deferredTimerCallback = callback;
        }
        return 1;
      };
      globalThis.fetch = async () => {
        fetchCount += 1;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            scenario_id: "beta",
            tags: {
              BBB: {
                districts: {
                  retry: {
                    feature_ids: ["feature-retry"],
                  },
                },
              },
            },
          }),
        };
      };
      applyAppStatePatch({
        activeScenarioId: "beta",
        currentScenarioApplyRequestId: 20,
        renderTransactionDiagnostics: {
          scenarioApplyEpochByScenarioId: {
            beta: 10,
          },
        },
        scenarioDistrictGroupsData: { id: "before" },
        scenarioDistrictGroupByFeatureId: new Map([["before", "before"]]),
        updateScenarioUIFn: () => {
          commitCount += 1;
        },
      });
      const bundle = {
        bundleLevel: "full",
        manifest: {
          scenario_id: "beta",
          district_groups_url: "/data/beta/districts.json",
        },
        loadDiagnostics: {
          optionalResources: {
            district_groups: {},
          },
        },
      };
      const firstCommit = scheduleScenarioDeferredBundleMetadataLoad(bundle, {
        d3Client: { json: async () => null },
        scenarioApplyEpoch: 10,
        scenarioApplyRequestId: 20,
        isScenarioApplyRequestCurrent: () =>
          Number(appState.currentScenarioApplyRequestId || 0) === 20,
      });

      applyAppStatePatch({
        currentScenarioApplyRequestId: 21,
        renderTransactionDiagnostics: {
          scenarioApplyEpochByScenarioId: {
            beta: 11,
          },
        },
      });
      const retryCommit = scheduleScenarioDeferredBundleMetadataLoad(bundle, {
        d3Client: { json: async () => null },
        scenarioApplyEpoch: 11,
        scenarioApplyRequestId: 21,
        isScenarioApplyRequestCurrent: () =>
          Number(appState.currentScenarioApplyRequestId || 0) === 21,
      });

      assert.equal(typeof deferredTimerCallback, "function");
      await deferredTimerCallback();
      await Promise.all([
        bundle.deferredMetadataLoadPromise,
        firstCommit,
        retryCommit,
      ]);

      assert.equal(fetchCount, 1);
      assert.equal(
        String(appState.scenarioDistrictGroupsData?.scenario_id || ""),
        "beta",
      );
      assert.equal(
        appState.scenarioDistrictGroupByFeatureId.get("feature-retry"),
        "retry",
      );
      assert.equal(commitCount, 1);

      applyAppStatePatch({
        currentScenarioApplyRequestId: 22,
        renderTransactionDiagnostics: {
          scenarioApplyEpochByScenarioId: {
            beta: 12,
          },
        },
        scenarioDistrictGroupsData: { id: "before-settled-retry" },
        scenarioDistrictGroupByFeatureId: new Map(),
      });
      const settledRetryResult = await scheduleScenarioDeferredBundleMetadataLoad(bundle, {
        d3Client: { json: async () => null },
        scenarioApplyEpoch: 12,
        scenarioApplyRequestId: 22,
        isScenarioApplyRequestCurrent: () =>
          Number(appState.currentScenarioApplyRequestId || 0) === 22,
      });
      assert.equal(settledRetryResult, true);
      assert.equal(fetchCount, 1);
      assert.equal(
        String(appState.scenarioDistrictGroupsData?.scenario_id || ""),
        "beta",
      );
      assert.equal(commitCount, 2);

      const observerError = Object.assign(new Error("scenario UI observer failed"), {
        code: "UI_OBSERVER_FAIL",
      });
      applyAppStatePatch({
        currentScenarioApplyRequestId: 23,
        renderTransactionDiagnostics: {
          scenarioApplyEpochByScenarioId: {
            beta: 13,
          },
        },
        scenarioDistrictGroupsData: { id: "before-observer-failure" },
        scenarioDistrictGroupByFeatureId: new Map(),
        updateScenarioUIFn: () => {
          throw observerError;
        },
      });
      const originalConsoleWarn = console.warn;
      const observerWarnings = [];
      let observerFailureResult = null;
      try {
        console.warn = (...args) => observerWarnings.push(args);
        observerFailureResult = await scheduleScenarioDeferredBundleMetadataLoad(bundle, {
          d3Client: { json: async () => null },
          scenarioApplyEpoch: 13,
          scenarioApplyRequestId: 23,
          isScenarioApplyRequestCurrent: () =>
            Number(appState.currentScenarioApplyRequestId || 0) === 23,
        });
      } finally {
        console.warn = originalConsoleWarn;
      }
      assert.equal(observerFailureResult, false);
      assert.equal(observerWarnings.length, 1);
      assert.equal(observerWarnings[0][1], observerError);
      assert.equal(
        String(appState.scenarioDistrictGroupsData?.scenario_id || ""),
        "beta",
      );
      assert.equal(
        String(appState.renderTransactionDiagnostics?.latestSnapshot?.phase || ""),
        "scenario-apply-deferred-metadata-commit-failed",
      );
      assert.equal(
        String(
          appState.renderTransactionDiagnostics?.latestSnapshot?.extra?.errorCode
          || "",
        ),
        "UI_OBSERVER_FAIL",
      );
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("deferred scenario metadata upgrades an ambient same-request lease with the manager currentness fence", async () => {
  const {
    scheduleScenarioDeferredBundleMetadataLoad,
  } = await import("../js/core/scenario_resources.js");
  const originalSetTimeout = globalThis.setTimeout;
  const originalFetch = globalThis.fetch;

  try {
    await withAppStateRestoredAsync(async () => {
      let deferredTimerCallback = null;
      globalThis.setTimeout = (callback, delayMs) => {
        if (Number(delayMs) === 1200 && !deferredTimerCallback) {
          deferredTimerCallback = callback;
        }
        return 1;
      };
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          scenario_id: "alpha",
          tags: {
            AAA: {
              districts: {
                stale: {
                  feature_ids: ["feature-stale"],
                },
              },
            },
          },
        }),
      });
      applyAppStatePatch({
        activeScenarioId: "alpha",
        currentScenarioApplyRequestId: 20,
        renderTransactionDiagnostics: {
          scenarioApplyEpochByScenarioId: {
            alpha: 10,
          },
        },
        scenarioDistrictGroupsData: { id: "before" },
        scenarioDistrictGroupByFeatureId: new Map([["before", "before"]]),
      });
      const bundle = {
        bundleLevel: "full",
        manifest: {
          scenario_id: "alpha",
          district_groups_url: "/data/alpha/districts.json",
        },
        loadDiagnostics: {
          optionalResources: {
            district_groups: {},
          },
        },
      };

      scheduleScenarioDeferredBundleMetadataLoad(bundle, {
        d3Client: { json: async () => null },
        scenarioApplyEpoch: 10,
        scenarioApplyRequestId: 20,
      });
      const explicitLease = scheduleScenarioDeferredBundleMetadataLoad(bundle, {
        d3Client: { json: async () => null },
        scenarioApplyEpoch: 10,
        scenarioApplyRequestId: 20,
        isScenarioApplyRequestCurrent: () => false,
      });

      assert.equal(typeof deferredTimerCallback, "function");
      await deferredTimerCallback();
      await Promise.all([
        bundle.deferredMetadataLoadPromise,
        explicitLease,
      ]);

      assert.equal(
        String(appState.scenarioDistrictGroupsData?.id || ""),
        "before",
      );
      assert.equal(
        appState.scenarioDistrictGroupByFeatureId.get("feature-stale"),
        undefined,
      );
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("scenario apply commit state does not reuse stale live topology for bad non blank runtime topology", () => {
  const staleTopology = { objects: { political: { stale: true } } };
  const defaultTopologyAtBuild = { objects: { political: { defaultAtBuild: true } } };
  const defaultTopologyAtCommit = { objects: { political: { defaultAtCommit: true } } };
  const unrenderableTopology = {
    type: "Topology",
    objects: { political: { type: "GeometryCollection", geometries: [] } },
    arcs: [],
  };
  const runtimeState = createBaseState({
    activeScenarioId: "previous",
    defaultRuntimePoliticalTopology: defaultTopologyAtBuild,
    runtimePoliticalTopology: staleTopology,
    scenarioRuntimeTopologyData: { id: "previous-scenario-runtime" },
  });
  const pipeline = createApplyPipelineForRuntimeTest(runtimeState, {
    hasRenderableScenarioPoliticalTopology: () => false,
    validateScenarioActivationCommitState: (activationPatch) => {
      assert.equal(
        activationPatch.useDefaultRuntimePoliticalTopology,
        true,
      );
      assert.equal(activationPatch.runtimePoliticalTopology, null);
      runtimeState.defaultRuntimePoliticalTopology = defaultTopologyAtCommit;
      return true;
    },
  });

  pipeline.applyPreparedScenarioState({
    manifest: { scenario_id: "sample" },
  }, {
    scenarioId: "sample",
    defaultCountryCode: "AAA",
    baseCountryMap: {},
    mapSemanticMode: "political",
    countryMap: { AAA: { tag: "AAA" } },
    runtimeTopologyPayload: unrenderableTopology,
    runtimeVersionTag: "sample:bad-topology",
    districtGroupsPayload: null,
    scenarioWaterRegionsFromTopology: null,
    scenarioSpecialRegionsFromTopology: null,
    scenarioAtlantropaFromTopology: null,
    scenarioContextLandMaskFromTopology: null,
    scenarioLandMaskFromTopology: null,
    scenarioReliefOverlaysPayload: null,
    scenarioCityOverridesPayload: null,
    scenarioStrategicValuesPayload: null,
    scenarioNameMap: { AAA: "Alpha" },
    scenarioColorMap: { AAA: "#111111" },
    scenarioGeneratedColorTags: [],
    coarseColorMap: null,
    scenarioOwnerBackfill: {},
    resolvedOwners: { "POL-A": "AAA" },
    cores: { "POL-A": ["AAA"] },
    releasableIndex: {},
    scenarioParentBorderEnabledBeforeActivate: null,
    scenarioDisplaySettingsBeforeActivate: null,
    scenarioOceanFillBeforeActivate: null,
    scenarioManifest: { scenario_id: "sample" },
  });

  assert.equal(runtimeState.activeScenarioId, "sample");
  assert.equal(runtimeState.runtimePoliticalTopology, defaultTopologyAtCommit);
  assert.equal(runtimeState.scenarioRuntimeTopologyData, null);
});

test("scenario apply normalizes bundled strategic values before commit", async () => {
  const runtimeState = createBaseState({
    activeScenarioId: "",
    scenarioStrategicValuesData: null,
    scenarioStrategicValuesRevision: 0,
  });
  const pipeline = createApplyPipelineForRuntimeTest(runtimeState);
  const bundle = {
    manifest: {
      scenario_id: "hoi4_test",
      baseline_hash: "abc123",
    },
    countriesPayload: { countries: { AAA: { display_name: "Alpha", color_hex: "#111111" } } },
    ownersPayload: { owners: { "POL-A": "AAA" } },
    coresPayload: { cores: { "POL-A": ["AAA"] } },
    runtimeTopologyPayload: createRenderableScenarioTopology(),
    strategicValuesPayload: createRawStrategicValuesPayload(),
  };

  const staged = await pipeline.prepareScenarioApplyState(bundle, { syncPalette: false });
  pipeline.applyPreparedScenarioState(bundle, staged);

  assert.equal(runtimeState.scenarioStrategicValuesData.bucketByFeature["POL-A"], "s1");
  assert.equal(runtimeState.scenarioStrategicValuesData.victoryPointsByFeature["POL-A"][0].name, "Warsaw");
  assert.equal(runtimeState.scenarioStrategicValuesData.resourcePoints.type, "FeatureCollection");
  assert.equal(runtimeState.scenarioStrategicValuesRevision, 1);
});

test("scenario apply includes external political owner codes in base color mirrors", async () => {
  const ownerCodes = ["CF", "CG", "CM", "CY", "EH", "GA", "MT", "TW", "VA"];
  const runtimeState = createBaseState({
    activeScenarioId: "",
    activePalettePack: {
      entries: {
        CAF: { map_hex: "#224466" },
        CMR: { map_hex: "#335577" },
        MLT: { map_hex: "#446688" },
        TWN: { map_hex: "#557799" },
      },
    },
    activePaletteMap: {
      mapped: {
        CAF: { iso2: "CF" },
        CMR: { iso2: "CM" },
        MLT: { iso2: "MT" },
        TWN: { iso2: "TW" },
      },
    },
  });
  const pipeline = createApplyPipelineForRuntimeTest(runtimeState, {
    getScenarioFixedOwnerColors: () => ({
      AAA: "#111111",
      GER: "#222222",
    }),
  });
  const runtimeTopologyPayload = {
    type: "Topology",
    objects: {
      political: {
        type: "GeometryCollection",
        geometries: ownerCodes.map((code, index) => ({
          type: "Polygon",
          id: index,
          arcs: [],
          properties: {
            id: code,
            cntr_code: code,
            scenario_shell_owner_hint: code === "VA" ? "VA" : "",
          },
        })),
      },
    },
    arcs: [],
  };
  const staged = await pipeline.prepareScenarioApplyState({
    manifest: {
      scenario_id: "tno_sample",
      baseline_hash: "abc123",
    },
    countriesPayload: {
      countries: {
        AAA: { display_name: "Alpha", color_hex: "#111111" },
        GER: { display_name: "Germany", color_hex: "#222222", base_iso2: "DE", lookup_iso2: "DE" },
      },
    },
    ownersPayload: {
      owners: {
        "feature-owned-by-cg": "CG",
      },
    },
    coresPayload: { cores: {} },
    runtimeTopologyPayload,
  }, { syncPalette: false });

  pipeline.applyPreparedScenarioState({ manifest: { scenario_id: "tno_sample" } }, staged);

  assert.equal(runtimeState.sovereignBaseColors.AAA, "#111111");
  assert.equal(runtimeState.sovereignBaseColors.GER, "#222222");
  for (const code of ownerCodes) {
    assert.match(runtimeState.sovereignBaseColors[code], /^#[0-9a-f]{6}$/);
    assert.equal(runtimeState.countryBaseColors[code], runtimeState.sovereignBaseColors[code]);
  }
  assert.equal(runtimeState.sovereignBaseColors.CF, "#224466");
  assert.equal(runtimeState.sovereignBaseColors.CM, "#335577");
  assert.equal(runtimeState.sovereignBaseColors.MT, "#446688");
  assert.equal(runtimeState.sovereignBaseColors.TW, "#557799");
  assert.deepEqual([...runtimeState.scenarioGeneratedColorTags].sort(), ["CG", "CY", "EH", "GA", "VA"]);
});

test("scenario apply gives every TNO 1962 runtime political owner code a base color", async () => {
  const [
    manifest,
    countriesPayload,
    ownersPayload,
    runtimeTopologyPayload,
    baseTopologyPayload,
    palettePack,
    paletteMap,
  ] = await Promise.all([
    readJsonFixture("../data/scenarios/tno_1962/manifest.json"),
    readJsonFixture("../data/scenarios/tno_1962/countries.json"),
    readJsonFixture("../data/scenarios/tno_1962/owners.by_feature.json"),
    readJsonFixture("../data/scenarios/tno_1962/runtime_topology.topo.json"),
    readJsonFixture("../data/europe_topology.json"),
    readJsonFixture("../data/palettes/tno.palette.json"),
    readJsonFixture("../data/palette-maps/tno.map.json"),
  ]);
  const runtimeState = createBaseState({
    activeScenarioId: "",
    activePalettePack: palettePack,
    activePaletteMap: paletteMap,
    topology: baseTopologyPayload,
    topologyPrimary: baseTopologyPayload,
  });
  const pipeline = createApplyPipelineForRuntimeTest(runtimeState, {
    countryNames: appState.countryNames,
    getScenarioDefaultCountryCode: () => "GER",
    getScenarioFixedOwnerColors: (countryMap = {}) => {
      const colors = {};
      Object.entries(countryMap || {}).forEach(([tag, entry]) => {
        const code = normalizeOwnerCodeForTest(tag);
        const color = String(entry?.color_hex || entry?.colorHex || "").trim().toLowerCase();
        if (code && /^#[0-9a-f]{6}$/.test(color)) {
          colors[code] = color;
        }
      });
      return colors;
    },
    buildScenarioRuntimeVersionTag: () => "tno_1962:runtime-topology",
  });
  const bundle = {
    manifest,
    countriesPayload,
    ownersPayload,
    coresPayload: { cores: {} },
    runtimeTopologyPayload,
  };
  const ownerCodes = collectTnoRuntimePoliticalOwnerCodes({
    countriesPayload,
    ownersPayload,
    runtimeTopologyPayload,
    countryNames: appState.countryNames,
    baseTopologyPayload,
  });

  const staged = await pipeline.prepareScenarioApplyState(bundle, { syncPalette: false });
  pipeline.applyPreparedScenarioState(bundle, staged);

  assert.ok(ownerCodes.length > 300, `unexpected TNO owner universe size: ${ownerCodes.length}`);
  for (const code of ["CF", "CG", "CM", "CY", "EH", "GA", "MT", "TW", "VA"]) {
    assert.ok(ownerCodes.includes(code), `${code} absent from TNO owner universe fixture`);
  }
  const missingSovereignColors = ownerCodes
    .filter((code) => !/^#[0-9a-f]{6}$/.test(String(runtimeState.sovereignBaseColors?.[code] || "")));
  const missingCountryColors = ownerCodes
    .filter((code) => !/^#[0-9a-f]{6}$/.test(String(runtimeState.countryBaseColors?.[code] || "")));
  assert.deepEqual(missingSovereignColors.slice(0, 20), [], `missing sovereign colors: ${missingSovereignColors.slice(0, 20).join(", ")}`);
  assert.equal(missingSovereignColors.length, 0);
  assert.deepEqual(missingCountryColors.slice(0, 20), [], `missing country colors: ${missingCountryColors.slice(0, 20).join(", ")}`);
  assert.equal(missingCountryColors.length, 0);
});

test("blank scenario apply preserves ownerless editable runtime topology", async () => {
  const defaultTopology = { objects: { political: { default: true } } };
  const runtimeState = createBaseState({
    activeScenarioId: "",
    defaultRuntimePoliticalTopology: defaultTopology,
    runtimePoliticalTopology: defaultTopology,
  });
  const phaseEvents = [];
  const ownerlessBlankTopology = {
    type: "Topology",
    objects: {
      political: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Polygon",
            arcs: [[[0]]],
            properties: { id: "BLANK-1", name: "Blank Parcel" },
          },
        ],
      },
    },
    arcs: [],
  };
  const pipeline = createScenarioApplyPipeline({
    runtimeState,
    countryNames: {},
    normalizeScenarioId: (value) => String(value || "").trim(),
    scenarioSupportsChunkedRuntime: () => false,
    scenarioBundleUsesChunkedLayer: () => false,
    scenarioBundleHasChunkedData: () => false,
    prepareScenarioDetailTopologyState: async () =>
      createScenarioReadinessStageResult(runtimeState),
    hasUsablePoliticalTopology: () => true,
    scenarioNeedsDetailTopology: () => false,
    getScenarioDisplayName: () => "Blank",
    getScenarioTargetPaletteId: () => "default",
    hasActiveScenarioPaletteLoaded: () => true,
    applyActivePaletteState: () => {},
    setActivePaletteSource: async () => true,
    getScenarioDefaultCountryCode: () => "",
    getScenarioMapSemanticMode: () => "blank",
    buildScenarioReleasableIndex: () => ({}),
    getScenarioReleasableCountries: () => ({}),
    normalizeScenarioCoreMap: (value) => value || {},
    normalizeScenarioDistrictGroupsPayload: () => null,
    getActiveScenarioMergedChunkLayerPayload: () => undefined,
    getScenarioDecodedCollection: () => null,
    getScenarioTopologyFeatureCollection: () => null,
    getScenarioNameMap: () => ({}),
    getMissingScenarioNameTags: () => [],
    getScenarioFixedOwnerColors: () => ({}),
    buildHoi4FarEastSovietOwnerBackfill: () => ({}),
    buildScenarioRuntimeVersionTag: () => "blank:sha",
    mergeReleasableCatalogs: () => null,
    buildScenarioDistrictGroupByFeatureId: () => new Map(),
    validateScenarioActivationCommitState: (nextState, transactionPatch) => {
      phaseEvents.push(`validate:${runtimeState.activeScenarioId}->${nextState.activeScenarioId}`);
      assert.equal(nextState.useDefaultRuntimePoliticalTopology, false);
      assert.equal(nextState.runtimePoliticalTopology, ownerlessBlankTopology);
      assert.equal(
        transactionPatch.scenarioPresentationPatch.activeSovereignCode,
        "",
      );
      return true;
    },
    syncScenarioLocalizationState: () => phaseEvents.push(`observer:localization:${runtimeState.activeScenarioId}`),
    applyBlankScenarioPresentationDefaults: () => phaseEvents.push(`observer:blank:${runtimeState.activeScenarioId}`),
    setScenarioAuditUiState: () => phaseEvents.push(`observer:audit:${runtimeState.activeScenarioId}`),
    getScenarioBaselineHashFromBundle: () => "blank-baseline",
    markLegacyColorStateDirty: () => phaseEvents.push(`post:legacy:${runtimeState.activeScenarioId}`),
    syncScenarioInspectorSelection: (code) => phaseEvents.push(`post:inspector:${runtimeState.activeScenarioId}:${code}`),
    disableScenarioParentBorders: () => phaseEvents.push(`post:borders:${runtimeState.activeScenarioId}`),
    applyScenarioPaintMode: () => phaseEvents.push(`post:paint:${runtimeState.activeScenarioId}`),
    syncScenarioOceanFillForActivation: () => phaseEvents.push(`post:ocean:${runtimeState.activeScenarioId}`),
    applyScenarioPerformanceHints: () => phaseEvents.push(`post:performance:${runtimeState.activeScenarioId}`),
    scheduleScenarioChunkRefresh: () => {},
    resetScenarioChunkRuntimeState: () => phaseEvents.push(`post:chunks:${runtimeState.activeScenarioId}`),
    ensureRuntimeChunkLoadState: () => ({}),
    hasRenderableScenarioPoliticalTopology: () => true,
    normalizeScenarioFeatureCollection: (value) => value,
    cloneScenarioStateValue: (value) => value,
  });

  const staged = await pipeline.prepareScenarioApplyState({
    manifest: { scenario_id: "blank_base", map_mode: "blank" },
    countriesPayload: { countries: {} },
    ownersPayload: { owners: {} },
    coresPayload: { cores: {} },
    runtimeTopologyPayload: ownerlessBlankTopology,
  }, { syncPalette: false });
  pipeline.applyPreparedScenarioState({ manifest: { scenario_id: "blank_base", map_mode: "blank" } }, staged);

  assert.equal(runtimeState.activeScenarioId, "blank_base");
  assert.equal(runtimeState.runtimePoliticalTopology, ownerlessBlankTopology);
  assert.equal(runtimeState.activeSovereignCode, "");
  assert.deepEqual(runtimeState.sovereigntyByFeatureId, {});
  assert.deepEqual(phaseEvents, [
    "validate:->blank_base",
    "observer:localization:blank_base",
    "observer:blank:blank_base",
    "observer:audit:blank_base",
    "post:legacy:blank_base",
    "post:inspector:blank_base:",
    "post:borders:blank_base",
    "post:paint:blank_base",
    "post:ocean:blank_base",
    "post:performance:blank_base",
    "post:chunks:blank_base",
  ]);
});

test("scenario style defaults restore captures the pre-activation baseline after apply commit", () => {
  const runtimeState = createBaseState({
    activeScenarioManifest: {
      style_defaults: {
        coastlines: {
          width: 0.8,
        },
        empireBorders: {
          opacity: 0.4,
        },
        ocean: {
          fillColor: "#2d4769",
          preset: "flat",
          experimentalAdvancedStyles: false,
        },
      },
    },
    scenarioOceanFillBeforeActivate: "#123456",
    scenarioOceanStyleBeforeActivate: null,
    styleConfig: {
      coastlines: {
        color: "#333333",
        opacity: 0.8,
        width: 1.2,
      },
      empireBorders: {
        color: "#666666",
        opacity: 0.9,
        width: 1,
      },
      ocean: {
        fillColor: "#123456",
        preset: "bathymetry_soft",
        experimentalAdvancedStyles: true,
      },
    },
  });
  const invalidationReasons = [];
  const runtime = createScenarioOceanFillRestoreRuntime({
    state: runtimeState,
    invalidateOceanBackgroundVisualState: (reason) => invalidationReasons.push(reason),
  });

  runtime.syncScenarioOceanFillForActivation(runtimeState.activeScenarioManifest);

  assert.deepEqual(runtimeState.scenarioOceanStyleBeforeActivate, {
    fillColor: "#123456",
    preset: "bathymetry_soft",
    experimentalAdvancedStyles: true,
  });
  assert.deepEqual(runtimeState.scenarioPresentationStyleBeforeActivate, {
    coastlines: {
      color: "#333333",
      opacity: 0.8,
      width: 1.2,
    },
    empireBorders: {
      color: "#666666",
      opacity: 0.9,
      width: 1,
    },
    ocean: {
      fillColor: "#123456",
      preset: "bathymetry_soft",
      experimentalAdvancedStyles: true,
    },
  });
  assert.deepEqual(runtimeState.styleConfig.coastlines, {
    color: "#333333",
    opacity: 0.8,
    width: 0.8,
  });
  assert.deepEqual(runtimeState.styleConfig.empireBorders, {
    color: "#666666",
    opacity: 0.4,
    width: 1,
  });
  assert.deepEqual(runtimeState.styleConfig.ocean, {
    fillColor: "#2d4769",
    preset: "flat",
    experimentalAdvancedStyles: false,
  });

  runtime.restoreScenarioOceanFillAfterExit();

  assert.deepEqual(runtimeState.styleConfig.coastlines, {
    color: "#333333",
    opacity: 0.8,
    width: 1.2,
  });
  assert.deepEqual(runtimeState.styleConfig.empireBorders, {
    color: "#666666",
    opacity: 0.9,
    width: 1,
  });
  assert.deepEqual(runtimeState.styleConfig.ocean, {
    fillColor: "#123456",
    preset: "bathymetry_soft",
    experimentalAdvancedStyles: true,
  });
  assert.equal(runtimeState.scenarioOceanFillBeforeActivate, null);
  assert.equal(runtimeState.scenarioOceanStyleBeforeActivate, null);
  assert.equal(runtimeState.scenarioPresentationStyleBeforeActivate, null);
  assert.deepEqual(invalidationReasons, [
    "scenario-style-defaults-activate",
    "scenario-style-defaults-clear",
  ]);
});

test("scenario style defaults extend their baseline and stay scoped across scenario switches", () => {
  const baselineStyle = {
    coastlines: {
      color: "#333333",
      extensionJoin: "round",
      opacity: 0.8,
      width: 1.2,
    },
    empireBorders: {
      color: "#666666",
      extensionDash: [2, 1],
      opacity: 0.9,
      width: 1,
    },
    ocean: {
      extensionTone: "legacy-import",
      fillColor: "#123456",
      preset: "bathymetry_soft",
      experimentalAdvancedStyles: true,
    },
  };
  const tnoManifest = {
    style_defaults: {
      ocean: {
        fillColor: "#345678",
      },
    },
  };
  const blankManifest = {
    style_defaults: {
      coastlines: {
        width: 0.8,
      },
      empireBorders: {
        opacity: 0.4,
      },
      ocean: {
        fillColor: "#2d4769",
      },
    },
  };
  const runtimeState = createBaseState({
    scenarioOceanFillBeforeActivate: null,
    scenarioOceanStyleBeforeActivate: null,
    scenarioPresentationStyleBeforeActivate: null,
    styleConfig: structuredClone(baselineStyle),
  });
  const runtime = createScenarioOceanFillRestoreRuntime({ state: runtimeState });

  runtime.syncScenarioOceanFillForActivation(tnoManifest);
  assert.deepEqual(runtimeState.scenarioPresentationStyleBeforeActivate, {
    ocean: baselineStyle.ocean,
  });
  assert.equal(runtimeState.styleConfig.ocean.extensionTone, "legacy-import");

  runtime.syncScenarioOceanFillForActivation(blankManifest);
  assert.deepEqual(runtimeState.scenarioPresentationStyleBeforeActivate, baselineStyle);
  assert.equal(runtimeState.styleConfig.coastlines.extensionJoin, "round");
  assert.deepEqual(runtimeState.styleConfig.empireBorders.extensionDash, [2, 1]);
  assert.equal(runtimeState.styleConfig.ocean.extensionTone, "legacy-import");
  assert.equal(runtimeState.styleConfig.coastlines.width, 0.8);
  assert.equal(runtimeState.styleConfig.empireBorders.opacity, 0.4);
  assert.equal(runtimeState.styleConfig.ocean.fillColor, "#2d4769");

  runtime.syncScenarioOceanFillForActivation(tnoManifest);
  assert.deepEqual(runtimeState.styleConfig.coastlines, baselineStyle.coastlines);
  assert.deepEqual(runtimeState.styleConfig.empireBorders, baselineStyle.empireBorders);
  assert.equal(runtimeState.styleConfig.ocean.extensionTone, "legacy-import");
  assert.equal(runtimeState.styleConfig.ocean.fillColor, "#345678");

  runtime.restoreScenarioOceanFillAfterExit();
  assert.deepEqual(runtimeState.styleConfig, baselineStyle);
  assert.equal(runtimeState.scenarioOceanFillBeforeActivate, null);
  assert.equal(runtimeState.scenarioOceanStyleBeforeActivate, null);
  assert.equal(runtimeState.scenarioPresentationStyleBeforeActivate, null);
});

test("clearActiveScenario restores deferred coarse baseline when detail topology is still pending", () => {
  const runtimeState = createBaseState({
    topologyDetail: null,
    defaultRuntimePoliticalTopology: { objects: { political: {} } },
    topologyBundleMode: "composite",
    detailDeferred: false,
    detailPromotionCompleted: true,
  });
  const runtime = createLifecycleRuntime(runtimeState);

  runtime.clearActiveScenario({ renderNow: false, markDirtyReason: "" });

  assert.equal(runtimeState.activeScenarioId, "");
  assert.equal(runtimeState.topologyBundleMode, "single");
  assert.equal(runtimeState.detailDeferred, true);
  assert.equal(runtimeState.detailPromotionCompleted, false);
  assert.deepEqual(runtimeState.runtimePoliticalTopology, runtimeState.defaultRuntimePoliticalTopology);
});

test("clearActiveScenario keeps composite mode when baseline detail topology is already loaded", () => {
  const runtimeState = createBaseState({
    topologyDetail: { objects: { political: {} } },
    defaultRuntimePoliticalTopology: { objects: { political: {} } },
    topologyBundleMode: "composite",
    detailDeferred: false,
    detailPromotionCompleted: true,
  });
  const runtime = createLifecycleRuntime(runtimeState);

  runtime.clearActiveScenario({ renderNow: false, markDirtyReason: "" });

  assert.equal(runtimeState.topologyBundleMode, "composite");
  assert.equal(runtimeState.detailDeferred, false);
  assert.equal(runtimeState.detailPromotionCompleted, true);
});

test("clearActiveScenario restores exact health defaults before display restore and post-clear effects", () => {
  const targetState = createBaseState({
    scenarioHydrationHealthGate: { status: "stale", checkedAt: 99 },
    scenarioDataHealth: { expectedFeatureCount: 12, minRatio: 0.75 },
    activeScenarioPerformanceHints: { renderProfileDefault: "performance" },
  });
  const observed = [];
  const runtime = createLifecycleRuntime(targetState, {
    restoreScenarioDisplaySettingsAfterExit: () => {
      observed.push({
        phase: "display",
        gate: targetState.scenarioHydrationHealthGate,
        dataHealth: targetState.scenarioDataHealth,
      });
      targetState.activeScenarioPerformanceHints = null;
    },
    runPostScenarioClearEffects: () => {
      observed.push({
        phase: "post-clear",
        hints: targetState.activeScenarioPerformanceHints,
      });
    },
  });

  runtime.clearActiveScenario({ renderNow: false, markDirtyReason: "" });

  assert.equal(targetState.scenarioHydrationHealthGate.checkedAt, 0);
  assert.deepEqual(observed.map(({ phase }) => phase), ["display", "post-clear"]);
  assert.equal(observed[0].gate.status, "idle");
  assert.equal(observed[0].gate.checkedAt, 0);
  assert.deepEqual(observed[0].dataHealth, {
    expectedFeatureCount: 0,
    runtimeFeatureCount: 0,
    ratio: 1,
    minRatio: 0.75,
    generatedColorTags: [],
    warning: "",
    severity: "",
  });
  assert.equal(observed[1].hints, null);
});

test("resetToScenarioBaseline restores ownership before UI refresh side effects", () => {
  const runtimeState = createBaseState({
    sovereigntyByFeatureId: { A: "DE", B: "DE" },
  });
  const seenOwners = [];
  const runtime = createLifecycleRuntime(runtimeState, {
    runPostScenarioResetEffects: () => {
      seenOwners.push(runtimeState.sovereigntyByFeatureId.A);
    },
  });

  const changed = runtime.resetToScenarioBaseline({
    renderNow: false,
    markDirtyReason: "",
    showToastOnComplete: false,
  });

  assert.equal(changed, true);
  assert.deepEqual(seenOwners, ["FR"]);
  assert.deepEqual(runtimeState.sovereigntyByFeatureId, { A: "FR", B: "DE" });
});

test("scenario data health uses chunked political payload as the expected feature count", () => {
  const health = withAppStatePatch({
    activeScenarioManifest: {
      scenario_id: "hoi4_1939",
      detail_chunk_manifest_url: "data/scenarios/hoi4_1939/detail_chunks.manifest.json",
      summary: { feature_count: 2200 },
    },
    landDataFull: { type: "FeatureCollection", features: createFeatures(1210) },
    landData: { type: "FeatureCollection", features: createFeatures(1190) },
    runtimePoliticalTopology: null,
    scenarioPoliticalChunkData: { type: "FeatureCollection", features: createFeatures(1200) },
    scenarioPoliticalVisibleChunkData: { type: "FeatureCollection", features: createFeatures(20) },
    activeScenarioChunks: {
      mergedLayerPayloads: {
        political: { type: "FeatureCollection", features: createFeatures(1200) },
      },
    },
    scenarioGeneratedColorTags: [],
  }, () => evaluateScenarioDataHealth(appState.activeScenarioManifest, { minRatio: 0.7 }));

  assert.equal(health.expectedFeatureCount, 1200);
  assert.equal(health.runtimeFeatureCount, 1210);
  assert.ok(health.ratio >= 1);
  assert.equal(health.warning, "");
  assert.equal(health.severity, "");
});

test("scenario status uses a healthy live evaluation after a coarse warning settles", async () => {
  const { formatScenarioStatusText } = await import("../js/core/scenario_manager.js");
  withAppStatePatch({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      display_name: "TNO 1962",
      detail_chunk_manifest_url: "data/scenarios/tno_1962/detail_chunks.manifest.json",
      summary: { feature_count: 1200 },
    },
    landDataFull: { type: "FeatureCollection", features: createFeatures(1210) },
    landData: { type: "FeatureCollection", features: createFeatures(1200) },
    runtimePoliticalTopology: null,
    scenarioPoliticalChunkData: { type: "FeatureCollection", features: createFeatures(1200) },
    scenarioPoliticalVisibleChunkData: null,
    activeScenarioChunks: {
      scenarioId: "tno_1962",
      mergedLayerPayloads: {
        political: { type: "FeatureCollection", features: createFeatures(1200) },
      },
    },
    scenarioDataHealth: {
      warning: "Detail topology not fully loaded; scenario is shown in coarse mode.",
      minRatio: 0.7,
    },
    scenarioHydrationHealthGate: null,
    scenarioGeneratedColorTags: [],
  }, () => {
    const status = formatScenarioStatusText();
    assert.doesNotMatch(status, /Detail topology not fully loaded/);
  });
});

test("scenario rollback restores visible political data and advances scene data identity", () => withAppStateRestored(() => {
  const oldFullData = { type: "FeatureCollection", features: [{ id: "old-full", properties: {}, geometry: null }] };
  const oldVisibleData = { type: "FeatureCollection", features: [{ id: "old-visible", properties: {}, geometry: null }] };
  const failedFullData = { type: "FeatureCollection", features: [{ id: "failed-full", properties: {}, geometry: null }] };
  const failedVisibleData = { type: "FeatureCollection", features: [{ id: "failed-visible", properties: {}, geometry: null }] };

  appState.activeScenarioId = "old_scenario";
  appState.sceneScenarioId = "old_scenario";
  appState.sceneGeneration = 4;
  appState.scenarioDataGeneration = 10;
  appState.scenarioPoliticalChunkData = oldFullData;
  appState.scenarioPoliticalVisibleChunkData = oldVisibleData;
  appState.runtimeChunkLoadState = {
    refreshTimerId: null,
    promotionTimerId: null,
    promotionScheduled: false,
    promotionCommitInFlight: false,
  };

  const rollbackSnapshot = captureScenarioApplyRollbackSnapshot();

  appState.activeScenarioId = "failed_scenario";
  appState.sceneScenarioId = "failed_scenario";
  appState.sceneGeneration = 5;
  appState.scenarioDataGeneration = 11;
  appState.scenarioPoliticalChunkData = failedFullData;
  appState.scenarioPoliticalVisibleChunkData = failedVisibleData;
  const failedIdentity = createPoliticalRasterWorkerIdentity({
    sceneGeneration: appState.sceneGeneration,
    scenarioDataGeneration: appState.scenarioDataGeneration,
    scenarioId: appState.activeScenarioId,
    selectionVersion: 1,
    topologyRevision: 1,
    colorRevision: 1,
    transformBucket: "1:0:0",
    dpr: 1,
    viewport: { x: 0, y: 0, width: 10, height: 10, right: 10, bottom: 10 },
    passSignature: "political-failed",
  });

  restoreScenarioApplyRollbackSnapshot(rollbackSnapshot);

  assert.equal(readAppStateValue("activeScenarioId"), "old_scenario");
  assert.deepEqual(
    readAppStateValue("scenarioPoliticalChunkData")
      .features.map((feature) => feature.id),
    ["old-full"],
  );
  assert.deepEqual(
    readAppStateValue("scenarioPoliticalVisibleChunkData")
      .features.map((feature) => feature.id),
    ["old-visible"],
  );
  assert.equal(readAppStateValue("scenarioDataGeneration"), 12);
  assert.equal(
    readAppStateValue("scenarioDataGenerationReason"),
    "scenario-rollback",
  );
  assert.equal(readAppStateValue("sceneGeneration"), 6);
  assert.equal(
    readAppStateValue("sceneGenerationReason"),
    "scenario-rollback",
  );
  assert.equal(readAppStateValue("sceneScenarioId"), "old_scenario");

  const restoredIdentity = createPoliticalRasterWorkerIdentity({
    sceneGeneration: readAppStateValue("sceneGeneration"),
    scenarioDataGeneration:
      readAppStateValue("scenarioDataGeneration"),
    scenarioId: readAppStateValue("activeScenarioId"),
    selectionVersion: 1,
    topologyRevision: 1,
    colorRevision: 1,
    transformBucket: "1:0:0",
    dpr: 1,
    viewport: { x: 0, y: 0, width: 10, height: 10, right: 10, bottom: 10 },
    passSignature: "political-failed",
  });
  assert.equal(isPoliticalRasterWorkerResultCurrent(failedIdentity, restoredIdentity), false);
}));

test("scenario rollback round trip deeply isolates health and performance state", () => withAppStateRestored(() => {
  const originalGate = {
    status: "healthy",
    checkedAt: 73,
    diagnostics: { overlap: { matched: 9, expected: 10 } },
  };
  const originalDataHealth = {
    expectedFeatureCount: 10,
    runtimeFeatureCount: 9,
    ratio: 0.9,
    minRatio: 0.75,
    generatedColorTags: ["AA"],
    warning: "",
    severity: "",
    diagnostics: { source: { id: "before-health" } },
  };
  const originalPerformanceHints = {
    renderProfileDefault: "performance",
    renderBudgetHints: { contextLayers: ["cities", "roads"] },
  };
  const expectedGate = structuredClone(originalGate);
  const expectedDataHealth = structuredClone(originalDataHealth);
  const expectedPerformanceHints = structuredClone(originalPerformanceHints);

  applyAppStatePatch({
    scenarioHydrationHealthGate: originalGate,
    scenarioDataHealth: originalDataHealth,
    activeScenarioPerformanceHints: originalPerformanceHints,
  });
  const rollbackSnapshot = captureScenarioApplyRollbackSnapshot();

  originalGate.diagnostics.overlap.matched = 0;
  originalDataHealth.diagnostics.source.id = "mutated-after-capture";
  originalPerformanceHints.renderBudgetHints.contextLayers.push("ports");
  applyAppStatePatch({
    scenarioHydrationHealthGate: { status: "failed", checkedAt: 999 },
    scenarioDataHealth: { warning: "failed" },
    activeScenarioPerformanceHints: { renderProfileDefault: "quality" },
  });

  restoreScenarioApplyRollbackSnapshot(rollbackSnapshot);

  assert.deepEqual(
    readAppStateValue("scenarioHydrationHealthGate"),
    expectedGate,
  );
  assert.deepEqual(
    readAppStateValue("scenarioDataHealth"),
    expectedDataHealth,
  );
  assert.deepEqual(
    readAppStateValue("activeScenarioPerformanceHints"),
    expectedPerformanceHints,
  );
  assert.notEqual(readAppStateValue("scenarioHydrationHealthGate"), originalGate);
  assert.notEqual(readAppStateValue("scenarioDataHealth"), originalDataHealth);
  assert.notEqual(
    readAppStateValue("activeScenarioPerformanceHints"),
    originalPerformanceHints,
  );
}));

test("scenario rollback keeps required health and performance keys explicit when capture inputs are absent", () => withAppStateRestored(() => {
  const requiredKeys = [
    "scenarioHydrationHealthGate",
    "scenarioDataHealth",
    "activeScenarioPerformanceHints",
  ];
  deleteAppStateKeys(requiredKeys);
  const rollbackSnapshot = captureScenarioApplyRollbackSnapshot();

  applyAppStatePatch({
    scenarioHydrationHealthGate: { status: "failed" },
    scenarioDataHealth: { warning: "failed" },
    activeScenarioPerformanceHints: { renderProfileDefault: "quality" },
  });
  restoreScenarioApplyRollbackSnapshot(rollbackSnapshot);

  requiredKeys.forEach((key) => assert.equal(hasAppStateKey(key), true));
  assert.deepEqual(
    readAppStateValue("scenarioHydrationHealthGate"),
    createDefaultScenarioHydrationHealthGate(),
  );
  assert.equal(readAppStateValue("scenarioDataHealth"), undefined);
  assert.equal(readAppStateValue("activeScenarioPerformanceHints"), undefined);
}));

function assertScenarioRollbackRestoresSentinels({
  beforeValues,
  failedValues,
  absentKeys = [],
}) {
  return withAppStateRestored(() => {
    applyAppStatePatch(beforeValues);
    deleteAppStateKeys(absentKeys);
    const rollbackSnapshot = captureScenarioApplyRollbackSnapshot();

    applyAppStatePatch(failedValues);
    restoreScenarioApplyRollbackSnapshot(rollbackSnapshot);

    for (const [key, value] of Object.entries(beforeValues)) {
      assert.deepEqual(
        readAppStateValue(key),
        value,
        `${key} should restore from the rollback snapshot`,
      );
    }
    absentKeys.forEach((key) => {
      assert.equal(
        hasAppStateKey(key),
        false,
        `${key} should be deleted when it was absent before the transaction`,
      );
    });
  });
}

test("scenario rollback restores activation seed and Atlantropa sentinels", () => {
  assertScenarioRollbackRestoresSentinels({
    beforeValues: {
      runtimePoliticalMetaSeed: { id: "meta-before" },
      runtimePoliticalFeatureCollectionSeed: { id: "features-before" },
      scenarioAtlantropaData: { id: "atlantropa-before" },
    },
    failedValues: {
      runtimePoliticalMetaSeed: { id: "meta-failed" },
      runtimePoliticalFeatureCollectionSeed: { id: "features-failed" },
      scenarioAtlantropaData: { id: "atlantropa-failed" },
    },
  });
});

test("scenario data health is committed before its warning toast is published", () => withAppStateRestored(() => {
  applyAppStatePatch({
    activeScenarioId: "large_scenario",
    activeScenarioManifest: { summary: { feature_count: 2500 } },
    landData: { type: "FeatureCollection", features: [{ id: "coarse" }] },
    landDataFull: null,
    runtimePoliticalTopology: null,
    scenarioGeneratedColorTags: ["AA"],
    scenarioDataHealth: null,
  });
  let toastCount = 0;
  let observedCommittedHealth = false;
  appState.showToastFn = () => {
    toastCount += 1;
    observedCommittedHealth = (
      appState.scenarioDataHealth?.severity === "error"
      && appState.scenarioDataHealth?.expectedFeatureCount === 2500
    );
  };
  try {
    const health = refreshScenarioDataHealth({ showWarningToast: true });
    assert.equal(toastCount, 1);
    assert.equal(observedCommittedHealth, true);
    assert.equal(health.severity, "error");
    assert.equal(health.expectedFeatureCount, 2500);
  } finally {
    appState.showToastFn = null;
  }
}));

test("scenario rollback restores detail readiness sentinels", () => {
  assertScenarioRollbackRestoresSentinels({
    beforeValues: {
      topologyDetail: { id: "detail-before" },
      topologyBundleMode: "composite",
      detailDeferred: false,
      detailPromotionCompleted: true,
      detailPromotionInFlight: false,
      detailSourceRequested: "detail-before",
    },
    failedValues: {
      topologyDetail: { id: "detail-failed" },
      topologyBundleMode: "single",
      detailDeferred: true,
      detailPromotionCompleted: false,
      detailPromotionInFlight: true,
      detailSourceRequested: "detail-failed",
    },
  });
});

test("scenario rollback restores presentation and localization sentinels including absent properties", () => {
  assertScenarioRollbackRestoresSentinels({
    beforeValues: {
      showScenarioAtlantropa: false,
      mapSemanticMode: "political",
      locales: { ui: { ready: "Before" }, geo: { AAA: "Alpha" } },
      geoAliasToStableKey: { alpha: "AAA" },
    },
    failedValues: {
      scenarioPresentationStyleBeforeActivate: { ocean: { fillColor: "#abcdef" } },
      showScenarioAtlantropa: true,
      mapSemanticMode: "blank",
      locales: { ui: { ready: "Failed" }, geo: {} },
      geoAliasToStableKey: { failed: "ZZZ" },
    },
    absentKeys: ["scenarioPresentationStyleBeforeActivate"],
  });
});

test("scenario data health accepts current coarse collections before chunk payload promotion", () => {
  const health = withAppStatePatch({
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      detail_chunk_manifest_url: "data/scenarios/tno_1962/detail_chunks.manifest.json",
      summary: { feature_count: 12865 },
    },
    landDataFull: { type: "FeatureCollection", features: createFeatures(209) },
    landData: { type: "FeatureCollection", features: createFeatures(198) },
    runtimePoliticalTopology: null,
    scenarioPoliticalChunkData: null,
    scenarioPoliticalVisibleChunkData: { type: "FeatureCollection", features: createFeatures(7) },
    activeScenarioChunks: {
      mergedLayerPayloads: {},
    },
    scenarioGeneratedColorTags: [],
  }, () => evaluateScenarioDataHealth(appState.activeScenarioManifest, { minRatio: 0.7 }));

  assert.equal(health.expectedFeatureCount, 209);
  assert.equal(health.runtimeFeatureCount, 209);
  assert.equal(health.warning, "");
  assert.equal(health.severity, "");
});

test("scenario data health keeps manifest totals for non-chunked topology checks", () => {
  const health = withAppStatePatch({
    activeScenarioManifest: {
      scenario_id: "legacy",
      summary: { feature_count: 2200 },
    },
    landDataFull: { type: "FeatureCollection", features: createFeatures(900) },
    landData: { type: "FeatureCollection", features: createFeatures(900) },
    runtimePoliticalTopology: null,
    scenarioPoliticalChunkData: { type: "FeatureCollection", features: createFeatures(1200) },
    activeScenarioChunks: {
      mergedLayerPayloads: {
        political: { type: "FeatureCollection", features: createFeatures(1200) },
      },
    },
    scenarioGeneratedColorTags: [],
  }, () => evaluateScenarioDataHealth(appState.activeScenarioManifest, { minRatio: 0.7 }));

  assert.equal(health.expectedFeatureCount, 2200);
  assert.equal(health.runtimeFeatureCount, 900);
  assert.equal(health.severity, "error");
});
