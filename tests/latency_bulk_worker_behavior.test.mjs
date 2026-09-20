import test from "node:test";
import assert from "node:assert/strict";
import { createGeometryRasterRuntimeOwner } from "../js/core/renderer/geometry_raster_runtime_owner.js";
function fixture() {
  const state = { firstVisibleFramePainted: true, startupReadonly: false, zoomTransform: { x: 0, y: 0, k: 1 },
    dpr: 1, activeScenarioId: "tno", sceneGeneration: 1, scenarioDataGeneration: 1, topologyRevision: 1,
    renderPhase: "idle", landData: {}, idToKey: new Map([["a", 1]]), hitCanvasDirty: true };
  const flags = { edit: true, bulk: true, color: "red", supported: true };
  const requests = [], rendered = [], scheduled = [];
  const feature = { geometry: { type: "Point", coordinates: [0, 0] } }, projection = {};
  const helpers = { isEnabled: () => true, hasPendingColorEdit: () => flags.edit, allowPendingColorEdit: () => flags.bulk,
    needsPoliticalRender: () => true, getPoliticalLayout: () => ({ pixelWidth: 200, pixelHeight: 160 }),
    getPoliticalSignature: () => flags.color, collectPoliticalItems: () => [{ id: "a", feature }], orderPoliticalItems: items => items,
    getFeatureId: () => "a", excludeVisual: () => false, skipVisual: () => false,
    resolveFillColor: () => flags.color, resolveStrokeColor: () => flags.color,
    collectHitItems: () => ({ items: [{ id: "a", feature }] }), excludeHit: () => false, keyToColor: () => "red" };
  const owner = createGeometryRasterRuntimeOwner({ state, helpers,
    surface: { getProjection: () => projection, getContext: () => ({ save() {}, restore() {}, setTransform() {}, drawImage: bitmap => rendered.push(bitmap) }),
      getHitCanvas: () => ({ width: 200, height: 160 }) },
    client: { available: () => flags.supported, dispose() {}, request: input => new Promise((resolve, reject) => requests.push({ input, resolve, reject })) },
    effects: { recordMetric() {}, requestRender: reason => scheduled.push(reason), commitHit() {} } });
  function finish(i) { const bitmap = { closed: 0, close() { this.closed++; } }; requests[i].resolve({ bitmap, renderedCount: 1 }); return bitmap; }
  return { owner, state, flags, helpers, requests, rendered, scheduled, finish };
}
test("bulk pending edit can prepare and commit exact worker output without clearing visible frame early", async () => {
  const f = fixture(); assert.equal(f.owner.prepareFrame(), true);
  assert.equal(f.rendered.length, 0); const pending = f.owner.preparePolitical();
  assert.equal(f.requests.length, 1);
  const bitmap = f.finish(0); await pending;
  assert.equal(f.owner.drawPolitical().renderedCount, 1); assert.equal(f.rendered[0], bitmap);
  assert.equal(f.flags.edit, true, "only existing rendered-ID completion may clear pending edits");
  f.owner.dispose(); assert.equal(bitmap.closed, 1);
});
test("small previews retain their original synchronous edit contract", () => {
  const f = fixture(); f.flags.bulk = false;
  assert.equal(f.owner.preparePolitical({ force: true }), null); assert.equal(f.requests.length, 0);
  delete f.helpers.allowPendingColorEdit;
  assert.equal(f.owner.preparePolitical({ force: true }), null);
});
test("late bulk result cannot overwrite newer color, camera, scenario or topology", async () => {
  for (const mutate of [f => { f.flags.color = "blue"; }, f => { f.state.zoomTransform.x = 1; },
    f => { f.state.activeScenarioId = "hoi4"; }, f => { f.state.topologyRevision++; }, f => { f.flags.bulk = false; }]) {
    const f = fixture(), pending = f.owner.preparePolitical(); mutate(f);
    const bitmap = f.finish(0); await pending;
    assert.equal(bitmap.closed, 1); assert.equal(f.owner.drawPolitical(), null); assert.equal(f.scheduled.length, 0);
    f.owner.dispose();
  }
});
test("A to B edit requests keep only current exact pixels", async () => {
  const f = fixture(), a = f.owner.preparePolitical(); f.flags.color = "blue"; const b = f.owner.preparePolitical();
  const old = f.finish(0); await a; assert.equal(old.closed, 1);
  assert.equal(f.owner.preparePolitical(), b);
  const current = f.finish(1); await b; assert.equal(f.owner.drawPolitical().renderedCount, 1);
  assert.deepEqual(f.rendered, [current]); f.owner.dispose();
});
test("worker failure releases the exact-frame wait instead of retrying the same failed identity forever", async () => {
  for (const reject of [false, true]) {
    const f = fixture(), pending = f.owner.preparePolitical();
    if (reject) f.requests[0].reject(Error("failure")); else f.requests[0].resolve(null);
    await pending;
    assert.equal(f.owner.prepareFrame(), false); assert.equal(f.requests.length, 1);
    assert.equal(f.scheduled.length, 1);
    f.flags.color = "green"; const next = f.owner.preparePolitical(); assert.equal(f.requests.length, 2);
    f.finish(1); await next; f.owner.dispose();
  }
});
test("unsupported or readonly workers never hold the UI hostage", () => {
  const f = fixture(); f.flags.supported = false; assert.equal(f.owner.prepareFrame(), false);
  f.flags.supported = true; f.state.startupReadonly = true; assert.equal(f.owner.prepareFrame(), false);
});
test("disposing an in-flight bulk edit closes late bitmap without scheduling another frame", async () => {
  const f = fixture(), pending = f.owner.preparePolitical(); f.owner.dispose();
  const bitmap = f.finish(0); await pending;
  assert.equal(bitmap.closed, 1); assert.equal(f.rendered.length, 0); assert.equal(f.scheduled.length, 0);
});
