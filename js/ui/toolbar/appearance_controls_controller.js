import {
  createPhysicalStyleConfigForPreset,
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizePhysicalPreset,
  normalizePhysicalStyleConfig,
  normalizeTextureMode,
  normalizeTextureStyleConfig,
  normalizeTransportOverviewStyleConfig,
  normalizeUrbanStyleConfig,
  resolveLinkedTransportOverviewScopeAndThreshold,
} from "../../core/state.js";
import { normalizeHexColor } from "../../core/palette_manager.js";
import { captureHistoryState, pushHistoryEntry } from "../../core/history_manager.js";

/**
 * Owns the Appearance 面板里的 transport appearance、tab/filter、recent colors、
 * parent border country list 这些闭环逻辑。
 *
 * toolbar.js 继续保留更高层 facade：
 * - runtimeState callback 注册
 * - special zone popover 壳层
 * - export / dock / workspace 编排
 */
export function createAppearanceControlsController({
  runtimeState,
  t,
  clamp,
  markDirty,
  renderDirty,
  ensureActiveScenarioOptionalLayerLoaded,
  normalizeOceanFillColor,
  updateSwatchUI,
  openSpecialZonePopover,
}) {
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
  const dayNightCityLightsStyle = document.getElementById("dayNightCityLightsStyle");
  const dayNightCityLightsIntensity = document.getElementById("dayNightCityLightsIntensity");
  const dayNightCityLightsTextureOpacity = document.getElementById("dayNightCityLightsTextureOpacity");
  const dayNightCityLightsCorridorStrength = document.getElementById("dayNightCityLightsCorridorStrength");
  const dayNightCityLightsCoreSharpness = document.getElementById("dayNightCityLightsCoreSharpness");
  const dayNightCityLightsPopulationBoostEnabled = document.getElementById("dayNightCityLightsPopulationBoostEnabled");
  const dayNightCityLightsPopulationBoostStrength = document.getElementById("dayNightCityLightsPopulationBoostStrength");
  const dayNightHistoricalCityLightsDensity = document.getElementById("dayNightHistoricalCityLightsDensity");
  const dayNightHistoricalCityLightsSecondaryRetention = document.getElementById("dayNightHistoricalCityLightsSecondaryRetention");
  const dayNightShadowOpacity = document.getElementById("dayNightShadowOpacity");
  const dayNightTwilightWidth = document.getElementById("dayNightTwilightWidth");
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
  const dayNightHistoricalCityLightsSecondaryRetentionValue = document.getElementById("dayNightHistoricalCityLightsSecondaryRetentionValue");
  const dayNightShadowOpacityValue = document.getElementById("dayNightShadowOpacityValue");
  const dayNightTwilightWidthValue = document.getElementById("dayNightTwilightWidthValue");
  const toggleUrban = document.getElementById("toggleUrban");
  const togglePhysical = document.getElementById("togglePhysical");
  const toggleRivers = document.getElementById("toggleRivers");
  const toggleCityPoints = document.getElementById("toggleCityPoints");
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
  const referenceImageInput = document.getElementById("referenceImageInput");
  const referenceOpacity = document.getElementById("referenceOpacity");
  const referenceScale = document.getElementById("referenceScale");
  const referenceOffsetX = document.getElementById("referenceOffsetX");
  const referenceOffsetY = document.getElementById("referenceOffsetY");
  const cityPointsMarkerScaleValue = document.getElementById("cityPointsMarkerScaleValue");
  const cityPointsMarkerDensityValue = document.getElementById("cityPointsMarkerDensityValue");
  const cityPointsOpacityValue = document.getElementById("cityPointsOpacityValue");
  const cityPointsLabelSizeValue = document.getElementById("cityPointsLabelSizeValue");
  const urbanOpacityValue = document.getElementById("urbanOpacityValue");
  const urbanAdaptiveStrengthValue = document.getElementById("urbanAdaptiveStrengthValue");
  const urbanStrokeOpacityValue = document.getElementById("urbanStrokeOpacityValue");
  const urbanToneBiasValue = document.getElementById("urbanToneBiasValue");
  const urbanAdaptiveTintStrengthValue = document.getElementById("urbanAdaptiveTintStrengthValue");
  const urbanMinAreaValue = document.getElementById("urbanMinAreaValue");
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
  const referenceOpacityValue = document.getElementById("referenceOpacityValue");
  const referenceScaleValue = document.getElementById("referenceScaleValue");
  const referenceOffsetXValue = document.getElementById("referenceOffsetXValue");
  const referenceOffsetYValue = document.getElementById("referenceOffsetYValue");
  const appearanceLayerFilter = document.getElementById("appearanceLayerFilter");
  const appearanceTabButtons = Array.from(document.querySelectorAll("[data-appearance-tab]"));
  const appearanceTabPanels = Array.from(document.querySelectorAll("[data-appearance-panel]"));
  const appearanceFilterItems = Array.from(document.querySelectorAll("[data-appearance-filter-item]"));
  const appearanceSpecialZoneBtn = document.getElementById("appearanceSpecialZoneBtn");
  const recentContainer = document.getElementById("recentColors");
  const dockRecentDivider = document.getElementById("dockRecentDivider");
  const parentBordersVisible = document.getElementById("parentBordersVisible");
  const parentBorderColor = document.getElementById("parentBorderColor");
  const parentBorderOpacity = document.getElementById("parentBorderOpacity");
  const parentBorderWidth = document.getElementById("parentBorderWidth");
  const parentBorderEnableAll = document.getElementById("parentBorderEnableAll");
  const parentBorderDisableAll = document.getElementById("parentBorderDisableAll");
  const parentBorderCountryList = document.getElementById("parentBorderCountryList");
  const parentBorderEmpty = document.getElementById("parentBorderEmpty");

  const transportAppearanceMasterToggle = document.getElementById("transportAppearanceMasterToggle");
  const transportAirportCard = document.getElementById("transportAirportCard");
  const transportPortCard = document.getElementById("transportPortCard");
  const transportRailCard = document.getElementById("transportRailCard");
  const transportRoadCard = document.getElementById("transportRoadCard");
  const transportAirportControls = document.getElementById("transportAirportControls");
  const transportPortControls = document.getElementById("transportPortControls");
  const transportRailControls = document.getElementById("transportRailControls");
  const transportRoadControls = document.getElementById("transportRoadControls");
  const transportAirportSummaryMeta = document.getElementById("transportAirportSummaryMeta");
  const transportPortSummaryMeta = document.getElementById("transportPortSummaryMeta");
  const transportRailSummaryMeta = document.getElementById("transportRailSummaryMeta");
  const transportRoadSummaryMeta = document.getElementById("transportRoadSummaryMeta");

  const toggleAirports = document.getElementById("toggleAirports");
  const togglePorts = document.getElementById("togglePorts");
  const toggleRail = document.getElementById("toggleRail");
  const toggleRoad = document.getElementById("toggleRoad");

  const airportVisualStrength = document.getElementById("airportVisualStrength");
  const airportVisualStrengthValue = document.getElementById("airportVisualStrengthValue");
  const airportOpacity = document.getElementById("airportOpacity");
  const airportOpacityValue = document.getElementById("airportOpacityValue");
  const airportPrimaryColor = document.getElementById("airportPrimaryColor");
  const airportLabelsEnabled = document.getElementById("airportLabelsEnabled");
  const airportLabelDensity = document.getElementById("airportLabelDensity");
  const airportLabelMode = document.getElementById("airportLabelMode");
  const airportCoverageReach = document.getElementById("airportCoverageReach");
  const airportCoverageReachValue = document.getElementById("airportCoverageReachValue");
  const airportScopeLinked = document.getElementById("airportScopeLinked");
  const airportScopeResolved = document.getElementById("airportScopeResolved");
  const airportThresholdResolved = document.getElementById("airportThresholdResolved");
  const airportScope = document.getElementById("airportScope");
  const airportImportanceThreshold = document.getElementById("airportImportanceThreshold");

  const portVisualStrength = document.getElementById("portVisualStrength");
  const portVisualStrengthValue = document.getElementById("portVisualStrengthValue");
  const portOpacity = document.getElementById("portOpacity");
  const portOpacityValue = document.getElementById("portOpacityValue");
  const portPrimaryColor = document.getElementById("portPrimaryColor");
  const portLabelsEnabled = document.getElementById("portLabelsEnabled");
  const portLabelDensity = document.getElementById("portLabelDensity");
  const portLabelMode = document.getElementById("portLabelMode");
  const portCoverageReach = document.getElementById("portCoverageReach");
  const portCoverageReachValue = document.getElementById("portCoverageReachValue");
  const portScopeLinked = document.getElementById("portScopeLinked");
  const portScopeResolved = document.getElementById("portScopeResolved");
  const portThresholdResolved = document.getElementById("portThresholdResolved");
  const portTier = document.getElementById("portTier");
  const portImportanceThreshold = document.getElementById("portImportanceThreshold");

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

  const applyAppearanceFilter = () => {
    const query = String(appearanceLayerFilter?.value || "").trim().toLowerCase();
    appearanceFilterItems.forEach((item) => {
      const label = String(item.getAttribute("data-appearance-filter-label") || item.textContent || "").toLowerCase();
      item.classList.toggle("hidden", !!query && !label.includes(query));
    });
  };

  const setAppearanceTab = (tabId = "ocean") => {
    const normalizedTabId = String(tabId || "ocean").trim().toLowerCase();
    appearanceTabButtons.forEach((button) => {
      const id = String(button.dataset.appearanceTab || "").trim().toLowerCase();
      const isActive = id === normalizedTabId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    appearanceTabPanels.forEach((panel) => {
      const id = String(panel.dataset.appearancePanel || "").trim().toLowerCase();
      const isActive = id === normalizedTabId;
      panel.classList.toggle("is-active", isActive);
      panel.classList.toggle("hidden", !isActive);
      panel.hidden = !isActive;
    });
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
  let textureHistoryBefore = null;

  const syncTextureConfig = () => {
    runtimeState.styleConfig.texture = normalizeTextureStyleConfig(runtimeState.styleConfig.texture);
    return runtimeState.styleConfig.texture;
  };

  const syncDayNightConfig = () => {
    runtimeState.styleConfig.dayNight = normalizeDayNightStyleConfig(runtimeState.styleConfig.dayNight);
    return runtimeState.styleConfig.dayNight;
  };

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

  const updateTextureValueLabel = (element, text) => {
    if (element) element.textContent = text;
  };

  const formatUtcMinutes = (rawValue) => {
    const totalMinutes = clamp(Math.round(Number(rawValue) || 0), 0, 24 * 60 - 1);
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours}:${minutes} UTC`;
  };

  const renderTextureModePanels = (mode = runtimeState.styleConfig.texture?.mode || "none") => {
    texturePaperControls?.classList.toggle("hidden", mode !== "paper");
    textureGraticuleControls?.classList.toggle("hidden", mode !== "graticule");
    textureDraftGridControls?.classList.toggle("hidden", mode !== "draft_grid");
  };

  const renderTextureUI = () => {
    const texture = syncTextureConfig();
    const mode = normalizeTextureMode(texture.mode);
    const degreesLabel = "°";
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
      dayNightCurrentTime.textContent = formatUtcMinutes(dayNight.mode === "utc" ? currentUtcMinutes : dayNight.manualUtcMinutes);
    }
    [[dayNightModeManualBtn, "manual"], [dayNightModeUtcBtn, "utc"]].forEach(([button, modeValue]) => {
      if (!button) return;
      const isActive = dayNight.mode === modeValue;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    dayNightManualControls?.classList.toggle("hidden", dayNight.mode !== "manual");
    dayNightUtcStatus?.classList.toggle("hidden", dayNight.mode !== "utc");

    if (dayNightCityLightsEnabled) dayNightCityLightsEnabled.checked = !!dayNight.cityLightsEnabled;
    if (dayNightCityLightsStyle) {
      dayNightCityLightsStyle.value = dayNight.cityLightsStyle;
      dayNightCityLightsStyle.disabled = !dayNight.cityLightsEnabled;
    }
    const modernLightsControlsEnabled = dayNight.cityLightsEnabled && dayNight.cityLightsStyle === "modern";
    const historicalLightsControlsEnabled = dayNight.cityLightsEnabled && dayNight.cityLightsStyle === "historical_1930s";
    if (dayNightCityLightsIntensity) {
      dayNightCityLightsIntensity.value = String(Math.round(dayNight.cityLightsIntensity * 100));
      dayNightCityLightsIntensity.disabled = !dayNight.cityLightsEnabled;
    }
    updateTextureValueLabel(dayNightCityLightsIntensityValue, `${Math.round(dayNight.cityLightsIntensity * 100)}%`);
    if (dayNightCityLightsTextureOpacity) {
      dayNightCityLightsTextureOpacity.value = String(Math.round(dayNight.cityLightsTextureOpacity * 100));
      dayNightCityLightsTextureOpacity.disabled = !modernLightsControlsEnabled;
    }
    updateTextureValueLabel(dayNightCityLightsTextureOpacityValue, `${Math.round(dayNight.cityLightsTextureOpacity * 100)}%`);
    if (dayNightCityLightsCorridorStrength) {
      dayNightCityLightsCorridorStrength.value = String(Math.round(dayNight.cityLightsCorridorStrength * 100));
      dayNightCityLightsCorridorStrength.disabled = !modernLightsControlsEnabled;
    }
    updateTextureValueLabel(dayNightCityLightsCorridorStrengthValue, `${Math.round(dayNight.cityLightsCorridorStrength * 100)}%`);
    if (dayNightCityLightsCoreSharpness) {
      dayNightCityLightsCoreSharpness.value = String(Math.round(dayNight.cityLightsCoreSharpness * 100));
      dayNightCityLightsCoreSharpness.disabled = !modernLightsControlsEnabled;
    }
    updateTextureValueLabel(dayNightCityLightsCoreSharpnessValue, `${Math.round(dayNight.cityLightsCoreSharpness * 100)}%`);
    if (dayNightCityLightsPopulationBoostEnabled) {
      dayNightCityLightsPopulationBoostEnabled.checked = !!dayNight.cityLightsPopulationBoostEnabled;
      dayNightCityLightsPopulationBoostEnabled.disabled = !modernLightsControlsEnabled;
    }
    const populationBoostControlsEnabled = modernLightsControlsEnabled && !!dayNight.cityLightsPopulationBoostEnabled;
    if (dayNightCityLightsPopulationBoostStrength) {
      dayNightCityLightsPopulationBoostStrength.value = String(Math.round(dayNight.cityLightsPopulationBoostStrength * 100));
      dayNightCityLightsPopulationBoostStrength.disabled = !populationBoostControlsEnabled;
    }
    updateTextureValueLabel(dayNightCityLightsPopulationBoostStrengthValue, `${Math.round(dayNight.cityLightsPopulationBoostStrength * 100)}%`);
    if (dayNightHistoricalCityLightsDensity) {
      dayNightHistoricalCityLightsDensity.value = String(Math.round(dayNight.historicalCityLightsDensity * 100));
      dayNightHistoricalCityLightsDensity.disabled = !historicalLightsControlsEnabled;
    }
    updateTextureValueLabel(dayNightHistoricalCityLightsDensityValue, `${Math.round(dayNight.historicalCityLightsDensity * 100)}%`);
    if (dayNightHistoricalCityLightsSecondaryRetention) {
      dayNightHistoricalCityLightsSecondaryRetention.value = String(Math.round(dayNight.historicalCityLightsSecondaryRetention * 100));
      dayNightHistoricalCityLightsSecondaryRetention.disabled = !historicalLightsControlsEnabled;
    }
    updateTextureValueLabel(dayNightHistoricalCityLightsSecondaryRetentionValue, `${Math.round(dayNight.historicalCityLightsSecondaryRetention * 100)}%`);
    if (dayNightShadowOpacity) dayNightShadowOpacity.value = String(Math.round(dayNight.shadowOpacity * 100));
    updateTextureValueLabel(dayNightShadowOpacityValue, `${Math.round(dayNight.shadowOpacity * 100)}%`);
    if (dayNightTwilightWidth) dayNightTwilightWidth.value = String(Math.round(dayNight.twilightWidthDeg));
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

  const persistCityViewSettings = () => {
    runtimeState.persistViewSettingsFn?.();
  };

  const syncCityPointsConfig = () => {
    runtimeState.styleConfig.cityPoints = normalizeCityLayerStyleConfig(runtimeState.styleConfig.cityPoints);
    return runtimeState.styleConfig.cityPoints;
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
    return runtimeState.currentLanguage === "zh" ? themeStyle.hintZh.trim() : themeStyle.hintEn;
  };

  const getCityPointsLabelDensityHint = (densityValue) => {
    const normalized = String(densityValue || "balanced").trim().toLowerCase();
    if (runtimeState.currentLanguage === "zh") {
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
    runtimeState.styleConfig.urban = normalizeUrbanStyleConfig(runtimeState.styleConfig.urban);
    if (runtimeState.styleConfig.urban.mode === "manual") {
      runtimeState.styleConfig.urban.color = normalizeOceanFillColor(runtimeState.styleConfig.urban.color || "#4b5563");
    }
    runtimeState.styleConfig.urban.adaptiveTintColor = normalizeOceanFillColor(runtimeState.styleConfig.urban.adaptiveTintColor || "#f2dea1");
    return runtimeState.styleConfig.urban;
  };

  const getUrbanCapability = () => {
    const capability = runtimeState.urbanLayerCapability && typeof runtimeState.urbanLayerCapability === "object"
      ? runtimeState.urbanLayerCapability
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
    runtimeState.styleConfig.physical = normalizePhysicalStyleConfig(runtimeState.styleConfig.physical);
    runtimeState.styleConfig.physical.contourColor = normalizeOceanFillColor(
      runtimeState.styleConfig.physical.contourColor || "#6b5947",
    );
    return runtimeState.styleConfig.physical;
  };

  const applyPhysicalPresetConfig = (preset, { preserveMode = true } = {}) => {
    const current = syncPhysicalConfig();
    const resolvedPreset = normalizePhysicalPreset(preset);
    const next = createPhysicalStyleConfigForPreset(resolvedPreset);
    runtimeState.styleConfig.physical = normalizePhysicalStyleConfig({
      ...next,
      mode: preserveMode ? current.mode : next.mode,
      contourColor: current.contourColor || next.contourColor,
    });
    return runtimeState.styleConfig.physical;
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
    if (urbanAdaptiveStrengthValue) urbanAdaptiveStrengthValue.textContent = `${Math.round(urbanConfig.adaptiveStrength * 100)}%`;
    if (urbanStrokeOpacity) urbanStrokeOpacity.value = String(Math.round(urbanConfig.strokeOpacity * 100));
    if (urbanStrokeOpacityValue) urbanStrokeOpacityValue.textContent = `${Math.round(urbanConfig.strokeOpacity * 100)}%`;
    if (urbanToneBias) urbanToneBias.value = String(Math.round(urbanConfig.toneBias * 100));
    if (urbanToneBiasValue) urbanToneBiasValue.textContent = formatUrbanToneBias(urbanConfig.toneBias);
    if (urbanAdaptiveTintEnabled) urbanAdaptiveTintEnabled.checked = !!urbanConfig.adaptiveTintEnabled;
    if (urbanAdaptiveTintColor) urbanAdaptiveTintColor.value = urbanConfig.adaptiveTintColor || "#f2dea1";
    if (urbanAdaptiveTintStrength) urbanAdaptiveTintStrength.value = String(Math.round((urbanConfig.adaptiveTintStrength || 0) * 100));
    if (urbanAdaptiveTintStrengthValue) urbanAdaptiveTintStrengthValue.textContent = `${Math.round((urbanConfig.adaptiveTintStrength || 0) * 100)}%`;
    [urbanAdaptiveStrength, urbanStrokeOpacity, urbanToneBias, urbanAdaptiveTintEnabled, urbanAdaptiveTintColor, urbanAdaptiveTintStrength].forEach((element) => {
      if (element) element.disabled = !adaptiveAvailable;
    });
    if (urbanAdaptiveTintColor) urbanAdaptiveTintColor.disabled = !adaptiveAvailable || !urbanConfig.adaptiveTintEnabled;
    if (urbanAdaptiveTintStrength) urbanAdaptiveTintStrength.disabled = !adaptiveAvailable || !urbanConfig.adaptiveTintEnabled;
    if (urbanMinArea) urbanMinArea.value = String(Math.round(urbanConfig.minAreaPx));
    if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(urbanConfig.minAreaPx)}`;
    return urbanConfig;
  };

  const renderAppearanceStyleControlsUi = () => {
    if (toggleCityPoints) toggleCityPoints.checked = !!runtimeState.showCityPoints;
    if (toggleUrban) toggleUrban.checked = !!runtimeState.showUrban;
    if (togglePhysical) togglePhysical.checked = !!runtimeState.showPhysical;
    if (toggleRivers) toggleRivers.checked = !!runtimeState.showRivers;

    const cityPointsConfig = syncCityPointsConfig();
    ensureCityPointsThemeOptions();
    if (cityPointsTheme) cityPointsTheme.value = String(cityPointsConfig.theme || "classic_graphite");
    if (cityPointsThemeHint) cityPointsThemeHint.textContent = getCityPointsThemeHint(cityPointsConfig.theme || "classic_graphite");
    if (cityPointsMarkerScale) cityPointsMarkerScale.value = Number(cityPointsConfig.markerScale || 1).toFixed(2);
    if (cityPointsMarkerScaleValue) cityPointsMarkerScaleValue.textContent = `${Number(cityPointsConfig.markerScale || 1).toFixed(2)}x`;
    if (cityPointsMarkerDensity) cityPointsMarkerDensity.value = Number(cityPointsConfig.markerDensity || 1).toFixed(2);
    if (cityPointsMarkerDensityValue) cityPointsMarkerDensityValue.textContent = formatCityPointsDensityValue(cityPointsConfig.markerDensity || 1);
    if (cityPointsMarkerDensityHint) {
      cityPointsMarkerDensityHint.textContent = runtimeState.currentLanguage === "zh"
        ? "控制每个缩放阶段最多允许出现多少个城市点。"
        : "Controls how many city markers can surface at each zoom stage.";
    }
    if (cityPointsLabelDensity) cityPointsLabelDensity.value = String(cityPointsConfig.labelDensity || "balanced");
    if (cityPointsLabelDensityHint) cityPointsLabelDensityHint.textContent = getCityPointsLabelDensityHint(cityPointsConfig.labelDensity || "balanced");
    if (cityPointsColor) cityPointsColor.value = normalizeOceanFillColor(cityPointsConfig.color || "#2f343a");
    if (cityPointsCapitalColor) cityPointsCapitalColor.value = normalizeOceanFillColor(cityPointsConfig.capitalColor || "#9f9072");
    if (cityPointsOpacity) cityPointsOpacity.value = String(Math.round(cityPointsConfig.opacity * 100));
    if (cityPointsOpacityValue) cityPointsOpacityValue.textContent = `${Math.round(cityPointsConfig.opacity * 100)}%`;
    if (cityPointLabelsEnabled) cityPointLabelsEnabled.checked = !!cityPointsConfig.showLabels;
    if (cityPointsLabelSize) cityPointsLabelSize.value = String(Math.round(cityPointsConfig.labelSize));
    if (cityPointsLabelSizeValue) cityPointsLabelSizeValue.textContent = `${Math.round(cityPointsConfig.labelSize)}px`;
    if (cityCapitalOverlayEnabled) cityCapitalOverlayEnabled.checked = !!cityPointsConfig.showCapitalOverlay;

    syncUrbanControls();

    runtimeState.styleConfig.physical = normalizePhysicalStyleConfig(runtimeState.styleConfig.physical);
    const activePhysicalPreset = normalizePhysicalPreset(runtimeState.styleConfig.physical.preset || "balanced");
    if (physicalPreset) physicalPreset.value = activePhysicalPreset;
    if (physicalPresetHint) physicalPresetHint.textContent = getPhysicalPresetHint(activePhysicalPreset);
    if (physicalMode) physicalMode.value = runtimeState.styleConfig.physical.mode;
    if (physicalOpacity) physicalOpacity.value = String(Math.round(runtimeState.styleConfig.physical.opacity * 100));
    if (physicalOpacityValue) physicalOpacityValue.textContent = `${Math.round(runtimeState.styleConfig.physical.opacity * 100)}%`;
    if (physicalAtlasIntensity) physicalAtlasIntensity.value = String(Math.round(runtimeState.styleConfig.physical.atlasIntensity * 100));
    if (physicalAtlasIntensityValue) physicalAtlasIntensityValue.textContent = `${Math.round(runtimeState.styleConfig.physical.atlasIntensity * 100)}%`;
    if (physicalRainforestEmphasis) physicalRainforestEmphasis.value = String(Math.round(runtimeState.styleConfig.physical.rainforestEmphasis * 100));
    if (physicalRainforestEmphasisValue) physicalRainforestEmphasisValue.textContent = `${Math.round(runtimeState.styleConfig.physical.rainforestEmphasis * 100)}%`;
    if (physicalContourColor) physicalContourColor.value = runtimeState.styleConfig.physical.contourColor;
    if (physicalContourOpacity) physicalContourOpacity.value = String(Math.round(runtimeState.styleConfig.physical.contourOpacity * 100));
    if (physicalContourOpacityValue) physicalContourOpacityValue.textContent = `${Math.round(runtimeState.styleConfig.physical.contourOpacity * 100)}%`;
    if (physicalMinorContours) physicalMinorContours.checked = !!runtimeState.styleConfig.physical.contourMinorVisible;
    if (physicalContourMajorWidth) physicalContourMajorWidth.value = String(Number(runtimeState.styleConfig.physical.contourMajorWidth).toFixed(2));
    if (physicalContourMajorWidthValue) physicalContourMajorWidthValue.textContent = Number(runtimeState.styleConfig.physical.contourMajorWidth).toFixed(2);
    if (physicalContourMinorWidth) physicalContourMinorWidth.value = String(Number(runtimeState.styleConfig.physical.contourMinorWidth).toFixed(2));
    if (physicalContourMinorWidthValue) physicalContourMinorWidthValue.textContent = Number(runtimeState.styleConfig.physical.contourMinorWidth).toFixed(2);
    if (physicalContourMajorInterval) physicalContourMajorInterval.value = String(Math.round(runtimeState.styleConfig.physical.contourMajorIntervalM));
    if (physicalContourMajorIntervalValue) physicalContourMajorIntervalValue.textContent = `${Math.round(runtimeState.styleConfig.physical.contourMajorIntervalM)}`;
    if (physicalContourMinorInterval) physicalContourMinorInterval.value = String(Math.round(runtimeState.styleConfig.physical.contourMinorIntervalM));
    if (physicalContourMinorIntervalValue) physicalContourMinorIntervalValue.textContent = `${Math.round(runtimeState.styleConfig.physical.contourMinorIntervalM)}`;
    if (physicalContourMajorLowReliefCutoff) physicalContourMajorLowReliefCutoff.value = String(Math.round(runtimeState.styleConfig.physical.contourMajorLowReliefCutoffM));
    if (physicalContourMajorLowReliefCutoffValue) physicalContourMajorLowReliefCutoffValue.textContent = `${Math.round(runtimeState.styleConfig.physical.contourMajorLowReliefCutoffM)}`;
    if (physicalContourMinorLowReliefCutoff) physicalContourMinorLowReliefCutoff.value = String(Math.round(runtimeState.styleConfig.physical.contourMinorLowReliefCutoffM));
    if (physicalContourMinorLowReliefCutoffValue) physicalContourMinorLowReliefCutoffValue.textContent = `${Math.round(runtimeState.styleConfig.physical.contourMinorLowReliefCutoffM)}`;
    if (physicalBlendMode) physicalBlendMode.value = runtimeState.styleConfig.physical.blendMode;
    Object.entries(physicalClassToggleMap).forEach(([key, element]) => {
      if (element) element.checked = runtimeState.styleConfig.physical.atlasClassVisibility?.[key] !== false;
    });

    if (riversColor) riversColor.value = runtimeState.styleConfig.rivers.color;
    if (riversOpacity) riversOpacity.value = String(Math.round(runtimeState.styleConfig.rivers.opacity * 100));
    if (riversOpacityValue) riversOpacityValue.textContent = `${Math.round(runtimeState.styleConfig.rivers.opacity * 100)}%`;
    if (riversWidth) riversWidth.value = String(Number(runtimeState.styleConfig.rivers.width).toFixed(2));
    if (riversWidthValue) riversWidthValue.textContent = Number(runtimeState.styleConfig.rivers.width).toFixed(2);
    if (riversOutlineColor) riversOutlineColor.value = runtimeState.styleConfig.rivers.outlineColor;
    if (riversOutlineWidth) riversOutlineWidth.value = String(Number(runtimeState.styleConfig.rivers.outlineWidth).toFixed(2));
    if (riversOutlineWidthValue) riversOutlineWidthValue.textContent = Number(runtimeState.styleConfig.rivers.outlineWidth).toFixed(2);
    if (riversDashStyle) riversDashStyle.value = runtimeState.styleConfig.rivers.dashStyle;
  };

  const renderReferenceOverlayUi = () => {
    if (referenceOpacity) referenceOpacity.value = String(Math.round(runtimeState.referenceImageState.opacity * 100));
    if (referenceOpacityValue) referenceOpacityValue.textContent = `${Math.round(runtimeState.referenceImageState.opacity * 100)}%`;
    if (referenceScale) referenceScale.value = String(Number(runtimeState.referenceImageState.scale).toFixed(2));
    if (referenceScaleValue) referenceScaleValue.textContent = `${Number(runtimeState.referenceImageState.scale).toFixed(2)}x`;
    if (referenceOffsetX) referenceOffsetX.value = String(Math.round(runtimeState.referenceImageState.offsetX));
    if (referenceOffsetXValue) referenceOffsetXValue.textContent = `${Math.round(runtimeState.referenceImageState.offsetX)}px`;
    if (referenceOffsetY) referenceOffsetY.value = String(Math.round(runtimeState.referenceImageState.offsetY));
    if (referenceOffsetYValue) referenceOffsetYValue.textContent = `${Math.round(runtimeState.referenceImageState.offsetY)}px`;
    const referenceImage = document.getElementById("referenceImage");
    if (referenceImage) {
      referenceImage.style.opacity = String(runtimeState.referenceImageState.opacity);
      referenceImage.style.transform =
        `translate(${runtimeState.referenceImageState.offsetX}px, ${runtimeState.referenceImageState.offsetY}px) `
        + `scale(${runtimeState.referenceImageState.scale})`;
    }
  };

  const getTransportAppearanceConfig = () => {
    runtimeState.styleConfig.transportOverview = normalizeTransportOverviewStyleConfig(
      runtimeState.styleConfig?.transportOverview || {},
    );
    return runtimeState.styleConfig.transportOverview;
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
    if (normalizedFamilyId === "rail") return normalizedScope === "mainline_only" ? 1 : 2;
    if (normalizedFamilyId === "road") return normalizedScope === "motorway_only" ? 1 : 2;
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
      const features = Array.isArray(runtimeState.railwaysData?.features) ? runtimeState.railwaysData.features : null;
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
      const features = Array.isArray(runtimeState.roadsData?.features) ? runtimeState.roadsData.features : null;
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
    const collection = familyId === "port" ? runtimeState.portsData : runtimeState.airportsData;
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
    if (familyId === "rail") return `${roundedCount.toLocaleString()} ${t(roundedCount === 1 ? "railway" : "railways", "ui")}`;
    if (familyId === "road") return `${roundedCount.toLocaleString()} ${t(roundedCount === 1 ? "road" : "roads", "ui")}`;
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
    const transportEnabled = runtimeState.showTransport !== false;
    const airportScopeState = getEffectiveTransportScopeState("airport", airportConfig);
    const portScopeState = getEffectiveTransportScopeState("port", portConfig);
    const railScopeState = getEffectiveTransportScopeState("rail", railConfig);
    const roadScopeState = getEffectiveTransportScopeState("road", roadConfig);

    if (transportAppearanceMasterToggle) transportAppearanceMasterToggle.checked = transportEnabled;

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
    if (airportThresholdResolved) airportThresholdResolved.textContent = t(formatTransportThresholdLabel(airportScopeState.importanceThreshold), "ui");
    if (airportScope) airportScope.value = String(airportConfig.scope || "major_civil");
    if (airportImportanceThreshold) airportImportanceThreshold.value = String(airportConfig.importanceThreshold || "secondary");
    if (transportAirportSummaryMeta) {
      transportAirportSummaryMeta.textContent = buildTransportFamilySummaryText("airport", transportEnabled, !!runtimeState.showAirports, airportConfig, airportScopeState);
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
    if (portThresholdResolved) portThresholdResolved.textContent = t(formatTransportThresholdLabel(portScopeState.importanceThreshold), "ui");
    if (portTier) portTier.value = String(portConfig.scope || "regional");
    if (portImportanceThreshold) portImportanceThreshold.value = String(portConfig.importanceThreshold || "secondary");
    if (transportPortSummaryMeta) {
      transportPortSummaryMeta.textContent = buildTransportFamilySummaryText("port", transportEnabled, !!runtimeState.showPorts, portConfig, portScopeState);
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
    if (toggleRail) toggleRail.checked = !!runtimeState.showRail;
    if (transportRailSummaryMeta) {
      transportRailSummaryMeta.textContent = buildTransportFamilySummaryText("rail", transportEnabled, !!runtimeState.showRail, railConfig, railScopeState);
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
    if (toggleRoad) toggleRoad.checked = !!runtimeState.showRoad;
    if (transportRoadSummaryMeta) {
      transportRoadSummaryMeta.textContent = buildTransportFamilySummaryText("road", transportEnabled, !!runtimeState.showRoad, roadConfig, roadScopeState);
    }

    [
      airportVisualStrength, airportOpacity, airportPrimaryColor, airportLabelsEnabled, airportLabelDensity,
      airportLabelMode, airportScopeLinked, airportScope, airportImportanceThreshold,
    ].forEach((control) => { if (control) control.disabled = !transportEnabled; });
    [
      portVisualStrength, portOpacity, portPrimaryColor, portLabelsEnabled, portLabelDensity,
      portLabelMode, portScopeLinked, portTier, portImportanceThreshold,
    ].forEach((control) => { if (control) control.disabled = !transportEnabled; });
    [
      railVisualStrength, railOpacity, railPrimaryColor, railLabelsEnabled, railLabelDensity,
      railScopeLinked, railScope, railImportanceThreshold, toggleRail,
    ].forEach((control) => { if (control) control.disabled = !transportEnabled; });
    [
      roadVisualStrength, roadOpacity, roadPrimaryColor, roadScopeLinked, roadScope,
      roadImportanceThreshold, toggleRoad,
    ].forEach((control) => { if (control) control.disabled = !transportEnabled; });

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
    runtimeState.syncFacilityInfoCardVisibilityFn?.();
  };

  const applyTransportAppearanceMasterToggle = (nextEnabled) => {
    const normalized = !!nextEnabled;
    if ((runtimeState.showTransport !== false) === normalized) {
      renderTransportAppearanceUi();
      return;
    }
    runtimeState.showTransport = normalized;
    if (normalized && runtimeState.showAirports && typeof runtimeState.ensureContextLayerDataFn === "function") {
      void runtimeState.ensureContextLayerDataFn("airports", { reason: "transport-master-toggle", renderNow: true });
    }
    if (normalized && runtimeState.showPorts && typeof runtimeState.ensureContextLayerDataFn === "function") {
      void runtimeState.ensureContextLayerDataFn("ports", { reason: "transport-master-toggle", renderNow: true });
    }
    if (normalized && runtimeState.showRail && typeof runtimeState.ensureContextLayerDataFn === "function") {
      void runtimeState.ensureContextLayerDataFn(["railways", "rail_stations_major"], { reason: "transport-master-toggle", renderNow: true });
    }
    if (normalized && runtimeState.showRoad && typeof runtimeState.ensureContextLayerDataFn === "function") {
      void runtimeState.ensureContextLayerDataFn("roads", { reason: "transport-master-toggle", renderNow: true });
    }
    renderTransportAppearanceUi();
    renderDirty("toggle-transport-overview");
  };

  const renderRecentColors = () => {
    if (!recentContainer) return;
    recentContainer.replaceChildren();
    const visibleRecentColors = runtimeState.recentColors.slice(0, 10);
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
        runtimeState.selectedColor = normalized;
        updateSwatchUI();
      });
      recentContainer.appendChild(btn);
    });
  };

  const normalizeParentBorderEnabledMap = () => {
    const supported = Array.isArray(runtimeState.parentBorderSupportedCountries) ? runtimeState.parentBorderSupportedCountries : [];
    const prev = runtimeState.parentBorderEnabledByCountry && typeof runtimeState.parentBorderEnabledByCountry === "object"
      ? runtimeState.parentBorderEnabledByCountry
      : {};
    const next = {};
    supported.forEach((countryCode) => {
      next[countryCode] = !!prev[countryCode];
    });
    runtimeState.parentBorderEnabledByCountry = next;
  };

  const syncParentBorderVisibilityUI = () => {
    const enabled = runtimeState.parentBordersVisible !== false;
    if (parentBordersVisible) parentBordersVisible.checked = enabled;
    if (parentBorderColor) parentBorderColor.disabled = !enabled;
    if (parentBorderOpacity) parentBorderOpacity.disabled = !enabled;
    if (parentBorderWidth) parentBorderWidth.disabled = !enabled;
    if (parentBorderEnableAll) parentBorderEnableAll.disabled = !enabled;
    if (parentBorderDisableAll) parentBorderDisableAll.disabled = !enabled;
    if (parentBorderCountryList) {
      parentBorderCountryList.classList.toggle("opacity-60", !enabled);
      parentBorderCountryList.classList.toggle("pointer-events-none", !enabled);
    }
  };

  const renderParentBorderCountryList = () => {
    if (!parentBorderCountryList) return;
    normalizeParentBorderEnabledMap();
    syncParentBorderVisibilityUI();
    const supported = Array.isArray(runtimeState.parentBorderSupportedCountries)
      ? [...runtimeState.parentBorderSupportedCountries]
      : [];

    parentBorderCountryList.replaceChildren();
    if (!supported.length) {
      parentBorderEmpty?.classList.remove("hidden");
      return;
    }
    parentBorderEmpty?.classList.add("hidden");

    const entries = supported
      .map((code) => ({
        code,
        displayName: t(runtimeState.countryNames?.[code] || code, "geo"),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    entries.forEach(({ code, displayName }) => {
      const label = document.createElement("label");
      label.className = "toggle-label parent-border-country-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "checkbox-input";
      checkbox.checked = !!runtimeState.parentBorderEnabledByCountry?.[code];
      checkbox.disabled = runtimeState.parentBordersVisible === false;
      checkbox.addEventListener("change", (event) => {
        runtimeState.parentBorderEnabledByCountry[code] = !!event.target.checked;
        renderDirty("parent-border-country");
      });

      const text = document.createElement("span");
      text.textContent = `${displayName} (${code})`;

      label.appendChild(checkbox);
      label.appendChild(text);
      parentBorderCountryList.appendChild(label);
    });
  };

  const bindEvents = () => {
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

    if (toggleAirports && !toggleAirports.dataset.bound) {
      toggleAirports.checked = !!runtimeState.showAirports;
      toggleAirports.addEventListener("change", (event) => {
        runtimeState.showAirports = !!event.target.checked;
        if (runtimeState.showAirports && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void runtimeState.ensureContextLayerDataFn("airports", { reason: "toolbar-toggle", renderNow: true });
        }
        renderTransportAppearanceUi();
        renderDirty("toggle-airports");
      });
      toggleAirports.dataset.bound = "true";
    }

    if (togglePorts && !togglePorts.dataset.bound) {
      togglePorts.checked = !!runtimeState.showPorts;
      togglePorts.addEventListener("change", (event) => {
        runtimeState.showPorts = !!event.target.checked;
        if (runtimeState.showPorts && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void runtimeState.ensureContextLayerDataFn("ports", { reason: "toolbar-toggle", renderNow: true });
        }
        renderTransportAppearanceUi();
        renderDirty("toggle-ports");
      });
      togglePorts.dataset.bound = "true";
    }

    if (toggleRail && !toggleRail.dataset.bound) {
      toggleRail.checked = !!runtimeState.showRail;
      toggleRail.addEventListener("change", (event) => {
        runtimeState.showRail = !!event.target.checked;
        if (runtimeState.showRail && runtimeState.showTransport === false) runtimeState.showTransport = true;
        if (runtimeState.showRail && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void runtimeState.ensureContextLayerDataFn(["railways", "rail_stations_major"], { reason: "toolbar-toggle", renderNow: true });
        }
        renderTransportAppearanceUi();
        renderDirty("toggle-rail");
      });
      toggleRail.dataset.bound = "true";
    }

    if (toggleRoad && !toggleRoad.dataset.bound) {
      toggleRoad.checked = !!runtimeState.showRoad;
      toggleRoad.addEventListener("change", (event) => {
        runtimeState.showRoad = !!event.target.checked;
        if (runtimeState.showRoad && runtimeState.showTransport === false) runtimeState.showTransport = true;
        if (runtimeState.showRoad && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void runtimeState.ensureContextLayerDataFn("roads", { reason: "toolbar-toggle", renderNow: true });
        }
        renderTransportAppearanceUi();
        renderDirty("toggle-road");
      });
      toggleRoad.dataset.bound = "true";
    }

    const bindInput = (element, mutate, reason) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("input", (event) => {
        mutate(event);
        renderTransportAppearanceUi();
        renderDirty(reason);
      });
      element.dataset.bound = "true";
    };
    const bindChange = (element, mutate, reason) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("change", (event) => {
        mutate(event);
        renderTransportAppearanceUi();
        renderDirty(reason);
      });
      element.dataset.bound = "true";
    };

    bindInput(airportVisualStrength, (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().airport.visualStrength = clamp(Number.isFinite(value) ? value / 100 : 0.56, 0, 1);
    }, "transport-airport-visual-strength");
    bindInput(airportOpacity, (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().airport.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.82, 0.2, 1);
    }, "transport-airport-opacity");
    bindInput(airportPrimaryColor, (event) => {
      getTransportAppearanceConfig().airport.primaryColor = normalizeOceanFillColor(event.target.value || "#1d4ed8");
    }, "transport-airport-primary-color");
    bindChange(airportLabelsEnabled, (event) => {
      getTransportAppearanceConfig().airport.labelsEnabled = !!event.target.checked;
    }, "transport-airport-labels-enabled");
    bindChange(airportLabelDensity, (event) => {
      getTransportAppearanceConfig().airport.labelDensity = String(event.target.value || "balanced");
    }, "transport-airport-label-density");
    bindChange(airportLabelMode, (event) => {
      getTransportAppearanceConfig().airport.labelMode = String(event.target.value || "both");
    }, "transport-airport-label-mode");
    bindInput(airportCoverageReach, (event) => {
      const value = Number(event.target.value);
      const config = getTransportAppearanceConfig().airport;
      config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
      if (String(config.scopeLinkMode || "linked") !== "manual") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("airport", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
    }, "transport-airport-coverage-reach");
    bindChange(airportScopeLinked, (event) => {
      const config = getTransportAppearanceConfig().airport;
      config.scopeLinkMode = event.target.checked ? "linked" : "manual";
      if (config.scopeLinkMode === "linked") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("airport", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
    }, "transport-airport-scope-link");
    bindChange(airportScope, (event) => {
      const config = getTransportAppearanceConfig().airport;
      config.scopeLinkMode = "manual";
      config.scope = String(event.target.value || "major_civil");
    }, "transport-airport-scope");
    bindChange(airportImportanceThreshold, (event) => {
      const config = getTransportAppearanceConfig().airport;
      config.scopeLinkMode = "manual";
      config.importanceThreshold = String(event.target.value || "secondary");
    }, "transport-airport-importance-threshold");

    bindInput(portVisualStrength, (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().port.visualStrength = clamp(Number.isFinite(value) ? value / 100 : 0.54, 0, 1);
    }, "transport-port-visual-strength");
    bindInput(portOpacity, (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().port.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.78, 0.2, 1);
    }, "transport-port-opacity");
    bindInput(portPrimaryColor, (event) => {
      getTransportAppearanceConfig().port.primaryColor = normalizeOceanFillColor(event.target.value || "#b45309");
    }, "transport-port-primary-color");
    bindChange(portLabelsEnabled, (event) => {
      getTransportAppearanceConfig().port.labelsEnabled = !!event.target.checked;
    }, "transport-port-labels-enabled");
    bindChange(portLabelDensity, (event) => {
      getTransportAppearanceConfig().port.labelDensity = String(event.target.value || "balanced");
    }, "transport-port-label-density");
    bindChange(portLabelMode, (event) => {
      getTransportAppearanceConfig().port.labelMode = String(event.target.value || "mixed");
    }, "transport-port-label-mode");
    bindInput(portCoverageReach, (event) => {
      const value = Number(event.target.value);
      const config = getTransportAppearanceConfig().port;
      config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
      if (String(config.scopeLinkMode || "linked") !== "manual") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("port", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
    }, "transport-port-coverage-reach");
    bindChange(portScopeLinked, (event) => {
      const config = getTransportAppearanceConfig().port;
      config.scopeLinkMode = event.target.checked ? "linked" : "manual";
      if (config.scopeLinkMode === "linked") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("port", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
    }, "transport-port-scope-link");
    bindChange(portTier, (event) => {
      const config = getTransportAppearanceConfig().port;
      config.scopeLinkMode = "manual";
      config.scope = String(event.target.value || "regional");
    }, "transport-port-scope");
    bindChange(portImportanceThreshold, (event) => {
      const config = getTransportAppearanceConfig().port;
      config.scopeLinkMode = "manual";
      config.importanceThreshold = String(event.target.value || "secondary");
    }, "transport-port-importance-threshold");

    bindInput(railVisualStrength, (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().rail.visualStrength = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
    }, "transport-rail-visual-strength");
    bindInput(railOpacity, (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().rail.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0.2, 1);
    }, "transport-rail-opacity");
    bindInput(railPrimaryColor, (event) => {
      getTransportAppearanceConfig().rail.primaryColor = normalizeOceanFillColor(event.target.value || "#0f172a");
    }, "transport-rail-primary-color");
    bindChange(railLabelsEnabled, (event) => {
      getTransportAppearanceConfig().rail.labelsEnabled = !!event.target.checked;
    }, "transport-rail-labels-enabled");
    bindChange(railLabelDensity, (event) => {
      getTransportAppearanceConfig().rail.labelDensity = String(event.target.value || "sparse");
    }, "transport-rail-label-density");
    bindInput(railCoverageReach, (event) => {
      const value = Number(event.target.value);
      const config = getTransportAppearanceConfig().rail;
      config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : 0.2, 0, 1);
      if (String(config.scopeLinkMode || "linked") !== "manual") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("rail", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
    }, "transport-rail-coverage-reach");
    bindChange(railScopeLinked, (event) => {
      const config = getTransportAppearanceConfig().rail;
      config.scopeLinkMode = event.target.checked ? "linked" : "manual";
      if (config.scopeLinkMode === "linked") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("rail", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
    }, "transport-rail-scope-link");
    bindChange(railScope, (event) => {
      const config = getTransportAppearanceConfig().rail;
      config.scopeLinkMode = "manual";
      config.scope = String(event.target.value || "mainline_only");
    }, "transport-rail-scope");
    bindChange(railImportanceThreshold, (event) => {
      const config = getTransportAppearanceConfig().rail;
      config.scopeLinkMode = "manual";
      config.importanceThreshold = String(event.target.value || "primary");
    }, "transport-rail-importance-threshold");

    bindInput(roadVisualStrength, (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().road.visualStrength = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
    }, "transport-road-visual-strength");
    bindInput(roadOpacity, (event) => {
      const value = Number(event.target.value);
      getTransportAppearanceConfig().road.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0.2, 1);
    }, "transport-road-opacity");
    bindInput(roadPrimaryColor, (event) => {
      getTransportAppearanceConfig().road.primaryColor = normalizeOceanFillColor(event.target.value || "#374151");
    }, "transport-road-primary-color");
    bindInput(roadCoverageReach, (event) => {
      const value = Number(event.target.value);
      const config = getTransportAppearanceConfig().road;
      config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : 0.2, 0, 1);
      if (String(config.scopeLinkMode || "linked") !== "manual") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("road", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
    }, "transport-road-coverage-reach");
    bindChange(roadScopeLinked, (event) => {
      const config = getTransportAppearanceConfig().road;
      config.scopeLinkMode = event.target.checked ? "linked" : "manual";
      if (config.scopeLinkMode === "linked") {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold("road", config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      }
    }, "transport-road-scope-link");
    bindChange(roadScope, (event) => {
      const config = getTransportAppearanceConfig().road;
      config.scopeLinkMode = "manual";
      config.scope = String(event.target.value || "motorway_only");
    }, "transport-road-scope");
    bindChange(roadImportanceThreshold, (event) => {
      const config = getTransportAppearanceConfig().road;
      config.scopeLinkMode = "manual";
      config.importanceThreshold = String(event.target.value || "primary");
    }, "transport-road-importance-threshold");

    if (textureSelect && textureSelect.dataset.bound !== "true") {
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
        if (normalizeTextureMode(texture.mode) === "none") return;
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
    if (textureDraftDash && textureDraftDash.dataset.bound !== "true") {
      textureDraftDash.addEventListener("change", (event) => {
        updateTextureStyle((texture) => {
          texture.draftGrid.dash = String(event.target.value || "dashed");
        }, { historyKind: "texture-draft-dash", commitHistory: true });
      });
      textureDraftDash.dataset.bound = "true";
    }

    if (dayNightEnabled && dayNightEnabled.dataset.bound !== "true") {
      dayNightEnabled.addEventListener("change", (event) => {
        const dayNight = syncDayNightConfig();
        dayNight.enabled = !!event.target.checked;
        renderDayNightUI();
        renderDirty("day-night-enabled");
      });
      dayNightEnabled.dataset.bound = "true";
    }
    [[dayNightModeManualBtn, "manual"], [dayNightModeUtcBtn, "utc"]].forEach(([button, modeValue]) => {
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
    const bindDayNightInput = (element, mutate, reason) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("input", (event) => {
        mutate(event);
        renderDayNightUI();
        renderDirty(reason);
      });
      element.dataset.bound = "true";
    };
    const bindDayNightChange = (element, mutate, reason) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("change", (event) => {
        mutate(event);
        renderDayNightUI();
        renderDirty(reason);
      });
      element.dataset.bound = "true";
    };
    bindDayNightInput(dayNightManualTime, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.manualUtcMinutes = clamp(Number.isFinite(value) ? value : 12 * 60, 0, 24 * 60 - 1);
    }, "day-night-time");
    bindDayNightChange(dayNightCityLightsEnabled, (event) => {
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsEnabled = !!event.target.checked;
    }, "day-night-city-lights-enabled");
    bindDayNightChange(dayNightCityLightsStyle, (event) => {
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsStyle = String(event.target.value || "modern");
    }, "day-night-city-lights-style");
    bindDayNightInput(dayNightCityLightsIntensity, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsIntensity = clamp(Number.isFinite(value) ? value / 100 : 0.78, 0, 1.8);
    }, "day-night-city-lights-intensity");
    bindDayNightInput(dayNightCityLightsTextureOpacity, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsTextureOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.54, 0, 1);
    }, "day-night-city-lights-texture-opacity");
    bindDayNightInput(dayNightCityLightsCorridorStrength, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsCorridorStrength = clamp(Number.isFinite(value) ? value / 100 : 0.62, 0, 1);
    }, "day-night-city-lights-corridor-strength");
    bindDayNightInput(dayNightCityLightsCoreSharpness, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsCoreSharpness = clamp(Number.isFinite(value) ? value / 100 : 0.54, 0, 1);
    }, "day-night-city-lights-core-sharpness");
    bindDayNightChange(dayNightCityLightsPopulationBoostEnabled, (event) => {
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsPopulationBoostEnabled = !!event.target.checked;
    }, "day-night-city-lights-population-boost-enabled");
    bindDayNightInput(dayNightCityLightsPopulationBoostStrength, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.cityLightsPopulationBoostStrength = clamp(Number.isFinite(value) ? value / 100 : 0.56, 0, 1.5);
    }, "day-night-city-lights-population-boost-strength");
    bindDayNightInput(dayNightHistoricalCityLightsDensity, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.historicalCityLightsDensity = clamp(Number.isFinite(value) ? value / 100 : 1.25, 0.75, 2);
    }, "day-night-historical-city-lights-density");
    bindDayNightInput(dayNightHistoricalCityLightsSecondaryRetention, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.historicalCityLightsSecondaryRetention = clamp(Number.isFinite(value) ? value / 100 : 0.55, 0, 1);
    }, "day-night-historical-city-lights-secondary-retention");
    bindDayNightInput(dayNightShadowOpacity, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.shadowOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.28, 0, 0.85);
    }, "day-night-shadow-opacity");
    bindDayNightInput(dayNightTwilightWidth, (event) => {
      const value = Number(event.target.value);
      const dayNight = syncDayNightConfig();
      dayNight.twilightWidthDeg = clamp(Number.isFinite(value) ? value : 10, 2, 28);
    }, "day-night-twilight-width");

    if (toggleUrban && toggleUrban.dataset.bound !== "true") {
      toggleUrban.checked = !!runtimeState.showUrban;
      toggleUrban.addEventListener("change", (event) => {
        runtimeState.showUrban = event.target.checked;
        if (runtimeState.showUrban && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void runtimeState.ensureContextLayerDataFn("urban", { reason: "toolbar-toggle", renderNow: true });
        }
        renderDirty("toggle-urban");
      });
      toggleUrban.dataset.bound = "true";
    }

    if (togglePhysical && togglePhysical.dataset.bound !== "true") {
      togglePhysical.checked = !!runtimeState.showPhysical;
      togglePhysical.addEventListener("change", (event) => {
        runtimeState.showPhysical = event.target.checked;
        if (runtimeState.showPhysical && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void runtimeState.ensureContextLayerDataFn(["physical-set", "physical-contours-set"], { reason: "toolbar-toggle", renderNow: true });
        }
        renderDirty("toggle-physical");
      });
      togglePhysical.dataset.bound = "true";
    }

    if (toggleRivers && toggleRivers.dataset.bound !== "true") {
      toggleRivers.checked = !!runtimeState.showRivers;
      toggleRivers.addEventListener("change", (event) => {
        runtimeState.showRivers = event.target.checked;
        if (runtimeState.showRivers && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void runtimeState.ensureContextLayerDataFn("rivers", { reason: "toolbar-toggle", renderNow: true });
        }
        renderDirty("toggle-rivers");
      });
      toggleRivers.dataset.bound = "true";
    }

    if (toggleCityPoints && toggleCityPoints.dataset.bound !== "true") {
      toggleCityPoints.checked = !!runtimeState.showCityPoints;
      toggleCityPoints.addEventListener("change", (event) => {
        runtimeState.showCityPoints = !!event.target.checked;
        if (runtimeState.showCityPoints) {
          if (typeof runtimeState.ensureBaseCityDataFn === "function") {
            void runtimeState.ensureBaseCityDataFn({ reason: "toolbar-toggle", renderNow: true });
          }
          void ensureActiveScenarioOptionalLayerLoaded("cities", { renderNow: true });
        }
        persistCityViewSettings();
        renderDirty("toggle-city-points");
      });
      toggleCityPoints.dataset.bound = "true";
    }

    if (urbanMode && urbanMode.dataset.bound !== "true") {
      urbanMode.addEventListener("change", (event) => {
        const cfg = syncUrbanConfig();
        const requestedMode = String(event.target.value || "adaptive");
        const capability = getUrbanCapability();
        cfg.mode = requestedMode === "adaptive" && !capability.adaptiveAvailable ? "manual" : requestedMode;
        syncUrbanControls();
        renderDirty("urban-mode");
      });
      urbanMode.dataset.bound = "true";
    }
    if (urbanColor && urbanColor.dataset.bound !== "true") {
      urbanColor.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        cfg.color = normalizeOceanFillColor(event.target.value);
        renderDirty("urban-color");
      });
      urbanColor.dataset.bound = "true";
    }
    if (cityPointsColor && cityPointsColor.dataset.bound !== "true") {
      cityPointsColor.addEventListener("input", (event) => {
        const cfg = syncCityPointsConfig();
        cfg.color = normalizeOceanFillColor(event.target.value);
        persistCityViewSettings();
        renderDirty("city-points-color");
      });
      cityPointsColor.dataset.bound = "true";
    }
    if (cityPointsTheme && cityPointsTheme.dataset.bound !== "true") {
      cityPointsTheme.addEventListener("change", (event) => {
        const cfg = syncCityPointsConfig();
        cfg.theme = getCityPointsThemeMeta(event.target.value || "classic_graphite").value;
        const themeStyle = getCityPointsThemeStyle(cfg.theme);
        cfg.color = themeStyle.color;
        cfg.capitalColor = themeStyle.capitalColor;
        if (cityPointsThemeHint) cityPointsThemeHint.textContent = getCityPointsThemeHint(cfg.theme);
        if (cityPointsColor) cityPointsColor.value = normalizeOceanFillColor(cfg.color);
        if (cityPointsCapitalColor) cityPointsCapitalColor.value = normalizeOceanFillColor(cfg.capitalColor);
        persistCityViewSettings();
        renderDirty("city-points-theme");
      });
      cityPointsTheme.dataset.bound = "true";
    }
    if (cityPointsMarkerScale && cityPointsMarkerScale.dataset.bound !== "true") {
      cityPointsMarkerScale.addEventListener("input", (event) => {
        const cfg = syncCityPointsConfig();
        const value = Number(event.target.value);
        cfg.markerScale = clamp(Number.isFinite(value) ? value : 1, 0.75, 2.5);
        if (cityPointsMarkerScaleValue) cityPointsMarkerScaleValue.textContent = `${Number(cfg.markerScale).toFixed(2)}x`;
        persistCityViewSettings();
        renderDirty("city-points-marker-scale");
      });
      cityPointsMarkerScale.dataset.bound = "true";
    }
    if (cityPointsMarkerDensity && cityPointsMarkerDensity.dataset.bound !== "true") {
      const syncMarkerDensity = (event) => {
        const cfg = syncCityPointsConfig();
        const value = Number(event.target.value);
        cfg.markerDensity = clamp(Number.isFinite(value) ? value : 1, 0.5, 2);
        if (cityPointsMarkerDensityValue) cityPointsMarkerDensityValue.textContent = formatCityPointsDensityValue(cfg.markerDensity);
        persistCityViewSettings();
        renderDirty("city-points-marker-density");
      };
      cityPointsMarkerDensity.addEventListener("input", syncMarkerDensity);
      cityPointsMarkerDensity.addEventListener("change", syncMarkerDensity);
      cityPointsMarkerDensity.dataset.bound = "true";
    }
    if (cityPointsLabelDensity && cityPointsLabelDensity.dataset.bound !== "true") {
      cityPointsLabelDensity.addEventListener("change", (event) => {
        const cfg = syncCityPointsConfig();
        cfg.labelDensity = String(event.target.value || "balanced");
        if (cityPointsLabelDensityHint) cityPointsLabelDensityHint.textContent = getCityPointsLabelDensityHint(cfg.labelDensity);
        persistCityViewSettings();
        renderDirty("city-points-label-density");
      });
      cityPointsLabelDensity.dataset.bound = "true";
    }
    if (cityPointsCapitalColor && cityPointsCapitalColor.dataset.bound !== "true") {
      cityPointsCapitalColor.addEventListener("input", (event) => {
        const cfg = syncCityPointsConfig();
        cfg.capitalColor = normalizeOceanFillColor(event.target.value);
        persistCityViewSettings();
        renderDirty("city-points-capital-color");
      });
      cityPointsCapitalColor.dataset.bound = "true";
    }
    if (cityPointsOpacity && cityPointsOpacity.dataset.bound !== "true") {
      cityPointsOpacity.addEventListener("input", (event) => {
        const cfg = syncCityPointsConfig();
        const value = Number(event.target.value);
        cfg.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.92, 0, 1);
        if (cityPointsOpacityValue) cityPointsOpacityValue.textContent = `${Math.round(cfg.opacity * 100)}%`;
        persistCityViewSettings();
        renderDirty("city-points-opacity");
      });
      cityPointsOpacity.dataset.bound = "true";
    }
    if (cityPointLabelsEnabled && cityPointLabelsEnabled.dataset.bound !== "true") {
      cityPointLabelsEnabled.addEventListener("change", (event) => {
        const cfg = syncCityPointsConfig();
        cfg.showLabels = !!event.target.checked;
        persistCityViewSettings();
        renderDirty("city-points-labels-toggle");
      });
      cityPointLabelsEnabled.dataset.bound = "true";
    }
    if (cityPointsLabelSize && cityPointsLabelSize.dataset.bound !== "true") {
      cityPointsLabelSize.addEventListener("input", (event) => {
        const cfg = syncCityPointsConfig();
        const value = Number(event.target.value);
        cfg.labelSize = clamp(Math.round(Number.isFinite(value) ? value : 12), 8, 24);
        if (cityPointsLabelSizeValue) cityPointsLabelSizeValue.textContent = `${Math.round(cfg.labelSize)}px`;
        persistCityViewSettings();
        renderDirty("city-points-label-size");
      });
      cityPointsLabelSize.dataset.bound = "true";
    }
    if (cityCapitalOverlayEnabled && cityCapitalOverlayEnabled.dataset.bound !== "true") {
      cityCapitalOverlayEnabled.addEventListener("change", (event) => {
        const cfg = syncCityPointsConfig();
        cfg.showCapitalOverlay = !!event.target.checked;
        persistCityViewSettings();
        renderDirty("city-points-capital-overlay");
      });
      cityCapitalOverlayEnabled.dataset.bound = "true";
    }
    if (urbanOpacity && urbanOpacity.dataset.bound !== "true") {
      urbanOpacity.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        cfg.fillOpacity = clamp(Number.isFinite(value) ? value / 100 : cfg.fillOpacity, 0, 1);
        if (urbanOpacityValue) urbanOpacityValue.textContent = `${Math.round(cfg.fillOpacity * 100)}%`;
        renderDirty("urban-opacity");
      });
      urbanOpacity.dataset.bound = "true";
    }
    if (urbanBlendMode && urbanBlendMode.dataset.bound !== "true") {
      urbanBlendMode.addEventListener("change", (event) => {
        const cfg = syncUrbanConfig();
        cfg.blendMode = String(event.target.value || "multiply");
        renderDirty("urban-blend");
      });
      urbanBlendMode.dataset.bound = "true";
    }
    if (urbanAdaptiveStrength && urbanAdaptiveStrength.dataset.bound !== "true") {
      urbanAdaptiveStrength.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        cfg.adaptiveStrength = clamp(Number.isFinite(value) ? value / 100 : cfg.adaptiveStrength, 0, 1);
        if (urbanAdaptiveStrengthValue) urbanAdaptiveStrengthValue.textContent = `${Math.round(cfg.adaptiveStrength * 100)}%`;
        renderDirty("urban-adaptive-strength");
      });
      urbanAdaptiveStrength.dataset.bound = "true";
    }
    if (urbanStrokeOpacity && urbanStrokeOpacity.dataset.bound !== "true") {
      urbanStrokeOpacity.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        cfg.strokeOpacity = clamp(Number.isFinite(value) ? value / 100 : cfg.strokeOpacity, 0, 1);
        if (urbanStrokeOpacityValue) urbanStrokeOpacityValue.textContent = `${Math.round(cfg.strokeOpacity * 100)}%`;
        renderDirty("urban-stroke-opacity");
      });
      urbanStrokeOpacity.dataset.bound = "true";
    }
    if (urbanToneBias && urbanToneBias.dataset.bound !== "true") {
      urbanToneBias.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        cfg.toneBias = clamp(Number.isFinite(value) ? value / 100 : cfg.toneBias, -0.3, 0.3);
        if (urbanToneBiasValue) urbanToneBiasValue.textContent = formatUrbanToneBias(cfg.toneBias);
        renderDirty("urban-tone-bias");
      });
      urbanToneBias.dataset.bound = "true";
    }
    if (urbanAdaptiveTintEnabled && urbanAdaptiveTintEnabled.dataset.bound !== "true") {
      urbanAdaptiveTintEnabled.addEventListener("change", (event) => {
        const cfg = syncUrbanConfig();
        cfg.adaptiveTintEnabled = !!event.target.checked;
        syncUrbanControls();
        renderDirty("urban-adaptive-tint-enabled");
      });
      urbanAdaptiveTintEnabled.dataset.bound = "true";
    }
    if (urbanAdaptiveTintColor && urbanAdaptiveTintColor.dataset.bound !== "true") {
      urbanAdaptiveTintColor.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        cfg.adaptiveTintColor = normalizeOceanFillColor(event.target.value || cfg.adaptiveTintColor || "#f2dea1");
        renderDirty("urban-adaptive-tint-color");
      });
      urbanAdaptiveTintColor.dataset.bound = "true";
    }
    if (urbanAdaptiveTintStrength && urbanAdaptiveTintStrength.dataset.bound !== "true") {
      urbanAdaptiveTintStrength.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        cfg.adaptiveTintStrength = clamp(Number.isFinite(value) ? value / 100 : cfg.adaptiveTintStrength, 0, 0.5);
        if (urbanAdaptiveTintStrengthValue) urbanAdaptiveTintStrengthValue.textContent = `${Math.round(cfg.adaptiveTintStrength * 100)}%`;
        renderDirty("urban-adaptive-tint-strength");
      });
      urbanAdaptiveTintStrength.dataset.bound = "true";
    }
    if (urbanMinArea && urbanMinArea.dataset.bound !== "true") {
      urbanMinArea.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        cfg.minAreaPx = clamp(Number.isFinite(value) ? value : 1, 1, 80);
        if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(cfg.minAreaPx)}`;
        renderDirty("urban-area");
      });
      urbanMinArea.dataset.bound = "true";
    }
    if (physicalPreset && physicalPreset.dataset.bound !== "true") {
      physicalPreset.addEventListener("change", (event) => {
        applyPhysicalPresetConfig(event.target.value || "balanced");
        renderAppearanceStyleControlsUi();
        renderDirty("physical-preset-select");
      });
      physicalPreset.dataset.bound = "true";
    }
    if (physicalMode && physicalMode.dataset.bound !== "true") {
      physicalMode.addEventListener("change", (event) => {
        const cfg = syncPhysicalConfig();
        cfg.mode = String(event.target.value || "atlas_and_contours");
        renderDirty("physical-mode");
      });
      physicalMode.dataset.bound = "true";
    }
    if (physicalOpacity && physicalOpacity.dataset.bound !== "true") {
      physicalOpacity.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
        if (physicalOpacityValue) physicalOpacityValue.textContent = `${Math.round(cfg.opacity * 100)}%`;
        renderDirty("physical-opacity");
      });
      physicalOpacity.dataset.bound = "true";
    }
    if (physicalAtlasIntensity && physicalAtlasIntensity.dataset.bound !== "true") {
      physicalAtlasIntensity.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.atlasIntensity = clamp(Number.isFinite(value) ? value / 100 : 0.9, 0.2, 1.4);
        if (physicalAtlasIntensityValue) physicalAtlasIntensityValue.textContent = `${Math.round(cfg.atlasIntensity * 100)}%`;
        renderDirty("physical-atlas-intensity");
      });
      physicalAtlasIntensity.dataset.bound = "true";
    }
    if (physicalRainforestEmphasis && physicalRainforestEmphasis.dataset.bound !== "true") {
      physicalRainforestEmphasis.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.rainforestEmphasis = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0, 1);
        if (physicalRainforestEmphasisValue) physicalRainforestEmphasisValue.textContent = `${Math.round(cfg.rainforestEmphasis * 100)}%`;
        renderDirty("physical-rainforest-emphasis");
      });
      physicalRainforestEmphasis.dataset.bound = "true";
    }
    if (physicalContourColor && physicalContourColor.dataset.bound !== "true") {
      physicalContourColor.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        cfg.contourColor = normalizeOceanFillColor(event.target.value);
        renderDirty("physical-contour-color");
      });
      physicalContourColor.dataset.bound = "true";
    }
    if (physicalContourOpacity && physicalContourOpacity.dataset.bound !== "true") {
      physicalContourOpacity.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.contourOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.34, 0, 1);
        if (physicalContourOpacityValue) physicalContourOpacityValue.textContent = `${Math.round(cfg.contourOpacity * 100)}%`;
        renderDirty("physical-contour-opacity");
      });
      physicalContourOpacity.dataset.bound = "true";
    }
    if (physicalMinorContours && physicalMinorContours.dataset.bound !== "true") {
      physicalMinorContours.addEventListener("change", (event) => {
        const cfg = syncPhysicalConfig();
        cfg.contourMinorVisible = !!event.target.checked;
        renderDirty("physical-contour-minor-toggle");
      });
      physicalMinorContours.dataset.bound = "true";
    }
    if (physicalContourMajorWidth && physicalContourMajorWidth.dataset.bound !== "true") {
      physicalContourMajorWidth.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.contourMajorWidth = clamp(Number.isFinite(value) ? value : 0.8, 0.2, 3);
        if (physicalContourMajorWidthValue) physicalContourMajorWidthValue.textContent = Number(cfg.contourMajorWidth).toFixed(2);
        renderDirty("physical-contour-major-width");
      });
      physicalContourMajorWidth.dataset.bound = "true";
    }
    if (physicalContourMinorWidth && physicalContourMinorWidth.dataset.bound !== "true") {
      physicalContourMinorWidth.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.contourMinorWidth = clamp(Number.isFinite(value) ? value : 0.45, 0.1, 2);
        if (physicalContourMinorWidthValue) physicalContourMinorWidthValue.textContent = Number(cfg.contourMinorWidth).toFixed(2);
        renderDirty("physical-contour-minor-width");
      });
      physicalContourMinorWidth.dataset.bound = "true";
    }
    if (physicalContourMajorInterval && physicalContourMajorInterval.dataset.bound !== "true") {
      physicalContourMajorInterval.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.contourMajorIntervalM = clamp(Number.isFinite(value) ? Math.round(value / 500) * 500 : 500, 500, 2000);
        if (physicalContourMajorIntervalValue) physicalContourMajorIntervalValue.textContent = `${Math.round(cfg.contourMajorIntervalM)}`;
        renderDirty("physical-contour-major-interval");
      });
      physicalContourMajorInterval.dataset.bound = "true";
    }
    if (physicalContourMinorInterval && physicalContourMinorInterval.dataset.bound !== "true") {
      physicalContourMinorInterval.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.contourMinorIntervalM = clamp(Number.isFinite(value) ? Math.round(value / 100) * 100 : 100, 100, 1000);
        if (physicalContourMinorIntervalValue) physicalContourMinorIntervalValue.textContent = `${Math.round(cfg.contourMinorIntervalM)}`;
        renderDirty("physical-contour-minor-interval");
      });
      physicalContourMinorInterval.dataset.bound = "true";
    }
    if (physicalContourMajorLowReliefCutoff && physicalContourMajorLowReliefCutoff.dataset.bound !== "true") {
      physicalContourMajorLowReliefCutoff.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.contourMajorLowReliefCutoffM = clamp(Number.isFinite(value) ? Math.round(value) : 200, 0, 2000);
        if (physicalContourMajorLowReliefCutoffValue) physicalContourMajorLowReliefCutoffValue.textContent = `${Math.round(cfg.contourMajorLowReliefCutoffM)}`;
        renderDirty("physical-contour-major-low-relief-cutoff");
      });
      physicalContourMajorLowReliefCutoff.dataset.bound = "true";
    }
    if (physicalContourMinorLowReliefCutoff && physicalContourMinorLowReliefCutoff.dataset.bound !== "true") {
      physicalContourMinorLowReliefCutoff.addEventListener("input", (event) => {
        const cfg = syncPhysicalConfig();
        const value = Number(event.target.value);
        cfg.contourMinorLowReliefCutoffM = clamp(Number.isFinite(value) ? Math.round(value) : 280, 0, 2000);
        if (physicalContourMinorLowReliefCutoffValue) physicalContourMinorLowReliefCutoffValue.textContent = `${Math.round(cfg.contourMinorLowReliefCutoffM)}`;
        renderDirty("physical-contour-minor-low-relief-cutoff");
      });
      physicalContourMinorLowReliefCutoff.dataset.bound = "true";
    }
    if (physicalBlendMode && physicalBlendMode.dataset.bound !== "true") {
      physicalBlendMode.addEventListener("change", (event) => {
        const cfg = syncPhysicalConfig();
        cfg.blendMode = String(event.target.value || "source-over");
        renderDirty("physical-blend");
      });
      physicalBlendMode.dataset.bound = "true";
    }
    Object.entries(physicalClassToggleMap).forEach(([key, element]) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("change", (event) => {
        const cfg = syncPhysicalConfig();
        cfg.atlasClassVisibility = {
          ...(cfg.atlasClassVisibility || {}),
          [key]: !!event.target.checked,
        };
        renderDirty(`physical-class-${key}`);
      });
      element.dataset.bound = "true";
    });
    if (riversColor && riversColor.dataset.bound !== "true") {
      riversColor.addEventListener("input", (event) => {
        runtimeState.styleConfig.rivers.color = normalizeOceanFillColor(event.target.value);
        renderDirty("rivers-color");
      });
      riversColor.dataset.bound = "true";
    }
    if (riversOpacity && riversOpacity.dataset.bound !== "true") {
      riversOpacity.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.styleConfig.rivers.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.88, 0, 1);
        if (riversOpacityValue) riversOpacityValue.textContent = `${Math.round(runtimeState.styleConfig.rivers.opacity * 100)}%`;
        renderDirty("rivers-opacity");
      });
      riversOpacity.dataset.bound = "true";
    }
    if (riversWidth && riversWidth.dataset.bound !== "true") {
      riversWidth.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.styleConfig.rivers.width = clamp(Number.isFinite(value) ? value : 0.5, 0.2, 4);
        if (riversWidthValue) riversWidthValue.textContent = Number(runtimeState.styleConfig.rivers.width).toFixed(2);
        renderDirty("rivers-width");
      });
      riversWidth.dataset.bound = "true";
    }
    if (riversOutlineColor && riversOutlineColor.dataset.bound !== "true") {
      riversOutlineColor.addEventListener("input", (event) => {
        runtimeState.styleConfig.rivers.outlineColor = normalizeOceanFillColor(event.target.value);
        renderDirty("rivers-outline-color");
      });
      riversOutlineColor.dataset.bound = "true";
    }
    if (riversOutlineWidth && riversOutlineWidth.dataset.bound !== "true") {
      riversOutlineWidth.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.styleConfig.rivers.outlineWidth = clamp(Number.isFinite(value) ? value : 0.25, 0, 3);
        if (riversOutlineWidthValue) riversOutlineWidthValue.textContent = Number(runtimeState.styleConfig.rivers.outlineWidth).toFixed(2);
        renderDirty("rivers-outline-width");
      });
      riversOutlineWidth.dataset.bound = "true";
    }
    if (riversDashStyle && riversDashStyle.dataset.bound !== "true") {
      riversDashStyle.addEventListener("change", (event) => {
        runtimeState.styleConfig.rivers.dashStyle = String(event.target.value || "solid");
        renderDirty("rivers-dash");
      });
      riversDashStyle.dataset.bound = "true";
    }

    const applyReferenceStyles = () => {
      const referenceImage = document.getElementById("referenceImage");
      if (!referenceImage) return;
      referenceImage.style.opacity = String(runtimeState.referenceImageState.opacity);
      referenceImage.style.transform =
        `translate(${runtimeState.referenceImageState.offsetX}px, ${runtimeState.referenceImageState.offsetY}px) `
        + `scale(${runtimeState.referenceImageState.scale})`;
    };

    if (referenceImageInput && referenceImageInput.dataset.bound !== "true") {
      referenceImageInput.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        const referenceImage = document.getElementById("referenceImage");
        if (!referenceImage) return;
        if (!file) {
          if (runtimeState.referenceImageUrl) {
            URL.revokeObjectURL(runtimeState.referenceImageUrl);
            runtimeState.referenceImageUrl = null;
          }
          referenceImage.src = "";
          referenceImage.style.opacity = "0";
          markDirty("reference-image-clear");
          return;
        }
        if (runtimeState.referenceImageUrl) {
          URL.revokeObjectURL(runtimeState.referenceImageUrl);
        }
        runtimeState.referenceImageUrl = URL.createObjectURL(file);
        referenceImage.src = runtimeState.referenceImageUrl;
        applyReferenceStyles();
        markDirty("reference-image-file");
      });
      referenceImageInput.dataset.bound = "true";
    }
    if (referenceOpacity && referenceOpacity.dataset.bound !== "true") {
      runtimeState.referenceImageState.opacity = Number(referenceOpacity.value) / 100;
      if (referenceOpacityValue) referenceOpacityValue.textContent = `${referenceOpacity.value}%`;
      referenceOpacity.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.referenceImageState.opacity = Number.isFinite(value) ? value / 100 : 0.6;
        if (referenceOpacityValue) referenceOpacityValue.textContent = `${event.target.value}%`;
        applyReferenceStyles();
        markDirty("reference-opacity");
      });
      referenceOpacity.dataset.bound = "true";
    }
    if (referenceScale && referenceScale.dataset.bound !== "true") {
      runtimeState.referenceImageState.scale = Number(referenceScale.value);
      if (referenceScaleValue) referenceScaleValue.textContent = `${Number(referenceScale.value).toFixed(2)}x`;
      referenceScale.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.referenceImageState.scale = Number.isFinite(value) ? value : 1;
        if (referenceScaleValue) referenceScaleValue.textContent = `${runtimeState.referenceImageState.scale.toFixed(2)}x`;
        applyReferenceStyles();
        markDirty("reference-scale");
      });
      referenceScale.dataset.bound = "true";
    }
    if (referenceOffsetX && referenceOffsetX.dataset.bound !== "true") {
      runtimeState.referenceImageState.offsetX = Number(referenceOffsetX.value);
      if (referenceOffsetXValue) referenceOffsetXValue.textContent = `${referenceOffsetX.value}px`;
      referenceOffsetX.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.referenceImageState.offsetX = Number.isFinite(value) ? value : 0;
        if (referenceOffsetXValue) referenceOffsetXValue.textContent = `${runtimeState.referenceImageState.offsetX}px`;
        applyReferenceStyles();
        markDirty("reference-offset-x");
      });
      referenceOffsetX.dataset.bound = "true";
    }
    if (referenceOffsetY && referenceOffsetY.dataset.bound !== "true") {
      runtimeState.referenceImageState.offsetY = Number(referenceOffsetY.value);
      if (referenceOffsetYValue) referenceOffsetYValue.textContent = `${referenceOffsetY.value}px`;
      referenceOffsetY.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.referenceImageState.offsetY = Number.isFinite(value) ? value : 0;
        if (referenceOffsetYValue) referenceOffsetYValue.textContent = `${runtimeState.referenceImageState.offsetY}px`;
        applyReferenceStyles();
        markDirty("reference-offset-y");
      });
      referenceOffsetY.dataset.bound = "true";
    }
  };

  return {
    applyAppearanceFilter,
    bindEvents,
    renderAppearanceStyleControlsUi,
    renderReferenceOverlayUi,
    renderParentBorderCountryList,
    renderRecentColors,
    renderDayNightUI,
    renderTextureUI,
    renderTransportAppearanceUi,
    setAppearanceTab,
    syncParentBorderVisibilityUI,
  };
}

