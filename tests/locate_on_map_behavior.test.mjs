import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
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

test("scenario members across the dateline produce a short country bounding box", (ctx) => {
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
  state.landIndex.set(west.id, west);
  button.click();
  const [bounds] = calls[0];
  assert.equal(bounds[0], 173);
  assert.equal(bounds[2], -177);
  assert.deepEqual(bounds, d3.geoBounds({ type: "FeatureCollection", features: [east, west] }).flat());
});
