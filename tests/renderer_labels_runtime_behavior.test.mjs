import test from "node:test";
import assert from "node:assert/strict";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";

function createHarness(overrides = {}, context = null) {
  const state = {
    width: 800, height: 600, showCityPoints: true,
    worldCitiesData: { type: "FeatureCollection", features: [] },
    zoomTransform: { x: 0, y: 0, k: 2 },
    styleConfig: { cityPoints: {}, countryLabels: { enabled: false } },
    ...overrides,
  };
  let exporting = false;
  const renders = [];
  const metrics = [];
  const projection = ([x, y]) => [x, y];
  const runtime = createLabelsRuntime({
    runtimeState: state,
    rendererSurfaceHost: {
      getContext: () => context,
      getProjection: () => projection,
      getMapSvg: () => null,
      getPathCanvas: () => null,
    },
    TEXTURE_LABEL_SERIF_STACK: "serif",
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    normalizeLongitude: value => value,
    getDisplayOwnerCode: () => "",
    getSignedHashUnit: () => 0,
    getLabelPaintBounds: () => null,
    getLabelPaintOverscanPx: () => 0,
    getFeatureCollectionFeatureCount: collection => collection?.features?.length || 0,
    isExportRenderInProgress: () => exporting,
    isPrivateSceneActive: () => true,
    invalidateRenderPasses: () => {},
    requestRendererRender: reason => renders.push(reason),
    nowMs: () => 0,
    collectContextMetric: (name, elapsed, detail) => metrics.push({ name, detail }),
    recordRenderPerfMetric: () => {},
    recordInteractionDurationMetric: () => {},
    drawPendingTransportLabels: () => {},
    drawPhysicalRegionLabels: () => {},
  });
  return { runtime, state, renders, metrics, setExporting: value => { exporting = value; } };
}

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

test("creation and readiness observation leave owners, DOM and workers uninitialized", (t) => {
  const unexpected = () => assert.fail("initialization touched an external resource");
  replaceGlobal(t, "document", { get fonts() { return unexpected(); }, createElement: unexpected });
  replaceGlobal(t, "Worker", class { constructor() { unexpected(); } });
  const runtime = createLabelsRuntime({
    runtimeState: { styleConfig: { countryLabels: { enabled: true } } },
    rendererSurfaceHost: { getProjection: unexpected, getContext: unexpected },
  });
  assert.deepEqual(runtime.getCountryLabelReadiness(), {
    expected: true, ready: false, sourceStatus: "uninitialized",
  });
  assert.deepEqual(runtime.getVisibleMapLabels(), { cities: [], countries: [], pendingCountryFits: 0 });
  runtime.reset();
  assert.equal(runtime.getCountryLabelReadiness().sourceStatus, "uninitialized");
});

test("first use creates owners once and subsequent use retains them", (t) => {
  const subscriptions = [];
  replaceGlobal(t, "document", { fonts: {
    status: "loaded", addEventListener: (...args) => subscriptions.push(args),
  } });
  const { runtime } = createHarness({ showCityPoints: false,
    styleConfig: { countryLabels: { enabled: true } } });
  assert.equal(subscriptions.length, 0);
  const policy = runtime.getUrbanCityPolicyOwner();
  assert.equal(runtime.getUrbanCityPolicyOwner(), policy);
  runtime.drawLabelsPassContent(2);
  runtime.drawLabelsPassContent(2);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0][0], "loadingdone");
});

test("reset cancels old city preparation after scene and data replacement", async () => {
  const { runtime, state, renders, metrics } = createHarness({
    worldCitiesData: { type: "FeatureCollection", features: [{ type: "Feature", id: "first",
      properties: { name: "First", __city_id: "first" },
      geometry: { type: "Point", coordinates: [100, 100] } }] },
  });
  assert.equal(await runtime.prepareCityPointsPass(), true);
  const published = runtime.getCachedEffectiveCityCollection();
  state.worldCitiesData = { type: "FeatureCollection", features: [] };
  state.activeScenarioId = "replacement";
  state.sceneGeneration = 1;
  const pending = runtime.prepareCityPointsPass();
  assert.ok(pending instanceof Promise);
  runtime.reset();
  assert.equal(await pending, false);
  runtime.drawCityPointsLayer(2);
  assert.equal(metrics.at(-1).detail.reason, "preparing");
  assert.equal(runtime.getCachedEffectiveCityCollection(), published);
  assert.equal(renders.filter(reason => reason === "city-plan-prepared").length, 1);
  assert.equal(await runtime.prepareCityPointsPass(), true);
  assert.notEqual(runtime.getCachedEffectiveCityCollection(), published);
  runtime.drawCityPointsLayer(2);
  assert.equal(metrics.at(-1).detail.reason, "no-data");
});

test("export mode is read at each preparation and during pending work", async () => {
  const { runtime, state, setExporting } = createHarness();
  setExporting(true);
  assert.equal(runtime.prepareLabelsPass(), null);
  assert.equal(runtime.getCachedEffectiveCityCollection(), null);
  setExporting(false);
  assert.equal(await runtime.prepareCityPointsPass(), true);
  state.cityLayerRevision = 1;
  const pending = runtime.prepareCityPointsPass();
  setExporting(true);
  assert.equal(await pending, false);
  assert.equal(runtime.prepareLabelsPass(), null);
  setExporting(false);
  assert.equal(await runtime.prepareCityPointsPass(), true);
});

test("country readiness rejects the old source after topology replacement and reset", async (t) => {
  replaceGlobal(t, "topojson", { merge: () => ({ type: "MultiPolygon", coordinates: [] }) });
  const topology = () => ({ objects: { political: { type: "GeometryCollection", geometries: [] } } });
  const { runtime, state } = createHarness({ showCityPoints: false,
    topology: topology(), styleConfig: { countryLabels: { enabled: true } } }, { save() {}, restore() {} });
  await runtime.prepareLabelsPass();
  runtime.drawLabelsPassContent(2);
  assert.equal(runtime.getCountryLabelReadiness().ready, true);
  state.topology = topology();
  state.sceneGeneration = 1;
  runtime.reset();
  assert.deepEqual(runtime.getCountryLabelReadiness(), {
    expected: true, ready: false, sourceStatus: "pending",
  });
  await runtime.prepareLabelsPass();
  runtime.drawLabelsPassContent(2);
  assert.equal(runtime.getCountryLabelReadiness().ready, true);
});
