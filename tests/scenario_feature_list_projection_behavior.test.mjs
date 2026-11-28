import assert from "node:assert/strict";
import test from "node:test";
import { expandScenarioFeatureIds, projectScenarioFeatureIds } from "../js/core/scenario/scenario_hierarchy.js";
import { state } from "../js/core/state.js";
import { rebuildPresetState } from "../js/core/releasable_manager.js";

function withRuntime(patch, run) {
  const keys = ["activeScenarioId", "activeScenarioManifest", "releasableCatalog", "hierarchyData", "scenarioCountriesByTag",
    "customPresets", "presetsState", "defaultReleasablePresetOverlays", "scenarioReleasablePresetOverlays"];
  const saved = Object.fromEntries(keys.map((key) => [key, state[key]]));
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    Object.assign(state, { scenarioCountriesByTag: {}, customPresets: {}, hierarchyData: { groups: {} } }, patch);
    return run(warnings);
  } finally {
    console.warn = warn;
    Object.assign(state, saved);
  }
}

const scenario = (featureMerges) => ({
  activeScenarioId: "tno_1962",
  activeScenarioManifest: { hierarchy_overrides: { feature_merges: featureMerges } },
});

test("a merged feature joins a list only when the list names all of its members", () => {
  const override = { feature_merges: { M_FULL: ["a", "b"], M_PART: ["c", "z"] } };
  assert.deepEqual(projectScenarioFeatureIds(["x", "a", "c", "b", "x"], override), {
    ids: ["x", "M_FULL"],
    partial: [{ mergedId: "M_PART", missing: ["z"] }],
  });
  assert.deepEqual(expandScenarioFeatureIds(["M_FULL", "y"], override), ["a", "b", "y"]);
  // An invalid merge record (a member in two merges) projects nothing, as in the hierarchy.
  const invalid = { feature_merges: { M1: ["a", "b"], M2: ["b", "c"] } };
  assert.deepEqual(projectScenarioFeatureIds(["a", "b"], invalid), { ids: ["a", "b"], partial: [] });
  assert.deepEqual(projectScenarioFeatureIds(["a", "b"], null), { ids: ["a", "b"], partial: [] });
});

test("entries of other scenarios are not resolved against the active scenario's merges", () => {
  const hoi4Only = { tag: "RKU", release_lookup_iso2: "UA", scenario_ids: ["hoi4_1936"],
    preset_source: { type: "feature_ids", feature_ids: ["a"] } };
  withRuntime({ ...scenario({ M: ["a", "b"] }), releasableCatalog: { entries: [hoi4Only] } }, (warnings) => {
    rebuildPresetState();
    assert.deepEqual(state.defaultReleasablePresetOverlays, {});
    // During startup the manifest can arrive before its scenario id: nothing is projected yet.
    state.activeScenarioId = "";
    rebuildPresetState();
    assert.deepEqual(state.defaultReleasablePresetOverlays.UA[0].ids, ["a"]);
    assert.deepEqual(warnings, []);
  });
});
