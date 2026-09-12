import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import { ensureProjectedBoundsCacheState } from "../state/renderer_runtime_state.js";
import {
  clearProjectedBoundsCacheEntriesState,
  setProjectedBoundsCacheEntryState,
  syncProjectedBoundsCacheEntryState,
} from "../state/actions/renderer_cache_actions.js";

const DEFAULT_SPHERICAL_GEOMETRY_MAX_AREA = Math.PI * 2;

function defaultWarn(...args) {
  console.warn(...args);
}

function buildProjectedBounds(minX, minY, maxX, maxY) {
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    area: Math.max(0, width) * Math.max(0, height),
  };
}

function isWorldBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return false;
  const [[minLon, minLat], [maxLon, maxLat]] = bounds;
  return minLon <= -180 && maxLon >= 180 && minLat <= -90 && maxLat >= 90;
}

export function createProjectedGeometryBoundsOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const {
    sphericalGeometryMaxArea = DEFAULT_SPHERICAL_GEOMETRY_MAX_AREA,
  } = constants;
  const {
    getProjection = () => null,
    getPathCanvas = () => null,
    getPathSvg = () => null,
    getLandFeatures = () => [],
    getRiverFeatures = () => [],
    getActiveScenarioId = () => "",
    getD3 = () => null,
  } = getters;
  const {
    getFeatureId = () => "",
    recordRenderPerfMetric = () => {},
    updateProjectedBoundsDiagnostics = null,
    recordProjectedBoundsDiagnosticsState = updateProjectedBoundsDiagnostics || (() => {}),
    resetHostWaterPathCaches = () => {},
    warn = defaultWarn,
  } = helpers;

  const sphericalGeometryDiagnosticsByObject = new WeakMap();
  const safeWaterRegionGeometryPartsByFeature = new WeakMap();
  const sanitizedWaterRegionFeatureByFeature = new WeakMap();
  const waterSphericalSanitizationWarnings = new Set();
  let projectedBoundsByGeometry = new WeakMap();
  let boundsProjectionGeneration = -1;
  let boundsScenarioId = "";

  function ensureGeometryBoundsIdentity() {
    const generation = getProjectionGeometryGeneration(getProjection());
    const scenarioId = String(getActiveScenarioId() || "");
    if (generation !== boundsProjectionGeneration || scenarioId !== boundsScenarioId) {
      projectedBoundsByGeometry = new WeakMap();
      if (boundsProjectionGeneration !== -1) {
        ensureCache();
        clearProjectedBoundsCacheEntriesState(state);
        resetHostWaterPathCaches();
      }
      boundsProjectionGeneration = generation;
      boundsScenarioId = scenarioId;
    }
  }

  function ensureCache() {
    // Runtime resets may replace the public ID map; never retain its holder.
    // Geometry identity remains private, while ID publication uses state actions.
    if (!(state.projectedBoundsById instanceof Map)) ensureProjectedBoundsCacheState(state);
  }

  function computeProjectedCoordinateBounds(geoObject) {
    const projection = getProjection();
    if (!projection || !geoObject || typeof geoObject !== "object") return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const visit = (value) => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        const projected = projection([Number(value[0]), Number(value[1])]);
        if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return;
        minX = Math.min(minX, projected[0]);
        minY = Math.min(minY, projected[1]);
        maxX = Math.max(maxX, projected[0]);
        maxY = Math.max(maxY, projected[1]);
        return;
      }
      value.forEach(visit);
    };
    const visitGeometry = (geometry) => {
      if (!geometry || typeof geometry !== "object") return;
      const type = String(geometry.type || "");
      if (type === "Feature") {
        visitGeometry(geometry.geometry);
      } else if (type === "FeatureCollection") {
        if (Array.isArray(geometry.features)) geometry.features.forEach(visitGeometry);
      } else if (type === "GeometryCollection") {
        if (Array.isArray(geometry.geometries)) geometry.geometries.forEach(visitGeometry);
      } else {
        visit(geometry.coordinates);
      }
    };
    visitGeometry(geoObject);
    return buildProjectedBounds(minX, minY, maxX, maxY);
  }

  function computeProjectedGeoBounds(geoObject) {
    const pathRef = getPathCanvas() || getPathSvg();
    if (!pathRef || !geoObject) return null;
    let bounds = null;
    try {
      bounds = pathRef.bounds(geoObject);
    } catch (_error) {
      return computeProjectedCoordinateBounds(geoObject);
    }
    if (!bounds || bounds.length !== 2) return computeProjectedCoordinateBounds(geoObject);
    const projectedBounds = buildProjectedBounds(bounds[0]?.[0], bounds[0]?.[1], bounds[1]?.[0], bounds[1]?.[1]);
    return projectedBounds || computeProjectedCoordinateBounds(geoObject);
  }

  function computeProjectedFeatureBounds(feature) {
    ensureGeometryBoundsIdentity();
    const geometry = feature?.geometry;
    if (!geometry || typeof geometry !== "object") return computeProjectedGeoBounds(feature);
    if (projectedBoundsByGeometry.has(geometry)) return projectedBoundsByGeometry.get(geometry);
    const bounds = computeProjectedGeoBounds(feature);
    projectedBoundsByGeometry.set(geometry, bounds);
    return bounds;
  }

  function getProjectedFeatureBounds(feature, { featureId = null, allowCompute = true } = {}) {
    ensureGeometryBoundsIdentity();
    const resolvedFeatureId = featureId || getFeatureId(feature);
    const geometry = feature?.geometry;
    const cached = geometry && projectedBoundsByGeometry.has(geometry);
    // The public ID map can be populated by spatial-index builders. Only the
    // geometry cache proves which shape those bounds describe after a LOD swap.
    if (!cached && !allowCompute) return null;
    const bounds = cached ? projectedBoundsByGeometry.get(geometry) : computeProjectedFeatureBounds(feature);
    if (resolvedFeatureId) {
      ensureCache();
      syncProjectedBoundsCacheEntryState(state, resolvedFeatureId, bounds);
    }
    return bounds;
  }

  function rebuildProjectedBoundsCache() {
    clearProjectedBoundsCache();
    ensureCache();
    for (const feature of [...(getLandFeatures() || []), ...(getRiverFeatures() || [])]) {
      const featureId = getFeatureId(feature);
      if (!featureId) continue;
      const bounds = computeProjectedFeatureBounds(feature);
      if (bounds) setProjectedBoundsCacheEntryState(state, featureId, bounds);
    }
  }

  function clearProjectedBoundsCache() {
    projectedBoundsByGeometry = new WeakMap();
    ensureCache();
    clearProjectedBoundsCacheEntriesState(state);
    resetHostWaterPathCaches();
  }

  function recordProjectedBoundsDiagnostic(feature, reason = "unknown") {
    return recordProjectedBoundsDiagnosticsState(feature, reason);
  }

  function mergeProjectedBounds(boundsList = []) {
    if (!Array.isArray(boundsList)) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const entry of boundsList) {
      if (!entry) continue;
      minX = Math.min(minX, Number(entry.minX));
      minY = Math.min(minY, Number(entry.minY));
      maxX = Math.max(maxX, Number(entry.maxX));
      maxY = Math.max(maxY, Number(entry.maxY));
    }
    return buildProjectedBounds(minX, minY, maxX, maxY);
  }

  function normalizeGeoObjectForSphericalDiagnostics(geoObject) {
    if (!geoObject || typeof geoObject !== "object") return null;
    const objectType = String(geoObject.type || "").trim();
    if (objectType === "Feature" || objectType === "FeatureCollection" || objectType === "Sphere") {
      return geoObject;
    }
    if (objectType) {
      return { type: "Feature", properties: {}, geometry: geoObject };
    }
    return null;
  }

  function getSphericalGeometryDiagnostics(geoObject) {
    const normalizedGeoObject = normalizeGeoObjectForSphericalDiagnostics(geoObject);
    const d3 = getD3();
    if (!normalizedGeoObject || !d3?.geoArea || !d3?.geoBounds) return null;
    if (sphericalGeometryDiagnosticsByObject.has(geoObject)) {
      return sphericalGeometryDiagnosticsByObject.get(geoObject) || null;
    }
    try {
      const area = Number(d3.geoArea(normalizedGeoObject));
      const bounds = d3.geoBounds(normalizedGeoObject);
      const diagnostics = {
        area,
        bounds,
        isWorldBounds: isWorldBounds(bounds),
        hasExcessiveSphereArea: Number.isFinite(area) && area > sphericalGeometryMaxArea,
      };
      diagnostics.invalid = diagnostics.isWorldBounds || diagnostics.hasExcessiveSphereArea;
      sphericalGeometryDiagnosticsByObject.set(geoObject, diagnostics);
      return diagnostics;
    } catch (_error) {
      return null;
    }
  }

  function isSphericalGeometryUnsafe(geoObject) {
    return !!getSphericalGeometryDiagnostics(geoObject)?.invalid;
  }

  function collectPolygonalGeometryParts(geometry) {
    if (!geometry || typeof geometry !== "object") return [];
    const geometryType = String(geometry.type || "");
    if (geometryType === "Polygon") return [geometry];
    if (geometryType === "MultiPolygon") {
      const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
      return coordinates
        .filter((partCoordinates) => Array.isArray(partCoordinates) && partCoordinates.length > 0)
        .map((partCoordinates) => ({ type: "Polygon", coordinates: partCoordinates }));
    }
    if (geometryType === "GeometryCollection") {
      return (Array.isArray(geometry.geometries) ? geometry.geometries : [])
        .flatMap((partGeometry) => collectPolygonalGeometryParts(partGeometry));
    }
    return [];
  }

  function collectFeatureHitGeometries(feature) {
    const geometry = feature?.geometry;
    const polygonParts = collectPolygonalGeometryParts(geometry);
    return polygonParts.length ? polygonParts : (geometry ? [geometry] : []);
  }

  function buildWaterRegionFeatureFromParts(feature, parts) {
    const safeParts = Array.isArray(parts) ? parts : [];
    if (!feature || !safeParts.length) return null;
    if (safeParts.length === 1) return { ...feature, geometry: safeParts[0] };
    return {
      ...feature,
      geometry: {
        type: "MultiPolygon",
        coordinates: safeParts
          .filter((part) => String(part?.type || "") === "Polygon" && Array.isArray(part.coordinates))
          .map((part) => part.coordinates),
      },
    };
  }

  function collectSafeWaterRegionGeometryPartsInfo(feature) {
    if (!feature || typeof feature !== "object") return { parts: [], rawCount: 0, removedCount: 0 };
    if (safeWaterRegionGeometryPartsByFeature.has(feature)) {
      return safeWaterRegionGeometryPartsByFeature.get(feature);
    }
    const rawParts = collectFeatureHitGeometries(feature);
    const safeParts = [];
    let removedCount = 0;
    rawParts.forEach((part) => {
      if (isSphericalGeometryUnsafe(part)) {
        removedCount += 1;
        return;
      }
      safeParts.push(part);
    });
    const info = { parts: safeParts, rawCount: rawParts.length, removedCount };
    safeWaterRegionGeometryPartsByFeature.set(feature, info);
    return info;
  }

  function collectSafeWaterRegionGeometryParts(feature) {
    return collectSafeWaterRegionGeometryPartsInfo(feature).parts;
  }

  function shouldExcludeWaterHitGeometry(hitGeometry, _feature = null) {
    return isSphericalGeometryUnsafe(hitGeometry);
  }

  function sanitizeWaterRegionFeature(feature) {
    if (!feature || typeof feature !== "object") return null;
    if (sanitizedWaterRegionFeatureByFeature.has(feature)) {
      return sanitizedWaterRegionFeatureByFeature.get(feature);
    }
    const partInfo = collectSafeWaterRegionGeometryPartsInfo(feature);
    const sanitized = partInfo.removedCount > 0
      ? buildWaterRegionFeatureFromParts(feature, partInfo.parts)
      : feature;
    sanitizedWaterRegionFeatureByFeature.set(feature, sanitized);
    return sanitized;
  }

  function sanitizeWaterRegionFeatures(features = []) {
    const sanitizedFeatures = [];
    const changedFeatureIds = [];
    let removedPartCount = 0;
    (Array.isArray(features) ? features : []).forEach((feature) => {
      const sanitized = sanitizeWaterRegionFeature(feature);
      const partInfo = collectSafeWaterRegionGeometryPartsInfo(feature);
      if (partInfo.removedCount > 0) {
        const featureId = getFeatureId(feature);
        if (featureId) changedFeatureIds.push(featureId);
        removedPartCount += partInfo.removedCount;
      }
      if (sanitized) sanitizedFeatures.push(sanitized);
    });
    if (removedPartCount > 0) {
      const uniqueIds = Array.from(new Set(changedFeatureIds)).sort();
      recordRenderPerfMetric("waterSphericalSanitization", 0, {
        removedPartCount,
        featureIds: uniqueIds,
      });
      const warningKey = `${getActiveScenarioId() || ""}:${uniqueIds.join(",")}:${removedPartCount}`;
      if (!waterSphericalSanitizationWarnings.has(warningKey)) {
        waterSphericalSanitizationWarnings.add(warningKey);
        warn(`[map_renderer] Removed ${removedPartCount} D3-unsafe water geometry part(s): ${uniqueIds.join(", ")}`);
      }
    }
    return sanitizedFeatures;
  }

  return Object.freeze({
    computeProjectedCoordinateBounds,
    computeProjectedGeoBounds,
    computeProjectedFeatureBounds,
    getProjectedFeatureBounds,
    rebuildProjectedBoundsCache,
    clearProjectedBoundsCache,
    recordProjectedBoundsDiagnostic,
    mergeProjectedBounds,
    normalizeGeoObjectForSphericalDiagnostics,
    getSphericalGeometryDiagnostics,
    isSphericalGeometryUnsafe,
    collectPolygonalGeometryParts,
    collectFeatureHitGeometries,
    buildWaterRegionFeatureFromParts,
    collectSafeWaterRegionGeometryPartsInfo,
    collectSafeWaterRegionGeometryParts,
    shouldExcludeWaterHitGeometry,
    sanitizeWaterRegionFeature,
    sanitizeWaterRegionFeatures,
  });
}
