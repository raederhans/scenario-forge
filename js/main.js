// App entry point (Phase 13)
import { state as runtimeState } from "./core/state.js";
import "./core/data_service.js";
import {
  setBootPreviewVisibleState,
  setStartupInitialScenarioChunkVisualPromotion,
  setStartupInteractionMode,
  setUiHydrationState,
} from "./core/state/actions/boot_actions.js";
import { createStartupBootOverlayController } from "./bootstrap/startup_boot_overlay.js";
import { createStartupDataPipelineOwner } from "./bootstrap/startup_data_pipeline.js";
import { createDeferredDetailPromotionOwner } from "./bootstrap/deferred_detail_promotion.js";
import { createPostReadyScheduler } from "./bootstrap/post_ready_scheduler.js";
import { createStartupReadyHandoffOwner } from "./bootstrap/startup_ready_handoff.js";
import { registerMainRuntimeDiagnostics } from "./bootstrap/main_runtime_diagnostics.js";
import { createStartupRenderRuntimeBinding } from "./bootstrap/render_runtime_binding.js";
import { handleStartupFailure } from "./bootstrap/startup_failure_recovery.js";
import { isUiShellDebugMode, runUiShellDebugBoot } from "./bootstrap/ui_shell_boot.js";
import { createDeferredMilsymbolLoader } from "./bootstrap/deferred_vendor_loader.js";
import { createDeferredUiBootstrapper } from "./bootstrap/deferred_ui_bootstrap.js";
import { createPageLifetimeModuleLoader, runOptionalStartupTask } from "./bootstrap/startup_lazy_module_loader.js";
import {
  configureStartupSupportKeyUsageAudit,
  getBootLanguage,
  hydrateLanguage,
  initLongAnimationFrameObserver,
  persistViewSettings,
  postStartupSupportKeyUsageReport,
  warnOnStartupBundleIntegrity,
} from "./bootstrap/startup_bootstrap_support.js";
import {
  buildInteractionInfrastructureAfterStartup,
  initMap,
  invalidateAllRenderPasses,
  invalidateContextLayerVisualStateBatch,
  reconcileDetailPromotionPoliticalPass,
  setMapData,
} from "./core/map_renderer/public.js";
import { flushRenderBoundary, requestRender } from "./core/render_boundary.js";
import { callRuntimeHook, registerRuntimeHook } from "./core/state/index.js";
import { runPostScenarioUiReplay } from "./core/scenario_post_apply_effects.js";
import { t } from "./core/i18n.js";
import {
  applyUiShellDebugTerritorySeed,
  revealUiShellDebugTerritoryPanels,
} from "./bootstrap/ui_shell_debug_seed.js";
import { registerMapcreatorSnapshotProvider } from "./core/mapcreator_snapshot.js";
import { updateUIText } from "./ui/i18n.js";
import { bindBeforeUnload } from "./core/dirty_state.js";

const state = runtimeState;
configureStartupSupportKeyUsageAudit();

registerMainRuntimeDiagnostics({
  targetState: state,
  registerSnapshotProvider: registerMapcreatorSnapshotProvider,
});

function requestMainRender(reason = "", { flush = false } = {}) {
  return flush ? flushRenderBoundary(reason) : requestRender(reason);
}

const postReadyScheduler = createPostReadyScheduler({ targetState: runtimeState });
const deferredMilsymbolLoader = createDeferredMilsymbolLoader();
const deferredUiBootstrapper = createDeferredUiBootstrapper();
const bootstrapDeferredUi = deferredUiBootstrapper.bootstrapDeferredUi;

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
let startupReadyHandoffOwner = null;
const startupScenarioBootOwnerLoader = createPageLifetimeModuleLoader({
  importModule: () => import("./bootstrap/startup_scenario_boot.js"),
  createValue: ({ createStartupScenarioBootOwner }) => createStartupScenarioBootOwner({
    runtimeState: state,
    helpers: {
      finishBootMetric,
      setBootState,
      startBootMetric,
      warnOnStartupBundleIntegrity,
    },
  }),
});
const startupSampleProjectDeeplinkModuleLoader = createPageLifetimeModuleLoader({
  importModule: () => import("./bootstrap/startup_sample_project_deeplink.js"),
});

function checkpointFirstVisibleFrameMetrics() {
  if (!state.firstVisibleFramePainted) {
    return null;
  }
  checkpointBootMetricOnce("first-visible");
  if (String(state.activeScenarioId || "").trim()) {
    checkpointBootMetricOnce("first-visible-scenario");
  }
  return state.bootMetrics;
}

function assertStartupFirstVisibleFrameAccepted(reason = "startup-first-visible") {
  const metrics = checkpointFirstVisibleFrameMetrics();
  if (metrics) return metrics;
  const blocked = state.renderPerfMetrics?.firstVisibleFrameBlocked || {};
  const blockReason = String(blocked.blockReason || blocked.reason || state.renderPhase || "unknown");
  throw new Error(`[boot] First visible frame was not accepted after ${reason}: ${blockReason}`);
}

registerRuntimeHook(state, "noteFirstVisibleFramePaintedFn", checkpointFirstVisibleFrameMetrics);

/**
 * Startup owner boundaries:
 * 1) StartupDataPipelineOwner: drives bootstrap data ingestion and base-state hydration.
 * 2) StartupScenarioBootOwner: applies the startup scenario bundle onto hydrated base runtimeState.
 * 3) StartupReadyHandoffOwner: owns ready-state handoff and post-ready work policy.
 * 4) DeferredDetailPromotionOwner: promotes delayed detail topology and unlocks interaction readiness.
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
  return startupScenarioBootOwnerLoader.loadValueOnce();
}

async function tryScheduleStartupSampleProjectDeeplink() {
  return runOptionalStartupTask({
    loadModule: startupSampleProjectDeeplinkModuleLoader.loadModuleOnce,
    run: (sampleProjectDeeplinkModule) => sampleProjectDeeplinkModule.tryScheduleStartupSampleProjectDeeplink({
      targetState: state,
      postReadyScheduler,
      helpers: {
        fetchImpl: typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
        ui: {
          t,
          showToast: (message, options) => callRuntimeHook(state, "showToastFn", message, options),
          showAppDialog: async () => false,
        },
        hooks: {
          refreshColorState: (options) => callRuntimeHook(state, "refreshColorStateFn", options),
        },
        showToast: (message, options) => callRuntimeHook(state, "showToastFn", message, options),
      },
    }),
    onError: (error) => console.warn("[boot] Startup sample project deeplink scheduling failed:", error),
  });
}

function getStartupReadyHandoffOwner() {
  if (startupReadyHandoffOwner) {
    return startupReadyHandoffOwner;
  }
  startupReadyHandoffOwner = createStartupReadyHandoffOwner({
    runtimeState: state,
    postReadyScheduler,
    effects: {
      commitUiHydrationState: (patch) => setUiHydrationState(runtimeState, patch),
      getStartupUiBootstrapPromise: deferredUiBootstrapper.getPromise,
    },
    helpers: {
      buildInteractionInfrastructureAfterStartup,
      checkpointBootMetric,
      completeBootSequenceLogging,
      ensureActiveScenarioBundleHydrated,
      ensureBaseCityDataReady,
      ensureContextLayerDataReady,
      ensureFullLocalizationDataReady,
      reconcileDetailPromotionPoliticalPass,
      requestMainRender,
      scheduleDeferredDetailPromotion,
      shouldFastTrackScenarioHydration,
      consoleWarn: console.warn.bind(console),
    },
  });
  return startupReadyHandoffOwner;
}

function getDeferredDetailPromotionOwner() {
  if (deferredDetailPromotionOwner) {
    return deferredDetailPromotionOwner;
  }
  deferredDetailPromotionOwner = createDeferredDetailPromotionOwner({
    runtimeState: state,
    helpers: {
      buildInteractionInfrastructureAfterStartup,
      canRunPostReadyIdleWork: postReadyScheduler.canRunIdleWork,
      checkpointBootMetric,
      completeBootSequenceLogging,
      finishBootMetric,
      flushPendingScenarioChunkRefreshAfterReady:
        getStartupReadyHandoffOwner().flushPendingScenarioChunkRefreshAfterReady,
      getBootProgressWindow,
      hasStartupReadonlyUnlockScheduled,
      requestMainRender,
      schedulePostReadyDeferredContextWarmup:
        getStartupReadyHandoffOwner().schedulePostReadyDeferredContextWarmup,
      schedulePostReadyHydration:
        getStartupReadyHandoffOwner().schedulePostReadyHydration,
      schedulePostReadyPoliticalReconcile:
        getStartupReadyHandoffOwner().schedulePostReadyPoliticalReconcile,
      schedulePostReadyVisualWarmup:
        getStartupReadyHandoffOwner().schedulePostReadyVisualWarmup,
      scheduleStartupReadonlyUnlockTimer,
      setBootState,
      setStartupReadonlyState,
      startBootMetric,
      startDeferredFullInteractionInfrastructureBuild:
        getStartupReadyHandoffOwner().startDeferredFullInteractionInfrastructureBuild,
      tryScheduleStartupSampleProjectDeeplink,
      warnOnStartupBundleIntegrity,
    },
  });
  return deferredDetailPromotionOwner;
}

async function rollbackStartupScenarioToBaseMap() {
  // 启动失败后的“继续进入基础地图”只负责撤销已激活场景；完整回滚仍由 scenario_manager 的 clear/apply 链路持有。
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

async function ensureBaseCityDataReady(options = {}) {
  return getStartupDataPipelineOwner().ensureBaseCityDataReady(options);
}

async function ensureFullLocalizationDataReady(options = {}) {
  const result = await getStartupDataPipelineOwner().ensureFullLocalizationDataReady(options);
  if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())
    || (options.taskContext && !options.taskContext.isCurrent())) return result;
  updateUIText();
  return result;
}

registerRuntimeHook(state, "ensureFullLocalizationDataReadyFn", ensureFullLocalizationDataReady);

async function ensureActiveScenarioBundleHydrated(options = {}) {
  return getStartupDataPipelineOwner().ensureActiveScenarioBundleHydrated(options);
}

function shouldFastTrackScenarioHydration() {
  return getStartupDataPipelineOwner().shouldFastTrackScenarioHydration();
}

async function ensureContextLayerDataReady(
  requestedLayerNames,
  options = {}
) {
  return getStartupDataPipelineOwner().ensureContextLayerDataReady(requestedLayerNames, options);
}

async function ensureStartupInitialScenarioChunkVisualReady({
  reason = "startup-initial-visual",
  d3Client = globalThis.d3,
} = {}) {
  if (typeof runtimeState.awaitInitialScenarioChunkVisualPromotionFn !== "function") {
    return null;
  }
  const result = await runtimeState.awaitInitialScenarioChunkVisualPromotionFn({
    reason,
    d3Client,
    // Bootstrap owns the first visible frame after promotion readiness. Rendering
    // here would draw it twice when bootstrap invalidates and flushes below.
    renderNow: false,
  });
  setStartupInitialScenarioChunkVisualPromotion(runtimeState, result);
  if (result && result.ok === false) {
    const details = {
      status: String(result.status || "unknown"),
      scenarioId: String(result.scenarioId || ""),
      activeScenarioId: String(result.activeScenarioId || ""),
      selectionVersion: Number(result.selectionVersion || 0),
      shellStatus: String(result.shellStatus || ""),
      promotedVisibleFeatureCount: Number(result.promotedVisibleFeatureCount || 0),
      promotedTotalFeatureCount: Number(result.promotedTotalFeatureCount || 0),
      landFeatureCount: Number(result.landFeatureCount || 0),
      colorCount: Number(result.colorCount || 0),
      pendingVisualPromotion: !!result.pendingVisualPromotion,
      pendingPromotion: !!result.pendingPromotion,
      promotionCommitInFlight: !!result.promotionCommitInFlight,
    };
    throw new Error(
      `[boot] Initial scenario chunk visual promotion did not reach visible readiness: ${JSON.stringify(details)}`
    );
  }
  return result;
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
  // 只在这里决定进入 ready、readonly 等待 detail，或先建 coarse 交互层；上游 bootstrap 只提供当前场景和 renderDispatcher。
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
    // chunked-coarse-first 已有可点击粗粒度政治层，先建 basic hit 基础设施再放行 ready，完整交互设施继续延后。
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
    void tryScheduleStartupSampleProjectDeeplink();
    getStartupReadyHandoffOwner().scheduleReadyPostBootWork(renderDispatcher, "ready-state");
    return;
  }
  if (shouldEnterStartupReadonly) {
    // 非 chunked 的 deferred detail 需要维持启动遮罩和 readonly 状态，等待 detail promotion 解锁后再进入完整交互。
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
  void tryScheduleStartupSampleProjectDeeplink();
  getStartupReadyHandoffOwner().scheduleReadyPostBootWork(renderDispatcher, "ready-state");
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
  deferredUiBootstrapper.reset();
  getStartupReadyHandoffOwner().reset("bootstrap");
  getStartupReadyHandoffOwner().beginUiHydration();
  postReadyScheduler.reset("bootstrap");
  deferredUiBootstrapper.setInteractionState("pending");
  setStartupInteractionMode(state, resolveStartupInteractionMode());
  setStartupReadonlyState(false);

  let renderDispatcher = null;
  let uiHydrationObservation = null;
  const observeUiHydration = () => {
    if (!deferredUiBootstrapper.getPromise() || uiHydrationObservation) {
      return;
    }
    uiHydrationObservation = getStartupReadyHandoffOwner().observePostReadyUiBootstrap(
      {
        runPostScenarioUiReplay,
        handleUiBootstrapReady: async () => {
          deferredUiBootstrapper.setInteractionState("ready");
          void tryScheduleStartupSampleProjectDeeplink();
        },
        handleUiBootstrapFailure: async (uiBootstrapError) => {
          deferredUiBootstrapper.setInteractionState("failed");
          console.error("[boot] Deferred UI hydration failed after map initialization.", uiBootstrapError);
        },
      },
    );
  };
  try {
    bindBeforeUnload();
    if (isUiShellDebugMode()) {
      const uiShellBootResult = await runUiShellDebugBoot({
        targetState: state,
        hooks: {
          onRenderDispatcher: (nextRenderDispatcher) => {
            renderDispatcher = nextRenderDispatcher;
          },
        },
        helpers: {
          applyUiShellDebugTerritorySeed,
          bootstrapDeferredUi,
          checkpointBootMetricOnce,
          completeBootSequenceLogging,
          createStartupRenderRuntimeBinding,
          ensureDetailTopologyReady,
          ensureFullLocalizationDataReady,
          finishBootMetric,
          getBootLanguage,
          initLongAnimationFrameObserver,
          initMap,
          revealUiShellDebugTerritoryPanels,
          runPostScenarioUiReplay,
          setBootPreviewVisible,
          setBootState,
          setMapData,
          startBootMetric,
        },
      });
      renderDispatcher = uiShellBootResult.renderDispatcher;
      getStartupReadyHandoffOwner().markUiHydrationReady();
      deferredUiBootstrapper.setInteractionState("ready");
      return;
    }
    // Phase: 加载基础拓扑 | Input: 启动配置与 bootstrap 资源 promise | Output: startupBaseData + 已注入基础 state 字段。
    // 这一段只建立 base runtimeState 与启动 bundle promise，不应用场景；场景写入必须等 map shell 与 render boundary 建好之后执行。
    setBootState("base-data");
    startBootMetric("base-data");
    const d3Client = globalThis.d3;
    startupScenarioBootOwnerLoader.preload();
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

    const renderRuntime = createStartupRenderRuntimeBinding({
      targetState: state,
      setBootPreviewVisible,
      ensureDetailTopologyReady,
      flushReason: "legacy-render-now",
    });
    renderDispatcher = renderRuntime.renderDispatcher;
    const { renderApp } = renderRuntime;
    void deferredMilsymbolLoader.loadMilsymbol();
    void deferredUiBootstrapper.bootstrapDeferredUi(renderApp);

    // Phase: 应用启动场景 | Input: scenarioBundlePromise + UI bootstrap promise | Output: active scenario state + source/recovery metadata。
    // UI bootstrap 与 scenario apply 并行启动，但 post-scenario UI replay 必须等 UI 绑定完成，避免控件用旧状态覆盖刚应用的场景。
    const startupScenarioBoot = await getStartupScenarioBootOwner();
    const {
      defaultScenarioBundle,
      scenarioBundleSource,
    } = await startupScenarioBoot.runStartupScenarioBoot({
      d3Client,
      scenarioBundlePromise,
      startupInteractionMode: runtimeState.startupInteractionMode,
    });

    if (!Array.isArray(runtimeState.landData?.features) || !runtimeState.landData.features.length) {
      setMapData({
        suppressRender: true,
        interactionLevel: startupInteractionLevel,
        deferInteractionInfrastructure: startupInteractionLevel === "readonly-startup",
      });
    }

    await ensureStartupInitialScenarioChunkVisualReady({
      reason: "startup-initial-visual",
      d3Client,
    });

    setBootState("warmup");
    invalidateAllRenderPasses("bootstrap-first-political-frame");
    renderDispatcher.flush();
    assertStartupFirstVisibleFrameAccepted("bootstrap-first-political-frame");

    // Phase: 触发 detail promotion | Input: 当前 scenario/state/renderDispatcher | Output: ready state 或 readonly 解锁调度。
    await finalizeReadyState(renderDispatcher);
    void observeUiHydration();
    void postStartupSupportKeyUsageReport({
      scenarioId: String(runtimeState.activeScenarioId || defaultScenarioBundle?.manifest?.scenario_id || "").trim(),
      source: scenarioBundleSource,
    });
  } catch (error) {
    void observeUiHydration();
    await handleStartupFailure({
      error,
      targetState: runtimeState,
      renderDispatcher,
      startupUiBootstrapPromise: null,
      startupUiBootstrapAwaited: true,
      startupUiBootstrapFailed: false,
      helpers: {
        finalizeReadyState,
        getBootLanguage,
        getBootProgressWindow,
        checkpointBootMetricOnce,
        finishBootMetric,
        invalidateAllRenderPasses,
        rollbackStartupScenarioToBaseMap,
        runPostScenarioUiReplay,
        setBootContinueHandler,
        setBootState,
        setStartupReadonlyState,
      },
    });
  }
}

bootstrap();
