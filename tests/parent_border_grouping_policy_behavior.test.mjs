import assert from "node:assert/strict";
import test from "node:test";
import { createParentBorderGroupingPolicy } from "../js/core/renderer/parent_border_grouping_policy.js";

const entry = (id, admin = "") => ({ id, feature: { id, properties: { country: "FR", admin } } });
function createHarness(state = {}, overrides = {}) {
  const policy = createParentBorderGroupingPolicy(state, {
    canonicalCountryCode: value => value,
    getAdmin1Group: feature => feature.properties.admin,
    getFeatureCountryCodeNormalized: feature => feature.properties.country,
    getFeatureId: feature => feature.id,
    shouldExcludePoliticalInteractionFeature: feature => !!feature.properties.excluded,
    ...overrides,
  });
  return { state, policy };
}

test("country indexing reads current land data, filters excluded features and preserves references", () => {
  const first = entry("1").feature;
  const excluded = entry("2").feature;
  excluded.properties.excluded = true;
  const { state, policy } = createHarness({ landData: { features: [first, excluded] } });
  assert.equal(policy.getCountryFeatureEntriesMap().get("FR")[0].feature, first);
  assert.equal(policy.getCountryFeatureEntriesMap().get("FR").length, 1);
  state.landDataFull = { features: [entry("3").feature] };
  assert.equal(policy.getFullLandDataFeatures(), state.landDataFull.features);
  assert.equal(policy.getCountryFeatureEntriesMap().get("FR")[0].id, "3");
});

test("country indexing keeps forEach sparse-array and initial-length semantics", () => {
  const features = new Array(3);
  features[1] = entry("1").feature;
  const visited = [];
  const { policy } = createHarness({ landData: { features } }, { getFeatureId: feature => {
    visited.push(feature.id);
    features.push(entry("late").feature);
    return feature.id;
  } });
  assert.equal(policy.getCountryFeatureEntriesMap().get("FR").length, 1);
  assert.deepEqual(visited, ["1"]);
});

test("general grouping requires coverage, multiple renderable groups and bounded dominance", () => {
  for (const [sizes, total, accepted] of [[[4, 4], 10, true], [[3, 3], 10, false], [[19, 2], 21, false], [[18, 2], 20, true], [[10], 10, false]]) {
    const entries = Array.from({ length: total }, (_, i) => entry(String(i)));
    let offset = 0;
    const groups = Object.fromEntries(sizes.map((size, i) => [`FR_${i}`, entries.slice(offset, offset += size).map(e => e.id)]));
    const { policy } = createHarness({ hierarchyData: { groups } });
    assert.equal(!!policy.resolveCountryParentGroupingCandidate("FR", entries)?.accepted, accepted, `${sizes}/${total}`);
  }
});

test("district definitions take precedence, including empty districts, and TNO does not fall back", () => {
  const entries = ["1", "2", "3", "4"].map(id => entry(id));
  const { state, policy } = createHarness({ activeScenarioId: "tno_1962", hierarchyData: { groups: { FR_A: ["1", "2"], FR_B: ["3", "4"] } } });
  assert.equal(policy.resolveCountryParentGroupingCandidate("FR", entries), null);
  state.scenarioDistrictGroupsData = { countries: { FR: { districts: {} } } };
  const empty = policy.resolveCountryParentGroupingCandidate("FR", entries);
  assert.equal(empty.forcedRule, "scenario_district");
  assert.equal(empty.accepted, false);
  state.scenarioDistrictGroupsData.countries.FR.districts = { A: { feature_ids: ["1", "2"] }, B: { feature_ids: ["2", "3", "4"] } };
  const result = policy.resolveCountryParentGroupingCandidate("FR", entries);
  assert.equal(result.accepted, true);
  assert.equal(result.featureToGroup.get("2"), "A", "first assignment wins");
  result.featureToGroup.clear();
  assert.equal(policy.resolveCountryParentGroupingCandidate("FR", entries).featureToGroup.size, 4);
});

test("German state override requires all city states and the bounded state count", () => {
  const { policy } = createHarness();
  const groups = ["Berlin", "Hamburg", "Bremen", ...Array.from({ length: 9 }, (_, i) => `State${i}`)];
  const entries = groups.map((group, i) => entry(String(i), group));
  assert.equal(policy.resolveCountryParentGroupingCandidate("DE", entries).forcedRule, "de_state_level");
  entries[2].feature.properties.admin = "Other";
  assert.equal(policy.resolveCountryParentGroupingCandidate("DE", entries), null);
});

test("British NUTS1 takes priority, with constituent-country fallback for non-NUTS IDs", () => {
  const { state, policy } = createHarness();
  const entries = Array.from({ length: 10 }, (_, i) => [entry(`UK${String.fromCharCode(65 + i)}01`), entry(`UK${String.fromCharCode(65 + i)}02`)]).flat();
  assert.equal(policy.resolveCountryParentGroupingCandidate("GB", entries).forcedRule, "gb_nuts1");
  const groups = Object.fromEntries(["England", "Scotland", "Wales", "Northern_Ireland"].map((name, i) => [`GB_${name}`, [`leaf-${i}-1`, `leaf-${i}-2`]]));
  state.hierarchyData = { groups };
  assert.equal(policy.resolveCountryParentGroupingCandidate("GB", Object.values(groups).flat().map(id => entry(id))).forcedRule, "gb_constituent_countries");
  assert.equal(Object.isFrozen(policy), true);
});
