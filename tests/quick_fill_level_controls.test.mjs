import test from "node:test";
import assert from "node:assert/strict";
import { getQuickFillLevelModel } from "../js/ui/toolbar/quick_fill_level_controls.js";

import { setBatchFillScopeState } from "../js/core/state/actions/scenario_presentation_actions.js";

function state() {
  return { selectedInspectorCountryCode: "FR", hierarchyData: { groups: { FR_region: ["a"] }, quick_fill: { countries: {
    FR: { levels: { department: { label: "Department", groups: {} }, region: { label: "Region", alias: "parent" } } },
  } } }, batchFillScope: "parent" };
}

test("scenario owner tags do not get mistaken for geographic country codes", () => {
  const s = state(); s.activeScenarioId = "hoi4_1936"; s.selectedInspectorCountryCode = "FRA";
  s.devSelectedHit = { id: "a", targetType: "land" };
  s.landIndex = new Map([["a", { properties: { id: "a", cntr_code: "FR" } }]]);
  assert.ok(setBatchFillScopeState(s, "level:department"));
  assert.equal(getQuickFillLevelModel(s).selected, "level:department");
  const model = getQuickFillLevelModel(s);
  assert.equal(model.countryCode, "FR");
});
