import assert from "node:assert/strict";
import test from "node:test";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";

function fixture() {
  const features = [
    { id: "a", country: "AA", group: "north" },
    { id: "b", country: "AA", group: "north" },
    { id: "c", country: "AA", group: "south" },
    { id: "d", country: "BB", group: "north" },
    { id: "hidden", country: "AA", group: "north", excluded: true },
  ];
  const state = {
    hierarchyData: { groups: { AA_north: ["a", "b", "hidden"], AA_south: ["c"], BB_north: ["d"] } },
    landIndex: new Map(features.map(feature => [feature.id, feature])),
    countryToFeatureIds: new Map([["AA", ["a", "b", "c", "hidden", "missing"]], ["BB", ["d"]]]),
    ownerToFeatureIds: new Map(), sovereigntyByFeatureId: {},
    scenarioDistrictGroupByFeatureId: new Map(), parentGroupByFeatureId: new Map(),
    currentTool: "fill", interactionGranularity: "subdivision", batchFillScope: "parent",
  };
  const policy = createFillTargetPolicy(state, {
    getAdmin1Group: feature => feature.group,
    getFeatureCountryCodeNormalized: feature => feature.country,
    getFeatureInteractionCountryCodeNormalized: (feature, id) => state.sovereigntyByFeatureId[id] || feature.country,
    shouldExcludePoliticalInteractionFeature: feature => !!feature.excluded,
  });
  return { state, policy, a: features[0], hidden: features[4] };
}

test("interaction targets use complete reference membership and fail closed on missing geometry", () => {
  const { state, policy, a, hidden } = fixture();
  state.interactionGranularity = "country";
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), [], "geographic member missing");
  state.countryToFeatureIds.set("AA", ["a", "b", "c", "hidden"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a", "b", "c"]);
  state.activeScenarioId = "fixture";
  state.scenarioBaselineOwnersByFeatureId = Object.freeze({ a: "ZZ", d: "ZZ", hidden: "ZZ" });
  state.sovereigntyByFeatureId.a = "WRONG";
  state.ownerToFeatureIds.set("ZZ", ["b"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a", "d"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(hidden, "hidden"), []);
  state.scenarioBaselineOwnersByFeatureId = Object.freeze({ a: "ZZ", missing: "ZZ" });
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), []);
});

test("parent targets use scenario district and normalized owner before direct grouping", () => {
  const { state, policy, a } = fixture();
  assert.deepEqual(policy.resolveParentGroupTargetIds(a, "a"), ["a", "b"]);
  state.activeScenarioId = "fixture";
  state.scenarioDistrictGroupsData = { scenario_id: "fixture", tags: { ZZ: { districts: { district: { feature_ids: ["a", "d"] } } } } };
  state.scenarioDistrictGroupByFeatureId = new Map([["a", "district"], ["d", "district"]]);
  state.scenarioBaselineOwnersByFeatureId = Object.freeze({ a: " zz ", d: "ZZ" });
  state.ownerToFeatureIds = new Map([["ZZ", ["a", "d", "d", "hidden", "missing"]]]);
  assert.deepEqual(policy.resolveParentGroupTargetIds(a, "a"), ["a", "d"]);
  assert.deepEqual(policy.resolveSpecialZoneParentGroupTargetIds(" a "), ["a", "d"]);
  state.scenarioDistrictGroupsData = { scenario_id: "fixture", tags: { ZZ: { districts: { district: { feature_ids: ["a"] } } } } };
  assert.deepEqual(policy.resolveParentGroupTargetIds(a, "a"), ["a"]);
  assert.deepEqual(policy.resolveSpecialZoneParentGroupTargetIds("missing"), []);
});
