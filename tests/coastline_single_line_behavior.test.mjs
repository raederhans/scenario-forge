import assert from "node:assert/strict";
import test from "node:test";
import { createBorderDrawOwner } from "../js/core/renderer/border_draw_owner.js";
import { createOceanRenderOwner } from "../js/core/renderer/ocean_render_owner.js";
import { createBathymetryStylePolicy, COASTLINE_LOD_LOW_ZOOM_MAX, COASTLINE_LOD_MID_ZOOM_MAX } from "../js/core/renderer/bathymetry_style_policy.js";
import { createScenarioReliefOverlayRenderOwner } from "../js/core/renderer/scenario_relief_overlay_render_owner.js";

function fixture({ source = "scenario", enabled = true, coastlines = {} } = {}) {
  const strokes = [], stack = [];
  let paths = [];
  const context = {
    globalAlpha: 1,
    beginPath() { paths = []; },
    stroke() { strokes.push({ paths: [...paths], color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha }); },
    save() { stack.push({ globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
    restore() { Object.assign(this, stack.pop()); },
  };
  const coast = { type: "MultiLineString", coordinates: [[[0, 0], [100, 100]]] };
  const shores = ["new_shoreline", "lake_shoreline"].map(kind => ({
    type: "Feature", properties: { kind, parent_id: "atlantropa_med" },
    geometry: { type: "LineString", coordinates: [[0, 0], [100, 100]] },
  }));
  const state = { activeScenarioId: "tno_1962", showScenarioReliefOverlays: true,
    styleConfig: { coastlines, ocean: { coastalAccentEnabled: enabled } },
    cachedCoastlinesLow: [coast] };
  const projection = point => point;
  const getters = { getProjection: () => projection, getContext: () => context, getPathCanvas: () => geometry => paths.push(geometry) };
  const policy = createBathymetryStylePolicy(state, {
    getReliefOverlayKind: feature => feature.properties.kind,
    getFeatureProjectedDensity: () => 0,
  });
  const ocean = createOceanRenderOwner({ state, getters, helpers: {
    isScenarioCoastalAccentEnabled: () => enabled,
    resolveCoastlineTopologySource: () => ({ source }),
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
    isScenarioCoastalAccentEnabled: () => enabled,
    getPathBounds: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
  } });
  return { strokes, coast, shores, ocean, border, relief };
}

for (const interactive of [false, true]) {
  test(`${interactive ? "interactive" : "settled"} coast has one constant screen-space stroke`, () => {
    for (const k of [1, 4, 8]) {
      for (const coastlines of [{}, { color: "#123456", width: 2.4, opacity: 0.4 }]) {
        const h = fixture({ coastlines });
        h.border.drawHierarchicalBorders(k, { interactive });
        assert.equal(h.strokes.length, 1);
        const stroke = h.strokes[0];
        assert.deepEqual(stroke.paths, [h.coast]);
        assert.equal(stroke.color, coastlines.color || "#333333");
        assert.equal(stroke.width * k, (coastlines.width ?? 1.2) * 0.8);
        assert.equal(stroke.alpha, (coastlines.opacity ?? 0.8) * 0.875);
      }
    }
  });
  test(`${interactive ? "interactive" : "settled"} coast respects zero width and opacity`, () => {
    for (const coastlines of [{ width: 0 }, { opacity: 0 }]) {
      const h = fixture({ coastlines });
      h.border.drawHierarchicalBorders(4, { interactive });
      assert.equal(h.strokes.length, 0);
    }
  });
}

test("supplementary shorelines use only the overlay route with constant screen widths", () => {
  for (const k of [1, 4, 8]) {
    for (const interactive of [false, true]) {
      const h = fixture({ source: "primary" });
      h.border.drawHierarchicalBorders(k, { interactive });
      h.relief.drawScenarioReliefOverlaysLayer(k);
      assert.equal(h.strokes.length, 3);
      for (const shore of h.shores) {
        const matches = h.strokes.filter(stroke => stroke.paths.includes(shore));
        assert.equal(matches.length, 1);
        assert.equal(matches[0].width * k, 1.22);
      }
    }
  }
});

test("dedicated scenario coastline does not receive overlay or relief duplicates", () => {
  const h = fixture();
  h.border.drawHierarchicalBorders(4);
  h.relief.drawScenarioReliefOverlaysLayer(4);
  assert.equal(h.strokes.length, 1);
  assert.deepEqual(h.strokes[0].paths, [h.coast]);
});

test("legacy disabled accent leaves supplementary shorelines to relief only", () => {
  for (const k of [1, 4, 8]) {
    const h = fixture({ source: "primary", enabled: false });
    h.border.drawHierarchicalBorders(k);
    h.relief.drawScenarioReliefOverlaysLayer(k);
    assert.equal(h.strokes.length, 3);
    for (const [index, shore] of h.shores.entries()) {
      const matches = h.strokes.filter(stroke => stroke.paths.includes(shore));
      assert.equal(matches.length, 1);
      assert.equal(matches[0].width * k, index === 0 ? 1.35 : 1.4);
    }
  }
});

test("interactive coastline selects the zoom LOD without viewport decluttering", () => {
  const low = { type: "MultiLineString", coordinates: [[[0, 0], [100, 0]]] };
  const mid = { type: "MultiLineString", coordinates: [[[0, 10], [50, 10], [100, 10]]] };
  const high = { type: "MultiLineString", coordinates: [[[0, 20], [0.1, 20], [50, 20], [100, 20]]] };
  const paths = [], zooms = [];
  const owner = createBorderDrawOwner({
    state: { cachedCoastlinesLow: [low], cachedCoastlinesMid: [mid], cachedCoastlinesHigh: [high] },
    constants: { coastlineLodLowZoomMax: COASTLINE_LOD_LOW_ZOOM_MAX, coastlineLodMidZoomMax: COASTLINE_LOD_MID_ZOOM_MAX },
    getters: {
      getContext: () => ({ beginPath() {}, stroke() {} }),
      getProjection: () => point => point,
      getPathCanvas: () => geometry => paths.push(geometry),
    },
    helpers: {
      isUsableMesh: value => !!value?.coordinates?.length,
      getCoastlineCollectionForZoom: k => {
        zooms.push(k);
        return k < COASTLINE_LOD_LOW_ZOOM_MAX ? [low] : k < COASTLINE_LOD_MID_ZOOM_MAX ? [mid] : [high];
      },
    },
  });
  for (const k of [COASTLINE_LOD_MID_ZOOM_MAX, 5, 8]) {
    paths.length = 0;
    owner.drawHierarchicalBorders(k, { interactive: true });
    assert.equal(zooms.at(-1), k);
    assert.deepEqual(paths, [high]);
    assert.equal(paths[0], high);
  }
});
