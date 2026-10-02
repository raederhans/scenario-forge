export function collectRasterPolygonalGeometryParts(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  const geometryType = String(geometry.type || "");
  if (geometryType === "Polygon") {
    return [geometry];
  }
  if (geometryType === "MultiPolygon") {
    return (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
      .filter((partCoordinates) => Array.isArray(partCoordinates) && partCoordinates.length > 0)
      .map((partCoordinates) => ({
        type: "Polygon",
        coordinates: partCoordinates,
      }));
  }
  if (geometryType === "GeometryCollection") {
    return (Array.isArray(geometry.geometries) ? geometry.geometries : [])
      .flatMap((partGeometry) => collectRasterPolygonalGeometryParts(partGeometry));
  }
  return [];
}

export function projectCoordinateToWorkerPixel(point, projection, transform, dpr) {
  if (!Array.isArray(point) || point.length < 2 || !projection) return null;
  const projected = projection([Number(point[0]), Number(point[1])]);
  if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return null;
  const x = (Number(transform?.x || 0) + projected[0] * Number(transform?.k || 1)) * dpr;
  const y = (Number(transform?.y || 0) + projected[1] * Number(transform?.k || 1)) * dpr;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [Number(x.toFixed(3)), Number(y.toFixed(3))];
}

export function buildWorkerPixelRingsForGeometry(geometry, projectPoint) {
  if (typeof projectPoint !== "function") return [];
  const rings = [];
  collectRasterPolygonalGeometryParts(geometry).forEach((polygonPart) => {
    (Array.isArray(polygonPart.coordinates) ? polygonPart.coordinates : []).forEach((ring) => {
      const projectedRing = (Array.isArray(ring) ? ring : [])
        .map((point) => projectPoint(point))
        .filter(Boolean);
      if (projectedRing.length >= 3) rings.push(projectedRing);
    });
  });
  return rings;
}
