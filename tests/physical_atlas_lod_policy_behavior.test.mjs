import test from "node:test";
import assert from "node:assert/strict";
import { resolvePhysicalAtlasCollection, shouldRequestPhysicalAtlasDetail, getPhysicalPresentationLayerRequests } from "../js/core/renderer/physical_atlas_lod_policy.js";

test("optional labels and DEM shading have separate visibility and scale gates", () => {
  const state = { showPhysical: true, styleConfig: { physical: { showRegionLabels: true, hillshadeOpacity: 0.15 } }, zoomTransform: { k: 1 } };
  assert.deepEqual(getPhysicalPresentationLayerRequests(state), []);
  state.zoomTransform.k = 2;
  assert.deepEqual(getPhysicalPresentationLayerRequests(state), ["physical_region_labels"]);
  state.zoomTransform.k = 4;
  assert.deepEqual(getPhysicalPresentationLayerRequests(state), ["physical_region_labels", "physical_hillshade"]);
  state.styleConfig.physical.mode = "contours_only";
  assert.deepEqual(getPhysicalPresentationLayerRequests(state), []);
});

test("regional detail loads only for an enabled atlas at detail scale, retaining overview until ready", () => {
  const overview = { features: [{}] };
  const detail = { features: [{}, {}] };
  const state = { showPhysical: true, styleConfig: { physical: { mode: "atlas_only" } }, zoomTransform: { k: 1 }, physicalSemanticsData: overview };
  assert.equal(shouldRequestPhysicalAtlasDetail(state), false);
  state.zoomTransform.k = 4;
  assert.equal(shouldRequestPhysicalAtlasDetail(state), true);
  assert.equal(resolvePhysicalAtlasCollection(state), overview);
  state.contextLayerExternalDataByName = { physical_semantics_detail: detail };
  assert.equal(resolvePhysicalAtlasCollection(state), detail);
  state.zoomTransform.k = 1;
  assert.equal(resolvePhysicalAtlasCollection(state), overview);
  state.zoomTransform.k = 8;
  state.styleConfig.physical.mode = "contours_only";
  assert.equal(shouldRequestPhysicalAtlasDetail(state), false);
  state.showPhysical = false;
  assert.equal(shouldRequestPhysicalAtlasDetail(state), false);
});
