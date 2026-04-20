import { loadDeferredDetailBundle } from "../core/data_loader.js";
import { refreshScenarioDataHealth } from "../core/scenario_data_health.js";
import {
  buildInteractionInfrastructureAfterStartup,
  refreshMapDataForScenarioApply,
  setMapData,
} from "../core/map_renderer.js";
import { getDeferredPromotionDelay } from "./startup_bootstrap_support.js";

const MAX_FORCED_STARTUP_INFRA_RETRIES = 2;

export function createDeferredDetailPromotionOwner({
  state,
  helpers = {},
} = {}) {
  const {
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
  } = helpers;

  let deferredPromotionHandle = null;
  let forcedStartupReadonlyInfraRetryCount = 0;

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

  /**
   * 事务：detail topology 准备。
   * 成功路径：加载 detail bundle -> 写入 topology/detail/runtime state -> 刷新 map data -> 标记 detailPromotionCompleted。
   * 恢复路径：加载失败或无 topologyDetail 时保留当前可运行状态并返回 false，调用方按既有启动路径继续。
   */
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
              requestMainRender?.("detail-topology-ready");
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
            requestMainRender?.("detail-topology-promoted");
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
    // 事务：startup readonly 解锁。
    // 成功路径：detail promotion 成功 + interaction infra basic 构建完成 -> 进入 ready 并释放 readonly。
    // 恢复路径：detail promotion 未就绪 -> 记录失败指标并保持 readonly，等待后续调度重试。
    if (!state.startupReadonly || state.startupReadonlyUnlockInFlight) {
      return false;
    }
    setStartupReadonlyState?.(true, {
      reason: "detail-promotion",
      unlockInFlight: true,
    });
    startBootMetric?.("startup-readonly:unlock");
    startBootMetric?.("detail-promotion");
    setBootState?.("detail-promotion", {
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
        finishBootMetric?.("detail-promotion", {
          failed: true,
        });
        finishBootMetric?.("startup-readonly:unlock", {
          failed: true,
        });
        setStartupReadonlyState?.(true, {
          reason: "detail-promotion-failed",
          unlockInFlight: false,
        });
        return false;
      }
      finishBootMetric?.("detail-promotion", {
        activeScenarioId: String(state.activeScenarioId || ""),
      });
      const activeScenarioId = String(state.activeScenarioId || "").trim();
      const cachedBundle = activeScenarioId
        ? state.scenarioBundleCacheById?.[activeScenarioId] || null
        : null;
      if (cachedBundle?.manifest) {
        warnOnStartupBundleIntegrity?.(cachedBundle, {
          source: cachedBundle?.loadDiagnostics?.startupBundle ? "startup-bundle" : "legacy",
        });
      }
      renderDispatcher?.flush?.();
      setBootState?.("interaction-infra", {
        blocking: true,
        canContinueWithoutScenario: false,
      });
      startBootMetric?.("interaction-infra");
      await buildInteractionInfrastructureAfterStartup({
        chunked: true,
        buildHitCanvas: false,
        mode: "basic",
      });
      finishBootMetric?.("interaction-infra", {
        activeScenarioId,
      });
      finishBootMetric?.("startup-readonly:unlock", {
        activeScenarioId,
      });
      setStartupReadonlyState?.(false);
      checkpointBootMetric?.("startup-readonly:unlocked");
      checkpointBootMetric?.("time-to-interactive");
      checkpointBootMetric?.("first-interactive");
      setBootState?.("ready", {
        blocking: false,
        progress: 100,
        canContinueWithoutScenario: false,
      });
      completeBootSequenceLogging?.();
      flushPendingScenarioChunkRefreshAfterReady?.("startup-readonly-unlocked");
      startDeferredFullInteractionInfrastructureBuild?.("startup-readonly-unlocked");
      schedulePostReadyHydration?.();
      schedulePostReadyDeferredContextWarmup?.();
      schedulePostReadyVisualWarmup?.();
      return true;
    } catch (error) {
      finishBootMetric?.("detail-promotion", {
        failed: true,
        errorMessage: error?.message || String(error || "Unknown detail promotion error."),
      });
      finishBootMetric?.("interaction-infra", {
        failed: true,
        errorMessage: error?.message || String(error || "Unknown interaction infrastructure error."),
      });
      finishBootMetric?.("startup-readonly:unlock", {
        failed: true,
        errorMessage: error?.message || String(error || "Unknown startup readonly unlock error."),
      });
      console.warn("[boot] Startup readonly unlock failed:", error);
      setStartupReadonlyState?.(true, {
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
    if (!state.startupReadonly || state.startupReadonlyUnlockInFlight || hasStartupReadonlyUnlockScheduled?.()) {
      return;
    }
    scheduleStartupReadonlyUnlockTimer?.(() => {
      if (attempt >= maxAttempts) {
        console.warn(`[boot] Startup readonly unlock failed after ${maxAttempts} attempts, force-unlocking.`);
        setStartupReadonlyState?.(true, {
          reason: "detail-promotion-failed",
          unlockInFlight: true,
        });
        setBootState?.("interaction-infra", {
          blocking: true,
          canContinueWithoutScenario: false,
        });
        startBootMetric?.("interaction-infra");
        void buildInteractionInfrastructureAfterStartup({
          chunked: true,
          buildHitCanvas: false,
          mode: "basic",
        }).then(() => {
          forcedStartupReadonlyInfraRetryCount = 0;
          finishBootMetric?.("interaction-infra", {
            activeScenarioId: String(state.activeScenarioId || ""),
            forced: true,
          });
          setStartupReadonlyState?.(false);
          setBootState?.("ready", {
            blocking: false,
            progress: 100,
            canContinueWithoutScenario: false,
          });
          checkpointBootMetric?.("time-to-interactive");
          checkpointBootMetric?.("first-interactive");
          completeBootSequenceLogging?.();
          flushPendingScenarioChunkRefreshAfterReady?.("startup-readonly-force-unlocked");
          startDeferredFullInteractionInfrastructureBuild?.("startup-readonly-force-unlocked");
          scheduleDeferredDetailPromotion(renderDispatcher);
          schedulePostReadyHydration?.();
          schedulePostReadyDeferredContextWarmup?.();
          schedulePostReadyVisualWarmup?.();
        }).catch((error) => {
          finishBootMetric?.("interaction-infra", {
            failed: true,
            forced: true,
            errorMessage: error?.message || String(error || "Unknown interaction infrastructure error."),
          });
          console.warn("[boot] Forced startup readonly unlock interaction infra build failed:", error);
          setStartupReadonlyState?.(true, {
            reason: "interaction-infra-failed",
            unlockInFlight: false,
          });
          setBootState?.("interaction-infra", {
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
          setStartupReadonlyState?.(false);
          setBootState?.("error", {
            error: error?.message || "Failed to initialize interaction infrastructure during startup recovery.",
            canContinueWithoutScenario: false,
            progress: state.bootProgress || getBootProgressWindow?.("interaction-infra")?.min,
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
      if (!canRunPostReadyIdleWork?.()) {
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

  return {
    ensureDetailTopologyReady,
    hasDetailTopologyLoaded,
    scheduleDeferredDetailPromotion,
    scheduleStartupReadonlyUnlock,
    unlockStartupReadonlyWithDetail,
  };
}
