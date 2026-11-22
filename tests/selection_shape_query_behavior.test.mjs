import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { querySelectionShape } from "../js/core/renderer/selection_shape_query.js";

globalThis.d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
const rect = { type: "rect", points: [[10, 10], [0, 0]] };

function item(id, [minX, minY, maxX, maxY], drawOrder, centroid) {
  return { id, minX, minY, maxX, maxY, drawOrder, interactive: true, feature: { centroid } };
}

function query(shape, bucket, globals = []) {
  return querySelectionShape({
    shape, items: bucket, grid: new Map([["0,0", bucket]]),
    gridMeta: { cellSize: 20, cols: 1, rows: 1, globals },
    isEligible: (_, id) => id !== "excluded",
    getCentroid: feature => {
      assert.ok(feature.centroid, "only boundary candidates need a centroid");
      return feature.centroid;
    },
  });
}

test("rectangle includes enclosed boxes and crossing centroids, deduplicated in draw order", () => {
  const enclosed = item("enclosed", [0, 0, 10, 10], 7);
  const inside = item("inside", [9, 7, 13, 8], 2, [10, 7]);
  assert.deepEqual(query(rect, [
    enclosed, inside, item("outside", [7, 8, 16, 9], 3, [11, 8]),
    item("disjoint", [11, 0, 14, 3], 1), { ...enclosed, id: "hidden", interactive: false },
    { ...enclosed, id: "excluded" },
  ], [item("global", [1, 1, 3, 3], 0), enclosed]), ["global", "inside", "enclosed"]);
});

test("concave lasso can cut the middle of a box with all four corners inside", () => {
  const lasso = { type: "lasso", points: [[0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10]] };
  assert.deepEqual(query(lasso, [
    item("notch", [2, 5, 8, 8], 1, [5, 6]), item("arm", [2, 5, 8, 8], 2, [7, 6]),
    item("inside", [1, 1, 3, 8], 0), item("outside", [4.5, 6, 5.5, 8], 3),
    item("surrounds", [-1, -1, 11, 11], 4, [2, 2]),
  ]), ["inside", "arm", "surrounds"]);
});

test("missing index is distinguishable from an empty selection", () => {
  assert.equal(querySelectionShape({ shape: rect, grid: null, gridMeta: null, items: [] }), null);
  assert.deepEqual(query(rect, []), []);
});
