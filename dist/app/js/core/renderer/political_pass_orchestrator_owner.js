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
  const hasInlinePoliticalPartitions = typeof getters.hasInlinePoliticalPartitions === "function"
    ? getters.hasInlinePoliticalPartitions
    : () => false;
  const isPoliticalIdRasterSelected = typeof getters.isPoliticalIdRasterSelected === "function"
    ? getters.isPoliticalIdRasterSelected
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
  const drawPoliticalIdRasterFine = typeof effects.drawPoliticalIdRasterFine === "function"
    ? effects.drawPoliticalIdRasterFine
    : () => null;
  const clearPendingPoliticalColorEdit = requireFunction(
    effects.clearPendingPoliticalColorEdit,
    "effects.clearPendingPoliticalColorEdit",
  );
  const counters = { passes: 0, rasterPrimaryPasses: 0, hybridRasterPasses: 0,
    nativeBackgroundPasses: 0, nativeFinePasses: 0, nativeFallbackPasses: 0, nativePartialRepaints: 0 };
  let lastBackend = "none", lastReason = "not-drawn";
  const validRasterMetrics = metrics => metrics && typeof metrics === "object"
    && Object.hasOwn(metrics, "renderedIds") && Number.isFinite(Number(metrics.fillMs))
    && Number.isFinite(Number(metrics.strokeMs)) && Number.isFinite(Number(metrics.renderedCount));
  function commitRaster(metrics, identity, viewport, primary) {
    for (const [metric, value] of [["drawPoliticalFeatureFillLoop", metrics.fillMs], ["drawPoliticalFeatureStrokeLoop", metrics.strokeMs]]) {
      recordRenderPerfMetric(metric, Number(value || 0), { renderedCount: Number(metrics.renderedCount || 0),
        visibleItemCount: viewport.visibleItemCount, source: "political-id-raster" });
    }
    clearPendingPoliticalColorEdit({ renderedCount: Number(metrics.renderedCount || 0),
      renderedIds: metrics.renderedIds, paintSource: "political-id-raster" });
    counters[primary ? "rasterPrimaryPasses" : "hybridRasterPasses"]++;
    lastBackend = primary ? "raster" : "hybrid-raster";
    lastReason = primary ? "complete-raster-coverage" : "fine-raster-coverage";
    if (primary) effects.cancelNativeBackgroundPreparation?.();
    return createPoliticalPassDrawResult(identity.sceneIdentity, {
      politicalDataStage: "fine", fullPoliticalReady: true, finePoliticalCacheReady: true,
      reason: primary ? "political-id-raster-primary" : "political-id-raster",
    });
  }
  function resolveRecoveryQuality(backgroundSummary) {
    return String(backgroundSummary?.recoveryQuality || resolvePoliticalRecoveryQualityEffect());
  }
  function drawBasePoliticalPass(k) {
    counters.passes++;
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
    const exportRendering = isExportRendering();
    const inlinePoliticalPartitions = hasInlinePoliticalPartitions();
    const idRasterSelected = !exportRendering && !inlinePoliticalPartitions && isPoliticalIdRasterSelected();
    const consumedBitmapResult = exportRendering || inlinePoliticalPartitions || idRasterSelected
      ? null
      : consumePoliticalRasterWorkerBitmapResult(identity.workerIdentity);
    if (
      consumedBitmapResult
      && drawPoliticalWorkerBitmapResult(consumedBitmapResult, identity.workerIdentity)
    ) {
      recordPoliticalRasterWorkerSnapshot();
      lastBackend = "worker-bitmap"; lastReason = "political-raster-worker-bitmap";
      return createPoliticalPassDrawResult(identity.sceneIdentity, {
        politicalDataStage: "fine",
        fullPoliticalReady: true,
        finePoliticalCacheReady: true,
        reason: "political-raster-worker-bitmap",
      });
    }
    const primaryRaster = idRasterSelected && getters.isPoliticalIdRasterPrimary?.() === true;
    if (primaryRaster && hasPoliticalLandFeatures()) {
      const metrics = drawPoliticalIdRasterFine({ k, identity, viewport });
      if (validRasterMetrics(metrics)) return commitRaster(metrics, identity, viewport, true);
      counters.nativeFallbackPasses++;
    }
    counters.nativeBackgroundPasses++;
    // Export draws into a separate target; it must not relabel the visible editor frame.
    if (!exportRendering) { lastBackend = "vector"; lastReason = primaryRaster ? "raster-unavailable" : inlinePoliticalPartitions ? "river-partitions" : "native-policy"; }
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
    if (idRasterSelected && !primaryRaster) {
      const metrics = drawPoliticalIdRasterFine({ k, identity, viewport });
      if (validRasterMetrics(metrics)) return commitRaster(metrics, identity, viewport, false);
    }

    const packetState = !idRasterSelected && !exportRendering && !inlinePoliticalPartitions && isPoliticalRasterWorkerBitmapEnabled()
      ? buildPoliticalRasterWorkerPacketEffect({ identity, viewport })
      : { packet: null, packetBuildMs: 0, reason: "bitmap-flag-disabled" };
    if (!idRasterSelected && !exportRendering && !inlinePoliticalPartitions) requestPoliticalRasterWorkerPassEffect({ identity, viewport, packetState });
    if (!idRasterSelected) recordPoliticalRasterWorkerSnapshot();

    const pendingPoliticalColorEdit = hasPendingPoliticalColorEdit();
    const progressiveRecoveryCoarseSkipCandidate = (
      !inlinePoliticalPartitions
      && !!backgroundSummary?.progressive
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

    counters.nativeFinePasses++;
    const featureMetrics = drawPoliticalFineFeatureLoop({ k, identity, viewport });
    recordRenderPerfMetric("drawPoliticalFeatureFillLoop", Number(featureMetrics.fillMs || 0), {
      renderedCount: Number(featureMetrics.renderedCount || 0),
      visibleItemCount: viewport.visibleItemCount,
    });
    recordRenderPerfMetric("drawPoliticalFeatureStrokeLoop", Number(featureMetrics.strokeMs || 0), {
      renderedCount: Number(featureMetrics.renderedCount || 0),
      visibleItemCount: viewport.visibleItemCount,
    });
    if (!exportRendering) {
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

  function drawPoliticalPass(k) {
    const result = drawBasePoliticalPass(k);
    if (result && !hasInlinePoliticalPartitions()) effects.drawPoliticalPartitions?.(k);
    return result;
  }

  return Object.freeze({ drawPoliticalPass,
    noteNativePartialRepaint() { counters.nativePartialRepaints++; lastBackend = "vector-partial"; lastReason = "partial-feedback"; },
    getDiagnostics: () => ({ ...counters, lastBackend, lastReason }),
  });
}
