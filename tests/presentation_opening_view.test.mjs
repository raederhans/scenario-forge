import assert from "node:assert/strict";
import test from "node:test";
import { applyScenarioOpeningView } from "../js/core/scenario/presentation_opening_view.js";

function apply(manifest, animate = false) {
  const calls = [];
  applyScenarioOpeningView(manifest, {
    animate,
    focusGeoBounds: (...args) => calls.push(["focus", ...args]),
    resetZoomToFit: (...args) => calls.push(["reset", ...args]),
  });
  return calls;
}

test("opening bounds focus the specified region", () => {
  for (const bounds of [[-12, 34, 48, 63], [-15, 22, 80, 66]]) {
    for (const animate of [false, true]) {
      assert.deepEqual(apply({ opening_view: { bounds } }, animate), [["focus", bounds, { animate }]]);
    }
  }
});

test("absent opening view fits the world", () => {
  for (const manifest of [undefined, null, {}]) {
    for (const animate of [false, true]) {
      assert.deepEqual(apply(manifest, animate), [["reset", { animate }]]);
    }
  }
});

test("invalid opening bounds leave the view unchanged", () => {
  for (const bounds of [undefined, null, "bounds", [], [0, 1, 2], [0, 1, 2, 3, 4],
    ["0", 1, 2, 3], [NaN, 1, 2, 3], [0, 1, Infinity, 3],
    [-181, 0, 10, 20], [0, -91, 10, 20], [0, 0, 181, 20], [0, 0, 10, 91],
    [10, 0, 0, 20], [0, 20, 10, 0], [0, 0, 0, 20], [0, 0, 10, 0]]) {
    assert.deepEqual(apply({ opening_view: { bounds } }), []);
  }
  assert.deepEqual(apply({ opening_view: null }), []);
});
