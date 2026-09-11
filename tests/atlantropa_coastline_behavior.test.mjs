import test from "node:test";
import assert from "node:assert/strict";
import { createBorderMeshOwner } from "../js/core/renderer/border_mesh_owner.js";
import { evaluateCoastlineTopologySource } from "../js/core/renderer/border_mesh_diagnostics.js";
import { buildGlobalCoastlineMesh } from "../js/core/renderer/border_mesh_source_selection.js";

const mask = (rings = 1) => ({ features: [{ geometry: { type: "Polygon", coordinates: Array.from({ length: rings }, () => []) } }] });

test("dedicated coastline follows overlay arrival, visibility and topology revision", (t) => {
  t.mock.method(console, "info", () => {});
  const priorTopojson = globalThis.topojson;
  const priorD3 = globalThis.d3;
  t.after(() => { globalThis.topojson = priorTopojson; globalThis.d3 = priorD3; });
  let decodes = 0;
  let meshes = 0;
  globalThis.topojson = { feature: (_topology, object) => { decodes++; return object; }, mesh: (_topology, object) => { meshes++; return object; } };
  globalThis.d3 = { geoArea: () => 1, geoBounds: () => [[0, 0], [1, 1]] };
  const primary = { objects: { land: mask() } };
  const dedicated = mask();
  const state = {
    topologyPrimary: primary, activeScenarioId: "tno_1962", showWaterRegions: true,
    runtimePoliticalTopology: { objects: { scenario_coastline: dedicated, context_land_mask: mask(600) } },
    scenarioAtlantropaData: { features: [] },
  };
  let surface = "initial";
  const owner = createBorderMeshOwner({ state, helpers: {
    publishScenarioCoastlineDecision: decision => decision,
    getScenarioSurfaceVersionSignal: () => surface,
    isUsableMesh: mesh => !!mesh?.coordinates?.length,
  } });
  primary.objects.land.coordinates = [[[0, 0], [1, 1]]];
  dedicated.coordinates = [[[0, 0], [2, 2]]];
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
  const meshCount = meshes;
  owner.ensureCoastlineMeshes();
  assert.equal(meshes, meshCount);
  const count = decodes;
  assert.equal(owner.resolveCoastlineTopologySource(), accepted);
  assert.equal(decodes, count);
  state.showScenarioAtlantropa = false;
  assert.equal(owner.resolveCoastlineTopologySource().source, "primary");
  owner.ensureCoastlineMeshes();
  assert.equal(state.cachedCoastlinesHigh[0], primary.objects.land);
  state.showScenarioAtlantropa = true;
  state.showWaterRegions = false;
  assert.equal(owner.resolveCoastlineTopologySource().source, "primary");
  state.showWaterRegions = true;
  assert.equal(owner.resolveCoastlineTopologySource().source, "scenario");
  owner.ensureCoastlineMeshes();
  assert.equal(state.cachedCoastlinesHigh[0], dedicated);
  state.cachedCoastlines = [];
  owner.ensureCoastlineMeshes();
  assert.equal(state.cachedCoastlinesHigh[0], dedicated);
  state.runtimePoliticalTopology.objects.scenario_coastline = mask(600);
  state.topologyRevision = 1;
  assert.equal(owner.resolveCoastlineTopologySource().reason, "interior_ring_count_exceeded");
  state.runtimePoliticalTopology = { objects: { scenario_coastline: mask() } };
  assert.equal(owner.resolveCoastlineTopologySource().source, "scenario");
  surface = "geometry-update";
  assert.notEqual(owner.resolveCoastlineTopologySource().scenarioSurfaceVersionSignal, accepted.scenarioSurfaceVersionSignal);
});

test("ordinary scenario masks and their gates retain existing behavior", (t) => {
  const priorTopojson = globalThis.topojson;
  const priorD3 = globalThis.d3;
  t.after(() => { globalThis.topojson = priorTopojson; globalThis.d3 = priorD3; });
  globalThis.topojson = { feature: (_topology, object) => object };
  globalThis.d3 = { geoArea: () => 1 };
  const primaryTopology = { objects: { land: mask() } };
  const runtimeTopology = { objects: { context_land_mask: mask() } };
  assert.equal(evaluateCoastlineTopologySource({ primaryTopology, runtimeTopology, scenarioId: "hoi4" }).decision.source, "scenario");
  assert.equal(evaluateCoastlineTopologySource({ primaryTopology, runtimeTopology }).decision.reason, "no_active_scenario");
  runtimeTopology.objects.context_land_mask = mask(601);
  assert.equal(evaluateCoastlineTopologySource({ primaryTopology, runtimeTopology, scenarioId: "hoi4" }).decision.reason, "interior_ring_count_exceeded");
});
