import test from "node:test";
import assert from "node:assert/strict";
import { patchLegendState, setLegendLabelState } from "../js/core/state/actions/legend_actions.js";
import { LegendManager, createRevisionedLegendColorReader } from "../js/core/legend_manager.js";

test("legend action writes only selected owner fields and detaches normalized input", () => {
  const colors = { region: "#112233" };
  const target = { colors, legendControl: { visible: false } };
  const patch = { legendLabels: { "#112233": "Label" }, legendColorOrder: ["#112233"], colors: {} };
  patchLegendState(target, patch);
  patch.legendLabels["#112233"] = "Changed";
  patch.legendColorOrder.length = 0;
  assert.deepEqual(target.legendLabels, { "#112233": "Label" });
  assert.deepEqual(target.legendColorOrder, ["#112233"]);
  assert.deepEqual(target.legendControl, { visible: false });
  assert.equal(target.colors, colors);
});

test("legend label action inserts and deletes without mutating previous label records", () => {
  const original = { "#112233": "Old" };
  const target = { legendLabels: original };
  setLegendLabelState(target, "#445566", "New");
  setLegendLabelState(target, "#112233", "");
  assert.deepEqual(target.legendLabels, { "#445566": "New" });
  assert.deepEqual(original, { "#112233": "Old" });
});

test("legend readers still normalize owner state through the canonical action", () => {
  const colors = { region: "#112233" };
  const target = {
    colors,
    colorRevision: 1,
    legendLabels: { "#112233": " Label " },
    legendConfig: { maxItems: 100 },
    legendControl: { width: 1, opacity: 5 },
    legendColorOrder: ["#112233", "invalid", "#112233"],
  };
  assert.deepEqual(createRevisionedLegendColorReader()(target), ["#112233"]);
  assert.equal(target.legendConfig.maxItems, 30);
  assert.equal(target.legendControl.width, 180);
  assert.equal(target.legendControl.opacity, 1);
  assert.deepEqual(target.legendLabels, { "#112233": "Label" });
  assert.deepEqual(target.legendColorOrder, ["#112233"]);
  LegendManager.updateConfig(target, { maxItems: 2 });
  LegendManager.setLabel("#112233", "Updated", target);
  LegendManager.hideControl(target);
  assert.equal(target.legendConfig.maxItems, 2);
  assert.equal(target.legendLabels["#112233"], "Updated");
  assert.equal(target.legendControl.visible, false);
  assert.equal(target.colors, colors);
});
