import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { fitCountryLabel } from "../js/core/renderer/country_label_layout.js";
import { createCountryLabelRenderOwner } from "../js/core/renderer/country_label_render_owner.js";
import { createCountryLabelSourceOwner } from "../js/core/renderer/country_label_source.js";
import { normalizeMapLabel } from "../js/core/state/strategic_overlay_state.js";

const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");
const { geoStream } = require("../vendor/d3.v7.min.js");

test("hidden bound lettering restores automatic country names until lettering is shown again", () => {
  const state = { annotationView: {}, mapLabels: [normalizeMapLabel({ countryCode: "AAA", lon: 0, lat: 0 }, "title")] };
  const runtime = createLabelsRuntime({ runtimeState: state, rendererSurfaceHost: {} });
  for (const visible of [true, false, true]) {
    state.annotationView.showMapLabels = visible;
    assert.equal(runtime.getCountryLabelSuppressionSignature(), visible ? "AAA" : "");
  }
});

test("release publication keeps the ready world visible and reuses unaffected country fits", async () => {
  const ids = ["west", "east", "island"];
  const state = { activeScenarioId: "history", scenarioCountriesByTag: { REL: { releasable: true } },
    scenarioBaselineOwnersByFeatureId: { west: "AAA", east: "AAA", island: "BBB" },
    scenarioRuntimeTopologyData: { type: "Topology", objects: { political: { type: "GeometryCollection",
      geometries: ids.map((id, i) => ({ id, type: "Polygon", arcs: [[i]] })) } },
      arcs: ids.map((_, i) => [[20 + i * 60, 20], [20 + i * 60, 60], [60 + i * 60, 60],
        [60 + i * 60, 20], [20 + i * 60, 20]]) } };
  const source = createCountryLabelSourceOwner({ state, topojson, resolveBorderIdentity: () => "REL",
    yieldTask: () => Promise.resolve() });
  const projection = { stream: sink => sink };
  const fits = [];
  const renderer = createCountryLabelRenderOwner({ state, getters: { getCountryLabelSource: source.getSource,
    getProjection: () => projection, getProjectionIdentity: () => 1, getViewportSize: () => ({ width: 400, height: 200 }),
    getContext: () => ({ save() {}, restore() {}, translate() {}, rotate() {}, strokeText() {}, fillText() {},
      measureText: () => ({ width: 60 }) }) },
    helpers: { geoStream, fitCountryLabel: (candidates, options) => {
      fits.push(options.glyphs.map(glyph => glyph.text).join(""));
      return fitCountryLabel(candidates, options);
    } } });
  await source.prepare();
  const before = source.getSource();
  assert.equal(renderer.drawCountryLabels(1), 2);
  assert.deepEqual(fits.sort(), ["AAA", "BBB"]);
  fits.length = 0;

  state.visualOverrides = { east: "release" };
  const during = source.getSource();
  assert.equal(during.status, "ready");
  assert.equal(during.features, before.features);
  assert.equal(source.peekSource().memberIndex, before.memberIndex);
  assert.equal(renderer.drawCountryLabels(1), 2);
  assert.deepEqual(fits, []);
  await source.prepare();
  renderer.drawCountryLabels(1);
  assert.deepEqual(fits.sort(), ["AAA", "REL"]);

  const published = source.getSource();
  state.visualOverrides = { east: "release", unknown: "release" };
  await source.prepare();
  assert.deepEqual(source.getSource(), published);
  assert.equal(source.getSource().countries, published.countries);
  source.dispose();
});
