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

test("interaction targets prefer owner scope then runtime country then interaction country", () => {
  const { state, policy, a, mode, hidden } = fixture();
  state.interactionGranularity = "country";
  state.sovereigntyByFeatureId.a = "ZZ";
  state.ownerToFeatureIds.set("ZZ", ["a", "d", "hidden"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a", "d"]);
  state.ownerToFeatureIds.clear();
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a", "b", "c"]);
  state.countryToFeatureIds.delete("AA");
  state.countryToFeatureIds.set("ZZ", ["a", "d"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a", "d"]);
  mode.sovereignty = true;
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a"]);
  assert.deepEqual(policy.resolveInteractionTargetIds(hidden, "hidden"), []);
  mode.sovereignty = false; state.countryToFeatureIds.clear();
  assert.deepEqual(policy.resolveInteractionTargetIds(a, "a"), ["a"]);
});

test("parent targets use scenario district and normalized owner before direct grouping", () => {
  const { state, policy, a } = fixture();
  assert.deepEqual(policy.resolveParentGroupTargetIds(a, "a"), ["a", "b"]);
  state.scenarioDistrictGroupByFeatureId = new Map([["a", "district"], ["d", "district"]]);
  state.sovereigntyByFeatureId = { a: " zz ", d: "ZZ" };
  state.ownerToFeatureIds = new Map([["ZZ", ["a", "d", "d", "hidden", "missing"]]]);
  assert.deepEqual(policy.resolveParentGroupTargetIds(a, "a"), ["a", "d"]);
  assert.deepEqual(policy.resolveSpecialZoneParentGroupTargetIds(" a "), ["a", "d"]);
  state.scenarioDistrictGroupByFeatureId.delete("d");
  assert.deepEqual(policy.resolveParentGroupTargetIds(a, "a"), []);
  assert.deepEqual(policy.resolveSpecialZoneParentGroupTargetIds("missing"), []);
});

test("batch plans preserve parent preference, explicit country scope and fallback metadata", () => {
  const { state, policy, a, hidden } = fixture();
  assert.deepEqual(policy.buildDoubleClickBatchPlan(a, "a"), {
    targetIds: ["a", "b"], kind: "fill-parent-group", dirtyReason: "fill-parent-group", fallbackToCountry: false,
  });
  state.parentGroupByFeatureId.set("a", "only-a");
  assert.deepEqual(policy.buildDoubleClickBatchPlan(a, "a"), {
    targetIds: ["a", "b", "c"], kind: "fill-country-batch", dirtyReason: "fill-country-batch", fallbackToCountry: true,
  });
  state.batchFillScope = "country";
  assert.equal(policy.buildDoubleClickBatchPlan(a, "a").fallbackToCountry, false);
  state.countryToFeatureIds.set("AA", ["a"]);
  assert.equal(policy.buildDoubleClickBatchPlan(a, "a"), null);
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
