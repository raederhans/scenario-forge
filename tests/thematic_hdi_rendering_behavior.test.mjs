import test from "node:test";
import assert from "node:assert/strict";
import { getThematicIndicator } from "../js/core/thematic/thematic_indicator_catalog.js";
import { getThematicWgiColor } from "../js/core/thematic/thematic_wgi_view_model.js";

test("HDI uses exact official category cutoffs", () => {
  const metric = getThematicIndicator("undp_hdi");
  for (const [value, index] of [[0, 0], [0.549, 0], [0.55, 1], [0.699, 1], [0.7, 2], [0.799, 2], [0.8, 3], [1, 3]]) {
    assert.equal(getThematicWgiColor({ status: "value", value, metricId: metric.id }), metric.colors[index]);
  }
});

test("HDI distinguishes missing and unmatched colors", () => {
  assert.notEqual(getThematicWgiColor({ status: "missing" }), getThematicWgiColor({ status: "unmatched" }));
});
