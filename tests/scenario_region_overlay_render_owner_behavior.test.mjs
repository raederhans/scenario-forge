import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScenarioRegionOverlayRenderOwner } from "../js/core/renderer/scenario_region_overlay_render_owner.js";

function harness(t, { mode = "reuse", noLayerContext = false } = {}) {
  const events = [];
  const metrics = [];
  const context = (name) => Object.fromEntries(
    ["save", "restore", "setTransform", "drawImage", "translate", "scale", "fill", "stroke", "beginPath"]
      .map((method) => [method, (...args) => events.push([name, method, ...args])]),
  );
  let target = context("main");
  const main = target;
  const layer = context("layer");
  const water = { id: "water", parts: [{ id: "part" }] };
  const state = { showWaterRegions: true, dpr: 2, zoomTransform: { k: 1, x: 0, y: 0 }, waterRegionsById: new Map([["water", water]]) };
  let cache = { contextScenarioLayerCache: {} };
  const layout = { pixelWidth: 100, pixelHeight: 100, offsetX: 5, offsetY: 7 };
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
  const owner = createScenarioRegionOverlayRenderOwner({
    runtimeState: state,
    rendererSurfaceHost: {
      getContext: () => target,
      getPathCanvas: () => (feature) => events.push(["pathCanvas", feature.id]),
      getPathSvg: () => (part) => { events.push(["pathSvg", projection, part.id]); return `${projection}:${part.id}`; },
    },
    getRenderPassCacheState: () => cache,
    getRenderPassLayout: () => layout,
    cloneZoomTransform: (value) => ({ ...value }),
    areZoomTransformsEquivalent: (a, b) => a.k === b.k && a.x === b.x && a.y === b.y,
    nowMs: () => 1,
    collectContextMetric: (name, _duration, payload) => metrics.push({ name, ...payload }),
    getFeatureId: (feature) => feature.id,
    isWaterRegionRenderable: () => true,
    getWaterRegionDefaultStyle: () => ({ opacity: 0.6 }),
    collectSafeWaterRegionGeometryParts: (feature) => feature.parts,
    projectedGeoBoundsInScreen: () => true,
    computeProjectedGeoBounds: (part) => part,
    getWaterRegionColor: () => "#123456",
    withRenderTarget: (next, draw) => { const previous = target; target = next; try { draw(); } finally { target = previous; } },
    prepareTargetContext: (_target, transform) => transform.k,
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
  return { owner, state, layout, events, metrics, main, draw: () => owner.drawScenarioRegionOverlaysPass(state.zoomTransform.k),
    setMode: (value) => { mode = value; }, setRevision: (value) => { revision = value; },
    setProjection: (value) => { projection = value; }, setAdaptiveDirect: () => { adaptiveDirect = true; },
    replaceCache: () => { cache = { contextScenarioLayerCache: {} }; }, getCache: () => cache,
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
  assert.deepEqual(h.events.find((event) => event[1] === "translate"), ["main", "translate", 10, 26]);
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
  h.layout.pixelWidth = 200; h.draw();
  assert.equal(h.getCache().contextScenarioLayerCache.water.canvas.width, 200);
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

test("selection highlight remains live after cached water and before special overlay", (t) => {
  const h = harness(t); h.state.showScenarioSpecialRegions = true; h.draw();
  h.state.selectedWaterRegionId = "water"; h.events.length = 0; h.draw();
  const images = h.events.map((event, index) => event[1] === "drawImage" ? index : -1).filter((index) => index >= 0);
  const highlight = h.events.findIndex((event) => event[0] === "main" && event[1] === "stroke");
  assert.equal(images.length, 2); assert.ok(images[0] < highlight && highlight < images[1]);
  assert.equal(h.main.strokeStyle, "#f1c40f");
  assert.equal(h.metrics.at(-1).highlightedWaterCount, 1);
  assert.equal(h.metrics.at(-1).specialCacheMode, "reuse");
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
  assert.match(source, /createScenarioRegionOverlayRenderOwner\(\{\s*runtimeState,\s*rendererSurfaceHost,/);
  assert.match(source, /resetHostWaterPathCaches: \(\) => \{\s*scenarioRegionOverlayRenderOwner\?\.resetWaterPathCaches\(\);/);
  assert.match(source, /getPreviousRenderedCount: \(\) => getScenarioRegionOverlayRenderOwner\(\)\.getPreviousWaterRenderedCount\(\),/);
  assert.match(source, /function resetScenarioWaterCacheAdaptiveState\([^)]*\) \{\s*scenarioRegionOverlayRenderOwner\?\.resetPreviousWaterRenderedCount\(\);/);
  assert.match(source, /function drawScenarioRegionOverlaysPass\(k\) \{\s*return getScenarioRegionOverlayRenderOwner\(\)\.drawScenarioRegionOverlaysPass\(k\);/);
  assert.doesNotMatch(source, /let scenarioWater(?:Part|Feature)PathCache/);
});

test("relief shares runtime layer cache and canvas resize invalidation without disturbing water", (t) => {
  const h = harness(t); h.draw();
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const cacheApi = {};
  for (const name of ["getContextScenarioLayerCacheEntry", "ensureContextScenarioLayerCanvas", "drawCachedContextScenarioLayer"]) {
    const declaration = source.match(new RegExp("function " + name + "\\([^]*?\\n}"))?.[0];
    assert.ok(declaration, name);
    cacheApi[name] = new Function("getScenarioRegionOverlayRenderOwner", declaration + "; return " + name)(() => h.owner);
  }
  const water = h.getCache().contextScenarioLayerCache.water;
  const relief = cacheApi.getContextScenarioLayerCacheEntry("relief");
  assert.equal(relief, h.getCache().contextScenarioLayerCache.relief);
  const canvas = cacheApi.ensureContextScenarioLayerCanvas("relief");
  relief.signature = "relief-1"; relief.referenceTransform = { ...h.state.zoomTransform }; relief.renderedCount = 2;
  assert.equal(cacheApi.drawCachedContextScenarioLayer("relief", h.state.zoomTransform), true);
  assert.equal(h.events.at(-2)[2], canvas);
  h.layout.pixelHeight = 200;
  assert.equal(cacheApi.drawCachedContextScenarioLayer("relief", h.state.zoomTransform), false);
  assert.equal(cacheApi.ensureContextScenarioLayerCanvas("relief"), canvas);
  assert.equal(canvas.height, 200); assert.equal(relief.signature, "");
  assert.equal(relief.referenceTransform, null); assert.equal(relief.renderedCount, 0);
  assert.equal(h.getCache().contextScenarioLayerCache.water, water);
  assert.equal(water.signature, "water-1");
});
