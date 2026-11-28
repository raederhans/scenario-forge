import assert from "node:assert/strict";
import test from "node:test";
import { clipHierarchyGroupsToOwner, getEffectiveScenarioHierarchy } from "../js/core/scenario/scenario_hierarchy.js";

function fixture() {
  const groups = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [
    `US_State_${i}`, Array.from({ length: i === 50 ? 44 : 62 }, (_, j) => `US_CNTY_${String(i * 62 + j).padStart(5, "0")}`),
  ]));
  const override = { country_codes: ["US"], groups, labels: Object.fromEntries(Object.keys(groups).map(id => [id, id.replaceAll("_", " ")])) };
  const base = {
    groups: { US_old: ["US_ZN_31_1__R"], IN_Kerala: ["IN_1", "IN_2"] },
    labels: { US_old: "Old US", IN_Kerala: "Kerala" },
    quick_fill: { countries: { US: { default_level: "state", levels: { state: { label: "State", alias: "parent" } } } } },
  };
  return { hierarchyData: base, activeScenarioManifest: { hierarchy_overrides: override } };
}

test("51-state snapshot replaces the entire US membership and preserves India", () => {
  const runtime = fixture();
  const result = getEffectiveScenarioHierarchy(runtime);
  const overrides = runtime.activeScenarioManifest.hierarchy_overrides;
  assert.equal(Object.keys(result.groups).filter(id => id.startsWith("US_")).length, 51);
  assert.equal(Object.values(overrides.groups).flat().length, 3144);
  assert.deepEqual(Object.entries(result.groups).filter(([id]) => id.startsWith("US_")), Object.entries(overrides.groups));
  assert.equal(result.groups.US_old, undefined);
  assert.equal(result.labels.US_old, undefined);
  assert.equal(result.groups.IN_Kerala, runtime.hierarchyData.groups.IN_Kerala);
  assert.equal(result.labels.IN_Kerala, "Kerala");
});

test("a scenario country lists only hierarchy groups it owns, cut to its own parcels", () => {
  const owners = { msk_1: "RKM", msk_2: "RKM", msk_3: "WRS", altai_1: "SIB", altai_2: "SIB" };
  const groups = [
    { id: "RU_moscow", label: "Moscow", children: ["msk_1", "msk_2", "msk_3"] },
    { id: "RU_altai", label: "Altai", children: ["altai_1", "altai_2"] },
  ];
  const clipped = clipHierarchyGroupsToOwner(groups, "RKM", (id) => owners[id] || "");
  assert.deepEqual(clipped, [{ id: "RU_moscow", label: "Moscow", children: ["msk_1", "msk_2"] }]);
  assert.deepEqual(groups[0].children, ["msk_1", "msk_2", "msk_3"], "the shared hierarchy is not mutated");
  assert.equal(clipHierarchyGroupsToOwner(groups, "", () => "RKM"), groups);
});
