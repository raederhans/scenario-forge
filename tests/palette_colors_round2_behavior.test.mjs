import test from "node:test";
import assert from "node:assert/strict";
import { checkColorHealth } from "../js/core/color_health_check.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import { createPaletteLibraryOperation } from "../js/core/palette_library_operation.js";
import { getPaletteCountryTargets } from "../js/core/palette_country_targets.js";
import { openLegendColorEditor } from "../js/ui/toolbar/palette_country_editor.js";
import { state } from "../js/core/state.js";
import { TestElement } from "./helpers/transport_right_deck_document.mjs";

function scene() {
  return {
    activeScenarioId: "test",
    scenarioCountriesByTag: { GER: {}, FRA: {}, ITA: {} },
    sovereignBaseColors: { GER: "#444444", FRA: "#444445", ITA: "#454545" },
    scenarioBaselineOwnersByFeatureId: {
      home: "GER", retained: "GER", annexed: "GER", custom: "GER", connected: "GER", island: "GER", italy: "ITA",
    },
    visualOverrides: { retained: "#444444", annexed: "#444445", custom: "#ffaabb", connected: "#ffaabb", island: "#ffaabb" },
    runtimeFeatureIds: ["home", "annexed", "custom", "connected", "island", "italy"],
    runtimeNeighborGraph: [[1], [0, 2], [1, 3], [2], [], []],
  };
}

test("country recolor retains foreign and custom territory and counts only its own members", () => {
  const state = scene();
  const operation = createPaletteLibraryOperation({
    state, ...createPaletteLibraryStateAccess(state),
    getCountryFeatureIds: code => [...getPaletteCountryTargets(state).get(code)],
    captureHistoryState: () => ({}), pushHistoryEntry() {}, refreshColorState() {},
    refreshResolvedColorsForFeatures() {}, markDirty() {}, selectPaintColor() {},
  });
  const result = operation.applyColor("#aabbcc", { countryCode: "GER" });
  assert.equal(result.featureCount, 2);
  assert.equal(result.preservedCount, 4);
  assert.deepEqual(state.visualOverrides, {
    home: "#aabbcc", retained: "#aabbcc", annexed: "#444445",
    custom: "#ffaabb", connected: "#ffaabb", island: "#ffaabb",
  });
});

test("health check ranks adjacent near pairs first and locates the detached custom component", () => {
  const state = scene();
  const [first, ...others] = checkColorHealth(state);
  assert.deepEqual(first.featureIds, ["home", "annexed"]);
  assert.equal(first.adjacent, true);
  assert.deepEqual(new Set([first.a, first.b]), new Set(["GER", "FRA"]));
  assert.equal(others.filter(issue => issue.type === "pair" && !issue.adjacent).length, 2);
  assert.deepEqual(others.at(-1), { type: "fragment", color: "#ffaabb", featureIds: ["island"] });
  state.sovereignBaseColors.ITA = "#00ff00";
  state.runtimeNeighborGraph[4].push(3);
  state.runtimeNeighborGraph[3].push(4);
  assert.equal(checkColorHealth(state).length, 1);
});

test("legend dialog recolors a country base and merges custom paint into a selected country", async t => {
  const patch = { ...scene(), landData: { features: [] }, countryPalette: {}, legendLabels: { "#ffaabb": "Custom" },
    legendColorOrder: ["#ffaabb"], historyPast: [], historyFuture: [] };
  const previous = Object.fromEntries(Object.keys(patch).map(key => [key, state[key]]));
  Object.assign(state, patch);
  t.after(() => Object.assign(state, previous));
  const doc = {
    body: new TestElement("body"),
    createElement(tag) {
      const el = new TestElement(tag);
      if (tag === "dialog") {
        el.showModal = () => { el.open = true; };
        el.close = () => { el.open = false; };
      }
      return el;
    },
  };
  let refreshed = 0;
  const open = entry => {
    openLegendColorEditor(doc, state, entry, () => refreshed++);
    return doc.body.children.at(-1);
  };
  const apply = dialog => dialog.children.find(el => el.textContent === "Apply").listeners.get("click")[0]();
  const country = open({ color: "#454545", owner: "ITA" });
  assert.ok(country.open);
  assert.ok(!country.children.some(el => el.tagName === "select"));
  country.children[0].children[0].value = "#0000ff";
  await apply(country);
  assert.equal(state.sovereignBaseColors.ITA, "#0000ff");
  const recolor = open({ color: "#ffaabb" });
  recolor.children[0].children[0].value = "#eeddaa";
  recolor.children[0].children[0].dispatch("input");
  await apply(recolor);
  assert.equal(state.visualOverrides.custom, "#eeddaa");
  assert.deepEqual(state.legendLabels, { "#eeddaa": "Custom" });
  const custom = open({ color: "#eeddaa" });
  const select = custom.children.find(el => el.tagName === "select");
  select.value = select.children.find(option => option.textContent === "ITA").value;
  select.dispatch("change");
  await apply(custom);
  assert.equal(refreshed, 3);
  assert.equal(state.visualOverrides.island, "#0000ff");
  assert.deepEqual(state.legendLabels, { "#0000ff": "Custom" });
  assert.deepEqual(state.historyPast.map(entry => entry.kind), ["inspector-country-color", "replace-color", "replace-color"]);
});
