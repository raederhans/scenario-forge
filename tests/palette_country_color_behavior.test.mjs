import test from "node:test";
import assert from "node:assert/strict";
import { getPaletteCountryTargets } from "../js/core/palette_country_targets.js";
import { getMapDataBoundary } from "../js/core/map_data_boundary.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import { createPaletteLibraryOperation } from "../js/core/palette_library_operation.js";
import { state } from "../js/core/state.js";
import { FileManager } from "../js/core/file_manager.js";
import { captureHistoryState, pushHistoryEntry, undoHistory, redoHistory, clearHistory } from "../js/core/history_manager.js";

const feature = (id, code, extra = {}) => ({ id, properties: { id, cntr_code: code, ...extra } });

test("country targets include unloaded scenario members, isolate scenario identity, and support numeric tags", () => {
  const fixture = {
    activeScenarioId: "test",
    scenarioBaselineOwnersByFeatureId: Object.freeze({ loaded: "D01", unloaded: "D01", foreign: "FRA" }),
    landIndex: new Map([["loaded", feature("loaded", "FR")], ["foreign", feature("foreign", "DE")]]),
    countryToFeatureIds: new Map([["D01", ["foreign"]]]),
  };
  assert.deepEqual([...getPaletteCountryTargets(fixture).get("D01")], ["loaded", "unloaded"]);
  fixture.scenarioBaselineOwnersByFeatureId = Object.freeze({ foreign: "D01" });
  assert.deepEqual([...getPaletteCountryTargets(fixture).get("D01")], ["foreign"]);
  fixture.activeScenarioId = "";
  assert.deepEqual([...getPaletteCountryTargets(fixture).keys()].sort(), ["DE", "FR"]);
  fixture.mapSemanticMode = "blank";
  assert.equal(getPaletteCountryTargets(fixture).size, 0);
});

test("explicit country painting overrides hover and local colors; real undo/redo restores the whole edit", (t) => {
  const patch = {
    activeScenarioId: "test",
    mapSemanticMode: "political",
    scenarioBaselineOwnersByFeatureId: Object.freeze({ loaded: "D01", unloaded: "D01", foreign: "FRA" }),
    landIndex: new Map([["loaded", feature("loaded", "FR")], ["foreign", feature("foreign", "DE")]]),
    hoveredId: "foreign", devSelectedHit: { id: "foreign" },
    sovereignBaseColors: { D01: "#112233", FRA: "#445566" },
    visualOverrides: { loaded: "#abcdef", foreign: "#654321" },
    selectedColor: "#000000",
  };
  const previous = Object.fromEntries(Object.keys(patch).map(key => [key, state[key]]));
  Object.assign(state, patch);
  clearHistory();
  t.after(() => { clearHistory(); Object.assign(state, previous); });
  const refreshes = [];
  const operation = createPaletteLibraryOperation({
    ...createPaletteLibraryStateAccess(state),
    getCountryFeatureIds: code => [...(getPaletteCountryTargets(state).get(code) || [])],
    captureHistoryState, pushHistoryEntry,
    selectPaintColor() {}, markDirty() {},
    refreshColorState() {},
    refreshResolvedColorsForFeatures(ids) { refreshes.push(ids); },
  });
  const before = captureHistoryState({ featureIds: ["loaded", "unloaded", "foreign"], ownerCodes: ["D01", "FRA"] });
  assert.equal(operation.applyColor("#ff0088", { countryCode: "missing" }).status, "no-target");
  assert.equal(operation.applyColor("invalid", { countryCode: "D01" }).status, "invalid-color");
  assert.deepEqual(captureHistoryState({ featureIds: ["loaded", "unloaded", "foreign"], ownerCodes: ["D01", "FRA"] }), before);
  assert.equal(operation.applyColor("#ff0088", { countryCode: "d01" }).featureCount, 2);
  assert.deepEqual(refreshes, [["loaded", "unloaded"]]);
  assert.equal(getMapDataBoundary(state).paint.resolveFeatureColor("loaded").color, "#ff0088");
  assert.equal(getMapDataBoundary(state).paint.resolveFeatureColor("unloaded").color, "#ff0088");
  assert.equal(state.visualOverrides.foreign, "#654321");
  assert.equal(undoHistory(), true);
  assert.deepEqual(captureHistoryState({ featureIds: ["loaded", "unloaded", "foreign"], ownerCodes: ["D01", "FRA"] }), before);
  assert.equal(redoHistory(), true);
  assert.equal(state.visualOverrides.loaded, "#ff0088");
  assert.equal(state.visualOverrides.unloaded, "#ff0088");
  assert.equal(state.sovereignBaseColors.D01, "#ff0088");
  const saved = JSON.parse(JSON.stringify(FileManager.buildProjectPayload(state)));
  assert.equal(saved.sovereignBaseColors.D01, "#ff0088");
  assert.equal(saved.visualOverrides.unloaded, "#ff0088");
  assert.equal(saved.visualOverrides.foreign, "#654321");
  assert.equal(state.scenarioBaselineOwnersByFeatureId.foreign, "FRA");
});
