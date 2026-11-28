import test from "node:test";
import assert from "node:assert/strict";
import { state, registerRuntimeHook } from "../js/core/state.js";
import { addProjectCity, listCountryCities } from "../js/core/capital_overrides.js";
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

test("旧城市按坐标恢复失效的宿主", () => {
  const id = "project_city_1";
  state.projectCities = [{ ...point, id, hostFeatureId: "obsolete" }];
  assert.ok(listCountryCities(state, "AA", options).some(entry => entry.id === id && entry.inTerritory));
});

test("新城市跳过旧改名及可从历史恢复的编号", () => {
  state.cityNameOverrides = { project_city_1: { en: "Old" } };
  state.historyFuture = [{ after: { projectCities: [{ id: "project_city_2" }] } }];
  assert.equal(addProjectCity(state, { ...point, hostFeatureId: "land" }), "project_city_3");
});
