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

test("visibility sync skips stale optional layer writes after scenario apply request changes", async (t) => {
  preserveScenarioState(t, ["activeScenarioId","scenarioBundleCacheById","showWaterRegions","showScenarioSpecialRegions","showScenarioAtlantropa","showScenarioReliefOverlays","showCityPoints","scenarioWaterRegionsData","currentScenarioApplyRequestId","renderTransactionDiagnostics"]);
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
    globalThis.fetch = previousFetch;
  }
});

test("failed special zone optional layer load clears stale runtime state", async (t) => {
  preserveScenarioState(t, ["activeScenarioId","activeScenarioManifest","scenarioBundleCacheById","specialZoneLayers","landIndex"]);
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
    globalThis.fetch = previousFetch;
  }
});

test("visibility sync clears stale special zone layers when declared asset load fails", async (t) => {
  preserveScenarioState(t, ["activeScenarioId","activeScenarioManifest","scenarioBundleCacheById","specialZoneLayers","landIndex","showSpecialZones","showWaterRegions","showScenarioSpecialRegions","showScenarioAtlantropa","showScenarioReliefOverlays","showCityPoints","specialZonesOverlayDirty"]);
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

test("strategic values optional layer load normalizes runtime payload and bumps revision", async (t) => {
  preserveScenarioState(t, ["activeScenarioId","activeScenarioManifest","scenarioBundleCacheById","scenarioStrategicValuesData","scenarioStrategicValuesRevision","scenarioBaselineHash"]);
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
    globalThis.fetch = previousFetch;
  }
});

test("visibility sync loads strategic values when resource markers are enabled", async (t) => {
  preserveScenarioState(t, ["activeScenarioId","activeScenarioManifest","scenarioBundleCacheById","scenarioStrategicValuesData","scenarioStrategicValuesRevision","showStrategicResourceMarkers","showWaterRegions","showScenarioSpecialRegions","showScenarioAtlantropa","showScenarioReliefOverlays","showCityPoints","showSpecialZones","scenarioBaselineHash"]);
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
    globalThis.fetch = previousFetch;
  }
});

test("visibility sync loads strategic values when choropleth metric is enabled", async (t) => {
  preserveScenarioState(t, ["activeScenarioId","activeScenarioManifest","scenarioBundleCacheById","scenarioStrategicValuesData","scenarioStrategicValuesRevision","showStrategicResourceMarkers","strategicChoroplethMetric","showWaterRegions","showScenarioSpecialRegions","showScenarioAtlantropa","showScenarioReliefOverlays","showCityPoints","showSpecialZones","scenarioBaselineHash"]);
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
    globalThis.fetch = previousFetch;
  }
});


function preserveScenarioState(t, fields) {
  const previous = Object.fromEntries(fields.map((key) => [key, state[key]]));
  t.after(() => Object.assign(state, previous));
}

function installOptionalWaterScenario(t) {
  const fields = [
    "activeScenarioId", "scenarioBundleCacheById", "scenarioWaterRegionsData",
    "currentScenarioApplyRequestId", "renderTransactionDiagnostics", "scenarioPerfMetrics",
  ];
  const previous = Object.fromEntries(fields.map((key) => [key, state[key]]));
  const previousGlobalMetrics = globalThis.__scenarioPerfMetrics;
  t.after(() => {
    Object.assign(state, previous);
    globalThis.__scenarioPerfMetrics = previousGlobalMetrics;
  });
  state.scenarioPerfMetrics = {};
  const bundle = { manifest: { scenario_id: "optional_owner_test", water_regions_url: "water.json" } };
  state.activeScenarioId = "optional_owner_test";
  state.scenarioBundleCacheById = { optional_owner_test: bundle };
  state.scenarioWaterRegionsData = null;
  state.currentScenarioApplyRequestId = 1;
  state.renderTransactionDiagnostics = null;
  // Exercise the d3 acquisition path deterministically, without network access.
  const previousFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  t.after(() => { globalThis.fetch = previousFetch; });
  return bundle;
}

test("optional payload dedupe keeps each caller's fence and reuses settled payload", async (t) => {
  const bundle = installOptionalWaterScenario(t);
  let resolvePayload;
  const pendingPayload = new Promise((resolve) => { resolvePayload = resolve; });
  const json = t.mock.fn(() => pendingPayload);
  const options = { d3Client: { json }, renderNow: false, scenarioApplyRequestId: 1 };
  const oldCaller = ensureActiveScenarioOptionalLayerLoaded("water", options);
  state.currentScenarioApplyRequestId = 2;
  const newCaller = ensureActiveScenarioOptionalLayerLoaded("water", {
    ...options, scenarioApplyRequestId: 2,
  });
  const payload = { type: "FeatureCollection", features: [{ type: "Feature", id: "water-new", properties: {}, geometry: null }] };
  resolvePayload(payload);
  const [oldResult, newResult] = await Promise.all([oldCaller, newCaller]);
  assert.equal(json.mock.callCount(), 1);
  assert.equal(oldResult, newResult);
  assert.equal(state.scenarioWaterRegionsData, newResult);
  assert.equal(bundle.optionalLayerSettledByKey.water, true);
  assert.equal(bundle.optionalLayerPromises.water, undefined);
  assert.ok(state.renderTransactionDiagnostics.snapshots.some((snapshot) => (
    snapshot.phase === "scenario-apply-stale-callback-skipped"
    && snapshot.extra?.callbackPhase === "optional-layer-loaded-before-render"
    && snapshot.extra?.scenarioApplyRequestId === 1
  )));
  assert.equal(await ensureActiveScenarioOptionalLayerLoaded("water", {
    ...options, scenarioApplyRequestId: 2,
  }), newResult);
  assert.equal(json.mock.callCount(), 1);
});

test("optional payload failures retry while absent assets settle until forced reload", async (t) => {
  const bundle = installOptionalWaterScenario(t);
  t.mock.method(console, "warn", () => {});
  const payload = { type: "FeatureCollection", features: [] };
  let fail = true;
  const json = t.mock.fn(async () => {
    if (fail) throw new Error("offline");
    return payload;
  });
  const options = { d3Client: { json }, renderNow: false };
  assert.equal(await ensureActiveScenarioOptionalLayerLoaded("water", options), null);
  assert.equal(bundle.optionalLayerSettledByKey.water, undefined);
  fail = false;
  assert.deepEqual(await ensureActiveScenarioOptionalLayerLoaded("water", options), payload);
  assert.equal(json.mock.callCount(), 2);
  delete bundle.manifest.water_regions_url;
  assert.equal(await ensureActiveScenarioOptionalLayerLoaded("water", { ...options, forceReload: true }), null);
  assert.equal(bundle.optionalLayerSettledByKey.water, true);
  bundle.manifest.water_regions_url = "water-restored.json";
  assert.equal(await ensureActiveScenarioOptionalLayerLoaded("water", options), null);
  assert.equal(json.mock.callCount(), 2);
  assert.deepEqual(await ensureActiveScenarioOptionalLayerLoaded("water", { ...options, forceReload: true }), payload);
  assert.equal(json.mock.callCount(), 3);
});

for (const oldFinishesFirst of [true, false]) {
  for (const oldFails of [false, true]) {
    test(`optional forced reload owns settlement (old first=${oldFinishesFirst}, fails=${oldFails})`, async (t) => {
      const bundle = installOptionalWaterScenario(t);
      t.mock.method(console, "warn", () => {});
      const requests = [];
      const json = t.mock.fn(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
      const options = { d3Client: { json }, renderNow: false };
      const oldCaller = ensureActiveScenarioOptionalLayerLoaded("water", options);
      const newCaller = ensureActiveScenarioOptionalLayerLoaded("water", { ...options, forceReload: true });
      const newPromise = bundle.optionalLayerPromises.water;
      const payload = (id) => ({ type: "FeatureCollection", features: [{ type: "Feature", id, properties: {}, geometry: null }] });
      const oldPayload = payload("old");
      const newPayload = payload("new");
      const finishOld = () => oldFails ? requests[0].reject(new Error("old failed")) : requests[0].resolve(oldPayload);
      if (oldFinishesFirst) {
        finishOld();
        await oldCaller;
        assert.equal(bundle.optionalLayerPromises.water, newPromise);
        assert.equal(state.scenarioWaterRegionsData, null);
        const follower = ensureActiveScenarioOptionalLayerLoaded("water", options);
        assert.equal(json.mock.callCount(), 2);
        requests[1].resolve(newPayload);
        await Promise.all([newCaller, follower]);
      } else {
        requests[1].resolve(newPayload);
        await newCaller;
        finishOld();
        await oldCaller;
      }
      assert.deepEqual(bundle.waterRegionsPayload, newPayload);
      assert.equal(state.scenarioWaterRegionsData, bundle.waterRegionsPayload);
      assert.equal(bundle.optionalLayerSettledByKey.water, true);
      assert.equal(bundle.optionalLayerPromises.water, undefined);
    });
  }
}

test("optional completion caches its bundle without mutating a same-ID replacement", async (t) => {
  const oldBundle = installOptionalWaterScenario(t);
  let resolvePayload;
  const pending = ensureActiveScenarioOptionalLayerLoaded("water", {
    d3Client: { json: () => new Promise((resolve) => { resolvePayload = resolve; }) },
    renderNow: false,
  });
  const replacement = { manifest: { ...oldBundle.manifest } };
  state.scenarioBundleCacheById.optional_owner_test = replacement;
  const payload = { type: "FeatureCollection", features: [] };
  resolvePayload(payload);
  assert.deepEqual(await pending, payload);
  assert.deepEqual(oldBundle.waterRegionsPayload, payload);
  assert.equal(state.scenarioWaterRegionsData, null);
  assert.equal(replacement.waterRegionsPayload, undefined);
});

test("outgoing strategic payload validation stays bound to its bundle baseline", async (t) => {
  const bundle = installOptionalWaterScenario(t);
  preserveScenarioState(t, ["scenarioBaselineHash", "scenarioStrategicValuesData", "scenarioStrategicValuesRevision"]);
  bundle.manifest.baseline_hash = "baseline-1";
  bundle.manifest.strategic_values_url = "strategic-values.json";
  state.scenarioBaselineHash = "baseline-1";
  state.scenarioStrategicValuesData = null;
  let resolvePayload;
  const pending = ensureActiveScenarioOptionalLayerLoaded("strategic_values", {
    d3Client: { json: () => new Promise((resolve) => { resolvePayload = resolve; }) },
    renderNow: false,
  });
  state.activeScenarioId = "incoming-scenario";
  state.scenarioBaselineHash = "baseline-2";
  const raw = createStrategicValuesFixture();
  raw.scenario_id = "optional_owner_test";
  resolvePayload(raw);
  const payload = await pending;
  assert.deepEqual(payload.diagnostics.errors, []);
  assert.equal(bundle.strategicValuesPayload, payload);
  assert.equal(state.scenarioStrategicValuesData, null);
});
