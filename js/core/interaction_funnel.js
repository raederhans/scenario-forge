import { clearDirty } from "./dirty_state.js";
import { captureProjectImportState } from "./state/actions/project_import_actions.js";
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
import { prepareImportedProjectState, commitImportedProjectPatch } from "./interaction_funnel/import_apply_orchestration.js";
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
let fileManagerModulePromise = null;
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

function getFileManagerModule() {
  if (!fileManagerModulePromise) {
    fileManagerModulePromise = import("./file_manager.js");
  }
  return fileManagerModulePromise;
}

function reportImportModuleFailure(error, ui, hooks) {
  debugState.importPhase = "error";
  debugState.lastImportError = String(error?.message || error || "");
  ui.showToast(ui.t("Failed to import project.", "ui"), { tone: "error" });
  hooks.onProjectImportError?.(error);
  return false;
}

function getContextLayerRequestFromKeys(layerKeys = []) {
  const normalizedKeys = (Array.isArray(layerKeys) ? layerKeys : [])
    .map((key) => String(key || "").trim())
    .filter(Boolean);
  if (normalizedKeys.length === 0) return null;
  return normalizedKeys.length === 1 ? normalizedKeys[0] : normalizedKeys;
}

async function restoreImportedTransportOverviewDataLayers(importState, isCurrent = () => true) {
  if (!importState.showTransport) return;
  for (const familyId of listTransportOverviewCapabilityFamilyIds()) {
    if (!isCurrent()) return;
    const visibilityField = getTransportOverviewVisibilityField(familyId);
    if (!visibilityField || !importState[visibilityField]) continue;
    const layerRequest = getContextLayerRequestFromKeys(getTransportOverviewDataLayerKeys(familyId));
    if (!layerRequest) continue;
    const result = await callRuntimeHook(importState, "ensureContextLayerDataFn", layerRequest, {
      reason: "project-import",
      renderNow: false,
    });
    if (isCurrent()) validateImportedContextLayerResult(result, importState);
  }
}

function validateImportedContextLayerResult(result, target = state) {
  // A null result is legitimate when topology already supplies the layer; that
  // branch explicitly marks it loaded. Failed deferred fetches instead mark error.
  for (const [name, collection] of Object.entries(result || {})) {
    if (target.contextLayerLoadStateByName?.[name] === "error"
      || (collection === null && target.contextLayerLoadStateByName?.[name] !== "loaded")) {
      throw new Error(target.contextLayerLoadErrorByName?.[name] || `${name} could not be restored.`);
    }
  }
}

async function restoreImportedScenarioOptionalLayer(layer, preparedImport, isCurrent) {
  const resources = await getScenarioResourcesModule();
  if (!isCurrent()) return;
  const bundle = preparedImport.preparedScenario?.bundle;
  const result = await resources.ensureActiveScenarioOptionalLayerLoaded(layer, {
    renderNow: false, isScenarioApplyRequestCurrent: isCurrent,
  });
  if (!isCurrent()) return;
  const urlField = layer === "cities" ? "city_overrides_url" : "strategic_values_url";
  // Missing configuration and chunk-owned layers legitimately return null.
  if (result === null && bundle?.manifest?.[urlField]
    && !resources.scenarioBundleUsesChunkedLayer(bundle, layer)) {
    throw new Error(`${layer} could not be restored.`);
  }
  return result;
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
async function restoreImportedTransportCountryOverlayState(target, importedState = {}, isCurrent = () => true) {
  const activePackIds = resolveImportedTransportCountryOverlayPackIds(target, importedState);
  if (!activePackIds.length) {
    clearTransportCountryOverlayState(target, "project-import-no-country-pack");
    return null;
  }
  try {
    let appliedState = null;
    for (const activePackId of activePackIds) {
      const overlayState = await loadTransportCountryOverlayState(activePackId);
      if (!isCurrent()) return null;
      appliedState = applyTransportCountryOverlayState(target, overlayState);
    }
    return appliedState;
  } catch (error) {
    if (!isCurrent()) return null;
    console.warn(`[project-import] Unable to restore transport country overlays ${activePackIds.join(", ")}.`, error);
    throw error;
  }
}

function stageImportedProjectPatch(data, preparedImport) {
  const original = { ...state, ...preparedImport.scenarioState };
  // Capture the complete explicit import-owned field set, including equal values:
  // scenario activation may change those values before this patch lands.
  const draft = { ...original,
    styleConfig: cloneImportedProjectValue(original.styleConfig),
    expandedInspectorContinents: new Set(original.expandedInspectorContinents || []),
    expandedInspectorReleaseParents: new Set(original.expandedInspectorReleaseParents || []),
  };
  const { importedOwnershipState } = preparedImport;
  draft.sovereignBaseColors = data.sovereignBaseColors || data.countryBaseColors || {};
  draft.countryBaseColors = { ...draft.sovereignBaseColors };
  draft.visualOverrides = data.visualOverrides || data.featureOverrides || {};
  draft.featureOverrides = { ...draft.visualOverrides };

  draft.waterRegionOverrides = data.waterRegionOverrides || {};
  draft.specialRegionOverrides = {};
  draft.sovereigntyByFeatureId = importedOwnershipState.sovereigntyByFeatureId;
  draft.mapSemanticMode = normalizeMapSemanticMode(
    data.mapSemanticMode,
    draft.activeScenarioId ? draft.mapSemanticMode : "political"
  );
  draft.sovereigntyInitialized = false;
  draft.paintMode = data.paintMode || "visual";
  draft.activeSovereignCode = data.activeSovereignCode || "";
  draft.selectedInspectorCountryCode = "";
  draft.inspectorHighlightCountryCode = draft.selectedInspectorCountryCode;
  draft.releasableBoundaryVariantByTag =
    data.releasableBoundaryVariantByTag &&
    typeof data.releasableBoundaryVariantByTag === "object"
      ? { ...data.releasableBoundaryVariantByTag }
      : {};
  if (draft.activeScenarioId) {
    const existingTags = Object.keys(draft.scenarioCountriesByTag || {});
    draft.scenarioReleasableIndex = buildScenarioReleasableIndex(draft.activeScenarioId);
    draft.scenarioCountriesByTag = {
      ...(draft.scenarioCountriesByTag || {}),
      ...getScenarioReleasableCountries(draft.activeScenarioId, {
        excludeTags: existingTags,
      }),
    };
  }
  draft.inspectorExpansionInitialized = false;
  if (draft.expandedInspectorContinents instanceof Set) {
    draft.expandedInspectorContinents.clear();
  }
  if (draft.expandedInspectorReleaseParents instanceof Set) {
    draft.expandedInspectorReleaseParents.clear();
  }
  draft.dynamicBordersDirty = !!data.dynamicBordersDirty;
  draft.dynamicBordersDirtyReason = data.dynamicBordersDirtyReason || "";
  resetDevTransientImportState(draft, { previewFormat: "names_with_ids" });

  const importedOverlayState = restoreImportedAnnotationOverlayState(draft, data, {
    cloneValue: cloneImportedProjectValue,
  });
  resetStrategicOverlayEditorState(draft, {
    unitCounterRenderer: importedOverlayState?.annotationView?.unitRendererDefault || "game",
  });

  // workbench UI 要先于 style/layer visibility 恢复，这样后面的 normalize 可以拿到
  // 正确的 tab、preview family 和 panel 状态，不会把导入文件里的 UI 语义抹掉。
  restoreImportedWorkbenchUiState(draft, data, {
    cloneValue: cloneImportedProjectValue,
  });

  draft.specialZones = data.specialZones || {};
  draft.specialZoneLayers = normalizeSpecialZoneLayersState(data.specialZoneLayers, {
    defaultSource: "project",
    topologyFingerprint: resolveSpecialZoneTopologyFingerprint(draft),
    validFeatureIds: preparedImport.validFeatureIds,
  });
  draft.specialZoneMembershipBrushMode = normalizeSpecialZoneMembershipBrushModeState(data.specialZoneMembershipBrushMode);
  draft.parentBordersVisible = data.parentBordersVisible !== false;
  draft.manualSpecialZones = { type: "FeatureCollection", features: [] };
  const supportedCountries = Array.isArray(draft.parentBorderSupportedCountries)
    ? draft.parentBorderSupportedCountries
    : [];
  const importedParentEnabled =
    data.parentBorderEnabledByCountry && typeof data.parentBorderEnabledByCountry === "object"
      ? data.parentBorderEnabledByCountry
      : {};
  const normalizedParentEnabled = {};
  supportedCountries.forEach((countryCode) => {
    normalizedParentEnabled[countryCode] = !!importedParentEnabled[countryCode];
  });
  draft.parentBorderEnabledByCountry = normalizedParentEnabled;
  restoreImportedStyleConfigState(draft, data.styleConfig);
  draft.intensityFields = normalizeIntensityFieldsState(data.intensityFields);
  draft.appearancePresets = normalizeAppearancePresetsState(data.appearancePresets);
  restoreImportedLayerVisibilityState(draft, data.layerVisibility);
  draft.customPresets =
    data.customPresets && typeof data.customPresets === "object" ? data.customPresets : {};
  return captureProjectImportState(draft);
}

// Required assets and the project patch are staged before changing the document.
// Once committed, optional completion cannot turn a successful import into failure.
let activeImportRequest = null;
let importRequestSequence = 0;

function captureImportDocumentIdentity(target) {
  return [target.dirtyRevision, target.activeScenarioId, target.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0,
    target.currentScenarioApplyRequestId, target.historyPast, target.historyFuture,
    target.historyPast?.length, target.historyFuture?.length];
}

function isImportDocumentCurrent(identity) {
  return captureImportDocumentIdentity(state).every((value, index) => value === identity[index]);
}

async function applyImportedProjectState(data, { ui, hooks, request }) {
  debugState.importPhase = "begin";
  const preparedImport = await prepareImportedProjectState({
    data, ui, debugState, getScenarioResourcesModule,
    getScenarioManagerModule: () => import("./scenario_manager.js"),
  });
  if (request && (activeImportRequest !== request || request.committed || !isImportDocumentCurrent(request.identity))) {
    throw Object.assign(new Error("Project import superseded by a document change."), { code: "IMPORT_ABORTED" });
  }
  data = preparedImport.data;
  const patch = stageImportedProjectPatch(data, preparedImport);
  const previous = captureProjectImportState(state);
  try {
    preparedImport.manager.commitScenarioForProjectImport(preparedImport.preparedScenario, () => {
      commitImportedProjectPatch(state, patch);
    }, () => !request || (activeImportRequest === request && !request.committed && isImportDocumentCurrent(request.identity)));
  } catch (error) {
    commitImportedProjectPatch(state, previous);
    throw error;
  }
  const warnings = [];
  // Both APIs update their state before notifying UI observers. An observer failure
  // must not turn a document that has already committed into a failed import.
  for (const [resource, finalize] of [["history-ui", clearHistory], ["save-status-ui", () => clearDirty("project-import")]]) {
    try { finalize(); } catch (error) {
      warnings.push({ resource, message: String(error?.message || error) });
    }
  }
  if (request) request.committed = true;
  debugState.importApplyCount += 1;
  debugState.lastImportedScenarioId = String(state.activeScenarioId || "");
  debugState.importPhase = "committed";
  const committedIdentity = captureImportDocumentIdentity(state);
  const isCurrent = () => (!request || activeImportRequest === request) && isImportDocumentCurrent(committedIdentity);
  if (request) request.isCurrent = isCurrent;
  const retryTasks = new Map();
  const complete = async (name, task) => {
    if (!isCurrent()) return;
    try {
      const result = await task();
      if (result === false) throw new Error(`${name} could not be restored.`);
    } catch (error) {
      if (!isCurrent()) return;
      warnings.push({ resource: name, message: String(error?.message || error) });
      retryTasks.set(name, task);
      ui.showToast(`${ui.t("Project imported", "ui")}: ${name} — ${String(error?.message || error)}`, {
        tone: "warning", duration: 12000, actionLabel: ui.t("Retry", "ui"),
        onAction: async () => {
          if (!isCurrent()) return;
          if (await task() === false) throw new Error(`${name} could not be restored.`);
          retryTasks.delete(name);
        },
      });
    }
  };
  await complete("document-refresh", () => {
    markLegacyColorStateDirty();
    hooks.invalidateFrontlineOverlayState?.();
    callRuntimeHook(state, "clearExportBakeCacheFn");
  });
  await complete("scenario-runtime", () => preparedImport.manager.completeScenarioProjectImport(preparedImport.preparedScenario, isCurrent));
  // Scenario activation commits topology before the renderer publishes its new
  // landData. Seeding ownership earlier would copy outgoing TNO/Atlantropa/global
  // feature IDs into this document, and its next import would correctly reject them.
  if (!warnings.some(warning => warning.resource === "scenario-runtime")) {
    await complete("ownership-index", () => ensureSovereigntyState({ force: true }));
  }
  const paletteId = String(data.activePaletteId || "").trim();
  if (paletteId) await complete(`palette:${paletteId}`, () => setActivePaletteSource(paletteId, {
    syncUI: true, overwriteCountryPalette: false, isCurrent,
  }));
  if (state.activeScenarioId && state.showCityPoints) await complete("cities", async () => {
    const baseCities = await callRuntimeHook(state, "ensureBaseCityDataFn", { reason: "project-import", renderNow: false });
    if (!isCurrent()) return;
    if (baseCities === null || state.baseCityDataState === "error") throw new Error("Base cities could not be restored.");
    return restoreImportedScenarioOptionalLayer("cities", preparedImport, isCurrent);
  });
  if (state.activeScenarioId && (state.showStrategicResourceMarkers || state.strategicChoroplethMetric)) {
    await complete("strategicvalues", () => restoreImportedScenarioOptionalLayer("strategicvalues", preparedImport, isCurrent));
  }
  for (const [visible, name, layer] of [
    [state.showRivers, "rivers", "rivers"], [state.showUrban, "urban", "urban"],
    [state.showPhysical, "physical", ["physical-set", "physical-contours-set"]],
  ]) if (visible) await complete(name, async () => {
    const result = await callRuntimeHook(state, "ensureContextLayerDataFn", layer, { reason: "project-import", renderNow: false });
    if (isCurrent()) validateImportedContextLayerResult(result);
  });
  await complete("transport-overview", () => restoreImportedTransportOverviewDataLayers(state, isCurrent));
  await complete("transport-country-overlays", () => restoreImportedTransportCountryOverlayState(state, data, isCurrent));
  await complete("project-ui", () => syncProjectImportUiState({ scenarioImportAudit: preparedImport.scenarioImportAudit, hooks }));
  if (!request || activeImportRequest === request) {
    debugState.importPhase = "complete";
  }
  return {
    status: warnings.length ? "committed-with-warnings" : "committed",
    summary: preparedImport.importSummary, warnings,
    // Retry only the named incomplete resource while this committed document is still current.
    retry: async (resource) => {
      if (!isCurrent() || !retryTasks.has(resource)) return false;
      if (await retryTasks.get(resource)() === false) return false;
      retryTasks.delete(resource);
      return true;
    },
  };
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

async function runProjectImport(input, options, source) {
  if (activeImportRequest?.pending) return { status: "failed", reason: "import-in-progress" };
  const request = { id: ++importRequestSequence, pending: true, committed: false,
    identity: captureImportDocumentIdentity(state) };
  activeImportRequest = request;
  const ui = resolveUi(options.ui);
  const hooks = resolveHooks(options.hooks);
  debugState.importStartCount += 1;
  debugState.importPhase = `${source}-read`;
  debugState.lastImportError = "";
  debugState.lastImportFileName = String(source === "file" ? input?.name || "" : options.fileName || "");
  let result = null;
  try {
    const { FileManager } = await getFileManagerModule();
    const callback = async data => {
      result = await applyImportedProjectState(data, { ui, hooks, request });
      return result;
    };
    const observers = {
      onSuccess: () => {
        request.pending = false;
        if (activeImportRequest === request && result && request.isCurrent?.()) hooks.onProjectImportComplete?.(result.summary);
      },
      onError: error => {
        request.pending = false;
        result = { status: error?.code === "IMPORT_ABORTED" ? "cancelled" : "failed", error };
        debugState.importPhase = result.status;
        debugState.lastImportError = String(error?.message || error || "");
        hooks.onProjectImportError?.(error);
      },
    };
    const outcome = source === "file"
      ? await FileManager.importProject(input, callback, observers, options.importOptions || {})
      : await FileManager.importProjectText(input, callback, observers, options.importOptions || {});
    return result || (outcome && typeof outcome === "object" ? outcome : { status: "failed" });
  } catch (error) {
    reportImportModuleFailure(error, ui, hooks);
    return { status: "failed", error };
  } finally {
    request.pending = false;
  }
}

export function importProjectThroughFunnel(file, options = {}) {
  return runProjectImport(file, options, "file");
}

export function importProjectTextThroughFunnel(text, options = {}) {
  return runProjectImport(text, options, "text");
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
