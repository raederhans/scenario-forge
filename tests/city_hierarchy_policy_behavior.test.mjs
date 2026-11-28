import test from "node:test";
import assert from "node:assert/strict";
import * as cityPolicy from "../js/core/renderer/city_reveal_policy.js";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";

function city(id, x, properties = {}) {
  return { type: "Feature", id, geometry: { type: "Point", coordinates: [x, 0] },
    properties: { __city_base_tier: "minor", ...properties } };
}

function plan(features) {
  const profile = { groupKey: "country", countryTier: "A", countryTierRank: 5 };
  const helpers = {
    ...cityPolicy,
    defaultCityCountryClassRank: 2,
    defaultCityCountryTierRank: 2,
    getCityAnchor: (feature) => feature.geometry.coordinates,
    getCityCountryGroupKey: () => "country",
    getCityCountryProfileIndex: () => new Map([["country", profile]]),
    getCityFeatureKey: (feature) => feature.id,
    getCityInterpolatedRevealBucket: (entry, scale) => cityPolicy.getCityRevealBucket(entry, cityPolicy.getCityRevealPhase(scale).id),
    getCityScreenPoint: anchor => anchor,
    getCityViewportCenterDistanceNorm: () => 0,
    isCityAnchorInViewport: () => true,
  };
  const owner = createUrbanCityPolicyOwner({ state: { activeScenarioId: "" },
    caches: { urbanFeatureIndexCache: {} }, helpers });
  return owner.buildCityRevealPlan({ features }, 12, {}, {});
}

test("explicit settlement rank wins over population", () => {
  const explicit = city("explicit", 0, { settlement_rank: "town", __city_settlement_rank: "medium", __city_population: 10_000_000 });
  assert.equal(cityPolicy.getCitySettlementRank(explicit), "medium");
});

test("historical scenario ignores modern population inference without an explicit rank", () => {
  const feature = city("historic", 0, { __city_base_tier: "major", __city_population: 9_000_000 });
  assert.equal(cityPolicy.getCitySettlementRank(feature, "hoi4_alt"), "large");
  assert.equal(cityPolicy.getCitySettlementRank(feature, "modern_world"), "metropolis");
  assert.equal(cityPolicy.getCitySettlementRank(city("unknown", 0, { __city_base_tier: "regional" }), "hoi4_alt"), "medium");
  assert.equal(cityPolicy.getCitySettlementRank(city("valid-source", 0, {
    __city_settlement_rank: "unknown", settlement_rank: "large", __city_population: 9_000_000,
  }), "hoi4_alt"), "large");
});

test("local selection uses settlement rank, then strategic value, with stable id ties", () => {
  const features = [
    city("z", 0, { __city_settlement_rank: "medium", __city_scenario_victory_points: 50 }),
    city("b", 100, { __city_settlement_rank: "large" }),
    city("a", 200, { __city_settlement_rank: "large" }),
    city("strategic", 300, { __city_settlement_rank: "large", __city_scenario_victory_points: 2 }),
  ];
  assert.deepEqual(plan(features).markerEntries.map((entry) => entry.cityId), ["strategic", "a", "b", "z"]);
});
