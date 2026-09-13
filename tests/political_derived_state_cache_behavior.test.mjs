import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalDerivedStateCache } from "../js/core/renderer/political_derived_state_cache.js";

test("derived delta retains unchanged features, replaces the same ID and removes obsolete IDs", () => {
  const cache = createPoliticalDerivedStateCache({ getFeatureId: (f) => f.id });
  const a = { id: "a" }, b = { id: "b" }, gone = { id: "gone" };
  const collection = { features: [a, b, gone] };
  const colors = { a: "red", b: "blue", gone: "green" };
  const identity = ["scene", 1, "projection", 5];
  cache.commit({ collection, colors, identity });
  const next = { features: [a, { id: "b" }, { id: "new" }] };
  const delta = cache.describe({ previousCollection: collection, collection: next, colors, identity });
  assert.deepEqual(delta.changedIds, ["b", "new"]);
  assert.deepEqual(delta.removedIds, ["gone"]);
  for (const change of [{ identity: ["other", 1, "projection", 5] }, { identity: ["scene", 1, "projection", 6] }, { colors: { ...colors } }, { previousCollection: { ...collection } }]) {
    assert.equal(cache.describe({ previousCollection: collection, collection: next, colors, identity, ...change }), null);
  }
  delete colors.a;
  assert.ok(cache.describe({ previousCollection: collection, collection: next, colors, identity }).changedIds.includes("a"));
  cache.reset();
  assert.equal(cache.describe({ previousCollection: collection, collection: next, colors, identity }), null);
});
