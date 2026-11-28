import assert from "node:assert/strict";
import test from "node:test";

import { getCountryOverrideIds, resetCountryOverrides } from "../js/core/country_override_reset_command.js";
import { undoHistory } from "../js/core/history_manager.js";
import { state } from "../js/core/state.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";

test("scenario reset clears baseline members and undoes the edit in one step", async (ctx) => {
  const { state: fixture, cells } = await makeFixture();
  const riverColors = Object.fromEntries(cells.map(({ id }) => [id, "#112233"]));
  const initial = {
    ...fixture,
    visualOverrides: { unloaded: "#445566", N: "#778899" },
    riverPaint: { ...fixture.riverPaint, overrides: { ...riverColors } },
    scenarioBaselineOwnersByFeatureId: { P: "AA", unloaded: "AA", clean: "AA", N: "BB" },
    countryToFeatureIds: new Map([["AA", ["N"]], ["BB", ["P"]]]),
    historyPast: [], historyFuture: [], currentLanguage: "zh", selectedInspectorCountryCode: "AA",
  };
  const saved = Object.fromEntries(Object.keys(initial).map(key => [key, state[key]]));
  Object.assign(state, initial);
  ctx.after(() => Object.assign(state, saved));

  resetCountryOverrides(getCountryOverrideIds(state, "AA"), "AA");
  assert.deepEqual(state.visualOverrides, { N: "#778899" });
  assert.deepEqual(state.riverPaint.overrides, {});
  assert.equal(state.historyPast.length, 1);

  assert.equal(undoHistory(), true);
  assert.deepEqual(state.visualOverrides, { unloaded: "#445566", N: "#778899" });
  assert.deepEqual(state.riverPaint.overrides, riverColors);
});

test("without a scenario the geographic index determines which edited parents count", async () => {
  const { state: source, cells } = await makeFixture();
  source.activeScenarioId = "";
  source.scenarioBaselineOwnersByFeatureId = { P: "BB", N: "AA" };
  source.countryToFeatureIds = new Map([["AA", ["P"]], ["BB", ["N"]]]);
  source.visualOverrides = { P: "#445566" };
  source.riverPaint.overrides = { [cells[0].id]: "#112233" };
  assert.deepEqual(getCountryOverrideIds(source, "AA"), ["P"]);
  assert.deepEqual(getCountryOverrideIds(source, "BB"), []);
});
