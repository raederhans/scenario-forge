// App entry point (Phase 13)
import { normalizeCityLayerStyleConfig, state } from "./core/state.js";
import { createStartupBootOverlayController } from "./bootstrap/startup_boot_overlay.js";
import { createStartupDataPipelineOwner } from "./bootstrap/startup_data_pipeline.js";
import {
  createRenderDispatcher,
  getBootLanguage,
  getDeferredPromotionDelay,
  hydrateLanguage,
  initLongAnimationFrameObserver,
  normalizeBatchFillScopes,
  persistViewSettings,
  postStartupSupportKeyUsageReport,
  warnOnStartupBundleIntegrity,
} from "./bootstrap/startup_bootstrap_support.js";
import {
  loadDeferredDetailBundle,
} from "./core/data_loader.js";
import { refreshScenarioDataHealth } from "./core/scenario_data_health.js";
import {
  buildInteractionInfrastructureAfterStartup,
  initMap,
  invalidateContextLayerVisualStateBatch,
  refreshMapDataForScenarioApply,
  setMapData,
  render,
} from "./core/map_renderer.js";
import {
  loadScenarioBundle,
} from "./core/scenario_resources.js";
import { bindRenderBoundary, flushRenderBoundary, requestRender } from "./core/render_boundary.js";
import { applyScenarioBundleCommand } from "./core/scenario_dispatcher.js";
import { initPresetState } from "./core/preset_state.js";
import { initTranslations } from "./ui/i18n.js";
import { initToast } from "./ui/toast.js";
import { bindBeforeUnload } from "./core/dirty_state.js";

function requestMainRender(reason = "", { flush = false } = {}) {
  return flush ? flushRenderBoundary(reason) : requestRender(reason);
}

let deferredPromotionHandle = null;
let milsymbolLoadPromise = null;
let deferredUiBootstrapPromise = null;
let postReadyContextWarmupScheduled = false;
let postReadyHydrationScheduled = false;
let postReadyTaskHandles = new Map();
let postReadyTaskEpoch = 0;
let forcedStartupReadonlyInfraRetryCount = 0;
const MAX_FORCED_STARTUP_INFRA_RETRIES = 2;

const bootOverlayController = createStartupBootOverlayController();
const {
  checkpointBootMetric,
  checkpointBootMetricOnce,
  completeBootSequenceLogging,
  finishBootMetric,
  getBootProgressWindow,
  hasStartupReadonlyUnlockScheduled,
  initializeBootOverlay,
  resetBootMetrics,
  resolveStartupInteractionMode,
  scheduleStartupReadonlyUnlockTimer,
  setBootContinueHandler,
  setBootPreviewVisible,
  setBootState,
  setStartupReadonlyState,
  startBootMetric,
} = bootOverlayController;
state.setStartupReadonlyStateFn = setStartupReadonlyState;
let startupDataPipelineOwner = null;

function getStartupDataPipelineOwner() {
  if (startupDataPipelineOwner) {
    return startupDataPipelineOwner;
  }
  startupDataPipelineOwner = createStartupDataPipelineOwner({
    state,
    helpers: {
      checkpointBootMetric,
      finishBootMetric,
      invalidateContextLayerVisualStateBatch,
      requestMainRender,
      startBootMetric,
    },
  });
  return startupDataPipelineOwner;
}

function yieldToMain() {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function loadDeferredMilsymbol() {
  if (globalThis.ms?.Symbol) {
    return Promise.resolve(true);
  }
  if (milsymbolLoadPromise) {
    return milsymbolLoadPromise;
  }
  if (typeof document === "undefined") {
    return Promise.resolve(false);
  }

  const existingScript = Array.from(document.scripts || []).find((script) => (
    String(script?.src || "").endsWith("/vendor/milsymbol.js")
    || String(script?.getAttribute?.("src") || "").trim() === "vendor/milsymbol.js"
  ));
  if (existingScript) {
    milsymbolLoadPromise = new Promise((resolve) => {
      const finalize = (loaded) => resolve(loaded && !!globalThis.ms?.Symbol);
      existingScript.addEventListener("load", () => finalize(true), { once: true });
      existingScript.addEventListener("error", () => finalize(false), { once: true });
      if (globalThis.ms?.Symbol) {
        finalize(true);
      }
    });
    return milsymbolLoadPromise;
  }

  milsymbolLoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "vendor/milsymbol.js";
    script.async = true;
    script.onload = () => resolve(!!globalThis.ms?.Symbol);
    script.onerror = () => {
      console.warn("[boot] Failed to load deferred milsymbol renderer.");
      resolve(false);
    };
    document.body?.appendChild(script);
  });
  return milsymbolLoadPromise;
}

function bootstrapDeferredUi(renderApp) {
  if (deferredUiBootstrapPromise) {
    return deferredUiBootstrapPromise;
  }
  deferredUiBootstrapPromise = (async () => {
    const [
      { initToolbar },
      { initSidebar },
      { initScenarioControls },
      { initShortcuts },
    ] = await Promise.all([
      import("./ui/toolbar.js"),
      import("./ui/sidebar.js"),
      import("./ui/scenario_controls.js"),
      import("./ui/shortcuts.js"),
    ]);
    await yieldToMain();
    initToolbar({ render: renderApp });
    await yieldToMain();
    initSidebar({ render: renderApp });
    await yieldToMain();
    initScenarioControls();
    initTranslations();
    initShortcuts();
    return true;
  })().catch((error) => {
    deferredUiBootstrapPromise = null;
    throw error;
  });
  return deferredUiBootstrapPromise;
}

async function ensureBaseCityDataReady({ reason = "manual", renderNow = true } = {}) {
  return getStartupDataPipelineOwner().ensureBaseCityDataReady({ reason, renderNow });
}

async function ensureFullLocalizationDataReady({ reason = "post-ready", renderNow = true } = {}) {
  return getStartupDataPipelineOwner().ensureFullLocalizationDataReady({ reason, renderNow });
}

state.ensureFullLocalizationDataReadyFn = ensureFullLocalizationDataReady;

async function ensureActiveScenarioBundleHydrated({ reason = "post-ready", renderNow = true } = {}) {
  return getStartupDataPipelineOwner().ensureActiveScenarioBundleHydrated({ reason, renderNow });
}

function shouldFastTrackScenarioHydration() {
  return getStartupDataPipelineOwner().shouldFastTrackScenarioHydration();
}

function schedulePostReadyHydration() {
  if (postReadyHydrationScheduled) {
    return;
  }
  postReadyHydrationScheduled = true;
  schedulePostReadyTask("post-ready-localization-hydration", () => (
    ensureFullLocalizationDataReady({ reason: "post-ready-idle", renderNow: true }).catch((error) => {
      console.warn("[boot] Deferred full localization hydration failed during idle scheduling.", error);
      return null;
    })
  ), {
    timeout: 2200,
    delayMs: 1200,
    retryDelayMs: 600,
  });
  schedulePostReadyTask("post-ready-scenario-hydration", () => (
    ensureActiveScenarioBundleHydrated({ reason: "post-ready-idle", renderNow: true }).catch((error) => {
      console.warn("[boot] Deferred full scenario hydration failed during idle scheduling.", error);
      return null;
    })
  ), {
    timeout: 4800,
    delayMs: shouldFastTrackScenarioHydration() ? 300 : 4200,
    retryDelayMs: shouldFastTrackScenarioHydration() ? 450 : 900,
  });
}

async function ensureContextLayerDataReady(
  requestedLayerNames,
  { reason = "manual", renderNow = true } = {}
) {
  return getStartupDataPipelineOwner().ensureContextLayerDataReady(requestedLayerNames, {
    reason,
    renderNow,
  });
}

function scheduleIdleTask(callback, { timeout = 1200, delayMs = 0 } = {}) {
  const run = () => {
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(() => {
        void callback();
      }, { timeout });
      return;
    }
    globalThis.setTimeout(() => {
      void callback();
    }, 0);
  };
  globalThis.setTimeout(run, Math.max(0, delayMs));
}

function flushPendingScenarioChunkRefreshAfterReady(reason = "post-ready") {
  if (typeof state.scheduleScenarioChunkRefreshFn !== "function") {
    return;
  }
  state.scheduleScenarioChunkRefreshFn({
    reason,
    delayMs: 0,
    flushPending: true,
  });
}

function startDeferredFullInteractionInfrastructureBuild(reason = "post-ready-full-interaction") {
  const run = () => {
    void buildInteractionInfrastructureAfterStartup({
      chunked: true,
      buildHitCanvas: false,
      mode: "full",
    }).catch((error) => {
      console.warn(`[boot] Deferred full interaction infrastructure build failed. reason=${reason}`, error);
    });
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(() => {
      run();
    }, { timeout: 1200 });
    return;
  }
  globalThis.setTimeout(run, 180);
}

function clearPostReadyTaskHandle(handle) {
  if (!handle) return;
  if (handle.type === "idle" && typeof globalThis.cancelIdleCallback === "function") {
    globalThis.cancelIdleCallback(handle.id);
    return;
  }
  if (handle.type === "raf" && typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle.id);
    return;
  }
  globalThis.clearTimeout?.(handle.id);
}

function clearScheduledPostReadyTask(taskKey) {
  const handle = postReadyTaskHandles.get(taskKey);
  if (!handle) return;
  clearPostReadyTaskHandle(handle);
  postReadyTaskHandles.delete(taskKey);
}

function clearAllScheduledPostReadyTasks() {
  postReadyTaskHandles.forEach((handle) => {
    clearPostReadyTaskHandle(handle);
  });
  postReadyTaskHandles.clear();
}

function canRunPostReadyIdleWork() {
  return (
    !state.bootBlocking
    && !state.scenarioApplyInFlight
    && !state.startupReadonly
    && !state.startupReadonlyUnlockInFlight
    && !state.isInteracting
    && String(state.renderPhase || "idle") === "idle"
  );
}

function schedulePostReadyTask(
  taskKey,
  callback,
  {
    timeout = 1200,
    delayMs = 0,
    retryDelayMs = 320,
  } = {}
) {
  const normalizedTaskKey = String(taskKey || "").trim();
  if (!normalizedTaskKey) return;
  clearScheduledPostReadyTask(normalizedTaskKey);
  const scheduledEpoch = postReadyTaskEpoch;

  const runWhenIdle = () => {
    if (scheduledEpoch !== postReadyTaskEpoch) {
      clearScheduledPostReadyTask(normalizedTaskKey);
      return;
    }
    if (!canRunPostReadyIdleWork()) {
      const retryId = globalThis.setTimeout(runWhenIdle, Math.max(120, retryDelayMs));
      postReadyTaskHandles.set(normalizedTaskKey, { type: "timeout", id: retryId });
      return;
    }
    if (typeof globalThis.requestIdleCallback === "function") {
      const idleId = globalThis.requestIdleCallback(() => {
        postReadyTaskHandles.delete(normalizedTaskKey);
        if (scheduledEpoch !== postReadyTaskEpoch) {
          return;
        }
        if (!canRunPostReadyIdleWork()) {
          schedulePostReadyTask(normalizedTaskKey, callback, {
            timeout,
            delayMs: retryDelayMs,
            retryDelayMs,
          });
          return;
        }
        void callback();
      }, { timeout });
      postReadyTaskHandles.set(normalizedTaskKey, { type: "idle", id: idleId });
      return;
    }
    const timeoutId = globalThis.setTimeout(() => {
      postReadyTaskHandles.delete(normalizedTaskKey);
      if (scheduledEpoch !== postReadyTaskEpoch) {
        return;
      }
      if (!canRunPostReadyIdleWork()) {
        schedulePostReadyTask(normalizedTaskKey, callback, {
          timeout,
          delayMs: retryDelayMs,
          retryDelayMs,
        });
        return;
      }
      void callback();
    }, 0);
    postReadyTaskHandles.set(normalizedTaskKey, { type: "timeout", id: timeoutId });
  };

  const startId = globalThis.setTimeout(runWhenIdle, Math.max(0, delayMs));
  postReadyTaskHandles.set(normalizedTaskKey, { type: "timeout", id: startId });
}

function schedulePostReadyVisualWarmup() {
  const textureMode = String(state.styleConfig?.texture?.mode || "none").trim().toLowerCase();
  const dayNightEnabled = !!state.styleConfig?.dayNight?.enabled;
  if (textureMode === "none" && !dayNightEnabled) {
    return;
  }
  schedulePostReadyTask("post-ready-visual-warmup", async () => {
    if (!state.bootBlocking) {
      requestMainRender("post-ready-visual-warmup");
    }
  }, {
    timeout: 900,
    delayMs: 120,
    retryDelayMs: 240,
  });
}

function schedulePostReadyDeferredContextWarmup() {
  if (state.bootBlocking || postReadyContextWarmupScheduled) {
    return;
  }
  const requestedLayerNames = [];
  const requestedContourLayerNames = [];
  if (state.showRivers) {
    requestedLayerNames.push("rivers");
  }
  if (state.showUrban) {
    requestedLayerNames.push("urban");
  }
  if (state.showPhysical) {
    requestedLayerNames.push("physical-set");
    requestedContourLayerNames.push("physical-contours-set");
  }
  const shouldWarmCities =
    state.showCityPoints !== false
    && state.baseCityDataState === "idle"
    && typeof state.ensureBaseCityDataFn === "function";
  if (!requestedLayerNames.length && !shouldWarmCities) {
    return;
  }
  postReadyContextWarmupScheduled = true;
  schedulePostReadyTask("post-ready-context-warmup", async () => {
    if (state.bootBlocking) {
      return;
    }
    const tasks = [];
    if (requestedLayerNames.length) {
      tasks.push(ensureContextLayerDataReady(requestedLayerNames, {
        reason: "post-ready",
        renderNow: true,
      }));
    }
    if (shouldWarmCities && state.baseCityDataState === "idle" && typeof state.ensureBaseCityDataFn === "function") {
      tasks.push(state.ensureBaseCityDataFn({ reason: "post-ready", renderNow: true }));
    }
    await Promise.allSettled(tasks);
  }, {
    timeout: 1000,
    delayMs: 120,
    retryDelayMs: 320,
  });
  if (requestedContourLayerNames.length) {
    schedulePostReadyTask("post-ready-contour-warmup", async () => {
      if (state.bootBlocking) {
        return;
      }
      await ensureContextLayerDataReady(requestedContourLayerNames, {
        reason: "post-ready-contours",
        renderNow: true,
      });
    }, {
      timeout: 1200,
      delayMs: 900,
      retryDelayMs: 320,
    });
  }
}

function schedulePostReadyCityWarmup() {
  if (
    state.bootBlocking
    || state.showCityPoints === false
    || state.baseCityDataState !== "idle"
    || typeof state.ensureBaseCityDataFn !== "function"
  ) {
    return;
  }
  const run = () => {
    if (state.bootBlocking || state.baseCityDataState !== "idle") {
      return;
    }
    void state.ensureBaseCityDataFn({ reason: "post-ready", renderNow: true }).catch(() => {});
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(() => {
      run();
    }, { timeout: 2200 });
  } else {
    globalThis.setTimeout(run, 900);
  }
}

function hasDetailTopologyLoaded() {
  return !!state.topologyDetail?.objects?.political;
}

function getViewportFocusCountryCode() {
  return String(
    state.activeSovereignCode
    || state.selectedInspectorCountryCode
    || ""
  ).trim().toUpperCase();
}

function prioritizeViewportFocusCountry({
  reason = "detail-promotion",
  flushPending = false,
} = {}) {
  const focusCountry = getViewportFocusCountryCode();
  if (!focusCountry) {
    return;
  }
  if (state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object") {
    state.runtimeChunkLoadState.focusCountryOverride = focusCountry;
  }
  if (typeof state.scheduleScenarioChunkRefreshFn === "function") {
    state.scheduleScenarioChunkRefreshFn({
      reason,
      delayMs: 0,
      flushPending,
    });
  }
}

function syncScenarioReadyUiAfterDetailPromotion() {
  refreshScenarioDataHealth({
    showWarningToast: false,
    showErrorToast: false,
  });
  if (typeof state.updateScenarioUIFn === "function") {
    state.updateScenarioUIFn();
  }
}

function applyDetailPromotionMapRefresh({
  interactionLevel = "full",
  deferInteractionInfrastructure = false,
} = {}) {
  const hasActiveScenario = !!String(state.activeScenarioId || "").trim();
  if (hasActiveScenario) {
    try {
      refreshMapDataForScenarioApply({ suppressRender: true });
      return "light";
    } catch (error) {
      console.warn("[main] Detail promotion lightweight refresh failed, falling back to setMapData.", error);
    }
  }
  setMapData({
    refitProjection: false,
    resetZoom: false,
    suppressRender: true,
    interactionLevel,
    deferInteractionInfrastructure,
  });
  return hasActiveScenario ? "setMapData-fallback" : "setMapData";
}

async function ensureDetailTopologyReady({
  renderDispatcher = null,
  requireIdle = false,
  applyMapData = true,
  suppressRender = false,
  interactionLevel = "full",
  deferInteractionInfrastructure = false,
  flushPendingFocusRefresh = true,
} = {}) {
  prioritizeViewportFocusCountry({
    reason: "detail-promotion-focus",
    flushPending: flushPendingFocusRefresh,
  });
  if (hasDetailTopologyLoaded()) {
    if (state.topologyBundleMode !== "composite") {
      state.topologyBundleMode = "composite";
      if (applyMapData) {
        applyDetailPromotionMapRefresh({
          interactionLevel,
          deferInteractionInfrastructure,
        });
        if (!suppressRender) {
          if (renderDispatcher?.schedule) {
            renderDispatcher.schedule();
          } else {
            requestMainRender("detail-topology-ready");
          }
        }
      }
    }
    state.detailDeferred = false;
    state.detailPromotionCompleted = true;
    syncScenarioReadyUiAfterDetailPromotion();
    return true;
  }

  if (state.detailPromotionInFlight) return false;
  if (requireIdle && (state.isInteracting || state.renderPhase !== "idle")) {
    return false;
  }

  state.detailPromotionInFlight = true;
  try {
    const {
      topologyDetail,
      runtimePoliticalTopology,
      topologyBundleMode,
      detailSourceUsed,
    } = await loadDeferredDetailBundle({
      detailSourceKey: state.detailSourceRequested,
    });

    if (!topologyDetail) {
      state.detailDeferred = false;
      console.warn("[main] Detail promotion skipped: no detail topology was loaded.");
      return false;
    }

    state.topologyDetail = topologyDetail;
    state.runtimePoliticalTopology = runtimePoliticalTopology || state.runtimePoliticalTopology;
    if (!state.activeScenarioId) {
      state.defaultRuntimePoliticalTopology = state.runtimePoliticalTopology || null;
    }
    state.topologyBundleMode = topologyBundleMode || "composite";
    state.detailDeferred = false;
    state.detailPromotionCompleted = true;
    state.detailSourceRequested = detailSourceUsed || state.detailSourceRequested;

    console.info(
      `[main] Detail promotion applied. source=${state.detailSourceRequested}, mode=${state.topologyBundleMode}.`
    );
    if (applyMapData) {
      const refreshMode = applyDetailPromotionMapRefresh({
        interactionLevel,
        deferInteractionInfrastructure,
      });
      if (!suppressRender) {
        if (renderDispatcher?.schedule) {
          renderDispatcher.schedule();
        } else {
          requestMainRender("detail-topology-promoted");
        }
      }
      console.info(`[main] Detail promotion refresh path=${refreshMode}.`);
    }
    syncScenarioReadyUiAfterDetailPromotion();
    return true;
  } catch (error) {
    console.warn("[main] Detail promotion failed:", error);
    return false;
  } finally {
    state.detailPromotionInFlight = false;
  }
}

async function unlockStartupReadonlyWithDetail(renderDispatcher) {
  if (!state.startupReadonly || state.startupReadonlyUnlockInFlight) {
    return false;
  }
  setStartupReadonlyState(true, {
    reason: "detail-promotion",
    unlockInFlight: true,
  });
  startBootMetric("startup-readonly:unlock");
  startBootMetric("detail-promotion");
  setBootState("detail-promotion", {
    blocking: true,
    canContinueWithoutScenario: false,
  });
  try {
    const promoted = await ensureDetailTopologyReady({
      renderDispatcher,
      requireIdle: false,
      applyMapData: true,
      suppressRender: true,
      interactionLevel: "readonly-startup",
      deferInteractionInfrastructure: true,
      flushPendingFocusRefresh: false,
    });
    const detailReady = promoted || hasDetailTopologyLoaded();
    if (!detailReady) {
      finishBootMetric("detail-promotion", {
        failed: true,
      });
      finishBootMetric("startup-readonly:unlock", {
        failed: true,
      });
      setStartupReadonlyState(true, {
        reason: "detail-promotion-failed",
        unlockInFlight: false,
      });
      return false;
    }
    finishBootMetric("detail-promotion", {
      activeScenarioId: String(state.activeScenarioId || ""),
    });
    const activeScenarioId = String(state.activeScenarioId || "").trim();
    const cachedBundle = activeScenarioId
      ? state.scenarioBundleCacheById?.[activeScenarioId] || null
      : null;
    if (cachedBundle?.manifest) {
      warnOnStartupBundleIntegrity(cachedBundle, {
        source: cachedBundle?.loadDiagnostics?.startupBundle ? "startup-bundle" : "legacy",
      });
    }
    renderDispatcher?.flush?.();
    setBootState("interaction-infra", {
      blocking: true,
      canContinueWithoutScenario: false,
    });
    startBootMetric("interaction-infra");
    await buildInteractionInfrastructureAfterStartup({
      chunked: true,
      buildHitCanvas: false,
      mode: "basic",
    });
    finishBootMetric("interaction-infra", {
      activeScenarioId,
    });
    finishBootMetric("startup-readonly:unlock", {
      activeScenarioId,
    });
    setStartupReadonlyState(false);
    checkpointBootMetric("startup-readonly:unlocked");
    checkpointBootMetric("time-to-interactive");
    checkpointBootMetric("first-interactive");
    setBootState("ready", {
      blocking: false,
      progress: 100,
      canContinueWithoutScenario: false,
    });
    completeBootSequenceLogging();
    flushPendingScenarioChunkRefreshAfterReady("startup-readonly-unlocked");
    startDeferredFullInteractionInfrastructureBuild("startup-readonly-unlocked");
    schedulePostReadyHydration();
    schedulePostReadyDeferredContextWarmup();
    schedulePostReadyVisualWarmup();
    return true;
  } catch (error) {
    finishBootMetric("detail-promotion", {
      failed: true,
      errorMessage: error?.message || String(error || "Unknown detail promotion error."),
    });
    finishBootMetric("interaction-infra", {
      failed: true,
      errorMessage: error?.message || String(error || "Unknown interaction infrastructure error."),
    });
    finishBootMetric("startup-readonly:unlock", {
      failed: true,
      errorMessage: error?.message || String(error || "Unknown startup readonly unlock error."),
    });
    console.warn("[boot] Startup readonly unlock failed:", error);
    setStartupReadonlyState(true, {
      reason: "detail-promotion-failed",
      unlockInFlight: false,
    });
    return false;
  }
}

function scheduleStartupReadonlyUnlock(
  renderDispatcher,
  { delayMs = 120, attempt = 0, maxAttempts = 5 } = {},
) {
  if (!state.startupReadonly || state.startupReadonlyUnlockInFlight || hasStartupReadonlyUnlockScheduled()) {
    return;
  }
  scheduleStartupReadonlyUnlockTimer(() => {
    if (attempt >= maxAttempts) {
      console.warn(`[boot] Startup readonly unlock failed after ${maxAttempts} attempts, force-unlocking.`);
      setStartupReadonlyState(true, {
        reason: "detail-promotion-failed",
        unlockInFlight: true,
      });
      setBootState("interaction-infra", {
        blocking: true,
        canContinueWithoutScenario: false,
      });
      startBootMetric("interaction-infra");
      void buildInteractionInfrastructureAfterStartup({
        chunked: true,
        buildHitCanvas: false,
        mode: "basic",
      }).then(() => {
        forcedStartupReadonlyInfraRetryCount = 0;
        finishBootMetric("interaction-infra", {
          activeScenarioId: String(state.activeScenarioId || ""),
          forced: true,
        });
        setStartupReadonlyState(false);
        setBootState("ready", {
          blocking: false,
          progress: 100,
          canContinueWithoutScenario: false,
        });
        checkpointBootMetric("time-to-interactive");
        checkpointBootMetric("first-interactive");
        completeBootSequenceLogging();
        flushPendingScenarioChunkRefreshAfterReady("startup-readonly-force-unlocked");
        startDeferredFullInteractionInfrastructureBuild("startup-readonly-force-unlocked");
        scheduleDeferredDetailPromotion(renderDispatcher);
        schedulePostReadyHydration();
        schedulePostReadyDeferredContextWarmup();
        schedulePostReadyVisualWarmup();
      }).catch((error) => {
        finishBootMetric("interaction-infra", {
          failed: true,
          forced: true,
          errorMessage: error?.message || String(error || "Unknown interaction infrastructure error."),
        });
        console.warn("[boot] Forced startup readonly unlock interaction infra build failed:", error);
        setStartupReadonlyState(true, {
          reason: "interaction-infra-failed",
          unlockInFlight: false,
        });
        setBootState("interaction-infra", {
          blocking: true,
          canContinueWithoutScenario: false,
        });
        forcedStartupReadonlyInfraRetryCount += 1;
        if (forcedStartupReadonlyInfraRetryCount <= MAX_FORCED_STARTUP_INFRA_RETRIES) {
          console.warn(
            `[boot] Retrying forced startup readonly unlock infra build (${forcedStartupReadonlyInfraRetryCount}/${MAX_FORCED_STARTUP_INFRA_RETRIES}).`,
          );
          scheduleStartupReadonlyUnlock(renderDispatcher, {
            delayMs: 1600,
            attempt: maxAttempts,
            maxAttempts,
          });
          return;
        }
        setStartupReadonlyState(false);
        setBootState("error", {
          error: error?.message || "Failed to initialize interaction infrastructure during startup recovery.",
          canContinueWithoutScenario: false,
          progress: state.bootProgress || getBootProgressWindow("interaction-infra").min,
        });
      });
      return;
    }
    void unlockStartupReadonlyWithDetail(renderDispatcher).then((unlocked) => {
      if (!unlocked && state.startupReadonly) {
        scheduleStartupReadonlyUnlock(renderDispatcher, {
          delayMs: 1600,
          attempt: attempt + 1,
          maxAttempts,
        });
      }
    });
  }, Math.max(0, delayMs));
}

function scheduleDeferredDetailPromotion(renderDispatcher) {
  if (
    !state.detailDeferred ||
    state.detailPromotionCompleted ||
    state.detailPromotionInFlight ||
    deferredPromotionHandle !== null
  ) {
    return;
  }

  const runPromotion = async () => {
    deferredPromotionHandle = null;
    if (!state.detailDeferred || state.detailPromotionCompleted || state.detailPromotionInFlight) {
      return;
    }
    if (!canRunPostReadyIdleWork()) {
      scheduleDeferredDetailPromotion(renderDispatcher);
      return;
    }
    prioritizeViewportFocusCountry({
      reason: "detail-promotion-idle-focus",
      flushPending: true,
    });
    const promoted = await ensureDetailTopologyReady({
      renderDispatcher,
      requireIdle: true,
    });
    if (!promoted && (state.isInteracting || state.renderPhase !== "idle")) {
      scheduleDeferredDetailPromotion(renderDispatcher);
    }
  };

  const delayMs = getDeferredPromotionDelay(state.renderProfile);
  if (typeof globalThis.requestIdleCallback === "function") {
    deferredPromotionHandle = globalThis.requestIdleCallback(() => {
      void runPromotion();
    }, { timeout: Math.max(600, delayMs) });
  } else {
    deferredPromotionHandle = globalThis.setTimeout(() => {
      void runPromotion();
    }, delayMs);
  }
}

async function finalizeReadyState(renderDispatcher) {
  const shouldEnterStartupReadonly = (
    !!String(state.activeScenarioId || "").trim()
    && state.startupInteractionMode === "readonly"
    && state.detailDeferred
    && !hasDetailTopologyLoaded()
  );
  const startupBootstrapStrategy = String(
    state.activeScenarioManifest?.startup_bootstrap_strategy || ""
  ).trim();
  const shouldUseChunkedCoarseStartup =
    shouldEnterStartupReadonly
    && startupBootstrapStrategy === "chunked-coarse-first";
  if (shouldUseChunkedCoarseStartup) {
    setBootState("interaction-infra", {
      blocking: true,
      progress: Math.max(Number(state.bootProgress) || 0, getBootProgressWindow("detail-promotion").min),
      canContinueWithoutScenario: false,
    });
    startBootMetric("interaction-infra");
    await buildInteractionInfrastructureAfterStartup({
      chunked: true,
      buildHitCanvas: false,
      mode: "basic",
    });
    finishBootMetric("interaction-infra", {
      activeScenarioId: String(state.activeScenarioId || ""),
      startupBootstrapStrategy,
    });
    setStartupReadonlyState(false);
    setBootState("ready", {
      blocking: false,
      progress: 100,
      canContinueWithoutScenario: false,
    });
    checkpointBootMetric("time-to-interactive");
    checkpointBootMetric("first-interactive");
    completeBootSequenceLogging();
    flushPendingScenarioChunkRefreshAfterReady("ready-state");
    startDeferredFullInteractionInfrastructureBuild("ready-state");
    scheduleDeferredDetailPromotion(renderDispatcher);
    schedulePostReadyHydration();
    schedulePostReadyDeferredContextWarmup();
    schedulePostReadyVisualWarmup();
    return;
  }
  if (shouldEnterStartupReadonly) {
    setStartupReadonlyState(true, {
      reason: "detail-promotion",
      unlockInFlight: false,
    });
    setBootState("detail-promotion", {
      blocking: true,
      progress: Math.max(Number(state.bootProgress) || 0, getBootProgressWindow("detail-promotion").min),
      canContinueWithoutScenario: false,
    });
    scheduleStartupReadonlyUnlock(renderDispatcher);
    return;
  }
  setBootState("ready", {
    blocking: false,
    progress: 100,
    canContinueWithoutScenario: false,
  });
  checkpointBootMetric("time-to-interactive");
  checkpointBootMetric("first-interactive");
  completeBootSequenceLogging();
  scheduleDeferredDetailPromotion(renderDispatcher);
  schedulePostReadyHydration();
  schedulePostReadyDeferredContextWarmup();
  schedulePostReadyVisualWarmup();
}

async function bootstrap() {
  initializeBootOverlay();
  if (!globalThis.d3 || !globalThis.topojson) {
    console.error("D3/topojson not loaded. Ensure scripts are included before main.js.");
    setBootState("error", {
      error: "D3/topojson not loaded. Ensure scripts are included before main.js.",
      canContinueWithoutScenario: false,
      progress: 0,
    });
    return;
  }

  hydrateLanguage();
  resetBootMetrics();
  state.bootPreviewVisible = false;
  setBootState("shell", {
    progress: getBootProgressWindow("shell").min,
    canContinueWithoutScenario: false,
  });
  setBootContinueHandler(null);
  deferredUiBootstrapPromise = null;
  postReadyContextWarmupScheduled = false;
  postReadyHydrationScheduled = false;
  postReadyTaskEpoch += 1;
  clearAllScheduledPostReadyTasks();
  state.startupInteractionMode = resolveStartupInteractionMode();
  setStartupReadonlyState(false);

  let renderDispatcher = null;
  try {
    bindBeforeUnload();
    setBootState("base-data");
    startBootMetric("base-data");
    const d3Client = globalThis.d3;
    const startupDataPipeline = getStartupDataPipelineOwner();
    const {
      configuredDefaultScenarioId,
      registryDefaultScenarioIdPromise,
      requestedDefaultScenarioIdPromise,
      scenarioBundlePromise,
      startupBundleResultPromise,
    } = startupDataPipeline.resolveStartupScenarioBootstrap({ d3Client });
    const startupFallbackScenarioId = await requestedDefaultScenarioIdPromise;
    const startupBaseData = await startupDataPipeline.loadStartupBaseData({
      d3Client,
      startupBundleResultPromise,
      startupFallbackScenarioId,
    });
    startupDataPipeline.hydrateStartupBaseState({
      ensureBaseCityDataReadyFn: ensureBaseCityDataReady,
      ensureContextLayerDataReadyFn: ensureContextLayerDataReady,
      persistViewSettingsFn: persistViewSettings,
      startupBaseData,
    });
    startupDataPipeline.decodeStartupPrimaryCollections({
      resourceMetrics: startupBaseData.resourceMetrics || {},
      startupDecodedCollections: startupBaseData.startupDecodedCollections || null,
    });
    const registryDefaultScenarioId = configuredDefaultScenarioId
      ? configuredDefaultScenarioId
      : await registryDefaultScenarioIdPromise;
    if (configuredDefaultScenarioId && registryDefaultScenarioId !== configuredDefaultScenarioId) {
      console.warn(
        `[boot] Configured default scenario "${configuredDefaultScenarioId}" differs from registry default "${registryDefaultScenarioId}".`
      );
    }
    initLongAnimationFrameObserver();
    const startupInteractionLevel = state.startupInteractionMode === "readonly" ? "readonly-startup" : "full";
    initMap({
      suppressRender: true,
      interactionLevel: startupInteractionLevel,
      deferInteractionInfrastructure: startupInteractionLevel === "readonly-startup",
    });
    setMapData({
      suppressRender: true,
      interactionLevel: startupInteractionLevel,
      deferInteractionInfrastructure: startupInteractionLevel === "readonly-startup",
    });

    renderDispatcher = createRenderDispatcher(render);
    const renderApp = () => {
      renderDispatcher.schedule();
    };
    globalThis.renderApp = renderApp;
    bindRenderBoundary({
      scheduleRender: () => renderDispatcher.schedule(),
      flushRender: () => renderDispatcher.flush(),
      ensureDetailTopology: (options = {}) =>
        ensureDetailTopologyReady({
          renderDispatcher,
          ...options,
        }),
    });
    const flushRenderNow = () => flushRenderBoundary("legacy-render-now");
    globalThis.renderNow = flushRenderNow;
    state.renderNowFn = flushRenderNow;
    state.ensureDetailTopologyFn = (options = {}) =>
      ensureDetailTopologyReady({
        renderDispatcher,
        ...options,
      });

    initToast();
    setBootPreviewVisible(false);
    initPresetState();
    void loadDeferredMilsymbol();
    deferredUiBootstrapPromise = bootstrapDeferredUi(renderApp);

    setBootState("scenario-bundle");
    const scenarioBundleResult = await scenarioBundlePromise;
    if (!scenarioBundleResult.ok) {
      throw scenarioBundleResult.error;
    }
    let defaultScenarioBundle = scenarioBundleResult.bundle;
    let scenarioBundleSource = String(scenarioBundleResult.source || "legacy").trim() || "legacy";
    let startupRecoveryReason = "";
    if (!defaultScenarioBundle?.manifest) {
      throw new Error("Default scenario bundle did not include a manifest.");
    }
    finishBootMetric("scenario-bundle", {
      source: scenarioBundleResult.source || "legacy",
      requiresDetailTopology: false,
      expectedScenarioFeatureCount: Number(defaultScenarioBundle.manifest?.summary?.feature_count || 0),
      bundleLevel: defaultScenarioBundle?.bundleLevel || "bootstrap",
      resourceMetrics: defaultScenarioBundle?.loadDiagnostics?.optionalResources?.runtime_topology?.metrics
        ? {
          runtimeTopology: defaultScenarioBundle.loadDiagnostics.optionalResources.runtime_topology.metrics,
          geoLocalePatch: defaultScenarioBundle.loadDiagnostics.optionalResources.geo_locale_patch?.metrics || null,
          manifest: defaultScenarioBundle.loadDiagnostics.requiredResources?.manifest || null,
        }
        : {
          geoLocalePatch: defaultScenarioBundle?.loadDiagnostics?.optionalResources?.geo_locale_patch?.metrics || null,
          manifest: defaultScenarioBundle?.loadDiagnostics?.requiredResources?.manifest || null,
        },
    });

    await deferredUiBootstrapPromise;
    setBootState("scenario-apply");
    startBootMetric("scenario-apply");
    state.scenarioApplyInFlight = true;
    if (typeof state.updateScenarioUIFn === "function") {
      state.updateScenarioUIFn();
    }
    try {
      await applyScenarioBundleCommand(defaultScenarioBundle, {
        renderMode: "none",
        suppressRender: true,
        markDirtyReason: "",
        showToastOnComplete: false,
        interactionLevel: state.startupInteractionMode === "readonly" ? "readonly-startup" : "full",
      });
    } catch (startupApplyError) {
      if (scenarioBundleSource !== "startup-bundle") {
        throw startupApplyError;
      }
      startupRecoveryReason = String(startupApplyError?.message || "startup-bundle-apply-failed");
      console.warn(
        `[boot] Startup bundle apply failed for "${defaultScenarioBundle.manifest?.scenario_id || ""}", falling back to legacy bootstrap bundle.`,
        startupApplyError
      );
      defaultScenarioBundle = await loadScenarioBundle(String(defaultScenarioBundle.manifest?.scenario_id || ""), {
        d3Client,
        bundleLevel: "bootstrap",
        forceReload: true,
      });
      scenarioBundleSource = "legacy-bootstrap-recovery";
      await applyScenarioBundleCommand(defaultScenarioBundle, {
        renderMode: "none",
        suppressRender: true,
        markDirtyReason: "",
        showToastOnComplete: false,
        interactionLevel: state.startupInteractionMode === "readonly" ? "readonly-startup" : "full",
      });
    }
    warnOnStartupBundleIntegrity(defaultScenarioBundle, {
      source: scenarioBundleSource,
    });
    finishBootMetric("scenario-apply", {
      activeScenarioId: String(state.activeScenarioId || ""),
      source: scenarioBundleSource,
      startupRecoveryReason,
    });
    state.scenarioApplyInFlight = false;
    if (typeof state.updateScenarioUIFn === "function") {
      state.updateScenarioUIFn();
    }

    setBootState("warmup");
    renderDispatcher.flush();
    checkpointBootMetricOnce("first-visible");
    checkpointBootMetricOnce("first-visible-scenario");
    await finalizeReadyState(renderDispatcher);
    void postStartupSupportKeyUsageReport({
      scenarioId: String(state.activeScenarioId || defaultScenarioBundle?.manifest?.scenario_id || "").trim(),
      source: scenarioBundleSource,
    });
  } catch (error) {
    state.scenarioApplyInFlight = false;
    if (typeof state.updateScenarioUIFn === "function") {
      state.updateScenarioUIFn();
    }
    finishBootMetric("total", { failed: true });
    console.error("Failed to boot application:", error);
    console.error("Stack trace:", error?.stack);
    setStartupReadonlyState(false);
    const canContinueWithoutScenario =
      !!state.landData?.features?.length
      && !!renderDispatcher?.flush;
    setBootContinueHandler(canContinueWithoutScenario
      ? async () => {
        if (deferredUiBootstrapPromise) {
          await deferredUiBootstrapPromise;
        }
        setBootState("warmup", {
          message: getBootLanguage() === "zh"
            ? "正在以基础地图模式继续。"
            : "Continuing with the base map only.",
          canContinueWithoutScenario: false,
        });
        renderDispatcher.flush();
        checkpointBootMetricOnce("first-visible");
        checkpointBootMetricOnce("first-visible-base");
        await finalizeReadyState(renderDispatcher);
      }
      : null);
    setBootState("error", {
      error: error?.message || "Failed to load the default startup scenario.",
      canContinueWithoutScenario,
      progress: state.bootProgress || getBootProgressWindow("scenario-apply").min,
    });
  }
}

bootstrap();
