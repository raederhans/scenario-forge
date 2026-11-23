import { getScenarioRegion, hidesRegionalBackdrop, isRegionalScenario } from "../scenario/scenario_region.js";
import { getContextTopologyObjectStamp, getStartupContextCollection } from "../state/context_layer_revision.js";
import { getDefaultBorderWorkerSources } from "./border_mesh_queries.js";
import { createContourPolygonQuery, packContourPolygons } from "./paint_contour_water_mask.js";
import { isLakeRegion } from "./effective_water_regions.js";

const primaryLandCache = new WeakMap();
export const OCEAN_MASK_MODE_SPHERE_MINUS_LAND = "sphere_minus_land";

export function getOceanMaskMode(state, defaultMode) {
  return isRegionalScenario(state.activeScenarioManifest) ? OCEAN_MASK_MODE_SPHERE_MINUS_LAND : defaultMode;
}

export function clipOceanOutsideLand(surface, sphere, land, exclusionPath) {
  const context = surface.getContext();
  if (exclusionPath) {
    context.clip(exclusionPath, "evenodd");
  } else {
    surface.getPathCanvas()(sphere);
    surface.getPathCanvas()(land);
    try {
      context.clip("evenodd");
    } catch (error) {
      context.clip();
    }
  }
}

export function usesRegionalMarineMask(state, feature) {
  return isRegionalScenario(state.activeScenarioManifest) && !isLakeRegion(feature);
}

export function isRegionalMarineHitOnLand(state, feature, lonLat) {
  if (!usesRegionalMarineMask(state, feature)) return false;
  const { collection } = getRegionalOceanLandMask(state);
  return !!collection && globalThis.d3.geoContains(collection, lonLat);
}

export function getRegionalOceanLandMask(state, topojson = globalThis.topojson) {
  if (!isRegionalScenario(state.activeScenarioManifest)) return null;
  const topology = state.topologyPrimary || state.topology;
  const land = topology?.objects?.land;
  let collection = null;
  if (land && topojson) {
    const decode = topojson.feature;
    const stamp = getContextTopologyObjectStamp(state, topology, land, decode);
    const cached = primaryLandCache.get(topology);
    if (cached?.land === land && stamp.every((value, index) => value === cached.stamp[index])) {
      collection = cached.collection;
    } else {
      collection = getStartupContextCollection(state, topology, land, stamp) || decode(topology, land);
      primaryLandCache.set(topology, { land, stamp, collection });
    }
  }
  return { collection, maskSource: "primary-land",
    maskFeatureCount: collection?.features?.length || 0 };
}

export function getRegionalBackdrop(state, topojson = globalThis.topojson) {
  const region = getScenarioRegion(state.activeScenarioManifest);
  if (!region || region.backdrop === "none") return null;
  return { ...getRegionalOceanLandMask(state, topojson), fill: region.backdrop_fill || "#b9b7b2" };
}

export function getRegionalBackgroundColor(manifest, oceanColor) {
  const region = getScenarioRegion(manifest);
  return region?.backdrop === "none" ? region.backdrop_fill || oceanColor : oceanColor;
}

export function drawRegionalLandEffect(state, surface, clipLand, draw) {
  if (!hidesRegionalBackdrop(state.activeScenarioManifest)) return draw();
  const context = surface.getContext();
  context.save();
  try {
    if (clipLand()) return draw();
  } finally {
    context.restore();
  }
}

export function clipRegionalLakeOutline(state, surface, clipLand, path, parts) {
  if (!hidesRegionalBackdrop(state.activeScenarioManifest)) return;
  clipLand();
  if (!path) {
    surface.getContext().beginPath();
    const trace = surface.getPathCanvas();
    for (const part of parts) trace(part);
  }
}

export function selectPoliticalBorderTopology(state, globalTopology) {
  return isRegionalScenario(state.activeScenarioManifest) ? state.scenarioRuntimeTopologyData : globalTopology;
}

export function getPoliticalBorderSources(state) {
  return isRegionalScenario(state.activeScenarioManifest)
    ? [{ key: "detail", topology: state.scenarioRuntimeTopologyData }]
    : getDefaultBorderWorkerSources(state);
}

export function getRegionalCoastlineDecision(state) {
  if (!isRegionalScenario(state.activeScenarioManifest)) return null;
  const primary = state.topologyPrimary || state.topology;
  const reason = hidesRegionalBackdrop(state.activeScenarioManifest) ? "regional-member-coast" : "regional-primary-land";
  return { source: "primary", reason, primaryObjectName: "land",
    scenarioId: state.activeScenarioId, topology: primary?.objects?.land ? primary : null };
}

const unwrapNear = (lon, reference) => lon + 360 * Math.round((reference - lon) / 360);

// Primary land and member politics can have different vertices and arc numbering.
// Split member edges at physical shores before classifying their open intervals.
function visitEdgeCells(x, y, nx, ny, visit) {
  for (let row = Math.floor(Math.min(y, ny)); row <= Math.floor(Math.max(y, ny)); row++) {
    for (let col = Math.floor(Math.min(x, nx)); col <= Math.floor(Math.max(x, nx)); col++) {
      visit(row * 360 + (col % 360 + 360) % 360);
    }
  }
}

function indexShoreEdges({ coordinates, ringOffsets }) {
  const cells = new Map();
  for (let r = 1; r < ringOffsets.length; r++) {
    for (let i = ringOffsets[r - 1] * 2; i < (ringOffsets[r] - 1) * 2; i += 2) {
      visitEdgeCells(coordinates[i], coordinates[i + 1], coordinates[i + 2], coordinates[i + 3], key => {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      });
    }
  }
  return cells;
}

function shoreCrossings(a, dx, dy, cells, coords) {
  const cuts = [0, 1];
  visitEdgeCells(a[0], a[1], a[0] + dx, a[1] + dy, key => {
    for (const i of cells.get(key) || []) {
      const y = coords[i + 1];
      const sx = coords[i + 2] - coords[i], sy = coords[i + 3] - y;
      const x = unwrapNear(coords[i], a[0] + (dx - sx) / 2);
      const cross = dx * sy - dy * sx;
      if (!cross) continue;
      const t = ((x - a[0]) * sy - (y - a[1]) * sx) / cross;
      const u = ((x - a[0]) * dy - (y - a[1]) * dx) / cross;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
  });
  return cuts.sort((left, right) => left - right);
}

export function buildRegionalMemberCoastline(state) {
  const topology = state.scenarioRuntimeTopologyData;
  const political = topology?.objects?.political;
  const land = getRegionalOceanLandMask(state)?.collection;
  if (!political || !land) return null;
  const packed = packContourPolygons(land);
  if (packed.polygonOffsets.length === 1) return null;
  const onLand = createContourPolygonQuery(packed);
  const cells = indexShoreEdges(packed);
  const boundary = globalThis.topojson.mesh(topology, political, (left, right) => left === right);
  const coordinates = [];
  for (const line of boundary.coordinates) {
    let run = null;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const dx = unwrapNear(b[0], a[0]) - a[0], dy = b[1] - a[1];
      if (!dx && !dy) continue;
      const cuts = shoreCrossings(a, dx, dy, cells, packed.coordinates);
      const pointAt = t => t === 0 ? a : t === 1 ? b : [unwrapNear(a[0] + t * dx, 0), a[1] + t * dy];
      // Both sides are land at a cut border. Probe on either side so an edge
      // coincident with the primary shoreline is independent of ring winding.
      const offset = 1e-9 / Math.hypot(dx, dy);
      for (let j = 1; j < cuts.length; j++) {
        const from = cuts[j - 1], to = cuts[j];
        if (from === to) continue;
        const [x, y] = pointAt((from + to) / 2);
        if (onLand(x + dy * offset, y - dx * offset) && onLand(x - dy * offset, y + dx * offset)) {
          run = null;
        } else {
          if (!run) {
            run = [pointAt(from)];
            coordinates.push(run);
          }
          run.push(pointAt(to));
        }
      }
    }
  }
  return { type: "MultiLineString", coordinates };
}
