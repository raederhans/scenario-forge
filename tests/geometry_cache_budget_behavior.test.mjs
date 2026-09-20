import assert from "node:assert/strict";
import test from "node:test";
import { GeometryBudgetMap, getGeometryRetentionWeights } from "../js/core/renderer/geometry_cache_budget.js";

test("weighted LRU touches hits, replaces weights, skips oversized entries without flushing hot entries", () => {
  const cache = new GeometryBudgetMap({ budget: 10, weigh: (value) => value.weight });
  cache.set("a", { weight: 4 }); cache.set("b", { weight: 4 }); cache.get("a");
  cache.set("c", { weight: 4 });
  assert.deepEqual([...cache.keys()], ["a", "c"]);
  cache.set("giant", { weight: 100 });
  assert.deepEqual([...cache.keys()], ["a", "c"]);
  cache.set("a", { weight: 2 });
  assert.equal(cache.getStats().estimatedBytes, 6);
  assert.equal(cache.getStats().oversizedSkips, 1);
  assert.equal(cache.getStats().evictions, 1);
  cache.delete("c"); assert.equal(cache.getStats().estimatedBytes, 2);
  cache.clear(); assert.equal(cache.getStats().estimatedBytes, 0);
});

test("active geometry can exceed target, then is evicted when unpinned; clear resets retention", () => {
  const cache = new GeometryBudgetMap({ budget: 10, weigh: (value) => value, autoTrim: false });
  cache.set("active", 20); cache.set("old", 6);
  assert.deepEqual(cache.trim(new Set(["active"])), ["old"]);
  assert.equal(cache.getStats().overBudgetBytes, 10);
  cache.set("next", 5);
  assert.deepEqual(cache.trim(new Set(["next"])), ["active"]);
  assert.equal(cache.getStats().estimatedBytes, 5);
  cache.clear(); assert.equal(cache.size, 0);
});

test("geometry weights count nested dimensions once per immutable geometry without retaining it in values", () => {
  const geometry = { type: "GeometryCollection", geometries: [
    { type: "Point", coordinates: [1, 2, 3] },
    { type: "Polygon", coordinates: [[[1, 2], [3, 4], [1, 2]]] },
  ] };
  const weights = getGeometryRetentionWeights({ type: "Feature", geometry });
  assert.equal(weights.points, 4);
  assert.equal(weights.decoded, 256 + 6 * 32 + 9 * 8);
  assert.equal(getGeometryRetentionWeights(geometry), weights);
  assert.notEqual(getGeometryRetentionWeights(structuredClone(geometry)), weights);
});
