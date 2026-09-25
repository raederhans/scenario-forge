import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCityFeatureCollection, normalizeScenarioCityOverridesPayload } from "../js/core/data_loader.js";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import { createCityLabelTextModel } from "../js/core/renderer/city_label_text_model.js";
import * as policy from "../js/core/renderer/city_reveal_policy.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const base = normalizeCityFeatureCollection(read("../data/world_cities.geojson"));

for (const scenarioId of ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"]) {
  test(`${scenarioId}: every active capital resolves to the saved point in an owned feature`, () => {
    const directory = `../data/scenarios/${scenarioId}/`;
    const overrides = normalizeScenarioCityOverridesPayload(read(`${directory}city_overrides.json`));
    const countries = read(`${directory}countries.json`).countries;
    const owners = read(`${directory}owners.by_feature.json`).owners;
    const state = {
      activeScenarioId: scenarioId, currentLanguage: "zh", worldCitiesData: base,
      scenarioCityOverridesData: overrides, scenarioCountriesByTag: countries, sovereigntyByFeatureId: owners,
    };
    const labels = createCityLabelTextModel(state, { getStrictGeoLabel: () => "", getPreferredGeoLabel: (_keys, fallback) => fallback });
    const owner = createUrbanCityPolicyOwner({ state, caches: { cityLayerCache: {} }, helpers: {
      getCityCanonicalId: (f) => f.properties.__city_id,
      getCityFeatureKey: labels.getCityFeatureKey,
      getCityFeatureAliases: labels.getCityFeatureAliases,
      getCityCapitalScore: policy.getCityCapitalScore,
      getCityTier: policy.getCityTier,
      getCityTierWeight: policy.getCityTierWeight,
      getDefaultCityMinZoomForTier: policy.getDefaultCityMinZoomForTier,
    } });
    const effective = owner.getEffectiveCityCollection();
    const cities = new Map(effective.features.map((f) => [f.properties.__city_id, f]));
    for (const [tag, country] of Object.entries(countries)) {
      if (!country.feature_count) continue;
      const hint = overrides.capital_city_hints[tag];
      assert.ok(hint, `${tag}: missing capital decision`);
      if (hint.resolution_method === "no_capital") continue;
      const cityId = overrides.capitals_by_tag[tag] || hint.city_id;
      const city = cities.get(cityId);
      assert.ok(city, `${tag}: capital not present in runtime collection`);
      assert.equal(city.properties.__city_is_country_capital, true, tag);
      assert.equal(owner.getCityScenarioTag(city), tag, `${tag}: capital belongs to another country`);
      assert.equal(hint.host_feature_id, city.properties.__city_host_feature_id, tag);
      // Unadjusted city geometry is rounded to four decimals in the shared file.
      assert.ok(Math.abs(city.geometry.coordinates[0] - hint.lon) < 0.0001, tag);
      assert.ok(Math.abs(city.geometry.coordinates[1] - hint.lat) < 0.0001, tag);
      if (overrides.cities[cityId]?.display_name?.zh) {
        assert.equal(labels.getCityDisplayLabel(city), overrides.cities[cityId].display_name.zh, tag);
      }
    }
    state.activeScenarioId = "";
    state.scenarioCityOverridesData = null;
    const restored = owner.getEffectiveCityCollection();
    assert.equal(restored.features.length, base.features.length);
    assert.equal(restored.features.some((f) => f.properties.__city_id === "CITY::scenario::cherdyn"), false);
  });
}
