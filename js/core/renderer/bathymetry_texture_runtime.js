import { createProjectionInverseParams } from './bathymetry_texture_math.js';
import { buildBathymetryColorRamp } from './bathymetry_texture_palette.js';
import { createBathymetryTextureSource } from './bathymetry_texture_source.js';
import { createBathymetryTextureRenderer } from './bathymetry_texture_renderer.js';

const LOAD_RETRY_COOLDOWN_MS = 10_000;

export function createBathymetryTextureRuntime({
  globalManifestUrl, fetchJson, loadImageBitmap, createCanvas,
  getProjection, getProjectionGeneration, onAssetsChanged = () => {}, now = Date.now,
  createRenderer = createBathymetryTextureRenderer,
}) {
  const slot = () => ({ value: null, pending: null, error: null, retryAt: 0 });
  const global = slot();
  let scenario = slot(), scenarioUrl = null, renderer = null, disposed = false;
  let status = 'off', projectionGeneration, projectionParams, rampKey, ramp;
  let tileBatch = null;

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
    load(global, async () => {
      const source = createBathymetryTextureSource({
        manifestUrl: globalManifestUrl, fetchJson, now,
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

  function draw(context, { oceanStyle, baseRgb, preset = oceanStyle.preset, isExport = false }) {
    if (disposed || !oceanStyle.experimentalAdvancedStyles || preset === 'flat' || oceanStyle.opacity <= 0) {
      status = 'off';
      return getState();
    }
    const projection = getProjection(), generation = getProjectionGeneration();
    if (projectionParams === undefined || generation !== projectionGeneration) {
      projectionParams = createProjectionInverseParams(projection);
      projectionGeneration = generation;
    }
    if (!projectionParams) {
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
    renderer ||= createRenderer({ createCanvas });
    const transform = context.getTransform();
    // The 5-arcminute overview holds 12 texels per degree; tiles pay off once it is magnified.
    const detail = transform.a * projection.scale() * Math.PI / 180 > 18;
    const output = renderer.render({
      width: context.canvas.width, height: context.canvas.height, transform,
      projectionParams, source: global.value, ramp, preset, detail,
      contourStrength: oceanStyle.contourStrength, overlay: scenario.value,
      hillshadeStrength: oceanStyle.hillshadeStrength,
      hillshadeExaggeration: oceanStyle.hillshadeExaggeration,
    });
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = Math.max(0, Math.min(1, oceanStyle.opacity));
    context.drawImage(output.canvas, 0, 0);
    context.restore();
    // One repaint per batch: every arriving tile would otherwise rebuild the background pass.
    if (output.missingTileKeys.length && !tileBatch) {
      tileBatch = global.value.requestTiles(output.missingTileKeys).then(() => {
        tileBatch = null;
        if (!disposed) onAssetsChanged('bathymetry-tile');
      });
    }
    return { ...getState(), backend: output.backend, detail,
      missingTileCount: output.missingTileKeys.length, coveredBounds: output.coveredBounds };
  }

  function dispose() {
    disposed = true;
    if (global.value) releaseSource(global.value);
    scenario.value?.bitmap.close?.();
    global.value = null;
    scenario.value = null;
    renderer?.dispose();
    status = 'off';
  }

  return { ensure, draw, setScenarioOverlayUrl, getState, dispose };
}
