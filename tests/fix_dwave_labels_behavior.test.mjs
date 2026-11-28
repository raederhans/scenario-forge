import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createCountryLabelSourceOwner } from "../js/core/renderer/country_label_source.js";
import { createCountryLabelCoverageOwner } from "../js/core/renderer/country_label_coverage.js";
import { waitForCountryLabelsForExport } from "../js/core/renderer/country_label_render_owner.js";

const topojson = createRequire(import.meta.url)("../vendor/topojson-client.min.js");

function fixture(t, options = {}) {
  const owners = { west: "AA", east: "BB" };
  const state = { activeScenarioId: "world", scenarioCountriesByTag: { AA: {}, BB: {} },
    scenarioBaselineOwnersByFeatureId: owners, visualOverrides: {},
    scenarioRuntimeTopologyData: { type: "Topology",
      arcs: [0, 10].map(x => [[x, 0], [x, 1], [x + 1, 1], [x + 1, 0], [x, 0]]),
      objects: { political: { type: "GeometryCollection", geometries: Object.keys(owners)
        .map((id, i) => ({ type: "Polygon", id, arcs: [[i]] })) } } } };
  const resolveBorderIdentity = id => state.visualOverrides[id] || owners[id];
  const source = createCountryLabelSourceOwner({ state, topojson, resolveBorderIdentity,
    yieldTask: () => Promise.resolve(), ...options });
  t.after(() => source.dispose());
  return { state, source, resolveBorderIdentity };
}

test("export flushes a quiet-period edit and reports failure of the requested geometry", async t => {
  let fail = false, pendingFits = 0;
  const { state, source } = fixture(t, { nowMs: () => 0, membershipScheduler: globalThis,
    isMembershipEditSettled: () => false, topojson: { merge(...args) {
      if (fail) throw new Error("merge failed");
      return topojson.merge(...args);
    } } });
  const exportLabels = () => waitForCountryLabelsForExport({ prepareSource: source.prepare,
    getSource: source.getSource, getDiagnostics: () => ({ pendingFits, workerErrors: 0 }),
    requestRender: () => { pendingFits = 1; }, wait: async () => { pendingFits = 0; },
    isDisabled: () => false });
  await source.prepare();
  state.visualOverrides = { west: "BB" };
  assert.equal(source.getSource().countries.length, 2);
  await exportLabels();
  assert.deepEqual(source.getSource().countries.map(c => c.countryCode), ["BB"]);
  assert.equal(pendingFits, 0);
  fail = true;
  state.visualOverrides = {};
  await assert.rejects(exportLabels(), /merge failed/);
  assert.deepEqual(source.getSource().countries.map(c => c.countryCode), ["BB"]);
});

test("countries swapping all land remain visible until one loses its acquired land", async t => {
  const { state, source, resolveBorderIdentity } = fixture(t);
  const coverage = createCountryLabelCoverageOwner({ state, peekSource: source.peekSource, resolveBorderIdentity });
  await source.prepare();
  assert.equal(coverage.getSignature(), "");
  state.visualOverrides = { west: "BB", east: "AA" };
  coverage.notifyColorsChanged(["west", "east"]);
  await source.prepare();
  assert.deepEqual(source.peekSource().countries.map(c => c.countryCode), ["AA", "BB"]);
  assert.deepEqual(coverage.getSuppressedCodes(), new Set());
  delete state.visualOverrides.east;
  state.colorRevision = 1;
  coverage.notifyColorsChanged(["east"]);
  await source.prepare();
  assert.equal(coverage.getSignature(), "AA");
});
