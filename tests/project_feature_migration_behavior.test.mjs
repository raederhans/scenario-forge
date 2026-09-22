import test from "node:test";
import assert from "node:assert/strict";
import { planProjectFeatureMigration } from "../js/core/project_feature_migration.js";
import { migrateFeatureScopedProjectDataToCurrentTopology } from "../js/core/sovereignty_manager.js";
import { prepareImportedProjectState } from "../js/core/interaction_funnel/import_apply_orchestration.js";
import { state } from "../js/core/state.js";

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
const project = (visualOverrides = {}, extra = {}) => ({
  scenario: { id: "modern_world", baselineHash: "old" }, visualOverrides, ...extra,
});
const plan = (data, override = manifest) => planProjectFeatureMigration(data, { manifest: override, validFeatureIds });
const reason = (expected) => (error) => {
  assert.equal(error.code, "PROJECT_FEATURE_MIGRATION_REVIEW_REQUIRED");
  assert.equal(error.migrationDetails.reason, expected);
  assert.match(error.userMessage, new RegExp(expected));
  return true;
};

test("approved split copies paint and ownership, equal merges coalesce without mutation", () => {
  const data = project({ US_ZONE: "red", US_OTHER: "red", US_A: "red", CA_A: "blue" }, {
    sovereigntyByFeatureId: { US_ZONE: "US", US_OTHER: "US", US_A: "US" },
  });
  const before = structuredClone(data);
  const result = plan(data);
  assert.deepEqual(result.data.visualOverrides, { US_A: "red", US_B: "red", CA_A: "blue" });
  assert.deepEqual(result.data.sovereigntyByFeatureId, { US_A: "US", US_B: "US" });
  assert.deepEqual(result.data.featureOverrides, result.data.visualOverrides);
  assert.equal(result.summary.migratedEntries, 4);
  assert.deepEqual(data, before);
});

test("different paint and owners cannot silently merge, regardless of entry order", () => {
  for (const entries of [{ US_ZONE: "red", US_OTHER: "blue" }, { US_OTHER: "blue", US_ZONE: "red" }]) {
    assert.throws(() => plan(project(entries)), (error) => {
      assert.equal(error.migrationDetails.issues[0].reason, "conflicting_values");
      assert.deepEqual(error.migrationDetails.issues[0].sourceIds.sort(), ["US_OTHER", "US_ZONE"]);
      return reason("ambiguous_or_unresolved_entries")(error);
    });
  }
  assert.throws(() => plan(project({}, { sovereigntyByFeatureId: { US_ZONE: "US", US_OTHER: "CA" } })),
    reason("ambiguous_or_unresolved_entries"));
});

test("existing same-ID entry is a contributor, never an implicit winner", () => {
  assert.throws(() => plan(project({ US_A: "green", US_ZONE: "red" })), reason("ambiguous_or_unresolved_entries"));
  const changedIdentity = structuredClone(manifest);
  changedIdentity.project_feature_migration.crosswalk = { US_A: ["US_B"] };
  assert.deepEqual(plan(project({ US_A: "red" }), changedIdentity).data.visualOverrides, { US_B: "red" });
});

test("unresolved and unmapped IDs reject atomically even when present in new topology", () => {
  for (const id of ["US_INVALID", "US_B", "US_MISSING"]) {
    const data = project({ US_ZONE: "red", [id]: "blue" });
    const before = structuredClone(data);
    assert.throws(() => plan(data), reason("ambiguous_or_unresolved_entries"));
    assert.deepEqual(data, before);
  }
});

test("a merged target cannot consume an absent contributor's default styling", () => {
  assert.throws(() => plan(project({ US_ZONE: "red", US_A: "red" })), (error) => {
    const issue = error.migrationDetails.issues.find((entry) => entry.reason === "partial_merge_requires_review");
    assert.equal(issue.targetId, "US_B");
    assert.deepEqual(issue.absentSourceIds, ["US_OTHER"]);
    return true;
  });
  assert.deepEqual(plan(project()).data.visualOverrides, {});
});

test("no manifest opt-in means no adapter; already current projects are not remapped twice", () => {
  assert.equal(plan(project(), {}), null);
  assert.equal(plan(project({ US_B: "red" }, { scenario: { id: "modern_world", baselineHash: "new" } })), null);
  assert.throws(() => plan(project({}, { scenario: { id: "modern_world", baselineHash: "unknown" } })), reason("source_baseline_mismatch"));
  assert.throws(() => plan(project(), { ...manifest, baseline_hash: "other" }), reason("target_baseline_mismatch"));
});

test("crosswalk requires valid complete successors and schema cannot accept raw overlap evidence", () => {
  for (const targets of [[], ["US_A", "US_GONE"], ["US_A", "US_A"], ["CA_A"]]) {
    const bad = structuredClone(manifest);
    bad.project_feature_migration.crosswalk.US_ZONE = targets;
    assert.throws(() => plan(project(), bad), reason("invalid_crosswalk"));
  }
  assert.throws(() => plan(project(), { ...manifest, project_feature_migration: { crosswalk: {} } }), reason("invalid_contract"));
});

test("unresolved auxiliary references and multi-target spatial anchors reject atomically", () => {
  for (const extra of [
    { specialZoneLayers: { layers: [{ memberFeatureIds: ["US_INVALID"] }] } },
    { unitCounters: [{ anchor: { featureId: "US_ZONE" } }] },
    { unitCounters: [{ layoutAnchor: { kind: "feature", key: "US_ZONE" } }] },
    { customPresets: { US: [{ name: "Custom", ids: ["US_INVALID"] }] } },
    { specialZoneLayers: { layers: [], storySteps: [{ id: "s", focusFeatureId: "US_ZONE" }] } },
  ]) {
    const data = project({}, extra);
    const before = structuredClone(data);
    assert.throws(() => plan(data), reason("ambiguous_or_unresolved_entries"));
    assert.deepEqual(data, before);
  }
});

test("membership collections expand and deduplicate; one-to-one anchors migrate without moving coordinates", () => {
  const data = project({}, {
    specialZoneLayers: { version: 1, activeLayerId: "l", topologyFingerprint: "old",
      layers: [{ id: "l", name: "Zone", memberFeatureIds: ["US_ZONE", "US_OTHER", "CA_A"] }],
      storySteps: [{ id: "s", layerIds: ["l"], focusFeatureId: "US_OTHER" }],
    },
    customPresets: { US: [{ name: "Custom", ids: ["US_ZONE", "US_A", "CA_A"], locked: false }] },
    unitCounters: [{ id: "u", anchor: { lon: -100, lat: 35, featureId: "US_OTHER" },
      layoutAnchor: { kind: "feature", key: "US_OTHER", slotIndex: 2 } },
    { id: "identity", anchor: { lon: -101, lat: 36, featureId: "US_A" },
      layoutAnchor: { kind: "attachment", key: "US_OTHER", slotIndex: 1 } }],
  });
  const before = structuredClone(data);
  const result = plan(data).data;
  assert.deepEqual(result.specialZoneLayers.layers[0].memberFeatureIds, ["US_A", "US_B", "CA_A"]);
  assert.equal(result.specialZoneLayers.topologyFingerprint, "new");
  assert.equal(result.specialZoneLayers.storySteps[0].focusFeatureId, "US_B");
  assert.deepEqual(result.customPresets.US[0].ids, ["US_A", "US_B", "CA_A"]);
  assert.deepEqual(result.unitCounters[0].anchor, { lon: -100, lat: 35, featureId: "US_B" });
  assert.deepEqual(result.unitCounters[0].layoutAnchor, { kind: "feature", key: "US_B", slotIndex: 2 });
  assert.deepEqual(result.unitCounters[1], data.unitCounters[1]);
  assert.equal(result.customPresets.US[0].locked, false);
  assert.deepEqual(data, before);
});

test("scenario import preflight passes the staged manifest and rejects before mutating the scene", async () => {
  const before = { scene: state.activeScenarioId, colors: state.visualOverrides, past: state.historyPast };
  const options = {
    ui: { t: (text) => text }, debugState: {},
    getScenarioResourcesModule: async () => ({ validateImportedScenarioBaseline: async () => ({ ok: true }) }),
    getScenarioManagerModule: async () => ({ prepareScenarioForProjectImport: async () => ({
      bundle: { manifest }, staged: { scenarioId: "modern_world", countryMap: {},
        resolvedOwners: Object.fromEntries([...validFeatureIds].map((id) => [id, "US"])) },
    }) }),
  };
  const result = await prepareImportedProjectState({ ...options,
    data: project({ US_ZONE: "red", US_OTHER: "red", US_A: "red" }),
  });
  assert.deepEqual(result.data.visualOverrides, { US_A: "red", US_B: "red" });
  assert.equal(result.scenarioState.scenarioBaselineHash, "new");
  await assert.rejects(prepareImportedProjectState({ ...options,
    data: project({ US_INVALID: "red" }),
  }), reason("ambiguous_or_unresolved_entries"));
  assert.deepEqual({ scene: state.activeScenarioId, colors: state.visualOverrides, past: state.historyPast }, before);
});

test("existing import migration consumes manifest plan before valid-ID fast path", async () => {
  const summaries = [];
  const result = await migrateFeatureScopedProjectDataToCurrentTopology(project({ US_ZONE: "red", US_A: "red", US_OTHER: "red" }), {
    scenarioManifest: manifest, validFeatureIds,
    fetchImpl: () => { throw new Error("No legacy asset needed"); },
    onMigration: (value) => summaries.push(value),
  });
  assert.deepEqual(result.visualOverrides, { US_A: "red", US_B: "red" });
  assert.deepEqual(summaries, [{ migratedEntries: 2, ignoredEntries: 0 }]);
  await assert.rejects(migrateFeatureScopedProjectDataToCurrentTopology(project({ US_INVALID: "red" }), {
    scenarioManifest: manifest, validFeatureIds,
  }), reason("ambiguous_or_unresolved_entries"));
});
