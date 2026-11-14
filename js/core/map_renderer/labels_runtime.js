import { lazyOwner } from "./lazy_owner.js";
import { getMapLabelHierarchy } from "../renderer/map_label_hierarchy.js";
import { getProjectionGeometryGeneration } from "../renderer/projection_geometry_identity.js";
import { createMarineLabelOwner, shouldShowMarineRegionNames } from "../renderer/marine_label_owner.js";
import { createUrbanAdaptivePaintModel } from "../renderer/urban_adaptive_paint_model.js";
import { createCityLabelTextModel } from "../renderer/city_label_text_model.js";
import { createCityGeometryPresentation } from "../renderer/city_geometry_presentation.js";
import { createCountryLabelSourceOwner } from "../renderer/country_label_source.js";
import { createCountryLabelRenderOwner, waitForCountryLabelsForExport } from "../renderer/country_label_render_owner.js";
import { createUrbanLayerRenderOwner } from "../renderer/urban_layer_render_owner.js";
import {
  getCityCanonicalId,
  getCityTier,
  getCityTierWeight,
  getDefaultCityMinZoomForTier,
  getCityEffectiveMinZoom,
  getUrbanFeatureStableId,
  getCityCapitalScore,
  getCitySortWeight,
  isCityScenarioTagExcludedFromReveal,
  getCityRevealPhase,
  getCityRevealPhaseInterpolation,
  getCityRevealBucket,
  getCityMarkerDensityMultiplier,
  getCityInterpolatedMarkerQuota,
  getCityInterpolatedMarkerBudget,
  getCityPriorityCountryReserveBudget,
  getCityPriorityCountryReserveRank,
  compareCityRevealEntries,
  getCityLabelBudget,
  isCityLabelEligibleForPhase,
  getCityLabelMinZoom,
  getCityMarkerSizePx,
  CITY_COUNTRY_TIER_RANK,
  CITY_COUNTRY_CLASS_RANK,
  CITY_MARKER_SIZE_LIMITS_PX,
} from "../renderer/city_reveal_policy.js";
import { normalizeCityLayerStyleConfig, normalizeMapSemanticMode, normalizeUrbanStyleConfig } from "../state.js";
import { getCanvasColorRelativeLuminance, getSafeCanvasColor } from "../renderer/canvas_color_helpers.js";
import { getGeoFeatureDisplayLabel, getPreferredGeoLabel, getStrictGeoLabel, renderTooltipText, t } from "../i18n.js";
import { getLocalizedScenarioCountryName } from "../scenario/scenario_country_display.js";
import { callRuntimeHook } from "../state/index.js";
import { createUrbanCityPolicyOwner } from "../renderer/urban_city_policy.js";
import { createCityPaintStyleModel } from "../renderer/city_paint_style_model.js";
import { createCityLabelOwner } from "../renderer/city_label_owner.js";
import { createCityPointsRenderOwner } from "../renderer/city_points_render_owner.js";
const CITY_MARKER_THEME_GRAPHITE = "classic_graphite";
const CITY_REVEAL_PROFILE_HYBRID = "hybrid_country_budget";

export function createLabelsRuntime({
  runtimeState,
  rendererSurfaceHost,
  TEXTURE_LABEL_SERIF_STACK,
  clamp,
  normalizeLongitude,
  getDisplayOwnerCode,
  getResolvedFeatureColor,
  getSignedHashUnit,
  collectContextMetric,
  recordInteractionDurationMetric,
  recordRenderPerfMetric,
  nowMs,
  getFeatureCollectionFeatureCount,
  getFeatureId,
  getUrbanGlowFeatureMultiplier,
  getUrbanLayerCapability,
  getSafeBlendMode,
  estimateProjectedAreaPx,
  pathBoundsInScreen,
  isOpenOceanRenderable,
  isWaterRegionRenderable,
  getProjectedFeatureBounds,
  projectedGeoBoundsInScreen,
  collectSafeWaterRegionGeometryParts,
  collectVisibleLandSpatialItems,
  getAdmin0BackgroundFillColor,
  invalidateRenderPasses,
  requestRendererRender,
  isExportRenderInProgress,
  isPrivateSceneActive,
  getLabelPaintBounds,
  getLabelPaintOverscanPx,
  getHoverEntryHitPriority,
  getScenarioWaterPartBounds,
  drawPendingTransportLabels,
  drawPhysicalRegionLabels,
}) {
  const urbanGeoCentroidCache = new WeakMap();

  const urbanFeatureIndexCache = {
    sourceRef: null,
    byId: new Map(),
  };
  const cityLayerCache = {
    baseRef: null,
    scenarioRef: null,
    scenarioCountriesRef: null,
    scenarioId: "",
    cityLayerRevision: -1,
    scenarioOwnershipTagRevision: -1,
    sovereigntyRevision: -1,
    merged: null,
  };

  let cityPointsRenderOwner = null;

  const getUrbanCityPolicyOwner = lazyOwner(() => createUrbanCityPolicyOwner({
    state: runtimeState,
    caches: {
      cityLayerCache,
      urbanFeatureIndexCache,
    },
    helpers: {
      compareCityRevealEntries,
      defaultCityCountryClassRank: CITY_COUNTRY_CLASS_RANK.micro,
      defaultCityCountryTierRank: CITY_COUNTRY_TIER_RANK.D,
      getCityAnchor: (...args) => getCityGeometryPresentation().getCityAnchor(...args),
      getCityCanonicalId,
      getCityCapitalScore,
      getCityEffectiveMinZoom,
      getCityFeatureAliases,
      getCityFeatureKey,
      getCityInterpolatedMarkerBudget,
      getCityInterpolatedMarkerQuota,
      getCityInterpolatedRevealBucket,
      getCityLabelBudget,
      getCityLabelMinZoom,
      getCityMarkerDensityMultiplier,
      getCityMarkerSizePx,
      getCityPriorityCountryReserveBudget,
      getCityPriorityCountryReserveRank,
      getCityRevealPhase,
      getCityScreenPoint: (...args) => getCityGeometryPresentation().getCityScreenPoint(...args),
      getCitySortWeight,
      getCityTier,
      getCityTierWeight,
      getCityViewportCenterDistanceNorm,
      getDefaultCityMinZoomForTier,
      getUrbanFeatureStableId,
      isCityAnchorInViewport: (...args) => getCityGeometryPresentation().isCityAnchorInViewport(...args),
      getCityPaintOverscanPx: () => Math.max(48, getLabelPaintOverscanPx()),
      isCityLabelEligibleForPhase,
      isCityScenarioTagExcludedFromReveal,
    },
  }));

  const getCityLabelOwner = lazyOwner(() => createCityLabelOwner({
    constants: { textureLabelSerifStack: TEXTURE_LABEL_SERIF_STACK },
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getViewportSize: () => ({ width: runtimeState.width, height: runtimeState.height }),
      getPaintBounds: getLabelPaintBounds,
    },
    helpers: {
      clamp,
      formatCityMapLabel,
      getCityDisplayLabel,
      getCityLabelMinZoom,
      getCityLabelRenderStyle,
      getCityMarkerSizePx,
      getCityVisualCapitalState,
    },
  }));

  function getCityPointsRenderOwner() {
    if (cityPointsRenderOwner) {
      return cityPointsRenderOwner;
    }
    cityPointsRenderOwner = createCityPointsRenderOwner({
      state: runtimeState,
      constants: {
        cityMarkerSizeLimitsPx: CITY_MARKER_SIZE_LIMITS_PX,
        cityMarkerThemeGraphite: CITY_MARKER_THEME_GRAPHITE,
        cityRevealProfileHybrid: CITY_REVEAL_PROFILE_HYBRID,
      },
      getters: {
        getContext: () => rendererSurfaceHost.getContext(),
        getMapSvg: () => rendererSurfaceHost.getMapSvg(),
        getProjection: () => rendererSurfaceHost.getProjection(),
      },
      helpers: {
        buildCityRevealPlan: (...args) => buildCityRevealPlan(...args),
        prepareCityRevealPlan: (...args) => getUrbanCityPolicyOwner().prepareCityRevealPlan(...args),
        getEffectiveCityCollectionSource: (...args) => getUrbanCityPolicyOwner().getEffectiveCityCollectionSource(...args),
        isEffectiveCityCollectionSourceCurrent: (...args) => getUrbanCityPolicyOwner().isEffectiveCityCollectionSourceCurrent(...args),
        getCachedEffectiveCityCollection: (...args) => getUrbanCityPolicyOwner().getCachedEffectiveCityCollection(...args),
        prepareEffectiveCityCollection: (...args) => getUrbanCityPolicyOwner().prepareEffectiveCityCollection(...args),
        installEffectiveCityCollection: (...args) => getUrbanCityPolicyOwner().installEffectiveCityCollection(...args),
        isPrivatePreparationEnabled: () => !isExportRenderInProgress() && isPrivateSceneActive(),
        getCityPaintOverscanPx: () => Math.max(48, getLabelPaintOverscanPx()),
        clamp,
        collectContextMetric,
        drawCityLabelsFromEntries: (...args) => getCityLabelOwner().drawCityLabelsFromEntries(...args),
        getCityMarkerRenderStyle,
        getCityMarkerSizePx,
        getCityTooltipText: (...args) => getCityGeometryPresentation().getCityTooltipText(...args),
        getCityVisualCapitalState,
        getEffectiveCityCollection: (...args) => getEffectiveCityCollection(...args),
        getHoverEntryHitPriority,
        getPointer: (event, target) => (
          typeof globalThis.d3?.pointer === "function" ? globalThis.d3.pointer(event, target) : null
        ),
        getZoomIdentity: () => globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 },
        getFeatureCollectionFeatureCount,
        isCityEntryEligibleForLandHit,
        normalizeCityLayerStyleConfig,
        nowMs,
        recordInteractionDurationMetric,
        recordRenderPerfMetric,
      },
    });
    return cityPointsRenderOwner;
  }

  const getMarineLabelOwner = lazyOwner(() => createMarineLabelOwner({
    state: runtimeState,
    getContext: () => rendererSurfaceHost.getContext(),
    getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
    getProjection: () => rendererSurfaceHost.getProjection(),
    getD3: () => globalThis.d3,
    isOpenOceanRenderable,
    isWaterRegionRenderable,
    getProjectedFeatureBounds,
    projectedGeoBoundsInScreen,
    collectSafeWaterRegionGeometryParts,
    getScenarioWaterPartBounds,
    getLabelPaintBounds,
    getGeoFeatureDisplayLabel,
    recordRenderPerfMetric,
    nowMs,
  }));

  function composeUrbanAdaptivePaintModel() {
    const owner = createUrbanAdaptivePaintModel(runtimeState, { getResolvedFeatureColor, clamp });
    return owner;
  }

  const getUrbanAdaptivePaintModel = lazyOwner(composeUrbanAdaptivePaintModel);
  const computeUrbanAdaptivePaintFromHostColor = (...args) => getUrbanAdaptivePaintModel().computeUrbanAdaptivePaintFromHostColor(...args);
  const getEffectiveUrbanMode = (...args) => getUrbanAdaptivePaintModel().getEffectiveUrbanMode(...args);
  const createDrawPaintResolver = (...args) => getUrbanAdaptivePaintModel().createDrawPaintResolver(...args);

  function composeUrbanLayerRenderOwner() {
    const owner = createUrbanLayerRenderOwner({
      state: runtimeState,
      helpers: {
        clamp, collectContextMetric, createDrawPaintResolver, getEffectiveUrbanMode,
        getContext: () => rendererSurfaceHost.getContext(),
        getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
        getProjection: () => rendererSurfaceHost.getProjection(),
        getSafeBlendMode, getSafeCanvasColor, getUrbanGlowFeatureMultiplier,
        getUrbanLayerCapability, normalizeUrbanStyleConfig, nowMs,
        estimateProjectedAreaPx, pathBoundsInScreen,
      },
    });
    return owner;
  }

  const getUrbanLayerRenderOwner = lazyOwner(composeUrbanLayerRenderOwner);

  function drawUrbanLayer(k, { interactive = false, scope = "base" } = {}) {
    return getUrbanLayerRenderOwner().drawUrbanLayer(k, { interactive, scope });
  }

  function composeCityLabelTextModel() {
    const owner = createCityLabelTextModel(runtimeState, {
      getStrictGeoLabel, getPreferredGeoLabel,
    });
    return owner;
  }

  const getCityLabelTextModel = lazyOwner(composeCityLabelTextModel);
  const getCityFeatureKey = (...args) => getCityLabelTextModel().getCityFeatureKey(...args);
  const getCityFeatureAliases = (...args) => getCityLabelTextModel().getCityFeatureAliases(...args);
  const getCityDisplayLabel = (...args) => getCityLabelTextModel().getCityDisplayLabel(...args);
  const formatCityMapLabel = (...args) => getCityLabelTextModel().formatCityMapLabel(...args);

  function getCityInterpolatedRevealBucket(entry, scale) {
    const { currentPhase, nextPhase, t } = getCityRevealPhaseInterpolation(scale);
    const currentBucket = getCityRevealBucket(entry, currentPhase.id);
    if (!nextPhase || nextPhase.id === currentPhase.id) {
      return currentBucket;
    }
    const nextBucket = getCityRevealBucket(entry, nextPhase.id);
    if (Number.isFinite(currentBucket) && Number.isFinite(nextBucket)) {
      return currentBucket + ((nextBucket - currentBucket) * t);
    }
    if (!Number.isFinite(currentBucket) && Number.isFinite(nextBucket)) {
      const seed = `${String(entry?.cityId || "")}:${currentPhase.id}:${nextPhase.id}`;
      const threshold = clamp(0.7 + (getSignedHashUnit(seed) * 0.12), 0.58, 0.82);
      return t >= threshold ? nextBucket + ((1 - t) * 0.5) : Number.POSITIVE_INFINITY;
    }
    return currentBucket;
  }

  function getCityViewportCenterDistanceNorm(entry) {
    const point = Array.isArray(entry?.screenPoint) ? entry.screenPoint : null;
    if (!point || point.length < 2) return 1;
    const centerX = Number(runtimeState.width || 0) * 0.5;
    const centerY = Number(runtimeState.height || 0) * 0.5;
    const maxDistance = Math.max(1, Math.hypot(centerX + 48, centerY + 48));
    return clamp(Math.hypot(Number(point[0] || 0) - centerX, Number(point[1] || 0) - centerY) / maxDistance, 0, 1);
  }

  const buildCityRevealPlan = (...args) => getUrbanCityPolicyOwner().buildCityRevealPlan(...args);

  const getEffectiveCityCollection = (...args) => getUrbanCityPolicyOwner().getEffectiveCityCollection(...args);
  // 只读已合并好的城市集合，不在调用方同步触发合并（检查器等 UI 读名称用）。
  const getCachedEffectiveCityCollection = () => getUrbanCityPolicyOwner().getCachedEffectiveCityCollection();

  const getCityGeometryPresentation = lazyOwner(() => createCityGeometryPresentation({
    state: runtimeState,
    surfaceHost: rendererSurfaceHost,
    getCityDisplayLabel,
    getDisplayOwnerCode,
    getLocalizedScenarioCountryName,
    getFeatureGeoCentroid,
    normalizeLongitude,
    clamp,
    t,
    renderTooltipText,
  }));

  const getCityPaintStyleModel = lazyOwner(() => createCityPaintStyleModel(runtimeState, {
      getResolvedFeatureColor, computeUrbanAdaptivePaintFromHostColor,
    }));

  function getCityLabelRenderStyle(entry, config = {}) {
    return getCityPaintStyleModel().getCityLabelRenderStyle(entry, config);
  }

  function getCityMarkerRenderStyle(entry, config = {}) {
    return getCityPaintStyleModel().getCityMarkerRenderStyle(entry, config);
  }

  function getCityVisualCapitalState(entry, config = {}) {
    return !!entry?.isCapital && config.showCapitalOverlay !== false;
  }

  function getHoveredCityEntryFromEvent(event) {
    return getCityPointsRenderOwner().getHoveredCityEntryFromEvent(event);
  }

  function isCityEntryEligibleForLandHit(entry, hit) {
    if (!entry || hit?.targetType !== "land") {
      return false;
    }
    const hostFeatureId = String(
      entry?.feature?.properties?.__city_host_feature_id
      || entry?.feature?.properties?.host_feature_id
      || ""
    ).trim();
    return !!hostFeatureId && hostFeatureId === String(hit?.id || "").trim();
  }

  function getHoveredCityTooltipEntry(event, hit) {
    return getCityPointsRenderOwner().getHoveredCityTooltipEntry(event, hit);
  }

  function drawCityPointsLayer(k, { interactive = false } = {}) {
    return getCityPointsRenderOwner().drawCityPointsLayer(k, { interactive });
  }

  function getFeatureGeoCentroid(feature) {
    if (!feature || !globalThis.d3?.geoCentroid) return null;
    const cached = urbanGeoCentroidCache.get(feature);
    if (cached) return cached;
    const centroid = globalThis.d3.geoCentroid(feature);
    const longitude = Number(centroid?.[0]);
    const latitude = Number(centroid?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return null;
    }
    const normalized = [normalizeLongitude(longitude), clamp(latitude, -89.999, 89.999)];
    urbanGeoCentroidCache.set(feature, normalized);
    return normalized;
  }

  function getBlankFeatureLabel(feature, id) {
    const props = feature?.properties || {};
    return String(props.name || props.label || id || "").trim();
  }

  function drawBlankFeatureLabelsPass(k, { interactive = false } = {}) {
    if (interactive) return;
    if (normalizeMapSemanticMode(runtimeState.mapSemanticMode) !== "blank") return;
    if (String(runtimeState.activeScenarioId || "") !== "blank_base") return;
    if (!runtimeState.showBlankFeatureLabels) return;
    if (!runtimeState.landData?.features?.length || !rendererSurfaceHost.getContext() || typeof rendererSurfaceHost.getPathCanvas()?.centroid !== "function") return;
    const visibleItems = collectVisibleLandSpatialItems();
    const items = Array.isArray(visibleItems) && visibleItems.length
      ? visibleItems
      : runtimeState.landData.features.map((feature, index) => ({
        feature,
        id: getFeatureId(feature) || `feature-${index}`,
      }));
    const maxLabels = Math.max(24, Math.min(140, Math.round(44 * Math.max(1, Number(k) || 1))));
    const step = Math.max(1, Math.ceil(items.length / maxLabels));
    const fontSize = Math.max(7, Math.min(12, 11 / Math.max(0.75, Number(k) || 1)));
    rendererSurfaceHost.getContext().save();
    rendererSurfaceHost.getContext().font = `${fontSize}px system-ui, sans-serif`;
    rendererSurfaceHost.getContext().textAlign = "center";
    rendererSurfaceHost.getContext().textBaseline = "middle";
    rendererSurfaceHost.getContext().lineWidth = Math.max(1.8 / Math.max(0.75, Number(k) || 1), 0.7);
    rendererSurfaceHost.getContext().strokeStyle = "rgba(248, 250, 252, 0.82)";
    rendererSurfaceHost.getContext().fillStyle = "rgba(31, 41, 55, 0.86)";
    for (let index = 0; index < items.length; index += step) {
      const item = items[index];
      const feature = item?.feature || item;
      const id = item?.id || getFeatureId(feature) || "";
      const label = getBlankFeatureLabel(feature, id);
      if (!label) continue;
      const centroid = rendererSurfaceHost.getPathCanvas().centroid(feature);
      if (!centroid || !Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) continue;
      rendererSurfaceHost.getContext().strokeText(label, centroid[0], centroid[1]);
      rendererSurfaceHost.getContext().fillText(label, centroid[0], centroid[1]);
    }
    rendererSurfaceHost.getContext().restore();
  }

  let countryLabelSourceOwner = null;
  let countryLabelRenderOwner = null;

  function getCountryLabelSourceOwner() {
    countryLabelSourceOwner ||= createCountryLabelSourceOwner({
      state: runtimeState,
      topojson: globalThis.topojson,
      ensureSources: (layers) => callRuntimeHook(runtimeState, "ensureScenarioNavigationSourcesFn", { layers }),
      getCountryName: (code) => getLocalizedScenarioCountryName(
        runtimeState.scenarioCountriesByTag?.[code],
        runtimeState.countryNames?.[code] || code,
        (name) => t(name, "geo"),
      ),
      onChange: () => {
        invalidateRenderPasses("labels", "country-label-source");
        requestRendererRender("country-label-source", { flush: false });
      },
    });
    return countryLabelSourceOwner;
  }

  function getCountryLabelRenderOwner() {
    if (countryLabelRenderOwner) return countryLabelRenderOwner;
    countryLabelRenderOwner ||= createCountryLabelRenderOwner({
      state: runtimeState,
      getters: {
        getContext: () => rendererSurfaceHost.getContext(),
        getProjection: () => rendererSurfaceHost.getProjection(),
        getProjectionIdentity: () => getProjectionGeometryGeneration(rendererSurfaceHost.getProjection()),
        getViewportSize: () => ({ width: runtimeState.width, height: runtimeState.height }),
        getPaintBounds: getLabelPaintBounds,
        getTransform: () => runtimeState.zoomTransform,
        getLanguage: () => runtimeState.currentLanguage || "en",
        getCountryLabelSource: () => getCountryLabelSourceOwner().getSource(),
        getCountryLabelColors: (code) => {
          const luminance = getCanvasColorRelativeLuminance(getAdmin0BackgroundFillColor(code));
          return Number.isFinite(luminance) && luminance < 0.18
            ? { fill: "#f4f1e7", stroke: "rgba(16, 24, 32, 0.3)" }
            : { fill: "#172b35", stroke: "rgba(255, 252, 241, 0.22)" };
        },
      },
      helpers: {
        isPrivatePreparationEnabled: () => !isExportRenderInProgress() && isPrivateSceneActive() && !runtimeState.isInteracting,
        onInvalidate: () => {
          invalidateRenderPasses("labels", "country-label-layout");
          requestRendererRender("country-label-layout", { flush: false });
        },
      },
    });
    const refreshFonts = () => {
      countryLabelRenderOwner?.clearTextCache();
      invalidateRenderPasses("labels", "country-label-fonts");
      requestRendererRender("country-label-fonts", { flush: false });
    };
    if (globalThis.document?.fonts) {
      if (document.fonts.status === "loading") document.fonts.ready.then(refreshFonts);
      document.fonts.addEventListener?.("loadingdone", refreshFonts);
    }
    return countryLabelRenderOwner;
  }

  let cityPointsPreparationPromise = null;
  function prepareCityPointsPass() {
    if (isExportRenderInProgress() || !isPrivateSceneActive()
      || runtimeState.isInteracting) {
      cityPointsRenderOwner?.cancelPreparation();
      return null;
    }
    const preparation = getCityPointsRenderOwner().prepareCurrentView(runtimeState.zoomTransform?.k || 1,
      { isCurrent: () => !runtimeState.isInteracting });
    if (preparation && preparation !== cityPointsPreparationPromise) {
      cityPointsPreparationPromise = preparation;
      preparation.then((ready) => {
        if (ready) requestRendererRender("city-plan-prepared", { flush: false });
      }, () => {}).finally(() => {
        if (cityPointsPreparationPromise === preparation) cityPointsPreparationPromise = null;
      });
    }
    return preparation;
  }

  function prepareLabelsPass() {
    // Both plans are private and independent. Neither may be built by a draw
    // callback, including the overview reservation that precedes country labels.
    const preparations = [prepareCityPointsPass(), prepareCountryLabelsPass()].filter(Boolean);
    return preparations.length ? Promise.all(preparations) : null;
  }

  function prepareCountryLabelsPass() {
    if (isExportRenderInProgress() || !isPrivateSceneActive()
      || runtimeState.isInteracting || runtimeState.styleConfig?.countryLabels?.enabled === false) {
      countryLabelRenderOwner?.cancelPreparation();
      return null;
    }
    const source = getCountryLabelSourceOwner();
    const status = source.getSource().status;
    if (status === "pending") return source.prepare();
    if (status !== "ready") return null;
    return getCountryLabelRenderOwner().prepareCurrentView(runtimeState.zoomTransform?.k || 1);
  }

  function drawLabelsPassContent(k, { interactive = false } = {}) {
    drawBlankFeatureLabelsPass(k, { interactive });
    const occupiedBoxes = [];
    if (shouldShowMarineRegionNames(runtimeState.styleConfig, interactive)) {
      getMarineLabelOwner().drawOrdinaryMarineLabels(k, occupiedBoxes);
    }
    // Keep capitals beside their symbols. Overview country titles take priority
    // over ordinary city names; regional views favor the whole city layer.
    const countryLabelsFirst = !interactive && !runtimeState.deferContextBasePass
      && getMapLabelHierarchy(k, runtimeState).preferCountries;
    let overviewLayout = null;
    if (countryLabelsFirst) {
      overviewLayout = getCityPointsRenderOwner().reserveOverviewLabelBoxes(k, occupiedBoxes);
    } else {
      getCityPointsRenderOwner().drawLabelsPass(k, { interactive, occupiedBoxes });
    }
    if (!interactive && !runtimeState.deferContextBasePass) {
      if (runtimeState.styleConfig?.countryLabels?.enabled !== false) {
        getCountryLabelSourceOwner().prepare();
        const startedAt = nowMs();
        getCountryLabelRenderOwner().drawCountryLabels(k, { occupiedBoxes });
        recordRenderPerfMetric("countryLabels", nowMs() - startedAt, getCountryLabelRenderOwner().getDiagnostics());
      }
      if (countryLabelsFirst) {
        getCityPointsRenderOwner().drawLabelsPass(k, { occupiedBoxes, overviewLayout });
      }
      drawPendingTransportLabels(k, { occupiedBoxes });
      drawPhysicalRegionLabels(k, { occupiedBoxes });
    }
  }

  async function ensureCountryLabelsReadyForExport(passNames) {
    if (!passNames.includes("labels")) return;
    await waitForCountryLabelsForExport({
      isDisabled: () => runtimeState.styleConfig?.countryLabels?.enabled === false,
      prepareSource: () => getCountryLabelSourceOwner().prepare(),
      getSource: () => getCountryLabelSourceOwner().getSource(),
      getDiagnostics: () => getCountryLabelRenderOwner().getDiagnostics(),
      requestRender: () => {
        invalidateRenderPasses("labels", "country-label-export");
        requestRendererRender("country-label-export", { flush: false });
      },
    });
  }

  function getVisibleMapLabels() {
    const width = Number(runtimeState.width) || 0, height = Number(runtimeState.height) || 0;
    const onScreen = (x, y, w = 0, h = 0) => x + w >= 0 && y + h >= 0 && x <= width && y <= height;
    const cities = (cityPointsRenderOwner?.getLastDrawnCityLabels() || [])
      .filter(({ screenPoint }) => Array.isArray(screenPoint) && onScreen(screenPoint[0], screenPoint[1]))
      .map(({ id }) => String(id));
    const countryDiagnostics = countryLabelRenderOwner?.getDiagnostics();
    const countries = (countryDiagnostics?.lastLabels || [])
      .filter(({ bounds }) => bounds && onScreen(bounds.x, bounds.y, bounds.w, bounds.h))
      .map(({ countryCode }) => String(countryCode));
    return { cities: [...new Set(cities)].sort(), countries: [...new Set(countries)].sort(),
      // Country names still waiting for an asynchronous layout fit in this view.
      pendingCountryFits: Number(countryDiagnostics?.pendingFits) || 0 };
  }

  function getCountryLabelReadiness() {
    const expected = runtimeState.styleConfig?.countryLabels?.enabled !== false;
    if (!expected) return { expected, ready: true, sourceStatus: "disabled" };
    const source = countryLabelSourceOwner?.peekSource();
    if (source?.status === "disabled") return { expected, ready: true, sourceStatus: "disabled" };
    if (!source || source.status !== "ready" || !countryLabelRenderOwner) {
      return { expected, ready: false, sourceStatus: source?.status || "uninitialized" };
    }
    const readiness = countryLabelRenderOwner.getReadinessForCurrentView(source);
    return { expected, ...readiness, sourceStatus: source.status,
      ready: readiness.ready && !runtimeState.renderPassCache?.dirty?.labels };
  }

  function assertCountryLabelsReadyForExport(passNames) {
    if (passNames.includes("labels")
      && runtimeState.styleConfig?.countryLabels?.enabled !== false) {
      const sourceStatus = getCountryLabelSourceOwner().getSource().status;
      const labelStatus = countryLabelRenderOwner?.getDiagnostics();
      if (sourceStatus !== "disabled" && (sourceStatus !== "ready"
        || !labelStatus || labelStatus.pendingFits > 0 || labelStatus.workerErrors > 0)) {
        throw new Error("Country names are still preparing or failed to prepare; wait for labels before exporting, or disable country names.");
      }
    }
  }

  function cancelCityPreparation() {
    cityPointsRenderOwner?.cancelPreparation();
  }

  function reset() {
    cancelCityPreparation();
    countryLabelRenderOwner?.cancelPreparation();
    cityPointsPreparationPromise = null;
  }

  return {
    computeUrbanAdaptivePaintFromHostColor,
    getEffectiveUrbanMode,
    buildCityRevealPlan,
    getCityLabelRenderStyle,
    getCityMarkerRenderStyle,
    getCachedEffectiveCityCollection,
    getEffectiveCityCollection,
    ensureCountryLabelsReadyForExport,
    getVisibleMapLabels,
    getCountryLabelReadiness,
    drawUrbanLayer,
    getUrbanCityPolicyOwner,
    getFeatureGeoCentroid,
    getHoveredCityEntryFromEvent,
    getHoveredCityTooltipEntry,
    drawCityPointsLayer,
    prepareCityPointsPass,
    prepareLabelsPass,
    drawLabelsPassContent,
    cancelCityPreparation,
    reset,
    assertCountryLabelsReadyForExport,
    resetCityAnchorCache: (...args) => getCityGeometryPresentation().resetCityAnchorCache(...args),
    getCityAnchor: (...args) => getCityGeometryPresentation().getCityAnchor(...args),
    getCityGeoCoordinates: (...args) => getCityGeometryPresentation().getCityGeoCoordinates(...args),
    getCityScreenPoint: (...args) => getCityGeometryPresentation().getCityScreenPoint(...args),
  };
}
