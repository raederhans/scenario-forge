import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";
import { planPoliticalRasterPatch } from "../js/core/renderer/political_raster_patch_plan.js";

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
test("patch includes all intersecting features in painter order", () => {
  const f = fixture();
  const result = planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds);
  const r = result.region;
  const expected = f.current.filter(e => e.bounds.maxX >= r.x && e.bounds.minX <= r.x + r.width
    && e.bounds.maxY >= r.y && e.bounds.minY <= r.y + r.height).map(e => e.id);
  assert.deepEqual(result.drawEntryIds, expected);
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
