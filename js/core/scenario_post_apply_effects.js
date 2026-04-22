import {
  STATE_BUS_EVENTS,
  emitStateBusEvent,
} from "./state/index.js";
import { state as runtimeState } from "./state.js";
import {
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
import { refreshScenarioShellOverlays } from "./scenario_shell_overlay.js";
import { syncCountryUi } from "./scenario_ui_sync.js";
import { requestRender } from "./render_boundary.js";

function runPaletteAndToolbarRefreshCallbacks() {
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

function runPostScenarioUiReplay({ full = true, renderNow = false } = {}) {
  runPaletteAndToolbarRefreshCallbacks();
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

function ensureScenarioPerfMetrics() {
  if (!runtimeState.scenarioPerfMetrics || typeof runtimeState.scenarioPerfMetrics !== "object") {
    runtimeState.scenarioPerfMetrics = {};
  }
  return runtimeState.scenarioPerfMetrics;
}

function updateChunkedFirstFramePrewarmMetric(details = {}, { replace = false } = {}) {
  const metrics = ensureScenarioPerfMetrics();
  const previousEntry = !replace && metrics.chunkedFirstFramePrewarm && typeof metrics.chunkedFirstFramePrewarm === "object"
    ? metrics.chunkedFirstFramePrewarm
    : {};
  metrics.chunkedFirstFramePrewarm = {
    ...previousEntry,
    ...details,
    recordedAt: Date.now(),
  };
  globalThis.__scenarioPerfMetrics = metrics;
  return metrics.chunkedFirstFramePrewarm;
}

function scheduleScenarioDetailChunkPrewarm({
  bundle,
  scenarioId = "",
  prewarmStartedAt = 0,
} = {}) {
  if (!scenarioSupportsChunkedRuntime(bundle)) return;
  const normalizedScenarioId = String(scenarioId || "").trim();
  scheduleAfterFirstFrame(() => {
    void (async () => {
      if (normalizedScenarioId && normalizedScenarioId !== String(runtimeState.activeScenarioId || "").trim()) {
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
        if (normalizedScenarioId && normalizedScenarioId !== String(runtimeState.activeScenarioId || "").trim()) {
          return;
        }
        scheduleScenarioChunkRefresh({
          reason: "scenario-apply-detail-prewarm",
          delayMs: 0,
        });
        updateChunkedFirstFramePrewarmMetric({
          scenarioId: normalizedScenarioId,
          mode: "async",
          synchronous: false,
          prewarmStartedAt,
          detailPrewarmStartedAt,
          detailPrewarmCompletedAt: Date.now(),
        });
      } catch (error) {
        console.warn(`[scenario] Detail chunk prewarm failed for "${scenarioId}".`, error);
        if (normalizedScenarioId && normalizedScenarioId !== String(runtimeState.activeScenarioId || "").trim()) {
          return;
        }
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
      }
    })();
  });
}

async function ensureChunkedScenarioFirstFrameReady({
  bundle,
  scenarioId = "",
} = {}) {
  if (!scenarioSupportsChunkedRuntime(bundle)) return;
  const normalizedScenarioId = String(scenarioId || "").trim();
  const synchronous = shouldSynchronouslyPrewarmChunkedScenario(bundle);
  const normalizedMode = synchronous ? "sync" : "async";
  const prewarmStartedAt = Date.now();
  updateChunkedFirstFramePrewarmMetric({
    scenarioId: normalizedScenarioId,
    mode: normalizedMode,
    synchronous: normalizedMode === "sync",
    prewarmStartedAt,
  }, { replace: true });
  if (normalizedScenarioId && normalizedScenarioId !== String(runtimeState.activeScenarioId || "").trim()) {
    return;
  }
  let prewarmCompletedAt = 0;
  try {
    await preloadScenarioCoarseChunks(bundle);
    if (synchronous) {
      await preloadScenarioFocusCountryPoliticalDetailChunk(bundle);
    }
    if (normalizedScenarioId && normalizedScenarioId !== String(runtimeState.activeScenarioId || "").trim()) {
      return;
    }
    prewarmCompletedAt = Date.now();
    updateChunkedFirstFramePrewarmMetric({
      scenarioId: normalizedScenarioId,
      mode: normalizedMode,
      synchronous,
      prewarmStartedAt,
      prewarmCompletedAt,
    });
  } catch (error) {
    console.warn(`[scenario] Coarse chunk prewarm failed for "${scenarioId}".`, error);
    if (normalizedScenarioId && normalizedScenarioId !== String(runtimeState.activeScenarioId || "").trim()) {
      return;
    }
    updateChunkedFirstFramePrewarmMetric({
      scenarioId: normalizedScenarioId,
      mode: normalizedMode,
      synchronous,
      prewarmStartedAt,
      prewarmCompletedAt: prewarmCompletedAt || Date.now(),
      prewarmFailed: true,
      prewarmFailure: String(error?.message || error || "Unknown prewarm error"),
    });
  } finally {
    if (normalizedScenarioId && normalizedScenarioId !== String(runtimeState.activeScenarioId || "").trim()) {
      return;
    }
    const refreshScheduledAt = Date.now();
    scheduleScenarioChunkRefresh({
      reason: "scenario-apply",
      delayMs: 0,
    });
    updateChunkedFirstFramePrewarmMetric({
      scenarioId: normalizedScenarioId,
      mode: normalizedMode,
      synchronous,
      prewarmStartedAt,
      prewarmCompletedAt: prewarmCompletedAt || Date.now(),
      refreshScheduledAt,
    });
    if (!synchronous) {
      scheduleScenarioDetailChunkPrewarm({
        bundle,
        scenarioId: normalizedScenarioId,
        prewarmStartedAt,
      });
    }
  }
}

function shouldSynchronouslyPrewarmChunkedScenario(bundle) {
  if (!scenarioSupportsChunkedRuntime(bundle)) return false;
  const featureCount = Number(bundle?.manifest?.summary?.feature_count || 0);
  const hints = bundle?.manifest?.performance_hints && typeof bundle.manifest.performance_hints === "object"
    ? bundle.manifest.performance_hints
    : {};
  return featureCount >= 18_000
    && hints.water_regions_default === false
    && hints.special_regions_default === false
    && hints.scenario_relief_overlays_default === false;
}

async function runPostScenarioApplyEffects({
  bundle,
  scenarioId = "",
  renderNow = false,
  suppressRender = false,
} = {}) {
  const useSingleFinalRender = !!renderNow && !suppressRender;
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario-opening:${scenarioId}` });
  let scenarioMapRefreshMode = "light";
  try {
    refreshMapDataForScenarioApply({ suppressRender: useSingleFinalRender ? true : suppressRender });
  } catch (refreshError) {
    scenarioMapRefreshMode = "setMapData-fallback";
    console.warn("[scenario] Lightweight scenario apply refresh failed; falling back to setMapData.", refreshError);
    setMapData({
      refitProjection: false,
      resetZoom: false,
      suppressRender: useSingleFinalRender ? true : suppressRender,
    });
  }
  rebuildPresetState();
  refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario:${scenarioId}` });
  if (scenarioSupportsChunkedRuntime(bundle)) {
    await ensureChunkedScenarioFirstFrameReady({ bundle, scenarioId });
  } else if (!runtimeState.bootBlocking) {
    await ensureActiveScenarioOptionalLayersForVisibility({ bundle, renderNow })
      .catch((error) => {
        console.warn(`[scenario] Optional layer visibility sync failed for "${scenarioId}".`, error);
      });
  }
  const dataHealth = refreshScenarioDataHealth({
    showWarningToast: true,
    showErrorToast: true,
  });
  syncCountryUi({ renderNow: useSingleFinalRender ? true : (renderNow && !suppressRender) });
  return {
    dataHealth,
    scenarioMapRefreshMode,
    hasChunkedRuntime: scenarioSupportsChunkedRuntime(bundle),
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
  runPaletteAndToolbarRefreshCallbacks();
  setMapData({ refitProjection: false, resetZoom: false });
  rebuildPresetState();
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: "scenario-rollback" });
  refreshScenarioShellOverlays({ renderNow: false, borderReason: "scenario-rollback" });
  refreshScenarioDataHealth({ showWarningToast: false, showErrorToast: false });
  syncCountryUi({ renderNow });
}

export {
  runPostScenarioUiReplay,
  runPostRollbackRestoreEffects,
  runPostScenarioApplyEffects,
  runPostScenarioClearEffects,
  runPostScenarioResetEffects,
};
