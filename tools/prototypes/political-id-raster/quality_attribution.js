import { loadPoliticalFixture } from "./fixtures.js";
import { createPoliticalIdRasterSource } from "../../../js/core/renderer/political_id_raster_source.js";
import { buildPoliticalIdRasterTile } from "../../../js/core/renderer/political_id_raster_tile.js";
import { createPoliticalIdRasterGpu } from "../../../js/core/renderer/political_id_raster_gpu.js";

const CSS_WIDTH = 720, CSS_HEIGHT = 480, TILE_SIZE = 512;
const MAX_PIXELS = 12 * 1024 * 1024;
const BACKGROUND = "#aadaff";
const PROJECTION_FIELDS = ["scale", "translate", "center", "rotate", "angle", "reflectX", "reflectY", "precision", "clipAngle", "clipExtent"];
const now = () => performance.now();

function compare(reference, actual, width, select = null) {
  if (reference.length !== actual.length || reference.length % 4) throw new RangeError("Attribution pixel shapes differ.");
  let pixels = 0, changed = 0, over1 = 0, over8 = 0, over32 = 0, maximum = 0, sum = 0;
  let worstPixel = null;
  for (let at = 0; at < reference.length; at += 4) {
    const index = at / 4, x = index % width, y = Math.floor(index / width);
    if (select && !select(x, y)) continue;
    let error = 0;
    for (let channel = 0; channel < 4; channel++) error = Math.max(error, Math.abs(reference[at + channel] - actual[at + channel]));
    pixels++;
    if (error > 0) changed++;
    if (error > 1) over1++;
    if (error > 8) over8++;
    if (error > 32) over32++;
    if (error > maximum) { maximum = error; worstPixel = { x, y }; }
    sum += error;
  }
  return {
    pixels, changedPixels: changed, changedPixelsRatio: changed / Math.max(1, pixels),
    meanMaxChannelError: sum / Math.max(1, pixels), maximumChannelError: maximum,
    pixelsOver1Ratio: over1 / Math.max(1, pixels), pixelsOver8Ratio: over8 / Math.max(1, pixels),
    pixelsOver32Ratio: over32 / Math.max(1, pixels), worstPixel,
  };
}

function seamSelector(width, height) {
  return (x, y) => {
    const nearBoundary = (position, extent) => {
      const boundary = Math.round(position / TILE_SIZE) * TILE_SIZE;
      return boundary > 0 && boundary < extent && Math.abs(position - boundary) <= 2;
    };
    return nearBoundary(x, width) || nearBoundary(y, height);
  };
}

function quarterDensity(scale) {
  const raw = Math.log2(scale) * 4, nearest = Math.round(raw);
  const level = Math.abs(raw - nearest) <= 1e-10 ? nearest : Math.ceil(raw);
  return { level, density: 2 ** (level / 4) };
}

function readGpuGrid(canvas) {
  const gl = canvas.getContext("webgl2");
  const pixels = new Uint8Array(canvas.width * canvas.height * 4), stride = canvas.width * 4;
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  // Flip rows in place, avoiding the GPU helper's second complete grid buffer.
  const row = new Uint8Array(stride);
  for (let top = 0; top < Math.floor(canvas.height / 2); top++) {
    const bottom = canvas.height - top - 1;
    row.set(pixels.subarray(top * stride, (top + 1) * stride));
    pixels.copyWithin(top * stride, bottom * stride, (bottom + 1) * stride);
    pixels.set(row, bottom * stride);
  }
  return pixels;
}

// Reproduce the worker's complete projection parameters without importing its
// browser entry point, which also installs self.onmessage when evaluated.
function scaledProjection(options, density, precision = options.precision) {
  const projection = globalThis.d3[options.factory]();
  for (const field of PROJECTION_FIELDS) {
    if (["scale", "translate", "precision", "clipExtent"].includes(field)) continue;
    if (typeof projection[field] === "function" && Object.hasOwn(options, field)) projection[field](options[field]);
  }
  projection.scale(options.scale * density);
  projection.translate(options.translate.map((value) => value * density));
  projection.precision(precision * density);
  projection.clipExtent(options.clipExtent?.map((point) => point.map((value) => value * density)) ?? null);
  return projection;
}

function makeGridInputs(entries, options, density, precision) {
  const projection = scaledProjection(options, density, precision);
  const generator = globalThis.d3.geoPath(projection);
  const paths = new Map();
  const projectedEntries = entries.map((entry) => {
    const [[minX, minY], [maxX, maxY]] = generator.bounds(entry.feature);
    return { ...entry, bounds: { minX, minY, maxX, maxY } };
  });
  return {
    projection, entries: projectedEntries, paths,
    getCachedPath(entry, buildPath) {
      if (!paths.has(entry.id)) paths.set(entry.id, buildPath());
      return paths.get(entry.id);
    },
  };
}

function intersects(entry, left, top, width, height, margin) {
  const bounds = entry.bounds;
  return bounds.maxX >= left - margin && bounds.minX <= left + width + margin
    && bounds.maxY >= top - margin && bounds.minY <= top + height + margin;
}

async function buildGrid(inputs, { width, height, strokeWidth, gutter = 0, tiled = false }) {
  const started = now(), tiles = [];
  const size = tiled ? TILE_SIZE : Math.max(width, height);
  const aggregate = { pathBuilds: 0, pathCacheHits: 0, maskReadPixels: 0, retainedBytes: 0, edgePixelCount: 0, maxContributors: 0 };
  for (let top = 0; top < height; top += size) {
    for (let left = 0; left < width; left += size) {
      const tileWidth = Math.min(size, width - left), tileHeight = Math.min(size, height - top);
      const entries = inputs.entries.filter((entry) => intersects(entry, left, top, tileWidth, tileHeight, strokeWidth / 2 + 4 + gutter));
      const tile = await buildPoliticalIdRasterTile({
        entries, projection: inputs.projection, getCachedPath: inputs.getCachedPath,
        width: tileWidth, height: tileHeight, originX: left, originY: top, strokeWidth, gutter,
      });
      tiles.push(tile);
      for (const field of Object.keys(aggregate)) {
        if (field === "maxContributors") aggregate[field] = Math.max(aggregate[field], tile.stats[field]);
        else aggregate[field] += tile.stats[field];
      }
    }
  }
  return { tiles, stats: { ...aggregate, tileCount: tiles.length, buildWallMs: now() - started } };
}

/** Browser-only pixel diagnosis. Costs include synchronous validation readback. */
export async function runQualityAttribution(scenarioId, { dpr = 1, zoom = 1.1 } = {}) {
  if (![1, 2].includes(dpr) || !Number.isFinite(zoom) || zoom <= 0) throw new RangeError("Quality attribution requires DPR 1/2 and positive zoom.");
  if (typeof OffscreenCanvas !== "function" || typeof Path2D !== "function") throw new Error("Quality attribution requires OffscreenCanvas and Path2D.");
  const width = CSS_WIDTH * dpr, height = CSS_HEIGHT * dpr, physicalScale = dpr * zoom;
  const quarter = quarterDensity(physicalScale), finalScale = physicalScale / quarter.density;
  const finalStrokeWidth = 0.75 * dpr, quarterStrokeWidth = finalStrokeWidth;
  const gridWidth = Math.ceil(width / finalScale), gridHeight = Math.ceil(height / finalScale);
  // Bound all raster surfaces, not just the number of cells in a tile. The
  // conservative peak counts reference/readback arrays and working surfaces;
  // sparse edge tables/native paths/driver allocations are byte costs outside it.
  const estimatedPeakPixelSlots = Math.max(6 * gridWidth * gridHeight + width * height,
    4 * gridWidth * gridHeight + 4 * width * height);
  if (![gridWidth, gridHeight].every(Number.isSafeInteger) || estimatedPeakPixelSlots > MAX_PIXELS) {
    throw new RangeError("Quality attribution exceeds its 12 Mi-pixel working budget.");
  }
  const fixture = await loadPoliticalFixture(scenarioId, { width: CSS_WIDTH, height: CSS_HEIGHT, dpr: 1 });
  const canvases = new Set();
  function canvas(w, h) { const value = new OffscreenCanvas(w, h); canvases.add(value); return value; }
  function release(value) { value.width = value.height = 0; canvases.delete(value); }
  let source, gpu;
  const report = {
    scenarioId, dpr, zoom, viewportCss: { width: CSS_WIDTH, height: CSS_HEIGHT }, viewportPhysical: { width, height },
    fixture: fixture.metadata,
    fixedInputs: { nativeExactPhysicalStrokeWidth: finalStrokeWidth, background: BACKGROUND, painterOrder: "fixture/source entries", paletteChanges: 0 },
    quarterGrid: { width: gridWidth, height: gridHeight, originX: 0, originY: 0, ...quarter, finalRgbaScale: finalScale,
      strokeWidth: quarterStrokeWidth, finalPhysicalStrokeWidth: quarterStrokeWidth * finalScale, tileSize: TILE_SIZE },
    memory: { pixelBudget: MAX_PIXELS, estimatedPeakPixelSlots, accounting: "conservative raster/readback pixel slots; excludes sparse edge tables, paths and browser/driver copies" },
    limitations: [
      "Standalone fixture; no main-app chunk compositor, overlay passes or startup integration.",
      "Quarter grid covers the visible viewport with partial right/bottom tiles; production offscreen guard tiles are omitted to bound working memory.",
      "Primary quarter cases retain production .75*dpr grid stroke, so final RGBA scaling thins it; one separate monolithic compensated-stroke case isolates this contribution.",
      "Legacy fixture precision is .1 CSS px multiplied by grid density; production canonical projection now uses a fixed .05 physical-pixel precision and is not reproduced here.",
      "Native context requests willReadFrequently:false; actual hardware acceleration is browser-dependent and repeated readback may change its backend.",
      "Exact-scale difference includes byte-alpha mask quantization and GPU/canvas color compositing; it is not proof of a single AA implementation defect.",
      "All costs are one-run diagnostic wall/submission/readback times, not reliable performance comparisons or GPU execution times.",
      "Gutter and imageSmoothingQuality improvements are measured, never assumed; no quality gate is inferred.",
    ],
  };
  try {
    source = createPoliticalIdRasterSource({ getBounds: fixture.getBounds, resolveColor: fixture.resolveColor });
    const snapshot = source.publish({ collection: fixture.collection, sceneKey: fixture.id, projectionKey: "quality-fixed-css",
      coverageKey: "quality-fixed-order", colorRevision: 0 });
    const entries = snapshot.entries.map((entry) => ({ ...entry, strokeCode: fixture.strokeCodeForEntry(entry) }));
    const options = { factory: "geoEqualEarth" };
    for (const field of PROJECTION_FIELDS) if (typeof fixture.projection[field] === "function") options[field] = fixture.projection[field]();
    report.fixedInputs.featureCount = entries.length;
    report.fixedInputs.projection = options;

    const nativeCanvas = canvas(width, height), nativeContext = nativeCanvas.getContext("2d", { willReadFrequently: false });
    if (!nativeContext) throw new Error("Quality attribution could not create native Canvas context.");
    const paths = new Map(), generator = globalThis.d3.geoPath(fixture.projection);
    const pathStarted = now();
    for (const entry of entries) {
      const path = new Path2D();
      generator.context(path)(entry.feature);
      paths.set(entry.id, path);
    }
    generator.context(null);
    const nativePathBuildMs = now() - pathStarted, nativeStarted = now();
    nativeContext.fillStyle = BACKGROUND;
    nativeContext.fillRect(0, 0, width, height);
    nativeContext.setTransform(physicalScale, 0, 0, physicalScale, 0, 0);
    nativeContext.lineWidth = 0.75 / zoom;
    nativeContext.lineJoin = nativeContext.lineCap = "round";
    for (const entry of entries) {
      nativeContext.fillStyle = nativeContext.strokeStyle = fixture.resolveColor(entry.feature, entry.id);
      nativeContext.fill(paths.get(entry.id));
      if (entry.strokeCode !== 0) nativeContext.stroke(paths.get(entry.id));
    }
    const nativeDrawSubmitMs = now() - nativeStarted, nativeReadStarted = now();
    const nativePixels = nativeContext.getImageData(0, 0, width, height).data;
    report.native = { nativePathBuildMs, nativeDrawSubmitMs, readbackMs: now() - nativeReadStarted, cachedPathCount: paths.size,
      contextAttributes: nativeContext.getContextAttributes?.() ?? null };
    paths.clear();
    release(nativeCanvas);

    gpu = createPoliticalIdRasterGpu({ canvas: canvas(1, 1) });
    gpu.setPalette(snapshot.palette, snapshot.paletteRevision);
    report.gpuEnvironment = gpu.getEnvironment();
    const outputCanvas = canvas(width, height), output = outputCanvas.getContext("2d", { willReadFrequently: true });
    if (!output) throw new Error("Quality attribution could not create output context.");
    function viewportPixels(gridW, gridH, scale, quality = "low") {
      output.setTransform(1, 0, 0, 1, 0, 0);
      output.clearRect(0, 0, width, height);
      output.fillStyle = BACKGROUND;
      output.fillRect(0, 0, width, height);
      output.imageSmoothingEnabled = true;
      output.imageSmoothingQuality = quality;
      output.drawImage(gpu.canvas, 0, 0, gridW, gridH, 0, 0, gridW * scale, gridH * scale);
      return output.getImageData(0, 0, width, height).data;
    }
    function capture(built, gridW, gridH, scale, { readGrid = false, readViewport = true } = {}) {
      const started = now(), before = gpu.getStats();
      gpu.setTiles(built.tiles);
      gpu.draw({ width: gridW, height: gridH });
      const submissionMs = now() - started, readStarted = now();
      const gridPixels = readGrid ? readGpuGrid(gpu.canvas) : null;
      const pixels = readViewport ? viewportPixels(gridW, gridH, scale) : null;
      const after = gpu.getStats();
      return { gridPixels, pixels, costs: { ...built.stats, gpuUploadAndDrawSubmitMs: submissionMs,
        validationReadbackAndBlitMs: now() - readStarted, tileUploadDelta: after.tileUploads - before.tileUploads,
        gpuTextureBytes: after.gpuTextureBytes } };
    }

    let exactInputs = makeGridInputs(entries, options, physicalScale, 0.1);
    let exactBuilt = await buildGrid(exactInputs, { width, height, strokeWidth: finalStrokeWidth });
    let exact = capture(exactBuilt, width, height, 1);
    report.exactFinalScale = { density: physicalScale, precisionCss: 0.1, finalRgbaScale: 1,
      vsNative: compare(nativePixels, exact.pixels, width), costs: exact.costs };
    exactInputs.paths.clear(); exactInputs = null; exactBuilt = null;
    gpu.setTiles([]);

    const fineInputs = makeGridInputs(entries, options, physicalScale, 0.01);
    const fineBuilt = await buildGrid(fineInputs, { width, height, strokeWidth: finalStrokeWidth });
    let fine = capture(fineBuilt, width, height, 1);
    report.projectionPrecision = { basePrecisionCss: 0.1, finePrecisionCss: 0.01,
      fineVsBaseExact: compare(exact.pixels, fine.pixels, width), fineVsNativeBasePrecision: compare(nativePixels, fine.pixels, width), costs: fine.costs };
    fineInputs.paths.clear(); fineBuilt.tiles.length = 0;
    exact = null; fine = null;
    gpu.setTiles([]);

    const quarterInputs = makeGridInputs(entries, options, quarter.density, 0.1);
    const monoBuilt = await buildGrid(quarterInputs, { width: gridWidth, height: gridHeight, strokeWidth: quarterStrokeWidth });
    let mono = capture(monoBuilt, gridWidth, gridHeight, finalScale, { readGrid: true });
    report.quarterMonolithic = { vsNative: compare(nativePixels, mono.pixels, width), costs: mono.costs };
    monoBuilt.tiles.length = 0;
    gpu.setTiles([]);
    const compensatedWidth = finalStrokeWidth / finalScale;
    const compensatedBuilt = await buildGrid(quarterInputs, { width: gridWidth, height: gridHeight, strokeWidth: compensatedWidth });
    let compensated = capture(compensatedBuilt, gridWidth, gridHeight, finalScale);
    report.scaledStrokeContribution = { gridStrokeWidth: quarterStrokeWidth, compensatedGridStrokeWidth: compensatedWidth,
      productionFinalPhysicalStrokeWidth: quarterStrokeWidth * finalScale, compensatedFinalPhysicalStrokeWidth: finalStrokeWidth,
      compensatedVsNative: compare(nativePixels, compensated.pixels, width),
      compensatedVsProductionMonolithic: compare(mono.pixels, compensated.pixels, width), costs: compensated.costs };
    compensatedBuilt.tiles.length = 0; compensated = null; mono.pixels = null;
    gpu.setTiles([]);
    const baseBuilt = await buildGrid(quarterInputs, { width: gridWidth, height: gridHeight, strokeWidth: quarterStrokeWidth, tiled: true });
    const base = capture(baseBuilt, gridWidth, gridHeight, finalScale, { readGrid: true, readViewport: false });
    const selectSeam = seamSelector(gridWidth, gridHeight);
    report.quarterTiledGutter0 = {
      vsMonolithicGrid: compare(mono.gridPixels, base.gridPixels, gridWidth),
      seamVsMonolithicGrid: compare(mono.gridPixels, base.gridPixels, gridWidth, selectSeam), costs: base.costs };
    mono = null;
    base.pixels = viewportPixels(gridWidth, gridHeight, finalScale);
    report.quarterTiledGutter0.vsNative = compare(nativePixels, base.pixels, width);
    const beforeSmoothing = gpu.getStats();
    let highPixels = viewportPixels(gridWidth, gridHeight, finalScale, "high");
    const afterSmoothing = gpu.getStats();
    report.finalRgbaSmoothing = { scale: finalScale, lowVsNative: report.quarterTiledGutter0.vsNative,
      highVsNative: compare(nativePixels, highPixels, width), highVsLow: compare(base.pixels, highPixels, width),
      tileUploadDelta: afterSmoothing.tileUploads - beforeSmoothing.tileUploads,
      paletteUploadDelta: afterSmoothing.paletteUploads - beforeSmoothing.paletteUploads,
      note: "Same resident gutter0 tiles and palette; only final RGBA imageSmoothingQuality changes." };
    highPixels = null;
    base.pixels = null; baseBuilt.tiles.length = 0;
    gpu.setTiles([]);

    report.gutters = [];
    for (const gutter of [2, 4]) {
      const built = await buildGrid(quarterInputs, { width: gridWidth, height: gridHeight, strokeWidth: quarterStrokeWidth, tiled: true, gutter });
      const result = capture(built, gridWidth, gridHeight, finalScale, { readGrid: true, readViewport: false });
      const gutterReport = { gutter,
        vsGutter0Grid: compare(base.gridPixels, result.gridPixels, gridWidth),
        seamVsGutter0Grid: compare(base.gridPixels, result.gridPixels, gridWidth, selectSeam), costs: result.costs };
      result.gridPixels = null;
      result.pixels = viewportPixels(gridWidth, gridHeight, finalScale);
      gutterReport.vsNative = compare(nativePixels, result.pixels, width);
      report.gutters.push(gutterReport);
      built.tiles.length = 0;
      gpu.setTiles([]);
    }
    quarterInputs.paths.clear();
    report.gpuTotals = gpu.getStats();
    report.completedAt = new Date().toISOString();
    return report;
  } finally {
    gpu?.dispose();
    source?.dispose();
    for (const value of canvases) { value.width = value.height = 0; }
    canvases.clear();
  }
}
