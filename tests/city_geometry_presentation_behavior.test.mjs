import test from "node:test";
import assert from "node:assert/strict";
import { createCityGeometryPresentation } from "../js/core/renderer/city_geometry_presentation.js";
import { createRendererFitProjectionOwner } from "../js/core/renderer/renderer_fit_projection_owner.js";

function createPresentation(overrides = {}) {
  return createCityGeometryPresentation({
    state: { width: 100, height: 80, zoomTransform: { k: 2, x: 10, y: 20 }, currentLanguage: "en" },
    surfaceHost: { getProjection: () => coordinates => [...coordinates], getPathCanvas: () => null },
    getFeatureGeoCentroid: () => [3, 4],
    normalizeLongitude: value => ((value + 180) % 360 + 360) % 360 - 180,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    ...overrides,
  });
}

test("projection fitting invalidates cached city anchors after mutating the projection", () => {
  let scale = 1;
  const projection = coordinates => coordinates.map(value => value * scale);
  projection.fitExtent = () => { scale = 3; };
  const surfaceHost = { getProjection: () => projection, getPathCanvas: () => null };
  const owner = createPresentation({ surfaceHost });
  const feature = { geometry: { type: "Point", coordinates: [2, 3] } };
  assert.deepEqual(owner.getCityAnchor(feature), [2, 3]);
  const fitOwner = createRendererFitProjectionOwner({
    surfaceHost,
    state: { width: 100, height: 80, landData: { features: [feature] } },
    constants: { projectionFitPaddingRatio: 0.05 },
    getters: { getLogicalCanvasDimensions: () => [100, 80], getRenderableLandFeatures: () => [feature] },
    effects: {
      resetCityAnchorCache: owner.resetCityAnchorCache,
      rebuildProjectedBoundsCache: () => {},
      buildSpatialIndex: () => {},
      setHitCanvasDirty: () => {},
      updateSpecialZonesPaths: () => {},
      renderSpecialZoneEditorOverlay: () => {},
      updateZoomTranslateExtent: () => {},
      markAllOverlaysDirty: () => {},
    },
  });
  assert.equal(fitOwner.fitProjection(), true);
  assert.deepEqual(owner.getCityAnchor(feature), [6, 9]);
});

test("multipoint anchors use the average coordinates", () => {
  const owner = createPresentation();
  const multi = { geometry: { type: "MultiPoint", coordinates: [[2, 4], [6, 8]] } };
  assert.deepEqual(owner.getCityAnchor(multi), [4, 6]);
  assert.deepEqual(owner.getCityGeoCoordinates(multi), [4, 6]);
});
