import assert from "node:assert/strict";
import test from "node:test";
import { createGeometryRasterRuntimeOwner } from "../js/core/renderer/geometry_raster_runtime_owner.js";

const tick = () => new Promise(setImmediate);
function fixture() {
  const feature = { geometry: { type: "Point", coordinates: [0, 0] } };
  const state = { firstVisibleFramePainted: true, zoomTransform: { x: 0, y: 0, k: 2 }, dpr: 1.25,
    activeScenarioId: "tno", sceneGeneration: 1, scenarioDataGeneration: 1, topologyRevision: 1,
    landData: { features: [feature] }, idToKey: new Map([["a", 1]]), hitCanvasDirty: true, renderPhase: "idle" };

  const requests = [], commits = [];
  const projection = { scale: () => 100, translate: () => [100, 100] };
  const layout = { paddedWidth: 101, paddedHeight: 103, pixelWidth: 126, pixelHeight: 128, offsetX: 4, offsetY: 5 };
  const context = { save() {}, restore() {}, setTransform() {}, drawImage() {} };
  const client = { available: () => true, dispose() {}, request: (input) => new Promise((resolve, reject) => requests.push({ input, resolve, reject })) };
  const h = { isEnabled: () => true, pointRadius: 2, getPoliticalLayout: () => layout,
    getPoliticalSignature: () => "political", hasPendingColorEdit: () => false,
    needsPoliticalRender: () => true, collectPoliticalItems: () => state.landData.features.map((feature, drawOrder) => ({ id: "a", feature, drawOrder })),
    orderPoliticalItems: (items) => items, getFeatureId: () => "a", excludeVisual: () => false,
    skipVisual: () => false, resolveFillColor: () => "#123456", resolveStrokeColor: () => "#987654",
    collectHitItems: () => ({ items: state.landData.features.map((feature) => ({ id: "a", feature })), stats: { candidates: 1 } }),
    excludeHit: () => false, keyToColor: (key) => `rgb(${key},0,0)` };
  const owner = createGeometryRasterRuntimeOwner({ state, client, helpers: h,
    surface: { getProjection: () => projection, getHitCanvas: () => ({ width: 126, height: 128 }), getContext: () => context },
    effects: { recordMetric() {}, requestRender() {}, commitHit: (result) => commits.push(result) } });
  const finish = (index) => {
    const bitmap = { close() {} };
    requests[index].resolve({ bitmap, renderedCount: 1 });
  };
  return { owner, state, commits, finish };
}

test("a scenario switch rejects the pending political frame", async () => {
  const f = fixture();
  const pending = f.owner.preparePolitical();
  f.state.activeScenarioId = "hoi4";
  f.finish(0);
  await pending;
  assert.equal(f.owner.drawPolitical(), null);
  f.owner.dispose();
});

test("a scenario switch rejects the pending hit map", async () => {
  const f = fixture();
  assert.equal(f.owner.requestHit(), true);
  f.state.activeScenarioId = "hoi4";
  f.finish(0);
  await tick();
  assert.equal(f.commits.length, 0);
  f.owner.dispose();
});
