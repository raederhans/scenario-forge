import assert from "node:assert/strict";
import test from "node:test";
import { createCityLightsAssetProvider } from "../js/core/renderer/city_lights_asset_provider.js";

function createModernAsset() {
  return {
    MODERN_CITY_LIGHTS_BASE_THRESHOLD: 2,
    MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD: 14,
    MODERN_CITY_LIGHTS_GRID: new Uint8Array([1, 2, 3, 4]),
    MODERN_CITY_LIGHTS_GRID_HEIGHT: 2,
    MODERN_CITY_LIGHTS_GRID_WIDTH: 2,
    MODERN_CITY_LIGHTS_STATS: { max: 4 },
    MODERN_CITY_LIGHTS_STEP_LAT_DEG: 90,
    MODERN_CITY_LIGHTS_STEP_LON_DEG: 180,
  };
}

function createUrbanShapes() {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature", id: "ne_urban_1", properties: { anchor: [0.5, 0.5] },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }],
  };
}

test("invalid urban shapes leave the published modern grid available", async () => {
  const provider = createCityLightsAssetProvider({
    importModernAsset: async () => createModernAsset(),
    resolveUrbanShapeAssetUrl: () => "urban.geojson",
    fetchUrbanShapeAsset: async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) }),
  });
  const grid = await provider.ensureModernAssets();
  await assert.rejects(provider.ensureUrbanShapeAssets());
  assert.equal(provider.getAssets().MODERN_CITY_LIGHTS_GRID, grid.MODERN_CITY_LIGHTS_GRID);
});

test("urban shape validation preserves multipolygon holes", async () => {
  const collection = createUrbanShapes();
  const ring = collection.features[0].geometry.coordinates[0];
  collection.features[0].geometry = { type: "MultiPolygon", coordinates: [[ring, ring], [ring]] };
  const provider = createCityLightsAssetProvider({
    resolveUrbanShapeAssetUrl: () => "urban.geojson",
    fetchUrbanShapeAsset: async () => ({ ok: true, json: async () => collection }),
  });
  assert.equal(await provider.ensureUrbanShapeAssets(), collection);
});
