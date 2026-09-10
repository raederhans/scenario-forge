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

function cloneJsonSafeTimings(timings) {
  return Object.freeze(Object.fromEntries(
    Object.entries(timings || {}).map(([key, value]) => [
      key,
      typeof value === "number" ? value : String(value),
    ]),
  ));
}

function createSummary({ status, frameMode, totalMs = 0, timings = {}, branch = {} }) {
  return Object.freeze({
    status,
    frameMode,
    drewFrame: Boolean(branch.drewFrame),
    usedTransformedFrame: Boolean(branch.useTransformedFrame),
    usedLastGoodFallback: Boolean(branch.usedLastGoodFallback),
    usedBaseVisibleFallback: Boolean(branch.usedBaseVisibleFallback),
    keptPreviousPixels: Boolean(branch.keptPreviousPixels),
    drewExactFrame: Boolean(branch.drewExactFrame),
    skippedCapture: Boolean(branch.skippedCapture),
    totalMs: Math.max(0, Number(totalMs || 0)),
    timings: cloneJsonSafeTimings(timings),
  });
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

  function drawCanvasFrameCore(options) {
    const includeSummary = options?.includeSummary === true;
    if (!isFrameSurfaceReady()) {
      return includeSummary
        ? createSummary({ status: "skipped-not-ready", frameMode: "none" })
        : undefined;
    }

    ensureLayerDataFromTopology();
    // Exact asynchronous work keeps the last complete visible frame intact.
    // Input frames still take the ordinary transformed-frame branch.
    if (effects.prepareAsyncFrame?.()) {
      return includeSummary ? createSummary({ status: "waiting-worker", frameMode: "previous-pixels" }) : undefined;
    }
    incrementPerfCounter("drawCanvas");
    clearPoliticalPatchOverlayIfStale("drawCanvas-stale-overlay");
    const initialPhase = getRenderPhase();
    const initialDeferExactAfterSettle = !!getDeferExactAfterSettle();
    if (initialPhase !== renderPhaseIdle || initialDeferExactAfterSettle) {
      cancelPoliticalPathWarmup("drawCanvas-non-idle");
    }
    promoteDeferredColorRenderToIdle();
    const frameStart = nowMs();
    const currentPhase = getRenderPhase();
    const currentDeferExactAfterSettle = !!getDeferExactAfterSettle();
    const frameTimings = {};
    const useTransformedFrame = currentPhase === renderPhaseInteracting
      || currentPhase === renderPhaseSettling
      || (currentPhase === renderPhaseIdle && currentDeferExactAfterSettle);
    let drewFrame = false;
    let usedLastGoodFallback = false;
    let usedBaseVisibleFallback = false;
    let keptPreviousPixels = false;
    let drewExactFrame = false;
    let frameMode = "none";

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
      ensureIdleRenderPasses(frameTimings, activeRenderPassNames);
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
    return typeof effects.withValidatedCache === "function"
      ? effects.withValidatedCache(() => drawCanvasFrameCore(options))
      : drawCanvasFrameCore(options);
  }

  return Object.freeze({
    drawCanvasFrame,
  });
}
