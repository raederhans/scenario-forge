import assert from "node:assert/strict";
import test from "node:test";
import { ColorManager } from "../js/core/color_manager.js";
import { getCountryLocateIds, getCountryOverrideIds, resetCountryOverrides } from "../js/core/country_override_reset_command.js";
import { captureHistoryState, pushHistoryEntry, redoHistory, undoHistory } from "../js/core/history_manager.js";
import { autoFillMap } from "../js/core/map_renderer.js";
import { createPaletteLibraryOperation } from "../js/core/palette_library_operation.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import { getProjectCountryBaseColors, restoreProjectCountries, serializeProjectCountries } from "../js/core/project_countries.js";
import { registerColorAsProjectCountry, renameProjectCountry } from "../js/core/project_country_commands.js";
import { createBorderIdentityResolver } from "../js/core/renderer/border_identity.js";
import { state, registerRuntimeHook } from "../js/core/state.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";

const color = "#abc123";

async function setup() {
  const { state: fixture, cells } = await makeFixture();
  Object.assign(state, fixture, {
    scenarioCountriesByTag: { FR: { tag: "FR" } }, countryPalette: {}, countryNameOverrides: {},
    historyPast: [], historyFuture: [], legendLabels: {}, legendColorOrder: [], selectedInspectorCountryCode: "",
    visualOverrides: { N: color }, hoveredId: "", devSelectedHit: null,
  });
  registerRuntimeHook(state, "resolveBorderIdentityFn", createBorderIdentityResolver({
    sovereignBaseColors: () => state.sovereignBaseColors,
    getReferenceOwner: () => "FR",
    getOverrideColor: (id, feature) => feature?.properties?.__riverParentId
      ? state.riverPaint.overrides[id] : state.visualOverrides[id],
  }));
  return cells.map(cell => cell.id);
}

test("auto-fill preserves a project country through a region color collision and reload", async () => {
  await setup();
  const reserved = ColorManager.getRegionColor("FR");
  state.visualOverrides.N = reserved;
  assert.equal(registerColorAsProjectCountry(reserved), "P01");
  autoFillMap("region");
  assert.equal(state.sovereignBaseColors.P01, reserved);
  assert.ok(state.sovereignBaseColors.FR);
  assert.notEqual(state.sovereignBaseColors.FR.toLowerCase(), reserved);
  const draft = { activeScenarioId: state.activeScenarioId, scenarioCountriesByTag: {}, sovereignBaseColors: state.sovereignBaseColors };
  restoreProjectCountries(draft, serializeProjectCountries(state));
  assert.equal(draft.countryPalette.P01, reserved);
  delete draft.sovereignBaseColors.P01;
  assert.deepEqual(getProjectCountryBaseColors(draft), {});
});

test("palette recolors the selected project country once and rejects another country's color", async () => {
  await setup();
  registerColorAsProjectCountry(color);
  const operation = createPaletteLibraryOperation({
    state, ...createPaletteLibraryStateAccess(state), captureHistoryState, pushHistoryEntry,
    refreshResolvedColorsForFeatures() {}, refreshColorState() {}, markDirty() {},
    selectPaintColor(value) { state.selectedColor = value; },
  });
  const next = "#123456";
  assert.equal(operation.applyColor(next).status, "applied");
  assert.deepEqual(state.sovereignBaseColors, { FR: "#ff0000", P01: next });
  assert.equal(state.visualOverrides.N, next);
  assert.equal(state.historyPast.length, 2);
  assert.equal(operation.applyColor("#ff0000").status, "no-target");
  assert.equal(state.selectedColor, next);
  assert.equal(state.historyPast.length, 2);
  assert.ok(undoHistory());
  assert.equal(state.visualOverrides.N, color);
  assert.equal(state.sovereignBaseColors.P01, color);
  const explicit = operation.applyColor(next, { countryCode: "P01" });
  assert.deepEqual([explicit.status, explicit.featureCount, explicit.preservedCount], ["applied", 1, 0]);
});

test("registration, rename and legacy project restore use the same name limit", async () => {
  await setup();
  const limited = "国".repeat(119) + "🌎";
  const long = limited + "国";
  registerColorAsProjectCountry(color, { name: long });
  assert.equal(state.scenarioCountriesByTag.P01.display_name, limited);
  renameProjectCountry("P01", "A" + long);
  assert.equal(state.countryNameOverrides.P01.en, ("A" + long).slice(0, 120));
  const draft = { activeScenarioId: "s", sovereignBaseColors: { P01: color } };
  restoreProjectCountries(draft, [{ tag: "P01", name: long }]);
  assert.equal(draft.scenarioCountriesByTag.P01.display_name, limited);
});

test("cell-only territory locates its parent and resets only its own paint in one undo step", async () => {
  const [own, other] = await setup();
  state.visualOverrides = { P: "#999999" };
  state.riverPaint.overrides = { [own]: color, [other]: "#ff0000" };
  assert.equal(registerColorAsProjectCountry(color), "P01");
  assert.deepEqual(getCountryLocateIds(state, "P01"), ["P"]);
  const ids = getCountryOverrideIds(state, "P01");
  assert.deepEqual(ids, ["P"]);
  resetCountryOverrides(ids, "P01");
  assert.deepEqual(state.riverPaint.overrides, { [other]: "#ff0000" });
  assert.deepEqual(state.visualOverrides, { P: "#999999" });
  assert.deepEqual(getCountryLocateIds(state, "P01"), []);
  assert.equal(state.historyPast.length, 2);
  assert.ok(undoHistory());
  assert.equal(state.riverPaint.overrides[own], color);
  assert.ok(redoHistory());
  assert.deepEqual(state.riverPaint.overrides, { [other]: "#ff0000" });
});
