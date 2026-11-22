import test from "node:test";
import assert from "node:assert/strict";
import { state, registerRuntimeHook } from "../js/core/state.js";
import { placeProjectCapital, removeProjectCity, resetCountryCapital, setCountryCapital } from "../js/core/capital_commands.js";
import { getHistoryActionLabel } from "../js/core/history_action_labels.js";
import { undoHistory, redoHistory } from "../js/core/history_manager.js";
import { clearActiveScenario, commitScenarioForProjectImport, resetToScenarioBaseline } from "../js/core/scenario_manager.js";

function setup() {
  Object.assign(state, { bootBlocking: false, activeScenarioId: "sample", scenarioCountriesByTag: { AA: {} },
    currentLanguage: "zh", capitalOverrides: {}, projectCities: [], cityNameOverrides: {},
    historyPast: [], historyFuture: [], landIndex: new Map([["land", { id: "land" }]]) });
  registerRuntimeHook(state, "resolveBorderIdentityFn", id => id === "land" ? "AA" : "BB");
}

test("capital commands restore the city, its visibility and the capital in a single history step", () => {
  setup();
  const city = { name: { zh: "港口" }, lon: 1, lat: 2, hostFeatureId: "land" };
  assert.equal(placeProjectCapital("AA", { ...city, hostFeatureId: "foreign" }), false);
  assert.deepEqual(state.projectCities, []);
  assert.equal(state.historyPast.length, 0);
  const id = placeProjectCapital("AA", city);
  assert.equal(id, "project_city_1");
  assert.equal(state.historyPast.length, 1);
  assert.deepEqual(state.capitalOverrides, { AA: { cityId: id } });
  assert.ok(undoHistory());
  assert.deepEqual(state.projectCities, []);
  assert.deepEqual(state.capitalOverrides, {});
  assert.ok(redoHistory());
  assert.equal(state.projectCities[0].id, id);
  assert.ok(setCountryCapital("AA", null));
  state.cityNameOverrides = { [id]: { hidden: true, zh: "海港" } };
  assert.ok(setCountryCapital("AA", id));
  assert.equal(getHistoryActionLabel("", state.historyPast.at(-1)), "设定首都 海港");
  assert.deepEqual(state.cityNameOverrides[id], { zh: "海港" });
  assert.ok(undoHistory());
  assert.deepEqual(state.capitalOverrides.AA, { cityId: null });
  assert.deepEqual(state.cityNameOverrides[id], { hidden: true, zh: "海港" });
  assert.ok(redoHistory());
  assert.ok(removeProjectCity(id));
  assert.deepEqual(state.projectCities, []);
  assert.deepEqual(state.cityNameOverrides, {});
  assert.deepEqual(state.capitalOverrides, {});
  assert.ok(undoHistory());
  assert.deepEqual(state.capitalOverrides.AA, { cityId: id });
  assert.deepEqual(state.cityNameOverrides[id], { zh: "海港" });
  assert.ok(resetCountryCapital("AA"));
  assert.deepEqual(state.capitalOverrides, {});
  assert.equal(state.projectCities[0].id, id);
});

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
  assert.throws(() => commitScenarioForProjectImport(prepared, () => { check(); throw Error("cancel"); }, () => true), /cancel/);
  assert.equal(state.activeScenarioId, "sample");
  assert.deepEqual(state.capitalOverrides, { AA: { cityId: id } });
  assert.equal(state.projectCities[0].id, id);
  commitScenarioForProjectImport(prepared, check, () => true);
});

for (const action of [resetToScenarioBaseline, clearActiveScenario]) {
  test(`${action.name} removes project capital decisions and cities`, () => {
    setup();
    assert.ok(placeProjectCapital("AA", { name: { en: "Port" }, lon: 1, lat: 2, hostFeatureId: "land" }));
    action({ renderNow: false });
    assert.deepEqual(state.projectCities, []);
    assert.deepEqual(state.capitalOverrides, {});
  });
}
