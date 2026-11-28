import test from "node:test";
import assert from "node:assert/strict";
import { planProjectFeatureMigration } from "../js/core/project_feature_migration.js";
import { migrateFeatureScopedProjectDataToCurrentTopology } from "../js/core/sovereignty_manager.js";

const manifest = {
  scenario_id: "modern_world", baseline_hash: "new",
  project_feature_migration: {
    version: 1, scenario_id: "modern_world", source_baseline_hash: "old", target_baseline_hash: "new",
    feature_id_prefixes: ["US_"],
    crosswalk: { US_ZONE: ["US_A", "US_B"], US_OTHER: ["US_B"], US_A: ["US_A"] },
    unresolved_ids: ["US_INVALID"],
  },
};
const validFeatureIds = new Set(["US_A", "US_B", "US_INVALID", "CA_A"]);
const project = visualOverrides => ({
  scenario: { id: "modern_world", baselineHash: "old" }, visualOverrides,
});
const plan = data => planProjectFeatureMigration(data, { manifest, validFeatureIds });
const reason = (expected) => (error) => {
  assert.equal(error.code, "PROJECT_FEATURE_MIGRATION_REVIEW_REQUIRED");
  assert.equal(error.migrationDetails.reason, expected);
  assert.match(error.userMessage, new RegExp(expected));
  return true;
};

test("split successors inherit the original paint", () => {
  const data = project({ US_ZONE: "red", US_OTHER: "red", US_A: "red", CA_A: "blue" });
  const result = plan(data);
  assert.deepEqual(result.data.visualOverrides, { US_A: "red", US_B: "red", CA_A: "blue" });
});

test("different paint cannot silently merge, regardless of entry order", () => {
  for (const entries of [{ US_ZONE: "red", US_OTHER: "blue" }, { US_OTHER: "blue", US_ZONE: "red" }]) {
    assert.throws(() => plan(project(entries)), (error) => {
      assert.equal(error.migrationDetails.issues[0].reason, "conflicting_values");
      assert.deepEqual(error.migrationDetails.issues[0].sourceIds.sort(), ["US_OTHER", "US_ZONE"]);
      return reason("ambiguous_or_unresolved_entries")(error);
    });
  }
});

test("equal paint coalesces when imported features merge", async () => {
  const result = await migrateFeatureScopedProjectDataToCurrentTopology(project({ US_ZONE: "red", US_A: "red", US_OTHER: "red" }), {
    scenarioManifest: manifest, validFeatureIds,
    fetchImpl: () => { throw new Error("No legacy asset needed"); },
  });
  assert.deepEqual(result.visualOverrides, { US_A: "red", US_B: "red" });
});

test("unresolved and unmapped IDs reject atomically even when present in new topology", () => {
  for (const id of ["US_INVALID", "US_B", "US_MISSING"]) {
    const data = project({ US_ZONE: "red", [id]: "blue" });
    const before = structuredClone(data);
    assert.throws(() => plan(data), reason("ambiguous_or_unresolved_entries"));
    assert.deepEqual(data, before);
  }
});
