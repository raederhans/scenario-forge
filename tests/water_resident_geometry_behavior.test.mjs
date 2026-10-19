import test from "node:test";
import assert from "node:assert/strict";
import { createWaterResidentGeometry } from "../js/core/renderer/water_resident_geometry.js";
import { packWaterGeometry } from "../js/core/renderer/water_geometry_transport.js";

const polygon = { type: "Polygon", coordinates: [
  [[0, 0], [0, 10], [10, 0], [0, 0]], [[1, 1], [2, 1], [1, 2], [1, 1]],
] };
async function update(id, version, feature = polygon, sourceId = "water", geometryNamespace = "scene") {
  const packed = await packWaterGeometry([{ id, feature }]);
  return { geometryNamespace, updates: packed.payload, versions: [[id, version]], requiredIds: [id],
    sourceIds: [[id, sourceId]] };
}

test("equal version aliases share one packed record and return to either strict version", async () => {
  const registry = createWaterResidentGeometry(10000);
  const first = registry.sync(await update("old", 1));
  const old = registry.getRecord("scene", "old", 1);
  const next = registry.sync(await update("new", 2, structuredClone(polygon)));
  assert.equal(registry.getRecord("scene", "new", 2), old);
  assert.equal(registry.get("scene", "old", 1), registry.get("scene", "new", 2));
  assert.equal(next.uniqueGeometryRecords, 1);
  assert.equal(next.geometryAliases, 2);
  assert.equal(next.canonicalReuses, 1);
  assert.ok(next.residentGeometryBytes - first.residentGeometryBytes < old.feature.weights.decoded,
    "only alias metadata, not a duplicate coordinate buffer, is charged");
  assert.throws(() => registry.get("scene", "new", 1), /stale/);
  assert.throws(() => registry.get("other", "new", 2), /stale/);
});

test("source identity, holes, ring order, dimensions, structure and Float64 bits forbid false sharing", async () => {
  const registry = createWaterResidentGeometry(100000);
  registry.sync(await update("base", 1));
  const token = registry.getRecord("scene", "base", 1).token;
  const variants = [
    { feature: polygon, source: "another-water" },
    { feature: { ...polygon, coordinates: polygon.coordinates.slice(0, 1) } },
    { feature: { ...polygon, coordinates: [...polygon.coordinates].reverse() } },
    { feature: { ...polygon, coordinates: polygon.coordinates.map(ring => ring.map(point => [...point, 0])) } },
    { feature: { type: "GeometryCollection", geometries: [polygon] } },
    { feature: { ...polygon, coordinates: polygon.coordinates.map((ring, ri) => ring.map((point, pi) =>
      ri === 0 && pi === 0 ? [-0, point[1]] : point)) } },
    { feature: { ...polygon, coordinates: polygon.coordinates.map((ring, ri) => ring.map((point, pi) =>
      ri === 0 && pi === 1 ? [point[0], point[1] + Number.EPSILON * 10] : point)) } },
  ];
  for (const [index, variant] of variants.entries()) {
    const id = `changed-${index}`;
    registry.sync(await update(id, index + 2, variant.feature, variant.source || "water"));
    assert.notEqual(registry.getRecord("scene", id, index + 2).token, token);
  }
  assert.equal(registry.getStats().uniqueGeometryRecords, variants.length + 1);
  const original = registry.getRecord("scene", "base", 1);
  registry.sync(await update("return", 20, structuredClone(polygon)));
  assert.equal(registry.getRecord("scene", "return", 20), original);
});

test("namespace replacement and clear never reuse retired tokens or aliases", async () => {
  const registry = createWaterResidentGeometry(10000);
  registry.sync(await update("old", 1));
  const old = registry.getRecord("scene", "old", 1);
  registry.sync(await update("new", 2, polygon, "water", "next"));
  assert.throws(() => registry.get("scene", "old", 1), /stale/);
  assert.notEqual(registry.getRecord("next", "new", 2).token, old.token);
  assert.equal(registry.getStats().uniqueGeometryRecords, 1);
  registry.clear();
  assert.equal(registry.getBytes(), 0);
  assert.equal(registry.getStats().geometryAliases, 0);
});

test("unique record and finite alias charges evict old aliases while protecting required content", async () => {
  const registry = createWaterResidentGeometry(620);
  registry.sync(await update("a", 1));
  const original = registry.getRecord("scene", "a", 1);
  for (let index = 2; index < 20; index++) {
    const id = `v${index}`;
    const result = registry.sync(await update(id, index, polygon));
    assert.equal(registry.getRecord("scene", id, index), original);
    assert.ok(result.residentGeometryBytes <= 620);
    assert.equal(result.uniqueGeometryRecords, 1);
    assert.ok(result.geometryAliases <= 2, "version aliases cannot grow outside the byte cap");
  }
  assert.throws(() => registry.get("scene", "a", 1), /stale/);
});

test("budget failure and cancellation leave accepted records, aliases and LRU unchanged", async () => {
  const registry = createWaterResidentGeometry(1100);
  registry.sync(await update("a", 1));
  const accepted = registry.getRecord("scene", "a", 1), before = registry.getBytes();
  const oversized = await update("huge", 2, { type: "LineString",
    coordinates: Array.from({ length: 100 }, (_, index) => [index, index]) });
  assert.throws(() => registry.sync(oversized), /budget/);
  assert.equal(registry.getRecord("scene", "a", 1), accepted);
  assert.equal(registry.getBytes(), before);
  assert.equal(registry.getStats().geometryAliases, 1);
  const equal = await update("cancelled", 2);
  let checks = 0;
  assert.throws(() => registry.sync(equal, { isCancelled: () => ++checks >= 4 }), { name: "AbortError" });
  assert.equal(registry.getBytes(), before);
  assert.equal(registry.getStats().canonicalReuses, 0);
  assert.throws(() => registry.get("scene", "cancelled", 2), /stale/);
  assert.equal(registry.getRecord("scene", "a", 1), accepted);
});

test("evicted unique content has no canonical index that can resurrect its record", async () => {
  const registry = createWaterResidentGeometry(620);
  registry.sync(await update("a", 1));
  const token = registry.getRecord("scene", "a", 1).token;
  registry.sync(await update("b", 1, polygon, "other-source"));
  assert.throws(() => registry.get("scene", "a", 1), /stale/);
  assert.equal(registry.getStats().uniqueGeometryRecords, 1);
  registry.sync(await update("return", 2));
  assert.notEqual(registry.getRecord("scene", "return", 2).token, token);
  assert.ok(registry.getBytes() <= 620);
});

test("source mappings are explicit and legacy packets default to their alias ID", async () => {
  const registry = createWaterResidentGeometry(10000);
  const first = await update("old", 1);
  delete first.sourceIds;
  registry.sync(first);
  const original = registry.getRecord("scene", "old", 1);
  const next = await update("new", 2);
  delete next.sourceIds;
  registry.sync(next);
  assert.notEqual(registry.getRecord("scene", "new", 2).token, original.token);
  const broken = await update("bad", 3);
  for (const sourceIds of [[["bad", "water"], ["bad", "water"]], [["missing", "water"]], [["bad", {}]]]) {
    assert.throws(() => registry.sync({ ...broken, sourceIds }), /source IDs/);
  }
  const deletion = await update("noop", 1, null);
  assert.throws(() => registry.sync({ ...first, updates: deletion.updates,
    versions: [["old", 99]], requiredIds: ["old"] }), /stale/);
  const changedSource = await update("old", 2, polygon, "different");
  assert.throws(() => registry.sync(changedSource), /source cannot change/);
  assert.equal(registry.getRecord("scene", "old", 1), original);
});
