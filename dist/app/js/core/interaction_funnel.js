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
  normalizeIntensityFieldsState,
  normalizeAppearancePresetsState,
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
import {
  applyTransportCountryOverlayState,
  clearTransportCountryOverlayState,
  loadTransportCountryOverlayState,
} from "./transport_country_overlay.js";
import {
  getTransportOverviewDataLayerKeys,
  getTransportOverviewVisibilityField,
  listTransportOverviewCapabilityFamilyIds,
} from "./transport_capability_registry.js";
import { isTargetMainMapPackId } from "./transport_pack_resolver.js";
import { syncProjectImportUiState as syncProjectImportUiStateHelper } from "./interaction_funnel/ui_sync.js";
import {
  normalizeSpecialZoneLayersState,
  normalizeSpecialZoneMembershipBrushModeState,
  resolveSpecialZoneTopologyFingerprint,
} from "./special_zone_layers.js";

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

function getContextLayerRequestFromKeys(layerKeys = []) {
  const normalizedKeys = (Array.isArray(layerKeys) ? layerKeys : [])
    .map((key) => String(key || "").trim())
    .filter(Boolean);
  if (normalizedKeys.length === 0) return null;
  return normalizedKeys.length === 1 ? normalizedKeys[0] : normalizedKeys;
}

async function restoreImportedTransportOverviewDataLayers(importState) {
  if (!importState.showTransport) return;
  for (const familyId of listTransportOverviewCapabilityFamilyIds()) {
    const visibilityField = getTransportOverviewVisibilityField(familyId);
    if (!visibilityField || !importState[visibilityField]) continue;
    const layerRequest = getContextLayerRequestFromKeys(getTransportOverviewDataLayerKeys(familyId));
    if (!layerRequest) continue;
    await callRuntimeHook(importState, "ensureContextLayerDataFn", layerRequest, {
      reason: "project-import",
      renderNow: false,
    });
  }
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
    onProjectImportComplete:
      typeof hooks.onProjectImportComplete === "function" ? hooks.onProjectImportComplete : null,
    onProjectImportError:
      typeof hooks.onProjectImportError === "function" ? hooks.onProjectImportError : null,
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

// project import 既要恢复文件里显式保存的 overlay pack，也要兼容旧工程只留下
// activePackId 的形态；这里统一收集 pack id，后面按 pack 顺序逐个恢复。
export function resolveImportedTransportCountryOverlayPackIds(target, importedState = {}) {
  const packIds = [];
  const pushPackId = (packId) => {
    const normalizedPackId = String(packId || "").trim().toLowerCase();
    if (normalizedPackId && isTargetMainMapPackId(normalizedPackId) && !packIds.includes(normalizedPackId)) {
      packIds.push(normalizedPackId);
    }
  };
  const pushPackIdsFromFamilyMap = (packIdsByFamily) => {
    if (!packIdsByFamily || typeof packIdsByFamily !== "object") return;
    Object.values(packIdsByFamily).forEach(pushPackId);
  };
  const importedPackIdsByFamily = importedState?.transportCountryOverlayState?.activePackIdByFamily || {};
  pushPackIdsFromFamilyMap(importedPackIdsByFamily);
  const explicitPackId = String(importedState?.transportCountryOverlayState?.activePackId || "").trim().toLowerCase();
  pushPackId(explicitPackId);
  const activePackIdByFamily = target?.styleConfig?.transportOverview?.activePackIdByFamily || {};
  pushPackIdsFromFamilyMap(activePackIdByFamily);
  return packIds;
}

// country overlay 仍然以 pack 为加载单位，所以导入工程时要把要用到的 pack
// 逐个读回 runtime，再让 applyTransportCountryOverlayState 负责合并到统一状态。
async function restoreImportedTransportCountryOverlayState(target, importedState = {}) {
  const activePackIds = resolveImportedTransportCountryOverlayPackIds(target, importedState);
  if (!activePackIds.length) {
    clearTransportCountryOverlayState(target, "project-import-no-country-pack");
    return null;
  }
  try {
    let appliedState = null;
    for (const activePackId of activePackIds) {
      const overlayState = await loadTransportCountryOverlayState(activePackId);
      appliedState = applyTransportCountryOverlayState(target, overlayState);
    }
    return appliedState;
  } catch (error) {
    clearTransportCountryOverlayState(target, "project-import-country-pack-load-failed");
    console.warn(`[project-import] Unable to restore transport country overlays ${activePackIds.join(", ")}.`, error);
    return null;
  }
}

// 这里是 project import 的集中收口点：先让 prepareImportedProjectState 解决
// scenario/runtime 依赖，再一次性回填 state，避免各个 editor 各自恢复半套状态。
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
  state.specialRegionOverrides = {};
  state.sovereigntyByFeatureId = importedOwnershipState.sovereigntyByFeatureId;
  state.mapSemanticMode = normalizeMapSemanticMode(
    data.mapSemanticMode,
    state.activeScenarioId ? state.mapSemanticMode : "political"
  );
  state.sovereigntyInitialized = false;
  state.paintMode = data.paintMode || "visual";
  state.activeSovereignCode = data.activeSovereignCode || "";
  state.selectedInspectorCountryCode = "";
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
  // workbench UI 要先于 style/layer visibility 恢复，这样后面的 normalize 可以拿到
  // 正确的 tab、preview family 和 panel 状态，不会把导入文件里的 UI 语义抹掉。
  restoreImportedWorkbenchUiState(state, data, {
    cloneValue: cloneImportedProjectValue,
  });
  callRuntimeHook(state, "clearExportBakeCacheFn");
  state.specialZones = data.specialZones || {};
  state.specialZoneLayers = normalizeSpecialZoneLayersState(data.specialZoneLayers, {
    defaultSource: "project",
    topologyFingerprint: resolveSpecialZoneTopologyFingerprint(state),
    validFeatureIds: state.landIndex instanceof Map ? new Set(state.landIndex.keys()) : null,
  });
  state.specialZoneMembershipBrushMode = normalizeSpecialZoneMembershipBrushModeState(data.specialZoneMembershipBrushMode);
  state.parentBordersVisible = data.parentBordersVisible !== false;
  state.manualSpecialZones = { type: "FeatureCollection", features: [] };
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
  state.intensityFields = normalizeIntensityFieldsState(data.intensityFields);
  state.appearancePresets = normalizeAppearancePresetsState(data.appearancePresets);
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
  if (
    state.activeScenarioId
    && (state.showStrategicResourceMarkers || String(state.strategicChoroplethMetric || "").trim())
  ) {
    const { ensureActiveScenarioOptionalLayerLoaded } = await getScenarioResourcesModule();
    await ensureActiveScenarioOptionalLayerLoaded("strategicvalues", { renderNow: false });
  }
  if (state.showRivers) {
    await callRuntimeHook(state, "ensureContextLayerDataFn", "rivers", {
      reason: "project-import",
      renderNow: false,
    });
  }
  await restoreImportedTransportOverviewDataLayers(state);
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
  await restoreImportedTransportCountryOverlayState(state, data);
  debugState.importPhase = "ui-sync";
  debugState.importApplyCount += 1;
  debugState.lastImportedScenarioId = String(state.activeScenarioId || "");
  syncProjectImportUiState({ scenarioImportAudit, hooks });
  debugState.importPhase = "complete";
  return preparedImport.importSummary;
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
  let importSummary = null;
  FileManager.importProject(
    file,
    async (data) => {
      try {
        importSummary = await applyImportedProjectState(data, { ui, hooks });
      } catch (error) {
        debugState.importPhase = "error";
        debugState.lastImportError = String(error?.message || error || "");
        throw error;
      }
    },
    {
      onSuccess: () => hooks.onProjectImportComplete?.(importSummary),
      onError: (error) => hooks.onProjectImportError?.(error),
    }
  );
  return true;
}

export async function importProjectTextThroughFunnel(text, options = {}) {
  const ui = resolveUi(options.ui);
  const hooks = resolveHooks(options.hooks);
  const importOptions =
    options.importOptions && typeof options.importOptions === "object" ? options.importOptions : {};
  debugState.importStartCount += 1;
  debugState.importPhase = "text-read";
  debugState.lastImportError = "";
  debugState.lastImportFileName = String(options.fileName || "");
  let importSummary = null;
  return FileManager.importProjectText(
    text,
    async (data) => {
      try {
        importSummary = await applyImportedProjectState(data, { ui, hooks });
      } catch (error) {
        debugState.importPhase = "error";
        debugState.lastImportError = String(error?.message || error || "");
        throw error;
      }
    },
    {
      onSuccess: () => hooks.onProjectImportComplete?.(importSummary),
      onError: (error) => hooks.onProjectImportError?.(error),
    },
    importOptions,
  );
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
  debugState.importPhase = "idle";
  debugState.lastImportError = "";
  debugState.lastClickContext = null;
  debugState.lastDoubleClickContext = null;
  debugState.lastImportFileName = "";
  debugState.lastImportedScenarioId = "";
}
