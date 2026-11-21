import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { emit, off } from "../js/core/state/bus.js";
import { STATE_BUS_EVENTS } from "../js/core/state/index.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

test("history updates share a frame and reuse areas while ownership and loaded geometry change", ctx => {
  const { add } = harness(ctx);
  const frames = [];
  ctx.mock.method(globalThis, "requestAnimationFrame", callback => frames.push(callback));
  const measured = [];
  const previousD3 = globalThis.d3;
  globalThis.d3 = { geoArea(feature) {
    measured.push(feature.geometry);
    return d3.geoArea(feature);
  } };
  ctx.after(() => { globalThis.d3 = previousD3; });
  const feature = (id, width) => ({
    id, type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [width, 1], [width, 0], [0, 0]]] },
  });
  const east = feature("east", 1), west = feature("west", 2);
  const source = {
    activeScenarioId: "test", selectedInspectorCountryCode: "AA", colorRevision: 0,
    scenarioCountriesByTag: { AA: {}, BB: {} }, scenarioBaselineOwnersByFeatureId: { east: "AA", west: "BB" },
    sovereignBaseColors: { AA: "#111111", BB: "#222222" }, visualOverrides: {},
    currentLanguage: "en", landData: { features: [east, west] },
  };
  const card = add();
  const stats = add("div", card, "countryTerritoryStats");
  const reset = add("button", card, "resetCountryOverrides");
  add("span", reset).dataset.resetCount = "";
  const controller = createCountryInspectorController({
    runtimeState: source, countryInspectorSelected: card,
    t: (key, domain, values) => values?.area ? JSON.stringify(values) : key,
  });
  controller.bindEvents();
  const event = STATE_BUS_EVENTS.UPDATE_HISTORY_UI;
  ctx.after(() => off(event));
  emit(event);
  frames.splice(0).forEach(run => run());
  assert.deepEqual(measured, [east.geometry, west.geometry]);

  source.visualOverrides.west = "#111111";
  source.colorRevision++;
  emit(event);
  source.colorRevision++;
  emit(event);
  assert.deepEqual(measured, [east.geometry, west.geometry]);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(measured, [east.geometry, west.geometry]);
  const expected = (...features) => JSON.stringify({
    count: features.length, area: Math.round(features.reduce((sum, f) => sum + d3.geoArea(f), 0) * 6371 ** 2).toLocaleString("en"),
    gained: 1, lost: 0,
  });
  assert.ok(stats.textContent.startsWith(expected(east, west)));

  const largerWest = feature("west", 3);
  source.landData = { features: [east, largerWest] };
  emit(event);
  frames.shift()();
  assert.deepEqual(measured, [east.geometry, west.geometry, largerWest.geometry]);
  assert.ok(stats.textContent.startsWith(expected(east, largerWest)));
});
