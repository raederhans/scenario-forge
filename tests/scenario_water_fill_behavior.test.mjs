import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { parse } from "acorn";
import { getFeatureId as getSharedFeatureId } from "../js/core/feature_identity.js";
import { isLakeRegion } from "../js/core/renderer/effective_water_regions.js";
import { createScenarioRegionOverlayRenderOwner } from "../js/core/renderer/scenario_region_overlay_render_owner.js";

const rendererSource = readFileSync(
  new URL("../js/core/renderer/scenario_region_overlay_render_owner.js", import.meta.url),
  "utf8",
);

function extractFunctionSource(source, functionName) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const factory = ast.body.find((node) => node.type === "ExportNamedDeclaration").declaration;
  const declaration = factory.body.body.find((node) => (
    node.type === "FunctionDeclaration" && node.id?.name === functionName
  ));
  assert.ok(declaration, `scenario region overlay owner must define ${functionName}`);
  return source.slice(declaration.start, declaration.end);
}

const drawScenarioWaterFillLayerSource = extractFunctionSource(
  rendererSource,
  "drawScenarioWaterFillLayer",
);

function createWaterPathHarness({ withContext = true } = {}) {
  const liveContext = { name: "live-canvas" };
  let currentContext = liveContext;
  const svgCalls = [];
  const pathCache = new Map();
  const projection = {};
  let projectionGeneration = 1;
  let addPathCalls = 0;
  let clock = 0;
  class Path2D {
    constructor(svg = null) { this.svg = svg; this.parts = []; }
    addPath(other) { addPathCalls++; this.parts.push(other); }
  }
  const pathCanvas = (candidate) => {
    if (candidate.throwStream) throw new Error("stream failed");
    currentContext.parts.push(candidate.id);
  };
  if (withContext) pathCanvas.context = function (next) {
    if (arguments.length) { currentContext = next; return this; }
    return currentContext;
  };
  const scope = vm.createContext({
    Path2D, scenarioWaterPathCache: pathCache, scenarioWaterFeaturePathKeyByPart: new WeakMap(),
    waterPathBuildCount: 0, waterPathBuildMs: 0, waterPathBuildDepth: 0,
    nowMs: () => { clock += 5; return clock; },
    getProjectionGeometryGeneration: () => projectionGeneration,
    rendererSurfaceHost: {
      getProjection: () => projection,
      getPathCanvas: () => pathCanvas,
      getPathSvg: () => (candidate) => {
        svgCalls.push(candidate.id);
        if (candidate.throwSvg) throw new Error("SVG path failed");
        return candidate.svg ?? "M1,2Z";
      },
    },
    getGeometryRetentionWeights: () => ({ path: 512 }),
    waterPathCacheBudget: 1_000_000,
  });
  vm.runInContext(`${extractFunctionSource(rendererSource, "getScenarioWaterPartPath")}\n`
    + `${extractFunctionSource(rendererSource, "sameWaterPathParts")}\n`
    + `${extractFunctionSource(rendererSource, "findCachedWaterFeaturePath")}\n`
    + `${extractFunctionSource(rendererSource, "getCachedWaterFeaturePath")}\n`
    + `${extractFunctionSource(rendererSource, "getScenarioWaterFeaturePath")}\n`
    + "globalThis.__partPath = getScenarioWaterPartPath; globalThis.__featurePath = getScenarioWaterFeaturePath;"
    + "globalThis.__cachedFeaturePath = getCachedWaterFeaturePath;", scope);
  return { scope, pathCache, svgCalls, liveContext,
    getAddPathCalls: () => addPathCalls,
    getClock: () => clock,
    setProjectionGeneration: (generation) => { projectionGeneration = generation; },
    getCurrentContext: () => currentContext,
    getPartPath: (candidate) => scope.__partPath(candidate),
    getFeaturePath: (candidate, parts) => scope.__featurePath(candidate, parts),
    getCachedFeaturePath: (candidate, parts) => scope.__cachedFeaturePath(candidate, parts) };
}

test("scenario water part builds Path2D from SVG without streaming into the live context", () => {
  const h = createWaterPathHarness();
  const waterPart = { id: "water-part", throwStream: true };
  const path = h.getPartPath(waterPart);
  assert.equal(path.svg, "M1,2Z");
  assert.deepEqual(h.svgCalls, ["water-part"]);
  assert.equal(h.getCurrentContext(), h.liveContext);
  assert.equal(h.getPartPath(waterPart), path);
  assert.deepEqual(h.svgCalls, ["water-part"]);
});

test("SVG failure returns null and can retry after source recovery", () => {
  const h = createWaterPathHarness();
  const waterPart = { id: "bad-svg", throwSvg: true, svg: "M3,4Z" };
  assert.equal(h.getPartPath(waterPart), null);
  assert.equal(h.pathCache.size, 0);
  waterPart.throwSvg = false;
  const path = h.getPartPath(waterPart);
  assert.equal(h.getCurrentContext(), h.liveContext);
  assert.equal(path.svg, "M3,4Z");
  assert.deepEqual(h.svgCalls, ["bad-svg", "bad-svg"]);
});

test("SVG paths work without a context shim; failed paths retry and feature cache releases duplicates", () => {
  const legacy = createWaterPathHarness({ withContext: false });
  assert.equal(legacy.getPartPath({ id: "legacy" }).svg, "M1,2Z");
  assert.deepEqual(legacy.svgCalls, ["legacy"]);

  const h = createWaterPathHarness();
  const waterPart = { id: "retry", svg: "" };
  const water = { id: "water" };
  const parts = [waterPart];
  assert.equal(h.getPartPath(waterPart), null);
  assert.equal(h.getFeaturePath(water, parts), null);
  assert.equal(h.pathCache.size, 0);
  waterPart.svg = "M5,6Z";
  const combined = h.getFeaturePath(water, parts);
  assert.equal(combined.svg, "M5,6Z");
  assert.equal(h.getAddPathCalls(), 0, "single part needs no Path2D copy");
  assert.equal(h.pathCache.has(waterPart), false, "combined path replaces duplicate part cache");
  assert.equal(h.getCachedFeaturePath(water, parts), combined);
});

test("single-part feature retains its original path while multi-part feature combines paths", () => {
  const h = createWaterPathHarness();
  const first = { id: "first" }, second = { id: "second" };
  const firstPath = h.getPartPath(first);
  const singleParts = [first];
  const single = { id: "single", geometry: {} };
  assert.equal(h.getFeaturePath(single, singleParts), firstPath);
  assert.equal(h.getAddPathCalls(), 0);
  assert.equal(h.pathCache.has(first), false, "feature entry owns the only retained path");
  const buildCount = h.scope.waterPathBuildCount;
  const clock = h.getClock();
  assert.equal(h.getFeaturePath(single, singleParts), firstPath);
  assert.equal(h.scope.waterPathBuildCount, buildCount);
  assert.equal(h.getClock(), clock, "warm lookup avoids build timing reads");

  const firstAgain = h.getPartPath(first);
  const secondPath = h.getPartPath(second);
  const multi = h.getFeaturePath({ id: "multi", geometry: {} }, [first, second]);
  assert.notEqual(multi, firstAgain);
  assert.deepEqual(multi.parts, [firstAgain, secondPath]);
  assert.equal(h.getAddPathCalls(), 2);
});

test("cached water feature path reuses exact safe parts across wrappers and rejects changed geometry", () => {
  const h = createWaterPathHarness();
  const waterPart = { id: "water-part" };
  const parts = [waterPart];
  const geometry = { type: "Polygon" };
  const water = { id: "water", geometry };
  assert.equal(h.getCachedFeaturePath(water, parts), null, "borrow never builds a path");
  assert.equal(h.pathCache.size, 0);
  const path = h.getFeaturePath(water, parts);
  assert.equal(h.getCachedFeaturePath(water, parts), path);
  assert.equal(h.getCachedFeaturePath(water, [waterPart]), path, "fresh array with identical part references is safe");
  const nextSceneFeature = { id: "water", geometry: { type: "Polygon" } };
  assert.equal(h.getCachedFeaturePath(nextSceneFeature, [waterPart]), path,
    "same sanitized part object remains valid across a new wrapper/scene");
  const secondPart = { id: "second-part" };
  const orderedParts = [waterPart, secondPart];
  const orderedPath = h.getFeaturePath({ id: "ordered", geometry: {} }, orderedParts);
  assert.equal(h.getCachedFeaturePath({ id: "ordered", geometry: {} }, [waterPart, secondPart]), orderedPath,
    "all ordered part references must match for complete path reuse");
  assert.equal(h.getCachedFeaturePath({ id: "ordered", geometry: {} }, [secondPart, waterPart]), null,
    "reordered geometry parts cannot borrow a complete path");
  assert.equal(h.getCachedFeaturePath({ id: "ordered", geometry: {} }, [waterPart, { id: "replacement-part" }]), null,
    "partial replacement cannot borrow a complete path");
  const changedPart = { id: "water-part", svg: "M9,9Z" };
  const changedGeometry = { id: "water", geometry: { type: "Polygon" } };
  const changedPath = h.getFeaturePath(changedGeometry, [changedPart]);
  assert.notEqual(changedPath, path, "same feature ID cannot reuse a path for different geometry parts");
  assert.equal(changedPath.svg, "M9,9Z");
  assert.equal(h.getCachedFeaturePath(changedGeometry, [changedPart]), changedPath);
  assert.equal(h.getCachedFeaturePath(changedGeometry, [changedPart, waterPart]), null,
    "changed part count and order cannot borrow a cached complete path");
  h.setProjectionGeneration(2);
  assert.equal(h.getCachedFeaturePath(nextSceneFeature, [waterPart]), null, "projection generation invalidates borrowing");
  assert.equal(h.pathCache.size, 3, "borrowing does not alter cache membership");
  h.setProjectionGeneration(1);
  const retainedEntry = [...h.pathCache.values()].find((entry) => entry.path === path);
  const retainedKey = [...h.pathCache.entries()].find(([, entry]) => entry === retainedEntry)?.[0];
  h.pathCache.delete(retainedKey);
  assert.equal(h.getCachedFeaturePath(nextSceneFeature, [waterPart]), null, "evicted path cannot be borrowed");
});

test("water feature path can be reused across wrappers with different paint styles", () => {
  const h = createWaterPathHarness();
  const part = { id: "export-water", svg: "M1,2Z" };
  const firstFeature = { id: "water", geometry: { type: "Polygon" } };
  const path = h.getFeaturePath(firstFeature, [part]);
  const nextSceneFeature = { id: "water", geometry: { type: "Polygon" }, style: { fill: "#123456" } };
  assert.equal(h.getFeaturePath(nextSceneFeature, [part]), path,
    "paint style and feature wrappers do not alter projected path commands");
  assert.deepEqual(h.svgCalls, ["export-water"], "new paint style does not reconstruct identical geometry");
});

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

test("political preview punches out visible shared and scenario lakes, preserving hidden scenario waters", () => {
  const shared = { properties: { id: "shared", water_type: "lake" } };
  const scenario = { properties: { id: "scenario", water_type: "lake" } };
  const sea = { properties: { id: "sea", water_type: "sea" } };
  const state = { showWaterRegions: false, contextLayerExternalDataByName: { lakes: { features: [shared] } } };
  const calls = [];
  const drawingContext = { globalCompositeOperation: "source-over",
    save() { this.saved = this.globalCompositeOperation; }, restore() { this.globalCompositeOperation = this.saved; } };
  const scope = vm.createContext({ runtimeState: state, isLakeRegion,
    getSharedFeatureId, getEffectiveWaterRegionFeatures: () => [shared, scenario, sea],
    rendererSurfaceHost: { getContext: () => drawingContext },
    drawScenarioWaterFillLayer: (k, options) => calls.push({ k, ids: Array.from(options.waterFeatures, f => f.properties.id), maskOnly: options.maskOnly, operation: drawingContext.globalCompositeOperation }),
  });
  vm.runInContext(extractFunctionSource(rendererSource, "maskLakesFromPoliticalPatch"), scope);
  scope.maskLakesFromPoliticalPatch(2);
  assert.deepEqual(calls[0], { k: 2, ids: ["shared"], maskOnly: true, operation: "destination-out" });
  state.showWaterRegions = true;
  scope.maskLakesFromPoliticalPatch(3);
  assert.deepEqual(calls[1].ids, ["shared", "scenario"]);
  assert.equal(drawingContext.globalCompositeOperation, "source-over");
});

function part(id, { visible = true } = {}) {
  return { id, bounds: { id, visible } };
}

function feature(id, {
  opacity = 1,
  renderable = true,
  parts = [part(`${id}-part`)],
} = {}) {
  return { id, opacity, renderable, parts };
}

function createHarness({
  hasPath2D = true,
  featurePath = null,
  partPaths = new Map(),
  pathCanvas = null,
  showRivers = false,
  coldPathBuild = false,
} = {}) {
  const calls = {
    beginPath: 0,
    fill: [],
    paint: [],
    stroke: [],
    pathCanvas: [],
    restore: 0,
    save: 0,
    featureColorIds: [],
    defaultStyles: [],
  };
  const metrics = [];
  let pathBuilt = false;
  const drawingContext = {
    globalAlpha: 1,
    fillStyle: "",
    beginPath() {
      calls.beginPath += 1;
    },
    fill(pathValue) {
      calls.fill.push(arguments.length ? pathValue : "current-path");
      calls.paint.push({ path: arguments.length ? pathValue : "current-path", color: this.fillStyle, alpha: this.globalAlpha });
    },
    stroke(pathValue) {
      calls.stroke.push({ path: pathValue || "current-path", color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth });
    },
    setLineDash() {},
    restore() {
      calls.restore += 1;
    },
    save() {
      calls.save += 1;
    },
  };
  const resolvedPathCanvas = typeof pathCanvas === "function"
    ? (candidate) => {
        calls.pathCanvas.push(candidate.id);
        pathCanvas(candidate);
      }
    : null;
  const context = vm.createContext({
    isLakeRegion,
    runtimeState: { showRivers, styleConfig: { rivers: { color: "#456789" } } },
    getSafeCanvasColor: (value, fallback) => value || fallback,
    Path2D: hasPath2D ? function Path2D() {} : undefined,
    waterPathBuildCount: 0,
    waterPathBuildMs: 0,
    collectContextMetric: (name, duration, payload) => metrics.push({ name, duration, payload }),
    collectSafeWaterRegionGeometryParts: (candidate) => candidate.parts,
    getScenarioWaterPartBounds: (candidate) => candidate.bounds,
    scenarioWaterPathCache: { getStats: () => ({ entries: 0 }) },
    getSharedFeatureId,
    getScenarioWaterFeaturePath: () => {
      if (coldPathBuild && !pathBuilt) {
        pathBuilt = true;
        context.waterPathBuildCount += 1;
        context.waterPathBuildMs += 5;
      }
      return featurePath;
    },
    getScenarioWaterPartPath: (candidate) => partPaths.get(candidate.id) || null,
    getWaterRegionColor: (id) => { calls.featureColorIds.push(id); return "#123456"; },
    getWaterRegionDefaultStyle: (candidate) => { calls.defaultStyles.push(candidate.id); return { opacity: candidate.opacity }; },
    isWaterRegionRenderable: (candidate) => candidate.renderable,
    nowMs: () => 10,
    projectedGeoBoundsInScreen: (candidateBounds) => candidateBounds?.visible !== false,
    rendererSurfaceHost: {
      getContext: () => drawingContext,
      getPathCanvas: () => resolvedPathCanvas,
    },
  });
  vm.runInContext(
    `${drawScenarioWaterFillLayerSource}\n`
      + "globalThis.__drawScenarioWaterFillLayer = drawScenarioWaterFillLayer;",
    context,
  );
  return {
    calls,
    metrics,
    draw: (waterFeatures, options = {}) => context.__drawScenarioWaterFillLayer(1, { waterFeatures, ...options }),
  };
}

test("scenario water fill counts a feature drawn through its complete Path2D", () => {
  const wholePath = { name: "whole-path" };
  const water = feature("water", { parts: [part("a"), part("b")] });
  const harness = createHarness({ featurePath: wholePath });

  assert.equal(harness.draw([water]), 1);
  assert.deepEqual(harness.calls.fill, [wholePath]);
  assert.equal(harness.calls.save, 1);
  assert.equal(harness.calls.restore, 1);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 1);
});

test("water metric separates cold path construction from a warm redraw", () => {
  const water = feature("water");
  const h = createHarness({ featurePath: { name: "path" }, coldPathBuild: true });
  h.draw([water]);
  assert.equal(h.metrics.at(-1).payload.buildCount, 1);
  assert.equal(h.metrics.at(-1).payload.pathBuildMs, 5);
  h.draw([water]);
  assert.equal(h.metrics.at(-1).payload.buildCount, 0);
  assert.equal(h.metrics.at(-1).payload.pathBuildMs, 0);
});

test("lake shoreline follows the river hue while patch masks never draw a shore", () => {
  const lake = { ...feature("lake"), properties: { water_type: "lake" } };
  const path = { name: "lake-path" };
  const h = createHarness({ featurePath: path, showRivers: true });
  h.draw([lake]);
  assert.deepEqual(h.calls.stroke, [{ path, color: "#456789", alpha: 0.22, width: 1.4 }]);
  h.draw([lake], { maskOnly: true });
  assert.equal(h.calls.stroke.length, 1);
  assert.equal(h.calls.fill.length, 2);
});

test("scenario water fill counts multiple visible part paths as one rendered feature", () => {
  const firstPath = { name: "first-path" };
  const secondPath = { name: "second-path" };
  const water = feature("water", { parts: [part("a"), part("b"), part("offscreen", { visible: false })] });
  const harness = createHarness({
    partPaths: new Map([
      ["a", firstPath],
      ["b", secondPath],
    ]),
  });

  assert.equal(harness.draw([water]), 1);
  assert.deepEqual(harness.calls.fill, [firstPath, secondPath]);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 1);
});

test("scenario water fill counts a canvas-path fallback only after it is filled", () => {
  const water = feature("water", { parts: [part("a"), part("b")] });
  const harness = createHarness({ pathCanvas: () => {} });

  assert.equal(harness.draw([water]), 1);
  assert.deepEqual(harness.calls.pathCanvas, ["a", "b"]);
  assert.deepEqual(harness.calls.fill, ["current-path", "current-path"]);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 1);
});

test("scenario water fill does not count a Path2D feature when no valid path exists", () => {
  const water = feature("water", { parts: [part("a"), part("b")] });
  const harness = createHarness({ hasPath2D: true });

  assert.equal(harness.draw([water]), 0);
  assert.deepEqual(harness.calls.fill, []);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 0);
  assert.equal(harness.metrics.at(-1).payload.skipped, true);
});

test("scenario water fill does not fill or count an empty legacy canvas path", () => {
  const water = feature("water", { parts: [part("a"), part("b")] });
  const harness = createHarness({ hasPath2D: false, pathCanvas: null });

  assert.equal(harness.draw([water]), 0);
  assert.deepEqual(harness.calls.fill, []);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 0);
});

test("scenario water fill excludes transparent, disabled, and offscreen features from its count", () => {
  const transparent = feature("transparent", { opacity: 0 });
  const disabled = feature("disabled", { renderable: false });
  const offscreen = feature("offscreen", { parts: [part("offscreen-part", { visible: false })] });
  const harness = createHarness({ featurePath: { name: "unused" } });

  assert.equal(harness.draw([transparent, disabled, offscreen]), 0);
  assert.deepEqual(harness.calls.fill, []);
  assert.equal(harness.calls.save, 0);
  assert.equal(harness.calls.restore, 0);
  assert.equal(harness.metrics.at(-1).payload.featureCount, 3);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 0);
});

test("water paint resolves styles and feature IDs only for visible features; masks skip opacity lookup", () => {
  const offscreen = feature("offscreen", { parts: [part("offscreen-part", { visible: false })] });
  const visible = feature("visible", { opacity: 0.6 });
  const h = createHarness({ featurePath: { name: "water-path" } });
  assert.equal(h.draw([offscreen, visible]), 1);
  assert.deepEqual(h.calls.defaultStyles, ["visible"]);
  assert.deepEqual(h.calls.featureColorIds, ["visible"]);
  h.calls.defaultStyles.length = 0;
  h.calls.featureColorIds.length = 0;
  assert.equal(h.draw([offscreen, visible], { maskOnly: true }), 1);
  assert.deepEqual(h.calls.defaultStyles, []);
  assert.deepEqual(h.calls.featureColorIds, ["visible"]);
  assert.equal(h.calls.fill.length, 2);
  assert.deepEqual(h.calls.paint, [
    { path: h.calls.fill[0], color: "#123456", alpha: 0.6 },
    { path: h.calls.fill[1], color: "#123456", alpha: 1 },
  ]);
});
