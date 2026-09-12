import {
  beginExactAfterSettleControllerApplyState,
  beginExactAfterSettleControllerFinalizeState,
  beginExactAfterSettleControllerScheduleState,
  captureExactAfterSettleControllerState,
  completeExactAfterSettleControllerApplyState,
  ensureExactAfterSettleControllerState,
  isExactAfterSettleControllerActiveState,
  isExactAfterSettleGenerationCurrentState,
  refreshExactAfterSettleControllerIdentityState,
  replaceExactAfterSettlePendingPlanState,
  resetExactAfterSettleControllerState,
  setDeferExactAfterSettleState,
  setExactAfterSettleHandleState,
  setPendingExactPoliticalFastFrameState,
} from "../state/actions/renderer_exact_refresh_actions.js";
import {
  createExactAfterSettleRefreshPlan,
  filterExactAfterSettleIdleRenderPassDefinitions,
  getExactAfterSettleDprRestorePasses,
  resolveDeferredExactContextTargetPasses,
  resolveExactAfterSettleTargetPasses,
} from "./exact_after_settle_refresh_plans.js";

function createExactAfterSettleScheduler({
  runtimeState,
  renderPassNames = [],
  renderPhaseIdle = "idle",
  exactContextRefreshDelayMs = 0,
  getContext,
  getVisibleContextFlagSignature,
  cloneZoomTransform,
  getAdaptiveSettleProfile,
  getContextBaseReuseDecision,
  shouldForceExactContextBaseRefresh,
  updateDprStage,
  setCanvasSize,
  cancelDeferredContextBaseEnhancement,
  setDeferContextBaseEnhancements,
  shouldDeferContextBaseEnhancementsForExactRefresh,
  scheduleDeferredContextBaseEnhancements,
  getRenderPassCacheState,
  getRenderPassSignature,
  getActiveRenderPassNames = () => renderPassNames,
  getRenderPipelinePassesOwner,
  prepareRenderPassAsync = () => null,
  getPhysicalExactRefreshPasses,
  invalidateRenderPasses,
  rebuildResolvedColors,
  requestRendererRender,
  render,
  recordRenderPerfMetric,
  readRenderPerfMetricDuration,
  nowMs,
  enqueueFrameTask,
  scheduleDeferredWork,
  cancelDeferredWork,
  flushPendingScenarioChunkRefreshAfterExact,
} = {}) {
  let deferredExactContextRefreshHandle = null;
  let deferredExactContextRefreshVersion = 0;
  const deferredExactContextRefreshTaskHandles = new Set();

  function getExactAfterSettleControllerState() {
    ensureExactAfterSettleControllerState(runtimeState);
    return captureExactAfterSettleControllerState(runtimeState);
  }

  function getTransformBucketSignature(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
    const k = Math.round(Number(transform?.k || 1) * 100);
    const x = Math.round(Number(transform?.x || 0) / 64);
    const y = Math.round(Number(transform?.y || 0) / 64);
    return `${k}:${x}:${y}`;
  }

  function getExactAfterSettleIdentity() {
    const context = getContext();
    const loadState = runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object"
      ? runtimeState.runtimeChunkLoadState
      : null;
    return {
      scenarioId: String(runtimeState.activeScenarioId || ""),
      selectionVersion: Number(loadState?.selectionVersion || 0),
      topologyRevision: Number(runtimeState.topologyRevision || 0),
      dpr: Math.max(1, Number(runtimeState.dpr || 1)),
      pixelWidth: Math.max(1, Number(context?.canvas?.width || 1)),
      pixelHeight: Math.max(1, Number(context?.canvas?.height || 1)),
      colorRevision: Number(runtimeState.colorRevision || 0),
      contextFlagSignature: getVisibleContextFlagSignature(),
      zoomToken: Number(runtimeState.zoomGestureEndedAt || 0),
      transformBucket: getTransformBucketSignature(),
    };
  }

  function assignExactAfterSettleIdentity(identity = getExactAfterSettleIdentity()) {
    return refreshExactAfterSettleControllerIdentityState(runtimeState, identity);
  }

  function isExactAfterSettleIdentityCurrent(controller) {
    if (!controller || typeof controller !== "object") return false;
    const identity = getExactAfterSettleIdentity();
    return String(controller.scenarioId || "") === identity.scenarioId
      && Number(controller.selectionVersion || 0) === identity.selectionVersion
      && Number(controller.topologyRevision || 0) === identity.topologyRevision
      && Math.abs(Number(controller.dpr || 1) - identity.dpr) <= 0.01
      && Number(controller.pixelWidth || 0) === identity.pixelWidth
      && Number(controller.pixelHeight || 0) === identity.pixelHeight
      && Number(controller.colorRevision || 0) === identity.colorRevision
      && String(controller.contextFlagSignature || "") === identity.contextFlagSignature
      && Number(controller.zoomToken || 0) === identity.zoomToken
      && String(controller.transformBucket || "") === identity.transformBucket;
  }

  function resetExactAfterSettleController(reason = "reset", generation = null) {
    return resetExactAfterSettleControllerState(runtimeState, { reason, generation });
  }

  function abortInterruptedExactAfterSettleRefresh(reason = "interrupted", generation = null) {
    const normalizedReason = String(reason || "interrupted").trim() || "interrupted";
    const shouldRearmExactRefresh = !!runtimeState.deferExactAfterSettle;
    cancelDeferredExactContextRefresh();
    recordRenderPerfMetric("settleExactRefreshAbortBeforePaint", 0, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      generation: generation == null ? Number(getExactAfterSettleControllerState().generation || 0) : Number(generation || 0),
      reason: normalizedReason,
      renderPhase: String(runtimeState.renderPhase || ""),
      deferExactAfterSettle: !!runtimeState.deferExactAfterSettle,
    });
    resetExactAfterSettleController(`abort-${normalizedReason}`, generation);
    setDeferExactAfterSettleState(runtimeState, shouldRearmExactRefresh);
    setPendingExactPoliticalFastFrameState(runtimeState, shouldRearmExactRefresh);
    invalidateRenderPasses("political", "exact-after-settle-abort");
    if (shouldRearmExactRefresh) {
      scheduleExactAfterSettleRefresh(runtimeState.adaptiveSettleProfile || getAdaptiveSettleProfile());
    }
    requestRendererRender("exact-after-settle-abort-recover", {
      flush: false,
      fallback: () => {
        if (getContext()) render();
      },
    });
    return false;
  }

  function beginExactAfterSettleControllerSchedule(scheduleStartedAt) {
    return beginExactAfterSettleControllerScheduleState(runtimeState, {
      scheduleStartedAt,
      identity: getExactAfterSettleIdentity(),
    });
  }

  function isExactAfterSettleGenerationCurrent(generation, phase = "") {
    return isExactAfterSettleGenerationCurrentState(runtimeState, generation, phase);
  }

  function isExactAfterSettleControllerActive() {
    return isExactAfterSettleControllerActiveState(runtimeState);
  }

  function invalidateExactAfterSettlePoliticalPass(generation, plan) {
    if (!plan || typeof plan !== "object") return plan;
    if (String(plan.politicalInvalidationReason || "") === "exact-after-settle-political") return plan;
    const politicalInvalidatedAt = Date.now();
    invalidateRenderPasses("political", "exact-after-settle-political");
    const nextPlan = {
      ...plan,
      politicalInvalidationReason: "exact-after-settle-political",
      politicalInvalidatedAt,
    };
    replaceExactAfterSettlePendingPlanState(runtimeState, {
      generation,
      plan: nextPlan,
    });
    return nextPlan;
  }

  function completeScheduledExactAfterSettleRefreshPlan(generation, plan, passStartedAt) {
    if (!isExactAfterSettleGenerationCurrent(generation, "applying")) {
      return false;
    }
    const controller = getExactAfterSettleControllerState();
    if (!isExactAfterSettleIdentityCurrent(controller)) {
      return abortInterruptedExactAfterSettleRefresh("pass-complete-identity-mismatch", generation);
    }
    const applyFinishedAt = nowMs();
    completeExactAfterSettleControllerApplyState(runtimeState, {
      generation,
      applyFinishedAt,
    });
    // Intermediate render requests must keep using the committed frame until
    // every critical pass is ready. Only this current generation can publish.
    setDeferExactAfterSettleState(runtimeState, false);
    recordRenderPerfMetric("settleExactRefreshPasses", Math.max(0, applyFinishedAt - passStartedAt), {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      generation,
      contextBaseRefreshed: !!plan.exactRefreshApplied,
      targetPasses: Array.isArray(plan.exactTargetPasses) ? plan.exactTargetPasses : [],
      passCount: Array.isArray(plan.exactTargetPasses) ? plan.exactTargetPasses.length : 0,
      politicalInvalidationReason: String(plan.politicalInvalidationReason || ""),
      politicalInvalidatedAt: Number(plan.politicalInvalidatedAt || 0),
    });
    return requestRendererRender("exact-after-settle", {
      flush: true,
      fallback: () => render(),
    });
  }

  function prepareExactAfterSettlePassesInSlices(generation, plan) {
    const controller = getExactAfterSettleControllerState();
    if (!isExactAfterSettleGenerationCurrent(generation, "applying")) {
      return false;
    }
    if (!isExactAfterSettleIdentityCurrent(controller)) {
      return abortInterruptedExactAfterSettleRefresh("pass-start-identity-mismatch", generation);
    }
    const transform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
    const definitions = filterExactAfterSettleIdleRenderPassDefinitions(
      getRenderPipelinePassesOwner().getIdleRenderPassDefinitions(),
      plan.exactTargetPasses,
    );
    const timings = {};
    const cache = getRenderPassCacheState();
    const passStartedAt = nowMs();
    if (runtimeState.legacyColorStateDirty) {
      rebuildResolvedColors();
    }

    const enqueueNextPass = (index, activePlan) => {
      if (index >= definitions.length) {
        completeScheduledExactAfterSettleRefreshPlan(generation, activePlan, passStartedAt);
        return;
      }
      const [passName, drawFn] = definitions[index];
      enqueueFrameTask(() => {
        const passStart = nowMs();
        const activeController = getExactAfterSettleControllerState();
        if (!isExactAfterSettleGenerationCurrent(generation, "applying")) return;
        if (runtimeState.renderPhase !== renderPhaseIdle) {
          abortInterruptedExactAfterSettleRefresh(`${passName}-phase-interrupted`, generation);
          return;
        }
        if (!isExactAfterSettleIdentityCurrent(activeController)) {
          abortInterruptedExactAfterSettleRefresh(`${passName}-identity-mismatch`, generation);
          return;
        }
        const preparation = prepareRenderPassAsync(passName);
        if (preparation) {
          Promise.resolve(preparation).then(() => {
            if (isExactAfterSettleGenerationCurrent(generation, "applying")) enqueueNextPass(index, activePlan);
          }).catch(() => abortInterruptedExactAfterSettleRefresh(`${passName}-prepare-failed`, generation));
          return;
        }
        const nextPlan = passName === "political"
          ? invalidateExactAfterSettlePoliticalPass(generation, activePlan)
          : activePlan;
        getRenderPipelinePassesOwner().prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache);
        recordRenderPerfMetric("settleExactRefreshPass", Math.max(0, nowMs() - passStart), {
          activeScenarioId: String(runtimeState.activeScenarioId || ""),
          generation,
          passName,
          index,
          targetPasses: Array.isArray(nextPlan.exactTargetPasses) ? nextPlan.exactTargetPasses : [],
          passCount: definitions.length,
        });
        enqueueNextPass(index + 1, nextPlan);
      }, {
        priority: "high",
        label: `exact-after-settle-pass-${passName}`,
        generation,
        dedupe: true,
        deferOnContinuousInput: false,
      });
    };

    enqueueNextPass(0, plan);
    return true;
  }

  function buildExactAfterSettleRefreshPlan({ profile, scheduleStartedAt, callbackStartedAt }) {
    const resolvedProfile = profile || getAdaptiveSettleProfile();
    const reuseDecision = getContextBaseReuseDecision();
    const forceExactContextBaseRefresh = shouldForceExactContextBaseRefresh(reuseDecision);
    const referenceScale = Number(reuseDecision.referenceTransform?.k);
    const currentScale = Number(runtimeState.zoomTransform?.k);
    const urbanZoomExactRefresh = !!reuseDecision.enabled
      && !!runtimeState.showUrban
      && Array.isArray(runtimeState.urbanData?.features)
      && runtimeState.urbanData.features.length > 0
      && Number.isFinite(referenceScale) && referenceScale > 0
      && Number.isFinite(currentScale) && currentScale > 0
      && referenceScale !== currentScale;
    return createExactAfterSettleRefreshPlan({
      profile: resolvedProfile,
      scheduleStartedAt,
      callbackStartedAt,
      reuseDecision,
      forceExactContextBaseRefresh,
      urbanZoomExactRefresh,
      metricSequenceStartedAt: Math.max(0, Number(runtimeState.renderPerfMetricSequence || 0)),
    });
  }

  function applyExactAfterSettleRefreshPlan(plan) {
    const reuseDecision = plan.reuseDecision || {};
    updateDprStage("idle", { force: true });
    const exactAfterSettleDprPasses = getExactAfterSettleDprRestorePasses(renderPassNames);
    setCanvasSize({
      reason: "exact-after-settle-dpr-restore",
      targetPassesOnDprChange: exactAfterSettleDprPasses,
      targetPassesOnResize: exactAfterSettleDprPasses,
      targetPassesOnCanvasResize: exactAfterSettleDprPasses,
    });
    cancelDeferredContextBaseEnhancement();
    if (plan.forceExactContextBaseRefresh) {
      invalidateRenderPasses(["physicalBase", "contextBase"], "physical-visible-exact");
    } else if (reuseDecision.enabled) {
      recordRenderPerfMetric("contextBaseReuseScaleRatio", 0, {
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
        scaleRatio: reuseDecision.scaleRatio,
        zoomBucket: reuseDecision.zoomBucket,
        referenceZoomBucket: reuseDecision.referenceZoomBucket,
      });
      recordRenderPerfMetric("contextBaseReuseDistancePx", 0, {
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
        distancePx: reuseDecision.distancePx,
        maxDistancePx: reuseDecision.maxDistancePx,
      });
      if (reuseDecision.shouldExactRefresh) {
        invalidateRenderPasses(getPhysicalExactRefreshPasses(), reuseDecision.reason || "context-base-exact");
      } else {
        recordRenderPerfMetric("contextBaseReuseSkipped", 0, {
          activeScenarioId: String(runtimeState.activeScenarioId || ""),
          reason: reuseDecision.reason,
          scaleRatio: reuseDecision.scaleRatio,
          distancePx: reuseDecision.distancePx,
          maxDistancePx: reuseDecision.maxDistancePx,
          zoomBucket: reuseDecision.zoomBucket,
          referenceZoomBucket: reuseDecision.referenceZoomBucket,
          crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
          crossesMinorContourThreshold: !!reuseDecision.crossesMinorContourThreshold,
        });
      }
    }
    // Urban strokes use screen pixels. A reused bitmap needs a fresh context pass
    // after scale changes, independently of the physical-layer refresh policy.
    if (plan.urbanZoomExactRefresh) {
      invalidateRenderPasses("contextBase", "urban-zoom-exact");
    }
    const deferContextBaseEnhancements = shouldDeferContextBaseEnhancementsForExactRefresh(
      reuseDecision,
      plan.forceExactContextBaseRefresh,
    );
    setDeferContextBaseEnhancements(deferContextBaseEnhancements);
    const cache = getRenderPassCacheState();
    const idleRenderPassNames = getRenderPipelinePassesOwner().getIdleRenderPassDefinitions()
      .map(([passName]) => passName);
    // Signature callbacks consume a value snapshot, never the live camera object.
    const signatureTransform = typeof getRenderPassSignature === "function" && runtimeState.zoomTransform != null
      ? cloneRenderZoomTransform(runtimeState.zoomTransform)
      : runtimeState.zoomTransform === undefined ? undefined : null;
    const targetPassPlan = resolveExactAfterSettleTargetPasses({
      renderPassNames,
      idleRenderPassNames,
      // Camera changes can invalidate a signature without setting its dirty bit.
      // Include those passes now so the final paint cannot discover unplanned
      // synchronous geometry work after the cancellable slices have completed.
      dirtyPassNames: getActiveRenderPassNames().filter((passName) => cache.dirty[passName]
        || (typeof getRenderPassSignature === "function"
          && cache.signatures?.[passName] !== getRenderPassSignature(passName, signatureTransform))),
      physicalExactRefreshPasses: getPhysicalExactRefreshPasses(),
      forceExactContextBaseRefresh: plan.forceExactContextBaseRefresh,
      exactRefreshApplied: plan.exactRefreshApplied,
    });
    return {
      ...plan,
      deferContextBaseEnhancements,
      deferredExactTargetPasses: targetPassPlan.deferredExactTargetPasses,
      exactTargetPasses: targetPassPlan.exactTargetPasses,
    };
  }

  function applyScheduledExactAfterSettleRefreshPlan(generation, plan) {
    if (!isExactAfterSettleGenerationCurrent(generation, "scheduled")) {
      return false;
    }
    const applyStartedAt = nowMs();
    const scheduledPlan = {
      ...plan,
      controllerGeneration: generation,
    };
    beginExactAfterSettleControllerApplyState(runtimeState, {
      generation,
      plan: scheduledPlan,
      applyStartedAt,
      identity: getExactAfterSettleIdentity(),
    });
    const appliedPlan = applyExactAfterSettleRefreshPlan(scheduledPlan);
    replaceExactAfterSettlePendingPlanState(runtimeState, {
      generation,
      plan: appliedPlan,
    });
    recordRenderPerfMetric("settleExactRefreshApply", Math.max(0, nowMs() - applyStartedAt), {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      generation,
      contextBaseRefreshed: !!appliedPlan.exactRefreshApplied,
    });
    return prepareExactAfterSettlePassesInSlices(generation, appliedPlan);
  }

  function recordSettleExactRefreshPhaseBreakdown(plan, durationMs) {
    const targetPasses = Array.isArray(plan?.exactTargetPasses) ? plan.exactTargetPasses : [];
    const deferredTargetPasses = Array.isArray(plan?.deferredExactTargetPasses) ? plan.deferredExactTargetPasses : [];
    const metricSequenceStartedAt = Math.max(0, Number(plan?.metricSequenceStartedAt || 0));
    recordRenderPerfMetric("settleExactRefreshPhaseBreakdown", durationMs, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      applyMs: readRenderPerfMetricDuration("settleExactRefreshApply"),
      passesMs: readRenderPerfMetricDuration("settleExactRefreshPasses"),
      waitForPaintMs: readRenderPerfMetricDuration("settleExactRefreshWaitForPaint"),
      finalizeMs: readRenderPerfMetricDuration("settleExactRefreshFinalize"),
      hitCanvasMs: readRenderPerfMetricDuration("buildHitCanvas", metricSequenceStartedAt),
      metricSequenceStartedAt,
      targetPasses,
      targetPassCount: targetPasses.length,
      deferredTargetPasses,
      deferredTargetPassCount: deferredTargetPasses.length,
      contextBaseRefreshed: !!plan?.exactRefreshApplied,
    });
  }

  function finalizeExactAfterSettleRefreshPlan(plan) {
    const reuseDecision = plan.reuseDecision || {};
    const resolvedProfile = plan.resolvedProfile || getAdaptiveSettleProfile();
    flushPendingScenarioChunkRefreshAfterExact();
    const finishedAt = nowMs();
    const durationMs = Math.max(0, finishedAt - plan.startedAt);
    const finalSharpnessMs = Math.max(0, finishedAt - Number(runtimeState.zoomGestureEndedAt || plan.startedAt));
    recordRenderPerfMetric("settleExactRefresh", durationMs, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      contextBaseRefreshed: plan.exactRefreshApplied,
      reason: plan.forceExactContextBaseRefresh ? "physical-visible-exact" : reuseDecision.reason,
      scaleRatio: reuseDecision.scaleRatio,
      distancePx: reuseDecision.distancePx,
      maxDistancePx: reuseDecision.maxDistancePx,
      zoomBucket: reuseDecision.zoomBucket,
      referenceZoomBucket: reuseDecision.referenceZoomBucket,
      crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
      crossesMinorContourThreshold: !!reuseDecision.crossesMinorContourThreshold,
      scaleDelta: Number(runtimeState.zoomGestureScaleDelta || resolvedProfile.scaleDelta || 0),
      settleDurationMs: Number(resolvedProfile.settleDurationMs || 0),
      exactQuietWindowMs: Number(resolvedProfile.exactQuietWindowMs || 0),
      settleWindowElapsedMs: Number(plan.settleWindowElapsedMs || 0),
      finalSharpnessMs: Number(finalSharpnessMs || 0),
    });
    if (plan.exactRefreshApplied) {
      recordRenderPerfMetric("contextBaseExactRefresh", Number(runtimeState.renderPerfMetrics?.drawContextBasePass?.durationMs || durationMs), {
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
        reason: plan.forceExactContextBaseRefresh ? "physical-visible-exact" : reuseDecision.reason,
        scaleRatio: reuseDecision.scaleRatio,
        distancePx: reuseDecision.distancePx,
        maxDistancePx: reuseDecision.maxDistancePx,
        zoomBucket: reuseDecision.zoomBucket,
        referenceZoomBucket: reuseDecision.referenceZoomBucket,
        crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
        crossesMinorContourThreshold: !!reuseDecision.crossesMinorContourThreshold,
      });
    }
    if (plan.deferContextBaseEnhancements) {
      scheduleDeferredContextBaseEnhancements();
    }
    scheduleDeferredExactContextRefresh(plan);
  }

  function finalizePendingExactAfterSettleRefreshAfterPaint() {
    const controller = getExactAfterSettleControllerState();
    if (!controller || typeof controller !== "object" || String(controller.phase || "") !== "awaiting-paint") {
      return false;
    }
    const generation = Number(controller.generation || 0);
    if (!isExactAfterSettleIdentityCurrent(controller)) {
      return abortInterruptedExactAfterSettleRefresh("identity-mismatch", generation);
    }
    const plan = controller.pendingPlan;
    if (!plan || typeof plan !== "object") {
      return abortInterruptedExactAfterSettleRefresh("missing-plan", generation);
    }
    const finalizeStartedAt = nowMs();
    beginExactAfterSettleControllerFinalizeState(runtimeState, generation);
    recordRenderPerfMetric("settleExactRefreshWaitForPaint", Math.max(0, finalizeStartedAt - Number(controller.applyFinishedAt || controller.applyStartedAt || controller.startedAt || finalizeStartedAt)), {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      generation,
    });
    finalizeExactAfterSettleRefreshPlan(plan);
    recordRenderPerfMetric("settleExactRefreshFinalize", Math.max(0, nowMs() - finalizeStartedAt), {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      generation,
    });
    recordSettleExactRefreshPhaseBreakdown(plan, Math.max(0, nowMs() - Number(plan.startedAt || finalizeStartedAt)));
    resetExactAfterSettleController("finalized", generation);
    return true;
  }

  function abortPendingExactAfterSettleRefreshAfterPaint(reason = "exact-compose-failed") {
    const controller = getExactAfterSettleControllerState();
    if (!controller || typeof controller !== "object" || String(controller.phase || "") !== "awaiting-paint") {
      return false;
    }
    const generation = Number(controller.generation || 0);
    recordRenderPerfMetric("settleExactRefreshAbortAfterPaintFailure", 0, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      generation,
      reason: String(reason || "exact-compose-failed"),
      controllerPhase: String(controller.phase || ""),
      deferExactAfterSettle: !!runtimeState.deferExactAfterSettle,
    });
    resetExactAfterSettleController(`abort-${reason}`, generation);
    setDeferExactAfterSettleState(runtimeState, false);
    setPendingExactPoliticalFastFrameState(runtimeState, false);
    invalidateRenderPasses("political", "exact-after-settle-abort");
    requestRendererRender("exact-after-settle-abort-recover", {
      flush: false,
      fallback: () => {
        if (getContext()) render();
      },
    });
    return true;
  }

  function cancelDeferredExactContextRefresh() {
    deferredExactContextRefreshVersion += 1;
    cancelDeferredWork(deferredExactContextRefreshHandle);
    deferredExactContextRefreshHandle = null;
    deferredExactContextRefreshTaskHandles.forEach((handle) => {
      if (handle && typeof handle.cancel === "function") {
        handle.cancel();
      }
    });
    deferredExactContextRefreshTaskHandles.clear();
  }

  function getDeferredExactContextTargetPasses(plan = {}) {
    const cache = getRenderPassCacheState();
    return resolveDeferredExactContextTargetPasses({
      plan,
      dirtyPassNames: renderPassNames.filter((passName) => cache.dirty?.[passName]),
      idleRenderPassNames: getRenderPipelinePassesOwner().getIdleRenderPassDefinitions()
        .map(([passName]) => passName),
    });
  }

  function isDeferredExactContextRefreshCurrent(refreshVersion, plan = {}) {
    if (Number(refreshVersion || 0) !== Number(deferredExactContextRefreshVersion || 0)) return false;
    const identity = plan && typeof plan === "object" ? plan.deferredExactContextIdentity : null;
    if (identity && typeof identity === "object" && !isExactAfterSettleIdentityCurrent(identity)) return false;
    return true;
  }

  function prepareDeferredExactContextPassesInSlices(passNames, plan = {}, refreshVersion = deferredExactContextRefreshVersion) {
    const targetPasses = Array.isArray(passNames) ? passNames.filter(Boolean) : [];
    if (!targetPasses.length) return false;
    if (!isDeferredExactContextRefreshCurrent(refreshVersion, plan)) return false;
    const transform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
    const definitions = filterExactAfterSettleIdleRenderPassDefinitions(
      getRenderPipelinePassesOwner().getIdleRenderPassDefinitions(),
      targetPasses,
    );
    const cache = getRenderPassCacheState();
    const timings = {};
    const startedAt = nowMs();

    const enqueueNextPass = (index) => {
      if (!isDeferredExactContextRefreshCurrent(refreshVersion, plan)) return;
      if (index >= definitions.length) {
        recordRenderPerfMetric("deferredExactContextRefresh", Math.max(0, nowMs() - startedAt), {
          activeScenarioId: String(runtimeState.activeScenarioId || ""),
          targetPasses,
          passCount: targetPasses.length,
          sourceGeneration: Number(plan.controllerGeneration || 0),
        });
        requestRendererRender("deferred-exact-context-refresh", {
          flush: false,
          fallback: () => render(),
        });
        return;
      }
      const [passName, drawFn] = definitions[index];
      let taskHandle = null;
      taskHandle = enqueueFrameTask(() => {
        if (taskHandle) {
          deferredExactContextRefreshTaskHandles.delete(taskHandle);
        }
        const passStart = nowMs();
        if (!isDeferredExactContextRefreshCurrent(refreshVersion, plan)) return;
        if (runtimeState.renderPhase !== renderPhaseIdle || runtimeState.deferExactAfterSettle) {
          if (isDeferredExactContextRefreshCurrent(refreshVersion, plan)) {
            scheduleDeferredExactContextRefresh(plan);
          }
          return;
        }
        getRenderPipelinePassesOwner().prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache);
        recordRenderPerfMetric("deferredExactContextRefreshPass", Math.max(0, nowMs() - passStart), {
          activeScenarioId: String(runtimeState.activeScenarioId || ""),
          passName,
          index,
          targetPasses,
        });
        enqueueNextPass(index + 1);
      }, {
        priority: "high",
        label: `deferred-exact-context-pass-${passName}`,
        generation: Number(plan.controllerGeneration || 0),
        dedupe: true,
        deferOnContinuousInput: false,
      });
      if (taskHandle) {
        deferredExactContextRefreshTaskHandles.add(taskHandle);
      }
    };
    enqueueNextPass(0);
    return true;
  }

  function scheduleDeferredExactContextRefresh(plan = {}) {
    const targetPasses = getDeferredExactContextTargetPasses(plan);
    if (!targetPasses.length) return false;
    cancelDeferredExactContextRefresh();
    const refreshVersion = Number(deferredExactContextRefreshVersion || 0);
    const scheduledPlan = plan.deferredExactContextIdentity
      ? plan
      : {
          ...plan,
          deferredExactContextIdentity: getExactAfterSettleIdentity(),
        };
    deferredExactContextRefreshHandle = scheduleDeferredWork(() => {
      deferredExactContextRefreshHandle = null;
      if (!isDeferredExactContextRefreshCurrent(refreshVersion, scheduledPlan)) return;
      if (runtimeState.renderPhase !== renderPhaseIdle || runtimeState.deferExactAfterSettle) {
        if (isDeferredExactContextRefreshCurrent(refreshVersion, scheduledPlan)) {
          scheduleDeferredExactContextRefresh(scheduledPlan);
        }
        return;
      }
      prepareDeferredExactContextPassesInSlices(targetPasses, scheduledPlan, refreshVersion);
    }, {
      timeout: exactContextRefreshDelayMs,
    });
    recordRenderPerfMetric("deferredExactContextRefreshScheduled", 0, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      targetPasses,
      passCount: targetPasses.length,
      sourceGeneration: Number(scheduledPlan.controllerGeneration || 0),
    });
    return true;
  }

  function cancelExactAfterSettleRefresh({ clearDefer = true } = {}) {
    cancelDeferredExactContextRefresh();
    cancelDeferredWork(runtimeState.exactAfterSettleHandle);
    setExactAfterSettleHandleState(runtimeState, null);
    resetExactAfterSettleController(clearDefer ? "cancel" : "reschedule");
    if (clearDefer) {
      setDeferExactAfterSettleState(runtimeState, false);
      setPendingExactPoliticalFastFrameState(runtimeState, false);
    }
  }

  function enqueueExactAfterSettleSegment(generation, label, task) {
    return enqueueFrameTask(() => {
      const startedAt = nowMs();
      if (!isExactAfterSettleGenerationCurrent(generation, "scheduled")) return;
      if (!runtimeState.deferExactAfterSettle) return;
      if (runtimeState.renderPhase !== renderPhaseIdle) {
        abortInterruptedExactAfterSettleRefresh(`${label}-phase-interrupted`, generation);
        return;
      }
      if (!isExactAfterSettleIdentityCurrent(getExactAfterSettleControllerState())) {
        abortInterruptedExactAfterSettleRefresh(`${label}-identity-mismatch`, generation);
        return;
      }
      task();
      recordRenderPerfMetric(`settleExactRefresh${label}`, Math.max(0, nowMs() - startedAt), {
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
        generation,
      });
    }, {
      priority: "high",
      label: `exact-after-settle-${label}`,
      generation,
      dedupe: true,
      deferOnContinuousInput: false,
    });
  }

  function scheduleExactAfterSettleRefresh(profile = runtimeState.adaptiveSettleProfile || getAdaptiveSettleProfile()) {
    cancelExactAfterSettleRefresh({ clearDefer: false });
    const scheduleStartedAt = nowMs();
    const generation = Number(beginExactAfterSettleControllerSchedule(scheduleStartedAt) || 0);
    const resolvedProfile = profile || getAdaptiveSettleProfile();
    setExactAfterSettleHandleState(runtimeState, {
      type: "timeout",
      id: globalThis.setTimeout(() => {
        setExactAfterSettleHandleState(runtimeState, null);
        if (!isExactAfterSettleGenerationCurrent(generation, "scheduled")) return;
        if (!runtimeState.deferExactAfterSettle) {
          resetExactAfterSettleController("defer-cleared", generation);
          return;
        }
        if (runtimeState.renderPhase !== renderPhaseIdle) {
          scheduleExactAfterSettleRefresh(resolvedProfile);
          return;
        }
        assignExactAfterSettleIdentity();
        enqueueExactAfterSettleSegment(generation, "Prepare", () => {
          const plan = buildExactAfterSettleRefreshPlan({
            profile: resolvedProfile,
            scheduleStartedAt,
            callbackStartedAt: nowMs(),
          });
          enqueueExactAfterSettleSegment(generation, "Apply", () => {
            applyScheduledExactAfterSettleRefreshPlan(generation, plan);
          });
        });
      }, resolvedProfile.exactQuietWindowMs),
    });
  }

  return {
    getExactAfterSettleControllerState,
    getExactAfterSettleIdentity,
    isExactAfterSettleIdentityCurrent,
    resetExactAfterSettleController,
    beginExactAfterSettleControllerSchedule,
    isExactAfterSettleGenerationCurrent,
    isExactAfterSettleControllerActive,
    finalizePendingExactAfterSettleRefreshAfterPaint,
    abortPendingExactAfterSettleRefreshAfterPaint,
    cancelExactAfterSettleRefresh,
    scheduleExactAfterSettleRefresh,
  };
}

export { createExactAfterSettleScheduler };
import { cloneRenderZoomTransform } from "../renderer/render_transform_reuse_policy_owner.js";
