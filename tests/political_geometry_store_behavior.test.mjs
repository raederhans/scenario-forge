import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalGeometryStore, getPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";
import { createPoliticalDerivedStateCache } from "../js/core/renderer/political_derived_state_cache.js";

const feature = (id, value = 0) => ({ type: "Feature", properties: { id }, geometry: { type: "Polygon", coordinates: [[[value, 0], [1, 0], [0, 1], [value, 0]]] } });
const collection = (...features) => ({ type: "FeatureCollection", features });
const ids = (value) => value.features.map((f) => f.properties.id);

test("detail replacement and eviction preserve full coarse coverage and exact first-wins order", () => {
  const store = createPoliticalGeometryStore();
  const a = feature("a"), b = feature("b"), c = feature("c");
  const base = collection(a, b, c), detailA = feature("a", 2), detailB = feature("b", 3);
  const first = store.compose([collection(detailA), base]);
  assert.deepEqual(ids(first), ["a", "b", "c"]);
  const second = store.compose([collection(detailB), collection(detailA), base]);
  assert.deepEqual(ids(second), ["b", "a", "c"]);
  assert.equal(second.features[2], c);
  assert.deepEqual(getPoliticalGeometrySnapshot(second).changedIds, ["b"]);
  const reverted = store.compose([base]);
  assert.deepEqual(reverted.features, [a, b, c]);
  assert.deepEqual(new Set(getPoliticalGeometrySnapshot(reverted).changedIds), new Set(["a", "b"]));
  assert.equal(reverted.globalCoverage, true);
  assert.deepEqual(first.features, [detailA, b, c], "previous snapshot must stay immutable");
});

test("new detail does not re-read immutable base IDs; reordering overlapping sources updates precedence", () => {
  let reads = 0;
  const base = collection(...Array.from({ length: 12000 }, (_, n) => ({
    properties: { get id() { reads++; return `f${n}`; } },
  })));
  const store = createPoliticalGeometryStore();
  store.compose([base]);
  const before = reads;
  const left = collection(feature("f1", 1)), right = collection(feature("f1", 2));
  const promoted = store.compose([left, base]);
  assert.equal(reads, before);
  assert.equal(promoted.features.length, 12000);
  store.compose([left, right, base]);
  const reordered = store.compose([right, left, base]);
  assert.equal(reordered.features[0], right.features[0]);
  assert.deepEqual(getPoliticalGeometrySnapshot(reordered).changedIds, ["f1"]);
});

test("derived cache consumes store delta and falls back safely when a promotion was skipped", () => {
  const store = createPoliticalGeometryStore();
  const cache = createPoliticalDerivedStateCache({ getFeatureId: (f) => f.properties.id });
  const a = feature("a"), b = feature("b"), base = collection(a, b);
  const colors = { a: "red", b: "blue" }, identity = ["scene", 1];
  const first = store.compose([base]);
  cache.commit({ collection: first, colors, identity });
  const replacement = feature("a", 2);
  const second = store.compose([collection(replacement), base]);
  let delta = cache.describe({ previousCollection: first, collection: second, colors, identity });
  assert.deepEqual(delta.changedIds, ["a"]);
  assert.equal(delta.features.get("b"), b);
  const third = store.compose([collection(feature("b", 4)), base]);
  delta = cache.describe({ previousCollection: first, collection: third, colors, identity });
  assert.deepEqual(delta.changedIds, ["b"]);
  assert.deepEqual(first.features, [a, b]);
});

test("new sources and removed IDs are captured without mutating earlier maps", () => {
  const store = createPoliticalGeometryStore();
  const one = store.compose([collection(feature("one"))]);
  const two = store.compose([collection(feature("two"))]);
  assert.deepEqual(getPoliticalGeometrySnapshot(two).removedIds, ["one"]);
  assert.ok(getPoliticalGeometrySnapshot(one).featuresById.has("one"));
});
