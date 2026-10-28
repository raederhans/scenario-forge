import { createProjectionInverseParams, invertProjectedPoint } from './bathymetry_texture_math.js';
import { buildBathymetryColorRamp } from './bathymetry_texture_palette.js';
import { createBathymetryTextureSource } from './bathymetry_texture_source.js';
import { createBathymetryTextureRenderer, estimateGeographicBounds } from './bathymetry_texture_renderer.js';

const LOAD_RETRY_COOLDOWN_MS = 10_000;

export function createBathymetryTextureRuntime({
  globalManifestUrl, fetchJson, loadImageBitmap, createCanvas,
  getProjection, getProjectionGeneration, onAssetsChanged = () => {}, now = Date.now,
  createRenderer = createBathymetryTextureRenderer, maxCachedTiles = 64,
}) {
  const slot = () => ({ value: null, pending: null, error: null, retryAt: 0 });
  const global = slot();
  let scenario = slot(), scenarioUrl = null, renderer = null, disposed = false;
  let status = 'off', projectionGeneration, projectionParams, rampKey, ramp;
  let tileBatch = null, detailPending = false;
  let gpuReadyTimer = null;
  let lastOutput = null;

  const matrixOf = (transform) => ({ a: transform.a, b: transform.b, c: transform.c, d: transform.d, e: transform.e, f: transform.f });
  // now · last⁻¹: maps pixels of the previous output onto the current canvas transform.
  function deltaTransform(now, last) {
    const det = last.a * last.d - last.b * last.c;
    if (!det) return null;
    const inv = { a: last.d / det, b: -last.b / det, c: -last.c / det, d: last.a / det,
      e: (last.c * last.f - last.d * last.e) / det, f: (last.b * last.e - last.a * last.f) / det };
    return {
      a: now.a * inv.a + now.c * inv.b, b: now.b * inv.a + now.d * inv.b,
      c: now.a * inv.c + now.c * inv.d, d: now.b * inv.c + now.d * inv.d,
      e: now.a * inv.e + now.c * inv.f + now.e, f: now.b * inv.e + now.d * inv.f + now.f,
    };
  }

  function getState() {
    const failedSources = [global.error && 'global', scenario.error && 'scenario'].filter(Boolean);
    const loadedTileCount = global.value?.getLoadedTiles().size || 0;
    return {
      status, backend: null, detail: false, missingTileCount: 0, coveredBounds: null,
      error: global.error || scenario.error,
      activeBathymetrySource: global.value ? (scenario.value ? 'merged' : 'global') : 'none',
      globalVisibleCount: status === 'ready' ? 1 : 0,
      scenarioVisibleCount: status === 'ready' && scenario.value ? 1 : 0,
      loadedTileCount,
      load: {
        status: failedSources.length ? (global.value ? 'partial' : 'error')
          : global.pending || scenario.pending ? 'loading' : global.value ? 'ready' : 'off',
        failedSources, loadedTileCount,
      },
    };
  }

  function updateStatus() {
    // A missing scenario overlay degrades to global depth instead of hiding it.
    status = global.error ? 'error'
      : global.pending || scenario.pending ? 'loading'
        : global.value ? 'ready' : 'off';
  }

  function load(target, loader, release, isCurrent) {
    if (target.value || target.pending || now() < target.retryAt) return;
    target.error = null;
    target.pending = Promise.resolve().then(loader).then((value) => {
      if (disposed || !isCurrent()) release(value);
      else target.value = value;
    }, (error) => {
      if (disposed || !isCurrent()) return;
      target.error = error instanceof Error ? error.message : String(error);
      target.retryAt = now() + LOAD_RETRY_COOLDOWN_MS;
    }).finally(() => {
      target.pending = null;
      if (disposed || !isCurrent()) return;
      updateStatus();
      onAssetsChanged('bathymetry-loaded');
    });
  }

  function releaseSource(source) {
    source.getOverview()?.close?.();
    for (const bitmap of source.getLoadedTiles().values()) bitmap.close?.();
  }

  function ensure() {
    if (disposed) return Promise.resolve(getState());
    if (!renderer) {
      renderer = createRenderer({ createCanvas });
      renderer.prewarm();
    }
    load(global, async () => {
      const source = createBathymetryTextureSource({
        manifestUrl: globalManifestUrl, fetchJson, now, maxCachedTiles,
        loadImageBitmap: async (url) => {
          if (disposed) throw new Error('Bathymetry runtime disposed');
          const bitmap = await loadImageBitmap(url);
          if (disposed) {
            bitmap.close?.();
            throw new Error('Bathymetry runtime disposed');
          }
          return bitmap;
        },
      });
      await source.load();
      return source;
    }, releaseSource, () => true);
    if (scenarioUrl) {
      const target = scenario, url = scenarioUrl;
      load(target, async () => {
        const manifest = await fetchJson(url);
        const bitmap = await loadImageBitmap(manifest.overlay.url);
        return { bitmap, bounds: manifest.bounds };
      }, (overlay) => overlay.bitmap.close?.(), () => scenario === target);
    }
    updateStatus();
    return Promise.all([global.pending, scenario.pending]).then(getState);
  }

  function setScenarioOverlayUrl(url) {
    const next = url || null;
    if (next === scenarioUrl) return;
    scenario.value?.bitmap.close?.();
    scenario = slot();
    scenarioUrl = next;
    status = 'off';
  }

  const isStyleActive = (oceanStyle, preset = oceanStyle.preset) =>
    !disposed && oceanStyle.experimentalAdvancedStyles && preset !== 'flat' && oceanStyle.opacity > 0;

  function syncProjectionParams() {
    const generation = getProjectionGeneration();
    if (projectionParams === undefined || generation !== projectionGeneration) {
      projectionParams = createProjectionInverseParams(getProjection());
      projectionGeneration = generation;
    }
    return projectionParams;
  }

  // Detail tiles for a target surface, or null when the overview should be used.
  function resolveDetailTileKeys(width, height, transform) {
    // The 5-arcminute overview holds 12 texels per degree; tiles pay off once it is magnified.
    if (!(transform.a * getProjection().scale() * Math.PI / 180 > 18)) return null;
    const { a, b, c, d, e, f } = transform, det = a * d - b * c;
    const bounds = estimateGeographicBounds(width, height, (x, y) =>
      invertProjectedPoint(projectionParams, (d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det));
    if (!bounds) return null;
    const keys = global.value.getTileKeysForBounds(bounds);
    // A view needing more tiles than the cache holds would evict visible tiles and refetch forever.
    return keys.length <= global.value.getCapacity() ? keys : null;
  }

  // Loads what a draw at this surface would need, so exports never fall back to the overview.
  async function prepareForSurface({ width, height, transform, oceanStyle }) {
    if (!isStyleActive(oceanStyle) || !syncProjectionParams()) return;
    await ensure();
    if (disposed || !global.value) return;
    const keys = resolveDetailTileKeys(width, height, transform);
    if (!keys?.length) return;
    const source = global.value, revision = source.getRevision();
    await source.requestTiles(keys);
    if (!disposed && source.getRevision() !== revision) onAssetsChanged('bathymetry-tile');
  }

  function draw(context, { oceanStyle, baseRgb, preset = oceanStyle.preset, isExport = false, reuseLastOutput = false }) {
    if (!isStyleActive(oceanStyle, preset)) {
      status = 'off';
      return getState();
    }
    if (!syncProjectionParams()) {
      status = 'unsupported-projection';
      return getState();
    }
    ensure();
    if (status !== 'ready') return getState();
    const key = [baseRgb.r, baseRgb.g, baseRgb.b, preset, oceanStyle.scale].join('|');
    if (key !== rampKey) {
      ramp = buildBathymetryColorRamp({ baseRgb, preset, scale: oceanStyle.scale });
      rampKey = key;
    }
    const transform = context.getTransform();
    // During a zoom or pan gesture the previous frame's depth image is moved
    // with the camera instead of re-shading every frame; the idle render that
    // follows the gesture produces the exact image again.
    if (reuseLastOutput && !isExport && lastOutput
      && lastOutput.width === context.canvas.width && lastOutput.height === context.canvas.height
      && lastOutput.projectionGeneration === projectionGeneration && lastOutput.rampKey === key
      && lastOutput.overlay === scenario.value && lastOutput.source === global.value) {
      const delta = deltaTransform(matrixOf(transform), lastOutput.transform);
      if (delta) {
        context.save();
        context.setTransform(delta.a, delta.b, delta.c, delta.d, delta.e, delta.f);
        context.globalAlpha = Math.max(0, Math.min(1, oceanStyle.opacity));
        context.drawImage(lastOutput.canvas, 0, 0);
        context.restore();
        return { ...getState(), backend: lastOutput.backend, detail: lastOutput.detail, reused: true,
          missingTileCount: lastOutput.missingTileCount, coveredBounds: lastOutput.coveredBounds };
      }
    }
    const detail = !!resolveDetailTileKeys(context.canvas.width, context.canvas.height, transform);
    const output = renderer.render({
      width: context.canvas.width, height: context.canvas.height, transform,
      projectionParams, source: global.value, ramp, preset, detail,
      contourStrength: oceanStyle.contourStrength, overlay: scenario.value,
      hillshadeStrength: oceanStyle.hillshadeStrength,
      hillshadeExaggeration: oceanStyle.hillshadeExaggeration,
    });
    if (output.backend === 'pending') {
      if (gpuReadyTimer === null) gpuReadyTimer = setTimeout(checkGpuReady, 50);
      return { ...getState(), backend: 'pending' };
    }
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = Math.max(0, Math.min(1, oceanStyle.opacity));
    context.drawImage(output.canvas, 0, 0);
    context.restore();
    lastOutput = { canvas: output.canvas, transform: matrixOf(transform), width: context.canvas.width,
      height: context.canvas.height, projectionGeneration, rampKey: key, overlay: scenario.value, source: global.value,
      backend: output.backend, detail, missingTileCount: output.missingTileKeys.length, coveredBounds: output.coveredBounds };
    // One repaint per batch: every arriving tile would otherwise rebuild the background pass.
    detailPending = detail && output.missingTileKeys.length > 0;
    if (detailPending && !tileBatch) {
      const source = global.value, revision = source.getRevision();
      tileBatch = source.requestTiles(output.missingTileKeys).then(() => {
        tileBatch = null;
        // Tiles in failure cooldown settle without loading; repainting then would request them again at once.
        if (!disposed && source.getRevision() !== revision) onAssetsChanged('bathymetry-tile');
      });
    }
    return { ...getState(), backend: output.backend, detail,
      missingTileCount: output.missingTileKeys.length, coveredBounds: output.coveredBounds };
  }

  function checkGpuReady() {
    gpuReadyTimer = null;
    if (renderer.isReady()) onAssetsChanged('bathymetry-gpu-ready');
    else gpuReadyTimer = setTimeout(checkGpuReady, 50);
  }

  function dispose() {
    disposed = true;
    lastOutput = null;
    clearTimeout(gpuReadyTimer);
    gpuReadyTimer = null;
    if (global.value) releaseSource(global.value);
    scenario.value?.bitmap.close?.();
    global.value = null;
    scenario.value = null;
    renderer?.dispose();
    status = 'off';
  }

  return { ensure, draw, prepareForSurface, setScenarioOverlayUrl, getState, dispose,
    hasPendingDetail: () => detailPending };
}
