// Pure bounds calculation; projection identity and cache lifetime belong to the caller.
export function buildProjectedBounds(minX, minY, maxX, maxY) {
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

export function computeProjectedCoordinateBounds(projection, geoObject) {
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

function isValidPosition(position) {
  const lon = position?.[0];
  const lat = position?.[1];
  return typeof lon === "number" && lon >= -180 && lon <= 180 && lat > -90 && lat < 90;
}

function ringLongitudeSpan(ring) {
  if (!Array.isArray(ring)) return Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const position of ring) {
    if (!isValidPosition(position)) return Infinity;
    if (position[0] < minLon) minLon = position[0];
    if (position[0] > maxLon) maxLon = position[0];
  }
  return maxLon - minLon;
}

function isAreaBoundedPolygon(rings) {
  if (!Array.isArray(rings)) return false;
  let span = 0;
  for (const ring of rings) span += ringLongitudeSpan(ring);
  return span < 180;
}

function hasValidPositions(value) {
  if (!Array.isArray(value)) return false;
  return typeof value[0] === "number" ? isValidPosition(value) : value.every(hasValidPositions);
}

// True when geoBounds cannot change D3's spherical verdict. D3 reports world
// bounds only for a polygon whose summed ring areas are negative (an inverted
// complement), and normalizes that polygon's geoArea to 4π plus the sum. A ring
// of valid non-polar vertices spanning Δλ < 180° encloses at most 2·Δλ, so when
// a polygon's ring spans add up to under 180° the sum stays above -2π and the
// inverted polygon's area exceeds 2π, which the area check already rejects.
// Rings that avoid the poles also keep every other polygon's bounds off ±90°.
export function isCompactLonLatGeometry(geoObject) {
  if (!geoObject || typeof geoObject !== "object") return false;
  switch (geoObject.type) {
    case "FeatureCollection":
      return Array.isArray(geoObject.features) && geoObject.features.every(isCompactLonLatGeometry);
    case "Feature":
      return isCompactLonLatGeometry(geoObject.geometry);
    case "GeometryCollection":
      return Array.isArray(geoObject.geometries) && geoObject.geometries.every(isCompactLonLatGeometry);
    case "Polygon":
      return isAreaBoundedPolygon(geoObject.coordinates);
    case "MultiPolygon":
      return Array.isArray(geoObject.coordinates) && geoObject.coordinates.every(isAreaBoundedPolygon);
    case "Point":
    case "MultiPoint":
    case "LineString":
    case "MultiLineString":
      return hasValidPositions(geoObject.coordinates);
    default:
      return false;
  }
}
