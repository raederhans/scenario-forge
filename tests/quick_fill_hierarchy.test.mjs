import test from "node:test";
import assert from "node:assert/strict";
import { createQuickFillHierarchyResolver, normalizeQuickFillScope, getQuickFillLevels } from "../js/core/quick_fill_hierarchy.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { normalizeScenarioDistrictGroupsPayload, getScenarioDistrictCountryGrouping } from "../js/core/scenario_districts.js";

function fixture() {
  const features = ["a", "b", "c"].map((id) => ({ properties: { id, cntr_code: "CN", admin1_group: "direct" } }));
  const state = {
    hierarchyData: { groups: { CN_north: ["a", "b"], CN_south: ["c"] } },
    landIndex: new Map(features.map((f) => [f.properties.id, f])),
    countryToFeatureIds: new Map([["CN", ["a", "b", "c"]]]),
    currentTool: "fill", interactionGranularity: "subdivision", batchFillScope: "parent",
    sovereigntyByFeatureId: {}, activeScenarioId: "", parentGroupByFeatureId: new Map(),
  };
  const helpers = {
    getAdmin1Group: (f) => f?.properties.admin1_group,
    getFeatureCountryCodeNormalized: (f) => f?.properties.cntr_code,
    getFeatureInteractionCountryCodeNormalized: (f, id) => state.sovereigntyByFeatureId[id] || f.properties.cntr_code,
    shouldExcludePoliticalInteractionFeature: (f) => f?.properties.interactive === false,
    isSovereigntyModeActive: () => state.paintMode === "sovereignty",
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

test("missing membership and loading never fall back to country", () => {
  const f = fixture();
  f.state.hierarchyData = { groups: { CN_north: ["a", "b", "unloaded"] } };
  assert.equal(f.resolve().status, "loading");
  assert.equal(f.policy.buildDoubleClickBatchPlan(f.features[0], "a"), null);
  assert.equal(f.resolve("c").status, "missing_membership");
  assert.equal(f.policy.buildDoubleClickBatchPlan(f.features[2], "c"), null);
});

test("duplicate membership blocks the entire conflicting group", () => {
  const f = fixture();
  f.state.hierarchyData = { groups: { CN_first: ["a", "b"], CN_second: ["b", "c"] } };
  assert.equal(f.resolve().status, "conflict");
  assert.equal(f.resolve("b").status, "conflict");
});

test("only an explicit no-parent contract can fall back to country", () => {
  const f = fixture();
  f.state.hierarchyData = { quick_fill: { countries: { CN: { parent_available: false } } } };
  assert.equal(f.resolve().status, "no_parent_level");
  assert.equal(f.policy.buildDoubleClickBatchPlan(f.features[0], "a").fallbackToCountry, true);
});

test("multiple levels have independent memberships and invalid explicit levels fail closed", () => {
  const f = fixture();
  f.state.hierarchyData.quick_fill = { countries: { CN: { default_level: "province", levels: {
    province: { label: "Province", alias: "parent" },
    prefecture: { label: "Prefecture", groups: { small: { feature_ids: ["a"] } }, unmapped_feature_ids: ["b"] },
  } } } };
  assert.deepEqual(f.resolve().targetIds, ["a", "b"]);
  assert.deepEqual(f.resolve("a", "level:prefecture").targetIds, ["a"]);
  assert.equal(f.resolve("b", "level:prefecture").status, "unmapped");
  assert.equal(f.resolve("a", "level:absent").status, "unsupported_level");
  assert.equal(getQuickFillLevels(f.state.hierarchyData, "CN").length, 2);
});

test("incomplete reference groups are not exposed as complete parent fills", () => {
  const f = fixture();
  f.state.hierarchyData = { quick_fill: { countries: { CN: { levels: {
    prefecture: { groups: { partial: { feature_ids: ["a", "b"], complete: false } } },
  } } } } };
  assert.equal(f.resolve("a", "level:prefecture").status, "incomplete_group");
});

test("parent fill is intersected with the current scenario owner", () => {
  const f = fixture();
  f.state.activeScenarioId = "hoi4_1936";
  f.state.sovereigntyByFeatureId = { a: "CHI", b: "JAP", c: "CHI" };
  assert.deepEqual(f.resolve().targetIds, ["a"]);
  assert.deepEqual(f.resolve("a", "country").targetIds, ["a", "c"]);
  f.state.sovereigntyByFeatureId.b = "CHI";
  f.state.sovereigntyRevision = 1;
  assert.deepEqual(f.resolve("a", "country").targetIds, ["a", "b", "c"]);
});

test("unloaded scenario members prevent partial fill, absent scenario IDs do not", () => {
  const f = fixture();
  f.state.activeScenarioId = "hoi4_1936";
  f.state.sovereigntyByFeatureId = { a: "CHI", b: "CHI", c: "CHI" };
  f.state.landIndex.delete("b");
  assert.equal(f.resolve().status, "loading");
  assert.equal(f.resolve("a", "country").status, "loading");
  delete f.state.sovereigntyByFeatureId.b;
  assert.deepEqual(f.resolve().targetIds, ["a"]);
});

test("TNO default remains scenario-aware; geographic scope is explicit", () => {
  const f = fixture();
  f.state.activeScenarioId = "tno_1962";
  f.state.sovereigntyByFeatureId = { a: "CHI", b: "CHI", c: "CHI" };
  assert.equal(f.resolve().status, "scenario_level_unavailable");
  assert.deepEqual(f.resolve("a", "level:parent").targetIds, ["a", "b"]);
});

test("district tags are owner-scoped and old payload normalization is idempotent", () => {
  const f = fixture();
  const legacy = { scenario_id: "hoi4_1936", countries: { CN: { districts: { district: { feature_ids: ["a", "b"] } } } } };
  const normalized = normalizeScenarioDistrictGroupsPayload(legacy);
  assert.deepEqual(normalizeScenarioDistrictGroupsPayload(normalized), normalized);
  f.state.activeScenarioId = "hoi4_1936";
  f.state.sovereigntyByFeatureId = { a: "CHI", b: "CHI", c: "JAP" };
  f.state.scenarioDistrictGroupsData = normalized;
  assert.deepEqual(f.resolve().targetIds, ["a", "b"]);
  f.state.scenarioDistrictGroupsData = { scenario_id: "hoi4_1936", tags: { CHI: { districts: { district: { feature_ids: ["a", "c"] } } } } };
  assert.deepEqual(f.resolve().targetIds, ["a"]);
  assert.equal(f.resolve("b").status, "missing_membership");
  const groups = getScenarioDistrictCountryGrouping(f.state.scenarioDistrictGroupsData, "CN", f.features.map((feature) => ({ id: feature.properties.id, feature })), f.state.sovereigntyByFeatureId);
  assert.deepEqual([...groups], [["a", "CHI::district"]]);
});

test("stale scenario data cannot survive a scenario switch", () => {
  const f = fixture();
  f.state.activeScenarioId = "hoi4_1939";
  f.state.sovereigntyByFeatureId = { a: "CHI" };
  f.state.scenarioDistrictGroupsData = { scenario_id: "hoi4_1936", tags: {} };
  assert.equal(f.resolve().status, "stale_scenario");
});

test("all double-click entry points enforce tool/mode gates", () => {
  for (const change of [
    { currentTool: "erase" }, { paintMode: "sovereignty" }, { brushModeEnabled: true },
    { interactionGranularity: "country" }, { specialZoneEditor: { active: true } },
  ]) {
    const f = fixture(); Object.assign(f.state, change);
    assert.equal(f.policy.buildDoubleClickBatchPlan(f.features[0], "a"), null);
  }
});

test("excluded members are omitted but valid singleton still paints", () => {
  const f = fixture(); f.features[1].properties.interactive = false;
  assert.deepEqual(f.resolve().targetIds, ["a"]);
  assert.equal(f.resolve("b").status, "excluded");
});

test("scope normalization keeps explicit levels and rejects malformed inputs", () => {
  for (const value of ["level:prefecture", "level:department", "country", "parent"]) assert.equal(normalizeQuickFillScope(value), value);
  for (const value of ["level:", "level:../x", null, {}, "bad"]) assert.equal(normalizeQuickFillScope(value), "parent");
});
