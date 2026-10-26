import assert from "node:assert/strict";
import test from "node:test";
import { expandScenarioFeatureIds, projectScenarioFeatureIds } from "../js/core/scenario_hierarchy.js";
import { countryPresets, state } from "../js/core/state.js";
import {
  getScenarioReleasableCountries,
  rebuildPresetState,
  resolveFeatureIdsFromPresetSource,
} from "../js/core/releasable_manager.js";

// Scenario-scoped merges leave the shared preset and releasable ID lists on their
// members; the active scenario projects them when presets are read.
const bavaria = countryPresets.DE.find((preset) => preset.name === "Bavaria");
const [first, second, third] = bavaria.ids;
const outsider = countryPresets.DE.flatMap((preset) => preset.ids).find((id) => !bavaria.ids.includes(id));

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

test("historical presets resolve to whole merged features and recover after a scenario switch", () => {
  const merges = { DE_MRG_full: [first, second], DE_MRG_part: [third, outsider] };
  withRuntime(scenario(merges), (warnings) => {
    const ids = rebuildPresetState().DE.find((preset) => preset.name === "Bavaria").ids;
    assert.ok(ids.includes("DE_MRG_full"));
    assert.ok(![first, second, third, "DE_MRG_part"].some((id) => ids.includes(id)), "partial merge never counts");
    assert.equal(ids.length, bavaria.ids.length - 2);
    assert.deepEqual(warnings.find(([message]) => /part of a scenario merge/.test(message))?.[1].partial,
      [{ mergedId: "DE_MRG_part", missing: [outsider] }]);

    Object.assign(state, { activeScenarioId: "", activeScenarioManifest: null });
    assert.deepEqual(rebuildPresetState().DE.find((preset) => preset.name === "Bavaria").ids, bavaria.ids);
  });
  assert.equal(countryPresets.DE.find((preset) => preset.name === "Bavaria").ids, bavaria.ids, "shared presets stay intact");
});

test("releasable preset sources resolve in member IDs before projecting", () => {
  const merges = { DE_MRG_ab: ["a", "b"], DE_MRG_cd: ["c", "d"] };
  const entry = { tag: "BAY", release_lookup_iso2: "DE", color_hex: "#123456",
    preset_source: { type: "hierarchy_group_ids", group_ids: ["DE_G"], feature_ids: ["e"], exclude_feature_ids: ["d"] } };
  withRuntime({ ...scenario(merges), releasableCatalog: { entries: [entry] },
    hierarchyData: { groups: { DE_G: ["a", "b", "c", "d"] } } }, (warnings) => {
    // The projected hierarchy names DE_MRG_cd; excluding its member d must drop the merge, not keep it whole.
    assert.deepEqual(resolveFeatureIdsFromPresetSource(entry.preset_source, entry), ["e", "DE_MRG_ab"]);
    assert.equal(warnings.length, 1);
    assert.equal(getScenarioReleasableCountries("tno_1962").BAY.feature_count, 2);
    const core = rebuildPresetState().BAY.find((preset) => preset.preset_kind === "releasable_core");
    assert.deepEqual(core.ids, ["e", "DE_MRG_ab"]);

    const whole = { ...entry.preset_source, exclude_feature_ids: [] };
    assert.deepEqual(resolveFeatureIdsFromPresetSource(whole, entry), ["e", "DE_MRG_ab", "DE_MRG_cd"]);
  });
});

test("a scenario catalog naming merged IDs excludes and selects them against hierarchy groups", () => {
  const entry = { tag: "BAY", release_lookup_iso2: "DE" };
  withRuntime({ ...scenario({ M: ["a", "b"] }), hierarchyData: { groups: { DE_G: ["a", "b", "c"] } } }, (warnings) => {
    const resolve = (source) => resolveFeatureIdsFromPresetSource({ type: "feature_selection", ...source }, entry);
    assert.deepEqual(resolve({ group_ids: ["DE_G"], exclude_feature_ids: ["M"] }), ["c"]);
    assert.deepEqual(resolve({ feature_ids: ["M"], exclude_group_ids: ["DE_G"] }), []);
    assert.deepEqual(resolve({ feature_ids: ["M", "c"] }), ["M", "c"]);
    assert.equal(warnings.length, 1, "only the empty resolution warns");
  });
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
