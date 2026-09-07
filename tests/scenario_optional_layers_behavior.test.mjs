import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import {
  ensureActiveScenarioOptionalLayerLoaded,
  ensureActiveScenarioOptionalLayersForVisibility,
} from "../js/core/scenario_resources.js";
import { createScenarioBundleAssembler } from "../js/core/scenario/bundle_loader.js";
import { createLayerFromPreset } from "../js/core/special_zone_layers.js";
import {
  loadScenarioJsonWithTimeout,
  loadScenarioJsonResourceWithTimeout,
  loadMeasuredRequiredScenarioResource,
  loadOptionalScenarioResource,
} from "../js/core/scenario/shared.js";

for (const [name, load, select] of [
  ["payload", loadScenarioJsonWithTimeout, (result) => result.payload],
  ["measured", loadScenarioJsonResourceWithTimeout, (result) => result],
]) {
  test(`scenario ${name} loading preserves results and releases its timeout`, async (t) => {
    const timer = {};
    t.mock.method(globalThis, "setTimeout", (_callback, delay) => {
      assert.equal(delay, 60_000);
      return timer;
    });
    const clear = t.mock.method(globalThis, "clearTimeout", (id) => assert.equal(id, timer));
    const result = { payload: { owners: {} }, metrics: { durationMs: 12 } };
    const client = {};
    const loader = async (url, options) => {
      assert.equal(url, "owners.json");
      assert.deepEqual(options, { d3Client: client, label: "scenario:owners" });
      return result;
    };
    assert.equal(await load(loader, client, "owners.json", { resourceLabel: "owners" }), select(result));
    assert.equal(clear.mock.callCount(), 1);
  });

  test(`scenario ${name} loading propagates rejection and timeout with cleanup`, async (t) => {
    let expire;
    t.mock.method(globalThis, "setTimeout", (callback) => { expire = callback; return 1; });
    const clear = t.mock.method(globalThis, "clearTimeout", () => {});
    const failure = new Error("network failed");
    await assert.rejects(load(async () => { throw failure; }, {}, "owners.json"), (error) => error === failure);
    const pending = load(() => new Promise(() => {}), {}, "owners.json", {
      scenarioId: "test", resourceLabel: "owners",
    });
    const rejected = assert.rejects(pending, /Timed out loading "owners" for "test" after 60000ms/);
    expire();
    await rejected;
    assert.equal(clear.mock.callCount(), 2);
  });
}

test("required scenario resources validate payloads while optional resources retain failure results", async (t) => {
  const options = { scenarioId: "test", resourceLabel: "owners", requiredField: "owners" };
  const payload = { owners: {} };
  const metrics = { durationMs: 12 };
  const loader = t.mock.fn(async () => ({ payload, metrics }));
  assert.deepEqual(await loadMeasuredRequiredScenarioResource(loader, {}, "owners.json", options), { payload, metrics });
  await assert.rejects(loadMeasuredRequiredScenarioResource(loader, {}, "", options), /Required resource "owners" is missing/);
  assert.equal(loader.mock.callCount(), 1);
  for (const invalid of [null, "invalid", {}]) {
    await assert.rejects(
      loadMeasuredRequiredScenarioResource(async () => ({ payload: invalid }), {}, "owners.json", options),
      /invalid payload|missing "owners"/,
    );
  }
  const missing = await loadOptionalScenarioResource(loader, {}, "", options);
  assert.equal(missing.reason, "missing_url");
  assert.equal(loader.mock.callCount(), 1);
  t.mock.method(console, "warn", () => {});
  const failed = await loadOptionalScenarioResource(async () => { throw new Error("offline"); }, {}, "owners.json", options);
  assert.deepEqual(failed, { ok: false, value: null, metrics: null, reason: "load_error", errorMessage: "offline" });
});

test("visibility sync skips stale optional layer writes after scenario apply request changes", async () => {
  const previousActiveScenarioId = state.activeScenarioId;
  const previousBundleCache = state.scenarioBundleCacheById;
  const previousShowWaterRegions = state.showWaterRegions;
  const previousShowScenarioSpecialRegions = state.showScenarioSpecialRegions;
  const previousShowScenarioAtlantropa = state.showScenarioAtlantropa;
  const previousShowScenarioReliefOverlays = state.showScenarioReliefOverlays;
  const previousShowCityPoints = state.showCityPoints;
  const previousScenarioWaterRegionsData = state.scenarioWaterRegionsData;
  const previousCurrentScenarioApplyRequestId = state.currentScenarioApplyRequestId;
  const previousDiagnostics = state.renderTransactionDiagnostics;
  const previousFetch = globalThis.fetch;

  const bundle = {
    manifest: {
      scenario_id: "stale_optional_test",
      water_regions_url: "data/scenarios/stale_optional_test/water_regions.json",
    },
    optionalLayerPromises: {},
    optionalLayerSettledByKey: {},
  };
  state.activeScenarioId = "stale_optional_test";
  state.currentScenarioApplyRequestId = 1;
  state.scenarioBundleCacheById = { stale_optional_test: bundle };
  state.showWaterRegions = true;
  state.showScenarioSpecialRegions = false;
  state.showScenarioAtlantropa = false;
  state.showScenarioReliefOverlays = false;
  state.showCityPoints = false;
  state.scenarioWaterRegionsData = null;
  state.renderTransactionDiagnostics = null;
  const staleJsonClient = {
    json: async () => {
      state.currentScenarioApplyRequestId = 2;
      state.activeScenarioId = "newer_optional_test";
      return {
        type: "FeatureCollection",
        features: [{ type: "Feature", id: "water-a", properties: {}, geometry: null }],
      };
    },
  };
  globalThis.fetch = async () => {
    state.currentScenarioApplyRequestId = 2;
    state.activeScenarioId = "newer_optional_test";
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", id: "water-a", properties: {}, geometry: null }],
      }),
    };
  };

  try {
    const payloads = await ensureActiveScenarioOptionalLayersForVisibility({
      bundle,
      d3Client: staleJsonClient,
      renderNow: false,
      scenarioApplyEpoch: 7,
      scenarioApplyRequestId: 1,
    });

    assert.deepEqual(payloads, []);
    assert.equal(state.scenarioWaterRegionsData, null);
    const snapshots = state.renderTransactionDiagnostics?.snapshots || [];
    assert.ok(snapshots.some((snapshot) => (
      snapshot.phase === "scenario-apply-stale-callback-skipped"
      && snapshot.extra?.callbackPhase === "optional-layer-visibility-sync-after-load"
      && snapshot.extra?.scenarioApplyRequestId === 1
      && snapshot.extra?.currentScenarioApplyRequestId === 2
    )));
  } finally {
    state.activeScenarioId = previousActiveScenarioId;
    state.scenarioBundleCacheById = previousBundleCache;
    state.showWaterRegions = previousShowWaterRegions;
    state.showScenarioSpecialRegions = previousShowScenarioSpecialRegions;
    state.showScenarioAtlantropa = previousShowScenarioAtlantropa;
    state.showScenarioReliefOverlays = previousShowScenarioReliefOverlays;
    state.showCityPoints = previousShowCityPoints;
    state.scenarioWaterRegionsData = previousScenarioWaterRegionsData;
    state.currentScenarioApplyRequestId = previousCurrentScenarioApplyRequestId;
    state.renderTransactionDiagnostics = previousDiagnostics;
    globalThis.fetch = previousFetch;
  }
});

test("failed special zone optional layer load clears stale runtime state", async () => {
  const previousActiveScenarioId = state.activeScenarioId;
  const previousActiveScenarioManifest = state.activeScenarioManifest;
  const previousBundleCache = state.scenarioBundleCacheById;
  const previousSpecialZoneLayers = state.specialZoneLayers;
  const previousLandIndex = state.landIndex;
  const previousFetch = globalThis.fetch;

  const pendingLayer = createLayerFromPreset("custom", { id: "pending-layer", memberFeatureIds: ["a"] });
  state.activeScenarioId = "scenario_special_zones_test";
  state.activeScenarioManifest = {
    scenario_id: "scenario_special_zones_test",
    special_zone_layers_url: "data/scenarios/test/special_zone_layers.json",
  };
  state.landIndex = new Map([["a", { id: "a" }]]);
  state.specialZoneLayers = {
    layers: [pendingLayer],
    activeLayerId: "pending-layer",
    diagnostics: [],
  };
  state.scenarioBundleCacheById = {
    scenario_special_zones_test: {
      manifest: {
        scenario_id: "scenario_special_zones_test",
        special_zone_layers_url: "data/scenarios/test/special_zone_layers.json",
      },
      optionalLayerPromises: {},
      optionalLayerSettledByKey: {},
    },
  };
  globalThis.fetch = async () => {
    throw new Error("network unavailable");
  };

  try {
    const payload = await ensureActiveScenarioOptionalLayerLoaded("specialZoneLayers", { renderNow: false });
    assert.equal(payload, null);
    assert.deepEqual(state.specialZoneLayers.layers, []);
    assert.equal(state.specialZoneLayers.activeLayerId, "");
    assert.ok(state.specialZoneLayers.diagnostics.some((entry) => entry.code === "special_zone_layers_load_failed"));
    assert.equal(state.specialZonesOverlayDirty, true);
  } finally {
    state.activeScenarioId = previousActiveScenarioId;
    state.activeScenarioManifest = previousActiveScenarioManifest;
    state.scenarioBundleCacheById = previousBundleCache;
    state.specialZoneLayers = previousSpecialZoneLayers;
    state.landIndex = previousLandIndex;
    globalThis.fetch = previousFetch;
  }
});

test("visibility sync clears stale special zone layers when declared asset load fails", async () => {
  const previousActiveScenarioId = state.activeScenarioId;
  const previousActiveScenarioManifest = state.activeScenarioManifest;
  const previousBundleCache = state.scenarioBundleCacheById;
  const previousSpecialZoneLayers = state.specialZoneLayers;
  const previousLandIndex = state.landIndex;
  const previousShowSpecialZones = state.showSpecialZones;
  const previousShowWaterRegions = state.showWaterRegions;
  const previousShowScenarioSpecialRegions = state.showScenarioSpecialRegions;
  const previousShowScenarioAtlantropa = state.showScenarioAtlantropa;
  const previousShowScenarioReliefOverlays = state.showScenarioReliefOverlays;
  const previousShowCityPoints = state.showCityPoints;
  const previousSpecialZonesOverlayDirty = state.specialZonesOverlayDirty;
  const previousFetch = globalThis.fetch;

  const staleLayer = createLayerFromPreset("custom", { id: "stale-layer", memberFeatureIds: ["a"] });
  state.activeScenarioId = "scenario_special_zones_visibility_test";
  state.activeScenarioManifest = {
    scenario_id: "scenario_special_zones_visibility_test",
    special_zone_layers_url: "data/scenarios/test/special_zone_layers.json",
  };
  state.showSpecialZones = true;
  state.showWaterRegions = false;
  state.showScenarioSpecialRegions = false;
  state.showScenarioAtlantropa = false;
  state.showScenarioReliefOverlays = false;
  state.showCityPoints = false;
  state.specialZonesOverlayDirty = false;
  state.landIndex = new Map([["a", { id: "a" }]]);
  state.specialZoneLayers = {
    layers: [staleLayer],
    activeLayerId: "stale-layer",
    diagnostics: [],
  };
  state.scenarioBundleCacheById = {
    scenario_special_zones_visibility_test: {
      manifest: {
        scenario_id: "scenario_special_zones_visibility_test",
        special_zone_layers_url: "data/scenarios/test/special_zone_layers.json",
      },
      optionalLayerPromises: {},
      optionalLayerSettledByKey: {},
    },
  };
  globalThis.fetch = async () => {
    throw new Error("network unavailable");
  };

  try {
    const payloads = await ensureActiveScenarioOptionalLayersForVisibility({
      renderNow: false,
    });
    assert.deepEqual(payloads, [null]);
    assert.deepEqual(state.specialZoneLayers.layers, []);
    assert.equal(state.specialZoneLayers.activeLayerId, "");
    assert.ok(state.specialZoneLayers.diagnostics.some((entry) => entry.code === "special_zone_layers_load_failed"));
    assert.equal(state.specialZonesOverlayDirty, true);
  } finally {
    state.activeScenarioId = previousActiveScenarioId;
    state.activeScenarioManifest = previousActiveScenarioManifest;
    state.scenarioBundleCacheById = previousBundleCache;
    state.specialZoneLayers = previousSpecialZoneLayers;
    state.landIndex = previousLandIndex;
    state.showSpecialZones = previousShowSpecialZones;
    state.showWaterRegions = previousShowWaterRegions;
    state.showScenarioSpecialRegions = previousShowScenarioSpecialRegions;
    state.showScenarioAtlantropa = previousShowScenarioAtlantropa;
    state.showScenarioReliefOverlays = previousShowScenarioReliefOverlays;
    state.showCityPoints = previousShowCityPoints;
    state.specialZonesOverlayDirty = previousSpecialZonesOverlayDirty;
    globalThis.fetch = previousFetch;
  }
});

function createStrategicValuesFixture() {
  return {
    version: 1,
    scenario_id: "hoi4_optional_test",
    baseline_hash: "baseline-1",
    metrics: {
      steel: { kind: "additive", min: 0, max: 20, p95: 20 },
    },
    buckets: {
      s1: {
        state_id: 1,
        owner_tag: "GER",
        steel: 20,
      },
    },
    bucket_by_feature: {
      "GER-1": "s1",
    },
    victory_points: [
      {
        province_id: 6521,
        value: 50,
        state_id: 1,
        owner_tag: "GER",
        name: "Berlin",
        host_feature_id: "GER-1",
        city_id: "berlin",
      },
    ],
    resource_points: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [13.4, 52.5] },
          properties: {
            resource: "steel",
            amount: 20,
            tier: 3,
            state_id: 1,
            owner_tag: "GER",
          },
        },
      ],
    },
    diagnostics: {
      vp_total: 1,
      vp_matched: 1,
      resource_point_count: 1,
    },
  };
}

test("bundle assembly clears stale strategic values optional layer after baseline changes", async () => {
  const staleStrategicValuesPromise = Promise.resolve({ stale: true });
  const assembler = createScenarioBundleAssembler({
    loadMeasuredRequiredScenarioResource: async (_d3Client, _url, options = {}) => {
      const resourceLabel = String(options.resourceLabel || "");
      if (resourceLabel === "countries") {
        return { payload: { countries: {} }, metrics: null };
      }
      if (resourceLabel === "owners") {
        return { payload: { owners: {} }, metrics: null };
      }
      if (resourceLabel === "cores") {
        return { payload: { cores: {} }, metrics: null };
      }
      throw new Error(`Unexpected required scenario resource: ${resourceLabel}`);
    },
    loadOptionalScenarioResource: async () => ({
      ok: false,
      value: null,
      metrics: null,
      reason: "not-requested",
      errorMessage: "",
    }),
  });

  const { bundle } = await assembler({
    d3Client: { json: async () => null },
    targetId: "hoi4_optional_test",
    requestedBundleLevel: "full",
    manifest: {
      scenario_id: "hoi4_optional_test",
      baseline_hash: "baseline-2",
      countries_url: "countries.json",
      owners_url: "owners.json",
      cores_url: "cores.json",
    },
    priorBundle: {
      manifest: {
        scenario_id: "hoi4_optional_test",
        baseline_hash: "baseline-1",
      },
      strategicValuesPayload: createStrategicValuesFixture(),
      optionalLayerPromises: {
        strategicvalues: staleStrategicValuesPromise,
        waterRegions: Promise.resolve({ freshIndependentLayer: true }),
      },
      optionalLayerSettledByKey: {
        strategicvalues: true,
        waterRegions: true,
      },
    },
  });

  assert.equal(bundle.strategicValuesPayload, null);
  assert.equal(bundle.optionalLayerPromises.strategicvalues, undefined);
  assert.equal(bundle.optionalLayerSettledByKey.strategicvalues, undefined);
  assert.equal(bundle.optionalLayerSettledByKey.waterRegions, true);

  const { bundle: switchedScenarioBundle } = await assembler({
    d3Client: { json: async () => null },
    targetId: "hoi4_optional_next",
    requestedBundleLevel: "full",
    manifest: {
      scenario_id: "hoi4_optional_next",
      baseline_hash: "baseline-1",
      countries_url: "countries.json",
      owners_url: "owners.json",
      cores_url: "cores.json",
    },
    priorBundle: {
      manifest: {
        scenario_id: "hoi4_optional_test",
        baseline_hash: "baseline-1",
      },
      strategicValuesPayload: createStrategicValuesFixture(),
      optionalLayerPromises: {
        strategicvalues: staleStrategicValuesPromise,
      },
      optionalLayerSettledByKey: {
        strategicvalues: true,
      },
    },
  });

  assert.equal(switchedScenarioBundle.strategicValuesPayload, null);
  assert.equal(switchedScenarioBundle.optionalLayerPromises.strategicvalues, undefined);
  assert.equal(switchedScenarioBundle.optionalLayerSettledByKey.strategicvalues, undefined);
});

test("strategic values optional layer load normalizes runtime payload and bumps revision", async () => {
  const previousActiveScenarioId = state.activeScenarioId;
  const previousActiveScenarioManifest = state.activeScenarioManifest;
  const previousBundleCache = state.scenarioBundleCacheById;
  const previousStrategicValues = state.scenarioStrategicValuesData;
  const previousStrategicRevision = state.scenarioStrategicValuesRevision;
  const previousBaselineHash = state.scenarioBaselineHash;
  const previousFetch = globalThis.fetch;

  state.activeScenarioId = "hoi4_optional_test";
  state.scenarioBaselineHash = "baseline-1";
  state.activeScenarioManifest = {
    scenario_id: "hoi4_optional_test",
    baseline_hash: "baseline-1",
    strategic_values_url: "data/scenarios/hoi4_optional_test/strategic_values.by_feature.json",
  };
  state.scenarioStrategicValuesData = null;
  state.scenarioStrategicValuesRevision = 0;
  state.scenarioBundleCacheById = {
    hoi4_optional_test: {
      manifest: state.activeScenarioManifest,
      optionalLayerPromises: {},
      optionalLayerSettledByKey: {},
    },
  };
  globalThis.fetch = async (url) => {
    assert.match(String(url), /strategic_values\.by_feature\.json/);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(createStrategicValuesFixture()),
    };
  };

  try {
    const payload = await ensureActiveScenarioOptionalLayerLoaded("strategic_values", {
      d3Client: { json: async () => null },
      renderNow: false,
    });

    assert.equal(payload.diagnostics.errors.length, 0);
    assert.equal(state.scenarioStrategicValuesData.bucketByFeature["GER-1"], "s1");
    assert.equal(state.scenarioStrategicValuesData.victoryPointsByFeature["GER-1"][0].name, "Berlin");
    assert.equal(state.scenarioStrategicValuesData.resourcePoints.features[0].properties.resource, "steel");
    assert.equal(state.scenarioStrategicValuesRevision, 1);
  } finally {
    state.activeScenarioId = previousActiveScenarioId;
    state.activeScenarioManifest = previousActiveScenarioManifest;
    state.scenarioBundleCacheById = previousBundleCache;
    state.scenarioStrategicValuesData = previousStrategicValues;
    state.scenarioStrategicValuesRevision = previousStrategicRevision;
    state.scenarioBaselineHash = previousBaselineHash;
    globalThis.fetch = previousFetch;
  }
});

test("visibility sync loads strategic values when resource markers are enabled", async () => {
  const previousActiveScenarioId = state.activeScenarioId;
  const previousActiveScenarioManifest = state.activeScenarioManifest;
  const previousBundleCache = state.scenarioBundleCacheById;
  const previousStrategicValues = state.scenarioStrategicValuesData;
  const previousStrategicRevision = state.scenarioStrategicValuesRevision;
  const previousShowStrategicResourceMarkers = state.showStrategicResourceMarkers;
  const previousShowWaterRegions = state.showWaterRegions;
  const previousShowScenarioSpecialRegions = state.showScenarioSpecialRegions;
  const previousShowScenarioAtlantropa = state.showScenarioAtlantropa;
  const previousShowScenarioReliefOverlays = state.showScenarioReliefOverlays;
  const previousShowCityPoints = state.showCityPoints;
  const previousShowSpecialZones = state.showSpecialZones;
  const previousBaselineHash = state.scenarioBaselineHash;
  const previousFetch = globalThis.fetch;

  state.activeScenarioId = "hoi4_optional_test";
  state.scenarioBaselineHash = "baseline-1";
  state.activeScenarioManifest = {
    scenario_id: "hoi4_optional_test",
    baseline_hash: "baseline-1",
    strategic_values_url: "data/scenarios/hoi4_optional_test/strategic_values.by_feature.json",
  };
  state.showStrategicResourceMarkers = true;
  state.showWaterRegions = false;
  state.showScenarioSpecialRegions = false;
  state.showScenarioAtlantropa = false;
  state.showScenarioReliefOverlays = false;
  state.showCityPoints = false;
  state.showSpecialZones = false;
  state.scenarioStrategicValuesData = null;
  state.scenarioStrategicValuesRevision = 0;
  state.scenarioBundleCacheById = {
    hoi4_optional_test: {
      manifest: state.activeScenarioManifest,
      optionalLayerPromises: {},
      optionalLayerSettledByKey: {},
    },
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(createStrategicValuesFixture()),
  });

  try {
    const payloads = await ensureActiveScenarioOptionalLayersForVisibility({
      d3Client: { json: async () => null },
      renderNow: false,
    });

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].resourcePoints.features.length, 1);
    assert.equal(state.scenarioStrategicValuesData.buckets.s1.steel, 20);
    assert.equal(state.scenarioStrategicValuesRevision, 1);
  } finally {
    state.activeScenarioId = previousActiveScenarioId;
    state.activeScenarioManifest = previousActiveScenarioManifest;
    state.scenarioBundleCacheById = previousBundleCache;
    state.scenarioStrategicValuesData = previousStrategicValues;
    state.scenarioStrategicValuesRevision = previousStrategicRevision;
    state.showStrategicResourceMarkers = previousShowStrategicResourceMarkers;
    state.showWaterRegions = previousShowWaterRegions;
    state.showScenarioSpecialRegions = previousShowScenarioSpecialRegions;
    state.showScenarioAtlantropa = previousShowScenarioAtlantropa;
    state.showScenarioReliefOverlays = previousShowScenarioReliefOverlays;
    state.showCityPoints = previousShowCityPoints;
    state.showSpecialZones = previousShowSpecialZones;
    state.scenarioBaselineHash = previousBaselineHash;
    globalThis.fetch = previousFetch;
  }
});

test("visibility sync loads strategic values when choropleth metric is enabled", async () => {
  const previousActiveScenarioId = state.activeScenarioId;
  const previousActiveScenarioManifest = state.activeScenarioManifest;
  const previousBundleCache = state.scenarioBundleCacheById;
  const previousStrategicValues = state.scenarioStrategicValuesData;
  const previousStrategicRevision = state.scenarioStrategicValuesRevision;
  const previousShowStrategicResourceMarkers = state.showStrategicResourceMarkers;
  const previousStrategicChoroplethMetric = state.strategicChoroplethMetric;
  const previousShowWaterRegions = state.showWaterRegions;
  const previousShowScenarioSpecialRegions = state.showScenarioSpecialRegions;
  const previousShowScenarioAtlantropa = state.showScenarioAtlantropa;
  const previousShowScenarioReliefOverlays = state.showScenarioReliefOverlays;
  const previousShowCityPoints = state.showCityPoints;
  const previousShowSpecialZones = state.showSpecialZones;
  const previousBaselineHash = state.scenarioBaselineHash;
  const previousFetch = globalThis.fetch;

  state.activeScenarioId = "hoi4_optional_test";
  state.scenarioBaselineHash = "baseline-1";
  state.activeScenarioManifest = {
    scenario_id: "hoi4_optional_test",
    baseline_hash: "baseline-1",
    strategic_values_url: "data/scenarios/hoi4_optional_test/strategic_values.by_feature.json",
  };
  state.showStrategicResourceMarkers = false;
  state.strategicChoroplethMetric = "steel";
  state.showWaterRegions = false;
  state.showScenarioSpecialRegions = false;
  state.showScenarioAtlantropa = false;
  state.showScenarioReliefOverlays = false;
  state.showCityPoints = false;
  state.showSpecialZones = false;
  state.scenarioStrategicValuesData = null;
  state.scenarioStrategicValuesRevision = 0;
  state.scenarioBundleCacheById = {
    hoi4_optional_test: {
      manifest: state.activeScenarioManifest,
      optionalLayerPromises: {},
      optionalLayerSettledByKey: {},
    },
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(createStrategicValuesFixture()),
  });

  try {
    const payloads = await ensureActiveScenarioOptionalLayersForVisibility({
      d3Client: { json: async () => null },
      renderNow: false,
    });

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].resourcePoints.features.length, 1);
    assert.equal(state.scenarioStrategicValuesData.buckets.s1.steel, 20);
    assert.equal(state.scenarioStrategicValuesRevision, 1);
  } finally {
    state.activeScenarioId = previousActiveScenarioId;
    state.activeScenarioManifest = previousActiveScenarioManifest;
    state.scenarioBundleCacheById = previousBundleCache;
    state.scenarioStrategicValuesData = previousStrategicValues;
    state.scenarioStrategicValuesRevision = previousStrategicRevision;
    state.showStrategicResourceMarkers = previousShowStrategicResourceMarkers;
    state.strategicChoroplethMetric = previousStrategicChoroplethMetric;
    state.showWaterRegions = previousShowWaterRegions;
    state.showScenarioSpecialRegions = previousShowScenarioSpecialRegions;
    state.showScenarioAtlantropa = previousShowScenarioAtlantropa;
    state.showScenarioReliefOverlays = previousShowScenarioReliefOverlays;
    state.showCityPoints = previousShowCityPoints;
    state.showSpecialZones = previousShowSpecialZones;
    state.scenarioBaselineHash = previousBaselineHash;
    globalThis.fetch = previousFetch;
  }
});

