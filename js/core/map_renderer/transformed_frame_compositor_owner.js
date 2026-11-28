import { requireFunctionFrom } from "../renderer/require_function.js";
function requireString(candidate, label) {
  const value = String(candidate || "").trim();
  if (!value) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requirePassNames(candidate) {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new TypeError("constants.interactionCompositePassNames must be a non-empty array.");
  }
  return Object.freeze(candidate.slice());
}

export function createTransformedFrameCompositorOwner({
  constants = {},
  getters = {},
  helpers = {},
  effects = {},
} = {}) {
  const interactionCompositePassNames = requirePassNames(constants.interactionCompositePassNames);
  const getActiveInteractionCompositePassNames = getters.getActiveInteractionCompositePassNames
    || (() => interactionCompositePassNames);
  const renderPhaseIdle = requireString(constants.renderPhaseIdle, "constants.renderPhaseIdle");
  const renderPhaseInteracting = requireString(
    constants.renderPhaseInteracting,
    "constants.renderPhaseInteracting",
  );
  const renderPhaseSettling = requireString(
    constants.renderPhaseSettling,
    "constants.renderPhaseSettling",
  );

  const requireGetter = requireFunctionFrom(getters, "getters");
  const getCurrentTransform = requireGetter("getCurrentTransform");
  const getRenderPassCacheSnapshot = requireGetter("getRenderPassCacheSnapshot");
  const getActiveTransformedFramePassNames = requireGetter("getActiveTransformedFramePassNames");
  const getRenderPhase = requireGetter("getRenderPhase");
  const getDeferExactAfterSettle = requireGetter("getDeferExactAfterSettle");
  const getActiveScenarioId = requireGetter("getActiveScenarioId");
  const getPendingExactPoliticalFastFrame = requireGetter("getPendingExactPoliticalFastFrame");
  const getZoomGestureScaleDelta = requireGetter("getZoomGestureScaleDelta");
  const getZoomGestureEndedAt = requireGetter("getZoomGestureEndedAt");
  const getDpr = requireGetter("getDpr");

  const requireHelper = requireFunctionFrom(helpers, "helpers");
  const nowMs = requireHelper("nowMs");
  const canDrawTransformedPass = requireHelper("canDrawTransformedPass");
  const getInteractionCompositeReuseDecision = requireHelper("getInteractionCompositeReuseDecision");

  const requireEffect = requireFunctionFrom(effects, "effects");
  const ensureCompositeBufferCanvas = requireEffect("ensureCompositeBufferCanvas");
  const resetCanvasContext = requireEffect("resetCanvasContext");
  const withRenderTarget = requireEffect("withRenderTarget");
  const drawInteractionComposite = requireEffect("drawInteractionComposite");
  const composeRenderPassesToTarget = requireEffect("composeRenderPassesToTarget");
  const drawTransformedPass = requireEffect("drawTransformedPass");
  const drawInteractionBorderSnapshot = requireEffect("drawInteractionBorderSnapshot");
  const drawBordersPass = requireEffect("drawBordersPass");
  const blitCompositeBufferToMain = requireEffect("blitCompositeBufferToMain");
  const setInteractionCompositeRejectedReason = requireEffect("setInteractionCompositeRejectedReason");
  const invalidateInteractionComposite = requireEffect("invalidateInteractionComposite");
  const buildInteractionComposite = requireEffect("buildInteractionComposite");
  const canDrawInteractionComposite = requireEffect("canDrawInteractionComposite");
  const setPendingExactPoliticalFastFrame = requireEffect("setPendingExactPoliticalFastFrame");
  const recordRenderPerfMetric = requireEffect("recordRenderPerfMetric");
  const recordPassTiming = requireEffect("recordPassTiming");
  const incrementPerfCounter = requireEffect("incrementPerfCounter");

  function composeTransformedFrameToBuffer(
    currentTransform,
    transformedPasses,
    {
      interactiveBorders = false,
      useInteractionComposite = true,
      allowInteractionCompositeContinuity = false,
    } = {},
  ) {
    const bufferCanvas = ensureCompositeBufferCanvas();
    const bufferContext = bufferCanvas.getContext("2d");
    if (!bufferContext) return false;
    resetCanvasContext(bufferContext, bufferCanvas.width, bufferCanvas.height);
    let ok = false;
    withRenderTarget(bufferContext, () => {
      const interactionOk = useInteractionComposite
        ? drawInteractionComposite(currentTransform, {
          allowSelectionTopologyContinuity: allowInteractionCompositeContinuity,
        })
        : composeRenderPassesToTarget(
          bufferContext,
          getActiveInteractionCompositePassNames(),
          currentTransform,
          { requireAllPasses: true },
        ).ok;
      ok = interactionOk
        && transformedPasses.every((passName) => drawTransformedPass(passName, currentTransform));
      if (!ok) return;
      if (!drawInteractionBorderSnapshot(currentTransform)) {
        const k = Math.max(0.0001, Number(currentTransform?.k || 1));
        const dpr = getDpr();
        bufferContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        bufferContext.translate(currentTransform.x, currentTransform.y);
        bufferContext.scale(k, k);
        drawBordersPass(k, { interactive: !!interactiveBorders });
        bufferContext.setTransform(1, 0, 0, 1, 0, 0);
      }
      ok = effects.drawInteractionLabels
        ? effects.drawInteractionLabels(currentTransform)
        : drawTransformedPass("labels", currentTransform);
    });
    if (!ok) return false;
    blitCompositeBufferToMain(bufferCanvas);
    return true;
  }

  function drawTransformedFrameFromCaches(timings, { interactiveBorders = false } = {}) {
    const currentTransform = getCurrentTransform();
    const compositeStart = nowMs();
    if (effects.ensureTransformedPassCoverage?.(timings) === false) return false;
    const cache = getRenderPassCacheSnapshot();
    const activeTransformedPassNames = getActiveTransformedFramePassNames();
    const activeInteractionPassNames = getActiveInteractionCompositePassNames();
    const transformedPasses = activeTransformedPassNames.filter((passName) => (
      !activeInteractionPassNames.includes(passName) && passName !== "labels"
        && !(effects.drawInteractionLabels && passName === "textureLabels")
    ));
    const initialRenderPhase = getRenderPhase();
    const allowDirtyFastFrame = initialRenderPhase === renderPhaseSettling
      || (initialRenderPhase === renderPhaseIdle && getDeferExactAfterSettle());
    const dirtyFastFramePassNames = allowDirtyFastFrame
      ? activeTransformedPassNames.filter((passName) => !!cache.dirty?.[passName])
      : [];
    if (activeTransformedPassNames.some((passName) => !canDrawTransformedPass(passName, cache, {
      allowDirty: allowDirtyFastFrame,
    }))) {
      return false;
    }
    const compositeReuseDecision = getInteractionCompositeReuseDecision(currentTransform, cache, {
      allowSelectionTopologyContinuity: getRenderPhase() === renderPhaseInteracting,
    });
    const canReuseComposite = compositeReuseDecision.ok;
    if (!canReuseComposite) {
      setInteractionCompositeRejectedReason(compositeReuseDecision.reason || "unknown");
      if (compositeReuseDecision.reason !== "invalid") {
        invalidateInteractionComposite(compositeReuseDecision.reason);
      }
    }
    // Building a composite only copies already painted pass canvases, including
    // their margins. It must also be available on the first input frame.
    const canBuildCompositeNow = true;
    const canDrawDirtyInteractionPasses = allowDirtyFastFrame
      && !canReuseComposite
      && activeInteractionPassNames.every((passName) => canDrawTransformedPass(passName, cache, {
        allowDirty: true,
      }));
    const compositeReady = canReuseComposite
      || (canBuildCompositeNow && buildInteractionComposite(currentTransform, timings))
      || canDrawDirtyInteractionPasses;
    if (!compositeReady) {
      recordRenderPerfMetric("interactionCompositeUnavailable", 0, {
        phase: String(getRenderPhase() || ""),
        activeScenarioId: String(getActiveScenarioId() || ""),
        deferredBuild: !canBuildCompositeNow,
        allowDirtyFastFrame,
        reason: compositeReuseDecision.reason
          || cache.interactionComposite?.rejectedReason
          || "missing-interaction-composite",
      });
      return false;
    }
    if (
      !canDrawDirtyInteractionPasses
      && !canReuseComposite
      && !canDrawInteractionComposite(currentTransform, cache)
    ) {
      return false;
    }
    if (
      getDeferExactAfterSettle()
      && getPendingExactPoliticalFastFrame()
      && !cache.dirty?.political
    ) {
      setPendingExactPoliticalFastFrame(false);
      recordRenderPerfMetric("settlePoliticalFastExactSkipped", 0, {
        activeScenarioId: String(getActiveScenarioId() || ""),
        reason: "defer-to-sliced-exact-refresh",
        scaleDelta: Number(getZoomGestureScaleDelta() || 0),
        zoomEndedAt: Number(getZoomGestureEndedAt() || 0),
      });
    }
    if (canDrawDirtyInteractionPasses) {
      timings.usedDirtyInteractionPasses = true;
      recordRenderPerfMetric("dirtyInteractionPassFastFrame", 0, {
        phase: String(getRenderPhase() || ""),
        activeScenarioId: String(getActiveScenarioId() || ""),
        reason: cache.interactionComposite?.rejectedReason || "dirty-interaction-passes",
      });
    }
    if (dirtyFastFramePassNames.length) {
      timings.usedDirtyFastFramePasses = dirtyFastFramePassNames.join(",");
    }
    const drewAll = composeTransformedFrameToBuffer(currentTransform, transformedPasses, {
      interactiveBorders,
      useInteractionComposite: !canDrawDirtyInteractionPasses,
      allowInteractionCompositeContinuity: compositeReuseDecision.mode === "continuity",
    });
    if (!drewAll) {
      recordRenderPerfMetric("transformedFrameBufferComposeFailure", 0, {
        phase: String(getRenderPhase() || ""),
        activeScenarioId: String(getActiveScenarioId() || ""),
        allowDirtyFastFrame,
        usedDirtyInteractionPasses: canDrawDirtyInteractionPasses,
      });
      return false;
    }
    const timingLabel = interactiveBorders ? "interactiveComposite" : "transformedComposite";
    recordPassTiming(timings, timingLabel, compositeStart);
    if (Number.isFinite(timings.contextBase) || Number.isFinite(timings.contextScenario)) {
      timings.context = Math.max(0, Number(timings.contextBase || 0))
        + Math.max(0, Number(timings.contextScenario || 0));
    }
    incrementPerfCounter("transformedFrames");
    const finalRenderPhase = getRenderPhase();
    if (
      finalRenderPhase === renderPhaseSettling
      || (finalRenderPhase === renderPhaseIdle && getDeferExactAfterSettle())
    ) {
      recordRenderPerfMetric("settleFastFrame", Math.max(0, nowMs() - compositeStart), {
        phase: finalRenderPhase,
        interactiveBorders: !!interactiveBorders,
        activeScenarioId: String(getActiveScenarioId() || ""),
      });
    }
    return true;
  }

  return Object.freeze({
    composeTransformedFrameToBuffer,
    drawTransformedFrameFromCaches,
  });
}
