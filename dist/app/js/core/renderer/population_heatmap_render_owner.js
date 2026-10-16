import { getPopulationDensityColor } from "../population_spatial_view_model.js";
import { lonLatToPopulationGrid } from "../population_spatial_data.js";

export const POPULATION_SCREEN_SAMPLE_BUDGET = 400_000;
export const POPULATION_EXPORT_SAMPLE_BUDGET = 2_000_000;

// Refinement loads only the current view. The global overview remains the
// authoritative coarse presentation outside the bounded detail selection.
export function getPopulationViewportDetailTileIds(state, { projection, width = state.width, height = state.height } = {}) {
  const transform = state.zoomTransform || { k: 1, x: 0, y: 0 };
  if (Number(transform.k || 1) < 4 || !(width > 0) || !(height > 0)
    || typeof projection?.invert !== "function") return [];
  const catalog = state.populationRuntime?.data?.raster?.detail_tiles || [];
  if (!catalog.length) return [];
  const points = [];
  for (let row = 0; row <= 12; row += 1) for (let column = 0; column <= 16; column += 1) {
    const position = [(column * width / 16 - Number(transform.x || 0)) / transform.k,
      (row * height / 12 - Number(transform.y || 0)) / transform.k];
    const lonLat = projection.invert(position);
    if (!lonLat?.every(Number.isFinite)) continue;
    if (typeof projection === "function") {
      const forward = projection(lonLat);
      if (!forward?.every(Number.isFinite) || Math.hypot(forward[0] - position[0], forward[1] - position[1]) > 0.5) continue;
    }
    const point = lonLatToPopulationGrid(lonLat[0], lonLat[1]);
    if (point) points.push(point);
  }
  if (!points.length) return [];
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  const pad = Math.max(...catalog.map((tile) => Math.max(tile.bounds[2] - tile.bounds[0], tile.bounds[3] - tile.bounds[1])));
  const bounds = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  const center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  return catalog.filter((tile) => tile.bounds[0] <= bounds[2] && tile.bounds[2] >= bounds[0]
    && tile.bounds[1] <= bounds[3] && tile.bounds[3] >= bounds[1])
    .sort((left, right) => Math.hypot((left.bounds[0] + left.bounds[2]) / 2 - center[0], (left.bounds[1] + left.bounds[3]) / 2 - center[1])
      - Math.hypot((right.bounds[0] + right.bounds[2]) / 2 - center[0], (right.bounds[1] + right.bounds[3]) / 2 - center[1]))
    .slice(0, 32).map((tile) => tile.id);
}

// Pixel sampling is a presentation operation. Feature/country statistics never
// consume these pixels: they use the offline complete-geometry population rows.
export function rasterizePopulationDensity({
  width, height, targetWidth = width, targetHeight = height, matrix,
  projection, sampleDensity, colorForDensity = getPopulationDensityColor,
}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12
    || typeof projection?.invert !== "function") return { width, height, data, sampled: 0 };
  const scaleX = targetWidth / width, scaleY = targetHeight / height;
  let sampled = 0;
  const colors = new Map();
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const px = (column + 0.5) * scaleX - matrix.e;
      const py = (row + 0.5) * scaleY - matrix.f;
      const point = [(matrix.d * px - matrix.c * py) / determinant,
        (-matrix.b * px + matrix.a * py) / determinant];
      const lonLat = projection.invert(point);
      if (!Array.isArray(lonLat) || !lonLat.every(Number.isFinite)
        || Math.abs(lonLat[0]) > 180.000001 || Math.abs(lonLat[1]) > 90) continue;
      // Inversion outside a globe's visible outline can wrap to plausible
      // coordinates. A forward round-trip rejects that exterior, including seams.
      if (typeof projection === "function") {
        const projected = projection(lonLat);
        if (!projected?.every(Number.isFinite)
          || Math.hypot(projected[0] - point[0], projected[1] - point[1]) > 0.5) continue;
      }
      const value = sampleDensity(lonLat[0], lonLat[1]);
      const density = typeof value === "number" ? value : value?.density;
      if (typeof density !== "number" || !Number.isFinite(density) || density < 0
        || (typeof value === "object" && value && !["ok", "observed", "partial"].includes(value.status))) continue;
      const color = colorForDensity(density);
      if (!colors.has(color)) colors.set(color, /^#[0-9a-f]{6}$/i.test(color)
        ? [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16)) : null);
      const rgb = colors.get(color);
      if (!rgb) continue;
      const offset = (row * width + column) * 4;
      data.set(rgb, offset);
      data[offset + 3] = 255;
      sampled += 1;
    }
  }
  return { width, height, data, sampled };
}

export function createPopulationHeatmapRenderOwner({ state = {}, getters = {}, helpers = {} } = {}) {
  const {
    getContext = () => null, getProjection = () => null, getProjectionKey = () => "",
    getSnapshot = () => ({ status: "idle" }), sampleDensity = () => null,
    isRequested = () => state.styleConfig?.population?.enabled === true
      && state.styleConfig.population.mode === "heatmap",
    getMaskInfo = () => null, isExportRendering = () => false,
  } = getters;
  const {
    applyLandMask = () => false,
    createCanvas = () => globalThis.document?.createElement("canvas"),
    recordMetric = () => {}, nowMs = () => globalThis.performance?.now?.() || Date.now(),
  } = helpers;
  let cached = null;

  function getReadiness() {
    if (!isRequested()) return { ready: true, status: "disabled" };
    const snapshot = getSnapshot();
    if (snapshot.status !== "ready") return { ready: false, status: snapshot.status || "idle", error: snapshot.error || "" };
    const mask = getMaskInfo();
    if (!mask?.collection) return { ready: false, status: "mask-unavailable", error: "Population heatmap requires a scenario land mask." };
    if (typeof getProjection()?.invert !== "function") return { ready: false, status: "projection-unavailable" };
    return { ready: true, status: "ready", revision: snapshot.revision, dataVersion: snapshot.version,
      refinementStatus: snapshot.refinementStatus || "idle", error: snapshot.error || "" };
  }

  function assertReadyForExport() {
    const readiness = getReadiness();
    if (!readiness.ready) throw new Error(`Population heatmap is ${readiness.status}; ${readiness.error || "wait for population data and the land mask before exporting."}`);
    if (readiness.refinementStatus === "failed") throw new Error(`Population heatmap detail loading failed: ${readiness.error || "unknown error"}.`);
    return readiness;
  }

  function draw(k = 1) {
    const startedAt = nowMs();
    const readiness = getReadiness();
    if (readiness.status === "disabled") { cached = null; return { committed: true, status: "disabled" }; }
    if (isExportRendering()) assertReadyForExport();
    if (!readiness.ready) {
      cached = null;
      recordMetric("populationHeatmap", nowMs() - startedAt, { status: readiness.status, error: readiness.error, sampled: 0 });
      return { committed: true, status: readiness.status };
    }
    const context = getContext(), projection = getProjection();
    if (!context?.canvas || typeof context.getTransform !== "function") return { committed: false, reason: "population-context-unavailable" };
    const targetWidth = context.canvas.width, targetHeight = context.canvas.height;
    const matrix = context.getTransform();
    const budget = isExportRendering() ? POPULATION_EXPORT_SAMPLE_BUDGET : POPULATION_SCREEN_SAMPLE_BUDGET;
    const reduction = Math.max(1, Math.sqrt(targetWidth * targetHeight / budget));
    const width = Math.max(1, Math.floor(targetWidth / reduction));
    const height = Math.max(1, Math.floor(targetHeight / reduction));
    const snapshot = getSnapshot();
    const lod = k >= 4 ? "detail" : "overview";
    const key = JSON.stringify([getProjectionKey(), state.activeScenarioId, state.topologyRevision,
      snapshot.version, snapshot.revision, snapshot.status, lod, width, height, targetWidth, targetHeight,
      ...["a", "b", "c", "d", "e", "f"].map((name) => matrix[name])]);
    let cacheHit = cached?.key === key;
    if (!cacheHit) {
      // Retain one bounded presentation surface, replacing it on every identity
      // change. No projection grids or previous zoom canvases accumulate.
      cached = null;
      const canvas = createCanvas();
      if (!canvas) throw new Error("Population heatmap canvas could not be created.");
      canvas.width = width; canvas.height = height;
      const scratch = canvas.getContext("2d");
      if (!scratch) throw new Error("Population heatmap canvas context is unavailable.");
      const result = rasterizePopulationDensity({ width, height, targetWidth, targetHeight,
        matrix, projection, sampleDensity: (lon, lat) => sampleDensity(snapshot, lon, lat, { lod }) });
      const image = scratch.createImageData(width, height);
      image.data.set(result.data);
      scratch.putImageData(image, 0, 0);
      cached = { key, canvas, sampled: result.sampled, width, height };
    }
    context.save();
    try {
      if (!applyLandMask()) {
        if (isExportRendering()) throw new Error("Population heatmap land mask could not be applied.");
        return { committed: false, reason: "population-mask-unavailable" };
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = Math.max(0, Math.min(1, Number(state.styleConfig.population.opacity ?? 0.8)));
      context.imageSmoothingEnabled = true;
      context.drawImage(cached.canvas, 0, 0, targetWidth, targetHeight);
    } finally { context.restore(); }
    recordMetric("populationHeatmap", nowMs() - startedAt, { status: "ready", lod, cacheHit,
      refinementStatus: readiness.refinementStatus, error: readiness.error,
      sampled: cached.sampled, samplePixels: width * height, targetPixels: targetWidth * targetHeight });
    return { committed: true, status: "ready" };
  }

  return Object.freeze({ draw, getReadiness, assertReadyForExport,
    invalidate: () => { cached = null; }, getCacheInfo: () => cached
      ? { width: cached.width, height: cached.height, bytes: cached.width * cached.height * 4 } : null });
}
