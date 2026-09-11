import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createCityLightsAssetProvider,
  MODERN_CITY_LIGHTS_ASSET_SPECIFIER,
} from "../js/core/renderer/city_lights_asset_provider.js";

const rendererSource = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const providerSource = await readFile(
  new URL("../js/core/renderer/city_lights_asset_provider.js", import.meta.url),
  "utf8",
);

function createModernAsset(overrides = {}) {
  return {
    MODERN_CITY_LIGHTS_BASE_THRESHOLD: 2,
    MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD: 14,
    MODERN_CITY_LIGHTS_GRID: new Uint8Array([1, 2, 3, 4]),
    MODERN_CITY_LIGHTS_GRID_HEIGHT: 2,
    MODERN_CITY_LIGHTS_GRID_WIDTH: 2,
    MODERN_CITY_LIGHTS_STATS: { max: 4 },
    MODERN_CITY_LIGHTS_STEP_LAT_DEG: 90,
    MODERN_CITY_LIGHTS_STEP_LON_DEG: 180,
    ...overrides,
  };
}

test("map renderer startup graph has no static Modern City Lights asset import", () => {
  assert.doesNotMatch(rendererSource, /from\s+["']\.\/city_lights_modern_asset\.js["']/);
  assert.match(rendererSource, /createCityLightsAssetProvider\(\)/);
  assert.match(rendererSource, /return getCityLightsRenderOwner\(\)\.drawNightLightsLayer\(k, config, solarState\);/);
  assert.match(providerSource, /import\(["']\.\.\/city_lights_modern_asset\.js["']\)/);
  assert.doesNotMatch(providerSource, /from\s+["']\.\.\/city_lights_modern_asset\.js["']/);
});

test("provider does not import the modern asset until explicitly requested", async () => {
  const imports = [];
  const historicalEntries = [{ name: "historical" }];
  const provider = createCityLightsAssetProvider({
    historicalEntries,
    importModernAsset: async (specifier) => {
      imports.push(specifier);
      return createModernAsset();
    },
  });

  const initialAssets = provider.getAssets();
  assert.deepEqual(imports, []);
  assert.equal(initialAssets.HISTORICAL_1930_CITY_LIGHTS_ENTRIES, historicalEntries);
  assert.deepEqual(initialAssets.MODERN_CITY_LIGHTS_GRID, []);
  assert.equal(provider.isModernAssetsReady(), false);

  const loadedAssets = await provider.ensureModernAssets();

  assert.deepEqual(imports, [MODERN_CITY_LIGHTS_ASSET_SPECIFIER]);
  assert.equal(loadedAssets.MODERN_CITY_LIGHTS_GRID.length, 4);
  assert.equal(provider.getAssets().MODERN_CITY_LIGHTS_GRID, loadedAssets.MODERN_CITY_LIGHTS_GRID);
  assert.equal(provider.isModernAssetsReady(), true);
});

test("provider coalesces concurrent loads and retries after a rejected import", async () => {
  let attempts = 0;
  let resolveFirstImport;
  const provider = createCityLightsAssetProvider({
    importModernAsset: () => {
      attempts += 1;
      if (attempts === 1) {
        return new Promise((_resolve, reject) => {
          resolveFirstImport = () => reject(new Error("network unavailable"));
        });
      }
      return Promise.resolve(createModernAsset());
    },
  });

  const first = provider.ensureModernAssets();
  const second = provider.ensureModernAssets();
  assert.equal(first, second);
  assert.equal(attempts, 0, "import starts in a microtask so disabled boot remains side-effect free");
  await Promise.resolve();
  assert.equal(attempts, 1);
  resolveFirstImport();
  await assert.rejects(first, /network unavailable/);

  await provider.ensureModernAssets();
  assert.equal(attempts, 2);
  assert.equal(provider.isModernAssetsReady(), true);
});

test("provider rejects malformed modern grid dimensions", async () => {
  const provider = createCityLightsAssetProvider({
    importModernAsset: async () => createModernAsset({
      MODERN_CITY_LIGHTS_GRID_WIDTH: 3,
    }),
  });

  await assert.rejects(provider.ensureModernAssets(), /dimensions do not match/);
  assert.equal(provider.isModernAssetsReady(), false);
});

function createUrbanShapes() {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature", id: "ne_urban_1", properties: { anchor: [0.5, 0.5] },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }],
  };
}

test("urban shapes stay lazy for historical access and modern grid loading", async () => {
  let fetches = 0;
  let resolutions = 0;
  const provider = createCityLightsAssetProvider({
    importModernAsset: async () => createModernAsset(),
    resolveUrbanShapeAssetUrl: () => { resolutions += 1; return "urban.geojson"; },
    fetchUrbanShapeAsset: async () => { fetches += 1; throw new Error("not requested"); },
  });
  assert.ok(provider.getAssets().HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length);
  assert.equal(provider.getAssets().MODERN_CITY_LIGHTS_URBAN_AREAS, null);
  assert.equal(provider.isUrbanShapeAssetsReady(), false);
  await provider.ensureModernAssets();
  assert.equal(provider.isModernAssetsReady(), true);
  assert.equal(fetches, 0);
  assert.equal(resolutions, 0);
});

test("urban shape requests coalesce and retain their independent published collection", async () => {
  const collection = createUrbanShapes();
  let finish;
  let fetches = 0;
  const provider = createCityLightsAssetProvider({
    importModernAsset: async () => { throw new Error("grid must remain lazy"); },
    resolveUrbanShapeAssetUrl: () => "urban.geojson",
    fetchUrbanShapeAsset: (url) => {
      assert.equal(url, "urban.geojson");
      fetches += 1;
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  const first = provider.ensureUrbanShapeAssets();
  assert.equal(provider.ensureUrbanShapeAssets(), first);
  assert.equal(fetches, 0);
  await Promise.resolve();
  assert.equal(fetches, 1);
  assert.equal(provider.getAssets().MODERN_CITY_LIGHTS_URBAN_AREAS, null);
  finish({ ok: true, json: async () => collection });
  assert.equal(await first, collection);
  assert.equal(await provider.ensureUrbanShapeAssets(), collection);
  assert.equal(provider.getAssets().MODERN_CITY_LIGHTS_URBAN_AREAS, collection);
  assert.equal(provider.isUrbanShapeAssetsReady(), true);
  assert.equal(provider.isModernAssetsReady(), false);
  assert.equal(fetches, 1);
});

test("urban shape failures preserve modern grid and retry only on an explicit request", async () => {
  const failures = [
    () => { throw new Error("network unavailable"); },
    () => ({ ok: false, status: 503, json: async () => createUrbanShapes() }),
    () => ({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } }),
    () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) }),
  ];
  for (const fail of failures) {
    let attempts = 0;
    const provider = createCityLightsAssetProvider({
      importModernAsset: async () => createModernAsset(),
      resolveUrbanShapeAssetUrl: () => "urban.geojson",
      fetchUrbanShapeAsset: () => {
        attempts += 1;
        return attempts === 1 ? fail() : { ok: true, json: async () => createUrbanShapes() };
      },
    });
    const grid = await provider.ensureModernAssets();
    await assert.rejects(provider.ensureUrbanShapeAssets());
    await Promise.resolve();
    assert.equal(attempts, 1);
    assert.equal(provider.isUrbanShapeAssetsReady(), false);
    assert.equal(provider.getAssets().MODERN_CITY_LIGHTS_URBAN_AREAS, null);
    assert.equal(provider.getAssets().MODERN_CITY_LIGHTS_GRID, grid.MODERN_CITY_LIGHTS_GRID);
    await provider.ensureUrbanShapeAssets();
    assert.equal(attempts, 2);
    assert.equal(provider.isUrbanShapeAssetsReady(), true);
  }
});

test("urban shape validation rejects invalid geometry and preserves multipolygon holes", async () => {
  const ring = createUrbanShapes().features[0].geometry.coordinates[0];
  for (const geometry of [
    null, { type: "Point", coordinates: [0, 0] },
    { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 1], [1, 2], [2, 3]]] },
    { type: "Polygon", coordinates: [[[0, 0], [NaN, 1], [1, 2], [0, 0]]] },
    { type: "MultiPolygon", coordinates: [] },
  ]) {
    const collection = createUrbanShapes();
    collection.features[0].geometry = geometry;
    const provider = createCityLightsAssetProvider({
      resolveUrbanShapeAssetUrl: () => "urban.geojson",
      fetchUrbanShapeAsset: async () => ({ ok: true, json: async () => collection }),
    });
    await assert.rejects(provider.ensureUrbanShapeAssets(), /polygon features/);
  }
  const collection = createUrbanShapes();
  collection.features[0].geometry = { type: "MultiPolygon", coordinates: [[ring, ring], [ring]] };
  const provider = createCityLightsAssetProvider({
    resolveUrbanShapeAssetUrl: () => "urban.geojson",
    fetchUrbanShapeAsset: async () => ({ ok: true, json: async () => collection }),
  });
  assert.equal(await provider.ensureUrbanShapeAssets(), collection);
});
