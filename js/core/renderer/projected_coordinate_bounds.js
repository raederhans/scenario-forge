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

function collectGeometries(geoObject, out) {
  if (!geoObject || typeof geoObject !== "object") return false;
  if (geoObject.type === "FeatureCollection") {
    return Array.isArray(geoObject.features) && geoObject.features.every((feature) => collectGeometries(feature, out));
  }
  if (geoObject.type === "Feature") return collectGeometries(geoObject.geometry, out);
  if (geoObject.type === "GeometryCollection") {
    return Array.isArray(geoObject.geometries) && geoObject.geometries.every((geometry) => collectGeometries(geometry, out));
  }
  if (!Array.isArray(geoObject.coordinates)) return false;
  out.push(geoObject.coordinates);
  return true;
}

// True when every vertex is a valid non-polar lon/lat and all of them fit in a
// longitude span under 180 degrees. D3 reports world bounds only for a polygon
// whose ring area accumulates negative (an inverted complement); inside such a
// span that polygon's geoArea is 4π minus less than 2π, so the area check
// already rejects it and geoBounds cannot change the verdict.
export function isCompactLonLatGeometry(geoObject) {
  const stack = [];
  if (!collectGeometries(geoObject, stack)) return false;
  let minLon = Infinity;
  let maxLon = -Infinity;
  while (stack.length) {
    const value = stack.pop();
    if (typeof value[0] === "number") {
      const lon = value[0];
      const lat = value[1];
      if (!(lon >= -180 && lon <= 180 && lat > -90 && lat < 90)) return false;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      continue;
    }
    for (const item of value) {
      if (!Array.isArray(item)) return false;
      stack.push(item);
    }
  }
  return maxLon - minLon < 180;
}
