import { getGeometryRetentionWeights } from "../core/renderer/geometry_cache_budget.js";

const estimates = new WeakMap();

// Admission estimates for the shipped road packs, including transient decode
// work. Japan's full topology alone is about 80 MiB; the scheduler's generic
// 8 MiB fallback is unsuitable. These are weights, not measured heap limits.
export const ROAD_PACK_LOAD_BYTES = Object.freeze({ preview: 24 * 1024 * 1024, full: 192 * 1024 * 1024 });

// A deterministic retention weight, not browser heap measurement. Count the
// owned road records, native/projected coordinate arrays, path strings, segment
// records and lookup slots. DOM, renderer canvases and shared catalog/manifest
// metadata belong to other owners and are explicitly outside this estimate.
export function estimateRoadPackRetentionBytes(pack) {
  if (!pack || !Array.isArray(pack.roadFeatures) || !Array.isArray(pack.labelFeatures)) return null;
  if (estimates.has(pack)) return estimates.get(pack);
  const geometries = new Set();
  let bytes = 256 + (pack.roadFeatures.length + pack.labelFeatures.length) * 40;
  for (const feature of pack.roadFeatures) {
    bytes += 256;
    for (const value of Object.values(feature)) if (typeof value === "string") bytes += value.length * 2;
    for (const geometry of [feature.geometry, feature.projectedGeometry]) {
      if (geometry && !geometries.has(geometry)) {
        geometries.add(geometry);
        bytes += getGeometryRetentionWeights(geometry).decoded;
      }
    }
    for (const line of feature.projectedLines || []) {
      // line.points and segment endpoint arrays borrow projectedGeometry.
      // Counting those arrays again would double charge the same coordinates.
      bytes += 96 + String(line.pathD || "").length * 2 + (line.segments?.length || 0) * 96;
    }
    bytes += (feature.sourceFlags?.length || 0) * 16;
  }
  for (const label of pack.labelFeatures) {
    bytes += 128;
    for (const value of Object.values(label)) if (typeof value === "string") bytes += value.length * 2;
  }
  const result = Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
  estimates.set(pack, result);
  return result;
}
