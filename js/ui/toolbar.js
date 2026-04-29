// Toolbar UI (Phase 13)
import {
  state as runtimeState,
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
  refreshResolvedColorsForFeatures,
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
} from "../core/map_renderer/public.js";
import { captureHistoryState, canRedoHistory, canUndoHistory, pushHistoryEntry, redoHistory, undoHistory } from "../core/history_manager.js";
import { callRuntimeHook, registerRuntimeHook } from "../core/state/index.js";
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
import { createUiSurfaceUrlState } from "./ui_surface_url_state.js";
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
  resolveExportPassSequence,
} from "./toolbar/export_workbench_controller.js";
import { createPaletteLibraryPanelController } from "./toolbar/palette_library_panel.js";
import { createAppearanceControlsController } from "./toolbar/appearance_controls_controller.js";
import { createScenarioGuidePopoverController } from "./toolbar/scenario_guide_popover.js";
import { createSpecialZoneEditorController } from "./toolbar/special_zone_editor.js";
import {
  createTransportWorkbenchController,
  TRANSPORT_WORKBENCH_INSPECTOR_TABS,
} from "./toolbar/transport_workbench_controller.js";
import { createWorkspaceChromeSupportSurfaceController } from "./toolbar/workspace_chrome_support_surface_controller.js";
const state = runtimeState;

// Quick Colors 优先反映当前 palette pack，未启用 pack 时再退回静态主题色。
// 这样 toolbar 的快速选色和 Palette Library 会共享同一份颜色来源语义。
function renderPalette(themeName) {
  const paletteGrid = document.getElementById("paletteGrid");
  if (!paletteGrid) return;
  runtimeState.currentPaletteTheme = themeName;
  paletteGrid.replaceChildren();

  let swatches = [];
  if (runtimeState.activePalettePack?.entries) {
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
      runtimeState.selectedColor = normalized;
      callRuntimeHook(state, "updateSwatchUIFn");
    });
    paletteGrid.appendChild(btn);
  });

  if (!normalizeHexColor(runtimeState.selectedColor) && swatches.length > 0) {
    runtimeState.selectedColor = swatches[0];
  }
  callRuntimeHook(state, "updateSwatchUIFn");
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
    select.value = runtimeState.activePaletteId || sourceOptions[0]?.value || "";
    return;
  }

  Object.keys(PALETTE_THEMES).forEach((themeName) => {
    const option = document.createElement("option");
    option.value = themeName;
    option.textContent = themeName;
    select.appendChild(option);
  });
  select.value = runtimeState.currentPaletteTheme;
}

const EXPORT_MAX_DIMENSION_PX = 7680;
const EXPORT_MAX_PIXELS = 7680 * 4320;
const EXPORT_MAX_CONCURRENT_JOBS = 1;

function resolveExportBaseDimensions() {
  const dpr = Math.max(1, Number(runtimeState.dpr || globalThis.devicePixelRatio || 1));
  const fallbackLogicalWidth = Number(runtimeState.colorCanvas?.width || 0) / dpr;
  const fallbackLogicalHeight = Number(runtimeState.colorCanvas?.height || 0) / dpr;
  const width = Math.round(Number(runtimeState.width || fallbackLogicalWidth || 0));
  const height = Math.round(Number(runtimeState.height || fallbackLogicalHeight || 0));
  return { width, height };
}


function initToolbar({ render } = {}) {
  // toolbar.js 保留的是壳层接线职责：集中拿 DOM、拼 controller、注册 runtime hooks。
  // 各个面板自身的业务逻辑应继续留在子 controller，避免再把 owner 逻辑回流到这个大文件。
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
  const paletteLibrarySearchClear = document.getElementById("paletteLibrarySearchClear");
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
  const SCENARIO_BAR_BASE_MAX_WIDTH = 560;
  const SCENARIO_BAR_NARROW_WIDTH = 360;
  const SCENARIO_GUIDE_MAX_WIDTH = 360;
  const SCENARIO_GUIDE_VERTICAL_GAP = 10;
  if (!runtimeState.ui || typeof runtimeState.ui !== "object") {
    runtimeState.ui = {};
  }
  runtimeState.ui.dockCollapsed = !!runtimeState.ui.dockCollapsed;
  runtimeState.ui.scenarioBarCollapsed = !!runtimeState.ui.scenarioBarCollapsed;
  runtimeState.ui.scenarioGuideDismissed = !!runtimeState.ui.scenarioGuideDismissed;
  runtimeState.ui.politicalEditingExpanded = !!runtimeState.ui.politicalEditingExpanded;
  runtimeState.ui.scenarioVisualAdjustmentsOpen = !!runtimeState.ui.scenarioVisualAdjustmentsOpen;
  runtimeState.ui.developerMode = !!runtimeState.ui.developerMode;
  runtimeState.ui.tutorialEntryVisible = runtimeState.ui.tutorialEntryVisible !== false;
  runtimeState.ui.tutorialDismissed = !!runtimeState.ui.tutorialDismissed;
  runtimeState.ui.responsiveChromeTier = String(runtimeState.ui.responsiveChromeTier || "");
  if (!runtimeState.ui.paletteLibrarySections || typeof runtimeState.ui.paletteLibrarySections !== "object") {
    runtimeState.ui.paletteLibrarySections = {};
  }
  const uiSurfaceUrlState = createUiSurfaceUrlState({
    uiUrlStateKeys: UI_URL_STATE_KEYS,
  });
  const {
    getScenarioGuideSectionFromUrl,
    getSupportSurfaceViewFromUrl,
    syncScenarioGuideSectionUrlState,
    syncSupportSurfaceUrlState,
  } = uiSurfaceUrlState;

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
    getGuideSectionFromUrl: getScenarioGuideSectionFromUrl,
    onSectionChange: syncScenarioGuideSectionUrlState,
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
    if (runtimeState.ui.responsiveChromeTier === nextTier) return;
    if (nextTier === "mobile") {
      runtimeState.ui.dockCollapsed = true;
      runtimeState.ui.scenarioBarCollapsed = true;
    }
    runtimeState.ui.responsiveChromeTier = nextTier;
  };
  applyResponsiveChromeDefaults();

  const persistDeveloperMode = () => {
    try {
      globalThis.localStorage?.setItem(
        DEVELOPER_MODE_STORAGE_KEY,
        runtimeState.ui.developerMode ? "true" : "false"
      );
    } catch {}
  };

  const updateLanguageToggleUi = () => {
    if (!toggleLang) return;
    const nextLang = runtimeState.currentLanguage === "zh" ? "EN" : "ZH";
    const buttonLabel = runtimeState.currentLanguage === "zh" ? "ZH / EN" : "EN / ZH";
    toggleLang.textContent = buttonLabel;
    toggleLang.setAttribute("title", `${t("Language", "ui")}: ${nextLang}`);
  };

  const syncDeveloperModeUi = () => {
    document.body?.classList.toggle("developer-mode", !!runtimeState.ui.developerMode);
    if (developerModeBtn) {
      const buttonLabel = runtimeState.ui.developerMode
        ? t("Hide development workspace", "ui")
        : t("Show development workspace", "ui");
      developerModeBtn.classList.toggle("is-active", !!runtimeState.ui.developerMode);
      developerModeBtn.setAttribute("aria-pressed", runtimeState.ui.developerMode ? "true" : "false");
      developerModeBtn.setAttribute("aria-label", buttonLabel);
      developerModeBtn.setAttribute("title", buttonLabel);
    }
    if (!runtimeState.ui.developerMode && runtimeState.ui.devWorkspaceExpanded) {
      if (typeof runtimeState.setDevWorkspaceExpandedFn === "function") {
        callRuntimeHook(state, "setDevWorkspaceExpandedFn", false);
      } else if (devWorkspaceToggleBtn) {
        devWorkspaceToggleBtn.click();
      }
    }
  };

  const setDeveloperMode = (nextValue) => {
    const normalized = !!nextValue;
    if (runtimeState.ui.developerMode === normalized) {
      syncDeveloperModeUi();
      return;
    }
    runtimeState.ui.developerMode = normalized;
    persistDeveloperMode();
    syncDeveloperModeUi();
  };

  try {
    const storedDeveloperMode = globalThis.localStorage?.getItem(DEVELOPER_MODE_STORAGE_KEY);
    if (storedDeveloperMode === "true" || storedDeveloperMode === "false") {
      runtimeState.ui.developerMode = storedDeveloperMode === "true";
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

  // support surface owner 统一协调 guide / dock / export / transport info 这类跨面板壳层行为。
  // 这样 URL restore、focus restore、outside click/Escape 关闭链只维护一处真相源。
  const workspaceChromeSupportSurfaceController = createWorkspaceChromeSupportSurfaceController({
    state,
    getSupportSurfaceViewFromUrl,
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
    syncSupportSurfaceUrlState,
    ensureRightPanelVisible: () => runtimeState.toggleRightPanelFn?.(true),
    openExportWorkbench: (trigger = dockExportBtn) => runtimeState.openExportWorkbenchFn?.(trigger),
    closeExportWorkbench: ({ restoreFocus = true } = {}) => runtimeState.closeExportWorkbenchFn?.({ restoreFocus }),
  });
  const {
    bindDockPopoverDismiss,
    closeDockPopover,
    closeScenarioGuidePopover,
    openDockPopover,
    restoreSupportSurfaceFromUrl,
    toggleScenarioGuidePopover,
  } = workspaceChromeSupportSurfaceController;
  registerRuntimeHook(state, "restoreSupportSurfaceFromUrlFn", restoreSupportSurfaceFromUrl);
  registerRuntimeHook(state, "closeDockPopoverFn", closeDockPopover);

  const syncPanelToggleButtons = () => {
    leftPanelToggle?.setAttribute("aria-expanded", String(document.body.classList.contains("left-drawer-open")));
    rightPanelToggle?.setAttribute("aria-expanded", String(document.body.classList.contains("right-drawer-open")));
  };

  const toggleLeftPanel = (force) => {
    if (runtimeState.transportWorkbenchUi?.open && force !== false) {
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
    if (runtimeState.transportWorkbenchUi?.open && force !== false) {
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
    runtimeState.ui.dockCollapsed = typeof force === "boolean" ? force : !runtimeState.ui.dockCollapsed;
    if (runtimeState.ui.dockCollapsed) {
      closeDockPopover();
    }
    updateDockCollapsedUi();
    return runtimeState.ui.dockCollapsed;
  };

  registerRuntimeHook(state, "toggleLeftPanelFn", toggleLeftPanel);
  registerRuntimeHook(state, "toggleRightPanelFn", toggleRightPanel);
  registerRuntimeHook(state, "toggleDockFn", toggleDock);
  registerRuntimeHook(state, "syncDeveloperModeUiFn", syncDeveloperModeUi);
  registerRuntimeHook(state, "toggleDeveloperModeFn", () => {
    const shouldOpen = !runtimeState.ui.developerMode;
    if (shouldOpen) {
      setDeveloperMode(true);
      if (typeof runtimeState.setDevWorkspaceExpandedFn === "function") {
        callRuntimeHook(state, "setDevWorkspaceExpandedFn", true);
        return true;
      }
      if (devWorkspaceToggleBtn && !runtimeState.ui.devWorkspaceExpanded) {
        devWorkspaceToggleBtn.click();
      }
      return true;
    }

    if (typeof runtimeState.setDevWorkspaceExpandedFn === "function") {
      callRuntimeHook(state, "setDevWorkspaceExpandedFn", false);
      setDeveloperMode(false);
      return false;
    }
    if (devWorkspaceToggleBtn && runtimeState.ui.devWorkspaceExpanded) {
      devWorkspaceToggleBtn.click();
    }
    setDeveloperMode(false);
    return false;
  });

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

  registerRuntimeHook(state, "openExportWorkbenchFn", (trigger = dockExportBtn) => {
    setExportWorkbenchState(true, { trigger });
    return true;
  });
  registerRuntimeHook(state, "closeExportWorkbenchFn", ({ restoreFocus = true } = {}) => {
    setExportWorkbenchState(false, { restoreFocus });
    return false;
  });

  registerRuntimeHook(state, "openTransportWorkbenchFn", (trigger = null) => openTransportWorkbench(trigger));
  registerRuntimeHook(state, "closeTransportWorkbenchFn", ({ restoreFocus = true } = {}) => (
    closeTransportWorkbench({ restoreFocus })
  ));
  registerRuntimeHook(state, "refreshTransportWorkbenchUiFn", renderTransportWorkbenchUi);
  initializeTransportWorkbenchRuntime();

  const getPaintModeLabel = () => (
    String(runtimeState.paintMode || "visual") === "sovereignty"
      ? t("Political Ownership", "ui")
      : t("Visual Color", "ui")
  );

  const getPrimaryActionLabel = () => (
    String(runtimeState.paintMode || "visual") === "sovereignty"
      ? t("Auto-Fill Ownership", "ui")
      : t("Auto-Fill Visuals", "ui")
  );

  const normalizeCountryCode = (rawCode) =>
    String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");

  const getFeatureDisplayName = (feature, fallback = "") => {
    const props = feature?.properties || {};
    const rawLabel = runtimeState.currentLanguage === "zh"
      ? (props.label_zh || props.name_zh || props.label || props.name)
      : (props.label_en || props.name_en || props.label || props.name);
    return String(rawLabel || props.id || feature?.id || fallback || "").trim();
  };

  const getWorkspaceSelectionLabel = () => {
    const specialId = String(runtimeState.selectedSpecialRegionId || "").trim();
    if (specialId && runtimeState.specialRegionsById?.has(specialId)) {
      return getFeatureDisplayName(runtimeState.specialRegionsById.get(specialId), t("Special Region", "ui"));
    }

    const waterId = String(runtimeState.selectedWaterRegionId || "").trim();
    if (waterId && runtimeState.waterRegionsById?.has(waterId)) {
      return getFeatureDisplayName(runtimeState.waterRegionsById.get(waterId), t("Water Region", "ui"));
    }

    const selectedCode = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    if (selectedCode) {
      const label = String(runtimeState.countryNames?.[selectedCode] || selectedCode).trim() || selectedCode;
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
  registerRuntimeHook(state, "updateWorkspaceStatusFn", refreshWorkspaceStatus);

  const getActiveQuickFillPolicy = () => {
    const selectedCode = normalizeCountryCode(
      runtimeState.selectedInspectorCountryCode || runtimeState.inspectorHighlightCountryCode
    );
    if (!selectedCode || !(runtimeState.countryInteractionPoliciesByCode instanceof Map)) {
      return null;
    }
    return runtimeState.countryInteractionPoliciesByCode.get(selectedCode) || null;
  };

  const getQuickFillParentLabel = (policy) => {
    if (policy?.parentScopeLabel === "Province") {
      return t("By Province", "ui");
    }
    return t("By Parent", "ui");
  };

  const getQuickFillHint = (policy) => {
    const requestedScope = String(runtimeState.batchFillScope || "parent") === "country" ? "country" : "parent";
    if (requestedScope === "country") {
      return t("Single-click: one subdivision | Double-click: country batch", "ui");
    }
    if (policy?.parentScopeLabel === "Province") {
      return t("Single-click: one subdivision | Double-click: province batch", "ui");
    }
    return t("Single-click: one subdivision | Double-click: parent batch", "ui");
  };

  const refreshQuickFillControls = () => {
    const isScenarioMode = !!runtimeState.activeScenarioId;
    const isOwnershipMode = String(runtimeState.paintMode || "visual") === "sovereignty";
    const isSubdivisionMode = String(runtimeState.interactionGranularity || "subdivision") !== "country";
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
      dockQuickFillBtn.setAttribute("aria-expanded", runtimeState.activeDockPopover === "quickfill" ? "true" : "false");
    }
    if (dockQuickFillRow) {
      const shouldShowPopover = isVisible && runtimeState.activeDockPopover === "quickfill";
      dockQuickFillRow.classList.toggle("hidden", !shouldShowPopover);
      dockQuickFillRow.setAttribute("aria-hidden", shouldShowPopover ? "false" : "true");
    }
    if (!isVisible && runtimeState.activeDockPopover === "quickfill") {
      closeDockPopover();
    }
    if (quickFillParentBtn) {
      quickFillParentBtn.textContent = getQuickFillParentLabel(activePolicy);
      quickFillParentBtn.disabled = !parentEnabled;
      quickFillParentBtn.classList.toggle(
        "is-active",
        parentEnabled && String(runtimeState.batchFillScope || "parent") !== "country"
      );
    }
    if (quickFillCountryBtn) {
      quickFillCountryBtn.textContent = t("By Country", "ui");
      quickFillCountryBtn.disabled = !countryEnabled;
      quickFillCountryBtn.classList.toggle(
        "is-active",
        countryEnabled && String(runtimeState.batchFillScope || "parent") === "country"
      );
    }
    if (dockQuickFillHint) {
      dockQuickFillHint.textContent = getQuickFillHint(activePolicy);
    }
  };

  const refreshPaintControlsLayout = () => {
    const isScenarioMode = !!runtimeState.activeScenarioId;
    const isOwnershipMode = String(runtimeState.paintMode || "visual") === "sovereignty";
    const showPoliticalPanel = !isScenarioMode && (runtimeState.ui.politicalEditingExpanded || isOwnershipMode);
    const showBorderMaintenance = isScenarioMode || runtimeState.ui.politicalEditingExpanded || isOwnershipMode;
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

    if (!showEditConfigButton && runtimeState.activeDockPopover === "edit") {
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
    bottomDock.classList.toggle("is-collapsed", !!runtimeState.ui.dockCollapsed);
    if (dockCollapseBtn) {
      dockCollapseBtn.setAttribute("aria-pressed", runtimeState.ui.dockCollapsed ? "true" : "false");
      dockCollapseBtn.setAttribute(
        "aria-label",
        runtimeState.ui.dockCollapsed ? t("Expand quick dock", "ui") : t("Collapse quick dock", "ui")
      );
      dockCollapseBtn.setAttribute("title", runtimeState.ui.dockCollapsed ? t("Expand", "ui") : t("Collapse", "ui"));
    }
    if (dockHandleChevron) {
      dockHandleChevron.textContent = runtimeState.ui.dockCollapsed ? "^" : "v";
    }
    if (dockHandleLabel) {
      dockHandleLabel.textContent = runtimeState.ui.dockCollapsed ? t("Expand", "ui") : t("Collapse", "ui");
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
    if (typeof runtimeState.syncFacilityInfoCardVisibilityFn === "function") {
      runtimeState.syncFacilityInfoCardVisibilityFn();
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
    scenarioContextBar.style.setProperty("--scenario-bar-safe-max-width", `${availableWidth}px`);
    scenarioContextBar.classList.toggle("is-overlay-constrained", availableWidth < SCENARIO_BAR_BASE_MAX_WIDTH);
    scenarioContextBar.classList.toggle("is-narrow", availableWidth < SCENARIO_BAR_NARROW_WIDTH);
  };

  const refreshScenarioContextBar = () => {
    if (!scenarioContextBar) return;
    const activeScenario = String(runtimeState.activeScenarioManifest?.display_name || runtimeState.activeScenarioId || "").trim();
    const activeCode = String(runtimeState.activeSovereignCode || "").trim().toUpperCase();
    const splitCount = Number(runtimeState.scenarioOwnerControllerDiffCount || 0);
    const activeLabel = activeCode
      ? (t(runtimeState.countryNames?.[activeCode] || activeCode, "geo") || runtimeState.countryNames?.[activeCode] || activeCode)
      : t("None", "ui");
    const modeLabel = getPaintModeLabel();
    const scenarioViewLabel = String(runtimeState.scenarioViewMode || "ownership") === "frontline"
      ? t("Frontline", "ui")
      : t("Ownership", "ui");
    const showScenarioState = !!activeScenario;
    const activeValue = activeCode ? `${activeLabel} (${activeCode})` : t("None", "ui");
    scenarioContextBar.classList.toggle("is-scenario", !!activeScenario);
    scenarioContextBar.classList.toggle("is-collapsed", !!runtimeState.ui.scenarioBarCollapsed);
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
      scenarioContextCollapseBtn.textContent = runtimeState.ui.scenarioBarCollapsed ? "+" : "-";
      scenarioContextCollapseBtn.setAttribute("aria-label", runtimeState.ui.scenarioBarCollapsed
        ? t("Expand", "ui")
        : t("Collapse", "ui"));
    }
    syncScenarioGuideTriggerButtons({
      isOpen: !!(scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")),
      tutorialEntryVisible: !!runtimeState.ui.tutorialEntryVisible,
    });
    if (scenarioTransportWorkbenchBtn) {
      scenarioTransportWorkbenchBtn.textContent = t("Transport", "ui");
      scenarioTransportWorkbenchBtn.setAttribute("title", runtimeState.transportWorkbenchUi?.open
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
  registerRuntimeHook(state, "updateScenarioContextBarFn", refreshScenarioContextBar);
  registerRuntimeHook(state, "triggerScenarioGuideFn", triggerScenarioGuide);
  let onboardingAutoTimer = 0;
  const dismissOnboardingHint = () => {
    if (onboardingAutoTimer) { clearTimeout(onboardingAutoTimer); onboardingAutoTimer = 0; }
    if (!mapOnboardingHint || runtimeState.onboardingDismissed) return;
    runtimeState.onboardingDismissed = true;
    mapOnboardingHint.classList.add("is-hidden");
    mapOnboardingHint.setAttribute("aria-hidden", "true");
  };
  const showOnboardingHint = () => {
    if (!mapOnboardingHint) return;
    runtimeState.onboardingDismissed = false;
    mapOnboardingHint.classList.remove("is-hidden");
    mapOnboardingHint.setAttribute("aria-hidden", "false");
    if (onboardingAutoTimer) clearTimeout(onboardingAutoTimer);
    onboardingAutoTimer = setTimeout(dismissOnboardingHint, 5000);
  };
  registerRuntimeHook(state, "dismissOnboardingHintFn", dismissOnboardingHint);
  registerRuntimeHook(state, "showOnboardingHintFn", showOnboardingHint);

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
    if (runtimeState.specialZoneEditor?.active) {
      mapContainer.classList.add("tool-special-zone");
      return;
    }
    if (runtimeState.brushModeEnabled && runtimeState.brushPanModifierActive) {
      mapContainer.classList.add("tool-pan-override");
      return;
    }
    mapContainer.classList.add(`tool-${runtimeState.currentTool || "fill"}`);
  };

  const renderDirty = (reason) => {
    markDirty(reason);
    if (render) render();
  };

  const addRecentColor = (color) => {
    const normalized = normalizeHexColor(color);
    if (!normalized) return;
    runtimeState.recentColors = (Array.isArray(runtimeState.recentColors) ? runtimeState.recentColors : [])
      .filter((value) => normalizeHexColor(value) !== normalized);
    runtimeState.recentColors.unshift(normalized);
    runtimeState.recentColors = runtimeState.recentColors.slice(0, 10);
    callRuntimeHook(state, "updateRecentUI");
  };

  const getFeatureIdsForOwnerColorRefresh = (ownerCode) => {
    const normalizedOwner = normalizeCountryCode(ownerCode);
    if (!normalizedOwner) return [];
    const ids = new Set();
    if (runtimeState.sovereigntyByFeatureId && typeof runtimeState.sovereigntyByFeatureId === "object") {
      Object.entries(runtimeState.sovereigntyByFeatureId).forEach(([featureId, rawOwner]) => {
        if (normalizeCountryCode(rawOwner) === normalizedOwner) ids.add(featureId);
      });
    }
    const ownerIds = runtimeState.ownerToFeatureIds instanceof Map
      ? runtimeState.ownerToFeatureIds.get(normalizedOwner)
      : null;
    const ownerIdList = Array.isArray(ownerIds) || ownerIds instanceof Set ? Array.from(ownerIds) : [];
    ownerIdList.forEach((featureId) => ids.add(featureId));
    const countryIds = runtimeState.countryToFeatureIds instanceof Map
      ? runtimeState.countryToFeatureIds.get(normalizedOwner)
      : null;
    const countryIdList = Array.isArray(countryIds) || countryIds instanceof Set ? Array.from(countryIds) : [];
    countryIdList.forEach((featureId) => ids.add(featureId));
    return Array.from(ids)
      .map((featureId) => String(featureId || "").trim())
      .filter((featureId) => featureId && runtimeState.landIndex?.has(featureId));
  };

  const resolvePaletteLibraryApplyTarget = () => {
    const selectedHitId = String(runtimeState.devSelectedHit?.id || "").trim();
    if (selectedHitId && runtimeState.landIndex?.has(selectedHitId)) {
      return { type: "feature", featureIds: [selectedHitId] };
    }
    const hoveredId = String(runtimeState.hoveredId || "").trim();
    if (hoveredId && runtimeState.landIndex?.has(hoveredId)) {
      return { type: "feature", featureIds: [hoveredId] };
    }
    const ownerCode = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    return ownerCode ? { type: "owner", ownerCode } : null;
  };

  const applyPaletteLibraryColor = (rawColor) => {
    const color = normalizeHexColor(rawColor);
    if (!color) return false;
    const target = resolvePaletteLibraryApplyTarget();
    if (!target) {
      showToast(t("Select or hover a land feature first.", "ui"), {
        title: t("Color Library", "ui"),
        tone: "info",
        duration: 2400,
      });
      return false;
    }

    runtimeState.selectedColor = color;
    if (target.type === "feature") {
      const featureIds = target.featureIds;
      const before = captureHistoryState({ featureIds });
      runtimeState.visualOverrides = runtimeState.visualOverrides || {};
      runtimeState.featureOverrides = runtimeState.featureOverrides || {};
      featureIds.forEach((featureId) => {
        runtimeState.visualOverrides[featureId] = color;
        runtimeState.featureOverrides[featureId] = color;
      });
      markLegacyColorStateDirty();
      refreshResolvedColorsForFeatures(featureIds, { renderNow: false });
      markDirty("palette-library-apply-color");
      pushHistoryEntry({
        kind: "palette-library-apply-color",
        before,
        after: captureHistoryState({ featureIds }),
        meta: { affectsSovereignty: false },
      });
      addRecentColor(color);
      updateSwatchUI();
      if (render) render();
      return true;
    }

    const ownerCode = target.ownerCode;
    const featureIds = getFeatureIdsForOwnerColorRefresh(ownerCode);
    const before = captureHistoryState({ ownerCodes: [ownerCode] });
    runtimeState.sovereignBaseColors = runtimeState.sovereignBaseColors || {};
    runtimeState.countryBaseColors = runtimeState.countryBaseColors || {};
    runtimeState.sovereignBaseColors[ownerCode] = color;
    runtimeState.countryBaseColors[ownerCode] = color;
    markLegacyColorStateDirty();
    if (featureIds.length) {
      refreshResolvedColorsForFeatures(featureIds, { renderNow: false });
    } else {
      refreshColorState({ renderNow: false });
    }
    markDirty("palette-library-apply-owner-color");
    pushHistoryEntry({
      kind: "palette-library-apply-owner-color",
      before,
      after: captureHistoryState({ ownerCodes: [ownerCode] }),
      meta: { affectsSovereignty: false },
    });
    addRecentColor(color);
    updateSwatchUI();
    if (render) render();
    return true;
  };

  const persistCityViewSettings = () => {
    runtimeState.persistViewSettingsFn?.();
  };

  const refreshActiveSovereignLabel = () => {
    const code = String(runtimeState.activeSovereignCode || "").trim().toUpperCase();
    if (activeSovereignLabel) {
      if (!code) {
        activeSovereignLabel.textContent = t("None selected", "ui");
      } else {
        const label = String(runtimeState.countryNames?.[code] || code).trim() || code;
        activeSovereignLabel.textContent = `${t(label, "geo") || label} (${code})`;
      }
    }
    refreshScenarioContextBar();
    refreshWorkspaceStatus();
    if (typeof runtimeState.renderPresetTreeFn === "function") {
      runtimeState.renderPresetTreeFn();
    }
  };
  registerRuntimeHook(state, "updateActiveSovereignUIFn", refreshActiveSovereignLabel);
  const refreshDynamicBorderStatus = () => {
    if (dynamicBorderStatus) {
      if (!runtimeState.runtimePoliticalTopology?.objects?.political) {
        dynamicBorderStatus.textContent = t("Dynamic borders disabled", "ui");
      } else if (runtimeState.dynamicBordersDirty) {
        dynamicBorderStatus.textContent = t("Borders need recalculation", "ui");
      } else {
        dynamicBorderStatus.textContent = t("Borders up to date", "ui");
      }
    }
    if (recalculateBordersBtn) {
      recalculateBordersBtn.disabled = !runtimeState.dynamicBordersDirty;
    }
  };
  registerRuntimeHook(state, "updateDynamicBorderStatusUIFn", refreshDynamicBorderStatus);
  registerRuntimeHook(state, "updatePaintModeUIFn", () => {
    if (paintModeSelect) {
      paintModeSelect.value = runtimeState.paintMode || "visual";
    }
    const isOwnershipMode = String(runtimeState.paintMode || "visual") === "sovereignty";
    [paintModeVisualBtn, paintModePoliticalBtn].forEach((button) => {
      if (!button) return;
      const buttonMode = button.dataset.paintMode || "visual";
      const isActive = (buttonMode === "sovereignty") === isOwnershipMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    if (paintGranularitySelect) {
      paintGranularitySelect.value = runtimeState.interactionGranularity || "subdivision";
    }
    refreshPaintControlsLayout();
    refreshActiveSovereignLabel();
    refreshDynamicBorderStatus();
    refreshWorkspaceStatus();
    updateDockCollapsedUi();
  });
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
  if (!runtimeState.styleConfig.ocean || typeof runtimeState.styleConfig.ocean !== "object") {
    runtimeState.styleConfig.ocean = {};
  }
  runtimeState.styleConfig.ocean.preset = normalizeOceanPreset(runtimeState.styleConfig.ocean.preset || "flat");
  runtimeState.styleConfig.ocean.experimentalAdvancedStyles = runtimeState.styleConfig.ocean.experimentalAdvancedStyles === true;
  if (!runtimeState.styleConfig.ocean.experimentalAdvancedStyles && OCEAN_ADVANCED_PRESETS.has(runtimeState.styleConfig.ocean.preset)) {
    runtimeState.styleConfig.ocean.preset = "flat";
  }
  runtimeState.styleConfig.ocean.coastalAccentEnabled = runtimeState.styleConfig.ocean.coastalAccentEnabled !== false;
  runtimeState.styleConfig.ocean.fillColor = normalizeOceanFillColor(runtimeState.styleConfig.ocean.fillColor);
  runtimeState.styleConfig.ocean.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.opacity)) ? Number(runtimeState.styleConfig.ocean.opacity) : 0.72,
    0,
    1
  );
  runtimeState.styleConfig.ocean.scale = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.scale)) ? Number(runtimeState.styleConfig.ocean.scale) : 1,
    0.6,
    2.4
  );
  runtimeState.styleConfig.ocean.contourStrength = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.contourStrength))
      ? Number(runtimeState.styleConfig.ocean.contourStrength)
      : 0.75,
    0,
    1
  );
  runtimeState.styleConfig.ocean.shallowBandFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.shallowBandFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.shallowBandFadeEndZoom)
      : 2.8,
    2.1,
    4.8
  );
  runtimeState.styleConfig.ocean.midBandFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.midBandFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.midBandFadeEndZoom)
      : 3.4,
    2.7,
    5.2
  );
  runtimeState.styleConfig.ocean.deepBandFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.deepBandFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.deepBandFadeEndZoom)
      : 4.2,
    3.3,
    6
  );
  runtimeState.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom)
      : 3.0,
    2.1,
    4.6
  );
  runtimeState.styleConfig.ocean.scenarioShallowContourFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.scenarioShallowContourFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.scenarioShallowContourFadeEndZoom)
      : 3.4,
    2.5,
    5
  );
  runtimeState.styleConfig.lakes = normalizeLakeStyleConfig(runtimeState.styleConfig.lakes);
  if (!runtimeState.styleConfig.internalBorders || typeof runtimeState.styleConfig.internalBorders !== "object") {
    runtimeState.styleConfig.internalBorders = {};
  }
  runtimeState.styleConfig.internalBorders.color = normalizeOceanFillColor(runtimeState.styleConfig.internalBorders.color || "#cccccc");
  runtimeState.styleConfig.internalBorders.colorMode =
    String(runtimeState.styleConfig.internalBorders.colorMode || "auto").trim().toLowerCase() === "manual"
      ? "manual"
      : "auto";
  runtimeState.styleConfig.internalBorders.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.internalBorders.opacity))
      ? Number(runtimeState.styleConfig.internalBorders.opacity)
      : 1,
    0,
    1
  );
  runtimeState.styleConfig.internalBorders.width = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.internalBorders.width))
      ? Number(runtimeState.styleConfig.internalBorders.width)
      : 0.5,
    0.01,
    2
  );
  if (!runtimeState.styleConfig.empireBorders || typeof runtimeState.styleConfig.empireBorders !== "object") {
    runtimeState.styleConfig.empireBorders = {};
  }
  runtimeState.styleConfig.empireBorders.color = normalizeOceanFillColor(runtimeState.styleConfig.empireBorders.color || "#666666");
  runtimeState.styleConfig.empireBorders.width = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.empireBorders.width))
      ? Number(runtimeState.styleConfig.empireBorders.width)
      : 1,
    0.01,
    5
  );
  if (!runtimeState.styleConfig.coastlines || typeof runtimeState.styleConfig.coastlines !== "object") {
    runtimeState.styleConfig.coastlines = {};
  }
  runtimeState.styleConfig.coastlines.color = normalizeOceanFillColor(runtimeState.styleConfig.coastlines.color || "#333333");
  runtimeState.styleConfig.coastlines.width = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.coastlines.width))
      ? Number(runtimeState.styleConfig.coastlines.width)
      : 1.2,
    0.5,
    3
  );
  if (!runtimeState.styleConfig.parentBorders || typeof runtimeState.styleConfig.parentBorders !== "object") {
    runtimeState.styleConfig.parentBorders = {};
  }
  runtimeState.styleConfig.parentBorders.color = String(
    runtimeState.styleConfig.parentBorders.color || "#4b5563"
  );
  runtimeState.styleConfig.parentBorders.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.parentBorders.opacity))
      ? Number(runtimeState.styleConfig.parentBorders.opacity)
      : 0.85,
    0,
    1
  );
  runtimeState.styleConfig.parentBorders.width = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.parentBorders.width))
      ? Number(runtimeState.styleConfig.parentBorders.width)
      : 1.1,
    0.2,
    4
  );
  if (!runtimeState.parentBorderEnabledByCountry || typeof runtimeState.parentBorderEnabledByCountry !== "object") {
    runtimeState.parentBorderEnabledByCountry = {};
  }
  runtimeState.parentBordersVisible = runtimeState.parentBordersVisible !== false;
  runtimeState.styleConfig.urban = normalizeUrbanStyleConfig(runtimeState.styleConfig.urban);
  if (runtimeState.styleConfig.urban.mode === "manual") {
    runtimeState.styleConfig.urban.color = normalizeOceanFillColor(runtimeState.styleConfig.urban.color || "#4b5563");
  }
  runtimeState.styleConfig.urban.adaptiveTintColor = normalizeOceanFillColor(
    runtimeState.styleConfig.urban.adaptiveTintColor || "#f2dea1"
  );

  runtimeState.styleConfig.physical = normalizePhysicalStyleConfig(runtimeState.styleConfig.physical);
  runtimeState.styleConfig.physical.contourColor = normalizeOceanFillColor(
    runtimeState.styleConfig.physical.contourColor || "#6b5947"
  );

  if (!runtimeState.styleConfig.rivers || typeof runtimeState.styleConfig.rivers !== "object") {
    runtimeState.styleConfig.rivers = {};
  }
  runtimeState.styleConfig.rivers.color = normalizeOceanFillColor(runtimeState.styleConfig.rivers.color || "#3b82f6");
  runtimeState.styleConfig.rivers.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.rivers.opacity)) ? Number(runtimeState.styleConfig.rivers.opacity) : 0.88,
    0,
    1
  );
  runtimeState.styleConfig.rivers.width = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.rivers.width)) ? Number(runtimeState.styleConfig.rivers.width) : 0.5,
    0.2,
    4
  );
  runtimeState.styleConfig.rivers.outlineColor = normalizeOceanFillColor(
    runtimeState.styleConfig.rivers.outlineColor || "#e2efff"
  );
  runtimeState.styleConfig.rivers.outlineWidth = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.rivers.outlineWidth))
      ? Number(runtimeState.styleConfig.rivers.outlineWidth)
      : 0.25,
    0,
    3
  );
  runtimeState.styleConfig.rivers.dashStyle = String(runtimeState.styleConfig.rivers.dashStyle || "solid");

  runtimeState.styleConfig.texture = normalizeTextureStyleConfig(runtimeState.styleConfig.texture);
  if (!runtimeState.referenceImageState || typeof runtimeState.referenceImageState !== "object") {
    runtimeState.referenceImageState = {};
  }
  runtimeState.referenceImageState.opacity = clamp(
    Number.isFinite(Number(runtimeState.referenceImageState.opacity)) ? Number(runtimeState.referenceImageState.opacity) : 0.6,
    0,
    1
  );
  runtimeState.referenceImageState.scale = clamp(
    Number.isFinite(Number(runtimeState.referenceImageState.scale)) ? Number(runtimeState.referenceImageState.scale) : 1,
    0.2,
    3
  );
  runtimeState.referenceImageState.offsetX = clamp(
    Number.isFinite(Number(runtimeState.referenceImageState.offsetX)) ? Number(runtimeState.referenceImageState.offsetX) : 0,
    -1000,
    1000
  );
  runtimeState.referenceImageState.offsetY = clamp(
    Number.isFinite(Number(runtimeState.referenceImageState.offsetY)) ? Number(runtimeState.referenceImageState.offsetY) : 0,
    -1000,
    1000
  );

  const paletteLibraryPanelController = createPaletteLibraryPanelController({
    themeSelect,
    paletteLibraryToggle,
    paletteLibraryPanel,
    paletteLibrarySources,
    paletteLibrarySearch,
    paletteLibrarySearchClear,
    paletteLibrarySummary,
    paletteLibraryList,
    paletteLibraryToggleLabel,
    applyPaletteLibraryColor,
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
  registerRuntimeHook(state, "updatePaletteSourceUIFn", syncPaletteSourceControls);
  registerRuntimeHook(state, "renderPaletteFn", renderPalette);

  registerRuntimeHook(state, "updatePaletteLibraryUIFn", renderPaletteLibrary);

  function renderSpecialZoneEditorUI() {
    if (toggleWaterRegions) toggleWaterRegions.checked = !!runtimeState.showWaterRegions;
    if (toggleOpenOceanRegions) toggleOpenOceanRegions.checked = !!runtimeState.showOpenOceanRegions;
    if (toggleSpecialZones) toggleSpecialZones.checked = !!runtimeState.showSpecialZones;
    if (toggleAirports) toggleAirports.checked = !!runtimeState.showAirports;
    if (togglePorts) togglePorts.checked = !!runtimeState.showPorts;
    renderAppearanceStyleControlsUi();
    specialZoneEditorController.renderSpecialZoneEditorUI();
    updateToolUI();
  }
  registerRuntimeHook(state, "updateSpecialZoneEditorUIFn", renderSpecialZoneEditorUI);

  function updateSwatchUI() {
    const swatches = document.querySelectorAll(".color-swatch");
    swatches.forEach((swatch) => {
      if (swatch.dataset.color === runtimeState.selectedColor) {
        swatch.classList.add("is-selected");
      } else {
        swatch.classList.remove("is-selected");
      }
    });
    const libraryRows = document.querySelectorAll(".palette-library-row");
    libraryRows.forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.color === runtimeState.selectedColor);
    });
    if (document.getElementById("customColor")) {
      customColor.value = runtimeState.selectedColor;
    }
    if (selectedColorPreview) {
      selectedColorPreview.style.backgroundColor = runtimeState.selectedColor;
      selectedColorPreview.setAttribute("aria-label", `${t("Selected color", "ui")}: ${runtimeState.selectedColor}`);
    }
    if (selectedColorValue) {
      selectedColorValue.textContent = String(runtimeState.selectedColor || "").toUpperCase();
    }
  }
  registerRuntimeHook(state, "updateSwatchUIFn", updateSwatchUI);

  function updateToolUI() {
    toolButtons.forEach((button) => {
      const isActive = button.dataset.tool === runtimeState.currentTool;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    const disableBrush = runtimeState.currentTool === "eyedropper" || !!runtimeState.specialZoneEditor?.active;
    if (disableBrush) {
      runtimeState.brushModeEnabled = false;
      runtimeState.brushPanModifierActive = false;
    }
    if (brushModeBtn) {
      brushModeBtn.disabled = disableBrush;
      brushModeBtn.classList.toggle("is-active", !!runtimeState.brushModeEnabled && !disableBrush);
      brushModeBtn.setAttribute("aria-pressed", String(!!runtimeState.brushModeEnabled && !disableBrush));
    }
    setToolCursorClass();
    updateDirtyIndicator();
  }
  registerRuntimeHook(state, "updateToolUIFn", updateToolUI);

  const appearanceControlsController = createAppearanceControlsController({
    runtimeState: state,
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
    setAppearanceTab: setAppearanceTabController,
    syncParentBorderVisibilityUI,
  } = appearanceControlsController;
  registerRuntimeHook(state, "updateTransportAppearanceUIFn", renderTransportAppearanceUi);
  registerRuntimeHook(state, "updateRecentUI", () => {
    renderRecentColors();
    renderPalette(runtimeState.currentPaletteTheme);
    renderPaletteLibrary();
  });
  registerRuntimeHook(state, "updateParentBorderCountryListFn", renderParentBorderCountryList);

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
    runtimeState: state,
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
      callRuntimeHook(state, "closeExportWorkbenchFn", { restoreFocus });
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
  registerRuntimeHook(state, "updateHistoryUIFn", updateHistoryUi);

  function updateZoomUi() {
    const text = getZoomPercent();
    if (zoomPercentInput && zoomPercentInput.dataset.editing !== "true") {
      if (zoomPercentInput.value !== text) {
        zoomPercentInput.value = text;
      }
    }
    if (zoomPercentInput) {
      if (zoomPercentInput.hasAttribute("aria-invalid")) {
        zoomPercentInput.removeAttribute("aria-invalid");
      }
      if (zoomPercentInput.dataset.zoomError) {
        zoomPercentInput.dataset.zoomError = "";
        zoomPercentInput.setCustomValidity("");
      }
    }
  }
  registerRuntimeHook(state, "updateZoomUIFn", updateZoomUi);

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
    runtimeState.currentTool = nextTool;
    if (nextTool === "eyedropper") {
      runtimeState.brushModeEnabled = false;
      runtimeState.brushPanModifierActive = false;
    }
    updateToolUI();
    if (dismissHint) {
      dismissOnboardingHint();
    }
    emitTransientFeedback(feedbackLabel || getToolFeedbackLabel(nextTool));
  };

  const runBrushModeToggle = (nextValue = !runtimeState.brushModeEnabled, { dismissHint = true } = {}) => {
    runtimeState.brushModeEnabled = !!nextValue;
    if (runtimeState.brushModeEnabled && runtimeState.currentTool === "eyedropper") {
      runtimeState.currentTool = "fill";
    }
    updateToolUI();
    if (dismissHint) {
      dismissOnboardingHint();
    }
    emitTransientFeedback(t(
      runtimeState.brushModeEnabled ? "Brush On · Shift+Drag to pan" : "Brush Off",
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

  registerRuntimeHook(state, "runToolSelectionFn", runToolSelection);
  registerRuntimeHook(state, "runBrushModeToggleFn", runBrushModeToggle);
  registerRuntimeHook(state, "runHistoryActionFn", runHistoryAction);
  registerRuntimeHook(state, "runZoomStepFn", runZoomStep);
  registerRuntimeHook(state, "runZoomResetFn", runZoomReset);
  registerRuntimeHook(state, "commitZoomInputValueFn", commitZoomInputValue);

  registerRuntimeHook(state, "updateToolbarInputsFn", () => {
    const internalAutoColorEnabled = String(runtimeState.styleConfig.internalBorders.colorMode || "auto") !== "manual";
    if (internalBorderAutoColor) {
      internalBorderAutoColor.checked = internalAutoColorEnabled;
    }
    if (internalBorderColor) {
      internalBorderColor.value = runtimeState.styleConfig.internalBorders.color;
      internalBorderColor.disabled = internalAutoColorEnabled;
    }
    if (internalBorderOpacity) {
      internalBorderOpacity.value = String(Math.round(runtimeState.styleConfig.internalBorders.opacity * 100));
    }
    if (internalBorderOpacityValue) {
      internalBorderOpacityValue.textContent = `${Math.round(runtimeState.styleConfig.internalBorders.opacity * 100)}%`;
    }
    if (internalBorderWidth) {
      internalBorderWidth.value = String(Number(runtimeState.styleConfig.internalBorders.width).toFixed(2));
    }
    if (internalBorderWidthValue) {
      internalBorderWidthValue.textContent = Number(runtimeState.styleConfig.internalBorders.width).toFixed(2);
    }
    if (empireBorderColor) {
      empireBorderColor.value = runtimeState.styleConfig.empireBorders.color;
    }
    if (empireBorderWidth) {
      empireBorderWidth.value = String(Number(runtimeState.styleConfig.empireBorders.width).toFixed(2));
    }
    if (empireBorderWidthValue) {
      empireBorderWidthValue.textContent = Number(runtimeState.styleConfig.empireBorders.width).toFixed(2);
    }
    if (coastlineColor) {
      coastlineColor.value = runtimeState.styleConfig.coastlines.color;
    }
    if (coastlineWidth) {
      coastlineWidth.value = String(Number(runtimeState.styleConfig.coastlines.width).toFixed(1));
    }
    if (coastlineWidthValue) {
      coastlineWidthValue.textContent = Number(runtimeState.styleConfig.coastlines.width).toFixed(1);
    }
    syncParentBorderVisibilityUI();
    renderOceanLakeControlsUi();
    if (colorModeSelect) {
      colorModeSelect.value = runtimeState.colorMode || "political";
    }
    if (themeSelect) {
      themeSelect.value = String(runtimeState.activePaletteId || themeSelect.value || "");
    }
    renderReferenceOverlayUi();
    syncExportWorkbenchControlsFromState();
    renderTextureUI();
    renderDayNightUI();
    renderSpecialZoneEditorUI();
  });
  registerRuntimeHook(state, "updateTextureUIFn", renderTextureUI);

  if (customColor) {
    customColor.addEventListener("input", (event) => {
      runtimeState.selectedColor = event.target.value;
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
      runtimeState.toggleDeveloperModeFn?.();
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
      runtimeState.paintMode = nextMode;
      runtimeState.ui.politicalEditingExpanded = nextMode === "sovereignty";
      markDirty?.("paint-mode");
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
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
        runtimeState.closeExportWorkbenchFn?.({ restoreFocus: true });
      } else {
        closeDockPopover?.({ restoreFocus: false, syncUrl: true });
        runtimeState.openExportWorkbenchFn?.(dockExportBtn);
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
      runtimeState.ui.politicalEditingExpanded = !runtimeState.ui.politicalEditingExpanded;
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
      }
    });
    politicalEditingToggleBtn.dataset.bound = "true";
  }

  if (scenarioContextCollapseBtn && !scenarioContextCollapseBtn.dataset.bound) {
    scenarioContextCollapseBtn.addEventListener("click", () => {
      runtimeState.ui.scenarioBarCollapsed = !runtimeState.ui.scenarioBarCollapsed;
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
    const renderPassCache = runtimeState.renderPassCache && typeof runtimeState.renderPassCache === "object"
      ? runtimeState.renderPassCache
      : {};
    const signatures = renderPassCache.signatures && typeof renderPassCache.signatures === "object"
      ? renderPassCache.signatures
      : {};
    const dirtyRevision = Number(runtimeState.dirtyRevision || 0);
    const zoomTransform = runtimeState.zoomTransform && typeof runtimeState.zoomTransform === "object"
      ? runtimeState.zoomTransform
      : { k: 1, x: 0, y: 0 };
    const transformSignature = [
      `zoomK:${Number(zoomTransform.k || 1).toFixed(5)}`,
      `zoomX:${Number(zoomTransform.x || 0).toFixed(2)}`,
      `zoomY:${Number(zoomTransform.y || 0).toFixed(2)}`,
    ];
    if (layerId === "color") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `colorRevision:${Number(runtimeState.colorRevision) || 0}`,
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
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
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
        `dynamicDirty:${runtimeState.dynamicBordersDirty ? 1 : 0}`,
        `dirtyRevision:${dirtyRevision}`,
        `passBorders:${String(signatures.borders || "")}`,
        `passLineEffects:${String(signatures.lineEffects || "")}`,
      ];
    }
    if (layerId === "text") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
        `svgChildren:${mapSvgChildCount}`,
        `dirtyRevision:${dirtyRevision}`,
        ...transformSignature,
      ];
    }
    return [
      getExportBakeVisibilitySignature(exportUi),
      `colorRevision:${Number(runtimeState.colorRevision) || 0}`,
      `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
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
    const renderPassCache = runtimeState.renderPassCache && typeof runtimeState.renderPassCache === "object"
      ? runtimeState.renderPassCache
      : null;
    if (!renderPassCache || !targetCtx) return false;
    const passCanvas = renderPassCache.canvases?.[passName];
    if (!passCanvas) return false;
    const layout = renderPassCache.layouts?.[passName] || {};
    const dpr = Math.max(Number(runtimeState.dpr) || 1, 1);
    const referenceTransform = renderPassCache.referenceTransforms?.[passName] || null;
    const currentTransform = runtimeState.zoomTransform && typeof runtimeState.zoomTransform === "object"
      ? runtimeState.zoomTransform
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
    const width = runtimeState.colorCanvas?.width || runtimeState.lineCanvas?.width || 0;
    const height = runtimeState.colorCanvas?.height || runtimeState.lineCanvas?.height || 0;
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
    const width = runtimeState.colorCanvas?.width || runtimeState.lineCanvas?.width || 0;
    const height = runtimeState.colorCanvas?.height || runtimeState.lineCanvas?.height || 0;
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
    toggleWaterRegions.checked = !!runtimeState.showWaterRegions;
    toggleWaterRegions.addEventListener("change", (event) => {
      runtimeState.showWaterRegions = event.target.checked;
      if (runtimeState.showWaterRegions) {
        void ensureActiveScenarioOptionalLayerLoaded("water", { renderNow: true });
      }
      renderDirty("toggle-water-regions");
    });
  }

  if (toggleOpenOceanRegions) {
    toggleOpenOceanRegions.checked = !!runtimeState.showOpenOceanRegions;
    toggleOpenOceanRegions.addEventListener("change", (event) => {
      runtimeState.allowOpenOceanSelect = !!event.target.checked;
      runtimeState.allowOpenOceanPaint = !!event.target.checked;
      runtimeState.showOpenOceanRegions = !!event.target.checked;
      if (!runtimeState.showOpenOceanRegions) {
        runtimeState.hoveredWaterRegionId = null;
      }
      callRuntimeHook(state, "updateWaterInteractionUIFn");
      callRuntimeHook(state, "renderWaterRegionListFn");
      renderDirty("toggle-open-ocean-regions");
    });
  }

  if (toggleSpecialZones) {
    toggleSpecialZones.checked = runtimeState.showSpecialZones;
    toggleSpecialZones.addEventListener("change", (event) => {
      runtimeState.showSpecialZones = event.target.checked;
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
        autoFillMap(runtimeState.colorMode || "political", {
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
    colorModeSelect.value = runtimeState.colorMode;
    colorModeSelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "region");
      runtimeState.colorMode = value === "political" ? "political" : "region";
    });
  }

  if (paintGranularitySelect) {
    paintGranularitySelect.value = runtimeState.interactionGranularity || "subdivision";
    paintGranularitySelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "subdivision");
      const requested = value === "country" ? "country" : "subdivision";
      runtimeState.interactionGranularity =
        runtimeState.paintMode === "sovereignty" ? "subdivision" : requested;
      paintGranularitySelect.value = runtimeState.interactionGranularity;
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
      }
    });
  }

  if (quickFillParentBtn) {
    quickFillParentBtn.addEventListener("click", () => {
      runtimeState.batchFillScope = "parent";
      closeDockPopover();
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
      }
    });
  }

  if (quickFillCountryBtn) {
    quickFillCountryBtn.addEventListener("click", () => {
      runtimeState.batchFillScope = "country";
      closeDockPopover();
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
      }
    });
  }

  if (paintModeSelect) {
    paintModeSelect.value = runtimeState.paintMode || "visual";
    paintModeSelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "visual");
      runtimeState.paintMode = value === "sovereignty" ? "sovereignty" : "visual";
      if (runtimeState.paintMode === "sovereignty") {
        runtimeState.interactionGranularity = "subdivision";
        runtimeState.ui.politicalEditingExpanded = true;
        if (paintGranularitySelect) {
          paintGranularitySelect.value = "subdivision";
        }
      }
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
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
      const featureIds = Object.keys(runtimeState.visualOverrides || {});
      const ownerCodes = Array.from(new Set([
        ...Object.keys(runtimeState.sovereignBaseColors || {}),
        ...Object.keys(runtimeState.countryBaseColors || {}),
      ]));
      const sovereigntyFeatureIds = String(runtimeState.paintMode || "visual") === "sovereignty"
        ? Object.keys(runtimeState.sovereigntyByFeatureId || {})
        : [];
      const before = captureHistoryState({
        featureIds,
        ownerCodes,
        sovereigntyFeatureIds,
      });
      if (runtimeState.paintMode === "sovereignty") {
        if (runtimeState.activeScenarioId) {
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
        runtimeState.colors = {};
        runtimeState.visualOverrides = {};
        runtimeState.featureOverrides = {};
        runtimeState.countryBaseColors = {};
        runtimeState.sovereignBaseColors = {};
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
          affectsSovereignty: runtimeState.paintMode === "sovereignty",
        },
      });
      showToast(t("Map cleared. Undo is available from history.", "ui"), {
        title: t("Clear Map", "ui"),
        tone: "warning",
        actionLabel: t("Undo", "ui"),
        onAction: () => {
          if (typeof runtimeState.runHistoryActionFn === "function") {
            callRuntimeHook(state, "runHistoryActionFn", "undo");
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
    internalBorderAutoColor.checked = String(runtimeState.styleConfig.internalBorders.colorMode || "auto") !== "manual";
    if (internalBorderColor) {
      internalBorderColor.disabled = internalBorderAutoColor.checked;
    }
    internalBorderAutoColor.addEventListener("change", (event) => {
      runtimeState.styleConfig.internalBorders.colorMode = event.target.checked ? "auto" : "manual";
      if (internalBorderColor) {
        internalBorderColor.disabled = event.target.checked;
      }
      renderDirty("internal-border-color-mode");
    });
  }
  if (internalBorderColor) {
    internalBorderColor.addEventListener("input", (event) => {
      runtimeState.styleConfig.internalBorders.color = event.target.value;
      runtimeState.styleConfig.internalBorders.colorMode = "manual";
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
      runtimeState.styleConfig.internalBorders.opacity = Number.isFinite(value) ? value : 1;
      if (internalBorderOpacityValue) {
        internalBorderOpacityValue.textContent = `${event.target.value}%`;
      }
      renderDirty("internal-border-opacity");
    });
  }
  if (internalBorderWidth) {
    const initialInternalWidth = Number(internalBorderWidth.value);
    if (Number.isFinite(initialInternalWidth)) {
      runtimeState.styleConfig.internalBorders.width = initialInternalWidth;
      if (internalBorderWidthValue) {
        internalBorderWidthValue.textContent = initialInternalWidth.toFixed(2);
      }
    }
    internalBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      runtimeState.styleConfig.internalBorders.width = Number.isFinite(value) ? value : 0.5;
      if (internalBorderWidthValue) {
        internalBorderWidthValue.textContent = value.toFixed(2);
      }
      renderDirty("internal-border-width");
    });
  }

  if (empireBorderColor) {
    empireBorderColor.addEventListener("input", (event) => {
      runtimeState.styleConfig.empireBorders.color = event.target.value;
      renderDirty("empire-border-color");
    });
  }
  if (empireBorderWidth) {
    const initialEmpireWidth = Number(empireBorderWidth.value);
    if (Number.isFinite(initialEmpireWidth)) {
      runtimeState.styleConfig.empireBorders.width = initialEmpireWidth;
      if (empireBorderWidthValue) {
        empireBorderWidthValue.textContent = initialEmpireWidth.toFixed(2);
      }
    }
    empireBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      runtimeState.styleConfig.empireBorders.width = Number.isFinite(value) ? value : 1.0;
      if (empireBorderWidthValue) {
        empireBorderWidthValue.textContent = value.toFixed(2);
      }
      renderDirty("empire-border-width");
    });
  }

  if (coastlineColor) {
    coastlineColor.addEventListener("input", (event) => {
      runtimeState.styleConfig.coastlines.color = event.target.value;
      renderDirty("coastline-color");
    });
  }
  if (coastlineWidth) {
    coastlineWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      runtimeState.styleConfig.coastlines.width = Number.isFinite(value) ? value : 1.2;
      if (coastlineWidthValue) {
        coastlineWidthValue.textContent = value.toFixed(1);
      }
      renderDirty("coastline-width");
    });
  }

  if (parentBorderColor) {
    parentBorderColor.value = runtimeState.styleConfig.parentBorders.color || "#4b5563";
    parentBorderColor.addEventListener("input", (event) => {
      runtimeState.styleConfig.parentBorders.color = event.target.value;
      renderDirty("parent-border-color");
    });
  }
  if (parentBorderOpacity) {
    const initial = Math.round((runtimeState.styleConfig.parentBorders.opacity || 0.85) * 100);
    parentBorderOpacity.value = String(clamp(initial, 0, 100));
    if (parentBorderOpacityValue) {
      parentBorderOpacityValue.textContent = `${parentBorderOpacity.value}%`;
    }
    parentBorderOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      runtimeState.styleConfig.parentBorders.opacity = clamp(
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
    const initial = Number(runtimeState.styleConfig.parentBorders.width || 1.1);
    parentBorderWidth.value = String(clamp(initial, 0.2, 4));
    if (parentBorderWidthValue) {
      parentBorderWidthValue.textContent = Number(parentBorderWidth.value).toFixed(2);
    }
    parentBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      runtimeState.styleConfig.parentBorders.width = clamp(Number.isFinite(value) ? value : 1.1, 0.2, 4);
      if (parentBorderWidthValue) {
        parentBorderWidthValue.textContent = runtimeState.styleConfig.parentBorders.width.toFixed(2);
      }
      renderDirty("parent-border-width");
    });
  }
  if (parentBordersVisible) {
    parentBordersVisible.checked = runtimeState.parentBordersVisible !== false;
    parentBordersVisible.addEventListener("change", (event) => {
      runtimeState.parentBordersVisible = !!event.target.checked;
      syncParentBorderVisibilityUI();
      renderParentBorderCountryList();
      renderDirty("parent-border-visibility");
    });
  }
  if (parentBorderEnableAll) {
    parentBorderEnableAll.addEventListener("click", () => {
      const supported = Array.isArray(runtimeState.parentBorderSupportedCountries)
        ? runtimeState.parentBorderSupportedCountries
        : [];
      supported.forEach((countryCode) => {
        runtimeState.parentBorderEnabledByCountry[countryCode] = true;
      });
      renderParentBorderCountryList();
      renderDirty("parent-border-enable-all");
    });
  }
  if (parentBorderDisableAll) {
    parentBorderDisableAll.addEventListener("click", () => {
      const supported = Array.isArray(runtimeState.parentBorderSupportedCountries)
        ? runtimeState.parentBorderSupportedCountries
        : [];
      supported.forEach((countryCode) => {
        runtimeState.parentBorderEnabledByCountry[countryCode] = false;
      });
      renderParentBorderCountryList();
      renderDirty("parent-border-disable-all");
    });
  }

  if (!runtimeState.ui.overlayResizeBound) {
    globalThis.addEventListener("resize", () => {
      applyResponsiveChromeDefaults();
      updateDockCollapsedUi();
      refreshScenarioContextBar();
      handlePaletteLibraryResize();
    });
    runtimeState.ui.overlayResizeBound = true;
  }

  syncPaletteLibraryPanelVisibility();
  syncPaletteSourceControls();
  renderPalette(runtimeState.currentPaletteTheme);
  renderPaletteLibrary();
  syncPanelToggleButtons();
  renderTransportWorkbenchUi();
  renderExportWorkbenchLayerList();
  callRuntimeHook(state, "updatePaintModeUIFn");
  registerRuntimeHook(state, "updateDockCollapsedUiFn", updateDockCollapsedUi);
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
  renderScenarioGuideSection("quick", { syncUrl: false });
  syncScenarioGuideTriggerButtons({
    isOpen: false,
    tutorialEntryVisible: !!runtimeState.ui.tutorialEntryVisible,
  });
  if (specialZonePopover) {
    specialZonePopover.setAttribute("aria-hidden", specialZonePopover.classList.contains("hidden") ? "true" : "false");
  }
  if (mapOnboardingHint) {
    mapOnboardingHint.setAttribute("role", "status");
    mapOnboardingHint.setAttribute("aria-live", "polite");
    if (runtimeState.onboardingDismissed) {
      dismissOnboardingHint();
    } else {
      showOnboardingHint();
    }
  }
  updateUIText();
}



export { initToolbar, resolveExportPassSequence };
