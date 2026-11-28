import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRenderCacheOwner } from "../js/core/renderer/render_cache_owner.js";
import { readFileSync } from "node:fs";
import { createScenarioRegionOverlayRenderOwner } from "../js/core/renderer/scenario_region_overlay_render_owner.js";

function harness(t, { waterWorker = null } = {}) {
  const events = [];
  const context = (name) => {
    const target = Object.fromEntries(
    ["save", "restore", "setTransform", "drawImage", "translate", "scale", "fill", "stroke", "beginPath", "closePath", "clip", "moveTo", "lineTo", "setLineDash"]
      .map((method) => [method, (...args) => events.push([name, method, ...args])]),
    );
    return target;
  };
  let target = context("main");
  const layer = context("layer");
  const water = { id: "water", parts: [{ id: "part" }] };
  const state = { width: 40, height: 60, renderPhase: "idle", showScenarioReliefOverlays: true, showWaterRegions: true, dpr: 2, zoomTransform: { k: 1, x: 0, y: 0 }, waterRegionsById: new Map([["water", water]]) };
  const cache = { contextScenarioLayerCache: {}, layouts: {} };
  let revision = "water-1";
  const projection = "projection-1";
  let projectionHandle = () => null;
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldPath = Object.getOwnPropertyDescriptor(globalThis, "Path2D");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
    return { width: 1, height: 1, getContext: () => layer };
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
  const owner = createScenarioRegionOverlayRenderOwner(state, {
    nowMs: () => 0,
    collectContextMetric() {},
    getEffectiveAtlantropaFeatures: () => ({ land: [], shoal: [], relief: [] }),
    isScenarioAtlantropaVisible: () => false,
    getScenarioSpecialVisualRevisionToken: () => "special",
    getWaterPreparationRevision: waterWorker ? () => revision : null,
    getWaterWorkerProjectionOptions: waterWorker ? () => ({ factory: "geoEqualEarth" }) : null,
    createWaterWorkerClient: waterWorker ? () => waterWorker : undefined,
    getScenarioWaterRasterLayout: waterWorker ? () => cacheOwner.getRenderPassLayout("contextScenario") : null,
    withRenderTarget,
    prepareTargetContext: (context, transform) => { context.clearRect?.(); return transform.k; },
    rendererSurfaceHost: {
      getContext: () => target,
      getProjection: () => projectionHandle,
      getPathCanvas: () => (feature) => events.push(["pathCanvas", feature.id]),
      getPathSvg: () => (part) => { events.push(["pathSvg", projection, part.id]); return `${projection}:${part.id}`; },
    },
    scenarioLayerCache: cacheOwner.scenarioLayerCache,
    cloneZoomTransform: (value) => ({ ...value }),
    isWaterRegionRenderable: () => true,
    getWaterRegionDefaultStyle: () => ({ opacity: 0.6 }),
    collectSafeWaterRegionGeometryParts: (feature) => feature.parts,
    projectedGeoBoundsInScreen: () => true,
    computeProjectedGeoBounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
    getWaterRegionColor: () => "#123456",
    getScenarioWaterVisualRevisionToken: () => revision,
    isWaterRegionEnabled: () => true,
    isMacroOceanWaterRegion: (feature) => !!feature.macro,
    isBaseGeographyScenarioFeature: () => false,
    getEffectiveWaterRegionFeatures: () => [water],
    getEffectiveSpecialRegionFeatures: () => [],
    getForcedScenarioWaterCacheMode: () => ({ mode: "reuse", source: "test" }),
    shouldEnableContextScenarioTransformReuse: () => true,
    shouldUseDirectScenarioWaterDraw: () => false,
  });
  return { owner, state, water, events,
    draw: () => owner.drawScenarioRegionOverlaysPass(state.zoomTransform.k),
    setProjection(value) { projectionHandle = value; },
    setRevision(value) { revision = value; },
  };
}

test("worker revision change aborts old candidate and closes its late bitmap", async t => {
  const jobs = [];
  const worker = { available: () => true, dispose() {}, request: (_input, { signal }) => new Promise(resolve => jobs.push({ resolve, signal })) };
  const h = harness(t, { waterWorker: worker });
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
});
