import assert from "node:assert/strict";
import test from "node:test";
import { createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";
import { getGeometryRetentionWeights } from "../js/core/renderer/geometry_cache_budget.js";

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
function harness(budget) {
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
  }
});
