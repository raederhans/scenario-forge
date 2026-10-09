const DEFAULT_TILE_SIZE = 512;
const DEFAULT_MAX_PIXELS = 12 * 1024 * 1024;
const RASTER_BOUNDS_PADDING = 4;

const finite = (value) => Number.isFinite(value);

function validPositive(value) {
  return finite(value) && value > 0;
}

function getDensity(physicalScale) {
  const rawLevel = Math.log2(physicalScale) * 4;
  // Keep exact octave boundaries stable in the face of floating point noise.
  const nearest = Math.round(rawLevel);
  const level = Math.abs(rawLevel - nearest) <= 1e-10 ? nearest : Math.ceil(rawLevel);
  return { level, density: 2 ** (level / 4) };
}

/** Plan a complete, gap-free tile rectangle for a viewport in physical pixels. */
export function planPoliticalIdRasterView({
  transform,
  dpr,
  width,
  height,
  offsetX = 0,
  offsetY = 0,
  tileSize = DEFAULT_TILE_SIZE,
  maxPixels = DEFAULT_MAX_PIXELS,
} = {}) {
  const x = Number(transform?.x), y = Number(transform?.y), k = Number(transform?.k);
  if (![x, y, k, dpr, width, height, offsetX, offsetY, tileSize, maxPixels].every(finite)
    || !validPositive(k) || !validPositive(dpr) || !validPositive(width) || !validPositive(height)
    || !Number.isInteger(width) || !Number.isInteger(height) || !validPositive(tileSize)
    || !Number.isInteger(tileSize) || !validPositive(maxPixels)) return null;

  const physicalScale = k * dpr;
  if (!validPositive(physicalScale) || !finite(Math.log2(physicalScale))) return null;
  const { level, density } = getDensity(physicalScale);
  if (!validPositive(density)) return null;
  const scale = physicalScale / density;
  const translateX = (x + offsetX) * dpr;
  const translateY = (y + offsetY) * dpr;
  // Include one output pixel around the visible bounds before snapping to tile
  // boundaries. The adjacent edge tiles provide the required small guard band.
  const minWorldX = (-translateX - 1) / scale;
  const minWorldY = (-translateY - 1) / scale;
  const maxWorldX = (width - translateX + 1) / scale;
  const maxWorldY = (height - translateY + 1) / scale;
  const gridX0 = Math.floor(minWorldX / tileSize);
  const gridY0 = Math.floor(minWorldY / tileSize);
  const gridX1 = Math.ceil(maxWorldX / tileSize);
  const gridY1 = Math.ceil(maxWorldY / tileSize);
  const columns = gridX1 - gridX0;
  const rows = gridY1 - gridY0;
  const rasterWidth = columns * tileSize;
  const rasterHeight = rows * tileSize;
  const pixelCount = rasterWidth * rasterHeight;
  if (![gridX0, gridY0, gridX1, gridY1, rasterWidth, rasterHeight, pixelCount].every(Number.isSafeInteger)
    || columns <= 0 || rows <= 0 || pixelCount > maxPixels) return null;

  const originX = gridX0 * tileSize;
  const originY = gridY0 * tileSize;
  const tiles = [];
  for (let gy = gridY0; gy < gridY1; gy += 1) {
    for (let gx = gridX0; gx < gridX1; gx += 1) {
      const tileOriginX = gx * tileSize;
      const tileOriginY = gy * tileSize;
      tiles.push({
        key: `${level}:${dpr}:${gx}:${gy}`,
        originX: tileOriginX,
        originY: tileOriginY,
        width: tileSize,
        height: tileSize,
        density,
        level,
      });
    }
  }
  return {
    density,
    level,
    scale,
    originX,
    originY,
    width: rasterWidth,
    height: rasterHeight,
    outputX: originX * scale + translateX,
    outputY: originY * scale + translateY,
    outputWidth: rasterWidth * scale,
    outputHeight: rasterHeight * scale,
    tiles,
  };
}

function intersects(left, right) {
  return left.maxX >= right.minX && left.minX <= right.maxX
    && left.maxY >= right.minY && left.minY <= right.maxY;
}

function validBounds(bounds) {
  return !!bounds && [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(finite)
    && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY;
}

function byteLengthOf(tile) {
  const arrays = [tile?.codes, tile?.edgeIds, tile?.edgeWeights];
  if (!arrays.every((array) => ArrayBuffer.isView(array) && Number.isSafeInteger(array.byteLength))) return null;
  return arrays.reduce((total, array) => total + array.byteLength, 0);
}

/** A strict byte-bounded LRU of CPU tile payloads. */
export function createPoliticalIdRasterCache({ maxBytes = 48 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer.");
  }
  const cache = new Map();
  let cpuBytes = 0;
  let evictions = 0;

  function remove(key, evicted = false) {
    const entry = cache.get(key);
    if (!entry) return false;
    cache.delete(key);
    cpuBytes -= entry.bytes;
    if (evicted) evictions += 1;
    return true;
  }

  function get(key) {
    if (!cache.has(key)) return undefined;
    const entry = cache.get(key);
    cache.delete(key);
    cache.set(key, entry);
    return entry.tile;
  }

  function peek(key) {
    return cache.get(key)?.tile;
  }

  function set(key, tile, descriptor) {
    const normalizedKey = String(key ?? "");
    const bytes = byteLengthOf(tile);
    if (!normalizedKey || bytes === null || !descriptor
      || ![descriptor.originX, descriptor.originY, descriptor.width, descriptor.height, descriptor.density].every(finite)
      || descriptor.width <= 0 || descriptor.height <= 0 || descriptor.density <= 0) return false;
    remove(normalizedKey);
    // Oversized entries are never retained, even transiently in the LRU.
    if (bytes > maxBytes) return false;
    cache.set(normalizedKey, { tile, descriptor: { ...descriptor }, bytes });
    cpuBytes += bytes;
    while (cpuBytes > maxBytes && cache.size) {
      remove(cache.keys().next().value, true);
    }
    return cache.has(normalizedKey);
  }

  function invalidate(dirtyBounds) {
    if (!Array.isArray(dirtyBounds) || dirtyBounds.length === 0) return [];
    const changes = dirtyBounds.map((change) => ({
      oldBounds: change?.oldBounds ?? null,
      newBounds: change?.newBounds ?? null,
      previousCoverageUnknown: change?.previousCoverageUnknown === true,
    }));
    const unknown = changes.some(({ oldBounds, newBounds }) =>
      (!oldBounds && !newBounds) || (oldBounds && !validBounds(oldBounds)) || (newBounds && !validBounds(newBounds)));
    const clearAll = unknown || changes.some((change) => change.previousCoverageUnknown);
    const removed = [];
    for (const [key, entry] of cache) {
      const { descriptor } = entry;
      const padding = RASTER_BOUNDS_PADDING / descriptor.density;
      const tileBounds = {
        minX: descriptor.originX / descriptor.density - padding,
        minY: descriptor.originY / descriptor.density - padding,
        maxX: (descriptor.originX + descriptor.width) / descriptor.density + padding,
        maxY: (descriptor.originY + descriptor.height) / descriptor.density + padding,
      };
      if (clearAll || changes.some(({ oldBounds, newBounds }) =>
        (oldBounds && intersects(tileBounds, oldBounds)) || (newBounds && intersects(tileBounds, newBounds)))) {
        removed.push(key);
      }
    }
    for (const key of removed) remove(key);
    return removed;
  }

  function clear() {
    cache.clear();
    cpuBytes = 0;
  }

  function getStats() {
    return { cpuBytes, tileCount: cache.size, evictions };
  }

  function entries() {
    return [...cache.entries()].map(([key, entry]) => [key, entry.tile]);
  }

  return Object.freeze({ get, peek, set, invalidate, clear, getStats, entries });
}
