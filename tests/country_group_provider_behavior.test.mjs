import test from "node:test";
import assert from "node:assert/strict";
import { getCountryGroupSystems } from "../js/core/country_group_provider.js";

function fixture(extra = {}) {
  return {
    runtimeState: {
      activeScenarioId: "example",
      hierarchyData: {
        groups: { DE_north: ["a", "b"], DE_south: ["c"] },
        labels: { DE_north: "North", DE_south: "South" },
      },
      scenarioDistrictGroupsData: {
        tags: { GER: { districts: {
          one: { name_en: "District One", name_zh: "第一大区", feature_ids: ["a", "b", "outside"] },
          two: { name_en: "District Two", feature_ids: ["c"] },
        } } },
      },
      ...extra,
    },
    ownerCode: "GER", groupingCode: "DE",
    getOwnerCode: (id) => ["a", "outside"].includes(id) ? "GER" : "OTHER",
  };
}

test("scenario districts precede geographic groups and both are clipped to reference ownership", () => {
  const systems = getCountryGroupSystems(fixture());
  assert.deepEqual(systems.map((system) => system.id), ["scenario_districts", "geographic"]);
  assert.deepEqual(systems[0].groups.map(group => group.children), [["a", "outside"]]);
  assert.deepEqual(systems[1].groups.map(group => group.children), [["a"]]);
});

test("no scenario and blank mode return only untrimmed geography", () => {
  for (const extra of [{ activeScenarioId: "" }, { mapSemanticMode: "blank" }]) {
    const input = fixture(extra);
    input.getOwnerCode = () => { throw new Error("must not clip"); };
    const systems = getCountryGroupSystems(input);
    assert.deepEqual(systems.map((system) => system.id), ["geographic"]);
    assert.deepEqual(systems[0].groups.map((group) => group.children), [["a", "b"], ["c"]]);
  }
});
