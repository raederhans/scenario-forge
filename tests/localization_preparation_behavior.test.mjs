import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prepareScenarioLocalizationState, syncScenarioLocalizationStateAsync } from "../js/core/scenario/scenario_localization_state.js";
import { state } from "../js/core/state.js";

const LOCALIZATION_RUNTIME_KEYS = Object.freeze([
  "activeScenarioId", "activeScenarioManifest", "currentLanguage", "cityLayerRevision",
  "baseGeoLocales", "baseGeoAliasToStableKey", "baseCityAliasesData", "worldCitiesData", "ruCityOverrides",
  "scenarioCityOverridesData", "scenarioGeoLocalePatchData", "locales", "geoAliasToStableKey",
]);

let savedRuntimeState = null;
beforeEach(() => {
  savedRuntimeState = { ...state };
});
afterEach(() => {
  for (const key of Object.keys(state)) {
    if (!Object.hasOwn(savedRuntimeState, key)) delete state[key];
  }
  Object.assign(state, savedRuntimeState);
});

function bindRuntimeState(fields) {
  for (const key of LOCALIZATION_RUNTIME_KEYS) state[key] = undefined;
  return Object.assign(state, fields);
}

function optionalCityFixture() {
  const snapshot = {
    activeScenarioId: "optional-city", cityLayerRevision: 0,
    baseGeoLocales: Object.fromEntries(Array.from({ length: 768 }, (_, i) => [`base-${i}`, { en: `Base ${i}` }])),
    baseGeoAliasToStableKey: { alias: "base-0" },
    worldCitiesData: { features: [{ id: "source", properties: { host_feature_id: "HOST" } }] },
    ruCityOverrides: null, scenarioCityOverridesData: null,
    scenarioGeoLocalePatchData: { geo: { EXPLICIT: { en: "Explicit" } } },
    locales: { ui: { old: "UI" }, geo: { old: { en: "Old" } } },
    geoAliasToStableKey: { old: "old" },
  };
  const payload = { cities: { source: { city_id: "source", display_name: { en: "New city" } } } };
  let clock = 0;
  return { snapshot, payload, options: { nowMs: () => ++clock, sliceBudgetMs: 1 } };
}

test("city edits during async preparation cancel publication and preserve the edit", async () => {
  const { snapshot: fields, payload, options } = optionalCityFixture();
  const snapshot = bindRuntimeState(fields);
  const editedCity = { cities: { edit: { display_name: { en: "Edited" } } } };
  let yields = 0;
  assert.equal(await syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, {
    ...options, yieldControl: async () => {
      if (++yields !== 2) return;
      snapshot.scenarioCityOverridesData = editedCity;
      snapshot.cityLayerRevision++;
    },
  }), false);
  assert.equal(snapshot.scenarioCityOverridesData, editedCity);
  assert.equal(snapshot.cityLayerRevision, 1);
  assert.deepEqual(snapshot.locales.geo, { old: { en: "Old" } });
});

test("scenario-scoped merges point member aliases at the merged feature only in that scenario", async () => {
  // RU_D, RU_E -> RU_MRG_S, then RU_MRG_S, RU_G -> RU_MRG_T, both scoped to TNO.
  const baseAliasMap = { Zmeinogorsky: "id::RU_D", "Old merge": "id::RU_MRG_S", Barnaul: "id::RU_F" };
  const overrides = { feature_merges: { RU_MRG_T: ["RU_D", "RU_E", "RU_G"] }, feature_redirects: { RU_MRG_S: "RU_MRG_T" } };
  const options = { yieldControl: async () => {} };
  const tno = await prepareScenarioLocalizationState({
    activeScenarioId: "tno_1962", activeScenarioManifest: { hierarchy_overrides: overrides },
  }, { baseGeoLocales: {}, baseAliasMap }, options);
  assert.deepEqual(tno.aliasToStableKey, { Zmeinogorsky: "id::RU_MRG_T", "Old merge": "id::RU_MRG_T", Barnaul: "id::RU_F" });
  const hoi4 = await prepareScenarioLocalizationState({ activeScenarioId: "hoi4_1936", activeScenarioManifest: {} },
    { baseGeoLocales: {}, baseAliasMap }, options);
  assert.deepEqual(hoi4.aliasToStableKey, baseAliasMap);
  assert.equal(baseAliasMap.Zmeinogorsky, "id::RU_D");
});

test("explicit alias redirects take priority over merged members", async () => {
  const stableKeys = ["id::RU_D", "id::RU_E", "id::RU_OLD", "id::RU_KEEP", "plain-alias"];
  const baseAliasMap = Object.fromEntries(stableKeys.map((key, index) =>
    [`alias-${index}`, key]));
  const snapshot = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { hierarchy_overrides: {
      feature_merges: { RU_MERGED: ["RU_D", "RU_E"] },
      feature_redirects: { RU_OLD: "RU_MERGED", RU_D: "RU_FINAL" },
    } },
    baseGeoLocales: {}, baseGeoAliasToStableKey: baseAliasMap,
    locales: { ui: {}, geo: {} },
  };
  const result = await prepareScenarioLocalizationState(snapshot);
  assert.equal(result.aliasToStableKey["alias-0"], "id::RU_FINAL");
  assert.equal(result.aliasToStableKey["alias-1"], "id::RU_MERGED");
  assert.equal(result.aliasToStableKey["alias-2"], "id::RU_MERGED");
  assert.equal(result.aliasToStableKey["alias-3"], "id::RU_KEEP");
  assert.equal(result.aliasToStableKey["alias-4"], "plain-alias");
  assert.equal(baseAliasMap["alias-0"], "id::RU_D");
});
