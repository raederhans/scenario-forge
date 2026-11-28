import test from "node:test";
import assert from "node:assert/strict";
import { createCountryInspectorModel } from "../js/ui/sidebar/country_inspector_model.js";

const createModel = (state = {}) => createCountryInspectorModel(state, (label) => label);

test("preset and inspector lookups retain distinct precedence and country aliases", () => {
  const state = {
    activeScenarioId: "example",
    scenarioCountriesByTag: {
      CHI: { preset_lookup_code: "CN", release_lookup_iso2: "TW", lookup_iso2: "HK", base_iso2: "MO" },
    },
  };
  const model = createModel(state);
  assert.equal(model.resolveScenarioLookupCode("CHI"), "CN");
  assert.equal(model.resolveInspectorDataCode("CHI"), "TW");
});
