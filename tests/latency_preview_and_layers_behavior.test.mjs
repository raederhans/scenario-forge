import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createPoliticalPatchPreviewBudget } from "../js/core/renderer/political_patch_preview_budget.js";
import { createContextLayerRenderScheduler } from "../js/core/renderer/context_layer_render_scheduler.js";
const pointFeature = (count = 5) => ({ geometry: { type: "Polygon", coordinates: [Array.from({ length: count }, (_, i) => [i, 0])] } });

test("small previews fit; bulk rejection never traverses geometry", () => {
  const budget = createPoliticalPatchPreviewBudget({ now: () => 0 });
  assert.equal(budget.inspect([{ feature: pointFeature() }]).allowed, true);
  const entries = Array.from({ length: 25 }, () => ({ get feature() { throw Error("must not scan bulk"); } }));
  assert.equal(budget.inspect(entries).reason, "feature-budget");
  assert.equal(budget.isDeferred(), true);
  budget.reset(); assert.equal(budget.isDeferred(), false);
});
test("one giant cold polygon has bounded inspection but cached paths remain cheap", () => {
  let reads = 0;
  const coordinates = new Proxy(Array.from({ length: 2500 }, () => [1, 2]), {
    get(target, prop, receiver) { if (/^\d+$/.test(String(prop))) reads++; return Reflect.get(target, prop, receiver); },
  });
  const entries = [{ feature: { geometry: { type: "Polygon", coordinates: [coordinates] } } }];
  const budget = createPoliticalPatchPreviewBudget({ now: () => 0 });
  assert.equal(budget.inspect(entries).reason, "cold-path-budget");
  assert.ok(reads <= 2500);
  reads = 0;
  assert.equal(budget.inspect(entries, () => true).allowed, true);
  assert.equal(reads, 0);
});
test("structurally huge empty multipolygons cannot monopolize the estimator", () => {
  const budget = createPoliticalPatchPreviewBudget({ now: () => 0 });
  const entries = [{ feature: { geometry: { type: "MultiPolygon", coordinates: new Array(100000).fill([]) } } }];
  assert.equal(budget.inspect(entries).reason, "structure-budget");
});
test("inspection and between-feature time limits are independent of frame scheduling", () => {
  let clock = 0;
  const budget = createPoliticalPatchPreviewBudget({ now: () => clock++ });
  assert.equal(budget.inspect(Array.from({ length: 10 }, () => ({ feature: pointFeature() })), () => true).reason, "inspection-time-budget");
  assert.equal(budget.timeRemaining(0), false);
});
function schedulerFixture() {
  let identity = ["tno", 1], time = 0;
  const jobs = [], calls = [], metrics = [];
  const owner = createContextLayerRenderScheduler({ getIdentity: () => identity,
    now: () => time, schedule: (fn, delay) => { const job = { fn, delay }; jobs.push(job); return job; },
    cancel: (job) => { job.cancelled = true; }, requestRender: (...args) => calls.push(args),
    recordMetric: (...args) => metrics.push(args) });
  return { owner, jobs, calls, metrics, switchScene: () => { identity = ["hoi4", 2]; }, advance: () => { time += 10; } };
}
test("layer completions share a non-restarting bounded window and never flush", () => {
  const f = schedulerFixture();
  f.owner.request(["urban"], "preset"); f.advance(); f.owner.request(["rivers", "urban"], "preset");
  assert.equal(f.jobs.length, 1); assert.equal(f.jobs[0].delay, 32); assert.equal(f.calls.length, 0);
  f.jobs[0].fn();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].flush, false);
  assert.deepEqual(f.metrics[0][2].layers, ["urban", "rivers"]); assert.equal(f.metrics[0][2].requestCount, 2);
  assert.equal(f.owner.hasPending(), false);
});
test("a scene change or reset invalidates an already queued layer callback", () => {
  const f = schedulerFixture(); f.owner.request(["urban"], "old"); f.switchScene();
  f.jobs[0].fn(); assert.equal(f.calls.length, 0);
  f.owner.request(["rivers"], "new"); f.owner.reset(); f.jobs[1].fn();
  assert.equal(f.calls.length, 0); assert.equal(f.jobs[1].cancelled, true);
});
test("new scene replaces old batch while stale callbacks cannot cancel new work", () => {
  const f = schedulerFixture(); f.owner.request(["urban"], "old"); f.switchScene(); f.owner.request(["physical"], "new");
  f.jobs[0].fn(); assert.equal(f.owner.hasPending(), true);
  f.jobs[1].fn(); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.metrics[0][2].layers, ["physical"]);
});

const source = fs.readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
function previewFixture() {
  let clock = 0;
  const features = new Map(), calls = [], metrics = [], cache = {};
  const budget = createPoliticalPatchPreviewBudget({ now: () => clock });
  const scope = {
    politicalPatchPreviewBudget: budget,
    rendererSurfaceHost: { getPoliticalPatchContext: () => ({ canvas: {}, save() {}, restore() {} }), getProjection: () => ({}), getPathCanvas: () => ({}) },
    normalizePoliticalColorEditIds: (ids) => [...new Set(ids)], nowMs: () => clock,
    findResolvedColorFeatureById: (id) => { calls.push(["resolve", id]); return features.get(id); },
    getPoliticalFeaturePathEntry: () => null,
    clearPoliticalPatchOverlay: (reason) => calls.push(["clear", reason]),
    recordRenderPerfMetric: (...args) => metrics.push(args),
    runtimeState: { zoomTransform: { k: 1 }, activeScenarioId: "tno", colorRevision: 2 },
    getTransformSignature: () => "view", getLogicalCanvasDimensions: () => [800, 600],
    prepareTargetContext: () => 1, withRenderTarget: (_, fn) => fn(), orderPoliticalShellUnderlayFirst: (items) => items,
    drawPoliticalFeature: (feature, _, { metricsCollector }) => { calls.push(["draw", feature.id]); metricsCollector.renderedCount++; metricsCollector.renderedIds.add(feature.id); clock += scope.drawCost; },
    recordPoliticalPatchOverlayPaintDiagnostics() {}, getRenderPassCacheState: () => cache,
    recordFillPatchFirstPixelMetric: (value) => calls.push(["first-pixel", value]), drawCost: 0,
  };
  const body = source.slice(source.indexOf("function paintPoliticalPatchOverlayForIds("), source.indexOf("\nfunction clearPendingPoliticalColorEdit("));
  vm.createContext(scope); vm.runInContext(body, scope);
  return { scope, features, calls, metrics, budget, paint: (ids) => scope.paintPoliticalPatchOverlayForIds(ids) };
}
test("production preview rejects a bulk edit before ID resolution and keeps old preview from surviving undo", () => {
  const f = previewFixture(); assert.equal(f.paint(Array.from({ length: 1000 }, (_, i) => `id${i}`)), false);
  assert.equal(f.calls.filter(([type]) => type === "resolve" || type === "draw").length, 0);
  assert.deepEqual(f.calls[0], ["clear", "pending-edit-deferred"]);
  assert.equal(f.budget.isDeferred(), true);
});
test("production preview records only actually drawn IDs when it yields to exact rendering", () => {
  const f = previewFixture(); f.scope.drawCost = 4;
  for (const id of ["a", "b"]) f.features.set(id, { id, ...pointFeature() });
  assert.equal(f.paint(["a", "b"]), true);
  assert.equal(f.budget.isDeferred(), true);
  assert.equal(f.calls.filter(([type]) => type === "draw").length, 1);
  assert.deepEqual([...f.calls.find(([type]) => type === "first-pixel")[1].renderedIds], ["a"]);
});
test("production layer invalidation preserves the water source token and schedules rather than flushes", () => {
  const body = source.slice(source.indexOf("function invalidateContextLayerVisualStateBatch("), source.indexOf("\nfunction createHitCanvasElement("));
  const scheduled = [], invalidated = [];
  const scope = { layerResolverCache: { waterRegionsDataToken: "stable-water" },
    invalidateRenderPasses: (passes) => invalidated.push([...passes]), clearRenderPassReferenceTransforms() {},
    contextLayerRenderScheduler: { request: (...args) => scheduled.push(args) } };
  vm.createContext(scope); vm.runInContext(body, scope);
  scope.invalidateContextLayerVisualStateBatch(["urban"], "load");
  assert.equal(scope.layerResolverCache.waterRegionsDataToken, "stable-water");
  assert.deepEqual(invalidated[0], ["contextBase", "dayNight"]); assert.equal(scheduled.length, 1);
  scope.invalidateContextLayerVisualStateBatch(["physical"], "load", { renderNow: false });
  assert.equal(scheduled.length, 1); assert.ok(invalidated[1].includes("physicalBase"));
});

test("a preset submits all context families as one batch rather than independent renderNow requests", () => {
  const source = fs.readFileSync(new URL("../js/ui/toolbar/appearance_controls_controller.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("  const ensureAppearancePresetLayerData = () => {"), source.indexOf("  const appearancePresetsOwner ="));
  const requests = [];
  const scope = { runtimeState: { showUrban: true, showPhysical: true, showRivers: true, showTransport: true, showRoads: true,
      ensureContextLayerDataFn: (...args) => requests.push(args) },
    getPhysicalContextLayerRequests: () => ["physical", ["physical_semantics"]],
    listTransportOverviewCapabilityFamilyIds: () => ["roads"], getTransportOverviewVisibilityField: () => "showRoads",
    getTransportOverviewDataLayerKeys: () => ["roads"], getContextLayerRequestFromKeys: value => value,
  };
  vm.createContext(scope); vm.runInContext(`${body}\nglobalThis.apply = ensureAppearancePresetLayerData;`, scope);
  scope.apply(); assert.equal(requests.length, 1);
  assert.deepEqual([...requests[0][0]], ["urban", "physical", "physical_semantics", "rivers", "roads"]);
});
