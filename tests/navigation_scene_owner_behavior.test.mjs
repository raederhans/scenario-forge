import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createNavigationSceneOwner } from "../js/core/renderer/navigation_scene_owner.js";
import { getRegionalBackgroundColor } from "../js/core/renderer/regional_backdrop.js";

function feature(id) {
  return { type: "Feature", id, geometry: { type: "Polygon", coordinates: [] } };
}

function fixture(overrides = {}, services = {}) {
  const calls = { prepare: [] };
  const viewportDetail = feature("viewport-detail");
  const state = {
    firstVisibleFramePainted: true,
    activeScenarioId: "scenario-a",
    sceneGeneration: 1,
    landDataFull: { features: [feature("global-land")] },
    landData: { features: [viewportDetail] },
    scenarioPoliticalChunkData: { globalCoverage: true },
    showWaterRegions: true,
    ...overrides,
  };
  let currentProjection = {};
  const surface = {
    getProjection: () => currentProjection,
    getContext: () => ({ canvas: { width: 800, height: 600 } }),
  };
  const helpers = {
    recordMetric() {},
    getFeatureId: (item) => item.id,
    getEffectiveAtlantropaFeatures: () => ({ land: [], shoal: [], relief: [], water: [] }),
    getEffectiveWaterRegionFeatures: () => [],
    isAntarcticSectorFeature: () => false,
    isBaseGeographyScenarioFeature: () => false,
    shouldExcludePoliticalVisualFeature: () => false,
    getResolvedFeatureColor: () => "#canonical-land",
    isWaterRegionRenderable: () => true,
    collectSafeWaterRegionGeometryParts: (item) => [item],
    getOceanBaseFillColor: () => "#canonical-ocean",
    landFill: "#fallback-land",
  };
  const owner = createNavigationSceneOwner(state, {
    surface, helpers, ...services,
    createFrameOwner: () => ({
      prepare(options) { calls.prepare.push(options); return true; },
      clear() {}, isReady: () => false,
    }),
  });
  return {
    state, owner, calls, helpers, viewportDetail,
    setProjection: (next) => { currentProjection = next; },
  };
}

async function withGeoPath(run) {
  const previous = globalThis.d3;
  globalThis.d3 = {
    geoPath() {
      const path = () => {};
      path.bounds = (shape) => {
        assert.deepEqual(shape, { type: "Sphere" });
        return [[-180, -90], [180, 90]];
      };
      path.context = () => () => {};
      return path;
    },
  };
  try { return await run(); } finally { globalThis.d3 = previous; }
}

function paintLayer(layer) {
  const painted = [];
  const context = {
    beginPath() {},
    fill() { painted.push(this.fillStyle); },
  };
  layer.items.forEach((item) => layer.drawItem(context, item));
  return painted;
}

test("regional navigation paints the same backdrop on canvas and in the worker after mode changes", t => withGeoPath(async () => {
  const previous = globalThis.topojson;
  globalThis.topojson = createRequire(import.meta.url)("../vendor/topojson-client.min.js");
  t.after(() => previous ? globalThis.topojson = previous : delete globalThis.topojson);
  const region = { bounds: [0, 0, 20, 10] };
  let packet;
  const f = fixture({ activeScenarioManifest: { region }, showWaterRegions: false,
    contextLayerExternalDataByName: {}, topologyPrimary: { type: "Topology", arcs: [], objects: {
      land: { type: "Point", coordinates: [15, 5] },
    } } }, { yieldTask: () => {}, createWorkerClient: () => ({
      available: () => true, request: value => { packet = value; }, dispose() {},
    }) });
  t.after(f.owner.dispose);
  f.setProjection(Object.assign(point => point, { rotate: () => [0, 0, 0] }));
  f.helpers.getOceanBaseFillColor = () => getRegionalBackgroundColor(f.state.activeScenarioManifest, "#227799");
  for (const [backdrop, fill, expected] of [
    ["none", "#343434", ["#343434", "#canonical-land"]],
    ["none", undefined, ["#227799", "#canonical-land"]],
    ["land", undefined, ["#227799", "#b9b7b2", "#canonical-land"]],
  ]) {
    Object.assign(region, { backdrop, backdrop_fill: fill });
    f.owner.prepare();
    const frame = f.calls.prepare.at(-1);
    assert.equal(frame.backgroundColor, backdrop === "none" ? expected[0] : "transparent");
    assert.deepEqual(frame.layers.flatMap(paintLayer), expected);
    await frame.renderRaster({ width: 20, height: 10, bounds: frame.bounds, signal: new AbortController().signal });
    assert.deepEqual(packet.entries.map(entry => entry.fillColor), expected);
  }
}));

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
