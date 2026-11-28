import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { createCountryLabelSourceOwner } from "../js/core/renderer/country_label_source.js";
import { createPaintContourAssembly } from "../js/core/renderer/paint_contour_assembly.js";

const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");
const { geoArea, geoContains } = require("../vendor/d3.v7.min.js");
const eastPoint = [50, 25];

function fixture(t, options = {}) {
  const ids = ["west", "east", "bay", "island"];
  const owners = { west: "AAA", east: "AAA", bay: "BBB", island: "CCC" };
  const topology = { type: "Topology", objects: { political: { type: "GeometryCollection",
    geometries: ids.map((id, i) => ({ id, type: "Polygon", arcs: [[i]], properties: { cntr_code: owners[id] } })) } },
    arcs: ids.map((_, i) => {
      const x = 5 + i * 35;
      return [[x, 10], [x, 45], [x + 30, 45], [x + 30, 10], [x, 10]];
    }) };
  const state = { activeScenarioId: "history", scenarioBaselineOwnersByFeatureId: owners,
    scenarioCountriesByTag: { AAA: {}, BBB: {}, CCC: {} }, visualOverrides: {}, colorRevision: 0,
    sovereignBaseColors: { AAA: "#110000", BBB: "#220000", CCC: "#330000" },
    scenarioRuntimeTopologyData: topology, topologyPrimary: topology };
  const { resolveBorderIdentity } = createPaintContourAssembly({ runtimeState: state,
    canonicalCountryCode: code => code, getDisplayOwnerCode: (_, id) => owners[id] });
  const { getCountryName } = createLabelsRuntime({ runtimeState: state, rendererSurfaceHost: {} });
  const source = createCountryLabelSourceOwner({ state, topojson, geoArea, geoContains, resolveBorderIdentity,
    getCountryName, yieldTask: () => Promise.resolve(), ...options });
  t.after(() => source.dispose());
  const eastLabels = () => source.peekSource().countries.filter(record => geoContains(record.geometry, eastPoint))
    .map(record => record.countryCode);
  return { state, source, eastLabels };
}

test("repainting moves the parcel between label geometries", async t => {
  const { state, source, eastLabels } = fixture(t);
  await source.prepare();
  assert.deepEqual(eastLabels(), ["AAA"]);
  state.visualOverrides = { east: state.sovereignBaseColors.BBB };
  await source.prepare();
  assert.deepEqual(eastLabels(), ["BBB"]);
});

test("a failed incremental build keeps the published labels", async t => {
  let fail = false;
  const { state, source, eastLabels } = fixture(t, { topojson: { merge(...args) {
    if (fail) throw new Error("membership merge failed");
    return topojson.merge(...args);
  } } });
  await source.prepare();
  const before = source.getSource();
  fail = true;
  state.visualOverrides = { east: "#220000" };
  await source.prepare();
  const failed = source.getSource();
  assert.equal(failed.status, "ready");
  assert.equal(failed.countries, before.countries);
  assert.equal(failed.revision, before.revision);
  assert.equal(failed.membershipError, "membership merge failed");
  assert.ok(Number.isInteger(failed.failedAssignmentRevision));
  assert.equal(failed.membershipPending, false);
});
