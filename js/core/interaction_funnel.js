import { FileManager } from "./file_manager.js";
import { clearHistory } from "./history_manager.js";
import {
  ensureActiveScenarioOptionalLayerLoaded,
  validateImportedScenarioBaseline,
} from "./scenario_manager.js";
import {
  applyScenarioByIdCommand,
  clearActiveScenarioCommand,
  resetScenarioToBaselineCommand,
  setScenarioViewModeCommand,
} from "./scenario_dispatcher.js";
import {
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
  rebuildPresetState,
} from "./releasable_manager.js";
import { ensureDetailTopologyBoundary, requestRender } from "./render_boundary.js";
import { setActivePaletteSource } from "./palette_manager.js";
import {
  ensureSovereigntyState,
  getFeatureId,
  markLegacyColorStateDirty,
  migrateFeatureScopedProjectDataToCurrentTopology,
} from "./sovereignty_manager.js";
import {
  normalizeAnnotationView,
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizeLakeStyleConfig,
  normalizeMapSemanticMode,
  normalizePhysicalStyleConfig,
  state,
} from "./state.js";

let mapClickImpl = null;
let mapDoubleClickImpl = null;
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

async function waitForScenarioApplyIdle({ timeoutMs = 30_000, pollMs = 50 } = {}) {
  if (!state.scenarioApplyInFlight) {
    return true;
  }
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 30_000);
  while (state.scenarioApplyInFlight) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out while waiting for scenario apply to settle before project import.");
    }
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, Math.max(0, Number(pollMs) || 50));
    });
  }
  return true;
}

async function waitForStartupReadonlyUnlock({ timeoutMs = 45_000, pollMs = 50 } = {}) {
  if (!state.startupReadonly) {
    return true;
  }
  try {
    await ensureDetailTopologyBoundary({ applyMapData: false });
  } catch {
    // The startup unlock path owns the final recovery decision; keep waiting below.
  }
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 45_000);
  while (state.startupReadonly) {
    if (Date.now() >= deadline) {
      throw new Error(
        "Detailed interactions are still loading. Project import could not continue before startup readonly unlocked."
      );
    }
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, Math.max(0, Number(pollMs) || 50));
    });
  }
  return true;
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

function getScenarioImportValidFeatureIds() {
  if (!String(state.activeScenarioId || "").trim()) {
    return null;
  }
  if (Array.isArray(state.runtimeFeatureIds) && state.runtimeFeatureIds.length) {
    return new Set(
      state.runtimeFeatureIds
        .map((featureId) => String(featureId || "").trim())
        .filter(Boolean)
    );
  }
  if (state.runtimeFeatureIndexById instanceof Map && state.runtimeFeatureIndexById.size) {
    return new Set(
      Array.from(state.runtimeFeatureIndexById.keys())
        .map((featureId) => String(featureId || "").trim())
        .filter(Boolean)
    );
  }
  const runtimeGeometries = state.runtimePoliticalTopology?.objects?.political?.geometries;
  if (Array.isArray(runtimeGeometries) && runtimeGeometries.length) {
    return new Set(
      runtimeGeometries
        .map((geometry) => getFeatureId(geometry))
        .filter(Boolean)
    );
  }
  return null;
}

function syncProjectImportUiState({ scenarioImportAudit, hooks }) {
  state.scenarioImportAudit = state.activeScenarioId
    ? cloneImportedProjectValue(scenarioImportAudit)
    : null;
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
  }
  if (typeof state.updateStrategicOverlayUIFn === "function") {
    state.updateStrategicOverlayUIFn();
  }
  if (typeof state.updateWaterInteractionUIFn === "function") {
    state.updateWaterInteractionUIFn();
  }
  if (typeof state.updateScenarioSpecialRegionUIFn === "function") {
    state.updateScenarioSpecialRegionUIFn();
  }
  if (typeof state.updateActiveSovereignUIFn === "function") {
    state.updateActiveSovereignUIFn();
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
  if (typeof state.updateDynamicBorderStatusUIFn === "function") {
    state.updateDynamicBorderStatusUIFn();
  }
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
  if (typeof state.updateRecentUI === "function") {
    state.updateRecentUI();
  }
  if (typeof state.updateScenarioContextBarFn === "function") {
    state.updateScenarioContextBarFn();
  }
  state.persistViewSettingsFn?.();
  rebuildPresetState();
  hooks.refreshColorState?.({ renderNow: false });
  requestRender("project-import");
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (typeof state.refreshCountryInspectorDetailFn === "function") {
    state.refreshCountryInspectorDetailFn();
  }
  if (typeof state.renderWaterRegionListFn === "function") {
    state.renderWaterRegionListFn();
  }
  if (typeof state.renderSpecialRegionListFn === "function") {
    state.renderSpecialRegionListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
  if (typeof state.updateLegendUI === "function") {
    state.updateLegendUI();
  }
  if (typeof state.renderScenarioAuditPanelFn === "function") {
    state.renderScenarioAuditPanelFn();
  }
}

async function resolveScenarioImportAudit(data, ui) {
  let scenarioImportAudit = data.scenario?.importAudit || null;
  if (!data.scenario?.id) {
    return scenarioImportAudit;
  }
  const validation = await validateImportedScenarioBaseline(data.scenario);
  if (validation.ok) {
    return scenarioImportAudit;
  }
  const shouldContinue =
    validation.reason === "baseline_mismatch"
      ? await ui.showAppDialog({
          title: ui.t("Scenario Baseline Mismatch", "ui"),
          message: validation.message,
          details: ui.t(
            "The saved project was created against a different scenario baseline. Continue only if you are comfortable loading it against current assets.",
            "ui"
          ),
          confirmLabel: ui.t("Load Anyway", "ui"),
          cancelLabel: ui.t("Cancel Import", "ui"),
          tone: "warning",
        })
      : false;
  if (!shouldContinue) {
    const error = new Error("Project import cancelled.");
    error.code = "IMPORT_ABORTED";
    error.toastTitle = ui.t("Import cancelled", "ui");
    error.toastTone = validation.reason === "baseline_mismatch" ? "warning" : "error";
    error.userMessage =
      validation.reason === "missing_scenario"
        ? validation.message
        : ui.t(
            "Project import cancelled because the saved scenario baseline does not match the current assets.",
            "ui"
          );
    throw error;
  }
  if (validation.reason === "baseline_mismatch") {
    scenarioImportAudit = {
      scenarioId: String(data.scenario.id || "").trim(),
      savedVersion: Number(data.scenario.version || 1) || 1,
      currentVersion: Number(validation.currentVersion || 1) || 1,
      savedBaselineHash: String(data.scenario.baselineHash || "").trim(),
      currentBaselineHash: String(validation.currentBaselineHash || "").trim(),
      acceptedAt: new Date().toISOString(),
    };
  }
  return scenarioImportAudit;
}

async function applyImportedProjectState(data, { ui, hooks }) {
  debugState.importPhase = "begin";
  clearHistory();
  const scenarioImportAudit = await resolveScenarioImportAudit(data, ui);
  debugState.importPhase = "validated";
  await waitForScenarioApplyIdle();
  await waitForStartupReadonlyUnlock();
  debugState.importPhase = "scenario-idle";
  const importedScenarioId = String(data.scenario?.id || "").trim();
  const currentScenarioId = String(state.activeScenarioId || "").trim();
  if (importedScenarioId) {
    if (importedScenarioId === currentScenarioId) {
      debugState.importPhase = "scenario-reset";
      resetScenarioToBaselineCommand({
        renderMode: "none",
        markDirtyReason: "",
        showToastOnComplete: false,
      });
    } else {
      debugState.importPhase = "scenario-apply";
      await applyScenarioByIdCommand(importedScenarioId, {
        renderMode: "none",
        markDirtyReason: "",
        showToastOnComplete: false,
      });
    }
    setScenarioViewModeCommand(data.scenario.viewMode || "ownership", {
      renderMode: "none",
      markDirtyReason: "",
    });
  } else if (state.activeScenarioId) {
    debugState.importPhase = "scenario-clear";
    clearActiveScenarioCommand({
      renderMode: "none",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  }

  debugState.importPhase = "migration";
  const scenarioImportValidFeatureIds = getScenarioImportValidFeatureIds();
  const shouldRestoreScenarioBaselineControllers =
    !!state.activeScenarioId && !data.scenarioControllersByFeatureId;
  data = await migrateFeatureScopedProjectDataToCurrentTopology(data, {
    landData: scenarioImportValidFeatureIds ? null : state.landData,
    validFeatureIds: scenarioImportValidFeatureIds,
  });
  debugState.importPhase = "migration-done";
  state.sovereignBaseColors = data.sovereignBaseColors || data.countryBaseColors || {};
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.visualOverrides = data.visualOverrides || data.featureOverrides || {};
  state.featureOverrides = { ...state.visualOverrides };
  markLegacyColorStateDirty();
  state.waterRegionOverrides = data.waterRegionOverrides || {};
  state.specialRegionOverrides = data.specialRegionOverrides || {};
  state.sovereigntyByFeatureId = state.activeScenarioId
    ? {
        ...(state.scenarioBaselineOwnersByFeatureId || {}),
        ...(data.sovereigntyByFeatureId || {}),
      }
    : (data.sovereigntyByFeatureId || {});
  state.mapSemanticMode = normalizeMapSemanticMode(
    data.mapSemanticMode,
    state.activeScenarioId ? state.mapSemanticMode : "political"
  );
  if (state.activeScenarioId) {
    if (data.scenarioControllersByFeatureId) {
      state.scenarioControllersByFeatureId = { ...data.scenarioControllersByFeatureId };
    } else {
      state.scenarioControllersByFeatureId = {
        ...(state.scenarioBaselineControllersByFeatureId || {}),
      };
    }
  } else {
    state.scenarioControllersByFeatureId = data.scenarioControllersByFeatureId
      ? { ...data.scenarioControllersByFeatureId }
      : {};
  }
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
  state.devHoverHit = null;
  state.devSelectedHit = null;
  state.devSelectionFeatureIds = new Set();
  state.devSelectionOrder = [];
  state.devClipboardFallbackText = "";
  state.devClipboardPreviewFormat = "names_with_ids";
  ensureSovereigntyState({ force: true });
  state.specialZoneEditor = {
    active: false,
    vertices: [],
    zoneType: "custom",
    label: "",
    selectedId: null,
    counter: 1,
  };
  state.annotationView = normalizeAnnotationView({
    ...(state.annotationView || {}),
    ...(data.annotationView || {}),
  });
  state.operationalLines = Array.isArray(data.operationalLines)
    ? cloneImportedProjectValue(data.operationalLines)
    : [];
  state.operationGraphics = Array.isArray(data.operationGraphics)
    ? cloneImportedProjectValue(data.operationGraphics)
    : [];
  state.unitCounters = Array.isArray(data.unitCounters)
    ? cloneImportedProjectValue(data.unitCounters)
    : [];
  state.operationalLineEditor = {
    active: false,
    mode: "idle",
    points: [],
    kind: "frontline",
    label: "",
    stylePreset: "frontline",
    stroke: "",
    width: 0,
    opacity: 1,
    selectedId: null,
    selectedVertexIndex: -1,
    counter: 1,
  };
  state.operationGraphicsEditor = {
    active: false,
    mode: "idle",
    collection: "operationGraphics",
    points: [],
    kind: "attack",
    label: "",
    stylePreset: "attack",
    stroke: "",
    width: 0,
    opacity: 1,
    selectedId: null,
    selectedVertexIndex: -1,
    counter: 1,
  };
  state.unitCounterEditor = {
    active: false,
    renderer: String(state.annotationView?.unitRendererDefault || "game"),
    label: "",
    sidc: "",
    symbolCode: "",
    nationTag: "",
    nationSource: "display",
    presetId: "inf",
    iconId: "",
    unitType: "",
    echelon: "",
    subLabel: "",
    strengthText: "",
    layoutAnchor: { kind: "feature", key: "", slotIndex: null },
    attachment: null,
    baseFillColor: "",
    organizationPct: 78,
    equipmentPct: 74,
    statsPresetId: "regular",
    statsSource: "preset",
    size: "medium",
    selectedId: null,
    counter: 1,
  };
  state.strategicOverlayUi = {
    activeMode: "idle",
    modalOpen: false,
    modalSection: "line",
    modalEntityId: "",
    modalEntityType: "",
    counterEditorModalOpen: false,
    counterCatalogSource: "internal",
    counterCatalogCategory: "all",
    counterCatalogQuery: "",
    hoi4CounterCategory: "all",
    hoi4CounterQuery: "",
    hoi4CounterVariant: "small",
  };
  hooks.invalidateFrontlineOverlayState?.();
  state.operationalLinesDirty = true;
  state.operationGraphicsDirty = true;
  state.unitCountersDirty = true;
  state.specialZones = data.specialZones || {};
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
  state.styleConfig.internalBorders = {
    color: "#cccccc",
    opacity: 1,
    width: 0.5,
  };
  state.styleConfig.empireBorders = {
    color: "#666666",
    width: 1,
  };
  state.styleConfig.coastlines = {
    color: "#333333",
    width: 1.2,
  };
  if (data.styleConfig?.internalBorders && typeof data.styleConfig.internalBorders === "object") {
    state.styleConfig.internalBorders = {
      ...(state.styleConfig.internalBorders || {}),
      ...data.styleConfig.internalBorders,
    };
  }
  if (data.styleConfig?.empireBorders && typeof data.styleConfig.empireBorders === "object") {
    state.styleConfig.empireBorders = {
      ...(state.styleConfig.empireBorders || {}),
      ...data.styleConfig.empireBorders,
    };
  }
  if (data.styleConfig?.coastlines && typeof data.styleConfig.coastlines === "object") {
    state.styleConfig.coastlines = {
      ...(state.styleConfig.coastlines || {}),
      ...data.styleConfig.coastlines,
    };
  }
  if (data.styleConfig?.parentBorders && typeof data.styleConfig.parentBorders === "object") {
    state.styleConfig.parentBorders = {
      ...(state.styleConfig.parentBorders || {}),
      ...data.styleConfig.parentBorders,
    };
  }
  if (data.styleConfig?.ocean && typeof data.styleConfig.ocean === "object") {
    state.styleConfig.ocean = {
      ...(state.styleConfig.ocean || {}),
      ...data.styleConfig.ocean,
    };
  }
  state.styleConfig.lakes = normalizeLakeStyleConfig(data.styleConfig?.lakes);
  if (data.styleConfig?.cityPoints && typeof data.styleConfig.cityPoints === "object") {
    state.styleConfig.cityPoints = normalizeCityLayerStyleConfig({
      ...(state.styleConfig.cityPoints || {}),
      ...data.styleConfig.cityPoints,
    });
  }
  if (data.styleConfig?.urban && typeof data.styleConfig.urban === "object") {
    state.styleConfig.urban = {
      ...(state.styleConfig.urban || {}),
      ...data.styleConfig.urban,
    };
  }
  if (data.styleConfig?.physical && typeof data.styleConfig.physical === "object") {
    state.styleConfig.physical = normalizePhysicalStyleConfig({
      ...(state.styleConfig.physical || {}),
      ...data.styleConfig.physical,
    });
  }
  if (data.styleConfig?.rivers && typeof data.styleConfig.rivers === "object") {
    state.styleConfig.rivers = {
      ...(state.styleConfig.rivers || {}),
      ...data.styleConfig.rivers,
    };
  }
  if (data.styleConfig?.specialZones && typeof data.styleConfig.specialZones === "object") {
    state.styleConfig.specialZones = {
      ...(state.styleConfig.specialZones || {}),
      ...data.styleConfig.specialZones,
    };
  }
  if (data.styleConfig?.texture && typeof data.styleConfig.texture === "object") {
    state.styleConfig.texture = {
      ...(state.styleConfig.texture || {}),
      ...data.styleConfig.texture,
      paper: {
        ...(state.styleConfig.texture?.paper || {}),
        ...(data.styleConfig.texture.paper || {}),
      },
      graticule: {
        ...(state.styleConfig.texture?.graticule || {}),
        ...(data.styleConfig.texture.graticule || {}),
      },
      draftGrid: {
        ...(state.styleConfig.texture?.draftGrid || {}),
        ...(data.styleConfig.texture.draftGrid || {}),
      },
    };
  }
  if (data.styleConfig?.dayNight && typeof data.styleConfig.dayNight === "object") {
    state.styleConfig.dayNight = normalizeDayNightStyleConfig({
      ...(state.styleConfig.dayNight || {}),
      ...data.styleConfig.dayNight,
    });
  }
  if (data.layerVisibility && typeof data.layerVisibility === "object") {
    state.showWaterRegions =
      data.layerVisibility.showWaterRegions === undefined
        ? true
        : !!data.layerVisibility.showWaterRegions;
    state.showOpenOceanRegions =
      data.layerVisibility.showOpenOceanRegions === undefined
        ? false
        : !!data.layerVisibility.showOpenOceanRegions;
    state.showScenarioSpecialRegions =
      data.layerVisibility.showScenarioSpecialRegions === undefined
        ? true
        : !!data.layerVisibility.showScenarioSpecialRegions;
    state.showScenarioReliefOverlays =
      data.layerVisibility.showScenarioReliefOverlays === undefined
        ? true
        : !!data.layerVisibility.showScenarioReliefOverlays;
    state.showCityPoints =
      data.layerVisibility.showCityPoints === undefined
        ? true
        : !!data.layerVisibility.showCityPoints;
    state.showUrban = !!data.layerVisibility.showUrban;
    state.showPhysical = !!data.layerVisibility.showPhysical;
    state.showRivers = !!data.layerVisibility.showRivers;
    state.showSpecialZones =
      data.layerVisibility.showSpecialZones === undefined
        ? false
        : !!data.layerVisibility.showSpecialZones;
  }
  state.recentColors = Array.isArray(data.recentColors) ? [...data.recentColors] : [];
  state.interactionGranularity = data.interactionGranularity || "subdivision";
  state.batchFillScope = data.batchFillScope || "parent";
  state.referenceImageState = {
    ...(state.referenceImageState || {}),
    ...(data.referenceImageState || {}),
  };
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
    if (typeof state.ensureBaseCityDataFn === "function") {
      await state.ensureBaseCityDataFn({ reason: "project-import", renderNow: false });
    }
    await ensureActiveScenarioOptionalLayerLoaded("cities", { renderNow: false });
  }
  if (state.showRivers && typeof state.ensureContextLayerDataFn === "function") {
    await state.ensureContextLayerDataFn("rivers", {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (state.showUrban && typeof state.ensureContextLayerDataFn === "function") {
    await state.ensureContextLayerDataFn("urban", {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (state.showPhysical && typeof state.ensureContextLayerDataFn === "function") {
    await state.ensureContextLayerDataFn("physical-set", {
      reason: "project-import",
      renderNow: false,
    });
  }
  if (shouldRestoreScenarioBaselineControllers) {
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
