import assert from "node:assert/strict";
import test from "node:test";
import { redoHistory, undoHistory } from "../js/core/history_manager.js";
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
  const before = structuredClone({ current, source });
  const { patch, report } = plan(source, current, { mode: "fill-blanks" });
  assert.deepEqual(patch.visualOverrides, { A: "#aabbcc" });
  assert.deepEqual(patch.waterRegionOverrides, {});
  assert.deepEqual(report.unmatchedIds.sort(), ["base-only", "constructor", "ocean"]);
  assert.deepEqual(report.unmatchedGroups, [{ srcTag: "", color: "#aabbcc", count: 2 }, { srcTag: "", color: "#ddeeff", count: 1 }]);
  assert.deepEqual(report.invalidColors, [{ field: "visualOverrides", id: "C" }, { field: "waterRegionOverrides", id: "lake" }]);
  assert.equal(report.writtenCount, 1);
  assert.equal(report.skippedCount, 7);
  assert.deepEqual({ current, source }, before);
  const overwrite = plan(source, current, { mode: "overwrite" }).patch;
  assert.equal(overwrite.visualOverrides.B, "#ddeeff");
  assert.equal(overwrite.waterRegionOverrides.sea, "#332211");
  current.runtimeFeatureIds = [];
  current.scenarioBaselineOwnersByFeatureId = {};
  assert.deepEqual(plan(source, current).patch.visualOverrides, {});
});

test("color lookup filters aliases, prefers the saved reference owner and reports both color policies", () => {
  const current = target();
  const source = { visualOverrides: { A: "#800", B: "#800", C: "#abc", LOST: "#800" },
    sovereignBaseColors: { DE: "#800", GER: "#800", ITA: "#800" }, legendLabels: { "#880000": "red" } };
  const sourceReference = { countries: { GER: {}, ITA: {} }, ownersByFeatureId: { A: "GER", B: "ITA", LOST: "GER" } };
  current.scenarioCountriesByTag.ITA = { display_name: "Italy" };
  current.sovereignBaseColors.ITA = "#336699";
  const { patch, report } = plan(source, current, { sourceReference });
  assert.deepEqual(patch.visualOverrides, { A: "#112233", B: "#336699", C: "#aabbcc" });
  assert.deepEqual(patch.legendLabels, { "#112233": "red", "#336699": "red" });
  assert.deepEqual(report.colorChanges.map(c => [c.srcTag, c.currentTag, c.reason]), [
    ["GER", "FRA", "collision"], ["ITA", "FRA", "collision"],
  ]);
  assert.deepEqual(report.missingColors, ["#aabbcc"]);
  assert.deepEqual(report.unmatchedGroups, [{ srcTag: "GER", color: "#880000", count: 1 }]);
  assert.deepEqual(plan(source, current, { sourceReference, colorPolicy: "keep-original" }).patch.visualOverrides,
    { A: "#880000", B: "#880000", C: "#aabbcc" });
  source.sovereignBaseColors.GER = source.visualOverrides.A = "#fedcba";
  assert.equal(plan(source, current, { sourceReference }).report.colorChanges[0].reason, "base-changed");
  source.sovereignBaseColors.GER = source.visualOverrides.A = current.sovereignBaseColors.GER;
  assert.equal(plan(source, current, { sourceReference }).patch.visualOverrides.A, "#112233");
});

test("source splits require equal complete coverage, then target splits receive the parent paint", () => {
  const current = target();
  current.activeScenarioManifest = { hierarchy_overrides: { feature_splits: { P: ["A", "C"] } } };
  const sourceReference = { countries: {}, manifest: { hierarchy_overrides: { feature_splits: { P: ["X", "Y"] } } } };
  const source = { scenario: { id: "other" }, visualOverrides: { X: "#abc", Y: "#AABBCC" } };
  const merged = plan(source, current, { sourceReference });
  assert.deepEqual(merged.patch.visualOverrides, { A: "#aabbcc", C: "#aabbcc" });
  assert.equal(merged.report.migratedCount, 2);
  source.visualOverrides.Y = "#fff";
  const mixed = plan(source, current, { sourceReference });
  assert.deepEqual(mixed.patch.visualOverrides, {});
  assert.deepEqual(mixed.report.unmatchedIds, ["X", "Y"]);
  delete source.visualOverrides.Y;
  assert.deepEqual(plan(source, current, { sourceReference }).report.unmatchedIds, ["X"]);
});

test("a target merge cannot assign two different current country colors to the same parcel", () => {
  const current = target();
  current.activeScenarioManifest = { hierarchy_overrides: { feature_merges: { A: ["X", "Y"] } } };
  const sourceReference = { countries: { GER: {}, FRA: {} }, ownersByFeatureId: { X: "GER", Y: "FRA" } };
  const source = { visualOverrides: { X: "#abc", Y: "#abc" }, sovereignBaseColors: { GER: "#abc", FRA: "#abc" } };
  const mixed = plan(source, current, { sourceReference });
  assert.deepEqual(mixed.patch.visualOverrides, {});
  assert.deepEqual(mixed.report.unmatchedIds, ["X", "Y"]);
  assert.deepEqual(plan(source, current, { sourceReference, colorPolicy: "keep-original" }).patch.visualOverrides, { A: "#aabbcc" });
});

test("river cells join matching packs individually and uniform banks enter land migration before filtering", async () => {
  const { pack, cells, state: fixture } = await makeFixture();
  const current = { ...target(), ...fixture, runtimeFeatureIds: ["P", "N"] };
  const [x, y] = cells.map(cell => cell.id);
  const source = { scenario: { id: pack.sceneId, baselineHash: pack.source.baselineHash },
    riverPaint: { pack, overrides: { [x]: "#abc", [y]: "#ABC", unknown: "#def" } } };
  current.riverPaint.overrides[x] = "#123456";
  const direct = plan(source, current);
  assert.deepEqual(direct.patch.riverPaintOverrides, { [y]: "#aabbcc" });
  assert.equal(direct.report.skippedCount, 2);
  assert.deepEqual(direct.report.unmatchedIds, ["unknown"]);
  source.scenario.baselineHash = "older";
  assert.deepEqual(plan(source, current, { mode: "overwrite" }).patch.visualOverrides, { P: "#aabbcc" });
  source.scenario.baselineHash = pack.source.baselineHash;
  current.activeScenarioId = "target";
  current.runtimeFeatureIds = ["N"];
  current.activeScenarioManifest = { hierarchy_overrides: { feature_splits: { P: ["A", "B"] } } };
  const down = plan(source, current);
  assert.deepEqual(down.patch.visualOverrides, { A: "#aabbcc", B: "#aabbcc" });
  assert.deepEqual(down.patch.riverPaintOverrides, {});
  assert.equal(down.report.migratedCount, 2);
  source.riverPaint.overrides[y] = "#111";
  const mixed = plan(source, current);
  assert.deepEqual(mixed.patch.visualOverrides, {});
  assert.deepEqual(new Set(mixed.report.unmatchedIds), new Set([x, y, "unknown"]));
  delete source.riverPaint.overrides[y];
  assert.deepEqual(plan(source, current).report.unmatchedIds.sort(), [x, "unknown"].sort());
});

test("matching countries reuse their tags and reservations protect references left after unregistration", () => {
  const current = target();
  current.scenarioCountriesByTag.P01 = buildProjectCountryEntry("P01", "Blue");
  current.sovereignBaseColors.P01 = "#0000ff";
  current.countryNameOverrides.P02 = { en: "Retired" };
  current.capitalOverrides = { P03: { cityId: "old" } };
  current.politicalOverrides = { P04: { alliance: null } };
  current.mapLabels = [{ countryCode: "P05" }];
  current.historyPast = [{ meta: { scenarioId: "target" }, before: { projectCountries: { P06: null } } }];
  current.legendLabels["#ffffff"] = "Keep this label";
  const source = { projectCountries: [{ tag: "Q01", name: "Blue" }, { tag: "P02", name: "White" }, { tag: "P07", name: "Seven" }],
    sovereignBaseColors: { Q01: "#00f", P02: "#fff", P07: "#888" }, countryNameOverrides: { Q01: { en: "Blue" } },
    visualOverrides: { A: "#fff", B: "#00f" }, legendLabels: { "#fff": "White", "#00f": "Blue" } };
  const { patch, report } = plan(source, current);
  assert.deepEqual(patch.projectCountries.map(c => c.tag), ["P08", "P07"]);
  assert.deepEqual(patch.countryNameOverrides, {});
  assert.deepEqual(report.countryChanges.map(c => [c.from, c.to]), [["Q01", "P01"], ["P02", "P08"], ["P07", "P07"]]);
  assert.notEqual(patch.visualOverrides.A, "#ffffff");
  assert.equal(patch.legendLabels[patch.visualOverrides.A], "White");
  assert.equal(patch.visualOverrides.B, "#0000ff");
});

test("overwriting a painted parent clears old cells while retaining explicit source cells", async () => {
  const { pack, cells, state: fixture } = await makeFixture();
  const current = { ...target(), ...fixture, runtimeFeatureIds: ["P"], visualOverrides: { P: "#aabbcc" } };
  const [first, second] = cells.map(cell => cell.id);
  current.riverPaint.overrides = { [first]: "#123456", [second]: "#654321" };
  const source = { scenario: { id: pack.sceneId, baselineHash: pack.source.baselineHash },
    visualOverrides: { P: "#abc" }, riverPaint: { pack, overrides: { [second]: "#654321" } } };
  assert.deepEqual(plan(source, current).patch.riverPaintOverrides, {});
  const overwrite = () => plan(source, current, { mode: "overwrite" });
  const { patch, report } = overwrite();
  assert.deepEqual(patch.riverPaintOverrides, { [first]: null });
  assert.equal(report.writtenCount, 1);
  assert.equal(report.skippedCount, 1);
  source.riverPaint.overrides[second] = "#fff";
  current.visualOverrides.P = "#111111";
  const changed = overwrite();
  assert.deepEqual(changed.patch.visualOverrides, { P: "#aabbcc" });
  assert.deepEqual(changed.patch.riverPaintOverrides, { [first]: null, [second]: "#ffffff" });
  assert.equal(changed.report.writtenCount, 2);
});

test("legend-only colors cannot label another country or inflate paint diagnostics", () => {
  const current = target();
  current.visualOverrides.A = "#111111";
  const source = { visualOverrides: { A: "#800" }, sovereignBaseColors: { ITA: "#800", GER: "#456" },
    legendLabels: { "#800": "Italy", "#456": "Germany", "#abc": "Free color" } };
  const sourceReference = { countries: { ITA: {}, GER: {} } };
  for (const colorPolicy of ["current-base", "keep-original"]) {
    const { patch, report } = plan(source, current, { sourceReference, colorPolicy });
    const germanColor = colorPolicy === "current-base" ? "#112233" : "#445566";
    assert.deepEqual(patch.legendLabels, { [germanColor]: "Germany", "#aabbcc": "Free color" });
    assert.deepEqual(report.colorChanges, []);
    assert.deepEqual(report.missingColors, []);
  }
});

test("same-scenario paint follows the explicit baseline crosswalk and rejects unresolved parcels", () => {
  const current = { ...target(), scenarioBaselineHash: "new", runtimeFeatureIds: ["US_A", "US_B", "US_UNRESOLVED"] };
  current.activeScenarioManifest = { scenario_id: "target", baseline_hash: "new", project_feature_migration: {
    version: 1, scenario_id: "target", source_baseline_hash: "old", target_baseline_hash: "new",
    feature_id_prefixes: ["US_"], crosswalk: { US_A: ["US_B"] }, unresolved_ids: ["US_UNRESOLVED"],
  } };
  const source = { scenario: { id: "target", baselineHash: "old" }, visualOverrides: { US_A: "#abc" } };
  const { patch, report } = plan(source, current);
  assert.deepEqual(patch.visualOverrides, { US_B: "#aabbcc" });
  assert.equal(report.migratedCount, 1);
  source.visualOverrides.US_UNRESOLVED = "#abc";
  assert.throws(() => plan(source, current), { code: "PROJECT_FEATURE_MIGRATION_REVIEW_REQUIRED" });
  assert.deepEqual(current.visualOverrides, {});
});

test("one merge commits only the sparse paint, country and missing legend fields and round-trips through history", async t => {
  const { pack, cells, state: fixture } = await makeFixture();
  const initial = { ...target(), ...fixture, historyPast: [], historyFuture: [], isDirty: false, dirtyRevision: 0, lastDirtyReason: "",
    runtimeFeatureIds: ["P", "N"], countryNameOverrides: { P01: { en: "Original" }, P02: { zh: "保留" } },
    capitalOverrides: { P01: { cityId: "original" } }, legendLabels: { "#abcdef": "Existing legend" }, legendColorOrder: ["#abcdef"],
    visualOverrides: { B: "#999999" } };
  initial.scenarioCountriesByTag.P01 = buildProjectCountryEntry("P01", "Original");
  initial.sovereignBaseColors.P01 = "#000000";
  const saved = Object.fromEntries(Object.keys(initial).map(key => [key, state[key]]));
  const previous = readRegisteredRuntimeHookSource(state, "refreshColorStateFn");
  const refreshes = [];
  Object.assign(state, initial);
  registerRuntimeHook(state, "refreshColorStateFn", options => refreshes.push(options));
  t.after(() => { registerRuntimeHook(state, "refreshColorStateFn", previous); Object.assign(state, saved); });
  const snapshot = () => structuredClone(Object.fromEntries(["visualOverrides", "waterRegionOverrides", "riverPaint", "scenarioCountriesByTag",
    "countryPalette", "sovereignBaseColors", "legendLabels", "countryNameOverrides", "capitalOverrides"].map(key => [key, state[key]])));
  const before = snapshot();
  const source = { scenario: { id: pack.sceneId, baselineHash: pack.source.baselineHash }, projectCountries: [{ tag: "P01", name: "One" }, { tag: "P02", name: "Two" }],
    sovereignBaseColors: { P01: "#999", P02: "#abcdef", FR: "#fafafa" }, visualOverrides: { N: "#999" },
    countryNameOverrides: { P01: { zh: "一" }, P02: { en: "Second" }, FR: { en: "Ignore" } },
    legendLabels: { "#999": "One", "#abc": "New", "#123456": "Ship" },
    waterRegionOverrides: { sea: "#123456" }, riverPaint: { pack, overrides: { [cells[0].id]: "#999" } },
    capitalOverrides: { P01: {} }, mapLabels: [{ id: "other" }], unitCounters: [{ id: "unit" }], projectCities: [{ id: "city" }],
    politicalOverrides: { FR: { alliance: "axis" } }, operationalLines: [{}], projectName: "source" };
  const excluded = ["mapLabels", "unitCounters", "projectCities", "politicalOverrides", "operationalLines", "projectName"];
  const untouched = excluded.map(key => structuredClone(state[key]));
  const result = plan(source, state, { fileName: "paint.json" });
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(result.patch.projectCountries.map(c => c.tag), ["P03", "P04"]);
  const [one, two] = result.patch.projectCountries;
  assert.notEqual(one.color, "#999999");
  assert.notEqual(two.color, "#abcdef");
  assert.equal(applyProjectPaintMerge(state, result), true);
  assert.deepEqual(refreshes, [{ renderNow: true }]);
  assert.equal(state.historyPast.length, 1);
  assert.equal(state.historyPast[0].kind, "merge-project-paint");
  assert.equal(state.historyPast[0].meta.name, "paint.json");
  assert.equal(state.historyPast[0].meta.scenarioId, pack.sceneId);
  assert.equal(state.lastDirtyReason, "merge-project-paint");
  assert.equal(state.dirtyRevision, 1);
  assert.deepEqual(state.visualOverrides, { B: "#999999", N: one.color });
  assert.deepEqual(state.riverPaint.overrides, { [cells[0].id]: one.color });
  assert.deepEqual(state.waterRegionOverrides, { sea: "#123456" });
  assert.deepEqual(state.legendLabels, { "#abcdef": "Existing legend", [one.color]: "One", "#aabbcc": "New", "#123456": "Ship" });
  assert.deepEqual(state.countryNameOverrides, { ...before.countryNameOverrides, P03: { zh: "一" }, P04: { en: "Second" } });
  assert.equal(state.sovereignBaseColors.FR, before.sovereignBaseColors.FR);
  assert.deepEqual(state.capitalOverrides, before.capitalOverrides);
  assert.deepEqual(excluded.map(key => state[key]), untouched);
  const after = snapshot();
  assert.equal(undoHistory(), true);
  assert.deepEqual(snapshot(), before);
  assert.equal(redoHistory(), true);
  assert.deepEqual(snapshot(), after);
  const empty = plan({ legendLabels: { "#123456": "Different label" } }, state);
  assert.deepEqual(empty.patch.legendLabels, {});
  assert.equal(applyProjectPaintMerge(state, empty), false);
  assert.equal(state.historyPast.length, 1);
  assert.deepEqual(snapshot(), after);
});
