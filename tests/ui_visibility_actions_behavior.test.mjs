import assert from "node:assert/strict";
import test from "node:test";
import { commitUiVisibilityState } from "../js/core/state/actions/ui_visibility_actions.js";

test("visibility commits can preserve exact rollback snapshot values", () => {
  const sentinel = { version: "before" };
  const metric = { mode: "before" };
  const target = {};

  commitUiVisibilityState(
    target,
    {
      showCityPoints: sentinel,
      strategicChoroplethMetric: metric,
    },
    { normalize: false },
  );

  assert.equal(target.showCityPoints, sentinel);
  assert.equal(target.strategicChoroplethMetric, metric);
});
