import {
  HISTORICAL_1930_CITY_LIGHTS_ENTRIES,
} from "../city_lights_historical_1930_asset.js";
import { resolveDataAssetUrl } from "../runtime_asset_registry.js";

const MODERN_CITY_LIGHTS_ASSET_SPECIFIER = "../city_lights_modern_asset.js";

const EMPTY_MODERN_CITY_LIGHTS_ASSETS = Object.freeze({
  MODERN_CITY_LIGHTS_BASE_THRESHOLD: 0,
  MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD: Number.POSITIVE_INFINITY,
  MODERN_CITY_LIGHTS_GRID: Object.freeze([]),
  MODERN_CITY_LIGHTS_GRID_HEIGHT: 0,
  MODERN_CITY_LIGHTS_GRID_WIDTH: 0,
  MODERN_CITY_LIGHTS_STATS: null,
  MODERN_CITY_LIGHTS_STEP_LAT_DEG: 1,
  MODERN_CITY_LIGHTS_STEP_LON_DEG: 1,
});

function normalizeModernAssets(moduleNamespace) {
  const grid = moduleNamespace?.MODERN_CITY_LIGHTS_GRID;
  const width = Number(moduleNamespace?.MODERN_CITY_LIGHTS_GRID_WIDTH);
  const height = Number(moduleNamespace?.MODERN_CITY_LIGHTS_GRID_HEIGHT);
  if (!grid || typeof grid.length !== "number" || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new TypeError("Modern City Lights asset module is missing its grid dimensions.");
  }
  if (width <= 0 || height <= 0 || grid.length !== width * height) {
    throw new RangeError("Modern City Lights asset grid dimensions do not match its payload.");
  }
  return Object.freeze({
    MODERN_CITY_LIGHTS_BASE_THRESHOLD: Number(moduleNamespace.MODERN_CITY_LIGHTS_BASE_THRESHOLD) || 0,
    MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD: Number(moduleNamespace.MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD)
      || Number.POSITIVE_INFINITY,
    MODERN_CITY_LIGHTS_GRID: grid,
    MODERN_CITY_LIGHTS_GRID_HEIGHT: height,
    MODERN_CITY_LIGHTS_GRID_WIDTH: width,
    MODERN_CITY_LIGHTS_STATS: moduleNamespace.MODERN_CITY_LIGHTS_STATS || null,
    MODERN_CITY_LIGHTS_STEP_LAT_DEG: Number(moduleNamespace.MODERN_CITY_LIGHTS_STEP_LAT_DEG) || 1,
    MODERN_CITY_LIGHTS_STEP_LON_DEG: Number(moduleNamespace.MODERN_CITY_LIGHTS_STEP_LON_DEG) || 1,
  });
}

function normalizeUrbanShapeAssets(collection) {
  const validRing = (ring) => Array.isArray(ring) && ring.length >= 4
    && ring.every((point) => Array.isArray(point) && point.length >= 2
      && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
  const validPolygon = (polygon) => Array.isArray(polygon) && polygon.length > 0
    && polygon.every(validRing);
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)
      || collection.features.length === 0 || !collection.features.every((feature) => {
        const geometry = feature?.geometry;
        return feature?.type === "Feature" && (geometry?.type === "Polygon"
          ? validPolygon(geometry.coordinates)
          : geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)
            && geometry.coordinates.length > 0 && geometry.coordinates.every(validPolygon));
      })) {
    throw new TypeError("Modern City Lights urban shapes must contain polygon features.");
  }
  return collection;
}

export function createCityLightsAssetProvider({
  importModernAsset = () => import("../city_lights_modern_asset.js"),
  historicalEntries = HISTORICAL_1930_CITY_LIGHTS_ENTRIES,
  fetchUrbanShapeAsset = (url) => globalThis.fetch(url),
  resolveUrbanShapeAssetUrl = () => resolveDataAssetUrl("world_urban_lights"),
} = {}) {
  let modernAssets = null;
  let modernAssetPromise = null;
  let urbanShapeAssets = null;
  let urbanShapeAssetPromise = null;

  function getAssets() {
    return {
      HISTORICAL_1930_CITY_LIGHTS_ENTRIES: historicalEntries,
      HISTORICAL_DERIVED_GLOW_MAX_ENTRIES: 520,
      HISTORICAL_DERIVED_GLOW_MIN_WEIGHT: 0.62,
      ...(modernAssets || EMPTY_MODERN_CITY_LIGHTS_ASSETS),
      MODERN_CITY_LIGHTS_URBAN_AREAS: urbanShapeAssets,
    };
  }

  function ensureUrbanShapeAssets() {
    if (urbanShapeAssets) {
      return Promise.resolve(urbanShapeAssets);
    }
    if (urbanShapeAssetPromise) {
      return urbanShapeAssetPromise;
    }
    urbanShapeAssetPromise = Promise.resolve()
      .then(() => fetchUrbanShapeAsset(resolveUrbanShapeAssetUrl()))
      .then((response) => {
        if (!response?.ok || typeof response.json !== "function") {
          throw new Error(`Modern City Lights urban shapes request failed (${response?.status ?? "invalid response"}).`);
        }
        return response.json();
      })
      .then((collection) => {
        urbanShapeAssets = normalizeUrbanShapeAssets(collection);
        return urbanShapeAssets;
      })
      .catch((error) => {
        urbanShapeAssetPromise = null;
        throw error;
      });
    return urbanShapeAssetPromise;
  }

  function ensureModernAssets() {
    if (modernAssets) {
      return Promise.resolve(modernAssets);
    }
    if (modernAssetPromise) {
      return modernAssetPromise;
    }
    modernAssetPromise = Promise.resolve()
      .then(() => importModernAsset(MODERN_CITY_LIGHTS_ASSET_SPECIFIER))
      .then((moduleNamespace) => {
        modernAssets = normalizeModernAssets(moduleNamespace);
        return modernAssets;
      })
      .catch((error) => {
        modernAssetPromise = null;
        throw error;
      });
    return modernAssetPromise;
  }

  return Object.freeze({
    ensureModernAssets,
    ensureUrbanShapeAssets,
    getAssets,
    isModernAssetsReady: () => !!modernAssets,
    isUrbanShapeAssetsReady: () => !!urbanShapeAssets,
  });
}

export { MODERN_CITY_LIGHTS_ASSET_SPECIFIER };
