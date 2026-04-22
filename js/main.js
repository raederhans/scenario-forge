// App entry point (Phase 13)
import { normalizeCityLayerStyleConfig, state as runtimeState } from "./core/state.js";
import {
  setBootPreviewVisibleState,
  setStartupInteractionMode,
} from "./core/state/boot_state.js";
import { createStartupBootOverlayController } from "./bootstrap/startup_boot_overlay.js";
import { createStartupDataPipelineOwner } from "./bootstrap/startup_data_pipeline.js";
import { createDeferredDetailPromotionOwner } from "./bootstrap/deferred_detail_promotion.js";
import { createStartupScenarioBootOwner } from "./bootstrap/startup_scenario_boot.js";
import {
  createRenderDispatcher,
  getBootLanguage,
  hydrateLanguage,
  initLongAnimationFrameObserver,
  normalizeBatchFillScopes,
  persistViewSettings,
  postStartupSupportKeyUsageReport,
  warnOnStartupBundleIntegrity,
} from "./bootstrap/startup_bootstrap_support.js";
import {
  buildInteractionInfrastructureAfterStartup,
  initMap,
  invalidateContextLayerVisualStateBatch,
  setMapData,
  render,
} from "./core/map_renderer/public.js";
import { bindRenderBoundary, flushRenderBoundary, requestRender } from "./core/render_boundary.js";
import { registerRuntimeHook } from "./core/state/index.js";
import { initPresetState } from "./core/preset_state.js";
import { runPostScenarioUiReplay } from "./core/scenario_post_apply_effects.js";
import { initTranslations } from "./ui/i18n.js";
import { initToast } from "./ui/toast.js";
import { bindBeforeUnload } from "./core/dirty_state.js";
const state = runtimeState;

function requestMainRender(reason = "", { flush = false } = {}) {
  return flush ? flushRenderBoundary(reason) : requestRender(reason);
}

let milsymbolLoadPromise = null;
let deferredUiBootstrapPromise = null;
let postReadyContextWarmupScheduled = false;
let postReadyHydrationScheduled = false;
let postReadyTaskHandles = new Map();
let postReadyTaskEpoch = 0;

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
registerRuntimeHook(state, "setStartupReadonlyStateFn", setStartupReadonlyState);
let startupDataPipelineOwner = null;
let deferredDetailPromotionOwner = null;
let startupScenarioBootOwner = null;

/**
 * Startup owner boundaries:
 * 1) StartupDataPipelineOwner: drives bootstrap data ingestion and base-state hydration.
 * 2) StartupScenarioBootOwner: applies the startup scenario bundle onto hydrated base runtimeState.
 * 3) DeferredDetailPromotionOwner: promotes delayed detail topology and unlocks interaction readiness.
 */
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

function getStartupScenarioBootOwner() {
  if (startupScenarioBootOwner) {
    return startupScenarioBootOwner;
  }
  startupScenarioBootOwner = createStartupScenarioBootOwner({
    state,
    helpers: {
      finishBootMetric,
      setBootState,
      startBootMetric,
      warnOnStartupBundleIntegrity,
    },
  });
  return startupScenarioBootOwner;
}

function getDeferredDetailPromotionOwner() {
  if (deferredDetailPromotionOwner) {
    return deferredDetailPromotionOwner;
  }
  deferredDetailPromotionOwner = createDeferredDetailPromotionOwner({
    state,
    helpers: {
      canRunPostReadyIdleWork,
      checkpointBootMetric,
      completeBootSequenceLogging,
      finishBootMetric,
      flushPendingScenarioChunkRefreshAfterReady,
      getBootProgressWindow,
      hasStartupReadonlyUnlockScheduled,
      requestMainRender,
      schedulePostReadyDeferredContextWarmup,
      schedulePostReadyHydration,
      schedulePostReadyVisualWarmup,
      scheduleStartupReadonlyUnlockTimer,
      setBootState,
      setStartupReadonlyState,
      startBootMetric,
      startDeferredFullInteractionInfrastructureBuild,
      warnOnStartupBundleIntegrity,
    },
  });
  return deferredDetailPromotionOwner;
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
  })();
  return deferredUiBootstrapPromise;
}

async function rollbackStartupScenarioToBaseMap() {
  if (!String(runtimeState.activeScenarioId || "").trim()) {
    return false;
  }
  const { clearActiveScenario } = await import("./core/scenario_manager.js");
  return !!clearActiveScenario({
    renderNow: false,
    markDirtyReason: "",
    showToastOnComplete: false,
    allowDuringBootBlocking: true,
  });
}

async function ensureBaseCityDataReady({ reason = "manual", renderNow = true } = {}) {
  return getStartupDataPipelineOwner().ensureBaseCityDataReady({ reason, renderNow });
}

async function ensureFullLocalizationDataReady({ reason = "post-ready", renderNow = true } = {}) {
  return getStartupDataPipelineOwner().ensureFullLocalizationDataReady({ reason, renderNow });
}

registerRuntimeHook(state, "ensureFullLocalizationDataReadyFn", ensureFullLocalizationDataReady);

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
  if (typeof runtimeState.scheduleScenarioChunkRefreshFn !== "function") {
    return;
  }
  runtimeState.scheduleScenarioChunkRefreshFn({
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
    !runtimeState.bootBlocking
    && !runtimeState.scenarioApplyInFlight
    && !runtimeState.startupReadonly
    && !runtimeState.startupReadonlyUnlockInFlight
    && !runtimeState.isInteracting
    && String(runtimeState.renderPhase || "idle") === "idle"
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
  const textureMode = String(runtimeState.styleConfig?.texture?.mode || "none").trim().toLowerCase();
  const dayNightEnabled = !!runtimeState.styleConfig?.dayNight?.enabled;
  if (textureMode === "none" && !dayNightEnabled) {
    return;
  }
  schedulePostReadyTask("post-ready-visual-warmup", async () => {
    if (!runtimeState.bootBlocking) {
      requestMainRender("post-ready-visual-warmup");
    }
  }, {
    timeout: 900,
    delayMs: 120,
    retryDelayMs: 240,
  });
}

function schedulePostReadyDeferredContextWarmup() {
  if (runtimeState.bootBlocking || postReadyContextWarmupScheduled) {
    return;
  }
  const requestedLayerNames = [];
  const requestedContourLayerNames = [];
  if (runtimeState.showRivers) {
    requestedLayerNames.push("rivers");
  }
  if (runtimeState.showUrban) {
    requestedLayerNames.push("urban");
  }
  if (runtimeState.showPhysical) {
    requestedLayerNames.push("physical-set");
    requestedContourLayerNames.push("physical-contours-set");
  }
  const shouldWarmCities =
    runtimeState.showCityPoints !== false
    && runtimeState.baseCityDataState === "idle"
    && typeof runtimeState.ensureBaseCityDataFn === "function";
  if (!requestedLayerNames.length && !shouldWarmCities) {
    return;
  }
  postReadyContextWarmupScheduled = true;
  schedulePostReadyTask("post-ready-context-warmup", async () => {
    if (runtimeState.bootBlocking) {
      return;
    }
    const tasks = [];
    if (requestedLayerNames.length) {
      tasks.push(ensureContextLayerDataReady(requestedLayerNames, {
        reason: "post-ready",
        renderNow: true,
      }));
    }
    if (shouldWarmCities && runtimeState.baseCityDataState === "idle" && typeof runtimeState.ensureBaseCityDataFn === "function") {
      tasks.push(runtimeState.ensureBaseCityDataFn({ reason: "post-ready", renderNow: true }));
    }
    await Promise.allSettled(tasks);
  }, {
    timeout: 1000,
    delayMs: 120,
    retryDelayMs: 320,
  });
  if (requestedContourLayerNames.length) {
    schedulePostReadyTask("post-ready-contour-warmup", async () => {
      if (runtimeState.bootBlocking) {
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
    runtimeState.bootBlocking
    || runtimeState.showCityPoints === false
    || runtimeState.baseCityDataState !== "idle"
    || typeof runtimeState.ensureBaseCityDataFn !== "function"
  ) {
    return;
  }
  const run = () => {
    if (runtimeState.bootBlocking || runtimeState.baseCityDataState !== "idle") {
      return;
    }
    void runtimeState.ensureBaseCityDataFn({ reason: "post-ready", renderNow: true }).catch(() => {});
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
  return getDeferredDetailPromotionOwner().hasDetailTopologyLoaded();
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
  return getDeferredDetailPromotionOwner().ensureDetailTopologyReady({
    renderDispatcher,
    requireIdle,
    applyMapData,
    suppressRender,
    interactionLevel,
    deferInteractionInfrastructure,
    flushPendingFocusRefresh,
  });
}

async function unlockStartupReadonlyWithDetail(renderDispatcher) {
  return getDeferredDetailPromotionOwner().unlockStartupReadonlyWithDetail(renderDispatcher);
}

function scheduleStartupReadonlyUnlock(
  renderDispatcher,
  { delayMs = 120, attempt = 0, maxAttempts = 5 } = {},
) {
  return getDeferredDetailPromotionOwner().scheduleStartupReadonlyUnlock(renderDispatcher, {
    delayMs,
    attempt,
    maxAttempts,
  });
}

function scheduleDeferredDetailPromotion(renderDispatcher) {
  const deferredDetailPromotion = getDeferredDetailPromotionOwner();
  return deferredDetailPromotion.scheduleDeferredDetailPromotion(renderDispatcher);
}

async function finalizeReadyState(renderDispatcher) {
  const shouldEnterStartupReadonly = (
    !!String(runtimeState.activeScenarioId || "").trim()
    && runtimeState.startupInteractionMode === "readonly"
    && runtimeState.detailDeferred
    && !hasDetailTopologyLoaded()
  );
  const startupBootstrapStrategy = String(
    runtimeState.activeScenarioManifest?.startup_bootstrap_strategy || ""
  ).trim();
  const shouldUseChunkedCoarseStartup =
    shouldEnterStartupReadonly
    && startupBootstrapStrategy === "chunked-coarse-first";
  if (shouldUseChunkedCoarseStartup) {
    setBootState("interaction-infra", {
      blocking: true,
      progress: Math.max(Number(runtimeState.bootProgress) || 0, getBootProgressWindow("detail-promotion").min),
      canContinueWithoutScenario: false,
    });
    startBootMetric("interaction-infra");
    await buildInteractionInfrastructureAfterStartup({
      chunked: true,
      buildHitCanvas: false,
      mode: "basic",
    });
    finishBootMetric("interaction-infra", {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
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
      progress: Math.max(Number(runtimeState.bootProgress) || 0, getBootProgressWindow("detail-promotion").min),
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
  setBootPreviewVisibleState(state, false);
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
  setStartupInteractionMode(state, resolveStartupInteractionMode());
  setStartupReadonlyState(false);

  let renderDispatcher = null;
  let startupUiBootstrapPromise = null;
  let startupUiBootstrapAwaited = false;
  let startupUiBootstrapFailed = false;
  try {
    bindBeforeUnload();
    // Phase: 加载基础拓扑 | Input: 启动配置与 bootstrap 资源 promise | Output: startupBaseData + 已注入基础 state 字段。
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
    // Phase: 初始化地图骨架 | Input: startup interaction mode + 基础拓扑/语言状态 | Output: map shell + 首次渲染调度器。
    const startupInteractionLevel = runtimeState.startupInteractionMode === "readonly" ? "readonly-startup" : "full";
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
    registerRuntimeHook(state, "renderNowFn", flushRenderNow);
    registerRuntimeHook(state, "ensureDetailTopologyFn", (options = {}) =>
      ensureDetailTopologyReady({
        renderDispatcher,
        ...options,
      }));

    initToast();
    setBootPreviewVisible(false);
    initPresetState();
    void loadDeferredMilsymbol();
    startupUiBootstrapPromise = bootstrapDeferredUi(renderApp);

    // Phase: 应用启动场景 | Input: scenarioBundlePromise + UI bootstrap promise | Output: active scenario state + source/recovery metadata。
    const startupScenarioBoot = getStartupScenarioBootOwner();
    const {
      defaultScenarioBundle,
      scenarioBundleSource,
    } = await startupScenarioBoot.runStartupScenarioBoot({
      d3Client,
      scenarioBundlePromise,
      startupInteractionMode: runtimeState.startupInteractionMode,
    });
    if (startupUiBootstrapPromise) {
      startupUiBootstrapAwaited = true;
      try {
        await startupUiBootstrapPromise;
      } catch (uiBootstrapError) {
        startupUiBootstrapFailed = true;
        throw uiBootstrapError;
      }
      runPostScenarioUiReplay({ full: true });
    }

    setBootState("warmup");
    renderDispatcher.flush();
    checkpointBootMetricOnce("first-visible");
    checkpointBootMetricOnce("first-visible-scenario");
    // Phase: 触发 detail promotion | Input: 当前 scenario/state/renderDispatcher | Output: ready state 或 readonly 解锁调度。
    await finalizeReadyState(renderDispatcher);
    void postStartupSupportKeyUsageReport({
      scenarioId: String(runtimeState.activeScenarioId || defaultScenarioBundle?.manifest?.scenario_id || "").trim(),
      source: scenarioBundleSource,
    });
  } catch (error) {
    let deferredUiBootstrapError = null;
    if (startupUiBootstrapPromise && !startupUiBootstrapAwaited) {
      try {
        await startupUiBootstrapPromise;
      } catch (uiBootstrapError) {
        startupUiBootstrapFailed = true;
        deferredUiBootstrapError = uiBootstrapError;
        console.error("Deferred UI bootstrap failed during startup:", uiBootstrapError);
      }
    }
    runtimeState.scenarioApplyInFlight = false;
    runPostScenarioUiReplay({ full: true });
    finishBootMetric("total", { failed: true });
    console.error("Failed to boot application:", error);
    console.error("Stack trace:", error?.stack);
    setStartupReadonlyState(false);
    const canContinueWithoutScenario =
      !!runtimeState.landData?.features?.length
      && !!renderDispatcher?.flush;
    setBootContinueHandler(canContinueWithoutScenario
      ? async () => {
        if (String(runtimeState.activeScenarioId || "").trim()) {
          await rollbackStartupScenarioToBaseMap();
        }
        if (startupUiBootstrapPromise && !startupUiBootstrapFailed && !deferredUiBootstrapError) {
          await startupUiBootstrapPromise;
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
      progress: runtimeState.bootProgress || getBootProgressWindow("scenario-apply").min,
    });
  }
}

bootstrap();


