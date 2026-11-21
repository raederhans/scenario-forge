import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { createRegionSearchController } from "../js/ui/sidebar/region_search_controller.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

function land(id, code, west) {
  return {
    type: "Feature", id, properties: { cntr_code: code },
    geometry: { type: "Polygon", coordinates: [[
      [west, 0], [west, 1], [west + 1, 1], [west + 1, 0], [west, 0],
    ]] },
  };
}

test("selecting a search result focuses its bounds once and preserves the unloaded message", (ctx) => {
  const { doc, add } = harness(ctx);
  const feature = land("east", "AA", 173);
  const state = { landIndex: new Map([[feature.id, feature]]) };
  globalThis.d3 = d3;
  ctx.after(() => delete globalThis.d3);
  const calls = [];
  const controller = createRegionSearchController({
    documentRef: doc, state, t: (key) => key,
    getFeatureOwnerCode: () => "AA", getFeatureLabel: (item) => item.id,
    selectLandFeatureById: (id) => state.landIndex.has(id),
    focusGeoBounds: (...args) => calls.push(args),
  });
  controller.mount(add());
  controller.setCountry("AA");
  const input = doc.getElementById("regionSearchInput");
  input.value = "east";
  input.fire("input");
  doc.getElementById("regionSearchOption-0").click();
  assert.equal(calls.length, 1);
  const [bounds, options] = calls[0];
  assert.deepEqual(bounds, d3.geoBounds(feature).flat());
  assert.equal(options.animate, true);
  assert.equal(options.maxScale, 8);

  input.fire("input");
  state.landIndex.clear();
  input.fire("keydown", { key: "Enter" });
  assert.equal(doc.getElementById("regionSearchStatus").textContent, "Region is not loaded yet.");
  assert.equal(calls.length, 1);
});

test("country location combines loaded scenario members across the dateline and follows geographic membership outside a scenario", (ctx) => {
  const { add } = harness(ctx);
  globalThis.d3 = d3;
  ctx.after(() => delete globalThis.d3);
  const east = land("east", "BB", 173);
  const west = land("west", "BB", -178);
  const mainland = land("mainland", "AA", 5);
  const state = {
    selectedInspectorCountryCode: "AA", activeScenarioId: "scenario",
    scenarioBaselineOwnersByFeatureId: { east: "AA", west: "AA", missing: "AA", mainland: "BB" },
    landIndex: new Map([east, mainland].map((item) => [item.id, item])),
    countryToFeatureIds: new Map([["AA", [mainland.id]]]),
  };
  const calls = [];
  const card = add();
  card.insertBefore = (node) => card.prepend(node);
  const controller = createCountryInspectorController({
    runtimeState: state, countryInspectorSelected: card,
    getLatestCountryStatesByCode: () => new Map([["AA", { code: "AA" }]]),
    normalizeCountryCode: (code) => code, t: (key) => key,
    updateScenarioInspectorLayout() {}, scheduleAdaptiveInspectorHeights() {},
    setCountryInspectorColorPickerOpen() {}, focusGeoBounds: (...args) => calls.push(args),
  });
  controller.renderCountryInspectorDetail();
  const button = card.querySelector("button");
  assert.equal(button.textContent, "Locate on Map");
  assert.equal(button.disabled, false);
  state.landIndex.set(west.id, west);
  button.click();
  assert.equal(calls.length, 1);
  const [bounds] = calls[0];
  assert.equal(bounds[0], 173);
  assert.equal(bounds[2], -177);
  assert.deepEqual(bounds, d3.geoBounds({ type: "FeatureCollection", features: [east, west] }).flat());

  state.activeScenarioId = "";
  controller.renderCountryInspectorDetail();
  button.click();
  assert.deepEqual(calls[1][0], d3.geoBounds(mainland).flat());
  state.landIndex.clear();
  controller.renderCountryInspectorDetail();
  assert.equal(button.disabled, true);
  assert.equal(calls.length, 2);
});
