import test from "node:test";
import assert from "node:assert/strict";

import { normalizeExportWorkbenchUiState } from "../js/core/state_defaults.js";
import { createExportWorkbenchController } from "../js/ui/toolbar/export_workbench_controller.js";

class FakeInput extends EventTarget {
  constructor(value = "100") {
    super();
    this.value = value;
    this.dataset = {};
  }
}

function createControllerHarness() {
  const state = {};
  const inputs = Object.fromEntries(
    ["brightness", "contrast", "saturation", "clarity"]
      .map((key) => [key, new FakeInput()]),
  );
  const labels = Object.fromEntries(
    Object.keys(inputs).map((key) => [key, { textContent: "" }]),
  );
  const controller = createExportWorkbenchController({
    state,
    t: (key) => key,
    showToast() {},
    showExportFailureToast() {},
    normalizeExportWorkbenchUiState,
    renderPassNames: [],
    buildCompositeSourceCanvas: async () => ({}),
    buildSingleExportSourceCanvas: async () => ({}),
    applyExportAdjustmentsToCanvas: (canvas) => canvas,
    bakeLayer() {},
    clearBakeCache() {},
    exportWorkbenchBrightness: inputs.brightness,
    exportWorkbenchContrast: inputs.contrast,
    exportWorkbenchSaturation: inputs.saturation,
    exportWorkbenchClarity: inputs.clarity,
    exportWorkbenchBrightnessValue: labels.brightness,
    exportWorkbenchContrastValue: labels.contrast,
    exportWorkbenchSaturationValue: labels.saturation,
    exportWorkbenchClarityValue: labels.clarity,
  });

  return { state, inputs, labels, controller };
}

test("bound adjustment sliders preserve zero and normalize values in state and controls", (t) => {
  const originalInputConstructor = globalThis.HTMLInputElement;
  globalThis.HTMLInputElement = FakeInput;
  t.after(() => {
    if (originalInputConstructor === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = originalInputConstructor;
  });

  const { state, inputs, labels, controller } = createControllerHarness();
  controller.bindExportWorkbenchEvents();

  for (const key of Object.keys(inputs)) {
    const input = inputs[key];
    for (const [raw, expected] of [["137.6", 138], ["0", 0], ["-30", 0], ["250", 200], ["invalid", 100], ["Infinity", 100], ["-Infinity", 100]]) {
      input.value = raw;
      input.dispatchEvent(new Event("input"));

      assert.equal(state.exportWorkbenchUi.adjustments[key], expected, `${key} state for ${raw}`);

      controller.syncExportWorkbenchControlsFromState();
      assert.equal(input.value, String(expected), `${key} control for ${raw}`);
      assert.equal(labels[key].textContent, `${expected}%`, `${key} label for ${raw}`);
    }
  }
});
