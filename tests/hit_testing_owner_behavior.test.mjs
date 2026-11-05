import assert from "node:assert/strict";
import test from "node:test";
import { createHitTestingOwner } from "../js/core/map_renderer/hit_testing_owner.js";

function harness(overrides = {}) {
  const metrics = [];
  const calls = [];
  let stats = null;
  const feature = { geometry: { type: "Polygon" }, properties: { contains: true } };
  const item = { id: "land", feature, minX: 0, minY: 0, maxX: 10, maxY: 10, bboxArea: 100 };
  const state = {
    landData: { features: [feature] }, spatialItems: [item],
    spatialGrid: new Map([["0:0", [item]]]),
    spatialGridMeta: { cellSize: 100, cols: 1, rows: 1, globals: [] },
    idToKey: new Map([["land", 1]]), keyToId: new Map([[1, "land"]]),
    landIndex: new Map([["land", feature]]), spatialItemsById: new Map([["land", item]]),
    dpr: 2, topologyRevision: 7, hitCanvasTopologyRevision: 0, hitCanvasDirty: true,
    renderPhase: "idle", activeScenarioId: "test",
    zoomTransform: { x: 0, y: 0, k: 1 },
    ...overrides,
  };
  const context = new Proxy({ getImageData: (...args) => {
    calls.push(["getImageData", ...args]); return { data: [1, 0, 0, 255] };
  } }, { get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]) });
  const deps = new Proxy({
    nowMs: () => 10,
    getHitContext: () => context, getPathHitCanvas: () => () => {},
    getHitCanvas: () => ({ width: 100, height: 100 }), getMapSvg: () => ({}),
    getProjection: () => ({ invert: point => point }),
    getRenderPhaseIdle: () => "idle", getHitCanvasViewportOverscanPx: () => 24,
    getLastHitCanvasBuildStats: () => stats, setLastHitCanvasBuildStats: value => { stats = value; },
    collectVisibleLandSpatialItemsWithStats: () => ({ items: [item], stats: { globalCandidateCount: 3, cellCandidateCount: 1 } }),
    getSpatialBucketKey: () => "0:0",
    getLogicalCanvasDimensions: () => [50, 50],
    canonicalCountryCode: value => value,
    getFeatureCountryCodeNormalized: () => "AA", getFeatureInteractionCountryCodeNormalized: () => "BB",
    getWaterRegionType: feature => feature?.properties?.type,
    isMacroOceanWaterRegion: feature => !!feature?.properties?.macro,
    recordRenderPerfMetric: (...args) => metrics.push(args),
    recordInteractionDurationMetric: (...args) => metrics.push(args),
    scheduleHitCanvasBuild: options => calls.push(["schedule", options]),
    cancelScheduledHitCanvasBuild: options => calls.push(["cancel", options]),
  }, { get: (target, key) => target[key] || (() => false) });
  return { state, deps, metrics, calls, item, owner: createHitTestingOwner({ state, deps }) };
}

test("hit colors round trip across byte boundaries", () => {
  const { owner } = harness();
  for (const key of [0, 1, 255, 256, 65535, 65536, 0xffffff]) {
    const pixel = owner.keyToHitColor(key).match(/\d+/g).map(Number);
    assert.equal(owner.hitColorToKey(pixel), key);
  }
});

test("ranking and first containment select the containing candidate and record metrics", t => {
  const previous = globalThis.d3;
  t.after(() => { globalThis.d3 = previous; });
  globalThis.d3 = { geoContains: feature => feature.properties.contains };
  const { owner, item, metrics } = harness();
  const outside = { item: { ...item, id: "outside", bboxArea: 1, feature: { properties: { contains: false } } }, distanceProj: 0 };
  const inside = { item, distanceProj: 0 };
  assert.equal(owner.rankCandidates([outside, inside], [5, 5], { eventType: "click" }).find(c => c.containsGeo).item.id, "land");
  assert.equal(owner.findFirstContainingCandidate([outside, inside], [5, 5]).item.id, "land");
  assert.equal(metrics[0][0], "interactionHitRankDuration");
  assert.equal(metrics[0][2].candidateCount, 2);
  assert.equal(metrics[0][2].geoContainsCount, 2);
  assert.equal(metrics[1][2].fastPath, "hover-first-containing");
});

test("water priority preserves strict lakes and suppresses macro ocean hover", () => {
  const { owner } = harness();
  const land = { id: "land", bboxArea: 10 };
  const lake = { id: "lake", strict: true, bboxArea: 100, feature: { properties: { type: "lake" } } };
  assert.equal(owner.shouldPreferWaterHit(land, lake, { eventType: "click" }), true);
  assert.equal(owner.shouldPreferWaterHit(land, { ...lake, feature: { properties: { macro: true } } }, { eventType: "hover" }), false);
  assert.equal(owner.shouldPreferWaterHit(land, {}), false);
  assert.equal(owner.shouldPreferWaterHit({}, lake), true);
});

test("full canvas build publishes viewport counts and topology revision", () => {
  const { owner, state, metrics } = harness();
  assert.equal(owner.drawHitCanvasWithMetric({ mode: "forced" }), true);
  assert.equal(state.hitCanvasDirty, false);
  assert.equal(state.hitCanvasTopologyRevision, 7);
  assert.equal(owner.isHitCanvasCurrent(), true);
  assert.deepEqual(metrics[0], ["buildHitCanvas", 0, {
    built: true, dirtyBefore: true, globalCandidateCount: 3, cellCandidateCount: 1,
    visibleItemCount: 1, drawnItemCount: 1, globalCount: 3, spatialItemCount: 1, mode: "forced",
  }]);
  assert.equal(metrics[1][2].profile, "viewport-full");
});

test("dirty validation probes a clipped point and schedules the full build", t => {
  const previous = globalThis.d3;
  t.after(() => { globalThis.d3 = previous; });
  globalThis.d3 = { pointer: () => [5, 5] };
  const { owner, state, calls, metrics } = harness({ dpr: NaN });
  assert.equal(owner.getValidatedCanvasHit({}, new Set(["land"]), { forceBuild: true }).id, "land");
  assert.equal(state.hitCanvasDirty, true);
  assert.deepEqual(calls.find(c => c[0] === "schedule"), ["schedule", { reason: "dirty-point-probe-click" }]);
  assert.deepEqual(calls.find(c => c[0] === "rect"), ["rect", 4, 4, 3, 3]);
  assert.deepEqual(calls.find(c => c[0] === "getImageData"), ["getImageData", 5, 5, 1, 1]);
  assert.equal(metrics[0][0], "hitCanvasPointProbe");
  assert.equal(metrics[0][2].candidateCount, 1);
  assert.equal(metrics[1][2].profile, "point-probe");
  assert.equal(owner.getValidatedCanvasHit({}, new Set(["other"])).id, null);
});

test("scheduled, forced and deferred builds preserve their metric modes", () => {
  const { owner, state, metrics, calls } = harness();
  assert.equal(owner.ensureHitCanvasUpToDate(), false);
  assert.equal(calls[0][0], "schedule");
  assert.equal(owner.ensureHitCanvasUpToDate({ force: true }), true);
  assert.equal(metrics[0][2].mode, "forced");
  assert.equal(owner.ensureHitCanvasUpToDate({ force: true }), true);
  assert.equal(metrics.at(-1)[2].reason, "current");
  state.hitCanvasDirty = true;
  owner.drawScheduledHitCanvasWithMetric();
  assert.equal(metrics.at(-1)[2].mode, "deferred");
  owner.recordDeferredFullHitCanvasMetric({ keepReady: true });
  assert.equal(metrics.at(-1)[2].profile, "deferred-full");
  assert.equal(metrics.at(-1)[2].keepReady, true);
});

test("canvas hits retain distinct runtime and interaction countries", t => {
  const previous = globalThis.d3;
  t.after(() => { globalThis.d3 = previous; });
  globalThis.d3 = { pointer: () => [5, 5] };
  const { owner, calls } = harness();
  const hit = owner.getHitResultFromCanvas({});
  assert.equal(hit.countryCode, "BB");
  assert.equal(hit.runtimeCountryCode, "AA");
  assert.deepEqual(calls.find(c => c[0] === "getImageData"), ["getImageData", 10, 10, 1, 1]);
});

test("ordinary canvas excludes noninteractive land while river canvas masks it", () => {
  const { state, deps, item, calls } = harness();
  deps.shouldExcludePoliticalInteractionFeature = () => true;
  deps.orderPoliticalShellUnderlayFirst = items => items;
  const ordinary = createHitTestingOwner({ state, deps });
  ordinary.drawHitCanvas();
  assert.equal(calls.some(c => c[0] === "fill"), false);
  deps.hasVisibleRiverPartitions = () => true;
  const river = createHitTestingOwner({ state, deps });
  river.drawHitCanvas();
  assert.equal(calls.filter(c => c[0] === "fill").length, 1);
  assert.equal(deps.getHitContext().fillStyle, "rgb(0, 0, 0)");
  assert.equal(item.id, "land");
});

test("water picking honors active overlay and enabled-region gates", t => {
  const previous = globalThis.d3;
  t.after(() => { globalThis.d3 = previous; });
  globalThis.d3 = { geoContains: () => true };
  const { state, deps, item } = harness({ showWaterRegions: false });
  state.waterSpatialItems = [item];
  state.waterSpatialGrid = state.spatialGrid;
  state.waterSpatialGridMeta = state.spatialGridMeta;
  deps.isWaterRegionEnabled = () => true;
  const pointer = { px: 5, py: 5, lonLat: [5, 5], zoomK: 1 };
  assert.equal(createHitTestingOwner({ state, deps }).getWaterHitFromPointer(pointer).id, null);
  deps.isOpenOceanOverlayActive = () => true;
  assert.equal(createHitTestingOwner({ state, deps }).getWaterHitFromPointer(pointer).id, "land");
  deps.isWaterRegionEnabled = () => false;
  assert.equal(createHitTestingOwner({ state, deps }).getWaterHitFromPointer(pointer).id, null);
});
