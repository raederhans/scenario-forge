function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

export function createPoliticalPassOrchestratorOwner({
  getters = {},
  resolvers = {},
  helpers = {},
  effects = {},
} = {}) {
  const isHgoRuntimePreviewReady = requireFunction(
    getters.isHgoRuntimePreviewReady,
    "getters.isHgoRuntimePreviewReady",
  );
  const isRenderDiagnosticsEnabled = requireFunction(
    getters.isRenderDiagnosticsEnabled,
    "getters.isRenderDiagnosticsEnabled",
  );
  const hasPoliticalLandFeatures = requireFunction(
    getters.hasPoliticalLandFeatures,
    "getters.hasPoliticalLandFeatures",
  );
  const isPoliticalRasterWorkerBitmapEnabled = requireFunction(
    getters.isPoliticalRasterWorkerBitmapEnabled,
    "getters.isPoliticalRasterWorkerBitmapEnabled",
  );
  const hasPendingPoliticalColorEdit = requireFunction(
    getters.hasPendingPoliticalColorEdit,
    "getters.hasPendingPoliticalColorEdit",
  );
  const isExportRendering = typeof getters.isExportRendering === "function"
    ? getters.isExportRendering
    : () => false;
  const resolvePoliticalPassIdentity = requireFunction(
    resolvers.resolvePoliticalPassIdentity,
    "resolvers.resolvePoliticalPassIdentity",
  );
  const resolvePoliticalPassViewport = requireFunction(
    resolvers.resolvePoliticalPassViewport,
    "resolvers.resolvePoliticalPassViewport",
  );
  const hasVisiblePoliticalForegroundColorOverride = requireFunction(
    resolvers.hasVisiblePoliticalForegroundColorOverride,
    "resolvers.hasVisiblePoliticalForegroundColorOverride",
  );
  const nowMs = requireFunction(helpers.nowMs, "helpers.nowMs");
  const createPoliticalPassDrawResult = requireFunction(
    helpers.createPoliticalPassDrawResult,
    "helpers.createPoliticalPassDrawResult",
  );
  const recordRenderPerfMetric = requireFunction(
    effects.recordRenderPerfMetric,
    "effects.recordRenderPerfMetric",
  );
  const resolvePoliticalRecoveryQualityEffect = requireFunction(
    effects.resolvePoliticalRecoveryQuality,
    "effects.resolvePoliticalRecoveryQuality",
  );
  const recordPoliticalRasterWorkerSnapshot = requireFunction(
    effects.recordPoliticalRasterWorkerSnapshot,
    "effects.recordPoliticalRasterWorkerSnapshot",
  );
  const publishPoliticalPassDiagnostics = requireFunction(
    effects.publishPoliticalPassDiagnostics,
    "effects.publishPoliticalPassDiagnostics",
  );
  const consumePoliticalRasterWorkerBitmapResult = requireFunction(
    effects.consumePoliticalRasterWorkerBitmapResult,
    "effects.consumePoliticalRasterWorkerBitmapResult",
  );
  const drawPoliticalWorkerBitmapResult = requireFunction(
    effects.drawPoliticalWorkerBitmapResult,
    "effects.drawPoliticalWorkerBitmapResult",
  );
  const drawPoliticalBackgroundFills = requireFunction(
    effects.drawPoliticalBackgroundFills,
    "effects.drawPoliticalBackgroundFills",
  );
  const buildPoliticalRasterWorkerPacketEffect = requireFunction(
    effects.buildPoliticalRasterWorkerPacket,
    "effects.buildPoliticalRasterWorkerPacket",
  );
  const requestPoliticalRasterWorkerPassEffect = requireFunction(
    effects.requestPoliticalRasterWorkerPass,
    "effects.requestPoliticalRasterWorkerPass",
  );
  const drawPoliticalFineFeatureLoop = requireFunction(
    effects.drawPoliticalFineFeatureLoop,
    "effects.drawPoliticalFineFeatureLoop",
  );
  const clearPendingPoliticalColorEdit = requireFunction(
    effects.clearPendingPoliticalColorEdit,
    "effects.clearPendingPoliticalColorEdit",
  );

  function resolveRecoveryQuality(backgroundSummary) {
    return String(backgroundSummary?.recoveryQuality || resolvePoliticalRecoveryQualityEffect());
  }

  function drawPoliticalPass(k) {
    if (isHgoRuntimePreviewReady()) {
      recordRenderPerfMetric("drawPoliticalPass", 0, {
        skipped: true,
        reason: "hgo-runtime-preview",
      });
      return;
    }

    const identity = resolvePoliticalPassIdentity(k);
    recordPoliticalRasterWorkerSnapshot();
    const viewport = resolvePoliticalPassViewport(identity);
    if (viewport.visibleStats) {
      recordRenderPerfMetric("politicalPassVisibleItems", 0, {
        visibleItemCount: Number(viewport.visibleItemCount || 0),
        ...viewport.visibleStats,
      });
    }
    if (isRenderDiagnosticsEnabled()) {
      publishPoliticalPassDiagnostics({ identity, viewport });
    }

    const consumedBitmapResult = isExportRendering()
      ? null
      : consumePoliticalRasterWorkerBitmapResult(identity.workerIdentity);
    if (
      consumedBitmapResult
      && drawPoliticalWorkerBitmapResult(consumedBitmapResult, identity.workerIdentity)
    ) {
      recordPoliticalRasterWorkerSnapshot();
      return createPoliticalPassDrawResult(identity.sceneIdentity, {
        politicalDataStage: "fine",
        fullPoliticalReady: true,
        finePoliticalCacheReady: true,
        reason: "political-raster-worker-bitmap",
      });
    }

    const backgroundStartedAt = nowMs();
    const backgroundSummary = drawPoliticalBackgroundFills({ identity, viewport });
    recordRenderPerfMetric(
      "drawPoliticalBackgroundFillsPass",
      nowMs() - backgroundStartedAt,
      {
        groupCount: Number(backgroundSummary?.groupCount || 0),
        entryCount: Number(backgroundSummary?.entryCount || 0),
        reusedPathCount: Number(backgroundSummary?.reusedPathCount || 0),
        builtPathCount: Number(backgroundSummary?.builtPathCount || 0),
        pathlessEntryCount: Number(backgroundSummary?.pathlessEntryCount || 0),
        cacheHit: !!backgroundSummary?.cacheHit,
        recoveryQuality: resolveRecoveryQuality(backgroundSummary),
        progressive: !!backgroundSummary?.progressive,
        deferredFullCacheReady: !!backgroundSummary?.deferredFullCacheReady,
        deferredFullCacheScheduled: !!backgroundSummary?.deferredFullCacheScheduled,
        coarseUnderlay: String(backgroundSummary?.coarseUnderlay || ""),
      },
    );
    if (!hasPoliticalLandFeatures()) {
      return createPoliticalPassDrawResult(identity.sceneIdentity, {
        politicalDataStage: "not-ready",
        fullPoliticalReady: false,
        finePoliticalCacheReady: false,
        reason: "missing-land-data",
      });
    }

    const packetState = !isExportRendering() && isPoliticalRasterWorkerBitmapEnabled()
      ? buildPoliticalRasterWorkerPacketEffect({ identity, viewport })
      : { packet: null, packetBuildMs: 0, reason: "bitmap-flag-disabled" };
    if (!isExportRendering()) requestPoliticalRasterWorkerPassEffect({ identity, viewport, packetState });
    recordPoliticalRasterWorkerSnapshot();

    const pendingPoliticalColorEdit = hasPendingPoliticalColorEdit();
    const progressiveRecoveryCoarseSkipCandidate = (
      !!backgroundSummary?.progressive
      && !backgroundSummary?.deferredFullCacheReady
      && String(backgroundSummary?.coarseUnderlay || "") === "admin0"
      && !pendingPoliticalColorEdit
    );
    const visiblePoliticalForegroundColorOverride = progressiveRecoveryCoarseSkipCandidate
      ? hasVisiblePoliticalForegroundColorOverride(viewport.visibleItems)
      : false;
    if (progressiveRecoveryCoarseSkipCandidate && !visiblePoliticalForegroundColorOverride) {
      recordRenderPerfMetric("drawPoliticalFeatureFillLoop", 0, {
        renderedCount: 0,
        visibleItemCount: viewport.visibleItemCount,
        skipped: true,
        reason: "progressive-coarse-underlay",
        recoveryQuality: resolveRecoveryQuality(backgroundSummary),
      });
      recordRenderPerfMetric("drawPoliticalFeatureStrokeLoop", 0, {
        renderedCount: 0,
        visibleItemCount: viewport.visibleItemCount,
        skipped: true,
        reason: "progressive-coarse-underlay",
        recoveryQuality: resolveRecoveryQuality(backgroundSummary),
      });
      return createPoliticalPassDrawResult(identity.sceneIdentity, {
        politicalDataStage: "coarse",
        fullPoliticalReady: !!backgroundSummary?.deferredFullCacheReady
          || !!identity.sceneIdentity.fullPoliticalReady,
        finePoliticalCacheReady: false,
        coarseUnderlay: String(backgroundSummary?.coarseUnderlay || ""),
        reason: "progressive-coarse-underlay",
      });
    }

    const featureMetrics = drawPoliticalFineFeatureLoop({ k, identity, viewport });
    recordRenderPerfMetric("drawPoliticalFeatureFillLoop", Number(featureMetrics.fillMs || 0), {
      renderedCount: Number(featureMetrics.renderedCount || 0),
      visibleItemCount: viewport.visibleItemCount,
    });
    recordRenderPerfMetric("drawPoliticalFeatureStrokeLoop", Number(featureMetrics.strokeMs || 0), {
      renderedCount: Number(featureMetrics.renderedCount || 0),
      visibleItemCount: viewport.visibleItemCount,
    });
    if (!isExportRendering()) {
      clearPendingPoliticalColorEdit({
        renderedCount: Number(featureMetrics.renderedCount || 0),
        renderedIds: featureMetrics.renderedIds,
        paintSource: "political-pass",
      });
    }
    return createPoliticalPassDrawResult(identity.sceneIdentity, {
      politicalDataStage: "fine",
      fullPoliticalReady: true,
      finePoliticalCacheReady: true,
      reason: "fine-feature-loop",
    });
  }

  return Object.freeze({ drawPoliticalPass });
}
