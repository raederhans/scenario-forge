const HEMISPHERE_AREA = Math.PI * 2;

function isClosedFiniteRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  if (!ring.every((point) => Array.isArray(point)
    && Number.isFinite(point[0]) && Number.isFinite(point[1])
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

// Bathymetry bands describe local regions smaller than a hemisphere. D3 uses
// clockwise exteriors and opposite holes on the sphere; a planar shoelace test
// cannot establish this reliably for rings crossing the antimeridian.
export function normalizeBathymetryFeatureCollection(collection, {
  geoArea = globalThis.d3?.geoArea,
  geoBounds = globalThis.d3?.geoBounds,
} = {}) {
  const diagnostics = { polygonCount: 0, rewoundRingCount: 0, removedDegenerateHoleCount: 0, rejectedPolygonCount: 0, issues: [] };
  if (!Array.isArray(collection?.features)) return { collection, diagnostics };
  if (typeof geoArea !== "function" || typeof geoBounds !== "function") {
    throw new TypeError("Bathymetry normalization requires spherical geoArea and geoBounds");
  }
  const features = [];
  collection.features.forEach((feature, featureIndex) => {
    const geometry = feature?.geometry;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon" ? geometry.coordinates : null;
    if (!Array.isArray(polygons)) {
      diagnostics.issues.push({ featureIndex, reason: "unsupported-band-geometry" });
      return;
    }
    const normalizedPolygons = [];
    polygons.forEach((polygon, polygonIndex) => {
      diagnostics.polygonCount += 1;
      const reject = (reason) => {
        diagnostics.rejectedPolygonCount += 1;
        diagnostics.issues.push({ featureIndex, polygonIndex, reason });
      };
      if (!Array.isArray(polygon) || !polygon.length || !polygon.every(isClosedFiniteRing)) {
        reject("invalid-ring-coordinates");
        return;
      }
      let invalidRing = false;
      const rings = polygon.map((ring, ringIndex) => {
        const area = geoArea({ type: "Polygon", coordinates: [ring] });
        if (ringIndex > 0 && (area === 0 || area === HEMISPHERE_AREA * 2)) {
          diagnostics.removedDegenerateHoleCount += 1;
          diagnostics.issues.push({ featureIndex, polygonIndex, ringIndex, reason: "zero-area-hole" });
          return null;
        }
        if (!Number.isFinite(area) || area === 0 || area === HEMISPHERE_AREA || area === HEMISPHERE_AREA * 2) {
          invalidRing = true;
          return ring;
        }
        const needsReverse = ringIndex === 0 ? area > HEMISPHERE_AREA : area < HEMISPHERE_AREA;
        if (!needsReverse) return ring;
        diagnostics.rewoundRingCount += 1;
        return [...ring].reverse();
      }).filter(Boolean);
      if (invalidRing) {
        reject("degenerate-or-hemispherical-ring");
        return;
      }
      const normalized = { type: "Polygon", coordinates: rings };
      const area = geoArea(normalized);
      const bounds = geoBounds(normalized);
      if (!(area > 0 && area < HEMISPHERE_AREA)
        || !bounds.flat().every(Number.isFinite)
        || (bounds[0][1] === -90 && bounds[1][1] === 90)) {
        reject("invalid-local-spherical-scope");
        return;
      }
      normalizedPolygons.push(rings);
    });
    if (!normalizedPolygons.length) return;
    features.push({
      ...feature,
      geometry: {
        ...geometry,
        coordinates: geometry.type === "Polygon" ? normalizedPolygons[0] : normalizedPolygons,
      },
    });
  });
  return { collection: { ...collection, features }, diagnostics };
}
