// Research-only coverage tile. Projection and pixel scale must remain fixed for
// its lifetime; callers rebuild after either changes. Colors never encode IDs.
const EDGE_FLAG = 0x80000000;
const MAX_CODE = 0x7fffffff;
const SLICE_PIXELS = 65536;
const now = () => globalThis.performance?.now?.() ?? Date.now();
const defaultYieldTask = () => globalThis.scheduler?.yield
  ? globalThis.scheduler.yield()
  : new Promise((resolve) => setTimeout(resolve, 0));

function checkCancelled(isCancelled) {
  if (!isCancelled()) return;
  const error = new Error("Political ID raster build cancelled.");
  error.name = "AbortError";
  throw error;
}

function validateCode(code) {
  if (!Number.isInteger(code) || code < 1 || code > MAX_CODE) {
    throw new RangeError("Political palette code must be in 1..0x7fffffff.");
  }
}

function validateDimensions(width, height, originX, originY) {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)
    || ![originX, originY].every(Number.isSafeInteger)
    || !Number.isSafeInteger(width * height) || width * height > 0xffffffff) {
    throw new RangeError("Political ID raster dimensions exceed 32-bit capacity or are invalid.");
  }
}

function createAccumulator(width, height) {
  const codes = new Uint32Array(width * height);
  // Only pixels with partial coverage need maps. Weights remain double precision
  // while building; serialization rounds once to Float32 for GPU consumption.
  const edges = new Map();
  function add(index, code, alphaByte) {
    if (alphaByte === 0) return;
    if (alphaByte === 255) {
      codes[index] = code;
      edges.delete(index);
      return;
    }
    const previousCode = codes[index];
    let contributions = edges.get(index);
    if (!contributions && previousCode === code) return;
    if (!contributions) {
      contributions = new Map();
      if (previousCode) contributions.set(previousCode, 1);
      edges.set(index, contributions);
      codes[index] = 0;
    }
    const alpha = alphaByte / 255;
    for (const [oldCode, weight] of contributions) {
      contributions.set(oldCode, weight * (1 - alpha));
    }
    contributions.set(code, (contributions.get(code) ?? 0) + alpha);
  }

  function* finish({ originX = 0, originY = 0, maskReadPixels = 0, startedAt, isCancelled }) {
    let edgeLength = 0;
    let contributionCount = 0;
    let maxContributors = 0;
    let work = 0;
    for (const contributions of edges.values()) {
      checkCancelled(isCancelled);
      edgeLength += 1 + contributions.size;
      // The high bit identifies a span; its offset occupies only 31 bits.
      if (edgeLength > EDGE_FLAG) throw new RangeError("Political edge spans exceed 31-bit offset capacity.");
      contributionCount += contributions.size;
      maxContributors = Math.max(maxContributors, contributions.size);
      if (++work % SLICE_PIXELS === 0) yield;
    }
    const edgeIds = new Uint32Array(edgeLength);
    const edgeWeights = new Float32Array(edgeLength);
    let offset = 0;
    work = 0;
    for (const [index, contributions] of edges) {
      checkCancelled(isCancelled);
      codes[index] = (EDGE_FLAG | offset) >>> 0;
      edgeIds[offset++] = contributions.size;
      for (const [code, weight] of contributions) {
        edgeIds[offset] = code;
        edgeWeights[offset++] = weight;
        if (++work % SLICE_PIXELS === 0) yield;
      }
    }
    checkCancelled(isCancelled);
    return {
      width, height, originX, originY, codes, edgeIds, edgeWeights,
      stats: {
        edgePixelCount: edges.size,
        contributionCount,
        maxContributors,
        retainedBytes: codes.byteLength + edgeIds.byteLength + edgeWeights.byteLength,
        maskReadPixels,
        buildMs: now() - startedAt,
      },
    };
  }
  return { add, finish };
}

/** Pure synchronous coverage oracle. Layers are painter ordered byte-alpha masks. */
export function encodePoliticalCoverage({
  width, height, layers, originX = 0, originY = 0, isCancelled = () => false,
}) {
  const startedAt = now();
  validateDimensions(width, height, originX, originY);
  checkCancelled(isCancelled);
  const accumulator = createAccumulator(width, height);
  let maskReadPixels = 0;
  for (const { code, alpha } of layers) {
    checkCancelled(isCancelled);
    validateCode(code);
    if (!(alpha instanceof Uint8Array || alpha instanceof Uint8ClampedArray)
      || alpha.length !== width * height) {
      throw new RangeError("Political coverage alpha must be a byte array with one value per pixel.");
    }
    maskReadPixels += alpha.length;
    for (let index = 0; index < alpha.length; index++) {
      if (index % SLICE_PIXELS === 0) checkCancelled(isCancelled);
      accumulator.add(index, code, alpha[index]);
    }
  }
  const steps = accumulator.finish({ originX, originY, maskReadPixels, startedAt, isCancelled });
  let step;
  do { step = steps.next(); } while (!step.done);
  return step.value;
}

function maskRegion(bounds, width, height, originX, originY, strokeWidth) {
  if (!bounds || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
    || bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new RangeError("Political entry requires finite projected min/max bounds.");
  }
  // Round joins/caps extend by half a stroke, with two pixels for AA.
  const margin = strokeWidth / 2 + 2;
  const x = Math.max(0, Math.floor(bounds.minX - originX - margin));
  const y = Math.max(0, Math.floor(bounds.minY - originY - margin));
  const right = Math.min(width, Math.ceil(bounds.maxX - originX + margin));
  const bottom = Math.min(height, Math.ceil(bounds.maxY - originY + margin));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * Rasterizes full projected paths to white alpha masks, never RGB ID masks.
 * Hooks return paths in physical projection coordinates, before tile translation.
 * A cache hook must key projection/precision and geometry versions; paint codes
 * and stroke style do not change the path. Calling buildPath preserves D3's full
 * stream; createProjectedPath replaces that construction only when explicitly supplied.
 */
export async function buildPoliticalIdRasterTile({
  entries, projection, width, height, originX = 0, originY = 0, strokeWidth = 0.75,
  gutter = 0,
  d3 = globalThis.d3,
  createCanvas = (w, h) => new OffscreenCanvas(w, h),
  createPath = () => new Path2D(),
  createProjectedPath = null,
  getCachedPath = null,
  isCancelled = () => false,
  yieldTask = defaultYieldTask,
}) {
  const startedAt = now();
  validateDimensions(width, height, originX, originY);
  if (![0, 1, 2, 4].includes(gutter)) throw new RangeError("Political raster gutter must be 0, 1, 2, or 4.");
  const maskWidth = width + gutter * 2, maskHeight = height + gutter * 2;
  const maskOriginX = originX - gutter, maskOriginY = originY - gutter;
  validateDimensions(maskWidth, maskHeight, maskOriginX, maskOriginY);
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0) throw new RangeError("Invalid political stroke width.");
  if (!d3?.geoPath || !projection) throw new TypeError("Political ID raster requires D3 and the complete projection.");
  checkCancelled(isCancelled);
  const accumulator = createAccumulator(width, height);
  let canvas;
  let pathGenerator;
  let maskReadPixels = 0;
  let pixelWork = 0;
  let entryWork = 0;
  let pathBuilds = 0, pathCacheHits = 0;
  function buildPath(entry) {
    pathBuilds++;
    if (createProjectedPath) return createProjectedPath(entry);
    const path = createPath();
    // D3's stream owns clipping, resampling, spherical seams, and holes.
    pathGenerator ||= d3.geoPath(projection);
    pathGenerator.context(path)(entry.feature);
    return path;
  }
  async function pause() {
    checkCancelled(isCancelled);
    await yieldTask();
    checkCancelled(isCancelled);
  }
  try {
    canvas = createCanvas(maskWidth, maskHeight);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Political ID raster could not create a 2D mask context.");
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#ffffff";
    context.lineWidth = strokeWidth;
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const entry of entries) {
      checkCancelled(isCancelled);
      validateCode(entry.code);
      const strokeCode = entry.strokeCode ?? entry.code;
      if (strokeCode !== 0) validateCode(strokeCode);
      const drawStroke = strokeWidth > 0 && strokeCode !== 0;
      const region = maskRegion(entry.bounds, maskWidth, maskHeight, maskOriginX, maskOriginY, drawStroke ? strokeWidth : 0);
      if (region.width && region.height) {
        const beforeBuilds = pathBuilds;
        const path = getCachedPath?.(entry, () => buildPath(entry)) ?? buildPath(entry);
        if (pathBuilds === beforeBuilds) pathCacheHits++;
        const separateStroke = drawStroke && strokeCode !== entry.code;
        for (let pass = 0; pass < (separateStroke ? 2 : 1); pass++) {
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(region.x, region.y, region.width, region.height);
          context.setTransform(1, 0, 0, 1, -maskOriginX, -maskOriginY);
          if (pass === 0) context.fill(path);
          if (drawStroke && (!separateStroke || pass === 1)) context.stroke(path);
          const { data } = context.getImageData(region.x, region.y, region.width, region.height);
          maskReadPixels += region.width * region.height;
          // Read the expanded mask but accumulate only the requested tile. This
          // preserves all spans without retaining/copying an expanded ID tile.
          const firstRow = Math.max(0, gutter - region.y);
          const lastRow = Math.min(region.height, gutter + height - region.y);
          const firstColumn = Math.max(0, gutter - region.x);
          const lastColumn = Math.min(region.width, gutter + width - region.x);
          for (let row = firstRow; row < lastRow; row++) {
            for (let column = firstColumn; column < lastColumn; column++) {
              const localIndex = row * region.width + column;
              const tileIndex = (region.y + row - gutter) * width + region.x + column - gutter;
              accumulator.add(tileIndex, pass === 0 ? entry.code : strokeCode, data[localIndex * 4 + 3]);
              if (++pixelWork % SLICE_PIXELS === 0) await pause();
            }
          }
        }
      }
      if (++entryWork % 16 === 0) await pause();
    }
    const steps = accumulator.finish({ originX, originY, maskReadPixels, startedAt, isCancelled });
    let step = steps.next();
    while (!step.done) {
      await pause();
      step = steps.next();
    }
    Object.assign(step.value.stats, { strokeWidth, originX, originY, gutter, maskWidth, maskHeight, pathBuilds, pathCacheHits });
    return step.value;
  } finally {
    pathGenerator?.context(null);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/**
 * Split one already-rasterized region in row-major order. Copying coverage avoids
 * Canvas clip/transform AA differences from independently rasterizing tiles.
 * Retained bytes exclude the parent region and the builder's transient JS Maps;
 * those Maps' peak memory still requires measurement on real region builds.
 */
export function splitPoliticalIdRasterTile(tile, { tileSize = 256 } = {}) {
  if (!Number.isSafeInteger(tileSize) || tileSize <= 0) throw new RangeError("Political tile size must be a positive integer.");
  if (!tile || !(tile.codes instanceof Uint32Array) || !(tile.edgeIds instanceof Uint32Array)
    || !(tile.edgeWeights instanceof Float32Array)) {
    throw new TypeError("Political tile requires Uint32 codes/edge IDs and Float32 edge weights.");
  }
  const { width, height, originX = 0, originY = 0 } = tile;
  validateDimensions(width, height, originX, originY);
  if (tile.codes.length !== width * height || tile.edgeIds.length !== tile.edgeWeights.length) {
    throw new RangeError("Political tile array lengths do not match its shape.");
  }
  const result = [];
  for (let top = 0; top < height; top += tileSize) {
    for (let left = 0; left < width; left += tileSize) {
      const startedAt = now();
      const childWidth = Math.min(tileSize, width - left);
      const childHeight = Math.min(tileSize, height - top);
      const childOriginX = originX + left, childOriginY = originY + top;
      validateDimensions(childWidth, childHeight, childOriginX, childOriginY);
      const codes = new Uint32Array(childWidth * childHeight);
      let edgeLength = 0, edgePixelCount = 0, contributionCount = 0, maxContributors = 0;
      for (let row = 0; row < childHeight; row++) {
        const parentRow = (top + row) * width + left;
        const childRow = row * childWidth;
        codes.set(tile.codes.subarray(parentRow, parentRow + childWidth), childRow);
        for (let column = 0; column < childWidth; column++) {
          const encoded = codes[childRow + column];
          if (!(encoded & EDGE_FLAG)) continue;
          const offset = encoded & MAX_CODE;
          const count = tile.edgeIds[offset];
          if (!count || offset + count >= tile.edgeIds.length) throw new RangeError("Political tile has an invalid edge span.");
          edgeLength += count + 1;
          if (edgeLength > EDGE_FLAG) throw new RangeError("Political edge spans exceed 31-bit offset capacity.");
          edgePixelCount++;
          contributionCount += count;
          maxContributors = Math.max(maxContributors, count);
        }
      }
      const edgeIds = new Uint32Array(edgeLength);
      const edgeWeights = new Float32Array(edgeLength);
      let childOffset = 0;
      for (let index = 0; index < codes.length; index++) {
        const encoded = codes[index];
        if (!(encoded & EDGE_FLAG)) continue;
        const parentOffset = encoded & MAX_CODE;
        const count = tile.edgeIds[parentOffset];
        for (let contributor = 1; contributor <= count; contributor++) {
          validateCode(tile.edgeIds[parentOffset + contributor]);
          const weight = tile.edgeWeights[parentOffset + contributor];
          if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError("Political tile has an invalid edge weight.");
        }
        const end = parentOffset + count + 1;
        edgeIds.set(tile.edgeIds.subarray(parentOffset, end), childOffset);
        edgeWeights.set(tile.edgeWeights.subarray(parentOffset, end), childOffset);
        codes[index] = (EDGE_FLAG | childOffset) >>> 0;
        childOffset += count + 1;
      }
      const stats = {
        edgePixelCount, contributionCount, maxContributors,
        retainedBytes: codes.byteLength + edgeIds.byteLength + edgeWeights.byteLength,
        maskReadPixels: 0,
        buildMs: now() - startedAt,
        originX: childOriginX, originY: childOriginY,
      };
      if (Object.hasOwn(tile.stats || {}, "strokeWidth")) stats.strokeWidth = tile.stats.strokeWidth;
      result.push({
        width: childWidth, height: childHeight, originX: childOriginX, originY: childOriginY,
        codes, edgeIds, edgeWeights, stats,
      });
    }
  }
  return result;
}

/** Opaque palette, byte channels. Result is premultiplied RGBA, including alpha. */
export function referenceColorizePoliticalIdTile(tile, palette) {
  if (!(palette instanceof Uint8Array || palette instanceof Uint8ClampedArray)
    || palette.length % 4 !== 0) {
    throw new TypeError("Political palette must be a flat byte RGBA array indexed by code.");
  }
  const pixels = new Uint8ClampedArray(tile.width * tile.height * 4);
  const cache = new Map();
  function color(code) {
    if (cache.has(code)) return cache.get(code);
    const value = palette.subarray(code * 4, code * 4 + 4);
    if (value.length !== 4 || value[3] !== 255) {
      throw new RangeError(`Political palette code ${code} requires opaque byte RGB(A).`);
    }
    cache.set(code, value);
    return value;
  }
  for (let index = 0; index < tile.codes.length; index++) {
    const encoded = tile.codes[index];
    if (!encoded) continue;
    const output = index * 4;
    if (!(encoded & EDGE_FLAG)) {
      const rgba = color(encoded);
      pixels[output] = rgba[0];
      pixels[output + 1] = rgba[1];
      pixels[output + 2] = rgba[2];
      pixels[output + 3] = 255;
    } else {
      const offset = encoded & MAX_CODE;
      const count = tile.edgeIds[offset];
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let contributor = 1; contributor <= count; contributor++) {
        const rgba = color(tile.edgeIds[offset + contributor]);
        const weight = tile.edgeWeights[offset + contributor];
        red += rgba[0] * weight;
        green += rgba[1] * weight;
        blue += rgba[2] * weight;
        alpha += weight;
      }
      pixels[output] = red;
      pixels[output + 1] = green;
      pixels[output + 2] = blue;
      pixels[output + 3] = alpha * 255;
    }
  }
  return pixels;
}
