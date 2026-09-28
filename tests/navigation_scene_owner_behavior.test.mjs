import assert from "node:assert/strict";
import test from "node:test";

import { createNavigationSceneOwner } from "../js/core/renderer/navigation_scene_owner.js";

function feature(id) {
  return { type: "Feature", id, geometry: { type: "Polygon", coordinates: [] } };
}

function fixture(overrides = {}, services = {}) {
  const calls = { prepare: [], draw: [], clear: 0, metrics: [] };
  const projection = {};
  const globalLand = feature("global-land");
  const viewportDetail = feature("viewport-detail");
  const sharedLake = feature("shared-lake");
  const scenarioLake = feature("scenario-lake");
  const state = {
    firstVisibleFramePainted: true,
    bootBlocking: false,
    scenarioApplyInFlight: false,
    activeScenarioId: "scenario-a",
    sceneGeneration: 1,
    colorRevision: 1,
    visualOverrides: {},
    sovereignBaseColors: {},
    colors: { "global-land": "#wrong-runtime-color" },
    landDataFull: { features: [globalLand] },
    landData: { features: [viewportDetail] },
    scenarioPoliticalChunkData: { globalCoverage: true },
    contextLayerExternalDataByName: { lakes: { features: [sharedLake] } },
    waterRegionsData: { features: [sharedLake] },
    scenarioWaterRegionsData: { features: [scenarioLake] },
    showWaterRegions: true,
    showOpenOceanRegions: true,
    styleConfig: { ocean: { fillColor: "#123456" } },
    dpr: 2,
    ...overrides,
  };
  let currentProjection = projection;
  let getIdentity;
  const frame = {
    prepare(options) { calls.prepare.push(options); return true; },
    draw(...args) { calls.draw.push(args); return true; },
    isReady() { return false; },
    clear() { calls.clear++; },
  };
  const surface = {
    getProjection: () => currentProjection,
    getContext: () => ({ canvas: { width: 800, height: 600 } }),
  };
  const helpers = {
    recordMetric: (...args) => calls.metrics.push(args),
    getFeatureId: (item) => item.id,
    getEffectiveAtlantropaFeatures: () => ({ land: [], shoal: [], relief: [], water: [] }),
    getEffectiveWaterRegionFeatures: () => [sharedLake, scenarioLake],
    isAntarcticSectorFeature: () => false,
    isBaseGeographyScenarioFeature: () => false,
    shouldExcludePoliticalVisualFeature: () => false,
    getResolvedFeatureColor: () => "#canonical-land",
    getWaterRegionColor: (id) => id === "shared-lake" ? "#lake" : "#scenario-water",
    getWaterRegionDefaultStyle: () => ({ opacity: 0.75 }),
    isWaterRegionRenderable: () => true,
    collectSafeWaterRegionGeometryParts: (item) => [item],
    getOceanBaseFillColor: () => "#canonical-ocean",
    landFill: "#fallback-land",
  };
  const owner = createNavigationSceneOwner(state, {
    surface, helpers, ...services,
    createFrameOwner({ getIdentity: captured }) {
      getIdentity = captured;
      return frame;
    },
  });
  return {
    state, owner, calls, frame, helpers, getIdentity: () => getIdentity(),
    setProjection: (next) => { currentProjection = next; },
    globalLand, viewportDetail, sharedLake, scenarioLake,
  };
}

function withGeoPath(run) {
  const previous = globalThis.d3;
  globalThis.d3 = {
    geoPath() {
      const path = () => {};
      path.bounds = (shape) => {
        assert.deepEqual(shape, { type: "Sphere" });
        return [[-180, -90], [180, 90]];
      };
      path.context = (context) => (shape) => context.shapes.push(shape);
      return path;
    },
  };
  let result;
  try { result = run(); } catch (error) { globalThis.d3 = previous; throw error; }
  if (result?.then) return result.finally(() => { globalThis.d3 = previous; });
  globalThis.d3 = previous;
  return result;
}

function paintLayer(layer) {
  const painted = [];
  const context = {
    shapes: [],
    beginPath() {},
    fill() { painted.push({ color: this.fillStyle, opacity: this.globalAlpha, shapes: [...this.shapes] }); this.shapes.length = 0; },
  };
  layer.items.forEach((item) => layer.drawItem(context, item));
  return painted;
}

test("whole-scene source uses global coarse base instead of selected viewport detail", () => withGeoPath(() => {
  const a = feature("base-a");
  const b = feature("base-b");
  const f = fixture({
    scenarioBundleCacheById: {
      "scenario-a": {
        chunkRegistry: { byLayer: { political: [
          { id: "a", layer: "political", globalCoverage: true, lod: "coarse" },
          { id: "b", layer: "political", globalCoverage: true, lod: "coarse" },
          { id: "detail", layer: "political", globalCoverage: false, lod: "detail" },
        ] } },
        chunkPayloadCacheById: { a: { payload: { features: [a] } }, b: { payload: { features: [b] } } },
      },
    },
  });
  f.owner.prepare();
  assert.deepEqual(f.calls.prepare[0].layers[1].items, [a, b]);
  assert.equal(f.calls.prepare[0].layers[1].items.includes(f.viewportDetail), false);
  assert.deepEqual(f.calls.prepare[0].bounds, [[-180, -90], [180, 90]]);
}));

test("missing any global base aborts; active payload fallback supplies a complete base", () => withGeoPath(() => {
  const a = feature("base-a");
  const b = feature("base-b");
  const bundle = {
    chunkRegistry: { byLayer: { political: [
      { id: "a", layer: "political", globalCoverage: true, lod: "coarse" },
      { id: "b", layer: "political", globalCoverage: true, lod: "coarse" },
    ] } },
    chunkPayloadCacheById: { a: { payload: { features: [a] } } },
  };
  const f = fixture({ scenarioBundleCacheById: { "scenario-a": bundle } });
  f.owner.prepare();
  assert.equal(f.calls.prepare.length, 0);
  f.state.activeScenarioChunks = { payloadByChunkId: { b: { features: [b] } } };
  f.owner.prepare();
  assert.deepEqual(f.calls.prepare[0].layers[1].items, [a, b]);
}));

test("global water coverage survives viewport chunk promotion and rejects a missing base", () => withGeoPath(() => {
  const wholeWater = feature("whole-water");
  const bundle = { chunkRegistry: { byLayer: { water: [
    { id: "water-base", globalCoverage: true, lod: "coarse" },
    { id: "water-detail", globalCoverage: false, lod: "detail" },
  ] } }, chunkPayloadCacheById: {} };
  const f = fixture({ scenarioBundleCacheById: { "scenario-a": bundle } });
  f.owner.prepare();
  assert.equal(f.calls.prepare.length, 0);
  bundle.chunkPayloadCacheById["water-base"] = { payload: { features: [wholeWater] } };
  f.helpers.getEffectiveWaterRegionFeatures = (_atlantropa, water) => water;
  f.owner.prepare();
  assert.deepEqual(f.calls.prepare[0].layers[3].items, [wholeWater]);
  const identity = f.getIdentity();
  f.state.scenarioWaterRegionsData = { features: [feature("viewport-water")] };
  assert.equal(f.getIdentity(), identity);
  bundle.chunkPayloadCacheById["water-base"] = { payload: { features: [feature("replaced-world")] } };
  assert.equal(f.getIdentity(), identity);
  delete bundle.chunkPayloadCacheById["water-base"];
  assert.equal(f.getIdentity(), identity, "decoded cache eviction must not invalidate already-complete pixels");
  bundle.chunkRegistry.byLayer.water[0].sha256 = "new-content-version";
  assert.notEqual(f.getIdentity(), identity);
}));

test("active scenario without a coarse base or full-coverage marker rejects old land", () => withGeoPath(() => {
  const f = fixture({
    scenarioPoliticalChunkData: null,
    scenarioBundleCacheById: {
      "scenario-a": {
        chunkRegistry: { byLayer: { political: [
          { id: "detail", layer: "political", globalCoverage: false, lod: "detail" },
        ] } },
      },
    },
  });

  f.owner.prepare();

  assert.deepEqual(f.calls.prepare, []);
  assert.equal(f.state.landDataFull.features.length, 1);
}));

test("Atlantropa land and water both use the global base across viewport promotion", () => withGeoPath(() => {
  const atlLand = feature("atl-land");
  const atlWater = feature("atl-water");
  const bundle = { chunkRegistry: { byLayer: { scenario_atlantropa: [
    { id: "atl-base", globalCoverage: true, lod: "coarse" },
  ] } }, chunkPayloadCacheById: {} };
  const f = fixture({ scenarioBundleCacheById: { "scenario-a": bundle } });
  f.owner.prepare();
  assert.equal(f.calls.prepare.length, 0);
  bundle.chunkPayloadCacheById["atl-base"] = { payload: { features: [atlLand, atlWater] } };
  f.helpers.getEffectiveAtlantropaFeatures = (features) => {
    assert.deepEqual(features, [atlLand, atlWater]);
    return { land: [features[0]], water: [features[1]], shoal: [], relief: [] };
  };
  f.helpers.getEffectiveWaterRegionFeatures = (atl) => atl.water;
  f.owner.prepare();
  assert.deepEqual(f.calls.prepare[0].layers[2].items, [atlLand]);
  assert.deepEqual(f.calls.prepare[0].layers[3].items, [atlWater]);
  const identity = f.getIdentity();
  f.state.scenarioAtlantropaData = { features: [feature("viewport-atl")] };
  f.state.scenarioAtlantropaRevision = 10;
  assert.equal(f.getIdentity(), identity);
}));

test("canonical paint hooks win over runtime colors; Sphere ocean uses transparent backdrop", () => withGeoPath(() => {
  const f = fixture();
  f.owner.prepare();
  const scene = f.calls.prepare[0];
  assert.equal(scene.backgroundColor, "transparent");
  assert.deepEqual(scene.layers[0].items, [{ type: "Sphere" }]);
  assert.deepEqual(paintLayer(scene.layers[0]), [{
    color: "#canonical-ocean", opacity: undefined, shapes: [{ type: "Sphere" }],
  }]);
  assert.equal(paintLayer(scene.layers[1])[0].color, "#canonical-land");
  assert.notEqual(paintLayer(scene.layers[1])[0].color, f.state.colors["global-land"]);
}));

test("chunk promotion and paint-neutral color revision retain identity", () => {
  const f = fixture();
  const before = f.getIdentity();
  f.state.activeScenarioChunks = { payloadByChunkId: { detail: { features: [f.viewportDetail] } } };
  f.state.colorRevision++;
  assert.equal(f.getIdentity(), before);
  f.state.visualOverrides["global-land"] = "#f00";
  f.state.colorRevision++;
  const edited = f.getIdentity();
  assert.notEqual(edited, before);
  delete f.state.visualOverrides["global-land"];
  f.state.colorRevision++;
  assert.notEqual(f.getIdentity(), edited);
});

test("scene, projection, water and style edits each invalidate identity", () => {
  const f = fixture();
  let previous = f.getIdentity();
  const change = (edit) => {
    edit();
    const next = f.getIdentity();
    assert.notEqual(next, previous);
    previous = next;
  };
  change(() => { f.state.sceneGeneration++; });
  change(() => { f.setProjection({}); });
  change(() => { f.state.waterRegionsData = { features: [] }; });
  change(() => { f.state.showWaterRegions = false; });
  change(() => { f.state.styleConfig.ocean.fillColor = "#654321"; });
});

test("shared lakes remain visible while scenario lakes obey the water toggle", () => withGeoPath(() => {
  const f = fixture({ showWaterRegions: false });
  f.owner.prepare();
  const water = f.calls.prepare[0].layers[3];
  assert.deepEqual(water.items, [f.sharedLake]);
  assert.deepEqual(paintLayer(water), [{
    color: "#lake", opacity: 0.75, shapes: [f.sharedLake],
  }]);
  f.state.showWaterRegions = true;
  f.owner.prepare();
  assert.deepEqual(f.calls.prepare[1].layers[3].items, [f.sharedLake, f.scenarioLake]);
}));

test("navigation borrows warm projected water and land paths without streaming geometry again", () => withGeoPath(() => {
  const f = fixture();
  const landPath = {};
  const waterPath = {};
  f.helpers.getCachedLandPath = (item, id) => {
    assert.equal(item, f.globalLand);
    assert.equal(id, f.globalLand.id);
    return landPath;
  };
  f.helpers.getCachedWaterPath = (_item, parts) => {
    assert.equal(parts.length, 1);
    return waterPath;
  };
  f.owner.prepare();
  const fills = [];
  const context = { fill(path) { fills.push(path); }, beginPath() { assert.fail("warm path should not be streamed"); } };
  for (const index of [1, 3]) {
    const layer = f.calls.prepare[0].layers[index];
    layer.items.forEach((item) => layer.drawItem(context, item));
  }
  assert.deepEqual(fills, [landPath, waterPath, waterPath]);
}));

test("evicted global water sources are requested once and passed directly to the raster job", () => withGeoPath(async () => {
  const bundle = { chunkRegistry: { byLayer: { water: [
    { id: "water-base", globalCoverage: true, lod: "coarse" },
  ] } }, chunkPayloadCacheById: {} };
  const f = fixture({ scenarioBundleCacheById: { "scenario-a": bundle } });
  let resolveLoad;
  const requested = [];
  f.helpers.ensureNavigationSources = (layers) => {
    requested.push(layers);
    return new Promise((resolve) => { resolveLoad = resolve; });
  };
  f.helpers.getEffectiveWaterRegionFeatures = (_atlantropa, water) => water;
  f.owner.prepare();
  f.owner.prepare();
  await Promise.resolve();
  assert.deepEqual(requested, [["water"]]);
  assert.equal(f.calls.prepare.length, 0, "a viewport subset cannot stand in for the whole scene");
  const water = feature("whole-water");
  resolveLoad({ water: [{ features: [water] }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.prepare.length, 1);
  assert.deepEqual(f.calls.prepare[0].layers[3].items, [water]);
  assert.deepEqual(bundle.chunkPayloadCacheById, {}, "job does not depend on decoded cache residency");
  assert.equal(f.state.landData.features[0], f.viewportDetail, "active selection is unchanged");
  f.owner.prepare();
  assert.equal(requested.length, 1, "an accepted job does not reload its evicted input");
}));

test("late source completion cannot prepare or clear a newer scene request", () => withGeoPath(async () => {
  const makeBundle = () => ({ chunkRegistry: { byLayer: { water: [
    { id: "water-base", globalCoverage: true, lod: "coarse" },
  ] } }, chunkPayloadCacheById: {} });
  const f = fixture({ scenarioBundleCacheById: { "scenario-a": makeBundle(), "scenario-b": makeBundle() } });
  const completions = [];
  f.helpers.ensureNavigationSources = () => new Promise((resolve) => completions.push(resolve));
  f.helpers.getEffectiveWaterRegionFeatures = (_atlantropa, water) => water;
  f.owner.prepare();
  await Promise.resolve();
  f.state.activeScenarioId = "scenario-b";
  f.state.sceneGeneration++;
  f.owner.prepare();
  await Promise.resolve();
  completions[0]({ water: [{ features: [feature("old-water")] }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.prepare.length, 0);
  f.owner.prepare();
  await Promise.resolve();
  assert.equal(completions.length, 2, "obsolete finalization must not clear the current request");
  completions[1]({ water: [{ features: [feature("current-water")] }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.prepare[0].layers[3].items[0].id, "current-water");
}));

test("failed or cleared navigation source requests do not publish or retry on every frame", () => withGeoPath(async () => {
  const bundle = { chunkRegistry: { byLayer: { water: [
    { id: "water-base", globalCoverage: true, lod: "coarse" },
  ] } }, chunkPayloadCacheById: {} };
  const f = fixture({ scenarioBundleCacheById: { "scenario-a": bundle } });
  let attempts = 0;
  f.helpers.ensureNavigationSources = async () => { attempts++; throw new Error("unavailable"); };
  f.owner.prepare();
  await new Promise((resolve) => setImmediate(resolve));
  f.owner.prepare();
  await Promise.resolve();
  assert.equal(attempts, 1);
  assert.equal(f.calls.prepare.length, 0);
  assert.equal(f.calls.metrics.at(-1)[0], "navigationSourceLoadFailed");
  f.owner.clear();
  let resolveLoad;
  f.helpers.ensureNavigationSources = () => new Promise((resolve) => { resolveLoad = resolve; });
  f.owner.prepare();
  await Promise.resolve();
  f.owner.clear();
  resolveLoad({ water: [{ features: [feature("late-water")] }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.prepare.length, 0);
}));


test("early prefetch survives paint changes and retains evicted inputs until apply finishes", () => withGeoPath(async () => {
  const bundle = { chunkRegistry: { byLayer: { water: [
    { id: "water-base", globalCoverage: true, lod: "coarse" },
  ] } }, chunkPayloadCacheById: {} };
  const f = fixture({ scenarioApplyInFlight: true, bootBlocking: true, firstVisibleFramePainted: false,
    scenarioBundleCacheById: { "scenario-a": bundle } });
  let loads = 0;
  const water = feature("early-water");
  f.helpers.ensureNavigationSources = async () => { loads++; return { water: [{ features: [water] }] }; };
  f.helpers.getEffectiveWaterRegionFeatures = (_atlantropa, features) => features;
  f.owner.prewarm();
  f.state.colorRevision++;
  f.state.visualOverrides = { changed: "#123" };
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  assert.equal(f.calls.prepare.length, 0);
  f.state.scenarioApplyInFlight = false;
  f.state.bootBlocking = false;
  f.owner.prepare();
  assert.equal(f.calls.prepare.length, 1);
  assert.equal(f.calls.prepare[0].layers[3].items[0], water);
  assert.deepEqual(bundle.chunkPayloadCacheById, {});
}));

test("navigation worker receives canonical ordered paints and compound water geometry then is disposed", () => withGeoPath(async () => {
  let packet, requestSignal, disposed = 0, yields = 0;
  const result = { bitmap: {} };
  const f = fixture({}, {
    yieldTask: async () => { yields++; },
    createWorkerClient: () => ({ available: () => true, dispose: () => disposed++,
      request: async (input, { signal }) => { packet = input; requestSignal = signal; return result; } }),
  });
  f.helpers.collectSafeWaterRegionGeometryParts = (item) => [item, feature("hole")];
  f.owner.prepare();
  const signal = new AbortController().signal;
  const raster = f.calls.prepare[0];
  assert.equal(await raster.renderRaster({ width: 1024, height: 512, bounds: raster.bounds, signal }), result);
  assert.equal(packet.kind, "navigation");
  assert.equal(packet.entries[0].feature.geometry.type, "Sphere");
  assert.deepEqual(packet.entries.map((e) => e.fillColor), ["#canonical-ocean", "#canonical-land", "#lake", "#scenario-water"]);
  assert.equal(packet.entries[2].alpha, 0.75);
  assert.equal(packet.entries[2].feature.geometry.type, "GeometryCollection");
  assert.equal(packet.entries[2].feature.geometry.geometries.length, 2);
  assert.equal(new Set(packet.entries.map(e => e.id)).size, packet.entries.length);
  assert.equal(requestSignal, signal);
  assert.equal(disposed, 1);
  assert.ok(yields > 0);
}));


test("prewarm discovers a missing registry and prepares privately before apply unlock", () => withGeoPath(async () => {
  const bundle = {};
  const water = feature("early-water");
  const f = fixture({ scenarioApplyInFlight: true, firstVisibleFramePainted: false,
    scenarioBundleCacheById: { "scenario-a": bundle } });
  f.helpers.ensureNavigationSources = async (layers) => {
    assert.deepEqual(layers, ["political", "water", "scenario_atlantropa"]);
    bundle.chunkRegistry = { byLayer: { water: [{ id: "water-base", globalCoverage: true, lod: "coarse" }] } };
    return { political: [], water: [{ features: [water] }], scenario_atlantropa: [] };
  };
  f.helpers.getEffectiveWaterRegionFeatures = (_atlantropa, features) => features;
  f.owner.prewarm();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.scenarioApplyInFlight, true);
  assert.equal(f.calls.prepare.length, 1);
  assert.equal(f.calls.prepare[0].layers[3].items[0], water);
}));
