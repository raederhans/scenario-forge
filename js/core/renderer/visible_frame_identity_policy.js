// Owns visible frame identity policy decisions; inputs remain live.
export function createVisibleFrameIdentityPolicy(runtimeState, {
  areZoomTransformsEquivalent,
  cloneZoomTransform,
  ensureCurrentSceneSnapshot,
  getCachedPoliticalPassStaticSignature,
  getOceanBaseFillColor,
  getPassFullReferenceTransform,
  getPassReferenceTransform,
  getRenderPassCacheState,
  getRenderPassSignature,
  getResolvedColorCountForSceneSnapshot,
  getTransformBucketSignature,
  rendererSurfaceHost,
}) {
  function getRuntimeChunkSelectionVersion() {
    const loadState = runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object"
      ? runtimeState.runtimeChunkLoadState
      : null;
    return Math.max(0, Number(loadState?.selectionVersion || 0));
  }

  function getVisibleContextFlagSignature() {
    return [
      `view:${"ownership"}`,
      `profile:${String(runtimeState.renderProfile || "auto")}`,
      runtimeState.showPhysical ? "physical:on" : "physical:off",
      runtimeState.showUrban ? "urban:on" : "urban:off",
      runtimeState.showRivers ? "rivers:on" : "rivers:off",
      runtimeState.showWaterRegions ? "water:on" : "water:off",
      runtimeState.showOpenOceanRegions ? "open-ocean:on" : "open-ocean:off",
      runtimeState.showScenarioSpecialRegions ? "special:on" : "special:off",
      runtimeState.showScenarioReliefOverlays ? "relief:on" : "relief:off",
      runtimeState.showCityPoints ? "cities:on" : "cities:off",
      runtimeState.showStrategicResourceMarkers ? "strategic-resources:on" : "strategic-resources:off",
      `strategic-rev:${Number(runtimeState.scenarioStrategicValuesRevision || 0)}`,
      `strategic-metric:${String(runtimeState.strategicChoroplethMetric || "")}`,
      runtimeState.showTransport ? "transport:on" : "transport:off",
      runtimeState.showRoad ? "road:on" : "road:off",
      runtimeState.showAirports ? "airports:on" : "airports:off",
      runtimeState.showPorts ? "ports:on" : "ports:off",
      runtimeState.showRail ? "rail:on" : "rail:off",
      runtimeState.deferContextBasePass ? "context-base:deferred" : "context-base:ready",
      `context-rev:${Number(runtimeState.contextLayerRevision || 0)}`,
      `city-rev:${Number(runtimeState.cityLayerRevision || 0)}`,
    ].join("|");
  }

  function countFeatureCollectionFeatures(collection) {
    return Array.isArray(collection?.features) ? collection.features.length : 0;
  }

  function getPoliticalSceneReadiness() {
    const cache = getRenderPassCacheState();
    const scenarioPoliticalFeatureCount = countFeatureCollectionFeatures(runtimeState.scenarioPoliticalChunkData);
    const landFeatureCount = Math.max(
      countFeatureCollectionFeatures(runtimeState.landDataFull),
      countFeatureCollectionFeatures(runtimeState.landData),
    );
    const colorCount = getResolvedColorCountForSceneSnapshot();
    const fullPoliticalReady = !!(
      String(runtimeState.activeScenarioId || "")
      && scenarioPoliticalFeatureCount > 0
      && landFeatureCount > 0
      && colorCount > 0
    );
    const politicalPassCurrent = !!(
      Number(cache.politicalPassSceneGeneration || 0) === Number(runtimeState.sceneGeneration || 0)
      && Number(cache.politicalPassScenarioDataGeneration || 0) === Number(runtimeState.scenarioDataGeneration || 0)
    );
    const finePoliticalCacheReady = !!(
      cache.politicalPassFineCacheReady
      && cache.politicalPassDataStage === "fine"
      && politicalPassCurrent
    );
    const politicalDataStage = finePoliticalCacheReady
      ? "fine"
      : (fullPoliticalReady ? (politicalPassCurrent ? String(cache.politicalPassDataStage || "data-ready") : "data-ready") : "not-ready");
    return {
      politicalDataStage,
      fullPoliticalReady,
      finePoliticalCacheReady,
      scenarioPoliticalFeatureCount,
      landFeatureCount,
      colorCount,
    };
  }

  function getVisibleFrameIdentity(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    ensureCurrentSceneSnapshot("visible-frame-identity");
    const politicalReadiness = getPoliticalSceneReadiness();
    return {
      sceneGeneration: Math.max(0, Number(runtimeState.sceneGeneration || 0)),
      scenarioDataGeneration: Math.max(0, Number(runtimeState.scenarioDataGeneration || 0)),
      scenarioId: String(runtimeState.activeScenarioId || ""),
      selectionVersion: getRuntimeChunkSelectionVersion(),
      topologyRevision: Math.max(0, Number(runtimeState.topologyRevision || 0)),
      dpr: Math.max(1, Number(runtimeState.dpr || 1)),
      pixelWidth: Math.max(1, Number(rendererSurfaceHost.getContext()?.canvas?.width || 1)),
      pixelHeight: Math.max(1, Number(rendererSurfaceHost.getContext()?.canvas?.height || 1)),
      colorRevision: Number(runtimeState.colorRevision || 0),
      contextFlagSignature: getVisibleContextFlagSignature(),
      transformBucket: getTransformBucketSignature(transform),
      politicalDataStage: politicalReadiness.politicalDataStage,
      fullPoliticalReady: politicalReadiness.fullPoliticalReady,
      finePoliticalCacheReady: politicalReadiness.finePoliticalCacheReady,
      transform: cloneZoomTransform(transform),
    };
  }

  function getCommittedFrameKeySignature(commitKey = {}) {
    return [
      String(commitKey.scenarioId || ""),
      Number(commitKey.sceneGeneration || 0),
      Number(commitKey.scenarioDataGeneration || 0),
      Number(commitKey.selectionVersion || 0),
      Number(commitKey.topologyRevision || 0),
      Number(commitKey.colorRevision || 0),
      String(commitKey.contextFlagSignature || ""),
      Number(commitKey.dpr || 1).toFixed(2),
      Number(commitKey.pixelWidth || 0),
      Number(commitKey.pixelHeight || 0),
    ].join("::");
  }

  function getCommittedFrameIdentity(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity, metadata = {}) {
    const identity = getVisibleFrameIdentity(transform);
    const cache = getRenderPassCacheState();
    const commitKey = {
      scenarioId: identity.scenarioId,
      sceneGeneration: identity.sceneGeneration,
      scenarioDataGeneration: identity.scenarioDataGeneration,
      selectionVersion: identity.selectionVersion,
      topologyRevision: identity.topologyRevision,
      colorRevision: identity.colorRevision,
      contextFlagSignature: identity.contextFlagSignature,
      dpr: identity.dpr,
      pixelWidth: identity.pixelWidth,
      pixelHeight: identity.pixelHeight,
    };
    return {
      commitKey,
      metadata: {
        politicalDataStage: identity.politicalDataStage,
        fullPoliticalReady: identity.fullPoliticalReady,
        finePoliticalCacheReady: identity.finePoliticalCacheReady,
        referenceTransform: cloneZoomTransform(transform),
        transformBucket: identity.transformBucket,
        passSignature: getRenderPassSignature("political", transform),
        dirtyReasons: { ...(cache.reasons || {}) },
        resourcesReady: {
          politicalPassCurrent: !cache.dirty?.political,
          fullPoliticalReady: identity.fullPoliticalReady,
          finePoliticalCacheReady: identity.finePoliticalCacheReady,
        },
        ...metadata,
      },
    };
  }

  function getFirstVisiblePoliticalFrameBlockReason(reason = "visible-frame") {
    const activeScenarioId = String(runtimeState.activeScenarioId || "").trim();
    if (!activeScenarioId) return "";
    const normalizedReason = String(reason || "visible-frame");
    if (normalizedReason === "base-visible-fallback") {
      return "base-visible-fallback";
    }
    if (normalizedReason !== "exact-frame") {
      return `${normalizedReason}-before-current-political-frame`;
    }
    const cache = getRenderPassCacheState();
    if (cache.dirty?.political) {
      return "dirty-political-pass";
    }
    const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity;
    const expectedSignature = getRenderPassSignature("political", transform);
    if (String(cache.signatures?.political || "") !== String(expectedSignature || "")) {
      const cachedOceanFill = getCachedPoliticalPassStaticSignature(cache.signatures?.political)
        .split("::")
        .find((part) => String(part || "").startsWith("ocean-fill:"));
      if (cachedOceanFill && cachedOceanFill !== `ocean-fill:${getOceanBaseFillColor()}`) {
        return "stale-ocean-fill";
      }
      return "stale-political-signature";
    }
    const referenceTransform = getPassReferenceTransform("political");
    if (!referenceTransform || !areZoomTransformsEquivalent(referenceTransform, transform)) {
      return "stale-political-reference-transform";
    }
    if (String(cache.politicalPassDataStage || "") === "fine" && cache.politicalPassFineCacheReady) {
      const fullReferenceTransform = getPassFullReferenceTransform("political");
      if (!fullReferenceTransform || !areZoomTransformsEquivalent(fullReferenceTransform, transform)) {
        return "stale-political-full-reference-transform";
      }
    }
    return "";
  }

  function canDrawBaseVisibleFrameFallback() {
    return !runtimeState.firstVisibleFramePainted || !Array.isArray(runtimeState.landData?.features) || runtimeState.landData.features.length === 0;
  }

  return Object.freeze({ getRuntimeChunkSelectionVersion, getVisibleContextFlagSignature, getVisibleFrameIdentity, getCommittedFrameKeySignature, getCommittedFrameIdentity, getFirstVisiblePoliticalFrameBlockReason, canDrawBaseVisibleFrameFallback });
}
