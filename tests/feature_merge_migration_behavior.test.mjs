import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  migrateMergedFeatureProjectData,
  resolveFeatureMergeLineage,
} from "../js/core/feature_merge_migration.js";

const lineage = { version: 1, plans: [
  { plan: "one.v1.json", scenarios: null, groups: { DE_MRG_1: ["DE_A", "DE_B"] } },
  { plan: "two.v1.json", scenarios: null, groups: { DE_MRG_2: ["DE_MRG_1", "DE_C"] } },
  { plan: "tno.v1.json", scenarios: ["tno_1962"], groups: { RU_MRG_T: ["RU_D", "RU_E"] } },
] };

test("a HOI4 merged Indian parcel expands and regroups under the TNO lineage", async () => {
  const { migrateFeatureScopedProjectDataToCurrentTopology: migrate } = await import("../js/core/sovereignty_manager.js?cross-scenario");
  const read = file => JSON.parse(readFileSync(new URL("../data/" + file, import.meta.url), "utf8"));
  const owners = read("scenarios/tno_1962/owners.by_feature.json").owners;
  const summaries = [], discarded = [];
  const result = await migrate({ scenario: { id: "hoi4_1936" }, visualOverrides: { IN_MRG_169df8d18d42: "#abcdef" } }, {
    sourceScenarioId: "hoi4_1936", lineageScenarioId: "tno_1962", validFeatureIds: new Set(Object.keys(owners)),
    sourceManifest: read("scenarios/hoi4_1936/manifest.json"), scenarioManifest: read("scenarios/tno_1962/manifest.json"),
    fetchImpl: async url => ({ ok: true, json: () => read("feature-migrations/" + url.split("/").at(-1)) }),
    onDiscard: id => discarded.push(id), onMigration: summary => summaries.push(summary),
  });
  assert.deepEqual(result.visualOverrides, { IN_ADM2_76128533B24861976740713: "#abcdef", IN_MRG_6c3faeb50bb6: "#abcdef" });
  assert.deepEqual(summaries, [{ migratedEntries: 1, ignoredEntries: 0 }]);
  assert.deepEqual(discarded, []);
});

test("a merged feature takes a value only when every member carried that same value", () => {
  const valid = new Set(["DE_MRG_2", "RU_MRG_T", "FR_X"]);
  const migrate = (visualOverrides, scenario = "tno_1962") =>
    migrateMergedFeatureProjectData({ visualOverrides }, resolveFeatureMergeLineage(lineage, scenario), valid);

  // Mixed levels: an older save names M1 and C directly.
  let result = migrate({ DE_MRG_1: "red", DE_C: "red", RU_D: "blue", RU_E: "blue", FR_X: "green" });
  assert.deepEqual(result.data.visualOverrides, { FR_X: "green", DE_MRG_2: "red", RU_MRG_T: "blue" });
  assert.deepEqual(result.summary.visualOverrides, { migratedEntries: 4, droppedEntries: 0, createdEntries: 2 });

  // Different values, or a member left at its default, drop every source.
  result = migrate({ DE_A: "red", DE_B: "red", DE_C: "blue", RU_D: "blue" });
  assert.deepEqual(result.data.visualOverrides, {});
  assert.deepEqual(result.summary.visualOverrides, { migratedEntries: 0, droppedEntries: 4, createdEntries: 0 });

  // An explicit value on the merged feature wins over its stale members.
  result = migrate({ RU_MRG_T: "green", RU_D: "blue", RU_E: "blue" });
  assert.deepEqual(result.data.visualOverrides, { RU_MRG_T: "green" });
  assert.equal(result.summary.visualOverrides.droppedEntries, 2);

  // Outside the scoped scenario the members stay as they are.
  result = migrate({ RU_D: "blue" }, "hoi4_1936");
  assert.deepEqual(result.data.visualOverrides, { RU_D: "blue" });

  // A scoped member still valid in the shared base topology migrates in its scenario.
  result = migrateMergedFeatureProjectData({ visualOverrides: { RU_D: "blue", RU_E: "blue" } },
    resolveFeatureMergeLineage(lineage, "tno_1962"), new Set([...valid, "RU_D", "RU_E"]));
  assert.deepEqual(result.data.visualOverrides, { RU_MRG_T: "blue" });
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
