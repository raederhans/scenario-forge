import { FileManager } from "./file_manager.js";
import { clearHistory } from "./history_manager.js";
import {
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
} from "./releasable_manager.js";
import { setActivePaletteSource } from "./palette_manager.js";
import {
  ensureSovereigntyState,
  markLegacyColorStateDirty,
} from "./sovereignty_manager.js";
import {
  normalizeMapSemanticMode,
  restoreImportedAnnotationOverlayState,
  restoreImportedLayerVisibilityState,
  restoreImportedStyleConfigState,
  restoreImportedWorkbenchUiState,
  state,
} from "./state.js";
import { callRuntimeHook } from "./state/index.js";
import {
  resetStrategicOverlayEditorState,
} from "./state/strategic_overlay_state.js";
import { resetDevTransientImportState } from "./state/dev_state.js";
import { prepareImportedProjectState } from "./interaction_funnel/import_apply_orchestration.js";
import { syncProjectImportUiState as syncProjectImportUiStateHelper } from "./interaction_funnel/ui_sync.js";

let mapClickImpl = null;
let mapDoubleClickImpl = null;
let scenarioResourcesModulePromise = null;
let scenarioDispatcherModulePromise = null;
const debugState = {
  clickCount: 0,
  doubleClickCount: 0,
  importStartCount: 0,
  importApplyCount: 0,
  importPhase: "idle",
  lastImportError: "",
  lastClickContext: null,
  lastDoubleClickContext: null,
  lastImportFileName: "",
  lastImportedScenarioId: "",
};

function createNoopAsyncFalse() {
  return async () => false;
}

function getScenarioResourcesModule() {
  if (!scenarioResourcesModulePromise) {
    scenarioResourcesModulePromise = import("./scenario_resources.js");
  }
  return scenarioResourcesModulePromise;
}

function getScenarioDispatcherModule() {
  if (!scenarioDispatcherModulePromise) {
    scenarioDispatcherModulePromise = import("./scenario_dispatcher.js");
  }
  return scenarioDispatcherModulePromise;
}

function buildMapInteractionContext(kind, event) {
  return {
    kind,
    detail: Math.max(1, Number(event?.detail || (kind === "dblclick" ? 2 : 1))),
    ctrlKey: !!event?.ctrlKey,
    metaKey: !!event?.metaKey,
    shiftKey: !!event?.shiftKey,
    altKey: !!event?.altKey,
    currentTool: String(state.currentTool || ""),
    activeScenarioId: String(state.activeScenarioId || ""),
    interactionGranularity: String(state.interactionGranularity || ""),
    startupReadonly: !!state.startupReadonly,
  };
}

function resolveUi(ui = {}) {
  return {
    t: typeof ui.t === "function" ? ui.t : ((value) => String(value || "")),
    showToast: typeof ui.showToast === "function" ? ui.showToast : (() => {}),
    showAppDialog:
      typeof ui.showAppDialog === "function" ? ui.showAppDialog : createNoopAsyncFalse(),
  };
}

function resolveHooks(hooks = {}) {
  return {
    invalidateFrontlineOverlayState:
      typeof hooks.invalidateFrontlineOverlayState === "function"
        ? hooks.invalidateFrontlineOverlayState
        : null,
    refreshColorState:
      typeof hooks.refreshColorState === "function" ? hooks.refreshColorState : null,
  };
}

function cloneImportedProjectValue(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function syncProjectImportUiState({ scenarioImportAudit, hooks }) {
  return syncProjectImportUiStateHelper({ scenarioImportAudit, hooks });
}

async function applyImportedProjectState(data, { ui, hooks }) {
  debugState.importPhase = "begin";
  clearHistory();
  const preparedImport = await prepareImportedProjectState({
    data,
    ui,
    debugState,
    getScenarioResourcesModule,
    getScenarioDispatcherModule,
  });
  data = preparedImport.data;
  const { importedOwnershipState, scenarioImportAudit } = preparedImport;
  state.sovereignBaseColors = data.sovereignBaseColors || data.countryBaseColors || {};
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.visualOverrides = data.visualOverrides || data.featureOverrides || {};
  state.featureOverrides = { ...state.visualOverrides };
  markLegacyColorStateDirty();
  state.waterRegionOverrides = data.waterRegionOverrides || {};
  state.specialRegionOverrides = data.specialRegionOverrides || {};
  state.sovereigntyByFeatureId = importedOwnershipState.sovereigntyByFeatureId;
  state.mapSemanticMode = normalizeMapSemanticMode(
    data.mapSemanticMode,
    state.activeScenarioId ? state.mapSemanticMode : "political"
  );
  state.scenarioControllersByFeatureId = importedOwnershipState.scenarioControllersByFeatureId;
  state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  state.sovereigntyInitialized = false;
  state.paintMode = data.paintMode || "visual";
  state.activeSovereignCode = data.activeSovereignCode || "";
  state.selectedInspectorCountryCode =
    data.activeSovereignCode || state.selectedInspectorCountryCode || "";
  state.inspectorHighlightCountryCode = state.selectedInspectorCountryCode;
  state.releasableBoundaryVariantByTag =
    data.releasableBoundaryVariantByTag &&
    typeof data.releasableBoundaryVariantByTag === "object"
      ? { ...data.releasableBoundaryVariantByTag }
      : {};
  if (state.activeScenarioId) {
    const existingTags = Object.keys(state.scenarioCountriesByTag || {});
    state.scenarioReleasableIndex = buildScenarioReleasableIndex(state.activeScenarioId);
    state.scenarioCountriesByTag = {
      ...(state.scenarioCountriesByTag || {}),
      ...getScenarioReleasableCountries(state.activeScenarioId, {
        excludeTags: existingTags,
      }),
    };
  }
  state.inspectorExpansionInitialized = false;
  if (state.expandedInspectorContinents instanceof Set) {
    state.expandedInspectorContinents.clear();
  }
  if (state.expandedInspectorReleaseParents instanceof Set) {
    state.expandedInspectorReleaseParents.clear();
  }
  state.dynamicBordersDirty = !!data.dynamicBordersDirty;
  state.dynamicBordersDirtyReason = data.dynamicBordersDirtyReason || "";
  resetDevTransientImportState(state, { previewFormat: "names_with_ids" });
  ensureSovereigntyState({ force: true });
  const importedOverlayState = restoreImportedAnnotationOverlayState(state, data, {
    cloneValue: cloneImportedProjectValue,
  });
  resetStrategicOverlayEditorState(state, {
    unitCounterRenderer: importedOverlayState?.annotationView?.unitRendererDefault || "game",
  });
  hooks.invalidateFrontlineOverlayState?.();
  restoreImportedWorkbenchUiState(state, data, {
    cloneValue: cloneImportedProjectValue,
  });
  state.specialZones = data.specialZones || {};
  state.parentBordersVisible = data.parentBordersVisible !== false;
  state.manualSpecialZones =
    data.manualSpecialZones && data.manualSpecialZones.type === "FeatureCollection"
      ? data.manualSpecialZones
      : { type: "FeatureCollection", features: [] };
  const supportedCountries = Array.isArray(state.parentBorderSupportedCountries)
    ? state.parentBorderSupportedCountries
    : [];
  const importedParentEnabled =
    data.parentBorderEnabledByCountry && typeof data.parentBorderEnabledByCountry === "object"
      ? data.parentBorderEnabledByCountry
      : {};
  const normalizedParentEnabled = {};
  supportedCountries.forEach((countryCode) => {
    normalizedParentEnabled[countryCode] = !!importedParentEnabled[countryCode];
  });
  state.parentBorderEnabledByCountry = normalizedParentEnabled;
  restoreImportedStyleConfigState(state, data.styleConfig);
  restoreImportedLayerVisibilityState(state, data.layerVisibility);
  state.customPresets =
    data.customPresets && typeof data.customPresets === "object" ? data.customPresets : {};
  debugState.importPhase = "state-restored";
  const paletteRestoreTarget = String(data.activePaletteId || "").trim();
  const shouldRestorePalette =
    !!paletteRestoreTarget &&
    (paletteRestoreTarget !== String(state.activePaletteId || "").trim() ||
      !state.activePaletteMeta ||
      !state.activePalettePack ||
      !state.activePaletteMap);
  if (shouldRestorePalette) {
    const paletteRestored = await setActivePaletteSource(paletteRestoreTarget, {
      syncUI: true,
      overwriteCountryPalette: false,
    });
    if (!paletteRestored) {
      console.warn(
        `[project-import] Unable to restore saved palette source: ${paletteRestoreTarget}`
      );
      ui.showToast(ui.t("Saved palette could not be restored. Keeping the current palette.", "ui"), {
        title: ui.t("Palette restore skipped", "ui"),
        tone: "warning",
        duration: 3600,
      });
    }
  }
  if (state.activeScenarioId && state.showCityPoints) {
    const { ensureActiveScenarioOptionalLayerLoaded } = await getScenarioResourcesModule();
    await callRuntimeHook(state, "ensureBaseCityDataFn", { reason: "project-import", renderNow: false });
    await ensureActiveScenarioOptionalLayerLoaded("cities", { renderNow: false });
  }
  if (state.showRivers) {
    await callRuntimeHook(state, "ensureContextLayerDataFn", "rivers", {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (state.showTransport && state.showAirports) {
    await callRuntimeHook(state, "ensureContextLayerDataFn", "airports", {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (state.showTransport && state.showPorts) {
    await callRuntimeHook(state, "ensureContextLayerDataFn", "ports", {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (state.showTransport && state.showRail) {
    await callRuntimeHook(state, "ensureContextLayerDataFn", ["railways", "rail_stations_major"], {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (state.showUrban) {
    await callRuntimeHook(state, "ensureContextLayerDataFn", "urban", {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (state.showPhysical) {
    await callRuntimeHook(state, "ensureContextLayerDataFn", ["physical-set", "physical-contours-set"], {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (importedOwnershipState.shouldRestoreScenarioBaselineControllers) {
    state.scenarioControllersByFeatureId = {
      ...(state.scenarioBaselineControllersByFeatureId || {}),
    };
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  }
  debugState.importPhase = "ui-sync";
  debugState.importApplyCount += 1;
  debugState.lastImportedScenarioId = String(state.activeScenarioId || "");
  syncProjectImportUiState({ scenarioImportAudit, hooks });
  debugState.importPhase = "complete";
}

export function bindInteractionFunnel({
  mapClick = null,
  mapDoubleClick = null,
} = {}) {
  mapClickImpl = typeof mapClick === "function" ? mapClick : null;
  mapDoubleClickImpl = typeof mapDoubleClick === "function" ? mapDoubleClick : null;
}

export function dispatchMapClick(event) {
  if (typeof mapClickImpl !== "function") {
    return false;
  }
  debugState.clickCount += 1;
  debugState.lastClickContext = buildMapInteractionContext("click", event);
  return mapClickImpl(event, debugState.lastClickContext);
}

export function dispatchMapDoubleClick(event) {
  if (typeof mapDoubleClickImpl !== "function") {
    return false;
  }
  debugState.doubleClickCount += 1;
  debugState.lastDoubleClickContext = buildMapInteractionContext("dblclick", event);
  return mapDoubleClickImpl(event, debugState.lastDoubleClickContext);
}

export function importProjectThroughFunnel(file, options = {}) {
  const ui = resolveUi(options.ui);
  const hooks = resolveHooks(options.hooks);
  debugState.importStartCount += 1;
  debugState.importPhase = "file-read";
  debugState.lastImportError = "";
  debugState.lastImportFileName = String(file?.name || "");
  FileManager.importProject(file, async (data) => {
    try {
      await applyImportedProjectState(data, { ui, hooks });
    } catch (error) {
      debugState.importPhase = "error";
      debugState.lastImportError = String(error?.message || error || "");
      throw error;
    }
  });
  return true;
}

export function getInteractionFunnelDebugState() {
  return {
    ...debugState,
    lastClickContext: debugState.lastClickContext
      ? { ...debugState.lastClickContext }
      : null,
    lastDoubleClickContext: debugState.lastDoubleClickContext
      ? { ...debugState.lastDoubleClickContext }
      : null,
  };
}

export function resetInteractionFunnelDebugState() {
  debugState.clickCount = 0;
  debugState.doubleClickCount = 0;
  debugState.importStartCount = 0;
  debugState.importApplyCount = 0;
  debugState.lastClickContext = null;
  debugState.lastDoubleClickContext = null;
  debugState.lastImportFileName = "";
  debugState.lastImportedScenarioId = "";
}
