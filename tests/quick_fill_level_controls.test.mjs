import test from "node:test";
import assert from "node:assert/strict";
import { getQuickFillLevelModel, createQuickFillLevelControls } from "../js/ui/toolbar/quick_fill_level_controls.js";
import { setBatchFillScopeState } from "../js/core/state/actions/scenario_presentation_actions.js";

function state() {
  return { selectedInspectorCountryCode: "FR", hierarchyData: { groups: { FR_region: ["a"] }, quick_fill: { countries: {
    FR: { levels: { department: { label: "Department", groups: {} }, region: { label: "Region", alias: "parent" } } },
  } } }, batchFillScope: "parent" };
}

test("UI level selection is explicit, persistent and never silently downgraded", () => {
  const s = state();
  assert.ok(setBatchFillScopeState(s, "level:department"));
  assert.equal(s.batchFillScope, "level:department");
  assert.equal(getQuickFillLevelModel(s).selected, "level:department");
  s.selectedInspectorCountryCode = "US";
  const model = getQuickFillLevelModel(s);
  assert.equal(model.selected, "level:department");
  assert.equal(model.options.find((option) => option.value === model.selected).disabled, true);
});

test("scenario owner tags do not get mistaken for geographic country codes", () => {
  const s = state(); s.activeScenarioId = "hoi4_1936"; s.selectedInspectorCountryCode = "FRA";
  s.devSelectedHit = { id: "a", targetType: "land" };
  s.landIndex = new Map([["a", { properties: { id: "a", cntr_code: "FR" } }]]);
  const model = getQuickFillLevelModel(s);
  assert.equal(model.countryCode, "FR");
  assert.equal(model.options.find((option) => option.value === "country").label, "Current scenario owner");
});

test("select binds once and updates state through the injected action", () => {
  class Element {
    constructor() { this.children = []; this.events = {}; this.attributes = {}; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    addEventListener(event, fn) { this.events[event] = fn; }
    setAttribute(key, value) { this.attributes[key] = value; }
  }
  const container = new Element(); container.ownerDocument = { createElement: () => new Element() };
  const s = state(); let changes = 0;
  const controller = createQuickFillLevelControls({ state: s, container, onChange: (scope) => { changes++; setBatchFillScopeState(s, scope); } });
  controller.refresh(); controller.refresh();
  assert.equal(container.children.length, 1);
  const select = container.children[0]; select.value = "level:department"; select.events.change();
  assert.equal(changes, 1); assert.equal(s.batchFillScope, "level:department");
  s.currentLanguage = "zh"; controller.refresh();
  assert.equal(select.attributes["aria-label"], "快速填色层级");
});
