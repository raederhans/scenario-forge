import test from "node:test";
import assert from "node:assert/strict";
import { state, registerRuntimeHook } from "../js/core/state.js";
import { placeProjectCapital } from "../js/core/capital_commands.js";
import { commitScenarioForProjectImport } from "../js/core/scenario_manager.js";

function setup() {
  Object.assign(state, { bootBlocking: false, activeScenarioId: "sample", scenarioCountriesByTag: { AA: {} },
    currentLanguage: "zh", capitalOverrides: {}, projectCities: [], cityNameOverrides: {},
    historyPast: [], historyFuture: [], landIndex: new Map([["land", { id: "land" }]]) });
  registerRuntimeHook(state, "resolveBorderIdentityFn", id => id === "land" ? "AA" : "BB");
}

test("scenario activation clears project capitals and cities before the project patch commits", () => {
  setup();
  const id = placeProjectCapital("AA", { name: { en: "Port" }, lon: 1, lat: 2, hostFeatureId: "land" });
  assert.ok(id);
  const prepared = { bundle: { manifest: { scenario_id: "next" } },
    staged: { scenarioId: "next", mapSemanticMode: "blank", countryMap: {}, resolvedOwners: {}, cores: {} } };
  const check = () => {
    assert.equal(state.activeScenarioId, "next");
    assert.deepEqual(state.projectCities, []);
    assert.deepEqual(state.capitalOverrides, {});
  };
  commitScenarioForProjectImport(prepared, check, () => true);
});
