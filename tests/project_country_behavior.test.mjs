import test from "node:test";
import assert from "node:assert/strict";
import { state, registerRuntimeHook } from "../js/core/state.js";
import { createBorderIdentityResolver } from "../js/core/renderer/border_identity.js";
import { allocateProjectCountryTag, restoreProjectCountries } from "../js/core/project_countries.js";
import { registerColorAsProjectCountry, unregisterProjectCountry, recolorProjectCountry } from "../js/core/project_country_commands.js";
import { undoHistory } from "../js/core/history_manager.js";

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
