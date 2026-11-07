import test from "node:test";
import assert from "node:assert/strict";
import { getCountryGroupSystems, findCountryGroupForFeature, getGroupDisplayLabel, getHierarchyGroupsForCode } from "../js/core/country_group_provider.js";

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
  assert.deepEqual(systems[0].groups, [{
    id: "district:GER:one", systemId: "scenario_districts", labelEn: "District One",
    labelZh: "第一大区", label: "District One", children: ["a", "outside"], totalCount: 3,
  }]);
  assert.deepEqual(systems[1].groups, [{ id: "DE_north", label: "North", children: ["a"] }]);
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

test("legacy geographic country records supply scenario districts for the owner tag", () => {
  for (const collection of ["countries", "legacy_countries"]) {
    const input = fixture({ scenarioDistrictGroupsData: {
      [collection]: { DE: { districts: { legacy: { name_en: "Legacy", feature_ids: ["a", "b"] } } } },
    } });
    const group = getCountryGroupSystems(input)[0].groups[0];
    assert.equal(group.id, "district:GER:legacy");
    assert.deepEqual(group.children, ["a"]);
    assert.equal(group.totalCount, 2);
  }
});

test("empty districts leave geography as the default system", () => {
  const input = fixture();
  input.getOwnerCode = () => "OTHER";
  assert.deepEqual(getCountryGroupSystems(input), [{ id: "geographic", groups: [] }]);
});

test("feature lookup respects system and membership", () => {
  const systems = getCountryGroupSystems(fixture());
  assert.equal(findCountryGroupForFeature(systems, "scenario_districts", "a"), systems[0].groups[0]);
  assert.equal(findCountryGroupForFeature(systems, "geographic", "a"), systems[1].groups[0]);
  assert.equal(findCountryGroupForFeature(systems, "geographic", "outside"), null);
  assert.equal(findCountryGroupForFeature(systems, "missing", "a"), null);
  assert.equal(findCountryGroupForFeature(systems, "scenario_districts", "b"), null);
});

test("display labels prefer explicit language labels and fall back to geographic translation or label", () => {
  const group = { label: "Fallback", labelEn: "English", labelZh: "中文" };
  assert.equal(getGroupDisplayLabel(group, "zh", () => "翻译"), "中文");
  assert.equal(getGroupDisplayLabel(group, "en", () => "翻译"), "English");
  assert.equal(getGroupDisplayLabel({ label: "Fallback" }, "zh", () => "翻译"), "翻译");
  assert.equal(getGroupDisplayLabel({ label: "Fallback" }, "zh", () => ""), "Fallback");
  assert.equal(getGroupDisplayLabel({ label: "Fallback" }, "en", () => "翻译"), "Fallback");
});

test("现代行政区分组按分组 ID 带出中文名，中文界面优先使用", () => {
  const runtimeState = {
    hierarchyData: {
      groups: { CN_Hebei: ["CN_1"], RU_Kaluga: ["RU_1"] },
      labels: { CN_Hebei: "Hebei Province", RU_Kaluga: "Kaluga" },
      labels_zh: { CN_Hebei: "河北省" },
    },
    hierarchyGroupsByCode: new Map(),
  };
  const [hebei] = getHierarchyGroupsForCode(runtimeState, "CN");
  assert.equal(getGroupDisplayLabel(hebei, "zh", () => ""), "河北省");
  assert.equal(getGroupDisplayLabel(hebei, "en", () => ""), "Hebei Province");
  const [kaluga] = getHierarchyGroupsForCode(runtimeState, "RU");
  assert.equal(getGroupDisplayLabel(kaluga, "zh", (label) => (label === "Kaluga" ? "卡卢加" : "")), "卡卢加");
});
