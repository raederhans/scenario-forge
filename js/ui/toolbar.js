// Toolbar UI (Phase 13)
import {
  state,
  PALETTE_THEMES,
  createPhysicalStyleConfigForPreset,
  normalizeCityLayerStyleConfig,
    normalizeDayNightStyleConfig,
    normalizeExportWorkbenchUiState,
    normalizeLakeStyleConfig,
  normalizePhysicalPreset,
  normalizePhysicalStyleConfig,
  normalizeTransportOverviewStyleConfig,
  resolveLinkedTransportOverviewScopeAndThreshold,
  normalizeUrbanStyleConfig,
  normalizeTextureMode,
  normalizeTextureStyleConfig,
} from "../core/state.js";
import {
  autoFillMap,
  getZoomPercent,
  invalidateOceanBackgroundVisualState,
  invalidateOceanCoastalAccentVisualState,
  invalidateOceanVisualState,
  invalidateOceanWaterInteractionVisualState,
  getBathymetryPresetStyleDefaults,
  refreshColorState,
  resetZoomToFit,
  recomputeDynamicBordersNow,
  scheduleDynamicBorderRecompute,
  startSpecialZoneDraw,
  undoSpecialZoneVertex,
  zoomByStep,
  setZoomPercent,
  finishSpecialZoneDraw,
  cancelSpecialZoneDraw,
  deleteSelectedManualSpecialZone,
  selectSpecialZoneById,
  RENDER_PASS_NAMES,
  renderExportPassesToCanvas,
} from "../core/map_renderer.js";
import { captureHistoryState, canRedoHistory, canUndoHistory, pushHistoryEntry, redoHistory, undoHistory } from "../core/history_manager.js";
import {
  buildPaletteQuickSwatches,
  getPaletteSourceOptions,
  normalizeHexColor,
} from "../core/palette_manager.js";
import { ensureActiveScenarioOptionalLayerLoaded } from "../core/scenario_resources.js";
import { resetScenarioToBaselineCommand } from "../core/scenario_dispatcher.js";
import { toggleLanguage, updateUIText, t } from "./i18n.js";
import { markLegacyColorStateDirty, resetAllFeatureOwnersToCanonical } from "../core/sovereignty_manager.js";
import { showToast } from "./toast.js";
import { showAppDialog } from "./app_dialog.js";
import {
  applyDialogContract,
  createFocusReturnRegistry,
  focusSurface,
  getFocusableElements,
  rememberSurfaceTrigger,
  restoreSurfaceTriggerFocus,
  UI_URL_STATE_KEYS,
} from "./ui_contract.js";
import { markDirty, updateDirtyIndicator } from "../core/dirty_state.js";
import {
  createExportError,
  showExportFailureToast,
} from "./toolbar/export_failure_handler.js";
import {
  EXPORT_BAKE_OUTPUT_MODELS,
  EXPORT_MAIN_LAYER_IDS,
  EXPORT_MAIN_LAYER_MODEL_BY_ID,
  EXPORT_TEXT_LAYER_IDS,
  EXPORT_TEXT_LAYER_MODEL_BY_ID,
  createExportWorkbenchController,
  ensureExportWorkbenchUiState as ensureExportWorkbenchUiStateFromController,
  normalizeExportWorkbenchLayerOrder as normalizeExportWorkbenchLayerOrderFromController,
  normalizeExportWorkbenchTextVisibility as normalizeExportWorkbenchTextVisibilityFromController,
  normalizeExportWorkbenchVisibility as normalizeExportWorkbenchVisibilityFromController,
  resolveExportPassSequence as resolveExportPassSequenceFromController,
} from "./toolbar/export_workbench_controller.js";
import { createPaletteLibraryPanelController } from "./toolbar/palette_library_panel.js";
import { createScenarioGuidePopoverController } from "./toolbar/scenario_guide_popover.js";
import { createSpecialZoneEditorController } from "./toolbar/special_zone_editor.js";
import { createTransportWorkbenchController } from "./toolbar/transport_workbench_controller.js";

function renderPalette(themeName) {
  const paletteGrid = document.getElementById("paletteGrid");
  if (!paletteGrid) return;
  state.currentPaletteTheme = themeName;
  paletteGrid.replaceChildren();

  let swatches = [];
  if (state.activePalettePack?.entries) {
    swatches = buildPaletteQuickSwatches(6).map((entry) => entry.color);
  } else {
    swatches = Array.isArray(PALETTE_THEMES[themeName]) ? PALETTE_THEMES[themeName].slice(0, 6) : [];
  }

  swatches.forEach((color) => {
    const normalized = normalizeHexColor(color);
    if (!normalized) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch";
    btn.dataset.color = normalized;
    btn.style.backgroundColor = normalized;
    btn.setAttribute("aria-label", `${t("Quick Colors", "ui")}: ${normalized}`);
    btn.title = normalized;
    btn.addEventListener("click", () => {
      state.selectedColor = normalized;
      if (typeof state.updateSwatchUIFn === "function") {
        state.updateSwatchUIFn();
      }
    });
    paletteGrid.appendChild(btn);
  });

  if (!normalizeHexColor(state.selectedColor) && swatches.length > 0) {
    state.selectedColor = swatches[0];
  }
  if (typeof state.updateSwatchUIFn === "function") {
    state.updateSwatchUIFn();
  }
}

function populatePaletteSourceOptions(select) {
  if (!select) return;
  const sourceOptions = getPaletteSourceOptions();
  select.replaceChildren();

  if (sourceOptions.length > 0) {
    sourceOptions.forEach((optionData) => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      select.appendChild(option);
    });
    select.value = state.activePaletteId || sourceOptions[0]?.value || "";
    return;
  }

  Object.keys(PALETTE_THEMES).forEach((themeName) => {
    const option = document.createElement("option");
    option.value = themeName;
    option.textContent = themeName;
    select.appendChild(option);
  });
  select.value = state.currentPaletteTheme;
}

const EXPORT_MAX_DIMENSION_PX = 7680;
const EXPORT_MAX_PIXELS = 7680 * 4320;
const EXPORT_MAX_CONCURRENT_JOBS = 1;

function resolveExportBaseDimensions() {
  const dpr = Math.max(1, Number(state.dpr || globalThis.devicePixelRatio || 1));
  const fallbackLogicalWidth = Number(state.colorCanvas?.width || 0) / dpr;
  const fallbackLogicalHeight = Number(state.colorCanvas?.height || 0) / dpr;
  const width = Math.round(Number(state.width || fallbackLogicalWidth || 0));
  const height = Math.round(Number(state.height || fallbackLogicalHeight || 0));
  return { width, height };
}


function initToolbar({ render } = {}) {
  const OCEAN_ADVANCED_PRESETS = new Set([
    "bathymetry_soft",
    "bathymetry_contours",
  ]);
  const toolButtons = document.querySelectorAll(".btn-tool");
  const customColor = document.getElementById("customColor");
  const exportBtn = document.getElementById("exportWorkbenchSnapshotBtn");
  const exportTarget = document.getElementById("exportWorkbenchTarget");
  const exportFormat = document.getElementById("exportWorkbenchFormat");
  const exportScale = document.getElementById("exportWorkbenchScale");
  const exportWorkbenchLayerList = document.getElementById("exportWorkbenchMainLayerList");
  const exportWorkbenchTextElementList = document.getElementById("exportWorkbenchTextElementList");
  const textureSelect = document.getElementById("textureSelect");
  const textureOpacity = document.getElementById("textureOpacity");
  const texturePaperControls = document.getElementById("texturePaperControls");
  const texturePaperScale = document.getElementById("texturePaperScale");
  const texturePaperWarmth = document.getElementById("texturePaperWarmth");
  const texturePaperGrain = document.getElementById("texturePaperGrain");
  const texturePaperWear = document.getElementById("texturePaperWear");
  const textureGraticuleControls = document.getElementById("textureGraticuleControls");
  const textureGraticuleMajorStep = document.getElementById("textureGraticuleMajorStep");
  const textureGraticuleMinorStep = document.getElementById("textureGraticuleMinorStep");
  const textureGraticuleLabelStep = document.getElementById("textureGraticuleLabelStep");
  const textureGraticuleColor = document.getElementById("textureGraticuleColor");
  const textureGraticuleLabelColor = document.getElementById("textureGraticuleLabelColor");
  const textureGraticuleLabelSize = document.getElementById("textureGraticuleLabelSize");
  const textureGraticuleMajorWidth = document.getElementById("textureGraticuleMajorWidth");
  const textureGraticuleMinorWidth = document.getElementById("textureGraticuleMinorWidth");
  const textureGraticuleMajorOpacity = document.getElementById("textureGraticuleMajorOpacity");
  const textureGraticuleMinorOpacity = document.getElementById("textureGraticuleMinorOpacity");
  const textureDraftGridControls = document.getElementById("textureDraftGridControls");
  const textureDraftMajorStep = document.getElementById("textureDraftMajorStep");
  const textureDraftMinorStep = document.getElementById("textureDraftMinorStep");
  const textureDraftLonOffset = document.getElementById("textureDraftLonOffset");
  const textureDraftLatOffset = document.getElementById("textureDraftLatOffset");
  const textureDraftRoll = document.getElementById("textureDraftRoll");
  const textureDraftColor = document.getElementById("textureDraftColor");
  const textureDraftWidth = document.getElementById("textureDraftWidth");
  const textureDraftMajorOpacity = document.getElementById("textureDraftMajorOpacity");
  const textureDraftMinorOpacity = document.getElementById("textureDraftMinorOpacity");
  const textureDraftDash = document.getElementById("textureDraftDash");
  const dayNightEnabled = document.getElementById("dayNightEnabled");
  const dayNightModeManualBtn = document.getElementById("dayNightModeManualBtn");
  const dayNightModeUtcBtn = document.getElementById("dayNightModeUtcBtn");
  const dayNightManualControls = document.getElementById("dayNightManualControls");
  const dayNightManualTime = document.getElementById("dayNightManualTime");
  const dayNightUtcStatus = document.getElementById("dayNightUtcStatus");
  const dayNightCurrentTime = document.getElementById("dayNightCurrentTime");
  const dayNightCityLightsEnabled = document.getElementById("dayNightCityLightsEnabled");
  if (exportWorkbenchLayerList && !exportWorkbenchLayerList.getAttribute("aria-label")) {
    exportWorkbenchLayerList.setAttribute("aria-label", t("Main Layers", "ui"));
  }
  if (exportWorkbenchTextElementList && !exportWorkbenchTextElementList.getAttribute("aria-label")) {
    exportWorkbenchTextElementList.setAttribute("aria-label", t("Text elements", "ui"));
  }
  const dayNightCityLightsStyle = document.getElementById("dayNightCityLightsStyle");
  const dayNightCityLightsIntensity = document.getElementById("dayNightCityLightsIntensity");
  const dayNightCityLightsTextureOpacity = document.getElementById("dayNightCityLightsTextureOpacity");
  const dayNightCityLightsCorridorStrength = document.getElementById("dayNightCityLightsCorridorStrength");
  const dayNightCityLightsCoreSharpness = document.getElementById("dayNightCityLightsCoreSharpness");
  const dayNightCityLightsPopulationBoostEnabled = document.getElementById("dayNightCityLightsPopulationBoostEnabled");
  const dayNightCityLightsPopulationBoostStrength = document.getElementById("dayNightCityLightsPopulationBoostStrength");
  const dayNightHistoricalCityLightsDensity = document.getElementById("dayNightHistoricalCityLightsDensity");
  const dayNightHistoricalCityLightsSecondaryRetention = document.getElementById(
    "dayNightHistoricalCityLightsSecondaryRetention"
  );
  const dayNightShadowOpacity = document.getElementById("dayNightShadowOpacity");
  const dayNightTwilightWidth = document.getElementById("dayNightTwilightWidth");
  const toggleUrban = document.getElementById("toggleUrban");
  const togglePhysical = document.getElementById("togglePhysical");
  const toggleRivers = document.getElementById("toggleRivers");
  const toggleAirports = document.getElementById("toggleAirports");
  const togglePorts = document.getElementById("togglePorts");
  const toggleRail = document.getElementById("toggleRail");
  const toggleRoad = document.getElementById("toggleRoad");
  const transportAppearanceMasterToggle = document.getElementById("transportAppearanceMasterToggle");
  const transportAppearanceWorkbenchBtn = document.getElementById("transportAppearanceWorkbenchBtn");
  const transportAirportCard = document.getElementById("transportAirportCard");
  const transportPortCard = document.getElementById("transportPortCard");
  const transportRailCard = document.getElementById("transportRailCard");
  const transportRoadCard = document.getElementById("transportRoadCard");
  const transportAirportControls = document.getElementById("transportAirportControls");
  const transportPortControls = document.getElementById("transportPortControls");
  const transportRailControls = document.getElementById("transportRailControls");
  const transportRoadControls = document.getElementById("transportRoadControls");
  const airportVisualStrength = document.getElementById("airportVisualStrength");
  const airportOpacity = document.getElementById("airportOpacity");
  const airportPrimaryColor = document.getElementById("airportPrimaryColor");
  const airportLabelsEnabled = document.getElementById("airportLabelsEnabled");
  const airportLabelDensity = document.getElementById("airportLabelDensity");
  const airportLabelMode = document.getElementById("airportLabelMode");
  const airportCoverageReach = document.getElementById("airportCoverageReach");
  const airportScopeLinked = document.getElementById("airportScopeLinked");
  const airportScopeResolved = document.getElementById("airportScopeResolved");
  const airportThresholdResolved = document.getElementById("airportThresholdResolved");
  const airportScope = document.getElementById("airportScope");
  const airportImportanceThreshold = document.getElementById("airportImportanceThreshold");
  const transportAirportSummaryMeta = document.getElementById("transportAirportSummaryMeta");
  const portVisualStrength = document.getElementById("portVisualStrength");
  const portOpacity = document.getElementById("portOpacity");
  const portPrimaryColor = document.getElementById("portPrimaryColor");
  const portLabelsEnabled = document.getElementById("portLabelsEnabled");
  const portLabelDensity = document.getElementById("portLabelDensity");
  const portLabelMode = document.getElementById("portLabelMode");
  const portCoverageReach = document.getElementById("portCoverageReach");
  const portScopeLinked = document.getElementById("portScopeLinked");
  const portScopeResolved = document.getElementById("portScopeResolved");
  const portThresholdResolved = document.getElementById("portThresholdResolved");
  const portTier = document.getElementById("portTier");
  const portImportanceThreshold = document.getElementById("portImportanceThreshold");
  const transportPortSummaryMeta = document.getElementById("transportPortSummaryMeta");
  const railVisualStrength = document.getElementById("railVisualStrength");
  const railVisualStrengthValue = document.getElementById("railVisualStrengthValue");
  const railOpacity = document.getElementById("railOpacity");
  const railOpacityValue = document.getElementById("railOpacityValue");
  const railPrimaryColor = document.getElementById("railPrimaryColor");
  const railLabelsEnabled = document.getElementById("railLabelsEnabled");
  const railLabelDensity = document.getElementById("railLabelDensity");
  const railCoverageReach = document.getElementById("railCoverageReach");
  const railCoverageReachValue = document.getElementById("railCoverageReachValue");
  const railScopeLinked = document.getElementById("railScopeLinked");
  const railScopeResolved = document.getElementById("railScopeResolved");
  const railThresholdResolved = document.getElementById("railThresholdResolved");
  const railScope = document.getElementById("railScope");
  const railImportanceThreshold = document.getElementById("railImportanceThreshold");
  const transportRailSummaryMeta = document.getElementById("transportRailSummaryMeta");
  const roadVisualStrength = document.getElementById("roadVisualStrength");
  const roadVisualStrengthValue = document.getElementById("roadVisualStrengthValue");
  const roadOpacity = document.getElementById("roadOpacity");
  const roadOpacityValue = document.getElementById("roadOpacityValue");
  const roadPrimaryColor = document.getElementById("roadPrimaryColor");
  const roadCoverageReach = document.getElementById("roadCoverageReach");
  const roadCoverageReachValue = document.getElementById("roadCoverageReachValue");
  const roadScopeLinked = document.getElementById("roadScopeLinked");
  const roadScopeResolved = document.getElementById("roadScopeResolved");
  const roadThresholdResolved = document.getElementById("roadThresholdResolved");
  const roadScope = document.getElementById("roadScope");
  const roadImportanceThreshold = document.getElementById("roadImportanceThreshold");
  const transportRoadSummaryMeta = document.getElementById("transportRoadSummaryMeta");
  const toggleCityPoints = document.getElementById("toggleCityPoints");
  const toggleWaterRegions = document.getElementById("toggleWaterRegions");
  const toggleOpenOceanRegions = document.getElementById("toggleOpenOceanRegions");
  const toggleSpecialZones = document.getElementById("toggleSpecialZones");
  const cityPointsTheme = document.getElementById("cityPointsTheme");
  const cityPointsThemeHint = document.getElementById("cityPointsThemeHint");
  const cityPointsMarkerScale = document.getElementById("cityPointsMarkerScale");
  const cityPointsMarkerDensity = document.getElementById("cityPointsMarkerDensity");
  const cityPointsMarkerDensityHint = document.getElementById("cityPointsMarkerDensityHint");
  const cityPointsLabelDensity = document.getElementById("cityPointsLabelDensity");
  const cityPointsColor = document.getElementById("cityPointsColor");
  const cityPointsCapitalColor = document.getElementById("cityPointsCapitalColor");
  const cityPointsOpacity = document.getElementById("cityPointsOpacity");
  const cityPointLabelsEnabled = document.getElementById("cityPointLabelsEnabled");
  const cityPointsLabelSize = document.getElementById("cityPointsLabelSize");
  const cityCapitalOverlayEnabled = document.getElementById("cityCapitalOverlayEnabled");
  const urbanMode = document.getElementById("urbanMode");
  const urbanAdaptiveControls = document.getElementById("urbanAdaptiveControls");
  const urbanManualControls = document.getElementById("urbanManualControls");
  const lblUrbanOpacity = document.getElementById("lblUrbanOpacity");
  const urbanColor = document.getElementById("urbanColor");
  const urbanOpacity = document.getElementById("urbanOpacity");
  const urbanBlendMode = document.getElementById("urbanBlendMode");
  const urbanAdaptiveStrength = document.getElementById("urbanAdaptiveStrength");
  const urbanStrokeOpacity = document.getElementById("urbanStrokeOpacity");
  const urbanToneBias = document.getElementById("urbanToneBias");
  const urbanAdaptiveTintEnabled = document.getElementById("urbanAdaptiveTintEnabled");
  const urbanAdaptiveTintColor = document.getElementById("urbanAdaptiveTintColor");
  const urbanAdaptiveTintStrength = document.getElementById("urbanAdaptiveTintStrength");
  const urbanMinArea = document.getElementById("urbanMinArea");
  const urbanAdaptiveStatus = document.getElementById("urbanAdaptiveStatus");
  const physicalPreset = document.getElementById("physicalPreset");
  const physicalPresetHint = document.getElementById("physicalPresetHint");
  const physicalMode = document.getElementById("physicalMode");
  const physicalOpacity = document.getElementById("physicalOpacity");
  const physicalAtlasIntensity = document.getElementById("physicalAtlasIntensity");
  const physicalRainforestEmphasis = document.getElementById("physicalRainforestEmphasis");
  const physicalContourColor = document.getElementById("physicalContourColor");
  const physicalContourOpacity = document.getElementById("physicalContourOpacity");
  const physicalMinorContours = document.getElementById("physicalMinorContours");
  const physicalContourMajorWidth = document.getElementById("physicalContourMajorWidth");
  const physicalContourMinorWidth = document.getElementById("physicalContourMinorWidth");
  const physicalContourMajorInterval = document.getElementById("physicalContourMajorInterval");
  const physicalContourMinorInterval = document.getElementById("physicalContourMinorInterval");
  const physicalContourMajorLowReliefCutoff = document.getElementById("physicalContourMajorLowReliefCutoff");
  const physicalContourMinorLowReliefCutoff = document.getElementById("physicalContourMinorLowReliefCutoff");
  const physicalBlendMode = document.getElementById("physicalBlendMode");
  const physicalClassMountain = document.getElementById("physicalClassMountain");
  const physicalClassMountainHills = document.getElementById("physicalClassMountainHills");
  const physicalClassPlateau = document.getElementById("physicalClassPlateau");
  const physicalClassBadlands = document.getElementById("physicalClassBadlands");
  const physicalClassPlains = document.getElementById("physicalClassPlains");
  const physicalClassBasin = document.getElementById("physicalClassBasin");
  const physicalClassWetlands = document.getElementById("physicalClassWetlands");
  const physicalClassForestTemperate = document.getElementById("physicalClassForestTemperate");
  const physicalClassRainforestTropical = document.getElementById("physicalClassRainforestTropical");
  const physicalClassGrassland = document.getElementById("physicalClassGrassland");
  const physicalClassDesert = document.getElementById("physicalClassDesert");
  const physicalClassTundra = document.getElementById("physicalClassTundra");
  const riversColor = document.getElementById("riversColor");
  const riversOpacity = document.getElementById("riversOpacity");
  const riversWidth = document.getElementById("riversWidth");
  const riversOutlineColor = document.getElementById("riversOutlineColor");
  const riversOutlineWidth = document.getElementById("riversOutlineWidth");
  const riversDashStyle = document.getElementById("riversDashStyle");
  const specialZonesDisputedFill = document.getElementById("specialZonesDisputedFill");
  const specialZonesDisputedStroke = document.getElementById("specialZonesDisputedStroke");
  const specialZonesWastelandFill = document.getElementById("specialZonesWastelandFill");
  const specialZonesWastelandStroke = document.getElementById("specialZonesWastelandStroke");
  const specialZonesCustomFill = document.getElementById("specialZonesCustomFill");
  const specialZonesCustomStroke = document.getElementById("specialZonesCustomStroke");
  const specialZonesOpacity = document.getElementById("specialZonesOpacity");
  const specialZonesStrokeWidth = document.getElementById("specialZonesStrokeWidth");
  const specialZonesDashStyle = document.getElementById("specialZonesDashStyle");
  const specialZoneTypeSelect = document.getElementById("specialZoneTypeSelect");
  const specialZoneLabelInput = document.getElementById("specialZoneLabelInput");
  const specialZoneStartBtn = document.getElementById("specialZoneStartBtn");
  const specialZoneUndoBtn = document.getElementById("specialZoneUndoBtn");
  const specialZoneFinishBtn = document.getElementById("specialZoneFinishBtn");
  const specialZoneCancelBtn = document.getElementById("specialZoneCancelBtn");
  const specialZoneFeatureList = document.getElementById("specialZoneFeatureList");
  const specialZoneDeleteBtn = document.getElementById("specialZoneDeleteBtn");
  const specialZoneEditorHint = document.getElementById("specialZoneEditorHint");
  const recentContainer = document.getElementById("recentColors");
  const paletteLibraryToggle = document.getElementById("paletteLibraryToggle");
  const paletteLibraryPanel = document.getElementById("paletteLibraryPanel");
  const paletteLibrarySources = document.getElementById("paletteLibrarySources");
  const paletteLibrarySearch = document.getElementById("paletteLibrarySearch");
  const paletteLibrarySummary = document.getElementById("paletteLibrarySummary");
  const paletteLibraryList = document.getElementById("paletteLibraryList");
  const dockRecentDivider = document.getElementById("dockRecentDivider");
  const presetPolitical = document.getElementById("presetPolitical");
  const presetClear = document.getElementById("presetClear");
  const dockQuickFillBtn = document.getElementById("dockQuickFillBtn");
  const colorModeSelect = document.getElementById("colorModeSelect");
  const bottomDock = document.getElementById("bottomDock");
  const dockCollapseBtn = document.getElementById("dockCollapseBtn");
  const dockHandleChevron = document.getElementById("dockHandleChevron");
  const dockHandleLabel = document.getElementById("dockHandleLabel");
  const mapContainer = document.getElementById("mapContainer");
  const selectedColorPreview = document.getElementById("selectedColorPreview");
  const selectedColorValue = document.getElementById("selectedColorValue");
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const brushModeBtn = document.getElementById("brushModeBtn");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const zoomResetBtn = document.getElementById("zoomResetBtn");
  const zoomPercentInput = document.getElementById("zoomPercentInput");
  const zoomControls = document.getElementById("zoomControls");
  const developerModeBtn = document.getElementById("developerModeBtn");
  const toolHudChip = document.getElementById("toolHudChip");
  const mapOnboardingHint = document.getElementById("mapOnboardingHint");
  const scenarioContextBar = document.getElementById("scenarioContextBar");
  const scenarioContextCollapseBtn = document.getElementById("scenarioContextCollapseBtn");
  const scenarioContextScenarioItem = document.getElementById("scenarioContextScenarioItem");
  const scenarioContextModeItem = document.getElementById("scenarioContextModeItem");
  const scenarioContextActiveItem = document.getElementById("scenarioContextActiveItem");
  const scenarioContextSelectionItem = document.getElementById("scenarioContextSelectionItem");
  const scenarioContextScenarioText = document.getElementById("scenarioContextScenarioText");
  const scenarioContextModeText = document.getElementById("scenarioContextModeText");
  const scenarioContextActiveText = document.getElementById("scenarioContextActiveText");
  const scenarioContextSelectionText = document.getElementById("scenarioContextSelectionText");
  const scenarioTransportWorkbenchBtn = document.getElementById("scenarioTransportWorkbenchBtn");
  const scenarioGuideBtn = document.getElementById("scenarioGuideBtn");
  const utilitiesGuideBtn = document.getElementById("utilitiesGuideBtn");
  const scenarioGuideBackdrop = document.getElementById("scenarioGuideBackdrop");
  const scenarioGuidePopover = document.getElementById("scenarioGuidePopover");
  const scenarioGuideCloseBtn = document.getElementById("scenarioGuideCloseBtn");
  const scenarioGuideStatus = document.getElementById("scenarioGuideStatus");
  const scenarioGuideStatusChips = document.getElementById("scenarioGuideStatusChips");
  const scenarioGuideNavButtons = Array.from(document.querySelectorAll(".scenario-guide-nav-btn"));
  const scenarioGuidePanels = Array.from(document.querySelectorAll("[data-guide-panel]"));
  const dockConfigGroup = document.getElementById("dockConfigGroup");
  const dockReferenceBtn = document.getElementById("dockReferenceBtn");
  const dockExportBtn = document.getElementById("dockExportBtn");
  const dockEditPopoverBtn = document.getElementById("dockEditPopoverBtn");
  const dockReferencePopover = document.getElementById("dockReferencePopover");
  const dockEditPopover = document.getElementById("dockEditPopover");
  const devWorkspaceToggleBtn = document.getElementById("devWorkspaceToggleBtn");
  const leftPanelToggle = document.getElementById("leftPanelToggle");
  const rightPanelToggle = document.getElementById("rightPanelToggle");
  const inspectorSidebarTabProject = document.getElementById("inspectorSidebarTabProject");
  const inspectorUtilitiesSection = document.getElementById("inspectorUtilitiesSection");
  const exportProjectSection = document.getElementById("exportProjectSection");
  const exportSectionSummaryTarget = document.getElementById("exportSectionSummaryTarget");
  const exportSectionSummaryFormat = document.getElementById("exportSectionSummaryFormat");
  const exportSectionSummaryScale = document.getElementById("exportSectionSummaryScale");
  const transportWorkbenchOverlay = document.getElementById("transportWorkbenchOverlay");
  const transportWorkbenchPanel = document.getElementById("transportWorkbenchPanel");
  const exportWorkbenchOverlay = document.getElementById("exportWorkbenchOverlay");
  const exportWorkbenchPanel = document.getElementById("exportWorkbenchPanel");
  const exportWorkbenchCloseBtn = document.getElementById("exportWorkbenchCloseBtn");
  const exportWorkbenchPreviewStage = document.getElementById("exportWorkbenchPreviewStage");
  const exportWorkbenchPreviewState = document.getElementById("exportWorkbenchPreviewState");
  const exportWorkbenchPreviewModeButtons = Array.from(document.querySelectorAll(".export-workbench-preview-toggle-btn"));
  const exportWorkbenchPreviewLayerSelect = document.getElementById("exportWorkbenchPreviewLayerSelect");
  const exportWorkbenchTarget = document.getElementById("exportWorkbenchTarget");
  const exportWorkbenchFormat = document.getElementById("exportWorkbenchFormat");
  const exportWorkbenchScale = document.getElementById("exportWorkbenchScale");
  const exportWorkbenchSnapshotBtn = document.getElementById("exportWorkbenchSnapshotBtn");
  const exportWorkbenchBrightness = document.getElementById("exportWorkbenchBrightness");
  const exportWorkbenchContrast = document.getElementById("exportWorkbenchContrast");
  const exportWorkbenchSaturation = document.getElementById("exportWorkbenchSaturation");
  const exportWorkbenchClarity = document.getElementById("exportWorkbenchClarity");
  const exportWorkbenchBrightnessValue = document.getElementById("exportWorkbenchBrightnessValue");
  const exportWorkbenchContrastValue = document.getElementById("exportWorkbenchContrastValue");
  const exportWorkbenchSaturationValue = document.getElementById("exportWorkbenchSaturationValue");
  const exportWorkbenchClarityValue = document.getElementById("exportWorkbenchClarityValue");
  const exportWorkbenchBakeVisibleBtn = document.getElementById("exportWorkbenchBakeVisibleBtn");
  const exportWorkbenchClearBakeBtn = document.getElementById("exportWorkbenchClearBakeBtn");
  const exportWorkbenchBakeArtifactList = document.getElementById("exportWorkbenchBakeArtifactList");
  const transportWorkbenchInfoBtn = document.getElementById("transportWorkbenchInfoBtn");
  const transportWorkbenchInfoPopover = document.getElementById("transportWorkbenchInfoPopover");
  const transportWorkbenchInfoBody = document.getElementById("transportWorkbenchInfoBody");
  const transportWorkbenchSectionHelpPopover = document.getElementById("transportWorkbenchSectionHelpPopover");
  const transportWorkbenchSectionHelpTitle = document.getElementById("transportWorkbenchSectionHelpTitle");
  const transportWorkbenchSectionHelpBody = document.getElementById("transportWorkbenchSectionHelpBody");
  const transportWorkbenchCloseBtn = document.getElementById("transportWorkbenchCloseBtn");
  const transportWorkbenchResetBtn = document.getElementById("transportWorkbenchResetBtn");
  const transportWorkbenchApplyBtn = document.getElementById("transportWorkbenchApplyBtn");
  const transportWorkbenchTitle = document.getElementById("transportWorkbenchTitle");
  const transportWorkbenchLensTitle = document.getElementById("transportWorkbenchLensTitle");
  const transportWorkbenchLensSections = document.getElementById("transportWorkbenchLensSections");
  const transportWorkbenchFamilyStatus = document.getElementById("transportWorkbenchFamilyStatus");
  const transportWorkbenchCountryStatus = document.getElementById("transportWorkbenchCountryStatus");
  const transportWorkbenchPreviewMode = document.getElementById("transportWorkbenchPreviewMode");
  const transportWorkbenchPreviewTitle = document.getElementById("transportWorkbenchPreviewTitle");
  const transportWorkbenchPreviewCanvas = document.getElementById("transportWorkbenchPreviewCanvas");
  const transportWorkbenchPreviewActions = document.getElementById("transportWorkbenchPreviewActions");
  const transportWorkbenchPreviewControls = document.getElementById("transportWorkbenchPreviewControls");
  const transportWorkbenchCarrierMount = document.getElementById("transportWorkbenchCarrierMount");
  const transportWorkbenchLayerOrderPanel = document.getElementById("transportWorkbenchLayerOrderPanel");
  const transportWorkbenchLayerOrderList = document.getElementById("transportWorkbenchLayerOrderList");
  const transportWorkbenchCompareBtn = document.getElementById("transportWorkbenchCompareBtn");
  const transportWorkbenchCompareStatus = document.getElementById("transportWorkbenchCompareStatus");
  const transportWorkbenchZoomOutBtn = document.getElementById("transportWorkbenchZoomOutBtn");
  const transportWorkbenchZoomInBtn = document.getElementById("transportWorkbenchZoomInBtn");
  const transportWorkbenchRotateBtn = document.getElementById("transportWorkbenchRotateBtn");
  const transportWorkbenchInspectorTitle = document.getElementById("transportWorkbenchInspectorTitle");
  const transportWorkbenchInspectorTabButtons = Array.from(document.querySelectorAll(".transport-workbench-inspector-tab"));
  const transportWorkbenchInspectorPanels = Object.fromEntries(
    TRANSPORT_WORKBENCH_INSPECTOR_TABS.map((tab) => [tab.id, document.getElementById(`transportWorkbenchInspectorPanel${tab.id.charAt(0).toUpperCase()}${tab.id.slice(1)}`)])
  );
  const transportWorkbenchInspectorDetails = document.getElementById("transportWorkbenchInspectorDetails");
  const transportWorkbenchInspectorEmptyTitle = document.getElementById("transportWorkbenchInspectorEmptyTitle");
  const transportWorkbenchInspectorEmptyBody = document.getElementById("transportWorkbenchInspectorEmptyBody");
  const transportWorkbenchDisplaySections = document.getElementById("transportWorkbenchDisplaySections");
  const transportWorkbenchAggregationSections = document.getElementById("transportWorkbenchAggregationSections");
  const transportWorkbenchLabelSections = document.getElementById("transportWorkbenchLabelSections");
  const transportWorkbenchCoverageSections = document.getElementById("transportWorkbenchCoverageSections");
  const transportWorkbenchDataSections = document.getElementById("transportWorkbenchDataSections");
  const transportWorkbenchFamilyTabs = Array.from(document.querySelectorAll(".transport-workbench-family-tab"));
  const paintGranularitySelect = document.getElementById("paintGranularitySelect");
  const dockGranularityField = document.getElementById("dockGranularityField");
  const dockQuickFillRow = document.getElementById("dockQuickFillRow");
  const quickFillParentBtn = document.getElementById("quickFillParentBtn");
  const quickFillCountryBtn = document.getElementById("quickFillCountryBtn");
  const dockQuickFillHint = document.getElementById("dockQuickFillHint");
  const paintModeSelect = document.getElementById("paintModeSelect");
  const paintModeVisualBtn = document.getElementById("paintModeVisualBtn");
  const paintModePoliticalBtn = document.getElementById("paintModePoliticalBtn");
  const politicalEditingToggleBtn = document.getElementById("politicalEditingToggleBtn");
  const dockPoliticalEditingPanel = document.getElementById("dockPoliticalEditingPanel");
  const dockColorModeField = document.getElementById("dockColorModeField");
  const activeSovereignLabel = document.getElementById("activeSovereignLabel");
  const recalculateBordersBtn = document.getElementById("recalculateBordersBtn");
  const dynamicBorderStatus = document.getElementById("dynamicBorderStatus");
  const internalBorderAutoColor = document.getElementById("internalBorderAutoColor");
  const internalBorderColor = document.getElementById("internalBorderColor");
  const internalBorderOpacity = document.getElementById("internalBorderOpacity");
  const internalBorderWidth = document.getElementById("internalBorderWidth");
  const empireBorderColor = document.getElementById("empireBorderColor");
  const empireBorderWidth = document.getElementById("empireBorderWidth");
  const coastlineColor = document.getElementById("coastlineColor");
  const coastlineWidth = document.getElementById("coastlineWidth");
  const parentBordersVisible = document.getElementById("parentBordersVisible");
  const parentBorderColor = document.getElementById("parentBorderColor");
  const parentBorderOpacity = document.getElementById("parentBorderOpacity");
  const parentBorderWidth = document.getElementById("parentBorderWidth");
  const parentBorderCountryList = document.getElementById("parentBorderCountryList");
  const parentBorderEnableAll = document.getElementById("parentBorderEnableAll");
  const parentBorderDisableAll = document.getElementById("parentBorderDisableAll");
  const parentBorderEmpty = document.getElementById("parentBorderEmpty");
  const oceanFillColor = document.getElementById("oceanFillColor");
  const lakeLinkToOcean = document.getElementById("lakeLinkToOcean");
  const lakeFillColor = document.getElementById("lakeFillColor");
  const oceanCoastalAccentRow = document.getElementById("oceanCoastalAccentRow");
  const oceanCoastalAccentToggle = document.getElementById("oceanCoastalAccentToggle");
  const oceanAdvancedStylesToggle = document.getElementById("oceanAdvancedStylesToggle");
  const oceanStyleSelect = document.getElementById("oceanStyleSelect");
  const oceanStylePresetHint = document.getElementById("oceanStylePresetHint");
  const oceanTextureOpacity = document.getElementById("oceanTextureOpacity");
  const oceanTextureScale = document.getElementById("oceanTextureScale");
  const oceanContourStrength = document.getElementById("oceanContourStrength");
  const oceanBathymetryDebugDetails = document.getElementById("oceanBathymetryDebugDetails");
  const oceanBathymetrySourceValue = document.getElementById("oceanBathymetrySourceValue");
  const oceanBathymetryBandsValue = document.getElementById("oceanBathymetryBandsValue");
  const oceanBathymetryContoursValue = document.getElementById("oceanBathymetryContoursValue");
  const oceanShallowFadeEndZoom = document.getElementById("oceanShallowFadeEndZoom");
  const oceanMidFadeEndZoom = document.getElementById("oceanMidFadeEndZoom");
  const oceanDeepFadeEndZoom = document.getElementById("oceanDeepFadeEndZoom");
  const oceanScenarioSyntheticContourFadeEndZoom = document.getElementById("oceanScenarioSyntheticContourFadeEndZoom");
  const oceanScenarioShallowContourFadeEndZoom = document.getElementById("oceanScenarioShallowContourFadeEndZoom");
  const toggleLang = document.getElementById("btnToggleLang");
  const themeSelect = document.getElementById("themeSelect");
  const referenceImageInput = document.getElementById("referenceImageInput");
  const referenceOpacity = document.getElementById("referenceOpacity");
  const referenceScale = document.getElementById("referenceScale");
  const referenceOffsetX = document.getElementById("referenceOffsetX");
  const referenceOffsetY = document.getElementById("referenceOffsetY");
  const paletteLibraryToggleLabel = document.getElementById("paletteLibraryToggleLabel");

  const internalBorderOpacityValue = document.getElementById("internalBorderOpacityValue");
  const internalBorderWidthValue = document.getElementById("internalBorderWidthValue");
  const empireBorderWidthValue = document.getElementById("empireBorderWidthValue");
  const coastlineWidthValue = document.getElementById("coastlineWidthValue");
  const parentBorderOpacityValue = document.getElementById("parentBorderOpacityValue");
  const parentBorderWidthValue = document.getElementById("parentBorderWidthValue");
  const urbanOpacityValue = document.getElementById("urbanOpacityValue");
  const urbanAdaptiveStrengthValue = document.getElementById("urbanAdaptiveStrengthValue");
  const urbanStrokeOpacityValue = document.getElementById("urbanStrokeOpacityValue");
  const urbanToneBiasValue = document.getElementById("urbanToneBiasValue");
  const urbanAdaptiveTintStrengthValue = document.getElementById("urbanAdaptiveTintStrengthValue");
  const urbanMinAreaValue = document.getElementById("urbanMinAreaValue");
  const cityPointsOpacityValue = document.getElementById("cityPointsOpacityValue");
  const cityPointsMarkerScaleValue = document.getElementById("cityPointsMarkerScaleValue");
  const cityPointsMarkerDensityValue = document.getElementById("cityPointsMarkerDensityValue");
  const cityPointsLabelSizeValue = document.getElementById("cityPointsLabelSizeValue");
  const physicalOpacityValue = document.getElementById("physicalOpacityValue");
  const physicalAtlasIntensityValue = document.getElementById("physicalAtlasIntensityValue");
  const physicalRainforestEmphasisValue = document.getElementById("physicalRainforestEmphasisValue");
  const physicalContourOpacityValue = document.getElementById("physicalContourOpacityValue");
  const physicalContourMajorWidthValue = document.getElementById("physicalContourMajorWidthValue");
  const physicalContourMinorWidthValue = document.getElementById("physicalContourMinorWidthValue");
  const physicalContourMajorIntervalValue = document.getElementById("physicalContourMajorIntervalValue");
  const physicalContourMinorIntervalValue = document.getElementById("physicalContourMinorIntervalValue");
  const physicalContourMajorLowReliefCutoffValue = document.getElementById("physicalContourMajorLowReliefCutoffValue");
  const physicalContourMinorLowReliefCutoffValue = document.getElementById("physicalContourMinorLowReliefCutoffValue");
  const riversOpacityValue = document.getElementById("riversOpacityValue");
  const riversWidthValue = document.getElementById("riversWidthValue");
  const riversOutlineWidthValue = document.getElementById("riversOutlineWidthValue");
  const specialZonesOpacityValue = document.getElementById("specialZonesOpacityValue");
  const specialZonesStrokeWidthValue = document.getElementById("specialZonesStrokeWidthValue");
  const textureOpacityValue = document.getElementById("textureOpacityValue");
  const texturePaperScaleValue = document.getElementById("texturePaperScaleValue");
  const texturePaperWarmthValue = document.getElementById("texturePaperWarmthValue");
  const texturePaperGrainValue = document.getElementById("texturePaperGrainValue");
  const texturePaperWearValue = document.getElementById("texturePaperWearValue");
  const textureGraticuleMajorStepValue = document.getElementById("textureGraticuleMajorStepValue");
  const textureGraticuleMinorStepValue = document.getElementById("textureGraticuleMinorStepValue");
  const textureGraticuleLabelStepValue = document.getElementById("textureGraticuleLabelStepValue");
  const textureGraticuleLabelSizeValue = document.getElementById("textureGraticuleLabelSizeValue");
  const textureGraticuleMajorWidthValue = document.getElementById("textureGraticuleMajorWidthValue");
  const textureGraticuleMinorWidthValue = document.getElementById("textureGraticuleMinorWidthValue");
  const textureGraticuleMajorOpacityValue = document.getElementById("textureGraticuleMajorOpacityValue");
  const textureGraticuleMinorOpacityValue = document.getElementById("textureGraticuleMinorOpacityValue");
  const textureDraftMajorStepValue = document.getElementById("textureDraftMajorStepValue");
  const textureDraftMinorStepValue = document.getElementById("textureDraftMinorStepValue");
  const textureDraftLonOffsetValue = document.getElementById("textureDraftLonOffsetValue");
  const textureDraftLatOffsetValue = document.getElementById("textureDraftLatOffsetValue");
  const textureDraftRollValue = document.getElementById("textureDraftRollValue");
  const textureDraftWidthValue = document.getElementById("textureDraftWidthValue");
  const textureDraftMajorOpacityValue = document.getElementById("textureDraftMajorOpacityValue");
  const textureDraftMinorOpacityValue = document.getElementById("textureDraftMinorOpacityValue");
  const dayNightManualTimeValue = document.getElementById("dayNightManualTimeValue");
  const dayNightCityLightsIntensityValue = document.getElementById("dayNightCityLightsIntensityValue");
  const dayNightCityLightsTextureOpacityValue = document.getElementById("dayNightCityLightsTextureOpacityValue");
  const dayNightCityLightsCorridorStrengthValue = document.getElementById("dayNightCityLightsCorridorStrengthValue");
  const dayNightCityLightsCoreSharpnessValue = document.getElementById("dayNightCityLightsCoreSharpnessValue");
  const dayNightCityLightsPopulationBoostStrengthValue = document.getElementById("dayNightCityLightsPopulationBoostStrengthValue");
  const dayNightHistoricalCityLightsDensityValue = document.getElementById("dayNightHistoricalCityLightsDensityValue");
  const dayNightHistoricalCityLightsSecondaryRetentionValue = document.getElementById(
    "dayNightHistoricalCityLightsSecondaryRetentionValue"
  );
  const dayNightShadowOpacityValue = document.getElementById("dayNightShadowOpacityValue");
  const dayNightTwilightWidthValue = document.getElementById("dayNightTwilightWidthValue");
  const airportVisualStrengthValue = document.getElementById("airportVisualStrengthValue");
  const airportOpacityValue = document.getElementById("airportOpacityValue");
  const airportCoverageReachValue = document.getElementById("airportCoverageReachValue");
  const portVisualStrengthValue = document.getElementById("portVisualStrengthValue");
  const portOpacityValue = document.getElementById("portOpacityValue");
  const portCoverageReachValue = document.getElementById("portCoverageReachValue");
  const oceanTextureOpacityValue = document.getElementById("oceanTextureOpacityValue");
  const oceanTextureScaleValue = document.getElementById("oceanTextureScaleValue");
  const oceanContourStrengthValue = document.getElementById("oceanContourStrengthValue");
  const oceanShallowFadeEndZoomValue = document.getElementById("oceanShallowFadeEndZoomValue");
  const oceanMidFadeEndZoomValue = document.getElementById("oceanMidFadeEndZoomValue");
  const oceanDeepFadeEndZoomValue = document.getElementById("oceanDeepFadeEndZoomValue");
  const oceanScenarioSyntheticContourFadeEndZoomValue = document.getElementById("oceanScenarioSyntheticContourFadeEndZoomValue");
  const oceanScenarioShallowContourFadeEndZoomValue = document.getElementById("oceanScenarioShallowContourFadeEndZoomValue");
  const referenceOpacityValue = document.getElementById("referenceOpacityValue");
  const referenceScaleValue = document.getElementById("referenceScaleValue");
  const referenceOffsetXValue = document.getElementById("referenceOffsetXValue");
  const referenceOffsetYValue = document.getElementById("referenceOffsetYValue");
  const appearanceLayerFilter = document.getElementById("appearanceLayerFilter");
  const appearanceTabButtons = Array.from(document.querySelectorAll("[data-appearance-tab]"));
  const appearanceTabPanels = Array.from(document.querySelectorAll("[data-appearance-panel]"));
  const appearanceFilterItems = Array.from(document.querySelectorAll("[data-appearance-filter-item]"));
  const appearanceSpecialZoneBtn = document.getElementById("appearanceSpecialZoneBtn");
  const specialZonePopover = document.getElementById("specialZonePopover");
  const specialZoneEditorInline = specialZonePopover?.dataset.inlineEditor === "true";
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const DEVELOPER_MODE_STORAGE_KEY = "map_creator_developer_mode";
  const physicalClassToggleMap = {
    mountain_high_relief: physicalClassMountain,
    mountain_hills: physicalClassMountainHills,
    upland_plateau: physicalClassPlateau,
    badlands_canyon: physicalClassBadlands,
    plains_lowlands: physicalClassPlains,
    basin_lowlands: physicalClassBasin,
    wetlands_delta: physicalClassWetlands,
    forest_temperate: physicalClassForestTemperate,
    rainforest_tropical: physicalClassRainforestTropical,
    grassland_steppe: physicalClassGrassland,
    desert_bare: physicalClassDesert,
    tundra_ice: physicalClassTundra,
  };
  let toolHudTimerId = null;
  let scenarioGuideTimerId = null;
  let dockPopoverCloseBound = false;
  const overlayFocusReturnTargets = createFocusReturnRegistry();
  const MOBILE_WORKSPACE_MAX_WIDTH = 767;
  const TABLET_WORKSPACE_MAX_WIDTH = 1023;
  const SCENARIO_BAR_LEFT_OFFSET = 18;
  const SCENARIO_BAR_MOBILE_LEFT_OFFSET = 12;
  const SCENARIO_BAR_SAFE_GAP = 16;
  const SCENARIO_BAR_MIN_WIDTH = 172;
  const SCENARIO_GUIDE_MAX_WIDTH = 360;
  const SCENARIO_GUIDE_VERTICAL_GAP = 10;
  if (!state.ui || typeof state.ui !== "object") {
    state.ui = {};
  }
  state.ui.dockCollapsed = !!state.ui.dockCollapsed;
  state.ui.scenarioBarCollapsed = !!state.ui.scenarioBarCollapsed;
  state.ui.scenarioGuideDismissed = !!state.ui.scenarioGuideDismissed;
  state.ui.politicalEditingExpanded = !!state.ui.politicalEditingExpanded;
  state.ui.scenarioVisualAdjustmentsOpen = !!state.ui.scenarioVisualAdjustmentsOpen;
  state.ui.developerMode = !!state.ui.developerMode;
  state.ui.tutorialEntryVisible = state.ui.tutorialEntryVisible !== false;
  state.ui.tutorialDismissed = !!state.ui.tutorialDismissed;
  state.ui.responsiveChromeTier = String(state.ui.responsiveChromeTier || "");
  if (!state.ui.paletteLibrarySections || typeof state.ui.paletteLibrarySections !== "object") {
    state.ui.paletteLibrarySections = {};
  }

  const scenarioGuidePopoverController = createScenarioGuidePopoverController({
    state,
    scenarioGuideBtn,
    utilitiesGuideBtn,
    scenarioGuideBackdrop,
    scenarioGuidePopover,
    scenarioGuideCloseBtn,
    scenarioGuideStatus,
    scenarioGuideStatusChips,
    scenarioGuideNavButtons,
    scenarioGuidePanels,
    t,
  });
  const {
    bindScenarioGuideEvents,
    closeScenarioGuideSurface,
    openScenarioGuideSurface,
    renderScenarioGuideSection,
    renderScenarioGuideStatus,
    syncScenarioGuideTriggerButtons,
  } = scenarioGuidePopoverController;

  const getResponsiveChromeTier = () => {
    const viewportWidth = Number(globalThis.innerWidth) || 0;
    if (viewportWidth <= MOBILE_WORKSPACE_MAX_WIDTH) return "mobile";
    if (viewportWidth <= TABLET_WORKSPACE_MAX_WIDTH) return "tablet";
    return "desktop";
  };

  const applyResponsiveChromeDefaults = () => {
    const nextTier = getResponsiveChromeTier();
    if (state.ui.responsiveChromeTier === nextTier) return;
    if (nextTier === "mobile") {
      state.ui.dockCollapsed = true;
      state.ui.scenarioBarCollapsed = true;
    }
    state.ui.responsiveChromeTier = nextTier;
  };
  applyResponsiveChromeDefaults();

  const persistDeveloperMode = () => {
    try {
      globalThis.localStorage?.setItem(
        DEVELOPER_MODE_STORAGE_KEY,
        state.ui.developerMode ? "true" : "false"
      );
    } catch {}
  };

  const updateLanguageToggleUi = () => {
    if (!toggleLang) return;
    const nextLang = state.currentLanguage === "zh" ? "EN" : "ZH";
    const buttonLabel = state.currentLanguage === "zh" ? "ZH / EN" : "EN / ZH";
    toggleLang.textContent = buttonLabel;
    toggleLang.setAttribute("title", `${t("Language", "ui")}: ${nextLang}`);
  };

  const syncDeveloperModeUi = () => {
    document.body?.classList.toggle("developer-mode", !!state.ui.developerMode);
    if (developerModeBtn) {
      const buttonLabel = state.ui.developerMode
        ? t("Hide development workspace", "ui")
        : t("Show development workspace", "ui");
      developerModeBtn.classList.toggle("is-active", !!state.ui.developerMode);
      developerModeBtn.setAttribute("aria-pressed", state.ui.developerMode ? "true" : "false");
      developerModeBtn.setAttribute("aria-label", buttonLabel);
      developerModeBtn.setAttribute("title", buttonLabel);
    }
    if (!state.ui.developerMode && state.ui.devWorkspaceExpanded) {
      if (typeof state.setDevWorkspaceExpandedFn === "function") {
        state.setDevWorkspaceExpandedFn(false);
      } else if (devWorkspaceToggleBtn) {
        devWorkspaceToggleBtn.click();
      }
    }
  };

  const setDeveloperMode = (nextValue) => {
    const normalized = !!nextValue;
    if (state.ui.developerMode === normalized) {
      syncDeveloperModeUi();
      return;
    }
    state.ui.developerMode = normalized;
    persistDeveloperMode();
    syncDeveloperModeUi();
  };

  try {
    const storedDeveloperMode = globalThis.localStorage?.getItem(DEVELOPER_MODE_STORAGE_KEY);
    if (storedDeveloperMode === "true" || storedDeveloperMode === "false") {
      state.ui.developerMode = storedDeveloperMode === "true";
    }
  } catch {}
  updateLanguageToggleUi();
  syncDeveloperModeUi();

  const applyAppearanceFilter = () => {
    const query = String(appearanceLayerFilter?.value || "").trim().toLowerCase();
    appearanceFilterItems.forEach((item) => {
      const label = String(item.getAttribute("data-appearance-filter-label") || item.textContent || "").toLowerCase();
      const matches = !query || label.includes(query);
      item.classList.toggle("hidden", !matches);
    });
  };

  const getTransportAppearanceConfig = () => {
    state.styleConfig.transportOverview = normalizeTransportOverviewStyleConfig(
      state.styleConfig?.transportOverview || {},
    );
    return state.styleConfig.transportOverview;
  };

  const formatTransportPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;
  const formatTransportScopeLabel = (value) => String(value || "")
    .trim()
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
  const formatTransportThresholdLabel = (value) => String(value || "")
    .trim()
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

  const getEffectiveTransportScopeState = (familyId, familyConfig) => (
    familyConfig.scopeLinkMode === "manual"
      ? {
        scope: String(familyConfig.scope || "").trim().toLowerCase(),
        importanceThreshold: String(familyConfig.importanceThreshold || "").trim().toLowerCase(),
      }
      : resolveLinkedTransportOverviewScopeAndThreshold(familyId, familyConfig.coverageReach)
  );

  const getTransportScopeThresholdRank = (familyId, scope) => {
    const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
    const normalizedScope = String(scope || "").trim().toLowerCase();
    if (normalizedFamilyId === "airport") {
      if (normalizedScope === "international") return 3;
      if (normalizedScope === "all_civil") return 1;
      return 2;
    }
    if (normalizedFamilyId === "port") {
      if (normalizedScope === "core") return 3;
      if (normalizedScope === "expanded") return 1;
      return 2;
    }
    if (normalizedFamilyId === "rail") {
      return normalizedScope === "mainline_only" ? 1 : 2;
    }
    if (normalizedFamilyId === "road") {
      return normalizedScope === "motorway_only" ? 1 : 2;
    }
    return 1;
  };

  const getTransportImportanceThresholdRank = (threshold) => {
    const normalized = String(threshold || "").trim().toLowerCase();
    if (normalized === "primary") return 3;
    if (normalized === "secondary") return 2;
    return 1;
  };

  const getTransportFamilyFilteredCount = (familyId, familyConfig, effectiveScope) => {
    if (familyId === "rail") {
      const features = Array.isArray(state.railwaysData?.features) ? state.railwaysData.features : null;
      if (!features) return null;
      const scopeThreshold = getTransportScopeThresholdRank(familyId, effectiveScope.scope);
      const revealThreshold = String(effectiveScope.importanceThreshold || "").trim().toLowerCase() === "primary"
        ? 1
        : String(effectiveScope.importanceThreshold || "").trim().toLowerCase() === "secondary"
          ? 2
          : 3;
      return features.filter((feature) => {
        const properties = feature?.properties || {};
        const lineClass = String(properties.class || "").trim().toLowerCase();
        const revealRank = Math.max(1, Math.round(Number(properties.reveal_rank || (lineClass === "mainline" ? 1 : 2))));
        if (revealRank > revealThreshold) return false;
        if (scopeThreshold <= 1 && lineClass !== "mainline") return false;
        return lineClass === "mainline" || lineClass === "regional";
      }).length;
    }
    if (familyId === "road") {
      const features = Array.isArray(state.roadsData?.features) ? state.roadsData.features : null;
      if (!features) return null;
      const scopeThreshold = getTransportScopeThresholdRank(familyId, effectiveScope.scope);
      const revealThreshold = String(effectiveScope.importanceThreshold || "").trim().toLowerCase() === "primary" ? 1 : 2;
      return features.filter((feature) => {
        const properties = feature?.properties || {};
        const roadClass = String(properties.class || "").trim().toLowerCase();
        const revealRank = Math.max(1, Math.round(Number(properties.reveal_rank || (roadClass === "motorway" ? 1 : 2))));
        if (revealRank > revealThreshold) return false;
        if (scopeThreshold <= 1 && roadClass !== "motorway") return false;
        return roadClass === "motorway" || roadClass === "trunk";
      }).length;
    }
    const collection = familyId === "port" ? state.portsData : state.airportsData;
    const features = Array.isArray(collection?.features) ? collection.features : null;
    if (!features) return null;
    const minimumImportanceRank = Math.max(
      getTransportScopeThresholdRank(familyId, effectiveScope.scope),
      getTransportImportanceThresholdRank(effectiveScope.importanceThreshold),
    );
    return features.filter((feature) => {
      const importanceRank = Math.max(1, Math.round(Number(feature?.properties?.importance_rank || 1)));
      return importanceRank >= minimumImportanceRank;
    }).length;
  };

  const formatTransportFamilyCountText = (familyId, count) => {
    if (!Number.isFinite(count)) return "";
    const roundedCount = Math.max(0, Math.round(count));
    if (familyId === "rail") {
      return `${roundedCount.toLocaleString()} ${t(roundedCount === 1 ? "railway" : "railways", "ui")}`;
    }
    if (familyId === "road") {
      return `${roundedCount.toLocaleString()} ${t(roundedCount === 1 ? "road" : "roads", "ui")}`;
    }
    const noun = familyId === "port"
      ? (roundedCount === 1 ? "port" : "ports")
      : (roundedCount === 1 ? "airport" : "airports");
    return `${roundedCount.toLocaleString()} ${t(noun, "ui")}`;
  };

  const buildTransportFamilySummaryText = (familyId, masterEnabled, familyEnabled, familyConfig, effectiveScope) => {
    if (!familyEnabled) return t("Off", "ui");
    if (!masterEnabled) return `${t("On", "ui")} · ${t("hidden by master", "ui")}`;
    const countText = formatTransportFamilyCountText(
      familyId,
      getTransportFamilyFilteredCount(familyId, familyConfig, effectiveScope),
    );
    return countText
      ? `${t("On", "ui")} · ${countText}`
      : `${t("On", "ui")} · ${t(formatTransportScopeLabel(effectiveScope.scope), "ui")}`;
  };

  const setTransportAppearanceGroupEnabled = (container, enabled) => {
    if (!(container instanceof HTMLElement)) return;
    container.classList.toggle("opacity-60", !enabled);
    container.classList.toggle("pointer-events-none", !enabled);
    container.setAttribute("aria-disabled", enabled ? "false" : "true");
  };

  const renderTransportAppearanceUi = () => {
    const transportConfig = getTransportAppearanceConfig();
    const airportConfig = transportConfig.airport || {};
    const portConfig = transportConfig.port || {};
    const railConfig = transportConfig.rail || {};
    const roadConfig = transportConfig.road || {};
    const transportEnabled = state.showTransport !== false;
    const airportEnabled = transportEnabled && !!state.showAirports;
    const portEnabled = transportEnabled && !!state.showPorts;
    const railEnabled = transportEnabled && !!state.showRail;
    const roadEnabled = transportEnabled && !!state.showRoad;
    const airportScopeState = getEffectiveTransportScopeState("airport", airportConfig);
    const portScopeState = getEffectiveTransportScopeState("port", portConfig);
    const railScopeState = getEffectiveTransportScopeState("rail", railConfig);
    const roadScopeState = getEffectiveTransportScopeState("road", roadConfig);

    if (transportAppearanceMasterToggle) {
      transportAppearanceMasterToggle.checked = transportEnabled;
    }

    if (airportVisualStrength) airportVisualStrength.value = String(Math.round(Number(airportConfig.visualStrength ?? 0.56) * 100));
    if (airportVisualStrengthValue) airportVisualStrengthValue.textContent = formatTransportPercent(airportConfig.visualStrength ?? 0.56);
    if (airportOpacity) airportOpacity.value = String(Math.round(Number(airportConfig.opacity ?? 0.82) * 100));
    if (airportOpacityValue) airportOpacityValue.textContent = formatTransportPercent(airportConfig.opacity ?? 0.82);
    if (airportPrimaryColor) airportPrimaryColor.value = normalizeOceanFillColor(airportConfig.primaryColor || "#1d4ed8");
    if (airportLabelsEnabled) airportLabelsEnabled.checked = !!airportConfig.labelsEnabled;
    if (airportLabelDensity) airportLabelDensity.value = String(airportConfig.labelDensity || "balanced");
    if (airportLabelMode) airportLabelMode.value = String(airportConfig.labelMode || "both");
    if (airportCoverageReach) airportCoverageReach.value = String(Math.round(Number(airportConfig.coverageReach ?? 0.5) * 100));
    if (airportCoverageReachValue) airportCoverageReachValue.textContent = formatTransportPercent(airportConfig.coverageReach ?? 0.5);
    if (airportScopeLinked) airportScopeLinked.checked = String(airportConfig.scopeLinkMode || "linked") !== "manual";
    if (airportScopeResolved) airportScopeResolved.textContent = t(formatTransportScopeLabel(airportScopeState.scope), "ui");
    if (airportThresholdResolved) {
      airportThresholdResolved.textContent = t(formatTransportThresholdLabel(airportScopeState.importanceThreshold), "ui");
    }
    if (airportScope) airportScope.value = String(airportConfig.scope || "major_civil");
    if (airportImportanceThreshold) {
      airportImportanceThreshold.value = String(airportConfig.importanceThreshold || "secondary");
    }
    if (transportAirportSummaryMeta) {
      transportAirportSummaryMeta.textContent = buildTransportFamilySummaryText(
        "airport",
        transportEnabled,
        !!state.showAirports,
        airportConfig,
        airportScopeState,
      );
    }

    if (portVisualStrength) portVisualStrength.value = String(Math.round(Number(portConfig.visualStrength ?? 0.54) * 100));
    if (portVisualStrengthValue) portVisualStrengthValue.textContent = formatTransportPercent(portConfig.visualStrength ?? 0.54);
    if (portOpacity) portOpacity.value = String(Math.round(Number(portConfig.opacity ?? 0.78) * 100));
    if (portOpacityValue) portOpacityValue.textContent = formatTransportPercent(portConfig.opacity ?? 0.78);
    if (portPrimaryColor) portPrimaryColor.value = normalizeOceanFillColor(portConfig.primaryColor || "#b45309");
    if (portLabelsEnabled) portLabelsEnabled.checked = !!portConfig.labelsEnabled;
    if (portLabelDensity) portLabelDensity.value = String(portConfig.labelDensity || "balanced");
    if (portLabelMode) portLabelMode.value = String(portConfig.labelMode || "mixed");
    if (portCoverageReach) portCoverageReach.value = String(Math.round(Number(portConfig.coverageReach ?? 0.5) * 100));
    if (portCoverageReachValue) portCoverageReachValue.textContent = formatTransportPercent(portConfig.coverageReach ?? 0.5);
    if (portScopeLinked) portScopeLinked.checked = String(portConfig.scopeLinkMode || "linked") !== "manual";
    if (portScopeResolved) portScopeResolved.textContent = t(formatTransportScopeLabel(portScopeState.scope), "ui");
    if (portThresholdResolved) {
      portThresholdResolved.textContent = t(formatTransportThresholdLabel(portScopeState.importanceThreshold), "ui");
    }
    if (portTier) portTier.value = String(portConfig.scope || "regional");
    if (portImportanceThreshold) {
      portImportanceThreshold.value = String(portConfig.importanceThreshold || "secondary");
    }
    if (transportPortSummaryMeta) {
      transportPortSummaryMeta.textContent = buildTransportFamilySummaryText(
        "port",
        transportEnabled,
        !!state.showPorts,
        portConfig,
        portScopeState,
      );
    }
    if (railVisualStrength) railVisualStrength.value = String(Math.round(Number(railConfig.visualStrength ?? 0.5) * 100));
    if (railVisualStrengthValue) railVisualStrengthValue.textContent = formatTransportPercent(railConfig.visualStrength ?? 0.5);
    if (railOpacity) railOpacity.value = String(Math.round(Number(railConfig.opacity ?? 0.72) * 100));
    if (railOpacityValue) railOpacityValue.textContent = formatTransportPercent(railConfig.opacity ?? 0.72);
    if (railPrimaryColor) railPrimaryColor.value = normalizeOceanFillColor(railConfig.primaryColor || "#0f172a");
    if (railLabelsEnabled) railLabelsEnabled.checked = !!railConfig.labelsEnabled;
    if (railLabelDensity) railLabelDensity.value = String(railConfig.labelDensity || "sparse");
    if (railCoverageReach) railCoverageReach.value = String(Math.round(Number(railConfig.coverageReach ?? 0.2) * 100));
    if (railCoverageReachValue) railCoverageReachValue.textContent = formatTransportPercent(railConfig.coverageReach ?? 0.2);
    if (railScopeLinked) railScopeLinked.checked = String(railConfig.scopeLinkMode || "linked") !== "manual";
    if (railScopeResolved) railScopeResolved.textContent = t(formatTransportScopeLabel(railScopeState.scope), "ui");
    if (railThresholdResolved) railThresholdResolved.textContent = t(formatTransportThresholdLabel(railScopeState.importanceThreshold), "ui");
    if (railScope) railScope.value = String(railConfig.scope || "mainline_only");
    if (railImportanceThreshold) railImportanceThreshold.value = String(railConfig.importanceThreshold || "primary");
    if (toggleRail) toggleRail.checked = !!state.showRail;
    if (transportRailSummaryMeta) {
      transportRailSummaryMeta.textContent = buildTransportFamilySummaryText(
        "rail",
        transportEnabled,
        !!state.showRail,
        railConfig,
        railScopeState,
      );
    }
    if (roadVisualStrength) roadVisualStrength.value = String(Math.round(Number(roadConfig.visualStrength ?? 0.5) * 100));
    if (roadVisualStrengthValue) roadVisualStrengthValue.textContent = formatTransportPercent(roadConfig.visualStrength ?? 0.5);
    if (roadOpacity) roadOpacity.value = String(Math.round(Number(roadConfig.opacity ?? 0.72) * 100));
    if (roadOpacityValue) roadOpacityValue.textContent = formatTransportPercent(roadConfig.opacity ?? 0.72);
    if (roadPrimaryColor) roadPrimaryColor.value = normalizeOceanFillColor(roadConfig.primaryColor || "#374151");
    if (roadCoverageReach) roadCoverageReach.value = String(Math.round(Number(roadConfig.coverageReach ?? 0.2) * 100));
    if (roadCoverageReachValue) roadCoverageReachValue.textContent = formatTransportPercent(roadConfig.coverageReach ?? 0.2);
    if (roadScopeLinked) roadScopeLinked.checked = String(roadConfig.scopeLinkMode || "linked") !== "manual";
    if (roadScopeResolved) roadScopeResolved.textContent = t(formatTransportScopeLabel(roadScopeState.scope), "ui");
    if (roadThresholdResolved) roadThresholdResolved.textContent = t(formatTransportThresholdLabel(roadScopeState.importanceThreshold), "ui");
    if (roadScope) roadScope.value = String(roadConfig.scope || "motorway_only");
    if (roadImportanceThreshold) roadImportanceThreshold.value = String(roadConfig.importanceThreshold || "primary");
    if (toggleRoad) toggleRoad.checked = !!state.showRoad;
    if (transportRoadSummaryMeta) {
      transportRoadSummaryMeta.textContent = buildTransportFamilySummaryText(
        "road",
        transportEnabled,
        !!state.showRoad,
        roadConfig,
        roadScopeState,
      );
    }

    [
      airportVisualStrength,
      airportOpacity,
      airportPrimaryColor,
      airportLabelsEnabled,
      airportLabelDensity,
      airportLabelMode,
      airportScopeLinked,
      airportScope,
      airportImportanceThreshold,
    ].forEach((control) => {
      if (control) control.disabled = !transportEnabled;
    });
    [
      portVisualStrength,
      portOpacity,
      portPrimaryColor,
      portLabelsEnabled,
      portLabelDensity,
      portLabelMode,
      portScopeLinked,
      portTier,
      portImportanceThreshold,
    ].forEach((control) => {
      if (control) control.disabled = !transportEnabled;
    });
    [
      railVisualStrength,
      railOpacity,
      railPrimaryColor,
      railLabelsEnabled,
      railLabelDensity,
      railScopeLinked,
      railScope,
      railImportanceThreshold,
      toggleRail,
    ].forEach((control) => {
      if (control) control.disabled = !transportEnabled;
    });
    [
      roadVisualStrength,
      roadOpacity,
      roadPrimaryColor,
      roadScopeLinked,
      roadScope,
      roadImportanceThreshold,
      toggleRoad,
    ].forEach((control) => {
      if (control) control.disabled = !transportEnabled;
    });

    const airportManual = String(airportConfig.scopeLinkMode || "linked") === "manual";
    const portManual = String(portConfig.scopeLinkMode || "linked") === "manual";
    const railManual = String(railConfig.scopeLinkMode || "linked") === "manual";
    const roadManual = String(roadConfig.scopeLinkMode || "linked") === "manual";
    if (airportCoverageReach) airportCoverageReach.disabled = !transportEnabled || airportManual;
    if (airportScope) airportScope.disabled = !transportEnabled || !airportManual;
    if (airportImportanceThreshold) airportImportanceThreshold.disabled = !transportEnabled || !airportManual;
    if (portCoverageReach) portCoverageReach.disabled = !transportEnabled || portManual;
    if (portTier) portTier.disabled = !transportEnabled || !portManual;
    if (portImportanceThreshold) portImportanceThreshold.disabled = !transportEnabled || !portManual;
    if (railCoverageReach) railCoverageReach.disabled = !transportEnabled || railManual;
    if (railScope) railScope.disabled = !transportEnabled || !railManual;
    if (railImportanceThreshold) railImportanceThreshold.disabled = !transportEnabled || !railManual;
    if (roadCoverageReach) roadCoverageReach.disabled = !transportEnabled || roadManual;
    if (roadScope) roadScope.disabled = !transportEnabled || !roadManual;
    if (roadImportanceThreshold) roadImportanceThreshold.disabled = !transportEnabled || !roadManual;

    setTransportAppearanceGroupEnabled(transportAirportControls, transportEnabled);
    setTransportAppearanceGroupEnabled(transportPortControls, transportEnabled);
    setTransportAppearanceGroupEnabled(transportRailControls, transportEnabled);
    setTransportAppearanceGroupEnabled(transportRoadControls, transportEnabled);

    transportAirportCard?.classList.toggle("opacity-60", !transportEnabled);
    transportPortCard?.classList.toggle("opacity-60", !transportEnabled);
    transportRailCard?.classList.toggle("opacity-60", !transportEnabled);
    transportRoadCard?.classList.toggle("opacity-60", !transportEnabled);
    if (typeof state.syncFacilityInfoCardVisibilityFn === "function") {
      state.syncFacilityInfoCardVisibilityFn();
    }
  };

  const applyTransportAppearanceMasterToggle = (nextEnabled) => {
    const normalized = !!nextEnabled;
    if ((state.showTransport !== false) === normalized) {
      renderTransportAppearanceUi();
      return;
    }
    state.showTransport = normalized;
    if (normalized && state.showAirports && typeof state.ensureContextLayerDataFn === "function") {
      void state.ensureContextLayerDataFn("airports", { reason: "transport-master-toggle", renderNow: true });
    }
    if (normalized && state.showPorts && typeof state.ensureContextLayerDataFn === "function") {
      void state.ensureContextLayerDataFn("ports", { reason: "transport-master-toggle", renderNow: true });
    }
    if (normalized && state.showRail && typeof state.ensureContextLayerDataFn === "function") {
      void state.ensureContextLayerDataFn(["railways", "rail_stations_major"], { reason: "transport-master-toggle", renderNow: true });
    }
    if (normalized && state.showRoad && typeof state.ensureContextLayerDataFn === "function") {
      void state.ensureContextLayerDataFn("roads", { reason: "transport-master-toggle", renderNow: true });
    }
    renderTransportAppearanceUi();
    renderDirty("toggle-transport-overview");
  };

  state.updateTransportAppearanceUIFn = renderTransportAppearanceUi;

  const focusOverlaySurface = (container) => focusSurface(container);
  const rememberOverlayTrigger = (overlay, trigger) => rememberSurfaceTrigger(overlayFocusReturnTargets, overlay, trigger);
  const restoreOverlayTriggerFocus = (overlay, explicitTrigger = null) => (
    restoreSurfaceTriggerFocus(overlayFocusReturnTargets, overlay, explicitTrigger)
  );
  const isFocusableGuideTriggerVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = globalThis.getComputedStyle ? globalThis.getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    return rect.right > 0
      && rect.bottom > 0
      && rect.left < (globalThis.innerWidth || 0)
      && rect.top < (globalThis.innerHeight || 0);
  };
  const getGuideFocusReturnTrigger = (preferredTrigger = null) => {
    if (isFocusableGuideTriggerVisible(preferredTrigger)) return preferredTrigger;
    if (isFocusableGuideTriggerVisible(utilitiesGuideBtn)) return utilitiesGuideBtn;
    if (isFocusableGuideTriggerVisible(scenarioGuideBtn)) return scenarioGuideBtn;
    return preferredTrigger || utilitiesGuideBtn || scenarioGuideBtn || null;
  };
  const replaceUiUrlParams = (mutator) => {
    if (!globalThis.URLSearchParams || !globalThis.history?.replaceState || !globalThis.location) return;
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    mutator?.(params);
    const nextQuery = params.toString();
    const nextUrl = `${globalThis.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${globalThis.location.hash || ""}`;
    globalThis.history.replaceState(globalThis.history.state, "", nextUrl);
  };
  const syncSupportSurfaceUrlState = (view = "") => {
    replaceUiUrlParams((params) => {
      if (view) {
        params.set(UI_URL_STATE_KEYS.view, view);
      } else if (["guide", "reference", "export"].includes(String(params.get(UI_URL_STATE_KEYS.view) || ""))) {
        params.delete(UI_URL_STATE_KEYS.view);
      }
    });
  };

  const getExportBakeVisibilitySignature = (exportUi) => {
    const main = EXPORT_MAIN_LAYER_IDS
      .map((layerId) => `${layerId}:${exportUi?.visibility?.[layerId] === false ? "0" : "1"}`)
      .join("|");
    const text = EXPORT_TEXT_LAYER_IDS
      .map((layerId) => `${layerId}:${exportUi?.textVisibility?.[layerId] === false ? "0" : "1"}`)
      .join("|");
    return `main=${main};text=${text}`;
  };

  let exportWorkbenchController = null;
  const renderExportWorkbenchLayerList = () => exportWorkbenchController?.renderExportWorkbenchLayerList();
  const renderExportWorkbenchTextElementList = () => exportWorkbenchController?.renderExportWorkbenchTextElementList();

  let transportWorkbenchController = null;
  transportWorkbenchController = createTransportWorkbenchController({
    scenarioTransportWorkbenchBtn,
    transportAppearanceWorkbenchBtn,
    transportWorkbenchOverlay,
    transportWorkbenchPanel,
    transportWorkbenchInfoBtn,
    transportWorkbenchInfoPopover,
    transportWorkbenchInfoBody,
    transportWorkbenchSectionHelpPopover,
    transportWorkbenchSectionHelpTitle,
    transportWorkbenchSectionHelpBody,
    transportWorkbenchCloseBtn,
    transportWorkbenchResetBtn,
    transportWorkbenchApplyBtn,
    transportWorkbenchTitle,
    transportWorkbenchLensTitle,
    transportWorkbenchLensSections,
    transportWorkbenchFamilyStatus,
    transportWorkbenchCountryStatus,
    transportWorkbenchPreviewMode,
    transportWorkbenchPreviewTitle,
    transportWorkbenchPreviewCanvas,
    transportWorkbenchPreviewActions,
    transportWorkbenchPreviewControls,
    transportWorkbenchCarrierMount,
    transportWorkbenchLayerOrderPanel,
    transportWorkbenchLayerOrderList,
    transportWorkbenchCompareBtn,
    transportWorkbenchCompareStatus,
    transportWorkbenchZoomOutBtn,
    transportWorkbenchZoomInBtn,
    transportWorkbenchRotateBtn,
    transportWorkbenchInspectorTitle,
    transportWorkbenchInspectorTabButtons,
    transportWorkbenchInspectorPanels,
    transportWorkbenchInspectorDetails,
    transportWorkbenchInspectorEmptyTitle,
    transportWorkbenchInspectorEmptyBody,
    transportWorkbenchDisplaySections,
    transportWorkbenchAggregationSections,
    transportWorkbenchLabelSections,
    transportWorkbenchCoverageSections,
    transportWorkbenchDataSections,
    transportWorkbenchFamilyTabs,
  });
  const {
    bindTransportWorkbenchEvents,
    closeTransportWorkbench,
    closeTransportWorkbenchInfoPopover,
    closeTransportWorkbenchSectionHelpPopover,
    ensureTransportWorkbenchUiState,
    initializeTransportWorkbenchRuntime,
    openTransportWorkbench,
    renderTransportWorkbenchUi,
  } = transportWorkbenchController;

  const syncExportPreviewSourceOptions = () => {
    return exportWorkbenchController?.syncExportPreviewSourceOptions();
  };

  const renderExportWorkbenchBakeArtifactList = () => {
    return exportWorkbenchController?.renderExportWorkbenchBakeArtifactList();
  };

  const renderExportWorkbenchPreview = async () => {
    return exportWorkbenchController?.renderExportWorkbenchPreview();
  };

  const renderExportWorkbenchUi = (isOpen) => {
    if (!exportWorkbenchOverlay) return;
    exportWorkbenchOverlay.classList.toggle("hidden", !isOpen);
    exportWorkbenchOverlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
    dockExportBtn?.classList.toggle("is-active", isOpen);
    dockExportBtn?.setAttribute("aria-expanded", isOpen ? "true" : "false");
    return exportWorkbenchController?.renderExportWorkbenchUi(isOpen);
  };

  const setExportWorkbenchState = (nextOpen, { trigger = null, restoreFocus = true } = {}) => {
    if (!exportWorkbenchOverlay || !exportWorkbenchPanel) return;
    const willOpen = !!nextOpen;
    const wasOpen = !exportWorkbenchOverlay.classList.contains("hidden");
    if (willOpen === wasOpen) {
      renderExportWorkbenchUi(willOpen);
      return;
    }
    if (willOpen) {
      closeDockPopover({ restoreFocus: false, syncUrl: false });
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
        closeScenarioGuidePopover({ restoreFocus: false, syncUrl: false });
      }
      if (exportProjectSection instanceof HTMLDetailsElement) {
        exportProjectSection.open = true;
      }
      if (trigger instanceof HTMLElement) {
        rememberOverlayTrigger(exportWorkbenchOverlay, trigger);
      }
      renderExportWorkbenchUi(true);
      syncSupportSurfaceUrlState("export");
      focusOverlaySurface(exportWorkbenchPanel);
      return;
    }
    renderExportWorkbenchUi(false);
    syncSupportSurfaceUrlState("");
    if (restoreFocus) {
      restoreOverlayTriggerFocus(exportWorkbenchOverlay);
    }
  };

  state.openExportWorkbenchFn = (trigger = dockExportBtn) => {
    setExportWorkbenchState(true, { trigger });
    return true;
  };
  state.closeExportWorkbenchFn = ({ restoreFocus = true } = {}) => {
    setExportWorkbenchState(false, { restoreFocus });
    return false;
  };

  state.openTransportWorkbenchFn = (trigger = null) => {
    return openTransportWorkbench(trigger);
  };
  state.closeTransportWorkbenchFn = ({ restoreFocus = true } = {}) => {
    return closeTransportWorkbench({ restoreFocus });
  };
  state.refreshTransportWorkbenchUiFn = renderTransportWorkbenchUi;
  initializeTransportWorkbenchRuntime();

  const getPaintModeLabel = () => (
    String(state.paintMode || "visual") === "sovereignty"
      ? t("Political Ownership", "ui")
      : t("Visual Color", "ui")
  );

  const getPrimaryActionLabel = () => (
    String(state.paintMode || "visual") === "sovereignty"
      ? t("Auto-Fill Ownership", "ui")
      : t("Auto-Fill Visuals", "ui")
  );

  const normalizeCountryCode = (rawCode) =>
    String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");

  const getFeatureDisplayName = (feature, fallback = "") => {
    const props = feature?.properties || {};
    const rawLabel = state.currentLanguage === "zh"
      ? (props.label_zh || props.name_zh || props.label || props.name)
      : (props.label_en || props.name_en || props.label || props.name);
    return String(rawLabel || props.id || feature?.id || fallback || "").trim();
  };

  const getWorkspaceSelectionLabel = () => {
    const specialId = String(state.selectedSpecialRegionId || "").trim();
    if (specialId && state.specialRegionsById?.has(specialId)) {
      return getFeatureDisplayName(state.specialRegionsById.get(specialId), t("Special Region", "ui"));
    }

    const waterId = String(state.selectedWaterRegionId || "").trim();
    if (waterId && state.waterRegionsById?.has(waterId)) {
      return getFeatureDisplayName(state.waterRegionsById.get(waterId), t("Water Region", "ui"));
    }

    const selectedCode = normalizeCountryCode(state.selectedInspectorCountryCode);
    if (selectedCode) {
      const label = String(state.countryNames?.[selectedCode] || selectedCode).trim() || selectedCode;
      return `${t(label, "geo") || label} (${selectedCode})`;
    }

    return t("No selection", "ui");
  };

  const refreshScenarioSelectionChip = () => {
    const selectionLabel = getWorkspaceSelectionLabel();
    const hasSelection = selectionLabel !== t("No selection", "ui");
    if (scenarioContextSelectionItem) {
      scenarioContextSelectionItem.classList.toggle("hidden", !hasSelection);
    }
    if (scenarioContextSelectionText) {
      scenarioContextSelectionText.textContent = selectionLabel;
      scenarioContextSelectionText.setAttribute("title", `${t("Selection", "ui")}: ${selectionLabel}`);
    }
  };

  const refreshWorkspaceStatus = () => {
    updateLanguageToggleUi();
    refreshScenarioSelectionChip();
    renderOceanCoastalAccentUi();
  };
  state.updateWorkspaceStatusFn = refreshWorkspaceStatus;

  const getActiveQuickFillPolicy = () => {
    const selectedCode = normalizeCountryCode(
      state.selectedInspectorCountryCode || state.inspectorHighlightCountryCode
    );
    if (!selectedCode || !(state.countryInteractionPoliciesByCode instanceof Map)) {
      return null;
    }
    return state.countryInteractionPoliciesByCode.get(selectedCode) || null;
  };

  const getQuickFillParentLabel = (policy) => {
    if (policy?.parentScopeLabel === "Province") {
      return t("By Province", "ui");
    }
    return t("By Parent", "ui");
  };

  const getQuickFillHint = (policy) => {
    const requestedScope = String(state.batchFillScope || "parent") === "country" ? "country" : "parent";
    if (requestedScope === "country") {
      return t("Single-click: one subdivision | Double-click: country batch", "ui");
    }
    if (policy?.parentScopeLabel === "Province") {
      return t("Single-click: one subdivision | Double-click: province batch", "ui");
    }
    return t("Single-click: one subdivision | Double-click: parent batch", "ui");
  };

  const refreshQuickFillControls = () => {
    const isScenarioMode = !!state.activeScenarioId;
    const isOwnershipMode = String(state.paintMode || "visual") === "sovereignty";
    const isSubdivisionMode = String(state.interactionGranularity || "subdivision") !== "country";
    const activePolicy = getActiveQuickFillPolicy();
    const parentEnabled = !activePolicy
      || !Array.isArray(activePolicy.quickFillScopes)
      || activePolicy.quickFillScopes.includes("parent");
    const countryEnabled = !activePolicy
      || !Array.isArray(activePolicy.quickFillScopes)
      || activePolicy.quickFillScopes.includes("country");
    const isVisible = !isScenarioMode && !isOwnershipMode && isSubdivisionMode;

    if (dockQuickFillBtn) {
      dockQuickFillBtn.classList.toggle("hidden", !isVisible);
      dockQuickFillBtn.setAttribute("aria-hidden", isVisible ? "false" : "true");
      dockQuickFillBtn.setAttribute("aria-expanded", state.activeDockPopover === "quickfill" ? "true" : "false");
    }
    if (dockQuickFillRow) {
      const shouldShowPopover = isVisible && state.activeDockPopover === "quickfill";
      dockQuickFillRow.classList.toggle("hidden", !shouldShowPopover);
      dockQuickFillRow.setAttribute("aria-hidden", shouldShowPopover ? "false" : "true");
    }
    if (!isVisible && state.activeDockPopover === "quickfill") {
      closeDockPopover();
    }
    if (quickFillParentBtn) {
      quickFillParentBtn.textContent = getQuickFillParentLabel(activePolicy);
      quickFillParentBtn.disabled = !parentEnabled;
      quickFillParentBtn.classList.toggle(
        "is-active",
        parentEnabled && String(state.batchFillScope || "parent") !== "country"
      );
    }
    if (quickFillCountryBtn) {
      quickFillCountryBtn.textContent = t("By Country", "ui");
      quickFillCountryBtn.disabled = !countryEnabled;
      quickFillCountryBtn.classList.toggle(
        "is-active",
        countryEnabled && String(state.batchFillScope || "parent") === "country"
      );
    }
    if (dockQuickFillHint) {
      dockQuickFillHint.textContent = getQuickFillHint(activePolicy);
    }
  };

  const refreshPaintControlsLayout = () => {
    const isScenarioMode = !!state.activeScenarioId;
    const isOwnershipMode = String(state.paintMode || "visual") === "sovereignty";
    const showPoliticalPanel = !isScenarioMode && (state.ui.politicalEditingExpanded || isOwnershipMode);
    const showBorderMaintenance = isScenarioMode || state.ui.politicalEditingExpanded || isOwnershipMode;
    const showGranularityField = !isScenarioMode;
    const showColorModeField = !isOwnershipMode;
    const showPoliticalEditingToggle = !isScenarioMode;
    const showEditConfigButton = showGranularityField || showColorModeField || showPoliticalEditingToggle || showPoliticalPanel;
    const primaryActionLabel = getPrimaryActionLabel();

    if (document.getElementById("labelPresetPolitical")) {
      document.getElementById("labelPresetPolitical").textContent = primaryActionLabel;
    }
    if (presetPolitical) {
      presetPolitical.setAttribute("aria-label", primaryActionLabel);
      presetPolitical.setAttribute("title", primaryActionLabel);
    }

    if (dockGranularityField) {
      dockGranularityField.classList.toggle("hidden", !showGranularityField);
    }

    if (dockColorModeField) {
      dockColorModeField.classList.toggle("hidden", !showColorModeField);
    }

    if (politicalEditingToggleBtn) {
      politicalEditingToggleBtn.classList.toggle("hidden", !showPoliticalEditingToggle);
      politicalEditingToggleBtn.classList.toggle("is-active", showPoliticalPanel);
      politicalEditingToggleBtn.setAttribute("aria-expanded", String(showPoliticalPanel));
    }

    if (dockPoliticalEditingPanel) {
      dockPoliticalEditingPanel.classList.toggle("hidden", !showPoliticalPanel);
      dockPoliticalEditingPanel.setAttribute("aria-hidden", showPoliticalPanel ? "false" : "true");
    }

    if (!showEditConfigButton && state.activeDockPopover === "edit") {
      closeDockPopover();
    }
    if (dockEditPopoverBtn) {
      dockEditPopoverBtn.classList.toggle("hidden", !showEditConfigButton);
      dockEditPopoverBtn.setAttribute("aria-hidden", showEditConfigButton ? "false" : "true");
    }
    if (dockConfigGroup) {
      dockConfigGroup.classList.toggle("hidden", !showEditConfigButton);
      dockConfigGroup.setAttribute("aria-hidden", showEditConfigButton ? "false" : "true");
    }

    if (recalculateBordersBtn) {
      recalculateBordersBtn.classList.toggle("hidden", !showBorderMaintenance);
    }

    if (dynamicBorderStatus) {
      dynamicBorderStatus.classList.toggle("hidden", !showBorderMaintenance);
    }

    refreshQuickFillControls();
    refreshWorkspaceStatus();
  };

  const updateDockCollapsedUi = () => {
    if (!bottomDock) return;
    bottomDock.classList.toggle("is-collapsed", !!state.ui.dockCollapsed);
    if (dockCollapseBtn) {
      dockCollapseBtn.setAttribute("aria-pressed", state.ui.dockCollapsed ? "true" : "false");
      dockCollapseBtn.setAttribute(
        "aria-label",
        state.ui.dockCollapsed ? t("Expand quick dock", "ui") : t("Collapse quick dock", "ui")
      );
      dockCollapseBtn.setAttribute("title", state.ui.dockCollapsed ? t("Expand", "ui") : t("Collapse", "ui"));
    }
    if (dockHandleChevron) {
      dockHandleChevron.textContent = state.ui.dockCollapsed ? "^" : "v";
    }
    if (dockHandleLabel) {
      dockHandleLabel.textContent = state.ui.dockCollapsed ? t("Expand", "ui") : t("Collapse", "ui");
    }
  };

  const setAppearanceTab = (tabId) => {
    const normalized = String(tabId || "").trim().toLowerCase();
    const activeId = normalized || "ocean";
    appearanceTabButtons.forEach((button) => {
      const id = String(button.dataset.appearanceTab || "").trim().toLowerCase();
      const isActive = id === activeId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    appearanceTabPanels.forEach((panel) => {
      const id = String(panel.dataset.appearancePanel || "").trim().toLowerCase();
      const isActive = id === activeId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
    if (typeof state.syncFacilityInfoCardVisibilityFn === "function") {
      state.syncFacilityInfoCardVisibilityFn();
    }
  };

  const closeSpecialZonePopover = () => {
    if (!specialZonePopover || specialZoneEditorInline) return;
    specialZonePopover.classList.add("hidden");
    specialZonePopover.setAttribute("aria-hidden", "true");
    appearanceSpecialZoneBtn?.classList.remove("is-active");
    appearanceSpecialZoneBtn?.setAttribute("aria-expanded", "false");
  };

  const openSpecialZonePopover = () => {
    if (!specialZonePopover || specialZoneEditorInline) return;
    const willOpen = specialZonePopover.classList.contains("hidden");
    if (!willOpen) {
      closeSpecialZonePopover();
      return;
    }
    rememberOverlayTrigger(specialZonePopover, appearanceSpecialZoneBtn);
    specialZonePopover.classList.remove("hidden");
    specialZonePopover.setAttribute("aria-hidden", "false");
    appearanceSpecialZoneBtn?.classList.add("is-active");
    appearanceSpecialZoneBtn?.setAttribute("aria-expanded", "true");
    focusOverlaySurface(specialZonePopover);
  };

  const closeScenarioGuidePopover = ({ restoreFocus = false, syncUrl = true } = {}) => {
    if (!scenarioGuidePopover) return;
    closeScenarioGuideSurface({
      restoreFocus,
      restoreOverlayTriggerFocus,
    });
    if (syncUrl) {
      syncSupportSurfaceUrlState("");
    }
  };

  const ensureProjectSupportSurface = (sectionKind = "utilities") => {
    if (!document.body.classList.contains("right-drawer-open")) {
      toggleRightPanel(true);
    }
    inspectorSidebarTabProject?.click();
    if (inspectorSidebarTabProject && inspectorSidebarTabProject.getAttribute("aria-selected") !== "true") {
      const inspectorSidebarPanel = document.getElementById("inspectorSidebarPanel");
      const projectSidebarPanel = document.getElementById("projectSidebarPanel");
      const inspectorSidebarTabInspector = document.getElementById("inspectorSidebarTabInspector");
      inspectorSidebarTabProject.classList.add("is-active");
      inspectorSidebarTabProject.setAttribute("aria-selected", "true");
      inspectorSidebarTabInspector?.classList.remove("is-active");
      inspectorSidebarTabInspector?.setAttribute("aria-selected", "false");
      projectSidebarPanel?.classList.add("is-active");
      if (projectSidebarPanel instanceof HTMLElement) projectSidebarPanel.hidden = false;
      inspectorSidebarPanel?.classList.remove("is-active");
      if (inspectorSidebarPanel instanceof HTMLElement) inspectorSidebarPanel.hidden = true;
    }
    if (sectionKind === "export" && exportProjectSection instanceof HTMLDetailsElement) {
      exportProjectSection.open = true;
    }
    if (sectionKind !== "export" && inspectorUtilitiesSection instanceof HTMLDetailsElement) {
      inspectorUtilitiesSection.open = true;
    }
  };

  const restoreSupportSurfaceFromUrl = () => {
    if (!globalThis.URLSearchParams || !globalThis.location) return;
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    const view = String(params.get(UI_URL_STATE_KEYS.view) || "").trim().toLowerCase();
    if (!["guide", "reference", "export"].includes(view)) return;
    ensureTransportWorkbenchUiState();
    if (state.ui?.restoredSupportSurfaceViewFromUrl === view) {
      return;
    }
    if (view === "guide") {
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
        state.ui.restoredSupportSurfaceViewFromUrl = view;
        return;
      }
      toggleScenarioGuidePopover(getGuideFocusReturnTrigger(utilitiesGuideBtn));
      state.ui.restoredSupportSurfaceViewFromUrl = view;
      return;
    }
    if (view === "export") {
      ensureProjectSupportSurface("export");
      const exportTrigger = isFocusableGuideTriggerVisible(dockExportBtn) ? dockExportBtn : null;
      state.openExportWorkbenchFn?.(exportTrigger);
      state.ui.restoredSupportSurfaceViewFromUrl = view;
      return;
    }
    ensureProjectSupportSurface("utilities");
    const targetPopover = getDockPopoverByKind(view);
    if (state.activeDockPopover === view && targetPopover && !targetPopover.classList.contains("hidden")) {
      state.ui.restoredSupportSurfaceViewFromUrl = view;
      return;
    }
    openDockPopover(view);
    state.ui.restoredSupportSurfaceViewFromUrl = view;
  };
  state.restoreSupportSurfaceFromUrlFn = restoreSupportSurfaceFromUrl;

  const toggleScenarioGuidePopover = (trigger = scenarioGuideBtn) => {
    if (!scenarioGuidePopover) return;
    const willOpen = scenarioGuidePopover.classList.contains("hidden");
    if (!willOpen) {
      closeScenarioGuidePopover({ restoreFocus: true });
      return;
    }
    closeDockPopover({ restoreFocus: false, syncUrl: false });
    state.closeExportWorkbenchFn?.({ restoreFocus: false });
    closeSpecialZonePopover();
    rememberOverlayTrigger(scenarioGuidePopover, trigger);
    openScenarioGuideSurface({ focusOverlaySurface });
    syncSupportSurfaceUrlState("guide");
  };

  const getScenarioOverlayLeftInset = () => (
    globalThis.innerWidth <= 767 ? SCENARIO_BAR_MOBILE_LEFT_OFFSET : SCENARIO_BAR_LEFT_OFFSET
  );

  const applyScenarioOverlaySafeLayout = () => {
    if (!scenarioContextBar || !zoomControls) return;
    const overlayRect =
      scenarioContextBar.offsetParent?.getBoundingClientRect()
      || mapContainer?.closest(".map-stage")?.getBoundingClientRect()
      || mapContainer?.getBoundingClientRect()
      || { left: 0, right: globalThis.innerWidth || 0 };
    const zoomRect = zoomControls.getBoundingClientRect();
    const leftInset = getScenarioOverlayLeftInset();
    const fallbackWidth = Math.round((overlayRect.right - overlayRect.left) - (leftInset * 2));
    const rawAvailableWidth = Math.round(
      zoomRect.left - overlayRect.left - leftInset - SCENARIO_BAR_SAFE_GAP
    );
    const availableWidth = Math.max(
      SCENARIO_BAR_MIN_WIDTH,
      Math.min(fallbackWidth, rawAvailableWidth > 0 ? rawAvailableWidth : fallbackWidth)
    );
    scenarioContextBar.classList.remove("is-overlap-avoid");
    scenarioContextBar.style.maxWidth = `${availableWidth}px`;
  };

  const refreshScenarioContextBar = () => {
    if (!scenarioContextBar) return;
    const activeScenario = String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "").trim();
    const activeCode = String(state.activeSovereignCode || "").trim().toUpperCase();
    const splitCount = Number(state.scenarioOwnerControllerDiffCount || 0);
    const activeLabel = activeCode
      ? (t(state.countryNames?.[activeCode] || activeCode, "geo") || state.countryNames?.[activeCode] || activeCode)
      : t("None", "ui");
    const modeLabel = getPaintModeLabel();
    const scenarioViewLabel = String(state.scenarioViewMode || "ownership") === "frontline"
      ? t("Frontline", "ui")
      : t("Ownership", "ui");
    const showScenarioState = !!activeScenario;
    const activeValue = activeCode ? `${activeLabel} (${activeCode})` : t("None", "ui");
    scenarioContextBar.classList.toggle("is-scenario", !!activeScenario);
    scenarioContextBar.classList.toggle("is-collapsed", !!state.ui.scenarioBarCollapsed);
    if (scenarioContextScenarioText) {
      const scenarioValue = activeScenario || t("None", "ui");
      scenarioContextScenarioText.textContent = scenarioValue;
      scenarioContextScenarioText.setAttribute("title", `${t("Scenario", "ui")}: ${scenarioValue}`);
    }
    if (scenarioContextModeText) {
      scenarioContextModeText.textContent = modeLabel;
      scenarioContextModeText.setAttribute(
        "title",
        showScenarioState
          ? `${t("Mode", "ui")}: ${modeLabel} · ${t("View", "ui")}: ${scenarioViewLabel} · ${t("Split", "ui")}: ${splitCount}`
          : `${t("Mode", "ui")}: ${modeLabel}`
      );
    }
    if (scenarioContextActiveText) {
      scenarioContextActiveText.textContent = activeValue;
      scenarioContextActiveText.setAttribute("title", `${t("Active", "ui")}: ${activeValue}`);
    }
    if (scenarioContextCollapseBtn) {
      scenarioContextCollapseBtn.textContent = state.ui.scenarioBarCollapsed ? "+" : "-";
      scenarioContextCollapseBtn.setAttribute("aria-label", state.ui.scenarioBarCollapsed
        ? t("Expand", "ui")
        : t("Collapse", "ui"));
    }
    syncScenarioGuideTriggerButtons({
      isOpen: !!(scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")),
      tutorialEntryVisible: !!state.ui.tutorialEntryVisible,
    });
    if (scenarioTransportWorkbenchBtn) {
      scenarioTransportWorkbenchBtn.textContent = t("Transport", "ui");
      scenarioTransportWorkbenchBtn.setAttribute("title", state.transportWorkbenchUi?.open
        ? t("Close transport workbench", "ui")
        : t("Open transport workbench", "ui"));
    }
    refreshScenarioSelectionChip();
    renderScenarioGuideStatus({
      activeScenario,
      modeLabel,
      scenarioViewLabel,
      splitCount,
    });
    refreshWorkspaceStatus();
    applyScenarioOverlaySafeLayout();
  };

  const triggerScenarioGuide = () => {
    if (!scenarioContextBar) return;
    scenarioContextBar.classList.add("is-highlight");
    if (scenarioGuideTimerId) {
      globalThis.clearTimeout(scenarioGuideTimerId);
    }
    scenarioGuideTimerId = globalThis.setTimeout(() => {
      scenarioContextBar.classList.remove("is-highlight");
    }, 3000);
  };
  state.updateScenarioContextBarFn = refreshScenarioContextBar;
  state.triggerScenarioGuideFn = triggerScenarioGuide;
  let onboardingAutoTimer = 0;
  const dismissOnboardingHint = () => {
    if (onboardingAutoTimer) { clearTimeout(onboardingAutoTimer); onboardingAutoTimer = 0; }
    if (!mapOnboardingHint || state.onboardingDismissed) return;
    state.onboardingDismissed = true;
    mapOnboardingHint.classList.add("is-hidden");
    mapOnboardingHint.setAttribute("aria-hidden", "true");
  };
  const showOnboardingHint = () => {
    if (!mapOnboardingHint) return;
    state.onboardingDismissed = false;
    mapOnboardingHint.classList.remove("is-hidden");
    mapOnboardingHint.setAttribute("aria-hidden", "false");
    if (onboardingAutoTimer) clearTimeout(onboardingAutoTimer);
    onboardingAutoTimer = setTimeout(dismissOnboardingHint, 5000);
  };
  state.dismissOnboardingHintFn = dismissOnboardingHint;
  state.showOnboardingHintFn = showOnboardingHint;

  const showToolHud = (message, { duration = 1200 } = {}) => {
    if (!toolHudChip || !message) return;
    toolHudChip.textContent = message;
    toolHudChip.classList.remove("hidden", "is-hidden");
    toolHudChip.classList.add("is-visible");
    if (toolHudTimerId) {
      globalThis.clearTimeout(toolHudTimerId);
    }
    toolHudTimerId = globalThis.setTimeout(() => {
      toolHudChip.classList.remove("is-visible");
      toolHudChip.classList.add("is-hidden");
      globalThis.setTimeout(() => {
        toolHudChip.classList.add("hidden");
      }, 180);
    }, duration);
  };

  const emitTransientFeedback = (
    message,
    { tone = "info", duration = 1200, toast = false, title = "" } = {}
  ) => {
    if (!message) return;
    showToolHud(message, { duration });
    if (toast) {
      showToast(message, {
        title: title || undefined,
        tone,
        duration: Math.max(duration + 1200, 3200),
      });
    }
  };

  const getToolFeedbackLabel = (tool) => t(
    tool === "eraser"
      ? "Eraser"
      : tool === "eyedropper"
        ? "Eyedropper"
        : "Fill",
    "ui"
  );

  const getDockPopoverByKind = (kind) => {
    if (kind === "reference") return dockReferencePopover;
    if (kind === "edit") return dockEditPopover;
    if (kind === "quickfill") return dockQuickFillRow;
    return null;
  };
  const getDockPopoverTrigger = (kind) => {
    if (kind === "reference") return dockReferenceBtn;
    if (kind === "edit") return dockEditPopoverBtn;
    if (kind === "quickfill") return dockQuickFillBtn;
    return null;
  };

  const SUPPORT_DOCK_POPOVER_KINDS = new Set(["reference"]);
  const isSupportDockPopoverKind = (kind) => SUPPORT_DOCK_POPOVER_KINDS.has(String(kind || ""));

  const closeDockPopover = ({ restoreFocus = false, syncUrl = true } = {}) => {
    const activeKind = String(state.activeDockPopover || "");
    const activePopover = getDockPopoverByKind(activeKind);
    const activeTrigger = getDockPopoverTrigger(activeKind);
    state.activeDockPopover = "";
    dockReferencePopover?.classList.add("hidden");
    dockEditPopover?.classList.add("hidden");
    dockQuickFillRow?.classList.add("hidden");
    dockReferencePopover?.setAttribute("aria-hidden", "true");
    dockEditPopover?.setAttribute("aria-hidden", "true");
    dockQuickFillRow?.setAttribute("aria-hidden", "true");
    dockReferenceBtn?.classList.remove("is-active");
    dockEditPopoverBtn?.classList.remove("is-active");
    dockQuickFillBtn?.classList.remove("is-active");
    dockReferenceBtn?.setAttribute("aria-expanded", "false");
    dockEditPopoverBtn?.setAttribute("aria-expanded", "false");
    dockQuickFillBtn?.setAttribute("aria-expanded", "false");
    if (restoreFocus && activePopover) {
      restoreOverlayTriggerFocus(activePopover, activeTrigger);
    }
    if (syncUrl && isSupportDockPopoverKind(activeKind)) {
      syncSupportSurfaceUrlState("");
    }
  };
  state.closeDockPopoverFn = closeDockPopover;

  const syncPanelToggleButtons = () => {
    leftPanelToggle?.setAttribute("aria-expanded", String(document.body.classList.contains("left-drawer-open")));
    rightPanelToggle?.setAttribute("aria-expanded", String(document.body.classList.contains("right-drawer-open")));
  };

  const toggleLeftPanel = (force) => {
    if (state.transportWorkbenchUi?.open && force !== false) {
      return false;
    }
    closeDockPopover();
    const next = typeof force === "boolean" ? force : !document.body.classList.contains("left-drawer-open");
    document.body.classList.toggle("left-drawer-open", next);
    document.body.classList.toggle("right-drawer-open", false);
    syncPanelToggleButtons();
    refreshScenarioContextBar();
    return next;
  };

  const toggleRightPanel = (force) => {
    if (state.transportWorkbenchUi?.open && force !== false) {
      return false;
    }
    closeDockPopover();
    const next = typeof force === "boolean" ? force : !document.body.classList.contains("right-drawer-open");
    document.body.classList.toggle("right-drawer-open", next);
    document.body.classList.toggle("left-drawer-open", false);
    syncPanelToggleButtons();
    refreshScenarioContextBar();
    return next;
  };

  const toggleDock = (force) => {
    state.ui.dockCollapsed = typeof force === "boolean" ? force : !state.ui.dockCollapsed;
    if (state.ui.dockCollapsed) {
      closeDockPopover();
    }
    updateDockCollapsedUi();
    return state.ui.dockCollapsed;
  };

  state.toggleLeftPanelFn = toggleLeftPanel;
  state.toggleRightPanelFn = toggleRightPanel;
  state.toggleDockFn = toggleDock;
  state.syncDeveloperModeUiFn = syncDeveloperModeUi;
  state.toggleDeveloperModeFn = () => {
    const shouldOpen = !state.ui.developerMode;
    if (shouldOpen) {
      setDeveloperMode(true);
      if (typeof state.setDevWorkspaceExpandedFn === "function") {
        state.setDevWorkspaceExpandedFn(true);
      } else if (devWorkspaceToggleBtn && !state.ui.devWorkspaceExpanded) {
        devWorkspaceToggleBtn.click();
      }
      return true;
    }

    if (typeof state.setDevWorkspaceExpandedFn === "function") {
      state.setDevWorkspaceExpandedFn(false);
    } else if (devWorkspaceToggleBtn && state.ui.devWorkspaceExpanded) {
      devWorkspaceToggleBtn.click();
    }
    setDeveloperMode(false);
    return false;
  };

  const openDockPopover = (kind) => {
    const target = getDockPopoverByKind(kind);
    const trigger = getDockPopoverTrigger(kind);
    if (!target) return;
    const nextKind = state.activeDockPopover === kind ? "" : kind;
    closeDockPopover();
    if (!nextKind) return;
    if (isSupportDockPopoverKind(nextKind) && scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
      closeScenarioGuidePopover({ restoreFocus: false, syncUrl: false });
    }
    state.closeExportWorkbenchFn?.({ restoreFocus: false });
    state.activeDockPopover = nextKind;
    rememberOverlayTrigger(target, trigger);
    target.classList.remove("hidden");
    target.setAttribute("aria-hidden", "false");
    trigger?.classList.add("is-active");
    trigger?.setAttribute("aria-expanded", "true");
    if (isSupportDockPopoverKind(nextKind)) {
      syncSupportSurfaceUrlState(nextKind);
    }
    focusOverlaySurface(target);
  };

  const bindDockPopoverDismiss = () => {
    if (dockPopoverCloseBound) return;
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const insideDockPopover = target.closest(
        "#dockReferencePopover, #dockEditPopover, #dockQuickFillRow, #dockReferenceBtn, #dockEditPopoverBtn, #dockQuickFillBtn"
      );
      if (state.activeDockPopover && !insideDockPopover) {
        closeDockPopover();
      }
      const insideSpecialZone = target.closest("#specialZonePopover, #appearanceSpecialZoneBtn");
      if (!specialZoneEditorInline && specialZonePopover && !specialZonePopover.classList.contains("hidden") && !insideSpecialZone) {
        closeSpecialZonePopover();
      }
      const insideScenarioGuide = target.closest("#scenarioGuidePopover, #scenarioGuideBtn, #utilitiesGuideBtn, #scenarioGuideBackdrop");
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden") && !insideScenarioGuide) {
        closeScenarioGuidePopover();
      }
      const insideTransportWorkbenchInfo = target.closest("#transportWorkbenchInfoPopover, #transportWorkbenchInfoBtn");
      if (transportWorkbenchInfoPopover && !transportWorkbenchInfoPopover.classList.contains("hidden") && !insideTransportWorkbenchInfo) {
        closeTransportWorkbenchInfoPopover();
      }
      const insideTransportWorkbenchSectionHelp = target.closest("#transportWorkbenchSectionHelpPopover, .transport-workbench-section-help-btn");
      if (transportWorkbenchSectionHelpPopover && !transportWorkbenchSectionHelpPopover.classList.contains("hidden") && !insideTransportWorkbenchSectionHelp) {
        closeTransportWorkbenchSectionHelpPopover();
      }
      if (
        exportWorkbenchOverlay
        && exportWorkbenchPanel
        && !exportWorkbenchOverlay.classList.contains("hidden")
        && target === exportWorkbenchOverlay
      ) {
        state.closeExportWorkbenchFn?.({ restoreFocus: true });
      }
    });
    document.addEventListener("keydown", (event) => {
      if (exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden") && event.key === "Tab") {
        const focusables = getFocusableElements(exportWorkbenchPanel);
        if (!focusables.length) {
          event.preventDefault();
          focusOverlaySurface(exportWorkbenchPanel);
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
          return;
        }
        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
          return;
        }
      }
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden") && event.key === "Tab") {
        const focusables = getFocusableElements(scenarioGuidePopover);
        if (!focusables.length) {
          event.preventDefault();
          focusOverlaySurface(scenarioGuidePopover);
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
          return;
        }
        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
          return;
        }
      }
      if (event.key === "Escape") {
        let closedOverlay = false;
        if (state.activeDockPopover) {
          closeDockPopover({ restoreFocus: true });
          closedOverlay = true;
        }
        if (!specialZoneEditorInline) {
          if (specialZonePopover && !specialZonePopover.classList.contains("hidden")) {
            closeSpecialZonePopover();
            restoreOverlayTriggerFocus(specialZonePopover, appearanceSpecialZoneBtn);
            closedOverlay = true;
          }
        }
        if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
          closeScenarioGuidePopover({ restoreFocus: true });
          closedOverlay = true;
        }
        if (exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden")) {
          state.closeExportWorkbenchFn?.({ restoreFocus: true });
          closedOverlay = true;
        }
        if (transportWorkbenchInfoPopover && !transportWorkbenchInfoPopover.classList.contains("hidden")) {
          closeTransportWorkbenchInfoPopover({ restoreFocus: true });
          closedOverlay = true;
        }
        if (closedOverlay) {
          event.preventDefault();
        }
      }
    });
    dockPopoverCloseBound = true;
  };

  const setToolCursorClass = () => {
    if (!mapContainer) return;
    mapContainer.classList.remove("tool-fill", "tool-eraser", "tool-eyedropper", "tool-special-zone", "tool-pan-override");
    if (state.specialZoneEditor?.active) {
      mapContainer.classList.add("tool-special-zone");
      return;
    }
    if (state.brushModeEnabled && state.brushPanModifierActive) {
      mapContainer.classList.add("tool-pan-override");
      return;
    }
    mapContainer.classList.add(`tool-${state.currentTool || "fill"}`);
  };

  const renderDirty = (reason) => {
    markDirty(reason);
    if (render) render();
  };
  let pendingOceanVisualFrame = 0;
  let pendingOceanVisualReason = "";
  const pendingOceanVisualInvalidations = new Map();
  const flushPendingOceanVisualUpdates = () => {
    pendingOceanVisualFrame = 0;
    const queuedInvalidations = Array.from(pendingOceanVisualInvalidations.entries());
    pendingOceanVisualInvalidations.clear();
    queuedInvalidations.forEach(([invalidateFn, reason]) => {
      if (typeof invalidateFn === "function") {
        invalidateFn(reason);
      }
    });
    if (pendingOceanVisualReason) {
      renderDirty(pendingOceanVisualReason);
      pendingOceanVisualReason = "";
    }
  };
  const scheduleOceanVisualUpdate = (invalidateFn, reason) => {
    if (typeof invalidateFn !== "function") return;
    pendingOceanVisualInvalidations.set(invalidateFn, reason);
    pendingOceanVisualReason = String(reason || pendingOceanVisualReason || "ocean-visual");
    if (pendingOceanVisualFrame) return;
    pendingOceanVisualFrame = globalThis.requestAnimationFrame(flushPendingOceanVisualUpdates);
  };
  const applyOceanVisualUpdateNow = (invalidateFn, reason) => {
    if (pendingOceanVisualFrame) {
      globalThis.cancelAnimationFrame(pendingOceanVisualFrame);
      pendingOceanVisualFrame = 0;
    }
    pendingOceanVisualInvalidations.clear();
    pendingOceanVisualReason = "";
    if (typeof invalidateFn === "function") {
      invalidateFn(reason);
    }
    renderDirty(reason);
  };
  const bindOceanVisualInput = (element, onInput, onChange = null) => {
    if (!element || element.dataset.bound === "true") return;
    element.addEventListener("input", (event) => {
      onInput?.(event, false);
    });
    element.addEventListener("change", (event) => {
      if (typeof onChange === "function") {
        onChange(event, true);
        return;
      }
      onInput?.(event, true);
    });
    element.dataset.bound = "true";
  };
  const persistCityViewSettings = () => {
    state.persistViewSettingsFn?.();
  };
  const textureStylePaths = [
    "styleConfig.texture.mode",
    "styleConfig.texture.opacity",
    "styleConfig.texture.paper.assetId",
    "styleConfig.texture.paper.scale",
    "styleConfig.texture.paper.warmth",
    "styleConfig.texture.paper.grain",
    "styleConfig.texture.paper.wear",
    "styleConfig.texture.paper.vignette",
    "styleConfig.texture.paper.blendMode",
    "styleConfig.texture.graticule.majorStep",
    "styleConfig.texture.graticule.minorStep",
    "styleConfig.texture.graticule.labelStep",
    "styleConfig.texture.graticule.color",
    "styleConfig.texture.graticule.labelColor",
    "styleConfig.texture.graticule.labelSize",
    "styleConfig.texture.graticule.majorWidth",
    "styleConfig.texture.graticule.minorWidth",
    "styleConfig.texture.graticule.majorOpacity",
    "styleConfig.texture.graticule.minorOpacity",
    "styleConfig.texture.draftGrid.majorStep",
    "styleConfig.texture.draftGrid.minorStep",
    "styleConfig.texture.draftGrid.lonOffset",
    "styleConfig.texture.draftGrid.latOffset",
    "styleConfig.texture.draftGrid.roll",
    "styleConfig.texture.draftGrid.color",
    "styleConfig.texture.draftGrid.width",
    "styleConfig.texture.draftGrid.majorOpacity",
    "styleConfig.texture.draftGrid.minorOpacity",
    "styleConfig.texture.draftGrid.dash",
  ];
  const lakeStylePaths = [
    "styleConfig.lakes.linkedToOcean",
    "styleConfig.lakes.fillColor",
  ];
  let textureHistoryBefore = null;
  let lakeHistoryBefore = null;

  const beginTextureHistoryCapture = () => {
    if (textureHistoryBefore) return;
    textureHistoryBefore = captureHistoryState({
      stylePaths: textureStylePaths,
    });
  };

  const commitTextureHistory = (kind = "texture-style") => {
    if (!textureHistoryBefore) return;
    pushHistoryEntry({
      kind,
      before: textureHistoryBefore,
      after: captureHistoryState({
        stylePaths: textureStylePaths,
      }),
    });
    textureHistoryBefore = null;
  };

  const beginLakeHistoryCapture = () => {
    if (lakeHistoryBefore) return;
    lakeHistoryBefore = captureHistoryState({
      stylePaths: lakeStylePaths,
    });
  };

  const commitLakeHistory = (kind = "lake-style") => {
    if (!lakeHistoryBefore) return;
    pushHistoryEntry({
      kind,
      before: lakeHistoryBefore,
      after: captureHistoryState({
        stylePaths: lakeStylePaths,
      }),
    });
    lakeHistoryBefore = null;
  };

  const syncTextureConfig = () => {
    state.styleConfig.texture = normalizeTextureStyleConfig(state.styleConfig.texture);
    return state.styleConfig.texture;
  };

  const syncLakeConfig = () => {
    state.styleConfig.lakes = normalizeLakeStyleConfig(state.styleConfig.lakes);
    return state.styleConfig.lakes;
  };

  const syncCityPointsConfig = () => {
    state.styleConfig.cityPoints = normalizeCityLayerStyleConfig(state.styleConfig.cityPoints);
    return state.styleConfig.cityPoints;
  };

  const CITY_POINTS_THEME_OPTIONS = [
    { value: "classic_graphite", labelKey: "optCityPointsThemeClassicGraphite", fallback: "Classic Graphite" },
    { value: "atlas_ink", labelKey: "optCityPointsThemeAtlasInk", fallback: "Atlas Ink" },
    { value: "parchment_sepia", labelKey: "optCityPointsThemeParchmentSepia", fallback: "Parchment Sepia" },
    { value: "slate_blue", labelKey: "optCityPointsThemeSlateBlue", fallback: "Slate Blue" },
    { value: "ivory_outline", labelKey: "optCityPointsThemeIvoryOutline", fallback: "Ivory Outline" },
  ];

  const getCityPointsThemeMeta = (themeValue) =>
    CITY_POINTS_THEME_OPTIONS.find((option) => option.value === String(themeValue || "").trim().toLowerCase())
    || CITY_POINTS_THEME_OPTIONS[0];

  const getCityPointsThemeLabel = (themeValue) => {
    const meta = getCityPointsThemeMeta(themeValue);
    return t(meta.fallback, "ui");
  };

  const CITY_POINTS_THEME_DEFAULT_STYLES = {
    classic_graphite: {
      color: "#2f343a",
      capitalColor: "#9f9072",
      hintEn: "Neutral graphite markers that stay readable on mixed political fills.",
      hintZh: "中性的石墨灰点位，适合混合政治底图，整体最稳。 ",
    },
    atlas_ink: {
      color: "#35506e",
      capitalColor: "#d2aa72",
      hintEn: "Cool blue-ink markers with a cleaner atlas feel and clearer outlines.",
      hintZh: "偏蓝墨水感的点位，轮廓更清楚，更像地图集标注。",
    },
    parchment_sepia: {
      color: "#866245",
      capitalColor: "#c78d55",
      hintEn: "Warmer sepia markers tuned for historical overlays and paper-like palettes.",
      hintZh: "更暖的棕褐色点位，适合历史纸面和偏暖色地图。",
    },
    slate_blue: {
      color: "#566c86",
      capitalColor: "#d4b178",
      hintEn: "Cool slate-blue markers that sit quietly on modern, cleaner political maps.",
      hintZh: "偏冷的石板蓝点位，适合更现代、更干净的政治底图。",
    },
    ivory_outline: {
      color: "#ddd2bf",
      capitalColor: "#b27a4a",
      hintEn: "Light ivory fills with darker rims for stronger contrast on darker land colors.",
      hintZh: "浅象牙底配深描边，在深色国土上会更显眼。",
    },
  };

  const getCityPointsThemeStyle = (themeValue) =>
    CITY_POINTS_THEME_DEFAULT_STYLES[getCityPointsThemeMeta(themeValue).value]
    || CITY_POINTS_THEME_DEFAULT_STYLES.classic_graphite;

  const getCityPointsThemeHint = (themeValue) => {
    const themeStyle = getCityPointsThemeStyle(themeValue);
    return state.currentLanguage === "zh" ? themeStyle.hintZh.trim() : themeStyle.hintEn;
  };

  const getCityPointsLabelDensityHint = (densityValue) => {
    const normalized = String(densityValue || "balanced").trim().toLowerCase();
    if (state.currentLanguage === "zh") {
      if (normalized === "sparse") return "Sparse · 标签预算 P4 16 / P5 32，只保留更关键的名称。";
      if (normalized === "dense") return "Dense · 标签预算 P4 32 / P5 64，会显示更多次级城市名称。";
      return "Balanced · 标签预算 P4 24 / P5 48，是默认的均衡读图方案。";
    }
    if (normalized === "sparse") return "Sparse · label budget P4 16 / P5 32, favoring only the most important names.";
    if (normalized === "dense") return "Dense · label budget P4 32 / P5 64, allowing more secondary city labels.";
    return "Balanced · label budget P4 24 / P5 48, the default readability mix.";
  };

  const ensureCityPointsThemeOptions = () => {
    if (!cityPointsTheme) return;
    const normalizedExisting = Array.from(cityPointsTheme.options || []).map((option) => String(option.value || ""));
    const expected = CITY_POINTS_THEME_OPTIONS.map((option) => option.value);
    const matchesExisting =
      normalizedExisting.length === expected.length
      && normalizedExisting.every((value, index) => value === expected[index]);
    if (matchesExisting) {
      Array.from(cityPointsTheme.options || []).forEach((optionNode, index) => {
        const meta = CITY_POINTS_THEME_OPTIONS[index];
        if (!meta) return;
        optionNode.id = meta.labelKey;
        optionNode.textContent = getCityPointsThemeLabel(meta.value);
      });
      return;
    }
    const fragment = document.createDocumentFragment();
    CITY_POINTS_THEME_OPTIONS.forEach((optionMeta) => {
      const option = document.createElement("option");
      option.value = optionMeta.value;
      option.id = optionMeta.labelKey;
      option.textContent = getCityPointsThemeLabel(optionMeta.value);
      fragment.appendChild(option);
    });
    cityPointsTheme.replaceChildren(fragment);
  };

  const formatCityPointsDensityValue = (value) => `${Number(value || 1).toFixed(2)}x`;

  const syncUrbanConfig = () => {
    state.styleConfig.urban = normalizeUrbanStyleConfig(state.styleConfig.urban);
    if (state.styleConfig.urban.mode === "manual") {
      state.styleConfig.urban.color = normalizeOceanFillColor(state.styleConfig.urban.color || "#4b5563");
    }
    state.styleConfig.urban.adaptiveTintColor = normalizeOceanFillColor(state.styleConfig.urban.adaptiveTintColor || "#f2dea1");
    return state.styleConfig.urban;
  };

  const getUrbanCapability = () => {
    const capability = state.urbanLayerCapability && typeof state.urbanLayerCapability === "object"
      ? state.urbanLayerCapability
      : null;
    if (capability) return capability;
    return {
      adaptiveAvailable: false,
      unavailableReason: "Urban layer metadata is still loading.",
    };
  };

  const getEffectiveUrbanMode = (urbanConfig, capability = getUrbanCapability()) => {
    if (urbanConfig?.mode === "adaptive" && !capability?.adaptiveAvailable) {
      return "manual";
    }
    return urbanConfig?.mode === "manual" ? "manual" : "adaptive";
  };

  const formatUrbanToneBias = (rawValue) => {
    const percent = Math.round((Number(rawValue) || 0) * 100);
    return `${percent >= 0 ? "+" : ""}${percent}%`;
  };

  const syncPhysicalConfig = () => {
    state.styleConfig.physical = normalizePhysicalStyleConfig(state.styleConfig.physical);
    state.styleConfig.physical.contourColor = normalizeOceanFillColor(
      state.styleConfig.physical.contourColor || "#6b5947"
    );
    return state.styleConfig.physical;
  };

  const applyPhysicalPresetConfig = (preset, { preserveMode = true } = {}) => {
    const current = syncPhysicalConfig();
    const resolvedPreset = normalizePhysicalPreset(preset);
    const next = createPhysicalStyleConfigForPreset(resolvedPreset);
    state.styleConfig.physical = normalizePhysicalStyleConfig({
      ...next,
      mode: preserveMode ? current.mode : next.mode,
      contourColor: current.contourColor || next.contourColor,
    });
    return state.styleConfig.physical;
  };

  const getPhysicalPresetHint = (preset) => {
    const normalizedPreset = normalizePhysicalPreset(preset);
    if (normalizedPreset === "political_clean") {
      return t("Political Clean keeps only the clearest landform cues over political fills.", "ui");
    }
    if (normalizedPreset === "terrain_rich") {
      return t("Terrain Rich pushes the atlas and contour layer for the strongest relief read.", "ui");
    }
    return t("Balanced keeps terrain visible while staying cleaner over political fills.", "ui");
  };

  const syncDayNightConfig = () => {
    state.styleConfig.dayNight = normalizeDayNightStyleConfig(state.styleConfig.dayNight);
    return state.styleConfig.dayNight;
  };

  const syncUrbanControls = () => {
    const urbanConfig = syncUrbanConfig();
    const capability = getUrbanCapability();
    const adaptiveAvailable = !!capability.adaptiveAvailable;
    const effectiveMode = getEffectiveUrbanMode(urbanConfig, capability);
    const isManual = effectiveMode === "manual";
    if (urbanMode) {
      urbanMode.value = effectiveMode;
      const adaptiveOption = urbanMode.querySelector('option[value="adaptive"]');
      if (adaptiveOption) adaptiveOption.disabled = !adaptiveAvailable;
    }
    if (urbanAdaptiveStatus) {
      const statusText = adaptiveAvailable ? "" : String(capability.unavailableReason || "").trim();
      urbanAdaptiveStatus.textContent = statusText;
      urbanAdaptiveStatus.classList.toggle("hidden", !statusText);
    }
    if (lblUrbanOpacity) lblUrbanOpacity.textContent = isManual ? t("Opacity", "ui") : t("Fill Opacity", "ui");
    if (urbanAdaptiveControls) urbanAdaptiveControls.classList.toggle("hidden", isManual);
    if (urbanManualControls) urbanManualControls.classList.toggle("hidden", !isManual);
    if (urbanColor) urbanColor.value = urbanConfig.color;
    if (urbanOpacity) urbanOpacity.value = String(Math.round(urbanConfig.fillOpacity * 100));
    if (urbanOpacityValue) urbanOpacityValue.textContent = `${Math.round(urbanConfig.fillOpacity * 100)}%`;
    if (urbanBlendMode) urbanBlendMode.value = urbanConfig.blendMode;
    if (urbanAdaptiveStrength) urbanAdaptiveStrength.value = String(Math.round(urbanConfig.adaptiveStrength * 100));
    if (urbanAdaptiveStrengthValue) {
      urbanAdaptiveStrengthValue.textContent = `${Math.round(urbanConfig.adaptiveStrength * 100)}%`;
    }
    if (urbanStrokeOpacity) urbanStrokeOpacity.value = String(Math.round(urbanConfig.strokeOpacity * 100));
    if (urbanStrokeOpacityValue) {
      urbanStrokeOpacityValue.textContent = `${Math.round(urbanConfig.strokeOpacity * 100)}%`;
    }
    if (urbanToneBias) urbanToneBias.value = String(Math.round(urbanConfig.toneBias * 100));
    if (urbanToneBiasValue) urbanToneBiasValue.textContent = formatUrbanToneBias(urbanConfig.toneBias);
    if (urbanAdaptiveTintEnabled) urbanAdaptiveTintEnabled.checked = !!urbanConfig.adaptiveTintEnabled;
    if (urbanAdaptiveTintColor) urbanAdaptiveTintColor.value = urbanConfig.adaptiveTintColor || "#f2dea1";
    if (urbanAdaptiveTintStrength) urbanAdaptiveTintStrength.value = String(Math.round((urbanConfig.adaptiveTintStrength || 0) * 100));
    if (urbanAdaptiveTintStrengthValue) {
      urbanAdaptiveTintStrengthValue.textContent = `${Math.round((urbanConfig.adaptiveTintStrength || 0) * 100)}%`;
    }
    [urbanAdaptiveStrength, urbanStrokeOpacity, urbanToneBias, urbanAdaptiveTintEnabled, urbanAdaptiveTintColor, urbanAdaptiveTintStrength].forEach((element) => {
      if (element) element.disabled = !adaptiveAvailable;
    });
    if (urbanAdaptiveTintColor) {
      urbanAdaptiveTintColor.disabled = !adaptiveAvailable || !urbanConfig.adaptiveTintEnabled;
    }
    if (urbanAdaptiveTintStrength) {
      urbanAdaptiveTintStrength.disabled = !adaptiveAvailable || !urbanConfig.adaptiveTintEnabled;
    }
    if (urbanMinArea) urbanMinArea.value = String(Math.round(urbanConfig.minAreaPx));
    if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(urbanConfig.minAreaPx)}`;
    return urbanConfig;
  };

  const formatUtcMinutes = (rawValue) => {
    const totalMinutes = clamp(Math.round(Number(rawValue) || 0), 0, 24 * 60 - 1);
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours}:${minutes} UTC`;
  };

  const updateTextureValueLabel = (element, text) => {
    if (element) element.textContent = text;
  };

  const renderTextureModePanels = (mode = state.styleConfig.texture?.mode || "none") => {
    texturePaperControls?.classList.toggle("hidden", mode !== "paper");
    textureGraticuleControls?.classList.toggle("hidden", mode !== "graticule");
    textureDraftGridControls?.classList.toggle("hidden", mode !== "draft_grid");
  };

  const renderTextureUI = () => {
    const texture = syncTextureConfig();
    const mode = normalizeTextureMode(texture.mode);
    const degreesLabel = "\u00B0";
    if (textureSelect) textureSelect.value = mode;
    const textureOpacityDisabled = mode === "none";
    if (textureOpacity) {
      textureOpacity.value = String(Math.round(texture.opacity * 100));
      textureOpacity.disabled = textureOpacityDisabled;
      textureOpacity.setAttribute("aria-disabled", textureOpacityDisabled ? "true" : "false");
    }
    updateTextureValueLabel(textureOpacityValue, `${Math.round(texture.opacity * 100)}%`);

    if (texturePaperScale) texturePaperScale.value = String(Math.round(texture.paper.scale * 100));
    updateTextureValueLabel(texturePaperScaleValue, `${texture.paper.scale.toFixed(2)}x`);
    if (texturePaperWarmth) texturePaperWarmth.value = String(Math.round(texture.paper.warmth * 100));
    updateTextureValueLabel(texturePaperWarmthValue, `${Math.round(texture.paper.warmth * 100)}%`);
    if (texturePaperGrain) texturePaperGrain.value = String(Math.round(texture.paper.grain * 100));
    updateTextureValueLabel(texturePaperGrainValue, `${Math.round(texture.paper.grain * 100)}%`);
    if (texturePaperWear) texturePaperWear.value = String(Math.round(texture.paper.wear * 100));
    updateTextureValueLabel(texturePaperWearValue, `${Math.round(texture.paper.wear * 100)}%`);

    if (textureGraticuleMajorStep) textureGraticuleMajorStep.value = String(texture.graticule.majorStep);
    updateTextureValueLabel(textureGraticuleMajorStepValue, `${Math.round(texture.graticule.majorStep)}${degreesLabel}`);
    if (textureGraticuleMinorStep) {
      textureGraticuleMinorStep.min = "1";
      textureGraticuleMinorStep.max = String(texture.graticule.majorStep);
      textureGraticuleMinorStep.step = "1";
      textureGraticuleMinorStep.value = String(texture.graticule.minorStep);
    }
    updateTextureValueLabel(textureGraticuleMinorStepValue, `${Math.round(texture.graticule.minorStep)}${degreesLabel}`);
    if (textureGraticuleLabelStep) {
      textureGraticuleLabelStep.min = String(texture.graticule.majorStep);
      textureGraticuleLabelStep.max = "180";
      textureGraticuleLabelStep.step = "5";
      textureGraticuleLabelStep.value = String(texture.graticule.labelStep);
    }
    updateTextureValueLabel(textureGraticuleLabelStepValue, `${Math.round(texture.graticule.labelStep)}${degreesLabel}`);
    if (textureGraticuleColor) textureGraticuleColor.value = texture.graticule.color;
    if (textureGraticuleLabelColor) textureGraticuleLabelColor.value = texture.graticule.labelColor;
    if (textureGraticuleLabelSize) textureGraticuleLabelSize.value = String(texture.graticule.labelSize);
    updateTextureValueLabel(textureGraticuleLabelSizeValue, `${Math.round(texture.graticule.labelSize)}px`);
    if (textureGraticuleMajorWidth) textureGraticuleMajorWidth.value = String(texture.graticule.majorWidth);
    updateTextureValueLabel(textureGraticuleMajorWidthValue, Number(texture.graticule.majorWidth).toFixed(2));
    if (textureGraticuleMinorWidth) textureGraticuleMinorWidth.value = String(texture.graticule.minorWidth);
    updateTextureValueLabel(textureGraticuleMinorWidthValue, Number(texture.graticule.minorWidth).toFixed(2));
    if (textureGraticuleMajorOpacity) textureGraticuleMajorOpacity.value = String(Math.round(texture.graticule.majorOpacity * 100));
    updateTextureValueLabel(textureGraticuleMajorOpacityValue, `${Math.round(texture.graticule.majorOpacity * 100)}%`);
    if (textureGraticuleMinorOpacity) textureGraticuleMinorOpacity.value = String(Math.round(texture.graticule.minorOpacity * 100));
    updateTextureValueLabel(textureGraticuleMinorOpacityValue, `${Math.round(texture.graticule.minorOpacity * 100)}%`);

    if (textureDraftMajorStep) textureDraftMajorStep.value = String(texture.draftGrid.majorStep);
    updateTextureValueLabel(textureDraftMajorStepValue, `${Math.round(texture.draftGrid.majorStep)}${degreesLabel}`);
    if (textureDraftMinorStep) {
      textureDraftMinorStep.max = String(texture.draftGrid.majorStep);
      textureDraftMinorStep.value = String(texture.draftGrid.minorStep);
    }
    updateTextureValueLabel(textureDraftMinorStepValue, `${Math.round(texture.draftGrid.minorStep)}${degreesLabel}`);
    if (textureDraftLonOffset) textureDraftLonOffset.value = String(Math.round(texture.draftGrid.lonOffset));
    updateTextureValueLabel(textureDraftLonOffsetValue, `${Math.round(texture.draftGrid.lonOffset)}${degreesLabel}`);
    if (textureDraftLatOffset) textureDraftLatOffset.value = String(Math.round(texture.draftGrid.latOffset));
    updateTextureValueLabel(textureDraftLatOffsetValue, `${Math.round(texture.draftGrid.latOffset)}${degreesLabel}`);
    if (textureDraftRoll) textureDraftRoll.value = String(Math.round(texture.draftGrid.roll));
    updateTextureValueLabel(textureDraftRollValue, `${Math.round(texture.draftGrid.roll)}${degreesLabel}`);
    if (textureDraftColor) textureDraftColor.value = texture.draftGrid.color;
    if (textureDraftWidth) textureDraftWidth.value = String(texture.draftGrid.width);
    updateTextureValueLabel(textureDraftWidthValue, Number(texture.draftGrid.width).toFixed(2));
    if (textureDraftMajorOpacity) textureDraftMajorOpacity.value = String(Math.round(texture.draftGrid.majorOpacity * 100));
    updateTextureValueLabel(textureDraftMajorOpacityValue, `${Math.round(texture.draftGrid.majorOpacity * 100)}%`);
    if (textureDraftMinorOpacity) textureDraftMinorOpacity.value = String(Math.round(texture.draftGrid.minorOpacity * 100));
    updateTextureValueLabel(textureDraftMinorOpacityValue, `${Math.round(texture.draftGrid.minorOpacity * 100)}%`);
    if (textureDraftDash) textureDraftDash.value = texture.draftGrid.dash;

    renderTextureModePanels(mode);
  };

  const renderDayNightUI = () => {
    const dayNight = syncDayNightConfig();
    if (dayNightEnabled) dayNightEnabled.checked = !!dayNight.enabled;
    if (dayNightManualTime) dayNightManualTime.value = String(dayNight.manualUtcMinutes);
    updateTextureValueLabel(dayNightManualTimeValue, formatUtcMinutes(dayNight.manualUtcMinutes));

    const utcNow = new Date();
    const currentUtcMinutes = (utcNow.getUTCHours() * 60) + utcNow.getUTCMinutes();
    if (dayNightCurrentTime) {
      dayNightCurrentTime.textContent = formatUtcMinutes(
        dayNight.mode === "utc" ? currentUtcMinutes : dayNight.manualUtcMinutes
      );
    }

    const modeButtons = [
      [dayNightModeManualBtn, "manual"],
      [dayNightModeUtcBtn, "utc"],
    ];
    modeButtons.forEach(([button, modeValue]) => {
      if (!button) return;
      const isActive = dayNight.mode === modeValue;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    if (dayNightManualControls) {
      dayNightManualControls.classList.toggle("hidden", dayNight.mode !== "manual");
    }
    if (dayNightUtcStatus) {
      dayNightUtcStatus.classList.toggle("hidden", dayNight.mode !== "utc");
    }

    if (dayNightCityLightsEnabled) dayNightCityLightsEnabled.checked = !!dayNight.cityLightsEnabled;
    if (dayNightCityLightsStyle) {
      dayNightCityLightsStyle.value = dayNight.cityLightsStyle;
      dayNightCityLightsStyle.disabled = !dayNight.cityLightsEnabled;
    }
    const modernLightsControlsEnabled = dayNight.cityLightsEnabled && dayNight.cityLightsStyle === "modern";
    const historicalLightsControlsEnabled =
      dayNight.cityLightsEnabled && dayNight.cityLightsStyle === "historical_1930s";
    if (dayNightCityLightsIntensity) {
      dayNightCityLightsIntensity.value = String(Math.round(dayNight.cityLightsIntensity * 100));
      dayNightCityLightsIntensity.disabled = !dayNight.cityLightsEnabled;
    }
    updateTextureValueLabel(
      dayNightCityLightsIntensityValue,
      `${Math.round(dayNight.cityLightsIntensity * 100)}%`
    );
    if (dayNightCityLightsTextureOpacity) {
      dayNightCityLightsTextureOpacity.value = String(Math.round(dayNight.cityLightsTextureOpacity * 100));
      dayNightCityLightsTextureOpacity.disabled = !modernLightsControlsEnabled;
    }
    updateTextureValueLabel(
      dayNightCityLightsTextureOpacityValue,
      `${Math.round(dayNight.cityLightsTextureOpacity * 100)}%`
    );
    if (dayNightCityLightsCorridorStrength) {
      dayNightCityLightsCorridorStrength.value = String(Math.round(dayNight.cityLightsCorridorStrength * 100));
      dayNightCityLightsCorridorStrength.disabled = !modernLightsControlsEnabled;
    }
    updateTextureValueLabel(
      dayNightCityLightsCorridorStrengthValue,
      `${Math.round(dayNight.cityLightsCorridorStrength * 100)}%`
    );
    if (dayNightCityLightsCoreSharpness) {
      dayNightCityLightsCoreSharpness.value = String(Math.round(dayNight.cityLightsCoreSharpness * 100));
      dayNightCityLightsCoreSharpness.disabled = !modernLightsControlsEnabled;
    }
    updateTextureValueLabel(
      dayNightCityLightsCoreSharpnessValue,
      `${Math.round(dayNight.cityLightsCoreSharpness * 100)}%`
    );
    if (dayNightCityLightsPopulationBoostEnabled) {
      dayNightCityLightsPopulationBoostEnabled.checked = !!dayNight.cityLightsPopulationBoostEnabled;
      dayNightCityLightsPopulationBoostEnabled.disabled = !modernLightsControlsEnabled;
    }
    const populationBoostControlsEnabled = modernLightsControlsEnabled && !!dayNight.cityLightsPopulationBoostEnabled;
    if (dayNightCityLightsPopulationBoostStrength) {
      dayNightCityLightsPopulationBoostStrength.value = String(
        Math.round(dayNight.cityLightsPopulationBoostStrength * 100)
      );
      dayNightCityLightsPopulationBoostStrength.disabled = !populationBoostControlsEnabled;
    }
    updateTextureValueLabel(
      dayNightCityLightsPopulationBoostStrengthValue,
      `${Math.round(dayNight.cityLightsPopulationBoostStrength * 100)}%`
    );
    if (dayNightHistoricalCityLightsDensity) {
      dayNightHistoricalCityLightsDensity.value = String(Math.round(dayNight.historicalCityLightsDensity * 100));
      dayNightHistoricalCityLightsDensity.disabled = !historicalLightsControlsEnabled;
    }
    updateTextureValueLabel(
      dayNightHistoricalCityLightsDensityValue,
      `${Math.round(dayNight.historicalCityLightsDensity * 100)}%`
    );
    if (dayNightHistoricalCityLightsSecondaryRetention) {
      dayNightHistoricalCityLightsSecondaryRetention.value = String(
        Math.round(dayNight.historicalCityLightsSecondaryRetention * 100)
      );
      dayNightHistoricalCityLightsSecondaryRetention.disabled = !historicalLightsControlsEnabled;
    }
    updateTextureValueLabel(
      dayNightHistoricalCityLightsSecondaryRetentionValue,
      `${Math.round(dayNight.historicalCityLightsSecondaryRetention * 100)}%`
    );

    if (dayNightShadowOpacity) {
      dayNightShadowOpacity.value = String(Math.round(dayNight.shadowOpacity * 100));
    }
    updateTextureValueLabel(dayNightShadowOpacityValue, `${Math.round(dayNight.shadowOpacity * 100)}%`);

    if (dayNightTwilightWidth) {
      dayNightTwilightWidth.value = String(Math.round(dayNight.twilightWidthDeg));
    }
    updateTextureValueLabel(dayNightTwilightWidthValue, `${Math.round(dayNight.twilightWidthDeg)}°`);
  };

  const updateTextureStyle = (mutate, { historyKind = "texture-style", commitHistory = false } = {}) => {
    beginTextureHistoryCapture();
    const texture = syncTextureConfig();
    if (typeof mutate === "function") mutate(texture);
    syncTextureConfig();
    renderTextureUI();
    renderDirty("texture-style");
    if (commitHistory) {
      commitTextureHistory(historyKind);
    }
  };

  const bindTextureRange = (element, handler) => {
    if (!element || element.dataset.bound === "true") return;
    element.addEventListener("input", (event) => {
      handler(event, false);
    });
    element.addEventListener("change", (event) => {
      handler(event, true);
    });
    element.dataset.bound = "true";
  };

  const bindTextureColorInput = (element, handler) => {
    if (!element || element.dataset.bound === "true") return;
    element.addEventListener("input", (event) => {
      handler(event, false);
    });
    element.addEventListener("change", (event) => {
      handler(event, true);
    });
    element.dataset.bound = "true";
  };

  const refreshActiveSovereignLabel = () => {
    const code = String(state.activeSovereignCode || "").trim().toUpperCase();
    if (activeSovereignLabel) {
      if (!code) {
        activeSovereignLabel.textContent = t("None selected", "ui");
      } else {
        const label = String(state.countryNames?.[code] || code).trim() || code;
        activeSovereignLabel.textContent = `${t(label, "geo") || label} (${code})`;
      }
    }
    refreshScenarioContextBar();
    refreshWorkspaceStatus();
    if (typeof state.renderPresetTreeFn === "function") {
      state.renderPresetTreeFn();
    }
  };
  state.updateActiveSovereignUIFn = refreshActiveSovereignLabel;
  const refreshDynamicBorderStatus = () => {
    if (dynamicBorderStatus) {
      if (!state.runtimePoliticalTopology?.objects?.political) {
        dynamicBorderStatus.textContent = t("Dynamic borders disabled", "ui");
      } else if (state.dynamicBordersDirty) {
        dynamicBorderStatus.textContent = t("Borders need recalculation", "ui");
      } else {
        dynamicBorderStatus.textContent = t("Borders up to date", "ui");
      }
    }
    if (recalculateBordersBtn) {
      recalculateBordersBtn.disabled = !state.dynamicBordersDirty;
    }
  };
  state.updateDynamicBorderStatusUIFn = refreshDynamicBorderStatus;
  state.updatePaintModeUIFn = () => {
    if (paintModeSelect) {
      paintModeSelect.value = state.paintMode || "visual";
    }
    const isOwnershipMode = String(state.paintMode || "visual") === "sovereignty";
    [paintModeVisualBtn, paintModePoliticalBtn].forEach((button) => {
      if (!button) return;
      const buttonMode = button.dataset.paintMode || "visual";
      const isActive = (buttonMode === "sovereignty") === isOwnershipMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    if (paintGranularitySelect) {
      paintGranularitySelect.value = state.interactionGranularity || "subdivision";
    }
    refreshPaintControlsLayout();
    refreshActiveSovereignLabel();
    refreshDynamicBorderStatus();
    refreshWorkspaceStatus();
    updateDockCollapsedUi();
  };
  const normalizeOceanPreset = (value) => {
    const candidate = String(value || "flat").trim().toLowerCase();
    if (candidate === "wave_hachure") {
      return "flat";
    }
    if (
      candidate === "flat" ||
      candidate === "bathymetry_soft" ||
      candidate === "bathymetry_contours"
    ) {
      return candidate;
    }
    return "flat";
  };
  const getOceanPresetHint = (preset) => {
    const normalizedPreset = normalizeOceanPreset(preset);
    if (normalizedPreset === "bathymetry_soft") {
      return t("Bathymetry Soft emphasizes depth bands while keeping contours subtle.", "ui");
    }
    if (normalizedPreset === "bathymetry_contours") {
      return t("Bathymetry Contours emphasizes contour lines while bands stay in the background.", "ui");
    }
    return t("Flat Blue keeps the ocean fill clean with no bathymetry overlay.", "ui");
  };
  const syncOceanPresetControlValues = () => {
    if (oceanStyleSelect) {
      oceanStyleSelect.value = state.styleConfig.ocean.preset || "flat";
    }
    if (oceanTextureOpacity) {
      oceanTextureOpacity.value = String(Math.round(clamp(state.styleConfig.ocean.opacity || 0.72, 0, 1) * 100));
    }
    if (oceanTextureOpacityValue) {
      oceanTextureOpacityValue.textContent = `${Math.round(clamp(state.styleConfig.ocean.opacity || 0.72, 0, 1) * 100)}%`;
    }
    if (oceanTextureScale) {
      oceanTextureScale.value = String(Math.round(clamp(state.styleConfig.ocean.scale || 1, 0.6, 2.4) * 100));
    }
    if (oceanTextureScaleValue) {
      oceanTextureScaleValue.textContent = `${clamp(state.styleConfig.ocean.scale || 1, 0.6, 2.4).toFixed(2)}x`;
    }
    if (oceanContourStrength) {
      oceanContourStrength.value = String(Math.round(clamp(state.styleConfig.ocean.contourStrength || 0.75, 0, 1) * 100));
    }
    if (oceanContourStrengthValue) {
      oceanContourStrengthValue.textContent = `${Math.round(clamp(state.styleConfig.ocean.contourStrength || 0.75, 0, 1) * 100)}%`;
    }
    if (oceanStylePresetHint) {
      oceanStylePresetHint.textContent = getOceanPresetHint(state.styleConfig.ocean.preset || "flat");
    }
  };
  const applyBathymetryPresetDefaults = (preset) => {
    const defaults = getBathymetryPresetStyleDefaults(preset);
    if (!defaults) return false;
    state.styleConfig.ocean.opacity = defaults.opacity;
    state.styleConfig.ocean.scale = defaults.scale;
    state.styleConfig.ocean.contourStrength = defaults.contourStrength;
    return true;
  };
  const normalizeOceanFillColor = (value) => {
    const candidate = String(value || "").trim();
    if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate;
    if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
      return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`;
    }
    return "#aadaff";
  };
  if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
    state.styleConfig.ocean = {};
  }
  state.styleConfig.ocean.preset = normalizeOceanPreset(state.styleConfig.ocean.preset || "flat");
  state.styleConfig.ocean.experimentalAdvancedStyles = state.styleConfig.ocean.experimentalAdvancedStyles === true;
  if (!state.styleConfig.ocean.experimentalAdvancedStyles && OCEAN_ADVANCED_PRESETS.has(state.styleConfig.ocean.preset)) {
    state.styleConfig.ocean.preset = "flat";
  }
  state.styleConfig.ocean.coastalAccentEnabled = state.styleConfig.ocean.coastalAccentEnabled !== false;
  state.styleConfig.ocean.fillColor = normalizeOceanFillColor(state.styleConfig.ocean.fillColor);
  state.styleConfig.ocean.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.opacity)) ? Number(state.styleConfig.ocean.opacity) : 0.72,
    0,
    1
  );
  state.styleConfig.ocean.scale = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.scale)) ? Number(state.styleConfig.ocean.scale) : 1,
    0.6,
    2.4
  );
  state.styleConfig.ocean.contourStrength = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.contourStrength))
      ? Number(state.styleConfig.ocean.contourStrength)
      : 0.75,
    0,
    1
  );
  state.styleConfig.ocean.shallowBandFadeEndZoom = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.shallowBandFadeEndZoom))
      ? Number(state.styleConfig.ocean.shallowBandFadeEndZoom)
      : 2.8,
    2.1,
    4.8
  );
  state.styleConfig.ocean.midBandFadeEndZoom = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.midBandFadeEndZoom))
      ? Number(state.styleConfig.ocean.midBandFadeEndZoom)
      : 3.4,
    2.7,
    5.2
  );
  state.styleConfig.ocean.deepBandFadeEndZoom = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.deepBandFadeEndZoom))
      ? Number(state.styleConfig.ocean.deepBandFadeEndZoom)
      : 4.2,
    3.3,
    6
  );
  state.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom))
      ? Number(state.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom)
      : 3.0,
    2.1,
    4.6
  );
  state.styleConfig.ocean.scenarioShallowContourFadeEndZoom = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.scenarioShallowContourFadeEndZoom))
      ? Number(state.styleConfig.ocean.scenarioShallowContourFadeEndZoom)
      : 3.4,
    2.5,
    5
  );
  state.styleConfig.lakes = normalizeLakeStyleConfig(state.styleConfig.lakes);
  if (!state.styleConfig.internalBorders || typeof state.styleConfig.internalBorders !== "object") {
    state.styleConfig.internalBorders = {};
  }
  state.styleConfig.internalBorders.color = normalizeOceanFillColor(state.styleConfig.internalBorders.color || "#cccccc");
  state.styleConfig.internalBorders.colorMode =
    String(state.styleConfig.internalBorders.colorMode || "auto").trim().toLowerCase() === "manual"
      ? "manual"
      : "auto";
  state.styleConfig.internalBorders.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.internalBorders.opacity))
      ? Number(state.styleConfig.internalBorders.opacity)
      : 1,
    0,
    1
  );
  state.styleConfig.internalBorders.width = clamp(
    Number.isFinite(Number(state.styleConfig.internalBorders.width))
      ? Number(state.styleConfig.internalBorders.width)
      : 0.5,
    0.01,
    2
  );
  if (!state.styleConfig.empireBorders || typeof state.styleConfig.empireBorders !== "object") {
    state.styleConfig.empireBorders = {};
  }
  state.styleConfig.empireBorders.color = normalizeOceanFillColor(state.styleConfig.empireBorders.color || "#666666");
  state.styleConfig.empireBorders.width = clamp(
    Number.isFinite(Number(state.styleConfig.empireBorders.width))
      ? Number(state.styleConfig.empireBorders.width)
      : 1,
    0.01,
    5
  );
  if (!state.styleConfig.coastlines || typeof state.styleConfig.coastlines !== "object") {
    state.styleConfig.coastlines = {};
  }
  state.styleConfig.coastlines.color = normalizeOceanFillColor(state.styleConfig.coastlines.color || "#333333");
  state.styleConfig.coastlines.width = clamp(
    Number.isFinite(Number(state.styleConfig.coastlines.width))
      ? Number(state.styleConfig.coastlines.width)
      : 1.2,
    0.5,
    3
  );
  if (!state.styleConfig.parentBorders || typeof state.styleConfig.parentBorders !== "object") {
    state.styleConfig.parentBorders = {};
  }
  state.styleConfig.parentBorders.color = String(
    state.styleConfig.parentBorders.color || "#4b5563"
  );
  state.styleConfig.parentBorders.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.parentBorders.opacity))
      ? Number(state.styleConfig.parentBorders.opacity)
      : 0.85,
    0,
    1
  );
  state.styleConfig.parentBorders.width = clamp(
    Number.isFinite(Number(state.styleConfig.parentBorders.width))
      ? Number(state.styleConfig.parentBorders.width)
      : 1.1,
    0.2,
    4
  );
  if (!state.parentBorderEnabledByCountry || typeof state.parentBorderEnabledByCountry !== "object") {
    state.parentBorderEnabledByCountry = {};
  }
  state.parentBordersVisible = state.parentBordersVisible !== false;
  syncUrbanConfig();

  state.styleConfig.physical = normalizePhysicalStyleConfig(state.styleConfig.physical);
  state.styleConfig.physical.contourColor = normalizeOceanFillColor(
    state.styleConfig.physical.contourColor || "#6b5947"
  );

  if (!state.styleConfig.rivers || typeof state.styleConfig.rivers !== "object") {
    state.styleConfig.rivers = {};
  }
  state.styleConfig.rivers.color = normalizeOceanFillColor(state.styleConfig.rivers.color || "#3b82f6");
  state.styleConfig.rivers.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.rivers.opacity)) ? Number(state.styleConfig.rivers.opacity) : 0.88,
    0,
    1
  );
  state.styleConfig.rivers.width = clamp(
    Number.isFinite(Number(state.styleConfig.rivers.width)) ? Number(state.styleConfig.rivers.width) : 0.5,
    0.2,
    4
  );
  state.styleConfig.rivers.outlineColor = normalizeOceanFillColor(
    state.styleConfig.rivers.outlineColor || "#e2efff"
  );
  state.styleConfig.rivers.outlineWidth = clamp(
    Number.isFinite(Number(state.styleConfig.rivers.outlineWidth))
      ? Number(state.styleConfig.rivers.outlineWidth)
      : 0.25,
    0,
    3
  );
  state.styleConfig.rivers.dashStyle = String(state.styleConfig.rivers.dashStyle || "solid");

  state.styleConfig.texture = normalizeTextureStyleConfig(state.styleConfig.texture);
  if (!state.referenceImageState || typeof state.referenceImageState !== "object") {
    state.referenceImageState = {};
  }
  state.referenceImageState.opacity = clamp(
    Number.isFinite(Number(state.referenceImageState.opacity)) ? Number(state.referenceImageState.opacity) : 0.6,
    0,
    1
  );
  state.referenceImageState.scale = clamp(
    Number.isFinite(Number(state.referenceImageState.scale)) ? Number(state.referenceImageState.scale) : 1,
    0.2,
    3
  );
  state.referenceImageState.offsetX = clamp(
    Number.isFinite(Number(state.referenceImageState.offsetX)) ? Number(state.referenceImageState.offsetX) : 0,
    -1000,
    1000
  );
  state.referenceImageState.offsetY = clamp(
    Number.isFinite(Number(state.referenceImageState.offsetY)) ? Number(state.referenceImageState.offsetY) : 0,
    -1000,
    1000
  );

  if (oceanFillColor) {
    oceanFillColor.value = state.styleConfig.ocean.fillColor;
    bindOceanVisualInput(oceanFillColor, (event, commitNow) => {
      state.styleConfig.ocean.fillColor = normalizeOceanFillColor(event.target.value);
      renderLakeUi();
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanBackgroundVisualState, "ocean-fill");
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanBackgroundVisualState, "ocean-fill");
    });
  }

  const renderLakeUi = () => {
    const lakeConfig = syncLakeConfig();
    const resolvedLakeColor = lakeConfig.linkedToOcean
      ? normalizeOceanFillColor(state.styleConfig.ocean.fillColor)
      : normalizeOceanFillColor(lakeConfig.fillColor || state.styleConfig.ocean.fillColor);
    if (lakeLinkToOcean) {
      lakeLinkToOcean.checked = lakeConfig.linkedToOcean;
    }
    if (lakeFillColor) {
      lakeFillColor.value = resolvedLakeColor;
      lakeFillColor.disabled = lakeConfig.linkedToOcean;
      lakeFillColor.title = lakeConfig.linkedToOcean
        ? t("Linked to the current ocean fill color.", "ui")
        : "";
    }
  };

  const oceanAdvancedStylesEnabled = () => state.styleConfig.ocean.experimentalAdvancedStyles === true;
  const isTno1962Scenario = () => String(state.activeScenarioId || "").trim().toLowerCase() === "tno_1962";

  const renderOceanAdvancedStylesUi = () => {
    const enabled = oceanAdvancedStylesEnabled();
    const selectDisabledTitle = t("Enable Experimental Bathymetry to unlock data-driven depth presets.", "ui");
    const sliderDisabledTitle = t("Available when Experimental Bathymetry is enabled.", "ui");
    if (!enabled && OCEAN_ADVANCED_PRESETS.has(state.styleConfig.ocean.preset)) {
      state.styleConfig.ocean.preset = "flat";
    }
    if (oceanAdvancedStylesToggle) {
      oceanAdvancedStylesToggle.checked = enabled;
    }
    if (oceanStyleSelect) {
      Array.from(oceanStyleSelect.options).forEach((option) => {
        if (OCEAN_ADVANCED_PRESETS.has(option.value)) {
          option.disabled = !enabled;
        }
      });
      oceanStyleSelect.value = state.styleConfig.ocean.preset || "flat";
      oceanStyleSelect.title = enabled ? "" : selectDisabledTitle;
    }
    [
      oceanTextureOpacity,
      oceanTextureScale,
      oceanContourStrength,
      oceanShallowFadeEndZoom,
      oceanMidFadeEndZoom,
      oceanDeepFadeEndZoom,
      oceanScenarioSyntheticContourFadeEndZoom,
      oceanScenarioShallowContourFadeEndZoom,
    ].forEach((control) => {
      if (!control) return;
      control.disabled = !enabled;
      control.title = enabled ? "" : sliderDisabledTitle;
    });
    if (oceanBathymetryDebugDetails) {
      oceanBathymetryDebugDetails.classList.toggle("opacity-60", !enabled);
    }
  };
  const renderOceanCoastalAccentUi = () => {
    const visible = isTno1962Scenario();
    if (oceanCoastalAccentRow) {
      oceanCoastalAccentRow.classList.toggle("hidden", !visible);
    }
    if (oceanCoastalAccentToggle) {
      oceanCoastalAccentToggle.checked = state.styleConfig.ocean.coastalAccentEnabled !== false;
      oceanCoastalAccentToggle.disabled = !visible;
      oceanCoastalAccentToggle.title = visible ? "" : t("Available only in the TNO 1962 scenario.", "ui");
    }
  };
  const renderOceanBathymetryDebugUi = () => {
    const syncZoomSlider = (input, valueEl, value, min, max) => {
      if (input) {
        input.value = String(Math.round(clamp(value, min, max) * 100));
      }
      if (valueEl) {
        valueEl.textContent = `${clamp(value, min, max).toFixed(2)}x`;
      }
    };
    syncZoomSlider(oceanShallowFadeEndZoom, oceanShallowFadeEndZoomValue, state.styleConfig.ocean.shallowBandFadeEndZoom || 2.8, 2.1, 4.8);
    syncZoomSlider(oceanMidFadeEndZoom, oceanMidFadeEndZoomValue, state.styleConfig.ocean.midBandFadeEndZoom || 3.4, 2.7, 5.2);
    syncZoomSlider(oceanDeepFadeEndZoom, oceanDeepFadeEndZoomValue, state.styleConfig.ocean.deepBandFadeEndZoom || 4.2, 3.3, 6);
    syncZoomSlider(
      oceanScenarioSyntheticContourFadeEndZoom,
      oceanScenarioSyntheticContourFadeEndZoomValue,
      state.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom || 3.0,
      2.1,
      4.6
    );
    syncZoomSlider(
      oceanScenarioShallowContourFadeEndZoom,
      oceanScenarioShallowContourFadeEndZoomValue,
      state.styleConfig.ocean.scenarioShallowContourFadeEndZoom || 3.4,
      2.5,
      5
    );
    if (oceanStylePresetHint) {
      oceanStylePresetHint.textContent = getOceanPresetHint(state.styleConfig.ocean.preset || "flat");
    }
    if (oceanBathymetrySourceValue) {
      const bathymetrySourceLabel = String(state.activeBathymetrySource || "").trim();
      oceanBathymetrySourceValue.textContent = bathymetrySourceLabel || t("None", "ui");
    }
    if (oceanBathymetryBandsValue) {
      oceanBathymetryBandsValue.textContent = String(state.activeBathymetryBandsData?.features?.length || 0);
    }
    if (oceanBathymetryContoursValue) {
      oceanBathymetryContoursValue.textContent = String(state.activeBathymetryContoursData?.features?.length || 0);
    }
  };
  renderLakeUi();
  renderOceanAdvancedStylesUi();
  renderOceanCoastalAccentUi();
  renderOceanBathymetryDebugUi();

  function renderRecentColors() {
    if (!recentContainer) return;
    recentContainer.replaceChildren();
    const visibleRecentColors = state.recentColors.slice(0, 10);
    dockRecentDivider?.classList.toggle("hidden", visibleRecentColors.length === 0);
    visibleRecentColors.forEach((color) => {
      const normalized = normalizeHexColor(color);
      if (!normalized) return;
      const btn = document.createElement("button");
      btn.className = "color-swatch";
      btn.type = "button";
      btn.dataset.color = normalized;
      btn.style.backgroundColor = normalized;
      btn.title = normalized;
      btn.setAttribute("aria-label", `${t("Recent", "ui")}: ${normalized}`);
      btn.addEventListener("click", () => {
        state.selectedColor = normalized;
        updateSwatchUI();
      });
      recentContainer.appendChild(btn);
    });
  }

  const paletteLibraryPanelController = createPaletteLibraryPanelController({
    themeSelect,
    paletteLibraryToggle,
    paletteLibraryPanel,
    paletteLibrarySources,
    paletteLibrarySearch,
    paletteLibrarySummary,
    paletteLibraryList,
    paletteLibraryToggleLabel,
    renderPalette,
    updateSwatchUI,
  });
  const {
    bindEvents: bindPaletteLibraryPanelEvents,
    handlePaletteSourceChange,
    handleResize: handlePaletteLibraryResize,
    renderPaletteLibrary,
    syncPaletteSourceControls,
    syncPanelVisibility: syncPaletteLibraryPanelVisibility,
  } = paletteLibraryPanelController;
  state.updatePaletteSourceUIFn = syncPaletteSourceControls;
  state.renderPaletteFn = renderPalette;

  function applyAutoFillOceanColor() {
    const oceanMeta = state.activePaletteOceanMeta || state.activePalettePack?.ocean || null;
    const nextFillColor = normalizeOceanFillColor(
      oceanMeta?.apply_on_autofill ? oceanMeta?.fill_color : "#aadaff"
    );
    if (oceanFillColor) {
      oceanFillColor.value = nextFillColor;
    }
    return nextFillColor;
  }
  state.updateRecentUI = () => {
    renderRecentColors();
    renderPalette(state.currentPaletteTheme);
    renderPaletteLibrary();
  };
  state.updatePaletteLibraryUIFn = renderPaletteLibrary;

  function normalizeParentBorderEnabledMap() {
    const supported = Array.isArray(state.parentBorderSupportedCountries)
      ? state.parentBorderSupportedCountries
      : [];
    const prev = state.parentBorderEnabledByCountry && typeof state.parentBorderEnabledByCountry === "object"
      ? state.parentBorderEnabledByCountry
      : {};
    const next = {};
    supported.forEach((countryCode) => {
      next[countryCode] = !!prev[countryCode];
    });
    state.parentBorderEnabledByCountry = next;
  }

  function syncParentBorderVisibilityUI() {
    const enabled = state.parentBordersVisible !== false;
    if (parentBordersVisible) {
      parentBordersVisible.checked = enabled;
    }
    if (parentBorderColor) parentBorderColor.disabled = !enabled;
    if (parentBorderOpacity) parentBorderOpacity.disabled = !enabled;
    if (parentBorderWidth) parentBorderWidth.disabled = !enabled;
    if (parentBorderEnableAll) parentBorderEnableAll.disabled = !enabled;
    if (parentBorderDisableAll) parentBorderDisableAll.disabled = !enabled;
    if (parentBorderCountryList) {
      parentBorderCountryList.classList.toggle("opacity-60", !enabled);
      parentBorderCountryList.classList.toggle("pointer-events-none", !enabled);
    }
  }

  function renderParentBorderCountryList() {
    if (!parentBorderCountryList) return;
    normalizeParentBorderEnabledMap();
    syncParentBorderVisibilityUI();
    const supported = Array.isArray(state.parentBorderSupportedCountries)
      ? [...state.parentBorderSupportedCountries]
      : [];

    parentBorderCountryList.replaceChildren();
    if (!supported.length) {
      if (parentBorderEmpty) {
        parentBorderEmpty.classList.remove("hidden");
      }
      return;
    }
    if (parentBorderEmpty) {
      parentBorderEmpty.classList.add("hidden");
    }

    const entries = supported
      .map((code) => {
        const rawName = state.countryNames?.[code] || code;
        return {
          code,
          displayName: t(rawName, "geo"),
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    entries.forEach(({ code, displayName }) => {
      const label = document.createElement("label");
      label.className = "toggle-label parent-border-country-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "checkbox-input";
      checkbox.checked = !!state.parentBorderEnabledByCountry?.[code];
      checkbox.disabled = state.parentBordersVisible === false;
      checkbox.addEventListener("change", (event) => {
        state.parentBorderEnabledByCountry[code] = !!event.target.checked;
        renderDirty("parent-border-country");
      });

      const text = document.createElement("span");
      text.textContent = `${displayName} (${code})`;

      label.appendChild(checkbox);
      label.appendChild(text);
      parentBorderCountryList.appendChild(label);
    });
  }
  state.updateParentBorderCountryListFn = renderParentBorderCountryList;

  function renderSpecialZoneEditorUI() {
    if (toggleWaterRegions) toggleWaterRegions.checked = !!state.showWaterRegions;
    if (toggleOpenOceanRegions) toggleOpenOceanRegions.checked = !!state.showOpenOceanRegions;
    if (toggleCityPoints) toggleCityPoints.checked = !!state.showCityPoints;
    if (toggleUrban) toggleUrban.checked = !!state.showUrban;
    if (togglePhysical) togglePhysical.checked = !!state.showPhysical;
    if (toggleRivers) toggleRivers.checked = !!state.showRivers;
    if (toggleAirports) toggleAirports.checked = !!state.showAirports;
    if (togglePorts) togglePorts.checked = !!state.showPorts;
    if (toggleSpecialZones) toggleSpecialZones.checked = !!state.showSpecialZones;

    const cityPointsConfig = syncCityPointsConfig();
    ensureCityPointsThemeOptions();
    if (cityPointsTheme) {
      cityPointsTheme.value = String(cityPointsConfig.theme || "classic_graphite");
    }
    if (cityPointsThemeHint) {
      cityPointsThemeHint.textContent = getCityPointsThemeHint(cityPointsConfig.theme || "classic_graphite");
    }
    if (cityPointsMarkerScale) {
      cityPointsMarkerScale.value = Number(cityPointsConfig.markerScale || 1).toFixed(2);
    }
    if (cityPointsMarkerScaleValue) {
      cityPointsMarkerScaleValue.textContent = `${Number(cityPointsConfig.markerScale || 1).toFixed(2)}x`;
    }
    if (cityPointsMarkerDensity) {
      cityPointsMarkerDensity.value = Number(cityPointsConfig.markerDensity || 1).toFixed(2);
    }
    if (cityPointsMarkerDensityValue) {
      cityPointsMarkerDensityValue.textContent = formatCityPointsDensityValue(cityPointsConfig.markerDensity || 1);
    }
    if (cityPointsMarkerDensityHint) {
      cityPointsMarkerDensityHint.textContent = state.currentLanguage === "zh"
        ? "控制每个缩放阶段最多允许出现多少个城市点。"
        : "Controls how many city markers can surface at each zoom stage.";
    }
    if (cityPointsLabelDensity) {
      cityPointsLabelDensity.value = String(cityPointsConfig.labelDensity || "balanced");
    }
    if (cityPointsLabelDensityHint) {
      cityPointsLabelDensityHint.textContent = getCityPointsLabelDensityHint(cityPointsConfig.labelDensity || "balanced");
    }
    if (cityPointsColor) cityPointsColor.value = normalizeOceanFillColor(cityPointsConfig.color || "#2f343a");
    if (cityPointsCapitalColor) {
      cityPointsCapitalColor.value = normalizeOceanFillColor(cityPointsConfig.capitalColor || "#9f9072");
    }
    if (cityPointsOpacity) {
      cityPointsOpacity.value = String(Math.round(cityPointsConfig.opacity * 100));
    }
    if (cityPointsOpacityValue) {
      cityPointsOpacityValue.textContent = `${Math.round(cityPointsConfig.opacity * 100)}%`;
    }
    if (cityPointLabelsEnabled) {
      cityPointLabelsEnabled.checked = !!cityPointsConfig.showLabels;
    }
    if (cityPointsLabelSize) {
      cityPointsLabelSize.value = String(Math.round(cityPointsConfig.labelSize));
    }
    if (cityPointsLabelSizeValue) {
      cityPointsLabelSizeValue.textContent = `${Math.round(cityPointsConfig.labelSize)}px`;
    }
    if (cityCapitalOverlayEnabled) {
      cityCapitalOverlayEnabled.checked = !!cityPointsConfig.showCapitalOverlay;
    }

    syncUrbanControls();

    state.styleConfig.physical = normalizePhysicalStyleConfig(state.styleConfig.physical);
    const activePhysicalPreset = normalizePhysicalPreset(state.styleConfig.physical.preset || "balanced");
    if (physicalPreset) physicalPreset.value = activePhysicalPreset;
    if (physicalPresetHint) {
      physicalPresetHint.textContent = getPhysicalPresetHint(activePhysicalPreset);
    }
    if (physicalMode) physicalMode.value = state.styleConfig.physical.mode;
    if (physicalOpacity) physicalOpacity.value = String(Math.round(state.styleConfig.physical.opacity * 100));
    if (physicalOpacityValue) {
      physicalOpacityValue.textContent = `${Math.round(state.styleConfig.physical.opacity * 100)}%`;
    }
    if (physicalAtlasIntensity) {
      physicalAtlasIntensity.value = String(Math.round(state.styleConfig.physical.atlasIntensity * 100));
    }
    if (physicalAtlasIntensityValue) {
      physicalAtlasIntensityValue.textContent = `${Math.round(state.styleConfig.physical.atlasIntensity * 100)}%`;
    }
    if (physicalRainforestEmphasis) {
      physicalRainforestEmphasis.value = String(Math.round(state.styleConfig.physical.rainforestEmphasis * 100));
    }
    if (physicalRainforestEmphasisValue) {
      physicalRainforestEmphasisValue.textContent = `${Math.round(state.styleConfig.physical.rainforestEmphasis * 100)}%`;
    }
    if (physicalContourColor) physicalContourColor.value = state.styleConfig.physical.contourColor;
    if (physicalContourOpacity) {
      physicalContourOpacity.value = String(Math.round(state.styleConfig.physical.contourOpacity * 100));
    }
    if (physicalContourOpacityValue) {
      physicalContourOpacityValue.textContent = `${Math.round(state.styleConfig.physical.contourOpacity * 100)}%`;
    }
    if (physicalMinorContours) physicalMinorContours.checked = !!state.styleConfig.physical.contourMinorVisible;
    if (physicalContourMajorWidth) {
      physicalContourMajorWidth.value = String(Number(state.styleConfig.physical.contourMajorWidth).toFixed(2));
    }
    if (physicalContourMajorWidthValue) {
      physicalContourMajorWidthValue.textContent = Number(state.styleConfig.physical.contourMajorWidth).toFixed(2);
    }
    if (physicalContourMinorWidth) {
      physicalContourMinorWidth.value = String(Number(state.styleConfig.physical.contourMinorWidth).toFixed(2));
    }
    if (physicalContourMinorWidthValue) {
      physicalContourMinorWidthValue.textContent = Number(state.styleConfig.physical.contourMinorWidth).toFixed(2);
    }
    if (physicalContourMajorInterval) {
      physicalContourMajorInterval.value = String(Math.round(state.styleConfig.physical.contourMajorIntervalM));
    }
    if (physicalContourMajorIntervalValue) {
      physicalContourMajorIntervalValue.textContent = `${Math.round(state.styleConfig.physical.contourMajorIntervalM)}`;
    }
    if (physicalContourMinorInterval) {
      physicalContourMinorInterval.value = String(Math.round(state.styleConfig.physical.contourMinorIntervalM));
    }
    if (physicalContourMinorIntervalValue) {
      physicalContourMinorIntervalValue.textContent = `${Math.round(state.styleConfig.physical.contourMinorIntervalM)}`;
    }
    if (physicalContourMajorLowReliefCutoff) {
      physicalContourMajorLowReliefCutoff.value = String(Math.round(state.styleConfig.physical.contourMajorLowReliefCutoffM));
    }
    if (physicalContourMajorLowReliefCutoffValue) {
      physicalContourMajorLowReliefCutoffValue.textContent = `${Math.round(state.styleConfig.physical.contourMajorLowReliefCutoffM)}`;
    }
    if (physicalContourMinorLowReliefCutoff) {
      physicalContourMinorLowReliefCutoff.value = String(Math.round(state.styleConfig.physical.contourMinorLowReliefCutoffM));
    }
    if (physicalContourMinorLowReliefCutoffValue) {
      physicalContourMinorLowReliefCutoffValue.textContent = `${Math.round(state.styleConfig.physical.contourMinorLowReliefCutoffM)}`;
    }
    if (physicalBlendMode) physicalBlendMode.value = state.styleConfig.physical.blendMode;
    Object.entries(physicalClassToggleMap).forEach(([key, element]) => {
      if (element) element.checked = state.styleConfig.physical.atlasClassVisibility?.[key] !== false;
    });

    if (riversColor) riversColor.value = state.styleConfig.rivers.color;
    if (riversOpacity) riversOpacity.value = String(Math.round(state.styleConfig.rivers.opacity * 100));
    if (riversOpacityValue) riversOpacityValue.textContent = `${Math.round(state.styleConfig.rivers.opacity * 100)}%`;
    if (riversWidth) riversWidth.value = String(Number(state.styleConfig.rivers.width).toFixed(2));
    if (riversWidthValue) riversWidthValue.textContent = Number(state.styleConfig.rivers.width).toFixed(2);
    if (riversOutlineColor) riversOutlineColor.value = state.styleConfig.rivers.outlineColor;
    if (riversOutlineWidth) {
      riversOutlineWidth.value = String(Number(state.styleConfig.rivers.outlineWidth).toFixed(2));
    }
    if (riversOutlineWidthValue) {
      riversOutlineWidthValue.textContent = Number(state.styleConfig.rivers.outlineWidth).toFixed(2);
    }
    if (riversDashStyle) riversDashStyle.value = state.styleConfig.rivers.dashStyle;

    specialZoneEditorController.renderSpecialZoneEditorUI();
    updateToolUI();
  }
  state.updateSpecialZoneEditorUIFn = renderSpecialZoneEditorUI;

  function updateSwatchUI() {
    const swatches = document.querySelectorAll(".color-swatch");
    swatches.forEach((swatch) => {
      if (swatch.dataset.color === state.selectedColor) {
        swatch.classList.add("is-selected");
      } else {
        swatch.classList.remove("is-selected");
      }
    });
    const libraryRows = document.querySelectorAll(".palette-library-row");
    libraryRows.forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.color === state.selectedColor);
    });
    if (document.getElementById("customColor")) {
      customColor.value = state.selectedColor;
    }
    if (selectedColorPreview) {
      selectedColorPreview.style.backgroundColor = state.selectedColor;
      selectedColorPreview.setAttribute("aria-label", `${t("Selected color", "ui")}: ${state.selectedColor}`);
    }
    if (selectedColorValue) {
      selectedColorValue.textContent = String(state.selectedColor || "").toUpperCase();
    }
  }
  state.updateSwatchUIFn = updateSwatchUI;

  function updateToolUI() {
    toolButtons.forEach((button) => {
      const isActive = button.dataset.tool === state.currentTool;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    const disableBrush = state.currentTool === "eyedropper" || !!state.specialZoneEditor?.active;
    if (disableBrush) {
      state.brushModeEnabled = false;
      state.brushPanModifierActive = false;
    }
    if (brushModeBtn) {
      brushModeBtn.disabled = disableBrush;
      brushModeBtn.classList.toggle("is-active", !!state.brushModeEnabled && !disableBrush);
      brushModeBtn.setAttribute("aria-pressed", String(!!state.brushModeEnabled && !disableBrush));
    }
    setToolCursorClass();
    updateDirtyIndicator();
  }
  state.updateToolUIFn = updateToolUI;

  const specialZoneEditorController = createSpecialZoneEditorController({
    state,
    specialZonesDisputedFill,
    specialZonesDisputedStroke,
    specialZonesWastelandFill,
    specialZonesWastelandStroke,
    specialZonesCustomFill,
    specialZonesCustomStroke,
    specialZonesOpacity,
    specialZonesStrokeWidth,
    specialZonesDashStyle,
    specialZoneTypeSelect,
    specialZoneLabelInput,
    specialZoneStartBtn,
    specialZoneUndoBtn,
    specialZoneFinishBtn,
    specialZoneCancelBtn,
    specialZoneFeatureList,
    specialZoneDeleteBtn,
    specialZoneEditorHint,
    specialZonesOpacityValue,
    specialZonesStrokeWidthValue,
    normalizeOceanFillColor,
    clamp,
    markDirty,
    dismissOnboardingHint,
    updateToolUI,
    renderTransportAppearanceUi,
    render,
    startSpecialZoneDraw,
    undoSpecialZoneVertex,
    finishSpecialZoneDraw,
    cancelSpecialZoneDraw,
    deleteSelectedManualSpecialZone,
    selectSpecialZoneById,
    showAppDialog,
    showToast,
    t,
  });
  specialZoneEditorController.normalizeSpecialZoneEditorState();
  exportWorkbenchController = createExportWorkbenchController({
    state,
    t,
    showToast,
    showExportFailureToast,
    normalizeExportWorkbenchUiState,
    renderPassNames: RENDER_PASS_NAMES,
    exportBtn,
    exportTarget,
    exportFormat,
    exportScale,
    exportWorkbenchLayerList,
    exportWorkbenchTextElementList,
    exportWorkbenchOverlay,
    exportWorkbenchPreviewStage,
    exportWorkbenchPreviewState,
    exportWorkbenchPreviewModeButtons,
    exportWorkbenchPreviewLayerSelect,
    exportWorkbenchBrightness,
    exportWorkbenchContrast,
    exportWorkbenchSaturation,
    exportWorkbenchClarity,
    exportWorkbenchBrightnessValue,
    exportWorkbenchContrastValue,
    exportWorkbenchSaturationValue,
    exportWorkbenchClarityValue,
    exportWorkbenchBakeVisibleBtn,
    exportWorkbenchClearBakeBtn,
    exportWorkbenchBakeArtifactList,
    exportWorkbenchCloseBtn,
    dockExportBtn,
    exportSectionSummaryTarget,
    exportSectionSummaryFormat,
    exportSectionSummaryScale,
    onRequestClose: ({ restoreFocus = true } = {}) => {
      state.closeExportWorkbenchFn?.({ restoreFocus });
    },
    buildCompositeSourceCanvas: (...args) => buildCompositeSourceCanvas(...args),
    buildSingleExportSourceCanvas: (...args) => buildSingleExportSourceCanvas(...args),
    applyExportAdjustmentsToCanvas: (...args) => applyExportAdjustmentsToCanvas(...args),
    buildPerLayerExportOutputs: (...args) => buildPerLayerExportOutputs(...args),
    buildBakePackOutputs: (...args) => buildBakePackOutputs(...args),
    buildCompositeExportCanvas: (...args) => buildCompositeExportCanvas(...args),
    getSelectedExportScale: (...args) => getSelectedExportScale(...args),
    triggerCanvasDownload: (...args) => triggerCanvasDownload(...args),
    triggerBlobDownload: (...args) => triggerBlobDownload(...args),
    bakeLayer: (...args) => bakeLayer(...args),
    exportMaxConcurrentJobs: EXPORT_MAX_CONCURRENT_JOBS,
  });

  function updateHistoryUi() {
    if (undoBtn) undoBtn.disabled = !canUndoHistory();
    if (redoBtn) redoBtn.disabled = !canRedoHistory();
  }
  state.updateHistoryUIFn = updateHistoryUi;

  function updateZoomUi() {
    const text = getZoomPercent();
    if (zoomPercentInput && zoomPercentInput.dataset.editing !== "true") {
      zoomPercentInput.value = text;
    }
    zoomPercentInput?.removeAttribute("aria-invalid");
    if (zoomPercentInput) {
      zoomPercentInput.dataset.zoomError = "";
      zoomPercentInput.setCustomValidity("");
    }
  }
  state.updateZoomUIFn = updateZoomUi;

  function parseZoomInputValue(rawValue) {
    const normalized = String(rawValue || "").trim().replace(/%/g, "");
    if (!normalized) return null;
    const percent = Number(normalized);
    if (!Number.isFinite(percent)) return null;
    return percent;
  }

  function commitZoomInputValue({ announceInvalid = true } = {}) {
    if (!zoomPercentInput) return;
    const parsed = parseZoomInputValue(zoomPercentInput.value);
    zoomPercentInput.dataset.editing = "false";
    if (parsed === null || parsed < 35 || parsed > 5000) {
      const zoomErrorMessage = t("Zoom percentage must be between 35% and 5000%.", "ui");
      zoomPercentInput.setAttribute("aria-invalid", "true");
      zoomPercentInput.dataset.zoomError = "true";
      zoomPercentInput.setCustomValidity(zoomErrorMessage);
      if (announceInvalid) {
        emitTransientFeedback(zoomErrorMessage, {
          tone: "warning",
          toast: true,
          title: t("Invalid zoom", "ui"),
          duration: 2400,
        });
      }
      updateZoomUi();
      return;
    }
    zoomPercentInput.removeAttribute("aria-invalid");
    zoomPercentInput.dataset.zoomError = "";
    zoomPercentInput.setCustomValidity("");
    setZoomPercent(clamp(parsed, 35, 5000));
    updateZoomUi();
  }

  const runToolSelection = (tool, { dismissHint = true, feedbackLabel = "" } = {}) => {
    const nextTool = tool || "fill";
    state.currentTool = nextTool;
    if (nextTool === "eyedropper") {
      state.brushModeEnabled = false;
      state.brushPanModifierActive = false;
    }
    updateToolUI();
    if (dismissHint) {
      dismissOnboardingHint();
    }
    emitTransientFeedback(feedbackLabel || getToolFeedbackLabel(nextTool));
  };

  const runBrushModeToggle = (nextValue = !state.brushModeEnabled, { dismissHint = true } = {}) => {
    state.brushModeEnabled = !!nextValue;
    if (state.brushModeEnabled && state.currentTool === "eyedropper") {
      state.currentTool = "fill";
    }
    updateToolUI();
    if (dismissHint) {
      dismissOnboardingHint();
    }
    emitTransientFeedback(t(
      state.brushModeEnabled ? "Brush On · Shift+Drag to pan" : "Brush Off",
      "ui"
    ));
  };

  const runHistoryAction = (kind) => {
    if (kind === "redo") {
      redoHistory();
      emitTransientFeedback(t("Redo", "ui"), { duration: 900 });
      return;
    }
    undoHistory();
    emitTransientFeedback(t("Undo", "ui"), { duration: 900 });
  };

  const runZoomStep = (delta) => {
    dismissOnboardingHint();
    zoomByStep(delta);
  };

  const runZoomReset = () => {
    dismissOnboardingHint();
    resetZoomToFit();
  };

  state.runToolSelectionFn = runToolSelection;
  state.runBrushModeToggleFn = runBrushModeToggle;
  state.runHistoryActionFn = runHistoryAction;
  state.runZoomStepFn = runZoomStep;
  state.runZoomResetFn = runZoomReset;
  state.commitZoomInputValueFn = commitZoomInputValue;

  state.updateToolbarInputsFn = () => {
    const internalAutoColorEnabled = String(state.styleConfig.internalBorders.colorMode || "auto") !== "manual";
    if (internalBorderAutoColor) {
      internalBorderAutoColor.checked = internalAutoColorEnabled;
    }
    if (internalBorderColor) {
      internalBorderColor.value = state.styleConfig.internalBorders.color;
      internalBorderColor.disabled = internalAutoColorEnabled;
    }
    if (internalBorderOpacity) {
      internalBorderOpacity.value = String(Math.round(state.styleConfig.internalBorders.opacity * 100));
    }
    if (internalBorderOpacityValue) {
      internalBorderOpacityValue.textContent = `${Math.round(state.styleConfig.internalBorders.opacity * 100)}%`;
    }
    if (internalBorderWidth) {
      internalBorderWidth.value = String(Number(state.styleConfig.internalBorders.width).toFixed(2));
    }
    if (internalBorderWidthValue) {
      internalBorderWidthValue.textContent = Number(state.styleConfig.internalBorders.width).toFixed(2);
    }
    if (empireBorderColor) {
      empireBorderColor.value = state.styleConfig.empireBorders.color;
    }
    if (empireBorderWidth) {
      empireBorderWidth.value = String(Number(state.styleConfig.empireBorders.width).toFixed(2));
    }
    if (empireBorderWidthValue) {
      empireBorderWidthValue.textContent = Number(state.styleConfig.empireBorders.width).toFixed(2);
    }
    if (coastlineColor) {
      coastlineColor.value = state.styleConfig.coastlines.color;
    }
    if (coastlineWidth) {
      coastlineWidth.value = String(Number(state.styleConfig.coastlines.width).toFixed(1));
    }
    if (coastlineWidthValue) {
      coastlineWidthValue.textContent = Number(state.styleConfig.coastlines.width).toFixed(1);
    }
    syncParentBorderVisibilityUI();
    if (oceanFillColor) {
      oceanFillColor.value = normalizeOceanFillColor(state.styleConfig.ocean.fillColor);
    }
    if (oceanStyleSelect) {
      oceanStyleSelect.value = state.styleConfig.ocean.preset || "flat";
    }
    syncOceanPresetControlValues();
    renderOceanAdvancedStylesUi();
    renderOceanCoastalAccentUi();
    renderOceanBathymetryDebugUi();
    renderLakeUi();
    if (colorModeSelect) {
      colorModeSelect.value = state.colorMode || "political";
    }
    if (themeSelect) {
      themeSelect.value = String(state.activePaletteId || themeSelect.value || "");
    }
    if (referenceOpacity) {
      referenceOpacity.value = String(Math.round(state.referenceImageState.opacity * 100));
    }
    if (referenceOpacityValue) {
      referenceOpacityValue.textContent = `${Math.round(state.referenceImageState.opacity * 100)}%`;
    }
    if (referenceScale) {
      referenceScale.value = String(Number(state.referenceImageState.scale).toFixed(2));
    }
    if (referenceScaleValue) {
      referenceScaleValue.textContent = `${Number(state.referenceImageState.scale).toFixed(2)}x`;
    }
    if (referenceOffsetX) {
      referenceOffsetX.value = String(Math.round(state.referenceImageState.offsetX));
    }
    if (referenceOffsetXValue) {
      referenceOffsetXValue.textContent = `${Math.round(state.referenceImageState.offsetX)}px`;
    }
    if (referenceOffsetY) {
      referenceOffsetY.value = String(Math.round(state.referenceImageState.offsetY));
    }
    if (referenceOffsetYValue) {
      referenceOffsetYValue.textContent = `${Math.round(state.referenceImageState.offsetY)}px`;
    }
    if (referenceImage) {
      referenceImage.style.opacity = String(state.referenceImageState.opacity);
      referenceImage.style.transform =
        `translate(${state.referenceImageState.offsetX}px, ${state.referenceImageState.offsetY}px) `
        + `scale(${state.referenceImageState.scale})`;
    }
    syncExportWorkbenchControlsFromState();
    renderTextureUI();
    renderDayNightUI();
    renderSpecialZoneEditorUI();
  };
  state.updateTextureUIFn = renderTextureUI;

  if (customColor) {
    customColor.addEventListener("input", (event) => {
      state.selectedColor = event.target.value;
      updateSwatchUI();
    });
  }

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      runToolSelection(button.dataset.tool || "fill");
    });
  });

  if (brushModeBtn && !brushModeBtn.dataset.bound) {
    brushModeBtn.addEventListener("click", () => {
      if (brushModeBtn.disabled) return;
      runBrushModeToggle();
    });
    brushModeBtn.dataset.bound = "true";
  }

  if (selectedColorPreview && customColor && !selectedColorPreview.dataset.bound) {
    selectedColorPreview.addEventListener("click", () => {
      customColor.click();
    });
    selectedColorPreview.dataset.bound = "true";
  }

  if (undoBtn && !undoBtn.dataset.bound) {
    undoBtn.addEventListener("click", () => {
      runHistoryAction("undo");
    });
    undoBtn.dataset.bound = "true";
  }

  if (redoBtn && !redoBtn.dataset.bound) {
    redoBtn.addEventListener("click", () => {
      runHistoryAction("redo");
    });
    redoBtn.dataset.bound = "true";
  }

  if (zoomInBtn && !zoomInBtn.dataset.bound) {
    zoomInBtn.addEventListener("click", () => {
      runZoomStep(1);
    });
    zoomInBtn.dataset.bound = "true";
  }

  if (zoomOutBtn && !zoomOutBtn.dataset.bound) {
    zoomOutBtn.addEventListener("click", () => {
      runZoomStep(-1);
    });
    zoomOutBtn.dataset.bound = "true";
  }

  if (zoomResetBtn && !zoomResetBtn.dataset.bound) {
    zoomResetBtn.addEventListener("click", () => {
      runZoomReset();
    });
    zoomResetBtn.dataset.bound = "true";
  }

  if (zoomPercentInput && !zoomPercentInput.dataset.bound) {
    zoomPercentInput.addEventListener("focus", () => {
      zoomPercentInput.dataset.editing = "true";
      zoomPercentInput.select();
    });
    zoomPercentInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        dismissOnboardingHint();
        commitZoomInputValue();
        zoomPercentInput.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        zoomPercentInput.dataset.editing = "false";
        updateZoomUi();
        zoomPercentInput.blur();
      }
    });
    zoomPercentInput.addEventListener("blur", () => {
      commitZoomInputValue();
    });
    zoomPercentInput.dataset.bound = "true";
  }

  if (leftPanelToggle && !leftPanelToggle.dataset.bound) {
    leftPanelToggle.addEventListener("click", () => {
      toggleLeftPanel();
    });
    leftPanelToggle.dataset.bound = "true";
  }

  if (rightPanelToggle && !rightPanelToggle.dataset.bound) {
    rightPanelToggle.addEventListener("click", () => {
      toggleRightPanel();
    });
    rightPanelToggle.dataset.bound = "true";
  }

  bindTransportWorkbenchEvents();

  if (toggleLang && !toggleLang.dataset.bound) {
    toggleLang.addEventListener("click", toggleLanguage);
    toggleLang.dataset.bound = "true";
  }

  if (developerModeBtn && !developerModeBtn.dataset.bound) {
    developerModeBtn.addEventListener("click", () => {
      state.toggleDeveloperModeFn?.();
    });
    developerModeBtn.dataset.bound = "true";
  }

  [paintModeVisualBtn, paintModePoliticalBtn].forEach((button) => {
    if (!button || button.dataset.bound === "true") return;
    button.addEventListener("click", () => {
      const nextMode = button.dataset.paintMode || "visual";
      if (paintModeSelect) {
        paintModeSelect.value = nextMode;
      }
      state.paintMode = nextMode;
      state.ui.politicalEditingExpanded = nextMode === "sovereignty";
      markDirty?.("paint-mode");
      if (typeof state.updatePaintModeUIFn === "function") {
        state.updatePaintModeUIFn();
      }
      if (typeof render === "function") {
        render();
      }
    });
    button.dataset.bound = "true";
  });

  if (dockReferenceBtn && !dockReferenceBtn.dataset.bound) {
    dockReferenceBtn.setAttribute("aria-haspopup", "dialog");
    dockReferenceBtn.setAttribute("aria-controls", "dockReferencePopover");
    dockReferenceBtn.addEventListener("click", () => {
      openDockPopover("reference");
    });
    dockReferenceBtn.dataset.bound = "true";
  }

  if (dockExportBtn && !dockExportBtn.dataset.bound) {
    dockExportBtn.setAttribute("aria-haspopup", "dialog");
    dockExportBtn.setAttribute("aria-controls", "exportWorkbenchOverlay");
    dockExportBtn.addEventListener("click", () => {
      const isOpen = !!(exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden"));
      if (isOpen) {
        state.closeExportWorkbenchFn?.({ restoreFocus: true });
      } else {
        state.openExportWorkbenchFn?.(dockExportBtn);
      }
    });
    dockExportBtn.dataset.bound = "true";
  }
  exportWorkbenchController.bindExportWorkbenchEvents();

  if (dockCollapseBtn && !dockCollapseBtn.dataset.bound) {
    dockCollapseBtn.addEventListener("click", () => {
      toggleDock();
    });
    dockCollapseBtn.dataset.bound = "true";
  }

  if (dockEditPopoverBtn && !dockEditPopoverBtn.dataset.bound) {
    dockEditPopoverBtn.setAttribute("aria-haspopup", "dialog");
    dockEditPopoverBtn.setAttribute("aria-controls", "dockEditPopover");
    dockEditPopoverBtn.addEventListener("click", () => {
      openDockPopover("edit");
    });
    dockEditPopoverBtn.dataset.bound = "true";
  }

  if (dockQuickFillBtn && !dockQuickFillBtn.dataset.bound) {
    dockQuickFillBtn.setAttribute("aria-haspopup", "dialog");
    dockQuickFillBtn.setAttribute("aria-controls", "dockQuickFillRow");
    dockQuickFillBtn.addEventListener("click", () => {
      if (dockQuickFillBtn.classList.contains("hidden")) return;
      openDockPopover("quickfill");
    });
    dockQuickFillBtn.dataset.bound = "true";
  }

  if (politicalEditingToggleBtn && !politicalEditingToggleBtn.dataset.bound) {
    politicalEditingToggleBtn.addEventListener("click", () => {
      state.ui.politicalEditingExpanded = !state.ui.politicalEditingExpanded;
      if (typeof state.updatePaintModeUIFn === "function") {
        state.updatePaintModeUIFn();
      }
    });
    politicalEditingToggleBtn.dataset.bound = "true";
  }

  if (scenarioContextCollapseBtn && !scenarioContextCollapseBtn.dataset.bound) {
    scenarioContextCollapseBtn.addEventListener("click", () => {
      state.ui.scenarioBarCollapsed = !state.ui.scenarioBarCollapsed;
      refreshScenarioContextBar();
    });
    scenarioContextCollapseBtn.dataset.bound = "true";
  }

  bindScenarioGuideEvents({
    onToggle: (trigger) => {
      toggleScenarioGuidePopover(trigger);
    },
    onClose: () => {
      closeScenarioGuidePopover({ restoreFocus: true });
    },
  });

  if (appearanceSpecialZoneBtn && !appearanceSpecialZoneBtn.dataset.bound) {
    appearanceSpecialZoneBtn.setAttribute("aria-haspopup", "dialog");
    appearanceSpecialZoneBtn.setAttribute("aria-controls", "specialZonePopover");
    appearanceSpecialZoneBtn.addEventListener("click", () => {
      openSpecialZonePopover();
    });
    appearanceSpecialZoneBtn.dataset.bound = "true";
  }

  appearanceTabButtons.forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.addEventListener("click", () => {
      setAppearanceTab(button.dataset.appearanceTab || "ocean");
    });
    button.dataset.bound = "true";
  });

  if (appearanceLayerFilter && !appearanceLayerFilter.dataset.bound) {
    appearanceLayerFilter.addEventListener("input", () => {
      applyAppearanceFilter();
    });
    appearanceLayerFilter.dataset.bound = "true";
  }

  if (transportAppearanceMasterToggle && !transportAppearanceMasterToggle.dataset.bound) {
    transportAppearanceMasterToggle.addEventListener("change", (event) => {
      applyTransportAppearanceMasterToggle(!!event.target.checked);
    });
    transportAppearanceMasterToggle.dataset.bound = "true";
  }

  bindDockPopoverDismiss();
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(() => {
      restoreSupportSurfaceFromUrl();
    });
  });

  const computeBakeHash = (parts) => {
    const source = Array.isArray(parts) ? parts.join("|") : String(parts || "");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };

  const getLayerDependencyRevision = (layerId, exportUi = ensureExportWorkbenchUiState()) => {
    const mapSvg = document.getElementById("map-svg");
    const mapSvgChildCount = mapSvg ? mapSvg.childElementCount : 0;
    const renderPassCache = state.renderPassCache && typeof state.renderPassCache === "object"
      ? state.renderPassCache
      : {};
    const signatures = renderPassCache.signatures && typeof renderPassCache.signatures === "object"
      ? renderPassCache.signatures
      : {};
    const dirtyRevision = Number(state.dirtyRevision || 0);
    const zoomTransform = state.zoomTransform && typeof state.zoomTransform === "object"
      ? state.zoomTransform
      : { k: 1, x: 0, y: 0 };
    const transformSignature = [
      `zoomK:${Number(zoomTransform.k || 1).toFixed(5)}`,
      `zoomX:${Number(zoomTransform.x || 0).toFixed(2)}`,
      `zoomY:${Number(zoomTransform.y || 0).toFixed(2)}`,
    ];
    if (layerId === "color") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `colorRevision:${Number(state.colorRevision) || 0}`,
        `topologyRevision:${Number(state.topologyRevision) || 0}`,
        `dirtyRevision:${dirtyRevision}`,
        `passBackground:${String(signatures.background || "")}`,
        `passPhysicalBase:${String(signatures.physicalBase || "")}`,
        `passPolitical:${String(signatures.political || "")}`,
        `passContextBase:${String(signatures.contextBase || "")}`,
        `passContextScenario:${String(signatures.contextScenario || "")}`,
        `passEffects:${String(signatures.effects || "")}`,
        `passDayNight:${String(signatures.dayNight || "")}`,
      ];
    }
    if (layerId === "line") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `topologyRevision:${Number(state.topologyRevision) || 0}`,
        `dynamicDirty:${state.dynamicBordersDirty ? 1 : 0}`,
        `dirtyRevision:${dirtyRevision}`,
        `passBorders:${String(signatures.borders || "")}`,
        `passLineEffects:${String(signatures.lineEffects || "")}`,
      ];
    }
    if (layerId === "text") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `topologyRevision:${Number(state.topologyRevision) || 0}`,
        `svgChildren:${mapSvgChildCount}`,
        `dirtyRevision:${dirtyRevision}`,
        ...transformSignature,
      ];
    }
    return [
      getExportBakeVisibilitySignature(exportUi),
      `colorRevision:${Number(state.colorRevision) || 0}`,
      `topologyRevision:${Number(state.topologyRevision) || 0}`,
      `svgChildren:${mapSvgChildCount}`,
      `dirtyRevision:${dirtyRevision}`,
      ...transformSignature,
      `passPolitical:${String(signatures.political || "")}`,
      `passContextBase:${String(signatures.contextBase || "")}`,
      `passContextScenario:${String(signatures.contextScenario || "")}`,
      `passEffects:${String(signatures.effects || "")}`,
      `passBorders:${String(signatures.borders || "")}`,
      `passLineEffects:${String(signatures.lineEffects || "")}`,
      `passDayNight:${String(signatures.dayNight || "")}`,
      `passContextMarkers:${String(signatures.contextMarkers || "")}`,
      `passTextureLabels:${String(signatures.textureLabels || "")}`,
      `passLabels:${String(signatures.labels || "")}`,
    ];
  };

  const drawSvgLayerToCanvas = async (targetCanvas, targetCtx) => {
    const mapSvg = document.getElementById("map-svg");
    if (!mapSvg || !targetCanvas || !targetCtx) return false;
    const serializer = new XMLSerializer();
    const svgMarkup = serializer.serializeToString(mapSvg);
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          targetCtx.drawImage(image, 0, 0);
          resolve();
        };
        image.onerror = () => reject(new Error("SVG overlay export failed."));
        image.src = svgUrl;
      });
      return true;
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  const writeBakeArtifactMeta = (layerId, dependencies, canvas, dirtyFlag) => {
    const exportUi = ensureExportWorkbenchUiState();
    const entry = {
      layerId,
      updatedAt: Date.now(),
      dependencies: [...dependencies],
      canvasSize: {
        width: Math.max(0, Math.round(Number(canvas?.width) || 0)),
        height: Math.max(0, Math.round(Number(canvas?.height) || 0)),
      },
      dirtyFlag: !!dirtyFlag,
    };
    const nextArtifacts = Array.isArray(exportUi.bakeArtifacts) ? [...exportUi.bakeArtifacts] : [];
    const existingIndex = nextArtifacts.findIndex((artifact) => artifact?.layerId === layerId);
    if (existingIndex >= 0) {
      nextArtifacts[existingIndex] = entry;
    } else {
      nextArtifacts.push(entry);
    }
    exportUi.bakeArtifacts = nextArtifacts;
    return entry;
  };

  const drawRenderPassCanvasToBakeTarget = (passName, targetCtx) => {
    const renderPassCache = state.renderPassCache && typeof state.renderPassCache === "object"
      ? state.renderPassCache
      : null;
    if (!renderPassCache || !targetCtx) return false;
    const passCanvas = renderPassCache.canvases?.[passName];
    if (!passCanvas) return false;
    const layout = renderPassCache.layouts?.[passName] || {};
    const dpr = Math.max(Number(state.dpr) || 1, 1);
    const referenceTransform = renderPassCache.referenceTransforms?.[passName] || null;
    const currentTransform = state.zoomTransform && typeof state.zoomTransform === "object"
      ? state.zoomTransform
      : { k: 1, x: 0, y: 0 };
    const hasReferenceTransform = referenceTransform
      && Number.isFinite(Number(referenceTransform.k))
      && Number.isFinite(Number(referenceTransform.x))
      && Number.isFinite(Number(referenceTransform.y));
    const hasCurrentTransform = Number.isFinite(Number(currentTransform.k))
      && Number.isFinite(Number(currentTransform.x))
      && Number.isFinite(Number(currentTransform.y));
    if (!hasReferenceTransform || !hasCurrentTransform) {
      const offsetX = Math.round(-Number(layout.offsetX || 0) * dpr);
      const offsetY = Math.round(-Number(layout.offsetY || 0) * dpr);
      targetCtx.drawImage(passCanvas, offsetX, offsetY);
      return true;
    }
    const referenceK = Math.max(Number(referenceTransform.k) || 1, 0.0001);
    const currentK = Math.max(Number(currentTransform.k) || 1, 0.0001);
    const scaleRatio = currentK / referenceK;
    const dx = Number(currentTransform.x || 0) - (Number(referenceTransform.x || 0) * scaleRatio);
    const dy = Number(currentTransform.y || 0) - (Number(referenceTransform.y || 0) * scaleRatio);
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.translate(
      (dx - Number(layout.offsetX || 0) * scaleRatio) * dpr,
      (dy - Number(layout.offsetY || 0) * scaleRatio) * dpr,
    );
    targetCtx.scale(scaleRatio, scaleRatio);
    targetCtx.drawImage(passCanvas, 0, 0);
    targetCtx.restore();
    return true;
  };

  const drawLineLayerToCanvas = (targetCtx) => {
    let drewFromRenderPassCache = false;
    drewFromRenderPassCache = drawRenderPassCanvasToBakeTarget("lineEffects", targetCtx) || drewFromRenderPassCache;
    drewFromRenderPassCache = drawRenderPassCanvasToBakeTarget("borders", targetCtx) || drewFromRenderPassCache;
    if (drewFromRenderPassCache) {
      return true;
    }
    if (state.lineCanvas) {
      targetCtx.drawImage(state.lineCanvas, 0, 0);
      return true;
    }
    return false;
  };

  const drawColorLayerToCanvas = (targetCtx) => {
    const basePassNames = [
      "background",
      "physicalBase",
      "political",
      "contextBase",
      "contextScenario",
      "effects",
      "dayNight",
    ];
    let drewFromRenderPassCache = false;
    basePassNames.forEach((passName) => {
      drewFromRenderPassCache = drawRenderPassCanvasToBakeTarget(passName, targetCtx) || drewFromRenderPassCache;
    });
    if (drewFromRenderPassCache) {
      return "render-pass";
    }
    if (state.colorCanvas) {
      targetCtx.drawImage(state.colorCanvas, 0, 0);
      return "composite-canvas";
    }
    return "none";
  };

  const drawCompositeLayerToCanvas = (targetCtx) => {
    const compositePassNames = [
      "background",
      "physicalBase",
      "political",
      "contextBase",
      "contextScenario",
      "effects",
      "lineEffects",
      "dayNight",
      "borders",
      "contextMarkers",
      "textureLabels",
      "labels",
    ];
    let drewFromRenderPassCache = false;
    compositePassNames.forEach((passName) => {
      drewFromRenderPassCache = drawRenderPassCanvasToBakeTarget(passName, targetCtx) || drewFromRenderPassCache;
    });
    if (drewFromRenderPassCache) {
      return "render-pass";
    }
    if (state.colorCanvas) {
      targetCtx.drawImage(state.colorCanvas, 0, 0);
      return "composite-canvas";
    }
    return "none";
  };

  const bakeLayer = async (layerId, exportUiOverride = null) => {
    const exportUi = exportUiOverride && typeof exportUiOverride === "object"
      ? exportUiOverride
      : ensureExportWorkbenchUiState();
    const normalizedLayerId = String(layerId || "").trim().toLowerCase();
    if (!["color", "line", "text", "composite"].includes(normalizedLayerId)) {
      throw new Error(`Unsupported bake layer: ${layerId}`);
    }
    const width = state.colorCanvas?.width || state.lineCanvas?.width || 0;
    const height = state.colorCanvas?.height || state.lineCanvas?.height || 0;
    const dependencies = getLayerDependencyRevision(normalizedLayerId, exportUi);
    const hash = computeBakeHash([normalizedLayerId, `${width}x${height}`, ...dependencies]);
    const cacheEntry = exportUi.bakeCache.get(normalizedLayerId);
    if (
      cacheEntry
      && cacheEntry.hash === hash
      && cacheEntry.canvas
      && cacheEntry.canvas.width === width
      && cacheEntry.canvas.height === height
    ) {
      writeBakeArtifactMeta(normalizedLayerId, dependencies, cacheEntry.canvas, false);
      return cacheEntry.canvas;
    }
    const bakeCanvas = document.createElement("canvas");
    bakeCanvas.width = width;
    bakeCanvas.height = height;
    const bakeCtx = bakeCanvas.getContext("2d");
    if (!bakeCtx) {
      throw new Error("Canvas bake context unavailable.");
    }
    const bakePassNames = getBakePassNamesForLayer(normalizedLayerId, exportUi);
    if (normalizedLayerId === "composite") {
      const compositeCanvas = await buildCompositeSourceCanvas(exportUi);
      bakeCtx.drawImage(compositeCanvas, 0, 0);
    } else {
      if (bakePassNames.length) {
        const passCanvas = renderExportPassesToCanvas(bakePassNames);
        if (passCanvas) {
          bakeCtx.drawImage(passCanvas, 0, 0);
        }
      }
      if (normalizedLayerId === "text" && exportUi.textVisibility?.["svg-annotations"]) {
        await drawSvgLayerToCanvas(bakeCanvas, bakeCtx);
      }
    }
    const version = cacheEntry ? Number(cacheEntry.version || 0) + 1 : 1;
    exportUi.bakeCache.set(normalizedLayerId, {
      hash,
      version,
      canvas: bakeCanvas,
      updatedAt: Date.now(),
      dependencies,
      canvasSize: { width, height },
      dirtyFlag: true,
    });
    writeBakeArtifactMeta(normalizedLayerId, dependencies, bakeCanvas, true);
    return bakeCanvas;
  };

  const buildExportAdjustmentFilter = (exportUi) => {
    const adjustments = exportUi?.adjustments || {};
    const brightness = Math.max(0, Number(adjustments.brightness || 100)) / 100;
    const saturation = Math.max(0, Number(adjustments.saturation || 100)) / 100;
    const contrast = (Math.max(0, Number(adjustments.contrast || 100)) / 100)
      * (0.88 + (Math.max(0, Number(adjustments.clarity || 100)) / 100) * 0.12);
    return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturation.toFixed(3)})`;
  };

  const applyExportAdjustmentsToCanvas = (sourceCanvas, exportUi, { width = sourceCanvas?.width, height = sourceCanvas?.height } = {}) => {
    if (!sourceCanvas) {
      throw createExportError("invalid-params", "Missing export source canvas.");
    }
    const targetWidth = Math.max(1, Math.round(Number(width) || 0));
    const targetHeight = Math.max(1, Math.round(Number(height) || 0));
    const adjustedCanvas = document.createElement("canvas");
    adjustedCanvas.width = targetWidth;
    adjustedCanvas.height = targetHeight;
    const adjustedCtx = adjustedCanvas.getContext("2d");
    if (!adjustedCtx) {
      throw createExportError("invalid-params", "Canvas export context unavailable.");
    }
    adjustedCtx.imageSmoothingEnabled = true;
    adjustedCtx.imageSmoothingQuality = "high";
    adjustedCtx.filter = buildExportAdjustmentFilter(exportUi);
    adjustedCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
    adjustedCtx.filter = "none";
    return adjustedCanvas;
  };

  const cloneCanvas = (sourceCanvas) => {
    if (!sourceCanvas) return null;
    const canvas = document.createElement("canvas");
    canvas.width = sourceCanvas.width || 0;
    canvas.height = sourceCanvas.height || 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(sourceCanvas, 0, 0);
    return canvas;
  };

  const buildSvgAnnotationCanvas = async () => {
    const width = state.colorCanvas?.width || state.lineCanvas?.width || 0;
    const height = state.colorCanvas?.height || state.lineCanvas?.height || 0;
    if (!(width > 0) || !(height > 0)) {
      throw createExportError("invalid-params", "SVG annotation canvas unavailable.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw createExportError("invalid-params", "SVG annotation context unavailable.");
    }
    await drawSvgLayerToCanvas(canvas, ctx);
    return canvas;
  };

  const getBakePassNamesForLayer = (layerId, exportUi) => {
    const visibility = exportUi?.visibility || {};
    const textVisibility = exportUi?.textVisibility || {};
    if (layerId === "color") {
      return [
        ...(visibility.background === false ? [] : ["background"]),
        ...(visibility.political === false ? [] : ["physicalBase", "political"]),
        ...(visibility.context === false ? [] : ["contextBase", "contextScenario"]),
        ...(visibility.effects === false ? [] : ["effects", "dayNight"]),
      ];
    }
    if (layerId === "line") {
      return visibility.effects === false ? [] : ["lineEffects", "borders"];
    }
    if (layerId === "text") {
      return textVisibility["render-labels"] === false ? [] : ["labels"];
    }
    if (layerId === "composite") {
      return resolveExportPassSequence({
        ...exportUi,
        visibility,
      }).filter((passName) => textVisibility["render-labels"] !== false || passName !== "labels");
    }
    return [];
  };

  const buildCompositeSourceCanvas = async (exportUi) => {
    const passNames = resolveExportPassSequence({
      ...exportUi,
      visibility: exportUi.visibility,
    }).filter((passName) => exportUi.textVisibility?.["render-labels"] || passName !== "labels");
    const compositeCanvas = renderExportPassesToCanvas(passNames);
    if (!compositeCanvas) {
      throw createExportError("invalid-params", "Composite export canvas unavailable.");
    }
    const workingCanvas = cloneCanvas(compositeCanvas) || compositeCanvas;
    if (exportUi.textVisibility?.["svg-annotations"]) {
      const workingCtx = workingCanvas.getContext("2d");
      if (!workingCtx) {
        throw createExportError("invalid-params", "Composite export context unavailable.");
      }
      await drawSvgLayerToCanvas(workingCanvas, workingCtx);
    }
    return workingCanvas;
  };

  const buildSingleExportSourceCanvas = async (exportUi, sourceId) => {
    const normalizedSourceId = String(sourceId || "").trim();
    if (EXPORT_MAIN_LAYER_MODEL_BY_ID.has(normalizedSourceId)) {
      const model = EXPORT_MAIN_LAYER_MODEL_BY_ID.get(normalizedSourceId);
      const canvas = renderExportPassesToCanvas(model?.passNames || []);
      if (!canvas) {
        throw createExportError("invalid-params", `Layer export canvas unavailable for ${normalizedSourceId}.`);
      }
      return canvas;
    }
    if (normalizedSourceId === "render-labels") {
      const canvas = renderExportPassesToCanvas(["labels"]);
      if (!canvas) {
        throw createExportError("invalid-params", "Render-pass label canvas unavailable.");
      }
      return canvas;
    }
    if (normalizedSourceId === "svg-annotations") {
      return buildSvgAnnotationCanvas();
    }
    throw createExportError("invalid-params", `Unsupported preview source: ${normalizedSourceId}`);
  };

  const getBakePackLayerIds = (exportUi) => {
    const visibleMainLayers = exportUi.layerOrder.filter((layerId) => exportUi.visibility?.[layerId] !== false);
    const hasVisibleMainLayers = visibleMainLayers.length > 0;
    const hasEffectsLayer = visibleMainLayers.includes("effects");
    const hasTextLayer = Object.values(exportUi.textVisibility || {}).some(Boolean);
    const next = [];
    if (hasVisibleMainLayers) next.push("color");
    if (hasEffectsLayer) next.push("line");
    if (hasTextLayer) next.push("text");
    if (hasVisibleMainLayers || hasTextLayer) next.push("composite");
    return next;
  };

  const getSelectedExportScale = () => {
    const rawValue = String(exportScale?.value || ensureExportWorkbenchUiState().scale || "2").trim();
    return ["1", "1.5", "2", "4"].includes(rawValue) ? Number(rawValue) : 2;
  };

  const scaleCanvasForExport = (sourceCanvas, scaleMultiplier, exportUi) => {
    if (!sourceCanvas) {
      throw createExportError("invalid-params", "Missing export source canvas.");
    }
    const { width: baseWidth, height: baseHeight } = resolveExportBaseDimensions();
    if (!(baseWidth > 0) || !(baseHeight > 0)) {
      throw createExportError("invalid-params", "Missing preview canvas dimensions.");
    }
    const targetWidth = Math.round(baseWidth * scaleMultiplier);
    const targetHeight = Math.round(baseHeight * scaleMultiplier);
    if (targetWidth > EXPORT_MAX_DIMENSION_PX || targetHeight > EXPORT_MAX_DIMENSION_PX) {
      throw createExportError("invalid-params", `Export size exceeds 8K cap (${targetWidth}x${targetHeight}).`);
    }
    if (targetWidth * targetHeight > EXPORT_MAX_PIXELS) {
      throw createExportError("invalid-params", `Export pixel budget exceeded (${targetWidth}x${targetHeight}).`);
    }
    return applyExportAdjustmentsToCanvas(sourceCanvas, exportUi, {
      width: targetWidth,
      height: targetHeight,
    });
  };

  const buildCompositeExportCanvas = async (exportUi, scaleMultiplier) => {
    const compositeCanvas = await buildCompositeSourceCanvas(exportUi);
    return scaleCanvasForExport(compositeCanvas, scaleMultiplier, exportUi);
  };

  const buildPerLayerExportOutputs = async (exportUi, scaleMultiplier) => {
    const outputs = [];
    exportUi.layerOrder.forEach((layerId) => {
      if (exportUi.visibility?.[layerId] === false) return;
      if (layerId === "labels" && exportUi.textVisibility?.["render-labels"] === false) return;
      outputs.push({ id: layerId });
    });
    if (exportUi.textVisibility?.["svg-annotations"]) {
      outputs.push({ id: "svg-annotations" });
    }
    for (const output of outputs) {
      const layerCanvas = await buildSingleExportSourceCanvas(exportUi, output.id);
      output.canvas = scaleCanvasForExport(layerCanvas, scaleMultiplier, exportUi);
    }
    if (!outputs.length) {
      throw createExportError("invalid-params", "No visible export layers are available for per-layer export.");
    }
    return outputs;
  };

  const buildBakePackOutputs = async (exportUi, scaleMultiplier) => {
    const outputs = [];
    const bakeLayerIds = getBakePackLayerIds(exportUi);
    for (const layerId of bakeLayerIds) {
      const bakedCanvas = await bakeLayer(layerId, exportUi);
      outputs.push({
        id: layerId,
        canvas: scaleCanvasForExport(bakedCanvas, scaleMultiplier, exportUi),
      });
    }
    const metadata = {
      version: 1,
      generatedAt: new Date().toISOString(),
      exportUi: {
        target: exportUi.target,
        format: exportUi.format,
        scale: exportUi.scale,
        layerOrder: [...exportUi.layerOrder],
        visibility: { ...(exportUi.visibility || {}) },
        textVisibility: { ...(exportUi.textVisibility || {}) },
        adjustments: { ...(exportUi.adjustments || {}) },
      },
      bakeArtifacts: Array.isArray(exportUi.bakeArtifacts) ? exportUi.bakeArtifacts : [],
      files: outputs.map((output) => `map_bake_${output.id}.png`),
    };
    outputs.push({
      id: "metadata",
      blob: new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }),
      extension: "json",
      fileStem: "map_bake_manifest",
    });
    return outputs;
  };

  const triggerCanvasDownload = (canvas, extension, fileStem) => {
    const format = extension === "jpg" ? "image/jpeg" : "image/png";
    const dataUrl = canvas.toDataURL(format, 0.92);
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${fileStem}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const triggerBlobDownload = (blob, extension, fileStem) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${fileStem}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const syncExportWorkbenchControlsFromState = () => {
    return exportWorkbenchController?.syncExportWorkbenchControlsFromState() || ensureExportWorkbenchUiState();
  };

  renderTextureUI();
  renderDayNightUI();

  if (textureSelect && !textureSelect.dataset.bound) {
    textureSelect.addEventListener("change", (event) => {
      updateTextureStyle((texture) => {
        texture.mode = normalizeTextureMode(event.target.value);
      }, { historyKind: "texture-mode", commitHistory: true });
    });
    textureSelect.dataset.bound = "true";
  }

  bindTextureRange(textureOpacity, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      if (normalizeTextureMode(texture.mode) === "none") {
        return;
      }
      texture.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.88, 0, 1);
    }, { historyKind: "texture-opacity", commitHistory: commit });
  });

  bindTextureRange(texturePaperScale, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.paper.scale = clamp(Number.isFinite(value) ? value / 100 : 1, 0.55, 2.4);
    }, { historyKind: "texture-paper-scale", commitHistory: commit });
  });

  bindTextureRange(texturePaperWarmth, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.paper.warmth = clamp(Number.isFinite(value) ? value / 100 : 0.62, 0, 1);
    }, { historyKind: "texture-paper-warmth", commitHistory: commit });
  });

  bindTextureRange(texturePaperGrain, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.paper.grain = clamp(Number.isFinite(value) ? value / 100 : 0.34, 0, 1);
    }, { historyKind: "texture-paper-grain", commitHistory: commit });
  });

  bindTextureRange(texturePaperWear, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.paper.wear = clamp(Number.isFinite(value) ? value / 100 : 0.26, 0, 1);
    }, { historyKind: "texture-paper-wear", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleMajorStep, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.majorStep = clamp(Number.isFinite(value) ? value : 30, 10, 90);
      texture.graticule.minorStep = clamp(texture.graticule.minorStep, 1, texture.graticule.majorStep);
      texture.graticule.labelStep = Math.max(texture.graticule.labelStep, texture.graticule.majorStep);
    }, { historyKind: "texture-graticule-major", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleMinorStep, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.minorStep = clamp(Number.isFinite(value) ? value : 15, 1, texture.graticule.majorStep);
    }, { historyKind: "texture-graticule-minor", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleLabelStep, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.labelStep = clamp(Number.isFinite(value) ? value : 60, texture.graticule.majorStep, 180);
    }, { historyKind: "texture-graticule-label", commitHistory: commit });
  });

  bindTextureColorInput(textureGraticuleColor, (event, commit) => {
    updateTextureStyle((texture) => {
      texture.graticule.color = normalizeOceanFillColor(event.target.value);
    }, { historyKind: "texture-graticule-color", commitHistory: commit });
  });

  bindTextureColorInput(textureGraticuleLabelColor, (event, commit) => {
    updateTextureStyle((texture) => {
      texture.graticule.labelColor = normalizeOceanFillColor(event.target.value);
    }, { historyKind: "texture-graticule-label-color", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleLabelSize, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.labelSize = clamp(Math.round(Number.isFinite(value) ? value : 12), 9, 24);
    }, { historyKind: "texture-graticule-label-size", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleMajorWidth, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.majorWidth = clamp(Number.isFinite(value) ? value : 1.2, 0.2, 4);
    }, { historyKind: "texture-graticule-major-width", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleMinorWidth, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.minorWidth = clamp(Number.isFinite(value) ? value : 0.7, 0.1, 3);
    }, { historyKind: "texture-graticule-minor-width", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleMajorOpacity, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.majorOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.34, 0, 1);
    }, { historyKind: "texture-graticule-major-opacity", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleMinorOpacity, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.minorOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.14, 0, 1);
    }, { historyKind: "texture-graticule-minor-opacity", commitHistory: commit });
  });

  bindTextureRange(textureDraftMajorStep, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.draftGrid.majorStep = clamp(Number.isFinite(value) ? value : 24, 12, 90);
      texture.draftGrid.minorStep = Math.min(texture.draftGrid.minorStep, texture.draftGrid.majorStep);
    }, { historyKind: "texture-draft-major", commitHistory: commit });
  });

  bindTextureRange(textureDraftMinorStep, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.draftGrid.minorStep = clamp(Number.isFinite(value) ? value : 12, 4, texture.draftGrid.majorStep);
    }, { historyKind: "texture-draft-minor", commitHistory: commit });
  });

  bindTextureRange(textureDraftLonOffset, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.draftGrid.lonOffset = clamp(Number.isFinite(value) ? value : 0, -180, 180);
    }, { historyKind: "texture-draft-longitude", commitHistory: commit });
  });

  bindTextureRange(textureDraftLatOffset, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.draftGrid.latOffset = clamp(Number.isFinite(value) ? value : 12, -80, 80);
    }, { historyKind: "texture-draft-latitude", commitHistory: commit });
  });

  bindTextureRange(textureDraftRoll, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.draftGrid.roll = clamp(Number.isFinite(value) ? value : -18, -180, 180);
    }, { historyKind: "texture-draft-roll", commitHistory: commit });
  });

  bindTextureColorInput(textureDraftColor, (event, commit) => {
    updateTextureStyle((texture) => {
      texture.draftGrid.color = normalizeOceanFillColor(event.target.value);
    }, { historyKind: "texture-draft-color", commitHistory: commit });
  });

  bindTextureRange(textureDraftWidth, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.draftGrid.width = clamp(Number.isFinite(value) ? value : 1.1, 0.2, 4);
    }, { historyKind: "texture-draft-width", commitHistory: commit });
  });

  bindTextureRange(textureDraftMajorOpacity, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.draftGrid.majorOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.28, 0, 1);
    }, { historyKind: "texture-draft-major-opacity", commitHistory: commit });
  });

  bindTextureRange(textureDraftMinorOpacity, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.draftGrid.minorOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.14, 0, 1);
    }, { historyKind: "texture-draft-minor-opacity", commitHistory: commit });
  });

  if (textureDraftDash && !textureDraftDash.dataset.bound) {
    textureDraftDash.addEventListener("change", (event) => {
      updateTextureStyle((texture) => {
        texture.draftGrid.dash = String(event.target.value || "dashed");
      }, { historyKind: "texture-draft-dash", commitHistory: true });
    });
    textureDraftDash.dataset.bound = "true";
  }

  if (dayNightEnabled && !dayNightEnabled.dataset.bound) {
    dayNightEnabled.addEventListener("change", (event) => {
      const dayNight = syncDayNightConfig();
      dayNight.enabled = !!event.target.checked;
      renderDayNightUI();
      renderDirty("day-night-enabled");
    });
    dayNightEnabled.dataset.bound = "true";
  }

  [
    [dayNightModeManualBtn, "manual"],
    [dayNightModeUtcBtn, "utc"],
  ].forEach(([button, modeValue]) => {
    if (!button || button.dataset.bound === "true") return;
    button.addEventListener("click", () => {
      const dayNight = syncDayNightConfig();
      if (dayNight.mode === modeValue) return;
      dayNight.mode = modeValue;
      renderDayNightUI();
      renderDirty("day-night-mode");
    });
    button.dataset.bound = "true";
  });

  if (dayNightManualTime && !dayNightManualTime.dataset.bound) {
    dayNightManualTime.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.manualUtcMinutes = clamp(Number.isFinite(value) ? value : 12 * 60, 0, 24 * 60 - 1);
      renderDayNightUI();
      renderDirty("day-night-time");
    });
    dayNightManualTime.dataset.bound = "true";
  }

  if (dayNightCityLightsEnabled && !dayNightCityLightsEnabled.dataset.bound) {
    dayNightCityLightsEnabled.addEventListener("change", (event) => {
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsEnabled = !!event.target.checked;
      renderDayNightUI();
      renderDirty("day-night-city-lights-enabled");
    });
    dayNightCityLightsEnabled.dataset.bound = "true";
  }

  if (dayNightCityLightsStyle && !dayNightCityLightsStyle.dataset.bound) {
    dayNightCityLightsStyle.addEventListener("change", (event) => {
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsStyle = String(event.target.value || "modern");
      renderDayNightUI();
      renderDirty("day-night-city-lights-style");
    });
    dayNightCityLightsStyle.dataset.bound = "true";
  }

  if (dayNightCityLightsIntensity && !dayNightCityLightsIntensity.dataset.bound) {
    dayNightCityLightsIntensity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsIntensity = clamp(Number.isFinite(value) ? value / 100 : 0.78, 0, 1.8);
      renderDayNightUI();
      renderDirty("day-night-city-lights-intensity");
    });
    dayNightCityLightsIntensity.dataset.bound = "true";
  }

  if (dayNightCityLightsTextureOpacity && !dayNightCityLightsTextureOpacity.dataset.bound) {
    dayNightCityLightsTextureOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsTextureOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.54, 0, 1);
      renderDayNightUI();
      renderDirty("day-night-city-lights-texture-opacity");
    });
    dayNightCityLightsTextureOpacity.dataset.bound = "true";
  }

  if (dayNightCityLightsCorridorStrength && !dayNightCityLightsCorridorStrength.dataset.bound) {
    dayNightCityLightsCorridorStrength.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsCorridorStrength = clamp(Number.isFinite(value) ? value / 100 : 0.62, 0, 1);
      renderDayNightUI();
      renderDirty("day-night-city-lights-corridor-strength");
    });
    dayNightCityLightsCorridorStrength.dataset.bound = "true";
  }

  if (dayNightCityLightsCoreSharpness && !dayNightCityLightsCoreSharpness.dataset.bound) {
    dayNightCityLightsCoreSharpness.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsCoreSharpness = clamp(Number.isFinite(value) ? value / 100 : 0.54, 0, 1);
      renderDayNightUI();
      renderDirty("day-night-city-lights-core-sharpness");
    });
    dayNightCityLightsCoreSharpness.dataset.bound = "true";
  }

  if (dayNightCityLightsPopulationBoostEnabled && !dayNightCityLightsPopulationBoostEnabled.dataset.bound) {
    dayNightCityLightsPopulationBoostEnabled.addEventListener("change", (event) => {
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsPopulationBoostEnabled = !!event.target.checked;
      renderDayNightUI();
      renderDirty("day-night-city-lights-population-boost-enabled");
    });
    dayNightCityLightsPopulationBoostEnabled.dataset.bound = "true";
  }

  if (dayNightCityLightsPopulationBoostStrength && !dayNightCityLightsPopulationBoostStrength.dataset.bound) {
    dayNightCityLightsPopulationBoostStrength.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsPopulationBoostStrength = clamp(Number.isFinite(value) ? value / 100 : 0.56, 0, 1.5);
      renderDayNightUI();
      renderDirty("day-night-city-lights-population-boost-strength");
    });
    dayNightCityLightsPopulationBoostStrength.dataset.bound = "true";
  }

  if (dayNightHistoricalCityLightsDensity && !dayNightHistoricalCityLightsDensity.dataset.bound) {
    dayNightHistoricalCityLightsDensity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.historicalCityLightsDensity = clamp(Number.isFinite(value) ? value / 100 : 1.25, 0.75, 2);
      renderDayNightUI();
      renderDirty("day-night-historical-city-lights-density");
    });
    dayNightHistoricalCityLightsDensity.dataset.bound = "true";
  }

  if (
    dayNightHistoricalCityLightsSecondaryRetention &&
    !dayNightHistoricalCityLightsSecondaryRetention.dataset.bound
  ) {
    dayNightHistoricalCityLightsSecondaryRetention.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.historicalCityLightsSecondaryRetention = clamp(Number.isFinite(value) ? value / 100 : 0.55, 0, 1);
      renderDayNightUI();
      renderDirty("day-night-historical-city-lights-secondary-retention");
    });
    dayNightHistoricalCityLightsSecondaryRetention.dataset.bound = "true";
  }

  if (dayNightShadowOpacity && !dayNightShadowOpacity.dataset.bound) {
    dayNightShadowOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.shadowOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.28, 0, 0.85);
      renderDayNightUI();
      renderDirty("day-night-shadow-opacity");
    });
    dayNightShadowOpacity.dataset.bound = "true";
  }

  if (dayNightTwilightWidth && !dayNightTwilightWidth.dataset.bound) {
    dayNightTwilightWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.twilightWidthDeg = clamp(Number.isFinite(value) ? value : 10, 2, 28);
      renderDayNightUI();
      renderDirty("day-night-twilight-width");
    });
    dayNightTwilightWidth.dataset.bound = "true";
  }

  if (toggleUrban) {
    toggleUrban.checked = !!state.showUrban;
    toggleUrban.addEventListener("change", (event) => {
      state.showUrban = event.target.checked;
      if (state.showUrban && typeof state.ensureContextLayerDataFn === "function") {
        void state.ensureContextLayerDataFn("urban", { reason: "toolbar-toggle", renderNow: true });
      }
      renderDirty("toggle-urban");
    });
  }

  if (togglePhysical) {
    togglePhysical.checked = !!state.showPhysical;
    togglePhysical.addEventListener("change", (event) => {
      state.showPhysical = event.target.checked;
      if (state.showPhysical && typeof state.ensureContextLayerDataFn === "function") {
        void state.ensureContextLayerDataFn(["physical-set", "physical-contours-set"], { reason: "toolbar-toggle", renderNow: true });
      }
      renderDirty("toggle-physical");
    });
  }

  if (toggleRivers) {
    toggleRivers.checked = !!state.showRivers;
    toggleRivers.addEventListener("change", (event) => {
      state.showRivers = event.target.checked;
      if (state.showRivers && typeof state.ensureContextLayerDataFn === "function") {
        void state.ensureContextLayerDataFn("rivers", { reason: "toolbar-toggle", renderNow: true });
      }
      renderDirty("toggle-rivers");
    });
  }

  if (toggleAirports) {
    toggleAirports.checked = !!state.showAirports;
    toggleAirports.addEventListener("change", (event) => {
      state.showAirports = !!event.target.checked;
      if (state.showAirports && typeof state.ensureContextLayerDataFn === "function") {
        void state.ensureContextLayerDataFn("airports", { reason: "toolbar-toggle", renderNow: true });
      }
      renderTransportAppearanceUi();
      renderDirty("toggle-airports");
    });
  }

  if (togglePorts) {
    togglePorts.checked = !!state.showPorts;
    togglePorts.addEventListener("change", (event) => {
      state.showPorts = !!event.target.checked;
      if (state.showPorts && typeof state.ensureContextLayerDataFn === "function") {
        void state.ensureContextLayerDataFn("ports", { reason: "toolbar-toggle", renderNow: true });
      }
      renderTransportAppearanceUi();
      renderDirty("toggle-ports");
    });
  }

  if (toggleRail) {
    toggleRail.checked = !!state.showRail;
    toggleRail.addEventListener("change", (event) => {
      state.showRail = !!event.target.checked;
      if (state.showRail && state.showTransport === false) {
        state.showTransport = true;
      }
      if (state.showRail && typeof state.ensureContextLayerDataFn === "function") {
        void state.ensureContextLayerDataFn(["railways", "rail_stations_major"], { reason: "toolbar-toggle", renderNow: true });
      }
      renderTransportAppearanceUi();
      renderDirty("toggle-rail");
    });
  }

  if (toggleRoad) {
    toggleRoad.checked = !!state.showRoad;
    toggleRoad.addEventListener("change", (event) => {
      state.showRoad = !!event.target.checked;
      if (state.showRoad && state.showTransport === false) {
        state.showTransport = true;
      }
      if (state.showRoad && typeof state.ensureContextLayerDataFn === "function") {
        void state.ensureContextLayerDataFn("roads", { reason: "toolbar-toggle", renderNow: true });
      }
      renderTransportAppearanceUi();
      renderDirty("toggle-road");
    });
  }

  if (airportVisualStrength && !airportVisualStrength.dataset.bound) {
    airportVisualStrength.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().airport.visualStrength = clamp(Number.isFinite(value) ? value / 100 : 0.56, 0, 1);
      renderTransportAppearanceUi();
      renderDirty("transport-airport-visual-strength");
    });
    airportVisualStrength.dataset.bound = "true";
  }

  if (airportOpacity && !airportOpacity.dataset.bound) {
    airportOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().airport.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.82, 0.2, 1);
      renderTransportAppearanceUi();
      renderDirty("transport-airport-opacity");
    });
    airportOpacity.dataset.bound = "true";
  }

  if (airportPrimaryColor && !airportPrimaryColor.dataset.bound) {
    airportPrimaryColor.addEventListener("input", (event) => {
      getTransportAppearanceConfig().airport.primaryColor = normalizeOceanFillColor(event.target.value || "#1d4ed8");
      renderTransportAppearanceUi();
      renderDirty("transport-airport-primary-color");
    });
    airportPrimaryColor.dataset.bound = "true";
  }

  if (airportLabelsEnabled && !airportLabelsEnabled.dataset.bound) {
    airportLabelsEnabled.addEventListener("change", (event) => {
      getTransportAppearanceConfig().airport.labelsEnabled = !!event.target.checked;
      renderTransportAppearanceUi();
      renderDirty("transport-airport-labels-enabled");
    });
    airportLabelsEnabled.dataset.bound = "true";
  }

  if (airportLabelDensity && !airportLabelDensity.dataset.bound) {
    airportLabelDensity.addEventListener("change", (event) => {
      getTransportAppearanceConfig().airport.labelDensity = String(event.target.value || "balanced");
      renderTransportAppearanceUi();
      renderDirty("transport-airport-label-density");
    });
    airportLabelDensity.dataset.bound = "true";
  }

  if (airportLabelMode && !airportLabelMode.dataset.bound) {
    airportLabelMode.addEventListener("change", (event) => {
      getTransportAppearanceConfig().airport.labelMode = String(event.target.value || "both");
      renderTransportAppearanceUi();
      renderDirty("transport-airport-label-mode");
    });
    airportLabelMode.dataset.bound = "true";
  }

  if (airportCoverageReach && !airportCoverageReach.dataset.bound) {
    airportCoverageReach.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const config = getTransportAppearanceConfig().airport;
      config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
      if (String(config.scopeLinkMode || "linked") !== "manual") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("airport", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
      renderTransportAppearanceUi();
      renderDirty("transport-airport-coverage-reach");
    });
    airportCoverageReach.dataset.bound = "true";
  }

  if (airportScopeLinked && !airportScopeLinked.dataset.bound) {
    airportScopeLinked.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().airport;
      config.scopeLinkMode = event.target.checked ? "linked" : "manual";
      if (config.scopeLinkMode === "linked") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("airport", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
      renderTransportAppearanceUi();
      renderDirty("transport-airport-scope-link");
    });
    airportScopeLinked.dataset.bound = "true";
  }

  if (airportScope && !airportScope.dataset.bound) {
    airportScope.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().airport;
      config.scopeLinkMode = "manual";
      config.scope = String(event.target.value || "major_civil");
      renderTransportAppearanceUi();
      renderDirty("transport-airport-scope");
    });
    airportScope.dataset.bound = "true";
  }

  if (airportImportanceThreshold && !airportImportanceThreshold.dataset.bound) {
    airportImportanceThreshold.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().airport;
      config.scopeLinkMode = "manual";
      config.importanceThreshold = String(event.target.value || "secondary");
      renderTransportAppearanceUi();
      renderDirty("transport-airport-importance-threshold");
    });
    airportImportanceThreshold.dataset.bound = "true";
  }

  if (portVisualStrength && !portVisualStrength.dataset.bound) {
    portVisualStrength.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().port.visualStrength = clamp(Number.isFinite(value) ? value / 100 : 0.54, 0, 1);
      renderTransportAppearanceUi();
      renderDirty("transport-port-visual-strength");
    });
    portVisualStrength.dataset.bound = "true";
  }

  if (portOpacity && !portOpacity.dataset.bound) {
    portOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().port.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.78, 0.2, 1);
      renderTransportAppearanceUi();
      renderDirty("transport-port-opacity");
    });
    portOpacity.dataset.bound = "true";
  }

  if (portPrimaryColor && !portPrimaryColor.dataset.bound) {
    portPrimaryColor.addEventListener("input", (event) => {
      getTransportAppearanceConfig().port.primaryColor = normalizeOceanFillColor(event.target.value || "#b45309");
      renderTransportAppearanceUi();
      renderDirty("transport-port-primary-color");
    });
    portPrimaryColor.dataset.bound = "true";
  }

  if (portLabelsEnabled && !portLabelsEnabled.dataset.bound) {
    portLabelsEnabled.addEventListener("change", (event) => {
      getTransportAppearanceConfig().port.labelsEnabled = !!event.target.checked;
      renderTransportAppearanceUi();
      renderDirty("transport-port-labels-enabled");
    });
    portLabelsEnabled.dataset.bound = "true";
  }

  if (portLabelDensity && !portLabelDensity.dataset.bound) {
    portLabelDensity.addEventListener("change", (event) => {
      getTransportAppearanceConfig().port.labelDensity = String(event.target.value || "balanced");
      renderTransportAppearanceUi();
      renderDirty("transport-port-label-density");
    });
    portLabelDensity.dataset.bound = "true";
  }

  if (portLabelMode && !portLabelMode.dataset.bound) {
    portLabelMode.addEventListener("change", (event) => {
      getTransportAppearanceConfig().port.labelMode = String(event.target.value || "mixed");
      renderTransportAppearanceUi();
      renderDirty("transport-port-label-mode");
    });
    portLabelMode.dataset.bound = "true";
  }

  if (portCoverageReach && !portCoverageReach.dataset.bound) {
    portCoverageReach.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const config = getTransportAppearanceConfig().port;
      config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
      if (String(config.scopeLinkMode || "linked") !== "manual") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("port", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
      renderTransportAppearanceUi();
      renderDirty("transport-port-coverage-reach");
    });
    portCoverageReach.dataset.bound = "true";
  }

  if (portScopeLinked && !portScopeLinked.dataset.bound) {
    portScopeLinked.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().port;
      config.scopeLinkMode = event.target.checked ? "linked" : "manual";
      if (config.scopeLinkMode === "linked") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("port", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
      renderTransportAppearanceUi();
      renderDirty("transport-port-scope-link");
    });
    portScopeLinked.dataset.bound = "true";
  }

  if (portTier && !portTier.dataset.bound) {
    portTier.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().port;
      config.scopeLinkMode = "manual";
      config.scope = String(event.target.value || "regional");
      renderTransportAppearanceUi();
      renderDirty("transport-port-scope");
    });
    portTier.dataset.bound = "true";
  }

  if (portImportanceThreshold && !portImportanceThreshold.dataset.bound) {
    portImportanceThreshold.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().port;
      config.scopeLinkMode = "manual";
      config.importanceThreshold = String(event.target.value || "secondary");
      renderTransportAppearanceUi();
      renderDirty("transport-port-importance-threshold");
    });
    portImportanceThreshold.dataset.bound = "true";
  }

  if (railVisualStrength && !railVisualStrength.dataset.bound) {
    railVisualStrength.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().rail.visualStrength = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
      renderTransportAppearanceUi();
      renderDirty("transport-rail-visual-strength");
    });
    railVisualStrength.dataset.bound = "true";
  }

  if (railOpacity && !railOpacity.dataset.bound) {
    railOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().rail.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0.2, 1);
      renderTransportAppearanceUi();
      renderDirty("transport-rail-opacity");
    });
    railOpacity.dataset.bound = "true";
  }

  if (railPrimaryColor && !railPrimaryColor.dataset.bound) {
    railPrimaryColor.addEventListener("input", (event) => {
      getTransportAppearanceConfig().rail.primaryColor = normalizeOceanFillColor(event.target.value || "#0f172a");
      renderTransportAppearanceUi();
      renderDirty("transport-rail-primary-color");
    });
    railPrimaryColor.dataset.bound = "true";
  }

  if (railLabelsEnabled && !railLabelsEnabled.dataset.bound) {
    railLabelsEnabled.addEventListener("change", (event) => {
      getTransportAppearanceConfig().rail.labelsEnabled = !!event.target.checked;
      renderTransportAppearanceUi();
      renderDirty("transport-rail-labels-enabled");
    });
    railLabelsEnabled.dataset.bound = "true";
  }

  if (railLabelDensity && !railLabelDensity.dataset.bound) {
    railLabelDensity.addEventListener("change", (event) => {
      getTransportAppearanceConfig().rail.labelDensity = String(event.target.value || "sparse");
      renderTransportAppearanceUi();
      renderDirty("transport-rail-label-density");
    });
    railLabelDensity.dataset.bound = "true";
  }

  if (railCoverageReach && !railCoverageReach.dataset.bound) {
    railCoverageReach.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const config = getTransportAppearanceConfig().rail;
      config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : 0.2, 0, 1);
      if (String(config.scopeLinkMode || "linked") !== "manual") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("rail", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
      renderTransportAppearanceUi();
      renderDirty("transport-rail-coverage-reach");
    });
    railCoverageReach.dataset.bound = "true";
  }

  if (railScopeLinked && !railScopeLinked.dataset.bound) {
    railScopeLinked.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().rail;
      config.scopeLinkMode = event.target.checked ? "linked" : "manual";
      if (config.scopeLinkMode === "linked") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("rail", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
      renderTransportAppearanceUi();
      renderDirty("transport-rail-scope-link");
    });
    railScopeLinked.dataset.bound = "true";
  }

  if (railScope && !railScope.dataset.bound) {
    railScope.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().rail;
      config.scopeLinkMode = "manual";
      config.scope = String(event.target.value || "mainline_only");
      renderTransportAppearanceUi();
      renderDirty("transport-rail-scope");
    });
    railScope.dataset.bound = "true";
  }

  if (railImportanceThreshold && !railImportanceThreshold.dataset.bound) {
    railImportanceThreshold.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().rail;
      config.scopeLinkMode = "manual";
      config.importanceThreshold = String(event.target.value || "primary");
      renderTransportAppearanceUi();
      renderDirty("transport-rail-importance-threshold");
    });
    railImportanceThreshold.dataset.bound = "true";
  }

  if (roadVisualStrength && !roadVisualStrength.dataset.bound) {
    roadVisualStrength.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().road.visualStrength = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
      renderTransportAppearanceUi();
      renderDirty("transport-road-visual-strength");
    });
    roadVisualStrength.dataset.bound = "true";
  }

  if (roadOpacity && !roadOpacity.dataset.bound) {
    roadOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().road.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0.2, 1);
      renderTransportAppearanceUi();
      renderDirty("transport-road-opacity");
    });
    roadOpacity.dataset.bound = "true";
  }

  if (roadPrimaryColor && !roadPrimaryColor.dataset.bound) {
    roadPrimaryColor.addEventListener("input", (event) => {
      getTransportAppearanceConfig().road.primaryColor = normalizeOceanFillColor(event.target.value || "#374151");
      renderTransportAppearanceUi();
      renderDirty("transport-road-primary-color");
    });
    roadPrimaryColor.dataset.bound = "true";
  }

  if (roadCoverageReach && !roadCoverageReach.dataset.bound) {
    roadCoverageReach.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const config = getTransportAppearanceConfig().road;
      config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : 0.2, 0, 1);
      if (String(config.scopeLinkMode || "linked") !== "manual") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("road", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
      renderTransportAppearanceUi();
      renderDirty("transport-road-coverage-reach");
    });
    roadCoverageReach.dataset.bound = "true";
  }

  if (roadScopeLinked && !roadScopeLinked.dataset.bound) {
    roadScopeLinked.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().road;
      config.scopeLinkMode = event.target.checked ? "linked" : "manual";
      if (config.scopeLinkMode === "linked") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("road", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
      renderTransportAppearanceUi();
      renderDirty("transport-road-scope-link");
    });
    roadScopeLinked.dataset.bound = "true";
  }

  if (roadScope && !roadScope.dataset.bound) {
    roadScope.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().road;
      config.scopeLinkMode = "manual";
      config.scope = String(event.target.value || "motorway_only");
      renderTransportAppearanceUi();
      renderDirty("transport-road-scope");
    });
    roadScope.dataset.bound = "true";
  }

  if (roadImportanceThreshold && !roadImportanceThreshold.dataset.bound) {
    roadImportanceThreshold.addEventListener("change", (event) => {
      const config = getTransportAppearanceConfig().road;
      config.scopeLinkMode = "manual";
      config.importanceThreshold = String(event.target.value || "primary");
      renderTransportAppearanceUi();
      renderDirty("transport-road-importance-threshold");
    });
    roadImportanceThreshold.dataset.bound = "true";
  }

  if (toggleCityPoints) {
    toggleCityPoints.checked = !!state.showCityPoints;
    toggleCityPoints.addEventListener("change", (event) => {
      state.showCityPoints = !!event.target.checked;
      if (state.showCityPoints) {
        if (typeof state.ensureBaseCityDataFn === "function") {
          void state.ensureBaseCityDataFn({ reason: "toolbar-toggle", renderNow: true });
        }
        void ensureActiveScenarioOptionalLayerLoaded("cities", { renderNow: true });
      }
      persistCityViewSettings();
      renderDirty("toggle-city-points");
    });
  }

  if (toggleWaterRegions) {
    toggleWaterRegions.checked = !!state.showWaterRegions;
    toggleWaterRegions.addEventListener("change", (event) => {
      state.showWaterRegions = event.target.checked;
      if (state.showWaterRegions) {
        void ensureActiveScenarioOptionalLayerLoaded("water", { renderNow: true });
      }
      renderDirty("toggle-water-regions");
    });
  }

  if (toggleOpenOceanRegions) {
    toggleOpenOceanRegions.checked = !!state.showOpenOceanRegions;
    toggleOpenOceanRegions.addEventListener("change", (event) => {
      state.allowOpenOceanSelect = !!event.target.checked;
      state.allowOpenOceanPaint = !!event.target.checked;
      state.showOpenOceanRegions = !!event.target.checked;
      if (!state.showOpenOceanRegions) {
        state.hoveredWaterRegionId = null;
      }
      if (typeof state.updateWaterInteractionUIFn === "function") {
        state.updateWaterInteractionUIFn();
      }
      if (typeof state.renderWaterRegionListFn === "function") {
        state.renderWaterRegionListFn();
      }
      renderDirty("toggle-open-ocean-regions");
    });
  }

  if (toggleSpecialZones) {
    toggleSpecialZones.checked = state.showSpecialZones;
    toggleSpecialZones.addEventListener("change", (event) => {
      state.showSpecialZones = event.target.checked;
      renderDirty("toggle-special-zones");
    });
  }
  if (urbanMode) {
    urbanMode.addEventListener("change", (event) => {
      const cfg = syncUrbanConfig();
      const requestedMode = String(event.target.value || "adaptive");
      const capability = getUrbanCapability();
      cfg.mode = requestedMode === "adaptive" && !capability.adaptiveAvailable
        ? "manual"
        : requestedMode;
      syncUrbanControls();
      renderDirty("urban-mode");
    });
  }
  if (urbanColor) {
    urbanColor.addEventListener("input", (event) => {
      const cfg = syncUrbanConfig();
      cfg.color = normalizeOceanFillColor(event.target.value);
      renderDirty("urban-color");
    });
  }
  if (cityPointsColor) {
    cityPointsColor.addEventListener("input", (event) => {
      const cfg = syncCityPointsConfig();
      cfg.color = normalizeOceanFillColor(event.target.value);
      persistCityViewSettings();
      renderDirty("city-points-color");
    });
  }
  if (cityPointsTheme) {
    cityPointsTheme.addEventListener("change", (event) => {
      const cfg = syncCityPointsConfig();
      cfg.theme = getCityPointsThemeMeta(event.target.value || "classic_graphite").value;
      const themeStyle = getCityPointsThemeStyle(cfg.theme);
      cfg.color = themeStyle.color;
      cfg.capitalColor = themeStyle.capitalColor;
      if (cityPointsThemeHint) {
        cityPointsThemeHint.textContent = getCityPointsThemeHint(cfg.theme);
      }
      if (cityPointsColor) {
        cityPointsColor.value = normalizeOceanFillColor(cfg.color);
      }
      if (cityPointsCapitalColor) {
        cityPointsCapitalColor.value = normalizeOceanFillColor(cfg.capitalColor);
      }
      persistCityViewSettings();
      renderDirty("city-points-theme");
    });
  }
  if (cityPointsMarkerScale) {
    cityPointsMarkerScale.addEventListener("input", (event) => {
      const cfg = syncCityPointsConfig();
      const value = Number(event.target.value);
      cfg.markerScale = clamp(Number.isFinite(value) ? value : 1, 0.75, 2.5);
      if (cityPointsMarkerScaleValue) {
        cityPointsMarkerScaleValue.textContent = `${Number(cfg.markerScale).toFixed(2)}x`;
      }
      persistCityViewSettings();
      renderDirty("city-points-marker-scale");
    });
  }
  if (cityPointsMarkerDensity) {
    const syncMarkerDensity = (event) => {
      const cfg = syncCityPointsConfig();
      const value = Number(event.target.value);
      cfg.markerDensity = clamp(Number.isFinite(value) ? value : 1, 0.5, 2);
      if (cityPointsMarkerDensityValue) {
        cityPointsMarkerDensityValue.textContent = formatCityPointsDensityValue(cfg.markerDensity);
      }
      persistCityViewSettings();
      renderDirty("city-points-marker-density");
    };
    cityPointsMarkerDensity.addEventListener("input", syncMarkerDensity);
    cityPointsMarkerDensity.addEventListener("change", syncMarkerDensity);
  }
  if (cityPointsLabelDensity) {
    cityPointsLabelDensity.addEventListener("change", (event) => {
      const cfg = syncCityPointsConfig();
      cfg.labelDensity = String(event.target.value || "balanced");
      if (cityPointsLabelDensityHint) {
        cityPointsLabelDensityHint.textContent = getCityPointsLabelDensityHint(cfg.labelDensity);
      }
      persistCityViewSettings();
      renderDirty("city-points-label-density");
    });
  }
  if (cityPointsCapitalColor) {
    cityPointsCapitalColor.addEventListener("input", (event) => {
      const cfg = syncCityPointsConfig();
      cfg.capitalColor = normalizeOceanFillColor(event.target.value);
      persistCityViewSettings();
      renderDirty("city-points-capital-color");
    });
  }
  if (cityPointsOpacity) {
    cityPointsOpacity.addEventListener("input", (event) => {
      const cfg = syncCityPointsConfig();
      const value = Number(event.target.value);
      cfg.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.92, 0, 1);
      if (cityPointsOpacityValue) {
        cityPointsOpacityValue.textContent = `${Math.round(cfg.opacity * 100)}%`;
      }
      persistCityViewSettings();
      renderDirty("city-points-opacity");
    });
  }
  if (cityPointLabelsEnabled) {
    cityPointLabelsEnabled.addEventListener("change", (event) => {
      const cfg = syncCityPointsConfig();
      cfg.showLabels = !!event.target.checked;
      persistCityViewSettings();
      renderDirty("city-points-labels-toggle");
    });
  }
  if (cityPointsLabelSize) {
    cityPointsLabelSize.addEventListener("input", (event) => {
      const cfg = syncCityPointsConfig();
      const value = Number(event.target.value);
      cfg.labelSize = clamp(Math.round(Number.isFinite(value) ? value : 12), 8, 24);
      if (cityPointsLabelSizeValue) {
        cityPointsLabelSizeValue.textContent = `${Math.round(cfg.labelSize)}px`;
      }
      persistCityViewSettings();
      renderDirty("city-points-label-size");
    });
  }
  if (cityCapitalOverlayEnabled) {
    cityCapitalOverlayEnabled.addEventListener("change", (event) => {
      const cfg = syncCityPointsConfig();
      cfg.showCapitalOverlay = !!event.target.checked;
      persistCityViewSettings();
      renderDirty("city-points-capital-overlay");
    });
  }
  if (urbanOpacity) {
    urbanOpacity.addEventListener("input", (event) => {
      const cfg = syncUrbanConfig();
      const value = Number(event.target.value);
      cfg.fillOpacity = clamp(Number.isFinite(value) ? value / 100 : cfg.fillOpacity, 0, 1);
      if (urbanOpacityValue) urbanOpacityValue.textContent = `${Math.round(cfg.fillOpacity * 100)}%`;
      renderDirty("urban-opacity");
    });
  }
  if (urbanBlendMode) {
    urbanBlendMode.addEventListener("change", (event) => {
      const cfg = syncUrbanConfig();
      cfg.blendMode = String(event.target.value || "multiply");
      renderDirty("urban-blend");
    });
  }
  if (urbanAdaptiveStrength) {
    urbanAdaptiveStrength.addEventListener("input", (event) => {
      const cfg = syncUrbanConfig();
      const value = Number(event.target.value);
      cfg.adaptiveStrength = clamp(Number.isFinite(value) ? value / 100 : cfg.adaptiveStrength, 0, 1);
      if (urbanAdaptiveStrengthValue) {
        urbanAdaptiveStrengthValue.textContent = `${Math.round(cfg.adaptiveStrength * 100)}%`;
      }
      renderDirty("urban-adaptive-strength");
    });
  }
  if (urbanStrokeOpacity) {
    urbanStrokeOpacity.addEventListener("input", (event) => {
      const cfg = syncUrbanConfig();
      const value = Number(event.target.value);
      cfg.strokeOpacity = clamp(Number.isFinite(value) ? value / 100 : cfg.strokeOpacity, 0, 1);
      if (urbanStrokeOpacityValue) {
        urbanStrokeOpacityValue.textContent = `${Math.round(cfg.strokeOpacity * 100)}%`;
      }
      renderDirty("urban-stroke-opacity");
    });
  }
  if (urbanToneBias) {
    urbanToneBias.addEventListener("input", (event) => {
      const cfg = syncUrbanConfig();
      const value = Number(event.target.value);
      cfg.toneBias = clamp(Number.isFinite(value) ? value / 100 : cfg.toneBias, -0.3, 0.3);
      if (urbanToneBiasValue) {
        urbanToneBiasValue.textContent = formatUrbanToneBias(cfg.toneBias);
      }
      renderDirty("urban-tone-bias");
    });
  }
  if (urbanAdaptiveTintEnabled) {
    urbanAdaptiveTintEnabled.addEventListener("change", (event) => {
      const cfg = syncUrbanConfig();
      cfg.adaptiveTintEnabled = !!event.target.checked;
      syncUrbanControls();
      renderDirty("urban-adaptive-tint-enabled");
    });
  }
  if (urbanAdaptiveTintColor) {
    urbanAdaptiveTintColor.addEventListener("input", (event) => {
      const cfg = syncUrbanConfig();
      cfg.adaptiveTintColor = normalizeOceanFillColor(event.target.value || cfg.adaptiveTintColor || "#f2dea1");
      renderDirty("urban-adaptive-tint-color");
    });
  }
  if (urbanAdaptiveTintStrength) {
    urbanAdaptiveTintStrength.addEventListener("input", (event) => {
      const cfg = syncUrbanConfig();
      const value = Number(event.target.value);
      cfg.adaptiveTintStrength = clamp(Number.isFinite(value) ? value / 100 : cfg.adaptiveTintStrength, 0, 0.5);
      if (urbanAdaptiveTintStrengthValue) {
        urbanAdaptiveTintStrengthValue.textContent = `${Math.round(cfg.adaptiveTintStrength * 100)}%`;
      }
      renderDirty("urban-adaptive-tint-strength");
    });
  }
  if (urbanMinArea) {
    urbanMinArea.addEventListener("input", (event) => {
      const cfg = syncUrbanConfig();
      const value = Number(event.target.value);
      cfg.minAreaPx = clamp(Number.isFinite(value) ? value : 1, 1, 80);
      if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(cfg.minAreaPx)}`;
      renderDirty("urban-area");
    });
  }

  if (physicalPreset) {
    physicalPreset.addEventListener("change", (event) => {
      applyPhysicalPresetConfig(event.target.value || "balanced");
      syncToolbarFromState();
      renderDirty("physical-preset-select");
    });
  }
  if (physicalMode) {
    physicalMode.addEventListener("change", (event) => {
      const cfg = syncPhysicalConfig();
      cfg.mode = String(event.target.value || "atlas_and_contours");
      renderDirty("physical-mode");
    });
  }
  if (physicalOpacity) {
    physicalOpacity.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
      if (physicalOpacityValue) {
        physicalOpacityValue.textContent = `${Math.round(cfg.opacity * 100)}%`;
      }
      renderDirty("physical-opacity");
    });
  }
  if (physicalAtlasIntensity) {
    physicalAtlasIntensity.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.atlasIntensity = clamp(Number.isFinite(value) ? value / 100 : 0.9, 0.2, 1.4);
      if (physicalAtlasIntensityValue) {
        physicalAtlasIntensityValue.textContent = `${Math.round(cfg.atlasIntensity * 100)}%`;
      }
      renderDirty("physical-atlas-intensity");
    });
  }
  if (physicalRainforestEmphasis) {
    physicalRainforestEmphasis.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.rainforestEmphasis = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0, 1);
      if (physicalRainforestEmphasisValue) {
        physicalRainforestEmphasisValue.textContent = `${Math.round(cfg.rainforestEmphasis * 100)}%`;
      }
      renderDirty("physical-rainforest-emphasis");
    });
  }
  if (physicalContourColor) {
    physicalContourColor.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      cfg.contourColor = normalizeOceanFillColor(event.target.value);
      renderDirty("physical-contour-color");
    });
  }
  if (physicalContourOpacity) {
    physicalContourOpacity.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.contourOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.34, 0, 1);
      if (physicalContourOpacityValue) {
        physicalContourOpacityValue.textContent = `${Math.round(cfg.contourOpacity * 100)}%`;
      }
      renderDirty("physical-contour-opacity");
    });
  }
  if (physicalMinorContours) {
    physicalMinorContours.addEventListener("change", (event) => {
      const cfg = syncPhysicalConfig();
      cfg.contourMinorVisible = !!event.target.checked;
      renderDirty("physical-contour-minor-toggle");
    });
  }
  if (physicalContourMajorWidth) {
    physicalContourMajorWidth.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.contourMajorWidth = clamp(Number.isFinite(value) ? value : 0.8, 0.2, 3);
      if (physicalContourMajorWidthValue) {
        physicalContourMajorWidthValue.textContent = Number(cfg.contourMajorWidth).toFixed(2);
      }
      renderDirty("physical-contour-major-width");
    });
  }
  if (physicalContourMinorWidth) {
    physicalContourMinorWidth.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.contourMinorWidth = clamp(Number.isFinite(value) ? value : 0.45, 0.1, 2);
      if (physicalContourMinorWidthValue) {
        physicalContourMinorWidthValue.textContent = Number(cfg.contourMinorWidth).toFixed(2);
      }
      renderDirty("physical-contour-minor-width");
    });
  }
  if (physicalContourMajorInterval) {
    physicalContourMajorInterval.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.contourMajorIntervalM = clamp(
        Number.isFinite(value) ? Math.round(value / 500) * 500 : 500,
        500,
        2000
      );
      if (physicalContourMajorIntervalValue) {
        physicalContourMajorIntervalValue.textContent = `${Math.round(cfg.contourMajorIntervalM)}`;
      }
      renderDirty("physical-contour-major-interval");
    });
  }
  if (physicalContourMinorInterval) {
    physicalContourMinorInterval.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.contourMinorIntervalM = clamp(
        Number.isFinite(value) ? Math.round(value / 100) * 100 : 100,
        100,
        1000
      );
      if (physicalContourMinorIntervalValue) {
        physicalContourMinorIntervalValue.textContent = `${Math.round(cfg.contourMinorIntervalM)}`;
      }
      renderDirty("physical-contour-minor-interval");
    });
  }
  if (physicalContourMajorLowReliefCutoff) {
    physicalContourMajorLowReliefCutoff.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.contourMajorLowReliefCutoffM = clamp(Number.isFinite(value) ? Math.round(value) : 200, 0, 2000);
      if (physicalContourMajorLowReliefCutoffValue) {
        physicalContourMajorLowReliefCutoffValue.textContent = `${Math.round(cfg.contourMajorLowReliefCutoffM)}`;
      }
      renderDirty("physical-contour-major-low-relief-cutoff");
    });
  }
  if (physicalContourMinorLowReliefCutoff) {
    physicalContourMinorLowReliefCutoff.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.contourMinorLowReliefCutoffM = clamp(Number.isFinite(value) ? Math.round(value) : 280, 0, 2000);
      if (physicalContourMinorLowReliefCutoffValue) {
        physicalContourMinorLowReliefCutoffValue.textContent = `${Math.round(cfg.contourMinorLowReliefCutoffM)}`;
      }
      renderDirty("physical-contour-minor-low-relief-cutoff");
    });
  }
  if (physicalBlendMode) {
    physicalBlendMode.addEventListener("change", (event) => {
      const cfg = syncPhysicalConfig();
      cfg.blendMode = String(event.target.value || "source-over");
      renderDirty("physical-blend");
    });
  }
  Object.entries(physicalClassToggleMap).forEach(([key, element]) => {
    if (!element) return;
    element.addEventListener("change", (event) => {
      const cfg = syncPhysicalConfig();
      cfg.atlasClassVisibility = {
        ...(cfg.atlasClassVisibility || {}),
        [key]: !!event.target.checked,
      };
      renderDirty(`physical-class-${key}`);
    });
  });

  if (riversColor) {
    riversColor.addEventListener("input", (event) => {
      state.styleConfig.rivers.color = normalizeOceanFillColor(event.target.value);
      renderDirty("rivers-color");
    });
  }
  if (riversOpacity) {
    riversOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.rivers.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.88, 0, 1);
      if (riversOpacityValue) {
        riversOpacityValue.textContent = `${Math.round(state.styleConfig.rivers.opacity * 100)}%`;
      }
      renderDirty("rivers-opacity");
    });
  }
  if (riversWidth) {
    riversWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.rivers.width = clamp(Number.isFinite(value) ? value : 0.5, 0.2, 4);
      if (riversWidthValue) {
        riversWidthValue.textContent = Number(state.styleConfig.rivers.width).toFixed(2);
      }
      renderDirty("rivers-width");
    });
  }
  if (riversOutlineColor) {
    riversOutlineColor.addEventListener("input", (event) => {
      state.styleConfig.rivers.outlineColor = normalizeOceanFillColor(event.target.value);
      renderDirty("rivers-outline-color");
    });
  }
  if (riversOutlineWidth) {
    riversOutlineWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.rivers.outlineWidth = clamp(Number.isFinite(value) ? value : 0.25, 0, 3);
      if (riversOutlineWidthValue) {
        riversOutlineWidthValue.textContent = Number(state.styleConfig.rivers.outlineWidth).toFixed(2);
      }
      renderDirty("rivers-outline-width");
    });
  }
  if (riversDashStyle) {
    riversDashStyle.addEventListener("change", (event) => {
      state.styleConfig.rivers.dashStyle = String(event.target.value || "solid");
      renderDirty("rivers-dash");
    });
  }

  specialZoneEditorController.bindSpecialZoneEditorEvents();

  if (presetPolitical) {
    presetPolitical.addEventListener("click", async () => {
      if (presetPolitical.disabled) return;
      presetPolitical.disabled = true;
      presetPolitical.classList.add("is-loading");
      const nextOceanFill = applyAutoFillOceanColor();
      dismissOnboardingHint();
      try {
        await Promise.resolve();
        autoFillMap(state.colorMode || "political", {
          styleUpdates: {
            "ocean.fillColor": nextOceanFill,
          },
        });
        markDirty("auto-fill");
        if (render) render();
      } finally {
        presetPolitical.disabled = false;
        presetPolitical.classList.remove("is-loading");
      }
    });
  }

  if (colorModeSelect) {
    colorModeSelect.value = state.colorMode;
    colorModeSelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "region");
      state.colorMode = value === "political" ? "political" : "region";
    });
  }

  if (paintGranularitySelect) {
    paintGranularitySelect.value = state.interactionGranularity || "subdivision";
    paintGranularitySelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "subdivision");
      const requested = value === "country" ? "country" : "subdivision";
      state.interactionGranularity =
        state.paintMode === "sovereignty" ? "subdivision" : requested;
      paintGranularitySelect.value = state.interactionGranularity;
      if (typeof state.updatePaintModeUIFn === "function") {
        state.updatePaintModeUIFn();
      }
    });
  }

  if (quickFillParentBtn) {
    quickFillParentBtn.addEventListener("click", () => {
      state.batchFillScope = "parent";
      closeDockPopover();
      if (typeof state.updatePaintModeUIFn === "function") {
        state.updatePaintModeUIFn();
      }
    });
  }

  if (quickFillCountryBtn) {
    quickFillCountryBtn.addEventListener("click", () => {
      state.batchFillScope = "country";
      closeDockPopover();
      if (typeof state.updatePaintModeUIFn === "function") {
        state.updatePaintModeUIFn();
      }
    });
  }

  if (paintModeSelect) {
    paintModeSelect.value = state.paintMode || "visual";
    paintModeSelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "visual");
      state.paintMode = value === "sovereignty" ? "sovereignty" : "visual";
      if (state.paintMode === "sovereignty") {
        state.interactionGranularity = "subdivision";
        state.ui.politicalEditingExpanded = true;
        if (paintGranularitySelect) {
          paintGranularitySelect.value = "subdivision";
        }
      }
      if (typeof state.updatePaintModeUIFn === "function") {
        state.updatePaintModeUIFn();
      }
      if (render) render();
    });
  }

  if (recalculateBordersBtn) {
    recalculateBordersBtn.addEventListener("click", () => {
      recomputeDynamicBordersNow({ renderNow: true, reason: "manual-toolbar" });
    });
  }

  if (presetClear && !presetClear.dataset.bound) {
    presetClear.addEventListener("click", async () => {
      const confirmed = await showAppDialog({
        title: t("Clear Map", "ui"),
        message: t("Clear the current map?", "ui"),
        details: t(
          "This removes current paint overrides and, in political mode, restores ownership to its baseline. You can undo the clear from history.",
          "ui"
        ),
        confirmLabel: t("Clear Map", "ui"),
        cancelLabel: t("Keep Current Map", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      const featureIds = Object.keys(state.visualOverrides || {});
      const ownerCodes = Array.from(new Set([
        ...Object.keys(state.sovereignBaseColors || {}),
        ...Object.keys(state.countryBaseColors || {}),
      ]));
      const sovereigntyFeatureIds = String(state.paintMode || "visual") === "sovereignty"
        ? Object.keys(state.sovereigntyByFeatureId || {})
        : [];
      const before = captureHistoryState({
        featureIds,
        ownerCodes,
        sovereigntyFeatureIds,
      });
      if (state.paintMode === "sovereignty") {
        if (state.activeScenarioId) {
          resetScenarioToBaselineCommand({
            renderMode: "none",
            markDirtyReason: "",
            showToastOnComplete: false,
          });
        } else {
          resetAllFeatureOwnersToCanonical();
        }
        scheduleDynamicBorderRecompute("clear-sovereignty", 90);
      } else {
        state.colors = {};
        state.visualOverrides = {};
        state.featureOverrides = {};
        state.countryBaseColors = {};
        state.sovereignBaseColors = {};
        markLegacyColorStateDirty();
      }
      refreshColorState({ renderNow: true });
      refreshActiveSovereignLabel();
      refreshDynamicBorderStatus();
      markDirty("clear-map");
      pushHistoryEntry({
        kind: "clear-map",
        before,
        after: captureHistoryState({
          featureIds,
          ownerCodes,
          sovereigntyFeatureIds,
        }),
        meta: {
          affectsSovereignty: state.paintMode === "sovereignty",
        },
      });
      showToast(t("Map cleared. Undo is available from history.", "ui"), {
        title: t("Clear Map", "ui"),
        tone: "warning",
        actionLabel: t("Undo", "ui"),
        onAction: () => {
          if (typeof state.runHistoryActionFn === "function") {
            state.runHistoryActionFn("undo");
            return;
          }
          undoHistory();
        },
      });
    });
    presetClear.dataset.bound = "true";
  }

  if (themeSelect) {
    populatePaletteSourceOptions(themeSelect);
    themeSelect.addEventListener("change", async (event) => {
      const sourceOptions = getPaletteSourceOptions();
      if (!sourceOptions.length) {
        renderPalette(event.target.value);
        renderPaletteLibrary();
        return;
      }
      await handlePaletteSourceChange(event.target.value);
    });
  }
  bindPaletteLibraryPanelEvents();

  if (internalBorderAutoColor) {
    internalBorderAutoColor.checked = String(state.styleConfig.internalBorders.colorMode || "auto") !== "manual";
    if (internalBorderColor) {
      internalBorderColor.disabled = internalBorderAutoColor.checked;
    }
    internalBorderAutoColor.addEventListener("change", (event) => {
      state.styleConfig.internalBorders.colorMode = event.target.checked ? "auto" : "manual";
      if (internalBorderColor) {
        internalBorderColor.disabled = event.target.checked;
      }
      renderDirty("internal-border-color-mode");
    });
  }
  if (internalBorderColor) {
    internalBorderColor.addEventListener("input", (event) => {
      state.styleConfig.internalBorders.color = event.target.value;
      state.styleConfig.internalBorders.colorMode = "manual";
      if (internalBorderAutoColor) {
        internalBorderAutoColor.checked = false;
      }
      internalBorderColor.disabled = false;
      renderDirty("internal-border-color");
    });
  }
  if (internalBorderOpacity) {
    internalBorderOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value) / 100;
      state.styleConfig.internalBorders.opacity = Number.isFinite(value) ? value : 1;
      if (internalBorderOpacityValue) {
        internalBorderOpacityValue.textContent = `${event.target.value}%`;
      }
      renderDirty("internal-border-opacity");
    });
  }
  if (internalBorderWidth) {
    const initialInternalWidth = Number(internalBorderWidth.value);
    if (Number.isFinite(initialInternalWidth)) {
      state.styleConfig.internalBorders.width = initialInternalWidth;
      if (internalBorderWidthValue) {
        internalBorderWidthValue.textContent = initialInternalWidth.toFixed(2);
      }
    }
    internalBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.internalBorders.width = Number.isFinite(value) ? value : 0.5;
      if (internalBorderWidthValue) {
        internalBorderWidthValue.textContent = value.toFixed(2);
      }
      renderDirty("internal-border-width");
    });
  }

  if (empireBorderColor) {
    empireBorderColor.addEventListener("input", (event) => {
      state.styleConfig.empireBorders.color = event.target.value;
      renderDirty("empire-border-color");
    });
  }
  if (empireBorderWidth) {
    const initialEmpireWidth = Number(empireBorderWidth.value);
    if (Number.isFinite(initialEmpireWidth)) {
      state.styleConfig.empireBorders.width = initialEmpireWidth;
      if (empireBorderWidthValue) {
        empireBorderWidthValue.textContent = initialEmpireWidth.toFixed(2);
      }
    }
    empireBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.empireBorders.width = Number.isFinite(value) ? value : 1.0;
      if (empireBorderWidthValue) {
        empireBorderWidthValue.textContent = value.toFixed(2);
      }
      renderDirty("empire-border-width");
    });
  }

  if (coastlineColor) {
    coastlineColor.addEventListener("input", (event) => {
      state.styleConfig.coastlines.color = event.target.value;
      renderDirty("coastline-color");
    });
  }
  if (coastlineWidth) {
    coastlineWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.coastlines.width = Number.isFinite(value) ? value : 1.2;
      if (coastlineWidthValue) {
        coastlineWidthValue.textContent = value.toFixed(1);
      }
      renderDirty("coastline-width");
    });
  }

  if (parentBorderColor) {
    parentBorderColor.value = state.styleConfig.parentBorders.color || "#4b5563";
    parentBorderColor.addEventListener("input", (event) => {
      state.styleConfig.parentBorders.color = event.target.value;
      renderDirty("parent-border-color");
    });
  }
  if (parentBorderOpacity) {
    const initial = Math.round((state.styleConfig.parentBorders.opacity || 0.85) * 100);
    parentBorderOpacity.value = String(clamp(initial, 0, 100));
    if (parentBorderOpacityValue) {
      parentBorderOpacityValue.textContent = `${parentBorderOpacity.value}%`;
    }
    parentBorderOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.parentBorders.opacity = clamp(
        Number.isFinite(value) ? value / 100 : 0.85,
        0,
        1
      );
      if (parentBorderOpacityValue) {
        parentBorderOpacityValue.textContent = `${event.target.value}%`;
      }
      renderDirty("parent-border-opacity");
    });
  }
  if (parentBorderWidth) {
    const initial = Number(state.styleConfig.parentBorders.width || 1.1);
    parentBorderWidth.value = String(clamp(initial, 0.2, 4));
    if (parentBorderWidthValue) {
      parentBorderWidthValue.textContent = Number(parentBorderWidth.value).toFixed(2);
    }
    parentBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.parentBorders.width = clamp(Number.isFinite(value) ? value : 1.1, 0.2, 4);
      if (parentBorderWidthValue) {
        parentBorderWidthValue.textContent = state.styleConfig.parentBorders.width.toFixed(2);
      }
      renderDirty("parent-border-width");
    });
  }
  if (parentBordersVisible) {
    parentBordersVisible.checked = state.parentBordersVisible !== false;
    parentBordersVisible.addEventListener("change", (event) => {
      state.parentBordersVisible = !!event.target.checked;
      syncParentBorderVisibilityUI();
      renderParentBorderCountryList();
      renderDirty("parent-border-visibility");
    });
  }
  if (parentBorderEnableAll) {
    parentBorderEnableAll.addEventListener("click", () => {
      const supported = Array.isArray(state.parentBorderSupportedCountries)
        ? state.parentBorderSupportedCountries
        : [];
      supported.forEach((countryCode) => {
        state.parentBorderEnabledByCountry[countryCode] = true;
      });
      renderParentBorderCountryList();
      renderDirty("parent-border-enable-all");
    });
  }
  if (parentBorderDisableAll) {
    parentBorderDisableAll.addEventListener("click", () => {
      const supported = Array.isArray(state.parentBorderSupportedCountries)
        ? state.parentBorderSupportedCountries
        : [];
      supported.forEach((countryCode) => {
        state.parentBorderEnabledByCountry[countryCode] = false;
      });
      renderParentBorderCountryList();
      renderDirty("parent-border-disable-all");
    });
  }

  if (oceanStyleSelect) {
    renderOceanAdvancedStylesUi();
    oceanStyleSelect.addEventListener("change", (event) => {
      const nextPreset = normalizeOceanPreset(event.target.value);
      if (!oceanAdvancedStylesEnabled() && OCEAN_ADVANCED_PRESETS.has(nextPreset)) {
        state.styleConfig.ocean.preset = "flat";
        event.target.value = "flat";
      } else {
        state.styleConfig.ocean.preset = nextPreset;
        applyBathymetryPresetDefaults(nextPreset);
      }
      syncOceanPresetControlValues();
      renderOceanBathymetryDebugUi();
      applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-style");
    });
  }

  if (oceanTextureOpacity) {
    const initial = Math.round((state.styleConfig.ocean.opacity || 0.72) * 100);
    oceanTextureOpacity.value = String(clamp(initial, 0, 100));
    if (oceanTextureOpacityValue) {
      oceanTextureOpacityValue.textContent = `${oceanTextureOpacity.value}%`;
    }
    bindOceanVisualInput(oceanTextureOpacity, (event, commitNow) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0, 1);
      if (oceanTextureOpacityValue) {
        oceanTextureOpacityValue.textContent = `${event.target.value}%`;
      }
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-opacity");
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanVisualState, "ocean-opacity");
    });
  }

  if (oceanTextureScale) {
    const initial = state.styleConfig.ocean.scale || 1;
    oceanTextureScale.value = String(Math.round(clamp(initial, 0.6, 2.4) * 100));
    if (oceanTextureScaleValue) {
      oceanTextureScaleValue.textContent = `${(Number(oceanTextureScale.value) / 100).toFixed(2)}x`;
    }
    bindOceanVisualInput(oceanTextureScale, (event, commitNow) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.scale = clamp(Number.isFinite(value) ? value / 100 : 1, 0.6, 2.4);
      if (oceanTextureScaleValue) {
        oceanTextureScaleValue.textContent = `${state.styleConfig.ocean.scale.toFixed(2)}x`;
      }
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-scale");
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanVisualState, "ocean-scale");
    });
  }

  if (oceanContourStrength) {
    const initial = Math.round((state.styleConfig.ocean.contourStrength || 0.75) * 100);
    oceanContourStrength.value = String(clamp(initial, 0, 100));
    if (oceanContourStrengthValue) {
      oceanContourStrengthValue.textContent = `${oceanContourStrength.value}%`;
    }
    bindOceanVisualInput(oceanContourStrength, (event, commitNow) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.contourStrength = clamp(Number.isFinite(value) ? value / 100 : 0.75, 0, 1);
      if (oceanContourStrengthValue) {
        oceanContourStrengthValue.textContent = `${event.target.value}%`;
      }
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-contour");
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanVisualState, "ocean-contour");
    });
  }

  if (oceanAdvancedStylesToggle && !oceanAdvancedStylesToggle.dataset.bound) {
    oceanAdvancedStylesToggle.checked = oceanAdvancedStylesEnabled();
    oceanAdvancedStylesToggle.addEventListener("change", (event) => {
      state.styleConfig.ocean.experimentalAdvancedStyles = !!event.target.checked;
      if (!state.styleConfig.ocean.experimentalAdvancedStyles && OCEAN_ADVANCED_PRESETS.has(state.styleConfig.ocean.preset)) {
        state.styleConfig.ocean.preset = "flat";
      }
      syncOceanPresetControlValues();
      renderOceanAdvancedStylesUi();
      renderOceanBathymetryDebugUi();
      applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-experimental-advanced-styles");
    });
    oceanAdvancedStylesToggle.dataset.bound = "true";
  }

  if (oceanCoastalAccentToggle && !oceanCoastalAccentToggle.dataset.bound) {
    oceanCoastalAccentToggle.checked = state.styleConfig.ocean.coastalAccentEnabled !== false;
    oceanCoastalAccentToggle.addEventListener("change", (event) => {
      state.styleConfig.ocean.coastalAccentEnabled = !!event.target.checked;
      applyOceanVisualUpdateNow(invalidateOceanCoastalAccentVisualState, "ocean-coastal-accent");
    });
    oceanCoastalAccentToggle.dataset.bound = "true";
  }

  const bindOceanZoomDebugInput = (element, valueEl, stateKey, min, max, reason) => {
    if (!element) return;
    element.value = String(Math.round(clamp(Number(state.styleConfig.ocean[stateKey]) || min, min, max) * 100));
    if (valueEl) {
      valueEl.textContent = `${(Number(element.value) / 100).toFixed(2)}x`;
    }
    bindOceanVisualInput(element, (event, commitNow) => {
      const nextValue = clamp(Number(event.target.value) / 100, min, max);
      state.styleConfig.ocean[stateKey] = nextValue;
      if (valueEl) {
        valueEl.textContent = `${nextValue.toFixed(2)}x`;
      }
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanVisualState, reason);
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanVisualState, reason);
    });
  };

  bindOceanZoomDebugInput(
    oceanShallowFadeEndZoom,
    oceanShallowFadeEndZoomValue,
    "shallowBandFadeEndZoom",
    2.1,
    4.8,
    "ocean-shallow-band-fade"
  );
  bindOceanZoomDebugInput(
    oceanMidFadeEndZoom,
    oceanMidFadeEndZoomValue,
    "midBandFadeEndZoom",
    2.7,
    5.2,
    "ocean-mid-band-fade"
  );
  bindOceanZoomDebugInput(
    oceanDeepFadeEndZoom,
    oceanDeepFadeEndZoomValue,
    "deepBandFadeEndZoom",
    3.3,
    6,
    "ocean-deep-band-fade"
  );
  bindOceanZoomDebugInput(
    oceanScenarioSyntheticContourFadeEndZoom,
    oceanScenarioSyntheticContourFadeEndZoomValue,
    "scenarioSyntheticContourFadeEndZoom",
    2.1,
    4.6,
    "ocean-scenario-synthetic-contour-fade"
  );
  bindOceanZoomDebugInput(
    oceanScenarioShallowContourFadeEndZoom,
    oceanScenarioShallowContourFadeEndZoomValue,
    "scenarioShallowContourFadeEndZoom",
    2.5,
    5,
    "ocean-scenario-shallow-contour-fade"
  );

  if (lakeLinkToOcean && !lakeLinkToOcean.dataset.bound) {
    lakeLinkToOcean.checked = !!syncLakeConfig().linkedToOcean;
    lakeLinkToOcean.addEventListener("change", (event) => {
      beginLakeHistoryCapture();
      const lakeConfig = syncLakeConfig();
      lakeConfig.linkedToOcean = !!event.target.checked;
      renderLakeUi();
      applyOceanVisualUpdateNow(invalidateOceanWaterInteractionVisualState, "lake-link");
      commitLakeHistory("lake-link");
    });
    lakeLinkToOcean.dataset.bound = "true";
  }

  if (lakeFillColor && !lakeFillColor.dataset.bound) {
    bindOceanVisualInput(lakeFillColor, (event, commitNow) => {
      const lakeConfig = syncLakeConfig();
      if (lakeConfig.linkedToOcean) {
        renderLakeUi();
        return;
      }
      beginLakeHistoryCapture();
      lakeConfig.fillColor = normalizeOceanFillColor(event.target.value);
      renderLakeUi();
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanWaterInteractionVisualState, "lake-fill");
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanWaterInteractionVisualState, "lake-fill");
    }, () => {
      const lakeConfig = syncLakeConfig();
      if (lakeConfig.linkedToOcean) return;
      commitLakeHistory("lake-fill");
      applyOceanVisualUpdateNow(invalidateOceanWaterInteractionVisualState, "lake-fill");
    });
  }

  const referenceImage = document.getElementById("referenceImage");
  const applyReferenceStyles = () => {
    if (!referenceImage) return;
    referenceImage.style.opacity = String(state.referenceImageState.opacity);
    referenceImage.style.transform = `translate(${state.referenceImageState.offsetX}px, ${state.referenceImageState.offsetY}px) scale(${state.referenceImageState.scale})`;
  };

  if (referenceImageInput) {
    referenceImageInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!referenceImage) return;
      if (!file) {
        if (state.referenceImageUrl) {
          URL.revokeObjectURL(state.referenceImageUrl);
          state.referenceImageUrl = null;
        }
        referenceImage.src = "";
        referenceImage.style.opacity = "0";
        markDirty("reference-image-clear");
        return;
      }
      if (state.referenceImageUrl) {
        URL.revokeObjectURL(state.referenceImageUrl);
      }
      state.referenceImageUrl = URL.createObjectURL(file);
      referenceImage.src = state.referenceImageUrl;
      applyReferenceStyles();
      markDirty("reference-image-file");
    });
  }

  if (referenceOpacity) {
    state.referenceImageState.opacity = Number(referenceOpacity.value) / 100;
    if (referenceOpacityValue) {
      referenceOpacityValue.textContent = `${referenceOpacity.value}%`;
    }
    referenceOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.referenceImageState.opacity = Number.isFinite(value) ? value / 100 : 0.6;
      if (referenceOpacityValue) {
        referenceOpacityValue.textContent = `${event.target.value}%`;
      }
      applyReferenceStyles();
      markDirty("reference-opacity");
    });
  }

  if (referenceScale) {
    state.referenceImageState.scale = Number(referenceScale.value);
    if (referenceScaleValue) {
      referenceScaleValue.textContent = `${Number(referenceScale.value).toFixed(2)}x`;
    }
    referenceScale.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.referenceImageState.scale = Number.isFinite(value) ? value : 1;
      if (referenceScaleValue) {
        referenceScaleValue.textContent = `${state.referenceImageState.scale.toFixed(2)}x`;
      }
      applyReferenceStyles();
      markDirty("reference-scale");
    });
  }

  if (referenceOffsetX) {
    state.referenceImageState.offsetX = Number(referenceOffsetX.value);
    if (referenceOffsetXValue) {
      referenceOffsetXValue.textContent = `${referenceOffsetX.value}px`;
    }
    referenceOffsetX.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.referenceImageState.offsetX = Number.isFinite(value) ? value : 0;
      if (referenceOffsetXValue) {
        referenceOffsetXValue.textContent = `${state.referenceImageState.offsetX}px`;
      }
      applyReferenceStyles();
      markDirty("reference-offset-x");
    });
  }

  if (referenceOffsetY) {
    state.referenceImageState.offsetY = Number(referenceOffsetY.value);
    if (referenceOffsetYValue) {
      referenceOffsetYValue.textContent = `${referenceOffsetY.value}px`;
    }
    referenceOffsetY.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.referenceImageState.offsetY = Number.isFinite(value) ? value : 0;
      if (referenceOffsetYValue) {
        referenceOffsetYValue.textContent = `${state.referenceImageState.offsetY}px`;
      }
      applyReferenceStyles();
      markDirty("reference-offset-y");
    });
  }

  if (!state.ui.overlayResizeBound) {
    globalThis.addEventListener("resize", () => {
      applyResponsiveChromeDefaults();
      updateDockCollapsedUi();
      refreshScenarioContextBar();
      handlePaletteLibraryResize();
    });
    state.ui.overlayResizeBound = true;
  }

  syncPaletteLibraryPanelVisibility();
  syncPaletteSourceControls();
  renderPalette(state.currentPaletteTheme);
  renderPaletteLibrary();
  syncPanelToggleButtons();
  renderTransportWorkbenchUi();
  renderExportWorkbenchLayerList();
  state.updatePaintModeUIFn();
  state.updateDockCollapsedUiFn = updateDockCollapsedUi;
  updateDockCollapsedUi();
  setAppearanceTab("ocean");
  applyAppearanceFilter();
  refreshScenarioContextBar();
  renderRecentColors();
  renderParentBorderCountryList();
  renderSpecialZoneEditorUI();
  renderTransportAppearanceUi();
  updateHistoryUi();
  updateZoomUi();
  updateSwatchUI();
  updateToolUI();
  closeDockPopover({ syncUrl: false });
  closeSpecialZonePopover();
  closeScenarioGuidePopover({ syncUrl: false });
  if (dockReferencePopover) {
    dockReferencePopover.setAttribute("aria-hidden", "true");
  }
  if (exportWorkbenchOverlay) {
    exportWorkbenchOverlay.setAttribute("aria-hidden", "true");
  }
  if (scenarioGuidePopover) {
    applyDialogContract(scenarioGuidePopover, {
      tone: "info",
      labelledBy: "scenarioGuideTitle",
      describedBy: ["scenarioGuideSupportHint"],
    });
    scenarioGuidePopover.setAttribute("aria-hidden", "true");
  }
  if (scenarioGuideBackdrop) {
    scenarioGuideBackdrop.setAttribute("aria-hidden", "true");
  }
  renderScenarioGuideSection("quick");
  syncScenarioGuideTriggerButtons({
    isOpen: false,
    tutorialEntryVisible: !!state.ui.tutorialEntryVisible,
  });
  if (specialZonePopover) {
    specialZonePopover.setAttribute("aria-hidden", specialZonePopover.classList.contains("hidden") ? "true" : "false");
  }
  if (mapOnboardingHint) {
    mapOnboardingHint.setAttribute("role", "status");
    mapOnboardingHint.setAttribute("aria-live", "polite");
    if (state.onboardingDismissed) {
      dismissOnboardingHint();
    } else {
      showOnboardingHint();
    }
  }
  updateUIText();
}



export { initToolbar, resolveExportPassSequence };
