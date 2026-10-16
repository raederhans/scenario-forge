import { IDLE_RENDER_PASS_DEFINITIONS } from "./render_pipeline_catalog.js";
import { EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES } from "./exact_after_settle_pass_catalog.js";
import { coversViewport } from "./cached_surface_coverage.js";

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
    if (passName === "contextScenario" && prepareRenderPassAsync(passName)) return false;
    renderPassToCache(passName, drawFn, transform, timings);
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
    if ((!requestedPassNames || requestedPassNames.has("political"))
      && (cache.dirty.political
        || cache.signatures.political !== getRenderPassSignature("political", transform))
      && prepareRenderPassAsync("political")) return false;
    const definitions = getIdleRenderPassDefinitions()
      .filter(([passName]) => !requestedPassNames || requestedPassNames.has(passName));
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
