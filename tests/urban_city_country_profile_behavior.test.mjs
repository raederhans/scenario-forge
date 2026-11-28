import test from "node:test";
import assert from "node:assert/strict";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import { getCityCanonicalId, getCityTierWeight } from "../js/core/renderer/city_reveal_policy.js";

function city(id, host, properties = {}) {
  return { id, properties: { city_id: id, host_feature_id: host, ...properties } };
}

function harness(state = {}) {
  const owner = createUrbanCityPolicyOwner({
    state,
    helpers: {
      getCityCanonicalId,
      getCityFeatureKey: feature => feature.id,
      getCityTierWeight,
    },
  });
  return { owner };
}

test("country grouping preserves scenario, country code, host and city precedence", () => {
  const { owner } = harness({ sovereigntyByFeatureId: { host: " a " } });
  assert.equal(owner.getCityCountryGroupKey(city("one", "host", { country_code: "gb" })), "tag:A");
  assert.equal(owner.getCityCountryGroupKey(city("two", "other", { country_code: " gb " })), "cc:GB");
  assert.equal(owner.getCityCountryGroupKey(city("three", " other ")), "host:other");
  assert.equal(owner.getCityCountryGroupKey(city("four", "")), "city:four");
  assert.equal(owner.getCityCountryGroupKey({ id: "fallback", properties: {} }), "city:fallback");
});

test("country profiles resolve tiers for cities without population", () => {
  const { owner } = harness({
    sovereigntyByFeatureId: { a: "A", b: "B" },
    activeScenarioManifest: { default_country: "A", featured_tags: [] },
    scenarioCountriesByTag: { A: { controller_feature_count: 1 }, B: { controller_feature_count: 1 } },
  });
  const collection = { features: [city("a", "a"), city("b", "b")] };
  const first = owner.getCityCountryProfileIndex(collection);
  assert.equal(first.get("tag:A").countryTier, "A");
  assert.equal(first.get("tag:B").countryTier, "D");
});
