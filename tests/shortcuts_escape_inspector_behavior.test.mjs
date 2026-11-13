import { resolveInspectorStepUp } from "../js/core/inspector_drilldown.js";
import assert from "node:assert/strict";
import test from "node:test";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { registerRuntimeHook, readRegisteredRuntimeHookSource } from "../js/core/state/index.js";
import { registerSpecialZonesWorkbenchRuntimeHooks } from "../js/core/state/actions/special_zone_actions.js";
import { bindRenderBoundary } from "../js/core/render_boundary.js";
import { state } from "../js/core/state.js";
import { clearInspectorSelectionState, selectInspectorCountryState, selectInspectorGroupState, selectInspectorFeatureState } from "../js/core/state/actions/editor_input_actions.js";

class ElementStub {
  constructor(editable = false) { this.editable = editable; }
  closest() { return this.editable ? this : null; }
  hasAttribute() { return false; }
  getAttribute() { return null; }
}

for (const scenario of ["clear", "unselected", "modal", "editable", "prevented", "brush", "drill", "ungrouped", "declined", "membership"]) {
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
    const calls = [];
    const previousStepUp = readRegisteredRuntimeHookSource(state, "stepUpInspectorSelectionFn");
    context.after(() => registerRuntimeHook(state, "stepUpInspectorSelectionFn", previousStepUp));
    if (scenario === "membership") {
      registerSpecialZonesWorkbenchRuntimeHooks(state, {
        renderWorkbench: () => calls.push(["workbench", state.currentTool]),
      });
      bindRenderBoundary({ flushRender: ({ reason }) => calls.push(["flush", reason]) });
      context.after(() => {
        registerRuntimeHook(state, "updateSpecialZonesWorkbenchUIFn", null);
        bindRenderBoundary();
      });
    }
    const group = { id: "g", children: ["a", "b"] };
    const values = {
      bootBlocking: false, startupReadonly: false,
      currentTool: scenario === "membership" ? "special-zone-membership" : "select",
      specialZonePreviousTool: scenario === "membership" ? "fill" : "",
      unitCounterEditor: null, operationalLineEditor: null, operationGraphicsEditor: null,
      specialZoneEditor: null, brushModeEnabled: scenario === "brush", brushPanModifierActive: false,
      selectedInspectorCountryCode: scenario === "unselected" ? "" : "AA",
      inspectorHighlightCountryCode: "AA", inspectorHighlightFeatureIds: [],
      inspectorHighlightGroupMode: false, inspectorHighlightLabel: "", inspectorOverlayDirty: false,
      stepUpInspectorSelectionFn: () => {
        clears += 1;
        if (scenario === "declined") return false;
        const step = resolveInspectorStepUp({
          current: { countryCode: state.selectedInspectorCountryCode, level: state.inspectorSelectionLevel, featureId: state.inspectorSelectionFeatureId },
          findGroup: () => scenario === "ungrouped" ? null : group,
        });
        if (!step) return false;
        if (!step.countryCode) return clearInspectorSelectionState(state);
        if (step.level === "group") selectInspectorGroupState(state, step.countryCode, step.group);
        else selectInspectorCountryState(state, step.countryCode);
        return true;
      },
      inspectorSelectionLevel: "country", inspectorSelectionGroupId: "", inspectorSelectionFeatureId: "",
    };
    registerRuntimeHook(state, "stepUpInspectorSelectionFn", values.stepUpInspectorSelectionFn);
    delete values.stepUpInspectorSelectionFn;
    for (const [key, value] of Object.entries(values)) {
      const previous = Object.getOwnPropertyDescriptor(state, key);
      state[key] = value;
      context.after(() => previous ? Object.defineProperty(state, key, previous) : delete state[key]);
    }
    if (["drill", "ungrouped"].includes(scenario)) selectInspectorFeatureState(state, "AA", "a", group);
    initShortcuts();
    const event = { key: "Escape", target: new ElementStub(scenario === "editable"),
      defaultPrevented: scenario === "prevented", preventDefault() { this.defaultPrevented = true; } };
    assert.doesNotThrow(() => listeners.get("keydown")(event));
    if (scenario === "membership") {
      assert.equal(state.currentTool, "fill");
      assert.equal(state.specialZonePreviousTool, "");
      assert.equal(event.defaultPrevented, true);
      assert.equal(clears, 0);
      assert.deepEqual(calls, [
        ["workbench", "fill"],
        ["flush", "shortcut-special-zone-membership-exit"],
      ]);
      return;
    }
    if (["drill", "ungrouped"].includes(scenario)) {
      assert.equal(state.inspectorSelectionLevel, scenario === "drill" ? "group" : "country");
      assert.equal(event.defaultPrevented, true);
      const press = () => listeners.get("keydown")({ ...event, defaultPrevented: false });
      if (scenario === "drill") {
        press();
        assert.equal(state.inspectorSelectionLevel, "country");
      }
      press();
      assert.equal(state.selectedInspectorCountryCode, "");
      const calls = clears;
      press();
      assert.equal(clears, calls);
      return;
    }
    assert.equal(clears, ["clear", "declined"].includes(scenario) ? 1 : 0);
    assert.equal(state.selectedInspectorCountryCode, ["clear", "unselected"].includes(scenario) ? "" : "AA");
    assert.equal(event.defaultPrevented, ["clear", "prevented", "brush", "drill", "ungrouped"].includes(scenario));
    if (scenario === "brush") assert.equal(state.brushModeEnabled, false);
  });
}
