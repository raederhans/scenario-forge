import test from "node:test";
import assert from "node:assert/strict";
import { createQuickFillHierarchyResolver } from "../js/core/quick_fill_hierarchy.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";

function fixture() {
  const features = ["a", "b", "c"].map((id) => ({ properties: { id, cntr_code: "CN", admin1_group: "direct" } }));
  const state = {
    hierarchyData: { groups: { CN_north: ["a", "b"], CN_south: ["c"] } },
    landIndex: new Map(features.map((f) => [f.properties.id, f])),
    countryToFeatureIds: new Map([["CN", ["a", "b", "c"]]]),
    currentTool: "fill", interactionGranularity: "subdivision", batchFillScope: "parent",
    scenarioBaselineOwnersByFeatureId: {}, activeScenarioId: "", parentGroupByFeatureId: new Map(),
  };
  const helpers = {
    getAdmin1Group: (f) => f?.properties.admin1_group,
    getFeatureCountryCodeNormalized: (f) => f?.properties.cntr_code,
    getFeatureInteractionCountryCodeNormalized: (f, id) => state.scenarioBaselineOwnersByFeatureId[id] || f.properties.cntr_code,
    shouldExcludePoliticalInteractionFeature: (f) => f?.properties.interactive === false,
  };
  const resolver = createQuickFillHierarchyResolver(state, helpers);
  const policy = createFillTargetPolicy(state, helpers);
  return { state, features, resolver, policy, helpers, resolve: (id = "a", scope = "parent") => resolver.resolve(state.landIndex.get(id), id, scope) };
}

test("semantic parents do not depend on visible border cache or minimum group size", () => {
  const f = fixture();
  f.state.parentGroupByFeatureId = new Map([["a", "wrong"]]);
  assert.deepEqual(f.resolve().targetIds, ["a", "b"]);
  assert.deepEqual(f.resolve("c").targetIds, ["c"]);
  const plan = f.policy.buildDoubleClickBatchPlan(f.features[2], "c");
  assert.deepEqual(plan.targetIds, ["c"]);
  assert.equal(plan.fallbackToCountry, false);
});

test("duplicate membership blocks the entire conflicting group", () => {
  const f = fixture();
  f.state.hierarchyData = { groups: { CN_first: ["a", "b"], CN_second: ["b", "c"] } };
  assert.equal(f.resolve().status, "conflict");
  assert.equal(f.resolve("b").status, "conflict");
});

test("parent fill is intersected with the read-only scenario group", () => {
  const f = fixture();
  f.state.activeScenarioId = "hoi4_1936";
  f.state.scenarioBaselineOwnersByFeatureId = { a: "CHI", b: "JAP", c: "CHI" };
  assert.deepEqual(f.resolve().targetIds, ["a"]);
  assert.deepEqual(f.resolve("a", "country").targetIds, ["a", "c"]);
  f.state.scenarioBaselineOwnersByFeatureId.b = "CHI";

  assert.deepEqual(f.resolve("a", "country").targetIds, ["a", "b", "c"]);
});

test("unloaded scenario members prevent partial fill, absent scenario IDs do not", () => {
  const f = fixture();
  f.state.activeScenarioId = "hoi4_1936";
  f.state.scenarioBaselineOwnersByFeatureId = { a: "CHI", b: "CHI", c: "CHI" };
  f.state.landIndex.delete("b");
  assert.equal(f.resolve().status, "loading");
  assert.equal(f.resolve("a", "country").status, "loading");
  delete f.state.scenarioBaselineOwnersByFeatureId.b;
  assert.deepEqual(f.resolve().targetIds, ["a"]);
});
