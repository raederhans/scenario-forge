import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";
import "../js/core/geometry_transfer_codec_shared.js";
import { getGeometryRetentionWeights } from "../js/core/renderer/geometry_cache_budget.js";
import { createGeometryRasterWorkerClient } from "../js/core/geometry_raster_worker_client.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
const point = (x) => ({ type: "Feature", geometry: { type: "Point", coordinates: [x, 0] } });

test("navigation decodes mixed batches, builds SVG Path2D, and fills in entry order with alpha and scaleY", async () => {
  const fills = [], transforms = [], paths = [], contextOptions = [];
  const context = {
    setTransform(...args) { transforms.push(args); }, translate() {}, scale(...args) { transforms.push(args); },
    clearRect() {}, setLineDash() {},
    fill(path) { fills.push({ path, color: this.fillStyle, alpha: this.globalAlpha }); },
  };
  const kernel = createGeometryRasterWorkerKernel({ d3,
    createCanvas: () => ({ getContext: (_kind, options) => { contextOptions.push(options); return context; },
      transferToImageBitmap: () => ({ close() {} }) }),
    createPath: (svg) => { paths.push(svg); return { svg }; }, yieldTask: async () => {},
  });
  const first = [{ id: "a", feature: point(0) }];
  const second = [{ id: "b", feature: point(5) }];
  const packed = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(first, { minCoordinateCount: 0 });
  const result = await kernel.render({ sceneKey: "nav", projectionKey: 1, kind: "navigation",
    projectionOptions: {}, width: 20, height: 10, transform: { x: 0, y: 0, k: 2, scaleY: 3 },
    entries: [{ id: "a", fillColor: "red", alpha: 0.4 }, { id: "b", fillColor: "blue" }],
    geometryTransport: { encoding: "geo-f64-batches-v1", batches: [packed.payload, second] },
  });
  assert.equal(result.renderedCount, 2);
  assert.deepEqual(contextOptions, [{ willReadFrequently: true }]);
  assert.equal(typeof result.navigationTimings.geometryUpdateMs, "number");
  assert.equal(typeof result.navigationTimings.pathBuildMs, "number");
  assert.equal(typeof result.navigationTimings.fillMs, "number");
  assert.equal(typeof result.navigationTimings.yieldWallMs, "number");
  assert.equal(typeof result.navigationTimings.bitmapMs, "number");
  assert.equal(typeof result.navigationTimings.trimMs, "number");
  assert.ok(["a", "b"].includes(result.navigationTimings.maxPathId));
  assert.ok(["a", "b"].includes(result.navigationTimings.maxFillId));
  assert.deepEqual(fills.map(({ color, alpha }) => [color, alpha]), [["red", 0.4], ["blue", 1]]);
  assert.ok(paths.every((svg) => typeof svg === "string" && svg.length > 0));
  assert.ok(transforms.some((args) => args.length === 2 && args[0] === 2 && args[1] === 3));
  await assert.rejects(kernel.render({ sceneKey: "nav", projectionKey: 1, kind: "political",
    width: 20, height: 10, geometryTransport: { encoding: "geo-f64-batches-v1", batches: [] } }),
  /Invalid navigation geometry transport/);
});

test("completed navigation bitmaps unpin geometry before the final budget and eviction acknowledgement", async () => {
  const drawn = [];
  const context = { setTransform() {}, translate() {}, scale() {}, clearRect() {}, setLineDash() {},
    fill(path) { drawn.push([path.svg, this.fillStyle]); } };
  const a = point(0), b = point(5);
  const budget = getGeometryRetentionWeights(a).decoded;
  const kernel = createGeometryRasterWorkerKernel({ d3, geometryCacheBudget: budget,
    createCanvas: () => ({ getContext: () => context, transferToImageBitmap: () => ({ close() {} }) }),
    createPath: (svg) => ({ svg }), yieldTask: async () => {},
  });
  const packet = { kind: "navigation", sceneKey: "scene", projectionKey: 1,
    width: 20, height: 10, entries: [{ id: "a", fillColor: "red" }, { id: "b", fillColor: "blue" }] };
  const first = await kernel.render({ ...packet, geometryUpdates: [{ id: "a", feature: a }, { id: "b", feature: b }] });
  const originalDraws = [...drawn];
  assert.equal(first.renderedCount, 2);
  assert.deepEqual(first.evictedGeometryIds, ["a"]);
  assert.equal(first.cacheBudget.geometry.overBudgetBytes, 0);
  assert.equal(first.cacheBudget.geometry.estimatedBytes, budget);
  assert.equal(first.cacheBudget.paths.entries, 1);
  drawn.length = 0;
  const next = await kernel.render({ ...packet, geometryUpdates: [{ id: "a", feature: a }] });
  assert.equal(next.pathBuildCount, 1, "the acknowledged resident geometry keeps its path");
  assert.deepEqual(drawn, originalDraws, "budget retirement happens after complete ordered drawing");
  assert.deepEqual(next.evictedGeometryIds, ["a"]);
  assert.equal(next.cacheBudget.geometry.overBudgetBytes, 0);
  await assert.rejects(kernel.render(packet), /Missing raster geometry: a/);
});

test("navigation client reuploads exactly the kernel's retired geometry and reuses the resident path", async () => {
  const context = { setTransform() {}, translate() {}, scale() {}, clearRect() {}, setLineDash() {}, fill() {} };
  const a = point(0), b = point(5);
  const results = [], metrics = [];
  const kernel = createGeometryRasterWorkerKernel({ d3, geometryCacheBudget: getGeometryRetentionWeights(a).decoded,
    createCanvas: () => ({ getContext: () => context, transferToImageBitmap: () => ({ close() {} }) }),
    createPath: (svg) => ({ svg }), yieldTask: async () => {},
  });
  const worker = { terminate() {}, postMessage(message) {
    void kernel.render(message.packet).then((result) => {
      results.push(result);
      worker.onmessage({ data: { taskId: message.taskId, result } });
    });
  } };
  const budget = createRuntimeResourceBudget();
  const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true,
    resourceBudget: budget, onMetric: (name, _ms, details) => { if (name === "geometryWorkerRoundTrip") metrics.push(details); } });
  const entries = [{ id: "a", feature: a, fillColor: "red" }, { id: "b", feature: b, fillColor: "blue" }];
  for (let index = 0; index < 3; index++) {
    await client.request({ kind: "navigation", identity: `paint-${index}`, sceneKey: "same-scene",
      projectionKey: 1, width: 20, height: 10, entries });
  }
  assert.deepEqual(metrics.map(({ geometryUploads }) => geometryUploads), [2, 1, 1]);
  assert.deepEqual(results.map(({ pathBuildCount }) => pathBuildCount), [2, 1, 1]);
  assert.ok(results.every(({ cacheBudget }) => cacheBudget.geometry.overBudgetBytes === 0));
  assert.deepEqual(results.map(({ evictedGeometryIds }) => evictedGeometryIds), [["a"], ["a"], ["a"]]);
  client.dispose();
  assert.equal(budget.snapshot().ownerCount, 0);
});

test("navigation retention budgets only narrow constructor caps, accept zero and reject invalid values", async () => {
  const context = { setTransform() {}, translate() {}, scale() {}, clearRect() {}, setLineDash() {}, fill() {} };
  const kernel = createGeometryRasterWorkerKernel({ d3, geometryCacheBudget: 400, pathCacheBudget: 300,
    createCanvas: () => ({ getContext: () => context, transferToImageBitmap: () => ({ close() {} }) }),
    createPath: (svg) => ({ svg }), yieldTask: async () => {},
  });
  const packet = { kind: "navigation", sceneKey: "scene", projectionKey: 1, width: 20, height: 10,
    entries: [{ id: "a", fillColor: "red" }], geometryUpdates: [{ id: "a", feature: point(0) }] };
  const defaultBudget = await kernel.render(packet);
  assert.equal(defaultBudget.cacheBudget.geometry.budgetBytes, 400);
  assert.equal(defaultBudget.cacheBudget.paths.budgetBytes, 300);
  const narrowed = await kernel.render({ ...packet, navigationRetentionBudgetBytes: 600 });
  assert.equal(narrowed.cacheBudget.geometry.budgetBytes, 400);
  assert.equal(narrowed.cacheBudget.paths.budgetBytes, 200);
  assert.ok(narrowed.cacheBudget.geometry.estimatedBytes + narrowed.cacheBudget.paths.estimatedBytes <= 600);
  const expanded = await kernel.render({ ...packet, navigationRetentionBudgetBytes: 10000 });
  assert.equal(expanded.cacheBudget.geometry.budgetBytes, 400);
  assert.equal(expanded.cacheBudget.paths.budgetBytes, 300);
  const zero = await kernel.render({ ...packet, navigationRetentionBudgetBytes: 0 });
  assert.equal(zero.renderedCount, 1);
  assert.equal(zero.cacheBudget.geometry.estimatedBytes, 0);
  assert.equal(zero.cacheBudget.paths.estimatedBytes, 0);
  assert.deepEqual(zero.evictedGeometryIds, ["a"]);
  for (const budget of [-1, Infinity, NaN, 0.5, null, "600", Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(kernel.render({ ...packet, navigationRetentionBudgetBytes: budget }), /Invalid navigation retention budget/);
  const political = await kernel.render({ ...packet, entries: [], kind: "political", navigationRetentionBudgetBytes: Infinity });
  assert.equal(political.cacheBudget.geometry.budgetBytes, 400);
  assert.equal(political.cacheBudget.paths.budgetBytes, 300);
});

test("under navigation pressure geometry behind cached paths survives late water and reduces the next path build", async () => {
  const context = { setTransform() {}, translate() {}, scale() {}, clearRect() {}, setLineDash() {}, fill() {} };
  const a = point(0), b = point(5), water = point(10);
  const kernel = createGeometryRasterWorkerKernel({ d3,
    geometryCacheBudget: getGeometryRetentionWeights(a).decoded * 2,
    pathCacheBudget: getGeometryRetentionWeights(a).path * 2,
    createCanvas: () => ({ getContext: () => context, transferToImageBitmap: () => ({ close() {} }) }),
    createPath: (svg) => ({ svg }), yieldTask: async () => {},
  });
  const packet = { kind: "navigation", sceneKey: "scene", projectionKey: 1, width: 20, height: 10,
    entries: ["a", "b", "water"].map((id) => ({ id, fillColor: "red" })) };
  const first = await kernel.render({ ...packet,
    geometryUpdates: [{ id: "a", feature: a }, { id: "b", feature: b }, { id: "water", feature: water }] });
  assert.deepEqual(first.evictedGeometryIds, ["water"], "cached land geometry wins over later uncached water");
  assert.equal(first.pathBuildCount, 3);
  const second = await kernel.render({ ...packet, geometryUpdates: [{ id: "water", feature: water }] });
  assert.equal(second.pathBuildCount, 1);
  assert.equal(second.cacheBudget.geometry.overBudgetBytes, 0);
  assert.equal(second.cacheBudget.paths.overBudgetBytes, 0);
});
