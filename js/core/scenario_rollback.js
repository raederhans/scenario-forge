import { countryNames, defaultCountryPalette, state } from "./state.js";
import { normalizeMapSemanticMode } from "./state.js";
import { markLegacyColorStateDirty } from "./sovereignty_manager.js";
import { syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import {
  createDefaultActiveScenarioChunksState,
  createDefaultScenarioHydrationHealthGate,
  createDefaultRuntimeChunkLoadState,
} from "./state/scenario_runtime_state.js";
import { ensureScenarioAuditUiState, setScenarioAuditUiState } from "./scenario_ui_sync.js";
import { scheduleScenarioChunkRefresh } from "./scenario_resources.js";
import { cloneScenarioStateValue } from "./scenario/shared.js";

const ROLLBACK_REQUIRED_KEYS = Object.freeze([
  "activeScenarioId",
  "scenarioBorderMode",
  "activeScenarioManifest",
  "scenarioCountriesByTag",
  "scenarioFixedOwnerColors",
  "defaultRuntimePoliticalTopology",
  "scenarioRuntimeTopologyData",
  "scenarioLandMaskData",
  "scenarioContextLandMaskData",
  "scenarioLandMaskVersionTag",
  "scenarioContextLandMaskVersionTag",
  "runtimePoliticalTopology",
  "scenarioWaterRegionsData",
  "scenarioWaterOverlayVersionTag",
  "scenarioSpecialRegionsData",
  "scenarioRuntimeTopologyVersionTag",
  "scenarioHydrationHealthGate",
  "scenarioReliefOverlaysData",
  "scenarioDistrictGroupsData",
  "scenarioDistrictGroupByFeatureId",
  "scenarioReliefOverlayRevision",
  "scenarioGeoLocalePatchData",
  "scenarioCityOverridesData",
  "cityLayerRevision",
  "scenarioReleasableIndex",
  "releasableCatalog",
  "scenarioAudit",
  "scenarioAuditUi",
  "scenarioImportAudit",
  "scenarioBaselineHash",
  "scenarioBaselineOwnersByFeatureId",
  "scenarioControllersByFeatureId",
  "scenarioAutoShellOwnerByFeatureId",
  "scenarioAutoShellControllerByFeatureId",
  "scenarioBaselineControllersByFeatureId",
  "scenarioBaselineCoresByFeatureId",
  "scenarioShellOverlayRevision",
  "scenarioControllerRevision",
  "scenarioOwnerControllerDiffCount",
  "scenarioDataHealth",
  "scenarioViewMode",
  "countryNames",
  "sovereigntyByFeatureId",
  "sovereigntyInitialized",
  "visualOverrides",
  "featureOverrides",
  "sovereignBaseColors",
  "countryBaseColors",
  "activeSovereignCode",
  "selectedWaterRegionId",
  "selectedSpecialRegionId",
  "hoveredWaterRegionId",
  "hoveredSpecialRegionId",
  "selectedInspectorCountryCode",
  "inspectorHighlightCountryCode",
  "inspectorExpansionInitialized",
  "expandedInspectorContinents",
  "expandedInspectorReleaseParents",
  "parentBordersVisible",
  "scenarioParentBorderEnabledBeforeActivate",
  "parentBorderEnabledByCountry",
  "scenarioPaintModeBeforeActivate",
  "paintMode",
  "interactionGranularity",
  "batchFillScope",
  "scenarioUiState",
  "scenarioOceanFillBeforeActivate",
  "styleConfigOcean",
  "scenarioDisplaySettingsBeforeActivate",
  "activeScenarioPerformanceHints",
  "scenarioPoliticalChunkData",
  "activeScenarioChunks",
  "runtimeChunkLoadState",
  "renderProfile",
  "dynamicBordersEnabled",
  "showCityPoints",
  "showWaterRegions",
  "showScenarioSpecialRegions",
  "showScenarioReliefOverlays",
  "activePaletteId",
  "activePaletteMeta",
  "activePalettePack",
  "activePaletteMap",
  "currentPaletteTheme",
  "activePaletteOceanMeta",
  "fixedPaletteColorsByIso2",
  "resolvedDefaultCountryPalette",
  "paletteLibraryEntries",
  "paletteQuickSwatches",
  "paletteLoadErrorById",
]);

function validateScenarioApplyRollbackSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Invalid rollback snapshot: expected an object.");
  }
  const missingKeys = ROLLBACK_REQUIRED_KEYS.filter(
    (key) => !Object.prototype.hasOwnProperty.call(snapshot, key)
  );
  if (!missingKeys.length) {
    return;
  }
  const preview = missingKeys.slice(0, 8).join(", ");
  const suffix = missingKeys.length > 8 ? ` (+${missingKeys.length - 8} more)` : "";
  throw new Error(`Invalid rollback snapshot: missing required keys: ${preview}${suffix}`);
}

function captureScenarioRuntimeSnapshot() {
  return {
    activeScenarioId: state.activeScenarioId,
    scenarioBorderMode: state.scenarioBorderMode,
    activeScenarioManifest: cloneScenarioStateValue(state.activeScenarioManifest),
    scenarioCountriesByTag: cloneScenarioStateValue(state.scenarioCountriesByTag),
    scenarioFixedOwnerColors: cloneScenarioStateValue(state.scenarioFixedOwnerColors),
    defaultRuntimePoliticalTopology: cloneScenarioStateValue(state.defaultRuntimePoliticalTopology),
    scenarioRuntimeTopologyData: cloneScenarioStateValue(state.scenarioRuntimeTopologyData),
    scenarioLandMaskData: cloneScenarioStateValue(state.scenarioLandMaskData),
    scenarioContextLandMaskData: cloneScenarioStateValue(state.scenarioContextLandMaskData),
    scenarioLandMaskVersionTag: String(state.scenarioLandMaskVersionTag || ""),
    scenarioContextLandMaskVersionTag: String(state.scenarioContextLandMaskVersionTag || ""),
    runtimePoliticalTopology: cloneScenarioStateValue(state.runtimePoliticalTopology),
    scenarioWaterRegionsData: cloneScenarioStateValue(state.scenarioWaterRegionsData),
    scenarioWaterOverlayVersionTag: String(state.scenarioWaterOverlayVersionTag || ""),
    scenarioSpecialRegionsData: cloneScenarioStateValue(state.scenarioSpecialRegionsData),
    scenarioRuntimeTopologyVersionTag: String(state.scenarioRuntimeTopologyVersionTag || ""),
    scenarioHydrationHealthGate: cloneScenarioStateValue(state.scenarioHydrationHealthGate),
    scenarioReliefOverlaysData: cloneScenarioStateValue(state.scenarioReliefOverlaysData),
    scenarioDistrictGroupsData: cloneScenarioStateValue(state.scenarioDistrictGroupsData),
    scenarioDistrictGroupByFeatureId: cloneScenarioStateValue(state.scenarioDistrictGroupByFeatureId),
    scenarioReliefOverlayRevision: Number(state.scenarioReliefOverlayRevision) || 0,
    scenarioGeoLocalePatchData: cloneScenarioStateValue(state.scenarioGeoLocalePatchData),
    scenarioCityOverridesData: cloneScenarioStateValue(state.scenarioCityOverridesData),
    cityLayerRevision: Number(state.cityLayerRevision) || 0,
    scenarioReleasableIndex: cloneScenarioStateValue(state.scenarioReleasableIndex),
    releasableCatalog: cloneScenarioStateValue(state.releasableCatalog),
    scenarioAudit: cloneScenarioStateValue(state.scenarioAudit),
    scenarioAuditUi: cloneScenarioStateValue(ensureScenarioAuditUiState()),
    scenarioImportAudit: cloneScenarioStateValue(state.scenarioImportAudit),
    scenarioBaselineHash: String(state.scenarioBaselineHash || ""),
    scenarioBaselineOwnersByFeatureId: cloneScenarioStateValue(state.scenarioBaselineOwnersByFeatureId),
    scenarioControllersByFeatureId: cloneScenarioStateValue(state.scenarioControllersByFeatureId),
    scenarioAutoShellOwnerByFeatureId: cloneScenarioStateValue(state.scenarioAutoShellOwnerByFeatureId),
    scenarioAutoShellControllerByFeatureId: cloneScenarioStateValue(state.scenarioAutoShellControllerByFeatureId),
    scenarioBaselineControllersByFeatureId: cloneScenarioStateValue(state.scenarioBaselineControllersByFeatureId),
    scenarioBaselineCoresByFeatureId: cloneScenarioStateValue(state.scenarioBaselineCoresByFeatureId),
    scenarioShellOverlayRevision: Number(state.scenarioShellOverlayRevision) || 0,
    scenarioControllerRevision: Number(state.scenarioControllerRevision) || 0,
    scenarioOwnerControllerDiffCount: Number(state.scenarioOwnerControllerDiffCount) || 0,
    scenarioDataHealth: cloneScenarioStateValue(state.scenarioDataHealth),
    scenarioViewMode: String(state.scenarioViewMode || "ownership"),
    mapSemanticMode: normalizeMapSemanticMode(state.mapSemanticMode),
    countryNames: cloneScenarioStateValue(state.countryNames),
    sovereigntyByFeatureId: cloneScenarioStateValue(state.sovereigntyByFeatureId),
    sovereigntyInitialized: !!state.sovereigntyInitialized,
    visualOverrides: cloneScenarioStateValue(state.visualOverrides),
    featureOverrides: cloneScenarioStateValue(state.featureOverrides),
    sovereignBaseColors: cloneScenarioStateValue(state.sovereignBaseColors),
    countryBaseColors: cloneScenarioStateValue(state.countryBaseColors),
    activeScenarioPerformanceHints: cloneScenarioStateValue(state.activeScenarioPerformanceHints),
    scenarioPoliticalChunkData: cloneScenarioStateValue(state.scenarioPoliticalChunkData),
    activeScenarioChunks: cloneScenarioStateValue(state.activeScenarioChunks),
    runtimeChunkLoadState: cloneScenarioStateValue({
      ...(state.runtimeChunkLoadState || {}),
      refreshTimerId: null,
    }),
    renderProfile: String(state.renderProfile || "auto"),
    dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
    showCityPoints: state.showCityPoints !== false,
    showWaterRegions: state.showWaterRegions !== false,
    showScenarioSpecialRegions: state.showScenarioSpecialRegions !== false,
    showScenarioReliefOverlays: state.showScenarioReliefOverlays !== false,
  };
}

function captureScenarioPresentationSnapshot() {
  return {
    activeSovereignCode: String(state.activeSovereignCode || ""),
    selectedWaterRegionId: String(state.selectedWaterRegionId || ""),
    selectedSpecialRegionId: String(state.selectedSpecialRegionId || ""),
    hoveredWaterRegionId: state.hoveredWaterRegionId ?? null,
    hoveredSpecialRegionId: state.hoveredSpecialRegionId ?? null,
    selectedInspectorCountryCode: String(state.selectedInspectorCountryCode || ""),
    inspectorHighlightCountryCode: String(state.inspectorHighlightCountryCode || ""),
    inspectorExpansionInitialized: !!state.inspectorExpansionInitialized,
    expandedInspectorContinents: cloneScenarioStateValue(state.expandedInspectorContinents),
    expandedInspectorReleaseParents: cloneScenarioStateValue(state.expandedInspectorReleaseParents),
    parentBordersVisible: state.parentBordersVisible !== false,
    scenarioParentBorderEnabledBeforeActivate: cloneScenarioStateValue(state.scenarioParentBorderEnabledBeforeActivate),
    parentBorderEnabledByCountry: cloneScenarioStateValue(state.parentBorderEnabledByCountry),
    scenarioPaintModeBeforeActivate: cloneScenarioStateValue(state.scenarioPaintModeBeforeActivate),
    paintMode: String(state.paintMode || "visual"),
    interactionGranularity: String(state.interactionGranularity || "subdivision"),
    batchFillScope: String(state.batchFillScope || "parent"),
    scenarioUiState: {
      politicalEditingExpanded: !!state.ui?.politicalEditingExpanded,
      scenarioVisualAdjustmentsOpen: !!state.ui?.scenarioVisualAdjustmentsOpen,
    },
    scenarioOceanFillBeforeActivate: state.scenarioOceanFillBeforeActivate,
    styleConfigOcean: cloneScenarioStateValue(state.styleConfig?.ocean || {}),
    locales: cloneScenarioStateValue(state.locales),
    geoAliasToStableKey: cloneScenarioStateValue(state.geoAliasToStableKey),
    scenarioDisplaySettingsBeforeActivate: cloneScenarioStateValue(state.scenarioDisplaySettingsBeforeActivate),
  };
}

function captureScenarioPaletteSnapshot() {
  return {
    activePaletteId: String(state.activePaletteId || ""),
    activePaletteMeta: cloneScenarioStateValue(state.activePaletteMeta),
    activePalettePack: cloneScenarioStateValue(state.activePalettePack),
    activePaletteMap: cloneScenarioStateValue(state.activePaletteMap),
    currentPaletteTheme: String(state.currentPaletteTheme || ""),
    activePaletteOceanMeta: cloneScenarioStateValue(state.activePaletteOceanMeta),
    fixedPaletteColorsByIso2: cloneScenarioStateValue(state.fixedPaletteColorsByIso2),
    resolvedDefaultCountryPalette: cloneScenarioStateValue(state.resolvedDefaultCountryPalette),
    paletteLibraryEntries: cloneScenarioStateValue(state.paletteLibraryEntries),
    paletteQuickSwatches: cloneScenarioStateValue(state.paletteQuickSwatches),
    paletteLoadErrorById: cloneScenarioStateValue(state.paletteLoadErrorById),
  };
}

export function captureScenarioApplyRollbackSnapshot() {
  return {
    ...captureScenarioRuntimeSnapshot(),
    ...captureScenarioPresentationSnapshot(),
    ...captureScenarioPaletteSnapshot(),
  };
}

function restoreScenarioRuntimeSnapshot(snapshot) {
  state.activeScenarioId = snapshot.activeScenarioId;
  state.scenarioBorderMode = snapshot.scenarioBorderMode;
  state.activeScenarioManifest = cloneScenarioStateValue(snapshot.activeScenarioManifest);
  state.scenarioCountriesByTag = cloneScenarioStateValue(snapshot.scenarioCountriesByTag);
  state.scenarioFixedOwnerColors = cloneScenarioStateValue(snapshot.scenarioFixedOwnerColors);
  state.defaultRuntimePoliticalTopology = cloneScenarioStateValue(snapshot.defaultRuntimePoliticalTopology);
  state.scenarioRuntimeTopologyData = cloneScenarioStateValue(snapshot.scenarioRuntimeTopologyData);
  state.scenarioLandMaskData = cloneScenarioStateValue(snapshot.scenarioLandMaskData);
  state.scenarioContextLandMaskData = cloneScenarioStateValue(snapshot.scenarioContextLandMaskData);
  state.scenarioLandMaskVersionTag = String(snapshot.scenarioLandMaskVersionTag || "");
  state.scenarioContextLandMaskVersionTag = String(snapshot.scenarioContextLandMaskVersionTag || "");
  state.runtimePoliticalTopology = cloneScenarioStateValue(snapshot.runtimePoliticalTopology);
  state.scenarioWaterRegionsData = cloneScenarioStateValue(snapshot.scenarioWaterRegionsData);
  state.scenarioWaterOverlayVersionTag = String(snapshot.scenarioWaterOverlayVersionTag || "");
  state.scenarioSpecialRegionsData = cloneScenarioStateValue(snapshot.scenarioSpecialRegionsData);
  state.scenarioRuntimeTopologyVersionTag = String(snapshot.scenarioRuntimeTopologyVersionTag || "");
  state.scenarioHydrationHealthGate =
    cloneScenarioStateValue(snapshot.scenarioHydrationHealthGate) || createDefaultScenarioHydrationHealthGate();
  state.scenarioReliefOverlaysData = cloneScenarioStateValue(snapshot.scenarioReliefOverlaysData);
  state.scenarioDistrictGroupsData = cloneScenarioStateValue(snapshot.scenarioDistrictGroupsData);
  state.scenarioDistrictGroupByFeatureId = cloneScenarioStateValue(snapshot.scenarioDistrictGroupByFeatureId) || new Map();
  state.scenarioReliefOverlayRevision = Number(snapshot.scenarioReliefOverlayRevision) || 0;
  state.scenarioGeoLocalePatchData = cloneScenarioStateValue(snapshot.scenarioGeoLocalePatchData);
  state.scenarioCityOverridesData = cloneScenarioStateValue(snapshot.scenarioCityOverridesData);
  state.cityLayerRevision = Number(snapshot.cityLayerRevision) || 0;
  state.scenarioReleasableIndex = cloneScenarioStateValue(snapshot.scenarioReleasableIndex);
  state.releasableCatalog = cloneScenarioStateValue(snapshot.releasableCatalog);
  state.scenarioAudit = cloneScenarioStateValue(snapshot.scenarioAudit);
  setScenarioAuditUiState(cloneScenarioStateValue(snapshot.scenarioAuditUi) || {});
  state.scenarioImportAudit = cloneScenarioStateValue(snapshot.scenarioImportAudit);
  state.scenarioBaselineHash = String(snapshot.scenarioBaselineHash || "");
  state.scenarioBaselineOwnersByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineOwnersByFeatureId);
  state.scenarioControllersByFeatureId = cloneScenarioStateValue(snapshot.scenarioControllersByFeatureId);
  state.scenarioAutoShellOwnerByFeatureId = cloneScenarioStateValue(snapshot.scenarioAutoShellOwnerByFeatureId);
  state.scenarioAutoShellControllerByFeatureId = cloneScenarioStateValue(snapshot.scenarioAutoShellControllerByFeatureId);
  state.scenarioBaselineControllersByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineControllersByFeatureId);
  state.scenarioBaselineCoresByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineCoresByFeatureId);
  state.scenarioShellOverlayRevision = Number(snapshot.scenarioShellOverlayRevision) || 0;
  state.scenarioControllerRevision = Number(snapshot.scenarioControllerRevision) || 0;
  state.scenarioOwnerControllerDiffCount = Number(snapshot.scenarioOwnerControllerDiffCount) || 0;
  state.scenarioDataHealth = cloneScenarioStateValue(snapshot.scenarioDataHealth);
  state.scenarioViewMode = String(snapshot.scenarioViewMode || "ownership");
  state.mapSemanticMode = normalizeMapSemanticMode(snapshot.mapSemanticMode);
  state.countryNames = cloneScenarioStateValue(snapshot.countryNames) || { ...countryNames };
  state.sovereigntyByFeatureId = cloneScenarioStateValue(snapshot.sovereigntyByFeatureId);
  state.sovereigntyInitialized = !!snapshot.sovereigntyInitialized;
  state.visualOverrides = cloneScenarioStateValue(snapshot.visualOverrides);
  state.featureOverrides = cloneScenarioStateValue(snapshot.featureOverrides);
  state.sovereignBaseColors = cloneScenarioStateValue(snapshot.sovereignBaseColors);
  state.countryBaseColors = cloneScenarioStateValue(snapshot.countryBaseColors);
  markLegacyColorStateDirty();
  state.activeScenarioPerformanceHints = cloneScenarioStateValue(snapshot.activeScenarioPerformanceHints);
  state.scenarioPoliticalChunkData = cloneScenarioStateValue(snapshot.scenarioPoliticalChunkData);
  state.activeScenarioChunks =
    cloneScenarioStateValue(snapshot.activeScenarioChunks) || createDefaultActiveScenarioChunksState();
  state.runtimeChunkLoadState =
    cloneScenarioStateValue(snapshot.runtimeChunkLoadState) || createDefaultRuntimeChunkLoadState();
  state.renderProfile = String(snapshot.renderProfile || "auto");
  state.dynamicBordersEnabled = snapshot.dynamicBordersEnabled !== false;
  state.showCityPoints = snapshot.showCityPoints !== false;
  state.showWaterRegions = snapshot.showWaterRegions !== false;
  state.showScenarioSpecialRegions = snapshot.showScenarioSpecialRegions !== false;
  state.showScenarioReliefOverlays = snapshot.showScenarioReliefOverlays !== false;
}

function restoreScenarioPresentationSnapshot(snapshot) {
  state.activeSovereignCode = String(snapshot.activeSovereignCode || "");
  state.selectedWaterRegionId = String(snapshot.selectedWaterRegionId || "");
  state.selectedSpecialRegionId = String(snapshot.selectedSpecialRegionId || "");
  state.hoveredWaterRegionId = snapshot.hoveredWaterRegionId ?? null;
  state.hoveredSpecialRegionId = snapshot.hoveredSpecialRegionId ?? null;
  state.selectedInspectorCountryCode = String(snapshot.selectedInspectorCountryCode || "");
  state.inspectorHighlightCountryCode = String(snapshot.inspectorHighlightCountryCode || "");
  state.inspectorExpansionInitialized = !!snapshot.inspectorExpansionInitialized;
  state.expandedInspectorContinents =
    cloneScenarioStateValue(snapshot.expandedInspectorContinents) || new Set();
  state.expandedInspectorReleaseParents =
    cloneScenarioStateValue(snapshot.expandedInspectorReleaseParents) || new Set();
  state.parentBordersVisible = snapshot.parentBordersVisible !== false;
  state.scenarioParentBorderEnabledBeforeActivate =
    cloneScenarioStateValue(snapshot.scenarioParentBorderEnabledBeforeActivate);
  state.parentBorderEnabledByCountry = cloneScenarioStateValue(snapshot.parentBorderEnabledByCountry) || {};
  state.scenarioPaintModeBeforeActivate = cloneScenarioStateValue(snapshot.scenarioPaintModeBeforeActivate);
  state.paintMode = String(snapshot.paintMode || "visual");
  state.interactionGranularity = String(snapshot.interactionGranularity || "subdivision");
  state.batchFillScope = String(snapshot.batchFillScope || "parent");
  if (!state.ui || typeof state.ui !== "object") {
    state.ui = {};
  }
  state.ui.politicalEditingExpanded = !!snapshot.scenarioUiState?.politicalEditingExpanded;
  state.ui.scenarioVisualAdjustmentsOpen = !!snapshot.scenarioUiState?.scenarioVisualAdjustmentsOpen;
  state.scenarioOceanFillBeforeActivate = snapshot.scenarioOceanFillBeforeActivate;
  if (!state.styleConfig || typeof state.styleConfig !== "object") {
    state.styleConfig = {};
  }
  state.styleConfig.ocean = cloneScenarioStateValue(snapshot.styleConfigOcean) || {};
  state.locales = cloneScenarioStateValue(snapshot.locales) || { ui: {}, geo: {} };
  state.geoAliasToStableKey = cloneScenarioStateValue(snapshot.geoAliasToStableKey) || {};
  state.scenarioDisplaySettingsBeforeActivate =
    cloneScenarioStateValue(snapshot.scenarioDisplaySettingsBeforeActivate);
}

function restoreScenarioPaletteSnapshot(snapshot) {
  state.activePaletteId = String(snapshot.activePaletteId || "");
  state.activePaletteMeta = cloneScenarioStateValue(snapshot.activePaletteMeta);
  state.activePalettePack = cloneScenarioStateValue(snapshot.activePalettePack);
  state.activePaletteMap = cloneScenarioStateValue(snapshot.activePaletteMap);
  state.currentPaletteTheme = String(snapshot.currentPaletteTheme || "");
  state.activePaletteOceanMeta = cloneScenarioStateValue(snapshot.activePaletteOceanMeta);
  state.fixedPaletteColorsByIso2 = cloneScenarioStateValue(snapshot.fixedPaletteColorsByIso2) || {};
  state.resolvedDefaultCountryPalette =
    cloneScenarioStateValue(snapshot.resolvedDefaultCountryPalette) || { ...defaultCountryPalette };
  state.paletteLibraryEntries = cloneScenarioStateValue(snapshot.paletteLibraryEntries) || [];
  state.paletteQuickSwatches = cloneScenarioStateValue(snapshot.paletteQuickSwatches) || [];
  state.paletteLoadErrorById = cloneScenarioStateValue(snapshot.paletteLoadErrorById) || {};
}

export function restoreScenarioApplyRollbackSnapshot(
  snapshot,
  {
    shouldFailRestore = false,
  } = {}
) {
  validateScenarioApplyRollbackSnapshot(snapshot);
  if (shouldFailRestore) {
    throw new Error("Injected rollback restore failure.");
  }
  if (state.runtimeChunkLoadState?.refreshTimerId) {
    globalThis.clearTimeout(state.runtimeChunkLoadState.refreshTimerId);
  }

  restoreScenarioRuntimeSnapshot(snapshot);
  restoreScenarioPresentationSnapshot(snapshot);
  restoreScenarioPaletteSnapshot(snapshot);
  state.scheduleScenarioChunkRefreshFn = snapshot.activeScenarioId ? scheduleScenarioChunkRefresh : null;
  syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });
  return true;
}
