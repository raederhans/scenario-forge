import test from "node:test";
import assert from "node:assert/strict";
import { getPaletteCountryTargets } from "../js/core/palette_country_targets.js";
import { getMapDataBoundary } from "../js/core/map_data_boundary.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import { createPaletteLibraryOperation } from "../js/core/palette_library_operation.js";

const feature = (id, code, extra = {}) => ({ id, properties: { id, cntr_code: code, ...extra } });

test("country targets include unloaded scenario members", () => {
  const fixture = {
    activeScenarioId: "test",
    scenarioBaselineOwnersByFeatureId: Object.freeze({ loaded: "D01", unloaded: "D01", foreign: "FRA" }),
    landIndex: new Map([["loaded", feature("loaded", "FR")], ["foreign", feature("foreign", "DE")]]),
    countryToFeatureIds: new Map([["D01", ["foreign"]]]),
  };
  assert.deepEqual([...getPaletteCountryTargets(fixture).get("D01")], ["loaded", "unloaded"]);
});

test("explicit country painting preserves foreign members", async () => {
  const foreignColor = "#112233";
  const state = {
    activeScenarioId: "test",
    mapSemanticMode: "political",
    scenarioBaselineOwnersByFeatureId: Object.freeze({ loaded: "D01", unloaded: "D01", foreign: "FRA" }),
    landIndex: new Map([["loaded", feature("loaded", "FR")], ["foreign", feature("foreign", "DE")]]),
    hoveredId: "foreign", devSelectedHit: { id: "foreign" },
    sovereignBaseColors: { D01: "#112233", FRA: "#445566" },
    visualOverrides: { loaded: "#abcdef", foreign: foreignColor },
    legendLabels: { "#112233": "Original" },
    legendColorOrder: ["#112233"],
    colors: { foreign: foreignColor },
    selectedColor: "#000000",
  };
  const operation = createPaletteLibraryOperation({
    state,
    ...createPaletteLibraryStateAccess(state),
    dialog: async () => false,
    getCountryFeatureIds: code => [...(getPaletteCountryTargets(state).get(code) || [])],
    captureHistoryState: () => ({}), pushHistoryEntry() {},
    selectPaintColor() {}, markDirty() {},
    refreshColorState() {},
    refreshResolvedColorsForFeatures() {},
  });
  assert.equal((await operation.applyColor("#ff0088", { countryCode: "d01" })).featureCount, 1);
  assert.equal(getMapDataBoundary(state).paint.resolveFeatureColor("unloaded").color, "#ff0088");
  assert.equal(state.visualOverrides.foreign, foreignColor);
});
