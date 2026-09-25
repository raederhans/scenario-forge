import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeCityLocalizationData, normalizeCityFeatureCollection, normalizeScenarioCityOverridesPayload } from "../js/core/data_loader.js";
import { state as runtimeState } from "../js/core/state.js";
import { syncScenarioLocalizationState } from "../js/core/scenario_localization_state.js";
import { getStrictGeoLabel, getPreferredGeoLabel } from "../js/core/i18n.js";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import { createCityLabelTextModel } from "../js/core/renderer/city_label_text_model.js";
import * as policy from "../js/core/renderer/city_reveal_policy.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const base = normalizeCityFeatureCollection(read("../data/world_cities.geojson"));
const baseLocalization = mergeCityLocalizationData({
  locales: read("../data/locales.json"), cityCollection: base,
  cityAliases: read("../data/city_aliases.json"),
});

for (const scenarioId of ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962", "blank_base"]) {
  test(`${scenarioId}: every active capital resolves to the saved point in an owned feature`, () => {
    const directory = `../data/scenarios/${scenarioId}/`;
    const rawOverrides = read(`${directory}city_overrides.json`);
    const manifest = read(`${directory}manifest.json`);
    const overrides = normalizeScenarioCityOverridesPayload(rawOverrides);
    const countries = read(`${directory}countries.json`).countries;
    const owners = read(`${directory}owners.by_feature.json`).owners;
    const state = Object.assign(runtimeState, {
      activeScenarioId: scenarioId, currentLanguage: "zh", worldCitiesData: base,
      scenarioCityOverridesData: overrides, scenarioCountriesByTag: countries, sovereigntyByFeatureId: owners,
      baseGeoLocales: baseLocalization.locales.geo,
      baseGeoAliasToStableKey: baseLocalization.geoAliases.alias_to_stable_key,
      ruCityOverrides: null,
    });
    syncScenarioLocalizationState({ cityOverridesPayload: overrides,
      geoLocalePatchPayload: manifest.geo_locale_patch_url ? read(`../${manifest.geo_locale_patch_url}`) : null });
    const labels = createCityLabelTextModel(state, { getStrictGeoLabel, getPreferredGeoLabel });
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
    for (const language of ["en", "zh"]) {
      state.currentLanguage = language;
      for (const [cityId, raw] of Object.entries(rawOverrides.cities)) {
        const city = cities.get(cityId);
        if (!city) continue;
        const label = labels.getCityDisplayLabel(city);
        assert.ok(label && !/^(?:id::)?CITY::/.test(label), `${scenarioId}/${language}/${cityId}: ${label}`);
        if (raw.display_name?.[language]) {
          assert.equal(label, labels.formatCityMapLabel(raw.display_name[language], { entry: { feature: city } }), cityId);
        } else if (!raw.display_name && !raw.name && !raw.name_en && !raw.name_zh && raw.host_feature_id) {
          const stableKey = city.properties.__city_stable_key;
          assert.equal(label, labels.formatCityMapLabel(baseLocalization.locales.geo[stableKey][language], { entry: { feature: city } }), cityId);
        }
      }
    }
    state.currentLanguage = "zh";
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
    syncScenarioLocalizationState({ cityOverridesPayload: null, geoLocalePatchPayload: null });
    assert.deepEqual(state.locales.geo, baseLocalization.locales.geo);
    const restored = owner.getEffectiveCityCollection();
    assert.equal(restored.features.length, base.features.length);
    assert.equal(restored.features.some((f) => f.properties.__city_id === "CITY::scenario::cherdyn"), false);
  });
}
