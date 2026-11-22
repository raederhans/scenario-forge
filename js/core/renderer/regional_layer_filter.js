import { getScenarioRegion } from "../scenario/scenario_region.js";
import { getFeatureId } from "../feature_identity.js";

const filters = new WeakMap();
const cellSize = 2;
const worldColumns = 360 / cellSize;
const emptyLand = { type: "FeatureCollection", features: [] };

function polygons(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  return geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
}

// Keep rings continuous across the dateline, and follow the great-circle edges the
// projection draws: an edge spanning more than a degree of longitude gets intermediate
// points, so the planar tests below agree with d3.geoContains. Most parcels need no copies.
const maxEdgeSpan = 1;

function polygonPart(rings) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const origin = rings[0][0][0];
  const track = (x, lat) => {
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, lat); north = Math.max(north, lat);
  };
  const continuous = rings.map(ring => {
    let previous = origin, previousLat = 0;
    let out = null;
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const x = lon + 360 * Math.round((previous - lon) / 360);
      const steps = i ? Math.ceil(Math.abs(x - previous) / maxEdgeSpan) : 1;
      if (steps > 1) {
        out ||= ring.slice(0, i);
        const along = globalThis.d3.geoInterpolate([previous, previousLat], [x, lat]);
        for (let step = 1; step < steps; step++) {
          const [midLon, midLat] = along(step / steps);
          const midX = midLon + 360 * Math.round((previous - midLon) / 360);
          out.push([midX, midLat]);
          track(midX, midLat);
        }
      }
      if (x !== lon) out ||= ring.slice(0, i);
      if (out) out.push(x === lon ? ring[i] : [x, lat]);
      track(x, lat);
      previous = x; previousLat = lat;
    }
    return out || ring;
  });
  return { rings: continuous, west, south, east, north };
}

function withinBounds(x, y, west, south, east, north) {
  return y >= south && y <= north && (west <= east ? x >= west && x <= east : x >= west || x <= east);
}

function segmentsMeet(a, b, c, d) {
  if (Math.min(a[0], b[0]) > Math.max(c[0], d[0]) || Math.max(a[0], b[0]) < Math.min(c[0], d[0])
    || Math.min(a[1], b[1]) > Math.max(c[1], d[1]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1])) return false;
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0;
}

function touchesWater(land, water) {
  const shift = 360 * Math.round((water.west + water.east - land.west - land.east) / 720);
  if (land.west + shift > water.east || land.east + shift < water.west
    || land.south > water.north || land.north < water.south) return false;
  const [wx, wy] = water.rings[0][0];
  const [lx, ly] = land.rings[0][0];
  // A lake inside a parcel's shoreline hole is surrounded by that parcel.
  const landPoint = [lx + shift, ly];
  const inRing = globalThis.d3.polygonContains;
  if (inRing(land.rings[0], [wx - shift, wy])
    || (inRing(water.rings[0], landPoint) && !water.rings.slice(1).some(hole => inRing(hole, landPoint)))) return true;
  const shore = land.rings[0];
  for (const ring of water.rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      if (Math.max(a[0], b[0]) < land.west + shift || Math.min(a[0], b[0]) > land.east + shift
        || Math.max(a[1], b[1]) < land.south || Math.min(a[1], b[1]) > land.north) continue;
      const start = shift ? [a[0] - shift, a[1]] : a;
      const end = shift ? [b[0] - shift, b[1]] : b;
      for (let j = 1; j < shore.length; j++) {
        if (segmentsMeet(start, end, shore[j - 1], shore[j])) return true;
      }
    }
  }
  return false;
}

function visitCells(west, south, east, north, visit) {
  for (let y = Math.floor(south / cellSize); y <= Math.floor(north / cellSize); y++) {
    for (let x = Math.floor(west / cellSize); x <= Math.floor(east / cellSize); x++) {
      const column = (x % worldColumns + worldColumns) % worldColumns;
      if (visit(y * worldColumns + column)) return true;
    }
  }
  return false;
}

function createFilter(region, land) {
  const cells = new Map();
  const ids = new Set();
  const waterMembership = new WeakMap();
  for (const feature of land.features) {
    const id = getFeatureId(feature);
    for (const rings of polygons(feature.geometry)) {
      const part = polygonPart(rings);
      part.id = id;
      part.geometry = { type: "Polygon", coordinates: rings };
      ids.add(id);
      // Index the great-circle edges used by the projection, including their latitude extrema.
      const [[west, south], [east, north]] = globalThis.d3.geoBounds(part.geometry);
      part.bounds = [west, south, east, north];
      visitCells(west, south, west > east ? east + 360 : east, north, key => {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(part);
      });
    }
  }
  function hostAt(point) {
    if (!point) return "";
    const [x, y] = point;
    if (!withinBounds(x, y, ...region.bounds)) return "";
    let host = "";
    visitCells(x, y, x, y, key => {
      for (const part of cells.get(key) || []) {
        if (withinBounds(x, y, ...part.bounds) && globalThis.d3.geoContains(part.geometry, point)) {
          host = part.id;
          return true;
        }
      }
    });
    return host;
  }
  function includesWater(feature) {
    if (!waterMembership.has(feature)) {
      const included = polygons(feature.geometry).some(rings => {
        const water = polygonPart(rings);
        const checked = new Set();
        return visitCells(water.west, water.south, water.east, water.north, key =>
          cells.get(key)?.some(part => {
            if (checked.has(part)) return false;
            checked.add(part);
            return touchesWater(part, water);
          }));
      });
      waterMembership.set(feature, included);
    }
    return waterMembership.get(feature);
  }
  return { region, land, ids, hostAt, includesWater };
}

export function getRegionalLayerFilter(state) {
  const region = getScenarioRegion(state.activeScenarioManifest);
  if (!region) {
    filters.delete(state);
    return null;
  }
  const land = state.landData || emptyLand;
  const cached = filters.get(state);
  if (cached?.region === region && cached.land === land) return cached;
  const filter = createFilter(region, land);
  filters.set(state, filter);
  return filter;
}

export function getRegionalLandMaskInfo(state) {
  const filter = getRegionalLayerFilter(state);
  return filter && { collection: filter.land, maskSource: "regional-members", maskFeatureCount: filter.land.features.length };
}

export function drawRegionalUrbanLayer(state, surface, applyLandClip, draw, k, options) {
  if (!getScenarioRegion(state.activeScenarioManifest) || !state.showUrban) return draw(k, options);
  const context = surface.getContext();
  context.save();
  try {
    applyLandClip();
    return draw(k, options);
  } finally {
    context.restore();
  }
}
