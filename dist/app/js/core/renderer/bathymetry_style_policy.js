export const COASTLINE_LOD_LOW_ZOOM_MAX = 1.8;
export const COASTLINE_LOD_MID_ZOOM_MAX = 3.2;
export const COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW = 0.0016;
export const COASTLINE_ACCENT_DENSITY_THRESHOLD_MID = 0.0022;
const COASTLINE_OVERLAY_ATLANTROPA_ALPHA = 0.42;
const COASTLINE_OVERLAY_ATLANTROPA_ALPHA_INTERACTIVE = 0.30;
const COASTLINE_OVERLAY_DENSITY_ALPHA_LOW = 0.78;
const COASTLINE_OVERLAY_DENSITY_ALPHA_MID = 0.86;
const COASTLINE_ACCENT_MIN_WIDTH_PX = 0.85;
const COASTLINE_ACCENT_OVERLAY_MIN_WIDTH_PX = 0.95;
const BATHYMETRY_SHALLOW_DEPTH_MAX_M = 200;
const BATHYMETRY_MID_DEPTH_MAX_M = 500;
const BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM = 2.0;
const BATHYMETRY_BAND_SHALLOW_FADE_END_ZOOM = 2.8;
const BATHYMETRY_BAND_MID_FADE_START_ZOOM = 2.6;
const BATHYMETRY_BAND_MID_FADE_END_ZOOM = 3.4;
const BATHYMETRY_BAND_DEEP_FADE_START_ZOOM = COASTLINE_LOD_MID_ZOOM_MAX;
const BATHYMETRY_BAND_DEEP_FADE_END_ZOOM = 4.2;
const BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM = 2.0;
const BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_END_ZOOM = 3.0;
const BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM = 2.4;
const BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_END_ZOOM = 3.4;
const BATHYMETRY_MAX_REFERENCE_DEPTH_M = 6000;
const BATHYMETRY_DEPTH_STOPS = Object.freeze([
  [0, 0], [50, 0.14], [100, 0.25], [200, 0.38],
  [500, 0.50], [1000, 0.61], [2000, 0.73], [4000, 0.89], [6000, 1],
]);
const BATHYMETRY_BAND_ZOOM_FLOOR = 0.72;
const BATHYMETRY_SCENARIO_CONTOUR_ZOOM_FLOOR = 0.45;

// Owns bathymetry style policy decisions; inputs remain live.
export function createBathymetryStylePolicy(runtimeState, {
  buildBathymetryFeatureCollection,
  clamp,
  getBathymetryPresetProfile,
  getFeatureProjectedDensity,
  getOceanBaseFillColor,
  getReliefOverlayKind,
  parseCanvasColorChannels,
  toRgbaString,
}) {
  // Decoded bathymetry collections are replaced, not edited in place. Track the
  // features array as well as its wrapper so a replacement invalidates results.
  const sourceCollections = new WeakMap();
  const sortedCollections = new WeakMap();

  function getBathymetryFeatureDepthMax(feature) {
    const rawValue = Number(
      feature?.properties?.depth_max_m ??
      feature?.properties?.depth_m ??
      feature?.properties?.max_depth_m ??
      0
    );
    return Number.isFinite(rawValue) ? Math.max(0, Math.abs(rawValue)) : 0;
  }

  function interpolateRgbChannels(startRgb, endRgb, ratio) {
    const tRatio = clamp(Number(ratio) || 0, 0, 1);
    return {
      r: Math.round(startRgb.r + (endRgb.r - startRgb.r) * tRatio),
      g: Math.round(startRgb.g + (endRgb.g - startRgb.g) * tRatio),
      b: Math.round(startRgb.b + (endRgb.b - startRgb.b) * tRatio),
    };
  }

  function getBathymetryBaseRgb() {
    const oceanChannels = parseCanvasColorChannels(getOceanBaseFillColor());
    if (oceanChannels) {
      return {
        r: oceanChannels.r,
        g: oceanChannels.g,
        b: oceanChannels.b,
      };
    }
    return { r: 170, g: 218, b: 255 };
  }

  function isAtlantropaBathymetryFeature(feature) {
    return String(feature?.properties?.region_group || "").trim().toLowerCase().startsWith("atlantropa_");
  }

  function getBathymetryVisualModifiers(feature) {
    const source = String(feature?.properties?._bathymetrySource || "").trim().toLowerCase();
    const depthMax = getBathymetryFeatureDepthMax(feature);
    if (source !== "scenario") {
      return {
        bandBrightness: 1,
        bandAlpha: 1,
        contourBrightness: 1,
        contourAlpha: 1,
      };
    }

    // Scenario depths are schematic geometry, including "observed" TNO polygons.
    const shallowScale = depthMax <= 150 ? 0.92 : 1;
    return {
      bandBrightness: 0.76 * shallowScale,
      bandAlpha: 0.72 * shallowScale,
      contourBrightness: 0.72 * shallowScale,
      contourAlpha: 0.62 * shallowScale,
    };
  }

  function getBathymetryDepthTone(depth, oceanStyle) {
    const boundedDepth = clamp(depth, 0, BATHYMETRY_MAX_REFERENCE_DEPTH_M);
    const discrete = oceanStyle.bathymetryProfile?.paletteMode === "discrete"
      || (oceanStyle.bathymetryProfile?.paletteMode == null && oceanStyle.preset === "bathymetry_contours");
    let index = BATHYMETRY_DEPTH_STOPS.findIndex(([stop]) => stop >= boundedDepth);
    if (index < 0) index = BATHYMETRY_DEPTH_STOPS.length - 1;
    const [endDepth, endTone] = BATHYMETRY_DEPTH_STOPS[index];
    const [startDepth, startTone] = BATHYMETRY_DEPTH_STOPS[Math.max(0, index - 1)];
    const tone = discrete || endDepth === startDepth
      ? endTone
      : startTone + (endTone - startTone) * (boundedDepth - startDepth) / (endDepth - startDepth);
    const scale = clamp(Number(oceanStyle.scale) || 1, 0.6, 2.4);
    return clamp(0.5 + (tone - 0.5) * scale, 0, 1);
  }

  function getBathymetryPaletteRgb(baseRgb, tone) {
    const baseLuminance = (0.2126 * baseRgb.r + 0.7152 * baseRgb.g + 0.0722 * baseRgb.b) / 255;
    const shallowRgb = interpolateRgbChannels(baseRgb, { r: 225, g: 243, b: 250 }, baseLuminance < 0.4 ? 0.42 : 0.36);
    const deepRgb = interpolateRgbChannels(baseRgb, { r: 9, g: 37, b: 68 }, baseLuminance < 0.4 ? 0.64 : 0.86);
    return interpolateRgbChannels(shallowRgb, deepRgb, tone);
  }

  function getBathymetryBandFillStyle(feature, oceanStyle) {
    const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
    const baseRgb = getBathymetryBaseRgb();
    const depthTone = getBathymetryDepthTone(getBathymetryFeatureDepthMax(feature), oceanStyle);
    const visualModifiers = getBathymetryVisualModifiers(feature);
    const fillRgb = interpolateRgbChannels(
      baseRgb,
      getBathymetryPaletteRgb(baseRgb, depthTone),
      visualModifiers.bandBrightness
    );
    const alphaBase = profile?.bandAlphaBase ?? 0.64;
    const alpha = clamp(
      oceanStyle.opacity * alphaBase * visualModifiers.bandAlpha,
      0,
      0.96
    );
    return toRgbaString(fillRgb, alpha);
  }

  function getBathymetryContourStrokeStyle(feature, oceanStyle) {
    const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
    const baseRgb = getBathymetryBaseRgb();
    const depthTone = getBathymetryDepthTone(getBathymetryFeatureDepthMax(feature), oceanStyle);
    const visualModifiers = getBathymetryVisualModifiers(feature);
    const strokeRgb = interpolateRgbChannels(
      baseRgb,
      getBathymetryPaletteRgb(baseRgb, depthTone),
      visualModifiers.contourBrightness
    );
    const alphaBase = profile?.contourAlphaBase ?? 0.4;
    const alpha = clamp(
      oceanStyle.opacity * alphaBase * clamp(Number(oceanStyle.contourStrength) || 0, 0, 1)
        * visualModifiers.contourAlpha,
      0,
      0.92
    );
    return toRgbaString(strokeRgb, alpha);
  }

  function sortBathymetryFeaturesForFill(collection) {
    if (!Array.isArray(collection?.features)) return [];
    const cached = sortedCollections.get(collection);
    if (cached?.features === collection.features) return cached.sorted;
    const sorted = [...collection.features].sort((a, b) => getBathymetryFeatureDepthMax(b) - getBathymetryFeatureDepthMax(a));
    sortedCollections.set(collection, { features: collection.features, sorted });
    return sorted;
  }

  function getBathymetryTuningConfig() {
    const ocean = runtimeState.styleConfig?.ocean || {};
    const shallowBandFadeEndZoom = clamp(
      Number.isFinite(Number(ocean.shallowBandFadeEndZoom)) ? Number(ocean.shallowBandFadeEndZoom) : BATHYMETRY_BAND_SHALLOW_FADE_END_ZOOM,
      BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM + 0.1,
      4.8
    );
    const midBandFadeEndZoom = clamp(
      Number.isFinite(Number(ocean.midBandFadeEndZoom)) ? Number(ocean.midBandFadeEndZoom) : BATHYMETRY_BAND_MID_FADE_END_ZOOM,
      BATHYMETRY_BAND_MID_FADE_START_ZOOM + 0.1,
      5.2
    );
    const deepBandFadeEndZoom = clamp(
      Number.isFinite(Number(ocean.deepBandFadeEndZoom)) ? Number(ocean.deepBandFadeEndZoom) : BATHYMETRY_BAND_DEEP_FADE_END_ZOOM,
      BATHYMETRY_BAND_DEEP_FADE_START_ZOOM + 0.1,
      6
    );
    const scenarioSyntheticContourFadeEndZoom = clamp(
      Number.isFinite(Number(ocean.scenarioSyntheticContourFadeEndZoom))
        ? Number(ocean.scenarioSyntheticContourFadeEndZoom)
        : BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_END_ZOOM,
      BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM + 0.1,
      4.6
    );
    const scenarioShallowContourFadeEndZoom = clamp(
      Number.isFinite(Number(ocean.scenarioShallowContourFadeEndZoom))
        ? Number(ocean.scenarioShallowContourFadeEndZoom)
        : BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_END_ZOOM,
      BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM + 0.1,
      5
    );
    return {
      shallowBandFadeEndZoom,
      midBandFadeEndZoom,
      deepBandFadeEndZoom,
      scenarioSyntheticContourFadeEndZoom,
      scenarioShallowContourFadeEndZoom,
    };
  }

  function getZoomFadeFactor(k, fadeStartZoom, fadeEndZoom) {
    if (!(k >= fadeStartZoom)) {
      return 1;
    }
    if (k >= fadeEndZoom) {
      return 0;
    }
    return clamp(
      1 - (k - fadeStartZoom) / Math.max(0.0001, fadeEndZoom - fadeStartZoom),
      0,
      1
    );
  }

  function getBathymetryBandVisibilityConfig(feature, k) {
    const tuning = getBathymetryTuningConfig();
    const depthMax = getBathymetryFeatureDepthMax(feature);
    if (depthMax <= BATHYMETRY_SHALLOW_DEPTH_MAX_M) {
      return { alpha: Math.max(BATHYMETRY_BAND_ZOOM_FLOOR, getZoomFadeFactor(k, BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM, tuning.shallowBandFadeEndZoom)) };
    }
    if (depthMax <= BATHYMETRY_MID_DEPTH_MAX_M) {
      return { alpha: Math.max(BATHYMETRY_BAND_ZOOM_FLOOR, getZoomFadeFactor(k, BATHYMETRY_BAND_MID_FADE_START_ZOOM, tuning.midBandFadeEndZoom)) };
    }
    return { alpha: Math.max(BATHYMETRY_BAND_ZOOM_FLOOR, getZoomFadeFactor(k, BATHYMETRY_BAND_DEEP_FADE_START_ZOOM, tuning.deepBandFadeEndZoom)) };
  }

  function getBathymetryContourVisibilityConfig(feature, k) {
    const tuning = getBathymetryTuningConfig();
    const source = String(feature?.properties?._bathymetrySource || "").trim().toLowerCase();
    if (source !== "scenario") {
      return { alpha: 1 };
    }
    const mode = String(feature?.properties?.bathymetry_mode || "").trim().toLowerCase();
    if (mode === "synthetic" || getBathymetryFeatureDepthMax(feature) > BATHYMETRY_SHALLOW_DEPTH_MAX_M) {
      return {
        alpha: Math.max(BATHYMETRY_SCENARIO_CONTOUR_ZOOM_FLOOR, getZoomFadeFactor(
          k,
          BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM,
          tuning.scenarioSyntheticContourFadeEndZoom
        )),
      };
    }
    if (getBathymetryFeatureDepthMax(feature) <= BATHYMETRY_SHALLOW_DEPTH_MAX_M) {
      return {
        alpha: Math.max(BATHYMETRY_SCENARIO_CONTOUR_ZOOM_FLOOR, getZoomFadeFactor(
          k,
          BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM,
          tuning.scenarioShallowContourFadeEndZoom
        )),
      };
    }
    return { alpha: 1 };
  }

  function getBathymetryCollectionBySource(collection, source) {
    if (!Array.isArray(collection?.features)) return null;
    let cached = sourceCollections.get(collection);
    if (!cached || cached.features !== collection.features) {
      cached = { features: collection.features, bySource: new Map() };
      sourceCollections.set(collection, cached);
    }
    if (!cached.bySource.has(source)) {
      cached.bySource.set(source, buildBathymetryFeatureCollection(
        collection.features.filter((feature) => String(feature?.properties?._bathymetrySource || "") === source)
      ));
    }
    return cached.bySource.get(source);
  }

  function getScenarioCoastalAccentLineWidth(k, { interactive = false, overlay = false } = {}) {
    const baseWidth = overlay
      ? 1.22 / Math.max(0.0001, k)
      : (interactive ? 1.05 : 1.28) / Math.max(0.0001, k);
    if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
      return baseWidth;
    }
    return Math.max(baseWidth, overlay ? COASTLINE_ACCENT_OVERLAY_MIN_WIDTH_PX : COASTLINE_ACCENT_MIN_WIDTH_PX);
  }

  function isAtlantropaScenarioShorelineOverlay(feature) {
    if (getReliefOverlayKind(feature) !== "new_shoreline") return false;
    return String(feature?.properties?.parent_id || "").trim().toLowerCase().startsWith("atlantropa_");
  }

  function getScenarioCoastalAccentOverlayVisualConfig(feature, k, { interactive = false } = {}) {
    const isAtlantropa = isAtlantropaScenarioShorelineOverlay(feature);
    let alpha = interactive ? 0.38 : 0.62;
    if (isAtlantropa) {
      alpha = interactive
        ? COASTLINE_OVERLAY_ATLANTROPA_ALPHA_INTERACTIVE
        : COASTLINE_OVERLAY_ATLANTROPA_ALPHA;
      if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
        const densityThreshold = k < COASTLINE_LOD_LOW_ZOOM_MAX
          ? COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW
          : COASTLINE_ACCENT_DENSITY_THRESHOLD_MID;
        const densityAlpha = k < COASTLINE_LOD_LOW_ZOOM_MAX
          ? COASTLINE_OVERLAY_DENSITY_ALPHA_LOW
          : COASTLINE_OVERLAY_DENSITY_ALPHA_MID;
        if (getFeatureProjectedDensity(feature) > densityThreshold) {
          alpha *= densityAlpha;
        }
      }
    }
    return {
      alpha,
      lineWidth: getScenarioCoastalAccentLineWidth(k, { interactive, overlay: true }),
    };
  }

  return Object.freeze({ getBathymetryFeatureDepthMax, isAtlantropaBathymetryFeature, getBathymetryBandFillStyle, getBathymetryContourStrokeStyle, sortBathymetryFeaturesForFill, getBathymetryBandVisibilityConfig, getBathymetryContourVisibilityConfig, getBathymetryCollectionBySource, getScenarioCoastalAccentLineWidth, getScenarioCoastalAccentOverlayVisualConfig });
}
