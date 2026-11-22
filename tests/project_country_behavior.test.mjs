import test from "node:test";
import assert from "node:assert/strict";
import { state, registerRuntimeHook } from "../js/core/state.js";
import { createBorderIdentityResolver } from "../js/core/renderer/border_identity.js";
import { allocateProjectCountryTag, restoreProjectCountries, serializeProjectCountries } from "../js/core/project_countries.js";
import { registerColorAsProjectCountry, unregisterProjectCountry, recolorProjectCountry, renameProjectCountry } from "../js/core/project_country_commands.js";
import { undoHistory, redoHistory } from "../js/core/history_manager.js";
import { getHistoryActionLabel } from "../js/core/history_action_labels.js";
import { getCountryLocateIds, getCountryOverrideIds } from "../js/core/country_override_reset_command.js";
import { createScenarioLifecycleRuntime } from "../js/core/scenario/lifecycle_runtime.js";
import { resetCountryColors } from "../js/core/country_color_commands.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";

const color = "#aabbcc";
function setup() {
  Object.assign(state, {
    activeScenarioId: "modern_world", scenarioCountriesByTag: { FR: { tag: "FR" } },
    sovereignBaseColors: { FR: "#112233" }, scenarioFixedOwnerColors: { FR: "#112233" }, countryPalette: {},
    visualOverrides: { N: color }, countryNames: {}, countryNameOverrides: {}, parentBorderEnabledByCountry: {},
    customPresets: {}, capitalOverrides: {}, mapLabels: [], historyPast: [], historyFuture: [],
    riverPaint: null, landIndex: new Map(), landData: null, legendLabels: {}, legendColorOrder: [], currentLanguage: "en",
    selectedInspectorCountryCode: "", activeSovereignCode: "", inspectorHighlightCountryCode: "",
  });
  const resolve = createBorderIdentityResolver({
    sovereignBaseColors: () => state.sovereignBaseColors,
    getCountryTags: () => new Set(Object.keys(state.scenarioCountriesByTag)),
    getReferenceOwner: () => "FR",
    getOverrideColor: (id, feature) => feature?.properties?.__riverParentId
      ? state.riverPaint.overrides[id] : state.visualOverrides[id],
  });
  const refreshes = [];
  registerRuntimeHook(state, "resolveBorderIdentityFn", resolve);
  registerRuntimeHook(state, "refreshColorStateFn", options => refreshes.push(options));
  return { resolve, refreshes };
}

function tables() {
  return [state.scenarioCountriesByTag, state.sovereignBaseColors, state.countryPalette];
}

function assertReplaced(previous) {
  tables().forEach((value, index) => assert.notEqual(value, previous[index]));
}

test("registration, removal and history update identities and inspector selection", () => {
  const { resolve } = setup();
  state.currentLanguage = "zh";
  assert.equal(resolve("N"), "color:" + color);
  const original = tables();
  assert.equal(registerColorAsProjectCountry("#ABC"), "P01");
  assertReplaced(original);
  assert.equal(resolve("N"), "P01");
  assert.deepEqual(serializeProjectCountries(state), [{ tag: "P01", name: "新国家 1" }]);
  assert.equal(getHistoryActionLabel("", state.historyPast.at(-1)), "登记新国家 新国家 1");
  assert.deepEqual(getCountryLocateIds(state, "P01"), ["N"]);
  assert.deepEqual(getCountryOverrideIds(state, "P01"), ["N"]);
  assert.equal(state.selectedInspectorCountryCode, "P01");
  state.activeSovereignCode = state.inspectorHighlightCountryCode = "P01";
  const registered = tables();
  assert.ok(undoHistory());
  assertReplaced(registered);
  assert.deepEqual([state.selectedInspectorCountryCode, state.activeSovereignCode, state.inspectorHighlightCountryCode], ["", "", ""]);
  assert.equal(resolve("N"), "color:" + color);
  assert.ok(redoHistory());
  assert.equal(resolve("N"), "P01");
  const restored = tables();
  assert.equal(unregisterProjectCountry("FR"), false);
  assert.ok(unregisterProjectCountry("P01"));
  assertReplaced(restored);
  assert.equal(resolve("N"), "color:" + color);
  assert.equal(allocateProjectCountryTag(state), "P02");
  assert.ok(undoHistory());
  assert.equal(resolve("N"), "P01");
  assert.ok(redoHistory());
  assert.equal(resolve("N"), "color:" + color);
});

test("registration requires an active scenario and unregistered paint, and history skips foreign scenarios", () => {
  setup();
  state.activeScenarioId = "";
  assert.equal(registerColorAsProjectCountry(color), false);
  state.activeScenarioId = "modern_world";
  assert.equal(registerColorAsProjectCountry("#123456"), false);
  assert.equal(registerColorAsProjectCountry(color), "P01");
  assert.equal(registerColorAsProjectCountry(color), false);
  state.activeScenarioId = "other";
  const previous = tables();
  undoHistory();
  tables().forEach((table, index) => assert.equal(table, previous[index]));
  state.sovereignBaseColors = { FR: "#123456" };
  redoHistory();
  assert.deepEqual(state.sovereignBaseColors, { FR: "#123456" });
});

test("allocation skips referenced, catalog and reserved codes before moving to the Q range", () => {
  const draft = { activeScenarioId: "s", scenarioCountriesByTag: { P01: {} }, sovereignBaseColors: { P02: color },
    countryPalette: { P03: color }, countryNames: { P04: "Old" }, countryNameOverrides: { P05: {} },
    mapLabels: [{ countryCode: "P06" }], parentBorderEnabledByCountry: { P07: false }, customPresets: { P08: [] },
    releasableCatalog: { entries: [{ tag: "P09", scenario_ids: ["s"] }, { tag: "P13", scenario_ids: ["other"] }] },
    capitalOverrides: { P10: {} }, scenarioReleasableIndex: { byTag: { P11: {} } } };
  assert.equal(allocateProjectCountryTag(draft, { reservedTags: ["P12"] }), "P13");
  const reservedTags = Array.from({ length: 99 }, (_, i) => "P" + String(i + 1).padStart(2, "0"));
  assert.equal(allocateProjectCountryTag(draft, { reservedTags }), "Q01");
});

test("rename preserves custom legend labels and restores matching labels together with localized names", () => {
  setup();
  state.legendLabels = { [color]: "North" };
  registerColorAsProjectCountry(color);
  assert.ok(renameProjectCountry("P01", "West"));
  assert.equal(state.legendLabels[color], "West");
  undoHistory();
  assert.equal(state.legendLabels[color], "North");
  assert.deepEqual(state.countryNameOverrides, {});
  redoHistory();
  state.legendLabels = { [color]: "Custom" };
  state.currentLanguage = "zh";
  renameProjectCountry("P01", "西国");
  assert.equal(state.legendLabels[color], "Custom");
  unregisterProjectCountry("P01");
  assert.deepEqual(state.countryNameOverrides.P01, { en: "West", zh: "西国" });
});

test("registration refresh includes painted river parents and recoloring migrates even cell-only paint", async () => {
  const { refreshes } = setup();
  const fixture = await makeFixture();
  Object.assign(state, fixture.state, { visualOverrides: { N: color } });
  const cell = fixture.cells[0].id;
  state.riverPaint.overrides[cell] = color;
  state.legendLabels = { [color]: "North" };
  registerColorAsProjectCountry(color);
  assert.deepEqual(refreshes.at(-1).featureIds.sort(), ["N", "P"]);
  assert.ok(recolorProjectCountry("P01", "#bada55"));
  assert.equal(state.visualOverrides.N, "#bada55");
  assert.equal(state.riverPaint.overrides[cell], "#bada55");
  undoHistory();
  assert.equal(state.visualOverrides.N, color);
  state.visualOverrides = {};
  assert.equal(recolorProjectCountry("P01", "#f00"), false);
  assert.equal(recolorProjectCountry("P01", "#123456"), true);
  assert.equal(state.riverPaint.overrides[cell], "#123456");
  assert.equal(state.legendLabels["#123456"], "North");
  undoHistory();
  assert.equal(state.riverPaint.overrides[cell], color);
  unregisterProjectCountry("P01");
  assert.equal(registerColorAsProjectCountry(color), "P02");
  assert.equal(refreshes.at(-1).featureIds, undefined);
});

test("restore remaps conflicts and references without overwriting either country's colors", () => {
  const draft = { activeScenarioId: "s", scenarioCountriesByTag: { P01: { tag: "P01" } },
    sovereignBaseColors: { P01: color, P02: "#123456" }, countryPalette: { P01: "#ffffff" },
    countryNameOverrides: { P01: { en: "West" } }, activeSovereignCode: "P01",
    parentBorderEnabledByCountry: { P01: false }, customPresets: { P01: [] }, capitalOverrides: { P01: { cityId: null } },
    mapLabels: [{ countryCode: "P01" }] };
  const list = ["P01", "P02", "P03"].map(tag => ({ tag, name: tag }));
  const result = restoreProjectCountries(draft, list, { scenarioBaseColors: { P01: "#ffffff" } });
  assert.deepEqual(result, { tagMap: { P01: "P04" }, dropped: ["P03"] });
  assert.deepEqual(draft.sovereignBaseColors, { P01: "#ffffff", P02: "#123456", P04: color });
  assert.deepEqual(draft.countryPalette, draft.sovereignBaseColors);
  assert.deepEqual(draft.countryNameOverrides, { P04: { en: "West" } });
  assert.equal(draft.activeSovereignCode, "P04");
  assert.equal(draft.mapLabels[0].countryCode, "P04");
  assert.deepEqual(draft.capitalOverrides, { P04: { cityId: null } });
  assert.deepEqual(draft.customPresets, { P04: [] });
  assert.deepEqual(draft.parentBorderEnabledByCountry, { P04: false });
});

test("restore drops a missing saved color even when the scenario supplied a conflicting base color", () => {
  const draft = { activeScenarioId: "s", scenarioCountriesByTag: { P01: {} },
    sovereignBaseColors: { P01: "#123456" }, countryPalette: {} };
  const result = restoreProjectCountries(draft, [{ tag: "P01", name: "West" }], {
    scenarioBaseColors: draft.sovereignBaseColors, savedBaseColors: {},
  });
  assert.deepEqual(result, { tagMap: {}, dropped: ["P01"] });
  assert.equal(draft.sovereignBaseColors.P01, "#123456");
  assert.deepEqual(serializeProjectCountries(draft), []);
});

test("color reset preserves project colors and clears territory, baseline removes the country before restoring selection", async () => {
  setup();
  const fixture = await makeFixture();
  Object.assign(state, fixture.state, { visualOverrides: { N: color } });
  state.riverPaint.overrides[fixture.cells[0].id] = color;
  registerColorAsProjectCountry(color);
  state.scenarioFixedOwnerColors = { FR: color };
  resetCountryColors();
  assert.notEqual(state.sovereignBaseColors.FR, color);
  assert.equal(state.sovereignBaseColors.P01, color);
  assert.equal(state.countryPalette.P01, color);
  assert.equal(state.scenarioCountriesByTag.P01.project_country, true);
  assert.deepEqual(state.visualOverrides, {});
  assert.deepEqual(state.riverPaint.overrides, {});
  undoHistory();
  assert.equal(state.riverPaint.overrides[fixture.cells[0].id], color);
  state.scenarioBaselineOwnersByFeatureId = { N: "FR" };
  state.activeSovereignCode = "P01";
  const runtime = createScenarioLifecycleRuntime({ state, getScenarioMapSemanticMode: () => "political",
    ensureSovereigntyState() {}, getScenarioDefaultCountryCode: () => "", setScenarioAuditUiState() {}, runPostScenarioResetEffects() {} });
  const registered = tables();
  assert.ok(runtime.resetToScenarioBaseline({ markDirtyReason: "" }));
  assertReplaced(registered);
  assert.ok(!state.scenarioCountriesByTag.P01);
  assert.ok(!state.countryPalette.P01);
  assert.ok(!state.sovereignBaseColors.P01);
  assert.deepEqual([state.selectedInspectorCountryCode, state.inspectorHighlightCountryCode, state.activeSovereignCode], ["", "", ""]);
});
