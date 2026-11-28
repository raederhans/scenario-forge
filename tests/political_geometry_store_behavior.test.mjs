import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalGeometryStore } from "../js/core/political_geometry_store.js";

const feature = (id, value = 0) => ({ type: "Feature", properties: { id }, geometry: { type: "Polygon", coordinates: [[[value, 0], [1, 0], [0, 1], [value, 0]]] } });
const collection = (...features) => ({ type: "FeatureCollection", features });
const ids = (value) => value.features.map((f) => f.properties.id);

test("detail replacement keeps the original draw order", () => {
  const store = createPoliticalGeometryStore();
  const a = feature("a"), b = feature("b"), c = feature("c");
  const base = collection(a, b, c), detailA = feature("a", 2), detailB = feature("b", 3);
  const first = store.compose([collection(detailA), base]);
  assert.deepEqual(ids(first), ["a", "b", "c"]);
  const second = store.compose([collection(detailB), collection(detailA), base]);
  // A promoted feature keeps its position; only the winning object changes.
  assert.deepEqual(ids(second), ["a", "b", "c"]);
  assert.equal(second.features[1], detailB);
  assert.equal(second.features[2], c);
});

test("evicting detail restores the coarse features in order", () => {
  const store = createPoliticalGeometryStore();
  const a = feature("a"), b = feature("b"), c = feature("c");
  const base = collection(a, b, c);
  store.compose([collection(feature("a", 2), feature("b", 3)), base]);
  const reverted = store.compose([base]);
  assert.deepEqual(reverted.features, [a, b, c]);
});
