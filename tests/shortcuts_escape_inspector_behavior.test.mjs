import assert from "node:assert/strict";
import test from "node:test";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { state } from "../js/core/state.js";
import { clearInspectorSelectionState } from "../js/core/state/actions/editor_input_actions.js";

class ElementStub {
  constructor(editable = false) { this.editable = editable; }
  closest() { return this.editable ? this : null; }
  hasAttribute() { return false; }
  getAttribute() { return null; }
}

for (const scenario of ["clear", "unselected", "modal", "editable", "prevented", "brush"]) {
  test(`Escape inspector selection: ${scenario}`, (context) => {
    const listeners = new Map();
    for (const [key, value] of Object.entries({
      Element: ElementStub,
      document: { body: { dataset: {} }, querySelectorAll: () => scenario === "modal" ? [new ElementStub()] : [] },
      window: { addEventListener: (name, handler) => listeners.set(name, handler) },
    })) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      context.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
    }
    let clears = 0;
    const values = {
      bootBlocking: false, startupReadonly: false,
      unitCounterEditor: null, operationalLineEditor: null, operationGraphicsEditor: null,
      specialZoneEditor: null, brushModeEnabled: scenario === "brush", brushPanModifierActive: false,
      selectedInspectorCountryCode: scenario === "unselected" ? "" : "AA",
      inspectorHighlightCountryCode: "AA", inspectorHighlightFeatureIds: [],
      inspectorHighlightGroupMode: false, inspectorHighlightLabel: "", inspectorOverlayDirty: false,
      clearInspectorLandSelectionFn: () => { clears += 1; return clearInspectorSelectionState(state); },
    };
    for (const [key, value] of Object.entries(values)) {
      const previous = Object.getOwnPropertyDescriptor(state, key);
      state[key] = value;
      context.after(() => previous ? Object.defineProperty(state, key, previous) : delete state[key]);
    }
    initShortcuts();
    const event = { key: "Escape", target: new ElementStub(scenario === "editable"),
      defaultPrevented: scenario === "prevented", preventDefault() { this.defaultPrevented = true; } };
    listeners.get("keydown")(event);
    assert.equal(clears, scenario === "clear" ? 1 : 0);
    assert.equal(state.selectedInspectorCountryCode, ["clear", "unselected"].includes(scenario) ? "" : "AA");
    assert.equal(event.defaultPrevented, ["clear", "prevented", "brush"].includes(scenario));
    if (scenario === "brush") assert.equal(state.brushModeEnabled, false);
  });
}
