import { IDLE_RENDER_PASS_DEFINITIONS } from "./render_pipeline_catalog.js";
import { EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES } from "./exact_after_settle_pass_catalog.js";
import { coversViewport } from "./cached_surface_coverage.js";

// Start private candidates without publishing pass canvases. A null result
// means the caller's guard or synchronous failure interrupted the traversal.
export function preflightPrivateRenderPasses(definitions, {
  prepareRenderPassAsync,
  shouldPrepare = () => true,
  beforePrepare = () => true,
  canReusePendingPass = () => false,
  onPrepareError,
}) {
  let preparationPending = false;
  for (const [passName] of definitions) {
    if (!["political", "physicalBase", "contextScenario", "contextMarkers", "borders", "labels"].includes(passName)
      || !shouldPrepare(passName)) continue;
    if (!beforePrepare(passName)) return null;
    try {
      const preparation = prepareRenderPassAsync(passName);
      if (preparation) {
        if (!canReusePendingPass(passName)) preparationPending = true;
        if (onPrepareError) Promise.resolve(preparation).catch(error => onPrepareError(passName, error));
      }
    } catch (error) {
      if (!onPrepareError) throw error;
      onPrepareError(passName, error);
      return null;
    }
  }
  return preparationPending;
}

// Preparation may yield more than once. Resume the same pass only while its
// scheduler generation is current, then publish passes in catalog order.
export function prepareExactRenderPassesInSlices({
  definitions, generation, enqueueFrameTask, prepareRenderPassAsync,
  canPreparePass, isGenerationCurrent, onPrepareError, onPassReady, onComplete, nowMs,
}) {
  const enqueueNextPass = (index) => {
    if (index >= definitions.length) {
      onComplete();
      return;
    }
    const [passName, drawFn] = definitions[index];
    enqueueFrameTask(() => {
      const passStartedAt = nowMs();
      if (!canPreparePass(passName)) return;
      const preparation = prepareRenderPassAsync(passName);
      if (preparation) {
        Promise.resolve(preparation).then(() => {
          if (isGenerationCurrent()) enqueueNextPass(index);
        }).catch(() => onPrepareError(passName));
        return;
      }
      onPassReady(passName, drawFn, index, passStartedAt);
      enqueueNextPass(index + 1);
    }, {
      priority: "high",
      label: `exact-after-settle-pass-${passName}`,
      generation,
      dedupe: true,
      deferOnContinuousInput: false,
    });
  };
  enqueueNextPass(0);
}

export function createRenderPipelinePassesOwner({
  state = {},
  constants = {},
  drawPasses = {},
  helpers = {},
} = {}) {
  const {
    exactAfterSettleDeferredPassNames = EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,
  } = constants;

  const {
    detectContextScenarioReasonMismatch = () => {},
    getContextBaseReuseDecision = () => ({ enabled: false }),
    getContextScenarioReuseDecision = () => ({ enabled: false }),
    getExactAfterSettleControllerState = () => null,
    getPassReferenceTransform = () => null,
    setPassReferenceTransform = null,
    getPassCoverage = () => null,
    getRenderPassCacheState = () => ({ signatures: {}, dirty: {}, reasons: {}, canvases: {}, counters: {} }),
    getRenderPassSignature = () => "",
    getActiveRenderPassNames = () => null,
    incrementPerfCounter = () => {},
    rebuildResolvedColors = () => {},
    recordRenderPerfMetric = () => {},
    renderPassToCache = () => {},
    prepareRenderPassAsync = () => null,
    canYieldRenderPassWork = () => false,
    nowMs = () => globalThis.performance?.now?.() || 0,
    requestRenderContinuation = () => {},
    shouldEnableContextBaseTransformReuse = () => false,
    shouldEnableContextScenarioTransformReuse = () => false,
    shouldStartExactAfterSettleFastPath = () => false,
    tryPartialPoliticalPassRepaint = () => false,
  } = helpers;

  const noopDrawPass = () => {};
  const lastCommitted = {};

  function canReusePendingPass(passName, cache = getRenderPassCacheState()) {
    if (passName !== "borders" || !cache.canvases?.[passName]) return false;
    if (getPassReferenceTransform(passName)) return true;
    const committed = lastCommitted[passName];
    const canvas = cache.canvases[passName];
    // A resize keeps the canvas object but clears its pixels: never restore a
    // reference for a surface whose dimensions changed since it was committed.
    if (!committed || committed.canvas !== canvas
      || committed.width !== canvas.width || committed.height !== canvas.height) return false;
    // Invalidation cleared the reference but the surface still holds the
    // borders committed at that transform: restore it so the composite can
    // scale the stale surface exactly like the interaction frame did.
    if (typeof setPassReferenceTransform !== "function") return false;
    setPassReferenceTransform(passName, committed.transform);
    return !!getPassReferenceTransform(passName);
  }

  function getIdleRenderPassDefinitions() {
    return IDLE_RENDER_PASS_DEFINITIONS.map(({ passName, drawKey }) => {
      const drawFn = typeof drawPasses[drawKey] === "function" ? drawPasses[drawKey] : noopDrawPass;
      return [passName, (k) => drawFn(k)];
    });
  }

  function shouldDeferExactAfterSettlePassForCriticalPaint(passName, cache = getRenderPassCacheState()) {
    if (!exactAfterSettleDeferredPassNames.has(passName)) return false;
    const controller = getExactAfterSettleControllerState();
    if (!controller || String(controller.phase || "") !== "awaiting-paint") return false;
    if (!cache.canvases?.[passName]) return false;
    if (!getPassReferenceTransform(passName)) return false;
    return true;
  }

  // idle pass 准备阶段只决定“要不要重画”和“记录原因”，真正绘制仍走 renderPassToCache。
  function prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache = getRenderPassCacheState()) {
    const nextSignature = getRenderPassSignature(passName, transform);
    const previousSignature = String(cache.signatures[passName] || "");
    if (previousSignature !== nextSignature) {
      cache.dirty[passName] = true;
      if (!cache.reasons[passName] || cache.reasons[passName] === "init") {
        cache.reasons[passName] = "signature";
      }
      if (passName === "contextScenario") {
        recordRenderPerfMetric("contextScenarioSignatureChanged", 0, {
          activeScenarioId: String(state.activeScenarioId || ""),
          previousSignature,
          nextSignature,
        });
      }
    }
    if (
      passName === "contextBase"
      && shouldEnableContextBaseTransformReuse()
      && !state.deferExactAfterSettle
      && shouldStartExactAfterSettleFastPath()
    ) {
      const reuseDecision = getContextBaseReuseDecision(transform);
      if (reuseDecision.enabled && reuseDecision.shouldExactRefresh) {
        cache.dirty[passName] = true;
        cache.reasons[passName] = reuseDecision.reason || "context-base-threshold";
      }
    }
    if (
      passName === "contextScenario"
      && shouldEnableContextScenarioTransformReuse()
      && cache.dirty[passName]
      && String(cache.reasons[passName] || "") === "signature"
    ) {
      const reuseDecision = getContextScenarioReuseDecision(transform);
      if (reuseDecision.enabled && reuseDecision.shouldExactRefresh) {
        cache.dirty[passName] = true;
        cache.reasons.contextScenario = "signature";
        incrementPerfCounter("contextScenarioExactRefreshCount");
        recordRenderPerfMetric("contextScenarioExactRefresh", 0, {
          activeScenarioId: String(state.activeScenarioId || ""),
          reason: reuseDecision.reason,
          scaleRatio: reuseDecision.scaleRatio,
          distancePx: reuseDecision.distancePx,
          maxDistancePx: reuseDecision.maxDistancePx,
          zoomBucket: reuseDecision.zoomBucket,
          referenceZoomBucket: reuseDecision.referenceZoomBucket,
          crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
          reuseFrameCount: reuseDecision.reuseFrameCount,
          reuseFrameLimit: reuseDecision.reuseFrameLimit,
        });
      } else {
        cache.dirty[passName] = false;
        cache.counters.contextScenarioReuseCount = Math.max(
          0,
          Number(cache.counters.contextScenarioReuseCount || 0) + 1,
        );
        recordRenderPerfMetric("contextScenarioReuseSkipped", 0, {
          activeScenarioId: String(state.activeScenarioId || ""),
          reason: reuseDecision.reason || "transform-reuse",
          transformK: Number(transform?.k || state.zoomTransform?.k || 1),
          scaleRatio: reuseDecision.scaleRatio,
          distancePx: reuseDecision.distancePx,
          maxDistancePx: reuseDecision.maxDistancePx,
          zoomBucket: reuseDecision.zoomBucket,
          referenceZoomBucket: reuseDecision.referenceZoomBucket,
          reuseFrameCount: reuseDecision.reuseFrameCount,
          reuseFrameLimit: reuseDecision.reuseFrameLimit,
        });
      }
    }
    if (!cache.dirty[passName]) return;
    if (shouldDeferExactAfterSettlePassForCriticalPaint(passName, cache)) {
      recordRenderPerfMetric("settleExactRefreshDeferredPass", 0, {
        activeScenarioId: String(state.activeScenarioId || ""),
        passName,
        reason: String(cache.reasons?.[passName] || "dirty"),
        controllerPhase: String(getExactAfterSettleControllerState()?.phase || ""),
      });
      return;
    }
    if (
      passName === "political"
      && tryPartialPoliticalPassRepaint(transform, nextSignature, timings)
    ) {
      return;
    }
    if ((passName === "physicalBase" || passName === "contextScenario" || passName === "contextMarkers" || passName === "borders" || passName === "labels")
      && prepareRenderPassAsync(passName)) {
      if (!canReusePendingPass(passName, cache)) return false;
      timings.usedDirtyFastFramePasses = [timings.usedDirtyFastFramePasses, passName].filter(Boolean).join(",");
      recordRenderPerfMetric("idleRenderPassDeferredForPreparation", 0, {
        passName,
        reason: "preparation-pending-reuse-surface",
        activeScenarioId: String(state.activeScenarioId || ""),
      });
      return;
    }
    renderPassToCache(passName, drawFn, transform, timings);
    const committedCanvas = cache.canvases?.[passName] || null;
    lastCommitted[passName] = {
      canvas: committedCanvas,
      width: committedCanvas?.width,
      height: committedCanvas?.height,
      transform: { x: transform.x, y: transform.y, k: transform.k },
    };
  }

  function ensureIdleRenderPasses(timings, passNames = null) {
    const transform = state.zoomTransform || globalThis.d3.zoomIdentity;
    const cache = getRenderPassCacheState();
    const activePassNames = getActiveRenderPassNames();
    const selectedPassNames = Array.isArray(passNames) ? passNames : activePassNames;
    const requestedPassNames = Array.isArray(selectedPassNames)
      ? new Set(selectedPassNames.filter((name) => name
        && (!Array.isArray(activePassNames) || activePassNames.includes(name)))) : null;
    if (state.legacyColorStateDirty) {
      rebuildResolvedColors();
    }
    // Color resolution and transformed-frame fallbacks can change the exact
    // identity after the frame-level worker check. Gate the actual paint here,
    // before clearing any pass canvas, including while still settling.
    const definitions = getIdleRenderPassDefinitions()
      .filter(([passName]) => !requestedPassNames || requestedPassNames.has(passName));
    // These producers own private candidates and independent cancellation
    // fences. Start all of them before waiting for any one of them; no pass
    // canvas is cleared or published by this preflight.
    const pendingPassNames = [];
    const preparationPending = preflightPrivateRenderPasses(definitions, {
      prepareRenderPassAsync: (passName) => {
        const preparation = prepareRenderPassAsync(passName);
        if (preparation) pendingPassNames.push(passName);
        return preparation;
      },
      canReusePendingPass,
      shouldPrepare: passName => cache.dirty[passName]
        || cache.signatures[passName] !== getRenderPassSignature(passName, transform),
    });
    if (preparationPending) {
      recordRenderPerfMetric("idleRenderPassPreflightPending", 0, {
        passNames: pendingPassNames.join(","),
        activeScenarioId: String(state.activeScenarioId || ""),
      });
      return false;
    }
    const startedAt = nowMs();
    for (let index = 0; index < definitions.length; index += 1) {
      const [passName, drawFn] = definitions[index];
      if (prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache) === false) return false;
      if (index < definitions.length - 1 && Number.isFinite(timings[passName])
        && canYieldRenderPassWork() && nowMs() - startedAt >= 8) {
        requestRenderContinuation("exact-pass-continuation");
        return false;
      }
    }
    if (Number.isFinite(timings.contextBase) || Number.isFinite(timings.contextScenario)) {
      timings.context =
        Math.max(0, Number(timings.contextBase || 0))
        + Math.max(0, Number(timings.contextScenario || 0));
    }
    detectContextScenarioReasonMismatch({ cache, renderPerf: state.renderPerfMetrics || {} });
    return true;
  }

  function ensureTransformedPassCoverage(timings, passNames) {
    const transform = state.zoomTransform || globalThis.d3.zoomIdentity;
    const cache = getRenderPassCacheState();
    const requested = new Set(passNames);
    const dpr = Math.max(1, Number(state.dpr || 1));
    const width = Math.floor(state.width * dpr) / dpr;
    const height = Math.floor(state.height * dpr) / dpr;
    const exhausted = getIdleRenderPassDefinitions().filter(([passName]) => requested.has(passName)
      && cache.canvases[passName] && getPassReferenceTransform(passName)
      && !coversViewport(getPassCoverage(passName, transform), width, height));
    // Settling may reuse dirty passes, but it must never publish their uncovered
    // edges. Exact preparation owns pending data/color changes.
    if (exhausted.some(([passName]) => cache.dirty[passName])) return false;
    // Prepare the expensive fine geometry without modifying any pass canvas.
    // The worker requests another frame when ready; input can keep coalescing.
    if (exhausted.some(([passName]) => prepareRenderPassAsync(passName))) return false;
    const startedAt = nowMs();
    for (let index = 0; index < exhausted.length; index += 1) {
      const [passName, drawFn] = exhausted[index];
      // Refill only the exhausted pass. Other pass canvases retain their real
      // painted margins; the compositor publishes the complete buffer atomically.
      renderPassToCache(passName, drawFn, transform, timings);
      recordRenderPerfMetric("interactionCoverageRefresh", 0, { passName });
      if (index < exhausted.length - 1 && canYieldRenderPassWork() && nowMs() - startedAt >= 8) {
        requestRenderContinuation("coverage-pass-continuation");
        return false;
      }
    }
    return true;
  }

  return {
    ensureTransformedPassCoverage,
    getIdleRenderPassDefinitions,
    prepareIdleRenderPassDefinition,
    ensureIdleRenderPasses,
  };
}
