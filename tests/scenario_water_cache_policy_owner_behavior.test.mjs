import assert from "node:assert/strict";
import test from "node:test";

import { createScenarioWaterCachePolicyOwner } from "../js/core/renderer/scenario_water_cache_policy_owner.js";

function createFeature(id, parts = [], { renderable = true } = {}) {
  return { id, parts, renderable };
}

function createPart(id) {
  return { id };
}

function createHarness({
  modelState: modelStateOverrides = {},
  query = {},
  dpr = 1,
  previousRenderedCount = 0,
  boundsByPartId = {},
  constants = {},
} = {}) {
  const modelState = {
    width: 100,
    height: 100,
    zoomTransform: { x: 0, y: 0, k: 1 },
    ...modelStateOverrides,
  };
  const calls = {
    safeParts: [],
    projectedBounds: [],
    renderable: [],
    transforms: [],
  };
  const owner = createScenarioWaterCachePolicyOwner({
    state: modelState,
    constants,
    getters: {
      readSearchParam: (name) => query[name] || "",
      getDevicePixelRatio: () => dpr,
      getPreviousRenderedCount: () => previousRenderedCount,
    },
    helpers: {
      cloneZoomTransform: (transform) => {
        calls.transforms.push({ ...transform });
        return {
          x: Number(transform?.x || 0),
          y: Number(transform?.y || 0),
          k: Number(transform?.k || 1),
        };
      },
      collectSafeWaterRegionGeometryParts: (feature) => {
        calls.safeParts.push(feature?.id);
        return Array.isArray(feature?.parts) ? feature.parts : [];
      },
      computeProjectedGeoBounds: (part) => {
        calls.projectedBounds.push(part?.id);
        return boundsByPartId[part?.id] || null;
      },
      isWaterRegionRenderable: (feature) => {
        calls.renderable.push(feature?.id);
        return feature?.renderable !== false;
      },
    },
  });
  return { calls, modelState, owner };
}

test("normalizes scenario water cache strategy modes", () => {
  const { owner } = createHarness();

  assert.equal(owner.normalizeScenarioWaterCacheStrategyMode(" adaptive "), "adaptive");
  assert.equal(owner.normalizeScenarioWaterCacheStrategyMode("REUSE"), "reuse");
  assert.equal(owner.normalizeScenarioWaterCacheStrategyMode("redraw"), "redraw");
  assert.equal(owner.normalizeScenarioWaterCacheStrategyMode("direct"), "direct");
  assert.equal(owner.normalizeScenarioWaterCacheStrategyMode("unknown"), "");
});

test("resolves cache mode precedence from query render profile state and default", () => {
  assert.deepEqual(
    createHarness({
      query: { water_cache_mode: "direct" },
      modelState: {
        renderProfile: { waterCacheMode: "reuse" },
        scenarioWaterCacheMode: "redraw",
      },
    }).owner.getForcedScenarioWaterCacheMode(),
    { mode: "direct", source: "query-param" },
  );
  assert.deepEqual(
    createHarness({
      modelState: {
        renderProfile: { scenarioWaterCacheMode: "reuse" },
        waterCacheMode: "redraw",
      },
    }).owner.getForcedScenarioWaterCacheMode(),
    { mode: "reuse", source: "render-profile" },
  );
  assert.deepEqual(
    createHarness({ modelState: { scenarioWaterCacheMode: "redraw" } }).owner.getForcedScenarioWaterCacheMode(),
    { mode: "redraw", source: "state" },
  );
  assert.deepEqual(createHarness().owner.getForcedScenarioWaterCacheMode(), { mode: "adaptive", source: "default" });
});

test("normalizes and resolves coverage algo precedence", () => {
  const { owner } = createHarness();
  assert.equal(owner.normalizeScenarioWaterCoverageAlgo(" legacy "), "legacy");
  assert.equal(owner.normalizeScenarioWaterCoverageAlgo("GRID"), "grid");
  assert.equal(owner.normalizeScenarioWaterCoverageAlgo("unknown"), "");

  assert.deepEqual(
    createHarness({
      query: { scenario_water_cache_coverage_algo: "legacy" },
      modelState: {
        renderProfile: { waterCacheCoverageAlgo: "grid" },
        waterCacheCoverageAlgo: "grid",
      },
    }).owner.getForcedScenarioWaterCoverageAlgo(),
    { algo: "legacy", source: "query-param" },
  );
  assert.deepEqual(
    createHarness({
      modelState: {
        renderProfile: { scenarioWaterCacheCoverageAlgo: "legacy" },
        scenarioWaterCacheCoverageAlgo: "grid",
      },
    }).owner.getForcedScenarioWaterCoverageAlgo(),
    { algo: "legacy", source: "render-profile" },
  );
  assert.deepEqual(
    createHarness({ modelState: { scenarioWaterCacheCoverageAlgo: "legacy" } }).owner.getForcedScenarioWaterCoverageAlgo(),
    { algo: "legacy", source: "state" },
  );
  assert.deepEqual(createHarness().owner.getForcedScenarioWaterCoverageAlgo(), { algo: "grid", source: "default" });
});

test("legacy coverage uses viewport transform safe parts bounds and renderable filtering", () => {
  const partA = createPart("A");
  const partB = createPart("B");
  const renderable = createFeature("renderable", [partA]);
  const ignored = createFeature("ignored", [partB], { renderable: false });
  const { calls, owner } = createHarness({
    modelState: { width: 100, height: 100, zoomTransform: { x: 10, y: 0, k: 2 } },
    boundsByPartId: {
      A: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
      B: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    },
  });

  assert.equal(owner.getScenarioWaterVisibleCoverageRatioLegacy([renderable, ignored]), 0.16);
  assert.deepEqual(calls.renderable, ["renderable", "ignored"]);
  assert.deepEqual(calls.safeParts, ["renderable"]);
  assert.deepEqual(calls.projectedBounds, ["A"]);
});

test("coverage snapshots the current zoom once for all parts in each legacy or grid scan", () => {
  const feature = createFeature("water", [createPart("A"), createPart("B")]);
  const { calls, modelState, owner } = createHarness({ boundsByPartId: {
    A: { minX: 0, minY: 0, maxX: 20, maxY: 50 },
    B: { minX: 20, minY: 0, maxX: 40, maxY: 50 },
  } });
  assert.equal(owner.getScenarioWaterVisibleCoverageRatioLegacy([feature]), 0.2);
  assert.equal(calls.transforms.length, 1);
  const firstGrid = owner.getScenarioWaterVisibleCoverageRatioGrid([feature]);
  assert.equal(calls.transforms.length, 2);
  modelState.zoomTransform = { x: 0, y: 0, k: 2 };
  assert.equal(owner.getScenarioWaterVisibleCoverageRatioLegacy([feature]), 0.8);
  assert.equal(calls.transforms.length, 3);
  assert.ok(owner.getScenarioWaterVisibleCoverageRatioGrid([feature]) > firstGrid);
  assert.equal(calls.transforms.length, 4);
});

test("grid coverage respects grid constants capped dpr invalid viewport and clamp", () => {
  const part = createPart("grid");
  const constants = {
    scenarioWaterCoverageGridBaseColumns: 4,
    scenarioWaterCoverageGridBaseRows: 2,
    scenarioWaterCoverageGridMaxDpr: 2,
  };
  const feature = createFeature("water", [part]);

  assert.equal(
    createHarness({
      dpr: 5,
      constants,
      boundsByPartId: { grid: { minX: 0, minY: 0, maxX: 25, maxY: 50 } },
    }).owner.getScenarioWaterVisibleCoverageRatioGrid([feature]),
    0.125,
  );
  assert.equal(
    createHarness({
      modelState: { width: 0 },
      constants,
      boundsByPartId: { grid: { minX: 0, minY: 0, maxX: 25, maxY: 50 } },
    }).owner.getScenarioWaterVisibleCoverageRatioGrid([feature]),
    0,
  );
  assert.equal(
    createHarness({
      constants,
      boundsByPartId: { grid: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 } },
    }).owner.getScenarioWaterVisibleCoverageRatioGrid([feature]),
    1,
  );
});

test("complexity signals include rounded coverage previous count and coverage source", () => {
  const part = createPart("ratio");
  const feature = createFeature("water", [part]);
  const { owner } = createHarness({
    previousRenderedCount: 7,
    modelState: { waterCacheCoverageAlgo: "legacy" },
    boundsByPartId: {
      ratio: { minX: 0, minY: 0, maxX: 33.333, maxY: 100 },
    },
  });

  assert.deepEqual(owner.getScenarioWaterCacheComplexitySignals([feature]), {
    featureCount: 1,
    visibleCoverageRatio: 0.3333,
    previousRenderedCount: 7,
    waterCoverageAlgo: "legacy",
    waterCoverageAlgoSource: "state",
  });
});

test("direct scenario water draw decision follows all low complexity thresholds", () => {
  const { owner } = createHarness();
  const below = { featureCount: 24, visibleCoverageRatio: 0.2, previousRenderedCount: 28 };

  assert.equal(owner.shouldUseDirectScenarioWaterDraw(below), true);
  assert.equal(owner.shouldUseDirectScenarioWaterDraw({ ...below, featureCount: 25 }), false);
  assert.equal(owner.shouldUseDirectScenarioWaterDraw({ ...below, visibleCoverageRatio: 0.2001 }), false);
  assert.equal(owner.shouldUseDirectScenarioWaterDraw({ ...below, previousRenderedCount: 29 }), false);
});
