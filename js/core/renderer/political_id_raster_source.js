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

function* movedIdsByLongestIncreasingSubsequence(previousEntries, nextEntries) {
  const oldPositionById = new Map(), commonEntries = [];
  for (let index = 0; index < previousEntries.length; index++) {
    oldPositionById.set(previousEntries[index].id, index); yield "lis-index";
  }
  for (const entry of nextEntries) {
    if (oldPositionById.has(entry.id)) commonEntries.push(entry);
    yield "lis-common";
  }
  const tails = [];
  const tailEntryIndices = [];
  const predecessor = [];
  for (let index = 0; index < commonEntries.length; index += 1) {
    const oldPosition = oldPositionById.get(commonEntries[index].id);
    let low = 0, high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < oldPosition) low = middle + 1;
      else high = middle;
    }
    predecessor[index] = low > 0 ? tailEntryIndices[low - 1] : -1;
    tails[low] = oldPosition;
    tailEntryIndices[low] = index;
    yield "lis-scan";
  }
  const keptIds = new Set();
  for (let index = tailEntryIndices[tails.length - 1] ?? -1; index >= 0; index = predecessor[index]) {
    keptIds.add(commonEntries[index].id);
    yield "lis-kept";
  }
  const moved = new Set();
  for (const entry of commonEntries) {
    if (!keptIds.has(entry.id)) moved.add(entry.id);
    yield "lis-moved";
  }
  return moved;
}

const abortPreparation = () => new DOMException("Stale political raster source preparation", "AbortError");
function drainSteps(iterator) {
  let step;
  do { step = iterator.next(); } while (!step.done);
  return step.value;
}
async function runSteps(iterator, { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)),
  nowMs = () => globalThis.performance?.now() ?? Date.now(), timeBudgetMs = 4, workBatch = 256,
} = {}, isCurrent = () => true) {
  const batch = Math.max(1, Math.floor(Number(workBatch) || 1));
  const budget = Math.max(0, Number(timeBudgetMs) || 0);
  const check = () => { if (signal?.aborted || !isCurrent()) throw abortPreparation(); };
  let startedAt = nowMs(), work = 0;
  try {
    while (true) {
      check();
      const step = iterator.next();
      check();
      if (step.done) return step.value;
      if (++work >= batch || nowMs() - startedAt >= budget) {
        await yieldControl({ phase: step.value });
        check(); work = 0; startedAt = nowMs();
      }
    }
  } finally { iterator.return(); }
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

function makePublicSnapshot(snapshot, palette = snapshot?.palette.slice()) {
  if (!snapshot) return null;
  return Object.freeze({
    sceneKey: snapshot.sceneKey,
    projectionKey: snapshot.projectionKey,
    coverageKey: snapshot.coverageKey,
    geometryRevision: snapshot.geometryRevision,
    paletteRevision: snapshot.paletteRevision,
    mappingRevision: snapshot.mappingRevision,
    entries: snapshot.entries,
    palette,
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

  let publicationEpoch = 0;
  let preparedCandidates = new WeakMap();
  const knownCandidates = new WeakSet();

  function* prepareSteps({ collection, sceneKey, projectionKey, coverageKey = "", colorRevision = 0 } = {}, boundsForFeature = getBounds) {
    assertOpen();
    if (typeof boundsForFeature !== "function") throw new TypeError("[political_id_raster_source] getBounds must be a function.");
    const baselineEpoch = publicationEpoch;
    const baseline = currentSnapshot;
    const oldById = currentEntryById;
    const features = readFeatures(collection);
    const normalizedSceneKey = normalizeKey(sceneKey);
    const normalizedProjectionKey = normalizeKey(projectionKey);
    const normalizedCoverageKey = normalizeKey(coverageKey);
    const revisionKey = stableSerialize(colorRevision);
    const candidates = [], ids = new Set();
    for (let drawOrder = 0; drawOrder < features.length; drawOrder++) {
      const feature = features[drawOrder];
      if (!feature || typeof feature !== "object") {
        throw new TypeError(`[political_id_raster_source] Invalid feature at draw order ${drawOrder}.`);
      }
      const id = normalizeFeatureId(getId(feature));
      if (!id) throw new TypeError(`[political_id_raster_source] Missing feature ID at draw order ${drawOrder}.`);
      if (ids.has(id)) throw new TypeError(`[political_id_raster_source] Duplicate feature ID "${id}".`);
      ids.add(id);
      const geometry = feature.geometry;
      const bounds = normalizeBounds(boundsForFeature(feature, id), id);
      const color = normalizeColor(resolveColor(feature, id), id);
      candidates.push({ id, feature, geometry, bounds, color, drawOrder });
      yield "validation";
    }

    const oldEntries = baseline?.entries || [];
    const sceneChanged = !hasPublished || normalizedSceneKey !== baseline.sceneKey;
    const projectionChanged = !hasPublished || normalizedProjectionKey !== baseline.projectionKey;
    const coverageChanged = !hasPublished || normalizedCoverageKey !== baseline.coverageKey;
    const nextIdsByCode = new Map();
    if (!sceneChanged) for (const [id, code] of idsByCode) {
      nextIdsByCode.set(id, code); yield "mapping-copy";
    }
    let candidateNextCode = sceneChanged ? 1 : nextCode;
    let mappingChanged = sceneChanged;
    for (const candidate of candidates) {
      if (!nextIdsByCode.has(candidate.id)) {
        if (!Number.isSafeInteger(candidateNextCode) || candidateNextCode > 0x3fffffff) {
          throw new RangeError("[political_id_raster_source] Feature code space exhausted.");
        }
        nextIdsByCode.set(candidate.id, candidateNextCode++);
        mappingChanged = true;
      }
      yield "mapping";
    }

    // Version allocation is private until commit. Failed/cancelled preparations
    // cannot consume IDs or leave an unbounded chain of weak-cache overlays.
    const newObjectVersions = new WeakMap(), newPrimitiveVersions = new Map(), versionAssignments = [];
    let candidateNextGeometryVersion = nextGeometryVersion;
    const geometryVersionOf = geometry => {
      const object = (typeof geometry === "object" && geometry !== null) || typeof geometry === "function";
      if (!object && geometry == null) return 0;
      const existing = object ? objectGeometryVersions : primitiveGeometryVersions;
      const pending = object ? newObjectVersions : newPrimitiveVersions;
      let version = existing.get(geometry) ?? pending.get(geometry);
      if (version === undefined) {
        version = candidateNextGeometryVersion++;
        pending.set(geometry, version); versionAssignments.push([geometry, version, object]);
      }
      return version;
    };
    const nextEntries = [], nextById = new Map();
    for (const candidate of candidates) {
      const entry = Object.freeze({ id: candidate.id, code: nextIdsByCode.get(candidate.id),
        feature: candidate.feature, bounds: candidate.bounds, drawOrder: candidate.drawOrder,
        geometryVersion: geometryVersionOf(candidate.geometry) });
      nextEntries.push(entry); nextById.set(entry.id, entry); yield "entries";
    }
    const globallyChanged = sceneChanged || projectionChanged || coverageChanged;
    const movedIds = globallyChanged ? new Set() : yield* movedIdsByLongestIncreasingSubsequence(oldEntries, nextEntries);
    const changedIds = [], dirtyBounds = [];
    for (const entry of nextEntries) {
      const previous = oldById.get(entry.id) || null;
      const changed = globallyChanged || !previous || previous.geometryVersion !== entry.geometryVersion
        || movedIds.has(entry.id) || !equalBounds(previous.bounds, entry.bounds);
      if (changed) {
        changedIds.push(entry.id);
        dirtyBounds.push({ id: entry.id, oldBounds: previous?.bounds || null, newBounds: entry.bounds,
          previousCoverageUnknown: !!previous && previous.bounds === null });
      }
      yield "dirty-bounds";
    }
    const removedIds = [];
    for (const previous of oldEntries) {
      if (!nextById.has(previous.id)) {
        removedIds.push(previous.id);
        dirtyBounds.push({ id: previous.id, oldBounds: previous.bounds, newBounds: null,
          previousCoverageUnknown: previous.bounds === null });
      }
      yield "removed";
    }
    const geometryChanged = !hasPublished || globallyChanged || changedIds.length > 0 || removedIds.length > 0;
    const nextPalette = new Uint8Array(candidateNextCode * 4);
    for (const candidate of candidates) {
      nextPalette.set(candidate.color, nextIdsByCode.get(candidate.id) * 4); yield "palette";
    }
    let paletteBytesChanged = !baseline || baseline.palette.length !== nextPalette.length;
    if (!paletteBytesChanged) for (let offset = 0; offset < nextPalette.length; offset++) {
      if (baseline.palette[offset] !== nextPalette[offset]) { paletteBytesChanged = true; break; }
      yield "palette-compare";
    }
    const colorRevisionChanged = !hasColorRevision || revisionKey !== colorRevisionKey;
    const frozenDirtyBounds = [];
    for (const item of dirtyBounds) {
      frozenDirtyBounds.push(Object.freeze({ id: item.id, oldBounds: copyBounds(item.oldBounds),
        newBounds: copyBounds(item.newBounds), previousCoverageUnknown: item.previousCoverageUnknown }));
      yield "dirty-freeze";
    }
    const snapshot = {
      sceneKey: normalizedSceneKey, projectionKey: normalizedProjectionKey, coverageKey: normalizedCoverageKey,
      geometryRevision: geometryRevision + (geometryChanged ? 1 : 0),
      paletteRevision: paletteRevision + (paletteBytesChanged || colorRevisionChanged ? 1 : 0),
      mappingRevision: mappingRevision + (mappingChanged ? 1 : 0),
      entries: Object.freeze(nextEntries), palette: nextPalette,
      changedIds: Object.freeze(changedIds), removedIds: Object.freeze(removedIds),
      dirtyBounds: Object.freeze(frozenDirtyBounds),
    };
    const publicPalette = new Uint8Array(nextPalette.length);
    for (let offset = 0; offset < nextPalette.length; offset += 4096) {
      publicPalette.set(nextPalette.subarray(offset, offset + 4096), offset); yield "public-palette";
    }
    return { baselineEpoch, snapshot, publicSnapshot: makePublicSnapshot(snapshot, publicPalette),
      nextById, nextIdsByCode, candidateNextCode, candidateNextGeometryVersion, versionAssignments, revisionKey };
  }

  function rememberCandidate(prepared, signal) {
    if (disposed || signal?.aborted || prepared.baselineEpoch !== publicationEpoch) throw abortPreparation();
    const candidate = Object.freeze({});
    knownCandidates.add(candidate); preparedCandidates.set(candidate, { ...prepared, signal });
    return candidate;
  }

  async function prepare(input, options = {}) {
    assertOpen();
    const expectedEpoch = publicationEpoch;
    const prepared = await runSteps(prepareSteps(input, options.getBounds ?? getBounds), options,
      () => !disposed && publicationEpoch === expectedEpoch);
    return rememberCandidate(prepared, options.signal);
  }

  function commitPrepared(candidate) {
    if (!candidate || !knownCandidates.has(candidate)) throw new TypeError("[political_id_raster_source] Unknown prepared candidate.");
    const prepared = preparedCandidates.get(candidate);
    if (!prepared || disposed || prepared.signal?.aborted || prepared.baselineEpoch !== publicationEpoch) {
      preparedCandidates.delete(candidate); throw abortPreparation();
    }
    // Only weak-cache registrations remain here. No feature validation, bounds,
    // colors, sorting, palette copy or dirty-bound construction occurs at commit.
    const assignments = prepared.versionAssignments;
    for (let index = 0; index < assignments.length; index++) {
      const assignment = assignments[index];
      (assignment[2] ? objectGeometryVersions : primitiveGeometryVersions).set(assignment[0], assignment[1]);
    }
    nextGeometryVersion = prepared.candidateNextGeometryVersion;
    currentSnapshot = prepared.snapshot;
    currentEntryById = prepared.nextById; idsByCode = prepared.nextIdsByCode;
    nextCode = prepared.candidateNextCode; colorRevisionKey = prepared.revisionKey;
    geometryRevision = currentSnapshot.geometryRevision; paletteRevision = currentSnapshot.paletteRevision;
    mappingRevision = currentSnapshot.mappingRevision; hasColorRevision = hasPublished = true;
    publicationEpoch++; preparedCandidates = new WeakMap();
    return prepared.publicSnapshot;
  }

  function publish(input) {
    assertOpen();
    return commitPrepared(rememberCandidate(drainSteps(prepareSteps(input))));
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
    publicationEpoch++; preparedCandidates = new WeakMap();
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
    publicationEpoch++; preparedCandidates = new WeakMap();
    currentSnapshot = null;
    currentEntryById = new Map();
    idsByCode = new Map();
    nextCode = 1;
    objectGeometryVersions = new WeakMap();
    primitiveGeometryVersions.clear();
  }

  return Object.freeze({ publish, prepare, commitPrepared, updateColors, getSnapshot, captureFrame, isFrameCurrent, dispose });
}

// Full/fine views can wrap equal geometry, or deliberately prune tiny visual
// fragments from the interactive geometry while native background retains them.
// Compare immutable contents once per object pair; never turn arbitrary shape
// conflicts into a successful complete-display claim.
const displayGeometryEquivalence = new WeakMap();
function compareDisplayGeometry(left, right) {
  if (left === right) return "equal";
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || left.type !== right.type) return "different";
  let compared = displayGeometryEquivalence.get(left);
  if (!compared) { compared = new WeakMap(); displayGeometryEquivalence.set(left, compared); }
  if (compared.has(right)) return compared.get(right);
  let result = JSON.stringify(left) === JSON.stringify(right) ? "equal" : "different";
  if (result !== "equal" && left.type === "MultiPolygon" && Array.isArray(left.coordinates) && Array.isArray(right.coordinates)
    && left.coordinates.length > 0 && left.coordinates.length < right.coordinates.length) {
    const fullComponents = new Set(right.coordinates.map(component => JSON.stringify(component)));
    const fineComponents = left.coordinates.map(component => JSON.stringify(component));
    if (new Set(fineComponents).size === fineComponents.length && fineComponents.every(component => fullComponents.has(component))) result = "pruned-subset";
  }
  compared.set(right, result);
  return result;
}
const completeDisplayWrappers = new WeakMap();
function completeDisplayFeature(fine, full, id) {
  const comparison = compareDisplayGeometry(fine.geometry, full.geometry);
  if (comparison === "equal") return fine;
  const pruned = full.geometry?.coordinates?.length - fine.geometry?.coordinates?.length;
  if (comparison !== "pruned-subset" || fine.properties?.__visualFragmentCamouflage !== true
    || fine.properties?.__visualFragmentPrunedCount !== pruned) {
    throw new TypeError(`Conflicting display geometry for feature "${id}".`);
  }
  let byFine = completeDisplayWrappers.get(full.geometry);
  if (!byFine) { byFine = new WeakMap(); completeDisplayWrappers.set(full.geometry, byFine); }
  let wrapped = byFine.get(fine);
  if (!wrapped || wrapped.properties !== fine.properties) {
    wrapped = { ...fine, geometry: full.geometry };
    byFine.set(fine, wrapped);
  }
  return wrapped;
}

/** Complete display coverage, with original canonical IDs and no editing authority.
 * Known fragment pruning retains the full native background footprint. Precise
 * picking still consumes the original interactive collection, never these wrappers.
 * The caller applies the existing visual exclusion and painter-order policies.
 */
function* collectPoliticalRasterDisplayFeaturesSteps({ fullCollection, interactiveCollection, getId = getFeatureId }) {
  const fine = readFeatures(interactiveCollection);
  const full = fullCollection ? readFeatures(fullCollection) : fine;
  const fineById = new Map(), seen = new Set(), completeById = new Map();
  const identify = feature => {
    const id = normalizeFeatureId(getId(feature));
    if (!id) throw new TypeError("Complete raster coverage requires stable feature IDs.");
    return id;
  };
  for (const feature of fine) {
    const id = identify(feature);
    if (fineById.has(id)) throw new TypeError(`Duplicate interactive feature ID "${id}".`);
    fineById.set(id, feature);
    yield "display-interactive";
  }
  const support = [];
  for (const feature of full) {
    const id = identify(feature);
    if (seen.has(id)) throw new TypeError(`Duplicate full feature ID "${id}".`);
    seen.add(id);
    const interactive = fineById.get(id);
    if (interactive) completeById.set(id, completeDisplayFeature(interactive, feature, id));
    else support.push(feature);
    yield "display-full";
  }
  for (const feature of fine) {
    support.push(completeById.get(identify(feature)) || feature); yield "display-result";
  }
  return support;
}

export function collectPoliticalRasterDisplayFeatures(input) {
  return drainSteps(collectPoliticalRasterDisplayFeaturesSteps(input));
}

export function collectPoliticalRasterDisplayFeaturesAsync(input, options = {}) {
  return runSteps(collectPoliticalRasterDisplayFeaturesSteps(input), options);
}
