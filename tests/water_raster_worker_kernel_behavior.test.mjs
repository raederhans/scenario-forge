import test from "node:test";
import assert from "node:assert/strict";
import { createWaterRasterWorkerKernel } from "../js/core/renderer/water_raster_worker_kernel.js";
import { packWaterGeometry } from "../js/core/renderer/water_geometry_transport.js";
import { GeometryBudgetMap } from "../js/core/renderer/geometry_cache_budget.js";

function harness(options = {}) {
  const canvases = [], paths = [];
  const createPath = () => {
    const path = { commands: [], moveTo(...p) { this.commands.push(["move", ...p]); },
      lineTo(...p) { this.commands.push(["line", ...p]); }, closePath() { this.commands.push(["close"]); },
      arc(...p) { this.commands.push(["arc", ...p]); }, addPath(p) { this.commands.push(...p.commands); } };
    paths.push(path); return path;
  };
  const createCanvas = (width, height) => {
    const canvas = { width, height, transferToImageBitmap() { return { width, height, close() {} }; } };
    const context = { canvas, globalAlpha: 1, operations: [], setTransform() {}, clearRect() {},
      save() {}, restore() {}, setLineDash() {}, fill(path) { this.operations.push(["fill", path]); },
      stroke(path) { this.operations.push(["stroke", path]); },
      drawImage() { this.operations.push(["image", this.globalAlpha]); } };
    canvas.getContext = () => context; canvases.push(canvas); return canvas;
  };
  const kernel = createWaterRasterWorkerKernel({ d3: { geoEqualEarth: () => ({ stream: sink => sink }) },
    createCanvas, createPath, yieldTask: async () => {}, ...options });
  return { kernel, canvases, paths };
}
const polygon = { type: "Polygon", coordinates: [
  [[0, 0], [0, 10], [10, 0], [0, 0]], [[1, 1], [2, 1], [1, 2], [1, 1]],
] };
async function upload(kernel) {
  const packed = await packWaterGeometry([{ id: "water", feature: { type: "GeometryCollection", geometries: [polygon, polygon] } }]);
  kernel.sync({ geometryNamespace: "scene", updates: packed.payload, versions: [["water", 1]], requiredIds: ["water"] });
}
const packet = { geometryNamespace: "scene", identity: "candidate", revision: 1,
  projectionOptions: { factory: "geoEqualEarth" }, layout: { pixelWidth: 10, pixelHeight: 10, dpr: 2 },
  transform: { x: 1, y: 2, k: 3 }, entries: [{ id: "water", geometryVersion: 1, opacity: 0.4, fillColor: "#123456" }] };

test("marine parts retain holes and apply feature alpha only at union composite", async () => {
  const { kernel, canvases, paths } = harness();
  await upload(kernel);
  const result = await kernel.render(packet);
  assert.equal(result.identity, "candidate");
  assert.equal(result.renderedCount, 1);
  assert.deepEqual(canvases[0].getContext().operations, [["image", 0.4]]);
  assert.equal(canvases[1].getContext().operations.filter(item => item[0] === "fill").length, 2);
  assert.equal(paths[0].commands.filter(item => item[0] === "close").length, 2);
  assert.ok(result.stats.pathBytes > 0);
  kernel.dispose();
});

test("lake fill and outline composite retain separate alpha", async () => {
  const { kernel, canvases } = harness();
  await upload(kernel);
  await kernel.render({ ...packet, entries: [{ ...packet.entries[0], lake: {
    featureIdentity: { properties: { id: "lake_baikal", water_type: "lake" } },
    outlineEnabled: true, outlineColor: "#123456", outlineWidth: 2, outlineOpacity: 0.5,
  } }] });
  assert.deepEqual(canvases[0].getContext().operations, [["image", 0.4], ["image", 0.2]]);
  kernel.dispose();
});

test("budget rejection produces no partial candidate surface", async () => {
  const { kernel, canvases } = harness();
  await upload(kernel);
  await assert.rejects(kernel.render({ ...packet, layout: { ...packet.layout, pixelWidth: 10000, pixelHeight: 10000 } }), /budget/);
  assert.equal(canvases.length, 0);
  kernel.dispose();
});

test("zero-width lake outlines cannot leave a retained Canvas stroke outside dirty bounds", async () => {
  const { kernel, canvases } = harness();
  await upload(kernel);
  await kernel.render({ ...packet, transform: { x: 0, y: 0, k: 10 }, entries: [{ ...packet.entries[0], lake: {
    featureIdentity: { properties: { id: "lake_baikal", water_type: "lake" } },
    outlineEnabled: true, outlineColor: "#123456", outlineWidth: 0, outlineOpacity: 0.5,
  } }] });
  assert.equal(canvases[1].getContext().operations.some(item => item[0] === "stroke"), false);
  assert.deepEqual(canvases[0].getContext().operations, [["image", 0.4]]);
  kernel.dispose();
});

test("small water features composite only their padded pixel bounds", async () => {
  const { kernel } = harness();
  await upload(kernel);
  const result = await kernel.render({ ...packet, layout: { ...packet.layout, pixelWidth: 1000, pixelHeight: 1000 } });
  assert.equal(result.renderedCount, 1);
  assert.ok(result.stats.compositePixels > 0 && result.stats.compositePixels < 10000);
  assert.ok(result.stats.geometryBytes + result.stats.pathBytes <= 96 * 1024 * 1024);
  kernel.dispose();
});

test("reusing the scratch surface clears painted bounds without a full-surface clear per lake", async () => {
  const { kernel } = harness();
  await upload(kernel);
  const result = await kernel.render({ ...packet,
    layout: { ...packet.layout, pixelWidth: 1000, pixelHeight: 1000 },
    entries: Array.from({ length: 40 }, () => ({ ...packet.entries[0] })),
  });
  assert.equal(result.renderedCount, 40);
  assert.ok(result.stats.clearedPixels < 1_500_000, "one complete candidate clear plus bounded scratch cleanup");
  assert.ok(result.stats.clearedPixels >= 1_000_000);
  kernel.dispose();
});

test("geometry additions keep previous immutable version paths within the same scene", async () => {
  const { kernel, paths } = harness();
  await upload(kernel);
  await kernel.render(packet);
  const before = paths.length;
  const extra = await packWaterGeometry([{ id: "fine", feature: polygon }]);
  kernel.sync({ geometryNamespace: "scene", updates: extra.payload, versions: [["fine", 2]], requiredIds: ["fine"] });
  await kernel.render({ ...packet, entries: [{ ...packet.entries[0], id: "fine", geometryVersion: 2 }] });
  const afterFine = paths.length;
  assert.ok(afterFine > before);
  await kernel.render(packet);
  assert.equal(paths.length, afterFine, "returning to the resident coarse version must reuse native paths");
  kernel.dispose();
});

test("exact replacement aliases reuse projected holes while retaining strict frame versions", async () => {
  const { kernel, paths, canvases } = harness();
  const uploadAlias = async (id, version, parts = [polygon, polygon]) => {
    const packed = await packWaterGeometry([{ id, feature: { type: "GeometryCollection", geometries: parts } }]);
    return kernel.sync({ geometryNamespace: "scene", updates: packed.payload, versions: [[id, version]],
      sourceIds: [[id, "stable-water"]], requiredIds: [id] });
  };
  await uploadAlias("old", 1);
  const oldPacket = { ...packet, entries: [{ ...packet.entries[0], id: "old" }] };
  const first = await kernel.render(oldPacket);
  const originalPaths = paths.slice();
  const replacement = await uploadAlias("new", 2, structuredClone([polygon, polygon]));
  assert.equal(replacement.uniqueGeometryRecords, 1);
  const newPacket = { ...packet, entries: [{ ...packet.entries[0], id: "new", geometryVersion: 2 }] };
  const second = await kernel.render(newPacket);
  assert.equal(second.stats.pathBuildCount, 0);
  assert.equal(second.stats.boundsMissCount, 0);
  assert.equal(second.stats.pathEvictions, 0);
  assert.equal(second.stats.canonicalReuses, 1);
  assert.equal(second.stats.pathBytes, first.stats.pathBytes);
  assert.deepEqual(paths, originalPaths);
  assert.deepEqual(canvases.at(-2).getContext().operations, [["image", 0.4]]);
  assert.ok(originalPaths.every(path => path.commands.filter(command => command[0] === "close").length === 2));
  assert.equal((await kernel.render(oldPacket)).stats.pathBuildCount, 0, "returning to the old alias uses the same token");
  await assert.rejects(kernel.render({ ...newPacket, entries: [{ ...newPacket.entries[0], geometryVersion: 1 }] }), /stale/);
  const changed = structuredClone(polygon); changed.coordinates[1][0][0] = 1.5;
  await uploadAlias("changed", 3, [changed, polygon]);
  const changedPacket = { ...packet, entries: [{ ...packet.entries[0], id: "changed", geometryVersion: 3 }] };
  assert.equal((await kernel.render(changedPacket)).stats.pathBuildCount, 2, "real geometry changes cannot borrow the old paths");
  assert.equal((await kernel.render({ ...changedPacket,
    projectionOptions: { ...packet.projectionOptions, pointRadius: 6 } })).stats.pathBuildCount, 2,
  "point radius changes invalidate projected paths");
  kernel.dispose();
});

test("current content tokens reserve alias hits before a leading miss under a tight budget", async () => {
  const { kernel } = harness({ geometryBudgetBytes: 2048, pathBudgetBytes: 1116 });
  const ids = ["a", "b", "c"];
  const packed = await packWaterGeometry(ids.map(id => ({ id, feature: polygon })));
  kernel.sync({ geometryNamespace: "scene", updates: packed.payload, versions: ids.map(id => [id, 1]), requiredIds: ids });
  const entry = (id, geometryVersion = 1) => ({ ...packet.entries[0], id, geometryVersion });
  await kernel.render({ ...packet, entries: [entry("b"), entry("c")] });
  const next = await packWaterGeometry([{ id: "b2", feature: structuredClone(polygon) }]);
  kernel.sync({ geometryNamespace: "scene", updates: next.payload, versions: [["b2", 2]],
    requiredIds: ["a", "b2", "c"], sourceIds: [["b2", "b"]] });
  const result = await kernel.render({ ...packet, entries: [entry("a"), entry("b2", 2), entry("c")] });
  assert.equal(result.stats.pathBuildCount, 1, "both later content-token hits survive the first miss");
  assert.equal(result.stats.pathAdmissionSkips, 1);
  assert.equal(result.stats.pathEvictions, 0);
  assert.equal(result.stats.uniqueGeometryRecords, 3);
  assert.ok(result.stats.geometryBytes + result.stats.pathBytes <= 3164);
  kernel.dispose();
});

test("oversized parts project once per stripe and reuse the result for bounds and drawing", async () => {
  let clock = 0;
  const { kernel, paths } = harness({ geometryBudgetBytes: 1024, pathBudgetBytes: 0, now: () => ++clock });
  await upload(kernel);
  for (let repeat = 0; repeat < 2; repeat++) {
    const before = paths.length;
    const result = await kernel.render(packet);
    assert.equal(result.renderedCount, 1);
    assert.equal(paths.length - before, 2);
    assert.equal(result.stats.pathBuildCount, 2);
    assert.equal(result.stats.oversizedPathSkips, 2);
    assert.equal(result.stats.boundsMissCount, repeat ? 0 : 2);
    assert.equal(result.stats.pathBytes, 0);
    assert.ok(result.stats.geometryBytes + result.stats.pathBytes <= 1024);
    assert.match(result.stats.maxWorkPart, /^water:\d+:0$/);
    assert.ok(result.stats.maxWorkPart.length < 200);
  }
  kernel.dispose();
});

test("multiple stripes keep bounded transient paths and preserve holes and feature union alpha", async () => {
  const layout = { ...packet.layout, pixelWidth: 20, pixelHeight: 10 };
  for (const oversized of [false, true]) {
    const { kernel, paths, canvases } = harness({ surfaceBudgetBytes: 1000,
      ...(oversized ? { geometryBudgetBytes: 1024, pathBudgetBytes: 0 } : {}) });
    await upload(kernel);
    const result = await kernel.render({ ...packet, layout });
    assert.equal(result.renderedCount, 1);
    assert.equal(result.stats.pathBuildCount, oversized ? 8 : 2);
    assert.equal(paths.length, oversized ? 8 : 2);
    assert.equal(result.stats.boundsMissCount, 2);
    assert.equal(result.stats.oversizedPathSkips, oversized ? 8 : 0);
    assert.deepEqual(canvases[0].getContext().operations, Array.from({ length: 4 }, () => ["image", 0.4]));
    for (const path of paths) assert.equal(path.commands.filter(command => command[0] === "close").length, 2);
    assert.ok(result.stats.surfaceBytes <= 1000);
    assert.ok(result.stats.geometryBytes + result.stats.pathBytes <= (oversized ? 1024 : 96 * 1024 * 1024));
    kernel.dispose();
  }
});

test("a leading miss cannot evict later frame hits and repeat the same-order LRU churn", async () => {
  // Include the three aliases' 228-byte charge without changing path capacity.
  const { kernel, canvases } = harness({ geometryBudgetBytes: 2048, pathBudgetBytes: 1028 });
  const ids = ["a", "b", "c"];
  const packed = await packWaterGeometry(ids.map(id => ({ id, feature: polygon })));
  kernel.sync({ geometryNamespace: "scene", updates: packed.payload, versions: ids.map(id => [id, 1]), requiredIds: ids });
  const entries = ids.map(id => ({ ...packet.entries[0], id }));
  const warm = await kernel.render({ ...packet, entries: entries.slice(1) });
  assert.equal(warm.stats.pathBuildCount, 2);
  for (let repeat = 0; repeat < 3; repeat++) {
    const result = await kernel.render({ ...packet, entries });
    assert.equal(result.stats.pathBuildCount, 1);
    assert.equal(result.stats.pathAdmissionSkips, 1);
    assert.equal(result.stats.pathEvictions, 0);
    assert.equal(result.renderedCount, 3);
    assert.deepEqual(canvases.at(-2).getContext().operations, Array.from({ length: 3 }, () => ["image", 0.4]));
    assert.ok(result.stats.geometryBytes + result.stats.pathBytes <= 3076);
  }
  const changedFrame = await kernel.render({ ...packet, entries: entries.slice(0, 1) });
  assert.equal(changedFrame.stats.pathBuildCount, 1);
  assert.equal(changedFrame.stats.pathAdmissionSkips, 0);
  assert.equal(changedFrame.stats.pathEvictions, 1, "inactive old paths may leave to admit the new working set");
  assert.equal((await kernel.render({ ...packet, entries: entries.slice(0, 1) })).stats.pathBuildCount, 0);
  kernel.dispose();
});

test("bounds-cache churn cannot shrink path allowance or rebuild retained paths", async () => {
  const { kernel } = harness({ geometryBudgetBytes: 2048, pathBudgetBytes: 800 });
  const packed = await packWaterGeometry([{ id: "water", feature: {
    type: "GeometryCollection", geometries: Array.from({ length: 5 }, () => polygon),
  } }]);
  kernel.sync({ geometryNamespace: "scene", updates: packed.payload, versions: [["water", 1]], requiredIds: ["water"] });
  const first = await kernel.render(packet);
  assert.equal(first.stats.pathBuildCount, 5);
  assert.equal(first.stats.pathAdmissionSkips, 3);
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await kernel.render(packet);
    assert.equal(result.stats.pathBuildCount, 3);
    assert.ok(result.stats.boundsMissCount > 0);
    assert.equal(result.stats.pathBytes, first.stats.pathBytes);
    assert.equal(result.stats.pathEvictions, 0);
    assert.ok(result.stats.geometryBytes + result.stats.pathBytes <= 2848);
  }
  kernel.dispose();
});

test("multiple admitted misses scan the hot prefix only during frame preparation", async () => {
  // Unique geometry plus seven explicitly charged aliases must fit admission.
  const { kernel } = harness({ geometryBudgetBytes: 5000, pathBudgetBytes: 2200 });
  const ids = ["hot-a", "hot-b", "hot-c", "old-a", "old-b", "new-a", "new-b"];
  const packed = await packWaterGeometry(ids.map(id => ({ id, feature: polygon })));
  kernel.sync({ geometryNamespace: "scene", updates: packed.payload, versions: ids.map(id => [id, 1]), requiredIds: ids });
  const entry = id => ({ ...packet.entries[0], id });
  await kernel.render({ ...packet, entries: ids.slice(0, 5).map(entry) });
  let visits = 0;
  const iterate = GeometryBudgetMap.prototype[Symbol.iterator];
  GeometryBudgetMap.prototype[Symbol.iterator] = function* () {
    for (const pair of iterate.call(this)) { visits++; yield pair; }
  };
  try {
    const result = await kernel.render({ ...packet,
      entries: [...ids.slice(5), ...ids.slice(0, 3)].map(entry) });
    assert.equal(result.stats.pathBuildCount, 2);
    assert.equal(result.stats.pathEvictions, 2);
    assert.equal(result.stats.pathAdmissionSkips, 0);
    assert.equal(visits, 10, "five cached paths visited once for budget trim and once for reservation");
    assert.ok(result.stats.geometryBytes + result.stats.pathBytes <= 7200);
  } finally {
    GeometryBudgetMap.prototype[Symbol.iterator] = iterate;
    kernel.dispose();
  }
});
