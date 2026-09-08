import test from "node:test";
import assert from "node:assert/strict";
import { createRenderCacheOwner } from "../js/core/renderer/render_cache_owner.js";
import { createScenarioReliefOverlayRenderOwner } from "../js/core/renderer/scenario_relief_overlay_render_owner.js";
import { readFileSync } from "node:fs";
import { createScenarioRegionOverlayRenderOwner } from "../js/core/renderer/scenario_region_overlay_render_owner.js";

function harness(t, { mode = "reuse", noLayerContext = false } = {}) {
  const events = [];
  const metrics = [];
  const context = (name) => Object.fromEntries(
    ["save", "restore", "setTransform", "drawImage", "translate", "scale", "fill", "stroke", "beginPath", "clip", "moveTo", "lineTo", "setLineDash"]
      .map((method) => [method, (...args) => events.push([name, method, ...args])]),
  );
  let target = context("main");
  const main = target;
  const layer = context("layer");
  const water = { id: "water", parts: [{ id: "part" }] };
  const state = { width: 40, height: 60, renderPhase: "idle", showScenarioReliefOverlays: true, showWaterRegions: true, dpr: 2, zoomTransform: { k: 1, x: 0, y: 0 }, waterRegionsById: new Map([["water", water]]) };
  let cache = { contextScenarioLayerCache: {}, layouts: {} };
  let revision = "water-1";
  let projection = "projection-1";
  let adaptiveDirect = false;
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldPath = Object.getOwnPropertyDescriptor(globalThis, "Path2D");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 1, height: 1, getContext: () => noLayerContext ? null : layer }) } });
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
    rendererSurfaceHost: {
      getContext: () => target,
      getPathCanvas: () => (feature) => events.push(["pathCanvas", feature.id]),
      getPathSvg: () => (part) => { events.push(["pathSvg", projection, part.id]); return `${projection}:${part.id}`; },
    },
    scenarioLayerCache: cacheOwner.scenarioLayerCache,
    cloneZoomTransform: (value) => ({ ...value }),
    nowMs: () => 1,
    collectContextMetric: (name, _duration, payload) => metrics.push({ name, ...payload }),
    getFeatureId: (feature) => feature.id,
    isWaterRegionRenderable: () => true,
    getWaterRegionDefaultStyle: () => ({ opacity: 0.6 }),
    collectSafeWaterRegionGeometryParts: (feature) => feature.parts,
    projectedGeoBoundsInScreen: () => true,
    computeProjectedGeoBounds: (part) => part,
    getWaterRegionColor: () => "#123456",
    getScenarioWaterVisualRevisionToken: () => revision,
    isWaterRegionEnabled: () => true,
    isMacroOceanWaterRegion: () => false,
    isBaseGeographyScenarioFeature: () => false,
    isSpecialRegionEnabled: () => true,
    pathBoundsInScreen: () => true,
    getSpecialRegionOpacity: () => 0.5,
    getSpecialRegionColor: () => "#654321",
    getSpecialRegionStrokeColor: () => "#000000",
    getScenarioSpecialVisualRevisionToken: () => "special-1",
    isScenarioAtlantropaVisible: () => !!state.showScenarioAtlantropa,
    getEffectiveAtlantropaFeatures: () => ({ land: [{ id: "land" }], shoal: [{ id: "shoal" }], relief: [{ id: "relief" }] }),
    getLogicalCanvasDimensions: () => [100, 100],
    shouldExcludePoliticalVisualFeature: (feature) => feature.id === "relief",
    shouldSkipFeature: () => false,
    getResolvedFeatureColor: () => "#abcdef",
    LAND_FILL_COLOR: "#f0f0f0",
    getPoliticalFeaturePathEntry: (feature) => ({ path: feature.id }),
    getEffectiveWaterRegionFeatures: () => [water],
    getEffectiveSpecialRegionFeatures: () => [{ id: "special" }],
    getForcedScenarioWaterCacheMode: () => ({ mode, source: "test" }),
    getScenarioWaterCacheComplexitySignals: () => ({ visibleCoverageRatio: 0.5, previousRenderedCount: owner.getPreviousWaterRenderedCount() }),
    shouldEnableContextScenarioTransformReuse: () => true,
    shouldUseDirectScenarioWaterDraw: () => adaptiveDirect,
  });
  return { owner, reliefOwner, cacheOwner, state, get layout() { return cacheOwner.getRenderPassLayout("contextScenario"); }, events, metrics, main, draw: () => owner.drawScenarioRegionOverlaysPass(state.zoomTransform.k),
    setNoLayerContext: (value) => { noLayerContext = value; },
    setMode: (value) => { mode = value; }, setRevision: (value) => { revision = value; },
    setProjection: (value) => { projection = value; }, setAdaptiveDirect: () => { adaptiveDirect = true; },
    replaceCache: () => { cache = { contextScenarioLayerCache: {}, layouts: {} }; }, getCache: () => cache,
  };
}

test("water cache draws into the live target then reuses with DPR and overscan translation", (t) => {
  const h = harness(t);
  h.draw();
  assert.equal(h.owner.getPreviousWaterRenderedCount(), 1);
  assert.equal(h.events.filter((event) => event[0] === "layer" && event[1] === "fill").length, 1);
  assert.equal(h.events.filter((event) => event[0] === "main" && event[1] === "fill").length, 0);
  h.events.length = 0;
  h.state.zoomTransform = { k: 2, x: 10, y: 20 };
  h.draw();
  assert.deepEqual(h.events.find((event) => event[1] === "translate"), ["main", "translate", 12, 28]);
  assert.deepEqual(h.events.find((event) => event[1] === "scale"), ["main", "scale", 2, 2]);
  assert.equal(h.events.some((event) => event[1] === "fill"), false);
  assert.equal(h.metrics.at(-1).waterCacheMode, "reuse");
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

test("renderer wires projection and adaptive resets to the same overlay owner", () => {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  assert.match(source, /createScenarioRegionOverlayRenderOwner\(runtimeState,\s*\{\s*rendererSurfaceHost,/);
  assert.match(source, /resetHostWaterPathCaches: \(\) => \{\s*scenarioRegionOverlayRenderOwner\?\.resetWaterPathCaches\(\);/);
  assert.match(source, /getPreviousRenderedCount: \(\) => getScenarioRegionOverlayRenderOwner\(\)\.getPreviousWaterRenderedCount\(\),/);
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
