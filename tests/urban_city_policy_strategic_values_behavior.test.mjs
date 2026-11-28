import test from "node:test";
import assert from "node:assert/strict";
import * as cityPolicy from "../js/core/renderer/city_reveal_policy.js";
import { getCityRevealPhase } from "../js/core/renderer/city_reveal_policy.js";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";

function createCityFeature(id, hostFeatureId, extraProps = {}) {
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [13.4, 52.5] },
    properties: {
      city_id: id,
      stable_key: id,
      __city_host_feature_id: hostFeatureId,
      __city_population: 1000,
      ...extraProps,
    },
  };
}

function createOwner(state) {
  const helpers = {
    getCityCanonicalId: (feature) => String(feature?.properties?.city_id || feature?.id || "").trim(),
    getCityFeatureAliases: (feature, key) => new Set([
      key,
      feature?.id,
      feature?.properties?.city_id,
      feature?.properties?.stable_key,
      feature?.properties?.__city_stable_key,
    ].map((value) => String(value || "").trim()).filter(Boolean)),
    getCityFeatureKey: (feature, fallback = "") => String(
      feature?.id
      || feature?.properties?.city_id
      || feature?.properties?.stable_key
      || fallback
    ).trim(),
    getCityCapitalScore: () => 0,
    getCityTier: cityPolicy.getCityTier,
    getCityTierWeight: () => 1,
    getDefaultCityMinZoomForTier: cityPolicy.getDefaultCityMinZoomForTier,
  };
  return createUrbanCityPolicyOwner({
    state,
    caches: {
      cityLayerCache: {},
      urbanFeatureIndexCache: {},
    },
    helpers,
  });
}

function scenarioCapitals() {
  const base = [
    createCityFeature("kyoto", "JP", { __city_is_capital: true, __city_is_country_capital: true }),
    createCityFeature("tokyo", "JP", { __city_is_capital: false, __city_is_country_capital: false }),
  ];
  const state = {
    activeScenarioId: "test", worldCitiesData: { features: base },
    scenarioCountriesByTag: { JAP: { feature_count: 1 } },
    sovereigntyByFeatureId: { JP: "JAP" },
    scenarioCityOverridesData: { capitals_by_tag: { JAP: "tokyo" } },
  };
  const owner = createOwner(state);
  return owner.getEffectiveCityCollection().features;
}

test("scenario capitals promote regional cities", () => {
  const scenario = scenarioCapitals();
  assert.equal(scenario[1].properties.__city_is_country_capital, true);
  assert.equal(scenario[1].properties.__city_is_capital, true);
});

test("scenario capitals demote the original modern capital", () => {
  const scenario = scenarioCapitals();
  assert.equal(scenario[0].properties.__city_is_country_capital, false);
});

function createRevealFixture(features) {
  const state = { urbanData: null };
  state.sovereigntyByFeatureId = Object.fromEntries(features.map(feature => [
    feature.properties.__city_host_feature_id, "TEST",
  ]));
  state.scenarioCountriesByTag = { TEST: { controller_feature_count: 150 } };
  const helpers = {
    ...cityPolicy,
    defaultCityCountryClassRank: 2,
    defaultCityCountryTierRank: 2,
    getCityAnchor: (feature) => feature.geometry.coordinates,
    getCityFeatureKey: (feature) => feature.id,
    getCityInterpolatedRevealBucket: (entry, scale) => cityPolicy.getCityRevealBucket(entry, getCityRevealPhase(scale).id),
    getCityScreenPoint: (anchor) => anchor,
    getCityViewportCenterDistanceNorm: () => 0,
    isCityAnchorInViewport: () => true,
  };
  const owner = createUrbanCityPolicyOwner({ state, caches: { urbanFeatureIndexCache: {} }, helpers });
  const collection = { features }, config = { showLabels: true, labelMinZoom: 1.45 };
  const build = (scale) => owner.buildCityRevealPlan(collection, scale, {}, config);
  return build;
}

test("actual reveal plan ranks a matching strategic city ahead of a larger same-tier city", () => {
  const features = [
    { ...createCityFeature("large", "host", { __city_base_tier: "major", __city_population: 1000000 }), geometry: { type: "Point", coordinates: [0, 0] } },
    { ...createCityFeature("strategic", "host", { __city_base_tier: "major", __city_settlement_rank: "large", __city_population: 100000, __city_scenario_victory_points: 50 }), geometry: { type: "Point", coordinates: [60, 0] } },
  ];
  assert.deepEqual(createRevealFixture(features)(5).markerEntries.map((entry) => entry.cityId), ["strategic", "large"]);
});
