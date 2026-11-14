import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioRegionOverlayRenderOwner } from "../js/core/renderer/scenario_region_overlay_render_owner.js";

function createWarmupHarness(t, { budget = 32 * 1024 * 1024 } = {}) {
  const previousPath2D = globalThis.Path2D;
  class TestPath2D {
    constructor() { this.parts = []; }
    addPath(path) { this.parts.push(path); }
  }
  globalThis.Path2D = TestPath2D;
  t.after(() => { globalThis.Path2D = previousPath2D; });
  const jobs = [], renders = [], metrics = [], svgBuilds = [];
  const projection = {};
  let clock = 0;
  const makePart = (id, visible = true) => ({ id, visible, type: "Polygon",
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
  const features = [{ id: "water", geometry: {}, parts: [makePart("a"), makePart("b")] }];
  const state = { firstVisibleFramePainted: true, renderPhase: "idle", showWaterRegions: true,
    activeScenarioId: "tno_1962", sceneGeneration: 1, scenarioDataGeneration: 1,
    contextLayerRevision: 1, zoomTransform: { x: 0, y: 0, k: 2 }, width: 100, height: 100, dpr: 1 };
  const owner = createScenarioRegionOverlayRenderOwner(state, {
    rendererSurfaceHost: { getPathSvg: () => (part) => { svgBuilds.push(part.id); return "M1,2Z"; },
      getProjection: () => projection },
    nowMs: () => { clock += 2; return clock; },
    collectContextMetric: (name, ms, payload) => metrics.push({ name, ms, payload }),
    collectSafeWaterRegionGeometryParts: (feature) => feature.parts,
    computeProjectedGeoBounds: (part) => ({ visible: part.visible }),
    projectedGeoBoundsInScreen: (bounds) => bounds?.visible,
    isWaterRegionRenderable: () => true,
    getWaterRegionDefaultStyle: () => ({ opacity: 1 }),
    getEffectiveAtlantropaFeatures: () => ({}),
    getEffectiveWaterRegionFeatures: () => features,
    getScenarioWaterVisualRevisionToken: () => "water-revision-1",
    waterPathCacheBudget: budget,
    scheduleWaterWork: (callback) => {
      const job = { callback, canceled: false };
      jobs.push(job);
      return job;
    },
    cancelWaterWork: (job) => { job.canceled = true; },
    requestRender: (reason) => renders.push(reason),
  });
  const runNext = () => {
    const job = jobs.shift();
    if (job && !job.canceled) job.callback();
  };
  return { owner, state, features, jobs, renders, metrics, svgBuilds, runNext, makePart };
}

test("visible water paths warm across slices and wake one exact render", (t) => {
  const h = createWarmupHarness(t);
  assert.equal(h.owner.prepareVisibleWaterPaths(), false);
  assert.equal(h.owner.prepareVisibleWaterPaths(), false, "same identity has one pending task");
  h.runNext();
  assert.deepEqual(h.svgBuilds, ["a"]);
  assert.deepEqual(h.renders, []);
  assert.equal(h.jobs.length, 1);
  h.runNext();
  assert.deepEqual(h.svgBuilds, ["a", "b"]);
  assert.deepEqual(h.renders, ["visible-water-paths-ready"]);
  assert.ok(h.owner.getCachedWaterFeaturePath(h.features[0], h.features[0].parts));
  assert.equal(h.owner.prepareVisibleWaterPaths(), true, "warm exact draw has no preparation gate");
  assert.deepEqual(h.svgBuilds, ["a", "b"]);
  const originalPath = h.owner.getCachedWaterFeaturePath(h.features[0], h.features[0].parts);
  h.state.activeScenarioId = "next-scenario";
  h.state.sceneGeneration += 1;
  h.state.dpr = 3;
  const nextFeatureWrapper = { ...h.features[0], geometry: { type: "MultiPolygon" }, paint: "updated" };
  h.features[0] = nextFeatureWrapper;
  assert.equal(h.owner.getCachedWaterFeaturePath(nextFeatureWrapper, [...h.features[0].parts]), originalPath,
    "cached projection geometry is reusable across sanitized wrappers, scene paints, and export DPR");
  assert.equal(h.owner.prepareVisibleWaterPaths(), true, "warmup recognizes the alias instead of rebuilding paths");
  assert.equal(h.jobs.length, 0);
  assert.deepEqual(h.svgBuilds, ["a", "b"], "wrapper and target density changes do not rebuild paths");
});

test("gesture and changed transform abandon stale warmup until next idle selection", (t) => {
  const h = createWarmupHarness(t);
  assert.equal(h.owner.prepareVisibleWaterPaths(), false);
  h.state.renderPhase = "interacting";
  h.runNext();
  assert.deepEqual(h.svgBuilds, []);
  assert.deepEqual(h.renders, []);
  assert.equal(h.owner.prepareVisibleWaterPaths(), true);
  h.state.renderPhase = "idle";
  assert.equal(h.owner.prepareVisibleWaterPaths(), false);
  h.state.zoomTransform.x = 10;
  h.runNext();
  assert.deepEqual(h.renders, []);
  assert.equal(h.owner.prepareVisibleWaterPaths(), false);
  while (h.jobs.length) h.runNext();
  assert.deepEqual(h.renders, ["visible-water-paths-ready"]);
});

test("over-budget visible water skips warmup without permanent pending gate", (t) => {
  const h = createWarmupHarness(t, { budget: 100 });
  assert.equal(h.owner.prepareVisibleWaterPaths(), true);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.metrics.at(-1).payload.reason, "over-budget");
  assert.equal(h.owner.prepareVisibleWaterPaths(), true);
  assert.equal(h.metrics.length, 1, "same identity does not retry warmup");
});
