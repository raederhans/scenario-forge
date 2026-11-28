import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalGeometryStore, getPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";
const feature = (id, x = 0) => ({ type: "Feature", properties: { id }, geometry: { type: "Point", coordinates: [x, 0] } });
const fc = (...features) => ({ type: "FeatureCollection", features });
const ids = (collection) => collection.features.map((f) => f.properties.id);

test("lazy composition preserves source priority, stable draw positions and coarse restoration", () => {
  const store = createPoliticalGeometryStore(), base = fc(feature("a"), feature("b")), detail = fc(feature("b", 9));
  const coarse = store.compose([base]), refined = store.compose([detail, base]);
  assert.deepEqual(ids(refined), ["a", "b"]);
  assert.equal(getPoliticalGeometrySnapshot(refined).getFeature("b"), detail.features[0]);
  assert.equal(getPoliticalGeometrySnapshot(refined).featureCount, 2);
  const restored = store.compose([base]);
  assert.deepEqual(ids(coarse), ["a", "b"], "old lazy snapshot remains immutable after later updates");
  assert.equal(restored.features[1], base.features[1]);
  assert.equal(refined.features[1], detail.features[0], "old snapshot is not the live winner Map");
});

test("100 deterministic promotions/evictions match an independent full merge with first-appearance order", () => {
  const store = createPoliticalGeometryStore(), base = fc(...Array.from({ length: 70 }, (_, i) => feature(`id-${i}`)));
  const details = Array.from({ length: 8 }, (_, j) => fc(...Array.from({ length: 16 }, (_, i) => feature(`id-${(j * 9 + i) % 70}`, j + 1))));
  const retained = [];
  // Draw positions: ids in order of first appearance; an evicted id re-enters at the end.
  const order = new Set();
  for (let n = 0; n < 100; n++) {
    const sources = [...details.filter((_, i) => (n * 7 + i) % 5 < 2), base];
    if (n % 3 === 0) sources.reverse();
    const expected = new Map();
    for (const source of sources) for (const f of source.features) if (!expected.has(f.properties.id)) expected.set(f.properties.id, f);
    for (const id of [...order]) if (!expected.has(id)) order.delete(id);
    for (const source of sources) for (const f of source.features) order.add(f.properties.id);
    const output = store.compose(sources);
    retained.push([output, [...order].map((id) => expected.get(id))]);
    assert.equal(getPoliticalGeometrySnapshot(output).featureCount, expected.size);
  }
  for (const [output, expected] of retained) assert.deepEqual(output.features, expected);
});
