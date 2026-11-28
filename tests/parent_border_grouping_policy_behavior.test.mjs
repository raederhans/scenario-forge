import assert from "node:assert/strict";
import test from "node:test";
import { createParentBorderGroupingPolicy } from "../js/core/renderer/parent_border_grouping_policy.js";

const entry = (id, admin = "") => ({ id, feature: { id, properties: { country: "FR", admin } } });
function createHarness(state = {}) {
  const policy = createParentBorderGroupingPolicy(state, {
    canonicalCountryCode: value => value,
    getAdmin1Group: feature => feature.properties.admin,
    getFeatureCountryCodeNormalized: feature => feature.properties.country,
    getFeatureId: feature => feature.id,
    shouldExcludePoliticalInteractionFeature: feature => !!feature.properties.excluded,
  });
  return { state, policy };
}

test("groups with insufficient coverage are rejected", () => {
  const entries = Array.from({ length: 10 }, (_, i) => entry(String(i)));
  const groups = { FR_0: ["0", "1", "2"], FR_1: ["3", "4", "5"] };
  const { policy } = createHarness({ hierarchyData: { groups } });
  assert.equal(!!policy.resolveCountryParentGroupingCandidate("FR", entries)?.accepted, false);
});

test("British NUTS1 takes priority, with constituent-country fallback for non-NUTS IDs", () => {
  const { state, policy } = createHarness();
  const entries = Array.from({ length: 10 }, (_, i) => [entry(`UK${String.fromCharCode(65 + i)}01`), entry(`UK${String.fromCharCode(65 + i)}02`)]).flat();
  assert.equal(policy.resolveCountryParentGroupingCandidate("GB", entries).forcedRule, "gb_nuts1");
  const groups = Object.fromEntries(["England", "Scotland", "Wales", "Northern_Ireland"].map((name, i) => [`GB_${name}`, [`leaf-${i}-1`, `leaf-${i}-2`]]));
  state.hierarchyData = { groups };
  assert.equal(policy.resolveCountryParentGroupingCandidate("GB", Object.values(groups).flat().map(id => entry(id))).forcedRule, "gb_constituent_countries");
});
