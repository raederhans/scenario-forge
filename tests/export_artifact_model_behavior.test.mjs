import assert from "node:assert/strict";
import test from "node:test";
import { buildPerLayerExportPlan, getBakePackLayerIds } from "../js/ui/toolbar/export_artifact_model.js";
import { ensureExportWorkbenchUiState } from "../js/ui/toolbar/export_workbench_controller.js";
import { setExportTextVisibilityState } from "../js/core/state/actions/export_workbench_actions.js";

test("the default export legend follows the map until the user chooses a value", () => {
  const state = { legendControl: { visible: false } };
  assert.equal(ensureExportWorkbenchUiState(state).textVisibility.legend, false);
  state.legendControl.visible = true;
  assert.equal(ensureExportWorkbenchUiState(state).textVisibility.legend, true);
  setExportTextVisibilityState(state, "legend", false);
  assert.equal(ensureExportWorkbenchUiState(state).textVisibility.legend, false);
});

test("a legend alone produces a transparent layer and belongs to the text bake", () => {
  const ui = { layerOrder: [], textVisibility: { legend: true } };
  assert.deepEqual(buildPerLayerExportPlan(ui), [{ id: "legend" }]);
  assert.deepEqual(getBakePackLayerIds(ui), ["text", "composite"]);
  ui.textVisibility.legend = false;
  assert.deepEqual(buildPerLayerExportPlan(ui), []);
  assert.deepEqual(getBakePackLayerIds(ui), []);
});
