import { POST_READY_IDLE_QUIET_MS } from "./post_ready_scheduler.js";
import { patchScenarioChunkLoadState } from "../core/state/actions/scenario_chunk_runtime_actions.js";

const DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY = "post-ready-detail-promotion-political-reconcile";

const REQUIRED_HELPERS = Object.freeze([
  "buildInteractionInfrastructureAfterStartup",
  "checkpointBootMetric",
  "completeBootSequenceLogging",
  "ensureActiveScenarioBundleHydrated",
  "ensureContextLayerDataReady",
  "ensureFullLocalizationDataReady",
  "reconcileDetailPromotionPoliticalPass",
  "requestMainRender",
  "scheduleDeferredDetailPromotion",
  "shouldFastTrackScenarioHydration",
]);

const REQUIRED_EFFECTS = Object.freeze([
  "commitUiHydrationState",
  "getStartupUiBootstrapPromise",
]);

function getRequiredFunction(source, name, scope = "helpers") {
  const value = source?.[name];
  if (typeof value !== "function") {
    throw new Error(`createStartupReadyHandoffOwner requires ${scope}.${name}.`);
  }
  return value;
}

function getConsoleWarn(helpers) {
  return typeof helpers?.consoleWarn === "function"
    ? helpers.consoleWarn
    : console.warn.bind(console);
}

function normalizeReadyReason(reason, fallback = "post-ready") {
  return String(reason || fallback).trim() || fallback;
}

export function createStartupReadyHandoffOwner({
  runtimeState,
  postReadyScheduler,
  effects = {},
  helpers = {},
} = {}) {
  const targetRuntime = runtimeState;
  if (!targetRuntime || typeof targetRuntime !== "object") {
    throw new Error("createStartupReadyHandoffOwner requires runtimeState.");
  }
  if (!postReadyScheduler || typeof postReadyScheduler.scheduleTask !== "function") {
    throw new Error("createStartupReadyHandoffOwner requires postReadyScheduler.scheduleTask.");
  }

  for (const helperName of REQUIRED_HELPERS) {
    getRequiredFunction(helpers, helperName);
  }
  for (const effectName of REQUIRED_EFFECTS) {
    getRequiredFunction(effects, effectName, "effects");
  }

  const buildInteractionInfrastructureAfterStartup = helpers.buildInteractionInfrastructureAfterStartup;
  const checkpointBootMetric = helpers.checkpointBootMetric;
  const commitUiHydrationState = effects.commitUiHydrationState;
  const getStartupUiBootstrapPromise = effects.getStartupUiBootstrapPromise;
  const completeBootSequenceLogging = helpers.completeBootSequenceLogging;
  const ensureActiveScenarioBundleHydrated = helpers.ensureActiveScenarioBundleHydrated;
  const ensureContextLayerDataReady = helpers.ensureContextLayerDataReady;
  const ensureFullLocalizationDataReady = helpers.ensureFullLocalizationDataReady;
  const reconcileDetailPromotionPoliticalPass = helpers.reconcileDetailPromotionPoliticalPass;
  const requestMainRender = helpers.requestMainRender;
  const scheduleDeferredDetailPromotion = helpers.scheduleDeferredDetailPromotion;
  const shouldFastTrackScenarioHydration = helpers.shouldFastTrackScenarioHydration;
  const consoleWarn = getConsoleWarn(helpers);

  let postReadyContextWarmupScheduled = false;
  let postReadyHydrationScheduled = false;
  let lifecycleEpoch = 0;

  function scopedTaskOptions(options = {}) {
    const epoch = lifecycleEpoch;
    const scenarioId = targetRuntime.activeScenarioId;
    const requestId = targetRuntime.currentScenarioApplyRequestId;
    return {
      // Operational cancellation limits, not input-latency performance budgets.
      maxWaitMs: 120_000,
      maxRunMs: 120_000,
      isCurrent: () => epoch === lifecycleEpoch
        && targetRuntime.activeScenarioId === scenarioId
        && targetRuntime.currentScenarioApplyRequestId === requestId,
      ...options,
    };
  }

  function reset(reason = "reset") {
    lifecycleEpoch += 1;
    postReadyScheduler.clearTask?.("post-ready-context-warmup");
    postReadyScheduler.clearTask?.("post-ready-contour-warmup");
    postReadyContextWarmupScheduled = false;
    postReadyHydrationScheduled = false;
    return {
      reason: normalizeReadyReason(reason, "reset"),
      postReadyContextWarmupScheduled,
      postReadyHydrationScheduled,
    };
  }

  function schedulePostReadyHydration() {
    if (postReadyHydrationScheduled) {
      return;
    }
    postReadyHydrationScheduled = true;
    postReadyScheduler.scheduleTask("post-ready-localization-hydration", () => (
      ensureFullLocalizationDataReady({ reason: "post-ready-idle", renderNow: true }).catch((error) => {
        consoleWarn("[boot] Deferred full localization hydration failed during idle scheduling.", error);
        return null;
      })
    ), {
      timeout: 2200,
      delayMs: 1200,
      retryDelayMs: 600,
    });
    postReadyScheduler.scheduleTask("post-ready-scenario-hydration", () => (
      ensureActiveScenarioBundleHydrated({ reason: "post-ready-idle", renderNow: true }).catch((error) => {
        consoleWarn("[boot] Deferred full scenario hydration failed during idle scheduling.", error);
        return null;
      })
    ), {
      timeout: 4800,
      delayMs: shouldFastTrackScenarioHydration() ? 300 : 4200,
      retryDelayMs: shouldFastTrackScenarioHydration() ? 450 : 900,
    });
  }

  function schedulePostReadyPoliticalReconcileTask(reason = "detail-promotion-political-reconcile") {
    const normalizedReason = normalizeReadyReason(reason, "detail-promotion-political-reconcile");
    postReadyScheduler.scheduleTask(DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY, () => {
      if (!targetRuntime.detailPromotionCompleted) {
        schedulePostReadyPoliticalReconcileTask(normalizedReason);
        return false;
      }
      const requested = reconcileDetailPromotionPoliticalPass(normalizedReason);
      if (!requested) {
        schedulePostReadyPoliticalReconcileTask(normalizedReason);
      }
      return requested;
    }, {
      timeout: 1200,
      delayMs: 0,
      retryDelayMs: 320,
      idleQuietMs: POST_READY_IDLE_QUIET_MS,
    });
    return true;
  }

  function schedulePostReadyPoliticalReconcile(reason = "detail-promotion-political-reconcile") {
    if (!targetRuntime.detailPromotionCompleted) {
      return false;
    }
    return schedulePostReadyPoliticalReconcileTask(reason);
  }

  function flushPendingScenarioChunkRefreshAfterReady(reason = "post-ready") {
    if (typeof targetRuntime.scheduleScenarioChunkRefreshFn !== "function") {
      return;
    }
    const loadState = targetRuntime.runtimeChunkLoadState;
    const normalizedReason = normalizeReadyReason(reason, "post-ready");
    const shouldSeedFirstReadyFlush = !!(
      loadState
      && Number(loadState.selectionVersion || 0) <= 0
      && !String(loadState.pendingReason || "").trim()
      && !loadState.pendingPromotion
    );
    if (shouldSeedFirstReadyFlush) {
      patchScenarioChunkLoadState(targetRuntime, {
        pendingReason: normalizedReason,
        pendingDelayMs: 0,
      });
    }
    targetRuntime.scheduleScenarioChunkRefreshFn({
      reason: normalizedReason,
      delayMs: 0,
      flushPending: true,
    });
  }

  function scheduleReadyPostBootWork(renderDispatcher, reason = "ready-state") {
    checkpointBootMetric("time-to-interactive");
    checkpointBootMetric("first-interactive");
    completeBootSequenceLogging();
    flushPendingScenarioChunkRefreshAfterReady(reason);
    scheduleDeferredDetailPromotion(renderDispatcher);
    startDeferredFullInteractionInfrastructureBuild(reason);
    schedulePostReadyHydration();
    schedulePostReadyDeferredContextWarmup();
    schedulePostReadyVisualWarmup();
  }

  function beginUiHydration() {
    return commitUiHydrationState({
      status: "pending",
      error: "",
      updatedAt: Date.now(),
    });
  }

  function markUiHydrationReady() {
    return commitUiHydrationState({
      status: "ready",
      error: "",
      updatedAt: Date.now(),
    });
  }

  function observePostReadyUiBootstrap({
    runPostScenarioUiReplay,
    handleUiBootstrapReady,
    handleUiBootstrapFailure,
  } = {}) {
    const startupUiBootstrapPromise = getStartupUiBootstrapPromise();
    if (!startupUiBootstrapPromise || typeof startupUiBootstrapPromise.then !== "function") {
      return Promise.resolve({ ready: false, skipped: true, error: null });
    }
    if (typeof runPostScenarioUiReplay !== "function") {
      throw new TypeError("observePostReadyUiBootstrap requires runPostScenarioUiReplay.");
    }
    if (typeof handleUiBootstrapFailure !== "function") {
      throw new TypeError("observePostReadyUiBootstrap requires handleUiBootstrapFailure.");
    }
    if (typeof handleUiBootstrapReady !== "function") {
      throw new TypeError("observePostReadyUiBootstrap requires handleUiBootstrapReady.");
    }
    return Promise.resolve(startupUiBootstrapPromise)
      .then(async () => {
        markUiHydrationReady();
        runPostScenarioUiReplay({
          full: true,
          reason: "post-ready-ui-bootstrap",
          scenarioId: String(targetRuntime.activeScenarioId || "").trim(),
          scenarioApplyRequestId: Math.max(0, Number(targetRuntime.currentScenarioApplyRequestId || 0)),
        });
        await handleUiBootstrapReady();
        return { ready: true, skipped: false, error: null };
      })
      .catch(async (error) => {
        commitUiHydrationState({
          status: "failed",
          error: error?.message || String(error || "UI hydration failed."),
          updatedAt: Date.now(),
        });
        await handleUiBootstrapFailure(error);
        return { ready: false, skipped: false, error };
      });
  }

  function startDeferredFullInteractionInfrastructureBuild(reason = "post-ready-full-interaction") {
    postReadyScheduler.scheduleTask("post-ready-full-interaction-infra", () => {
      if (targetRuntime.detailDeferred && !targetRuntime.detailPromotionCompleted) {
        startDeferredFullInteractionInfrastructureBuild(`${reason}-after-detail`);
        return false;
      }
      return buildInteractionInfrastructureAfterStartup({
        chunked: true,
        buildHitCanvas: false,
        mode: "full",
      }).catch((error) => {
        consoleWarn(`[boot] Deferred full interaction infrastructure build failed. reason=${reason}`, error);
      });
    }, {
      timeout: 1200,
      delayMs: 180,
      retryDelayMs: 320,
      idleQuietMs: POST_READY_IDLE_QUIET_MS,
    });
  }

  function schedulePostReadyVisualWarmup() {
    const textureMode = String(targetRuntime.styleConfig?.texture?.mode || "none").trim().toLowerCase();
    const dayNightEnabled = !!targetRuntime.styleConfig?.dayNight?.enabled;
    if (textureMode === "none" && !dayNightEnabled) {
      return;
    }
    postReadyScheduler.scheduleTask("post-ready-visual-warmup", async () => {
      if (!targetRuntime.bootBlocking) {
        requestMainRender("post-ready-visual-warmup");
      }
    }, {
      timeout: 1200,
      delayMs: 900,
      retryDelayMs: 320,
      idleQuietMs: POST_READY_IDLE_QUIET_MS,
    });
  }

  function schedulePostReadyDeferredContextWarmup() {
    if (targetRuntime.bootBlocking || postReadyContextWarmupScheduled) {
      return;
    }
    const requestedLayerNames = [];
    const requestedContourLayerNames = [];
    if (targetRuntime.showRivers) {
      requestedLayerNames.push("rivers");
    }
    if (targetRuntime.showUrban) {
      requestedLayerNames.push("urban");
    }
    if (targetRuntime.showPhysical) {
      requestedLayerNames.push("physical-set");
      requestedContourLayerNames.push("physical-contours-set");
    }
    const shouldWarmCities =
      targetRuntime.showCityPoints !== false
      && targetRuntime.baseCityDataState === "idle"
      && typeof targetRuntime.ensureBaseCityDataFn === "function";
    if (!requestedLayerNames.length && !shouldWarmCities) {
      return;
    }
    postReadyContextWarmupScheduled = true;
    postReadyScheduler.scheduleTask("post-ready-context-warmup", async (task) => {
      task.throwIfStale();
      if (targetRuntime.bootBlocking) {
        return;
      }
      const tasks = [];
      if (requestedLayerNames.length) {
        tasks.push(ensureContextLayerDataReady(requestedLayerNames, {
          reason: "post-ready",
          renderNow: false,
        }));
      }
      if (shouldWarmCities && targetRuntime.baseCityDataState === "idle" && typeof targetRuntime.ensureBaseCityDataFn === "function") {
        tasks.push(targetRuntime.ensureBaseCityDataFn({ reason: "post-ready", renderNow: false }));
      }
      await task.waitFor(Promise.allSettled(tasks));
      task.commit(() => requestMainRender("post-ready-context-warmup"));
    }, scopedTaskOptions({
      timeout: 1600,
      delayMs: 900,
      retryDelayMs: 420,
      idleQuietMs: POST_READY_IDLE_QUIET_MS,
    }));
    if (requestedContourLayerNames.length) {
      postReadyScheduler.scheduleTask("post-ready-contour-warmup", async (task) => {
        task.throwIfStale();
        if (targetRuntime.bootBlocking) {
          return;
        }
        await task.yield();
        await task.waitFor(ensureContextLayerDataReady(requestedContourLayerNames, {
          reason: "post-ready-contours",
          renderNow: false,
        }));
        task.commit(() => requestMainRender("post-ready-contours"));
      }, scopedTaskOptions({
        timeout: 1800,
        delayMs: 1400,
        retryDelayMs: 420,
        idleQuietMs: POST_READY_IDLE_QUIET_MS,
      }));
    }
  }

  return Object.freeze({
    beginUiHydration,
    reset,
    flushPendingScenarioChunkRefreshAfterReady,
    observePostReadyUiBootstrap,
    markUiHydrationReady,
    scheduleReadyPostBootWork,
    startDeferredFullInteractionInfrastructureBuild,
    schedulePostReadyHydration,
    schedulePostReadyPoliticalReconcile,
    schedulePostReadyDeferredContextWarmup,
    schedulePostReadyVisualWarmup,
  });
}
