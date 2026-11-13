import test from "node:test";
import assert from "node:assert/strict";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import { getCityCanonicalId, getCityTierWeight } from "../js/core/renderer/city_reveal_policy.js";

function city(id, host, properties = {}) {
  return { id, properties: { city_id: id, host_feature_id: host, ...properties } };
}

function harness(state = {}) {
  let computations = 0;
  const owner = createUrbanCityPolicyOwner({
    state,
    helpers: {
      getCityCanonicalId,
      getCityFeatureKey: feature => feature.id,
      getCityTierWeight: feature => { computations++; return getCityTierWeight(feature); },
    },
  });
  return { owner, computations: () => computations };
}

test("country grouping preserves scenario, country code, host and city precedence", () => {
  const { owner } = harness({ sovereigntyByFeatureId: { host: " a " } });
  assert.equal(owner.getCityCountryGroupKey(city("one", "host", { country_code: "gb" })), "tag:A");
  assert.equal(owner.getCityCountryGroupKey(city("two", "other", { country_code: " gb " })), "cc:GB");
  assert.equal(owner.getCityCountryGroupKey(city("three", " other ")), "host:other");
  assert.equal(owner.getCityCountryGroupKey(city("four", "")), "city:four");
  assert.equal(owner.getCityCountryGroupKey({ id: "fallback", properties: {} }), "city:fallback");
  assert.deepEqual(owner.getCityCountryProfileIndex(null), new Map());
  assert.deepEqual(owner.getCityCountryProfileIndex({ features: [] }), new Map());
});

test("same collection follows default-country changes and unchanged dependencies reuse computed profiles", () => {
  const state = {
    sovereigntyByFeatureId: { a: "A", b: "B" },
    activeScenarioManifest: { default_country: "A", featured_tags: [] },
    scenarioCountriesByTag: { A: { controller_feature_count: 1 }, B: { controller_feature_count: 1 } },
  };
  const { owner, computations } = harness(state);
  const collection = { features: [city("a", "a"), city("b", "b")] };
  const first = owner.getCityCountryProfileIndex(collection);
  assert.equal(first.get("tag:A").countryTier, "A");
  assert.equal(first.get("tag:A").isDefaultCountry, true);
  assert.equal(first.get("tag:A").isPriorityCountry, true);
  assert.equal(first.get("tag:B").countryTier, "D");
  assert.equal(owner.getCityCountryProfileIndex(collection), first);
  assert.equal(computations(), 2);

  state.activeScenarioManifest.default_country = " b ";
  const second = owner.getCityCountryProfileIndex(collection);
  assert.notEqual(second, first);
  assert.equal(second.get("tag:A").countryTier, "D");
  assert.equal(second.get("tag:A").countryClass, "micro");
  assert.equal(second.get("tag:A").isDefaultCountry, false);
  assert.equal(second.get("tag:A").isPriorityCountry, false);
  assert.equal(second.get("tag:B").countryTier, "A");
  assert.equal(second.get("tag:B").countryClass, "global_core");
  assert.equal(second.get("tag:B").isDefaultCountry, true);
  assert.equal(second.get("tag:B").isPriorityCountry, true);
  assert.equal(owner.getCityCountryProfileIndex(collection), second);
  assert.equal(computations(), 4);
});

test("featured list and country records invalidate profiles when replaced", () => {
  const state = {
    sovereigntyByFeatureId: { host: "A" },
    activeScenarioManifest: { featured_tags: [] },
    scenarioCountriesByTag: { A: { controller_feature_count: 40 } },
  };
  const { owner, computations } = harness(state);
  const collection = { features: [city("a", "host")] };
  const first = owner.getCityCountryProfileIndex(collection);
  assert.equal(first.get("tag:A").countryTier, "B");
  assert.equal(first.get("tag:A").isFeaturedCountry, false);
  state.activeScenarioManifest.featured_tags = [" a ", "", "A"];
  assert.deepEqual([...owner.getScenarioFeaturedTagSet()], ["A"]);
  const featured = owner.getCityCountryProfileIndex(collection);
  assert.notEqual(featured, first);
  assert.equal(featured.get("tag:A").countryTier, "A");
  assert.equal(featured.get("tag:A").isFeaturedCountry, true);
  assert.equal(featured.get("tag:A").isPriorityCountry, false);
  state.scenarioCountriesByTag = { A: { controller_feature_count: 40, entry_kind: "controller_only", parent_owner_tag: "B" } };
  const subject = owner.getCityCountryProfileIndex(collection);
  assert.notEqual(subject, featured);
  assert.equal(subject.get("tag:A").countryTier, "E");
  assert.equal(subject.get("tag:A").countryClass, "micro_subject");
  assert.equal(owner.getCityCountryProfileIndex(collection), subject);
  assert.equal(computations(), 3);
});

test("profile aggregation preserves its complete return structure and record overrides", () => {
  const state = {
    sovereigntyByFeatureId: { host: "USA" },
    scenarioCountriesByTag: { USA: { tag: "USA", controller_feature_count: 150, featured: true } },
  };
  const { owner } = harness(state);
  const features = [
    city("a", "host", { country_code: "us", __city_population: 2000000, __city_base_tier: "major", __city_is_capital: true }),
    city("b", "host", { country_code: "us", __city_population: 3000000, __city_is_country_capital: true }),
  ];
  assert.deepEqual(owner.getCityCountryProfileIndex({ features }).get("tag:USA"), {
    groupKey: "tag:USA", scenarioTag: "USA", countryCode: "US",
    featureCount: 2, hasCapital: true, hasCountryCapital: true,
    maxPopulation: 3000000, maxTierWeight: 3, controllerFeatureCount: 150,
    countryClass: "global_core", classWeightBias: 0.42, minQuotaFloorBoost: 2,
    countryTier: "A", countryClassRank: 6, countryTierRank: 5,
    isDefaultCountry: false, isFeaturedCountry: true, isPrimaryPower: true,
    isSecondaryPower: false, isPriorityCountry: true,
  });
});

test("country profiles retain population fallback and caches belong to individual owners", () => {
  const collection = { features: [city("large", "host", { __city_population: 5000000 })] };
  const first = harness();
  const second = harness({
    sovereigntyByFeatureId: { host: "ITA" },
    scenarioCountriesByTag: { ITA: { tag: "ITA", controller_feature_count: 1 } },
  });
  const fallback = first.owner.getCityCountryProfileIndex(collection).get("host:host");
  assert.equal(fallback.countryTier, "A");
  assert.equal(fallback.controllerFeatureCount, 1);
  const secondary = second.owner.getCityCountryProfileIndex(collection).get("tag:ITA");
  assert.equal(secondary.countryTier, "D");
  assert.equal(secondary.countryClass, "regional_core");
  assert.equal(secondary.isSecondaryPower, true);
  assert.equal(secondary.isPriorityCountry, true);
  assert.equal(first.computations(), 1);
  assert.equal(second.computations(), 1);
});
