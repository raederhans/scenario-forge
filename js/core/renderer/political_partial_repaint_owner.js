function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

export function createPoliticalPartialRepaintOwner({
  surface,
  getters = {},
  helpers = {},
  effects = {},
  constants = {},
} = {}) {
  if (!surface || typeof surface.getContext !== "function" || typeof surface.getProjection !== "function") {
    throw new TypeError("surface must expose renderer context and projection ports.");
  }
  const getRuntimeState = requireFunction(getters.getRuntimeState, "getters.getRuntimeState");
  const getDebugMode = requireFunction(getters.getDebugMode, "getters.getDebugMode");
  const getDefaultTransform = requireFunction(getters.getDefaultTransform, "getters.getDefaultTransform");
  const getRenderPassCacheState = requireFunction(getters.getRenderPassCacheState, "getters.getRenderPassCacheState");

  const requiredHelpers = [
    "nowMs",
    "getFeatureId",
    "isAtlantropaSeaFeature",
    "getAtlantropaSeaPoliticalFillColor",
    "getAtlantropaSeaPoliticalStrokeColor",
    "getSafeCanvasColor",
    "getResolvedFeatureColor",
    "hashToColor",
    "buildWorkerPixelRingsForGeometry",
    "orderPoliticalShellUnderlayFirst",
    "shouldExcludePoliticalVisualFeature",
    "shouldSkipFeature",
    "pathBoundsInScreen",
    "getPoliticalFeaturePathEntry",
    "isPoliticalFeaturePathEntryCurrent",
    "rectsIntersect",
    "screenRectToProjectedRect",
    "collectLandSpatialItemsForProjectedRects",
    "getFeatureScreenBounds",
    "getRenderPassLayout",
    "getPassReferenceTransform",
    "areZoomTransformsEquivalent",
    "hasPassFullReferenceTransform",
    "getPassFullReferenceTransform",
    "getPoliticalPassFineBaselineMismatch",
    "getCachedPoliticalPassStaticSignature",
    "getPoliticalPathCacheHandle",
    "getVisibleFrameIdentity",
    "createPoliticalRasterWorkerIdentity",
    "getLogicalCanvasDimensions",
    "getRenderPassSignature",
    "getPoliticalPassViewportOverscanPx",
    "collectVisibleLandSpatialItemsWithStats",
    "cloneZoomTransform",
    "getTransformBucketSignature",
    "getIslandNeighborGraph",
    "ensurePoliticalRasterWorkerMetrics",
  ];
  const helper = Object.fromEntries(requiredHelpers.map((name) => [
    name,
    requireFunction(helpers[name], `helpers.${name}`),
  ]));

  const requiredEffects = [
    "incrementPerfCounter",
    "recordRenderPerfMetric",
    "drawPoliticalBackgroundFillsForEntries",
    "withRenderTarget",
    "clearPendingPoliticalColorEdit",
    "setPassReferenceTransform",
    "recordPassTiming",
    "commitPoliticalPassDiagnostics",
    "requestPoliticalRasterWorkerPass",
    "onAcceptedBitmapResult",
  ];
  const effect = Object.fromEntries(requiredEffects.map((name) => [
    name,
    requireFunction(effects[name], `effects.${name}`),
  ]));

  const renderPhaseIdle = String(constants.renderPhaseIdle || "idle");
  const landFillColor = String(constants.landFillColor || "#d8d1bd");
  const partialFeatureThreshold = Number(constants.partialFeatureThreshold || 48);
  const partialCandidateThreshold = Number(constants.partialCandidateThreshold || 160);
  const partialViewportCoverageMax = Number(constants.partialViewportCoverageMax || 0.18);
  const partialSyncBuildCandidateMax = Number(constants.partialSyncBuildCandidateMax || 96);
  const partialSyncBuildMissMax = Number(constants.partialSyncBuildMissMax || 96);
  const partialPaddingPx = Number(constants.partialPaddingPx || 4);

  function mergeIntersectingRects(rects = []) {
    const pending = Array.isArray(rects) ? rects.filter(Boolean).map((rect) => ({ ...rect })) : [];
    const merged = [];
    while (pending.length) {
      const next = pending.pop();
      if (!next) continue;
      let changed = true;
      while (changed) {
        changed = false;
        for (let index = pending.length - 1; index >= 0; index -= 1) {
          const candidate = pending[index];
          if (!helper.rectsIntersect(next, candidate)) continue;
          next.minX = Math.min(next.minX, candidate.minX);
          next.minY = Math.min(next.minY, candidate.minY);
          next.maxX = Math.max(next.maxX, candidate.maxX);
          next.maxY = Math.max(next.maxY, candidate.maxY);
          next.x = next.minX;
          next.y = next.minY;
          next.width = Math.max(0, next.maxX - next.minX);
          next.height = Math.max(0, next.maxY - next.minY);
          pending.splice(index, 1);
          changed = true;
        }
      }
      merged.push(next);
    }
    return merged;
  }

  function getViewportCoverageForRects(rects = []) {
    const state = getRuntimeState();
    const viewportArea = Math.max(1, Number(state.width || 1) * Number(state.height || 1));
    const coveredArea = (Array.isArray(rects) ? rects : []).reduce((sum, rect) => {
      if (!rect) return sum;
      const minX = Math.max(0, Math.min(Number(rect.minX || 0), Number(state.width || 0)));
      const minY = Math.max(0, Math.min(Number(rect.minY || 0), Number(state.height || 0)));
      const maxX = Math.max(0, Math.min(Number(rect.maxX || 0), Number(state.width || 0)));
      const maxY = Math.max(0, Math.min(Number(rect.maxY || 0), Number(state.height || 0)));
      if (maxX <= minX || maxY <= minY) return sum;
      return sum + ((maxX - minX) * (maxY - minY));
    }, 0);
    return Math.max(0, Math.min(coveredArea / viewportArea, 1));
  }

  function screenRectToPassRect(rect, layout) {
    if (!rect || !layout) return null;
    const clamp = (value, max) => Math.max(0, Math.min(Number(value || 0), Number(max || 0)));
    const minX = clamp(Number(rect.minX || rect.x || 0) + Number(layout.offsetX || 0), layout.paddedWidth);
    const minY = clamp(Number(rect.minY || rect.y || 0) + Number(layout.offsetY || 0), layout.paddedHeight);
    const maxX = clamp(Number(rect.maxX || ((rect.x || 0) + (rect.width || 0))) + Number(layout.offsetX || 0), layout.paddedWidth);
    const maxY = clamp(Number(rect.maxY || ((rect.y || 0) + (rect.height || 0))) + Number(layout.offsetY || 0), layout.paddedHeight);
    if (maxX <= minX || maxY <= minY) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function getPoliticalFeatureFillColor(feature, id, index, canvasWidth = 0) {
    const state = getRuntimeState();
    const debugMode = getDebugMode();
    if (debugMode === "PROD") {
      return helper.isAtlantropaSeaFeature(feature)
        ? helper.getAtlantropaSeaPoliticalFillColor()
        : (
          helper.getSafeCanvasColor(state.colors[id], null)
          || helper.getSafeCanvasColor(helper.getResolvedFeatureColor(feature, id), null)
          || landFillColor
        );
    }
    if (debugMode === "GEOMETRY") return index % 2 === 0 ? "pink" : "lightgreen";
    if (debugMode === "ARTIFACTS") {
      const bounds = surface.getPathCanvas().bounds(feature);
      let featureWidth = 0;
      if (bounds && bounds.length === 2) {
        const minX = bounds[0][0];
        const maxX = bounds[1][0];
        if ([minX, maxX].every(Number.isFinite)) featureWidth = maxX - minX;
      }
      return featureWidth > canvasWidth * 0.5 ? "red" : "#eee";
    }
    if (debugMode === "ID_HASH") return helper.hashToColor(id);
    return landFillColor;
  }

  function projectCoordinateToWorkerPixel(point, transform, dpr) {
    if (!Array.isArray(point) || point.length < 2 || !surface.getProjection()) return null;
    const projected = surface.getProjection()([Number(point[0]), Number(point[1])]);
    if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return null;
    const x = (Number(transform?.x || 0) + projected[0] * Number(transform?.k || 1)) * dpr;
    const y = (Number(transform?.y || 0) + projected[1] * Number(transform?.k || 1)) * dpr;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [Number(x.toFixed(3)), Number(y.toFixed(3))];
  }

  function buildPoliticalRasterWorkerPacket({
    visibleItems = null,
    transform = getDefaultTransform(),
    canvasWidth = 0,
    canvasHeight = 0,
  } = {}) {
    const state = getRuntimeState();
    const startedAt = helper.nowMs();
    if (getDebugMode() !== "PROD" || !surface.getProjection()) {
      return { packet: null, packetBuildMs: Math.max(0, helper.nowMs() - startedAt), reason: "debug-mode" };
    }
    const dpr = Math.max(0.1, Number(state.dpr || 1));
    const sourceItems = Array.isArray(visibleItems)
      ? visibleItems
      : (Array.isArray(state.landData?.features)
        ? state.landData.features.map((feature, index) => ({
          feature,
          drawOrder: index,
          id: helper.getFeatureId(feature) || `feature-${index}`,
        }))
        : []);
    const entries = [];
    helper.orderPoliticalShellUnderlayFirst(sourceItems).forEach((item, index) => {
      const feature = item?.feature || item;
      const id = item?.id || helper.getFeatureId(feature) || `feature-${index}`;
      if (!feature?.geometry || helper.shouldExcludePoliticalVisualFeature(feature, id)) return;
      const rings = helper.buildWorkerPixelRingsForGeometry(
        feature.geometry,
        (point) => projectCoordinateToWorkerPixel(point, transform, dpr),
      );
      if (!rings.length) return;
      const fillColor = getPoliticalFeatureFillColor(feature, id, Number(item?.drawOrder ?? index), canvasWidth);
      entries.push({
        id,
        fillColor,
        strokeColor: helper.isAtlantropaSeaFeature(feature)
          ? helper.getAtlantropaSeaPoliticalStrokeColor()
          : fillColor,
        strokeWidthPx: 0.75 * dpr,
        rings,
      });
    });
    const packetBuildMs = Math.max(0, helper.nowMs() - startedAt);
    if (!entries.length) return { packet: null, packetBuildMs, reason: "empty-packet" };
    return {
      packet: {
        canvasPxWidth: Math.max(1, Math.round(canvasWidth * dpr)),
        canvasPxHeight: Math.max(1, Math.round(canvasHeight * dpr)),
        entries,
      },
      packetBuildMs,
      reason: "ok",
    };
  }

  function drawPoliticalWorkerBitmapResult(result, workerIdentity) {
    const state = getRuntimeState();
    const context = surface.getContext();
    if (!result?.bitmap || !context?.canvas) return false;
    const startedAt = helper.nowMs();
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.drawImage(result.bitmap, 0, 0, context.canvas.width, context.canvas.height);
    context.restore();
    const metrics = helper.ensurePoliticalRasterWorkerMetrics();
    metrics.blitMs = Math.max(0, helper.nowMs() - startedAt);
    effect.recordRenderPerfMetric("politicalRasterWorker.blitMs", metrics.blitMs, {
      enabled: !!metrics.enabled,
      bitmapEnabled: !!metrics.bitmapEnabled,
      source: "bitmap-result",
    });
    effect.clearPendingPoliticalColorEdit({
      renderedCount: Math.max(0, Number(result.renderedFeatureCount || 0)),
      renderedIds: null,
      paintSource: "political-raster-worker-bitmap",
    });
    effect.recordRenderPerfMetric("politicalRasterWorkerBitmapCommit", metrics.blitMs, {
      renderedFeatureCount: Math.max(0, Number(result.renderedFeatureCount || 0)),
      packetFeatureCount: Math.max(0, Number(result.packetFeatureCount || 0)),
      canvasPxWidth: Math.max(0, Number(result.canvasPxWidth || 0)),
      canvasPxHeight: Math.max(0, Number(result.canvasPxHeight || 0)),
      activeScenarioId: String(workerIdentity?.scenarioId || state.activeScenarioId || ""),
    });
    result.bitmap.close?.();
    return true;
  }

  function drawPoliticalFeature(feature, index, {
    k,
    canvasWidth,
    canvasHeight,
    islandNeighbors = null,
    skipScreenCheck = false,
    path = null,
    transform = getDefaultTransform(),
    useCachedPath = true,
    allowBuildPath = false,
    countPathBuild = false,
    metricsCollector = null,
  } = {}) {
    const debugMode = getDebugMode();
    const id = helper.getFeatureId(feature) || `feature-${index}`;
    if (helper.shouldExcludePoliticalVisualFeature(feature, id)) return false;
    if (helper.shouldSkipFeature(feature, canvasWidth, canvasHeight)) return false;
    if (!skipScreenCheck && !helper.pathBoundsInScreen(feature)) return false;
    const isAtlantropaSea = debugMode === "PROD" && helper.isAtlantropaSeaFeature(feature);
    let fillColor = getPoliticalFeatureFillColor(feature, id, index, canvasWidth);
    if (debugMode === "ISLANDS") {
      const degree = islandNeighbors?.[index]?.length || 0;
      fillColor = degree === 0 ? "orange" : "lightgreen";
    }
    const renderPath = path || (useCachedPath
      ? helper.getPoliticalFeaturePathEntry(feature, {
        featureId: id,
        transform,
        allowBuild: allowBuildPath,
        countBuild: countPathBuild,
      })?.path
      : null) || null;
    const context = surface.getContext();
    context.fillStyle = fillColor;
    const fillStartedAt = metricsCollector ? helper.nowMs() : 0;
    if (renderPath) {
      context.fill(renderPath);
    } else {
      context.beginPath();
      surface.getPathCanvas()(feature);
      context.fill();
    }
    if (metricsCollector) {
      metricsCollector.fillMs = Number(metricsCollector.fillMs || 0)
        + Math.max(0, helper.nowMs() - fillStartedAt);
    }
    if (debugMode === "PROD") {
      context.strokeStyle = isAtlantropaSea ? helper.getAtlantropaSeaPoliticalStrokeColor() : fillColor;
      context.lineWidth = 0.75 / Math.max(0.0001, k);
      context.lineJoin = "round";
      context.lineCap = "round";
      const strokeStartedAt = metricsCollector ? helper.nowMs() : 0;
      if (renderPath) context.stroke(renderPath);
      else context.stroke();
      if (metricsCollector) {
        metricsCollector.strokeMs = Number(metricsCollector.strokeMs || 0)
          + Math.max(0, helper.nowMs() - strokeStartedAt);
      }
    }
    if (metricsCollector) {
      metricsCollector.renderedCount = Number(metricsCollector.renderedCount || 0) + 1;
      if (metricsCollector.renderedIds instanceof Set) metricsCollector.renderedIds.add(id);
    }
    return true;
  }

  function tryPartialPoliticalPassRepaint(transform, nextSignature, timings) {
    const state = getRuntimeState();
    const cache = getRenderPassCacheState();
    const dirtyIds = Array.from(cache.partialPoliticalDirtyIds || []).filter(Boolean);
    const dirtyFeatureCount = dirtyIds.length;
    const fallback = (fallbackReason, details = {}) => {
      effect.incrementPerfCounter("politicalPartialFallbacks");
      effect.recordRenderPerfMetric("politicalPartialRepaint", 0, {
        applied: false,
        dirtyFeatureCount,
        dirtyRectCount: 0,
        viewportCoverage: 0,
        candidateCount: 0,
        pathCacheMisses: 0,
        pathCacheMissRatio: 0,
        fallbackReason,
        ...details,
      });
      return false;
    };
    let commitSuccessfulRepaint = null;
    try {
    recoverable: {
    if (state.renderPhase !== renderPhaseIdle || state.deferExactAfterSettle) return fallback("non-idle-phase");
    if (getDebugMode() !== "PROD") return fallback("non-prod-mode");
    if (String(cache.reasons?.political || "") !== "refresh-colors") return fallback("non-color-invalidation");
    if (!dirtyFeatureCount) return fallback("no-dirty-features");
    if (dirtyFeatureCount > partialFeatureThreshold) return fallback("dirty-feature-threshold");
    const passCanvas = cache.canvases?.political;
    const passContext = passCanvas?.getContext?.("2d");
    if (!passCanvas || !passContext) return fallback("missing-pass-canvas");
    const layout = helper.getRenderPassLayout("political");
    if (passCanvas.width !== layout.pixelWidth || passCanvas.height !== layout.pixelHeight) return fallback("layout-mismatch");
    const referenceTransform = helper.getPassReferenceTransform("political");
    if (!referenceTransform || !helper.areZoomTransformsEquivalent(referenceTransform, transform)) return fallback("reference-transform-mismatch");
    if (!helper.hasPassFullReferenceTransform("political")) return fallback("missing-full-reference-transform");
    const fullReferenceTransform = helper.getPassFullReferenceTransform("political");
    if (!fullReferenceTransform || !helper.areZoomTransformsEquivalent(fullReferenceTransform, transform)) return fallback("full-reference-transform-mismatch");
    const fineBaselineMismatch = helper.getPoliticalPassFineBaselineMismatch(transform);
    if (fineBaselineMismatch) return fallback(fineBaselineMismatch);
    if (helper.getCachedPoliticalPassStaticSignature(cache.signatures?.political)
      !== helper.getCachedPoliticalPassStaticSignature(nextSignature)) {
      return fallback("static-signature-mismatch");
    }
    const canvasWidth = Math.max(Number(layout.paddedWidth || 0), Number(state.width || 0), 1);
    const canvasHeight = Math.max(Number(layout.paddedHeight || 0), Number(state.height || 0), 1);
    const dirtyRects = [];
    dirtyIds.forEach((id) => {
      const feature = state.landIndex?.get(id);
      if (!feature) {
        dirtyRects.push(null);
        return;
      }
      if (helper.shouldExcludePoliticalVisualFeature(feature, id)
        || helper.shouldSkipFeature(feature, canvasWidth, canvasHeight)) return;
      const rect = helper.getFeatureScreenBounds(feature, {
        featureId: id,
        transform,
        padding: partialPaddingPx,
      });
      dirtyRects.push(rect || null);
    });
    if (dirtyRects.some((rect) => !rect)) return fallback("missing-dirty-bounds");
    if (!dirtyRects.length) {
      commitSuccessfulRepaint = () => {
        cache.signatures.political = nextSignature;
        cache.dirty.political = false;
        cache.partialPoliticalDirtyIds.clear();
        cache.reasons.political = "partial-noop";
        effect.setPassReferenceTransform("political", transform);
        effect.incrementPerfCounter("politicalPartialRepaints");
        effect.recordRenderPerfMetric("politicalPartialRepaint", 0, {
          applied: true,
          dirtyFeatureCount,
          dirtyRectCount: 0,
          viewportCoverage: 0,
          affectedFeatureCount: 0,
          noop: true,
        });
        return true;
      };
      break recoverable;
    }
    const mergedDirtyRects = mergeIntersectingRects(dirtyRects);
    const viewportCoverage = getViewportCoverageForRects(mergedDirtyRects);
    if (viewportCoverage > partialViewportCoverageMax) {
      return fallback("coverage-threshold", { dirtyRectCount: mergedDirtyRects.length, viewportCoverage });
    }
    const projectedDirtyRects = mergedDirtyRects.map((rect) => helper.screenRectToProjectedRect(rect, transform));
    if (projectedDirtyRects.some((rect) => !rect)) {
      return fallback("projected-dirty-rect-missing", { dirtyRectCount: mergedDirtyRects.length, viewportCoverage });
    }
    const candidateResult = helper.collectLandSpatialItemsForProjectedRects(projectedDirtyRects, {
      maxCandidates: partialCandidateThreshold,
    });
    if (!candidateResult) {
      return fallback("spatial-index-unavailable", { dirtyRectCount: mergedDirtyRects.length, viewportCoverage });
    }
    if (candidateResult.overflow) {
      return fallback("candidate-threshold", {
        dirtyRectCount: mergedDirtyRects.length,
        viewportCoverage,
        candidateCount: candidateResult.items.length,
      });
    }
    const candidateItems = candidateResult.items;
    const candidateCount = candidateItems.length;
    effect.incrementPerfCounter("politicalPartialCandidateCount", candidateCount);
    if (!candidateCount) {
      return fallback("no-spatial-candidates", { dirtyRectCount: mergedDirtyRects.length, viewportCoverage });
    }
    if (candidateCount > partialCandidateThreshold) {
      return fallback("candidate-threshold", { dirtyRectCount: mergedDirtyRects.length, viewportCoverage, candidateCount });
    }
    const pathCacheHandle = helper.getPoliticalPathCacheHandle(transform, { resetIfMismatch: true });
    let pathCacheMisses = 0;
    if (!pathCacheHandle.valid || !(pathCacheHandle.map instanceof Map)) {
      return fallback("path-cache-unavailable", { dirtyRectCount: mergedDirtyRects.length, viewportCoverage, candidateCount });
    }
    candidateItems.forEach((item) => {
      if (!helper.isPoliticalFeaturePathEntryCurrent(pathCacheHandle.map.get(item.id), item.feature)) pathCacheMisses += 1;
    });
    if (pathCacheMisses > 0) effect.incrementPerfCounter("politicalPartialPathCacheMisses", pathCacheMisses);
    const pathCacheMissRatio = candidateCount > 0 ? pathCacheMisses / candidateCount : 0;
    const allowSyncPartialBuild = candidateCount <= partialSyncBuildCandidateMax
      && pathCacheMisses <= partialSyncBuildMissMax;
    if (pathCacheMisses > 0 && !allowSyncPartialBuild) {
      return fallback("partial-build-threshold", {
        dirtyRectCount: mergedDirtyRects.length,
        viewportCoverage,
        candidateCount,
        pathCacheMisses,
        pathCacheMissRatio: Number(pathCacheMissRatio.toFixed(4)),
      });
    }
    const redrawEntries = candidateItems.map((item) => {
      let pathEntry = pathCacheHandle.map.get(item.id) || null;
      if (!helper.isPoliticalFeaturePathEntryCurrent(pathEntry, item.feature)) pathEntry = null;
      if (!pathEntry?.path && allowSyncPartialBuild) {
        pathEntry = helper.getPoliticalFeaturePathEntry(item.feature, {
          featureId: item.id,
          transform,
          allowBuild: true,
          countBuild: true,
        });
        if (pathEntry?.path) effect.incrementPerfCounter("politicalPartialPathBuild");
      }
      if (!pathEntry?.path) return null;
      return { feature: item.feature, index: item.drawOrder, id: item.id, path: pathEntry.path };
    });
    if (redrawEntries.some((entry) => !entry)) {
      return fallback("path-cache-build-failed", {
        dirtyRectCount: mergedDirtyRects.length,
        viewportCoverage,
        candidateCount,
        pathCacheMisses,
        pathCacheMissRatio: Number(pathCacheMissRatio.toFixed(4)),
      });
    }
    const passRects = mergedDirtyRects.map((rect) => screenRectToPassRect(rect, layout)).filter(Boolean);
    if (!passRects.length) return fallback("pass-rect-empty", { dirtyRectCount: mergedDirtyRects.length, viewportCoverage });
    const startedAt = helper.nowMs();
    let backgroundGroupCount = 0;
    const partialFeatureMetrics = { renderedCount: 0, renderedIds: new Set() };
    let contextSaved = false;
    try {
      passContext.save();
      contextSaved = true;
      passContext.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      passContext.beginPath();
      passRects.forEach((rect) => passContext.rect(rect.x, rect.y, rect.width, rect.height));
      passContext.clip();
      passContext.clearRect(0, 0, layout.paddedWidth, layout.paddedHeight);
      passContext.translate(layout.offsetX, layout.offsetY);
      passContext.translate(transform.x, transform.y);
      passContext.scale(transform.k, transform.k);
      effect.withRenderTarget(passContext, () => {
        backgroundGroupCount = effect.drawPoliticalBackgroundFillsForEntries(redrawEntries);
        helper.orderPoliticalShellUnderlayFirst(redrawEntries).forEach(({ feature, index, path }) => {
          drawPoliticalFeature(feature, index, {
            k: transform.k,
            canvasWidth,
            canvasHeight,
            skipScreenCheck: true,
            path,
            transform,
            metricsCollector: partialFeatureMetrics,
          });
        });
      });
    } finally {
      if (contextSaved) passContext.restore();
    }
    commitSuccessfulRepaint = () => {
      cache.signatures.political = nextSignature;
      cache.dirty.political = false;
      cache.partialPoliticalDirtyIds.clear();
      effect.clearPendingPoliticalColorEdit({
        renderedCount: Number(partialFeatureMetrics.renderedCount || 0),
        renderedIds: partialFeatureMetrics.renderedIds,
        paintSource: "political-partial-repaint",
      });
      cache.reasons.political = "partial-repaint";
      effect.setPassReferenceTransform("political", transform);
      effect.incrementPerfCounter("politicalPartialRepaints");
      effect.recordPassTiming(timings, "political", startedAt);
      effect.recordRenderPerfMetric("politicalPartialRepaint", helper.nowMs() - startedAt, {
        applied: true,
        dirtyFeatureCount,
        dirtyRectCount: mergedDirtyRects.length,
        viewportCoverage: Number(viewportCoverage.toFixed(4)),
        candidateCount,
        affectedFeatureCount: Number(partialFeatureMetrics.renderedCount || 0),
        backgroundGroupCount,
        pathCacheMisses,
        pathCacheMissRatio: Number(pathCacheMissRatio.toFixed(4)),
      });
      return true;
    };
    }
    } catch (error) {
      return fallback("partial-repaint-exception", {
        exceptionName: String(error?.name || "Error"),
      });
    }
    return commitSuccessfulRepaint();
  }

  let workerSnapshotLastState = null;
  let workerSnapshotFrameCount = 0;
  function recordPoliticalRasterWorkerSnapshot() {
    const metrics = helper.ensurePoliticalRasterWorkerMetrics();
    const nextState = Object.fromEntries([
      ["enabled", !!metrics.enabled],
      ["protocolVersion", Number(metrics.protocolVersion || 0)],
      ...["roundTripMs", "rasterMs", "encodeMs", "decodeMs", "blitMs", "packetBuildMs",
        "timeoutCount", "recycleCount", "staleResponseCount", "acceptedCount",
        "bitmapAcceptedCount", "bitmapRejectedCount", "rejectedStaleCount", "fallbackCount"]
        .map((key) => [key, Number(metrics[key] || 0)]),
    ]);
    const stateChanged = !workerSnapshotLastState
      || Object.keys(nextState).some((key) => workerSnapshotLastState[key] !== nextState[key]);
    workerSnapshotFrameCount += 1;
    if (!stateChanged && (workerSnapshotFrameCount % 30) !== 0) return;
    workerSnapshotLastState = nextState;
    effect.recordRenderPerfMetric("politicalRasterWorker.roundTripMs", nextState.roundTripMs, {
      enabled: nextState.enabled,
      protocolVersion: nextState.protocolVersion,
    });
    for (const metricName of ["rasterMs", "encodeMs", "decodeMs", "blitMs", "packetBuildMs"]) {
      effect.recordRenderPerfMetric(`politicalRasterWorker.${metricName}`, nextState[metricName], { enabled: nextState.enabled });
    }
    for (const metricName of ["timeoutCount", "recycleCount", "staleResponseCount", "acceptedCount",
      "bitmapAcceptedCount", "bitmapRejectedCount", "rejectedStaleCount", "fallbackCount"]) {
      effect.recordRenderPerfMetric(`politicalRasterWorker.${metricName}`, 0, { count: nextState[metricName] });
    }
  }

  function resolvePoliticalPassIdentity(k) {
    const state = getRuntimeState();
    const transform = getDefaultTransform();
    const [canvasWidth, canvasHeight] = helper.getLogicalCanvasDimensions();
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : null;
    const sceneIdentity = helper.getVisibleFrameIdentity(transform);
    const workerIdentity = helper.createPoliticalRasterWorkerIdentity({
      sceneGeneration: sceneIdentity.sceneGeneration,
      scenarioDataGeneration: sceneIdentity.scenarioDataGeneration,
      scenarioId: sceneIdentity.scenarioId || state.activeScenarioId || "",
      selectionVersion: sceneIdentity.selectionVersion || Number(loadState?.selectionVersion || 0),
      topologyRevision: sceneIdentity.topologyRevision,
      colorRevision: sceneIdentity.colorRevision,
      transformBucket: sceneIdentity.transformBucket,
      dpr: sceneIdentity.dpr,
      viewport: {
        x: 0,
        y: 0,
        width: canvasWidth,
        height: canvasHeight,
        left: 0,
        top: 0,
        right: canvasWidth,
        bottom: canvasHeight,
      },
      passSignature: helper.getRenderPassSignature("political", transform),
    });
    return { k, transform, canvasWidth, canvasHeight, dpr: sceneIdentity.dpr, sceneIdentity, workerIdentity };
  }

  function resolvePoliticalPassViewport(identity) {
    const politicalOverscanPx = helper.getPoliticalPassViewportOverscanPx();
    const screenRects = [{
      minX: -politicalOverscanPx,
      minY: -politicalOverscanPx,
      maxX: identity.canvasWidth + politicalOverscanPx,
      maxY: identity.canvasHeight + politicalOverscanPx,
    }];
    const visibleItemsResult = getDebugMode() === "PROD"
      ? helper.collectVisibleLandSpatialItemsWithStats({ overscanPx: politicalOverscanPx })
      : null;
    const visibleItems = visibleItemsResult ? visibleItemsResult.items : null;
    return {
      overscanPx: politicalOverscanPx,
      screenRects,
      visibleItems,
      visibleItemCount: Array.isArray(visibleItems) ? visibleItems.length : null,
      visibleStats: visibleItemsResult?.stats || null,
    };
  }

  function publishPoliticalPassDiagnostics({ identity, viewport }) {
    const state = getRuntimeState();
    effect.commitPoliticalPassDiagnostics({
      transform: helper.cloneZoomTransform(identity.transform),
      transformBucket: helper.getTransformBucketSignature(identity.transform),
      passSignature: helper.getRenderPassSignature("political", identity.transform),
      visibleItemCount: viewport.visibleItemCount,
      overscanPx: viewport.overscanPx,
      layout: helper.getRenderPassLayout("political"),
      stats: viewport.visibleStats,
      dirtyReason: String(getRenderPassCacheState().reasons?.political || ""),
      phase: String(state.renderPhase || ""),
    });
  }

  function buildPoliticalPassWorkerPacket({ identity, viewport }) {
    return buildPoliticalRasterWorkerPacket({
      visibleItems: viewport.visibleItems,
      transform: identity.transform,
      canvasWidth: identity.canvasWidth,
      canvasHeight: identity.canvasHeight,
    });
  }

  function requestPoliticalPassWorker({ identity, packetState }) {
    const state = getRuntimeState();
    effect.requestPoliticalRasterWorkerPass({
      identity: identity.workerIdentity,
      rasterPacket: packetState.packet,
      packetBuildMs: packetState.packetBuildMs,
      renderHint: {
        pass: "political",
        surface: "main",
        canvasPxWidth: packetState.packet?.canvasPxWidth
          || Math.max(0, Math.round(identity.canvasWidth * Number(state.dpr || 1))),
        canvasPxHeight: packetState.packet?.canvasPxHeight
          || Math.max(0, Math.round(identity.canvasHeight * Number(state.dpr || 1))),
        packetFeatureCount: Array.isArray(packetState.packet?.entries) ? packetState.packet.entries.length : 0,
        packetReason: String(packetState.reason || ""),
      },
      onAcceptedBitmapResult: effect.onAcceptedBitmapResult,
    });
  }

  function drawPoliticalFineFeatureLoop({ k, identity, viewport }) {
    const workerFrame = getters.drawWorkerPoliticalFine?.();
    if (workerFrame) return workerFrame;
    const state = getRuntimeState();
    const islandNeighbors = getDebugMode() === "ISLANDS" ? helper.getIslandNeighborGraph() : null;
    const featureMetrics = { fillMs: 0, strokeMs: 0, renderedCount: 0, renderedIds: new Set() };
    // Prepare once per pass; persist each cold path as it is first drawn so
    // geometry outside the bounded idle warmup queue is reusable on later pans.
    const pathHandle = helper.getPoliticalPathCacheHandle(identity.transform, { resetIfMismatch: true });
    const paths = pathHandle.valid && pathHandle.map instanceof Map ? pathHandle.map : null;
    const readPath = (feature, index) => {
      const featureId = helper.getFeatureId(feature) || `feature-${index}`;
      const entry = paths?.get(featureId);
      if (helper.isPoliticalFeaturePathEntryCurrent(entry, feature)) return entry.path;
      const built = helper.getPoliticalFeaturePathEntry(feature, {
        featureId, transform: identity.transform, allowBuild: true, countBuild: true,
      });
      return helper.isPoliticalFeaturePathEntryCurrent(built, feature) ? built.path : null;
    };
    const hasVisibleItems = Array.isArray(viewport.visibleItems);
    const featureEntries = hasVisibleItems
      ? viewport.visibleItems
      : state.landData.features.map((feature, index) => ({
        feature,
        drawOrder: index,
        id: helper.getFeatureId(feature) || `feature-${index}`,
      }));
    helper.orderPoliticalShellUnderlayFirst(featureEntries).forEach(({ feature, drawOrder }) => {
      drawPoliticalFeature(feature, drawOrder, {
        k,
        canvasWidth: identity.canvasWidth,
        canvasHeight: identity.canvasHeight,
        islandNeighbors,
        transform: identity.transform,
        skipScreenCheck: hasVisibleItems,
        path: readPath(feature, drawOrder),
        useCachedPath: false,
        allowBuildPath: false,
        countPathBuild: false,
        metricsCollector: featureMetrics,
      });
    });
    return featureMetrics;
  }

  return Object.freeze({
    getPoliticalFeatureFillColor,
    buildPoliticalRasterWorkerPacket,
    drawPoliticalFeature,
    drawPoliticalFineFeatureLoop,
    drawPoliticalWorkerBitmapResult,
    publishPoliticalPassDiagnostics,
    recordPoliticalRasterWorkerSnapshot,
    requestPoliticalPassWorker,
    resolvePoliticalPassIdentity,
    resolvePoliticalPassViewport,
    tryPartialPoliticalPassRepaint,
  });
}
