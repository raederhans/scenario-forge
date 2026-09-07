import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCityRevealEntries,
  getCityCountryRevealOverride,
  getCityCountryTierFromScenarioRecord,
  getCityCountryVisibilityClass,
  getCityInterpolatedMarkerBudget,
  getCityInterpolatedMarkerQuota,
  getCityRevealPhase,
  isCityLabelEligibleForPhase,
} from "../js/core/renderer/city_reveal_policy.js";

import {
  createUrbanCityPolicyOwner,
  getUrbanCityRenderPassSignatureParts,
} from "../js/core/renderer/urban_city_policy.js";

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

function createStrategicValuesPayload(victoryPointsByFeature, diagnostics = { errors: [], warnings: [], source: {} }) {
  return {
    metrics: {},
    buckets: {},
    bucketByFeature: {},
    victoryPointsByFeature,
    victoryPointsByState: {},
    resourcePoints: {
      type: "FeatureCollection",
      features: [],
    },
    diagnostics,
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
    getCityTierWeight: () => 1,
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

test("urban city policy owns revision-sensitive render pass signature parts", () => {
  const state = {
    cityLayerRevision: 4,
    scenarioStrategicValuesRevision: 5,
    strategicChoroplethMetric: "victory_points",
    sovereigntyRevision: 6,
    colorRevision: 7,
    deferContextBasePass: true,
  };

  assert.deepEqual(getUrbanCityRenderPassSignatureParts(state, "contextMarkers"), [
    "cities:4",
    "strategic:5:victory_points",
    "sovereignty:6",
    "colors:7",
  ]);
  assert.deepEqual(getUrbanCityRenderPassSignatureParts(state, "labels"), [
    "labels:deferred",
    "cities:4",
    "strategic:5",
    "sovereignty:6",
    "colors:7",
  ]);
  assert.throws(
    () => getUrbanCityRenderPassSignatureParts(state, "political"),
    /Unsupported urban city render pass/,
  );
});

test("urban city policy copies matching strategic victory points onto city features", () => {
  const state = {
    activeScenarioId: "hoi4_city_test",
    worldCitiesData: {
      type: "FeatureCollection",
      features: [
        createCityFeature("berlin", "GER-1"),
      ],
    },
    scenarioCityOverridesData: null,
    scenarioStrategicValuesData: createStrategicValuesPayload({
        "GER-1": [
          {
            city_id: "berlin",
            stable_key: "berlin",
            value: 50,
            name: "Berlin",
            province_id: 6521,
            match_method: "city_exact",
          },
        ],
      }),
    scenarioStrategicValuesRevision: 1,
    scenarioCountriesByTag: {},
    sovereigntyByFeatureId: {},
    sovereigntyRevision: 0,
    cityLayerRevision: 0,
  };

  const collection = createOwner(state).getEffectiveCityCollection();
  assert.equal(collection.features.length, 1);
  assert.equal(collection.features[0].properties.__city_scenario_victory_points, 50);
  assert.equal(collection.features[0].properties.__city_scenario_vp_name, "Berlin");
  assert.equal(collection.features[0].properties.__city_scenario_vp_province_id, 6521);
  assert.equal(collection.features[0].properties.__city_scenario_vp_match_method, "city_exact");
});

test("urban city policy invalidates one owner cache when strategic values revision changes", () => {
  const strategicValues = createStrategicValuesPayload({
    "GER-1": [{ city_id: "berlin", stable_key: "berlin", value: 10, name: "Berlin" }],
  });
  const state = {
    activeScenarioId: "hoi4_city_test",
    worldCitiesData: {
      type: "FeatureCollection",
      features: [createCityFeature("berlin", "GER-1")],
    },
    scenarioCityOverridesData: null,
    scenarioStrategicValuesData: strategicValues,
    scenarioStrategicValuesRevision: 1,
    scenarioCountriesByTag: {},
    sovereigntyByFeatureId: {},
    sovereigntyRevision: 0,
    cityLayerRevision: 0,
  };
  const owner = createOwner(state);
  const first = owner.getEffectiveCityCollection();
  assert.equal(first.features[0].properties.__city_scenario_victory_points, 10);

  strategicValues.victoryPointsByFeature["GER-1"][0].value = 40;
  state.scenarioStrategicValuesRevision += 1;
  const second = owner.getEffectiveCityCollection();
  assert.notEqual(second, first);
  assert.equal(second.features[0].properties.__city_scenario_victory_points, 40);
});

test("urban city policy uses the strongest host victory point when city ids do not match", () => {
  const state = {
    activeScenarioId: "hoi4_city_test",
    worldCitiesData: {
      type: "FeatureCollection",
      features: [
        createCityFeature("host-city", "FRA-1"),
      ],
    },
    scenarioCityOverridesData: null,
    scenarioStrategicValuesData: createStrategicValuesPayload({
        "FRA-1": [
          { city_id: "minor", value: 1, name: "Minor" },
          { city_id: "paris", value: 30, name: "Paris", province_id: 11506 },
        ],
      }),
    scenarioStrategicValuesRevision: 2,
    scenarioCountriesByTag: {},
    sovereigntyByFeatureId: {},
    sovereigntyRevision: 0,
    cityLayerRevision: 0,
  };

  const collection = createOwner(state).getEffectiveCityCollection();
  assert.equal(collection.features[0].properties.__city_scenario_victory_points, 30);
  assert.equal(collection.features[0].properties.__city_scenario_vp_name, "Paris");
  assert.equal(collection.features[0].properties.__city_scenario_vp_province_id, 11506);
});

test("urban city policy ignores strategic victory points from diagnostic-error payloads", () => {
  const state = {
    activeScenarioId: "hoi4_city_test",
    worldCitiesData: {
      type: "FeatureCollection",
      features: [
        createCityFeature("berlin", "GER-1"),
      ],
    },
    scenarioCityOverridesData: null,
    scenarioStrategicValuesData: createStrategicValuesPayload({
      "GER-1": [
        {
          city_id: "berlin",
          stable_key: "berlin",
          value: 50,
          name: "Berlin",
          province_id: 6521,
          match_method: "city_exact",
        },
      ],
    }, {
      errors: [{ code: "baseline_hash_mismatch" }],
      warnings: [],
      source: {},
    }),
    scenarioStrategicValuesRevision: 3,
    scenarioCountriesByTag: {},
    sovereigntyByFeatureId: {},
    sovereigntyRevision: 0,
    cityLayerRevision: 0,
  };

  const collection = createOwner(state).getEffectiveCityCollection();
  assert.equal(collection.features.length, 1);
  assert.equal(collection.features[0].properties.__city_scenario_victory_points, undefined);
  assert.equal(collection.features[0].properties.__city_scenario_vp_name, undefined);
  assert.equal(collection.features[0].properties.__city_scenario_vp_province_id, undefined);
});

test("city reveal phases preserve threshold ownership and interpolated budgets", () => {
  for (const [scale, phase] of [[1, "P0"], [1.149999, "P0"], [1.15, "P1"],
    [1.45, "P2"], [1.9, "P3"], [2.45, "P4"], [3.05, "P5"], [20, "P5"]]) {
    assert.equal(getCityRevealPhase(scale).id, phase);
  }
  assert.equal(getCityInterpolatedMarkerBudget(1.3), 35);
  assert.equal(getCityInterpolatedMarkerBudget(3.05, 2), 340);
  assert.equal(getCityInterpolatedMarkerQuota({ countryTier: "A" }, 1.25), 2);
  assert.equal(getCityInterpolatedMarkerQuota({ countryTier: "E" }, 3.05), 1);
  assert.equal(getCityInterpolatedMarkerQuota({ countryTier: "E" }, 3.05, 0.5), 1);
  assert.equal(getCityInterpolatedMarkerQuota({ countryTier: "E" }, 0.5, 2), 1);
  assert.equal(getCityInterpolatedMarkerQuota({ countryTier: "A" }, 1.45, 0.5), 1);
});

test("city reveal ranking shifts from country priority to capital and population", () => {
  const priority = Object.freeze({ cityId: "priority", revealBucket: 0, isPriorityCountry: true,
    countryTierRank: 5, cityTierWeight: 1, population: 100 });
  const capital = Object.freeze({ cityId: "capital", revealBucket: 0, isCapital: true,
    countryTierRank: 1, cityTierWeight: 3, population: 1000000 });
  assert.ok(compareCityRevealEntries(priority, capital, "P0") < 0);
  assert.ok(compareCityRevealEntries(priority, capital, "P3") > 0);
  assert.ok(compareCityRevealEntries(priority, capital, "P5") > 0);
  assert.ok(compareCityRevealEntries({ ...capital, revealBucket: 2 }, priority, "P0") > 0);
  assert.ok(compareCityRevealEntries({ cityId: "a" }, { cityId: "b" }) < 0);
});

test("city country rules preserve subject precedence and explicit override bounds", () => {
  const profile = Object.freeze({ scenarioTag: "USA", featureCount: 300 });
  assert.equal(getCityCountryTierFromScenarioRecord(profile, { controller_feature_count: 150 }), "A");
  assert.equal(getCityCountryTierFromScenarioRecord(profile, {
    controller_feature_count: 150, entry_kind: "controller_only",
  }), "E");
  assert.equal(getCityCountryVisibilityClass(profile, {
    parent_owner_tag: "GER", controller_feature_count: 150, featured: true,
  }), "micro_subject");
  assert.deepEqual(getCityCountryRevealOverride(Object.freeze({
    tag: "USA", city_reveal_class: "local_actor", city_reveal_weight_bias: -8,
    city_reveal_min_floor_boost: 20,
  })), { className: "local_actor", classWeightBias: -0.35, minQuotaFloorBoost: 3 });
  assert.deepEqual(getCityCountryRevealOverride({ tag: "USA" }), {
    className: "global_core", classWeightBias: 0.42, minQuotaFloorBoost: 2,
  });
});

test("city labels retain staged capital, major and minor eligibility", () => {
  const capital = { isCapital: true, cityTier: "minor" };
  const major = { cityTier: "major" };
  const minor = { cityTier: "minor" };
  assert.equal(isCityLabelEligibleForPhase(capital, "P2"), false);
  assert.equal(isCityLabelEligibleForPhase(capital, "P3"), true);
  assert.equal(isCityLabelEligibleForPhase(major, "P3"), false);
  assert.equal(isCityLabelEligibleForPhase(major, "P4"), true);
  assert.equal(isCityLabelEligibleForPhase(minor, "P4"), false);
  assert.equal(isCityLabelEligibleForPhase(minor, "P5"), true);
});
