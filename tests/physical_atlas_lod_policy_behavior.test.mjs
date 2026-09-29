import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolvePhysicalAtlasCollection, shouldRequestPhysicalAtlasDetail, getPhysicalPresentationLayerRequests, PHYSICAL_ATLAS_DETAIL_LAYER } from "../js/core/renderer/physical_atlas_lod_policy.js";

test("renderer zoom entry requests missing detail through the installed loader without unresolved hooks", async () => {
  const source = fs.readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const entry = source.slice(source.indexOf("function ensurePhysicalAtlasDetailForView()"), source.indexOf("function ensureContourLodForView()"));
  const calls = [];
  const state = { showPhysical: true, styleConfig: { physical: {} }, zoomTransform: { k: 4 }, ensureContextLayerDataFn: (...args) => { calls.push(args); } };
  const run = new Function("runtimeState", "shouldRequestPhysicalAtlasDetail", "PHYSICAL_ATLAS_DETAIL_LAYER", "getPhysicalPresentationLayerRequests", `${entry}; return ensurePhysicalAtlasDetailForView;`)(state, shouldRequestPhysicalAtlasDetail, PHYSICAL_ATLAS_DETAIL_LAYER, getPhysicalPresentationLayerRequests);
  run(); await Promise.resolve();
  assert.deepEqual(calls[0][0], ["physical_semantics_detail"]);
  state.contextLayerLoadStateByName = { physical_semantics_detail: "loading" };
  run(); await Promise.resolve();
  assert.equal(calls.length, 1);
});

test("renderer tool normalization retains an existing zero strength on partial changes", () => {
  const source = fs.readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const entry = source.slice(source.indexOf("function normalizeIntensityFieldToolState("), source.indexOf("function setIntensityFieldTool("));
  const state = { intensityFieldTool: { active:true,channelId:"physicalAtlas",subMode:"paint",brushRadiusDeg:3,brushStrength:0 } };
  const normalize = new Function("runtimeState", "createDefaultIntensityFieldToolState", "INTENSITY_FIELD_TOOL_CHANNELS", "INTENSITY_FIELD_TOOL_SUBMODES", "INTENSITY_FIELD_GRID", "clamp", `${entry}; return normalizeIntensityFieldToolState;`)(state, ()=>({channelId:"physicalAtlas",subMode:"paint",brushRadiusDeg:3,brushStrength:1}),new Set(["physicalAtlas"]),new Set(["paint","points"]),{min:0,max:2},(v,a,b)=>Math.max(a,Math.min(b,v)));
  assert.equal(normalize({subMode:"points"}).brushStrength,0);
});

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
