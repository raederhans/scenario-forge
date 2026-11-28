import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { readRuntimeHook, registerRuntimeHook } from "../js/core/state/index.js";
import { normalizeExportWorkbenchUiState } from "../js/core/state_defaults.js";
import { undoHistory } from "../js/core/history_manager.js";
import { buildPerLayerExportPlan } from "../js/ui/toolbar/export_artifact_model.js";
import { createExportWorkbenchController } from "../js/ui/toolbar/export_workbench_controller.js";
import { Element } from "./helpers/legend_element.mjs";

const noop = () => {};
function setFields(t, target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    t.after(() => previous ? Object.defineProperty(target, key, previous) : delete target[key]);
    target[key] = value;
  }
}

test("project name creates an undoable title and registers title-only layer", t => {
  class Control extends Element {
    matches(selector) {
      return selector === this.tagName || (selector === "[name]" && !!this.name) || super.matches(selector);
    }
  }
  const fields = new Control();
  const makeField = () => {
    const field = new Control("fieldset");
    field.append(new Control("legend"));
    for (const name of ["enabled", "text", "position", "size", "background"]) {
      field.append(Object.assign(new Control("input"), { name, type: name === "enabled" ? "checkbox" : "text" }));
    }
    return field;
  };
  const template = { content: { firstElementChild: { cloneNode: makeField } } };
  const doc = { getElementById: id => id === "exportMapTitleFields" ? fields : template, createElement: tag => new Control(tag) };
  setFields(t, globalThis, { HTMLInputElement: Control });
  setFields(t, state, { exportWorkbenchUi: normalizeExportWorkbenchUiState(null), projectName: "Atlas", historyPast: [], historyFuture: [] });
  const previous = readRuntimeHook(state, "refreshExportMapTitlesFn");
  t.after(() => registerRuntimeHook(state, "refreshExportMapTitlesFn", previous));
  const controller = createExportWorkbenchController({ state, t: key => key, normalizeExportWorkbenchUiState,
    exportWorkbenchOverlay: { ownerDocument: doc, getAttribute: () => "false" }, renderPassNames: [],
    showToast: noop, showExportFailureToast: noop, buildCompositeSourceCanvas: noop, buildSingleExportSourceCanvas: noop,
    applyExportAdjustmentsToCanvas: noop, bakeLayer: noop, clearBakeCache: noop });
  controller.bindExportWorkbenchEvents();
  controller.syncExportWorkbenchControlsFromState();
  const field = fields.querySelector('[data-title-field="title"]');
  const [enabled, input] = field.querySelectorAll("[name]");
  field.querySelector("button").fire("click");
  assert.deepEqual([enabled.checked, input.value], [true, "Atlas"]);

  const layers = () => ({ mapTitles: state.exportWorkbenchUi.mapTitles, textVisibility: {}, layerOrder: [] });
  assert.deepEqual(buildPerLayerExportPlan(layers()), [{ id: "map-titles" }]);

  undoHistory();
  assert.deepEqual([enabled.checked, input.value], [false, ""]);
  assert.deepEqual(buildPerLayerExportPlan(layers()), []);
});
