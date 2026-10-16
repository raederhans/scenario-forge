function samePolygonCoordinates(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let ringIndex = 0; ringIndex < left.length; ringIndex += 1) {
    const leftRing = left[ringIndex], rightRing = right[ringIndex];
    if (!Array.isArray(leftRing) || !Array.isArray(rightRing) || leftRing.length !== rightRing.length) return false;
    for (let pointIndex = 0; pointIndex < leftRing.length; pointIndex += 1) {
      const leftPoint = leftRing[pointIndex], rightPoint = rightRing[pointIndex];
      if (!Array.isArray(leftPoint) || !Array.isArray(rightPoint)
        || leftPoint.length !== rightPoint.length || leftPoint.length < 2) return false;
      for (let axis = 0; axis < leftPoint.length; axis += 1) {
        if (!Number.isFinite(leftPoint[axis]) || leftPoint[axis] !== rightPoint[axis]) return false;
      }
    }
  }
  return true;
}

export function collectPolygonalGeometryParts(geometry) {
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

export function buildWaterRegionFeatureFromParts(feature, parts) {
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

export function rebindSanitizedWaterRegionFeature(feature, sanitized) {
  if (!sanitized) return null;
  if (feature.geometry === sanitized.geometry) return feature;
  // Geometry may be reused, but the caller owns the current metadata. Keep
  // the existing wrapper only while its shallow fields still match.
  const featureKeys = Object.keys(feature).filter((key) => key !== "geometry");
  const sanitizedKeys = Object.keys(sanitized).filter((key) => key !== "geometry");
  if (featureKeys.length === sanitizedKeys.length && featureKeys.every((key) =>
    Object.hasOwn(sanitized, key) && feature[key] === sanitized[key])) return sanitized;
  return { ...feature, geometry: sanitized.geometry };
}

function sameWaterGeometry(left, right) {
  if (!left || !right || left.type !== right.type) return false;
  if (left === right) return true;
  if (left.type === "Polygon") return samePolygonCoordinates(left.coordinates, right.coordinates);
  if (left.type === "MultiPolygon") {
    const leftParts = left.coordinates, rightParts = right.coordinates;
    if (!Array.isArray(leftParts) || !Array.isArray(rightParts) || leftParts.length !== rightParts.length) return false;
    return leftParts.every((part, index) => samePolygonCoordinates(part, rightParts[index]));
  }
  if (left.type === "GeometryCollection") {
    const leftParts = left.geometries, rightParts = right.geometries;
    if (!Array.isArray(leftParts) || !Array.isArray(rightParts) || leftParts.length !== rightParts.length) return false;
    return leftParts.every((part, index) => sameWaterGeometry(part, rightParts[index]));
  }
  return false;
}

export function createWaterSanitizationSnapshotCache() {
  let snapshots = [];

  return Object.freeze({
    reset() { snapshots = []; },
    reuseSequence(source, scenarioId) {
      snapshots = snapshots.filter((snapshot) => snapshot.scenarioId === scenarioId);
      const reused = snapshots.find((snapshot) => snapshot.source.length === source.length
        && source.every((feature, index) => feature === snapshot.source[index]
          && feature?.geometry === snapshot.geometries[index]));
      if (!reused) return null;
      const other = snapshots.find((snapshot) => snapshot !== reused);
      snapshots = [reused, ...(other ? [other] : [])];
      return reused.bindings.map(({ feature, sanitized }) =>
        rebindSanitizedWaterRegionFeature(feature, sanitized)).filter(Boolean);
    },
    findDecodedFeature(featureId, feature) {
      if (!featureId) return null;
      return snapshots.map((snapshot) => snapshot.byId.get(featureId))
        .find((entry) => entry && entry.feature !== feature
          && sameWaterGeometry(entry.geometry, feature?.geometry)) || null;
    },
    remember(source, scenarioId, bindings, byId) {
      const next = {
        scenarioId,
        source: source.slice(),
        geometries: source.map((feature) => feature?.geometry),
        bindings: bindings.slice(),
        byId,
      };
      const largest = snapshots.slice().sort((a, b) => b.source.length - a.source.length)[0];
      snapshots = [next, ...(largest ? [largest] : [])];
    },
  });
}
