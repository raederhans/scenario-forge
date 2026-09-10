import { POST_READY_IDLE_QUIET_MS } from "./post_ready_scheduler.js";
import { patchScenarioChunkLoadState } from "../core/state/actions/scenario_chunk_runtime_actions.js";
import { normalizePhysicalStyleConfig } from "../core/state_defaults.js";

const DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY = "post-ready-detail-promotion-political-reconcile";

const REQUIRED_HELPERS = Object.freeze([
  "buildInteractionInfrastructureAfterStartup",
  "checkpointBootMetric",
  "completeBootSequenceLogging",
  "ensureActiveScenarioBundleHydrated",
  "ensureBaseCityDataReady",
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
  const ensureBaseCityDataReady = helpers.ensureBaseCityDataReady;
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
  let hydrationScenarioId;
  let hydrationRequestId;
  let hydrationScenarioApplyEpoch;

  function scopedTaskOptions(options = {}, { scenarioScoped = true } = {}) {
    const epoch = lifecycleEpoch;
    const scenarioId = targetRuntime.activeScenarioId;
    const requestId = targetRuntime.currentScenarioApplyRequestId;
    const scenarioApplyEpoch = targetRuntime.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0;
    return {
      // Operational cancellation limits, not input-latency performance budgets.
      maxWaitMs: 120_000,
      maxRunMs: 120_000,
      isCurrent: () => epoch === lifecycleEpoch
        && (!scenarioScoped || (targetRuntime.activeScenarioId === scenarioId
        && targetRuntime.currentScenarioApplyRequestId === requestId
        && (targetRuntime.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0) === scenarioApplyEpoch)),
      ...options,
    };
  }

  function reset(reason = "reset") {
    lifecycleEpoch += 1;
    for (const key of ["post-ready-localization-hydration", "post-ready-scenario-hydration",
      "post-ready-full-interaction-infra", "post-ready-visual-warmup", DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY]) {
      postReadyScheduler.clearTask?.(key);
    }
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
    if (postReadyHydrationScheduled && hydrationScenarioId === targetRuntime.activeScenarioId
      && hydrationRequestId === targetRuntime.currentScenarioApplyRequestId
      && hydrationScenarioApplyEpoch === (targetRuntime.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0)) {
      return;
    }
    const scheduleLocalization = !postReadyHydrationScheduled;
    postReadyHydrationScheduled = true;
    hydrationScenarioId = targetRuntime.activeScenarioId;
    hydrationRequestId = targetRuntime.currentScenarioApplyRequestId;
    hydrationScenarioApplyEpoch = targetRuntime.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0;
    if (scheduleLocalization) postReadyScheduler.scheduleTask("post-ready-localization-hydration", (task) => task.waitFor(
      ensureFullLocalizationDataReady({ reason: "post-ready-idle", renderNow: true, taskContext: task }).catch((error) => {
        task.throwIfStale();
        consoleWarn("[boot] Deferred full localization hydration failed during idle scheduling.", error);
        return null;
      })
    ), scopedTaskOptions({
      timeout: 2200,
      delayMs: 1200,
      retryDelayMs: 600,
    }, { scenarioScoped: false }));
    postReadyScheduler.scheduleTask("post-ready-scenario-hydration", (task) => task.waitFor(
      ensureActiveScenarioBundleHydrated({ reason: "post-ready-idle", renderNow: true, taskContext: task }).catch((error) => {
        task.throwIfStale();
        consoleWarn("[boot] Deferred full scenario hydration failed during idle scheduling.", error);
        return null;
      })
    ), scopedTaskOptions({
      timeout: 4800,
      delayMs: shouldFastTrackScenarioHydration() ? 300 : 4200,
      retryDelayMs: shouldFastTrackScenarioHydration() ? 450 : 900,
    }));
  }

  function schedulePostReadyPoliticalReconcileTask(reason = "detail-promotion-political-reconcile") {
    const normalizedReason = normalizeReadyReason(reason, "detail-promotion-political-reconcile");
    postReadyScheduler.scheduleTask(DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY, async (task) => {
      task.throwIfStale();
      while (!targetRuntime.detailPromotionCompleted
        || !task.commit(() => reconcileDetailPromotionPoliticalPass(normalizedReason))) {
        await task.yield();
      }
      return true;
    }, scopedTaskOptions({
      canStart: () => !!targetRuntime.detailPromotionCompleted,
      timeout: 1200,
      delayMs: 0,
      retryDelayMs: 320,
      idleQuietMs: POST_READY_IDLE_QUIET_MS,
    }));
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
    const epoch = lifecycleEpoch;
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
        if (epoch !== lifecycleEpoch) return { ready: false, skipped: true, error: null };
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
        if (epoch !== lifecycleEpoch) return { ready: false, skipped: true, error: null };
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
    postReadyScheduler.scheduleTask("post-ready-full-interaction-infra", (task) => {
      task.throwIfStale();
      return buildInteractionInfrastructureAfterStartup({
        taskContext: task,
        chunked: true,
        buildHitCanvas: false,
        mode: "full",
      }).catch((error) => {
        task.throwIfStale();
        consoleWarn(`[boot] Deferred full interaction infrastructure build failed. reason=${reason}`, error);
      });
    }, scopedTaskOptions({
      canStart: () => !targetRuntime.detailDeferred || !!targetRuntime.detailPromotionCompleted,
      timeout: 1200,
      delayMs: 180,
      retryDelayMs: 320,
      idleQuietMs: POST_READY_IDLE_QUIET_MS,
    }));
  }

  function schedulePostReadyVisualWarmup() {
    const textureMode = String(targetRuntime.styleConfig?.texture?.mode || "none").trim().toLowerCase();
    const dayNightEnabled = !!targetRuntime.styleConfig?.dayNight?.enabled;
    if (textureMode === "none" && !dayNightEnabled) {
      return;
    }
    postReadyScheduler.scheduleTask("post-ready-visual-warmup", async (task) => {
      task.throwIfStale();
      if (!targetRuntime.bootBlocking) {
        task.commit(() => requestMainRender("post-ready-visual-warmup"));
      }
    }, scopedTaskOptions({
      timeout: 1200,
      delayMs: 900,
      retryDelayMs: 320,
      idleQuietMs: POST_READY_IDLE_QUIET_MS,
    }, { scenarioScoped: false }));
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
      if (normalizePhysicalStyleConfig(targetRuntime.styleConfig?.physical).mode !== "atlas_only") {
        requestedContourLayerNames.push("physical-contours-set");
      }
    }
    const shouldWarmCities =
      targetRuntime.showCityPoints !== false
      && targetRuntime.baseCityDataState === "idle";
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
          taskContext: task,
          reason: "post-ready",
          renderNow: false,
        }));
      }
      if (shouldWarmCities && targetRuntime.baseCityDataState === "idle") {
        tasks.push(ensureBaseCityDataReady({ reason: "post-ready", renderNow: false, taskContext: task }));
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
        await task.yield();
        if (targetRuntime.bootBlocking || !targetRuntime.showPhysical
          || normalizePhysicalStyleConfig(targetRuntime.styleConfig?.physical).mode === "atlas_only") {
          return;
        }
        await task.waitFor(ensureContextLayerDataReady(requestedContourLayerNames, {
          taskContext: task,
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
