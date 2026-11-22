import test from "node:test";
import assert from "node:assert/strict";
import { state, registerRuntimeHook } from "../js/core/state.js";
import { placeProjectCapital } from "../js/core/capital_commands.js";
import { addProjectCity, findCapitalCityFeature, listCountryCities, setCapitalOverride } from "../js/core/capital_overrides.js";
import { createCapitalVisibility } from "../js/core/renderer/capital_visibility.js";
import { resetToScenarioBaseline, commitScenarioForProjectImport } from "../js/core/scenario_manager.js";
import { d3, feature, rectangle } from "./helpers/river_paint_fixture.mjs";

const point = { name: { en: "Port", zh: "港口" }, lon: 1, lat: 1, hostFeatureId: "" };
const options = { resolveBorderIdentity: id => state.sovereigntyByFeatureId[id] };

test.beforeEach(() => {
  globalThis.d3 = d3;
  Object.assign(state, {
    activeScenarioId: "sample", bootBlocking: false, projectCities: [], capitalOverrides: {},
    cityNameOverrides: {}, historyPast: [], historyFuture: [], worldCitiesData: { features: [] },
    scenarioCountriesByTag: { AA: { feature_count: 0 }, BB: {} },
    sovereigntyByFeatureId: { land: "AA", foreign: "BB" },
    landIndex: new Map([["land", feature("land", rectangle(0, 0, 2, 2))],
      ["foreign", feature("foreign", rectangle(3, 0, 5, 2))]]),
  });
  registerRuntimeHook(state, "resolveBorderIdentityFn", options.resolveBorderIdentity);
});

test("地图取点拒绝海面和他国领土，并为本国取点保存宿主", () => {
  assert.equal(placeProjectCapital("AA", { ...point, lon: 10 }), false);
  assert.equal(addProjectCity(state, { ...point, lon: 10 }), false);
  assert.equal(placeProjectCapital("AA", { ...point, lon: 4 }), false);
  assert.deepEqual(state.projectCities, []);
  assert.deepEqual(state.historyPast, []);
  assert.ok(placeProjectCapital("AA", point));
  assert.equal(state.projectCities[0].hostFeatureId, "land");
});

for (const hostFeatureId of ["obsolete", ""]) {
  test(`旧城市按坐标恢复宿主（${hostFeatureId || "空宿主"}）并随占领隐藏星标`, () => {
    const id = "project_city_1";
    state.projectCities = [{ ...point, id, hostFeatureId }];
    const visibility = createCapitalVisibility({ state, ...options });
    assert.ok(listCountryCities(state, "AA", options).some(entry => entry.id === id && entry.inTerritory));
    assert.ok(setCapitalOverride(state, "AA", id, options));
    const city = findCapitalCityFeature(state, id);
    assert.ok(visibility.isCapitalVisible(city));
    state.sovereigntyByFeatureId.land = "BB";
    state.sovereigntyByFeatureId.foreign = "AA";
    assert.equal(visibility.isCapitalVisible(city), false);
  });
}

test("新城市跳过旧改名及可从历史恢复的编号", () => {
  state.cityNameOverrides = { project_city_1: { en: "Old" } };
  state.historyFuture = [{ after: { projectCities: [{ id: "project_city_2" }] } }];
  assert.equal(addProjectCity(state, { ...point, hostFeatureId: "land" }), "project_city_3");
});

for (const action of ["reset", "activate"]) {
  test(`${action} 清除项目城市改名并保留基础城市改名`, () => {
    const base = { town: { en: "Custom" } };
    const names = { ...base, project_city_1: { en: "Old" } };
    state.cityNameOverrides = names;
    if (action === "reset") {
      resetToScenarioBaseline({ renderNow: false });
    } else {
      const prepared = { bundle: { manifest: { scenario_id: "next" } },
        staged: { scenarioId: "next", mapSemanticMode: "blank", countryMap: {}, resolvedOwners: {}, cores: {} } };
      assert.throws(() => commitScenarioForProjectImport(prepared, () => {
        assert.deepEqual(state.cityNameOverrides, base);
        throw Error("cancel");
      }, () => true), /cancel/);
      assert.deepEqual(state.cityNameOverrides, names);
      commitScenarioForProjectImport(prepared, () => {}, () => true);
    }
    assert.deepEqual(state.cityNameOverrides, base);
  });
}

test("零基线地块国家可以在取得的城市设都", () => {
  const id = "town";
  state.scenarioCityOverridesData = { capital_city_hints: { BB: { resolution_method: "no_capital" } } };
  state.worldCitiesData = { features: [{ type: "Feature", id,
    properties: { name: "Town", __city_host_feature_id: "foreign" },
    geometry: { type: "Point", coordinates: [4, 1] } }] };
  const painted = { resolveBorderIdentity: host => host === "foreign" ? "AA" : state.sovereigntyByFeatureId[host] };
  assert.equal(findCapitalCityFeature(state, id).properties.__city_is_capital, false);
  assert.ok(setCapitalOverride(state, "AA", id, painted));
  assert.deepEqual(findCapitalCityFeature(state, id).properties.__city_capital_tags, ["AA"]);
});
