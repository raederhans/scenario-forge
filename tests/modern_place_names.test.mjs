import test from "node:test";
import assert from "node:assert/strict";
import { createCityLabelTextModel } from "../js/core/renderer/city_label_text_model.js";
import { createUrbanCityPolicyOwner, getUrbanCityRenderPassSignatureParts } from "../js/core/renderer/urban_city_policy.js";
import { formatModernPlaceName, formatCityVictoryPoints, listRenamedPlacesInFeatures } from "../js/core/renderer/modern_place_name.js";

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

test("only real renames get a modern-name annotation", async () => {
  const { isRenamedPlace } = await import("../js/core/renderer/modern_place_name.js");
  assert.equal(isRenamedPlace("Breslau", "Wrocław"), true);
  assert.equal(isRenamedPlace("Vaduz", "Vaduz"), false);
  assert.equal(isRenamedPlace("Rhodes", "Rhodes"), false);
  assert.equal(isRenamedPlace("Gdańsk", "Gdansk"), false);
  assert.equal(isRenamedPlace("Saint Helier", ""), false);
});

test("renamed places in selected features list era and present-day names by population", () => {
  const city = (host, era, modern, population, extra = {}) => ({ properties: {
    __city_host_feature_id: host, __city_population: population,
    __city_display_name_override: era, __city_base_display_name: modern, ...extra,
  } });
  const cities = [
    city("a", { en: "Tilsit", zh: "蒂尔西特" }, { en: "Sovetsk", zh: "苏维埃茨克" }, 40000),
    city("a", { en: "Königsberg", zh: "柯尼斯堡" }, { en: "Kaliningrad", zh: "加里宁格勒" }, 370000),
    city("a", { en: "Torino", zh: "都灵" }, { en: "Turin", zh: "都灵" }, 600000),
    city("a", { en: "Kiew", zh: "基辅" }, { en: "Kiev", zh: "基辅" }, 800000),
    city("b", { en: "Memel", zh: "梅梅尔" }, { en: "Klaipėda", zh: "克莱佩达" }, 50000),
    city("a", { en: "Hidden", zh: "隐藏" }, { en: "Shown", zh: "显示" }, 1, { __city_hidden: true }),
    city("a", null, { en: "Gdańsk", zh: "格但斯克" }, 450000),
  ];
  assert.deepEqual(listRenamedPlacesInFeatures(cities, ["a"], "zh"), {
    entries: [
      { eraName: "柯尼斯堡", modernName: "加里宁格勒" },
      { eraName: "蒂尔西特", modernName: "苏维埃茨克" },
    ],
    total: 2,
  });
  // 英文名不同即算改名；中文两边同名（都灵、基辅）时与地图标签一样不括注。
  const both = listRenamedPlacesInFeatures(cities, ["a", "b"], "en", { limit: 2 });
  assert.deepEqual(both, {
    entries: [{ eraName: "Kiew", modernName: "Kiev" }, { eraName: "Torino", modernName: "Turin" }],
    total: 5,
  });
  assert.deepEqual(listRenamedPlacesInFeatures(cities, [], "en"), { entries: [], total: 0 });
  assert.deepEqual(listRenamedPlacesInFeatures(null, ["a"], "en"), { entries: [], total: 0 });
});
