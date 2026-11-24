import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterOrderIndex, updatePoliticalIdRasterOrder } from "../js/core/renderer/political_id_raster_order_index.js";

test("every foreground transition preserves the original order within each tier and dirties exactly the crossing members", () => {
  const original = ["a", "b", "c", "d", "e"].map((id, originalIndex) => ({
    id, originalIndex, baseTier: originalIndex % 2, code: originalIndex + 1, geometryVersion: originalIndex + 10,
    bounds: originalIndex ? { minX: originalIndex, minY: 0, maxX: originalIndex + 1, maxY: 1 } : null,
  }));
  const members = mask => new Set(original.filter((_, i) => mask & (1 << i)).map(entry => entry.id));
  const sorted = ids => original.slice().sort((a, b) =>
    (ids.has(a.id) ? 2 : a.baseTier) - (ids.has(b.id) ? 2 : b.baseTier) || a.originalIndex - b.originalIndex);
  for (let before = 0; before < 32; before++) {
    const oldMembers = members(before);
    const old = sorted(oldMembers).map((entry, drawOrder) => Object.freeze({ ...entry, drawOrder }));
    const index = createPoliticalIdRasterOrderIndex(original, new Map(old.map(entry => [entry.id, entry])), oldMembers);
    for (let after = 0; after < 32; after++) {
      const newMembers = members(after), expected = sorted(newMembers);
      const next = updatePoliticalIdRasterOrder(index, newMembers);
      const actual = next.entries || old;
      assert.deepEqual(actual.map(entry => entry.id), expected.map(entry => entry.id));
      const crossings = expected.filter((entry, i) => oldMembers.has(entry.id) !== newMembers.has(entry.id)
        && expected.some((other, j) => (i < j) !== (index.entryById.get(entry.id).drawOrder < index.entryById.get(other.id).drawOrder)));
      assert.deepEqual(next.dirtyBounds, crossings.map(({ id, bounds }) => ({
        id, oldBounds: bounds, newBounds: bounds, previousCoverageUnknown: bounds === null,
      })));
      for (const [drawOrder, entry] of actual.entries()) {
        assert.equal(entry.drawOrder, drawOrder);
        assert.equal(entry.code, expected[drawOrder].code);
        assert.equal(entry.geometryVersion, expected[drawOrder].geometryVersion);
      }
    }
  }
});
