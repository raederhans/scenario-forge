import {
  normalizeIntensityFieldsState, normalizePhysicalStyleConfig,
  normalizeTextureStyleConfig, normalizeUrbanStyleConfig,
  normalizeCityLayerStyleConfig, normalizeTransportOverviewStyleConfig,
} from '../state.js';
import { getUrbanCityRenderPassSignatureParts } from './urban_city_policy.js';
import { VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES } from '../map_renderer/render_pass_catalog.js';

// Cache identity reads current state and live renderer dependencies on every call.
export function createRenderPassSignaturePolicy(runtimeState, {
  getTransformSignature,
  getOceanBaseFillColor,
  getDebugMode,
  shouldEnableContextBaseTransformReuse,
  getViewportRenderSignature,
  getPhysicalLandMaskInfo,
  getScenarioRuntimeTopologySignatureToken,
  getHgoRuntimePreviewVisibilitySignature,
  getHgoRuntimePreviewProjectionOptions,
  isHgoRuntimePreviewReady,
  rendererSurfaceHost,
  getContextBaseZoomBucketId,
  shouldRefreshContextBaseForColorChanges,
  getScenarioOverlaySignatureToken,
  getLakeBaseFillColor,
  getLakeStyleConfig,
  stableJson,
  getDayNightRuntimeOwner,
  getBorderAppearanceRevision = () => runtimeState.colorRevision || 0,
}) {
  function getTransportPresentationSignatureParts() {
    return [
      runtimeState.showTransport ? "transport:on" : "transport:off",
      runtimeState.showRoad ? "road:on" : "road:off",
      runtimeState.showAirports ? "airports:on" : "airports:off",
      runtimeState.showPorts ? "ports:on" : "ports:off",
      runtimeState.showRail ? "rail:on" : "rail:off",
      `context:${Number(runtimeState.contextLayerRevision || 0)}`,
      `scene:${Number(runtimeState.sceneGeneration || 0)}`,
      `scenario-data:${Number(runtimeState.scenarioDataGeneration || 0)}`,
      `language:${String(runtimeState.currentLanguage || "en")}`,
      stableJson(normalizeTransportOverviewStyleConfig(runtimeState.styleConfig?.transportOverview || {})),
    ];
  }

  function getPoliticalPassStaticSignature(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    return [
      getTransformSignature(transform),
      runtimeState.topologyRevision || 0,
      `ocean-fill:${getOceanBaseFillColor()}`,
      getDebugMode(),
      runtimeState.topologyBundleMode || "single",
    ].join("::");
  }

  function getRenderPassTransformSignature(passName, transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    if (
      VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES.has(passName)
      && shouldEnableContextBaseTransformReuse()
    ) {
      return [
        "transform-reuse",
        getViewportRenderSignature(),
        Number(Number(runtimeState.dpr || 1).toFixed(2)),
      ].join("::");
    }
    return getTransformSignature(transform);
  }

  function getRenderPassSignature(passName, transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    const transformSignature = getRenderPassTransformSignature(passName, transform);
    const intensityFields = normalizeIntensityFieldsState(runtimeState.intensityFields);
    if (passName === "background") {
      return [
        transformSignature,
        runtimeState.topologyRevision || 0,
        runtimeState.oceanMaskMode || "topology_ocean",
        Number(runtimeState.oceanMaskQuality || 1).toFixed(3),
        `field:oceanDepth:${Number(intensityFields.channels.oceanDepth?.revision || 0)}`,
        stableJson(runtimeState.styleConfig?.ocean || {}),
      ].join("::");
    }
    if (passName === "physicalBase") {
      const maskInfo = getPhysicalLandMaskInfo();
      return [
        transformSignature,
        runtimeState.topologyRevision || 0,
        runtimeState.activeScenarioId || "",
        runtimeState.showPhysical ? "physical:on" : "physical:off",
        `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}:${maskInfo.maskQualityToken || "unchecked"}`,
        `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
        `field:${Number(intensityFields.channels.physicalAtlas?.revision || 0)}`,
        stableJson(normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical || {})),
      ].join("::");
    }
    if (passName === "political") {
      return [
        runtimeState.colorRevision || 0,
        getHgoRuntimePreviewVisibilitySignature(),
        getPoliticalPassStaticSignature(transform),
      ].join("::");
    }
    if (passName === "hgoPreview") {
      const preview = runtimeState.hgoRuntimePreview || {};
      const summary = preview.summary || {};
      const hgoProjectionOptions = getHgoRuntimePreviewProjectionOptions();
      return [
        isHgoRuntimePreviewReady() ? "hgo:on" : "hgo:off",
        String(preview.status || ""),
        Number(runtimeState.dpr || 1).toFixed(2),
        Number(runtimeState.width || 0),
        Number(runtimeState.height || 0),
        rendererSurfaceHost.getProjection() ? transformSignature : "projection:none",
        hgoProjectionOptions.projectionName,
        hgoProjectionOptions.sourceProjection,
        `seed:${Number(summary.provinceCount || summary.province_count || 0)}:${Number(summary.stateCount || summary.state_count || 0)}:${Number(summary.countryCount || summary.country_count || 0)}`,
      ].join("::");
    }
    if (passName === "effects") {
      return [
        transformSignature,
        runtimeState.topologyRevision || 0,
        stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
      ].join("::");
    }
    if (passName === "lineEffects") {
      return [
        transformSignature,
        runtimeState.topologyRevision || 0,
        stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
      ].join("::");
    }
    if (passName === "contextBase") {
      const maskInfo = getPhysicalLandMaskInfo();
      const zoomBucket = getContextBaseZoomBucketId(transform?.k || runtimeState.zoomTransform?.k || 1);
      const baseSignatureParts = [
        runtimeState.topologyRevision || 0,
        runtimeState.activeScenarioId || "",
        getHgoRuntimePreviewVisibilitySignature(),
        runtimeState.deferContextBasePass ? "context-base:deferred" : "context-base:ready",
        `bucket:${zoomBucket}`,
        runtimeState.showPhysical ? "physical:on" : "physical:off",
        runtimeState.showUrban ? "urban:on" : "urban:off",
        runtimeState.showRivers ? "rivers:on" : "rivers:off",
        `context:${Number(runtimeState.contextLayerRevision || 0)}`,
        `context-colors:${shouldRefreshContextBaseForColorChanges() ? Number(runtimeState.colorRevision || 0) : 0}`,
        `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}:${maskInfo.maskQualityToken || "unchecked"}`,
        `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
        `field:physicalContour:${Number(intensityFields.channels.physicalContour?.revision || 0)}`,
        `field:urbanGlow:${Number(intensityFields.channels.urbanGlow?.revision || 0)}`,
        String(runtimeState.renderProfile || "auto"),
        stableJson(normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical || {})),
        stableJson(normalizeUrbanStyleConfig(runtimeState.styleConfig?.urban || {})),
        stableJson(runtimeState.styleConfig?.rivers || {}),
      ];
      if (shouldEnableContextBaseTransformReuse()) {
        return [
          getViewportRenderSignature(),
          "context-base-transform-reuse",
          ...baseSignatureParts,
        ].join("::");
      }
      return [
        transformSignature,
        ...baseSignatureParts,
      ].join("::");
    }
    if (passName === "contextMarkers") {
      return [
        transformSignature,
        runtimeState.topologyRevision || 0,
        runtimeState.activeScenarioId || "",
        getHgoRuntimePreviewVisibilitySignature(),
        runtimeState.deferContextBasePass ? "context-markers:deferred" : "context-markers:ready",
        runtimeState.showCityPoints ? "cities:on" : "cities:off",
        runtimeState.showStrategicResourceMarkers ? "strategic-resources:on" : "strategic-resources:off",
        ...getTransportPresentationSignatureParts(),
        ...getUrbanCityRenderPassSignatureParts(runtimeState, "contextMarkers"),
        stableJson(normalizeCityLayerStyleConfig(runtimeState.styleConfig?.cityPoints || {})),
      ].join("::");
    }
    if (passName === "labels") {
      return [
        transformSignature,
        runtimeState.topologyRevision || 0,
        runtimeState.activeScenarioId || "",
        getHgoRuntimePreviewVisibilitySignature(),
        runtimeState.showBlankFeatureLabels ? "blank-feature-labels:on" : "blank-feature-labels:off",
        runtimeState.showCityPoints ? "cities:on" : "cities:off",
        ...getUrbanCityRenderPassSignatureParts(runtimeState, "labels"),
        ...getTransportPresentationSignatureParts(),
        stableJson(normalizeCityLayerStyleConfig(runtimeState.styleConfig?.cityPoints || {})),
      ].join("::");
    }
    if (passName === "contextScenario") {
      return [
        transformSignature,
        runtimeState.topologyRevision || 0,
        runtimeState.activeScenarioId || "",
        getHgoRuntimePreviewVisibilitySignature(),
        runtimeState.scenarioReliefOverlayRevision || 0,
        `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
        `scenario-overlays:${getScenarioOverlaySignatureToken()}`,
        runtimeState.showWaterRegions ? "scenario-water:on" : "scenario-water:off",
        runtimeState.showOpenOceanRegions ? "open-ocean:on" : "open-ocean:off",
        runtimeState.showScenarioSpecialRegions ? "scenario-special:on" : "scenario-special:off",
        runtimeState.showScenarioReliefOverlays ? "scenario-relief:on" : "scenario-relief:off",
        `ocean-fill:${getOceanBaseFillColor()}`,
        `lake-fill:${getLakeBaseFillColor()}`,
        `lake-style:${stableJson(getLakeStyleConfig())}`,
      ].join("::");
    }
    if (passName === "textureLabels") {
      return [
        transformSignature,
        getHgoRuntimePreviewVisibilitySignature(),
        runtimeState.topologyRevision || 0,
        stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
      ].join("::");
    }
    if (passName === "dayNight") {
      return getDayNightRuntimeOwner().buildDayNightPassSignature(
        transformSignature, intensityFields.channels.urbanGlow?.revision, Number(runtimeState.topologyRevision || 0),
      );
    }
    if (passName === "borders") {
      return [
        transformSignature,
        getHgoRuntimePreviewVisibilitySignature(),
        runtimeState.topologyRevision || 0,
        getBorderAppearanceRevision(),
        runtimeState.cachedDynamicBordersHash || "",
        runtimeState.sovereigntyRevision || 0,
        0,
        runtimeState.activeScenarioId || "",
        runtimeState.scenarioBorderMode || "canonical",
        "ownership",
        stableJson(runtimeState.parentBorderEnabledByCountry || {}),
        stableJson(runtimeState.styleConfig?.internalBorders || {}),
        stableJson(runtimeState.styleConfig?.empireBorders || {}),
        stableJson(runtimeState.styleConfig?.coastlines || {}),
        stableJson(runtimeState.styleConfig?.parentBorders || {}),
      ].join("::");
    }
    return transformSignature;
  }

  return Object.freeze({ getPoliticalPassStaticSignature, getRenderPassTransformSignature, getRenderPassSignature });
}
