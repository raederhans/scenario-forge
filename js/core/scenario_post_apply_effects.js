import { state } from "./state.js";
import {
  refreshMapDataForScenarioApply,
  refreshScenarioOpeningOwnerBorders,
  setMapData,
} from "./map_renderer.js";
import { rebuildPresetState } from "./releasable_manager.js";
import { refreshScenarioDataHealth } from "./scenario_data_health.js";
import {
  ensureActiveScenarioOptionalLayersForVisibility,
  preloadScenarioCoarseChunks,
  preloadScenarioFocusCountryPoliticalDetailChunk,
  scheduleScenarioChunkRefresh,
  scenarioBundleHasChunkedData,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
} from "./scenario_resources.js";
import { refreshScenarioShellOverlays } from "./scenario_shell_overlay.js";
import { syncCountryUi } from "./scenario_ui_sync.js";

function runPaletteAndToolbarRefreshCallbacks() {
  if (typeof state.renderPaletteFn === "function") {
    state.renderPaletteFn(state.currentPaletteTheme);
  }
  if (typeof state.updatePaletteLibraryUIFn === "function") {
    state.updatePaletteLibraryUIFn();
  }
  if (typeof state.updatePaletteSourceUIFn === "function") {
    state.updatePaletteSourceUIFn();
  }
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
  if (typeof state.updateWaterInteractionUIFn === "function") {
    state.updateWaterInteractionUIFn();
  }
  if (typeof state.updateScenarioSpecialRegionUIFn === "function") {
    state.updateScenarioSpecialRegionUIFn();
  }
  if (typeof state.updateScenarioReliefOverlayUIFn === "function") {
    state.updateScenarioReliefOverlayUIFn();
  }
  if (typeof state.updateDynamicBorderStatusUIFn === "function") {
    state.updateDynamicBorderStatusUIFn();
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
  if (!state.scenarioPerfMetrics || typeof state.scenarioPerfMetrics !== "object") {
    state.scenarioPerfMetrics = {};
  }
  return state.scenarioPerfMetrics;
}

function updateChunkedFirstFramePrewarmMetric(details = {}) {
  const metrics = ensureScenarioPerfMetrics();
  const previousEntry = metrics.chunkedFirstFramePrewarm && typeof metrics.chunkedFirstFramePrewarm === "object"
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

function ensureChunkedScenarioFirstFrameReady({
  bundle,
  scenarioId = "",
  mode = "async",
} = {}) {
  if (!scenarioSupportsChunkedRuntime(bundle)) return;
  const normalizedScenarioId = String(scenarioId || "").trim();
  const normalizedMode = String(mode || "").trim().toLowerCase() === "sync" ? "sync" : "async";
  const prewarmStartedAt = Date.now();
  updateChunkedFirstFramePrewarmMetric({
    scenarioId: normalizedScenarioId,
    mode: normalizedMode,
    synchronous: normalizedMode === "sync",
    prewarmStartedAt,
  });
  const runPrewarm = async () => {
    if (normalizedScenarioId && normalizedScenarioId !== String(state.activeScenarioId || "").trim()) {
      return;
    }
    let prewarmCompletedAt = 0;
    try {
      await preloadScenarioCoarseChunks(bundle);
      await preloadScenarioFocusCountryPoliticalDetailChunk(bundle);
      prewarmCompletedAt = Date.now();
      updateChunkedFirstFramePrewarmMetric({
        scenarioId: normalizedScenarioId,
        mode: normalizedMode,
        synchronous: normalizedMode === "sync",
        prewarmStartedAt,
        prewarmCompletedAt,
      });
    } catch (error) {
      console.warn(`[scenario] Coarse chunk prewarm failed for "${scenarioId}".`, error);
      updateChunkedFirstFramePrewarmMetric({
        scenarioId: normalizedScenarioId,
        mode: normalizedMode,
        synchronous: normalizedMode === "sync",
        prewarmStartedAt,
        prewarmCompletedAt: prewarmCompletedAt || Date.now(),
        prewarmFailed: true,
        prewarmFailure: String(error?.message || error || "Unknown prewarm error"),
      });
    } finally {
      if (normalizedScenarioId && normalizedScenarioId !== String(state.activeScenarioId || "").trim()) {
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
        synchronous: normalizedMode === "sync",
        prewarmStartedAt,
        prewarmCompletedAt: prewarmCompletedAt || Date.now(),
        refreshScheduledAt,
      });
    }
  };
  if (normalizedMode === "sync") {
    return runPrewarm();
  }
  scheduleAfterFirstFrame(() => {
    void runPrewarm();
  });
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
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario-opening:${scenarioId}` });
  let scenarioMapRefreshMode = "light";
  const shouldSynchronouslyPrewarm = shouldSynchronouslyPrewarmChunkedScenario(bundle);
  try {
    refreshMapDataForScenarioApply({ suppressRender });
  } catch (refreshError) {
    scenarioMapRefreshMode = "setMapData-fallback";
    console.warn("[scenario] Lightweight scenario apply refresh failed; falling back to setMapData.", refreshError);
    setMapData({ refitProjection: false, resetZoom: false, suppressRender });
  }
  rebuildPresetState();
  refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario:${scenarioId}` });
  if (scenarioSupportsChunkedRuntime(bundle)) {
    await ensureChunkedScenarioFirstFrameReady({
      bundle,
      scenarioId,
      mode: shouldSynchronouslyPrewarm ? "sync" : "async",
    });
  } else if (!state.bootBlocking) {
    await ensureActiveScenarioOptionalLayersForVisibility({ bundle, renderNow })
      .catch((error) => {
        console.warn(`[scenario] Optional layer visibility sync failed for "${scenarioId}".`, error);
      });
  }
  const dataHealth = refreshScenarioDataHealth({
    showWarningToast: true,
    showErrorToast: true,
  });
  syncCountryUi({ renderNow: renderNow && !suppressRender });
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
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario-reset-opening:${scenarioId}` });
  refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario-reset:${scenarioId}` });
  refreshScenarioDataHealth({ showWarningToast: false });
  syncCountryUi({ renderNow });
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
  runPostRollbackRestoreEffects,
  runPostScenarioApplyEffects,
  runPostScenarioClearEffects,
  runPostScenarioResetEffects,
};
