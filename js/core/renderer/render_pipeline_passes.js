import { IDLE_RENDER_PASS_DEFINITIONS } from "./render_pipeline_catalog.js";
import { EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES } from "./exact_after_settle_pass_catalog.js";

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
    getRenderPassCacheState = () => ({ signatures: {}, dirty: {}, reasons: {}, canvases: {}, counters: {} }),
    getRenderPassSignature = () => "",
    incrementPerfCounter = () => {},
    recordRenderPerfMetric = () => {},
    renderPassToCache = () => {},
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

  function getHgoPreviewVisibilityTokenFromSignature(signature) {
    return String(signature || "")
      .split("::")
      .find((part) => part === "hgo:on" || part === "hgo:off") || "";
  }

  function didHgoPreviewVisibilityTokenChange(previousSignature, nextSignature) {
    const previousToken = getHgoPreviewVisibilityTokenFromSignature(previousSignature);
    const nextToken = getHgoPreviewVisibilityTokenFromSignature(nextSignature);
    return !!previousToken && !!nextToken && previousToken !== nextToken;
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
    const hgoPreviewVisibilityChanged = passName === "contextScenario"
      && didHgoPreviewVisibilityTokenChange(previousSignature, nextSignature);
    if (previousSignature !== nextSignature) {
      cache.dirty[passName] = true;
      if (hgoPreviewVisibilityChanged) {
        cache.reasons[passName] = "hgo-runtime-preview";
      } else if (!cache.reasons[passName] || cache.reasons[passName] === "init") {
        cache.reasons[passName] = "signature";
      }
      if (passName === "contextScenario") {
        recordRenderPerfMetric("contextScenarioSignatureChanged", 0, {
          activeScenarioId: String(state.activeScenarioId || ""),
          previousSignature,
          nextSignature,
          hgoPreviewVisibilityChanged,
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
    renderPassToCache(passName, drawFn, transform, timings);
  }

  function ensureIdleRenderPasses(timings, passNames = null) {
    const transform = state.zoomTransform || globalThis.d3.zoomIdentity;
    const cache = getRenderPassCacheState();
    const requestedPassNames = Array.isArray(passNames) ? new Set(passNames.filter(Boolean)) : null;
    getIdleRenderPassDefinitions()
      .filter(([passName]) => !requestedPassNames || requestedPassNames.has(passName))
      .forEach(([passName, drawFn]) => {
        prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache);
      });
    if (Number.isFinite(timings.contextBase) || Number.isFinite(timings.contextScenario)) {
      timings.context =
        Math.max(0, Number(timings.contextBase || 0))
        + Math.max(0, Number(timings.contextScenario || 0));
    }
    detectContextScenarioReasonMismatch({ cache, renderPerf: state.renderPerfMetrics || {} });
  }

  return {
    getIdleRenderPassDefinitions,
    prepareIdleRenderPassDefinition,
    ensureIdleRenderPasses,
  };
}
