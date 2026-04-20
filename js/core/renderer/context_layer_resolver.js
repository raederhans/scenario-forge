export function createContextLayerResolverOwner({
  state,
  caches = {},
  constants = {},
  helpers = {},
} = {}) {
  const {
    layerResolverCache = null,
  } = caches;

  const {
    contextLayerMinScore = 0.08,
    layerDiagPrefix = "[layer-resolver]",
    urbanCorruptBoundsHeightDeg = 150,
    urbanCorruptBoundsWidthDeg = 300,
  } = constants;

  const {
    clamp = (value) => Number(value) || 0,
    ensureBathymetryDataAvailability = () => false,
    getContextLayerStableSourceToken = () => "",
    getUrbanFeatureOwnerId = () => "",
    getUrbanFeatureStableId = () => "",
    resetScenarioWaterCacheAdaptiveState = () => {},
  } = helpers;

  function getLayerFeatureCollection(topology, layerName) {
    if (!topology?.objects || !globalThis.topojson) return null;
    const object = topology.objects[layerName];
    if (!object) return null;
    try {
      const collection = globalThis.topojson.feature(topology, object);
      if (!collection || !Array.isArray(collection.features)) return null;
      return collection;
    } catch (error) {
      console.warn(`${layerDiagPrefix} Failed to decode layer "${layerName}":`, error);
      return null;
    }
  }

  function computeLayerCoverageScore(collection) {
    if (!collection?.features?.length || !globalThis.d3?.geoBounds) return 0;
    try {
      const [[minLon, minLat], [maxLon, maxLat]] = globalThis.d3.geoBounds(collection);
      if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return 0;
      let width = maxLon - minLon;
      if (width < 0) width += 360;
      const height = Math.max(0, maxLat - minLat);
      const normalizedArea = clamp((width * height) / (360 * 180), 0, 1);
      const densityBoost = Math.min(1, Math.log10(collection.features.length + 1) / 4);
      return clamp(normalizedArea * 0.8 + densityBoost * 0.2, 0, 1);
    } catch (_error) {
      return 0;
    }
  }

  function createUrbanLayerCapability(overrides = {}) {
    return {
      featureCount: 0,
      hasGeometry: false,
      hasStableId: false,
      hasOwnerMeta: false,
      hasCorruptBounds: false,
      missingStableIdCount: 0,
      missingOwnerCount: 0,
      corruptBoundsCount: 0,
      adaptiveAvailable: false,
      unavailableReason: "Urban layer data unavailable.",
      ...overrides,
    };
  }

  function getUrbanFeatureGeoBounds(feature) {
    if (!feature || !globalThis.d3?.geoBounds) return null;
    try {
      const bounds = globalThis.d3.geoBounds(feature);
      if (!Array.isArray(bounds) || bounds.length !== 2) return null;
      const [[minLon, minLat], [maxLon, maxLat]] = bounds;
      if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
      let width = maxLon - minLon;
      if (width < 0) width += 360;
      const height = Math.max(0, maxLat - minLat);
      return {
        width,
        height,
      };
    } catch (_error) {
      return null;
    }
  }

  function getUrbanCapabilityUnavailableReason(capability) {
    if (!capability?.hasGeometry) {
      return "Urban layer data unavailable.";
    }
    if (capability.hasCorruptBounds) {
      return "Urban layer geometry is corrupt; rebuild the topology before using Adaptive mode.";
    }
    if (!capability.hasStableId) {
      return "Urban layer is missing stable IDs; Adaptive mode is disabled until the topology is rebuilt.";
    }
    if (!capability.hasOwnerMeta) {
      return "Urban layer is missing country owner metadata; Adaptive mode is disabled until the topology is rebuilt.";
    }
    return "";
  }

  function getUrbanLayerCapability(collection) {
    const features = Array.isArray(collection?.features) ? collection.features : [];
    if (!features.length) {
      return createUrbanLayerCapability();
    }

    let missingStableIdCount = 0;
    let missingOwnerCount = 0;
    let corruptBoundsCount = 0;

    features.forEach((feature) => {
      if (!getUrbanFeatureStableId(feature)) {
        missingStableIdCount += 1;
      }
      if (!getUrbanFeatureOwnerId(feature)) {
        missingOwnerCount += 1;
      }
      const bounds = getUrbanFeatureGeoBounds(feature);
      if (
        bounds
        && (bounds.width >= urbanCorruptBoundsWidthDeg || bounds.height >= urbanCorruptBoundsHeightDeg)
      ) {
        corruptBoundsCount += 1;
      }
    });

    const capability = createUrbanLayerCapability({
      featureCount: features.length,
      hasGeometry: true,
      hasStableId: missingStableIdCount === 0,
      hasOwnerMeta: missingOwnerCount === 0,
      hasCorruptBounds: corruptBoundsCount > 0,
      missingStableIdCount,
      missingOwnerCount,
      corruptBoundsCount,
    });
    capability.adaptiveAvailable = capability.hasGeometry
      && capability.hasStableId
      && capability.hasOwnerMeta
      && !capability.hasCorruptBounds;
    capability.unavailableReason = getUrbanCapabilityUnavailableReason(capability);
    return capability;
  }

  function canRenderUrbanCollection(capability) {
    return !!capability?.hasGeometry && !capability?.hasCorruptBounds;
  }

  function canPreferUrbanDetailCollection(capability) {
    return canRenderUrbanCollection(capability) && !!capability?.hasStableId && !!capability?.hasOwnerMeta;
  }

  function pickBestLayerSource(primaryCollection, detailCollection, policy = {}) {
    const minScore = Number.isFinite(Number(policy.minScore))
      ? Number(policy.minScore)
      : contextLayerMinScore;
    const preferDetailWhenPrimaryEmpty = !!policy.preferDetailWhenPrimaryEmpty;
    const primaryCount = Array.isArray(primaryCollection?.features) ? primaryCollection.features.length : 0;
    const detailCount = Array.isArray(detailCollection?.features) ? detailCollection.features.length : 0;
    const primaryScore = computeLayerCoverageScore(primaryCollection);
    const detailScore = computeLayerCoverageScore(detailCollection);

    if (!primaryCount && !detailCount) {
      return {
        collection: null,
        source: "none",
        primaryScore,
        detailScore,
        primaryCount,
        detailCount,
      };
    }

    if (!primaryCount && detailCount) {
      return {
        collection: detailCollection,
        source: "detail",
        primaryScore,
        detailScore,
        primaryCount,
        detailCount,
      };
    }

    if (primaryCount && !detailCount) {
      return {
        collection: primaryCollection,
        source: "primary",
        primaryScore,
        detailScore,
        primaryCount,
        detailCount,
      };
    }

    if (preferDetailWhenPrimaryEmpty && primaryCount === 0 && detailCount > 0) {
      return {
        collection: detailCollection,
        source: "detail",
        primaryScore,
        detailScore,
        primaryCount,
        detailCount,
      };
    }

    if (primaryScore >= minScore && primaryScore >= detailScore * 0.65) {
      return {
        collection: primaryCollection,
        source: "primary",
        primaryScore,
        detailScore,
        primaryCount,
        detailCount,
      };
    }

    if (detailScore > primaryScore || detailCount > primaryCount * 1.25) {
      return {
        collection: detailCollection,
        source: "detail",
        primaryScore,
        detailScore,
        primaryCount,
        detailCount,
      };
    }

    return {
      collection: primaryCollection,
      source: "primary",
      primaryScore,
      detailScore,
      primaryCount,
      detailCount,
    };
  }

  function resolveContextLayerData(layerName) {
    const externalContextCollection = state.contextLayerExternalDataByName?.[layerName];
    if (
      layerName === "special_zones" &&
      Array.isArray(state.specialZonesExternalData?.features)
    ) {
      if (!state.layerDataDiagnostics || typeof state.layerDataDiagnostics !== "object") {
        state.layerDataDiagnostics = {};
      }
      if (!state.contextLayerSourceByName || typeof state.contextLayerSourceByName !== "object") {
        state.contextLayerSourceByName = {};
      }
      state.contextLayerSourceByName[layerName] = "external";
      state.layerDataDiagnostics[layerName] = {
        source: "external",
        primaryCount: 0,
        detailCount: state.specialZonesExternalData.features.length,
        primaryScore: 0,
        detailScore: 1,
      };
      return state.specialZonesExternalData;
    }

    const primaryTopology = state.topologyPrimary || state.topology;
    const detailTopology = state.topologyDetail;
    const primaryCollection = getLayerFeatureCollection(primaryTopology, layerName);
    const detailCollection = getLayerFeatureCollection(detailTopology, layerName);
    const isUrbanLayer = layerName === "urban";
    const primaryUrbanCapability = isUrbanLayer ? getUrbanLayerCapability(primaryCollection) : null;
    const detailUrbanCapability = isUrbanLayer ? getUrbanLayerCapability(detailCollection) : null;
    const externalUrbanCapability = isUrbanLayer ? getUrbanLayerCapability(externalContextCollection) : null;
    const preferExternalUrban =
      isUrbanLayer
      && canPreferUrbanDetailCollection(externalUrbanCapability)
      && !canPreferUrbanDetailCollection(primaryUrbanCapability)
      && !canPreferUrbanDetailCollection(detailUrbanCapability);

    if (preferExternalUrban) {
      if (!state.layerDataDiagnostics || typeof state.layerDataDiagnostics !== "object") {
        state.layerDataDiagnostics = {};
      }
      if (!state.contextLayerSourceByName || typeof state.contextLayerSourceByName !== "object") {
        state.contextLayerSourceByName = {};
      }
      state.contextLayerSourceByName[layerName] = "external";
      state.layerDataDiagnostics[layerName] = {
        source: "external",
        primaryCount: Array.isArray(primaryCollection?.features) ? primaryCollection.features.length : 0,
        detailCount: Array.isArray(detailCollection?.features) ? detailCollection.features.length : 0,
        primaryScore: Number(computeLayerCoverageScore(primaryCollection).toFixed(3)),
        detailScore: Number(computeLayerCoverageScore(detailCollection).toFixed(3)),
        externalCount: Array.isArray(externalContextCollection?.features) ? externalContextCollection.features.length : 0,
        externalScore: Number(computeLayerCoverageScore(externalContextCollection).toFixed(3)),
        primaryAdaptiveAvailable: !!primaryUrbanCapability?.adaptiveAvailable,
        detailAdaptiveAvailable: !!detailUrbanCapability?.adaptiveAvailable,
        externalAdaptiveAvailable: !!externalUrbanCapability?.adaptiveAvailable,
        primaryMissingStableIds: Number(primaryUrbanCapability?.missingStableIdCount || 0),
        primaryMissingOwnerMeta: Number(primaryUrbanCapability?.missingOwnerCount || 0),
        detailMissingStableIds: Number(detailUrbanCapability?.missingStableIdCount || 0),
        detailMissingOwnerMeta: Number(detailUrbanCapability?.missingOwnerCount || 0),
        externalMissingStableIds: Number(externalUrbanCapability?.missingStableIdCount || 0),
        externalMissingOwnerMeta: Number(externalUrbanCapability?.missingOwnerCount || 0),
      };
      state.urbanLayerCapability = externalUrbanCapability;
      return externalContextCollection;
    }

    const pick = pickBestLayerSource(
      isUrbanLayer && !canRenderUrbanCollection(primaryUrbanCapability) ? null : primaryCollection,
      isUrbanLayer && !canPreferUrbanDetailCollection(detailUrbanCapability) ? null : detailCollection,
      {
        minScore: layerName === "special_zones" ? 0 : contextLayerMinScore,
        preferDetailWhenPrimaryEmpty: layerName === "special_zones",
      }
    );

    if (!state.layerDataDiagnostics || typeof state.layerDataDiagnostics !== "object") {
      state.layerDataDiagnostics = {};
    }
    if (!state.contextLayerSourceByName || typeof state.contextLayerSourceByName !== "object") {
      state.contextLayerSourceByName = {};
    }

    state.contextLayerSourceByName[layerName] = pick.source;
    state.layerDataDiagnostics[layerName] = {
      source: pick.source,
      primaryCount: pick.primaryCount,
      detailCount: pick.detailCount,
      primaryScore: Number(pick.primaryScore.toFixed(3)),
      detailScore: Number(pick.detailScore.toFixed(3)),
      ...(isUrbanLayer
        ? {
            primaryAdaptiveAvailable: !!primaryUrbanCapability?.adaptiveAvailable,
            detailAdaptiveAvailable: !!detailUrbanCapability?.adaptiveAvailable,
            primaryMissingStableIds: Number(primaryUrbanCapability?.missingStableIdCount || 0),
            primaryMissingOwnerMeta: Number(primaryUrbanCapability?.missingOwnerCount || 0),
            primaryCorruptBounds: Number(primaryUrbanCapability?.corruptBoundsCount || 0),
            detailMissingStableIds: Number(detailUrbanCapability?.missingStableIdCount || 0),
            detailMissingOwnerMeta: Number(detailUrbanCapability?.missingOwnerCount || 0),
            detailCorruptBounds: Number(detailUrbanCapability?.corruptBoundsCount || 0),
          }
        : {}),
    };

    if (isUrbanLayer) {
      state.urbanLayerCapability = pick.source === "detail"
        ? detailUrbanCapability
        : primaryUrbanCapability;
    }

    if (pick.source === "none" && Array.isArray(externalContextCollection?.features)) {
      if (isUrbanLayer && !canRenderUrbanCollection(externalUrbanCapability)) {
        state.urbanLayerCapability = externalUrbanCapability;
        return pick.collection;
      }
      state.contextLayerSourceByName[layerName] = "external";
      state.layerDataDiagnostics[layerName] = {
        source: "external",
        primaryCount: pick.primaryCount,
        detailCount: externalContextCollection.features.length,
        primaryScore: Number(pick.primaryScore.toFixed(3)),
        detailScore: 1,
        ...(isUrbanLayer
          ? {
              externalAdaptiveAvailable: !!externalUrbanCapability?.adaptiveAvailable,
              externalMissingStableIds: Number(externalUrbanCapability?.missingStableIdCount || 0),
              externalMissingOwnerMeta: Number(externalUrbanCapability?.missingOwnerCount || 0),
              externalCorruptBounds: Number(externalUrbanCapability?.corruptBoundsCount || 0),
            }
          : {}),
      };
      if (isUrbanLayer) {
        state.urbanLayerCapability = externalUrbanCapability;
      }
      return externalContextCollection;
    }

    if (isUrbanLayer && !state.urbanLayerCapability) {
      state.urbanLayerCapability = createUrbanLayerCapability();
    }

    return pick.collection;
  }

  function ensureLayerDataFromTopology() {
    const primaryTopology = state.topologyPrimary || state.topology;
    if (!primaryTopology || !globalThis.topojson) return;

    if (!state.manualSpecialZones || state.manualSpecialZones.type !== "FeatureCollection") {
      state.manualSpecialZones = { type: "FeatureCollection", features: [] };
    }
    if (!Array.isArray(state.manualSpecialZones.features)) {
      state.manualSpecialZones.features = [];
    }

    const sameSource =
      layerResolverCache.primaryRef === primaryTopology &&
      layerResolverCache.detailRef === state.topologyDetail &&
      layerResolverCache.bundleMode === state.topologyBundleMode &&
      layerResolverCache.contextRevision === Number(state.contextLayerRevision || 0);
    if (sameSource) {
      return;
    }

    state.oceanData = resolveContextLayerData("ocean");
    state.landBgData = resolveContextLayerData("land");
    const previousWaterRegionsDataToken = String(layerResolverCache.waterRegionsDataToken || "");
    const nextWaterRegionsData = resolveContextLayerData("water_regions");
    state.waterRegionsData = nextWaterRegionsData;
    const nextWaterRegionsDataToken = getContextLayerStableSourceToken("water_regions", nextWaterRegionsData, {
      primaryTopology,
      detailTopology: state.topologyDetail,
      externalCollection: state.contextLayerExternalDataByName?.water_regions,
      source: state.contextLayerSourceByName?.water_regions,
    });
    layerResolverCache.waterRegionsDataToken = nextWaterRegionsDataToken;
    state.riversData = resolveContextLayerData("rivers");
    state.urbanData = resolveContextLayerData("urban");
    state.physicalData = resolveContextLayerData("physical");
    state.specialZonesData = resolveContextLayerData("special_zones");
    if (previousWaterRegionsDataToken !== nextWaterRegionsDataToken) {
      resetScenarioWaterCacheAdaptiveState("water-regions-data-replaced");
    }
    ensureBathymetryDataAvailability({ required: false });

    const diag = state.layerDataDiagnostics || {};
    console.info(
      `${layerDiagPrefix} sources: ocean=${diag.ocean?.source || "none"}, `
        + `land=${diag.land?.source || "none"}, water_regions=${diag.water_regions?.source || "none"}, `
        + `rivers=${diag.rivers?.source || "none"}, `
        + `urban=${diag.urban?.source || "none"}, physical=${diag.physical?.source || "none"}, `
        + `special_zones=${diag.special_zones?.source || "none"}, `
        + `bathymetry=${state.activeBathymetrySource || "none"}`
    );
    if (typeof state.updateToolbarInputsFn === "function") {
      state.updateToolbarInputsFn();
    }

    if (state.topologyBundleMode !== "composite" && primaryTopology?.objects?.political) {
      const expectedCount = Array.isArray(primaryTopology.objects.political.geometries)
        ? primaryTopology.objects.political.geometries.length
        : 0;
      const currentCount = Array.isArray(state.landData?.features)
        ? state.landData.features.length
        : 0;
      const fullCount = Array.isArray(state.landDataFull?.features)
        ? state.landDataFull.features.length
        : 0;
      if (currentCount !== expectedCount || fullCount !== expectedCount) {
        const primaryCollection = globalThis.topojson.feature(primaryTopology, primaryTopology.objects.political);
        state.landDataFull = primaryCollection;
        state.landData = primaryCollection;
      }
    }

    layerResolverCache.primaryRef = primaryTopology;
    layerResolverCache.detailRef = state.topologyDetail;
    layerResolverCache.bundleMode = state.topologyBundleMode;
    layerResolverCache.contextRevision = Number(state.contextLayerRevision || 0);

    if (typeof state.updateSpecialZoneEditorUIFn === "function") {
      state.updateSpecialZoneEditorUIFn();
    }
  }

  return {
    canPreferUrbanDetailCollection,
    canRenderUrbanCollection,
    computeLayerCoverageScore,
    createUrbanLayerCapability,
    ensureLayerDataFromTopology,
    getLayerFeatureCollection,
    getUrbanFeatureGeoBounds,
    getUrbanLayerCapability,
    pickBestLayerSource,
    resolveContextLayerData,
  };
}
