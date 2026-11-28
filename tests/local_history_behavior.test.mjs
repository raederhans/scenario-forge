import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";
import { getTerritoryChanges, formatTerritorySummary, buildTerritoryChangesCsv } from "../js/core/territory_change_summary.js";

test("territory summary groups baseline transfers by painted country, including unloaded parcels", () => {
  Object.assign(state, {
    activeScenarioId: "test", currentLanguage: "zh",
    scenarioBaselineOwnersByFeatureId: { a: "PL", b: "PL", c: "DE", d: "PL" },
    scenarioCountriesByTag: {
      DE: { display_name_en: "Germany", display_name_zh: "德国" },
      PL: { display_name_en: "Poland", display_name_zh: "波兰" },
    },
    sovereignBaseColors: { ALIAS: "#aa1122", DE: "#aa1122", PL: "#1122aa" },
    visualOverrides: { a: "#AA1122", b: "#aa1122", c: "#aa1122", d: "#888888" },
    landIndex: new Map([["a", { properties: { name: '=Port, "A"' } }]]),
  });
  const rows = getTerritoryChanges(state);
  assert.deepEqual(rows, [
    { id: "a", name: '=Port, "A"', from: "PL", to: "DE" },
    { id: "b", name: "b", from: "PL", to: "DE" },
    { id: "d", name: "d", from: "PL", to: "color:#888888" },
  ]);
  assert.match(formatTerritorySummary(rows, state), /德国从波兰获得 2 块（=Port, "A"、b）。/);
  state.currentLanguage = "en";
  assert.match(formatTerritorySummary(rows, state), /Germany gained 2 parcels from Poland/);
  assert.equal(buildTerritoryChangesCsv(rows), [
    "\ufefffeature_id,name,original_owner,current_owner",
    '"a","\'=Port, ""A""","PL","DE"', '"b","b","PL","DE"', '"d","d","PL","color:#888888"',
  ].join("\r\n"));
  state.activeScenarioId = "";
  assert.equal(formatTerritorySummary(getTerritoryChanges(state), state), "No territory changes.");
});

test("a painted river parcel compares against its parent baseline without counting the parent twice", async () => {
  const { state, cells } = await makeFixture();
  state.scenarioBaselineOwnersByFeatureId = { P: "FR" };
  state.sovereignBaseColors.DE = "#aa1122";
  state.visualOverrides.P = "#aa1122";
  state.riverPaint = { ...state.riverPaint, overrides: { [cells[0].id]: "#ff0000" } };
  assert.deepEqual(getTerritoryChanges(state), [{ id: cells[1].id, name: "P", from: "FR", to: "DE" }]);
});
