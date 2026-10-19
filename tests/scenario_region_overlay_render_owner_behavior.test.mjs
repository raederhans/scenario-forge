import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRenderCacheOwner } from "../js/core/renderer/render_cache_owner.js";
import { createScenarioReliefOverlayRenderOwner } from "../js/core/renderer/scenario_relief_overlay_render_owner.js";
import { readFileSync } from "node:fs";
import { createScenarioRegionOverlayRenderOwner } from "../js/core/renderer/scenario_region_overlay_render_owner.js";
import { createScenarioWaterCachePolicyOwner } from "../js/core/renderer/scenario_water_cache_policy_owner.js";
import { isPopulationActive, POPULATION_UNESTIMATED_COLOR } from "../js/core/population_spatial_view_model.js";
import { POPULATION_LAYER_ID, POPULATION_DATA_VERSION, POPULATION_YEAR } from "../js/core/population_spatial_data.js";

function harness(t, { mode = "reuse", noLayerContext = false, waterPathCacheBudget, actualWaterPolicy = false, oceanSurfacePattern = null, rasterPreparation = false, clockStep = 0, resourceBudget = null, pixelMasks = null, waterWorker = null } = {}) {
  const events = [];
  const metrics = [];
  const coverageCalls = [];
  const waterJobs = [];
  const unavailableReasons = [];
  const canvases = [];
  const waterWork = { effectiveCollections: 0, atlantropaBuckets: 0, signatures: 0 };
  const context = (name) => {
    const target = Object.fromEntries(
    ["save", "restore", "setTransform", "drawImage", "translate", "scale", "fill", "stroke", "beginPath", "closePath", "clip", "moveTo", "lineTo", "setLineDash"]
      .map((method) => [method, (...args) => events.push([name, method, ...args])]),
    );
    if (pixelMasks) {
      target.pixels = [0, 0, 0, 0];
      target.globalAlpha = 1;
      const stack = [];
      target.save = () => stack.push(target.globalAlpha);
      target.restore = () => { target.globalAlpha = stack.pop(); };
      target.clearRect = () => { target.pixels.fill(0); };
      const composite = source => source.forEach((alpha, index) => {
        const sourceAlpha = alpha * target.globalAlpha;
        target.pixels[index] = sourceAlpha + target.pixels[index] * (1 - sourceAlpha);
      });
      target.fill = path => { composite(pixelMasks[path.path] || [0, 0, 0, 0]); events.push([name, "fill", path]); };
      target.drawImage = canvas => { composite(canvas.getContext("2d").pixels); events.push([name, "drawImage", canvas]); };
    }
    return target;
  };
  let target = context("main");
  const main = target;
  const layer = context("layer");
  const water = { id: "water", parts: [{ id: "part" }] };
  let waterFeatures = [water];
  let coverageRatio = 0.5;
  const waterPolicy = createScenarioWaterCachePolicyOwner();
  const state = { width: 40, height: 60, renderPhase: "idle", showScenarioReliefOverlays: true, showWaterRegions: true, dpr: 2, zoomTransform: { k: 1, x: 0, y: 0 }, waterRegionsById: new Map([["water", water]]) };
  let cache = { contextScenarioLayerCache: {}, layouts: {} };
  let revision = "water-1";
  let projection = "projection-1";
  let projectionHandle = () => null;
  let adaptiveDirect = false;
  let boundsAvailable = true;
  let visible = true;
  let clock = 0;
  let canvasIndex = 0;
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldPath = Object.getOwnPropertyDescriptor(globalThis, "Path2D");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
    const target = rasterPreparation ? context(`canvas-${canvasIndex++}`) : layer;
    const canvas = { width: 1, height: 1, getContext: () => noLayerContext ? null : target };
    canvases.push(canvas);
    return canvas;
  } } });
  Object.defineProperty(globalThis, "Path2D", { configurable: true, value: class {
    constructor(path) { this.path = path; this.parts = []; }
    addPath(path) { this.parts.push(path); }
  } });
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else delete globalThis.document;
    if (oldPath) Object.defineProperty(globalThis, "Path2D", oldPath); else delete globalThis.Path2D;
  });
  const withRenderTarget = (next, draw) => { const previous = target; target = next; try { draw(); } finally { target = previous; } };
  const cacheOwner = createRenderCacheOwner({
    state,
    constants: { transformedFramePassNames: new Set(["contextScenario"]), renderPassOverscanRatioPerSide: 0.1 },
    getters: { getContext: () => target },
    helpers: {
      ensureRenderPassCacheState: () => cache,
      cloneZoomTransform: (value) => ({ ...value }),
      areZoomTransformsEquivalent: (a, b) => a.k === b.k && a.x === b.x && a.y === b.y,
      withRenderTarget,
      prepareTargetContext: (_target, transform) => transform.k,
    },
  });
  const reliefFeatures = [{ id: "relief", properties: { overlay_kind: "dam_approach" }, geometry: { type: "LineString" } }];
  const reliefOwner = createScenarioReliefOverlayRenderOwner({
    state,
    scenarioLayerCache: cacheOwner.scenarioLayerCache,
    getters: { getContext: () => target, getPathCanvas: () => (feature) => events.push(["reliefPath", feature.id]) },
    helpers: {
      cloneZoomTransform: (value) => ({ ...value }),
      shouldEnableContextScenarioTransformReuse: () => true,
      collectContextMetric: (name, _duration, payload) => metrics.push({ name, ...payload }),
      getEffectiveScenarioReliefOverlayFeatures: () => reliefFeatures,
      getPathBounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
      getReliefOverlayKind: (feature) => feature.properties.overlay_kind,
      getScenarioReliefVisualRevisionToken: () => revision,
      isReliefOverlayEnabled: () => true,
      pathBoundsInScreen: () => true,
    },
  });
  const owner = createScenarioRegionOverlayRenderOwner(state, {
    getWaterPreparationRevision: waterWorker ? () => revision : null,
    getWaterWorkerProjectionOptions: waterWorker ? () => ({ factory: "geoEqualEarth" }) : null,
    createWaterWorkerClient: waterWorker ? () => waterWorker : undefined,
    resourceBudget,
    getScenarioWaterRasterLayout: rasterPreparation ? () => cacheOwner.getRenderPassLayout("contextScenario") : null,
    withRenderTarget,
    prepareTargetContext: (context, transform) => { context.clearRect?.(); return transform.k; },
    waterPathCacheBudget,
    rendererSurfaceHost: {
      getContext: () => target,
      getProjection: () => projectionHandle,
      getPathCanvas: () => (feature) => events.push(["pathCanvas", feature.id]),
      getPathSvg: () => (part) => { events.push(["pathSvg", projection, part.id]); return `${projection}:${part.id}`; },
    },
    scenarioLayerCache: cacheOwner.scenarioLayerCache,
    cloneZoomTransform: (value) => ({ ...value }),
    nowMs: () => { clock += clockStep; return clock; },
    collectContextMetric: (name, _duration, payload) => metrics.push({ name, ...payload }),
    isWaterRegionRenderable: () => true,
    getWaterRegionDefaultStyle: () => ({ opacity: 0.6 }),
    collectSafeWaterRegionGeometryParts: (feature) => feature.parts,
    projectedGeoBoundsInScreen: (bounds) => { events.push(["cull", state.zoomTransform.k, bounds]); return !!bounds && visible && bounds.part?.visible !== false; },
    computeProjectedGeoBounds: (part) => { events.push(["bounds", projection, part.id]); return boundsAvailable ? { minX: 0, minY: 0, maxX: 10, maxY: 10, part, projection } : null; },
    getWaterRegionColor: () => "#123456",
    getOceanSurfacePattern: () => oceanSurfacePattern,
    scheduleWaterWork: (callback) => { const job = { callback, canceled: false }; waterJobs.push(job); return job; },
    cancelWaterWork: (job) => { job.canceled = true; },
    requestRender: (reason) => events.push(["requestRender", reason]),
    onWaterPreparationUnavailable: reason => unavailableReasons.push(reason),
    getScenarioWaterVisualRevisionToken: () => { waterWork.signatures += 1; return revision; },
    isWaterRegionEnabled: () => true,
    isMacroOceanWaterRegion: (feature) => !!feature.macro,
    isBaseGeographyScenarioFeature: () => false,
    isSpecialRegionEnabled: () => true,
    pathBoundsInScreen: () => true,
    getSpecialRegionOpacity: () => 0.5,
    getSpecialRegionColor: () => "#654321",
    getSpecialRegionStrokeColor: () => "#000000",
    getScenarioSpecialVisualRevisionToken: () => "special-1",
    isScenarioAtlantropaVisible: () => !!state.showScenarioAtlantropa,
    getEffectiveAtlantropaFeatures: () => { waterWork.atlantropaBuckets += 1; return { land: [{ id: "land" }], shoal: [{ id: "shoal" }], relief: [{ id: "relief" }] }; },
    getLogicalCanvasDimensions: () => [100, 100],
    shouldExcludePoliticalVisualFeature: (feature) => feature.id === "relief",
    shouldSkipFeature: () => false,
    getResolvedFeatureColor: () => "#abcdef",
    getPopulationUnestimatedOverlayColor: () => state.activeScenarioId === "tno_1962" && isPopulationActive(state)
      ? POPULATION_UNESTIMATED_COLOR : null,
    LAND_FILL_COLOR: "#f0f0f0",
    getPoliticalFeaturePathEntry: (feature) => ({ path: feature.id }),
    getEffectiveWaterRegionFeatures: () => { waterWork.effectiveCollections += 1; return waterFeatures; },
    getEffectiveSpecialRegionFeatures: () => [{ id: "special" }],
    getForcedScenarioWaterCacheMode: () => ({ mode, source: "test" }),
    getScenarioWaterCacheComplexitySignals: (features) => {
      coverageCalls.push(features.length);
      return {
        visibleCoverageRatio: coverageRatio,
        previousRenderedCount: owner.getPreviousWaterRenderedCount(),
        waterCoverageAlgo: "grid",
      };
    },
    shouldEnableContextScenarioTransformReuse: () => true,
    shouldUseDirectScenarioWaterDraw: (signals) => actualWaterPolicy
      ? waterPolicy.shouldUseDirectScenarioWaterDraw(signals)
      : adaptiveDirect,
  });
  return { owner, reliefOwner, cacheOwner, state, water, waterWork, waterJobs, canvases, unavailableReasons,
    runOneWaterJob: () => { const job = waterJobs.shift(); if (job && !job.canceled) job.callback(); },
    runWaterJobs: () => { while (waterJobs.length) { const job = waterJobs.shift(); if (!job.canceled) job.callback(); } },
    get layout() { return cacheOwner.getRenderPassLayout("contextScenario"); }, events, metrics, coverageCalls, main, draw: () => owner.drawScenarioRegionOverlaysPass(state.zoomTransform.k),
    setNoLayerContext: (value) => { noLayerContext = value; },
    setBoundsAvailable: (value) => { boundsAvailable = value; }, setVisible: (value) => { visible = value; },
    replaceWaterPart: () => { water.parts = [{ id: "replacement" }]; },
    setMode: (value) => { mode = value; }, setRevision: (value) => { revision = value; },
    setProjection: (value) => { projection = value; projectionHandle = typeof value === "function" ? value : () => null; }, setAdaptiveDirect: () => { adaptiveDirect = true; },
    setCoverageRatio: (value) => { coverageRatio = value; },
    setWaterFeatureCount: (value) => { waterFeatures = Array.from({ length: value }, (_, index) => ({ ...water, id: `water-${index}` })); },
    replaceCache: () => { cache = { contextScenarioLayerCache: {}, layouts: {} }; }, getCache: () => cache,
  };
}

test("worker preparation snapshots selection once and publishes only complete candidate", async t => {
  let resolve;
  const worker = { available: () => true, dispose() {}, request: () => new Promise(done => { resolve = done; }) };
  const h = harness(t, { rasterPreparation: true, waterWorker: worker });
  h.state.firstVisibleFramePainted = true;
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  const reads = h.waterWork.effectiveCollections;
  for (let i = 0; i < 10; i++) assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(h.waterWork.effectiveCollections, reads);
  assert.equal(h.events.filter(event => event[0] === "pathSvg").length, 0);
  let closed = 0;
  resolve({ bitmap: { close() { closed++; } }, renderedCount: 1,
    stats: { geometryBytes: 1, pathBytes: 1, patternBytes: 0 } });
  await Promise.resolve();
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  h.draw();
  assert.equal(closed, 1);
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  h.owner.resetWaterPathCaches();
});

test("worker failure prepares a complete sliced canvas and retries worker only for a new revision", async t => {
  let requests = 0;
  const worker = { available: () => true, dispose() {}, request: async () => { requests++; throw new Error("worker failed"); } };
  const h = harness(t, { rasterPreparation: true, clockStep: 2, waterWorker: worker });
  h.state.firstVisibleFramePainted = true;
  h.water.parts = Array.from({ length: 5 }, (_, id) => ({ id }));
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  h.draw();
  assert.equal(h.events.filter(event => event[0] === "pathSvg").length, 0);
  assert.equal(h.metrics.some(metric => metric.failed && metric.worker), true);
  h.runOneWaterJob();
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.ok(h.events.filter(event => event[0] === "pathSvg").length < 5);
  h.runWaterJobs();
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  assert.equal(requests, 1);
  h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "prepared");
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  assert.equal(requests, 1);
  assert.deepEqual(h.unavailableReasons, []);
  h.setRevision("water-2");
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(requests, 2);
  h.owner.resetWaterPathCaches();
});

test("worker preparation bypasses temporary startup and interaction constraints and resumes at idle", t => {
  let requests = 0;
  const worker = { available: () => true, dispose() {}, request: () => { requests++; return new Promise(() => {}); } };
  const h = harness(t, { rasterPreparation: true, waterWorker: worker });
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  h.state.firstVisibleFramePainted = true;
  for (const flags of [{ renderPhase: "interacting" }, { bootBlocking: true }, { scenarioApplyInFlight: true },
    { startupReadonly: true }, { startupReadonlyUnlockInFlight: true }]) {
    Object.assign(h.state, flags);
    assert.equal(h.owner.prepareScenarioWaterLayer(), true);
    for (const key of Object.keys(flags)) h.state[key] = key === "renderPhase" ? "idle" : false;
  }
  assert.equal(requests, 0);
  assert.deepEqual(h.unavailableReasons, []);
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(requests, 1);
  h.owner.resetWaterPathCaches();
});

test("canvas recovery replaces a previously published worker layer after a revision fails", async t => {
  const worker = { available: () => true, dispose() {}, request: async input => {
    if (input.revision !== "water-1") throw new Error("worker failed");
    return { bitmap: { close() {} }, renderedCount: 1,
      stats: { geometryBytes: 1, pathBytes: 1, patternBytes: 0 } };
  } };
  const h = harness(t, { rasterPreparation: true, waterWorker: worker });
  h.state.firstVisibleFramePainted = true;
  h.owner.prepareScenarioWaterLayer();
  await Promise.resolve();
  h.draw();
  h.setRevision("water-2");
  h.owner.prepareScenarioWaterLayer();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  h.runWaterJobs();
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "prepared");
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  assert.deepEqual(h.unavailableReasons, []);
  h.owner.resetWaterPathCaches();
});

test("worker failure with an oversized canvas notifies native fallback once and never becomes ready", async t => {
  let requests = 0;
  const worker = { available: () => true, dispose() {}, request: async () => { requests++; throw new RangeError("surface budget"); } };
  const h = harness(t, { rasterPreparation: true, waterWorker: worker });
  h.state.firstVisibleFramePainted = true;
  h.state.width = h.state.height = 4000;
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  await Promise.resolve(); await Promise.resolve();
  for (let i = 0; i < 3; i++) assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(requests, 1);
  assert.deepEqual(h.unavailableReasons, ["surface-budget"]);
  assert.equal(h.waterJobs.length, 0);
  h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "unavailable");
  assert.equal(h.events.some(event => event[1] === "fill"), false);
  h.owner.resetWaterPathCaches();
});

test("missing canvas context notifies native fallback once without marking preparation ready", t => {
  const h = harness(t, { rasterPreparation: true, noLayerContext: true });
  h.state.firstVisibleFramePainted = true;
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.deepEqual(h.unavailableReasons, ["context-unavailable"]);
  assert.equal(h.waterJobs.length, 0);
  h.owner.resetWaterPathCaches();
});

test("failed canvas slice notifies native fallback and releases partial surfaces", t => {
  const resources = new Map();
  const h = harness(t, { rasterPreparation: true,
    resourceBudget: { update: (key, value) => resources.set(key, value), release: key => resources.delete(key) } });
  h.state.firstVisibleFramePainted = true;
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  h.setNoLayerContext(true);
  h.runWaterJobs();
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.deepEqual(h.unavailableReasons, ["prepare-failed"]);
  assert.equal(resources.size, 0);
  assert.equal(h.canvases.every(canvas => canvas.width === 1 && canvas.height === 1), true);
  h.owner.resetWaterPathCaches();
});

test("worker revision change aborts old candidate and closes its late bitmap", async t => {
  const jobs = [];
  const worker = { available: () => true, dispose() {}, request: (_input, { signal }) => new Promise(resolve => jobs.push({ resolve, signal })) };
  const h = harness(t, { rasterPreparation: true, waterWorker: worker });
  h.state.firstVisibleFramePainted = true;
  h.owner.prepareScenarioWaterLayer();
  h.setRevision("water-2");
  h.owner.prepareScenarioWaterLayer();
  assert.equal(jobs[0].signal.aborted, true);
  let closed = 0;
  jobs[0].resolve({ bitmap: { close() { closed++; } } });
  await Promise.resolve();
  assert.equal(closed, 1);
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  h.owner.resetWaterPathCaches();
});

test("stale worker completion wakes preparation even when no newer render has started", async t => {
  const jobs = [];
  const worker = { available: () => true, dispose() {}, request: () => new Promise(resolve => jobs.push(resolve)) };
  const h = harness(t, { rasterPreparation: true, waterWorker: worker });
  h.state.firstVisibleFramePainted = true;
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  h.setRevision("water-2");
  let closed = 0;
  jobs[0]({ bitmap: { close() { closed++; } } });
  await Promise.resolve();
  assert.equal(closed, 1);
  assert.ok(h.events.some(event => event[0] === "requestRender" && event[1] === "scenario-water-raster-stale"));
  assert.equal(h.owner.getPreparationDiagnostics().pending, false);
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(jobs.length, 2);
  h.owner.resetWaterPathCaches();
});

test("candidate water raster yields between parts and publishes only the complete layer", t => {
  const resources = new Map();
  const h = harness(t, { rasterPreparation: true, clockStep: 2,
    resourceBudget: { update: (key, value) => resources.set(key, value), release: key => resources.delete(key) } });
  h.state.firstVisibleFramePainted = true;
  h.water.parts = Array.from({ length: 5 }, (_, i) => ({ id: `part-${i}` }));
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(resources.size, 1);
  h.runOneWaterJob();
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(h.events.some(event => event[0] === "main" && event[1] === "drawImage"), false);
  assert.ok(h.events.filter(event => event[0] === "pathSvg").length < 5);
  h.runWaterJobs();
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  assert.equal(h.events.filter(event => event[0] === "pathSvg").length, 5);
  h.events.length = 0;
  h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "prepared");
  assert.equal(h.events.some(event => event[0] === "pathSvg" || event[1] === "fill"), false);
  assert.equal(resources.size, 0);
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  assert.equal(h.waterJobs.length, 0);
});

test("water raster candidate rejects transform changes and releases reset surfaces", t => {
  const resources = new Map();
  const h = harness(t, { rasterPreparation: true, clockStep: 2,
    resourceBudget: { update: (key, value) => resources.set(key, value), release: key => resources.delete(key) } });
  h.state.firstVisibleFramePainted = true;
  h.water.parts = [{ id: "a" }, { id: "b" }];
  h.owner.prepareScenarioWaterLayer();
  h.state.zoomTransform.k = 2;
  h.runWaterJobs();
  assert.equal(resources.size, 0);
  assert.equal(h.events.some(event => event[0] === "pathSvg"), false);
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  h.owner.resetWaterPathCaches();
  assert.equal(resources.size, 0);
  h.runWaterJobs();
  assert.equal(h.events.some(event => event[0] === "pathSvg"), false);
});

test("part masks preserve holes and apply marine feature opacity once across overlaps", t => {
  // Samples: A-only, A/B overlap, A-hole covered by B, uncovered hole.
  // Each Path2D represents a complete polygon including its interior rings.
  const h = harness(t, { rasterPreparation: true, pixelMasks: {
    "projection-1:a": [1, 1, 0, 0],
    "projection-1:b": [0, 1, 1, 0],
  } });
  h.state.firstVisibleFramePainted = true;
  h.water.parts = [{ id: "a" }, { id: "b" }];
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  h.runWaterJobs();
  h.draw();
  assert.deepEqual(h.main.pixels, [0.6, 0.6, 0.6, 0]);
  assert.equal(h.events.filter(event => event[0] === "pathSvg").length, 2);
});

test("water raster surface budget rejects oversized candidates without scheduling or increasing budget", t => {
  const h = harness(t, { rasterPreparation: true });
  h.state.firstVisibleFramePainted = true;
  h.state.width = 4000;
  h.state.height = 4000;
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  assert.equal(h.waterJobs.length, 0);
  assert.equal(h.metrics.at(-1).reason, "surface-budget");
  assert.deepEqual(h.unavailableReasons, ["surface-budget"]);
  h.draw();
  assert.equal(h.events.some(event => event[1] === "fill"), false);
});

test("lake-only candidate does not allocate or clear a marine scratch surface", t => {
  const h = harness(t, { rasterPreparation: true });
  h.state.firstVisibleFramePainted = true;
  h.water.properties = { water_type: "lake" };
  h.owner.prepareScenarioWaterLayer();
  h.runWaterJobs();
  assert.equal(h.canvases.length, 1);
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  assert.equal(h.metrics.filter(metric => metric.name === "drawScenarioWaterFillLayer").length, 0);
  assert.equal(h.metrics.filter(metric => metric.name === "scenarioWaterRasterPreparation").length, 1);
});

test("large DPR2 marine raster uses exact-size candidate and budget-bounded scratch strips", t => {
  const usage = [];
  const h = harness(t, { rasterPreparation: true,
    resourceBudget: { update: (_key, value) => usage.push(value.bitmaps), release: () => {} } });
  h.state.firstVisibleFramePainted = true;
  h.state.width = 1000;
  h.state.height = 1000;
  h.state.dpr = 2;
  assert.equal(h.owner.prepareScenarioWaterLayer(), false);
  h.runWaterJobs();
  assert.equal(h.owner.prepareScenarioWaterLayer(), true);
  const [candidate, scratch] = h.canvases;
  assert.equal(candidate.width, h.layout.pixelWidth);
  assert.equal(candidate.height, h.layout.pixelHeight);
  assert.ok(scratch.width < candidate.width);
  assert.equal(scratch.height, candidate.height);
  assert.ok(Math.max(...usage) <= 32 * 1024 * 1024);
  assert.deepEqual(h.events.filter(event => event[0] === "canvas-0" && event[1] === "drawImage")
    .map(event => event[3]), Array.from({ length: Math.ceil(candidate.width / scratch.width) }, (_, index) => index * scratch.width));
  h.events.length = 0;
  h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "prepared");
  assert.equal(h.events.some(event => event[1] === "fill"), false);
});

test("selected marine highlight uses simplified display geometry while fill keeps original safe parts", (t) => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), sandbox);
  const previousD3 = globalThis.d3;
  globalThis.d3 = sandbox.d3;
  t.after(() => {
    if (previousD3 === undefined) delete globalThis.d3;
    else globalThis.d3 = previousD3;
  });

  const h = harness(t);
  const geometry = {
    type: "Polygon",
    coordinates: [[
      [0, 0], [0, 5], [0, 10], [5, 10], [10, 10], [10, 5], [10, 0], [5, 0], [0, 0],
    ]],
  };
  const original = JSON.stringify(geometry);
  h.water.parts = [geometry];
  h.water.properties = { id: "water", water_type: "sea" };
  h.setProjection(sandbox.d3.geoMercator().scale(100).translate([0, 0]));
  h.state.selectedWaterRegionId = "water";
  h.draw();
  h.events.length = 0;
  h.draw();

  assert.ok(h.events.some((event) => event[0] === "main" && event[1] === "lineTo"));
  assert.ok(h.events.some((event) => event[0] === "main" && event[1] === "closePath"));
  assert.ok(h.events.some((event) => event[0] === "main" && event[1] === "stroke"));
  assert.equal(h.events.filter((event) => event[0] === "pathCanvas").length, 0);
  assert.equal(JSON.stringify(geometry), original, "display generation leaves source coordinates intact");
  assert.equal(h.metrics.at(-1).highlightedWaterCount, 1);
});

test("water pass reuses one effective collection, Atlantropa buckets and signature through cache redraw", t => {
  const h = harness(t);
  h.state.showScenarioAtlantropa = true;
  h.draw();
  assert.equal(h.waterWork.effectiveCollections, 1);
  assert.equal(h.waterWork.atlantropaBuckets, 1);
  assert.equal(h.waterWork.signatures, 1);
  assert.equal(h.metrics.findLast((metric) => metric.name === "contextScenarioLayerWater")?.renderedCount, 1);
  h.draw();
  assert.equal(h.waterWork.effectiveCollections, 2);
  assert.equal(h.waterWork.atlantropaBuckets, 2);
  assert.equal(h.waterWork.signatures, 2);
  assert.equal(h.metrics.at(-1).waterCacheMode, "reuse");
});

test("cached visible-water pass reuses the existing layer without repainting", t => {
  const h = harness(t);
  h.draw();
  const fillsBeforeReuse = h.events.filter((event) => event[1] === "fill").length;
  h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "reuse");
  assert.equal(h.events.filter((event) => event[1] === "fill").length, fillsBeforeReuse);
});

test("water path eviction preserves fill and live highlight, including oversized transient paths", (t) => {
  const h = harness(t, { mode: "direct", waterPathCacheBudget: 1 });
  h.state.selectedWaterRegionId = "water";
  h.draw(); h.draw();
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
  assert.equal(h.events.filter((event) => event[0] === "pathSvg").length, 2, "uncached paths rebuild for each frame");
  assert.ok(h.events.some((event) => event[1] === "stroke"), "selection highlight remains visible");
  const metric = h.metrics.filter((metric) => metric.name === "drawScenarioWaterFillLayer").at(-1);
  assert.equal(metric.pathCacheBudget.estimatedBytes, 0);
  assert.ok(metric.pathCacheBudget.oversizedSkips > 0);
});

test("whole water paths replace duplicate component retention without eviction", (t) => {
  const h = harness(t, { mode: "direct", waterPathCacheBudget: 264 });
  h.draw(); h.draw();
  const metric = h.metrics.filter((metric) => metric.name === "drawScenarioWaterFillLayer").at(-1);
  assert.equal(metric.pathCacheBudget.entries, 1);
  assert.equal(metric.pathCacheBudget.estimatedBytes, 264);
  assert.equal(metric.pathCacheBudget.evictions, 0);
  assert.equal(h.events.filter((event) => event[0] === "pathSvg").length, 1);
});

test("world-cached complete water path serves a subset view without reprojection in warmup or draw", t => {
  const h = harness(t, { mode: "direct" });
  const parts = [{ id: "a" }, { id: "b" }];
  h.water.parts = parts;
  h.draw();
  const complete = h.owner.getCachedWaterFeaturePath(h.water, parts);
  assert.ok(complete);
  assert.equal(h.events.filter(event => event[0] === "pathSvg").length, 2);
  h.state.firstVisibleFramePainted = true;
  h.state.zoomTransform = { k: 5.6, x: -100, y: -200 };
  parts[1].visible = false;
  h.events.length = 0;
  assert.equal(h.owner.prepareVisibleWaterPaths(), true);
  assert.equal(h.waterJobs.length, 0);
  h.draw();
  assert.equal(h.events.filter(event => event[0] === "pathSvg").length, 0);
  assert.ok(h.events.some(event => event[1] === "fill" && event[2] === complete));
});

test("subset view without a complete retained path prepares and draws only visible parts", t => {
  const h = harness(t, { mode: "direct" });
  h.water.parts = [{ id: "visible" }, { id: "offscreen", visible: false }];
  h.state.firstVisibleFramePainted = true;
  assert.equal(h.owner.prepareVisibleWaterPaths(), false);
  h.runWaterJobs();
  assert.deepEqual(h.events.filter(event => event[0] === "pathSvg").map(event => event[2]), ["visible"]);
  assert.equal(h.owner.getCachedWaterFeaturePath(h.water, h.water.parts), null);
  h.events.length = 0;
  assert.equal(h.owner.prepareVisibleWaterPaths(), true);
  h.draw();
  assert.equal(h.events.filter(event => event[0] === "pathSvg").length, 0);
  assert.ok(h.events.some(event => event[1] === "fill" && event[2]?.path === "projection-1:visible"));
});

for (const staleCause of ["parts", "projection"]) {
  test(`subset view rejects a whole water path with changed ${staleCause}`, t => {
    const h = harness(t, { mode: "direct" });
    h.water.parts = [{ id: "a" }, { id: "b" }];
    h.draw();
    const complete = h.owner.getCachedWaterFeaturePath(h.water, h.water.parts);
    h.state.firstVisibleFramePainted = true;
    h.water.parts[1].visible = false;
    if (staleCause === "parts") h.water.parts[1] = { id: "replacement", visible: false };
    else h.setProjection("projection-2");
    assert.equal(h.owner.getCachedWaterFeaturePath(h.water, h.water.parts), null);
    h.events.length = 0;
    assert.equal(h.owner.prepareVisibleWaterPaths(), false);
    h.runWaterJobs();
    assert.deepEqual(h.events.filter(event => event[0] === "pathSvg").map(event => event.slice(1)),
      [[staleCause === "projection" ? "projection-2" : "projection-1", "a"]]);
    h.draw();
    assert.equal(h.events.some(event => event[1] === "fill" && event[2] === complete), false);
  });
}

test("an oversized unretained whole water path cannot bypass subset cache admission", t => {
  const h = harness(t, { mode: "direct", waterPathCacheBudget: 1 });
  h.water.parts = [{ id: "a" }, { id: "b" }];
  h.draw();
  assert.equal(h.owner.getCachedWaterFeaturePath(h.water, h.water.parts), null);
  h.water.parts[1].visible = false;
  h.state.firstVisibleFramePainted = true;
  h.events.length = 0;
  assert.equal(h.owner.prepareVisibleWaterPaths(), true);
  assert.equal(h.waterJobs.length, 0);
  assert.equal(h.metrics.at(-1).reason, "over-budget");
  h.draw();
  assert.deepEqual(h.events.filter(event => event[0] === "pathSvg").map(event => event[2]), ["a"]);
});

test("water cache reuses the same view but repaints changed transforms without rebuilding paths", (t) => {
  const h = harness(t);
  h.draw();
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
  assert.equal(h.events.filter((event) => event[0] === "layer" && event[1] === "fill").length, 1);
  assert.equal(h.events.filter((event) => event[0] === "main" && event[1] === "fill").length, 0);
  h.events.length = 0;
  h.draw();
  assert.equal(h.events.some((event) => event[1] === "fill"), false);
  assert.equal(h.metrics.at(-1).waterCacheMode, "reuse");
  h.state.zoomTransform = { k: 2, x: 10, y: 20 };
  h.events.length = 0;
  h.draw();
  assert.equal(h.events.filter((event) => event[1] === "fill").length, 1);
  assert.equal(h.events.some((event) => event[0] === "pathSvg"), false);
  assert.equal(h.metrics.at(-1).waterCacheMode, "redraw");
});

for (const mode of ["reuse", "adaptive"]) {
  test(`${mode} fills newly visible lakes after a pan and zoom round trip`, (t) => {
    const h = harness(t, { mode });
    h.setVisible(false); h.draw();
    assert.equal(h.owner.getPreviousWaterRenderedCount(), 0);
    h.setVisible(true);
    for (const transform of [{ k: 1, x: -1000, y: 0 }, { k: 3, x: -1400, y: 80 }, { k: 1, x: 0, y: 0 }]) {
      h.state.zoomTransform = transform;
      h.events.length = 0; h.draw();
      assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
      assert.equal(h.events.filter((event) => event[1] === "fill").length, 1);
      assert.equal(h.metrics.at(-1).waterCacheMode, "redraw");
    }
  });
}

test("water bounds reuse projection coordinates while zoom culling and selection stay live", t => {
  const h = harness(t, { mode: "direct" });
  h.draw();
  h.state.zoomTransform = { k: 2, x: 10, y: 20 };
  h.state.selectedWaterRegionId = "water";
  h.draw();
  assert.equal(h.events.filter(e => e[0] === "bounds").length, 1);
  assert.ok(h.events.some(e => e[0] === "cull" && e[1] === 2));
  h.setVisible(false); h.events.length = 0; h.draw();
  assert.equal(h.events.some(e => e[1] === "fill"), false);
  h.setVisible(true); h.replaceWaterPart(); h.draw();
  assert.ok(h.events.some(e => e[0] === "bounds" && e[2] === "replacement"));
  h.setProjection("projection-2"); h.owner.resetWaterPathCaches(); h.draw();
  assert.ok(h.events.some(e => e[0] === "bounds" && e[1] === "projection-2"));
});

test("shared base lakes render with the editable water overlay off, without highlighting hidden regions", t => {
  const h = harness(t, { mode: "direct" });
  h.state.showWaterRegions = false;
  h.state.contextLayerExternalDataByName = { lakes: { features: [h.water] } };
  h.state.selectedWaterRegionId = "water";
  h.draw();
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
  assert.equal(h.events.filter((event) => event[1] === "fill").length, 1);
  assert.equal(h.events.filter((event) => event[1] === "stroke").length, 0);
  h.state.contextLayerExternalDataByName.lakes = { features: [{ id: "another-lake" }] };
  h.events.length = 0;
  h.draw();
  assert.equal(h.events.some((event) => event[1] === "fill"), false);
});

test("failed water bounds do not poison the cache", t => {
  const h = harness(t, { mode: "direct" });
  h.setBoundsAvailable(false); h.draw();
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 0);
  h.setBoundsAvailable(true); h.draw();
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
  assert.equal(h.events.filter(e => e[0] === "bounds").length, 2);
});

test("coverage policy and water drawing share bounds but recompute screen coverage after zoom", t => {
  const h = harness(t, { mode: "direct" });
  const policy = createScenarioWaterCachePolicyOwner({
    state: h.state,
    helpers: {
      collectSafeWaterRegionGeometryParts: feature => feature.parts,
      computeProjectedGeoBounds: part => h.owner.getScenarioWaterPartBounds(part),
    },
  });
  const firstCoverage = policy.getScenarioWaterCacheComplexitySignals([h.water]).visibleCoverageRatio;
  h.draw();
  h.state.zoomTransform = { k: 2, x: 0, y: 0 };
  const zoomCoverage = policy.getScenarioWaterCacheComplexitySignals([h.water]).visibleCoverageRatio;
  assert.ok(zoomCoverage > firstCoverage);
  h.draw();
  assert.equal(h.events.filter(e => e[0] === "bounds").length, 1);
  h.owner.resetWaterPathCaches();
  policy.getScenarioWaterCacheComplexitySignals([h.water]); h.draw();
  assert.equal(h.events.filter(e => e[0] === "bounds").length, 2);
});

test("revision, dimensions and replacement cache each redraw while path cache resets with projection", (t) => {
  const h = harness(t);
  h.draw();
  h.setRevision("water-2"); h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "redraw");
  assert.equal(h.events.filter((event) => event[0] === "pathSvg").length, 1);
  h.state.width = 100; h.draw();
  assert.equal(h.getCache().contextScenarioLayerCache.water.canvas.width, 240);
  assert.equal(h.metrics.at(-1).waterCacheMode, "redraw");
  h.setProjection("projection-2"); h.owner.resetWaterPathCaches(); h.replaceCache(); h.draw();
  assert.deepEqual(h.events.filter((event) => event[0] === "pathSvg").at(-1), ["pathSvg", "projection-2", "part"]);
  assert.equal(h.metrics.at(-1).waterCacheMode, "redraw");
  h.owner.resetPreviousWaterRenderedCount();
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 0);
});

test("direct and adaptive-direct bypass layer canvases, while redraw rebuilds each frame", (t) => {
  const h = harness(t, { mode: "direct" });
  h.draw();
  assert.equal(h.getCache().contextScenarioLayerCache.water.canvas, null);
  assert.equal(h.metrics.at(-1).waterCacheMode, "direct");
  h.setMode("adaptive"); h.setAdaptiveDirect(); h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "adaptive-direct");
  h.setMode("redraw"); h.draw(); h.draw();
  assert.equal(h.events.filter((event) => event[0] === "layer" && event[1] === "fill").length, 2);
});

for (const mode of ["direct", "reuse", "redraw"]) {
  test(`forced ${mode} water cache does not calculate screen coverage`, (t) => {
    const h = harness(t, { mode, actualWaterPolicy: true });
    h.draw();
    assert.deepEqual(h.coverageCalls, [], `${mode} should not request coverage`);
    assert.equal(h.metrics.at(-1).waterVisibleCoverageRatio, null);
    assert.equal(h.metrics.at(-1).waterCoverageAlgo, "not-evaluated");
    assert.equal(h.metrics.at(-1).waterCacheStrategyMode, mode);
  });
}

test("adaptive water cache calculates coverage only after count thresholds can allow direct draw", (t) => {
  const h = harness(t, { mode: "adaptive", actualWaterPolicy: true });
  h.setWaterFeatureCount(24);
  h.setCoverageRatio(0.2);
  h.draw();
  assert.deepEqual(h.coverageCalls, [24]);
  assert.equal(h.metrics.at(-1).waterCacheMode, "adaptive-direct");
  assert.equal(h.metrics.at(-1).waterVisibleCoverageRatio, 0.2);

  h.setWaterFeatureCount(25);
  h.draw();
  assert.deepEqual(h.coverageCalls, [24], "25 features fail before reading coverage");
  assert.equal(h.metrics.at(-1).waterCacheMode, "redraw");
  assert.equal(h.metrics.at(-1).waterVisibleCoverageRatio, null);
  assert.equal(h.metrics.at(-1).waterCoverageAlgo, "not-evaluated");

  h.setWaterFeatureCount(24);
  h.setCoverageRatio(0.2001);
  h.draw();
  assert.deepEqual(h.coverageCalls, [24, 24]);
  assert.equal(h.metrics.at(-1).waterCacheMode, "reuse");
  assert.equal(h.metrics.at(-1).waterVisibleCoverageRatio, 0.2001);
});

for (const [previousCount, expectedCalls, expectedMode] of [
  [28, [24], "adaptive-direct"],
  [29, [], "redraw"],
]) {
  test(`adaptive with ${previousCount} prior rendered regions preserves its decision and coverage cost`, (t) => {
    const h = harness(t, { mode: "direct", actualWaterPolicy: true });
    h.setWaterFeatureCount(previousCount);
    h.draw();
    h.setMode("adaptive");
    h.setWaterFeatureCount(24);
    h.setCoverageRatio(0.2);
    h.draw();
    assert.deepEqual(h.coverageCalls, expectedCalls);
    assert.equal(h.metrics.at(-1).waterCacheMode, expectedMode);
    assert.equal(h.metrics.at(-1).waterPrevRenderedCount, previousCount);
    assert.equal(h.metrics.at(-1).waterVisibleCoverageRatio, previousCount === 28 ? 0.2 : null);
  });
}

test("missing offscreen context clears cache identity and draws directly", (t) => {
  const h = harness(t, { noLayerContext: true }); h.draw();
  const entry = h.getCache().contextScenarioLayerCache.water;
  assert.equal(entry.signature, ""); assert.equal(entry.referenceTransform, null);
  assert.equal(entry.renderedCount, 0);
  assert.equal(h.metrics.at(-1).waterCacheMode, "direct");
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
});

for (const mode of ["reuse", "adaptive", "redraw"]) {
  test(`${mode} preserves cache miss reasons, rebuilds and subsequent mode switches`, (t) => {
    const h = harness(t, { mode });
    const miss = () => h.metrics.findLast((metric) => metric.name === "contextScenarioLayerCacheMiss");
    h.draw();
    assert.equal(miss().reason, mode === "redraw" ? "forced-redraw" : "signature");
    assert.equal(miss().signatureChanged, true);
    h.events.length = 0;
    h.draw();
    assert.equal(h.metrics.at(-1).waterCacheMode, mode === "redraw" ? "redraw" : "reuse");
    assert.equal(h.events.filter((event) => event[0] === "layer" && event[1] === "fill").length, mode === "redraw" ? 1 : 0);

    h.state.width = 100;
    h.draw();
    assert.equal(miss().reason, mode === "redraw" ? "forced-redraw" : "transform");
    assert.equal(miss().signatureChanged, false);
    assert.equal(h.getCache().contextScenarioLayerCache.water.canvas.width, 240);
    h.setRevision("water-2");
    h.draw();
    assert.equal(miss().signatureChanged, true);
    assert.equal(h.getCache().contextScenarioLayerCache.water.signature, "water-2");

    h.setMode("direct"); h.draw();
    assert.equal(h.metrics.at(-1).waterCacheMode, "direct");
    h.setMode("adaptive"); h.draw();
    assert.equal(h.metrics.at(-1).waterCacheMode, "reuse");
    assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
  });

  test(`${mode} leaves no reusable identity when the layer context is unavailable`, (t) => {
    const h = harness(t, { mode, noLayerContext: true });
    h.draw(); h.events.length = 0; h.draw();
    assert.equal(h.metrics.at(-1).waterCacheMode, "direct");
    assert.equal(h.events.filter((event) => event[0] === "main" && event[1] === "fill").length, 1);
    const entry = h.getCache().contextScenarioLayerCache.water;
    assert.equal(entry.signature, "");
    assert.equal(entry.referenceTransform, null);
    assert.equal(entry.renderedCount, 0);
  });
}

test("selection highlight remains live after cached water and before special overlay", (t) => {
  const h = harness(t); h.state.showScenarioSpecialRegions = true; h.draw();
  h.state.selectedWaterRegionId = "water"; h.events.length = 0; h.draw();
  const images = h.events.map((event, index) => event[1] === "drawImage" ? index : -1).filter((index) => index >= 0);
  const highlight = h.events.findIndex((event) => event[0] === "main" && event[1] === "stroke");
  assert.equal(images.length, 2); assert.ok(images[0] < highlight && highlight < images[1]);
  assert.equal(h.main.strokeStyle, "#f1c40f");
  assert.equal(h.metrics.at(-1).highlightedWaterCount, 1);
  assert.equal(h.metrics.at(-1).waterCacheMode, "reuse");
  assert.equal(h.events.some((event) => event[0] === "layer" && event[1] === "fill"), false);
  assert.equal(h.metrics.at(-1).specialCacheMode, "reuse");
  h.state.selectedWaterRegionId = ""; h.events.length = 0; h.draw();
  assert.equal(h.metrics.at(-1).highlightedWaterCount, 0);
  assert.equal(h.events.some((event) => event[1] === "stroke"), false);
  h.state.showWaterRegions = false; h.state.showScenarioSpecialRegions = false;
  h.events.length = 0; h.draw();
  assert.deepEqual(h.events, []); assert.equal(h.metrics.at(-1).reason, "disabled");
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
});

test("Atlantropa land-like overlays stay between water highlight and special with live colors", (t) => {
  const h = harness(t); h.state.showScenarioAtlantropa = true;
  h.state.showScenarioSpecialRegions = true; h.state.selectedWaterRegionId = "water";
  h.draw(); h.events.length = 0; h.state.colors = { shoal: "#aabbcc" }; h.draw();
  const highlight = h.events.findIndex((event) => event[0] === "main" && event[1] === "stroke");
  const fills = h.events.map((event, index) => event[0] === "main" && event[1] === "fill" ? index : -1).filter((index) => index >= 0);
  assert.deepEqual(fills.map((index) => h.events[index][2]), ["land", "shoal"]);
  assert.ok(highlight < fills[0]);
  assert.ok(fills[1] < h.events.findLastIndex((event) => event[1] === "drawImage"));
  assert.equal(h.main.fillStyle, "#aabbcc");
  assert.equal(h.metrics.at(-1).atlantropaLandLikeRenderedCount, 2);
});

for (const mode of ["density", "heatmap"]) {
  test(`TNO ${mode} marks Atlantropa land and shoal unestimated while water and visibility keep existing behavior`, (t) => {
    const h = harness(t, { mode: "direct" });
    h.state.showScenarioAtlantropa = true;
    h.state.activeScenarioId = "tno_1962";
    h.state.activeScenarioManifest = { source: { runtime_topology_sha256: "geometry-current" } };
    h.state.styleConfig = { population: { enabled: true, mode, dataVersion: POPULATION_DATA_VERSION } };
    h.state.populationRuntime = { status: "ready", data: {
      layerId: POPULATION_LAYER_ID, dataVersion: POPULATION_DATA_VERSION, year: POPULATION_YEAR,
      scenarioId: "tno_1962", geometryVersion: "geometry-current",
    } };
    h.state.colors = { land: "#ff0000", shoal: "#00ff00" };
    const fills = [];
    const fill = h.main.fill;
    h.main.fill = function(path) { fills.push({ path, color: this.fillStyle }); fill(path); };
    h.draw();
    assert.deepEqual(fills.filter(({ path }) => ["land", "shoal"].includes(path)), [
      { path: "land", color: POPULATION_UNESTIMATED_COLOR },
      { path: "shoal", color: POPULATION_UNESTIMATED_COLOR },
    ]);
    assert.ok(fills.some(({ path, color }) => typeof path !== "string" && color === "#123456"), "source water retains its live ocean fill");
    fills.length = 0;
    h.state.showScenarioAtlantropa = false;
    h.draw();
    assert.equal(fills.filter(({ path }) => ["land", "shoal"].includes(path)).length, 0);
    h.state.showScenarioAtlantropa = true;
    h.state.populationRuntime.status = "loading";
    fills.length = 0; h.draw();
    assert.deepEqual(fills.filter(({ path }) => ["land", "shoal"].includes(path)), [
      { path: "land", color: "#ff0000" }, { path: "shoal", color: "#00ff00" },
    ], "inactive population data keeps the original atlas palette");
    h.state.showWaterRegions = false;
    fills.length = 0; h.draw();
    assert.equal(fills.length, 0, "population does not force the overlay on when its water-region pass is hidden");
  });
}

test("renderer wires projection and adaptive resets to the same overlay owner", () => {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  assert.match(source, /createScenarioRegionOverlayRenderOwner\(runtimeState,\s*\{\s*rendererSurfaceHost,/);
  assert.match(source, /resetHostWaterPathCaches: \(\) => \{\s*scenarioRegionOverlayRenderOwner\?\.resetWaterPathCaches\(\{ preserveResidentWorker: true \}\);/);
  assert.match(source, /getPreviousRenderedCount: \(\) => getScenarioRegionOverlayRenderOwner\(\)\.getPreviousWaterRenderedCount\(\),/);
  assert.match(source, /computeProjectedGeoBounds: \(part\) => getScenarioRegionOverlayRenderOwner\(\)\.getScenarioWaterPartBounds\(part\),/);
  assert.match(source, /function resetScenarioWaterCacheAdaptiveState\([^)]*\) \{\s*scenarioRegionOverlayRenderOwner\?\.resetPreviousWaterRenderedCount\(\);/);
  assert.match(source, /function drawScenarioRegionOverlaysPass\(k\) \{\s*return getScenarioRegionOverlayRenderOwner\(\)\.drawScenarioRegionOverlaysPass\(k\);/);
  assert.doesNotMatch(source, /let scenarioWater(?:Part|Feature)PathCache/);
});

test("shared cache summaries are immutable and global reset releases all overlay layers", (t) => {
  const h = harness(t); h.draw(); h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  const api = h.cacheOwner.scenarioLayerCache;
  const snapshot = api.getSnapshot("water");
  assert.deepEqual(Object.keys(snapshot).sort(), ["hasCanvas", "hasReferenceTransform", "renderedCount", "signature"]);
  assert.throws(() => { snapshot.signature = "forged"; }, TypeError);
  assert.equal(api.getSnapshot("water").signature, "water-1");
  h.cacheOwner.clearRenderPassReferenceTransforms();
  assert.deepEqual(h.getCache().contextScenarioLayerCache, {});
  assert.equal(api.draw("water", h.state.zoomTransform), false);
  assert.equal(api.draw("relief", h.state.zoomTransform), false);
  h.draw(); h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  assert.equal(api.getSnapshot("water").renderedCount, 1);
  assert.equal(api.getSnapshot("relief").renderedCount, 1);
});

test("relief owns cache hit, resize, revision and replacement decisions independently of water", (t) => {
  const h = harness(t); h.draw();
  const water = h.getCache().contextScenarioLayerCache.water;
  const draw = () => h.reliefOwner.drawScenarioReliefOverlaysPass(h.state.zoomTransform.k);
  draw();
  assert.equal(h.metrics.at(-1).cacheMode, "redraw");
  h.events.length = 0; draw();
  assert.equal(h.metrics.at(-1).cacheMode, "reuse");
  assert.equal(h.events.some((event) => event[0] === "reliefPath"), false);
  h.state.height = 100; draw();
  assert.equal(h.metrics.at(-1).cacheMode, "redraw");
  assert.equal(h.getCache().contextScenarioLayerCache.relief.canvas.height, 240);
  assert.equal(h.getCache().contextScenarioLayerCache.water, water);
  assert.equal(water.signature, "water-1");
  h.setRevision("relief-2"); draw();
  assert.equal(h.metrics.at(-1).cacheMode, "redraw");
  h.replaceCache(); draw();
  assert.equal(h.metrics.at(-1).cacheMode, "redraw");
  assert.equal(h.getCache().contextScenarioLayerCache.water, undefined);
});

test("relief phase and visibility gates do not composite an existing cache", (t) => {
  const h = harness(t);
  h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  for (const phase of ["interacting", "settling"]) {
    h.state.renderPhase = phase; h.events.length = 0;
    h.reliefOwner.drawScenarioReliefOverlaysPass(1);
    assert.deepEqual(h.events, []);
    assert.equal(h.metrics.at(-1).reason, phase);
  }
  h.state.renderPhase = "idle";
  h.state.showScenarioReliefOverlays = false; h.events.length = 0;
  h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  assert.deepEqual(h.events, []);
  assert.equal(h.metrics.at(-1).reason, "disabled");
  h.state.showScenarioReliefOverlays = true;
  h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  assert.equal(h.metrics.at(-1).cacheMode, "reuse");
});

test("relief missing layer context draws on the active target without publishing cache identity", (t) => {
  const h = harness(t, { noLayerContext: true });
  h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  assert.equal(h.metrics.at(-1).cacheMode, "direct");
  assert.equal(h.events.some((event) => event[0] === "main" && event[1] === "stroke"), true);
  assert.equal(h.cacheOwner.scenarioLayerCache.getSnapshot("relief").hasReferenceTransform, false);
});

test("failed layer painting or signature calculation cannot reuse partial pixels and restores the live target", (t) => {
  const h = harness(t); h.draw();
  const api = h.cacheOwner.scenarioLayerCache;
  for (const failingStage of ["draw", "signature"]) {
    assert.throws(() => api.render("water", h.state.zoomTransform, {
      draw: () => { if (failingStage === "draw") throw new Error("paint failed"); return 1; },
      getSignature: () => { throw new Error("signature failed"); },
    }), /failed/);
    assert.deepEqual(api.getSnapshot("water"), { signature: "", renderedCount: 0, hasCanvas: true, hasReferenceTransform: false });
    assert.equal(api.draw("water", h.state.zoomTransform), false);
    h.setMode("direct"); h.events.length = 0; h.draw();
    assert.equal(h.events.some((event) => event[0] === "main" && event[1] === "fill"), true);
    h.setMode("reuse"); h.draw();
    assert.equal(h.metrics.at(-1).waterCacheMode, "redraw");
  }
});


test("DPR changes rebuild all layer sizes and context loss clears a previously valid layer", (t) => {
  const h = harness(t); h.state.showScenarioSpecialRegions = true;
  h.draw(); h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  const widths = Object.fromEntries(Object.entries(h.getCache().contextScenarioLayerCache).map(([key, entry]) => [key, entry.canvas.width]));
  h.state.dpr = 3;
  h.draw(); h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  for (const name of ["water", "special", "relief"]) {
    assert.equal(h.getCache().contextScenarioLayerCache[name].canvas.width, widths[name] * 1.5);
    assert.equal(h.cacheOwner.scenarioLayerCache.getSnapshot(name).hasReferenceTransform, true);
  }
  h.setNoLayerContext(true); h.setRevision("new-revision");
  h.draw(); h.reliefOwner.drawScenarioReliefOverlaysPass(1);
  for (const name of ["water", "relief"]) {
    assert.equal(h.cacheOwner.scenarioLayerCache.getSnapshot(name).hasReferenceTransform, false);
    assert.equal(h.cacheOwner.scenarioLayerCache.draw(name, h.state.zoomTransform), false);
  }
});

test("a failed forced water redraw invalidates the old cache and the next draw rebuilds it", (t) => {
  const h = harness(t); h.draw(); h.setMode("redraw");
  const context = h.getCache().contextScenarioLayerCache.water.canvas.getContext("2d");
  const fill = context.fill;
  context.fill = () => { throw new Error("partial draw failure"); };
  assert.throws(() => h.draw(), /partial draw failure/);
  assert.equal(h.cacheOwner.scenarioLayerCache.getSnapshot("water").hasReferenceTransform, false);
  assert.equal(h.cacheOwner.scenarioLayerCache.draw("water", h.state.zoomTransform), false);
  context.fill = fill; h.setMode("reuse"); h.draw();
  assert.equal(h.metrics.at(-1).waterCacheMode, "redraw");
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
});

test("marine fill keeps bathymetry while lakes and user paint stay solid", t => {
  const pattern = { oceanSurface: true };
  const h = harness(t, { mode: "direct", oceanSurfacePattern: pattern });
  h.draw();
  assert.equal(h.main.fillStyle, pattern);
  h.state.waterRegionOverrides = { water: "#123456" };
  h.draw();
  assert.equal(h.main.fillStyle, "#123456");
  h.state.waterRegionOverrides = {};
  h.water.properties = { water_type: "lake" };
  h.draw();
  assert.equal(h.main.fillStyle, "#123456");
});

test("disabled open-ocean paint does not let a stored override hide bathymetry", t => {
  const pattern = { oceanSurface: true };
  const h = harness(t, { mode: "direct", oceanSurfacePattern: pattern });
  h.water.macro = true;
  h.state.waterRegionOverrides = { water: "#123456" };
  h.state.allowOpenOceanPaint = false;
  h.draw();
  assert.equal(h.main.fillStyle, pattern);
  h.state.allowOpenOceanPaint = true;
  h.draw();
  assert.equal(h.main.fillStyle, "#123456");
});

test("precision cache reset retains the resident worker only within the same scene", async t => {
  let disposals = 0;
  const worker = { available: () => true, dispose() { disposals++; }, request: async () => ({
    bitmap: { close() {} }, renderedCount: 1, stats: { geometryBytes: 1, pathBytes: 1, patternBytes: 0 },
  }) };
  const h = harness(t, { rasterPreparation: true, waterWorker: worker });
  h.state.firstVisibleFramePainted = true;
  h.owner.prepareScenarioWaterLayer(); await Promise.resolve(); h.draw();
  h.owner.resetWaterPathCaches({ preserveResidentWorker: true });
  assert.equal(disposals, 0);
  h.state.sceneGeneration = 2;
  h.owner.resetWaterPathCaches({ preserveResidentWorker: true });
  assert.equal(disposals, 1);
});
