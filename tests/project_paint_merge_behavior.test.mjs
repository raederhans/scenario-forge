import assert from "node:assert/strict";
import test from "node:test";
import { undoHistory } from "../js/core/history_manager.js";
import { planProjectPaintMerge as plan, applyProjectPaintMerge } from "../js/core/project_paint_merge.js";
import { buildProjectCountryEntry } from "../js/core/project_countries.js";
import { state } from "../js/core/state.js";
import { readRegisteredRuntimeHookSource, registerRuntimeHook } from "../js/core/state/index.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";

const target = () => ({
  activeScenarioId: "target", scenarioCountriesByTag: { GER: { display_name: "Germany" }, FRA: { display_name: "France" } },
  sovereignBaseColors: { GER: "#112233", FRA: "#880000" }, countryPalette: {}, scenarioBaselineOwnersByFeatureId: { A: "GER", B: "FRA" },
  runtimeFeatureIds: ["C"], visualOverrides: {}, waterRegionOverrides: {}, waterRegionsById: new Map([["sea", {}]]),
  legendLabels: {}, countryNameOverrides: {}, riverPaint: { pack: null, overrides: {} },
});

test("fill blanks preserves explicit paint, uses only current IDs and reports invalid colors and unmatched IDs", () => {
  const current = target();
  current.visualOverrides.B = "#998877";
  current.waterRegionOverrides.sea = "#123456";
  current.topologyPrimary = { objects: { political: { geometries: [{ id: "base-only" }] } } };
  const source = { visualOverrides: { A: "#abc", B: "#def", C: "not a color", "base-only": "#ABC", constructor: "#abc" },
    waterRegionOverrides: { sea: "#321", ocean: "#def", lake: "red" } };
  const { patch, report } = plan(source, current, { mode: "fill-blanks" });
  assert.deepEqual(patch.visualOverrides, { A: "#aabbcc" });
  assert.deepEqual(patch.waterRegionOverrides, {});
  assert.deepEqual(report.unmatchedIds.sort(), ["base-only", "constructor", "ocean"]);
  assert.deepEqual(report.unmatchedGroups, [{ srcTag: "", color: "#aabbcc", count: 2 }, { srcTag: "", color: "#ddeeff", count: 1 }]);
  assert.deepEqual(report.invalidColors, [{ field: "visualOverrides", id: "C" }, { field: "waterRegionOverrides", id: "lake" }]);
  assert.equal(report.writtenCount, 1);
  assert.equal(report.skippedCount, 7);
});

test("a target merge cannot assign two different current country colors to the same parcel", () => {
  const current = target();
  current.activeScenarioManifest = { hierarchy_overrides: { feature_merges: { A: ["X", "Y"] } } };
  const sourceReference = { countries: { GER: {}, FRA: {} }, ownersByFeatureId: { X: "GER", Y: "FRA" } };
  const source = { visualOverrides: { X: "#abc", Y: "#abc" }, sovereignBaseColors: { GER: "#abc", FRA: "#abc" } };
  const mixed = plan(source, current, { sourceReference });
  assert.deepEqual(mixed.patch.visualOverrides, {});
  assert.deepEqual(mixed.report.unmatchedIds, ["X", "Y"]);
});

test("one undo restores the pre-merge content", async t => {
  const { pack, cells, state: fixture } = await makeFixture();
  const initial = { ...target(), ...fixture, historyPast: [], historyFuture: [], isDirty: false, dirtyRevision: 0, lastDirtyReason: "",
    runtimeFeatureIds: ["P", "N"], countryNameOverrides: { P01: { en: "Original" }, P02: { zh: "保留" } },
    capitalOverrides: { P01: { cityId: "original" } }, legendLabels: { "#abcdef": "Existing legend" }, legendColorOrder: ["#abcdef"],
    visualOverrides: { B: "#999999" } };
  initial.scenarioCountriesByTag.P01 = buildProjectCountryEntry("P01", "Original");
  initial.sovereignBaseColors.P01 = "#000000";
  const saved = Object.fromEntries(Object.keys(initial).map(key => [key, state[key]]));
  const previous = readRegisteredRuntimeHookSource(state, "refreshColorStateFn");
  Object.assign(state, initial);
  registerRuntimeHook(state, "refreshColorStateFn", () => {});
  t.after(() => { registerRuntimeHook(state, "refreshColorStateFn", previous); Object.assign(state, saved); });
  const snapshot = () => structuredClone(Object.fromEntries(["visualOverrides", "waterRegionOverrides", "riverPaint", "scenarioCountriesByTag",
    "countryPalette", "sovereignBaseColors", "legendLabels", "countryNameOverrides", "capitalOverrides"].map(key => [key, state[key]])));
  const before = snapshot();
  const source = { scenario: { id: pack.sceneId, baselineHash: pack.source.baselineHash }, projectCountries: [{ tag: "P01", name: "One" }, { tag: "P02", name: "Two" }],
    sovereignBaseColors: { P01: "#999", P02: "#abcdef", FR: "#fafafa" }, visualOverrides: { N: "#999" },
    countryNameOverrides: { P01: { zh: "一" }, P02: { en: "Second" }, FR: { en: "Ignore" } },
    legendLabels: { "#999": "One", "#abc": "New", "#123456": "Ship" },
    waterRegionOverrides: { sea: "#123456" }, riverPaint: { pack, overrides: { [cells[0].id]: "#999" } } };
  const result = plan(source, state, { fileName: "paint.json" });
  assert.deepEqual(snapshot(), before);
  assert.equal(applyProjectPaintMerge(state, result), true);
  assert.equal(state.historyPast.length, 1);
  assert.deepEqual(state.visualOverrides, { B: "#999999", N: result.patch.projectCountries[0].color });
  assert.equal(undoHistory(), true);
  assert.deepEqual(snapshot(), before);
});
