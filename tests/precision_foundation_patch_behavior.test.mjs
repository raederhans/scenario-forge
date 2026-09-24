import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";
import { planPoliticalRasterPatch } from "../js/core/renderer/political_raster_patch_plan.js";
import { createGeometryRasterRuntimeOwner } from "../js/core/renderer/geometry_raster_runtime_owner.js";

function fixture() {
  const entries = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), feature: { geometry: {} },
    fillColor: "red", strokeColor: "red", lineWidth: 1, geometryIdentity: index,
    bounds: { minX: index % 40 * 10, maxX: index % 40 * 10 + 10,
      minY: Math.floor(index / 40) * 10, maxY: Math.floor(index / 40) * 10 + 10 } }));
  const previous = { patchKey: "stable", entries };
  const current = entries.map((entry, index) => index < 93 ? { ...entry, fillColor: "blue", strokeColor: "blue" } : entry);
  const description = { patchKey: "stable", width: 400, height: 250 };
  return { previous, current, description, bounds: entry => entry.bounds };
}
test("93-feature update admits a bounded patch without raising the synchronous threshold", () => {
  const f = fixture(), plan = planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds);
  assert.equal(plan.changedCount, 93); assert.ok(plan.drawEntryIds.length < 1000);
  assert.ok(plan.coverage <= 0.18); assert.deepEqual(plan.region, { x: 0, y: 0, width: 400, height: 30 });
  assert.ok(plan.drawEntryIds.includes("120"), "unchanged boundary contributors retain painter order");
  assert.deepEqual(plan.drawEntryIds, [...plan.drawEntryIds].sort((a, b) => Number(a) - Number(b)));
});
test("no partial geometry, order, transform, layout or revision reuse", () => {
  for (const change of [
    f => f.description.patchKey = "new-view",
    f => f.current[0] = { ...f.current[0], feature: { geometry: {} } },
    f => f.current[0] = { ...f.current[0], geometryIdentity: 99999 },
    f => f.current.reverse(),
    f => f.current.pop(),
    f => f.current[0] = { ...f.current[0], lineWidth: 2 },
  ]) {
    const f = fixture(); change(f);
    assert.equal(planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds), null);
  }
});
test("unknown bounds, excessive area and transient memory fail back to full rendering", () => {
  const f = fixture();
  assert.equal(planPoliticalRasterPatch(f.previous, f.current, f.description, () => null), null);
  assert.equal(planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds, { maxCoverage: 0.01 }), null);
  assert.equal(planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds, { maxTransientBytes: 1 }), null);
});
test("patch rectangle is clamped and snapped to physical pixels", () => {
  const f = fixture();
  f.current[0] = { ...f.current[0], bounds: { minX: -2.2, minY: -3.1, maxX: 10.2, maxY: 10.1 } };
  const plan = planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds);
  assert.equal(plan.region.x, 0); assert.equal(plan.region.y, 0);
});

function cropHarness(createBitmap) {
  const transforms = [];
  const context = { setTransform: (...args) => transforms.push(["set", ...args]),
    translate: (...args) => transforms.push(["translate", ...args]), scale: (...args) => transforms.push(["scale", ...args]),
    clearRect: (...args) => transforms.push(["clear", ...args]), fill() {}, stroke() {} };
  const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] } };
  const packet = { kind: "political", sceneKey: "fixture", projectionKey: "projection", width: 800, height: 600,
    dpr: 1.5, offsetX: 20, offsetY: 10, transform: { x: 3, y: 4, k: 2.5 },
    geometryUpdates: [{ id: "region", feature }], entries: [{ id: "region", fillColor: "red" }],
    renderRegion: { x: 137, y: 83, width: 160, height: 120 }, drawEntryIds: ["region"], patchBaseIdentity: "accepted" };
  const kernel = createGeometryRasterWorkerKernel({ d3: createRequire(import.meta.url)("../vendor/d3.v7.min.js"),
    createCanvas: (width, height) => ({ width, height, getContext: () => context, transferToImageBitmap: () => ({ close() {} }) }),
    createPath: () => ({ moveTo() {}, lineTo() {}, closePath() {}, arc() {} }), createBitmap, yieldTask: async () => {} });
  return { kernel, packet, transforms };
}

test("worker patch crops the bitmap without changing full-frame raster coordinates", async () => {
  const crops = [], bitmap = { close() {} };
  const { kernel, packet, transforms } = cropHarness(async (canvas, ...rect) => {
    crops.push({ width: canvas.width, height: canvas.height, rect }); return bitmap;
  });
  const result = await kernel.render(packet);
  assert.deepEqual(crops, [{ width: 800, height: 600, rect: [137, 83, 160, 120] }]);
  assert.deepEqual(transforms.slice(-4), [["set", 1.5, 0, 0, 1.5, 0, 0], ["translate", 20, 10], ["translate", 3, 4], ["scale", 2.5, 2.5]]);
  assert.equal(result.bitmap, bitmap); assert.deepEqual(result.renderRegion, packet.renderRegion);
  assert.equal(result.width, 160); assert.equal(result.height, 120); assert.equal(result.patchBaseIdentity, "accepted");
});

test("cancelling an asynchronous patch crop closes its late bitmap", async () => {
  let cancelled = false, closed = false;
  const { kernel, packet } = cropHarness(async () => { cancelled = true; return { close() { closed = true; } }; });
  await assert.rejects(kernel.render(packet, { isCancelled: () => cancelled }), { name: "AbortError" });
  assert.equal(closed, true);
});

test("patch commits a bitmap snapshot and retires full, cropped and composed bitmaps", async () => {
  const features = [{ geometry: {} }, { geometry: {} }];
  const projection = {}, requests = [], paints = [], operations = [];
  const makeBitmap = () => ({ closes: 0, close() { this.closes++; } });
  const full = makeBitmap(), cropped = makeBitmap(), composite = makeBitmap();
  let color = "red";
  const owner = createGeometryRasterRuntimeOwner({
    state: { firstVisibleFramePainted: true, dpr: 1, zoomTransform: { x: 0, y: 0, k: 1 }, landData: { features } },
    client: { available: () => true, dispose() {}, request: async packet => {
      requests.push(packet);
      return packet.renderRegion ? { bitmap: cropped, width: packet.renderRegion.width, height: packet.renderRegion.height,
        renderRegion: packet.renderRegion, patchBaseIdentity: packet.patchBaseIdentity, renderedCount: 1 }
        : { bitmap: full, width: 100, height: 100, renderedCount: 2 };
    } },
    surface: { getProjection: () => projection, getContext: () => ({
      save() {}, restore() {}, setTransform() {}, drawImage: bitmap => paints.push(bitmap),
    }) },
    helpers: { isEnabled: () => true, hasPendingColorEdit: () => false, needsPoliticalRender: () => true,
      getPoliticalLayout: () => ({ pixelWidth: 100, pixelHeight: 100 }),
      getPoliticalSignature: () => color, getPoliticalPatchStaticSignature: () => "static",
      collectPoliticalItems: () => features.map((feature, i) => ({ id: String(i), feature })),
      orderPoliticalItems: items => items, excludeVisual: () => false, skipVisual: () => false,
      resolveFillColor: (_, id) => id === "0" ? color : "gray", resolveStrokeColor: () => null,
      getPoliticalEntryPixelBounds: ({ id }) => id === "0"
        ? { minX: 10, minY: 10, maxX: 20, maxY: 20 } : { minX: 80, minY: 80, maxX: 90, maxY: 90 },
    },
    effects: { recordMetric() {}, requestRender() {} },
    createCanvas: () => ({ getContext: () => ({
      drawImage: (...args) => operations.push(["draw", ...args]),
      clearRect: (...args) => operations.push(["clear", ...args]),
    }), transferToImageBitmap() { operations.push(["snapshot"]); return composite; } }),
  });
  await owner.preparePolitical();
  color = "blue";
  await owner.preparePolitical();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].drawEntryIds, ["0"]);
  assert.deepEqual(operations, [["draw", full, 0, 0], ["clear", 10, 10, 10, 10],
    ["draw", cropped, 10, 10], ["snapshot"]]);
  assert.equal(owner.drawPolitical().renderedCount, 2);
  assert.deepEqual(paints, [composite]);
  assert.equal(full.closes, 1);
  assert.equal(cropped.closes, 1);
  assert.equal(composite.closes, 0);
  owner.dispose();
  assert.equal(composite.closes, 1);
});


test("accepted-frame bounds are indexed once and queried in painter order", () => {
  const f = fixture(); let calls = 0;
  const getter = e => { calls++; return e.bounds; };
  let previous = f.previous;
  for (let iteration = 0; iteration < 6; iteration++) {
    const current = previous.entries.map((e, i) => i < 93 ? { ...e, fillColor: String(iteration) } : e);
    const result = planPoliticalRasterPatch(previous, current, f.description, getter);
    assert.equal(result.changedCount, 93);
    assert.equal(result.boundsIndex.reused, iteration > 0);
    assert.equal(calls, 1000);
    const r = result.region;
    const expected = current.filter(e => e.bounds.maxX >= r.x && e.bounds.minX <= r.x + r.width
      && e.bounds.maxY >= r.y && e.bounds.minY <= r.y + r.height).map(e => e.id);
    assert.deepEqual(result.drawEntryIds, expected);
    assert.ok(result.boundsIndex.visitedBounds < 1000);
    previous = { patchKey: f.description.patchKey, entries: current };
  }
});

test("bounds getter and view changes never reuse the previous index", () => {
  const f = fixture();
  planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds);
  const previous = { patchKey: 'stable', entries: f.current };
  const current = f.current.map((e, i) => i === 0 ? { ...e, fillColor: 'green' } : e);
  let calls = 0;
  const result = planPoliticalRasterPatch(previous, current, f.description, e => { calls++; return e.bounds; });
  assert.equal(calls, 1000); assert.equal(result.boundsIndex.reused, false);
  assert.equal(planPoliticalRasterPatch(previous, current, { ...f.description, patchKey: 'changed' }, f.bounds), null);
});

test("numeric index does not retain borrowed bounds and agrees with naive overlap oracle", () => {
  const f = fixture(); let previous = f.previous;
  for (let iteration = 0; iteration < 40; iteration++) {
    const selected = (iteration * 173) % 1000;
    const current = previous.entries.map((e, i) => i === selected ? { ...e, fillColor: `edit-${iteration}` } : e);
    const result = planPoliticalRasterPatch(previous, current, f.description, f.bounds);
    const r = result.region;
    assert.deepEqual(result.drawEntryIds, current.filter(e => e.bounds.maxX >= r.x && e.bounds.minX <= r.x+r.width
      && e.bounds.maxY >= r.y && e.bounds.minY <= r.y+r.height).map(e => e.id));
    previous = { patchKey: 'stable', entries: current };
  }
});

test("worker clears only the published crop but full frames clear the complete surface", async () => {
  const { kernel, packet, transforms } = cropHarness(async () => ({ close() {} }));
  const result = await kernel.render(packet);
  assert.ok(transforms.some(row => JSON.stringify(row) === JSON.stringify(['clear',137,83,160,120])));
  assert.equal(result.clearedPixelCount, 160*120);
  const full = { ...packet, renderRegion: null, drawEntryIds: null, patchBaseIdentity: null };
  const rendered = await kernel.render(full);
  assert.ok(transforms.some(row => JSON.stringify(row) === JSON.stringify(['clear',0,0,800,600])));
  assert.equal(rendered.clearedPixelCount, 800*600);
});
