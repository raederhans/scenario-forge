import assert from "node:assert/strict";
import test from "node:test";
import { createBorderDrawOwner } from "../js/core/renderer/border_draw_owner.js";
import { createOceanRenderOwner } from "../js/core/renderer/ocean_render_owner.js";
import { createBathymetryStylePolicy } from "../js/core/renderer/bathymetry_style_policy.js";
import { createScenarioReliefOverlayRenderOwner } from "../js/core/renderer/scenario_relief_overlay_render_owner.js";

function fixture({ coastlines = {} } = {}) {
  const strokes = [];
  let paths = [];
  const context = {
    globalAlpha: 1,
    beginPath() { paths = []; },
    stroke() { strokes.push({ paths: [...paths], width: this.lineWidth }); },
    save() {}, restore() {},
  };
  const coast = { type: "MultiLineString", coordinates: [[[0, 0], [100, 100]]] };
  const shores = ["new_shoreline", "lake_shoreline"].map(kind => ({
    type: "Feature", properties: { kind, parent_id: "atlantropa_med" },
    geometry: { type: "LineString", coordinates: [[0, 0], [100, 100]] },
  }));
  const state = { activeScenarioId: "tno_1962", showScenarioReliefOverlays: true,
    styleConfig: { coastlines, ocean: { coastalAccentEnabled: true } },
    cachedCoastlinesLow: [coast] };
  const projection = point => point;
  const getters = { getProjection: () => projection, getContext: () => context, getPathCanvas: () => geometry => paths.push(geometry) };
  const policy = createBathymetryStylePolicy(state, {
    getReliefOverlayKind: feature => feature.properties.kind,
    getFeatureProjectedDensity: () => 0,
  });
  const ocean = createOceanRenderOwner({ state, getters, helpers: {
    isScenarioCoastalAccentEnabled: () => true,
    resolveCoastlineTopologySource: () => ({ source: "scenario" }),
    getCoastlineCollectionForZoom: () => [coast],
    isUsableMesh: mesh => !!mesh?.coordinates?.length,
    getPhysicalLandMaskInfo: () => ({ collection: {} }),
    getScenarioCoastalAccentOverlayFeatures: () => shores,
    getScenarioCoastalAccentOverlayVisualConfig: policy.getScenarioCoastalAccentOverlayVisualConfig,
  } });
  const border = createBorderDrawOwner({ state, getters, helpers: {
    getCoastlineCollectionForZoom: () => [coast],
    isUsableMesh: mesh => !!mesh?.coordinates?.length,
    drawScenarioCoastalAccentLayer: ocean.drawScenarioCoastalAccentLayer,
  } });
  const relief = createScenarioReliefOverlayRenderOwner({ state, getters, helpers: {
    getEffectiveScenarioReliefOverlayFeatures: () => shores,
    getReliefOverlayKind: feature => feature.properties.kind,
    isReliefOverlayEnabled: () => true,
    isScenarioCoastalAccentEnabled: () => true,
    getPathBounds: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
  } });
  return { strokes, coast, border, relief };
}

test("coast width stays constant in screen space across zoom levels", () => {
  for (const k of [1, 4, 8]) {
    const coastlines = { width: 2.4 };
    const h = fixture({ coastlines });
    h.border.drawHierarchicalBorders(k);
    assert.equal(h.strokes.length, 1);
    const stroke = h.strokes[0];
    assert.deepEqual(stroke.paths, [h.coast]);
    assert.equal(stroke.width * k, (coastlines.width ?? 1.2) * 0.8);
  }
});

test("dedicated scenario coastline does not receive overlay or relief duplicates", () => {
  const h = fixture();
  h.border.drawHierarchicalBorders(4);
  h.relief.drawScenarioReliefOverlaysLayer(4);
  assert.equal(h.strokes.length, 1);
  assert.deepEqual(h.strokes[0].paths, [h.coast]);
});
