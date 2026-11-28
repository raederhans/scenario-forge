import test from "node:test";
import assert from "node:assert/strict";
import { createBorderMeshOwner } from "../js/core/renderer/border_mesh_owner.js";
import { buildGlobalCoastlineMesh } from "../js/core/renderer/border_mesh_source_selection.js";

const mask = (rings = 1) => ({ features: [{ geometry: { type: "Polygon", coordinates: Array.from({ length: rings }, () => []) } }] });

function fixture(t) {
  t.mock.method(console, "info", () => {});
  const priorTopojson = globalThis.topojson;
  const priorD3 = globalThis.d3;
  t.after(() => { globalThis.topojson = priorTopojson; globalThis.d3 = priorD3; });
  globalThis.topojson = { feature: (_, object) => object, mesh: (_, object) => object };
  globalThis.d3 = { geoArea: () => 1, geoBounds: () => [[0, 0], [1, 1]] };
  const primary = { objects: { land: mask() } };
  const dedicated = mask();
  const state = {
    topologyPrimary: primary, activeScenarioId: "tno_1962", showWaterRegions: true,
    runtimePoliticalTopology: { objects: { scenario_coastline: dedicated, context_land_mask: mask(600) } },
    scenarioAtlantropaData: { features: [] },
  };
  const owner = createBorderMeshOwner({ state, helpers: {
    publishScenarioCoastlineDecision: decision => decision,
    isUsableMesh: mesh => !!mesh?.coordinates?.length,
  } });
  primary.objects.land.coordinates = [[[0, 0], [1, 1]]];
  dedicated.coordinates = [[[0, 0], [2, 2]]];
  return { owner, state, primary, dedicated };
}

test("overlay land selects the dedicated scenario coastline", t => {
  const { owner, state, primary, dedicated } = fixture(t);
  assert.equal(owner.resolveCoastlineTopologySource().source, "primary");
  owner.ensureCoastlineMeshes();
  assert.equal(state.cachedCoastlinesHigh[0], primary.objects.land);
  state.scenarioAtlantropaData = { features: [{ properties: { atl_render_layer: "land" } }] };
  const accepted = owner.resolveCoastlineTopologySource();
  assert.equal(accepted.source, "scenario");
  assert.equal(accepted.runtimeObjectName, "scenario_coastline");
  assert.equal(buildGlobalCoastlineMesh({ topologyInput: accepted }), dedicated);
  owner.ensureCoastlineMeshes();
  assert.equal(state.cachedCoastlinesHigh[0], dedicated);
});

test("hiding overlay land restores the primary coastline", t => {
  const { owner, state, primary } = fixture(t);
  state.scenarioAtlantropaData = { features: [{ properties: { atl_render_layer: "land" } }] };
  owner.ensureCoastlineMeshes();
  state.showScenarioAtlantropa = false;
  assert.equal(owner.resolveCoastlineTopologySource().source, "primary");
  owner.ensureCoastlineMeshes();
  assert.equal(state.cachedCoastlinesHigh[0], primary.objects.land);
});
