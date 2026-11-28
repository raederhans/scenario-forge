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
  registry.sync(await update("old", 1));
  const old = registry.getRecord("scene", "old", 1);
  registry.sync(await update("new", 2, structuredClone(polygon)));
  assert.equal(registry.getRecord("scene", "new", 2), old);
  assert.equal(registry.get("scene", "old", 1), registry.get("scene", "new", 2));
  assert.throws(() => registry.get("scene", "new", 1), /stale/);
  assert.throws(() => registry.get("other", "new", 2), /stale/);
});

test("a failed geometry update preserves the accepted record", async () => {
  const registry = createWaterResidentGeometry(1100);
  registry.sync(await update("a", 1));
  const accepted = registry.getRecord("scene", "a", 1);
  const oversized = await update("huge", 2, { type: "LineString",
    coordinates: Array.from({ length: 100 }, (_, index) => [index, index]) });
  assert.throws(() => registry.sync(oversized), /budget/);
  assert.equal(registry.getRecord("scene", "a", 1), accepted);
});
