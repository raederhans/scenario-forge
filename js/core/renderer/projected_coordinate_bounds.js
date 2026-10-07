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
