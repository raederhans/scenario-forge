import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createScenarioStartupHydrationController } from "../js/core/scenario/startup_hydration.js";
import {
  createStartupScenarioBootstrapCacheKey,
  createStartupScenarioBootstrapCoreCacheKey,
} from "../js/core/startup_cache.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(...segments) {
  return readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

function createMinimalHydrationController(state, overrides = {}) {
  return createScenarioStartupHydrationController({
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
    refreshScenarioOpeningOwnerBorders: () => false,
    flushRenderBoundary: () => {},
    enterScenarioFatalRecovery: () => {},
    consumeScenarioTestHook: () => false,
    t: (value) => value,
    showToast: () => {},
    ...overrides,
  });
}

for (const invalidation of ["request", "epoch"]) {
test(`health gate retry arriving after a new scenario ${invalidation} cannot change its recovery state`, async () => {
  let finishLoad;
  const state = {
    activeScenarioId: "sample",
    currentScenarioApplyRequestId: 1,
    renderTransactionDiagnostics: { scenarioApplyEpoch: 1 },
    landData: { type: "FeatureCollection", features: [] },
    sovereigntyByFeatureId: {},
    scenarioRuntimeTopologyVersionTag: "sample:missing-runtime-source-sha:runtime_topology_sha256",
  };
  const effects = [];
  const controller = createMinimalHydrationController(state, {
    getLoadScenarioBundle: () => () => new Promise((resolve) => { finishLoad = resolve; }),
    enterScenarioFatalRecovery: () => effects.push("fatal"),
    syncScenarioUi: () => effects.push("ui"),
    flushRenderBoundary: () => effects.push("render"),
  });
  const pending = controller.enforceScenarioHydrationHealthGate();
  assert.equal(typeof finishLoad, "function");
  if (invalidation === "request") state.currentScenarioApplyRequestId = 2;
  else state.renderTransactionDiagnostics.scenarioApplyEpoch = 2;
  state.scenarioHydrationHealthGate = { status: "new-request" };
  finishLoad({ manifest: { scenario_id: "sample" } });
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(state.scenarioHydrationHealthGate, { status: "new-request" });
  assert.deepEqual(effects, []);
});
}

test("startup shell-empty scenario political baseline cannot fall back to modern primary", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");

  assert.match(
    rendererSource,
    /const hasScenarioRuntimePoliticalSource = !!String\(runtimeState\.activeScenarioId \|\| ""\)\.trim\(\)\s*&& !!runtimeTopology\?\.objects\?\.political;/,
  );
  assert.match(
    rendererSource,
    /if \(runtimeBaseCollection\) \{[\s\S]*?fullCollection = runtimeBaseCollection;[\s\S]*?\} else if \(hasScenarioRuntimePoliticalSource\) \{[\s\S]*?fullCollection = \{ type: "FeatureCollection", features: \[\] \};[\s\S]*?\} else if \(primaryTopology\?\.objects\?\.political/,
  );
});

test("runtime version tag is driven by source sha metadata", () => {
  const { buildScenarioRuntimeVersionTag } = createMinimalHydrationController({ activeScenarioId: "sample" });
  const topology = { objects: { political: { geometries: [{ properties: { id: "A" } }] } } };

  assert.notEqual(
    buildScenarioRuntimeVersionTag({
      manifest: { scenario_id: "sample", baseline_hash: "same" },
      bundleLevel: "full",
      source: { runtime_topology_sha256: "sha-a" },
    }, topology),
    buildScenarioRuntimeVersionTag({
      manifest: { scenario_id: "sample", baseline_hash: "same" },
      bundleLevel: "full",
      source: { runtime_topology_sha256: "sha-b" },
    }, topology),
  );
  assert.equal(
    buildScenarioRuntimeVersionTag({
      manifest: { scenario_id: "sample", detail_chunk_manifest_url: "data/scenarios/sample/detail_chunks.manifest.json" },
      bundleLevel: "full",
      source: {
        runtime_bootstrap_topology_sha256: "bootstrap-sha",
        detail_chunk_manifest_sha256: "chunk-sha",
      },
    }, topology),
    "sample:bootstrap-sha:chunk-sha",
  );
});

test("missing runtime source sha enters hydration health gate", () => {
  const state = {
    activeScenarioId: "sample",
    landData: { type: "FeatureCollection", features: [] },
    sovereigntyByFeatureId: {},
    scenarioRuntimeTopologyVersionTag: "sample:missing-runtime-source-sha:runtime_topology_sha256",
  };
  const { evaluateScenarioHydrationHealthGateState } = createMinimalHydrationController(state);

  const result = evaluateScenarioHydrationHealthGateState();

  assert.equal(result.ok, false);
  assert.equal(result.overlayConsistency.reason, "missing-runtime-source-sha");
});

test("startup hydration marks unrenderable runtime topology as fatal and keeps readonly", () => {
  for (const initialSince of [4321, 0]) {
    const state = {
      activeScenarioId: "sample",
      startupReadonly: false,
      startupReadonlyReason: "",
      startupReadonlyUnlockInFlight: false,
      startupReadonlySince: initialSince,
      scenarioHydrationHealthGate: null,
    };
    const { hydrateActiveScenarioBundle } = createMinimalHydrationController(state);

    const hydrated = hydrateActiveScenarioBundle({
      manifest: { scenario_id: "sample" },
      runtimeTopologyPayload: {
        type: "Topology",
        objects: { political: { type: "GeometryCollection", geometries: [] } },
        arcs: [],
      },
    });

    assert.equal(hydrated, false);
    assert.equal(state.startupReadonly, true);
    assert.equal(state.startupReadonlyReason, "scenario-health-gate");
    assert.equal(state.startupReadonlySince, initialSince);
    assert.equal(state.scenarioHydrationHealthGate.status, "fatal");
    assert.equal(
      state.scenarioHydrationHealthGate.reason,
      "scenario-runtime-topology-unrenderable",
    );
  }
});

test("startup hydration allows blank scenario runtime topology shells", () => {
  const state = {
    activeScenarioId: "blank_base",
    startupReadonly: false,
    scenarioHydrationHealthGate: null,
    scenarioPoliticalChunkData: null,
    defaultReleasableCatalog: null,
  };
  const { hydrateActiveScenarioBundle } = createMinimalHydrationController(state);
  const blankTopology = {
    type: "Topology",
    objects: { political: { type: "GeometryCollection", geometries: [] } },
    arcs: [],
  };

  const hydrated = hydrateActiveScenarioBundle({
    manifest: { scenario_id: "blank_base", map_mode: "blank" },
    source: { runtime_topology_sha256: "blank-runtime" },
    bundleLevel: "full",
    runtimeTopologyPayload: blankTopology,
  });

  assert.equal(hydrated, true);
  assert.equal(state.startupReadonly, false);
  assert.equal(state.scenarioHydrationHealthGate, null);
  assert.equal(state.runtimePoliticalTopology, blankTopology);
});

test("startup hydration clears stale political chunk when runtime-only shell fallback arrives", () => {
  const originalTopojson = globalThis.topojson;
  const appliedPayloads = [];
  const promotionCalls = [];
  globalThis.topojson = {
    feature: (_topology, object) => ({
      type: "FeatureCollection",
      features: (object?.geometries || []).map((geometry) => ({
        type: "Feature",
        id: geometry?.id,
        properties: { ...(geometry?.properties || {}), id: geometry?.id },
        geometry: { type: "Polygon", coordinates: [] },
      })),
    }),
  };
  try {
    const shellTopology = {
      type: "Topology",
      objects: {
        political: {
          type: "GeometryCollection",
          geometries: [{
            id: "RU_ARCTIC_FB_ALT_001",
            properties: {
              id: "RU_ARCTIC_FB_ALT_001",
              scenario_helper_kind: "shell_fallback",
              render_as_base_geography: false,
            },
          }],
        },
      },
      arcs: [],
    };
    const shellCollection = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        id: "RU_ARCTIC_FB_ALT_001",
        properties: {
          id: "RU_ARCTIC_FB_ALT_001",
          scenario_helper_kind: "shell_fallback",
          render_as_base_geography: false,
        },
        geometry: { type: "Polygon", coordinates: [] },
      }],
    };
    const stalePoliticalChunk = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        id: "STALE_COUNTRY",
        properties: { id: "STALE_COUNTRY" },
        geometry: { type: "Polygon", coordinates: [] },
      }],
    };
    const state = {
      activeScenarioId: "tno_1962",
      startupReadonly: false,
      scenarioHydrationHealthGate: null,
      runtimePoliticalTopology: null,
      scenarioRuntimeTopologyData: null,
      scenarioPoliticalChunkData: stalePoliticalChunk,
      scenarioWaterRegionsData: null,
      scenarioSpecialRegionsData: null,
      scenarioAtlantropaData: null,
      scenarioLandMaskData: null,
      scenarioContextLandMaskData: null,
      scenarioWaterOverlayVersionTag: "",
      scenarioLandMaskVersionTag: "",
      scenarioContextLandMaskVersionTag: "",
      defaultReleasableCatalog: null,
    };
    const { hydrateActiveScenarioBundle } = createMinimalHydrationController(state, {
      getScenarioRuntimeMergedLayerPayloads: () => ({ political: shellCollection }),
      hasScenarioMergedLayerPayload: (_payloads, layerKey) => layerKey === "political",
      applyScenarioPoliticalChunkPayload: (_bundle, payload) => {
        appliedPayloads.push(payload);
        return false;
      },
      areScenarioFeatureCollectionsEquivalent: () => false,
      refreshMapDataForScenarioChunkPromotion: (options) => {
        promotionCalls.push(options);
      },
    });

    const hydrated = hydrateActiveScenarioBundle({
      manifest: { scenario_id: "tno_1962", map_mode: "ownership" },
      source: {
        runtime_bootstrap_topology_sha256: "bootstrap-sha",
        detail_chunk_manifest_sha256: "chunk-sha",
      },
      bundleLevel: "full",
      runtimeTopologyPayload: shellTopology,
    });

    assert.equal(hydrated, true);
    assert.equal(state.runtimePoliticalTopology, shellTopology);
    assert.equal(state.scenarioRuntimeTopologyData, shellTopology);
    assert.equal(state.scenarioPoliticalChunkData, null);
    assert.equal(appliedPayloads.length, 1);
    assert.equal(appliedPayloads[0], null);
    assert.equal(promotionCalls.length, 1);
    assert.equal(promotionCalls[0].hasPoliticalPayloadChange, true);
  } finally {
    globalThis.topojson = originalTopojson;
  }
});

test("startup hydration filters runtime-only shell fallback from mixed political payload", () => {
  const originalTopojson = globalThis.topojson;
  const appliedPayloads = [];
  globalThis.topojson = {
    feature: (_topology, object) => ({
      type: "FeatureCollection",
      features: (object?.geometries || []).map((geometry) => ({
        type: "Feature",
        id: geometry?.id,
        properties: { ...(geometry?.properties || {}), id: geometry?.id },
        geometry: { type: "Polygon", coordinates: [] },
      })),
    }),
  };
  try {
    const mixedTopology = {
      type: "Topology",
      objects: {
        political: {
          type: "GeometryCollection",
          geometries: [
            { id: "REAL_COUNTRY", properties: { id: "REAL_COUNTRY" } },
            {
              id: "RU_ARCTIC_FB_ALT_001",
              properties: {
                id: "RU_ARCTIC_FB_ALT_001",
                scenario_helper_kind: "shell_fallback",
                render_as_base_geography: false,
              },
            },
          ],
        },
      },
      arcs: [],
    };
    const mixedCollection = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        id: "REAL_COUNTRY",
        properties: { id: "REAL_COUNTRY" },
        geometry: { type: "Polygon", coordinates: [] },
      }, {
        type: "Feature",
        id: "RU_ARCTIC_FB_ALT_001",
        properties: {
          id: "RU_ARCTIC_FB_ALT_001",
          scenario_helper_kind: "shell_fallback",
          render_as_base_geography: false,
        },
        geometry: { type: "Polygon", coordinates: [] },
      }],
    };
    const state = {
      activeScenarioId: "tno_1962",
      startupReadonly: false,
      scenarioHydrationHealthGate: null,
      runtimePoliticalTopology: null,
      scenarioRuntimeTopologyData: null,
      scenarioPoliticalChunkData: null,
      scenarioWaterRegionsData: null,
      scenarioSpecialRegionsData: null,
      scenarioAtlantropaData: null,
      scenarioLandMaskData: null,
      scenarioContextLandMaskData: null,
      scenarioWaterOverlayVersionTag: "",
      scenarioLandMaskVersionTag: "",
      scenarioContextLandMaskVersionTag: "",
      defaultReleasableCatalog: null,
    };
    const { hydrateActiveScenarioBundle } = createMinimalHydrationController(state, {
      getScenarioRuntimeMergedLayerPayloads: () => ({ political: mixedCollection }),
      hasScenarioMergedLayerPayload: (_payloads, layerKey) => layerKey === "political",
      applyScenarioPoliticalChunkPayload: (_bundle, payload) => {
        appliedPayloads.push(payload);
        return false;
      },
      areScenarioFeatureCollectionsEquivalent: () => false,
    });

    const hydrated = hydrateActiveScenarioBundle({
      manifest: { scenario_id: "tno_1962", map_mode: "ownership" },
      source: {
        runtime_bootstrap_topology_sha256: "bootstrap-sha",
        detail_chunk_manifest_sha256: "chunk-sha",
      },
      bundleLevel: "full",
      runtimeTopologyPayload: mixedTopology,
    });

    assert.equal(hydrated, true);
    assert.equal(appliedPayloads.length, 1);
    assert.deepEqual(
      appliedPayloads[0].features.map((feature) => feature.id),
      ["REAL_COUNTRY"],
    );
    assert.deepEqual(
      state.scenarioPoliticalChunkData.features.map((feature) => feature.id),
      ["REAL_COUNTRY"],
    );
  } finally {
    globalThis.topojson = originalTopojson;
  }
});

test("startup scenario cache keys change when source sha metadata changes", () => {
  const common = {
    scenarioRegistry: { version: 1 },
    scenarioId: "sample",
    bundleLevel: "bootstrap",
    runtimeBootstrapTopologyUrl: "data/scenarios/sample/startup.runtime_shell.topo.json",
  };
  const manifestA = {
    version: 2,
    baseline_hash: "same",
    generated_at: "same",
    source: {
      runtime_topology_sha256: "full-a",
      runtime_bootstrap_topology_sha256: "boot-a",
      detail_chunk_manifest_sha256: "chunks-a",
      countries_sha256: "countries-a",
    },
  };
  const manifestB = {
    ...manifestA,
    source: {
      ...manifestA.source,
      runtime_bootstrap_topology_sha256: "boot-b",
    },
  };
  const manifestC = {
    ...manifestA,
    source: {
      ...manifestA.source,
      countries_sha256: "countries-c",
    },
  };

  assert.notEqual(
    createStartupScenarioBootstrapCoreCacheKey({ ...common, manifest: manifestA }),
    createStartupScenarioBootstrapCoreCacheKey({ ...common, manifest: manifestB }),
  );
  assert.notEqual(
    createStartupScenarioBootstrapCacheKey({
      ...common,
      manifest: manifestA,
      currentLanguage: "en",
      geoLocalePatchUrl: "data/scenarios/sample/geo_locale_patch.en.json",
    }),
    createStartupScenarioBootstrapCacheKey({
      ...common,
      manifest: manifestB,
      currentLanguage: "en",
      geoLocalePatchUrl: "data/scenarios/sample/geo_locale_patch.en.json",
    }),
  );
  assert.notEqual(
    createStartupScenarioBootstrapCoreCacheKey({ ...common, manifest: manifestA }),
    createStartupScenarioBootstrapCoreCacheKey({ ...common, manifest: manifestC }),
  );
  assert.notEqual(
    createStartupScenarioBootstrapCacheKey({
      ...common,
      manifest: manifestA,
      currentLanguage: "en",
      geoLocalePatchUrl: "data/scenarios/sample/geo_locale_patch.en.json",
    }),
    createStartupScenarioBootstrapCacheKey({
      ...common,
      manifest: manifestC,
      currentLanguage: "en",
      geoLocalePatchUrl: "data/scenarios/sample/geo_locale_patch.en.json",
    }),
  );
});

test("startup hydration refreshes opening owner borders when full mesh pack arrives", () => {
  const calls = [];
  const promotionCalls = [];
  const state = {
    activeScenarioId: "tno_1962",
    scenarioBorderMode: "scenario_owner_only",
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
  const effectOrder = [];
  const flushCalls = [];
  const scenarioUiCalls = [];
  const countryUiCalls = [];
  const toastCalls = [];
  const targetState = {
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
    startupReadonlySince: 9876,
    scenarioHydrationHealthGate: { status: "old", checkedAt: 12 },
  };

  const { enforceScenarioHydrationHealthGate } = createScenarioStartupHydrationController({
    state: targetState,
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
      effectOrder.push(["country-ui", targetState.scenarioHydrationHealthGate.status]);
      countryUiCalls.push(options);
    },
    syncScenarioUi: () => {
      effectOrder.push(["scenario-ui", targetState.scenarioHydrationHealthGate.status]);
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
      effectOrder.push(["flush", targetState.scenarioHydrationHealthGate.status]);
      flushCalls.push(reason);
    },
    enterScenarioFatalRecovery: () => {},
    consumeScenarioTestHook: (name) => name === "forceHydrationHealthGateMaskMismatchOnce",
    t: (value) => value,
    showToast: (...args) => {
      effectOrder.push(["toast", targetState.scenarioHydrationHealthGate.status]);
      toastCalls.push(args);
    },
  });

  const result = await enforceScenarioHydrationHealthGate({
    renderNow: true,
    reason: "test-mask-mismatch",
    autoRetry: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.degradedWaterOverlay, true);
  assert.equal(targetState.startupReadonly, false);
  assert.equal(targetState.startupReadonlyReason, "");
  assert.equal(targetState.startupReadonlyUnlockInFlight, false);
  assert.equal(targetState.startupReadonlySince, 9876);
  assert.deepEqual(targetState.scenarioHydrationHealthGate, {
    status: "degraded",
    reason: "runtime-overlay-context-land-mask-version-mismatch",
    checkedAt: targetState.scenarioHydrationHealthGate.checkedAt,
    attemptedRetry: false,
    ownerFeatureOverlapRatio: 0,
    ownerFeatureOverlapCount: 0,
    ownerFeatureRenderedCount: 1,
    degradedWaterOverlay: true,
  });
  assert.equal(targetState.scenarioWaterRegionsData, null);
  assert.equal(targetState.scenarioLandMaskData, null);
  assert.equal(targetState.scenarioContextLandMaskData, null);
  assert.deepEqual(effectOrder, [
    ["toast", "old"],
    ["scenario-ui", "degraded"],
    ["country-ui", "degraded"],
    ["flush", "degraded"],
  ]);
  assert.deepEqual(flushCalls, ["scenario-health-gate-fallback"]);
  assert.equal(scenarioUiCalls.length, 1);
  assert.equal(countryUiCalls.length, 1);
  assert.equal(countryUiCalls[0]?.renderNow, false);
  assert.equal(toastCalls.length, 1);
});

test("startup hydration retry recovers before readonly clear, gate publish, and UI sync", async () => {
  const order = [];
  let forceMismatch = true;
  const targetState = {
    activeScenarioId: "tno_1962",
    landData: {
      type: "FeatureCollection",
      features: [{ properties: { id: "feature-1" } }],
    },
    sovereigntyByFeatureId: { "feature-1": "AA" },
    scenarioRuntimeTopologyVersionTag: "runtime-v1",
    startupReadonly: true,
    startupReadonlyReason: "scenario-health-gate",
    startupReadonlyUnlockInFlight: true,
    startupReadonlySince: 10,
    scenarioHydrationHealthGate: { status: "old" },
  };
  const controller = createMinimalHydrationController(targetState, {
    ownerFeatureCoverageMinFeatures: 1,
    consumeScenarioTestHook: (name) => {
      if (name !== "forceHydrationHealthGateOwnerMismatchOnce" || !forceMismatch) {
        return false;
      }
      forceMismatch = false;
      return true;
    },
    getLoadScenarioBundle: () => async (_scenarioId, options) => {
      order.push(["force-reload", options.forceReload]);
      return null;
    },
    flushRenderBoundary: (reason) => {
      order.push(["flush", reason, targetState.startupReadonlyReason]);
    },
    syncScenarioUi: () => {
      order.push([
        "scenario-ui",
        targetState.startupReadonlyReason,
        targetState.scenarioHydrationHealthGate.status,
      ]);
    },
    syncCountryUi: () => {
      order.push([
        "country-ui",
        targetState.startupReadonlyReason,
        targetState.scenarioHydrationHealthGate.status,
      ]);
    },
  });

  const result = await controller.enforceScenarioHydrationHealthGate();

  assert.equal(result.ok, true);
  assert.equal(result.attemptedRetry, true);
  assert.deepEqual(order, [
    ["force-reload", true],
    ["flush", "scenario-health-gate-retry-recovered", "scenario-health-gate"],
    ["scenario-ui", "", "ok"],
    ["country-ui", "", "ok"],
  ]);
  assert.equal(targetState.scenarioHydrationHealthGate.reason, "retry-recovered");
});

test("startup hydration retry failure preserves attemptedRetry in the committed gate", async () => {
  const targetState = {
    activeScenarioId: "tno_1962",
    landData: {
      type: "FeatureCollection",
      features: [{ properties: { id: "feature-1" } }],
    },
    sovereigntyByFeatureId: { "feature-1": "AA" },
    scenarioRuntimeTopologyVersionTag: "runtime-v1",
    startupReadonly: true,
    startupReadonlyReason: "scenario-health-gate",
    scenarioHydrationHealthGate: { status: "old" },
  };
  const controller = createMinimalHydrationController(targetState, {
    ownerFeatureCoverageMinFeatures: 1,
    consumeScenarioTestHook: (name) =>
      name === "forceHydrationHealthGateOwnerMismatchOnce",
    getLoadScenarioBundle: () => async () => {
      throw new Error("retry failed");
    },
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await controller.enforceScenarioHydrationHealthGate();
    assert.equal(result.ok, false);
    assert.equal(result.attemptedRetry, true);
    assert.equal(targetState.scenarioHydrationHealthGate.attemptedRetry, true);
    assert.equal(targetState.scenarioHydrationHealthGate.status, "degraded");
  } finally {
    console.warn = originalWarn;
  }
});
