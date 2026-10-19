import { decodePackedRasterUpdates } from "./packed_geometry.js";

const validToken = value => typeof value === "string" && value.length > 0
  || typeof value === "number" && Number.isFinite(value);
const tokenBytes = value => typeof value === "string" ? value.length * 2 : 8;

function sameStructure(left, right) {
  if (!left || !right) return left === right;
  if (left.type !== right.type) return false;
  if (left.type === "GeometryCollection") return left.geometries.length === right.geometries.length
    && left.geometries.every((part, index) => sameStructure(part, right.geometries[index]));
  if (left.type === "Sphere") return true;
  return left.coordinates[0] === right.coordinates[0] && left.coordinates[1] === right.coordinates[1];
}

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
  return true;
}

function sameGeometry(left, right) {
  return sameStructure(left.geometry, right.geometry)
    && sameBytes(left.lengths, right.lengths) && sameBytes(left.coordinates, right.coordinates);
}

// Water LOD payloads can re-decode identical coordinates under new version IDs.
// Aliases keep strict version checks; only exact packed content for the same
// source may share a record. No secondary index retains retired coordinates.
export function createWaterResidentGeometry(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Water geometry budget must be a nonnegative integer.");
  let namespace = null, aliases = new Map(), bytes = 0, sequence = 0, canonicalReuses = 0, uniqueGeometryRecords = 0;
  function clear() { namespace = null; aliases.clear(); bytes = 0; uniqueGeometryRecords = 0; }
  const getStats = () => ({ uniqueGeometryRecords, geometryAliases: aliases.size, canonicalReuses });
  function check(isCancelled) {
    if (isCancelled()) throw Object.assign(new Error("Water geometry sync cancelled."), { name: "AbortError" });
  }
  function sync({ geometryNamespace, updates, versions = [], requiredIds = [], deletedIds = [], sourceIds = [] },
    { isCancelled = () => false } = {}) {
    check(isCancelled);
    if (!validToken(geometryNamespace)) throw new TypeError("Invalid water geometry namespace.");
    const versionMap = new Map(), sources = new Map();
    for (const [id, version] of versions) {
      if (!validToken(id) || !validToken(version) || versionMap.has(id)) throw new TypeError("Invalid water geometry versions.");
      versionMap.set(id, version);
    }
    for (const [id, sourceId] of sourceIds) {
      if (!validToken(id) || !validToken(sourceId) || sources.has(id) || !versionMap.has(id)) throw new TypeError("Invalid water geometry source IDs.");
      sources.set(id, sourceId);
    }
    const next = geometryNamespace === namespace ? new Map(aliases) : new Map();
    for (const id of deletedIds) next.delete(id);
    // This transaction-local index may borrow old records, but is discarded
    // before returning. Persistent ownership is exclusively through aliases.
    const candidates = new Map();
    function indexRecord(record) {
      let records = candidates.get(record.sourceId);
      if (!records) { records = new Set(); candidates.set(record.sourceId, records); }
      records.add(record);
    }
    for (const alias of next.values()) indexRecord(alias.record);
    let nextSequence = sequence, reused = 0;
    const updated = new Set();
    for (const { id, feature } of decodePackedRasterUpdates(updates)) {
      check(isCancelled);
      if (!validToken(id) || updated.has(id)) throw new TypeError("Invalid water geometry update IDs.");
      updated.add(id);
      if (!feature) { next.delete(id); continue; }
      if (!versionMap.has(id)) throw new TypeError("Water geometry update requires a version.");
      const sourceId = sources.get(id) ?? id, version = versionMap.get(id);
      const previous = next.get(id);
      if (previous && previous.sourceId !== sourceId) throw new TypeError("Water geometry alias source cannot change.");
      let record;
      for (const candidate of candidates.get(sourceId) || []) {
        check(isCancelled);
        if (sameGeometry(candidate.feature, feature)) { record = candidate; reused++; break; }
      }
      if (!record) {
        record = { token: ++nextSequence, sourceId, feature, bytes: feature.weights.decoded };
        indexRecord(record);
      }
      next.delete(id);
      next.set(id, { record, sourceId, version, bytes: 64 + tokenBytes(id) + tokenBytes(sourceId) + tokenBytes(version) });
    }
    const required = new Set(requiredIds);
    for (const id of required) {
      const alias = next.get(id);
      if (!alias || versionMap.has(id) && alias.version !== versionMap.get(id)) throw new Error(`Water resident geometry missing or stale: ${id}`);
      if (sources.has(id) && sources.get(id) !== alias.sourceId) throw new TypeError("Water geometry alias source cannot change.");
      next.delete(id); next.set(id, alias);
    }
    const records = new Map();
    let nextBytes = 0;
    for (const alias of next.values()) {
      nextBytes += alias.bytes;
      if (!records.has(alias.record)) nextBytes += alias.record.bytes;
      records.set(alias.record, (records.get(alias.record) || 0) + 1);
    }
    for (const [id, alias] of next) {
      if (nextBytes <= maxBytes) break;
      if (required.has(id)) continue;
      next.delete(id); nextBytes -= alias.bytes;
      const count = records.get(alias.record) - 1;
      if (count) records.set(alias.record, count);
      else { records.delete(alias.record); nextBytes -= alias.record.bytes; }
    }
    if (nextBytes > maxBytes) throw new RangeError("Water resident geometry exceeds worker budget.");
    check(isCancelled);
    aliases = next; namespace = geometryNamespace; bytes = nextBytes; sequence = nextSequence; canonicalReuses += reused;
    uniqueGeometryRecords = records.size;
    return { resident: [...aliases].map(([id, alias]) => [id, alias.version]), residentGeometryBytes: bytes,
      ...getStats() };
  }
  function getRecord(scene, id, version) {
    const alias = scene === namespace ? aliases.get(id) : null;
    if (!alias || alias.version !== version) throw new Error(`Water resident geometry missing or stale: ${id}`);
    aliases.delete(id); aliases.set(id, alias);
    return alias.record;
  }
  return { sync, getRecord, get: (scene, id, version) => getRecord(scene, id, version).feature,
    getBytes: () => bytes, getStats, clear };
}
