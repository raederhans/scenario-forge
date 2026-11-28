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
});

test("a mismatched color baseline cannot supply a delta", () => {
  const a = { id: "a" };
  const collection = { features: [a] };
  const index = new Map();
  const identity = ["scene", "projection", "semantic", index];
  const oldColors = { a: "red" };
  const replacement = { a: "blue" };
  const cache = createPoliticalDerivedStateCache({ getFeatureId: feature => feature.id });
  cache.commit({ identity, collection, colors: oldColors, colorRevision: 8 });
  assert.equal(cache.refreshColors({ identity, collection, previousColors: { ...oldColors },
    previousColorRevision: 8, colors: replacement, colorRevision: 9 }), false);
  assert.equal(cache.describe({ identity, previousCollection: collection, collection,
    colors: replacement, colorRevision: 9 }), null);
});
