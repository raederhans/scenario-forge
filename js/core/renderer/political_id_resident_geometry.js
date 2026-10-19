import { decodePackedRasterUpdates } from "./packed_geometry.js";

// One scene with an independent binary geometry budget. Required tile sources
// are pinned during admission; inactive sources leave in LRU order. Coordinates
// are never expanded to GeoJSON, and an oversized required set fails atomically.
export function createPoliticalIdResidentGeometry(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Political geometry budget must be a nonnegative integer.");
  let namespace = null, entries = new Map(), bytes = 0;
  function clear() { namespace = null; entries.clear(); bytes = 0; }
  function sync({ geometryNamespace, updates, versions = [], requiredIds = [], deletedIds = [] }) {
    const next = geometryNamespace === namespace ? new Map(entries) : new Map();
    for (const id of deletedIds) next.delete(id);
    const versionMap = new Map(versions);
    for (const { id, feature } of decodePackedRasterUpdates(updates)) {
      next.delete(id);
      if (feature) next.set(id, { feature, version: versionMap.get(id) });
    }
    const required = new Set(requiredIds);
    for (const id of required) {
      if (!next.has(id)) throw new Error(`Political resident geometry missing: ${id}`);
      const entry = next.get(id); next.delete(id); next.set(id, entry);
    }
    let nextBytes = [...next.values()].reduce((sum, entry) => sum + entry.feature.weights.decoded, 0);
    for (const [id, entry] of next) {
      if (nextBytes <= maxBytes) break;
      if (!required.has(id)) { next.delete(id); nextBytes -= entry.feature.weights.decoded; }
    }
    if (nextBytes > maxBytes) throw new RangeError("Political resident geometry exceeds worker budget.");
    entries = next; namespace = geometryNamespace; bytes = nextBytes;
    return { resident: [...entries].map(([id, entry]) => [id, entry.version]), residentGeometryBytes: bytes };
  }
  function get(scene, id, version) {
    const entry = scene === namespace ? entries.get(id) : null;
    if (!entry || entry.version !== version) throw new Error(`Political resident geometry missing or stale: ${id}`);
    entries.delete(id); entries.set(id, entry);
    return entry.feature;
  }
  return { sync, get, clear, getBytes: () => bytes };
}
