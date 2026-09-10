export function createOceanRenderOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const runtimeState = state;
  const {
    COASTLINE_ACCENT_DENSITY_ALPHA_LOW = 0.68,
    COASTLINE_ACCENT_DENSITY_ALPHA_MID = 0.82,
    COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW = 0.0016,
    COASTLINE_ACCENT_DENSITY_THRESHOLD_MID = 0.0022,
    COASTLINE_ACCENT_DENSITY_WIDTH_SCALE = 0.9,
    COASTLINE_LOD_LOW_ZOOM_MAX = 1.8,
    COASTLINE_LOD_MID_ZOOM_MAX = 3.2,
    OCEAN_MASK_MODE_BATHYMETRY = "bathymetry_features",
    OCEAN_MASK_MODE_TOPOLOGY = "topology_ocean",
    TNO_COASTAL_ACCENT_COLOR = "rgba(214, 232, 244, 0.88)",
  } = constants;
  const {
    getContext = () => null,
    getPathCanvas = () => null,
  } = getters;
  const {
    applyBathymetryCoverageExclusionMask = () => {},
    applyOceanClipMask = () => {},
    clamp = (value, min, max) => Math.max(min, Math.min(max, value)),
    clipOutAtlantropaAccentRegions = () => false,
    doesOceanStyleRequireBathymetry = () => false,
    ensureBathymetryDataAvailability = () => {},
    getBathymetryBandFillStyle = () => "rgba(0, 0, 0, 0)",
    getBathymetryBandVisibilityConfig = () => ({ alpha: 1 }),
    getBathymetryCollectionBySource = () => null,
    getBathymetryContourStrokeStyle = () => "rgba(0, 0, 0, 0)",
    getBathymetryContourVisibilityConfig = () => ({ alpha: 1 }),
    getBathymetryFeatureCollections = () => ({}),
    getBathymetryFeatureDepthMax = () => 0,
    getBathymetryPresetProfile = () => ({}),
    getCoastlineCollectionForZoom = () => [],
    getOceanStyleConfig = () => ({}),
    getProjectedGeographicPath = () => null,
    collectContextMetric = () => {},
    nowMs = () => Date.now(),
    getProjectedLineDensityStats = () => ({ density: 0 }),
    getSafeCanvasColor = (value, fallback) => value || fallback,
    getScenarioCoastalAccentLineWidth = () => 1,
    getScenarioCoastalAccentOverlayFeatures = () => [],
    getScenarioCoastalAccentOverlayVisualConfig = () => ({ alpha: 0, lineWidth: 0 }),
    getViewportAwareCoastlineCollection = (collection) => collection || [],
    isScenarioCoastalAccentEnabled = () => false,
    isUsableMesh = () => false,
    pathBoundsInScreen = () => true,
    resolveCoastlineTopologySource = () => null,
    resolveOceanMask = () => ({ mode: OCEAN_MASK_MODE_TOPOLOGY, quality: 0 }),
    sortBathymetryFeaturesForFill = (collection) => Array.isArray(collection?.features) ? collection.features : [],
  } = helpers;

  function isHgoVectorSceneActive() {
    const manifest = runtimeState?.activeScenarioManifest || {};
    const profile = String(manifest.scenario_contract_profile || "").trim();
    if (profile === "hgo_vector") return true;
    const performanceHints = manifest.performance_hints && typeof manifest.performance_hints === "object"
      ? manifest.performance_hints
      : {};
    return performanceHints.hgo_vector_scene_default === true;
  }

  function drawBathymetryBands(collection, oceanStyle) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas) return;
    const zoomK = Number(runtimeState.zoomTransform?.k) || 1;
    const features = sortBathymetryFeaturesForFill(collection);
    const startedAt = nowMs();
    let renderedCount = 0;
    features.forEach((feature) => {
      const visibilityConfig = getBathymetryBandVisibilityConfig(feature, zoomK);
      if (visibilityConfig.alpha <= 0) return;
      if (!pathBoundsInScreen(feature)) return;
      context.save();
      context.globalAlpha *= visibilityConfig.alpha;
      context.fillStyle = getBathymetryBandFillStyle(feature, oceanStyle);
      const path = getProjectedGeographicPath(feature);
      if (path) {
        context.fill(path);
      } else {
        context.beginPath();
        pathCanvas(feature);
        context.fill();
      }
      context.restore();
      renderedCount += 1;
    });
    collectContextMetric("drawBathymetryBands", nowMs() - startedAt, { featureCount: features.length, renderedCount });
  }

  function buildVisibleBathymetryContourDepthSet(collection, oceanStyle) {
    const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
    if (!profile?.skipAlternateContourDepths || !Array.isArray(collection?.features)) {
      return null;
    }
    const uniqueDepths = [...new Set(collection.features.map((feature) => getBathymetryFeatureDepthMax(feature)))]
      .filter((depth) => depth > 0)
      .sort((a, b) => a - b);
    if (!uniqueDepths.length) return null;
    return new Set(uniqueDepths.filter((_, index) => index % 2 === 0));
  }

  function drawBathymetryContours(collection, oceanStyle) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas || !Array.isArray(collection?.features) || !collection.features.length) return;
    const zoomK = Number(runtimeState.zoomTransform?.k) || 1;
    const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
    const lineWidthBase = (profile?.contourLineWidthBase ?? 0.45)
      + oceanStyle.contourStrength * (profile?.contourLineWidthScale ?? 0.75);
    const visibleDepths = buildVisibleBathymetryContourDepthSet(collection, oceanStyle);
    const startedAt = nowMs();
    let renderedCount = 0;
    collection.features.forEach((feature) => {
      if (visibleDepths && !visibleDepths.has(getBathymetryFeatureDepthMax(feature))) {
        return;
      }
      const visibilityConfig = getBathymetryContourVisibilityConfig(feature, zoomK);
      if (visibilityConfig.alpha <= 0) return;
      if (!pathBoundsInScreen(feature)) return;
      context.save();
      context.globalAlpha *= visibilityConfig.alpha;
      context.strokeStyle = getBathymetryContourStrokeStyle(feature, oceanStyle);
      context.lineWidth = lineWidthBase;
      const path = getProjectedGeographicPath(feature);
      if (path) {
        context.stroke(path);
      } else {
        context.beginPath();
        pathCanvas(feature);
        context.stroke();
      }
      context.restore();
      renderedCount += 1;
    });
    collectContextMetric("drawBathymetryContours", nowMs() - startedAt, { featureCount: collection.features.length, renderedCount });
  }

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
    if (isHgoVectorSceneActive()) return;
    if (!context || !isScenarioCoastalAccentEnabled()) return;
    const coastlineDecision = resolveCoastlineTopologySource();
    const usesScenarioCoastlineSource = coastlineDecision?.source === "scenario";
    const baseCoastlineCollection = getCoastlineCollectionForZoom(k);
    const coastlineCollection = interactive
      ? baseCoastlineCollection
      : getViewportAwareCoastlineCollection(baseCoastlineCollection, k);
    const coastlineWidth = getScenarioCoastalAccentLineWidth(k, { interactive });
    const densityThreshold = k < COASTLINE_LOD_LOW_ZOOM_MAX
      ? COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW
      : k < COASTLINE_LOD_MID_ZOOM_MAX
        ? COASTLINE_ACCENT_DENSITY_THRESHOLD_MID
        : Infinity;
    const entries = [];
    coastlineCollection.forEach((mesh) => {
      if (!isUsableMesh(mesh)) return;
      mesh.coordinates.forEach((line) => {
        const densityStats = interactive
          ? { density: 0 }
          : getProjectedLineDensityStats(line);
        const densityScale = densityStats.density > densityThreshold
          ? (k < COASTLINE_LOD_LOW_ZOOM_MAX ? COASTLINE_ACCENT_DENSITY_ALPHA_LOW : COASTLINE_ACCENT_DENSITY_ALPHA_MID)
          : 1;
        entries.push({
          geometry: {
            type: "LineString",
            coordinates: line,
          },
          alpha: (interactive ? 0.28 : 0.4) * densityScale,
          lineWidth: coastlineWidth * (densityScale < 1 ? COASTLINE_ACCENT_DENSITY_WIDTH_SCALE : 1),
        });
      });
    });
    drawCoastalAccentStrokeBuckets(entries, { clipAtlantropa: !usesScenarioCoastlineSource });
    if (!usesScenarioCoastlineSource) {
      drawScenarioCoastalAccentOverlays(k, { interactive });
    }
  }

  function drawOceanStyle() {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas) return;
    const oceanStyle = getOceanStyleConfig();
    const bathymetryRequired = doesOceanStyleRequireBathymetry(oceanStyle);
    ensureBathymetryDataAvailability({
      required: bathymetryRequired,
    });
    if (!oceanStyle.experimentalAdvancedStyles) {
      runtimeState.oceanMaskMode = OCEAN_MASK_MODE_TOPOLOGY;
      runtimeState.oceanMaskQuality = 0;
      return;
    }
    if (oceanStyle.preset === "flat") {
      runtimeState.oceanMaskMode = OCEAN_MASK_MODE_TOPOLOGY;
      runtimeState.oceanMaskQuality = 0;
      return;
    }
    const bathymetryData = getBathymetryFeatureCollections();
    const hasBands = Array.isArray(bathymetryData.bands?.features) && bathymetryData.bands.features.length > 0;
    const hasContours =
      Array.isArray(bathymetryData.contours?.features) && bathymetryData.contours.features.length > 0;
    if (!hasBands && !hasContours) {
      runtimeState.oceanMaskMode = OCEAN_MASK_MODE_TOPOLOGY;
      runtimeState.oceanMaskQuality = 0;
      return;
    }

    const { mode: clipMaskMode } = resolveOceanMask();
    const globalBands = getBathymetryCollectionBySource(bathymetryData.bands, "global");
    const scenarioBands = getBathymetryCollectionBySource(bathymetryData.bands, "scenario");
    const globalContours = getBathymetryCollectionBySource(bathymetryData.contours, "global");
    const scenarioContours = getBathymetryCollectionBySource(bathymetryData.contours, "scenario");
    const scenarioCoverage = bathymetryData.scenarioCoverage;

    context.save();
    applyOceanClipMask(clipMaskMode);
    if (Array.isArray(globalBands?.features) && globalBands.features.length) {
      context.save();
      applyBathymetryCoverageExclusionMask(scenarioCoverage);
      drawBathymetryBands(globalBands, oceanStyle);
      context.restore();
    }
    if (Array.isArray(scenarioBands?.features) && scenarioBands.features.length) {
      drawBathymetryBands(scenarioBands, oceanStyle);
    }
    if (Array.isArray(globalContours?.features) && globalContours.features.length) {
      context.save();
      applyBathymetryCoverageExclusionMask(scenarioCoverage);
      drawBathymetryContours(globalContours, oceanStyle);
      context.restore();
    }
    if (Array.isArray(scenarioContours?.features) && scenarioContours.features.length) {
      drawBathymetryContours(scenarioContours, oceanStyle);
    }
    context.restore();
    runtimeState.oceanMaskMode = OCEAN_MASK_MODE_BATHYMETRY;
    runtimeState.oceanMaskQuality = 1;
  }

  return {
    buildCoastalAccentStrokeBuckets,
    buildVisibleBathymetryContourDepthSet,
    drawBathymetryBands,
    drawBathymetryContours,
    drawCoastalAccentStrokeBuckets,
    drawOceanStyle,
    drawScenarioCoastalAccentLayer,
    drawScenarioCoastalAccentOverlays,
  };
}
