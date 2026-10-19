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

test("scenario capitals promote regional cities, demote modern capitals and restore on exit", () => {
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
  const scenario = owner.getEffectiveCityCollection().features;
  assert.equal(scenario[0].properties.__city_is_country_capital, false);
  assert.equal(scenario[1].properties.__city_is_country_capital, true);
  assert.equal(scenario[1].properties.__city_is_capital, true);
  assert.equal(base[0].properties.__city_is_country_capital, true);
  state.activeScenarioId = "";
  state.scenarioCityOverridesData = null;
  const restored = owner.getEffectiveCityCollection().features;
  assert.equal(restored[0].properties.__city_is_country_capital, true);
  assert.equal(restored[1].properties.__city_is_country_capital, false);
});

test("anarchy and dormant countries cannot acquire a fallback or stale explicit capital", () => {
  const state = {
    activeScenarioId: "tno_1962",
    worldCitiesData: { features: [createCityFeature("niamey", "NE"), createCityFeature("dormant", "FR")] },
    scenarioCountriesByTag: { AFA: { feature_count: 1 }, OLD: { feature_count: 0 } },
    sovereigntyByFeatureId: { NE: "AFA", FR: "OLD" },
    scenarioCityOverridesData: {
      capitals_by_tag: { OLD: "dormant" },
      capital_city_hints: { AFA: { resolution_method: "no_capital" } },
    },
  };
  assert.ok(createOwner(state).getEffectiveCityCollection().features.every((f) => !f.properties.__city_is_capital));
});

test("scenario placement changes marker and host without mutating the base city", () => {
  const base = createCityFeature("capital", "old-host");
  const state = {
    activeScenarioId: "test", worldCitiesData: { features: [base] },
    scenarioCountriesByTag: { AAA: {} }, sovereigntyByFeatureId: { "new-host": "AAA" },
    scenarioCityOverridesData: { capitals_by_tag: { AAA: "capital" }, cities: {
      capital: { city_id: "capital", host_feature_id: "new-host", lon: 12.5, lat: 53,
        display_name: { en: "Capital", zh: "首都" } },
    } },
  };
  const owner = createOwner(state);
  const result = owner.getEffectiveCityCollection().features[0];
  assert.equal(owner.getCityScenarioTag(result), "AAA");
  assert.deepEqual(result.geometry.coordinates, [12.5, 53]);
  assert.equal(result.properties.name_zh, "首都");
  assert.deepEqual(base.geometry.coordinates, [13.4, 52.5]);
  assert.equal(base.properties.__city_host_feature_id, "old-host");
});

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

test("scenario city override propagates an explicit settlement rank", () => {
  const state = {
    activeScenarioId: "hoi4_city_test",
    worldCitiesData: { type: "FeatureCollection", features: [createCityFeature("berlin", "GER-1")] },
    scenarioCityOverridesData: { cities: { berlin: { city_id: "berlin", tier: "minor", settlement_rank: "metropolis" } } },
    scenarioCountriesByTag: {},
    sovereigntyByFeatureId: {},
  };
  const feature = createOwner(state).getEffectiveCityCollection().features[0];
  assert.equal(feature.properties.__city_settlement_rank, "metropolis");
  assert.equal(feature.properties.__city_base_tier, "minor");
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

function createRevealFixture(features, overrides = {}, state = { urbanData: null }) {
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
    ...overrides,
  };
  const owner = createUrbanCityPolicyOwner({ state, caches: { urbanFeatureIndexCache: {} }, helpers });
  const collection = { features }, config = { showLabels: true, labelMinZoom: 1.45 };
  const build = (scale) => owner.buildCityRevealPlan(collection, scale, {}, config);
  build.prepare = (scale, options) => owner.prepareCityRevealPlan(collection, scale, {}, config, options);
  return build;
}

test("cooperative reveal preserves native stable ordering, selected aliases and all synchronous plan fields", async () => {
  const features = Array.from({ length: 257 }, (_, index) => ({
    ...createCityFeature(`async-${index % 17}`, "host", {
      __city_base_tier: ["major", "regional", "minor"][index % 3],
      __city_population: (index % 13) * 100000,
      __city_is_capital: index % 31 === 0,
    }),
    geometry: { type: "Point", coordinates: [(index % 30) * 50, Math.floor(index / 30) * 50] },
  }));
  const build = createRevealFixture(features);
  let yields = 0;
  for (const scale of [1, 1.45, 2.45, 5, 12]) {
    const prepared = await build.prepare(scale, { workBatch: 17, nowMs: () => 0,
      yieldControl: async () => { yields++; } });
    assert.deepEqual(prepared, build(scale));
    const inputOrder = new Map(features.map((feature, index) => [feature, index]));
    const nativeOrder = [...prepared.candidateEntries]
      .sort((left, right) => inputOrder.get(left.feature) - inputOrder.get(right.feature))
      .sort((left, right) => compareCityRevealEntries(left, right, prepared.phase.id));
    assert.deepEqual(prepared.candidateEntries, nativeOrder, "equal comparisons retain source feature order");
    assert.ok(prepared.labelEntries.every((entry) => prepared.markerEntries.includes(entry)));
  }
  assert.ok(yields > 100, "mapping, sorting and selection all use bounded preparation slices");
});

test("cooperative reveal cancels before cold helpers and inside candidate sorting", async () => {
  const features = Array.from({ length: 128 }, (_, index) => ({
    ...createCityFeature(`sort-${128 - index}`, "host", { __city_base_tier: "major" }),
    geometry: { type: "Point", coordinates: [index * 50, 0] },
  }));
  let anchors = 0, comparisons = 0;
  const build = createRevealFixture(features, {
    getCityAnchor(feature) { anchors++; return feature.geometry.coordinates; },
    compareCityRevealEntries(left, right, phase) { comparisons++; return compareCityRevealEntries(left, right, phase); },
  });
  let current = true;
  assert.equal(await build.prepare(5, { isCurrent: () => current,
    yieldControl: async () => { current = false; } }), null);
  assert.equal(anchors, 0, "a stale first task must not enter a projection helper");
  current = true;
  assert.equal(await build.prepare(5, { workBatch: 8, nowMs: () => 0, isCurrent: () => current,
    yieldControl: async () => { if (comparisons > 20) current = false; } }), null);
  assert.equal(anchors, 128);
  assert.ok(comparisons > 20 && comparisons < 100, "sorting cancels inside a merge pass");
});

test("cooperative reveal prepares full labels while the public synchronous plan respects defer", async () => {
  const state = { urbanData: null, deferExactAfterSettle: true };
  const feature = { ...createCityFeature("deferred", "host", { __city_base_tier: "major" }),
    geometry: { type: "Point", coordinates: [0, 0] } };
  const build = createRevealFixture([feature], {}, state);
  assert.equal(build(5).labelEntries.length, 0);
  const prepared = await build.prepare(5, { yieldControl: async () => {} });
  assert.equal(prepared.labelEntries.length, 1);
  state.deferExactAfterSettle = false;
  assert.deepEqual(prepared, build(5));
});

test("cooperative reveal honors elapsed time before its work-count limit", async () => {
  const features = Array.from({ length: 160 }, (_, index) => ({
    ...createCityFeature(`timed-${index}`, "host", { __city_base_tier: "major" }),
    geometry: { type: "Point", coordinates: [index * 50, 0] },
  }));
  let clock = 0, yields = 0, anchors = 0, priorAnchors = 0;
  const build = createRevealFixture(features, { getCityAnchor(feature) { anchors++; return feature.geometry.coordinates; } });
  assert.ok(await build.prepare(5, { workBatch: 10000, sliceBudgetMs: 2, nowMs: () => (clock += 3),
    yieldControl: async () => {
      assert.ok(anchors - priorAnchors <= 32, "elapsed-time checkpoints bound the candidate scan");
      priorAnchors = anchors;
      yields++;
    } }));
  assert.ok(yields > 10);
});

test("default cooperative reveal yield lets a host task run before collection projection", async () => {
  let hostTaskRan = false;
  const feature = createCityFeature("host-yield", "host", { __city_base_tier: "major" });
  const build = createRevealFixture([feature], { getCityAnchor(value) {
    assert.equal(hostTaskRan, true);
    return value.geometry.coordinates;
  } });
  setTimeout(() => { hostTaskRan = true; }, 0);
  assert.ok(await build.prepare(5));
});

test("reveal plan exposes local minor cities, rejects overlapping markers and retains label alternates", () => {
  const features = Array.from({ length: 120 }, (_, index) => ({
    ...createCityFeature(`city-${index}`, "host", { __city_base_tier: index < 8 ? "major" : "minor" }),
    geometry: { type: "Point", coordinates: [(index % 20) * 40, Math.floor(index / 20) * 40] },
  }));
  features.push({ ...features[0], id: "overlapping-city", properties: { ...features[0].properties, city_id: "overlapping-city" } });
  const planAt = createRevealFixture(features);
  assert.equal(planAt(3.05).markerEntries.length, 8);
  const detail = planAt(12);
  assert.equal(detail.markerEntries.length, 50);
  assert.ok(detail.markerEntries.some((entry) => entry.cityTier === "minor"));
  assert.equal(detail.labelEntries.length, 50);
  assert.equal(detail.labelBudget, 72);
});

test("actual reveal plan ranks a matching strategic city ahead of a larger same-tier city", () => {
  const features = [
    { ...createCityFeature("large", "host", { __city_base_tier: "major", __city_population: 1000000 }), geometry: { type: "Point", coordinates: [0, 0] } },
    { ...createCityFeature("strategic", "host", { __city_base_tier: "major", __city_settlement_rank: "large", __city_population: 100000, __city_scenario_victory_points: 50 }), geometry: { type: "Point", coordinates: [60, 0] } },
  ];
  assert.deepEqual(createRevealFixture(features)(5).markerEntries.map((entry) => entry.cityId), ["strategic", "large"]);
});

test("dense local city clusters keep breathing room instead of filling every gap", () => {
  const features = Array.from({ length: 40 }, (_, index) => ({
    ...createCityFeature(`dense-${index}`, "host", { __city_base_tier: "minor", __city_population: 40000 - index }),
    geometry: { type: "Point", coordinates: [index * 20, 0] },
  }));
  const plan = createRevealFixture(features)(50);
  assert.equal(plan.markerEntries.length, 14);
  for (let index = 1; index < plan.markerEntries.length; index += 1) {
    assert.ok(plan.markerEntries[index].screenPoint[0] - plan.markerEntries[index - 1].screenPoint[0] >= 48);
  }
});

test("city reveal selects candidates inside explicit paint padding", () => {
  let margin = 48;
  const feature = { ...createCityFeature("padding", "host", { __city_base_tier: "major" }), geometry: { type: "Point", coordinates: [-70, 50] } };
  const planAt = createRevealFixture([feature], { getCityPaintOverscanPx: () => margin,
    isCityAnchorInViewport: ([x], { padding }) => x >= -padding });
  assert.equal(planAt(5).labelEntries.length, 0);
  margin = 96;
  assert.equal(planAt(5).labelEntries.length, 1);
  margin = 48;
  assert.equal(planAt(5).labelEntries.length, 0);
});
