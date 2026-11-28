import assert from "node:assert/strict";
import test from "node:test";
import { migrateMergedFeatureProjectData, resolveFeatureMergeLineage } from "../js/core/feature_merge_migration.js";

const splits = { CN_M: ["CN_M__SPLIT_S", "CN_M__SPLIT_N"] };

const children = splits.CN_M;
const parent = "PL_POW_2209";
const danzig = parent + "__SPLIT_DANZIG";
const danzigLeaves = [danzig + "__SPLIT_MARIENBURG", danzig + "__SPLIT_REST"];
const rest = parent + "__SPLIT_REST";
const leaves = [...danzigLeaves, rest];
const nested = { feature_splits: { [parent]: leaves, [danzig]: danzigLeaves } };

test("old parent paint and memberships copy to every child, child edits take precedence", () => {
  const data = { visualOverrides: { CN_M: "red", [children[0]]: "blue" },
    customPresets: { CN: [{ ids: ["CN_M"] }] }, specialZoneLayers: { layers: [{ memberFeatureIds: ["CN_M"] }] } };
  const result = migrateMergedFeatureProjectData(data, resolveFeatureMergeLineage(null, "hoi4_1936", splits), new Set(children));
  assert.deepEqual(result.data.visualOverrides, { [children[0]]: "blue", [children[1]]: "red" });
  assert.deepEqual(result.data.customPresets.CN[0].ids, children);
  assert.deepEqual(result.data.specialZoneLayers.layers[0].memberFeatureIds, children);
  assert.deepEqual(migrateMergedFeatureProjectData(data, resolveFeatureMergeLineage(null, "modern_world"), new Set(["CN_M"])).data, data);
});

test("nested migration inherits the nearest paint and deduplicates overlapping memberships", () => {
  const lineage = resolveFeatureMergeLineage(null, "hoi4_1936", nested.feature_splits);
  const data = { visualOverrides: { [parent]: "red", [danzig]: "blue" },
    customPresets: { PL: [{ ids: [parent, danzig, danzigLeaves[0]] }] } };
  const migrate = () => migrateMergedFeatureProjectData(data, lineage, new Set(leaves)).data;
  const expected = { [danzigLeaves[0]]: "blue", [danzigLeaves[1]]: "blue", [rest]: "red" };
  const result = migrate();
  assert.deepEqual(result.visualOverrides, expected);
  assert.deepEqual(result.customPresets.PL[0].ids, leaves);
  data.visualOverrides[danzigLeaves[0]] = "green";
  assert.deepEqual(migrate().visualOverrides, { ...expected, [danzigLeaves[0]]: "green" });
});
