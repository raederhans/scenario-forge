import assert from "node:assert/strict";
import test from "node:test";
import { getEffectiveScenarioHierarchyFromInputs, projectScenarioFeatureIds, expandScenarioFeatureIds } from "../js/core/scenario_hierarchy.js";
import { migrateMergedFeatureProjectData, resolveFeatureMergeLineage } from "../js/core/feature_merge_migration.js";
import { getScenarioImportValidFeatureIds } from "../js/core/interaction_funnel/import_trust_projection.js";
import { countryPresets, state } from "../js/core/state.js";
import { rebuildPresetState, resolveFeatureIdsFromPresetSource } from "../js/core/releasable_manager.js";

const splits = { CN_M: ["CN_M__SPLIT_S", "CN_M__SPLIT_N"] };
const override = { feature_merges: { CN_M: ["CN_A", "CN_B"] }, feature_splits: splits };
const children = splits.CN_M;

test("historical presets and releasable selectors use split children only in the active scenario", () => {
  const keys = ["activeScenarioId", "activeScenarioManifest", "hierarchyData", "scenarioCountriesByTag", "releasableCatalog",
    "customPresets", "presetsState", "defaultReleasablePresetOverlays", "scenarioReleasablePresetOverlays"];
  const saved = Object.fromEntries(keys.map(key => [key, state[key]]));
  const preset = countryPresets.DE.find(p => p.name === "Bavaria");
  const parent = preset.ids[0];
  const successors = [parent + "__SPLIT_E", parent + "__SPLIT_W"];
  try {
    Object.assign(state, { activeScenarioId: "hoi4_1936", activeScenarioManifest: { hierarchy_overrides: {
      feature_splits: { [parent]: successors },
    } }, hierarchyData: { groups: { DE_G: [parent] } }, scenarioCountriesByTag: {}, releasableCatalog: { entries: [] }, customPresets: {} });
    const projected = rebuildPresetState().DE.find(p => p.name === "Bavaria").ids;
    assert.ok(successors.every(id => projected.includes(id)) && !projected.includes(parent));
    assert.deepEqual(resolveFeatureIdsFromPresetSource({ type: "feature_ids", feature_ids: [parent] }), successors);
    assert.deepEqual(resolveFeatureIdsFromPresetSource({ type: "feature_ids", feature_ids: [successors[0]] }), [successors[0]]);
    assert.deepEqual(resolveFeatureIdsFromPresetSource({ type: "hierarchy_group_ids", group_ids: ["DE_G"],
      exclude_feature_ids: [successors[0]] }), [successors[1]]);
    state.activeScenarioId = "";
    state.activeScenarioManifest = null;
    assert.deepEqual(rebuildPresetState().DE.find(p => p.name === "Bavaria").ids, preset.ids);
  } finally {
    Object.assign(state, saved);
  }
});

test("scenario splits project groups, quick-fill, unmapped lists and shared presets", () => {
  const base = { groups: { CN_Liaoning: ["CN_A", "CN_B", "CN_C"] }, quick_fill: { countries: {
    CN: { levels: { prefecture: { groups: { city: { feature_ids: ["CN_A", "CN_B"] } }, unmapped_feature_ids: ["CN_M"] } } },
  } } };
  const effective = getEffectiveScenarioHierarchyFromInputs(base, override);
  assert.deepEqual(effective.groups.CN_Liaoning, [...children, "CN_C"]);
  assert.deepEqual(effective.quick_fill.countries.CN.levels.prefecture.groups.city.feature_ids, children);
  assert.deepEqual(effective.quick_fill.countries.CN.levels.prefecture.unmapped_feature_ids, children);
  assert.deepEqual(projectScenarioFeatureIds(["CN_A", "CN_B"], override).ids, children);
  assert.deepEqual(projectScenarioFeatureIds(["CN_M"], { feature_splits: splits }).ids, children);
  assert.deepEqual(expandScenarioFeatureIds(children, override), ["CN_A", "CN_B"]);
  assert.deepEqual(expandScenarioFeatureIds([children[0]], override), [children[0]]);
  assert.deepEqual(projectScenarioFeatureIds(["CN_A"], override), { ids: [], partial: [{ mergedId: "CN_M", missing: ["CN_B"] }] });
  assert.equal(getEffectiveScenarioHierarchyFromInputs(base, {}), base);
  assert.deepEqual(base.groups.CN_Liaoning, ["CN_A", "CN_B", "CN_C"]);
});

test("old parent paint and memberships copy to every child, child edits take precedence", () => {
  const data = { visualOverrides: { CN_M: "red", [children[0]]: "blue" },
    customPresets: { CN: [{ ids: ["CN_M"] }] }, specialZoneLayers: { layers: [{ memberFeatureIds: ["CN_M"] }] } };
  const result = migrateMergedFeatureProjectData(data, resolveFeatureMergeLineage(null, "hoi4_1936", splits), new Set(children));
  assert.deepEqual(result.data.visualOverrides, { [children[0]]: "blue", [children[1]]: "red" });
  assert.deepEqual(result.data.customPresets.CN[0].ids, children);
  assert.deepEqual(result.data.specialZoneLayers.layers[0].memberFeatureIds, children);
  assert.deepEqual(migrateMergedFeatureProjectData(data, resolveFeatureMergeLineage(null, "modern_world"), new Set(["CN_M"])).data, data);
});

test("old pre-merge leaves migrate through merge then split without growing partial paint", () => {
  const lineage = resolveFeatureMergeLineage({ plans: [{ groups: { CN_M: ["CN_A", "CN_B"] } }] }, "hoi4_1936", splits);
  const valid = new Set(children);
  assert.deepEqual(migrateMergedFeatureProjectData({ visualOverrides: { CN_A: "red", CN_B: "red" } }, lineage, valid).data.visualOverrides,
    Object.fromEntries(children.map(id => [id, "red"])));
  assert.deepEqual(migrateMergedFeatureProjectData({ visualOverrides: { CN_A: "red" } }, lineage, valid).data.visualOverrides, {});
  const mixed = migrateMergedFeatureProjectData({ visualOverrides: { CN_M: "blue", CN_A: "red", CN_B: "red" },
    customPresets: { CN: [{ ids: ["CN_M", "CN_A", "CN_B"] }] } }, lineage, valid);
  assert.deepEqual(mixed.data.visualOverrides, Object.fromEntries(children.map(id => [id, "blue"])));
  assert.deepEqual(mixed.summary.visualOverrides, { migratedEntries: 1, droppedEntries: 2, createdEntries: 2 });
  assert.deepEqual(mixed.summary.auxiliary, { migratedEntries: 3, droppedEntries: 0 });
});

test("import forces split migration even when shared base still considers the parent valid", async () => {
  const { migrateFeatureScopedProjectDataToCurrentTopology: migrate } = await import("../js/core/sovereignty_manager.js?feature-splits");
  const target = { activeScenarioId: "hoi4_1936", defaultRuntimePoliticalTopology: {
    objects: { political: { geometries: [{ properties: { id: "CN_M" } }] } },
  } };
  const valid = getScenarioImportValidFeatureIds(target, { staged: { scenarioId: "hoi4_1936",
    resolvedOwners: Object.fromEntries(children.map(id => [id, "CHI"])) } });
  assert.ok(valid.has("CN_M"));
  const summaries = [];
  const result = await migrate({ scenario: { id: "hoi4_1936" }, visualOverrides: { CN_M: "red" } }, {
    validFeatureIds: valid, scenarioManifest: { scenario_id: "hoi4_1936", hierarchy_overrides: override },
    fetchImpl: async () => ({ ok: true, json: async () => ({ plans: [] }) }), onMigration: summary => summaries.push(summary),
  });
  assert.deepEqual(result.visualOverrides, Object.fromEntries(children.map(id => [id, "red"])));
  assert.deepEqual(summaries, [{ migratedEntries: 1, ignoredEntries: 0 }]);
});
