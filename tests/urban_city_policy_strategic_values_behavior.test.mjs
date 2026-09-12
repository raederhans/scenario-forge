import test from "node:test";
import assert from "node:assert/strict";
import * as cityPolicy from "../js/core/renderer/city_reveal_policy.js";
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

test("urban city policy does not borrow another city victory point in the same host", () => {
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
  assert.equal(collection.features[0].properties.__city_scenario_victory_points, undefined);
  assert.equal(collection.features[0].properties.__city_scenario_vp_name, undefined);
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
  assert.equal(getCityInterpolatedMarkerBudget(3.05, 2), 200);
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
  assert.equal(isCityLabelEligibleForPhase(capital, "P2"), true);
  assert.equal(isCityLabelEligibleForPhase(capital, "P3"), true);
  assert.equal(isCityLabelEligibleForPhase(major, "P3"), true);
  assert.equal(isCityLabelEligibleForPhase(major, "P4"), true);
  assert.equal(isCityLabelEligibleForPhase(minor, "P4"), false);
  assert.equal(isCityLabelEligibleForPhase(minor, "P5"), true);
});

test("local zoom releases country quotas and grows bounded point and label budgets", () => {
  for (const countryTier of ["A", "B", "C", "D", "E"]) {
    const entry = { countryTier };
    const quotas = [3.05, 5, 8, 12, 50].map((scale) => getCityInterpolatedMarkerQuota(entry, scale));
    assert.ok(quotas[1] > quotas[0]);
    assert.ok(quotas.every((quota, index) => index === 0 || quota >= quotas[index - 1]));
    assert.equal(quotas[4], getCityInterpolatedMarkerBudget(50));
  }
  assert.equal(getCityInterpolatedMarkerBudget(50), 120);
  assert.equal(getCityInterpolatedMarkerBudget(50, 0.95), 114);
  assert.equal(cityPolicy.getCityLabelBudget(getCityRevealPhase(50), {}, 50), 72);
  assert.ok(Number.isFinite(cityPolicy.getCityRevealBucket({ countryTier: "E", cityTier: "minor" }, "P5")));
});

test("priority reserve fades to zero before the P4 boundary", () => {
  const values = [1.9, 2.1, 2.3, 2.44, 2.45].map((scale) => (
    cityPolicy.getCityPriorityCountryReserveBudget(scale, 100)
  ));
  assert.deepEqual(values, [30, 19, 8, 1, 0]);
});

function createRevealFixture(features) {
  const profile = { groupKey: "country", countryTier: "A", countryTierRank: 5 };
  const helpers = {
    ...cityPolicy,
    defaultCityCountryClassRank: 2,
    defaultCityCountryTierRank: 2,
    getCityAnchor: (feature) => feature.geometry.coordinates,
    getCityCountryGroupKey: () => "country",
    getCityCountryProfileIndex: () => new Map([["country", profile]]),
    getCityFeatureKey: (feature) => feature.id,
    getCityInterpolatedRevealBucket: (entry, scale) => cityPolicy.getCityRevealBucket(entry, getCityRevealPhase(scale).id),
    getCityScreenPoint: (anchor) => anchor,
    getCityViewportCenterDistanceNorm: () => 0,
    isCityAnchorInViewport: () => true,
  };
  const owner = createUrbanCityPolicyOwner({ state: { urbanData: null }, caches: { urbanFeatureIndexCache: {} }, helpers });
  return (scale) => owner.buildCityRevealPlan({ features }, scale, {}, { showLabels: true, labelMinZoom: 1.45 });
}

test("reveal plan exposes local minor cities, rejects overlapping markers and retains label alternates", () => {
  const features = Array.from({ length: 120 }, (_, index) => ({
    ...createCityFeature(`city-${index}`, "host", { __city_base_tier: index < 8 ? "major" : "minor" }),
    geometry: { type: "Point", coordinates: [(index % 20) * 40, Math.floor(index / 20) * 40] },
  }));
  features.push({ ...features[0], id: "overlapping-city", properties: { ...features[0].properties, city_id: "overlapping-city" } });
  const planAt = createRevealFixture(features);
  assert.equal(planAt(3.05).markerEntries.length, 8);
  const detail = planAt(12);
  assert.equal(detail.markerEntries.length, 120);
  assert.ok(detail.markerEntries.some((entry) => entry.cityTier === "minor"));
  assert.equal(detail.labelEntries.length, 120);
  assert.equal(detail.labelBudget, 72);
});

test("actual reveal plan ranks a matching strategic city ahead of a larger same-tier city", () => {
  const features = [
    { ...createCityFeature("large", "host", { __city_base_tier: "major", __city_population: 1000000 }), geometry: { type: "Point", coordinates: [0, 0] } },
    { ...createCityFeature("strategic", "host", { __city_base_tier: "major", __city_population: 100000, __city_scenario_victory_points: 50 }), geometry: { type: "Point", coordinates: [40, 0] } },
  ];
  assert.deepEqual(createRevealFixture(features)(5).markerEntries.map((entry) => entry.cityId), ["strategic", "large"]);
});

test("dense local city clusters keep breathing room instead of filling every gap", () => {
  const features = Array.from({ length: 40 }, (_, index) => ({
    ...createCityFeature(`dense-${index}`, "host", { __city_base_tier: "minor", __city_population: 40000 - index }),
    geometry: { type: "Point", coordinates: [index * 20, 0] },
  }));
  const plan = createRevealFixture(features)(50);
  assert.equal(plan.markerEntries.length, 20);
  for (let index = 1; index < plan.markerEntries.length; index += 1) {
    assert.ok(plan.markerEntries[index].screenPoint[0] - plan.markerEntries[index - 1].screenPoint[0] >= 36);
  }
});
