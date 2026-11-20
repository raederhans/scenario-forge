import assert from "node:assert/strict";
import test from "node:test";

import { getCountryOverrideIds } from "../js/core/country_override_reset_command.js";
import { undoHistory } from "../js/core/history_manager.js";
import { t } from "../js/core/i18n.js";
import { state } from "../js/core/state.js";
import { flushPanelRefreshNow } from "../js/core/state/changes.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

test("reset counts baseline members once, confirms the count, and undoes the edit in one step", async (ctx) => {
  const { doc, add } = harness(ctx);
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

  const card = add();
  card.insertBefore = node => card.prepend(node);
  const button = add("button", card, "resetCountryOverrides");
  const count = add("span", button);
  count.dataset.resetCount = "";
  const controller = createCountryInspectorController({
    runtimeState: state, countryInspectorSelected: card, t,
    getLatestCountryStatesByCode: () => new Map([["AA", { code: "AA" }]]),
    normalizeCountryCode: code => code,
    updateScenarioInspectorLayout() {}, scheduleAdaptiveInspectorHeights() {}, setCountryInspectorColorPickerOpen() {},
  });
  controller.bindEvents();
  controller.renderCountryInspectorDetail();
  assert.equal(count.textContent, "(2)");
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(doc.querySelector(".app-dialog-message").textContent, "将清除 2 个地块的手动颜色");
  doc.querySelector("[data-dialog-cancel]").click();
  await Promise.resolve();
  assert.deepEqual(state.visualOverrides, { unloaded: "#445566", N: "#778899" });
  assert.deepEqual(state.riverPaint.overrides, riverColors);
  assert.equal(state.historyPast.length, 0);

  button.click();
  doc.querySelector("[data-dialog-confirm]").click();
  await Promise.resolve();
  flushPanelRefreshNow();
  assert.deepEqual(state.visualOverrides, { N: "#778899" });
  assert.deepEqual(state.riverPaint.overrides, {});
  assert.equal(count.textContent, "(0)");
  assert.equal(button.disabled, true);
  assert.equal(state.historyPast.length, 1);

  assert.equal(undoHistory(), true);
  flushPanelRefreshNow();
  assert.deepEqual(state.visualOverrides, { unloaded: "#445566", N: "#778899" });
  assert.deepEqual(state.riverPaint.overrides, riverColors);
  assert.equal(count.textContent, "(2)");
  assert.equal(button.disabled, false);
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
