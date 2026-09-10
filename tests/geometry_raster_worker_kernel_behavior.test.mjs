import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createGeometryRasterProjection, createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
class RecordedPath {
  commands = [];
  moveTo(...args) { this.commands.push(["moveTo", ...args]); }
  lineTo(...args) { this.commands.push(["lineTo", ...args]); }
  closePath(...args) { this.commands.push(["closePath", ...args]); }
  arc(...args) { this.commands.push(["arc", ...args]); }
}
function harness(overrides = {}) {
  const draws = [], transforms = [], bitmaps = [];
  const kernel = createGeometryRasterWorkerKernel({
    d3, createPath: () => new RecordedPath(), yieldTask: async () => {},
    createCanvas: () => ({
      getContext: () => ({
        setTransform: (...args) => transforms.push(["setTransform", ...args]),
        translate: (...args) => transforms.push(["translate", ...args]),
        scale: (...args) => transforms.push(["scale", ...args]),
        clearRect() {},
        fill(...args) { draws.push({ kind: "fill", args, color: this.fillStyle }); },
        stroke(...args) { draws.push({ kind: "stroke", args, color: this.strokeStyle, width: this.lineWidth }); },
      }),
      transferToImageBitmap: () => {
        const bitmap = { closed: false, close() { this.closed = true; } };
        bitmaps.push(bitmap);
        return bitmap;
      },
    }), ...overrides,
  });
  return { kernel, draws, transforms, bitmaps };
}
const feature = { type: "Feature", geometry: { type: "GeometryCollection", geometries: [
  { type: "Polygon", coordinates: [[[170, 65], [-170, 65], [-175, 85], [170, 65]]] },
  { type: "Polygon", coordinates: [[[0, 0], [0, 40], [40, 40], [40, 0], [0, 0]], [[10, 10], [20, 10], [20, 20], [10, 10]]] },
  { type: "MultiPolygon", coordinates: [[[[50, 0], [50, 20], [60, 0], [50, 0]]]] },
  { type: "Point", coordinates: [12, 12] },
] } };
function packet(extra = {}) {
  return { sceneKey: "tno", projectionKey: 1, projectionOptions: {}, kind: "political",
    geometryUpdates: [{ id: "region", feature }], entries: [{ id: "region", fillColor: "#123456", strokeColor: "#654321", lineWidth: 0.3 }],
    width: 800, height: 600, dpr: 2, transform: { x: 3, y: 4, k: 2.5 }, offsetX: 20, offsetY: 10, ...extra };
}
test("real D3 stream preserves clipping, resampling, holes, multipolygons and point radius", async () => {
  const options = { factory: "geoEqualEarth", scale: 180, translate: [200, 150], center: [2, 3], rotate: [5, 6, 7], angle: 8,
    reflectX: true, reflectY: false, precision: 0.1, clipAngle: 170, clipExtent: [[0, 0], [800, 600]], pointRadius: 2 };
  const { kernel, draws, transforms } = harness();
  const result = await kernel.render(packet({ projectionOptions: options }));
  const expected = new RecordedPath();
  const projection = d3.geoEqualEarth();
  for (const [key, value] of Object.entries(options)) if (key !== "factory" && key !== "pointRadius") projection[key](value);
  d3.geoPath(projection, expected).pointRadius(2)(feature);
  assert.deepEqual(draws[0].args[0].commands, expected.commands);
  assert.ok(expected.commands.length > 20);
  assert.equal(draws[0].args.length, 1, "default nonzero fill rule");
  assert.equal(draws[1].width, 0.3);
  assert.deepEqual(transforms.slice(-4), [["setTransform", 2, 0, 0, 2, 0, 0], ["translate", 20, 10], ["translate", 3, 4], ["scale", 2.5, 2.5]]);
  assert.equal(result.pathBuildCount, 1);
});
test("camera, DPR, color and hit reuse geometry; replacement, projection and scene invalidate", async () => {
  const { kernel, draws } = harness();
  await kernel.render(packet());
  const hit = await kernel.render(packet({ kind: "hit", geometryUpdates: [], dpr: 1, transform: { x: 40, y: 0, k: 1 } }));
  assert.equal(hit.pathBuildCount, 0);
  assert.equal(draws.at(-1).kind, "fill");
  assert.equal(draws.length, 3, "hit never strokes even if style contains a stroke");
  assert.equal((await kernel.render(packet())).pathBuildCount, 1, "explicit same-ID update replaces geometry");
  assert.equal((await kernel.render(packet({ projectionKey: 2, geometryUpdates: [] }))).pathBuildCount, 1);
  await assert.rejects(kernel.render(packet({ sceneKey: "hoi4", geometryUpdates: [] })), /Missing raster geometry/);
  assert.equal((await kernel.render(packet({ sceneKey: "hoi4" }))).pathBuildCount, 1);
});
test("unsupported projection fields reject; default point radius is two", async () => {
  assert.throws(() => createGeometryRasterProjection(d3, { preclip: "custom" }), /Unsupported projection field/);
  assert.throws(() => createGeometryRasterProjection(d3, { factory: "mercator" }), /Unsupported projection factory/);
  const { kernel, draws } = harness();
  await kernel.render(packet({ geometryUpdates: [{ id: "region", feature: { type: "Point", coordinates: [0, 0] } }] }));
  assert.equal(draws[0].args[0].commands.find(([name]) => name === "arc")[3], 2);
});
test("batch cancellation stops rendering without producing a bitmap", async () => {
  let cancelled = false, yields = 0;
  const { kernel, draws, bitmaps } = harness({ batchSize: 1, sliceBudgetMs: 0, yieldTask: async () => { if (++yields === 2) cancelled = true; } });
  await assert.rejects(kernel.render(packet({ entries: [packet().entries[0], packet().entries[0]] }), { isCancelled: () => cancelled }), { name: "AbortError" });
  assert.equal(draws.length, 2, "only first political feature completed");
  assert.equal(bitmaps.length, 0);
});

test("cheap cached batches avoid timer delays while expensive work still yields", async () => {
  let clock = 0, yields = 0;
  const { kernel } = harness({ batchSize: 1, now: () => clock,
    yieldTask: async () => { yields += 1; },
    createPath: () => { clock += 10; return new RecordedPath(); } });
  const entries = [packet().entries[0], packet().entries[0]];
  assert.equal((await kernel.render(packet({ entries }))).yieldCount, 1);
  assert.equal((await kernel.render(packet({ entries, geometryUpdates: [] }))).yieldCount, 0);
  assert.equal(yields, 1);
});

test("each raster kind retains one surface, resizes only on changes, and resets drawing state", async () => {
  const surfaces = [];
  const { kernel } = harness({ createCanvas: (initialWidth, initialHeight) => {
    let width = initialWidth, height = initialHeight;
    const resized = [], clears = [];
    const context = { setTransform() {}, translate() {}, scale() {}, fill() {}, stroke() {},
      clearRect: (...args) => clears.push(args), setLineDash(value) { this.dash = value; } };
    const canvas = {
      get width() { return width; }, set width(value) { width = value; resized.push(["width", value]); },
      get height() { return height; }, set height(value) { height = value; resized.push(["height", value]); },
      getContext: () => context, transferToImageBitmap: () => ({ close() {} }),
    };
    surfaces.push({ canvas, context, resized, clears }); return canvas;
  } });
  await kernel.render(packet());
  const first = surfaces[0];
  Object.assign(first.context, { globalAlpha: 0.2, globalCompositeOperation: "multiply", filter: "blur(5px)",
    shadowBlur: 12, shadowOffsetX: 8, shadowOffsetY: 4, lineDashOffset: 9, dash: [3, 2] });
  const reused = await kernel.render(packet({ geometryUpdates: [] }));
  assert.equal(reused.pathBuildCount, 0);
  assert.equal(surfaces.length, 1); assert.deepEqual(first.resized, []);
  assert.equal(first.context.globalAlpha, 1); assert.equal(first.context.globalCompositeOperation, "source-over");
  assert.equal(first.context.filter, "none"); assert.equal(first.context.shadowBlur, 0);
  assert.equal(first.context.shadowOffsetX, 0); assert.equal(first.context.shadowOffsetY, 0);
  assert.deepEqual(first.context.dash, []); assert.equal(first.context.lineDashOffset, 0);
  await kernel.render(packet({ width: 1000, geometryUpdates: [] }));
  assert.deepEqual(first.resized, [["width", 1000]]);
  assert.deepEqual(first.clears.at(-1), [0, 0, 1000, 600]);
  await kernel.render(packet({ kind: "hit", geometryUpdates: [] }));
  assert.equal(surfaces.length, 2);
  await kernel.render(packet({ sceneKey: "modern", width: 1000 }));
  assert.equal(surfaces.length, 2, "scene changes retain a bounded pair of surfaces");
  await assert.rejects(kernel.render(packet({ width: -1 })), /Invalid raster/);
  assert.equal(surfaces.length, 2);
});

test("entry reads packet envelope, serializes tasks and closes cancelled late results", async () => {
  const replies = [], starts = [], completions = [];
  const scope = {
    self: { postMessage: (...args) => replies.push(args) },
    createGeometryRasterWorkerKernel: () => ({ render: (packet) => {
      starts.push(packet);
      return new Promise((resolve) => completions.push(resolve));
    } }),
  };
  const source = fs.readFileSync(new URL("../js/workers/geometry_raster.worker.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(source, scope);
  const send = (data) => scope.self.onmessage({ data });
  send({ type: "RENDER_GEOMETRY", taskId: "old", packet: { kind: "hit" } });
  send({ type: "RENDER_GEOMETRY", taskId: "new", packet: { kind: "political" } });
  await new Promise(setImmediate);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].kind, "hit");
  send({ type: "CANCEL_TASK", taskId: "old" });
  const oldBitmap = { closed: false, close() { this.closed = true; } };
  completions[0]({ bitmap: oldBitmap });
  await new Promise(setImmediate);
  assert.equal(oldBitmap.closed, true);
  assert.equal(replies.length, 0);
  assert.equal(starts[1].kind, "political");
  const bitmap = { close() {} };
  completions[1]({ bitmap, kind: "political" });
  await new Promise(setImmediate);
  assert.equal(replies[0][0].taskId, "new");
  assert.equal(replies[0][0].type, "GEOMETRY_RASTER_RESULT");
  assert.equal(replies[0][0].result.bitmap, bitmap);
  assert.equal(replies[0][1][0], bitmap);
});
