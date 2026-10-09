import { getFeatureId } from "../feature_identity.js";

const EMPTY_BOUNDS = null;

function normalizeKey(value) {
  if (value == null) return "";
  return String(value);
}

function normalizeFeatureId(value) {
  return String(value ?? "").trim();
}

function normalizeBounds(value, id) {
  if (value == null) return EMPTY_BOUNDS;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`[political_id_raster_source] Invalid bounds for feature "${id}".`);
  }
  const { minX, minY, maxX, maxY } = value;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX > maxX || minY > maxY) {
    throw new TypeError(`[political_id_raster_source] Invalid bounds for feature "${id}".`);
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function normalizeColor(value, id) {
  let color;
  if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) {
    color = [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
      255,
    ];
  } else if (Array.isArray(value) && value.length === 4
    && value.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)
    && value[3] === 255) {
    color = value;
  } else {
    throw new TypeError(`[political_id_raster_source] Invalid non-opaque color for feature "${id}".`);
  }
  return Object.freeze([color[0], color[1], color[2], 255]);
}

function equalBounds(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.minX === right.minX && left.minY === right.minY
    && left.maxX === right.maxX && left.maxY === right.maxY;
}

function equalColor(left, right) {
  return !!left && !!right && left[0] === right[0] && left[1] === right[1]
    && left[2] === right[2] && left[3] === right[3];
}

function movedIdsByLongestIncreasingSubsequence(previousEntries, nextEntries) {
  const oldPositionById = new Map(previousEntries.map((entry, index) => [entry.id, index]));
  const commonEntries = nextEntries.filter((entry) => oldPositionById.has(entry.id));
  const tails = [];
  const tailEntryIndices = [];
  const predecessor = new Array(commonEntries.length).fill(-1);
  for (let index = 0; index < commonEntries.length; index += 1) {
    const oldPosition = oldPositionById.get(commonEntries[index].id);
    let low = 0, high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < oldPosition) low = middle + 1;
      else high = middle;
    }
    if (low > 0) predecessor[index] = tailEntryIndices[low - 1];
    tails[low] = oldPosition;
    tailEntryIndices[low] = index;
  }
  const keptIds = new Set();
  for (let index = tailEntryIndices[tails.length - 1] ?? -1; index >= 0; index = predecessor[index]) {
    keptIds.add(commonEntries[index].id);
  }
  return new Set(commonEntries.filter((entry) => !keptIds.has(entry.id)).map((entry) => entry.id));
}

function stableSerialize(value) {
  const stack = new Set();
  function normalize(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("View values must be finite JSON values.");
      return item;
    }
    if (Array.isArray(item)) {
      if (stack.has(item)) throw new TypeError("View values must not contain cycles.");
      stack.add(item);
      const result = item.map((child) => child === undefined ? null : normalize(child));
      stack.delete(item);
      return result;
    }
    if (typeof item === "object" && item) {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("View values must use plain objects.");
      }
      if (stack.has(item)) throw new TypeError("View values must not contain cycles.");
      stack.add(item);
      const result = Object.create(null);
      for (const key of Object.keys(item).sort()) {
        const child = item[key];
        if (child !== undefined) result[key] = normalize(child);
      }
      stack.delete(item);
      return result;
    }
    throw new TypeError("View values must be JSON-compatible.");
  }
  return JSON.stringify(normalize(value));
}

function copyBounds(bounds) {
  return bounds ? Object.freeze({ ...bounds }) : null;
}

function makePublicSnapshot(snapshot) {
  if (!snapshot) return null;
  return Object.freeze({
    sceneKey: snapshot.sceneKey,
    projectionKey: snapshot.projectionKey,
    coverageKey: snapshot.coverageKey,
    geometryRevision: snapshot.geometryRevision,
    paletteRevision: snapshot.paletteRevision,
    mappingRevision: snapshot.mappingRevision,
    entries: snapshot.entries,
    palette: snapshot.palette.slice(),
    changedIds: snapshot.changedIds,
    removedIds: snapshot.removedIds,
    dirtyBounds: snapshot.dirtyBounds,
  });
}

function readFeatures(collection) {
  const features = Array.isArray(collection) ? collection : collection?.features;
  if (!Array.isArray(features)) {
    throw new TypeError("[political_id_raster_source] collection.features must be an array.");
  }
  return features;
}

export function createPoliticalIdRasterSource({
  getId = getFeatureId,
  getBounds,
  resolveColor,
} = {}) {
  if (typeof getId !== "function" || typeof getBounds !== "function" || typeof resolveColor !== "function") {
    throw new TypeError("[political_id_raster_source] getId, getBounds, and resolveColor must be functions.");
  }

  let disposed = false;
  let hasPublished = false;
  let currentSnapshot = null;
  let currentEntryById = new Map();
  let idsByCode = new Map();
  let nextCode = 1;
  let geometryRevision = 0;
  let paletteRevision = 0;
  let mappingRevision = 0;
  let colorRevisionKey = null;
  let hasColorRevision = false;
  let nextGeometryVersion = 1;
  let objectGeometryVersions = new WeakMap();
  const primitiveGeometryVersions = new Map();

  function assertOpen() {
    if (disposed) throw new Error("[political_id_raster_source] source is disposed.");
  }

  function geometryVersionOf(geometry) {
    if ((typeof geometry === "object" && geometry !== null) || typeof geometry === "function") {
      let version = objectGeometryVersions.get(geometry);
      if (version === undefined) {
        version = nextGeometryVersion++;
        objectGeometryVersions.set(geometry, version);
      }
      return version;
    }
    if (geometry == null) return 0;
    let version = primitiveGeometryVersions.get(geometry);
    if (version === undefined) {
      version = nextGeometryVersion++;
      primitiveGeometryVersions.set(geometry, version);
    }
    return version;
  }

  function publish({ collection, sceneKey, projectionKey, coverageKey = "", colorRevision = 0 } = {}) {
    assertOpen();
    const features = readFeatures(collection);
    const normalizedSceneKey = normalizeKey(sceneKey);
    const normalizedProjectionKey = normalizeKey(projectionKey);
    const normalizedCoverageKey = normalizeKey(coverageKey);
    const revisionKey = stableSerialize(colorRevision);
    const candidates = [];
    const ids = new Set();

    // Validate the complete incoming collection before changing any private state.
    for (let drawOrder = 0; drawOrder < features.length; drawOrder += 1) {
      const feature = features[drawOrder];
      if (!feature || typeof feature !== "object") {
        throw new TypeError(`[political_id_raster_source] Invalid feature at draw order ${drawOrder}.`);
      }
      const id = normalizeFeatureId(getId(feature));
      if (!id) throw new TypeError(`[political_id_raster_source] Missing feature ID at draw order ${drawOrder}.`);
      if (ids.has(id)) throw new TypeError(`[political_id_raster_source] Duplicate feature ID "${id}".`);
      ids.add(id);
      const geometry = feature.geometry;
      const bounds = normalizeBounds(getBounds(feature, id), id);
      const color = normalizeColor(resolveColor(feature, id), id);
      candidates.push({ id, feature, geometry, bounds, color, drawOrder });
    }

    const oldEntries = currentSnapshot?.entries || [];
    const oldById = currentEntryById;
    const sceneChanged = !hasPublished || normalizedSceneKey !== currentSnapshot.sceneKey;
    const projectionChanged = !hasPublished || normalizedProjectionKey !== currentSnapshot.projectionKey;
    const coverageChanged = !hasPublished || normalizedCoverageKey !== currentSnapshot.coverageKey;
    const nextIdsByCode = sceneChanged ? new Map() : new Map(idsByCode);
    let candidateNextCode = sceneChanged ? 1 : nextCode;
    let mappingChanged = sceneChanged;
    for (const candidate of candidates) {
      if (nextIdsByCode.has(candidate.id)) continue;
      if (!Number.isSafeInteger(candidateNextCode) || candidateNextCode > 0x3fffffff) {
        throw new RangeError("[political_id_raster_source] Feature code space exhausted.");
      }
      nextIdsByCode.set(candidate.id, candidateNextCode++);
      mappingChanged = true;
    }

    const nextEntries = candidates.map((candidate) => Object.freeze({
      id: candidate.id,
      code: nextIdsByCode.get(candidate.id),
      feature: candidate.feature,
      bounds: candidate.bounds,
      drawOrder: candidate.drawOrder,
      geometryVersion: geometryVersionOf(candidate.geometry),
    }));
    const nextById = new Map(nextEntries.map((entry) => [entry.id, entry]));
    const globallyChanged = sceneChanged || projectionChanged || coverageChanged;
    const movedIds = globallyChanged ? new Set() : movedIdsByLongestIncreasingSubsequence(oldEntries, nextEntries);
    const changedIds = [];
    const dirtyBounds = [];
    for (const entry of nextEntries) {
      const previous = oldById.get(entry.id) || null;
      const changed = globallyChanged || !previous
        || previous.geometryVersion !== entry.geometryVersion
        || movedIds.has(entry.id)
        || !equalBounds(previous.bounds, entry.bounds);
      if (!changed) continue;
      changedIds.push(entry.id);
      dirtyBounds.push({ id: entry.id, oldBounds: previous?.bounds || null, newBounds: entry.bounds,
        previousCoverageUnknown: !!previous && previous.bounds === null });
    }
    const removedIds = [];
    for (const previous of oldEntries) {
      if (nextById.has(previous.id)) continue;
      removedIds.push(previous.id);
      dirtyBounds.push({ id: previous.id, oldBounds: previous.bounds, newBounds: null,
        previousCoverageUnknown: previous.bounds === null });
    }
    const geometryChanged = !hasPublished || globallyChanged || changedIds.length > 0 || removedIds.length > 0;

    const paletteLength = candidateNextCode * 4;
    const nextPalette = new Uint8Array(paletteLength);
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const offset = nextIdsByCode.get(candidate.id) * 4;
      nextPalette.set(candidate.color, offset);
    }
    const paletteBytesChanged = !currentSnapshot
      || currentSnapshot.palette.length !== nextPalette.length
      || currentSnapshot.palette.some((value, index) => value !== nextPalette[index]);
    const colorRevisionChanged = !hasColorRevision || revisionKey !== colorRevisionKey;

    if (geometryChanged) geometryRevision += 1;
    if (paletteBytesChanged || colorRevisionChanged) paletteRevision += 1;
    if (mappingChanged) mappingRevision += 1;

    currentSnapshot = {
      sceneKey: normalizedSceneKey,
      projectionKey: normalizedProjectionKey,
      coverageKey: normalizedCoverageKey,
      geometryRevision,
      paletteRevision,
      mappingRevision,
      entries: Object.freeze(nextEntries),
      palette: nextPalette,
      changedIds: Object.freeze(changedIds),
      removedIds: Object.freeze(removedIds),
      dirtyBounds: Object.freeze(dirtyBounds.map((item) => Object.freeze({
        id: item.id,
        oldBounds: copyBounds(item.oldBounds),
        newBounds: copyBounds(item.newBounds),
        previousCoverageUnknown: item.previousCoverageUnknown,
      }))),
    };
    currentEntryById = nextById;
    idsByCode = nextIdsByCode;
    nextCode = candidateNextCode;
    colorRevisionKey = revisionKey;
    hasColorRevision = true;
    hasPublished = true;
    return getSnapshot();
  }

  function updateColors(featureIds = null, options = {}) {
    assertOpen();
    if (!currentSnapshot) throw new Error("[political_id_raster_source] publish must succeed before updateColors.");
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("[political_id_raster_source] color options must be an object.");
    }
    let selectedIds;
    if (featureIds === null) {
      selectedIds = currentSnapshot.entries.map((entry) => entry.id);
    } else {
      if (!Array.isArray(featureIds)) throw new TypeError("[political_id_raster_source] featureIds must be an array or null.");
      selectedIds = [...new Set(featureIds.map((id) => {
        const normalized = normalizeFeatureId(id);
        if (!normalized) throw new TypeError("[political_id_raster_source] featureIds must not contain empty IDs.");
        return normalized;
      }))];
    }

    const resolved = [];
    for (const id of selectedIds) {
      const entry = currentEntryById.get(id);
      if (!entry) continue;
      resolved.push({ entry, color: normalizeColor(resolveColor(entry.feature, id), id) });
    }
    const nextPalette = currentSnapshot.palette.slice();
    let bytesChanged = false;
    for (const { entry, color } of resolved) {
      const offset = entry.code * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (nextPalette[offset + channel] !== color[channel]) bytesChanged = true;
      }
      nextPalette.set(color, offset);
    }
    const hasRevisionArgument = Object.prototype.hasOwnProperty.call(options, "colorRevision");
    const { colorRevision } = options;
    const nextRevisionKey = hasRevisionArgument ? stableSerialize(colorRevision) : colorRevisionKey;
    const revisionChanged = hasRevisionArgument && (!hasColorRevision || nextRevisionKey !== colorRevisionKey);
    if (bytesChanged || revisionChanged) paletteRevision += 1;
    if (hasRevisionArgument) {
      colorRevisionKey = nextRevisionKey;
      hasColorRevision = true;
    }
    currentSnapshot = {
      ...currentSnapshot,
      paletteRevision,
      palette: nextPalette,
    };
    return getSnapshot();
  }

  function getSnapshot() {
    return makePublicSnapshot(currentSnapshot);
  }

  function captureFrame(view) {
    assertOpen();
    if (!currentSnapshot) return null;
    return Object.freeze({
      sceneKey: currentSnapshot.sceneKey,
      projectionKey: currentSnapshot.projectionKey,
      coverageKey: currentSnapshot.coverageKey,
      geometryRevision: currentSnapshot.geometryRevision,
      paletteRevision: currentSnapshot.paletteRevision,
      mappingRevision: currentSnapshot.mappingRevision,
      viewKey: stableSerialize(view),
    });
  }

  function isFrameCurrent(frame, view) {
    if (disposed || !currentSnapshot || !frame || typeof frame !== "object") return false;
    let viewKey;
    try {
      viewKey = stableSerialize(view);
    } catch (_error) {
      return false;
    }
    return frame.sceneKey === currentSnapshot.sceneKey
      && frame.projectionKey === currentSnapshot.projectionKey
      && frame.coverageKey === currentSnapshot.coverageKey
      && frame.geometryRevision === currentSnapshot.geometryRevision
      && frame.paletteRevision === currentSnapshot.paletteRevision
      && frame.mappingRevision === currentSnapshot.mappingRevision
      && frame.viewKey === viewKey;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    currentSnapshot = null;
    currentEntryById = new Map();
    idsByCode = new Map();
    nextCode = 1;
    objectGeometryVersions = new WeakMap();
    primitiveGeometryVersions.clear();
  }

  return Object.freeze({ publish, updateColors, getSnapshot, captureFrame, isFrameCurrent, dispose });
}
