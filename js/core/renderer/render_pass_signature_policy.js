import { getThematicWgiSignature } from "../thematic_wgi_view_model.js";
import { getPopulationSignature } from "../population_spatial_view_model.js";
import { getPopulationHeatmapSnapshot } from "../population_spatial_runtime.js";
import {
  normalizeIntensityFieldsState, normalizePhysicalStyleConfig,
  normalizeTextureStyleConfig, normalizeUrbanStyleConfig,
  normalizeCityLayerStyleConfig, normalizeTransportOverviewStyleConfig,
} from '../state.js';
import { getUrbanCityRenderPassSignatureParts } from './urban_city_policy.js';
import { RENDER_PASS_NAMES, VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES } from '../map_renderer/render_pass_catalog.js';
import { resolveContourLodRequest } from './physical_contour_lod_policy.js';
import { resolvePhysicalAtlasCollection } from './physical_atlas_lod_policy.js';
import { getObjectIdentityToken } from './object_identity.js';
import { getRiverZoomBucket } from './river_layer_render_owner.js';

// Keep pass identities tied to the fields that the pass actually paints.  The
// physical style object also contains atlas-only controls; including all of it
// invalidates the shared context pass when an unrelated control changes.
function getPhysicalBaseStyleSignature(styleConfig) {
  const cfg = normalizePhysicalStyleConfig(styleConfig || {});
  return {
    mode: cfg.mode,
    opacity: cfg.opacity,
    atlasOpacity: cfg.atlasOpacity,
    atlasIntensity: cfg.atlasIntensity,
    landformIntensity: cfg.landformIntensity,
    landcoverIntensity: cfg.landcoverIntensity,
    atlasClassVisibility: cfg.atlasClassVisibility,
    rainforestEmphasis: cfg.rainforestEmphasis,
    preset: cfg.preset,
    blendMode: cfg.blendMode,
  };
}

function getPhysicalContourStyleSignature(styleConfig) {
  const cfg = normalizePhysicalStyleConfig(styleConfig || {});
  return {
    mode: cfg.mode,
    opacity: cfg.opacity,
    contourColor: cfg.contourColor,
    contourOpacity: cfg.contourOpacity,
    hillshadeOpacity: cfg.hillshadeOpacity,
    landformIntensity: cfg.hillshadeOpacity > 0 ? cfg.landformIntensity : undefined,
    contourMajorWidth: cfg.contourMajorWidth,
    contourMinorWidth: cfg.contourMinorWidth,
    contourMajorIntervalM: cfg.contourMajorIntervalM,
    contourMinorIntervalM: cfg.contourMinorIntervalM,
    contourMinorVisible: cfg.contourMinorVisible,
    contourMajorLowReliefCutoffM: cfg.contourMajorLowReliefCutoffM,
    contourMinorLowReliefCutoffM: cfg.contourMinorLowReliefCutoffM,
    preset: cfg.preset,
  };
}

function getPhysicalContextStyleSignature(styleConfig) {
  return getPhysicalContourStyleSignature(styleConfig);
}

// Cache identity reads current state and live renderer dependencies on every call.
export function createRenderPassSignaturePolicy(runtimeState, {
  getTransformSignature,
  getOceanBaseFillColor,
  getDebugMode,
  shouldEnableContextBaseTransformReuse,
  getViewportRenderSignature,
  getPhysicalLandMaskInfo,
  getScenarioRuntimeTopologySignatureToken,
  rendererSurfaceHost,
  getContextBaseZoomBucketId,
  shouldRefreshContextBaseForColorChanges,
  getScenarioOverlaySignatureToken,
  getLakeBaseFillColor,
  getLakeStyleConfig,
  stableJson,
  getDayNightRuntimeOwner,
  getBorderAppearanceRevision = () => runtimeState.colorRevision || 0,
  getPaintContourRevision = () => runtimeState.colorRevision || 0,
  getPoliticalBorderRevision = () => 0,
}) {
  let observedTopologyRevision = Number(runtimeState.topologyRevision || 0);
  const topologyRevisionByPass = new Map();

  function getPassTopologyRevision(passName) {
    const current = Number(runtimeState.topologyRevision || 0);
    // Unscoped topology changes (apply, resize/reset) retain full invalidation.
    if (current !== observedTopologyRevision) {
      topologyRevisionByPass.clear();
      observedTopologyRevision = current;
    }
    if (!topologyRevisionByPass.has(passName)) topologyRevisionByPass.set(passName, current);
    return topologyRevisionByPass.get(passName);
  }

  function recordScopedTopologyChange({ previousRevision, targetPasses = [] }) {
    const current = Number(runtimeState.topologyRevision || 0);
    if (Number(previousRevision) !== observedTopologyRevision || current !== Number(previousRevision) + 1) {
      topologyRevisionByPass.clear();
      observedTopologyRevision = current;
      return;
    }
    // Seed also passes not yet painted so first use has a deterministic revision.
    for (const passName of RENDER_PASS_NAMES) {
      if (!topologyRevisionByPass.has(passName)) topologyRevisionByPass.set(passName, observedTopologyRevision);
    }
    for (const passName of targetPasses) topologyRevisionByPass.set(passName, current);
    observedTopologyRevision = current;
  }

  function getTransportPresentationSignatureParts() {
    const dataParts = [];
    if (runtimeState.showTransport) {
      const overlayState = runtimeState.transportCountryOverlayState;
      for (const [family, visible, field, layer] of [
        ["road", runtimeState.showRoad, "roadsData", "roads"],
        ["rail", runtimeState.showRail, "railwaysData", "railways"],
        ["airport", runtimeState.showAirports, "airportsData", "airports"],
        ["port", runtimeState.showPorts, "portsData", "ports"],
      ]) {
        if (!visible) continue;
        const familyOverlay = overlayState?.overlaysByFamily?.[family];
        const overlay = familyOverlay?.status === "ready" ? familyOverlay
          : overlayState?.status === "ready" && overlayState.family === family ? overlayState : null;
        dataParts.push(getObjectIdentityToken(runtimeState[field]),
          getObjectIdentityToken(overlay?.collectionsByLayer?.[layer]));
        if (family === "rail") dataParts.push(getObjectIdentityToken(runtimeState.railStationsMajorData),
          getObjectIdentityToken(overlay?.collectionsByLayer?.rail_stations_major));
      }
    }
    return [
      runtimeState.showTransport ? "transport:on" : "transport:off",
      runtimeState.showRoad ? "road:on" : "road:off",
      runtimeState.showAirports ? "airports:on" : "airports:off",
      runtimeState.showPorts ? "ports:on" : "ports:off",
      runtimeState.showRail ? "rail:on" : "rail:off",
      ...dataParts,
      `scene:${Number(runtimeState.sceneGeneration || 0)}`,
      `scenario-data:${Number(runtimeState.scenarioDataGeneration || 0)}`,
      `language:${String(runtimeState.currentLanguage || "en")}`,
      stableJson(normalizeTransportOverviewStyleConfig(runtimeState.styleConfig?.transportOverview || {})),
    ];
  }

  function getPoliticalPassStaticSignature(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    return [
      getTransformSignature(transform),
      getPassTopologyRevision("political"),
      `ocean-fill:${getOceanBaseFillColor()}`,
      getDebugMode(),
      runtimeState.topologyBundleMode || "single",
      runtimeState.strategicChoroplethMetric || "",
      getThematicWgiSignature(runtimeState),
      getPopulationSignature(runtimeState),
      runtimeState.scenarioStrategicValuesRevision || 0,
      stableJson(runtimeState.styleConfig?.strategicValues || {}),
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
    if (passName === "populationHeatmap") {
      const snapshot = getPopulationHeatmapSnapshot(runtimeState);
      const maskInfo = getPhysicalLandMaskInfo();
      return [transformSignature, getViewportRenderSignature(), runtimeState.dpr,
        getPassTopologyRevision(passName), getPopulationSignature(runtimeState),
        snapshot.status, snapshot.version, snapshot.revision,
        getObjectIdentityToken(rendererSurfaceHost.getProjection()),
        getScenarioRuntimeTopologySignatureToken(),
        `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}`,
        getScenarioOverlaySignatureToken()].join("::");
    }
    if (passName === "background") {
      const { showRegionNames: _showRegionNames, ...oceanPaintStyle } = runtimeState.styleConfig?.ocean || {};
      return [
        transformSignature,
        getPassTopologyRevision(passName),
        runtimeState.oceanMaskMode || "topology_ocean",
        Number(runtimeState.oceanMaskQuality || 1).toFixed(3),
        `field:oceanDepth:${Number(intensityFields.channels.oceanDepth?.revision || 0)}`,
        stableJson(oceanPaintStyle),
        `bathymetry:${runtimeState.activeBathymetryTopologyUrl || ""}`,
      ].join("::");
    }
    if (passName === "physicalBase") {
      const maskInfo = getPhysicalLandMaskInfo();
      // Atlas publications replace the collection. Unrelated context loads
      // (including contour LOD and names) must not invalidate this fill pass.
      const atlas = resolvePhysicalAtlasCollection({
        zoomTransform: transform,
        physicalSemanticsData: runtimeState.physicalSemanticsData,
        contextLayerExternalDataByName: runtimeState.contextLayerExternalDataByName,
      });
      return [
        transformSignature,
        getPassTopologyRevision(passName),
        runtimeState.activeScenarioId || "",
        runtimeState.showPhysical ? "physical:on" : "physical:off",
        `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}:${maskInfo.maskQualityToken || "unchecked"}`,
        `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
        `field:${Number(intensityFields.channels.physicalAtlas?.revision || 0)}`,
        `atlas:${getObjectIdentityToken(atlas, "physical-atlas")}`,
        stableJson(getPhysicalBaseStyleSignature(runtimeState.styleConfig?.physical || {})),
      ].join("::");
    }
    if (passName === "political") {
      return [
        runtimeState.colorRevision || 0,
        getPoliticalPassStaticSignature(transform),
      ].join("::");
    }
    if (passName === "effects") {
      return [
        transformSignature,
        getPassTopologyRevision(passName),
        stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
      ].join("::");
    }
    if (passName === "lineEffects") {
      return [
        transformSignature,
        getPassTopologyRevision(passName),
        stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
      ].join("::");
    }
    if (passName === "contextBase") {
      const maskInfo = getPhysicalLandMaskInfo();
      const zoomBucket = getContextBaseZoomBucketId(transform?.k || runtimeState.zoomTransform?.k || 1);
      const baseSignatureParts = [
        getPassTopologyRevision(passName),
        runtimeState.activeScenarioId || "",
        runtimeState.deferContextBasePass ? "context-base:deferred" : "context-base:ready",
        `bucket:${zoomBucket}`,
        runtimeState.showPhysical ? "physical:on" : "physical:off",
        runtimeState.showUrban ? "urban:on" : "urban:off",
        runtimeState.showUrban && runtimeState.urbanData?.features?.length
          ? `urban-scale:${Number(transform?.k || runtimeState.zoomTransform?.k || 1).toFixed(4)}`
          : "urban-scale:inactive",
        runtimeState.showRivers ? "rivers:on" : "rivers:off",
        runtimeState.showRivers
          ? `river-bucket:${getRiverZoomBucket(transform?.k || runtimeState.zoomTransform?.k || 1)}`
          : "river-bucket:inactive",
        `context:${Number(runtimeState.contextLayerRevision || 0)}`,
        `context-colors:${shouldRefreshContextBaseForColorChanges() ? Number(runtimeState.colorRevision || 0) : 0}`,
        `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}:${maskInfo.maskQualityToken || "unchecked"}`,
        `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
        `field:physicalContour:${Number(intensityFields.channels.physicalContour?.revision || 0)}`,
        `field:physicalShading:${runtimeState.styleConfig?.physical?.hillshadeOpacity > 0 ? Number(intensityFields.channels.physicalAtlas?.revision || 0) : 0}`,
        `hillshade-scale:${!!runtimeState.showPhysical && runtimeState.styleConfig?.physical?.hillshadeOpacity > 0 && Number(transform?.k || 1) >= 4}`,
        runtimeState.showPhysical && runtimeState.styleConfig?.physical?.mode !== "atlas_only"
          ? `contour-lod:${resolveContourLodRequest({ styleConfig: runtimeState.styleConfig, zoomTransform: transform }).join("|")}`
          : "contour-lod:inactive",
        `field:urbanGlow:${Number(intensityFields.channels.urbanGlow?.revision || 0)}`,
        String(runtimeState.renderProfile || "auto"),
        stableJson(getPhysicalContextStyleSignature(runtimeState.styleConfig?.physical || {})),
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
        getPassTopologyRevision(passName),
        runtimeState.activeScenarioId || "",
        runtimeState.deferContextBasePass ? "context-markers:deferred" : "context-markers:ready",
        runtimeState.showCityPoints ? "cities:on" : "cities:off",
        runtimeState.showStrategicResourceMarkers ? "strategic-resources:on" : "strategic-resources:off",
        stableJson(runtimeState.styleConfig?.strategicValues || {}),
        ...getTransportPresentationSignatureParts(),
        ...getUrbanCityRenderPassSignatureParts(runtimeState, "contextMarkers"),
        stableJson(normalizeCityLayerStyleConfig(runtimeState.styleConfig?.cityPoints || {})),
      ].join("::");
    }
    if (passName === "labels") {
      const physicalStyle = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical || {});
      return [
        transformSignature,
        `physical-labels:${!!runtimeState.showPhysical}:${!!runtimeState.styleConfig?.physical?.showRegionLabels}:${runtimeState.styleConfig?.physical?.mode}:${runtimeState.showPhysical && physicalStyle.showRegionLabels ? physicalStyle.opacity : "inactive"}`,
        stableJson(runtimeState.styleConfig?.physical?.atlasClassVisibility || {}),
        getPassTopologyRevision(passName),
        runtimeState.activeScenarioId || "",
        `marine-data:${String(runtimeState.waterRegionsDataToken || "")}:${String(runtimeState.scenarioWaterOverlayVersionTag || "")}`,
        runtimeState.styleConfig?.ocean?.showRegionNames === true ? "marine-labels:on" : "marine-labels:off",
        runtimeState.styleConfig?.countryLabels?.enabled !== false ? "country-labels:on" : "country-labels:off",
        runtimeState.showWaterRegions ? "marine:on" : "marine:off",
        runtimeState.showOpenOceanRegions || runtimeState.allowOpenOceanPaint ? "open-ocean-labels:on" : "open-ocean-labels:off",
        `marine-selected:${String(runtimeState.selectedWaterRegionId || "")}`,
        `marine-language:${String(runtimeState.currentLanguage || "en")}`,
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
        getPassTopologyRevision(passName),
        runtimeState.activeScenarioId || "",
        runtimeState.scenarioReliefOverlayRevision || 0,
        getPopulationSignature(runtimeState),
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
        getPassTopologyRevision(passName),
        stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
      ].join("::");
    }
    if (passName === "dayNight") {
      return getDayNightRuntimeOwner().buildDayNightPassSignature(
        transformSignature, intensityFields.channels.urbanGlow?.revision, Number(getPassTopologyRevision(passName)),
      );
    }
    if (passName === "borders") {
      return [
        transformSignature,
        runtimeState.showWaterRegions ? "water:on" : "water:off",
        runtimeState.showScenarioAtlantropa !== false ? "atlantropa:on" : "atlantropa:off",
        getScenarioOverlaySignatureToken(),
        getPassTopologyRevision(passName),
        getBorderAppearanceRevision(),
        getPaintContourRevision(),
        getPoliticalBorderRevision(),
        runtimeState.cachedDynamicBordersHash || "",
        runtimeState.sovereigntyRevision || 0,
        0,
        runtimeState.activeScenarioId || "",
        runtimeState.scenarioBorderMode || "canonical",
        "paint-contours",
        stableJson(runtimeState.parentBorderEnabledByCountry || {}),
        stableJson(runtimeState.styleConfig?.internalBorders || {}),
        stableJson(runtimeState.styleConfig?.empireBorders || {}),
        stableJson(runtimeState.styleConfig?.coastlines || {}),
        stableJson(runtimeState.styleConfig?.parentBorders || {}),
      ].join("::");
    }
    return transformSignature;
  }

  return Object.freeze({ getPoliticalPassStaticSignature, getRenderPassTransformSignature, getRenderPassSignature, recordScopedTopologyChange });
}
