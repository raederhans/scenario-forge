import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { createCountryLabelLayoutWorkerHandler } from "../js/core/renderer/country_label_layout_worker.js";
import { fitRegionalProjection } from "../js/core/renderer/regional_camera.js";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");
const topojson = require("../vendor/topojson-client.min.js");

function setGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
}

test("regional reset shows the eastern countries after vector pass preflight", async t => {
  const width = 900, height = 500;
  const region = { bounds: [30, 30, 150, 68], central_meridian: 90, backdrop: "none" };
  const projection = d3.geoEqualEarth();
  projection.clipExtent(fitRegionalProjection(projection, region, width, height));
  const easternCodes = ["E1", "E2", "E3", "E4", "E5", "E6"];
  const territories = [
    ["P", 53, 47, 4], ["CHILD", 65, 48, 3], ["TINY1", 57, 37, 0.04], ["TINY2", 121, 42, 0.04],
    ...easternCodes.map((code, i) => [code, 112 + i % 2 * 22, 37 + Math.floor(i / 2) * 11, 3]),
  ];
  const state = {
    width, height, activeScenarioId: "regional", activeScenarioManifest: { region }, currentLanguage: "en",
    zoomTransform: d3.zoomIdentity.translate(0, -210).scale(1.888),
    scenarioCountriesByTag: Object.fromEntries(territories.map(([code]) => [code, { display_name_en: code }])),
    scenarioBaselineOwnersByFeatureId: Object.fromEntries(territories.map(([code]) => [code, code])),
    scenarioRuntimeTopologyData: { type: "Topology",
      arcs: territories.map(([, x, y, r]) => [
        [x - r, y - r], [x - r, y + r], [x + r, y + r], [x + r, y - r], [x - r, y - r],
      ]),
      objects: { political: { type: "GeometryCollection",
        geometries: territories.map(([id], i) => ({ type: "Polygon", id, arcs: [[i]] })) } } },
  };
  Object.assign(state.scenarioCountriesByTag.CHILD, { presentation: "parent_merged", parent_owner_tag: "P" });
  const idle = [], replies = [];
  setGlobal(t, "d3", d3);
  setGlobal(t, "topojson", topojson);
  setGlobal(t, "requestIdleCallback", callback => idle.push(callback));
  const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, fillText() {}, strokeText() {},
    measureText: () => ({ width: 60 }) };
  // CI runs Node 20, which has no Promise.withResolvers.
  const sourcePublished = {};
  sourcePublished.promise = new Promise((resolve) => { sourcePublished.resolve = resolve; });
  let repaint = false;
  const runtime = createLabelsRuntime({
    runtimeState: state, rendererSurfaceHost: { getContext: () => ctx, getProjection: () => projection,
      getMapSvg: () => null, getPathCanvas: () => null },
    isExportRenderInProgress: () => false, isPrivateSceneActive: () => false, getLabelPaintBounds: () => null,
    resolveBorderIdentity: id => id, getAdmin0BackgroundFillColor: () => "#ffffff", nowMs: () => 0,
    invalidateRenderPasses() {}, recordRenderPerfMetric() {}, drawPendingTransportLabels() {}, drawPhysicalRegionLabels() {},
    requestRendererRender(reason) {
      repaint = true;
      if (reason === "country-label-source") setImmediate(sourcePublished.resolve);
    },
  });
  const draw = () => { repaint = false; runtime.drawLabelsPassContent(state.zoomTransform.k); };
  draw();
  await sourcePublished.promise;
  setGlobal(t, "Worker", class {
    handle = createCountryLabelLayoutWorkerHandler();
    postMessage(message) {
      replies.push(() => this.onmessage({ data: this.handle(message) }));
    }
    terminate() {}
  });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  function drain() {
    for (let turn = 0; idle.length || replies.length || repaint; turn++) {
      assert.ok(turn < 30, "label preparation must finish");
      now += 500;
      if (repaint) draw();
      for (const callback of idle.splice(0)) callback();
      for (const reply of replies.splice(0)) reply();
    }
  }
  drain();
  assert.deepEqual(runtime.getVisibleMapLabels().countries, ["P"]);

  state.zoomTransform = d3.zoomIdentity;
  draw();
  // Exact-pass preflight can run after the label canvas was already painted at k=1.
  runtime.prepareLabelsPass();
  drain();
  assert.deepEqual(runtime.getVisibleMapLabels().countries, [...easternCodes, "P"]);
});
