import test from "node:test";
import assert from "node:assert/strict";
import { patchLegendState } from "../js/core/state/actions/legend_actions.js";

test("legend action writes only selected owner fields and detaches normalized input", () => {
  const colors = { region: "#112233" };
  const target = { colors };
  const patch = { legendLabels: { "#112233": "Label" }, legendColorOrder: ["#112233"], colors: {} };
  patchLegendState(target, patch);
  patch.legendLabels["#112233"] = "Changed";
  patch.legendColorOrder.length = 0;
  assert.deepEqual(target.legendLabels, { "#112233": "Label" });
  assert.deepEqual(target.legendColorOrder, ["#112233"]);
  assert.equal(target.colors, colors);
});
