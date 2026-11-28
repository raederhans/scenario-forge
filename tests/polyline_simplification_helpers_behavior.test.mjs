import assert from "node:assert/strict";
import test from "node:test";

import { sanitizePolyline, simplifyPolylineEffectiveArea, simplifyPolylineRDP } from "../js/core/renderer/polyline_simplification_helpers.js";

test("sanitizePolyline removes invalid points and consecutive duplicates", () => {
  assert.deepEqual(
    sanitizePolyline([
      [1, 2],
      [1, 2],
      ["3", "4"],
      ["x", 5],
      null,
      [3, 4],
      [5, Infinity],
      [6, 7],
    ]),
    [
      [1, 2],
      [3, 4],
      [6, 7],
    ]
  );
  assert.deepEqual(sanitizePolyline(null), []);
});

test("simplifyPolylineRDP preserves endpoints and removes simple middle points", () => {
  const points = [[0, 0], [1, 0.1], [2, 0]];
  assert.deepEqual(simplifyPolylineRDP(points, 0.2), [[0, 0], [2, 0]]);
});

test("simplifyPolylineEffectiveArea preserves representative output", () => {
  const points = [[0, 0], [1, 0.05], [2, 0], [3, 1], [4, 0]];
  assert.deepEqual(
    simplifyPolylineEffectiveArea(points, 0.1),
    [[0, 0], [2, 0], [3, 1], [4, 0]]
  );
});
