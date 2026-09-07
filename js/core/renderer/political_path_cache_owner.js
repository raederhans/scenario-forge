// Owns projected political paths and cancellable idle warmup; cache state remains shared.
const POLITICAL_PATH_WARMUP_OVERSCAN_PX = 96;
const POLITICAL_PATH_WARMUP_QUEUE_MAX = 512;
const POLITICAL_PATH_WARMUP_MAX_FEATURES_PER_SLICE = 24;
const POLITICAL_PATH_WARMUP_CPU_BUDGET_MS = 4;
const POLITICAL_PATH_WARMUP_TIMEOUT_MS = 24;

export function createPoliticalPathCacheOwner({
  runtimeState,
  rendererSurfaceHost,
  getPoliticalPassStaticSignature,
  getProjectionRenderSignature,
  getViewportRenderSignature,
  getRenderPassCacheState,
  cancelDeferredWork,
  scheduleDeferredWork,
  incrementPerfCounter,
  recordRenderPerfMetric,
  areZoomTransformsEquivalent,
  cloneZoomTransform,
  getFeatureId,
  screenRectToProjectedRect,
  collectLandSpatialItemsForProjectedRects,
  nowMs,
  RENDER_PHASE_IDLE,
}) {
  function getPoliticalPathCacheSignature(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    return [
      getPoliticalPassStaticSignature(transform),
      getProjectionRenderSignature(),
      getViewportRenderSignature(),
      String(runtimeState.activeScenarioId || ""),
      "ownership",
      Number(runtimeState.sovereigntyRevision || 0),
      0,
      Number(runtimeState.scenarioShellOverlayRevision || 0),
    ].join("::");
  }

  function cancelPoliticalPathWarmup(reason = "unspecified") {
    const cache = getRenderPassCacheState();
    const hadWork =
      !!cache.politicalPathWarmupHandle
      || (Array.isArray(cache.politicalPathWarmupQueue) && cache.politicalPathWarmupQueue.length > 0)
      || !!cache.politicalPathWarmupSignature;
    if (cache.politicalPathWarmupHandle) {
      cancelDeferredWork(cache.politicalPathWarmupHandle);
    }
    cache.politicalPathWarmupHandle = null;
    cache.politicalPathWarmupQueue = [];
    cache.politicalPathWarmupSignature = "";
    cache.politicalPathWarmupReason = String(reason || "unspecified");
    if (hadWork) {
      incrementPerfCounter("politicalPathWarmupCancels");
    }
  }

  function invalidatePoliticalPathCache(reason = "unspecified") {
    const cache = getRenderPassCacheState();
    cancelPoliticalPathWarmup(reason);
    const previousSize = cache.politicalPathCache instanceof Map
      ? cache.politicalPathCache.size
      : 0;
    const previousSignature = String(cache.politicalPathCacheSignature || "");
    const previousReason = String(cache.politicalPathCacheReason || "");
    if (cache.politicalPathCache instanceof Map) {
      cache.politicalPathCache.clear();
    } else {
      cache.politicalPathCache = new Map();
    }
    cache.politicalPathCacheSignature = "";
    cache.politicalPathCacheTransform = null;
    cache.politicalPathCacheReason = String(reason || "unspecified");
    recordRenderPerfMetric("politicalPathCacheReset", 0, {
      reason: String(reason || "unspecified"),
      previousSize,
      previousSignature,
      previousReason,
    });
  }

  function getPoliticalPathCacheHandle(
    transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
    { resetIfMismatch = false } = {},
  ) {
    const cache = getRenderPassCacheState();
    const signature = getPoliticalPathCacheSignature(transform);
    const valid =
      cache.politicalPathCache instanceof Map
      && cache.politicalPathCacheSignature === signature
      && areZoomTransformsEquivalent(cache.politicalPathCacheTransform, transform);
    if (valid) {
      return {
        cache,
        signature,
        valid: true,
        map: cache.politicalPathCache,
        resetSummary: null,
      };
    }
    let resetSummary = null;
    if (resetIfMismatch) {
      const previousSize = cache.politicalPathCache instanceof Map
        ? cache.politicalPathCache.size
        : 0;
      const previousSignature = String(cache.politicalPathCacheSignature || "");
      const previousReason = String(cache.politicalPathCacheReason || "");
      const previousTransform = cache.politicalPathCacheTransform
        ? cloneZoomTransform(cache.politicalPathCacheTransform)
        : null;
      if (!(cache.politicalPathCache instanceof Map)) {
        cache.politicalPathCache = new Map();
      } else {
        cache.politicalPathCache.clear();
      }
      cache.politicalPathCacheSignature = signature;
      cache.politicalPathCacheTransform = cloneZoomTransform(transform);
      cache.politicalPathCacheReason = "prepared";
      resetSummary = {
        reason: "prepare-mismatch",
        previousSize,
        previousSignature,
        previousReason,
        nextSignature: signature,
        previousTransformK: Number(previousTransform?.k || 0),
        nextTransformK: Number(transform?.k || 1),
      };
      recordRenderPerfMetric("politicalPathCacheReset", 0, {
        ...resetSummary,
      });
    }
    return {
      cache,
      signature,
      valid: resetIfMismatch,
      map: cache.politicalPathCache instanceof Map ? cache.politicalPathCache : new Map(),
      resetSummary,
    };
  }

  function buildPoliticalFeaturePathEntry(feature) {
    if (!feature?.geometry || !globalThis.Path2D || typeof rendererSurfaceHost.getPathSvg() !== "function") {
      return null;
    }
    try {
      const pathString = rendererSurfaceHost.getPathSvg()(feature);
      if (!pathString) return null;
      return {
        path: new globalThis.Path2D(pathString),
      };
    } catch (_error) {
      return null;
    }
  }

  function getPoliticalFeaturePathEntry(
    feature,
    {
      featureId = null,
      transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
      allowBuild = false,
      countMiss = false,
      countBuild = false,
    } = {},
  ) {
    const resolvedId = featureId || getFeatureId(feature);
    if (!resolvedId) return null;
    const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: allowBuild });
    if (!handle.valid || !(handle.map instanceof Map)) {
      if (countMiss) incrementPerfCounter("politicalPartialPathCacheMisses");
      return null;
    }
    const cachedEntry = handle.map.get(resolvedId);
    if (cachedEntry?.path) {
      return cachedEntry;
    }
    if (countMiss) incrementPerfCounter("politicalPartialPathCacheMisses");
    if (!allowBuild) {
      return null;
    }
    const builtEntry = buildPoliticalFeaturePathEntry(feature);
    if (!builtEntry?.path) {
      return null;
    }
    handle.map.set(resolvedId, builtEntry);
    if (countBuild) incrementPerfCounter("politicalPathCacheBuild");
    return builtEntry;
  }

  function collectWarmupCandidateItems(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    const viewportWidth = Math.max(1, Number(runtimeState.width || 1));
    const viewportHeight = Math.max(1, Number(runtimeState.height || 1));
    const overscan = Math.max(0, Number(POLITICAL_PATH_WARMUP_OVERSCAN_PX || 0));
    const viewportRect = {
      minX: -overscan,
      minY: -overscan,
      maxX: viewportWidth + overscan,
      maxY: viewportHeight + overscan,
    };
    const projectedViewportRect = screenRectToProjectedRect(viewportRect, transform);
    if (!projectedViewportRect) return null;
    const candidateResult = collectLandSpatialItemsForProjectedRects([projectedViewportRect]);
    if (!candidateResult || candidateResult.overflow) {
      return null;
    }
    const normalizedTransform = cloneZoomTransform(transform);
    const centerX = ((viewportWidth / 2) - normalizedTransform.x) / normalizedTransform.k;
    const centerY = ((viewportHeight / 2) - normalizedTransform.y) / normalizedTransform.k;
    return candidateResult.items
      .map((item) => ({
        ...item,
        warmupDistance: Math.hypot(
          (((Number(item?.minX || 0) + Number(item?.maxX || 0)) / 2) - centerX),
          (((Number(item?.minY || 0) + Number(item?.maxY || 0)) / 2) - centerY),
        ),
      }))
      .sort((left, right) => {
        const distanceDelta = Number(left?.warmupDistance || 0) - Number(right?.warmupDistance || 0);
        if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
        return (left?.drawOrder ?? 0) - (right?.drawOrder ?? 0);
      })
      .slice(0, POLITICAL_PATH_WARMUP_QUEUE_MAX);
  }

  function runPoliticalPathWarmupSlice(deadline = null) {
    const cache = getRenderPassCacheState();
    cache.politicalPathWarmupHandle = null;
    if (
      runtimeState.renderPhase !== RENDER_PHASE_IDLE
      || runtimeState.deferExactAfterSettle
      || cache.dirty?.political
    ) {
      cancelPoliticalPathWarmup("warmup-non-idle");
      return false;
    }
    const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity;
    const expectedSignature = getPoliticalPathCacheSignature(transform);
    if (
      cache.politicalPathWarmupSignature !== expectedSignature
      || (
        cache.politicalPathCacheSignature
        && cache.politicalPathCacheSignature !== expectedSignature
      )
    ) {
      invalidatePoliticalPathCache("warmup-signature-mismatch");
      return false;
    }
    if (!Array.isArray(cache.politicalPathWarmupQueue) || !cache.politicalPathWarmupQueue.length) {
      cache.politicalPathWarmupQueue = [];
      cache.politicalPathWarmupSignature = "";
      return false;
    }
    const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: true });
    if (!handle.valid || !(handle.map instanceof Map)) {
      invalidatePoliticalPathCache("warmup-handle-invalid");
      return false;
    }
    const startedAt = nowMs();
    let processedCount = 0;
    let builtCount = 0;
    while (cache.politicalPathWarmupQueue.length > 0) {
      if (processedCount >= POLITICAL_PATH_WARMUP_MAX_FEATURES_PER_SLICE) break;
      if (processedCount > 0 && (nowMs() - startedAt) >= POLITICAL_PATH_WARMUP_CPU_BUDGET_MS) break;
      if (
        processedCount > 0
        && deadline
        && typeof deadline.timeRemaining === "function"
        && deadline.timeRemaining() <= 0
      ) {
        break;
      }
      const nextItem = cache.politicalPathWarmupQueue.shift();
      if (!nextItem?.id || !nextItem?.feature) continue;
      processedCount += 1;
      if (handle.map.get(nextItem.id)?.path) continue;
      const pathEntry = getPoliticalFeaturePathEntry(nextItem.feature, {
        featureId: nextItem.id,
        transform,
        allowBuild: true,
        countBuild: true,
      });
      if (pathEntry?.path) {
        builtCount += 1;
        incrementPerfCounter("politicalPathWarmupBuild");
      }
    }
    incrementPerfCounter("politicalPathWarmupSlices");
    const durationMs = nowMs() - startedAt;
    recordRenderPerfMetric("politicalPathWarmupSlice", durationMs, {
      builtCount,
      processedCount,
      remainingCount: cache.politicalPathWarmupQueue.length,
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      transformK: Number(transform?.k || 1),
    });
    recordRenderPerfMetric("politicalPathWarmup", durationMs, {
      builtCount,
      processedCount,
      remainingCount: cache.politicalPathWarmupQueue.length,
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      transformK: Number(transform?.k || 1),
    });
    if (cache.politicalPathWarmupQueue.length > 0) {
      cache.politicalPathWarmupHandle = scheduleDeferredWork(runPoliticalPathWarmupSlice, {
        timeout: POLITICAL_PATH_WARMUP_TIMEOUT_MS,
      });
    } else {
      cache.politicalPathWarmupSignature = "";
    }
    return builtCount > 0;
  }

  function schedulePoliticalPathWarmup(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    const cache = getRenderPassCacheState();
    if (
      runtimeState.renderPhase !== RENDER_PHASE_IDLE
      || runtimeState.deferExactAfterSettle
      || cache.dirty?.political
    ) {
      return false;
    }
    const signature = getPoliticalPathCacheSignature(transform);
    const candidateItems = collectWarmupCandidateItems(transform);
    if (!Array.isArray(candidateItems)) {
      cancelPoliticalPathWarmup("warmup-spatial-unavailable");
      return false;
    }
    const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: false });
    const cacheMap = handle.valid && handle.map instanceof Map ? handle.map : null;
    const queue = candidateItems.filter((item) => item?.id && item?.feature && !cacheMap?.get(item.id)?.path);
    if (!queue.length) {
      cancelPoliticalPathWarmup("warmup-complete");
      return false;
    }
    if (cache.politicalPathWarmupHandle) {
      cancelDeferredWork(cache.politicalPathWarmupHandle);
    }
    cache.politicalPathWarmupHandle = null;
    cache.politicalPathWarmupQueue = queue;
    cache.politicalPathWarmupSignature = signature;
    cache.politicalPathWarmupReason = "scheduled";
    cache.politicalPathWarmupHandle = scheduleDeferredWork(runPoliticalPathWarmupSlice, {
      timeout: POLITICAL_PATH_WARMUP_TIMEOUT_MS,
    });
    return true;
  }

  return {
    getPoliticalPathCacheSignature,
    cancelPoliticalPathWarmup,
    invalidatePoliticalPathCache,
    getPoliticalPathCacheHandle,
    getPoliticalFeaturePathEntry,
    schedulePoliticalPathWarmup,
  };
}
