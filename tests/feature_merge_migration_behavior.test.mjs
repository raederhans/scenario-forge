import assert from "node:assert/strict";
import test from "node:test";
import {
  migrateMergedFeatureProjectData,
  resolveFeatureMergeLineage,
} from "../js/core/feature_merge_migration.js";

// A, B -> M1 everywhere; M1, C -> M2 everywhere; D, E -> T only in tno_1962.
const lineage = { version: 1, plans: [
  { plan: "one.v1.json", scenarios: null, groups: { DE_MRG_1: ["DE_A", "DE_B"] } },
  { plan: "two.v1.json", scenarios: null, groups: { DE_MRG_2: ["DE_MRG_1", "DE_C"] } },
  { plan: "tno.v1.json", scenarios: ["tno_1962"], groups: { RU_MRG_T: ["RU_D", "RU_E"] } },
] };

test("lineage resolves every level to the final feature of the scenario", () => {
  const tno = resolveFeatureMergeLineage(lineage, "tno_1962");
  assert.equal(tno.resolve("DE_A"), "DE_MRG_2");
  assert.equal(tno.resolve("DE_MRG_1"), "DE_MRG_2");
  assert.deepEqual([...tno.leavesOf("DE_MRG_2")].sort(), ["DE_A", "DE_B", "DE_C"]);
  assert.equal(tno.resolve("RU_D"), "RU_MRG_T");
  const hoi4 = resolveFeatureMergeLineage(lineage, "hoi4_1936");
  assert.equal(hoi4.resolve("RU_D"), "RU_D");
  assert.equal(hoi4.isMerged("RU_D"), false);
});

test("a merged feature takes a value only when every member carried that same value", () => {
  const valid = new Set(["DE_MRG_2", "RU_MRG_T", "FR_X"]);
  const migrate = (visualOverrides, scenario = "tno_1962") =>
    migrateMergedFeatureProjectData({ visualOverrides }, resolveFeatureMergeLineage(lineage, scenario), valid);

  // Mixed levels: an older save names M1 and C directly.
  let result = migrate({ DE_MRG_1: "red", DE_C: "red", RU_D: "blue", RU_E: "blue", FR_X: "green" });
  assert.deepEqual(result.data.visualOverrides, { FR_X: "green", DE_MRG_2: "red", RU_MRG_T: "blue" });
  assert.deepEqual(result.summary, { migratedEntries: 4, droppedEntries: 0, createdEntries: 2 });

  // Different values, or a member left at its default, drop every source.
  result = migrate({ DE_A: "red", DE_B: "red", DE_C: "blue", RU_D: "blue" });
  assert.deepEqual(result.data.visualOverrides, {});
  assert.deepEqual(result.summary, { migratedEntries: 0, droppedEntries: 4, createdEntries: 0 });

  // An explicit value on the merged feature wins over its stale members.
  result = migrate({ RU_MRG_T: "green", RU_D: "blue", RU_E: "blue" });
  assert.deepEqual(result.data.visualOverrides, { RU_MRG_T: "green" });
  assert.equal(result.summary.droppedEntries, 2);

  // Outside the scoped scenario the members stay as they are.
  result = migrate({ RU_D: "blue" }, "hoi4_1936");
  assert.deepEqual(result.data.visualOverrides, { RU_D: "blue" });
});

test("member lists need the whole merged feature and anchors follow their member", () => {
  const valid = new Set(["DE_MRG_2", "RU_MRG_T", "RU_F"]);
  const { data, summary } = migrateMergedFeatureProjectData({
    customPresets: { DE: [{ name: "core", ids: ["DE_A", "DE_B", "DE_C"] }], RU: [{ name: "part", ids: ["RU_D", "RU_F"] }] },
    specialZoneLayers: { layers: [{ id: "z", memberFeatureIds: ["RU_E", "RU_D"] }], storySteps: [{ id: "s", focusFeatureId: "DE_B" }] },
    unitCounters: [{ id: "u", anchor: { featureId: "RU_E" }, layoutAnchor: { kind: "feature", key: "DE_C" } }],
  }, resolveFeatureMergeLineage(lineage, "tno_1962"), valid);
  assert.deepEqual(data.customPresets.DE[0].ids, ["DE_MRG_2"]);
  assert.deepEqual(data.customPresets.RU[0].ids, ["RU_F"]);
  assert.deepEqual(data.specialZoneLayers.layers[0].memberFeatureIds, ["RU_MRG_T"]);
  assert.equal(data.specialZoneLayers.storySteps[0].focusFeatureId, "DE_MRG_2");
  assert.equal(data.unitCounters[0].anchor.featureId, "RU_MRG_T");
  assert.equal(data.unitCounters[0].layoutAnchor.key, "DE_MRG_2");
  assert.deepEqual(summary, { migratedEntries: 8, droppedEntries: 1, createdEntries: 0 });
});

test("project import migrates merged members and reports the dropped ones", async () => {
  const { migrateFeatureScopedProjectDataToCurrentTopology: migrate } = await import("../js/core/sovereignty_manager.js?feature-merges");
  const summaries = [];
  const urls = [];
  const result = await migrate({
    scenario: { id: "tno_1962" },
    visualOverrides: { RU_D: "blue", RU_E: "blue", DE_A: "red", DE_B: "red", DE_C: "blue", FR_X: "green" },
  }, {
    validFeatureIds: new Set(["RU_MRG_T", "DE_MRG_2", "FR_X"]),
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => (url.includes("political_feature_merges") ? lineage : {}) };
    },
    onMigration: (summary) => summaries.push(summary),
  });
  assert.deepEqual(result.visualOverrides, { FR_X: "green", RU_MRG_T: "blue" });
  assert.deepEqual(summaries, [{ migratedEntries: 2, ignoredEntries: 3 }]);
  assert.ok(urls.some((url) => url.endsWith("feature-migrations/political_feature_merges.v1.json")));
});
