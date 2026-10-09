import { createPoliticalIdRasterSource } from "../../../js/core/renderer/political_id_raster_source.js";
import { buildPoliticalIdRasterTile, referenceColorizePoliticalIdTile, splitPoliticalIdRasterTile } from "../../../js/core/renderer/political_id_raster_tile.js";
import { createPoliticalIdRasterGpu } from "../../../js/core/renderer/political_id_raster_gpu.js";
import { applyFeaturePaintState } from "../../../js/core/state/color_state.js";
import { getMapDataBoundary, createReadonlyReferenceAssignments } from "../../../js/core/map_data_boundary.js";
import { loadPoliticalFixture } from "./fixtures.js";

const $ = (id) => document.getElementById(id);
const frame = () => new Promise(requestAnimationFrame);
const now = () => performance.now();
const BACKGROUND = "#aadaff";
const TILE_SIZE = 256;
// Fixed before browser measurements. Failures are retained in the report.
const GATES = Object.freeze({ oracleMaxError: 1, nativeMaxError: 3, interiorMaxError: 0, warmRatio: 0.8 });
// User authorized a small raster quality tradeoff after the strict first run.
// These additional gates leave the strict result visible and keep geometry,
// seams and editing as hard requirements. They are prototype criteria only.
const APPROXIMATE_GATES = Object.freeze({ meanPixelMaxError: 0.75, fractionOver32: 0.002, solidInteriorMaxError: 1, seamOracleMaxError: 0 });
let current = null, busy = false, suiteReport = null, generation = 0;

function canvas(width, height) { return new OffscreenCanvas(width, height); }
function projectedBounds(projection, feature) {
  const [[minX, minY], [maxX, maxY]] = d3.geoPath(projection).bounds(feature);
  return { minX, minY, maxX, maxY };
}
function syntheticFixture(width, height, dpr) {
  const polygon = (id, rings) => ({ type: "Feature", properties: { id }, geometry: { type: "Polygon", coordinates: rings } });
  const ring = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const features = [
    polygon("hole", [ring(20.35, 30.2, 220, 210), ring(76, 85, 75, 90).reverse()]),
    polygon("seam", [[[245.3, 15.2], [550.6, 190.3], [274.4, 300.5], [245.3, 15.2]]]),
    polygon("narrow", [ring(22.15, 290.45, 470, 0.6)]),
    { type: "Feature", properties: { id: "islands" }, geometry: { type: "MultiPolygon", coordinates: [[ring(615.25, 60.1, 1.2, 1.3)], [ring(610.2, 95.2, 12, 14)]] } },
    ...Array.from({ length: 12 }, (_, index) => polygon(`overlap-${index}`, [ring(410.05 + index * 0.031, 340.15 + index * 0.027, 170, 80)])),
  ];
  const owners = Object.fromEntries(features.map((feature, i) => [feature.properties.id, `C${i}`]));
  const state = {
    activeScenarioId: "synthetic", scenarioBaselineOwnersByFeatureId: createReadonlyReferenceAssignments(owners),
    landIndex: new Map(features.map(f => [f.properties.id, f])), visualOverrides: {}, mapSemanticMode: "political",
    sovereignBaseColors: Object.fromEntries(features.map((_, i) => [`C${i}`, ["#c89469", "#718c78", "#ad6486", "#ddd48f"][i % 4]])),
  };
  const projection = d3.geoIdentity().scale(dpr).clipExtent([[0, 0], [width, height]]);
  const boundary = getMapDataBoundary(state);
  return {
    id: "synthetic", label: "Synthetic edge fixtures", state, projection,
    collection: { type: "FeatureCollection", features },
    getBounds: f => projectedBounds(projection, f),
    resolveColor: (_f, id) => boundary.paint.resolveFeatureColor(id).color || "#777777",
    strokeCodeForEntry: entry => entry.code,
    metadata: { source: "deterministic synthetic polygons", selectedFeatures: features.length, loadMs: 0, dpr },
  };
}
async function makeTiles(session, tileSize = TILE_SIZE, isCancelled = () => false) {
  const entries = session.snapshot.entries.map(entry => ({ ...entry, strokeCode: session.fixture.strokeCodeForEntry(entry) }));
  // Build the bounded local region in one raster space. Canvas antialiasing
  // changes when a path is independently clipped by each tile's surface.
  const region = await buildPoliticalIdRasterTile({ entries, projection: session.fixture.projection,
    width: session.width, height: session.height, strokeWidth: session.strokeWidth, isCancelled });
  return tileSize >= Math.max(session.width, session.height) ? [region] : splitPoliticalIdRasterTile(region, { tileSize });
}
function drawNative(session, context) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, session.width, session.height);
  context.lineWidth = session.strokeWidth;
  context.lineJoin = "round"; context.lineCap = "round";
  for (const entry of session.snapshot.entries) {
    const color = session.fixture.resolveColor(entry.feature, entry.id);
    context.fillStyle = color; context.strokeStyle = color;
    const path = session.paths.get(entry.id);
    context.fill(path);
    if (session.fixture.strokeCodeForEntry(entry) !== 0) context.stroke(path);
  }
}
function drawRaster(session, context) {
  context.clearRect(0, 0, session.width, session.height);
  if (!session.gpu?.isAvailable() || session.lost) { drawNative(session, context); return "canvas-fallback"; }
  session.gpu.draw({ width: session.width, height: session.height, context });
  return "gpu";
}
function setColors(session, ids) {
  session.snapshot = session.source.updateColors(ids, { colorRevision: ++session.colorRevision });
  if (session.gpu?.isAvailable() && !session.lost) session.gpu.setPalette(session.snapshot.palette, session.snapshot.paletteRevision);
}
function render(session) {
  drawNative(session, $("native").getContext("2d"));
  drawRaster(session, $("raster").getContext("2d"));
}
function destroy(session) {
  if (!session) return;
  session.source.dispose(); session.gpu?.dispose(); session.paths.clear(); session.tiles.length = 0;
}
async function load(id, dpr = 1) {
  const ticket = ++generation;
  $("scenario").value = id; $("dpr").value = String(dpr);
  $("status").textContent = `加载 ${id}，生成固定视图的 ID 瓦片…`;
  destroy(current); current = null;
  const width = 720 * dpr, height = 480 * dpr, startedAt = now();
  const fixture = id === "synthetic" ? syntheticFixture(width, height, dpr) : await loadPoliticalFixture(id, { width, height, dpr });
  const session = { fixture, width, height, dpr, strokeWidth: 0.75 * dpr, paths: new Map(), tiles: [], gpu: null, source: null, snapshot: null, colorRevision: 0, history: [], lost: false, selected: null };
  try {
    const adapterStarted = now();
    session.source = createPoliticalIdRasterSource({ getBounds: fixture.getBounds, resolveColor: fixture.resolveColor });
    session.snapshot = session.source.publish({ collection: fixture.collection, sceneKey: id, projectionKey: `${id}:${width}:${height}:${dpr}`, coverageKey: `stable-order;round-stroke:${session.strokeWidth}`, colorRevision: 0 });
    session.view = { width, height, dpr, projection: session.snapshot.projectionKey };
    const adapterMs = now() - adapterStarted;
    const pathStarted = now();
    for (const entry of session.snapshot.entries) {
      const path = new Path2D();
      d3.geoPath(fixture.projection).context(path)(entry.feature);
      session.paths.set(entry.id, path);
    }
    const nativePathBuildMs = now() - pathStarted;
    for (const target of [$("native"), $("raster")]) { target.width = width; target.height = height; }
    const nativeStarted = now();
    drawNative(session, $("native").getContext("2d"));
    const nativeFirstDrawMs = now() - nativeStarted;
    const buildStarted = now();
    session.tiles = await makeTiles(session, TILE_SIZE, () => ticket !== generation);
    const tileBuildMs = now() - buildStarted;
    const uploadStarted = now();
    try {
      session.gpu = createPoliticalIdRasterGpu({ onContextLost: () => { session.lost = true; } });
      session.gpu.setPalette(session.snapshot.palette, session.snapshot.paletteRevision);
      session.gpu.setTiles(session.tiles);
    } catch (error) {
      session.gpu?.dispose(); session.gpu = null;
      session.gpuUnavailableReason = error.message;
    }
    const gpuCreateAndUploadMs = now() - uploadStarted;
    const firstDrawStarted = now();
    drawRaster(session, $("raster").getContext("2d"));
    const gpuFirstDrawAndBlitMs = now() - firstDrawStarted;
    session.cold = { fixtureLoadAndSelectionMs: fixture.metadata.loadMs, adapterMs, nativePathBuildMs, nativeFirstDrawMs, tileBuildMs, gpuCreateAndUploadMs, gpuFirstDrawAndBlitMs, totalWallMs: now() - startedAt };
    current = session;
    session.selected = session.snapshot.entries.find(entry => fixture.strokeCodeForEntry(entry) !== 0)?.id;
    $("selection").textContent = `选中：${session.selected}（也可点击地图选择）`;
    $("status").textContent = `${fixture.label} · ${session.snapshot.entries.length} 个地块 · ${session.tiles.length} 块瓦片 · ${width} × ${height} 像素${session.gpu ? "" : " · GPU 不可用，Canvas 回退"}`;
    return session;
  } catch (error) { destroy(session); throw error; }
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, medianMs: at(0.5), p95Ms: at(0.95), minMs: sorted[0], maxMs: sorted.at(-1), samplesMs: values };
}
async function benchmark(session, pairs = 24) {
  // These canvases are never read back. Pixel validation uses fresh surfaces.
  const nativeContext = $("native").getContext("2d"), rasterContext = $("raster").getContext("2d");
  const native = [], raster = [], nativeRaf = [], rasterRaf = [];
  const before = session.gpu.getStats(), geometryRevision = session.snapshot.geometryRevision;
  const originalOverrides = { ...session.fixture.state.visualOverrides };
  const candidates = session.snapshot.entries.filter(entry => session.fixture.strokeCodeForEntry(entry) !== 0);
  for (let i = -4; i < pairs; i++) {
    const entry = candidates[(i + 4) % candidates.length];
    for (const kind of i % 2 === 0 ? ["native", "raster"] : ["raster", "native"]) {
      await frame();
      const start = now();
      applyFeaturePaintState(session.fixture.state, [entry.id], i % 2 === 0 ? "#d64f46" : "#2a93bc");
      if (kind === "native") drawNative(session, nativeContext);
      else { setColors(session, [entry.id]); drawRaster(session, rasterContext); }
      const submitted = now();
      await frame();
      const rafSettled = now();
      if (i >= 0) {
        (kind === "native" ? native : raster).push(submitted - start);
        (kind === "native" ? nativeRaf : rasterRaf).push(rafSettled - start);
      }
    }
  }
  session.fixture.state.visualOverrides = originalOverrides;
  setColors(session, null); render(session);
  const a = stats(native), b = stats(raster), after = session.gpu.getStats();
  return {
    method: "counterbalanced AB/BA; 4 warmup pairs; single-ID canonical paint; full fixed-view political pass; no readPixels; includes raster palette update and 2D blit",
    limitations: "CPU call duration and next-rAF interval are not GPU timer queries, display presentation, app input latency or whole-app FPS. Production partial repaint is not benchmarked.",
    native: a, raster: b, nativeNextRaf: stats(nativeRaf), rasterNextRaf: stats(rasterRaf),
    rasterToNativeMedianRatio: b.medianMs / Math.max(0.001, a.medianMs),
    warmGatePass: b.medianMs <= a.medianMs * GATES.warmRatio,
    geometryUnchanged: geometryRevision === session.snapshot.geometryRevision,
    tileUploadsDuringPaint: after.tileUploads - before.tileUploads,
  };
}
function assembleOracle(session, tiles = session.tiles) {
  const output = new Uint8ClampedArray(session.width * session.height * 4);
  for (const tile of tiles) {
    const rgba = referenceColorizePoliticalIdTile(tile, session.snapshot.palette);
    for (let y = 0; y < tile.height; y++) {
      output.set(rgba.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), ((tile.originY + y) * session.width + tile.originX) * 4);
    }
  }
  return output;
}
function difference(a, b, predicate = () => true) {
  let maxError = 0, pixelsDifferent = 0, pixelsOver3 = 0, pixelsOver32 = 0, pixels = 0, sum = 0;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < a.length; index += 4) {
    if (!predicate(index / 4)) continue;
    let error = 0;
    for (let c = 0; c < 4; c++) error = Math.max(error, Math.abs(a[index + c] - b[index + c]));
    maxError = Math.max(maxError, error); histogram[error]++; pixels++; sum += error;
    if (error) pixelsDifferent++;
    if (error > 3) pixelsOver3++;
    if (error > 32) pixelsOver32++;
  }
  let cumulative = 0, p99Error = 0;
  for (let i = 0; i < histogram.length; i++) { cumulative += histogram[i]; if (cumulative >= pixels * 0.99) { p99Error = i; break; } }
  return { pixels, maxError, p99Error, meanPixelMaxError: sum / Math.max(1, pixels), pixelsDifferent, pixelsOver3, pixelsOver32, fractionOver32: pixelsOver32 / Math.max(1, pixels) };
}
function flatten(source) {
  const result = canvas(source.width, source.height), context = result.getContext("2d");
  context.fillStyle = BACKGROUND; context.fillRect(0, 0, result.width, result.height); context.drawImage(source, 0, 0);
  const bytes = context.getImageData(0, 0, result.width, result.height).data;
  result.width = result.height = 0;
  return bytes;
}
function isInterior(session, index) {
  const x = index % session.width, y = Math.floor(index / session.width);
  const tile = session.tiles.find(t => x >= t.originX && x < t.originX + t.width && y >= t.originY && y < t.originY + t.height);
  const code = tile.codes[(y - tile.originY) * tile.width + x - tile.originX];
  return code !== 0 && (code & 0x80000000) === 0;
}
function solidInteriorPredicate(session) {
  const codes = new Uint32Array(session.width * session.height);
  for (const tile of session.tiles) for (let y = 0; y < tile.height; y++) {
    codes.set(tile.codes.subarray(y * tile.width, (y + 1) * tile.width), (tile.originY + y) * session.width + tile.originX);
  }
  return index => {
    const code = codes[index], x = index % session.width, y = Math.floor(index / session.width);
    if (!code || code & 0x80000000 || x < 2 || y < 2 || x >= session.width - 2 || y >= session.height - 2) return false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (codes[index + dy * session.width + dx] !== code) return false;
    return true;
  };
}
function validatePixels(session) {
  const nativeCanvas = canvas(session.width, session.height), rasterCanvas = canvas(session.width, session.height);
  drawNative(session, nativeCanvas.getContext("2d"));
  drawRaster(session, rasterCanvas.getContext("2d"));
  // Synchronous readback belongs only to correctness checks, after benchmarks.
  const oracle = difference(assembleOracle(session), session.gpu.readPixelsForValidation());
  const nativeBytes = flatten(nativeCanvas), rasterBytes = flatten(rasterCanvas);
  const native = difference(nativeBytes, rasterBytes);
  const interior = difference(nativeBytes, rasterBytes, index => isInterior(session, index));
  const solidInterior = difference(nativeBytes, rasterBytes, solidInteriorPredicate(session));
  const seams = difference(nativeBytes, rasterBytes, index => {
    const x = index % session.width, y = Math.floor(index / session.width);
    return (x > 0 && x % TILE_SIZE <= 1) || (y > 0 && y % TILE_SIZE <= 1);
  });
  nativeCanvas.width = nativeCanvas.height = rasterCanvas.width = rasterCanvas.height = 0;
  return { oracle, native, interior, solidInterior, seams,
    pass: oracle.maxError <= GATES.oracleMaxError && native.maxError <= GATES.nativeMaxError && interior.maxError <= GATES.interiorMaxError,
    approximatePass: oracle.maxError <= GATES.oracleMaxError && native.meanPixelMaxError <= APPROXIMATE_GATES.meanPixelMaxError && native.fractionOver32 <= APPROXIMATE_GATES.fractionOver32 && solidInterior.maxError <= APPROXIMATE_GATES.solidInteriorMaxError };
}
async function diagnoseCoverage(session) {
  const softwareCanvas = canvas(session.width, session.height);
  const nativeCanvas = canvas(session.width, session.height);
  const rasterCanvas = canvas(session.width, session.height);
  const monoCanvas = canvas(session.width, session.height);
  let monoGpu;
  try {
  drawNative(session, softwareCanvas.getContext("2d", { willReadFrequently: true }));
  drawNative(session, nativeCanvas.getContext("2d"));
  drawRaster(session, rasterCanvas.getContext("2d"));
  const software = flatten(softwareCanvas), native = flatten(nativeCanvas), raster = flatten(rasterCanvas);
  const monoTiles = await makeTiles(session, Math.max(session.width, session.height));
  monoGpu = createPoliticalIdRasterGpu();
  monoGpu.setPalette(session.snapshot.palette, session.snapshot.paletteRevision); monoGpu.setTiles(monoTiles);
  monoGpu.draw({ width: session.width, height: session.height, context: monoCanvas.getContext("2d") });
  const mono = flatten(monoCanvas);
  const report = {
    softwareVsNative: difference(software, native),
    softwareVsTiled: difference(software, raster),
    softwareVsMonolithic: difference(software, mono),
    nativeVsMonolithic: difference(native, mono),
    tiledVsMonolithic: difference(raster, mono),
    environment: session.gpu.getEnvironment(),
  };
  return report;
  } finally {
    monoGpu?.dispose();
    for (const value of [softwareCanvas, nativeCanvas, rasterCanvas, monoCanvas]) value.width = value.height = 0;
  }
}
function edit(session, id, color) {
  session.history.push({ id, previous: session.fixture.state.visualOverrides[id], had: Object.hasOwn(session.fixture.state.visualOverrides, id) });
  applyFeaturePaintState(session.fixture.state, [id], color);
  setColors(session, [id]); render(session);
}
function undo(session) {
  const entry = session.history.pop();
  if (!entry) return false;
  applyFeaturePaintState(session.fixture.state, [entry.id], entry.previous, { remove: !entry.had });
  setColors(session, [entry.id]); render(session); return true;
}
async function validateBehavior(session) {
  const beforePalette = session.snapshot.palette.slice(), beforeFrame = session.source.captureFrame(session.view);
  const originalOwners = session.fixture.state.scenarioBaselineOwnersByFeatureId;
  const beforeUploads = session.gpu.getStats().tileUploads, beforeGeometry = session.snapshot.geometryRevision;
  edit(session, session.selected, "#e338c5");
  const editChangedPalette = !session.snapshot.palette.every((byte, index) => byte === beforePalette[index]);
  const stalePaintRejected = !session.source.isFrameCurrent(beforeFrame, session.view);
  const editedPixels = validatePixels(session);
  undo(session);
  const undoRestoredPalette = session.snapshot.palette.every((byte, index) => byte === beforePalette[index]);
  const undoPixels = validatePixels(session);
  const staleViewRejected = !session.source.isFrameCurrent(session.source.captureFrame(session.view), { ...session.view, width: session.width + 1 });
  const noGeometryRebuild = beforeUploads === session.gpu.getStats().tileUploads && beforeGeometry === session.snapshot.geometryRevision;
  return { editChangedPalette, stalePaintRejected, staleViewRejected, undoRestoredPalette, noGeometryRebuild, canonicalOwnersUnchanged: originalOwners === session.fixture.state.scenarioBaselineOwnersByFeatureId && Object.isFrozen(originalOwners), editedPixels, undoPixels };
}
async function validateLoss(session) {
  const environment = session.gpu.getEnvironment();
  session.gpu.loseContextForValidation();
  for (let i = 0; i < 12 && !session.lost; i++) await frame();
  if (!session.lost) return { supported: false, pass: false, reason: "WEBGL_lose_context unavailable or loss event not observed" };
  const fallback = canvas(session.width, session.height), reference = canvas(session.width, session.height);
  const route = drawRaster(session, fallback.getContext("2d")); drawNative(session, reference.getContext("2d"));
  const fallbackDifference = difference(flatten(fallback), flatten(reference));
  fallback.width = fallback.height = reference.width = reference.height = 0;
  session.gpu.dispose(); session.gpu = null;
  try {
    session.gpu = createPoliticalIdRasterGpu({ onContextLost: () => { session.lost = true; } });
    session.gpu.setPalette(session.snapshot.palette, session.snapshot.paletteRevision); session.gpu.setTiles(session.tiles);
    session.lost = false;
  } catch (error) {
    session.gpu?.dispose(); session.gpu = null;
    render(session);
    return { supported: true, route, fallbackDifference, environment, recoveryError: error.message, pass: false };
  }
  render(session);
  return { supported: true, route, fallbackDifference, recoveredPixels: validatePixels(session), environment, pass: route === "canvas-fallback" && fallbackDifference.maxError === 0 };
}
function memory(session) {
  const tileStats = session.tiles.map(t => t.stats);
  return {
    cpuIdBytes: session.tiles.reduce((sum, t) => sum + t.codes.byteLength, 0),
    cpuCoverageBytes: session.tiles.reduce((sum, t) => sum + t.edgeIds.byteLength + t.edgeWeights.byteLength, 0),
    cpuPaletteBytes: session.snapshot.palette.byteLength, ...session.gpu.getStats(),
    regionMaskRgbaBytes: session.width * session.height * 4,
    splitTransientNote: "Full region ID/coverage arrays coexist with split tile arrays until the region is released; JS coverage Maps add unmeasured build overhead.",
    twoComparisonSurfaceBytes: session.width * session.height * 4 * 2,
    edgePixels: tileStats.reduce((sum, s) => sum + s.edgePixelCount, 0),
    maxContributors: Math.max(...tileStats.map(s => s.maxContributors)),
    excluded: "JS Map/entry/path overhead, decoded vector arrays, transient getImageData arrays, padded upload copies, browser compositor buffers and driver allocations; not measured heap or peak VRAM",
  };
}
function validateSyntheticGeometry(session) {
  if (session.fixture.id !== "synthetic") throw new Error("Synthetic geometry check requires the synthetic fixture.");
  const maxCoverage = new Map();
  for (const tile of session.tiles) for (const encoded of tile.codes) {
    if (!encoded) continue;
    if (!(encoded & 0x80000000)) { maxCoverage.set(encoded, 1); continue; }
    const offset = encoded & 0x7fffffff, count = tile.edgeIds[offset];
    for (let j = 1; j <= count; j++) {
      const code = tile.edgeIds[offset + j], weight = tile.edgeWeights[offset + j];
      maxCoverage.set(code, Math.max(maxCoverage.get(code) || 0, weight));
    }
  }
  const expected = ["narrow", "islands"].map(id => {
    const entry = session.snapshot.entries.find(item => item.id === id);
    return { id, maxCoverage: maxCoverage.get(entry.code) || 0 };
  });
  const holeTransparent = assembleOracle(session)[(Math.round(120 * session.dpr) * session.width + Math.round(100 * session.dpr)) * 4 + 3] === 0;
  return { dpr: session.dpr, expected, holeTransparent, pass: expected.every(item => item.maxCoverage > 0.5) && holeTransparent };
}
async function runSuite() {
  const report = { schema: 1, baseline: "98425dcc23ba6954e997df979788d4f06856cb76", createdAt: new Date().toISOString(), userAgent: navigator.userAgent, gates: GATES, approximateGates: APPROXIMATE_GATES, cases: [], complete: false };
  suiteReport = report;
  for (const [id, dpr] of [["hoi4_1939", 1], ["hoi4_1936", 1], ["tno_1962", 1], ["hoi4_1939", 2], ["synthetic", 1], ["synthetic", 2]]) {
    const session = await load(id, dpr);
    if (!session.gpu) throw new Error(`GPU benchmark unavailable; Canvas fallback works: ${session.gpuUnavailableReason}`);
    $("status").textContent = `正在测量 ${id} @ ${dpr}×`;
    const warm = await benchmark(session);
    const pixels = validatePixels(session), behavior = await validateBehavior(session);
    const result = { id, dpr, width: session.width, height: session.height, fixture: session.fixture.metadata, environment: session.gpu.getEnvironment(), cold: session.cold, warm, pixels, behavior, memory: memory(session) };
    if (id === "synthetic") {
      const monolithic = await makeTiles(session, Math.max(session.width, session.height));
      result.tileSeamOracle = difference(assembleOracle(session), assembleOracle(session, monolithic));
      result.syntheticHoleTransparent = assembleOracle(session)[(Math.round(120 * dpr) * session.width + Math.round(100 * dpr)) * 4 + 3] === 0;
      result.syntheticGeometry = validateSyntheticGeometry(session);
      result.contextLoss = await validateLoss(session);
    }
    result.correctnessPass = pixels.pass && behavior.editChangedPalette && behavior.stalePaintRejected && behavior.staleViewRejected && behavior.undoRestoredPalette && behavior.noGeometryRebuild && behavior.canonicalOwnersUnchanged && behavior.editedPixels.pass && behavior.undoPixels.pass && (!result.tileSeamOracle || (result.tileSeamOracle.maxError <= 1 && result.syntheticHoleTransparent && result.contextLoss.pass && result.contextLoss.recoveredPixels.pass));
    result.behaviorPass = behavior.editChangedPalette && behavior.stalePaintRejected && behavior.staleViewRejected && behavior.undoRestoredPalette && behavior.noGeometryRebuild && behavior.canonicalOwnersUnchanged;
    result.approximatePass = pixels.approximatePass && result.behaviorPass && behavior.editedPixels.approximatePass && behavior.undoPixels.approximatePass && (!result.tileSeamOracle || (result.tileSeamOracle.maxError <= APPROXIMATE_GATES.seamOracleMaxError && result.syntheticGeometry.pass && result.contextLoss.pass && result.contextLoss.recoveredPixels.approximatePass));
    report.cases.push(result); $("result").textContent = JSON.stringify(report, null, 2);
  }
  report.complete = true;
  report.correctnessPass = report.cases.every(item => item.correctnessPass);
  report.approximatePass = report.cases.every(item => item.approximatePass);
  report.warmPass = report.cases.filter(item => item.id !== "synthetic").every(item => item.warm.warmGatePass);
  report.productionEnabled = false;
  $("status").textContent = `验证完成：严格像素对照 ${report.correctnessPass ? "通过" : "有差异"}；小幅画质损失标准 ${report.approximatePass ? "通过" : "未通过"}；真实样本改色速度门槛 ${report.warmPass ? "通过" : "未通过"}。结果不代表整张地图或完整应用性能。`;
  $("result").textContent = JSON.stringify(report, null, 2); $("download").disabled = false;
  return report;
}
async function run(action) {
  if (busy) return;
  busy = true;
  try { return await action(); }
  catch (error) { $("status").textContent = `失败：${error.message}`; console.error(error); if (suiteReport) suiteReport.error = error.stack; throw error; }
  finally { busy = false; }
}
$("load").onclick = () => run(() => load($("scenario").value, Number($("dpr").value)));
$("paint").onclick = () => { if (current && !busy) edit(current, current.selected, $("color").value); };
$("undo").onclick = () => { if (current && !busy) undo(current); };
$("suite").onclick = () => run(runSuite);
$("mode").onchange = () => {
  const mode = $("mode").value;
  $("native-panel").hidden = mode === "raster"; $("raster-panel").hidden = mode === "canvas";
  $("maps").classList.toggle("single", mode !== "both");
};
for (const id of ["native", "raster"]) $(id).onclick = event => {
  if (!current || busy) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) * current.width / rect.width, y = (event.clientY - rect.top) * current.height / rect.height;
  const context = $("native").getContext("2d");
  const hit = [...current.snapshot.entries].reverse().find(entry => context.isPointInPath(current.paths.get(entry.id), x, y));
  if (hit) { current.selected = hit.id; $("selection").textContent = `选中：${hit.id}`; }
};
$("download").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(suiteReport, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "political-id-raster-report.json"; a.click(); URL.revokeObjectURL(url);
};
window.politicalIdPrototype = {
  validateSyntheticGeometry: () => validateSyntheticGeometry(current),
  diagnose: () => run(() => diagnoseCoverage(current)),
  load: (id, dpr = 1) => run(() => load(id, dpr)), runSuite: () => run(runSuite),
  get report() { return suiteReport; }, get busy() { return busy; },
  get status() { return $("status").textContent; },
  inspect: () => current ? { scene: current.fixture.id, geometryRevision: current.snapshot.geometryRevision, paletteRevision: current.snapshot.paletteRevision, selected: current.selected, overrides: { ...current.fixture.state.visualOverrides }, gpu: current.gpu?.getStats() } : null,
};
await run(() => load("hoi4_1939"));
