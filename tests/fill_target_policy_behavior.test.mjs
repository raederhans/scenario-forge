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
  const mode = { sovereignty: false };
  const policy = createFillTargetPolicy(state, {
    getAdmin1Group: feature => feature.group,
    getFeatureCountryCodeNormalized: feature => feature.country,
    getFeatureInteractionCountryCodeNormalized: (feature, id) => state.sovereigntyByFeatureId[id] || feature.country,
    isSovereigntyModeActive: () => mode.sovereignty,
    shouldExcludePoliticalInteractionFeature: feature => !!feature.excluded,
  });
  return { state, mode, policy, a: features[0], hidden: features[4] };
}

test("country targets filter absent and excluded features and observe replacement indexes", () => {
  const { state, policy } = fixture();
  const ids = policy.getCountryFeatureIds("AA");
  assert.deepEqual(ids, ["a", "b", "c"]);
  ids.pop();
  assert.deepEqual(policy.getCountryFeatureIds("AA"), ["a", "b", "c"]);
  state.countryToFeatureIds = new Map([["AA", ["b"]]]);
  assert.deepEqual(policy.getCountryFeatureIds("AA"), ["b"]);
  state.landIndex = new Map();
  assert.deepEqual(policy.getCountryFeatureIds("AA"), []);
  for (const index of [null, {}, new Map([["AA", "invalid"]])]) {
    state.countryToFeatureIds = index;
    assert.deepEqual(policy.getCountryFeatureIds("AA"), []);
  }
});

test("interaction targets use complete reference membership and fail closed on missing geometry", () => {
  const { state, policy, a, mode, hidden } = fixture();
  state.interactionGranularity = "country";
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), [], "geographic member missing");
  state.countryToFeatureIds.set("AA", ["a", "b", "c", "hidden"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a", "b", "c"]);
  state.activeScenarioId = "fixture";
  state.scenarioBaselineOwnersByFeatureId = Object.freeze({ a: "ZZ", d: "ZZ", hidden: "ZZ" });
  state.sovereigntyByFeatureId.a = "WRONG";
  state.ownerToFeatureIds.set("ZZ", ["b"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a", "d"]);
  mode.sovereignty = true;
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(hidden, "hidden"), []);
  mode.sovereignty = false;
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

test("batch plans ignore border caches, preserve singleton parents and explicit country scope", () => {
  const { state, policy, a, hidden } = fixture();
  assert.deepEqual(policy.buildDoubleClickBatchPlan(a, "a"), {
    targetIds: ["a", "b"], kind: "fill-parent-group", dirtyReason: "fill-parent-group", fallbackToCountry: false,
  });
  state.parentGroupByFeatureId.set("a", "only-a");
  assert.deepEqual(policy.buildDoubleClickBatchPlan(a, "a"), {
    targetIds: ["a", "b"], kind: "fill-parent-group", dirtyReason: "fill-parent-group", fallbackToCountry: false,
  });
  state.hierarchyData = { groups: { AA_singleton: ["a"] } };
  assert.deepEqual(policy.buildDoubleClickBatchPlan(a, "a").targetIds, ["a"]);
  state.countryToFeatureIds.set("AA", ["a", "b", "c", "hidden"]);
  state.batchFillScope = "country";
  assert.equal(policy.buildDoubleClickBatchPlan(a, "a").fallbackToCountry, false);
  state.countryToFeatureIds.set("AA", ["a"]);
  assert.deepEqual(policy.buildDoubleClickBatchPlan(a, "a").targetIds, ["a"]);
  assert.equal(policy.buildDoubleClickBatchPlan(hidden, "hidden"), null);
});

test("double click eligibility enforces every tool and mode gate before planning", () => {
  for (const block of [
    ({ state }) => { state.currentTool = "erase"; },
    ({ state }) => { state.interactionGranularity = "country"; },
    ({ state }) => { state.brushModeEnabled = true; },
    ({ state }) => { state.specialZoneEditor = { active: true }; },
    ({ mode }) => { mode.sovereignty = true; },
  ]) {
    const current = fixture();
    assert.equal(current.policy.isDoubleClickBatchEligible({ id: "a" }, current.a), true);
    block(current);
    assert.equal(current.policy.isDoubleClickBatchEligible({ id: "a" }, current.a), false);
  }
  const { policy, a } = fixture();
  assert.equal(policy.isDoubleClickBatchEligible(null, a), false);
  assert.equal(policy.isDoubleClickBatchEligible({ id: "a" }, null), false);
  assert.ok(Object.isFrozen(policy));
  const next = fixture();
  next.state.parentGroupByFeatureId.set("a", "changed");
  assert.deepEqual(policy.resolveParentGroupTargetIds(a, "a"), ["a", "b"]);
});
