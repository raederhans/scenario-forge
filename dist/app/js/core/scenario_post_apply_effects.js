import {
  STATE_BUS_EVENTS,
  emitStateBusEvent,
} from "./state/index.js";
import { state as runtimeState } from "./state.js";
import {
  setScenarioPerfMetricState,
} from "./state/scenario_runtime_state.js";
import {
  createScenarioApplyRefreshPlan,
  refreshMapDataForScenarioApply,
  refreshScenarioOpeningOwnerBorders,
  setMapData,
} from "./scenario/scenario_renderer_bridge.js";
import { rebuildPresetState } from "./releasable_manager.js";
import { refreshScenarioDataHealth } from "./scenario_data_health.js";
import {
  ensureActiveScenarioOptionalLayersForVisibility,
  preloadScenarioCoarseChunks,
  preloadScenarioFocusCountryPoliticalDetailChunk,
  scheduleScenarioChunkRefresh,
  scenarioSupportsChunkedRuntime,
} from "./scenario_resources.js";
import {
  recordRenderTransactionSnapshot,
} from "./renderer/render_transaction_diagnostics.js";
import {
  syncResolvedDefaultCountryPalette,
} from "./palette_manager.js";
import { refreshScenarioShellOverlays } from "./scenario_shell_overlay.js";
import { syncCountryUi, syncScenarioUi } from "./scenario_ui_sync.js";
import { requestRender } from "./render_boundary.js";

function runPaletteAndToolbarRefreshCallbacks() {
  // scenario apply / reset / rollback 都会复用这一批 UI 回放事件，
  // 这样地图数据刷新和各 owner 的可见状态能在同一轮里重新对齐。
  emitStateBusEvent(STATE_BUS_EVENTS.RENDER_PALETTE, runtimeState.currentPaletteTheme);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_PALETTE_LIBRARY);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_PALETTE_SOURCE);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_PARENT_BORDER_COUNTRY_LIST);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_PAINT_MODE);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_WATER_INTERACTION);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_SPECIAL_REGION);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_RELIEF_OVERLAY);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DYNAMIC_BORDER_STATUS);
}

function publishScenarioPaletteAndToolbarState({
  overwriteCountryPalette = false,
} = {}) {
  const resolvedDefaults = syncResolvedDefaultCountryPalette({
    overwriteCountryPalette,
  });
  runPaletteAndToolbarRefreshCallbacks();
  return resolvedDefaults;
}

function runPostScenarioUiReplay({ full = true, renderNow = false } = {}) {
  publishScenarioPaletteAndToolbarState();
  if (full) {
    syncCountryUi({ renderNow });
  }
}

function scheduleAfterFirstFrame(callback) {
  if (typeof callback !== "function") return;
  const runAsync = () => {
    if (typeof globalThis.setTimeout === "function") {
      globalThis.setTimeout(callback, 0);
      return;
    }
    callback();
  };
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => {
          runAsync();
        });
        return;
      }
      runAsync();
    });
    return;
  }
  runAsync();
}

function shouldSuppressChunkedPostApplyDataHealthSignals({
  hasChunkedRuntime = false,
  prewarmFailed = false,
  chunkErrorCount = 0,
} = {}) {
  return hasChunkedRuntime === true
    && prewarmFailed !== true
    && Math.max(0, Number(chunkErrorCount || 0)) === 0;
}

function getScenarioChunkLoadErrorCount() {
  return Object.keys(runtimeState.runtimeChunkLoadState?.errorByChunkId || {}).length;
}

function hasPendingScenarioChunkWork(loadState = runtimeState.runtimeChunkLoadState) {
  return !!(
    String(loadState?.shellStatus || "") === "loading"
    || String(loadState?.pendingReason || "").trim()
    || loadState?.refreshScheduled
    || loadState?.pendingPromotion
    || loadState?.pendingVisualPromotion
    || loadState?.pendingInfraPromotion
    || loadState?.promotionScheduled
    || loadState?.promotionCommitInFlight
    || loadState?.pendingPostCommitRefresh
    || Object.keys(loadState?.inFlightByChunkId || {}).length
  );
}

function recordScenarioPostApplySnapshot({
  phase = "",
  reason = "scenario-post-apply",
  expectedScenarioId = "",
  extra = {},
} = {}) {
  return recordRenderTransactionSnapshot(runtimeState, {
    phase,
    reason,
    expectedScenarioId,
    source: "scenario_post_apply_effects",
    extra,
  });
}

function scheduleScenarioDataHealthSyncAfterChunkSettle(context, attempt = 0) {
  if (!shouldContinueScenarioApplyContext(context, "detail-prewarm-health-sync")) return;
  if (hasPendingScenarioChunkWork()) {
    if (attempt >= 120) {
      recordScenarioPostApplySnapshot({
        phase: "scenario-detail-health-settle-timeout",
        reason: context.reason,
        expectedScenarioId: context.scenarioId,
        extra: {
          attempt,
          scenarioApplyEpoch: context.scenarioApplyEpoch,
          scenarioApplyRequestId: context.scenarioApplyRequestId,
          shellStatus: String(runtimeState.runtimeChunkLoadState?.shellStatus || ""),
          pendingReason: String(runtimeState.runtimeChunkLoadState?.pendingReason || ""),
        },
      });
      return;
    }
    globalThis.setTimeout(() => {
      scheduleScenarioDataHealthSyncAfterChunkSettle(context, attempt + 1);
    }, 100);
    return;
  }
  const chunkErrorCount = getScenarioChunkLoadErrorCount();
  const dataHealth = refreshScenarioDataHealth({
    showWarningToast: chunkErrorCount > 0,
    showErrorToast: chunkErrorCount > 0,
  });
  syncScenarioUi();
  recordScenarioPostApplySnapshot({
    phase: "scenario-detail-health-settled",
    reason: context.reason,
    expectedScenarioId: context.scenarioId,
    extra: {
      attempt,
      chunkErrorCount,
      scenarioApplyEpoch: context.scenarioApplyEpoch,
      scenarioApplyRequestId: context.scenarioApplyRequestId,
      warning: String(dataHealth?.warning || ""),
    },
  });
}

function updateChunkedFirstFramePrewarmMetric(details = {}, { replace = false } = {}) {
  return setScenarioPerfMetricState(runtimeState, "chunkedFirstFramePrewarm", {
    ...details,
    recordedAt: Date.now(),
  }, { merge: !replace });
}

function getCurrentScenarioApplyRequestId() {
  return Math.max(0, Number(runtimeState.currentScenarioApplyRequestId || 0));
}

function isScenarioApplyContextCurrent({
  scenarioId = "",
  scenarioApplyRequestId = 0,
  isScenarioApplyRequestCurrent = null,
} = {}) {
  if (typeof isScenarioApplyRequestCurrent === "function" && !isScenarioApplyRequestCurrent()) {
    return false;
  }
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (normalizedScenarioId && normalizedScenarioId !== String(runtimeState.activeScenarioId || "").trim()) {
    return false;
  }
  const expectedRequestId = Math.max(0, Number(scenarioApplyRequestId || 0));
  const currentRequestId = getCurrentScenarioApplyRequestId();
  return !(expectedRequestId > 0 && currentRequestId > 0 && expectedRequestId !== currentRequestId);
}

function recordScenarioApplyStaleCallbackSkipped({
  callbackPhase = "",
  reason = "scenario-post-apply",
  scenarioId = "",
  scenarioApplyEpoch = 0,
  scenarioApplyRequestId = 0,
  extra = {},
} = {}) {
  recordScenarioPostApplySnapshot({
    phase: "scenario-apply-stale-callback-skipped",
    reason,
    expectedScenarioId: scenarioId,
    extra: {
      ...extra,
      allowScenarioMismatch: true,
      callbackPhase,
      resolution: "skipped-stale-request",
      scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
      scenarioApplyRequestId: Math.max(0, Number(scenarioApplyRequestId || 0)),
      currentScenarioApplyRequestId: getCurrentScenarioApplyRequestId(),
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    },
  });
}

function shouldContinueScenarioApplyContext(context, callbackPhase) {
  if (isScenarioApplyContextCurrent(context)) {
    return true;
  }
  recordScenarioApplyStaleCallbackSkipped({
    ...context,
    callbackPhase,
  });
  return false;
}

function scheduleScenarioDetailChunkPrewarm({
  bundle,
  scenarioId = "",
  prewarmStartedAt = 0,
  scenarioApplyEpoch = 0,
  scenarioApplyRequestId = 0,
  isScenarioApplyRequestCurrent = null,
} = {}) {
  // 细节政治块只在首帧已经交给 coarse 数据兜住可见性的前提下异步补齐。
  // 这里重复检查 activeScenarioId，是为了避免用户在等待期间切剧本后把旧 detail 刷回当前页面。
  if (!scenarioSupportsChunkedRuntime(bundle)) return;
  const normalizedScenarioId = String(scenarioId || "").trim();
  const transactionScenarioApplyEpoch = Math.max(0, Number(scenarioApplyEpoch || bundle?.chunkLifecycle?.scenarioApplyEpoch || 0));
  const transactionScenarioApplyRequestId = Math.max(0, Number(scenarioApplyRequestId || bundle?.chunkLifecycle?.scenarioApplyRequestId || 0));
  const currentnessContext = {
    scenarioId: normalizedScenarioId,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason: "scenario-apply-detail-prewarm",
  };
  scheduleAfterFirstFrame(() => {
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-detail-prewarm-scheduled",
      reason: "scenario-apply-detail-prewarm",
      expectedScenarioId: normalizedScenarioId,
      source: "scenario_post_apply_effects",
      extra: {
        prewarmStartedAt,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    void (async () => {
      if (!shouldContinueScenarioApplyContext(currentnessContext, "detail-prewarm-before-load")) {
        return;
      }
      const detailPrewarmStartedAt = Date.now();
      updateChunkedFirstFramePrewarmMetric({
        scenarioId: normalizedScenarioId,
        mode: "async",
        synchronous: false,
        prewarmStartedAt,
        detailPrewarmStartedAt,
      });
      try {
        await preloadScenarioFocusCountryPoliticalDetailChunk(bundle);
        if (!shouldContinueScenarioApplyContext(currentnessContext, "detail-prewarm-after-load")) {
          return;
        }
        scheduleScenarioChunkRefresh({
          reason: "scenario-apply-detail-prewarm",
          delayMs: 0,
          refreshSourceStartedAtMs: prewarmStartedAt,
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
        });
        scheduleScenarioDataHealthSyncAfterChunkSettle(currentnessContext);
        updateChunkedFirstFramePrewarmMetric({
          scenarioId: normalizedScenarioId,
          mode: "async",
          synchronous: false,
          prewarmStartedAt,
          detailPrewarmStartedAt,
          detailPrewarmCompletedAt: Date.now(),
        });
        recordRenderTransactionSnapshot(runtimeState, {
          phase: "scenario-detail-prewarm-complete",
          reason: "scenario-apply-detail-prewarm",
          expectedScenarioId: normalizedScenarioId,
          source: "scenario_post_apply_effects",
          extra: {
            prewarmStartedAt,
            detailPrewarmStartedAt,
            scenarioApplyEpoch: transactionScenarioApplyEpoch,
            scenarioApplyRequestId: transactionScenarioApplyRequestId,
            status: "committed",
          },
        });
      } catch (error) {
        console.warn(`[scenario] Detail chunk prewarm failed for "${scenarioId}".`, error);
        if (!shouldContinueScenarioApplyContext(currentnessContext, "detail-prewarm-failed")) {
          return;
        }
        refreshScenarioDataHealth({ showWarningToast: true, showErrorToast: true });
        syncScenarioUi();
        updateChunkedFirstFramePrewarmMetric({
          scenarioId: normalizedScenarioId,
          mode: "async",
          synchronous: false,
          prewarmStartedAt,
          detailPrewarmStartedAt,
          detailPrewarmCompletedAt: Date.now(),
          detailPrewarmFailed: true,
          detailPrewarmFailure: String(error?.message || error || "Unknown detail prewarm error"),
        });
        recordRenderTransactionSnapshot(runtimeState, {
          phase: "scenario-detail-prewarm-failed",
          reason: "scenario-apply-detail-prewarm",
          expectedScenarioId: normalizedScenarioId,
          source: "scenario_post_apply_effects",
          extra: {
            prewarmStartedAt,
            detailPrewarmStartedAt,
            scenarioApplyEpoch: transactionScenarioApplyEpoch,
            scenarioApplyRequestId: transactionScenarioApplyRequestId,
            error: String(error?.message || error || "Unknown detail prewarm error"),
          },
        });
      }
    })();
  });
}

async function ensureChunkedScenarioFirstFrameReady({
  bundle,
  scenarioId = "",
  awaitPrewarm = true,
  scenarioApplyEpoch = 0,
  scenarioApplyRequestId = 0,
  isScenarioApplyRequestCurrent = null,
} = {}) {
  // 这里负责“apply 成功后第一眼必须看见什么”：
  // coarse chunk 永远先到位，focus detail 只在 manifest 明确要求时同步阻塞。
  if (!scenarioSupportsChunkedRuntime(bundle)) {
    return { chunkPrewarmAwaited: true, chunkPrewarmDeferred: false };
  }
  const normalizedScenarioId = String(scenarioId || "").trim();
  const transactionScenarioApplyEpoch = Math.max(0, Number(scenarioApplyEpoch || bundle?.chunkLifecycle?.scenarioApplyEpoch || 0));
  const transactionScenarioApplyRequestId = Math.max(0, Number(scenarioApplyRequestId || bundle?.chunkLifecycle?.scenarioApplyRequestId || 0));
  const currentnessContext = {
    scenarioId: normalizedScenarioId,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason: "scenario-apply",
  };
  const synchronous = shouldSynchronouslyPrewarmChunkedScenario(bundle);
  const normalizedMode = synchronous ? "sync" : "async";
  const prewarmStartedAt = Date.now();
  const shouldAwaitPrewarm = awaitPrewarm !== false || synchronous;
  let prewarmStatus = {
    chunkPrewarmAwaited: shouldAwaitPrewarm,
    chunkPrewarmDeferred: !shouldAwaitPrewarm,
    coarsePrewarmCommitted: false,
  };
  updateChunkedFirstFramePrewarmMetric({
    scenarioId: normalizedScenarioId,
    mode: normalizedMode,
    synchronous: normalizedMode === "sync",
    awaited: shouldAwaitPrewarm,
    coarsePrewarmAwaited: shouldAwaitPrewarm,
    coarsePrewarmCommitted: false,
    prewarmStartedAt,
  }, { replace: true });
  recordRenderTransactionSnapshot(runtimeState, {
    phase: "scenario-coarse-prewarm-start",
    reason: "scenario-apply",
    expectedScenarioId: normalizedScenarioId,
    source: "scenario_post_apply_effects",
    extra: {
      prewarmStartedAt,
      awaited: shouldAwaitPrewarm,
      synchronous: normalizedMode === "sync",
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    },
  });
  if (!shouldContinueScenarioApplyContext(currentnessContext, "coarse-prewarm-start")) {
    return prewarmStatus;
  }
  if (awaitPrewarm === false && !synchronous) {
    const refreshScheduledAt = Date.now();
    // Startup boot already has a shell/core frame; chunk refresh can hydrate the full coarse selection after apply.
    scheduleScenarioChunkRefresh({
      reason: "scenario-apply",
      delayMs: 0,
      refreshSourceStartedAtMs: prewarmStartedAt,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    });
    updateChunkedFirstFramePrewarmMetric({
      scenarioId: normalizedScenarioId,
      mode: normalizedMode,
      synchronous: false,
      awaited: false,
      coarsePrewarmAwaited: false,
      chunkPrewarmDeferred: true,
      coarsePrewarmCommitted: false,
      prewarmStartedAt,
      prewarmDeferredAt: refreshScheduledAt,
      refreshScheduledAt,
      coarsePrewarmDeferredAt: refreshScheduledAt,
      chunkRefreshScheduledAt: refreshScheduledAt,
    });
    scheduleScenarioDetailChunkPrewarm({
      bundle,
      scenarioId: normalizedScenarioId,
      prewarmStartedAt,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
      isScenarioApplyRequestCurrent,
    });
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-coarse-prewarm-deferred",
      reason: "scenario-apply",
      expectedScenarioId: normalizedScenarioId,
      source: "scenario_post_apply_effects",
      extra: {
        prewarmStartedAt,
        refreshScheduledAt,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        status: "deferred",
      },
    });
    return {
      chunkPrewarmAwaited: false,
      chunkPrewarmDeferred: true,
      coarsePrewarmCommitted: false,
      chunkRefreshScheduledAt: refreshScheduledAt,
    };
  }
  let prewarmCompletedAt = 0;
  let coarsePrewarmCommitted = false;
  try {
    const coarsePayload = await preloadScenarioCoarseChunks(bundle);
    coarsePrewarmCommitted = !!coarsePayload;
    if (synchronous) {
      await preloadScenarioFocusCountryPoliticalDetailChunk(bundle);
    }
    if (!shouldContinueScenarioApplyContext(currentnessContext, "coarse-prewarm-after-load")) {
      return prewarmStatus;
    }
    prewarmCompletedAt = Date.now();
    updateChunkedFirstFramePrewarmMetric({
      scenarioId: normalizedScenarioId,
      mode: normalizedMode,
      synchronous,
      awaited: true,
      coarsePrewarmAwaited: true,
      chunkPrewarmDeferred: false,
      coarsePrewarmCommitted,
      prewarmStartedAt,
      prewarmCompletedAt,
      coarsePrewarmCompletedAt: prewarmCompletedAt,
    });
    prewarmStatus = {
      chunkPrewarmAwaited: true,
      chunkPrewarmDeferred: false,
      coarsePrewarmCommitted,
      coarsePrewarmCompletedAt: prewarmCompletedAt,
    };
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-coarse-prewarm-complete",
      reason: "scenario-apply",
      expectedScenarioId: normalizedScenarioId,
      source: "scenario_post_apply_effects",
      extra: {
        prewarmStartedAt,
        prewarmCompletedAt,
        coarsePrewarmCommitted,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        status: coarsePrewarmCommitted ? "committed" : "empty",
      },
    });
  } catch (error) {
    console.warn(`[scenario] Coarse chunk prewarm failed for "${scenarioId}".`, error);
    if (!shouldContinueScenarioApplyContext(currentnessContext, "coarse-prewarm-failed")) {
      return prewarmStatus;
    }
    const failedAt = prewarmCompletedAt || Date.now();
    updateChunkedFirstFramePrewarmMetric({
      scenarioId: normalizedScenarioId,
      mode: normalizedMode,
      synchronous,
      awaited: true,
      coarsePrewarmAwaited: true,
      chunkPrewarmDeferred: false,
      coarsePrewarmCommitted,
      prewarmStartedAt,
      prewarmCompletedAt: failedAt,
      coarsePrewarmCompletedAt: failedAt,
      prewarmFailed: true,
      prewarmFailure: String(error?.message || error || "Unknown prewarm error"),
    });
    prewarmStatus = {
      chunkPrewarmAwaited: true,
      chunkPrewarmDeferred: false,
      coarsePrewarmCommitted,
      coarsePrewarmCompletedAt: failedAt,
      prewarmFailed: true,
    };
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-coarse-prewarm-failed",
      reason: "scenario-apply",
      expectedScenarioId: normalizedScenarioId,
      source: "scenario_post_apply_effects",
      extra: {
        prewarmStartedAt,
        prewarmCompletedAt: failedAt,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        error: String(error?.message || error || "Unknown prewarm error"),
      },
    });
  } finally {
    if (!shouldContinueScenarioApplyContext(currentnessContext, "coarse-prewarm-finally-refresh")) {
      return prewarmStatus;
    }
    const refreshScheduledAt = Date.now();
    scheduleScenarioChunkRefresh({
      reason: "scenario-apply",
      delayMs: 0,
      refreshSourceStartedAtMs: prewarmStartedAt,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    });
    updateChunkedFirstFramePrewarmMetric({
      scenarioId: normalizedScenarioId,
      mode: normalizedMode,
      synchronous,
      prewarmStartedAt,
      prewarmCompletedAt: prewarmCompletedAt || Date.now(),
      refreshScheduledAt,
      chunkRefreshScheduledAt: refreshScheduledAt,
    });
    if (!synchronous) {
      scheduleScenarioDetailChunkPrewarm({
        bundle,
        scenarioId: normalizedScenarioId,
        prewarmStartedAt,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        isScenarioApplyRequestCurrent,
      });
    }
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-coarse-prewarm-refresh-scheduled",
      reason: "scenario-apply",
      expectedScenarioId: normalizedScenarioId,
      source: "scenario_post_apply_effects",
      extra: {
        prewarmStartedAt,
        refreshScheduledAt,
        coarsePrewarmCommitted,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
  }
  return prewarmStatus;
}

function shouldSynchronouslyPrewarmChunkedScenario(bundle) {
  if (!scenarioSupportsChunkedRuntime(bundle)) return false;
  const hints = bundle?.manifest?.performance_hints && typeof bundle.manifest.performance_hints === "object"
    ? bundle.manifest.performance_hints
    : {};
  // Coarse chunks are still first-frame required; focus detail only blocks apply when a scenario opts in.
  return hints.sync_focus_detail_prewarm_default === true;
}

async function syncVisibleScenarioOptionalLayersForPostApply({
  bundle,
  scenarioId = "",
  renderNow = false,
  scenarioApplyEpoch = 0,
  scenarioApplyRequestId = 0,
  isScenarioApplyRequestCurrent = null,
} = {}) {
  if (runtimeState.bootBlocking) {
    return;
  }
  const transactionScenarioApplyEpoch = Math.max(0, Number(scenarioApplyEpoch || bundle?.chunkLifecycle?.scenarioApplyEpoch || 0));
  const transactionScenarioApplyRequestId = Math.max(0, Number(scenarioApplyRequestId || bundle?.chunkLifecycle?.scenarioApplyRequestId || 0));
  const currentnessContext = {
    scenarioId,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason: "scenario-post-apply",
  };
  if (!shouldContinueScenarioApplyContext(currentnessContext, "optional-layer-sync-start")) {
    return;
  }
  recordRenderTransactionSnapshot(runtimeState, {
    phase: "scenario-optional-layers-post-apply-start",
    reason: "scenario-post-apply",
    expectedScenarioId: scenarioId,
    source: "scenario_post_apply_effects",
    extra: {
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    },
  });
  await ensureActiveScenarioOptionalLayersForVisibility({
    bundle,
    renderNow,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
  })
    .catch((error) => {
      console.warn(`[scenario] Optional layer visibility sync failed for "${scenarioId}".`, error);
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-optional-layers-post-apply-failed",
        reason: "scenario-post-apply",
        expectedScenarioId: scenarioId,
        source: "scenario_post_apply_effects",
        extra: {
          scenarioApplyEpoch: transactionScenarioApplyEpoch,
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
          error: String(error?.message || error || "Unknown optional layer sync error"),
        },
      });
    });
  if (!shouldContinueScenarioApplyContext(currentnessContext, "optional-layer-sync-complete")) {
    return;
  }
  recordRenderTransactionSnapshot(runtimeState, {
    phase: "scenario-optional-layers-post-apply-complete",
    reason: "scenario-post-apply",
    expectedScenarioId: scenarioId,
    source: "scenario_post_apply_effects",
    extra: {
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    },
  });
}

async function runPostScenarioApplyEffects({
  bundle,
  scenarioId = "",
  deferChunkPrewarm = false,
  deferOptionalLayers = false,
  renderNow = false,
  suppressRender = false,
  scenarioApplyEpoch = 0,
  scenarioApplyRequestId = 0,
  isScenarioApplyRequestCurrent = null,
} = {}) {
  // post-apply 只收口 apply 之后的可见修复和 UI 回放。
  // 真正的 scenario state 提交已经在更早阶段完成，这里避免再引入第二套写口。
  const useSingleFinalRender = !!renderNow && !suppressRender;
  const refreshPlan = createScenarioApplyRefreshPlan({
    refreshOpeningOwnerBorders: false,
  });
  const transactionScenarioApplyEpoch = Math.max(0, Number(scenarioApplyEpoch || bundle?.chunkLifecycle?.scenarioApplyEpoch || 0));
  const transactionScenarioApplyRequestId = Math.max(0, Number(scenarioApplyRequestId || bundle?.chunkLifecycle?.scenarioApplyRequestId || 0));
  const currentnessContext = {
    scenarioId,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason: "scenario-post-apply",
  };
  let scenarioMapRefreshMode = "light";
  try {
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-refresh-map-data-start",
      reason: "scenario-post-apply",
      expectedScenarioId: scenarioId,
      source: "scenario_post_apply_effects",
      extra: {
        mode: "light",
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    refreshMapDataForScenarioApply({
      suppressRender: useSingleFinalRender ? true : suppressRender,
      refreshPlan,
    });
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-refresh-map-data-complete",
      reason: "scenario-post-apply",
      expectedScenarioId: scenarioId,
      source: "scenario_post_apply_effects",
      extra: {
        mode: "light",
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
  } catch (refreshError) {
    scenarioMapRefreshMode = "setMapData-fallback";
    console.warn("[scenario] Lightweight scenario apply refresh failed; falling back to setMapData.", refreshError);
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-refresh-map-data-fallback",
      reason: "scenario-post-apply",
      expectedScenarioId: scenarioId,
      source: "scenario_post_apply_effects",
      extra: {
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        error: String(refreshError?.message || refreshError || "Unknown refresh error"),
      },
    });
    setMapData({
      refitProjection: false,
      resetZoom: false,
      suppressRender: useSingleFinalRender ? true : suppressRender,
    });
  }
  rebuildPresetState();
  refreshScenarioShellOverlays({
    renderNow: false,
    borderReason: `scenario:${scenarioId}`,
    refreshOpeningOwnerBorders: false,
  });
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario:${scenarioId}:opening` });
  let chunkPrewarmResult = {
    chunkPrewarmAwaited: true,
    chunkPrewarmDeferred: false,
  };
  if (scenarioSupportsChunkedRuntime(bundle)) {
    chunkPrewarmResult = await ensureChunkedScenarioFirstFrameReady({
      bundle,
      scenarioId,
      awaitPrewarm: !deferChunkPrewarm,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
      isScenarioApplyRequestCurrent,
    });
  }
  if (!shouldContinueScenarioApplyContext(currentnessContext, "post-apply-before-optional-layer-sync")) {
    return {
      dataHealth: runtimeState.scenarioDataHealth || {},
      scenarioMapRefreshMode,
      hasChunkedRuntime: scenarioSupportsChunkedRuntime(bundle),
      chunkPrewarmAwaited: chunkPrewarmResult?.chunkPrewarmAwaited !== false,
      chunkPrewarmDeferred: chunkPrewarmResult?.chunkPrewarmDeferred === true,
      coarsePrewarmCommitted: chunkPrewarmResult?.coarsePrewarmCommitted === true,
      prewarmFailed: chunkPrewarmResult?.prewarmFailed === true,
    };
  }
  if (!deferOptionalLayers) await syncVisibleScenarioOptionalLayersForPostApply({
    bundle,
    scenarioId,
    renderNow,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
  });
  if (!shouldContinueScenarioApplyContext(currentnessContext, "post-apply-before-data-health")) {
    return {
      dataHealth: runtimeState.scenarioDataHealth || {},
      scenarioMapRefreshMode,
      hasChunkedRuntime: scenarioSupportsChunkedRuntime(bundle),
      chunkPrewarmAwaited: chunkPrewarmResult?.chunkPrewarmAwaited !== false,
      chunkPrewarmDeferred: chunkPrewarmResult?.chunkPrewarmDeferred === true,
      coarsePrewarmCommitted: chunkPrewarmResult?.coarsePrewarmCommitted === true,
      prewarmFailed: chunkPrewarmResult?.prewarmFailed === true,
    };
  }
  const shouldExposeScenarioDataHealthSignals =
    !bundle?.loadDiagnostics?.startupBundle
    && !runtimeState.startupReadonly
    && !runtimeState.startupReadonlyUnlockInFlight
    && !runtimeState.detailPromotionInFlight;
  const suppressChunkedPostApplyDataHealthSignals = shouldSuppressChunkedPostApplyDataHealthSignals({
    hasChunkedRuntime: scenarioSupportsChunkedRuntime(bundle),
    prewarmFailed: chunkPrewarmResult?.prewarmFailed === true,
    chunkErrorCount: getScenarioChunkLoadErrorCount(),
  });
  const dataHealth = refreshScenarioDataHealth({
    showWarningToast: shouldExposeScenarioDataHealthSignals && !suppressChunkedPostApplyDataHealthSignals,
    showErrorToast: shouldExposeScenarioDataHealthSignals && !suppressChunkedPostApplyDataHealthSignals,
  });
  recordRenderTransactionSnapshot(runtimeState, {
    phase: "scenario-data-health-refreshed",
    reason: "scenario-post-apply",
    expectedScenarioId: scenarioId,
    source: "scenario_post_apply_effects",
    extra: {
      scenarioMapRefreshMode,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
      hasChunkedRuntime: scenarioSupportsChunkedRuntime(bundle),
      chunkPrewarmResult,
      dataHealth: {
        expectedFeatureCount: Number(dataHealth?.expectedFeatureCount || 0),
        runtimeFeatureCount: Number(dataHealth?.runtimeFeatureCount || 0),
        ratio: Number(dataHealth?.ratio || 0),
        warning: String(dataHealth?.warning || ""),
        severity: String(dataHealth?.severity || ""),
      },
    },
  });
  if (!shouldContinueScenarioApplyContext(currentnessContext, "post-apply-before-country-ui")) {
    return {
      dataHealth,
      scenarioMapRefreshMode,
      hasChunkedRuntime: scenarioSupportsChunkedRuntime(bundle),
      chunkPrewarmAwaited: chunkPrewarmResult?.chunkPrewarmAwaited !== false,
      chunkPrewarmDeferred: chunkPrewarmResult?.chunkPrewarmDeferred === true,
      coarsePrewarmCommitted: chunkPrewarmResult?.coarsePrewarmCommitted === true,
      prewarmFailed: chunkPrewarmResult?.prewarmFailed === true,
    };
  }
  syncCountryUi({ renderNow: useSingleFinalRender ? true : (renderNow && !suppressRender) });
  return {
    dataHealth,
    scenarioMapRefreshMode,
    hasChunkedRuntime: scenarioSupportsChunkedRuntime(bundle),
    chunkPrewarmAwaited: chunkPrewarmResult?.chunkPrewarmAwaited !== false,
    chunkPrewarmDeferred: chunkPrewarmResult?.chunkPrewarmDeferred === true,
    coarsePrewarmCommitted: chunkPrewarmResult?.coarsePrewarmCommitted === true,
    prewarmFailed: chunkPrewarmResult?.prewarmFailed === true,
  };
}

function runPostScenarioResetEffects({
  scenarioId = "",
  renderNow = false,
} = {}) {
  scheduleAfterFirstFrame(() => {
    refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario-reset-opening:${scenarioId}` });
    refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario-reset:${scenarioId}` });
    refreshScenarioDataHealth({ showWarningToast: false });
    syncCountryUi({ renderNow });
    if (!renderNow) {
      requestRender(`scenario-reset-post-frame:${scenarioId}`);
    }
  });
}

function runPostScenarioClearEffects({ renderNow = false } = {}) {
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: "scenario-clear-opening" });
  setMapData({ refitProjection: false, resetZoom: false });
  rebuildPresetState();
  refreshScenarioShellOverlays({ renderNow: false, borderReason: "scenario-clear" });
  syncCountryUi({ renderNow });
}

function runPostRollbackRestoreEffects({ renderNow = false } = {}) {
  publishScenarioPaletteAndToolbarState();
  setMapData({ refitProjection: false, resetZoom: false });
  rebuildPresetState();
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: "scenario-rollback" });
  refreshScenarioShellOverlays({ renderNow: false, borderReason: "scenario-rollback" });
  refreshScenarioDataHealth({ showWarningToast: false, showErrorToast: false });
  syncCountryUi({ renderNow });
}

export {
  publishScenarioPaletteAndToolbarState,
  runPostScenarioUiReplay,
  runPostRollbackRestoreEffects,
  runPostScenarioApplyEffects,
  runPostScenarioClearEffects,
  runPostScenarioResetEffects,
  hasPendingScenarioChunkWork,
  shouldSuppressChunkedPostApplyDataHealthSignals,
};
