// Toolbar UI (Phase 13)
import {
  state,
  PALETTE_THEMES,
  normalizeExportWorkbenchUiState,
  normalizeLakeStyleConfig,
  normalizePhysicalStyleConfig,
  normalizeTextureStyleConfig,
  normalizeUrbanStyleConfig,
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
import { createOceanLakeControlsController } from "./toolbar/ocean_lake_controls_controller.js";
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
import { createAppearanceControlsController } from "./toolbar/appearance_controls_controller.js";
import { createScenarioGuidePopoverController } from "./toolbar/scenario_guide_popover.js";
import { createSpecialZoneEditorController } from "./toolbar/special_zone_editor.js";
import { createTransportWorkbenchController } from "./toolbar/transport_workbench_controller.js";
import { createWorkspaceChromeSupportSurfaceController } from "./toolbar/workspace_chrome_support_surface_controller.js";

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

  const focusOverlaySurface = (container) => focusSurface(container);
  const rememberOverlayTrigger = (overlay, trigger) => rememberSurfaceTrigger(overlayFocusReturnTargets, overlay, trigger);
  const restoreOverlayTriggerFocus = (overlay, explicitTrigger = null) => (
    restoreSurfaceTriggerFocus(overlayFocusReturnTargets, overlay, explicitTrigger)
  );
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

  const workspaceChromeSupportSurfaceController = createWorkspaceChromeSupportSurfaceController({
    state,
    uiUrlStateKeys: UI_URL_STATE_KEYS,
    scenarioGuideBtn,
    utilitiesGuideBtn,
    scenarioGuidePopover,
    scenarioGuideBackdrop,
    openScenarioGuideSurface,
    closeScenarioGuideSurface,
    dockReferenceBtn,
    dockEditPopoverBtn,
    dockQuickFillBtn,
    dockReferencePopover,
    dockEditPopover,
    dockQuickFillRow,
    exportWorkbenchOverlay,
    exportWorkbenchPanel,
    dockExportBtn,
    exportProjectSection,
    inspectorUtilitiesSection,
    inspectorSidebarTabProject,
    appearanceSpecialZoneBtn,
    specialZonePopover,
    isSpecialZoneInline: () => specialZoneEditorInline,
    closeSpecialZonePopover: () => closeSpecialZonePopover(),
    closeTransportWorkbenchInfoPopover,
    closeTransportWorkbenchSectionHelpPopover,
    transportWorkbenchInfoPopover,
    transportWorkbenchInfoBtn,
    transportWorkbenchSectionHelpPopover,
    rememberOverlayTrigger,
    restoreOverlayTriggerFocus,
    focusOverlaySurface,
    getFocusableElements,
    ensureTransportWorkbenchUiState,
    ensureRightPanelVisible: () => state.toggleRightPanelFn?.(true),
    openExportWorkbench: (trigger = dockExportBtn) => state.openExportWorkbenchFn?.(trigger),
    closeExportWorkbench: ({ restoreFocus = true } = {}) => state.closeExportWorkbenchFn?.({ restoreFocus }),
  });
  const {
    bindDockPopoverDismiss,
    closeDockPopover,
    closeScenarioGuidePopover,
    openDockPopover,
    restoreSupportSurfaceFromUrl,
    syncSupportSurfaceUrlState,
    toggleScenarioGuidePopover,
  } = workspaceChromeSupportSurfaceController;
  state.restoreSupportSurfaceFromUrlFn = restoreSupportSurfaceFromUrl;
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
  const persistCityViewSettings = () => {
    state.persistViewSettingsFn?.();
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
  state.styleConfig.urban = normalizeUrbanStyleConfig(state.styleConfig.urban);
  if (state.styleConfig.urban.mode === "manual") {
    state.styleConfig.urban.color = normalizeOceanFillColor(state.styleConfig.urban.color || "#4b5563");
  }
  state.styleConfig.urban.adaptiveTintColor = normalizeOceanFillColor(
    state.styleConfig.urban.adaptiveTintColor || "#f2dea1"
  );

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

  state.updatePaletteLibraryUIFn = renderPaletteLibrary;

  function renderSpecialZoneEditorUI() {
    if (toggleWaterRegions) toggleWaterRegions.checked = !!state.showWaterRegions;
    if (toggleOpenOceanRegions) toggleOpenOceanRegions.checked = !!state.showOpenOceanRegions;
    if (toggleSpecialZones) toggleSpecialZones.checked = !!state.showSpecialZones;
    if (toggleAirports) toggleAirports.checked = !!state.showAirports;
    if (togglePorts) togglePorts.checked = !!state.showPorts;
    renderAppearanceStyleControlsUi();
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

  const appearanceControlsController = createAppearanceControlsController({
    state,
    t,
    clamp,
    markDirty,
    renderDirty,
    ensureActiveScenarioOptionalLayerLoaded,
    normalizeOceanFillColor,
    updateSwatchUI,
    openSpecialZonePopover,
  });
  const {
    applyAppearanceFilter,
    bindEvents: bindAppearanceControlEvents,
    renderAppearanceStyleControlsUi,
    renderDayNightUI,
    renderParentBorderCountryList,
    renderRecentColors,
    renderReferenceOverlayUi,
    renderTextureUI,
    renderTransportAppearanceUi,
    setAppearanceTab,
    syncParentBorderVisibilityUI,
  } = appearanceControlsController;
  state.updateTransportAppearanceUIFn = renderTransportAppearanceUi;
  state.updateRecentUI = () => {
    renderRecentColors();
    renderPalette(state.currentPaletteTheme);
    renderPaletteLibrary();
  };
  state.updateParentBorderCountryListFn = renderParentBorderCountryList;

  const oceanLakeControlsController = createOceanLakeControlsController({
    state,
    t,
    clamp,
    renderDirty,
    normalizeOceanFillColor,
    normalizeOceanPreset,
    advancedPresets: OCEAN_ADVANCED_PRESETS,
    getBathymetryPresetStyleDefaults,
    invalidateOceanBackgroundVisualState,
    invalidateOceanCoastalAccentVisualState,
    invalidateOceanVisualState,
    invalidateOceanWaterInteractionVisualState,
    oceanFillColor,
    lakeLinkToOcean,
    lakeFillColor,
    oceanCoastalAccentRow,
    oceanCoastalAccentToggle,
    oceanAdvancedStylesToggle,
    oceanStyleSelect,
    oceanStylePresetHint,
    oceanTextureOpacity,
    oceanTextureScale,
    oceanContourStrength,
    oceanBathymetryDebugDetails,
    oceanBathymetrySourceValue,
    oceanBathymetryBandsValue,
    oceanBathymetryContoursValue,
    oceanShallowFadeEndZoom,
    oceanMidFadeEndZoom,
    oceanDeepFadeEndZoom,
    oceanScenarioSyntheticContourFadeEndZoom,
    oceanScenarioShallowContourFadeEndZoom,
    oceanTextureOpacityValue,
    oceanTextureScaleValue,
    oceanContourStrengthValue,
    oceanShallowFadeEndZoomValue,
    oceanMidFadeEndZoomValue,
    oceanDeepFadeEndZoomValue,
    oceanScenarioSyntheticContourFadeEndZoomValue,
    oceanScenarioShallowContourFadeEndZoomValue,
  });
  const {
    applyAutoFillOceanColor,
    bindEvents: bindOceanLakeControlEvents,
    renderOceanCoastalAccentUi,
    renderOceanLakeControlsUi,
  } = oceanLakeControlsController;
  renderOceanLakeControlsUi();

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
    renderOceanLakeControlsUi();
    if (colorModeSelect) {
      colorModeSelect.value = state.colorMode || "political";
    }
    if (themeSelect) {
      themeSelect.value = String(state.activePaletteId || themeSelect.value || "");
    }
    renderReferenceOverlayUi();
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

  bindAppearanceControlEvents();
  bindOceanLakeControlEvents();
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
