// Bump this identity/coverage version whenever the mask or edge encoding changes.
const IDENTITY_PREFIX = "political-id-raster:v1:";
const COVERAGE_VERSION = "d3-full-stream-white-mask-source-over-round-stroke-gutter-crop:v1";
const PROJECTION_FIELDS = [
  "scale", "translate", "center", "rotate", "angle", "reflectX", "reflectY",
  "precision", "clipAngle", "clipExtent", "parallels",
];
const COORDINATE_DEPTH = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
const invalid = (message) => { throw new TypeError(`Political raster identity: ${message}`); };

function finite(value, name) {
  if (!Number.isFinite(value)) invalid(`${name} must be finite.`);
  return value;
}

function vector(value, length, name) {
  if (!Array.isArray(value) || value.length !== length) invalid(`${name} must have ${length} coordinates.`);
  return value.map((number) => finite(number, name));
}

function normalizeProjection(options) {
  if (!options || typeof options.factory !== "string" || !options.factory) invalid("projection factory is required.");
  const methods = options.methods ?? options;
  if (!methods || typeof methods !== "object" || Array.isArray(methods)) invalid("projection methods must be an object.");
  const result = { factory: options.factory };
  for (const field of PROJECTION_FIELDS) {
    if (!Object.hasOwn(methods, field)) continue;
    const value = methods[field];
    if (["translate", "center", "parallels"].includes(field)) result[field] = vector(value, 2, field);
    else if (field === "rotate") {
      if (!Array.isArray(value) || ![2, 3].includes(value.length)) invalid("rotate must have 2 or 3 coordinates.");
      result[field] = vector([value[0], value[1], value[2] ?? 0], 3, field);
    } else if (field === "clipExtent") {
      if (value === null) result[field] = null;
      else {
        if (!Array.isArray(value) || value.length !== 2) invalid("clipExtent must contain two points or be null.");
        result[field] = value.map((point) => vector(point, 2, field));
      }
    } else if (["reflectX", "reflectY"].includes(field)) {
      if (typeof value !== "boolean") invalid(`${field} must be boolean.`);
      result[field] = value;
    } else result[field] = field === "clipAngle" && value === null ? null : finite(value, field);
  }
  return result;
}

function normalizeDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") invalid("tile descriptor is required.");
  const { originX, originY, width, height, density, level } = descriptor;
  if (![originX, originY].every(Number.isSafeInteger)
    || ![width, height].every((value) => Number.isSafeInteger(value) && value > 0)
    || !Number.isSafeInteger(width * height) || width * height > 0xffffffff) invalid("tile dimensions/origin are invalid.");
  if (!Number.isFinite(density) || density <= 0) invalid("density must be finite and positive.");
  if (level !== undefined && !Number.isSafeInteger(level)) invalid("level must be a safe integer when supplied.");
  return [originX, originY, width, height, density, level ?? null];
}

function normalizeGeometry(geometry, ancestors = new Set()) {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) invalid("GeoJSON geometry is required.");
  if (ancestors.has(geometry)) invalid("geometry must not contain cycles.");
  ancestors.add(geometry);
  try {
    if (geometry.type === "GeometryCollection") {
      if (!Array.isArray(geometry.geometries)) invalid("GeometryCollection.geometries must be an array.");
      return [geometry.type, geometry.geometries.map((child) => normalizeGeometry(child, ancestors))];
    }
    if (!Object.hasOwn(COORDINATE_DEPTH, geometry.type)) invalid(`unsupported GeoJSON geometry type ${String(geometry.type)}.`);
    function validateCoordinates(value, depth) {
      if (!Array.isArray(value)) invalid("geometry coordinates must be arrays.");
      if (depth === 0) {
        if (value.length < 2 || !value.every(Number.isFinite)) invalid("geometry positions must contain at least two finite numbers.");
      } else for (const child of value) validateCoordinates(child, depth - 1);
    }
    validateCoordinates(geometry.coordinates, COORDINATE_DEPTH[geometry.type]);
    // Keep the coordinate arrays by reference: do not allocate a second huge
    // coordinate tree merely to impose object-key ordering.
    return [geometry.type, geometry.coordinates];
  } finally {
    ancestors.delete(geometry);
  }
}

/**
 * Content identities survive palette/code reassignment and session restarts.
 * Geometry objects must be immutable, or geometryVersion must change after an
 * in-place edit. Only the latest version/pending digest is kept per weak key.
 * First-use serialization and UTF-8 encoding are O(geometry bytes) on the caller
 * thread; subsequent tiles reuse the digest without traversing coordinates.
 */
export function createPoliticalIdRasterIdentityBuilder({ crypto = globalThis.crypto } = {}) {
  let geometryCache = new WeakMap();
  const stats = { geometryHashes: 0, identityHashes: 0, cacheHits: 0 };
  const encoder = new TextEncoder();

  async function digest(serialized) {
    if (typeof crypto?.subtle?.digest !== "function") {
      throw new Error("Political raster identity requires Web Crypto SHA-256 (crypto.subtle.digest).");
    }
    let buffer;
    try { buffer = await crypto.subtle.digest("SHA-256", encoder.encode(serialized)); }
    catch (error) { throw new Error(`Political raster identity SHA-256 failed: ${String(error?.message || error)}`); }
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 32) {
      throw new Error("Political raster identity SHA-256 returned an invalid digest.");
    }
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function geometryHash(entry) {
    const feature = entry.feature;
    const geometry = feature?.type === "Feature" ? feature.geometry : feature;
    if (!geometry || typeof geometry !== "object") invalid(`entry ${entry.id} requires a GeoJSON geometry.`);
    const previous = geometryCache.get(geometry);
    if (previous && Object.is(previous.version, entry.geometryVersion)) {
      stats.cacheHits++;
      return previous.promise;
    }
    const serialized = JSON.stringify(normalizeGeometry(geometry));
    const promise = digest(serialized).then((hash) => { stats.geometryHashes++; return hash; });
    const cached = { version: entry.geometryVersion, promise };
    const cache = geometryCache;
    cache.set(geometry, cached);
    promise.catch(() => { if (cache.get(geometry) === cached) cache.delete(geometry); });
    return promise;
  }

  async function identify({ sceneKey, descriptor, projectionOptions, entries, strokeWidth, gutter = 0 } = {}) {
    if (typeof crypto?.subtle?.digest !== "function") {
      throw new Error("Political raster identity requires Web Crypto SHA-256 (crypto.subtle.digest).");
    }
    if (typeof sceneKey !== "string" || !sceneKey) invalid("stable sceneKey is required.");
    const shape = normalizeDescriptor(descriptor);
    const projection = normalizeProjection(projectionOptions);
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0) invalid("strokeWidth must be finite and nonnegative.");
    if (![0, 1, 2, 4].includes(gutter)) invalid("gutter must be 0, 1, 2, or 4.");
    if (!Array.isArray(entries)) invalid("painter-ordered entries must be an array.");
    const ids = new Set();
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)) invalid("entry IDs must be unique nonempty strings.");
      ids.add(entry.id);
      if (entry.strokeCode != null && (!Number.isInteger(entry.strokeCode) || entry.strokeCode < 0 || entry.strokeCode > 0x7fffffff)) {
        invalid(`entry ${entry.id} has an invalid strokeCode.`);
      }
      if (entry.strokeCode != null && entry.strokeCode !== 0 && entry.strokeCode !== entry.code) {
        invalid(`entry ${entry.id} has an unsupported cross-ID strokeCode.`);
      }
    }
    const orderedEntries = [];
    // Hash one geometry at a time to bound temporary UTF-8/digest input storage.
    for (const entry of entries) orderedEntries.push([entry.id, await geometryHash(entry), entry.strokeCode !== 0]);
    const hash = await digest(JSON.stringify([COVERAGE_VERSION, sceneKey, shape, projection, strokeWidth, gutter, orderedEntries]));
    stats.identityHashes++;
    return IDENTITY_PREFIX + hash;
  }

  return Object.freeze({ identify, getStats: () => ({ ...stats }), dispose: () => { geometryCache = new WeakMap(); } });
}
