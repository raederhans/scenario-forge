// Toolbar UI (Phase 13)
import {
  state,
  PALETTE_THEMES,
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizeLakeStyleConfig,
  normalizePhysicalStyleConfig,
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
} from "../core/map_renderer.js";
import { captureHistoryState, canRedoHistory, canUndoHistory, pushHistoryEntry, redoHistory, undoHistory } from "../core/history_manager.js";
import {
  buildPaletteLibraryEntries,
  buildPaletteQuickSwatches,
  getPaletteSourceOptions,
  getSuggestedIso2,
  getUnmappedReason,
  normalizeHexColor,
  setActivePaletteSource,
} from "../core/palette_manager.js";
import { ensureActiveScenarioOptionalLayerLoaded, resetToScenarioBaseline } from "../core/scenario_manager.js";
import { toggleLanguage, updateUIText, t } from "./i18n.js";
import { resetAllFeatureOwnersToCanonical } from "../core/sovereignty_manager.js";
import { showToast } from "./toast.js";
import { showAppDialog } from "./app_dialog.js";
import { markDirty, updateDirtyIndicator } from "../core/dirty_state.js";

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


function initToolbar({ render } = {}) {
  const OCEAN_ADVANCED_PRESETS = new Set([
    "bathymetry_soft",
    "bathymetry_contours",
  ]);
  const toolButtons = document.querySelectorAll(".btn-tool");
  const customColor = document.getElementById("customColor");
  const exportBtn = document.getElementById("exportBtn");
  const exportFormat = document.getElementById("exportFormat");
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
  const textureDraftGridControls = document.getElementById("textureDraftGridControls");
  const textureDraftMajorStep = document.getElementById("textureDraftMajorStep");
  const textureDraftMinorStep = document.getElementById("textureDraftMinorStep");
  const textureDraftLonOffset = document.getElementById("textureDraftLonOffset");
  const textureDraftLatOffset = document.getElementById("textureDraftLatOffset");
  const textureDraftRoll = document.getElementById("textureDraftRoll");
  const dayNightEnabled = document.getElementById("dayNightEnabled");
  const dayNightModeManualBtn = document.getElementById("dayNightModeManualBtn");
  const dayNightModeUtcBtn = document.getElementById("dayNightModeUtcBtn");
  const dayNightManualControls = document.getElementById("dayNightManualControls");
  const dayNightManualTime = document.getElementById("dayNightManualTime");
  const dayNightUtcStatus = document.getElementById("dayNightUtcStatus");
  const dayNightCurrentTime = document.getElementById("dayNightCurrentTime");
  const dayNightCityLightsEnabled = document.getElementById("dayNightCityLightsEnabled");
  const dayNightCityLightsStyle = document.getElementById("dayNightCityLightsStyle");
  const dayNightCityLightsIntensity = document.getElementById("dayNightCityLightsIntensity");
  const dayNightCityLightsTextureOpacity = document.getElementById("dayNightCityLightsTextureOpacity");
  const dayNightCityLightsCorridorStrength = document.getElementById("dayNightCityLightsCorridorStrength");
  const dayNightCityLightsCoreSharpness = document.getElementById("dayNightCityLightsCoreSharpness");
  const dayNightShadowOpacity = document.getElementById("dayNightShadowOpacity");
  const dayNightTwilightWidth = document.getElementById("dayNightTwilightWidth");
  const toggleUrban = document.getElementById("toggleUrban");
  const togglePhysical = document.getElementById("togglePhysical");
  const toggleRivers = document.getElementById("toggleRivers");
  const toggleCityPoints = document.getElementById("toggleCityPoints");
  const toggleWaterRegions = document.getElementById("toggleWaterRegions");
  const toggleOpenOceanRegions = document.getElementById("toggleOpenOceanRegions");
  const toggleSpecialZones = document.getElementById("toggleSpecialZones");
  const cityPointsTheme = document.getElementById("cityPointsTheme");
  const cityPointsMarkerScale = document.getElementById("cityPointsMarkerScale");
  const cityPointsLabelDensity = document.getElementById("cityPointsLabelDensity");
  const cityPointsColor = document.getElementById("cityPointsColor");
  const cityPointsCapitalColor = document.getElementById("cityPointsCapitalColor");
  const cityPointsOpacity = document.getElementById("cityPointsOpacity");
  const cityPointsRadius = document.getElementById("cityPointsRadius");
  const cityPointLabelsEnabled = document.getElementById("cityPointLabelsEnabled");
  const cityPointsLabelSize = document.getElementById("cityPointsLabelSize");
  const cityCapitalOverlayEnabled = document.getElementById("cityCapitalOverlayEnabled");
  const urbanColor = document.getElementById("urbanColor");
  const urbanOpacity = document.getElementById("urbanOpacity");
  const urbanBlendMode = document.getElementById("urbanBlendMode");
  const urbanMinArea = document.getElementById("urbanMinArea");
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
  const physicalContourLowReliefCutoff = document.getElementById("physicalContourLowReliefCutoff");
  const physicalBlendMode = document.getElementById("physicalBlendMode");
  const physicalClassMountain = document.getElementById("physicalClassMountain");
  const physicalClassPlateau = document.getElementById("physicalClassPlateau");
  const physicalClassPlains = document.getElementById("physicalClassPlains");
  const physicalClassWetlands = document.getElementById("physicalClassWetlands");
  const physicalClassForest = document.getElementById("physicalClassForest");
  const physicalClassRainforest = document.getElementById("physicalClassRainforest");
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
  const colorModeSelect = document.getElementById("colorModeSelect");
  const bottomDock = document.getElementById("bottomDock");
  const dockCollapseBtn = document.getElementById("dockCollapseBtn");
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
  const toolHudChip = document.getElementById("toolHudChip");
  const mapOnboardingHint = document.getElementById("mapOnboardingHint");
  const scenarioContextBar = document.getElementById("scenarioContextBar");
  const scenarioContextCollapseBtn = document.getElementById("scenarioContextCollapseBtn");
  const scenarioContextScenarioItem = document.getElementById("scenarioContextScenarioItem");
  const scenarioContextModeItem = document.getElementById("scenarioContextModeItem");
  const scenarioContextActiveItem = document.getElementById("scenarioContextActiveItem");
  const scenarioContextScenarioText = document.getElementById("scenarioContextScenarioText");
  const scenarioContextModeText = document.getElementById("scenarioContextModeText");
  const scenarioContextActiveText = document.getElementById("scenarioContextActiveText");
  const scenarioGuideBtn = document.getElementById("scenarioGuideBtn");
  const scenarioGuidePopover = document.getElementById("scenarioGuidePopover");
  const scenarioGuideStatus = document.getElementById("scenarioGuideStatus");
  const scenarioGuideStatusChips = document.getElementById("scenarioGuideStatusChips");
  const dockReferenceBtn = document.getElementById("dockReferenceBtn");
  const dockExportBtn = document.getElementById("dockExportBtn");
  const dockReferencePopover = document.getElementById("dockReferencePopover");
  const dockExportPopover = document.getElementById("dockExportPopover");
  const devWorkspaceToggleBtn = document.getElementById("devWorkspaceToggleBtn");
  const leftPanelToggle = document.getElementById("leftPanelToggle");
  const rightPanelToggle = document.getElementById("rightPanelToggle");
  const dockPaintSummary = document.getElementById("dockPaintSummary");
  const paintGranularitySelect = document.getElementById("paintGranularitySelect");
  const dockQuickFillRow = document.getElementById("dockQuickFillRow");
  const quickFillParentBtn = document.getElementById("quickFillParentBtn");
  const quickFillCountryBtn = document.getElementById("quickFillCountryBtn");
  const dockQuickFillHint = document.getElementById("dockQuickFillHint");
  const paintModeSelect = document.getElementById("paintModeSelect");
  const paintModeVisualBtn = document.getElementById("paintModeVisualBtn");
  const paintModePoliticalBtn = document.getElementById("paintModePoliticalBtn");
  const politicalEditingToggleBtn = document.getElementById("politicalEditingToggleBtn");
  const scenarioVisualAdjustmentsBtn = document.getElementById("scenarioVisualAdjustmentsBtn");
  const dockPoliticalEditingPanel = document.getElementById("dockPoliticalEditingPanel");
  const activeSovereignLabel = document.getElementById("activeSovereignLabel");
  const recalculateBordersBtn = document.getElementById("recalculateBordersBtn");
  const dynamicBorderStatus = document.getElementById("dynamicBorderStatus");
  const internalBorderColor = document.getElementById("internalBorderColor");
  const internalBorderOpacity = document.getElementById("internalBorderOpacity");
  const internalBorderWidth = document.getElementById("internalBorderWidth");
  const empireBorderColor = document.getElementById("empireBorderColor");
  const empireBorderWidth = document.getElementById("empireBorderWidth");
  const coastlineColor = document.getElementById("coastlineColor");
  const coastlineWidth = document.getElementById("coastlineWidth");
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
  const workspaceScenarioValue = document.getElementById("workspaceScenarioValue");
  const workspaceModeValue = document.getElementById("workspaceModeValue");
  const workspaceSelectionValue = document.getElementById("workspaceSelectionValue");
  const workspaceSelectionHint = document.getElementById("workspaceSelectionHint");
  const paletteLibraryToggleLabel = document.getElementById("paletteLibraryToggleLabel");

  const internalBorderOpacityValue = document.getElementById("internalBorderOpacityValue");
  const internalBorderWidthValue = document.getElementById("internalBorderWidthValue");
  const empireBorderWidthValue = document.getElementById("empireBorderWidthValue");
  const coastlineWidthValue = document.getElementById("coastlineWidthValue");
  const parentBorderOpacityValue = document.getElementById("parentBorderOpacityValue");
  const parentBorderWidthValue = document.getElementById("parentBorderWidthValue");
  const urbanOpacityValue = document.getElementById("urbanOpacityValue");
  const urbanMinAreaValue = document.getElementById("urbanMinAreaValue");
  const cityPointsOpacityValue = document.getElementById("cityPointsOpacityValue");
  const cityPointsMarkerScaleValue = document.getElementById("cityPointsMarkerScaleValue");
  const cityPointsRadiusValue = document.getElementById("cityPointsRadiusValue");
  const cityPointsLabelSizeValue = document.getElementById("cityPointsLabelSizeValue");
  const physicalOpacityValue = document.getElementById("physicalOpacityValue");
  const physicalAtlasIntensityValue = document.getElementById("physicalAtlasIntensityValue");
  const physicalRainforestEmphasisValue = document.getElementById("physicalRainforestEmphasisValue");
  const physicalContourOpacityValue = document.getElementById("physicalContourOpacityValue");
  const physicalContourMajorWidthValue = document.getElementById("physicalContourMajorWidthValue");
  const physicalContourMinorWidthValue = document.getElementById("physicalContourMinorWidthValue");
  const physicalContourMajorIntervalValue = document.getElementById("physicalContourMajorIntervalValue");
  const physicalContourMinorIntervalValue = document.getElementById("physicalContourMinorIntervalValue");
  const physicalContourLowReliefCutoffValue = document.getElementById("physicalContourLowReliefCutoffValue");
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
  const textureDraftMajorStepValue = document.getElementById("textureDraftMajorStepValue");
  const textureDraftMinorStepValue = document.getElementById("textureDraftMinorStepValue");
  const textureDraftLonOffsetValue = document.getElementById("textureDraftLonOffsetValue");
  const textureDraftLatOffsetValue = document.getElementById("textureDraftLatOffsetValue");
  const textureDraftRollValue = document.getElementById("textureDraftRollValue");
  const dayNightManualTimeValue = document.getElementById("dayNightManualTimeValue");
  const dayNightCityLightsIntensityValue = document.getElementById("dayNightCityLightsIntensityValue");
  const dayNightCityLightsTextureOpacityValue = document.getElementById("dayNightCityLightsTextureOpacityValue");
  const dayNightCityLightsCorridorStrengthValue = document.getElementById("dayNightCityLightsCorridorStrengthValue");
  const dayNightCityLightsCoreSharpnessValue = document.getElementById("dayNightCityLightsCoreSharpnessValue");
  const dayNightShadowOpacityValue = document.getElementById("dayNightShadowOpacityValue");
  const dayNightTwilightWidthValue = document.getElementById("dayNightTwilightWidthValue");
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
  const appearanceTabButtons = Array.from(document.querySelectorAll("[data-appearance-tab]"));
  const appearanceTabPanels = Array.from(document.querySelectorAll("[data-appearance-panel]"));
  const appearanceSpecialZoneBtn = document.getElementById("appearanceSpecialZoneBtn");
  const specialZonePopover = document.getElementById("specialZonePopover");
  const specialZoneEditorInline = specialZonePopover?.dataset.inlineEditor === "true";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const physicalClassToggleMap = {
    mountain_high_relief: physicalClassMountain,
    upland_plateau: physicalClassPlateau,
    plains_lowlands: physicalClassPlains,
    wetlands_delta: physicalClassWetlands,
    forest: physicalClassForest,
    rainforest: physicalClassRainforest,
    desert_bare: physicalClassDesert,
    tundra_ice: physicalClassTundra,
  };
  let toolHudTimerId = null;
  let scenarioGuideTimerId = null;
  let dockPopoverCloseBound = false;
  const overlayFocusReturnTargets = new WeakMap();
  const PALETTE_LIBRARY_GROUPS = [
    { key: "essentials", label: () => t("Essentials", "ui"), defaultOpen: true },
    { key: "dynamic", label: () => t("Dynamic / Runtime", "ui"), defaultOpen: false },
    { key: "countries", label: () => t("Countries", "ui"), defaultOpen: false },
    { key: "extra", label: () => t("Extra", "ui"), defaultOpen: false },
  ];
  const MOBILE_WORKSPACE_MAX_WIDTH = 767;
  const TABLET_WORKSPACE_MAX_WIDTH = 1023;
  const SCENARIO_BAR_LEFT_OFFSET = 18;
  const SCENARIO_BAR_MOBILE_LEFT_OFFSET = 12;
  const SCENARIO_BAR_SAFE_GAP = 16;
  const SCENARIO_BAR_MIN_WIDTH = 172;
  const SCENARIO_GUIDE_MAX_WIDTH = 360;
  if (!state.ui || typeof state.ui !== "object") {
    state.ui = {};
  }
  state.ui.dockCollapsed = !!state.ui.dockCollapsed;
  state.ui.scenarioBarCollapsed = !!state.ui.scenarioBarCollapsed;
  state.ui.scenarioGuideDismissed = !!state.ui.scenarioGuideDismissed;
  state.ui.politicalEditingExpanded = !!state.ui.politicalEditingExpanded;
  state.ui.scenarioVisualAdjustmentsOpen = !!state.ui.scenarioVisualAdjustmentsOpen;
  state.ui.responsiveChromeTier = String(state.ui.responsiveChromeTier || "");
  if (!state.ui.paletteLibrarySections || typeof state.ui.paletteLibrarySections !== "object") {
    state.ui.paletteLibrarySections = {};
  }

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

  const getFocusableElements = (container) => {
    if (!(container instanceof HTMLElement)) return [];
    const candidates = Array.from(container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    return candidates.filter((element) => (
      element instanceof HTMLElement
      && !element.hidden
      && element.getAttribute("aria-hidden") !== "true"
      && element.tabIndex >= 0
    ));
  };

  const focusOverlaySurface = (container) => {
    if (!(container instanceof HTMLElement)) return;
    const [firstFocusable] = getFocusableElements(container);
    const target = firstFocusable || container;
    if (!target.hasAttribute("tabindex")) {
      container.setAttribute("tabindex", "-1");
    }
    if (typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
  };

  const rememberOverlayTrigger = (overlay, trigger) => {
    if (!(overlay instanceof HTMLElement) || !(trigger instanceof HTMLElement)) return;
    overlayFocusReturnTargets.set(overlay, trigger);
  };

  const restoreOverlayTriggerFocus = (overlay, explicitTrigger = null) => {
    const target = explicitTrigger instanceof HTMLElement
      ? explicitTrigger
      : overlayFocusReturnTargets.get(overlay);
    if (target && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
  };

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

  const refreshWorkspaceStatus = () => {
    if (workspaceScenarioValue) {
      workspaceScenarioValue.textContent = String(
        state.activeScenarioManifest?.display_name || state.activeScenarioId || t("None", "ui")
      ).trim() || t("None", "ui");
    }
    if (workspaceModeValue) {
      workspaceModeValue.textContent = getPaintModeLabel();
    }
    if (workspaceSelectionValue) {
      workspaceSelectionValue.textContent = getWorkspaceSelectionLabel();
    }
    if (workspaceSelectionHint) {
      workspaceSelectionHint.textContent = t("Choose a country, water region, or special region.", "ui");
    }
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

    if (dockQuickFillRow) {
      dockQuickFillRow.classList.toggle("hidden", !isVisible);
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

    if (dockPaintSummary) {
      dockPaintSummary.textContent = `${getPaintModeLabel()} ${t("Brush", "ui")}`;
    }

    if (document.getElementById("labelPresetPolitical")) {
      document.getElementById("labelPresetPolitical").textContent = getPrimaryActionLabel();
    }

    if (paintGranularitySelect) {
      paintGranularitySelect.classList.toggle("hidden", isScenarioMode);
    }

    if (politicalEditingToggleBtn) {
      politicalEditingToggleBtn.classList.toggle("hidden", isScenarioMode);
      politicalEditingToggleBtn.classList.toggle("is-active", showPoliticalPanel);
      politicalEditingToggleBtn.setAttribute("aria-expanded", String(showPoliticalPanel));
    }

    if (scenarioVisualAdjustmentsBtn) {
      scenarioVisualAdjustmentsBtn.classList.toggle("hidden", !isScenarioMode);
    }

    if (dockPoliticalEditingPanel) {
      dockPoliticalEditingPanel.classList.toggle("hidden", !showPoliticalPanel);
      dockPoliticalEditingPanel.setAttribute("aria-hidden", showPoliticalPanel ? "false" : "true");
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
      dockCollapseBtn.textContent = state.ui.dockCollapsed ? t("Expand", "ui") : t("Collapse", "ui");
      dockCollapseBtn.setAttribute("aria-pressed", state.ui.dockCollapsed ? "true" : "false");
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

  const closeScenarioGuidePopover = ({ restoreFocus = false } = {}) => {
    if (!scenarioGuidePopover) return;
    scenarioGuidePopover.classList.add("hidden");
    scenarioGuidePopover.setAttribute("aria-hidden", "true");
    scenarioGuideBtn?.classList.remove("is-active");
    scenarioGuideBtn?.setAttribute("aria-expanded", "false");
    if (scenarioGuideBtn) {
      scenarioGuideBtn.textContent = "?";
      scenarioGuideBtn.setAttribute("title", t("Show guide", "ui"));
    }
    if (restoreFocus) {
      restoreOverlayTriggerFocus(scenarioGuidePopover, scenarioGuideBtn);
    }
  };

  const toggleScenarioGuidePopover = () => {
    if (!scenarioGuidePopover) return;
    const willOpen = scenarioGuidePopover.classList.contains("hidden");
    if (!willOpen) {
      closeScenarioGuidePopover({ restoreFocus: true });
      applyScenarioOverlaySafeLayout();
      return;
    }
    rememberOverlayTrigger(scenarioGuidePopover, scenarioGuideBtn);
    scenarioGuidePopover.classList.remove("hidden");
    scenarioGuidePopover.setAttribute("aria-hidden", "false");
    scenarioGuideBtn?.classList.add("is-active");
    scenarioGuideBtn?.setAttribute("aria-expanded", "true");
    if (scenarioGuideBtn) {
      scenarioGuideBtn.textContent = "?";
      scenarioGuideBtn.setAttribute("title", t("Hide guide", "ui"));
    }
    focusOverlaySurface(scenarioGuidePopover);
    applyScenarioOverlaySafeLayout();
  };

  const getScenarioOverlayLeftInset = () => (
    globalThis.innerWidth <= 767 ? SCENARIO_BAR_MOBILE_LEFT_OFFSET : SCENARIO_BAR_LEFT_OFFSET
  );

  const renderScenarioGuideStatus = ({
    activeScenario = "",
    modeLabel = "",
    scenarioViewLabel = "",
    splitCount = 0,
  } = {}) => {
    if (!scenarioGuideStatusChips) return;
    const statusChips = [
      { label: t("Mode", "ui"), value: modeLabel },
    ];
    if (activeScenario) {
      statusChips.push(
        { label: t("View", "ui"), value: scenarioViewLabel },
        { label: t("Split", "ui"), value: String(splitCount) }
      );
    }
    scenarioGuideStatusChips.replaceChildren();
    statusChips
      .filter((chip) => String(chip.value || "").trim())
      .forEach((chip) => {
        const pill = document.createElement("span");
        pill.className = "scenario-guide-status-pill";

        const label = document.createElement("span");
        label.className = "scenario-guide-status-pill-label";
        label.textContent = `${chip.label}:`;

        const value = document.createElement("span");
        value.textContent = chip.value;

        pill.appendChild(label);
        pill.appendChild(value);
        scenarioGuideStatusChips.appendChild(pill);
      });
    scenarioGuideStatus?.classList.toggle("hidden", !scenarioGuideStatusChips.childElementCount);
  };

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
    if (scenarioGuidePopover) {
      const guideWidth = Math.max(
        SCENARIO_BAR_MIN_WIDTH,
        Math.min(SCENARIO_GUIDE_MAX_WIDTH, availableWidth)
      );
      scenarioGuidePopover.style.maxWidth = `${guideWidth}px`;
    }
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
    scenarioContextBar.classList.toggle("is-scenario", showScenarioState);
    scenarioContextBar.classList.toggle("is-collapsed", !!state.ui.scenarioBarCollapsed);
    scenarioContextScenarioItem?.classList.toggle("hidden", !showScenarioState);
    scenarioContextModeItem?.classList.toggle("hidden", showScenarioState);
    scenarioContextActiveItem?.classList.toggle("hidden", !showScenarioState);
    if (scenarioContextScenarioText) {
      scenarioContextScenarioText.textContent = activeScenario || t("None", "ui");
      scenarioContextScenarioText.setAttribute("title", `${t("Scenario", "ui")}: ${activeScenario || t("None", "ui")}`);
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
    if (scenarioGuideBtn) {
      scenarioGuideBtn.textContent = "?";
      const isGuideOpen = !!(scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden"));
      scenarioGuideBtn.setAttribute("title", isGuideOpen ? t("Hide guide", "ui") : t("Show guide", "ui"));
    }
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

  const getDockPopoverByKind = (kind) => (kind === "reference" ? dockReferencePopover : kind === "export" ? dockExportPopover : null);
  const getDockPopoverTrigger = (kind) => (kind === "reference" ? dockReferenceBtn : kind === "export" ? dockExportBtn : null);

  const closeDockPopover = ({ restoreFocus = false } = {}) => {
    const activeKind = String(state.activeDockPopover || "");
    const activePopover = getDockPopoverByKind(activeKind);
    const activeTrigger = getDockPopoverTrigger(activeKind);
    state.activeDockPopover = "";
    dockReferencePopover?.classList.add("hidden");
    dockExportPopover?.classList.add("hidden");
    dockReferencePopover?.setAttribute("aria-hidden", "true");
    dockExportPopover?.setAttribute("aria-hidden", "true");
    dockReferenceBtn?.classList.remove("is-active");
    dockExportBtn?.classList.remove("is-active");
    dockReferenceBtn?.setAttribute("aria-expanded", "false");
    dockExportBtn?.setAttribute("aria-expanded", "false");
    if (restoreFocus && activePopover) {
      restoreOverlayTriggerFocus(activePopover, activeTrigger);
    }
  };
  state.closeDockPopoverFn = closeDockPopover;

  const openDockPopover = (kind) => {
    const target = kind === "reference" ? dockReferencePopover : dockExportPopover;
    const trigger = getDockPopoverTrigger(kind);
    if (!target) return;
    const nextKind = state.activeDockPopover === kind ? "" : kind;
    closeDockPopover();
    if (!nextKind) return;
    state.activeDockPopover = nextKind;
    rememberOverlayTrigger(target, trigger);
    target.classList.remove("hidden");
    target.setAttribute("aria-hidden", "false");
    if (nextKind === "reference") {
      dockReferenceBtn?.classList.add("is-active");
      dockReferenceBtn?.setAttribute("aria-expanded", "true");
    } else {
      dockExportBtn?.classList.add("is-active");
      dockExportBtn?.setAttribute("aria-expanded", "true");
    }
    focusOverlaySurface(target);
  };

  const bindDockPopoverDismiss = () => {
    if (dockPopoverCloseBound) return;
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const insideDockPopover = target.closest("#dockReferencePopover, #dockExportPopover, #dockReferenceBtn, #dockExportBtn");
      if (state.activeDockPopover && !insideDockPopover) {
        closeDockPopover();
      }
      const insideSpecialZone = target.closest("#specialZonePopover, #appearanceSpecialZoneBtn");
      if (!specialZoneEditorInline && specialZonePopover && !specialZonePopover.classList.contains("hidden") && !insideSpecialZone) {
        closeSpecialZonePopover();
      }
      const insideScenarioGuide = target.closest("#scenarioGuidePopover, #scenarioGuideBtn");
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden") && !insideScenarioGuide) {
        closeScenarioGuidePopover();
      }
    });
    document.addEventListener("keydown", (event) => {
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
    "styleConfig.texture.graticule.majorWidth",
    "styleConfig.texture.graticule.minorWidth",
    "styleConfig.texture.graticule.majorOpacity",
    "styleConfig.texture.graticule.minorOpacity",
    "styleConfig.texture.draftGrid.majorStep",
    "styleConfig.texture.draftGrid.minorStep",
    "styleConfig.texture.draftGrid.lonOffset",
    "styleConfig.texture.draftGrid.latOffset",
    "styleConfig.texture.draftGrid.roll",
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

  const syncPhysicalConfig = () => {
    state.styleConfig.physical = normalizePhysicalStyleConfig(state.styleConfig.physical);
    state.styleConfig.physical.contourColor = normalizeOceanFillColor(
      state.styleConfig.physical.contourColor || "#6b5947"
    );
    return state.styleConfig.physical;
  };

  const syncDayNightConfig = () => {
    state.styleConfig.dayNight = normalizeDayNightStyleConfig(state.styleConfig.dayNight);
    return state.styleConfig.dayNight;
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
    if (textureSelect) textureSelect.value = mode;
    if (textureOpacity) textureOpacity.value = String(Math.round(texture.opacity * 100));
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
    updateTextureValueLabel(textureGraticuleMajorStepValue, `${Math.round(texture.graticule.majorStep)}°`);
    if (textureGraticuleMinorStep) textureGraticuleMinorStep.value = String(texture.graticule.minorStep);
    updateTextureValueLabel(textureGraticuleMinorStepValue, `${Math.round(texture.graticule.minorStep)}°`);
    if (textureGraticuleLabelStep) textureGraticuleLabelStep.value = String(texture.graticule.labelStep);
    updateTextureValueLabel(textureGraticuleLabelStepValue, `${Math.round(texture.graticule.labelStep)}°`);

    if (textureDraftMajorStep) textureDraftMajorStep.value = String(texture.draftGrid.majorStep);
    updateTextureValueLabel(textureDraftMajorStepValue, `${Math.round(texture.draftGrid.majorStep)}°`);
    if (textureDraftMinorStep) textureDraftMinorStep.value = String(texture.draftGrid.minorStep);
    updateTextureValueLabel(textureDraftMinorStepValue, `${Math.round(texture.draftGrid.minorStep)}°`);
    if (textureDraftLonOffset) textureDraftLonOffset.value = String(Math.round(texture.draftGrid.lonOffset));
    updateTextureValueLabel(textureDraftLonOffsetValue, `${Math.round(texture.draftGrid.lonOffset)}°`);
    if (textureDraftLatOffset) textureDraftLatOffset.value = String(Math.round(texture.draftGrid.latOffset));
    updateTextureValueLabel(textureDraftLatOffsetValue, `${Math.round(texture.draftGrid.latOffset)}°`);
    if (textureDraftRoll) textureDraftRoll.value = String(Math.round(texture.draftGrid.roll));
    updateTextureValueLabel(textureDraftRollValue, `${Math.round(texture.draftGrid.roll)}°`);

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
  if (!state.styleConfig.urban || typeof state.styleConfig.urban !== "object") {
    state.styleConfig.urban = {};
  }
  state.styleConfig.urban.color = normalizeOceanFillColor(state.styleConfig.urban.color || "#4b5563");
  state.styleConfig.urban.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.urban.opacity)) ? Number(state.styleConfig.urban.opacity) : 0.4,
    0,
    1
  );
  state.styleConfig.urban.blendMode = String(state.styleConfig.urban.blendMode || "multiply");
  state.styleConfig.urban.minAreaPx = clamp(
    Number.isFinite(Number(state.styleConfig.urban.minAreaPx)) ? Number(state.styleConfig.urban.minAreaPx) : 8,
    0,
    80
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

  if (!state.styleConfig.specialZones || typeof state.styleConfig.specialZones !== "object") {
    state.styleConfig.specialZones = {};
  }
  state.styleConfig.specialZones.disputedFill = normalizeOceanFillColor(
    state.styleConfig.specialZones.disputedFill || "#f97316"
  );
  state.styleConfig.specialZones.disputedStroke = normalizeOceanFillColor(
    state.styleConfig.specialZones.disputedStroke || "#ea580c"
  );
  state.styleConfig.specialZones.wastelandFill = normalizeOceanFillColor(
    state.styleConfig.specialZones.wastelandFill || "#dc2626"
  );
  state.styleConfig.specialZones.wastelandStroke = normalizeOceanFillColor(
    state.styleConfig.specialZones.wastelandStroke || "#b91c1c"
  );
  state.styleConfig.specialZones.customFill = normalizeOceanFillColor(
    state.styleConfig.specialZones.customFill || "#8b5cf6"
  );
  state.styleConfig.specialZones.customStroke = normalizeOceanFillColor(
    state.styleConfig.specialZones.customStroke || "#6d28d9"
  );
  state.styleConfig.specialZones.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.specialZones.opacity))
      ? Number(state.styleConfig.specialZones.opacity)
      : 0.32,
    0,
    1
  );
  state.styleConfig.specialZones.strokeWidth = clamp(
    Number.isFinite(Number(state.styleConfig.specialZones.strokeWidth))
      ? Number(state.styleConfig.specialZones.strokeWidth)
      : 1.3,
    0.4,
    4
  );
  state.styleConfig.specialZones.dashStyle = String(state.styleConfig.specialZones.dashStyle || "dashed");
  state.styleConfig.texture = normalizeTextureStyleConfig(state.styleConfig.texture);

  if (!state.manualSpecialZones || state.manualSpecialZones.type !== "FeatureCollection") {
    state.manualSpecialZones = { type: "FeatureCollection", features: [] };
  }
  if (!Array.isArray(state.manualSpecialZones.features)) {
    state.manualSpecialZones.features = [];
  }
  if (!state.specialZoneEditor || typeof state.specialZoneEditor !== "object") {
    state.specialZoneEditor = {};
  }
  state.specialZoneEditor.zoneType = String(state.specialZoneEditor.zoneType || "custom");
  state.specialZoneEditor.label = String(state.specialZoneEditor.label || "");
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
      oceanBathymetrySourceValue.textContent = String(state.activeBathymetrySource || "none");
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

  function syncPaletteSourceControls() {
    const activeValue = String(state.activePaletteId || "");
    if (themeSelect && themeSelect.value !== activeValue) {
      themeSelect.value = activeValue;
    }
  }
  state.updatePaletteSourceUIFn = syncPaletteSourceControls;
  state.renderPaletteFn = renderPalette;

  const ensurePaletteLibrarySectionState = (sourceId) => {
    const key = String(sourceId || "legacy").trim() || "legacy";
    if (!state.ui.paletteLibrarySections[key] || typeof state.ui.paletteLibrarySections[key] !== "object") {
      state.ui.paletteLibrarySections[key] = {};
    }
    return state.ui.paletteLibrarySections[key];
  };

  const buildPaletteLibraryGroups = (entries) => {
    const groups = {
      essentials: [],
      dynamic: [],
      countries: [],
      extra: [],
    };
    entries.forEach((entry) => {
      if (Number.isFinite(entry.quickIndex)) {
        groups.essentials.push(entry);
        return;
      }
      if (entry.dynamic) {
        groups.dynamic.push(entry);
        return;
      }
      if (entry.mapped) {
        groups.countries.push(entry);
        return;
      }
      groups.extra.push(entry);
    });
    return PALETTE_LIBRARY_GROUPS.map((group) => ({
      ...group,
      entries: groups[group.key] || [],
    })).filter((group) => group.entries.length > 0);
  };

  const createPaletteLibraryRow = (entry) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "palette-library-row";
    row.dataset.color = entry.color;
    row.dataset.tag = entry.sourceTag;
    row.dataset.iso2 = entry.mappedIso2 || "";
    if (entry.color === state.selectedColor) {
      row.classList.add("is-selected");
    }
    row.addEventListener("click", () => {
      state.selectedColor = entry.color;
      updateSwatchUI();
    });

    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.dataset.color = entry.color;
    swatch.style.backgroundColor = entry.color;

    const meta = document.createElement("span");
    meta.className = "palette-library-meta";

    const title = document.createElement("span");
    title.className = "palette-library-title";
    title.textContent = entry.localizedName || entry.label;

    const subtitle = document.createElement("span");
    subtitle.className = "palette-library-subtitle";
    const isoTag = entry.mappedIso2 || entry.iso2 || "--";
    const sourceTag = entry.sourceLabel || entry.sourceTag || "Palette";
    subtitle.textContent = `${isoTag} · ${sourceTag}`;
    row.title = [
      entry.localizedName || entry.label,
      entry.sourceTag,
      entry.countryFileLabel,
      entry.mappedIso2
        ? `${t("Mapped to", "ui")} ${entry.mappedIso2}`
        : `${t("Unmapped", "ui")}: ${formatPaletteReason(entry)}`,
    ].filter(Boolean).join(" · ");

    meta.appendChild(title);
    meta.appendChild(subtitle);
    row.appendChild(swatch);
    row.appendChild(meta);
    return row;
  };

  const renderPaletteLibrarySourceTabs = (sourceOptions) => {
    if (!paletteLibrarySources) return;
    paletteLibrarySources.replaceChildren();
    if (!sourceOptions.length) {
      paletteLibrarySources.classList.add("hidden");
      return;
    }
    paletteLibrarySources.classList.remove("hidden");
    sourceOptions.forEach((optionData) => {
      const button = document.createElement("button");
      const isActive = optionData.value === state.activePaletteId;
      button.type = "button";
      button.className = "palette-library-source-btn";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(isActive));
      button.classList.toggle("is-active", isActive);
      button.textContent = optionData.label;
      button.addEventListener("click", async () => {
        if (isActive) return;
        await handlePaletteSourceChange(optionData.value);
      });
      paletteLibrarySources.appendChild(button);
    });
  };

  const PALETTE_LIBRARY_HEIGHT = {
    base: 240,
    cap: 480,
  };
  let adaptivePaletteLibraryHeightFrame = 0;

  const clampPaletteLibraryHeight = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

  const syncAdaptivePaletteLibraryHeight = () => {
    adaptivePaletteLibraryHeightFrame = 0;
    if (!paletteLibraryList || !state.paletteLibraryOpen) return;
    const scrollHeight = Number(paletteLibraryList.scrollHeight || 0);
    const nextHeight = clampPaletteLibraryHeight(
      scrollHeight,
      PALETTE_LIBRARY_HEIGHT.base,
      PALETTE_LIBRARY_HEIGHT.cap
    );
    paletteLibraryList.style.height = `${Math.round(nextHeight)}px`;
    paletteLibraryList.style.maxHeight = `${Math.round(nextHeight)}px`;
  };

  const scheduleAdaptivePaletteLibraryHeight = () => {
    if (adaptivePaletteLibraryHeightFrame) {
      globalThis.cancelAnimationFrame(adaptivePaletteLibraryHeightFrame);
    }
    adaptivePaletteLibraryHeightFrame = globalThis.requestAnimationFrame(syncAdaptivePaletteLibraryHeight);
  };

  const syncPaletteLibraryToggleUi = () => {
    if (!paletteLibraryToggle) return;
    const label = state.paletteLibraryOpen
      ? t("Hide Color Library", "ui")
      : t("Browse All Colors", "ui");
    paletteLibraryToggle.setAttribute("aria-expanded", state.paletteLibraryOpen ? "true" : "false");
    paletteLibraryToggle.setAttribute("aria-label", label);
    paletteLibraryToggle.setAttribute("title", label);
    paletteLibraryToggle.dataset.expanded = state.paletteLibraryOpen ? "true" : "false";
    if (paletteLibraryToggleLabel) {
      paletteLibraryToggleLabel.textContent = label;
    }
  };

  async function handlePaletteSourceChange(nextPaletteId) {
    const targetId = String(nextPaletteId || "").trim();
    if (!targetId || targetId === state.activePaletteId) {
      syncPaletteSourceControls();
      return;
    }
    const didChange = await setActivePaletteSource(targetId, {
      syncUI: true,
      overwriteCountryPalette: false,
    });
    if (!didChange) {
      syncPaletteSourceControls();
    }
  }

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

  function renderPaletteLibrary() {
    if (!paletteLibraryList) return;

    const searchTerm = String(state.paletteLibrarySearch || "").trim().toLowerCase();
    const sourceOptions = getPaletteSourceOptions();
    renderPaletteLibrarySourceTabs(sourceOptions);
    const sourceLabel = state.activePaletteMeta?.display_name || state.currentPaletteTheme || "Palette";
    const summarizeResults = (count) => (
      state.currentLanguage === "zh"
        ? `${count} 个颜色，来源 ${sourceLabel}`
        : `${count} colors from ${sourceLabel}`
    );
    let entries = [];
    if (state.activePalettePack?.entries) {
      entries = buildPaletteLibraryEntries();
    } else {
      entries = (PALETTE_THEMES[state.currentPaletteTheme] || []).map((color, index) => ({
        key: `legacy-${index}`,
        sourceTag: `LEGACY-${index + 1}`,
        iso2: "",
        color,
        label: `Palette Color ${index + 1}`,
        sourceLabel,
        mapped: false,
        unmappedReason: "",
        dynamic: false,
      }));
    }

    const filtered = entries.filter((entry) => {
      if (!searchTerm) return true;
      return [
        entry.label,
        entry.localizedName,
        entry.countryFileLabel,
        entry.iso2,
        entry.sourceTag,
        entry.sourceLabel,
        entry.mappingStatus,
        entry.mappedIso2,
        entry.unmappedReason,
        entry.suggestedIso2,
      ].some((value) => String(value || "").toLowerCase().includes(searchTerm));
    });
    const groupedEntries = buildPaletteLibraryGroups(filtered);
    const activeSourceId = String(state.activePaletteId || state.currentPaletteTheme || "legacy").trim() || "legacy";
    const sectionState = ensurePaletteLibrarySectionState(activeSourceId);

    paletteLibraryList.replaceChildren();
    if (paletteLibrarySummary) {
      paletteLibrarySummary.textContent = summarizeResults(filtered.length);
    }

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "palette-library-empty";
      empty.textContent = t("No palette colors match the current search.", "ui");
      paletteLibraryList.appendChild(empty);
      scheduleAdaptivePaletteLibraryHeight();
      return;
    }

    groupedEntries.forEach((group) => {
      const section = document.createElement("details");
      section.className = "palette-library-section";
      const isOpen = searchTerm
        ? group.entries.length > 0
        : (typeof sectionState[group.key] === "boolean" ? sectionState[group.key] : group.defaultOpen);
      section.open = isOpen;
      section.addEventListener("toggle", () => {
        if (searchTerm) return;
        sectionState[group.key] = section.open;
        scheduleAdaptivePaletteLibraryHeight();
      });

      const summary = document.createElement("summary");

      const heading = document.createElement("div");
      heading.className = "palette-library-section-heading";

      const title = document.createElement("div");
      title.className = "palette-library-section-title";
      title.textContent = group.label();

      const count = document.createElement("div");
      count.className = "palette-library-section-count";
      count.textContent = String(group.entries.length);

      heading.appendChild(title);
      heading.appendChild(count);
      summary.appendChild(heading);
      section.appendChild(summary);

      const list = document.createElement("div");
      list.className = "palette-library-section-list";
      group.entries.forEach((entry) => {
        list.appendChild(createPaletteLibraryRow(entry));
      });
      section.appendChild(list);
      paletteLibraryList.appendChild(section);
    });
    scheduleAdaptivePaletteLibraryHeight();
    syncPaletteLibraryToggleUi();
  }
  state.updatePaletteLibraryUIFn = renderPaletteLibrary;

  function formatPaletteReason(entry) {
    const reason = getUnmappedReason(entry) || String(entry?.mappingReason || "").trim();
    if (reason === "dynamic_tag_not_mapped") return t("Dynamic tag", "ui");
    if (reason === "unsupported_runtime_country") {
      const suggested = getSuggestedIso2(entry);
      return suggested
        ? `${t("Unsupported runtime country", "ui")} (${suggested})`
        : t("Unsupported runtime country", "ui");
    }
    if (reason === "colonial_predecessor") return t("Colonial predecessor", "ui");
    if (reason === "historical_union_or_predecessor") return t("Historical predecessor", "ui");
    if (reason === "split_state") return t("Split state", "ui");
    if (reason === "warlord_or_regional_tag") return t("Warlord / regional tag", "ui");
    if (reason === "fictional_or_alt_history") return t("Fictional / alt-history", "ui");
    if (reason === "ambiguous_identity") return t("Ambiguous identity", "ui");
    if (reason === "unreviewed") return t("Unreviewed", "ui");
    return reason || t("Unreviewed", "ui");
  }

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

  function renderParentBorderCountryList() {
    if (!parentBorderCountryList) return;
    normalizeParentBorderEnabledMap();
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
    if (toggleSpecialZones) toggleSpecialZones.checked = !!state.showSpecialZones;

    const cityPointsConfig = syncCityPointsConfig();
    if (cityPointsTheme) {
      cityPointsTheme.value = String(cityPointsConfig.theme || "classic_graphite");
    }
    if (cityPointsMarkerScale) {
      cityPointsMarkerScale.value = Number(cityPointsConfig.markerScale || 1).toFixed(2);
    }
    if (cityPointsMarkerScaleValue) {
      cityPointsMarkerScaleValue.textContent = `${Number(cityPointsConfig.markerScale || 1).toFixed(2)}x`;
    }
    if (cityPointsLabelDensity) {
      cityPointsLabelDensity.value = String(cityPointsConfig.labelDensity || "balanced");
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
    if (cityPointsRadius) {
      cityPointsRadius.value = Number(cityPointsConfig.radius).toFixed(1);
    }
    if (cityPointsRadiusValue) {
      cityPointsRadiusValue.textContent = Number(cityPointsConfig.radius).toFixed(1);
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

    if (urbanColor) urbanColor.value = state.styleConfig.urban.color;
    if (urbanOpacity) urbanOpacity.value = String(Math.round(state.styleConfig.urban.opacity * 100));
    if (urbanOpacityValue) urbanOpacityValue.textContent = `${Math.round(state.styleConfig.urban.opacity * 100)}%`;
    if (urbanBlendMode) urbanBlendMode.value = state.styleConfig.urban.blendMode;
    if (urbanMinArea) urbanMinArea.value = String(Math.round(state.styleConfig.urban.minAreaPx));
    if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(state.styleConfig.urban.minAreaPx)}`;

    state.styleConfig.physical = normalizePhysicalStyleConfig(state.styleConfig.physical);
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
    if (physicalContourLowReliefCutoff) {
      physicalContourLowReliefCutoff.value = String(Math.round(state.styleConfig.physical.contourLowReliefCutoffM));
    }
    if (physicalContourLowReliefCutoffValue) {
      physicalContourLowReliefCutoffValue.textContent = `${Math.round(state.styleConfig.physical.contourLowReliefCutoffM)}`;
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

    if (specialZonesDisputedFill) specialZonesDisputedFill.value = state.styleConfig.specialZones.disputedFill;
    if (specialZonesDisputedStroke) specialZonesDisputedStroke.value = state.styleConfig.specialZones.disputedStroke;
    if (specialZonesWastelandFill) specialZonesWastelandFill.value = state.styleConfig.specialZones.wastelandFill;
    if (specialZonesWastelandStroke) {
      specialZonesWastelandStroke.value = state.styleConfig.specialZones.wastelandStroke;
    }
    if (specialZonesCustomFill) specialZonesCustomFill.value = state.styleConfig.specialZones.customFill;
    if (specialZonesCustomStroke) specialZonesCustomStroke.value = state.styleConfig.specialZones.customStroke;
    if (specialZonesOpacity) specialZonesOpacity.value = String(Math.round(state.styleConfig.specialZones.opacity * 100));
    if (specialZonesOpacityValue) {
      specialZonesOpacityValue.textContent = `${Math.round(state.styleConfig.specialZones.opacity * 100)}%`;
    }
    if (specialZonesStrokeWidth) {
      specialZonesStrokeWidth.value = String(Number(state.styleConfig.specialZones.strokeWidth).toFixed(2));
    }
    if (specialZonesStrokeWidthValue) {
      specialZonesStrokeWidthValue.textContent = Number(state.styleConfig.specialZones.strokeWidth).toFixed(2);
    }
    if (specialZonesDashStyle) specialZonesDashStyle.value = state.styleConfig.specialZones.dashStyle;

    const manualFeatures = Array.isArray(state.manualSpecialZones?.features)
      ? state.manualSpecialZones.features
      : [];
    if (specialZoneFeatureList) {
      const selectedId = state.specialZoneEditor?.selectedId || "";
      specialZoneFeatureList.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = t("No manual zones", "ui");
      specialZoneFeatureList.appendChild(placeholder);

      manualFeatures.forEach((feature, index) => {
        const id = String(feature?.properties?.id || `manual_sz_${index + 1}`);
        const label = String(feature?.properties?.label || feature?.properties?.name || id);
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${label} (${id})`;
        specialZoneFeatureList.appendChild(option);
      });
      specialZoneFeatureList.value = selectedId && manualFeatures.some((f) => String(f?.properties?.id || "") === selectedId)
        ? selectedId
        : "";
    }

    if (specialZoneTypeSelect) {
      specialZoneTypeSelect.value = String(state.specialZoneEditor?.zoneType || "custom");
    }
    if (specialZoneLabelInput) {
      specialZoneLabelInput.value = String(state.specialZoneEditor?.label || "");
    }

    const isDrawing = !!state.specialZoneEditor?.active;
    if (specialZoneStartBtn) specialZoneStartBtn.disabled = isDrawing;
    if (specialZoneUndoBtn) specialZoneUndoBtn.disabled = !isDrawing;
    if (specialZoneFinishBtn) specialZoneFinishBtn.disabled = !isDrawing;
    if (specialZoneCancelBtn) specialZoneCancelBtn.disabled = !isDrawing;
    if (specialZoneDeleteBtn) {
      specialZoneDeleteBtn.disabled = !state.specialZoneEditor?.selectedId;
    }
    if (specialZoneEditorHint) {
      specialZoneEditorHint.textContent = isDrawing
        ? t("Drawing in progress: click map to add vertices, double-click to finish.", "ui")
        : t("Click map to add vertices, double-click to finish.", "ui");
    }
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
    if (parsed === null || parsed < 100 || parsed > 5000) {
      const zoomErrorMessage = t("Zoom percentage must be between 100% and 5000%.", "ui");
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
    setZoomPercent(clamp(parsed, 100, 5000));
    updateZoomUi();
    emitTransientFeedback(getZoomPercent(), { duration: 1000 });
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
    emitTransientFeedback(getZoomPercent(), { duration: 900 });
  };

  const runZoomReset = () => {
    dismissOnboardingHint();
    resetZoomToFit();
    emitTransientFeedback(getZoomPercent(), { duration: 1000 });
  };

  state.runToolSelectionFn = runToolSelection;
  state.runBrushModeToggleFn = runBrushModeToggle;
  state.runHistoryActionFn = runHistoryAction;
  state.runZoomStepFn = runZoomStep;
  state.runZoomResetFn = runZoomReset;
  state.commitZoomInputValueFn = commitZoomInputValue;

  state.updateToolbarInputsFn = () => {
    if (internalBorderColor) {
      internalBorderColor.value = state.styleConfig.internalBorders.color;
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
      closeDockPopover();
      const next = !document.body.classList.contains("left-drawer-open");
      document.body.classList.toggle("left-drawer-open", next);
      document.body.classList.remove("right-drawer-open");
      leftPanelToggle.setAttribute("aria-expanded", String(next));
      rightPanelToggle?.setAttribute("aria-expanded", "false");
      refreshScenarioContextBar();
    });
    leftPanelToggle.dataset.bound = "true";
  }

  if (rightPanelToggle && !rightPanelToggle.dataset.bound) {
    rightPanelToggle.addEventListener("click", () => {
      closeDockPopover();
      const next = !document.body.classList.contains("right-drawer-open");
      document.body.classList.toggle("right-drawer-open", next);
      document.body.classList.remove("left-drawer-open");
      rightPanelToggle.setAttribute("aria-expanded", String(next));
      leftPanelToggle?.setAttribute("aria-expanded", "false");
      refreshScenarioContextBar();
    });
    rightPanelToggle.dataset.bound = "true";
  }

  if (toggleLang && !toggleLang.dataset.bound) {
    toggleLang.addEventListener("click", toggleLanguage);
    toggleLang.dataset.bound = "true";
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
    dockExportBtn.setAttribute("aria-controls", "dockExportPopover");
    dockExportBtn.addEventListener("click", () => {
      openDockPopover("export");
    });
    dockExportBtn.dataset.bound = "true";
  }

  if (dockCollapseBtn && !dockCollapseBtn.dataset.bound) {
    dockCollapseBtn.addEventListener("click", () => {
      state.ui.dockCollapsed = !state.ui.dockCollapsed;
      updateDockCollapsedUi();
    });
    dockCollapseBtn.dataset.bound = "true";
  }

  if (inspectorDevWorkspaceBtn && !inspectorDevWorkspaceBtn.dataset.bound) {
    inspectorDevWorkspaceBtn.addEventListener("click", () => {
      devWorkspaceToggleBtn?.click();
    });
    inspectorDevWorkspaceBtn.dataset.bound = "true";
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

  if (scenarioVisualAdjustmentsBtn && !scenarioVisualAdjustmentsBtn.dataset.bound) {
    scenarioVisualAdjustmentsBtn.addEventListener("click", () => {
      if (typeof state.openScenarioVisualAdjustmentsFn === "function") {
        state.openScenarioVisualAdjustmentsFn({ scrollIntoView: true });
      }
    });
    scenarioVisualAdjustmentsBtn.dataset.bound = "true";
  }

  if (scenarioContextCollapseBtn && !scenarioContextCollapseBtn.dataset.bound) {
    scenarioContextCollapseBtn.addEventListener("click", () => {
      state.ui.scenarioBarCollapsed = !state.ui.scenarioBarCollapsed;
      refreshScenarioContextBar();
    });
    scenarioContextCollapseBtn.dataset.bound = "true";
  }

  if (scenarioGuideBtn && !scenarioGuideBtn.dataset.bound) {
    scenarioGuideBtn.setAttribute("aria-haspopup", "dialog");
    scenarioGuideBtn.setAttribute("aria-controls", "scenarioGuidePopover");
    scenarioGuideBtn.addEventListener("click", () => {
      toggleScenarioGuidePopover();
    });
    scenarioGuideBtn.dataset.bound = "true";
  }

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

  bindDockPopoverDismiss();

  if (exportBtn && exportFormat) {
    exportBtn.addEventListener("click", async () => {
      try {
        const format = exportFormat.value === "jpg" ? "image/jpeg" : "image/png";
        const extension = exportFormat.value === "jpg" ? "jpg" : "png";
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = state.colorCanvas?.width || 0;
        exportCanvas.height = state.colorCanvas?.height || 0;
        const exportCtx = exportCanvas.getContext("2d");
        if (!exportCtx) {
          throw new Error("Canvas export context unavailable.");
        }
        if (state.colorCanvas) exportCtx.drawImage(state.colorCanvas, 0, 0);
        if (state.lineCanvas) exportCtx.drawImage(state.lineCanvas, 0, 0);
        const mapSvg = document.getElementById("map-svg");
        if (mapSvg) {
          const serializer = new XMLSerializer();
          const svgMarkup = serializer.serializeToString(mapSvg);
          const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
          const svgUrl = URL.createObjectURL(svgBlob);
          try {
            await new Promise((resolve, reject) => {
              const image = new Image();
              image.onload = () => {
                exportCtx.drawImage(image, 0, 0);
                resolve();
              };
              image.onerror = () => reject(new Error("SVG overlay export failed."));
              image.src = svgUrl;
            });
          } finally {
            URL.revokeObjectURL(svgUrl);
          }
        }
        const dataUrl = exportCanvas.toDataURL(format, 0.92);
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `map_snapshot.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast(t("Map snapshot downloaded.", "ui"), {
          title: t("Snapshot exported", "ui"),
          tone: "success",
        });
      } catch (error) {
        console.error("Snapshot export failed:", error);
        showToast(t("Unable to export the map snapshot.", "ui"), {
          title: t("Snapshot failed", "ui"),
          tone: "error",
          duration: 4200,
        });
      }
    });
  }

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
      texture.graticule.minorStep = Math.min(texture.graticule.minorStep, texture.graticule.majorStep);
      texture.graticule.labelStep = Math.max(texture.graticule.labelStep, texture.graticule.majorStep);
    }, { historyKind: "texture-graticule-major", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleMinorStep, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.minorStep = clamp(Number.isFinite(value) ? value : 15, 5, texture.graticule.majorStep);
    }, { historyKind: "texture-graticule-minor", commitHistory: commit });
  });

  bindTextureRange(textureGraticuleLabelStep, (event, commit) => {
    const value = Number(event.target.value);
    updateTextureStyle((texture) => {
      texture.graticule.labelStep = clamp(Number.isFinite(value) ? value : 60, texture.graticule.majorStep, 180);
    }, { historyKind: "texture-graticule-label", commitHistory: commit });
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
      dayNight.cityLightsIntensity = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0, 1.2);
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
      dayNight.cityLightsCorridorStrength = clamp(Number.isFinite(value) ? value / 100 : 0.58, 0, 1);
      renderDayNightUI();
      renderDirty("day-night-city-lights-corridor-strength");
    });
    dayNightCityLightsCorridorStrength.dataset.bound = "true";
  }

  if (dayNightCityLightsCoreSharpness && !dayNightCityLightsCoreSharpness.dataset.bound) {
    dayNightCityLightsCoreSharpness.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsCoreSharpness = clamp(Number.isFinite(value) ? value / 100 : 0.62, 0, 1);
      renderDayNightUI();
      renderDirty("day-night-city-lights-core-sharpness");
    });
    dayNightCityLightsCoreSharpness.dataset.bound = "true";
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
      renderDirty("toggle-urban");
    });
  }

  if (togglePhysical) {
    togglePhysical.checked = !!state.showPhysical;
    togglePhysical.addEventListener("change", (event) => {
      state.showPhysical = event.target.checked;
      renderDirty("toggle-physical");
    });
  }

  if (toggleRivers) {
    toggleRivers.checked = !!state.showRivers;
    toggleRivers.addEventListener("change", (event) => {
      state.showRivers = event.target.checked;
      renderDirty("toggle-rivers");
    });
  }

  if (toggleCityPoints) {
    toggleCityPoints.checked = !!state.showCityPoints;
    toggleCityPoints.addEventListener("change", (event) => {
      state.showCityPoints = !!event.target.checked;
      if (state.showCityPoints) {
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
  if (urbanColor) {
    urbanColor.addEventListener("input", (event) => {
      state.styleConfig.urban.color = normalizeOceanFillColor(event.target.value);
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
      cfg.theme = String(event.target.value || "classic_graphite");
      persistCityViewSettings();
      renderDirty("city-points-theme");
    });
  }
  if (cityPointsMarkerScale) {
    cityPointsMarkerScale.addEventListener("input", (event) => {
      const cfg = syncCityPointsConfig();
      const value = Number(event.target.value);
      cfg.markerScale = clamp(Number.isFinite(value) ? value : 1, 0.75, 1.4);
      if (cityPointsMarkerScaleValue) {
        cityPointsMarkerScaleValue.textContent = `${Number(cfg.markerScale).toFixed(2)}x`;
      }
      persistCityViewSettings();
      renderDirty("city-points-marker-scale");
    });
  }
  if (cityPointsLabelDensity) {
    cityPointsLabelDensity.addEventListener("change", (event) => {
      const cfg = syncCityPointsConfig();
      cfg.labelDensity = String(event.target.value || "balanced");
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
  if (cityPointsRadius) {
    cityPointsRadius.addEventListener("input", (event) => {
      const cfg = syncCityPointsConfig();
      const value = Number(event.target.value);
      cfg.radius = clamp(Number.isFinite(value) ? value : 2.6, 1, 8);
      if (cityPointsRadiusValue) {
        cityPointsRadiusValue.textContent = Number(cfg.radius).toFixed(1);
      }
      persistCityViewSettings();
      renderDirty("city-points-radius");
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
      const value = Number(event.target.value);
      state.styleConfig.urban.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.4, 0, 1);
      if (urbanOpacityValue) urbanOpacityValue.textContent = `${Math.round(state.styleConfig.urban.opacity * 100)}%`;
      renderDirty("urban-opacity");
    });
  }
  if (urbanBlendMode) {
    urbanBlendMode.addEventListener("change", (event) => {
      state.styleConfig.urban.blendMode = String(event.target.value || "multiply");
      renderDirty("urban-blend");
    });
  }
  if (urbanMinArea) {
    urbanMinArea.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.urban.minAreaPx = clamp(Number.isFinite(value) ? value : 8, 0, 80);
      if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(state.styleConfig.urban.minAreaPx)}`;
      renderDirty("urban-area");
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
  if (physicalContourLowReliefCutoff) {
    physicalContourLowReliefCutoff.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const value = Number(event.target.value);
      cfg.contourLowReliefCutoffM = clamp(Number.isFinite(value) ? Math.round(value) : 300, 0, 2000);
      if (physicalContourLowReliefCutoffValue) {
        physicalContourLowReliefCutoffValue.textContent = `${Math.round(cfg.contourLowReliefCutoffM)}`;
      }
      renderDirty("physical-contour-low-relief-cutoff");
    });
  }
  if (physicalBlendMode) {
    physicalBlendMode.addEventListener("change", (event) => {
      const cfg = syncPhysicalConfig();
      cfg.blendMode = String(event.target.value || "multiply");
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

  const onSpecialZonesStyleChange = () => {
    renderDirty("special-zone-style");
  };
  if (specialZonesDisputedFill) {
    specialZonesDisputedFill.addEventListener("input", (event) => {
      state.styleConfig.specialZones.disputedFill = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesDisputedStroke) {
    specialZonesDisputedStroke.addEventListener("input", (event) => {
      state.styleConfig.specialZones.disputedStroke = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesWastelandFill) {
    specialZonesWastelandFill.addEventListener("input", (event) => {
      state.styleConfig.specialZones.wastelandFill = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesWastelandStroke) {
    specialZonesWastelandStroke.addEventListener("input", (event) => {
      state.styleConfig.specialZones.wastelandStroke = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesCustomFill) {
    specialZonesCustomFill.addEventListener("input", (event) => {
      state.styleConfig.specialZones.customFill = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesCustomStroke) {
    specialZonesCustomStroke.addEventListener("input", (event) => {
      state.styleConfig.specialZones.customStroke = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesOpacity) {
    specialZonesOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.specialZones.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.32, 0, 1);
      if (specialZonesOpacityValue) {
        specialZonesOpacityValue.textContent = `${Math.round(state.styleConfig.specialZones.opacity * 100)}%`;
      }
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesStrokeWidth) {
    specialZonesStrokeWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.specialZones.strokeWidth = clamp(Number.isFinite(value) ? value : 1.3, 0.4, 4);
      if (specialZonesStrokeWidthValue) {
        specialZonesStrokeWidthValue.textContent = Number(state.styleConfig.specialZones.strokeWidth).toFixed(2);
      }
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesDashStyle) {
    specialZonesDashStyle.addEventListener("change", (event) => {
      state.styleConfig.specialZones.dashStyle = String(event.target.value || "dashed");
      onSpecialZonesStyleChange();
    });
  }

  if (specialZoneTypeSelect) {
    specialZoneTypeSelect.addEventListener("change", (event) => {
      state.specialZoneEditor.zoneType = String(event.target.value || "custom");
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      markDirty("special-zone-type");
    });
  }
  if (specialZoneLabelInput) {
    specialZoneLabelInput.addEventListener("input", (event) => {
      state.specialZoneEditor.label = String(event.target.value || "");
      markDirty("special-zone-label");
    });
  }
  if (specialZoneStartBtn) {
    specialZoneStartBtn.addEventListener("click", () => {
      startSpecialZoneDraw({
        zoneType: String(specialZoneTypeSelect?.value || state.specialZoneEditor.zoneType || "custom"),
        label: String(specialZoneLabelInput?.value || state.specialZoneEditor.label || ""),
      });
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      dismissOnboardingHint();
      updateToolUI();
      if (render) render();
    });
  }
  if (specialZoneUndoBtn) {
    specialZoneUndoBtn.addEventListener("click", () => {
      undoSpecialZoneVertex();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      updateToolUI();
      if (render) render();
    });
  }
  if (specialZoneFinishBtn) {
    specialZoneFinishBtn.addEventListener("click", () => {
      const didFinish = finishSpecialZoneDraw();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      updateToolUI();
      if (didFinish) {
        markDirty("special-zone-finish");
      }
      if (render) render();
    });
  }
  if (specialZoneCancelBtn) {
    specialZoneCancelBtn.addEventListener("click", () => {
      cancelSpecialZoneDraw();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      updateToolUI();
      if (render) render();
    });
  }
  if (specialZoneFeatureList) {
    specialZoneFeatureList.addEventListener("change", (event) => {
      selectSpecialZoneById(String(event.target.value || ""));
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      if (render) render();
    });
  }
  if (specialZoneDeleteBtn && !specialZoneDeleteBtn.dataset.bound) {
    specialZoneDeleteBtn.addEventListener("click", async () => {
      if (!state.specialZoneEditor?.selectedId) return;
      const confirmed = await showAppDialog({
        title: t("Delete Selected", "ui"),
        message: t("Delete the selected special region?", "ui"),
        details: t(
          "This removes the selected manual zone from the current project. You can undo the deletion from history.",
          "ui"
        ),
        confirmLabel: t("Delete Zone", "ui"),
        cancelLabel: t("Cancel", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      deleteSelectedManualSpecialZone();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      markDirty("special-zone-delete");
      if (render) render();
      showToast(t("Selected special region was deleted.", "ui"), {
        title: t("Delete Selected", "ui"),
        tone: "warning",
      });
    });
    specialZoneDeleteBtn.dataset.bound = "true";
  }

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
      if (typeof state.updatePaintModeUIFn === "function") {
        state.updatePaintModeUIFn();
      }
    });
  }

  if (quickFillCountryBtn) {
    quickFillCountryBtn.addEventListener("click", () => {
      state.batchFillScope = "country";
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
          resetToScenarioBaseline({
            renderNow: false,
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

  if (paletteLibraryToggle) {
    paletteLibraryToggle.addEventListener("click", () => {
      state.paletteLibraryOpen = !state.paletteLibraryOpen;
      paletteLibraryPanel?.classList.toggle("hidden", !state.paletteLibraryOpen);
      syncPaletteLibraryToggleUi();
      renderPaletteLibrary();
    });
  }

  if (paletteLibrarySearch) {
    paletteLibrarySearch.value = state.paletteLibrarySearch || "";
    paletteLibrarySearch.addEventListener("input", (event) => {
      state.paletteLibrarySearch = String(event.target.value || "");
      renderPaletteLibrary();
    });
  }

  if (internalBorderColor) {
    internalBorderColor.addEventListener("input", (event) => {
      state.styleConfig.internalBorders.color = event.target.value;
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
      scheduleAdaptivePaletteLibraryHeight();
    });
    state.ui.overlayResizeBound = true;
  }

  paletteLibraryPanel?.classList.toggle("hidden", !state.paletteLibraryOpen);
  syncPaletteLibraryToggleUi();
  syncPaletteSourceControls();
  renderPalette(state.currentPaletteTheme);
  renderPaletteLibrary();
  leftPanelToggle?.setAttribute("aria-expanded", "false");
  rightPanelToggle?.setAttribute("aria-expanded", "false");
  state.updatePaintModeUIFn();
  updateDockCollapsedUi();
  setAppearanceTab("ocean");
  refreshScenarioContextBar();
  renderRecentColors();
  renderParentBorderCountryList();
  renderSpecialZoneEditorUI();
  updateHistoryUi();
  updateZoomUi();
  updateSwatchUI();
  updateToolUI();
  closeDockPopover();
  closeSpecialZonePopover();
  closeScenarioGuidePopover();
  if (dockReferencePopover) {
    dockReferencePopover.setAttribute("aria-hidden", "true");
  }
  if (dockExportPopover) {
    dockExportPopover.setAttribute("aria-hidden", "true");
  }
  if (scenarioGuidePopover) {
    scenarioGuidePopover.setAttribute("aria-hidden", "true");
  }
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



export { initToolbar };
