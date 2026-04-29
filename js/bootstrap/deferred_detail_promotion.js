import { loadDeferredDetailBundle } from "../core/data_loader.js";
import { refreshScenarioDataHealth } from "../core/scenario_data_health.js";
import {
  buildInteractionInfrastructureAfterStartup,
} from "../core/map_renderer/public.js";
import {
  refreshMapDataForScenarioApply,
  setMapData,
} from "../core/scenario/scenario_renderer_bridge.js";
import { getDeferredPromotionDelay } from "./startup_bootstrap_support.js";

const MAX_FORCED_STARTUP_INFRA_RETRIES = 2;

export function createDeferredDetailPromotionOwner({
  runtimeState,
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
    return !!runtimeState.topologyDetail?.objects?.political;
  }

  function getViewportFocusCountryCode() {
    return String(
      runtimeState.activeSovereignCode
      || runtimeState.selectedInspectorCountryCode
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
    if (runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object") {
      runtimeState.runtimeChunkLoadState.focusCountryOverride = focusCountry;
      runtimeState.runtimeChunkLoadState.focusCountryOverrideSource = String(reason || "detail-promotion");
      runtimeState.runtimeChunkLoadState.focusCountryOverrideExpiresAt = Date.now() + 5000;
    }
    if (typeof runtimeState.scheduleScenarioChunkRefreshFn === "function") {
      runtimeState.scheduleScenarioChunkRefreshFn({
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
    if (typeof runtimeState.updateScenarioUIFn === "function") {
      runtimeState.updateScenarioUIFn();
    }
  }

  function applyDetailPromotionMapRefresh({
    interactionLevel = "full",
    deferInteractionInfrastructure = false,
  } = {}) {
    const hasActiveScenario = !!String(runtimeState.activeScenarioId || "").trim();
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
   * 成功路径：加载 detail bundle -> 写入 topology/detail/runtime runtimeState -> 刷新 map data -> 标记 detailPromotionCompleted。
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
      if (runtimeState.topologyBundleMode !== "composite") {
        runtimeState.topologyBundleMode = "composite";
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
      runtimeState.detailDeferred = false;
      runtimeState.detailPromotionCompleted = true;
      syncScenarioReadyUiAfterDetailPromotion();
      return true;
    }

    if (runtimeState.detailPromotionInFlight) return false;
    if (requireIdle && (runtimeState.isInteracting || runtimeState.renderPhase !== "idle")) {
      return false;
    }

    runtimeState.detailPromotionInFlight = true;
    try {
      const {
        topologyDetail,
        runtimePoliticalTopology,
        topologyBundleMode,
        detailSourceUsed,
      } = await loadDeferredDetailBundle({
        detailSourceKey: runtimeState.detailSourceRequested,
      });

      if (!topologyDetail) {
        runtimeState.detailDeferred = false;
        console.warn("[main] Detail promotion skipped: no detail topology was loaded.");
        return false;
      }

      runtimeState.topologyDetail = topologyDetail;
      runtimeState.runtimePoliticalTopology = runtimePoliticalTopology || runtimeState.runtimePoliticalTopology;
      if (!runtimeState.activeScenarioId) {
        runtimeState.defaultRuntimePoliticalTopology = runtimeState.runtimePoliticalTopology || null;
      }
      runtimeState.topologyBundleMode = topologyBundleMode || "composite";
      runtimeState.detailDeferred = false;
      runtimeState.detailPromotionCompleted = true;
      runtimeState.detailSourceRequested = detailSourceUsed || runtimeState.detailSourceRequested;

      console.info(
        `[main] Detail promotion applied. source=${runtimeState.detailSourceRequested}, mode=${runtimeState.topologyBundleMode}.`
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
      runtimeState.detailPromotionInFlight = false;
    }
  }

  async function unlockStartupReadonlyWithDetail(renderDispatcher) {
    // 事务：startup readonly 解锁。
    // 成功路径：detail promotion 成功 + interaction infra basic 构建完成 -> 进入 ready 并释放 readonly。
    // 恢复路径：detail promotion 未就绪 -> 记录失败指标并保持 readonly，等待后续调度重试。
    if (!runtimeState.startupReadonly || runtimeState.startupReadonlyUnlockInFlight) {
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
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
      });
      const activeScenarioId = String(runtimeState.activeScenarioId || "").trim();
      const cachedBundle = activeScenarioId
        ? runtimeState.scenarioBundleCacheById?.[activeScenarioId] || null
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
    if (!runtimeState.startupReadonly || runtimeState.startupReadonlyUnlockInFlight || hasStartupReadonlyUnlockScheduled?.()) {
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
            activeScenarioId: String(runtimeState.activeScenarioId || ""),
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
            progress: runtimeState.bootProgress || getBootProgressWindow?.("interaction-infra")?.min,
          });
        });
        return;
      }
      void unlockStartupReadonlyWithDetail(renderDispatcher).then((unlocked) => {
        if (!unlocked && runtimeState.startupReadonly) {
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
      !runtimeState.detailDeferred ||
      runtimeState.detailPromotionCompleted ||
      runtimeState.detailPromotionInFlight ||
      deferredPromotionHandle !== null
    ) {
      return;
    }

    const runPromotion = async () => {
      deferredPromotionHandle = null;
      if (!runtimeState.detailDeferred || runtimeState.detailPromotionCompleted || runtimeState.detailPromotionInFlight) {
        return;
      }
      if (!canRunPostReadyIdleWork?.({ allowChunkBacklog: true })) {
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
      if (!promoted && (runtimeState.isInteracting || runtimeState.renderPhase !== "idle")) {
        scheduleDeferredDetailPromotion(renderDispatcher);
      }
    };

    const delayMs = getDeferredPromotionDelay(runtimeState.renderProfile);
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

