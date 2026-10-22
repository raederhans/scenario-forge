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

// Total longitude travelled along a ring's edges, each edge taking D3's minor
// arc. Unlike the span, repeated or self-overlapping loops keep adding to it.
function ringLongitudeTravel(ring) {
  if (!Array.isArray(ring) || !ring.length) return Infinity;
  let travel = 0;
  let previous = null;
  for (const position of ring) {
    if (!isValidPosition(position)) return Infinity;
    if (previous) travel += Math.abs(((position[0] - previous[0] + 540) % 360) - 180);
    previous = position;
  }
  return travel;
}

function isAreaBoundedPolygon(rings, maxTravel) {
  if (!Array.isArray(rings)) return false;
  let travel = 0;
  for (const ring of rings) travel += ringLongitudeTravel(ring);
  return travel < maxTravel;
}

// A minor arc reaches a pole only when its ends are 180° apart in longitude.
function isPoleFreeLine(line) {
  if (!Array.isArray(line) || !line.length) return false;
  let previous = null;
  for (const position of line) {
    if (!isValidPosition(position)) return false;
    if (previous && Math.abs(((position[0] - previous[0] + 540) % 360) - 180) >= 180) return false;
    previous = position;
  }
  return true;
}

// True when geoBounds cannot change D3's spherical verdict for a geoArea limit
// of maxArea. D3 reports world bounds only for a polygon whose summed ring areas
// are negative (an inverted complement), and normalizes that polygon's geoArea
// to 4π plus the sum. D3 sums one signed triangle (south pole, edge) per edge;
// with valid non-polar vertices each triangle lies in the lune between the
// edge's meridians, so its area is at most 2·|Δλ|. A polygon whose edges travel
// T radians of longitude in total therefore has an inverted area above 4π - 2T,
// which the area check rejects while T < (4π - maxArea) / 2. Travel under 180°
// also cannot wind around a pole, and a line whose edges each span under 180°
// never reaches one, so no other geometry's bounds touch ±90°. This holds for
// any ring shape, including holes, repeated loops and self-intersections.
export function isCompactLonLatGeometry(geoObject, maxArea = Math.PI * 2) {
  const maxTravel = Math.min(180, ((Math.PI * 4 - maxArea) / 2) * (180 / Math.PI));
  if (!(maxTravel > 0)) return false;
  return isCompactGeometry(geoObject, maxTravel);
}

function isCompactGeometry(geoObject, maxTravel) {
  if (!geoObject || typeof geoObject !== "object") return false;
  const coordinates = geoObject.coordinates;
  switch (geoObject.type) {
    case "FeatureCollection":
      return Array.isArray(geoObject.features) && geoObject.features.every((feature) => isCompactGeometry(feature, maxTravel));
    case "Feature":
      return isCompactGeometry(geoObject.geometry, maxTravel);
    case "GeometryCollection":
      return Array.isArray(geoObject.geometries) && geoObject.geometries.every((geometry) => isCompactGeometry(geometry, maxTravel));
    case "Polygon":
      return isAreaBoundedPolygon(coordinates, maxTravel);
    case "MultiPolygon":
      return Array.isArray(coordinates) && coordinates.every((polygon) => isAreaBoundedPolygon(polygon, maxTravel));
    case "LineString":
      return isPoleFreeLine(coordinates);
    case "MultiLineString":
      return Array.isArray(coordinates) && coordinates.every(isPoleFreeLine);
    case "Point":
      return isValidPosition(coordinates);
    case "MultiPoint":
      return Array.isArray(coordinates) && coordinates.every(isValidPosition);
    default:
      return false;
  }
}
