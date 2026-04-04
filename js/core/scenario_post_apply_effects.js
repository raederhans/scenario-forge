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
  scheduleScenarioChunkRefresh,
  scenarioBundleHasChunkedData,
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

async function runPostScenarioApplyEffects({
  bundle,
  scenarioId = "",
  renderNow = false,
  suppressRender = false,
} = {}) {
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario-opening:${scenarioId}` });
  let scenarioMapRefreshMode = "light";
  try {
    refreshMapDataForScenarioApply({ suppressRender });
  } catch (refreshError) {
    scenarioMapRefreshMode = "setMapData-fallback";
    console.warn("[scenario] Lightweight scenario apply refresh failed; falling back to setMapData.", refreshError);
    setMapData({ refitProjection: false, resetZoom: false, suppressRender });
  }
  rebuildPresetState();
  refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario:${scenarioId}` });
  if (scenarioBundleUsesChunkedLayer(bundle)) {
    await preloadScenarioCoarseChunks(bundle)
      .catch((error) => {
        console.warn(`[scenario] Coarse chunk prewarm failed for "${scenarioId}".`, error);
      });
    scheduleScenarioChunkRefresh({
      reason: "scenario-apply",
      delayMs: 0,
    });
  } else {
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
    hasChunkedRuntime: scenarioBundleUsesChunkedLayer(bundle) && scenarioBundleHasChunkedData(bundle),
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
