export function createOceanRenderOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const runtimeState = state;
  const {
    OCEAN_MASK_MODE_BATHYMETRY = "bathymetry_features",
    OCEAN_MASK_MODE_TOPOLOGY = "topology_ocean",
    TNO_COASTAL_ACCENT_COLOR = "rgba(214, 232, 244, 0.88)",
  } = constants;
  const {
    getContext = () => null,
    getPathCanvas = () => null,
  } = getters;
  const {
    applyOceanClipMask = () => {},
    clamp = (value, min, max) => Math.max(min, Math.min(max, value)),
    clipOutAtlantropaAccentRegions = () => false,
    drawBathymetryTexture = () => ({ status: "off" }),
    getOceanStyleConfig = () => ({}),
    publishBathymetryVisibility = () => {},
    getSafeCanvasColor = (value, fallback) => value || fallback,
    getScenarioCoastalAccentOverlayFeatures = () => [],
    getScenarioCoastalAccentOverlayVisualConfig = () => ({ alpha: 0, lineWidth: 0 }),
    isScenarioCoastalAccentEnabled = () => false,
    pathBoundsInScreen = () => true,
    resolveCoastlineTopologySource = () => null,
    resolveOceanMask = () => ({ mode: OCEAN_MASK_MODE_TOPOLOGY, quality: 0 }),
  } = helpers;

  function buildCoastalAccentStrokeBuckets(entries) {
    const buckets = new Map();
    entries.forEach((entry) => {
      if (!entry?.geometry) return;
      const alpha = clamp(Number(entry.alpha) || 0, 0, 1);
      const lineWidth = Math.max(0, Number(entry.lineWidth) || 0);
      if (!(alpha > 0) || !(lineWidth > 0)) return;
      const key = `${alpha.toFixed(4)}|${lineWidth.toFixed(4)}`;
      const bucket = buckets.get(key) || {
        alpha,
        lineWidth,
        geometries: [],
      };
      bucket.geometries.push(entry.geometry);
      buckets.set(key, bucket);
    });
    return [...buckets.values()];
  }

  function drawCoastalAccentStrokeBuckets(entries, { clipAtlantropa = false } = {}) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas || !Array.isArray(entries) || !entries.length) return;
    const buckets = buildCoastalAccentStrokeBuckets(entries);
    if (!buckets.length) return;
    const coastStyle = runtimeState.styleConfig?.coastlines || {};
    const coastAccentColor = getSafeCanvasColor(coastStyle.color, TNO_COASTAL_ACCENT_COLOR);
    const coastAccentOpacity = clamp(
      Number.isFinite(Number(coastStyle.opacity)) ? Number(coastStyle.opacity) : 0.8,
      0,
      1
    );
    const coastAccentWidthScale = clamp(
      (Number.isFinite(Number(coastStyle.width)) ? Number(coastStyle.width) : 1.2) / 1.2,
      0.1,
      3
    );
    buckets.forEach((bucket) => {
      context.save();
      if (clipAtlantropa) {
        clipOutAtlantropaAccentRegions();
      }
      context.strokeStyle = coastAccentColor;
      context.globalAlpha = bucket.alpha * coastAccentOpacity;
      context.lineWidth = bucket.lineWidth * coastAccentWidthScale;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      bucket.geometries.forEach((geometry) => {
        pathCanvas(geometry);
      });
      context.stroke();
      context.restore();
    });
  }

  function drawScenarioCoastalAccentOverlays(k, { interactive = false } = {}) {
    const shorelineFeatures = getScenarioCoastalAccentOverlayFeatures();
    if (!shorelineFeatures.length) return;
    const entries = [];
    shorelineFeatures.forEach((feature) => {
      if (!pathBoundsInScreen(feature)) return;
      const visualConfig = getScenarioCoastalAccentOverlayVisualConfig(feature, k, { interactive });
      entries.push({
        geometry: feature,
        alpha: visualConfig.alpha,
        lineWidth: visualConfig.lineWidth,
      });
    });
    drawCoastalAccentStrokeBuckets(entries);
  }

  function drawScenarioCoastalAccentLayer(k, { interactive = false } = {}) {
    const context = getContext();
    if (!context || !isScenarioCoastalAccentEnabled()) return;
    const coastlineDecision = resolveCoastlineTopologySource();
    const usesScenarioCoastlineSource = coastlineDecision?.source === "scenario";
    if (!usesScenarioCoastlineSource) {
      drawScenarioCoastalAccentOverlays(k, { interactive });
    }
  }

  function drawOceanStyle() {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas) return;
    const oceanStyle = getOceanStyleConfig();
    const visibility = { status: "off", lod: "overview", backend: null, missingTileCount: 0,
      loadedTileCount: 0, globalVisibleCount: 0, scenarioVisibleCount: 0, visibleCount: 0 };
    runtimeState.oceanMaskMode = OCEAN_MASK_MODE_TOPOLOGY;
    runtimeState.oceanMaskQuality = 0;
    if (!oceanStyle.experimentalAdvancedStyles || oceanStyle.preset === "flat") {
      publishBathymetryVisibility(visibility);
      return;
    }
    if (oceanStyle.opacity <= 0) {
      publishBathymetryVisibility({ ...visibility, status: "hidden" });
      return;
    }
    const { mode: clipMaskMode } = resolveOceanMask();
    context.save();
    applyOceanClipMask(clipMaskMode);
    const result = drawBathymetryTexture(oceanStyle);
    context.restore();
    const ready = result.status === "ready";
    if (ready) {
      runtimeState.oceanMaskMode = OCEAN_MASK_MODE_BATHYMETRY;
      runtimeState.oceanMaskQuality = 1;
    }
    publishBathymetryVisibility({
      ...visibility,
      status: result.status === "unsupported-projection" ? "unsupported" : result.status,
      lod: result.detail ? "detail" : "overview",
      backend: result.backend ?? null,
      missingTileCount: result.missingTileCount ?? 0,
      loadedTileCount: result.loadedTileCount ?? 0,
      visibleCount: ready ? 1 : 0,
      globalVisibleCount: ready ? result.globalVisibleCount ?? 1 : 0,
      scenarioVisibleCount: ready ? result.scenarioVisibleCount ?? 0 : 0,
    });
  }

  return {
    buildCoastalAccentStrokeBuckets,
    drawCoastalAccentStrokeBuckets,
    drawOceanStyle,
    drawScenarioCoastalAccentLayer,
    drawScenarioCoastalAccentOverlays,
  };
}
