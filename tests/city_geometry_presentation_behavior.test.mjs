import test from "node:test";
import assert from "node:assert/strict";
import { createCityGeometryPresentation } from "../js/core/renderer/city_geometry_presentation.js";
import { createRendererFitProjectionOwner } from "../js/core/renderer/renderer_fit_projection_owner.js";

function createPresentation(overrides = {}) {
  return createCityGeometryPresentation({
    state: { width: 100, height: 80, zoomTransform: { k: 2, x: 10, y: 20 }, currentLanguage: "en" },
    surfaceHost: { getProjection: () => coordinates => [...coordinates], getPathCanvas: () => null },
    getCityDisplayLabel: feature => feature.properties.name,
    getDisplayOwnerCode: () => "AA",
    getLocalizedScenarioCountryName: (record, fallback, translate) => translate(record?.name || fallback),
    getFeatureGeoCentroid: () => [3, 4],
    normalizeLongitude: value => ((value + 180) % 360 + 360) % 360 - 180,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    t: name => name,
    renderTooltipText: ({ lines }) => lines.join("\n"),
    ...overrides,
  });
}

test("city anchors cache projected points and null results by feature identity", () => {
  let calls = 0;
  const owner = createPresentation({ surfaceHost: {
    getProjection: () => coordinates => { calls++; return coordinates.map(value => value * 2); },
    getPathCanvas: () => null,
  } });
  const feature = { geometry: { type: "Point", coordinates: [2, 3] } };
  const first = owner.getCityAnchor(feature);
  assert.deepEqual(first, [4, 6]);
  assert.equal(owner.getCityAnchor(feature), first);
  assert.equal(calls, 1);
  assert.deepEqual(owner.getCityAnchor({ ...feature }), [4, 6]);
  assert.equal(calls, 2);
  const invalid = { geometry: { type: "Point", coordinates: [NaN, 3] } };
  assert.equal(owner.getCityAnchor(invalid), null);
  assert.equal(owner.getCityAnchor(invalid), null);
  assert.equal(calls, 3);
});

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

test("city geometry preserves multipoint averages, geographic bounds and viewport transforms", () => {
  const owner = createPresentation();
  const multi = { geometry: { type: "MultiPoint", coordinates: [[2, 4], [6, 8]] } };
  assert.deepEqual(owner.getCityAnchor(multi), [4, 6]);
  assert.deepEqual(owner.getCityGeoCoordinates(multi), [4, 6]);
  assert.deepEqual(owner.getCityGeoCoordinates({ geometry: { type: "Point", coordinates: [190, 95] } }), [-170, 89.999]);
  assert.deepEqual(owner.getCityGeoCoordinates({}), [3, 4]);
  assert.deepEqual(owner.getCityScreenPoint([4, 6]), [18, 32]);
  assert.deepEqual(owner.getCityScreenPoint([4, 6], { k: 1, x: -4, y: -6 }), [0, 0]);
  assert.equal(owner.isCityAnchorInViewport([57, 0]), true);
  assert.equal(owner.isCityAnchorInViewport([58, 0]), false);
  assert.equal(owner.isCityAnchorInViewport([57, 0], { padding: 0 }), false);
});

test("city tooltips use current language, host ownership and injected text helpers", () => {
  const host = { id: "host" };
  const state = { currentLanguage: "en", landIndex: new Map([["host", host]]),
    scenarioCountriesByTag: { AA: { name: "Country A" } } };
  const owner = createPresentation({ state, getDisplayOwnerCode: (feature, id) => {
    assert.equal(feature, host);
    assert.equal(id, "host");
    return "aa";
  } });
  const entry = { feature: { properties: { name: "City", __city_host_feature_id: "host", __city_is_country_capital: true } } };
  assert.equal(owner.getCityTooltipText(entry), "City\nCapital\nCountry A (AA)");
  state.currentLanguage = "zh";
  assert.equal(owner.getCityCapitalDescriptor(entry), "首都");
  entry.feature.properties.__city_is_country_capital = false;
  entry.feature.properties.__city_is_admin_capital = true;
  assert.equal(owner.getCityCapitalDescriptor(entry), "行政中心");
});
