import assert from "node:assert/strict";
import test from "node:test";
import { createGeometryRasterRuntimeOwner } from "../js/core/renderer/geometry_raster_runtime_owner.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { createGeometryRasterWorkerClient } from "../js/core/geometry_raster_worker_client.js";

const tick = () => new Promise(setImmediate);
function fixture({ injectedClient = null } = {}) {
  const feature = { geometry: { type: "Point", coordinates: [0, 0] } };
  const state = { firstVisibleFramePainted: true, zoomTransform: { x: 0, y: 0, k: 2 }, dpr: 1.25,
    activeScenarioId: "tno", sceneGeneration: 1, scenarioDataGeneration: 1, topologyRevision: 1,
    landData: { features: [feature] }, idToKey: new Map([["a", 1]]), hitCanvasDirty: true, renderPhase: "idle" };
  const flags = { enabled: true, supported: true, edit: false, needs: true, color: "#123456", excluded: false };
  const requests = [], renders = [], commits = [], paints = [];
  const projection = { scale: () => 100, translate: () => [100, 100] };
  const layout = { paddedWidth: 101, paddedHeight: 103, pixelWidth: 126, pixelHeight: 128, offsetX: 4, offsetY: 5 };
  const context = { save() {}, restore() {}, setTransform() {}, drawImage: (bitmap) => paints.push(bitmap) };
  const client = { available: () => flags.supported, dispose() {}, request: (input) => new Promise((resolve, reject) => requests.push({ input, resolve, reject })) };
  const h = { isEnabled: () => flags.enabled, pointRadius: 2, getPoliticalLayout: () => layout,
    getPoliticalSignature: () => "political", hasPendingColorEdit: () => flags.edit,
    needsPoliticalRender: () => flags.needs, collectPoliticalItems: () => state.landData.features.map((feature, drawOrder) => ({ id: "a", feature, drawOrder })),
    orderPoliticalItems: (items) => items, getFeatureId: () => "a", excludeVisual: () => flags.excluded,
    skipVisual: () => false, resolveFillColor: () => flags.color, resolveStrokeColor: () => "#987654",
    collectHitItems: () => ({ items: state.landData.features.map((feature) => ({ id: "a", feature })), stats: { candidates: 1 } }),
    excludeHit: () => flags.excluded, keyToColor: (key) => `rgb(${key},0,0)` };
  const owner = createGeometryRasterRuntimeOwner({ state, client: injectedClient || client, helpers: h,
    surface: { getProjection: () => projection, getHitCanvas: () => ({ width: 126, height: 128 }), getContext: () => context },
    effects: { recordMetric() {}, requestRender: (reason) => renders.push(reason), commitHit: (result) => commits.push(result) } });
  const finish = (index) => {
    const bitmap = { closes: 0, close() { this.closes++; } };
    requests[index].resolve({ bitmap, renderedCount: 1 });
    return bitmap;
  };
  return { owner, state, flags, requests, renders, commits, paints, finish, projection, layout, h };
}
test("prepare gates, forced exact preparation, dimensions and fine-only drawing preserve style ports", async () => {
  const f = fixture();
  f.state.renderPhase = "interacting";
  assert.equal(f.owner.prepareFrame(), false);
  f.state.renderPhase = "idle"; f.state.deferExactAfterSettle = true;
  assert.equal(f.owner.prepareFrame(), false);
  f.state.deferExactAfterSettle = false; f.flags.needs = false;
  assert.equal(f.owner.prepareFrame(), false);
  const pending = f.owner.preparePolitical({ force: true });
  assert.ok(pending instanceof Promise);
  assert.equal(f.requests[0].input.width, 126);
  assert.equal(f.requests[0].input.height, 128);
  assert.equal(f.requests[0].input.entries[0].strokeColor, "#987654");
  assert.equal(f.requests[0].input.entries[0].lineWidth, 0.375);
  assert.equal(f.paints.length, 0, "preparation never clears or draws the visible frame");
  const bitmap = f.finish(0); await pending;
  f.paints.push("background");
  assert.equal(f.owner.drawPolitical().renderedCount, 1);
  assert.deepEqual(f.paints, ["background", bitmap]);
  f.flags.edit = true;
  assert.equal(f.owner.preparePolitical({ force: true }), null);
  assert.equal(f.owner.drawPolitical(), null, "edits must use synchronous fine drawing");
  f.owner.dispose(); assert.equal(bitmap.closes, 1);
});
test("current political identity detects exact camera, projection, scene, geometry and resolved color", async () => {
  for (const change of [
    (f) => { f.state.zoomTransform.x += 0.000001; },
    (f) => { markProjectionGeometryChanged(f.projection); },
    (f) => { f.state.activeScenarioId = "hoi4"; },
    (f) => { f.state.landData.features[0].geometry = { type: "Point", coordinates: [4, 5] }; },
    (f) => { f.flags.color = "#abcdef"; },
  ]) {
    const f = fixture(); const pending = f.owner.preparePolitical(); change(f);
    const bitmap = f.finish(0); await pending;
    assert.equal(bitmap.closes, 1); assert.equal(f.owner.drawPolitical(), null);
    assert.equal(f.renders.length, 0);
  }
});
test("older completion cannot clear or replace a newer pending generation", async () => {
  const f = fixture(); const old = f.owner.preparePolitical();
  f.state.zoomTransform.x = 20;
  const latest = f.owner.preparePolitical();
  assert.notEqual(old, latest);
  const bitmap = f.finish(0); await old;
  assert.equal(bitmap.closes, 1);
  assert.equal(f.owner.preparePolitical(), latest);
  f.finish(1); await latest;
  assert.equal(f.owner.drawPolitical().renderedCount, 1);
  f.owner.dispose();
});
test("hit requires current mapping, geometry, camera and dirty state; every result is closed", async () => {
  for (const change of [
    (f) => { f.state.idToKey.set("a", 7); },
    (f) => { f.state.landData.features[0].geometry = { type: "Point", coordinates: [4, 5] }; },
    (f) => { f.state.zoomTransform.y = 0.001; },
    (f) => { f.state.hitCanvasDirty = false; },
  ]) {
    const f = fixture(); assert.equal(f.owner.requestHit(), true); change(f);
    const bitmap = f.finish(0); await tick();
    assert.equal(bitmap.closes, 1); assert.equal(f.commits.length, 0);
  }
  const f = fixture(); f.owner.requestHit(); const bitmap = f.finish(0); await tick();
  assert.equal(f.commits.length, 1); assert.equal(bitmap.closes, 1);
});
test("disposed success, fallback and rejection cannot commit or schedule another render", async () => {
  for (const kind of ["political", "hit"]) for (const outcome of ["success", "null", "reject"]) {
    const f = fixture();
    if (kind === "political") f.owner.preparePolitical(); else f.owner.requestHit();
    f.owner.dispose();
    let bitmap;
    if (outcome === "success") bitmap = f.finish(0);
    else if (outcome === "null") f.requests[0].resolve(null);
    else f.requests[0].reject(Error("worker stopped"));
    await tick();
    assert.equal(f.renders.length, 0); assert.equal(f.commits.length, 0);
    if (bitmap) assert.equal(bitmap.closes, 1);
    assert.equal(f.owner.preparePolitical({ force: true }), null);
    assert.equal(f.owner.requestHit(), false);
  }
});
test("late hit generations preserve the current pending task and color edits reject prepared frames", async () => {
  const f = fixture(); f.owner.requestHit();
  f.state.idToKey.set("a", 2); f.owner.requestHit();
  const oldBitmap = f.finish(0); await tick();
  assert.equal(oldBitmap.closes, 1); assert.equal(f.commits.length, 0);
  assert.equal(f.owner.requestHit(), true);
  assert.equal(f.requests.length, 2, "old completion must not clear latest pending hit");
  const newBitmap = f.finish(1); await tick();
  assert.equal(f.commits.length, 1); assert.equal(newBitmap.closes, 1);
  const prepared = f.owner.preparePolitical(); f.flags.edit = true;
  const politicalBitmap = f.finish(2); await prepared;
  assert.equal(politicalBitmap.closes, 1); assert.equal(f.owner.drawPolitical(), null);
});
test("unsupported paths return synchronously and pixel fallback floors fractional DPR", () => {
  const f = fixture(); f.flags.supported = false;
  assert.equal(f.owner.preparePolitical(), null); assert.equal(f.owner.requestHit(), false);
  f.flags.supported = true; delete f.layout.pixelWidth; delete f.layout.pixelHeight;
  assert.equal(f.owner.prepareFrame(), true);
  assert.equal(f.requests[0].input.height, 128);
  f.owner.dispose(); f.requests[0].resolve(null);
});

test("A to B to A reuses one result consumer when the real client merges the active identity", async (t) => {
  for (const kind of ["political", "hit"]) {
    const sent = [];
    const worker = { postMessage: (message) => sent.push(message), terminate() {} };
    const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true });
    const f = fixture({ injectedClient: client });
    t.after(() => f.owner.dispose());
    const request = () => kind === "political" ? f.owner.preparePolitical({ force: true }) : f.owner.requestHit();
    request();
    f.state.zoomTransform.x = 20; request();
    f.state.zoomTransform.x = 0; request();
    await tick();
    assert.equal(sent.length, 1, "client keeps A active while B is queued");
    const bitmap = { closes: 0, close() { this.closes++; } };
    worker.onmessage({ data: { type: "GEOMETRY_RASTER_RESULT", taskId: sent[0].taskId,
      result: { bitmap, renderedCount: 1 } } });
    await tick();
    if (kind === "political") {
      assert.equal(bitmap.closes, 0, "obsolete subscriber must not close the accepted A bitmap");
      assert.equal(f.owner.preparePolitical({ force: true }), null, "exact scheduler can proceed after A becomes ready");
      assert.equal(f.owner.drawPolitical().renderedCount, 1);
    } else {
      assert.equal(f.commits.length, 1);
      assert.equal(bitmap.closes, 1, "hit commit owns and closes its result exactly once");
    }
    const staleBitmap = { closes: 0, close() { this.closes++; } };
    worker.onmessage({ data: { type: "GEOMETRY_RASTER_RESULT", taskId: sent[1].taskId,
      result: { bitmap: staleBitmap, renderedCount: 1 } } });
    await tick();
    assert.equal(staleBitmap.closes, 1, "queued B is now stale");
    f.owner.dispose();
    assert.equal(bitmap.closes, 1);
  }
});
