import { createFrameSummary as createSummary } from "./frame_summary.js";

function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

function requireConstant(candidate, label) {
  const value = String(candidate || "").trim();
  if (!value) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function validateFunctions(namespace, functions) {
  const validated = {};
  for (const [name, value] of Object.entries(functions)) {
    validated[name] = requireFunction(value, `${namespace}.${name}`);
  }
  return validated;
}

function validateConstants(constants) {
  const {
    renderPhaseIdle,
    renderPhaseInteracting,
    renderPhaseSettling,
  } = constants;
  return {
    renderPhaseIdle: requireConstant(renderPhaseIdle, "constants.renderPhaseIdle"),
    renderPhaseInteracting: requireConstant(renderPhaseInteracting, "constants.renderPhaseInteracting"),
    renderPhaseSettling: requireConstant(renderPhaseSettling, "constants.renderPhaseSettling"),
  };
}

export function createDrawCanvasOrchestrationOwner({ constants = {}, getters = {}, effects = {} } = {}) {
  const {
    renderPhaseIdle,
    renderPhaseInteracting,
    renderPhaseSettling,
  } = validateConstants(constants);
  const {
    isFrameSurfaceReady,
    getRenderPhase,
    getDeferExactAfterSettle,
    getFirstVisibleFramePainted,
    getEffectiveZoomTransform,
    getRawZoomTransform,
    getActiveScenarioId,
    getActiveRenderPassNames,
    nowMs,
  } = validateFunctions("getters", {
    isFrameSurfaceReady: getters.isFrameSurfaceReady,
    getRenderPhase: getters.getRenderPhase,
    getDeferExactAfterSettle: getters.getDeferExactAfterSettle,
    getFirstVisibleFramePainted: getters.getFirstVisibleFramePainted,
    getEffectiveZoomTransform: getters.getEffectiveZoomTransform,
    getRawZoomTransform: getters.getRawZoomTransform,
    getActiveScenarioId: getters.getActiveScenarioId,
    getActiveRenderPassNames: getters.getActiveRenderPassNames,
    nowMs: getters.nowMs,
  });
  const {
    ensureLayerDataFromTopology,
    incrementPerfCounter,
    clearPoliticalPatchOverlayIfStale,
    cancelPoliticalPathWarmup,
    promoteDeferredColorRenderToIdle,
    drawTransformedFrameFromCaches,
    drawLastGoodFrameFallback,
    noteMissingVisibleFrameSkippedDuringInteraction,
    drawBaseVisibleFrameFallback,
    resetContextBreakdownForExactFrame,
    ensureIdleRenderPasses,
    composeCachedPasses,
    abortPendingExactAfterSettleRefreshAfterPaint,
    commitLastFrame,
    markFirstVisibleFramePainted,
    captureLastGoodFrame,
    recordRenderPerfMetric,
    finalizePendingExactAfterSettleRefreshAfterPaint,
  } = validateFunctions("effects", {
    ensureLayerDataFromTopology: effects.ensureLayerDataFromTopology,
    incrementPerfCounter: effects.incrementPerfCounter,
    clearPoliticalPatchOverlayIfStale: effects.clearPoliticalPatchOverlayIfStale,
    cancelPoliticalPathWarmup: effects.cancelPoliticalPathWarmup,
    promoteDeferredColorRenderToIdle: effects.promoteDeferredColorRenderToIdle,
    drawTransformedFrameFromCaches: effects.drawTransformedFrameFromCaches,
    drawLastGoodFrameFallback: effects.drawLastGoodFrameFallback,
    noteMissingVisibleFrameSkippedDuringInteraction: effects.noteMissingVisibleFrameSkippedDuringInteraction,
    drawBaseVisibleFrameFallback: effects.drawBaseVisibleFrameFallback,
    resetContextBreakdownForExactFrame: effects.resetContextBreakdownForExactFrame,
    ensureIdleRenderPasses: effects.ensureIdleRenderPasses,
    composeCachedPasses: effects.composeCachedPasses,
    abortPendingExactAfterSettleRefreshAfterPaint: effects.abortPendingExactAfterSettleRefreshAfterPaint,
    commitLastFrame: effects.commitLastFrame,
    markFirstVisibleFramePainted: effects.markFirstVisibleFramePainted,
    captureLastGoodFrame: effects.captureLastGoodFrame,
    recordRenderPerfMetric: effects.recordRenderPerfMetric,
    finalizePendingExactAfterSettleRefreshAfterPaint: effects.finalizePendingExactAfterSettleRefreshAfterPaint,
  });

  function drawNavigationFrame(includeSummary, { waitingWorker = false } = {}) {
    if (typeof effects.drawNavigationFrame !== "function") return null;
    const phase = getRenderPhase();
    const deferExact = !!getDeferExactAfterSettle();
    if (!waitingWorker && phase === renderPhaseIdle && !deferExact) return null;
    if (waitingWorker && (phase !== renderPhaseIdle || deferExact)) return null;
    const transform = getRawZoomTransform();
    const frameStart = nowMs();
    if (!effects.drawNavigationFrame(transform)) return null;
    incrementPerfCounter("drawCanvas");
    clearPoliticalPatchOverlayIfStale("drawCanvas-stale-overlay");
    cancelPoliticalPathWarmup("drawCanvas-navigation");
    const totalMs = Math.max(0, nowMs() - Number(frameStart || 0));
    commitLastFrame({ phase: getRenderPhase(), totalMs, timings: {}, transform,
      frameMode: "navigation", presented: true });
    markFirstVisibleFramePainted("navigation-frame");
    incrementPerfCounter("frames");
    return includeSummary ? createSummary({ status: "drawn", frameMode: "navigation", totalMs,
      branch: { drewFrame: true } }) : true;
  }

  function waitingWorkerResult(includeSummary) {
    const navigationResult = drawNavigationFrame(includeSummary, { waitingWorker: true });
    if (navigationResult !== null) return includeSummary ? navigationResult : undefined;
    if (getFirstVisibleFramePainted()) {
      const transform = getEffectiveZoomTransform();
      const startedAt = nowMs();
      // These fallbacks validate identity, raster quality and complete coverage
      // before touching visible pixels. Reuse does not complete pending exact
      // work, and must never become a new last-good capture.
      const overviewDrawn = !!effects.drawOverviewFrameFallback?.(transform);
      if (overviewDrawn || drawLastGoodFrameFallback(transform)) {
        const frameMode = overviewDrawn ? "overview" : "last-good";
        const totalMs = Math.max(0, nowMs() - startedAt);
        commitLastFrame({ phase: getRenderPhase(), totalMs, timings: {}, transform,
          frameMode, presented: true });
        incrementPerfCounter("frames");
        return includeSummary ? createSummary({ status: "waiting-worker", frameMode, totalMs,
          branch: { drewFrame: true, usedLastGoodFallback: true, skippedCapture: true } }) : undefined;
      }
    }
    return includeSummary ? createSummary({ status: "waiting-worker", frameMode: "previous-pixels" }) : undefined;
  }

  function drawCanvasFrameCore(options) {
    const includeSummary = options?.includeSummary === true;
    if (!isFrameSurfaceReady()) {
      return includeSummary
        ? createSummary({ status: "skipped-not-ready", frameMode: "none" })
        : undefined;
    }
    effects.beforeFrame?.();

    // A ready navigation frame can cover the requested transform before fine
    // topology and worker preparation. Color edits may require exact rendering.
    const hasNavigationFrame = typeof effects.drawNavigationFrame === "function";
    if (hasNavigationFrame) {
      promoteDeferredColorRenderToIdle();
      const navigationResult = drawNavigationFrame(includeSummary);
      if (navigationResult !== null) return includeSummary ? navigationResult : undefined;
    }
    ensureLayerDataFromTopology();
    // Color recovery can promote settling/deferred input to an exact idle draw.
    // Decide that phase before asking the worker to prepare its fine geometry.
    if (!hasNavigationFrame) promoteDeferredColorRenderToIdle();
    // Exact asynchronous work keeps the last complete visible frame intact.
    // Input frames still take the ordinary transformed-frame branch.
    if (effects.prepareAsyncFrame?.()) {
      return waitingWorkerResult(includeSummary);
    }
    incrementPerfCounter("drawCanvas");
    clearPoliticalPatchOverlayIfStale("drawCanvas-stale-overlay");
    const initialPhase = getRenderPhase();
    const initialDeferExactAfterSettle = !!getDeferExactAfterSettle();
    if (initialPhase !== renderPhaseIdle || initialDeferExactAfterSettle) {
      cancelPoliticalPathWarmup("drawCanvas-non-idle");
    }
    const frameStart = nowMs();
    const currentPhase = getRenderPhase();
    const currentDeferExactAfterSettle = !!getDeferExactAfterSettle();
    const frameTimings = {};
    const useTransformedFrame = !effects.requiresExactFrame?.() && (currentPhase === renderPhaseInteracting
      || currentPhase === renderPhaseSettling
      || (currentPhase === renderPhaseIdle && currentDeferExactAfterSettle));
    let drewFrame = false;
    let usedLastGoodFallback = false;
    let usedBaseVisibleFallback = false;
    let keptPreviousPixels = false;
    let drewExactFrame = false;
    let frameMode = "none";

    if (useTransformedFrame && effects.drawOverviewFrameFallback
      && effects.drawOverviewFrameFallback(getEffectiveZoomTransform())) {
      drewFrame = true;
      usedLastGoodFallback = true;
      frameMode = "overview";
    }
    if (useTransformedFrame && !drewFrame) {
      drewFrame = !!drawTransformedFrameFromCaches(frameTimings, {
        interactiveBorders: currentPhase !== renderPhaseIdle || currentDeferExactAfterSettle,
      });
      if (drewFrame) {
        frameMode = "fast";
      } else {
        drewFrame = !!drawLastGoodFrameFallback(getEffectiveZoomTransform());
        usedLastGoodFallback = drewFrame;
        if (drewFrame) {
          frameMode = "last-good";
        } else if (getRenderPhase() === renderPhaseInteracting && getFirstVisibleFramePainted()) {
          noteMissingVisibleFrameSkippedDuringInteraction("missing-fast-frame-no-continuity");
          keptPreviousPixels = true;
          drewFrame = true;
          frameMode = "previous-pixels";
        } else {
          drewFrame = !!drawBaseVisibleFrameFallback("missing-fast-frame-no-continuity");
          usedBaseVisibleFallback = drewFrame;
          if (drewFrame) {
            frameMode = "base-visible";
          }
        }
      }
    }

    if (!useTransformedFrame || !drewFrame) {
      resetContextBreakdownForExactFrame();
      const activeRenderPassNames = getActiveRenderPassNames();
      if (ensureIdleRenderPasses(frameTimings, activeRenderPassNames) === false) {
        return waitingWorkerResult(includeSummary);
      }
      drewExactFrame = !!composeCachedPasses(activeRenderPassNames);
      drewFrame = drewExactFrame;
      frameMode = drewExactFrame ? "exact" : frameMode;
      if (!drewExactFrame) {
        abortPendingExactAfterSettleRefreshAfterPaint("compose-cached-passes-failed");
      }
    }

    const commitPhase = getRenderPhase();
    const totalMs = Math.max(0, nowMs() - Number(frameStart || 0));
    commitLastFrame({
      phase: commitPhase,
      totalMs,
      timings: frameTimings,
      transform: getRawZoomTransform(),
      frameMode,
      presented: drewFrame && !keptPreviousPixels,
    });

    let capturePhase = currentPhase;
    if (drewFrame && !usedBaseVisibleFallback && !keptPreviousPixels) {
      const firstVisibleReason = usedLastGoodFallback
        ? "last-good-frame"
        : (useTransformedFrame ? "fast-frame" : "exact-frame");
      markFirstVisibleFramePainted(firstVisibleReason);
      capturePhase = getRenderPhase();
    }
    const usedDirtyFastFramePasses = typeof frameTimings.usedDirtyFastFramePasses === "string"
      && frameTimings.usedDirtyFastFramePasses.length > 0;
    if (
      drewFrame
      && !keptPreviousPixels
      && !usedLastGoodFallback
      && !usedBaseVisibleFallback
      && !usedDirtyFastFramePasses
      && (!useTransformedFrame || capturePhase !== renderPhaseInteracting)
    ) {
      captureLastGoodFrame(useTransformedFrame ? "fast-frame" : "exact-frame", getRawZoomTransform());
    } else if (drewFrame && usedDirtyFastFramePasses) {
      recordRenderPerfMetric("lastGoodFrameCaptureSkipped", 0, {
        reason: "dirty-fast-frame",
        dirtyPasses: frameTimings.usedDirtyFastFramePasses,
        activeScenarioId: String(getActiveScenarioId() || ""),
        phase: String(capturePhase || ""),
      });
    }
    if (drewExactFrame) {
      finalizePendingExactAfterSettleRefreshAfterPaint();
    }
    incrementPerfCounter("frames");

    return includeSummary
      ? createSummary({
        status: drewFrame ? "drawn" : "not-drawn",
        frameMode,
        totalMs,
        timings: frameTimings,
        branch: {
          drewFrame,
          useTransformedFrame,
          usedLastGoodFallback,
          usedBaseVisibleFallback,
          keptPreviousPixels,
          drewExactFrame,
          skippedCapture: usedDirtyFastFramePasses,
        },
      })
      : undefined;
  }

  function drawCanvasFrame(options) {
    try {
      return typeof effects.withValidatedCache === "function"
        ? effects.withValidatedCache(() => drawCanvasFrameCore(options))
        : drawCanvasFrameCore(options);
    } finally { effects.afterFrame?.(); }
  }
  return Object.freeze({ drawCanvasFrame });
}
