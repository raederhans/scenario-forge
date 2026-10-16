const EDGE_FLAG = 0x80000000;
const MAX_CODE = 0x7fffffff;
const MIN_PICK_DENSITY = 1;
const MAX_GUARD_PIXELS = 4;
const MAX_CANDIDATE_COUNT = 64;
const MAX_TILE_COUNT = 128;

function result(kind, ids = [], reason = null, primaryId = null) {
  const value = { kind, ids, primaryId };
  if (reason) value.reason = reason;
  return value;
}

function isSafePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidTile(tile, descriptor) {
  if (!tile || typeof tile !== "object"
    || !isSafePositiveInteger(tile.width) || !isSafePositiveInteger(tile.height)
    || !Number.isSafeInteger(tile.originX) || !Number.isSafeInteger(tile.originY)
    || !Number.isSafeInteger(tile.originX + tile.width) || !Number.isSafeInteger(tile.originY + tile.height)
    || !Number.isSafeInteger(tile.width * tile.height)
    || !(tile.codes instanceof Uint32Array) || tile.codes.length !== tile.width * tile.height
    || !(tile.edgeIds instanceof Uint32Array)
    || !(tile.edgeWeights instanceof Float32Array)
    || tile.edgeIds.length !== tile.edgeWeights.length) return false;

  if (descriptor != null) {
    if (typeof descriptor !== "object"
      || descriptor.originX !== tile.originX || descriptor.originY !== tile.originY
      || descriptor.width !== tile.width || descriptor.height !== tile.height
      || (descriptor.density != null && (!Number.isFinite(descriptor.density) || descriptor.density <= 0))) {
      return false;
    }
  }
  return true;
}

function mapCodeToId(codeToId, code) {
  let value;
  if (typeof codeToId === "function") {
    value = codeToId(code);
  } else if (codeToId instanceof Map) {
    value = codeToId.get(code);
  } else if (codeToId && typeof codeToId === "object"
    && Object.prototype.hasOwnProperty.call(codeToId, code)) {
    value = codeToId[code];
  } else {
    return null;
  }

  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).trim();
  return id || null;
}

function decodeCode(tile, encoded, maxCandidateCount) {
  if (!Number.isInteger(encoded) || encoded < 0 || encoded > 0xffffffff) {
    return { valid: false, reason: "invalid-code" };
  }
  if (encoded === 0) return { valid: true, transparent: true, codes: [] };
  if (!(encoded & EDGE_FLAG)) {
    if (encoded > MAX_CODE) return { valid: false, reason: "invalid-code" };
    return { valid: true, transparent: false, codes: [encoded] };
  }

  const offset = encoded & MAX_CODE;
  const count = tile.edgeIds[offset];
  if (!Number.isInteger(count) || count < 1 || count > maxCandidateCount
    || offset + count >= tile.edgeIds.length) {
    return { valid: false, reason: "invalid-edge-span" };
  }
  const codes = [];
  let weightSum = 0;
  for (let index = 1; index <= count; index += 1) {
    const code = tile.edgeIds[offset + index];
    const weight = tile.edgeWeights[offset + index];
    if (!Number.isInteger(code) || code < 1 || code > MAX_CODE
      || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      return { valid: false, reason: "invalid-edge-contribution" };
    }
    weightSum += weight;
    if (weight > 0) codes.push(code);
  }
  if (weightSum > 1.00001) return { valid: false, reason: "invalid-edge-weights" };
  if (!codes.length) return { valid: false, reason: "empty-edge-contributions" };
  return { valid: true, transparent: false, edge: true, codes };
}

/**
 * Read stable-ID candidates from CPU political raster tiles.
 * `point` and tile origins use the same raster-pixel coordinate space.
 * This function only supplies candidates; it never decides an interaction hit.
 */
export function queryPoliticalIdRasterCandidates({
  tiles,
  point,
  codeToId,
  density,
  samplesPerPixel = density ?? 1,
  guardPixels = 1,
  maxCandidateCount = 16,
} = {}) {
  if (!Array.isArray(tiles) || !tiles.length
    || tiles.length > MAX_TILE_COUNT
    || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || !Number.isSafeInteger(guardPixels) || guardPixels < 0 || guardPixels > MAX_GUARD_PIXELS
    || !isSafePositiveInteger(maxCandidateCount) || maxCandidateCount > MAX_CANDIDATE_COUNT) {
    return result("invalid", [], "invalid-query");
  }
  if (typeof codeToId !== "function" && !(codeToId instanceof Map)
    && (!codeToId || typeof codeToId !== "object")) {
    return result("invalid", [], "invalid-code-map");
  }

  let queryDensity = density;
  const normalizedTiles = [];
  for (const entry of tiles) {
    const tile = entry?.tile || entry;
    const descriptor = entry?.tile ? entry.descriptor : null;
    if (!isValidTile(tile, descriptor)) return result("invalid", [], "invalid-tile");
    const tileDensity = descriptor?.density ?? tile.density;
    if (tileDensity != null) {
      if (!Number.isFinite(tileDensity) || tileDensity <= 0) {
        return result("invalid", [], "invalid-density");
      }
      if (queryDensity == null) queryDensity = tileDensity;
      else if (Math.abs(queryDensity - tileDensity) > 1e-10 * Math.max(1, queryDensity, tileDensity)) {
        return result("invalid", [], "mixed-density");
      }
    }
    normalizedTiles.push(tile);
  }
  if (queryDensity == null) queryDensity = 1;
  if (!Number.isFinite(queryDensity) || queryDensity <= 0) {
    return result("invalid", [], "invalid-density");
  }
  // Coordinate-space density is not screen resolution. Canonical-world users
  // provide samplesPerPixel separately; legacy callers use density as before.
  if (!Number.isFinite(samplesPerPixel) || samplesPerPixel <= 0) return result("invalid", [], "invalid-sampling");
  if (samplesPerPixel < MIN_PICK_DENSITY) return result("missing", [], "coarse-density");

  const containing = normalizedTiles.filter((tile) => point.x >= tile.originX
    && point.y >= tile.originY
    && point.x < tile.originX + tile.width
    && point.y < tile.originY + tile.height);
  if (containing.length === 0) return result("missing", [], "outside-tiles");
  if (containing.length > 1) return result("invalid", [], "overlapping-tiles");

  const tile = containing[0];
  const centerX = Math.floor(point.x - tile.originX);
  const centerY = Math.floor(point.y - tile.originY);
  // Always inspect at least 3x3 pixels for an interior classification, even if
  // the caller asks for no additional boundary candidates.
  const radius = Math.max(1, guardPixels);
  if (centerX - radius < 0 || centerY - radius < 0
    || centerX + radius >= tile.width || centerY + radius >= tile.height) {
    return result("missing", [], "tile-seam");
  }

  const centerEncoded = tile.codes[centerY * tile.width + centerX];
  if (centerEncoded === 0) return result("missing", [], "transparent");

  const centerDecoded = decodeCode(tile, centerEncoded, maxCandidateCount);
  if (!centerDecoded.valid) return result("invalid", [], centerDecoded.reason);
  if (centerDecoded.transparent) return result("missing", [], "transparent");

  const ids = [];
  const seenIds = new Set();
  let interior = !centerDecoded.edge && centerDecoded.codes[0] > 0;
  const centerCode = centerDecoded.codes[0];
  let centerId = null;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const decoded = decodeCode(tile, tile.codes[y * tile.width + x], maxCandidateCount);
      if (!decoded.valid) return result("invalid", [], decoded.reason);
      if (decoded.transparent) {
        interior = false;
        continue;
      }
      if (decoded.edge || decoded.codes.length !== 1 || decoded.codes[0] !== centerCode) {
        interior = false;
      }
      for (const code of decoded.codes) {
        let id;
        try {
          id = mapCodeToId(codeToId, code);
        } catch (_error) {
          return result("invalid", [], "code-map-error");
        }
        if (!id) return result("invalid", [], "missing-code-mapping");
        if (x === centerX && y === centerY && code === centerCode) centerId = id;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        ids.push(id);
        if (ids.length > maxCandidateCount) return result("invalid", [], "candidate-limit");
      }
    }
  }

  if (!ids.length) return result("missing", [], "no-candidates");
  if (interior && ids.length === 1 && ids[0] === centerId) {
    return result("interior", ids, null, centerId);
  }
  return result("edge", ids);
}

/** Keep only caller-validated IDs while preserving the query's candidate-only semantics. */
export function resolvePoliticalIdRasterPickCandidate({ query, validateCandidate } = {}) {
  if (!query || !["interior", "edge", "missing", "invalid"].includes(query.kind)
    || !Array.isArray(query.ids) || typeof validateCandidate !== "function") {
    return result("invalid", [], "invalid-validation-request");
  }
  if (query.kind === "missing" || query.kind === "invalid") {
    return result(query.kind, [], query.reason || null);
  }

  const ids = [];
  for (const id of query.ids) {
    let valid = false;
    try {
      valid = !!validateCandidate(id);
    } catch (_error) {
      valid = false;
    }
    if (valid) ids.push(id);
  }
  if (!ids.length) return result("missing", [], "stale-candidate");
  if (query.kind === "interior" && query.primaryId === ids[0] && ids.length === 1) {
    return result("interior", ids, null, ids[0]);
  }
  return result("edge", ids);
}
