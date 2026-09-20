import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalGeometryStore, getPoliticalGeometrySnapshot, registerPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";
const feature = (id, x = 0) => ({ type: "Feature", properties: { id }, geometry: { type: "Point", coordinates: [x, 0] } });
const fc = (...features) => ({ type: "FeatureCollection", features });
const ids = (collection) => collection.features.map((f) => f.properties.id);

test("lazy composition preserves source priority, draw order and coarse restoration", () => {
  const store = createPoliticalGeometryStore(), base = fc(feature("a"), feature("b")), detail = fc(feature("b", 9));
  const coarse = store.compose([base]), refined = store.compose([detail, base]);
  assert.deepEqual(ids(refined), ["b", "a"]);
  assert.equal(getPoliticalGeometrySnapshot(refined).getFeature("b"), detail.features[0]);
  assert.equal(getPoliticalGeometrySnapshot(refined).featureCount, 2);
  const restored = store.compose([base]);
  assert.deepEqual(ids(coarse), ["a", "b"], "old lazy snapshot remains immutable after later updates");
  assert.equal(restored.features[1], base.features[1]);
  assert.equal(refined.features[0], detail.features[0], "old snapshot is not the live winner Map");
});

test("no-op source selection reuses compatibility views but advances an empty delta", () => {
  const store = createPoliticalGeometryStore(), base = fc(feature("a"), feature("b"));
  const first = store.compose([base]), next = store.compose([base]);
  assert.equal(first.features, next.features);
  const a = getPoliticalGeometrySnapshot(first), b = getPoliticalGeometrySnapshot(next);
  assert.equal(a.featuresById, b.featuresById);
  assert.equal(b.previousRevision, a.revision);
  assert.deepEqual(b.changedIds, []);
  assert.deepEqual(b.removedIds, []);
  base.features[0].properties.owner = "changed";
  assert.equal(next.features[0].properties.owner, "changed", "metadata still comes from live feature objects");
});

test("empty, duplicate and reordered sources preserve exact legacy winner semantics", () => {
  const store = createPoliticalGeometryStore(), a = fc(feature("a"), feature("b")), b = fc(feature("b", 9), feature("c"));
  assert.deepEqual(ids(store.compose([a, a, b])), ["a", "b", "c"]);
  const reordered = store.compose([b, a]);
  assert.deepEqual(ids(reordered), ["b", "c", "a"]);
  assert.equal(reordered.features[0], b.features[0]);
  assert.deepEqual(ids(store.compose([])), []);
  assert.deepEqual(ids(store.compose([a])), ["a", "b"]);
});

test("delta-only consumer does not materialize a compatibility Map or array", () => {
  const store = createPoliticalGeometryStore(), base = fc(...Array.from({ length: 3000 }, (_, i) => feature(`id-${i}`)));
  const first = store.compose([base]);
  const snapshot = getPoliticalGeometrySnapshot(first);
  assert.equal(typeof Object.getOwnPropertyDescriptor(first, "features").get, "function");
  assert.equal(typeof Object.getOwnPropertyDescriptor(snapshot, "featuresById").get, "function");
  assert.equal(snapshot.featureCount, 3000);
  assert.equal(snapshot.getFeature("id-50"), base.features[50]);
  const next = store.compose([fc(feature("id-50", 5)), base]);
  assert.deepEqual(getPoliticalGeometrySnapshot(next).changedIds, ["id-50"]);
  assert.equal(snapshot.getFeature("id-50"), base.features[50]);
  assert.equal(JSON.parse(JSON.stringify(next)).features.length, 3000);
});

test("100 deterministic promotions/evictions match an independent full merge", () => {
  const store = createPoliticalGeometryStore(), base = fc(...Array.from({ length: 70 }, (_, i) => feature(`id-${i}`)));
  const details = Array.from({ length: 8 }, (_, j) => fc(...Array.from({ length: 16 }, (_, i) => feature(`id-${(j * 9 + i) % 70}`, j + 1))));
  const retained = [];
  for (let n = 0; n < 100; n++) {
    const sources = [...details.filter((_, i) => (n * 7 + i) % 5 < 2), base];
    if (n % 3 === 0) sources.reverse();
    const expected = new Map();
    for (const source of sources) for (const f of source.features) if (!expected.has(f.properties.id)) expected.set(f.properties.id, f);
    const output = store.compose(sources);
    retained.push([output, [...expected.values()]]);
    assert.equal(getPoliticalGeometrySnapshot(output).featureCount, expected.size);
  }
  for (const [output, expected] of retained) assert.deepEqual(output.features, expected);
});


test("normalized snapshot lookup returns wrapped metadata, not the raw source view", () => {
  const store = createPoliticalGeometryStore(), raw = feature("a");
  const input = store.compose([fc(raw)]), wrapped = { ...raw, properties: { ...raw.properties, __source: "detail" } };
  const output = fc(wrapped);
  registerPoliticalGeometrySnapshot(output, { ...getPoliticalGeometrySnapshot(input), featuresById: new Map([["a", wrapped]]) });
  assert.equal(getPoliticalGeometrySnapshot(output).getFeature("a"), wrapped);
  assert.equal(getPoliticalGeometrySnapshot(input).getFeature("a"), raw);
});
