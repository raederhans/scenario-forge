import {
  normalizeDayNightStyleConfig,
  normalizeTextureMode,
  normalizeTextureStyleConfig,
  normalizeTransportOverviewStyleConfig,
  resolveLinkedTransportOverviewScopeAndThreshold,
} from "../../core/state.js";
import { normalizeHexColor } from "../../core/palette_manager.js";
import { captureHistoryState, pushHistoryEntry } from "../../core/history_manager.js";

/**
 * Owns the Appearance 面板里的 transport appearance、tab/filter、recent colors、
 * parent border country list 这些闭环逻辑。
 *
 * toolbar.js 继续保留更高层 facade：
 * - state callback 注册
 * - special zone popover 壳层
 * - export / dock / workspace 编排
 */
export function createAppearanceControlsController({
  state,
  t,
  clamp,
  renderDirty,
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
      panel.classList.toggle("hidden", id !== normalizedTabId);
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
    state.styleConfig.texture = normalizeTextureStyleConfig(state.styleConfig.texture);
    return state.styleConfig.texture;
  };

  const syncDayNightConfig = () => {
    state.styleConfig.dayNight = normalizeDayNightStyleConfig(state.styleConfig.dayNight);
    return state.styleConfig.dayNight;
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

  const renderTextureModePanels = (mode = state.styleConfig.texture?.mode || "none") => {
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
    const transportEnabled = state.showTransport !== false;
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
      transportAirportSummaryMeta.textContent = buildTransportFamilySummaryText("airport", transportEnabled, !!state.showAirports, airportConfig, airportScopeState);
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
      transportPortSummaryMeta.textContent = buildTransportFamilySummaryText("port", transportEnabled, !!state.showPorts, portConfig, portScopeState);
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
      transportRailSummaryMeta.textContent = buildTransportFamilySummaryText("rail", transportEnabled, !!state.showRail, railConfig, railScopeState);
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
      transportRoadSummaryMeta.textContent = buildTransportFamilySummaryText("road", transportEnabled, !!state.showRoad, roadConfig, roadScopeState);
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
    state.syncFacilityInfoCardVisibilityFn?.();
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

  const renderRecentColors = () => {
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
  };

  const normalizeParentBorderEnabledMap = () => {
    const supported = Array.isArray(state.parentBorderSupportedCountries) ? state.parentBorderSupportedCountries : [];
    const prev = state.parentBorderEnabledByCountry && typeof state.parentBorderEnabledByCountry === "object"
      ? state.parentBorderEnabledByCountry
      : {};
    const next = {};
    supported.forEach((countryCode) => {
      next[countryCode] = !!prev[countryCode];
    });
    state.parentBorderEnabledByCountry = next;
  };

  const syncParentBorderVisibilityUI = () => {
    const enabled = state.parentBordersVisible !== false;
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
    const supported = Array.isArray(state.parentBorderSupportedCountries)
      ? [...state.parentBorderSupportedCountries]
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
        displayName: t(state.countryNames?.[code] || code, "geo"),
      }))
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
      toggleAirports.checked = !!state.showAirports;
      toggleAirports.addEventListener("change", (event) => {
        state.showAirports = !!event.target.checked;
        if (state.showAirports && typeof state.ensureContextLayerDataFn === "function") {
          void state.ensureContextLayerDataFn("airports", { reason: "toolbar-toggle", renderNow: true });
        }
        renderTransportAppearanceUi();
        renderDirty("toggle-airports");
      });
      toggleAirports.dataset.bound = "true";
    }

    if (togglePorts && !togglePorts.dataset.bound) {
      togglePorts.checked = !!state.showPorts;
      togglePorts.addEventListener("change", (event) => {
        state.showPorts = !!event.target.checked;
        if (state.showPorts && typeof state.ensureContextLayerDataFn === "function") {
          void state.ensureContextLayerDataFn("ports", { reason: "toolbar-toggle", renderNow: true });
        }
        renderTransportAppearanceUi();
        renderDirty("toggle-ports");
      });
      togglePorts.dataset.bound = "true";
    }

    if (toggleRail && !toggleRail.dataset.bound) {
      toggleRail.checked = !!state.showRail;
      toggleRail.addEventListener("change", (event) => {
        state.showRail = !!event.target.checked;
        if (state.showRail && state.showTransport === false) state.showTransport = true;
        if (state.showRail && typeof state.ensureContextLayerDataFn === "function") {
          void state.ensureContextLayerDataFn(["railways", "rail_stations_major"], { reason: "toolbar-toggle", renderNow: true });
        }
        renderTransportAppearanceUi();
        renderDirty("toggle-rail");
      });
      toggleRail.dataset.bound = "true";
    }

    if (toggleRoad && !toggleRoad.dataset.bound) {
      toggleRoad.checked = !!state.showRoad;
      toggleRoad.addEventListener("change", (event) => {
        state.showRoad = !!event.target.checked;
        if (state.showRoad && state.showTransport === false) state.showTransport = true;
        if (state.showRoad && typeof state.ensureContextLayerDataFn === "function") {
          void state.ensureContextLayerDataFn("roads", { reason: "toolbar-toggle", renderNow: true });
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
  };

  return {
    applyAppearanceFilter,
    bindEvents,
    renderParentBorderCountryList,
    renderRecentColors,
    renderDayNightUI,
    renderTextureUI,
    renderTransportAppearanceUi,
    setAppearanceTab,
    syncParentBorderVisibilityUI,
  };
}
