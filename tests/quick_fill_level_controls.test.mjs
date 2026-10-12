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
  const controller = createQuickFillLevelControls({
    getModel: () => getQuickFillLevelModel(s),
    getSelectLabel: () => String(s.currentLanguage || "en").startsWith("zh") ? "快速填色层级" : "Quick fill level",
    container,
    onChange: (scope) => { changes++; setBatchFillScopeState(s, scope); },
  });
  controller.refresh(); controller.refresh();
  assert.equal(container.children.length, 1);
  const select = container.children[0]; select.value = "level:department"; select.events.change();
  assert.equal(changes, 1); assert.equal(s.batchFillScope, "level:department");
  s.currentLanguage = "zh"; controller.refresh();
  assert.equal(select.attributes["aria-label"], "快速填色层级");
  assert.deepEqual(select.children.map((option) => option.value), ["parent", "level:department", "level:region", "country"]);
  assert.equal(select.children[0].textContent, "默认上级");
  s.selectedInspectorCountryCode = "US";
  controller.refresh();
  assert.deepEqual(select.children.map((option) => option.value), ["parent", "country", "level:department"]);
  assert.equal(select.children[2].disabled, true);
  assert.equal(select.value, "level:department");
  select.value = "unsupported";
  select.events.change();
  assert.equal(changes, 2);
  assert.equal(s.batchFillScope, "parent");
});

test("missing container still reads a fresh model without requesting a DOM label", () => {
  const s = state();
  let reads = 0;
  const controller = createQuickFillLevelControls({
    getModel: () => { reads++; return getQuickFillLevelModel(s); },
    getSelectLabel: () => assert.fail("No select exists"),
    container: null,
    onChange: () => assert.fail("No change event exists"),
  });
  assert.equal(controller.refresh().selected, "parent");
  s.batchFillScope = "country";
  s.currentLanguage = "zh";
  const model = controller.refresh();
  assert.equal(model.selected, "country");
  assert.equal(model.options.at(-1).label, "全国");
  assert.equal(reads, 2);
});

test("level models return detached options and leave hierarchy snapshots unchanged", () => {
  const s = state();
  const model = getQuickFillLevelModel(s);
  model.options[1].label = "changed";
  model.options.push({ value: "injected" });
  const next = getQuickFillLevelModel(s);
  assert.equal(next.options[1].label, "Department");
  assert.equal(next.options.length, 4);
  assert.equal(s.hierarchyData.quick_fill.countries.FR.levels.department.label, "Department");
});
