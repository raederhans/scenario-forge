import { countryNames, defaultCountryPalette, state as runtimeState } from "./state.js";
import { normalizeMapSemanticMode } from "./state.js";
import { readRegisteredRuntimeHookSource } from "./state/index.js";
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
const state = runtimeState;

const ROLLBACK_REQUIRED_KEYS = Object.freeze([
  "activeScenarioId",
  "scenarioBorderMode",
  "activeScenarioManifest",
  "scenarioCountriesByTag",
  "scenarioFixedOwnerColors",
  "activeScenarioMeshPack",
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
  "scheduleScenarioChunkRefreshEnabled",
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
    activeScenarioId: runtimeState.activeScenarioId,
    scenarioBorderMode: runtimeState.scenarioBorderMode,
    activeScenarioManifest: cloneScenarioStateValue(runtimeState.activeScenarioManifest),
    scenarioCountriesByTag: cloneScenarioStateValue(runtimeState.scenarioCountriesByTag),
    scenarioFixedOwnerColors: cloneScenarioStateValue(runtimeState.scenarioFixedOwnerColors),
    activeScenarioMeshPack: cloneScenarioStateValue(runtimeState.activeScenarioMeshPack),
    defaultRuntimePoliticalTopology: cloneScenarioStateValue(runtimeState.defaultRuntimePoliticalTopology),
    scenarioRuntimeTopologyData: cloneScenarioStateValue(runtimeState.scenarioRuntimeTopologyData),
    scenarioLandMaskData: cloneScenarioStateValue(runtimeState.scenarioLandMaskData),
    scenarioContextLandMaskData: cloneScenarioStateValue(runtimeState.scenarioContextLandMaskData),
    scenarioLandMaskVersionTag: String(runtimeState.scenarioLandMaskVersionTag || ""),
    scenarioContextLandMaskVersionTag: String(runtimeState.scenarioContextLandMaskVersionTag || ""),
    runtimePoliticalTopology: cloneScenarioStateValue(runtimeState.runtimePoliticalTopology),
    scenarioWaterRegionsData: cloneScenarioStateValue(runtimeState.scenarioWaterRegionsData),
    scenarioWaterOverlayVersionTag: String(runtimeState.scenarioWaterOverlayVersionTag || ""),
    scenarioSpecialRegionsData: cloneScenarioStateValue(runtimeState.scenarioSpecialRegionsData),
    scenarioRuntimeTopologyVersionTag: String(runtimeState.scenarioRuntimeTopologyVersionTag || ""),
    scenarioHydrationHealthGate: cloneScenarioStateValue(runtimeState.scenarioHydrationHealthGate),
    scenarioReliefOverlaysData: cloneScenarioStateValue(runtimeState.scenarioReliefOverlaysData),
    scenarioDistrictGroupsData: cloneScenarioStateValue(runtimeState.scenarioDistrictGroupsData),
    scenarioDistrictGroupByFeatureId: cloneScenarioStateValue(runtimeState.scenarioDistrictGroupByFeatureId),
    scenarioReliefOverlayRevision: Number(runtimeState.scenarioReliefOverlayRevision) || 0,
    scenarioGeoLocalePatchData: cloneScenarioStateValue(runtimeState.scenarioGeoLocalePatchData),
    scenarioCityOverridesData: cloneScenarioStateValue(runtimeState.scenarioCityOverridesData),
    cityLayerRevision: Number(runtimeState.cityLayerRevision) || 0,
    scenarioReleasableIndex: cloneScenarioStateValue(runtimeState.scenarioReleasableIndex),
    releasableCatalog: cloneScenarioStateValue(runtimeState.releasableCatalog),
    scenarioAudit: cloneScenarioStateValue(runtimeState.scenarioAudit),
    scenarioAuditUi: cloneScenarioStateValue(ensureScenarioAuditUiState()),
    scenarioImportAudit: cloneScenarioStateValue(runtimeState.scenarioImportAudit),
    scenarioBaselineHash: String(runtimeState.scenarioBaselineHash || ""),
    scenarioBaselineOwnersByFeatureId: cloneScenarioStateValue(runtimeState.scenarioBaselineOwnersByFeatureId),
    scenarioControllersByFeatureId: cloneScenarioStateValue(runtimeState.scenarioControllersByFeatureId),
    scenarioAutoShellOwnerByFeatureId: cloneScenarioStateValue(runtimeState.scenarioAutoShellOwnerByFeatureId),
    scenarioAutoShellControllerByFeatureId: cloneScenarioStateValue(runtimeState.scenarioAutoShellControllerByFeatureId),
    scenarioBaselineControllersByFeatureId: cloneScenarioStateValue(runtimeState.scenarioBaselineControllersByFeatureId),
    scenarioBaselineCoresByFeatureId: cloneScenarioStateValue(runtimeState.scenarioBaselineCoresByFeatureId),
    scenarioShellOverlayRevision: Number(runtimeState.scenarioShellOverlayRevision) || 0,
    scenarioControllerRevision: Number(runtimeState.scenarioControllerRevision) || 0,
    scenarioOwnerControllerDiffCount: Number(runtimeState.scenarioOwnerControllerDiffCount) || 0,
    scenarioDataHealth: cloneScenarioStateValue(runtimeState.scenarioDataHealth),
    scenarioViewMode: String(runtimeState.scenarioViewMode || "ownership"),
    mapSemanticMode: normalizeMapSemanticMode(runtimeState.mapSemanticMode),
    countryNames: cloneScenarioStateValue(runtimeState.countryNames),
    sovereigntyByFeatureId: cloneScenarioStateValue(runtimeState.sovereigntyByFeatureId),
    sovereigntyInitialized: !!runtimeState.sovereigntyInitialized,
    visualOverrides: cloneScenarioStateValue(runtimeState.visualOverrides),
    featureOverrides: cloneScenarioStateValue(runtimeState.featureOverrides),
    sovereignBaseColors: cloneScenarioStateValue(runtimeState.sovereignBaseColors),
    countryBaseColors: cloneScenarioStateValue(runtimeState.countryBaseColors),
    activeScenarioPerformanceHints: cloneScenarioStateValue(runtimeState.activeScenarioPerformanceHints),
    scenarioPoliticalChunkData: cloneScenarioStateValue(runtimeState.scenarioPoliticalChunkData),
    activeScenarioChunks: cloneScenarioStateValue(runtimeState.activeScenarioChunks),
    runtimeChunkLoadState: cloneScenarioStateValue({
      ...(runtimeState.runtimeChunkLoadState || {}),
      refreshTimerId: null,
    }),
    scheduleScenarioChunkRefreshEnabled:
      readRegisteredRuntimeHookSource(runtimeState, "scheduleScenarioChunkRefreshFn") === scheduleScenarioChunkRefresh,
    renderProfile: String(runtimeState.renderProfile || "auto"),
    dynamicBordersEnabled: runtimeState.dynamicBordersEnabled !== false,
    showCityPoints: runtimeState.showCityPoints !== false,
    showWaterRegions: runtimeState.showWaterRegions !== false,
    showScenarioSpecialRegions: runtimeState.showScenarioSpecialRegions !== false,
    showScenarioReliefOverlays: runtimeState.showScenarioReliefOverlays !== false,
  };
}

function captureScenarioPresentationSnapshot() {
  return {
    activeSovereignCode: String(runtimeState.activeSovereignCode || ""),
    selectedWaterRegionId: String(runtimeState.selectedWaterRegionId || ""),
    selectedSpecialRegionId: String(runtimeState.selectedSpecialRegionId || ""),
    hoveredWaterRegionId: runtimeState.hoveredWaterRegionId ?? null,
    hoveredSpecialRegionId: runtimeState.hoveredSpecialRegionId ?? null,
    selectedInspectorCountryCode: String(runtimeState.selectedInspectorCountryCode || ""),
    inspectorHighlightCountryCode: String(runtimeState.inspectorHighlightCountryCode || ""),
    inspectorExpansionInitialized: !!runtimeState.inspectorExpansionInitialized,
    expandedInspectorContinents: cloneScenarioStateValue(runtimeState.expandedInspectorContinents),
    expandedInspectorReleaseParents: cloneScenarioStateValue(runtimeState.expandedInspectorReleaseParents),
    parentBordersVisible: runtimeState.parentBordersVisible !== false,
    scenarioParentBorderEnabledBeforeActivate: cloneScenarioStateValue(runtimeState.scenarioParentBorderEnabledBeforeActivate),
    parentBorderEnabledByCountry: cloneScenarioStateValue(runtimeState.parentBorderEnabledByCountry),
    scenarioPaintModeBeforeActivate: cloneScenarioStateValue(runtimeState.scenarioPaintModeBeforeActivate),
    paintMode: String(runtimeState.paintMode || "visual"),
    interactionGranularity: String(runtimeState.interactionGranularity || "subdivision"),
    batchFillScope: String(runtimeState.batchFillScope || "parent"),
    scenarioUiState: {
      politicalEditingExpanded: !!runtimeState.ui?.politicalEditingExpanded,
      scenarioVisualAdjustmentsOpen: !!runtimeState.ui?.scenarioVisualAdjustmentsOpen,
    },
    scenarioOceanFillBeforeActivate: runtimeState.scenarioOceanFillBeforeActivate,
    styleConfigOcean: cloneScenarioStateValue(runtimeState.styleConfig?.ocean || {}),
    locales: cloneScenarioStateValue(runtimeState.locales),
    geoAliasToStableKey: cloneScenarioStateValue(runtimeState.geoAliasToStableKey),
    scenarioDisplaySettingsBeforeActivate: cloneScenarioStateValue(runtimeState.scenarioDisplaySettingsBeforeActivate),
  };
}

function captureScenarioPaletteSnapshot() {
  return {
    activePaletteId: String(runtimeState.activePaletteId || ""),
    activePaletteMeta: cloneScenarioStateValue(runtimeState.activePaletteMeta),
    activePalettePack: cloneScenarioStateValue(runtimeState.activePalettePack),
    activePaletteMap: cloneScenarioStateValue(runtimeState.activePaletteMap),
    currentPaletteTheme: String(runtimeState.currentPaletteTheme || ""),
    activePaletteOceanMeta: cloneScenarioStateValue(runtimeState.activePaletteOceanMeta),
    fixedPaletteColorsByIso2: cloneScenarioStateValue(runtimeState.fixedPaletteColorsByIso2),
    resolvedDefaultCountryPalette: cloneScenarioStateValue(runtimeState.resolvedDefaultCountryPalette),
    paletteLibraryEntries: cloneScenarioStateValue(runtimeState.paletteLibraryEntries),
    paletteQuickSwatches: cloneScenarioStateValue(runtimeState.paletteQuickSwatches),
    paletteLoadErrorById: cloneScenarioStateValue(runtimeState.paletteLoadErrorById),
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
  runtimeState.activeScenarioId = snapshot.activeScenarioId;
  runtimeState.scenarioBorderMode = snapshot.scenarioBorderMode;
  runtimeState.activeScenarioManifest = cloneScenarioStateValue(snapshot.activeScenarioManifest);
  runtimeState.scenarioCountriesByTag = cloneScenarioStateValue(snapshot.scenarioCountriesByTag);
  runtimeState.scenarioFixedOwnerColors = cloneScenarioStateValue(snapshot.scenarioFixedOwnerColors);
  runtimeState.activeScenarioMeshPack = cloneScenarioStateValue(snapshot.activeScenarioMeshPack);
  runtimeState.defaultRuntimePoliticalTopology = cloneScenarioStateValue(snapshot.defaultRuntimePoliticalTopology);
  runtimeState.scenarioRuntimeTopologyData = cloneScenarioStateValue(snapshot.scenarioRuntimeTopologyData);
  runtimeState.scenarioLandMaskData = cloneScenarioStateValue(snapshot.scenarioLandMaskData);
  runtimeState.scenarioContextLandMaskData = cloneScenarioStateValue(snapshot.scenarioContextLandMaskData);
  runtimeState.scenarioLandMaskVersionTag = String(snapshot.scenarioLandMaskVersionTag || "");
  runtimeState.scenarioContextLandMaskVersionTag = String(snapshot.scenarioContextLandMaskVersionTag || "");
  runtimeState.runtimePoliticalTopology = cloneScenarioStateValue(snapshot.runtimePoliticalTopology);
  runtimeState.scenarioWaterRegionsData = cloneScenarioStateValue(snapshot.scenarioWaterRegionsData);
  runtimeState.scenarioWaterOverlayVersionTag = String(snapshot.scenarioWaterOverlayVersionTag || "");
  runtimeState.scenarioSpecialRegionsData = cloneScenarioStateValue(snapshot.scenarioSpecialRegionsData);
  runtimeState.scenarioRuntimeTopologyVersionTag = String(snapshot.scenarioRuntimeTopologyVersionTag || "");
  runtimeState.scenarioHydrationHealthGate =
    cloneScenarioStateValue(snapshot.scenarioHydrationHealthGate) || createDefaultScenarioHydrationHealthGate();
  runtimeState.scenarioReliefOverlaysData = cloneScenarioStateValue(snapshot.scenarioReliefOverlaysData);
  runtimeState.scenarioDistrictGroupsData = cloneScenarioStateValue(snapshot.scenarioDistrictGroupsData);
  runtimeState.scenarioDistrictGroupByFeatureId = cloneScenarioStateValue(snapshot.scenarioDistrictGroupByFeatureId) || new Map();
  runtimeState.scenarioReliefOverlayRevision = Number(snapshot.scenarioReliefOverlayRevision) || 0;
  runtimeState.scenarioGeoLocalePatchData = cloneScenarioStateValue(snapshot.scenarioGeoLocalePatchData);
  runtimeState.scenarioCityOverridesData = cloneScenarioStateValue(snapshot.scenarioCityOverridesData);
  runtimeState.cityLayerRevision = Number(snapshot.cityLayerRevision) || 0;
  runtimeState.scenarioReleasableIndex = cloneScenarioStateValue(snapshot.scenarioReleasableIndex);
  runtimeState.releasableCatalog = cloneScenarioStateValue(snapshot.releasableCatalog);
  runtimeState.scenarioAudit = cloneScenarioStateValue(snapshot.scenarioAudit);
  setScenarioAuditUiState(cloneScenarioStateValue(snapshot.scenarioAuditUi) || {});
  runtimeState.scenarioImportAudit = cloneScenarioStateValue(snapshot.scenarioImportAudit);
  runtimeState.scenarioBaselineHash = String(snapshot.scenarioBaselineHash || "");
  runtimeState.scenarioBaselineOwnersByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineOwnersByFeatureId);
  runtimeState.scenarioControllersByFeatureId = cloneScenarioStateValue(snapshot.scenarioControllersByFeatureId);
  runtimeState.scenarioAutoShellOwnerByFeatureId = cloneScenarioStateValue(snapshot.scenarioAutoShellOwnerByFeatureId);
  runtimeState.scenarioAutoShellControllerByFeatureId = cloneScenarioStateValue(snapshot.scenarioAutoShellControllerByFeatureId);
  runtimeState.scenarioBaselineControllersByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineControllersByFeatureId);
  runtimeState.scenarioBaselineCoresByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineCoresByFeatureId);
  runtimeState.scenarioShellOverlayRevision = Number(snapshot.scenarioShellOverlayRevision) || 0;
  runtimeState.scenarioControllerRevision = Number(snapshot.scenarioControllerRevision) || 0;
  runtimeState.scenarioOwnerControllerDiffCount = Number(snapshot.scenarioOwnerControllerDiffCount) || 0;
  runtimeState.scenarioDataHealth = cloneScenarioStateValue(snapshot.scenarioDataHealth);
  runtimeState.scenarioViewMode = String(snapshot.scenarioViewMode || "ownership");
  runtimeState.mapSemanticMode = normalizeMapSemanticMode(snapshot.mapSemanticMode);
  runtimeState.countryNames = cloneScenarioStateValue(snapshot.countryNames) || { ...countryNames };
  runtimeState.sovereigntyByFeatureId = cloneScenarioStateValue(snapshot.sovereigntyByFeatureId);
  runtimeState.sovereigntyInitialized = !!snapshot.sovereigntyInitialized;
  runtimeState.visualOverrides = cloneScenarioStateValue(snapshot.visualOverrides);
  runtimeState.featureOverrides = cloneScenarioStateValue(snapshot.featureOverrides);
  runtimeState.sovereignBaseColors = cloneScenarioStateValue(snapshot.sovereignBaseColors);
  runtimeState.countryBaseColors = cloneScenarioStateValue(snapshot.countryBaseColors);
  markLegacyColorStateDirty();
  runtimeState.activeScenarioPerformanceHints = cloneScenarioStateValue(snapshot.activeScenarioPerformanceHints);
  runtimeState.scenarioPoliticalChunkData = cloneScenarioStateValue(snapshot.scenarioPoliticalChunkData);
  runtimeState.activeScenarioChunks =
    cloneScenarioStateValue(snapshot.activeScenarioChunks) || createDefaultActiveScenarioChunksState();
  runtimeState.runtimeChunkLoadState =
    cloneScenarioStateValue(snapshot.runtimeChunkLoadState) || createDefaultRuntimeChunkLoadState();
  runtimeState.scheduleScenarioChunkRefreshFn = snapshot.scheduleScenarioChunkRefreshEnabled ? scheduleScenarioChunkRefresh : null;
  runtimeState.renderProfile = String(snapshot.renderProfile || "auto");
  runtimeState.dynamicBordersEnabled = snapshot.dynamicBordersEnabled !== false;
  runtimeState.showCityPoints = snapshot.showCityPoints !== false;
  runtimeState.showWaterRegions = snapshot.showWaterRegions !== false;
  runtimeState.showScenarioSpecialRegions = snapshot.showScenarioSpecialRegions !== false;
  runtimeState.showScenarioReliefOverlays = snapshot.showScenarioReliefOverlays !== false;
}

function restoreScenarioPresentationSnapshot(snapshot) {
  runtimeState.activeSovereignCode = String(snapshot.activeSovereignCode || "");
  runtimeState.selectedWaterRegionId = String(snapshot.selectedWaterRegionId || "");
  runtimeState.selectedSpecialRegionId = String(snapshot.selectedSpecialRegionId || "");
  runtimeState.hoveredWaterRegionId = snapshot.hoveredWaterRegionId ?? null;
  runtimeState.hoveredSpecialRegionId = snapshot.hoveredSpecialRegionId ?? null;
  runtimeState.selectedInspectorCountryCode = String(snapshot.selectedInspectorCountryCode || "");
  runtimeState.inspectorHighlightCountryCode = String(snapshot.inspectorHighlightCountryCode || "");
  runtimeState.inspectorExpansionInitialized = !!snapshot.inspectorExpansionInitialized;
  runtimeState.expandedInspectorContinents =
    cloneScenarioStateValue(snapshot.expandedInspectorContinents) || new Set();
  runtimeState.expandedInspectorReleaseParents =
    cloneScenarioStateValue(snapshot.expandedInspectorReleaseParents) || new Set();
  runtimeState.parentBordersVisible = snapshot.parentBordersVisible !== false;
  runtimeState.scenarioParentBorderEnabledBeforeActivate =
    cloneScenarioStateValue(snapshot.scenarioParentBorderEnabledBeforeActivate);
  runtimeState.parentBorderEnabledByCountry = cloneScenarioStateValue(snapshot.parentBorderEnabledByCountry) || {};
  runtimeState.scenarioPaintModeBeforeActivate = cloneScenarioStateValue(snapshot.scenarioPaintModeBeforeActivate);
  runtimeState.paintMode = String(snapshot.paintMode || "visual");
  runtimeState.interactionGranularity = String(snapshot.interactionGranularity || "subdivision");
  runtimeState.batchFillScope = String(snapshot.batchFillScope || "parent");
  if (!runtimeState.ui || typeof runtimeState.ui !== "object") {
    runtimeState.ui = {};
  }
  runtimeState.ui.politicalEditingExpanded = !!snapshot.scenarioUiState?.politicalEditingExpanded;
  runtimeState.ui.scenarioVisualAdjustmentsOpen = !!snapshot.scenarioUiState?.scenarioVisualAdjustmentsOpen;
  runtimeState.scenarioOceanFillBeforeActivate = snapshot.scenarioOceanFillBeforeActivate;
  if (!runtimeState.styleConfig || typeof runtimeState.styleConfig !== "object") {
    runtimeState.styleConfig = {};
  }
  runtimeState.styleConfig.ocean = cloneScenarioStateValue(snapshot.styleConfigOcean) || {};
  runtimeState.locales = cloneScenarioStateValue(snapshot.locales) || { ui: {}, geo: {} };
  runtimeState.geoAliasToStableKey = cloneScenarioStateValue(snapshot.geoAliasToStableKey) || {};
  runtimeState.scenarioDisplaySettingsBeforeActivate =
    cloneScenarioStateValue(snapshot.scenarioDisplaySettingsBeforeActivate);
}

function restoreScenarioPaletteSnapshot(snapshot) {
  runtimeState.activePaletteId = String(snapshot.activePaletteId || "");
  runtimeState.activePaletteMeta = cloneScenarioStateValue(snapshot.activePaletteMeta);
  runtimeState.activePalettePack = cloneScenarioStateValue(snapshot.activePalettePack);
  runtimeState.activePaletteMap = cloneScenarioStateValue(snapshot.activePaletteMap);
  runtimeState.currentPaletteTheme = String(snapshot.currentPaletteTheme || "");
  runtimeState.activePaletteOceanMeta = cloneScenarioStateValue(snapshot.activePaletteOceanMeta);
  runtimeState.fixedPaletteColorsByIso2 = cloneScenarioStateValue(snapshot.fixedPaletteColorsByIso2) || {};
  runtimeState.resolvedDefaultCountryPalette =
    cloneScenarioStateValue(snapshot.resolvedDefaultCountryPalette) || { ...defaultCountryPalette };
  runtimeState.paletteLibraryEntries = cloneScenarioStateValue(snapshot.paletteLibraryEntries) || [];
  runtimeState.paletteQuickSwatches = cloneScenarioStateValue(snapshot.paletteQuickSwatches) || [];
  runtimeState.paletteLoadErrorById = cloneScenarioStateValue(snapshot.paletteLoadErrorById) || {};
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
  if (runtimeState.runtimeChunkLoadState?.refreshTimerId) {
    globalThis.clearTimeout(runtimeState.runtimeChunkLoadState.refreshTimerId);
  }

  restoreScenarioRuntimeSnapshot(snapshot);
  restoreScenarioPresentationSnapshot(snapshot);
  restoreScenarioPaletteSnapshot(snapshot);
  syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });
  return true;
}

