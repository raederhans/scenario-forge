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

function planCodeCompression(codes) {
  if (!(codes instanceof Uint32Array) || codes.length < 2) return null;
  let runs = 1;
  for (let index = 1; index < codes.length; index += 1) {
    if (codes[index] !== codes[index - 1]) runs += 1;
    // Even a perfect suffix cannot make this RLE smaller than the raw array.
    if (runs * 8 >= codes.byteLength && runs > 1) return null;
  }
  return runs === 1 ? { kind: "constant", value: codes[0], bytes: 4 }
    : { kind: "rle", runs, bytes: runs * 8 };
}

function compressCodes(codes, plan) {
  if (plan.kind === "constant") return plan;
  const pairs = new Uint32Array(plan.runs * 2);
  let at = 0, start = 0;
  for (let index = 1; index <= codes.length; index += 1) {
    if (index !== codes.length && codes[index] === codes[start]) continue;
    pairs[at++] = codes[start];
    pairs[at++] = index - start;
    start = index;
  }
  return { kind: "rle", pairs, bytes: pairs.byteLength };
}

function decompressCodes(packed, length) {
  const codes = new Uint32Array(length);
  if (packed.kind === "constant") codes.fill(packed.value);
  else {
    let offset = 0;
    for (let at = 0; at < packed.pairs.length; at += 2) {
      const end = offset + packed.pairs[at + 1];
      codes.fill(packed.pairs[at], offset, end);
      offset = end;
    }
  }
  return codes;
}

/** A strict byte-bounded LRU of CPU tile payloads. */
export function createPoliticalIdRasterCache({ maxBytes = 48 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer.");
  }
  const cache = new Map();
  const payloads = new WeakMap();
  let cpuBytes = 0;
  let evictions = 0;

  function remove(key, evicted = false) {
    const entry = cache.get(key);
    if (!entry) return false;
    cache.delete(key);
    cpuBytes -= entry.bytes;
    entry.payload?.keys.delete(key);
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

  function resizePayload(payload, codeBytes) {
    for (const key of payload.keys) {
      const entry = cache.get(key);
      const bytes = payload.edgeBytes + codeBytes;
      cpuBytes += bytes - entry.bytes;
      entry.bytes = bytes;
    }
  }

  function compact(payload) {
    if (!payload?.codes || !payload.compressible) return false;
    const plan = planCodeCompression(payload.codes);
    if (!plan) { payload.compressible = false; return false; }
    // Encoding and decoding briefly need both representations. Reserve that
    // overlap inside the same cap, rather than hiding a second allocation.
    if (payload.rawBytes + plan.bytes > maxBytes || cpuBytes + plan.bytes > maxBytes) return false;
    const packed = compressCodes(payload.codes, plan);
    payload.codes = null;
    payload.packed = packed;
    resizePayload(payload, packed.bytes);
    return true;
  }

  function makeRoom(additionalBytes, protectedPayload = null, materializing = false) {
    // Every alias has its own conservative byte charge. Recompute the decode
    // reservation after eviction, since removing an alias also reduces it.
    const reservation = () => additionalBytes * (materializing ? protectedPayload.keys.size : 1);
    while (cpuBytes + reservation() > maxBytes) {
      const visited = new Set();
      for (const entry of cache.values()) {
        if ((protectedPayload && entry.payload === protectedPayload) || visited.has(entry.payload)) continue;
        visited.add(entry.payload);
        compact(entry.payload);
        if (cpuBytes + reservation() <= maxBytes) return true;
      }
      // Incompressible coverage still uses the original LRU eviction policy.
      const oldest = [...cache].find(([, entry]) => entry.payload !== protectedPayload
        || !materializing || protectedPayload.keys.size > 1);
      if (!oldest) return false;
      remove(oldest[0], true);
    }
    return true;
  }

  function materialize(payload) {
    if (payload.codes) return payload.codes;
    const packed = payload.packed;
    // A tile object held by the caller can outlive LRU residency, just as it
    // could before compression. It is no longer owned/accounted by this cache.
    if (payload.keys.size && !makeRoom(payload.codeBytes, payload, true)) {
      throw new RangeError("Political ID raster decode exceeds the CPU byte budget.");
    }
    payload.codes = decompressCodes(packed, payload.length);
    payload.packed = null;
    resizePayload(payload, payload.codeBytes);
    return payload.codes;
  }

  function getPayload(tile, bytes) {
    const existing = payloads.get(tile);
    if (existing) return existing;
    const property = Object.getOwnPropertyDescriptor(tile, "codes");
    if (!(property?.value instanceof Uint32Array) || !property.configurable || !property.writable) return null;
    const payload = { codes: property.value, packed: null, length: property.value.length,
      codeBytes: property.value.byteLength, edgeBytes: bytes - property.value.byteLength,
      rawBytes: bytes, compressible: true, keys: new Set() };
    // Keep the original tile object, including all WeakMap/GPU identity and
    // metadata. Existence probes and entries() do not touch this lazy property.
    Object.defineProperty(tile, "codes", { configurable: true, enumerable: property.enumerable,
      get: () => materialize(payload) });
    payloads.set(tile, payload);
    return payload;
  }

  function set(key, tile, descriptor) {
    const normalizedKey = String(key ?? "");
    const known = tile && payloads.get(tile);
    const rawBytes = known?.rawBytes ?? byteLengthOf(tile);
    const bytes = known ? known.edgeBytes + (known.codes ? known.codeBytes : known.packed.bytes) : rawBytes;
    if (!normalizedKey || bytes === null || !descriptor
      || ![descriptor.originX, descriptor.originY, descriptor.width, descriptor.height, descriptor.density].every(finite)
      || descriptor.width <= 0 || descriptor.height <= 0 || descriptor.density <= 0) return false;
    remove(normalizedKey);
    // Oversized entries are never retained, even transiently in the LRU.
    if (rawBytes > maxBytes) return false;
    const payload = getPayload(tile, rawBytes);
    if (!makeRoom(bytes, payload)) return false;
    cache.set(normalizedKey, { tile, descriptor: { ...descriptor }, bytes, payload });
    payload?.keys.add(normalizedKey);
    cpuBytes += bytes;
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
    for (const entry of cache.values()) entry.payload?.keys.clear();
    cache.clear();
    cpuBytes = 0;
  }

  function getStats() {
    return { cpuBytes, tileCount: cache.size, evictions };
  }

  function entries() {
    return [...cache.entries()].map(([key, entry]) => [key, entry.tile]);
  }

  return Object.freeze({ maxBytes, get, peek, set, invalidate, clear, getStats, entries });
}
