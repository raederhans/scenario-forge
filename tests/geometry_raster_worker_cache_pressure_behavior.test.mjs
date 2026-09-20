import assert from "node:assert/strict";
import test from "node:test";
import { createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";
import { getGeometryRetentionWeights } from "../js/core/renderer/geometry_cache_budget.js";

// Exercise the real kernel and weighted cache with a deliberately fake drawing
// boundary. These tests prove admission/order/lifecycle behavior, not D3
// projection correctness or native Path2D pixels. The existing kernel suite
// retains the real-D3 stream and projection checks.
const fakeD3 = {
  geoEqualEarth: () => ({}),
  geoPath: () => {
    let context;
    const draw = (feature) => { context.geometry = structuredClone(feature.geometry || feature); };
    draw.pointRadius = () => draw;
    draw.context = (value) => { context = value; return draw; };
    return draw;
  },
};
const feature = (seed, count = 5) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [
  Array.from({ length: count }, (_, index) => [seed + index, index % 2]),
] } });
const weight = (value) => getGeometryRetentionWeights(value).path;
function harness(budget, overrides = {}) {
  const draws = [];
  const kernel = createGeometryRasterWorkerKernel({
    d3: fakeD3, pathCacheBudget: budget, createPath: () => ({}), now: () => 0,
    yieldTask: async () => {},
    createCanvas: (width, height) => ({ width, height,
      getContext: () => ({
        setTransform() {}, translate() {}, scale() {}, clearRect() {},
        fill(path) { draws.push(["fill", path.geometry, this.fillStyle]); },
        stroke(path) { draws.push(["stroke", path.geometry, this.strokeStyle, this.lineWidth]); },
      }),
      transferToImageBitmap: () => ({ close() {} }),
    }),
    ...overrides,
  });
  return { kernel, draws };
}
function packet(ids, updates = [], extra = {}) {
  return { kind: "political", sceneKey: "precision", projectionKey: 1,
    width: 800, height: 600, geometryUpdates: updates,
    entries: ids.map((id) => ({ id, fillColor: `fill-${id}`, strokeColor: "border", lineWidth: 0.25 })),
    ...extra };
}
const updates = (...ids) => ids.map((id, i) => ({ id, feature: feature(i) }));
function bounded(result) {
  assert.ok(result.cacheBudget.paths.estimatedBytes <= result.cacheBudget.paths.budgetBytes);
  assert.equal(result.cacheBudget.paths.overBudgetBytes, 0);
}

test("cache pressure: repeated same-order frames retain hits without dropping drawing commands", async () => {
  const h = harness(weight(feature(0)) * 2);
  const first = await h.kernel.render(packet(["a", "b", "c"], updates("a", "b", "c")));
  assert.equal(first.pathBuildCount, 3);
  const expected = structuredClone(h.draws);
  for (let frame = 0; frame < 4; frame += 1) {
    h.draws.length = 0;
    const result = await h.kernel.render(packet(["a", "b", "c"]));
    assert.equal(result.pathBuildCount, 1, "only the nonresident path is rebuilt");
    assert.equal(result.cacheBudget.paths.frameAdmissionSkips, 1);
    assert.equal(result.renderedCount, 3);
    assert.deepEqual(h.draws, expected);
    bounded(result);
  }
});

test("cache pressure: new leading misses cannot evict later visible hits", async () => {
  const { kernel } = harness(weight(feature(0)) * 2);
  await kernel.render(packet(["a", "b"], updates("a", "b", "c")));
  const result = await kernel.render(packet(["c", "a", "b"]));
  assert.equal(result.pathBuildCount, 1);
  bounded(result);
});

test("cache pressure: mixed path weights reserve bytes rather than entry count", async () => {
  const a = feature(0), b = feature(20, 20), c = feature(50);
  const { kernel } = harness(weight(a) + weight(b));
  await kernel.render(packet(["a", "b"], [{ id: "a", feature: a }, { id: "b", feature: b }, { id: "c", feature: c }]));
  const result = await kernel.render(packet(["c", "b", "a"]));
  assert.equal(result.pathBuildCount, 1);
  assert.equal(result.cacheBudget.paths.estimatedBytes, weight(a) + weight(b));
  bounded(result);
});

test("cache pressure: duplicate draw entries reserve a resident path only once", async () => {
  const { kernel } = harness(weight(feature(0)) * 2);
  await kernel.render(packet(["a"], updates("a", "b")));
  const result = await kernel.render(packet(["a", "a", "b"]));
  assert.equal(result.pathBuildCount, 1);
  assert.equal(result.cacheBudget.paths.entries, 2);
  assert.equal((await kernel.render(packet(["a", "b"]))).pathBuildCount, 0);
});

test("cache pressure: inactive paths remain reusable until active misses need their capacity", async () => {
  const { kernel } = harness(weight(feature(0)) * 2);
  await kernel.render(packet(["a", "b"], updates("a", "b", "c", "d")));
  const subset = await kernel.render(packet(["a"]));
  assert.equal(subset.cacheBudget.paths.entries, 2, "not a flush-on-every-pan policy");
  const next = await kernel.render(packet(["c", "d"]));
  assert.equal(next.pathBuildCount, 2);
  assert.equal(next.cacheBudget.paths.entries, 2);
  assert.equal((await kernel.render(packet(["c", "d"]))).pathBuildCount, 0);
  bounded(next);
});

test("cache pressure: same-ID geometry replacement invalidates only that path", async () => {
  const h = harness(weight(feature(0)) * 2);
  await h.kernel.render(packet(["a", "b"], updates("a", "b", "c")));
  const replacement = feature(100);
  const result = await h.kernel.render(packet(["c", "a", "b"], [{ id: "a", feature: replacement }]));
  assert.equal(result.pathBuildCount, 2);
  assert.deepEqual(h.draws.at(-4)[1], replacement.geometry);
  assert.equal((await h.kernel.render(packet(["c", "a", "b"]))).pathBuildCount, 1);
  bounded(result);
});

test("cache pressure: oversized paths stay transient and preserve the existing oversize metric", async () => {
  const { kernel } = harness(weight(feature(0)));
  const small = feature(0), large = feature(50, 100);
  await kernel.render(packet(["small"], [{ id: "small", feature: small }, { id: "large", feature: large }]));
  const result = await kernel.render(packet(["large", "small"]));
  assert.equal(result.pathBuildCount, 1);
  assert.equal(result.cacheBudget.paths.oversizedSkips, 1);
  assert.equal(result.cacheBudget.paths.entries, 1);
  assert.equal((await kernel.render(packet(["small"]))).pathBuildCount, 0);
  bounded(result);
});

test("cache pressure: political and hit passes reuse paths but preserve fill/stroke behavior", async () => {
  const h = harness(weight(feature(0)) * 2);
  await h.kernel.render(packet(["a", "b", "c"], updates("a", "b", "c")));
  h.draws.length = 0;
  const result = await h.kernel.render(packet(["c", "a", "b"], [], { kind: "hit", dpr: 2, transform: { x: 10, y: 20, k: 4 } }));
  assert.equal(result.pathBuildCount, 1);
  assert.equal(h.draws.length, 3);
  assert.ok(h.draws.every(([kind]) => kind === "fill"));
});

test("cache pressure: scene, projection and explicit resets still invalidate paths", async () => {
  const { kernel } = harness(weight(feature(0)) * 2);
  await kernel.render(packet(["a", "b"], updates("a", "b")));
  assert.equal((await kernel.render(packet(["a", "b"], [], { projectionKey: 2 }))).pathBuildCount, 2);
  assert.equal((await kernel.render(packet(["a", "b"], updates("a", "b"), { resetGeometry: true }))).pathBuildCount, 2);
  await assert.rejects(kernel.render(packet(["a"], [], { sceneKey: "different" })), /Missing raster geometry/);
});

test("cache pressure: geometry eviction acknowledgement and re-upload remain intact", async () => {
  const { kernel } = harness(weight(feature(0)), { geometryCacheBudget: 1 });
  const pinned = await kernel.render(packet(["a", "b"], updates("a", "b")));
  assert.ok(pinned.cacheBudget.geometry.overBudgetBytes > 0);
  const retired = await kernel.render(packet([]));
  assert.deepEqual(new Set(retired.evictedGeometryIds), new Set(["a", "b"]));
  assert.equal(retired.cacheBudget.paths.entries, 0);
  await assert.rejects(kernel.render(packet(["a"])), /Missing raster geometry/);
  assert.equal((await kernel.render(packet(["a"], updates("a")))).pathBuildCount, 1);
});

test("cache pressure: real lossless transport remains compatible with admission", async () => {
  const h = harness(weight(feature(0)) * 2);
  const source = updates("a", "b", "c");
  const original = structuredClone(source);
  const encoded = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(source, { minCoordinateCount: 0 });
  await h.kernel.render(packet(["a", "b", "c"], [], {
    geometryTransport: structuredClone(encoded.payload, { transfer: encoded.transferables }),
  }));
  assert.deepEqual(source, original);
  assert.equal((await h.kernel.render(packet(["c", "b", "a"]))).pathBuildCount, 1);
});

test("cache pressure: cancellation cannot leak a frame reservation into later views", async () => {
  let cancelled = false, yields = 0;
  const { kernel } = harness(weight(feature(0)) * 2, {
    batchSize: 1, sliceBudgetMs: 0,
    yieldTask: async () => { if (++yields === 2) cancelled = true; },
  });
  await assert.rejects(kernel.render(packet(["a", "b", "c"], updates("a", "b", "c")), {
    isCancelled: () => cancelled,
  }), { name: "AbortError" });
  cancelled = false;
  const resumed = await kernel.render(packet(["b", "c"]));
  assert.equal(resumed.renderedCount, 2);
  bounded(resumed);
  assert.equal((await kernel.render(packet(["b", "c"]))).pathBuildCount, 0);
});

test("cache pressure: changing views and replacements match an uncached drawing oracle", async () => {
  const cached = harness(weight(feature(0)) * 3), uncached = harness(0);
  const ids = Array.from({ length: 12 }, (_, i) => `id-${i}`);
  const initial = updates(...ids);
  await cached.kernel.render(packet([], initial));
  await uncached.kernel.render(packet([], initial));
  for (let frame = 0; frame < 40; frame += 1) {
    const visible = Array.from({ length: 2 + frame % 7 }, (_, i) => ids[(frame * 5 + i * 7) % ids.length]);
    const changed = frame % 3 ? [] : [{ id: visible[0], feature: feature(frame * 100, 5 + frame % 13) }];
    const options = { kind: frame % 2 ? "hit" : "political", projectionKey: Math.floor(frame / 11) };
    cached.draws.length = 0;
    uncached.draws.length = 0;
    const result = await cached.kernel.render(packet(visible, changed, options));
    await uncached.kernel.render(packet(visible, changed, options));
    assert.deepEqual(cached.draws, uncached.draws, `frame ${frame}`);
    assert.equal(result.renderedCount, visible.length);
    bounded(result);
  }
});
