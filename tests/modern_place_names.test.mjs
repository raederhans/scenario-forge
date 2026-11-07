import test from "node:test";
import assert from "node:assert/strict";
import { createCityLabelTextModel } from "../js/core/renderer/city_label_text_model.js";
import { createUrbanCityPolicyOwner, getUrbanCityRenderPassSignatureParts } from "../js/core/renderer/urban_city_policy.js";
import { formatModernPlaceName, formatCityVictoryPoints } from "../js/core/renderer/modern_place_name.js";

function fixture() {
  const base = { id: "city", properties: {
    name_en: "Wrocław", name_zh: "弗罗茨瓦夫",
    __city_locale: { en: "Wrocław", zh: "弗罗茨瓦夫" },
  } };
  const state = {
    currentLanguage: "en", activeScenarioId: "historical",
    worldCitiesData: { features: [base] },
    scenarioCityOverridesData: { cities: { city: { city_id: "city", display_name: { en: "Breslau", zh: "布雷斯劳" } } } },
  };
  const model = createCityLabelTextModel(state, {
    getStrictGeoLabel: () => "", getPreferredGeoLabel: () => "",
  });
  const owner = createUrbanCityPolicyOwner({ state, caches: { cityLayerCache: {} }, helpers: {
    getCityFeatureKey: model.getCityFeatureKey,
    getCityFeatureAliases: model.getCityFeatureAliases,
    getCityCanonicalId: (feature) => feature.id,
    getCityTier: () => "minor", getDefaultCityMinZoomForTier: () => 2.9,
  } });
  return { state, model, base, feature: owner.getEffectiveCityCollection().features[0] };
}

test("scenario names retain base names and toggle live in both languages", () => {
  const { state, model, feature, base } = fixture();
  assert.equal(model.getCityDisplayLabel(feature), "Breslau");
  state.showModernPlaceNames = true;
  assert.equal(model.getCityDisplayLabel(feature), "Breslau (Wrocław)");
  state.currentLanguage = "zh";
  assert.equal(model.getCityDisplayLabel(feature), "布雷斯劳（今弗罗茨瓦夫）");
  assert.equal(model.getCityDisplayLabel(feature, { showModernPlaceNames: false }), "布雷斯劳");
  state.showModernPlaceNames = false;
  assert.equal(model.getCityDisplayLabel(feature), "布雷斯劳");
  assert.equal(base.properties.name_en, "Wrocław");
});

test("unchanged names and cities without overrides have no annotation", () => {
  const { state, model, feature, base } = fixture();
  state.showModernPlaceNames = true;
  for (const language of ["en", "zh"]) {
    state.currentLanguage = language;
    const modern = base.properties.__city_locale[language];
    assert.equal(model.getCityDisplayLabel(base), modern);
    feature.properties.__city_display_name_override[language] = modern;
    assert.equal(model.getCityDisplayLabel(feature), modern);
  }
});

test("shared place-name formatter supports future parcel comparisons", () => {
  assert.equal(formatModernPlaceName("Breslau", "Wrocław", "en"), "Breslau (Wrocław)");
  assert.equal(formatModernPlaceName("布雷斯劳", "弗罗茨瓦夫", "zh"), "布雷斯劳（今弗罗茨瓦夫）");
  assert.equal(formatModernPlaceName("London", "London", "en"), "London");
  assert.equal(formatModernPlaceName("伦敦", "伦敦", "zh"), "伦敦");
  assert.equal(formatModernPlaceName("London", "", "en"), "London");
});

test("label pass signature changes with the toggle", () => {
  const state = {};
  const before = getUrbanCityRenderPassSignatureParts(state, "labels");
  state.showModernPlaceNames = false;
  assert.deepEqual(getUrbanCityRenderPassSignatureParts(state, "labels"), before);
  state.showModernPlaceNames = true;
  assert.notDeepEqual(getUrbanCityRenderPassSignatureParts(state, "labels"), before);
});

test("victory points annotate mismatches and ignore diacritics", () => {
  assert.equal(formatCityVictoryPoints(10, "Stalino", "Shahrixon", "en"), "Victory points: 10 (Stalino)");
  assert.equal(formatCityVictoryPoints(10, "Stalino", "沙赫里汉", "zh"), "胜利点：10（Stalino）");
  assert.equal(formatCityVictoryPoints(10, "Munchen", "München", "en"), "Victory points: 10");
  assert.equal(formatCityVictoryPoints(10, "伦敦", "伦敦", "zh"), "胜利点：10");
  assert.equal(formatCityVictoryPoints(undefined, "", "London", "en"), "");
  assert.equal(formatCityVictoryPoints(0, "", "London", "en"), "");
  const { state, model, feature } = fixture();
  feature.properties.__city_scenario_victory_points = 10;
  feature.properties.__city_scenario_vp_name = "Stalino";
  assert.equal(model.getCityDisplayLabel(feature), "Breslau");
  state.showModernPlaceNames = true;
  assert.equal(model.getCityDisplayLabel(feature), "Breslau (Wrocław)");
});
