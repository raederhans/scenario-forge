import {
  buildProjectedBounds,
  computeProjectedCoordinateBounds as computeCoordinateBounds,
} from "./projected_coordinate_bounds.js";
import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import {
  buildWaterRegionFeatureFromParts,
  collectPolygonalGeometryParts,
  createWaterSanitizationSnapshotCache,
  rebindSanitizedWaterRegionFeature,
} from "./water_sanitization_snapshot_cache.js";
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
    getContextLayerRevision = () => 0,
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

  let sphericalGeometryDiagnosticsByGeometry = new WeakMap();
  let safeWaterRegionGeometryPartsByGeometry = new WeakMap();
  let sanitizedWaterRegionFeatureByGeometry = new WeakMap();
  const waterSnapshots = createWaterSanitizationSnapshotCache();
  let waterSanitizationRevision = Number(getContextLayerRevision() || 0);
  const waterSphericalSanitizationWarnings = new Set();
  let projectedBoundsByGeometry = new WeakMap();
  let projectedPartBounds = new WeakMap();
  let polygonPartsByGeometry = new WeakMap();
  let boundsProjectionGeneration = -1;
  let boundsScenarioId = "";

  function ensureWaterSanitizationRevision() {
    const revision = Number(getContextLayerRevision() || 0);
    if (revision === waterSanitizationRevision) return;
    waterSanitizationRevision = revision;
    sphericalGeometryDiagnosticsByGeometry = new WeakMap();
    safeWaterRegionGeometryPartsByGeometry = new WeakMap();
    sanitizedWaterRegionFeatureByGeometry = new WeakMap();
    polygonPartsByGeometry = new WeakMap();
    waterSnapshots.reset();
  }

  function ensureGeometryBoundsIdentity() {
    const generation = getProjectionGeometryGeneration(getProjection());
    const scenarioId = String(getActiveScenarioId() || "");
    if (generation !== boundsProjectionGeneration || scenarioId !== boundsScenarioId) {
      projectedBoundsByGeometry = new WeakMap();
      projectedPartBounds = new WeakMap();
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
    return computeCoordinateBounds(getProjection(), geoObject);
  }

  function computeProjectedGeoBounds(geoObject) {
    const pathRef = getPathCanvas() || getPathSvg();
    if (!pathRef || !geoObject) return null;
    ensureGeometryBoundsIdentity();
    const geometry = geoObject.type === "Feature" ? geoObject.geometry : geoObject;
    const cached = geometry && projectedPartBounds.get(geometry);
    if (cached?.pathRef === pathRef) return cached.bounds;
    let bounds = null;
    try {
      bounds = pathRef.bounds(geoObject);
    } catch (_error) {
      return computeProjectedCoordinateBounds(geoObject);
    }
    if (!bounds || bounds.length !== 2) return computeProjectedCoordinateBounds(geoObject);
    const projectedBounds = buildProjectedBounds(bounds[0]?.[0], bounds[0]?.[1], bounds[1]?.[0], bounds[1]?.[1]);
    if (projectedBounds && geometry && typeof geometry === "object") projectedPartBounds.set(geometry, { pathRef, bounds: projectedBounds });
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
    projectedPartBounds = new WeakMap();
    ensureCache();
    clearProjectedBoundsCacheEntriesState(state);
    resetHostWaterPathCaches();
  }

  // Narrow operation: reset only the published ID map while retaining the
  // private geometry WeakMap when projection and scenario identity are stable.
  // Call this when the runtime primary index is rebuilt and IDs need to be
  // re-published, but geometry bounds are still valid for the same projection.
  // Water paths survive unchanged identity; a scene/projection change still resets them.
  function resetPublishedBoundsCache() {
    ensureGeometryBoundsIdentity();
    ensureCache();
    clearProjectedBoundsCacheEntriesState(state);
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
    ensureWaterSanitizationRevision();
    const normalizedGeoObject = normalizeGeoObjectForSphericalDiagnostics(geoObject);
    const d3 = getD3();
    if (!normalizedGeoObject || !d3?.geoArea || !d3?.geoBounds) return null;
    const geometry = geoObject.type === "Feature" && geoObject.geometry
      ? geoObject.geometry : geoObject;
    // Feature properties do not affect D3's spherical calculations. Geometry
    // identity survives wrapper replacement; revision covers in-place edits.
    const cached = sphericalGeometryDiagnosticsByGeometry.get(geometry);
    if (cached) return cached;
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
      sphericalGeometryDiagnosticsByGeometry.set(geometry, diagnostics);
      return diagnostics;
    } catch (_error) {
      return null;
    }
  }

  function isSphericalGeometryUnsafe(geoObject) {
    return !!getSphericalGeometryDiagnostics(geoObject)?.invalid;
  }

  function collectFeatureHitGeometries(feature) {
    ensureWaterSanitizationRevision();
    const geometry = feature?.geometry;
    if (!geometry || typeof geometry !== "object") return [];
    if (polygonPartsByGeometry.has(geometry)) return polygonPartsByGeometry.get(geometry);
    const polygonParts = collectPolygonalGeometryParts(geometry);
    const parts = polygonParts.length ? polygonParts : [geometry];
    polygonPartsByGeometry.set(geometry, parts);
    return parts;
  }

  function collectSafeWaterRegionGeometryPartsInfo(feature) {
    ensureWaterSanitizationRevision();
    if (!feature || typeof feature !== "object") return { parts: [], rawCount: 0, removedCount: 0 };
    const geometry = feature.geometry;
    if (!geometry || typeof geometry !== "object") return { parts: [], rawCount: 0, removedCount: 0 };
    const cached = safeWaterRegionGeometryPartsByGeometry.get(geometry);
    if (cached) return cached;
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
    safeWaterRegionGeometryPartsByGeometry.set(geometry, info);
    return info;
  }

  function collectSafeWaterRegionGeometryParts(feature) {
    return collectSafeWaterRegionGeometryPartsInfo(feature).parts;
  }

  function shouldExcludeWaterHitGeometry(hitGeometry, _feature = null) {
    return isSphericalGeometryUnsafe(hitGeometry);
  }

  function sanitizeWaterRegionFeature(feature) {
    ensureWaterSanitizationRevision();
    if (!feature || typeof feature !== "object") return null;
    const geometry = feature.geometry;
    const cached = geometry && sanitizedWaterRegionFeatureByGeometry.get(geometry);
    if (cached) {
      if (cached.unchanged) return feature;
      cached.sanitized = rebindSanitizedWaterRegionFeature(feature, cached.sanitized);
      return cached.sanitized;
    }
    const partInfo = collectSafeWaterRegionGeometryPartsInfo(feature);
    const sanitized = partInfo.removedCount > 0
      ? buildWaterRegionFeatureFromParts(feature, partInfo.parts)
      : feature;
    if (geometry && typeof geometry === "object") {
      sanitizedWaterRegionFeatureByGeometry.set(geometry, { sanitized, unchanged: sanitized === feature });
    }
    return sanitized;
  }

  function sanitizeWaterRegionFeatures(features = []) {
    ensureWaterSanitizationRevision();
    const source = Array.isArray(features) ? features : [];
    const scenarioId = String(getActiveScenarioId() || "");
    const reused = waterSnapshots.reuseSequence(source, scenarioId);
    if (reused) return reused;
    const sanitizedFeatures = [];
    const changedFeatureIds = [];
    const snapshotEntries = new Map();
    const snapshotBindings = [];
    let removedPartCount = 0;
    source.forEach((feature) => {
      const featureId = getFeatureId(feature);
      const candidate = waterSnapshots.findDecodedFeature(featureId, feature);
      if (candidate) {
        const priorInfo = safeWaterRegionGeometryPartsByGeometry.get(candidate.geometry);
        if (priorInfo) {
          safeWaterRegionGeometryPartsByGeometry.set(feature.geometry, priorInfo);
          const rebound = candidate.sanitizedGeometry
            ? { ...feature, geometry: candidate.sanitizedGeometry }
            : null;
          sanitizedWaterRegionFeatureByGeometry.set(feature.geometry, { sanitized: rebound });
        }
      }
      const sanitized = sanitizeWaterRegionFeature(feature);
      const partInfo = collectSafeWaterRegionGeometryPartsInfo(feature);
      snapshotBindings.push({ feature, sanitized });
      if (featureId) snapshotEntries.set(featureId, { feature, geometry: feature?.geometry, sanitizedGeometry: sanitized?.geometry });
      if (partInfo.removedCount > 0) {
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
    waterSnapshots.remember(source, scenarioId, snapshotBindings, snapshotEntries);
    return sanitizedFeatures;
  }

  return Object.freeze({
    computeProjectedCoordinateBounds,
    computeProjectedGeoBounds,
    computeProjectedFeatureBounds,
    getProjectedFeatureBounds,
    rebuildProjectedBoundsCache,
    clearProjectedBoundsCache,
    resetPublishedBoundsCache,
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
