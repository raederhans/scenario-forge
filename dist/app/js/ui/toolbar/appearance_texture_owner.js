import {
  normalizeDayNightStyleConfig,
  normalizeTextureMode,
  normalizeTextureStyleConfig,
} from "../../core/state.js";
import { captureHistoryState, pushHistoryEntry } from "../../core/history_manager.js";
import { setAppearanceStyleGroupState } from "../../core/state/actions/appearance_actions.js";
import { callRuntimeHook } from "../../core/state/index.js";

export const TEXTURE_STYLE_PATHS = Object.freeze([
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
]);

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatUtcMinutes(rawValue, clampFn = clampNumber) {
  const totalMinutes = clampFn(Math.round(Number(rawValue) || 0), 0, 24 * 60 - 1);
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

function updateValueLabel(element, text) {
  if (element) element.textContent = text;
}

function formatCycleSecondsPerDay(rawValue, t = (value) => value) {
  const seconds = Math.round(Number(rawValue) || 0);
  return t("{seconds}s / day", "ui").replace("{seconds}", String(seconds));
}

function collectTextureNodes(documentRef) {
  return {
    textureSelect: documentRef.getElementById("textureSelect"),
    textureOpacity: documentRef.getElementById("textureOpacity"),
    texturePaperControls: documentRef.getElementById("texturePaperControls"),
    texturePaperScale: documentRef.getElementById("texturePaperScale"),
    texturePaperWarmth: documentRef.getElementById("texturePaperWarmth"),
    texturePaperGrain: documentRef.getElementById("texturePaperGrain"),
    texturePaperWear: documentRef.getElementById("texturePaperWear"),
    textureGraticuleControls: documentRef.getElementById("textureGraticuleControls"),
    textureGraticuleMajorStep: documentRef.getElementById("textureGraticuleMajorStep"),
    textureGraticuleMinorStep: documentRef.getElementById("textureGraticuleMinorStep"),
    textureGraticuleLabelStep: documentRef.getElementById("textureGraticuleLabelStep"),
    textureGraticuleColor: documentRef.getElementById("textureGraticuleColor"),
    textureGraticuleLabelColor: documentRef.getElementById("textureGraticuleLabelColor"),
    textureGraticuleLabelSize: documentRef.getElementById("textureGraticuleLabelSize"),
    textureGraticuleMajorWidth: documentRef.getElementById("textureGraticuleMajorWidth"),
    textureGraticuleMinorWidth: documentRef.getElementById("textureGraticuleMinorWidth"),
    textureGraticuleMajorOpacity: documentRef.getElementById("textureGraticuleMajorOpacity"),
    textureGraticuleMinorOpacity: documentRef.getElementById("textureGraticuleMinorOpacity"),
    textureDraftGridControls: documentRef.getElementById("textureDraftGridControls"),
    textureDraftMajorStep: documentRef.getElementById("textureDraftMajorStep"),
    textureDraftMinorStep: documentRef.getElementById("textureDraftMinorStep"),
    textureDraftLonOffset: documentRef.getElementById("textureDraftLonOffset"),
    textureDraftLatOffset: documentRef.getElementById("textureDraftLatOffset"),
    textureDraftRoll: documentRef.getElementById("textureDraftRoll"),
    textureDraftColor: documentRef.getElementById("textureDraftColor"),
    textureDraftWidth: documentRef.getElementById("textureDraftWidth"),
    textureDraftMajorOpacity: documentRef.getElementById("textureDraftMajorOpacity"),
    textureDraftMinorOpacity: documentRef.getElementById("textureDraftMinorOpacity"),
    textureDraftDash: documentRef.getElementById("textureDraftDash"),
    dayNightEnabled: documentRef.getElementById("dayNightEnabled"),
    dayNightMode: documentRef.getElementById("dayNightMode"),
    dayNightManualControls: documentRef.getElementById("dayNightManualControls"),
    dayNightManualTime: documentRef.getElementById("dayNightManualTime"),
    dayNightSyncComputerUtcBtn: documentRef.getElementById("dayNightSyncComputerUtcBtn"),
    dayNightCycleControls: documentRef.getElementById("dayNightCycleControls"),
    dayNightCycleSpeed: documentRef.getElementById("dayNightCycleSpeed"),
    dayNightCityLightsEnabled: documentRef.getElementById("dayNightCityLightsEnabled"),
    dayNightCityLightsStyle: documentRef.getElementById("dayNightCityLightsStyle"),
    dayNightCityLightsIntensity: documentRef.getElementById("dayNightCityLightsIntensity"),
    dayNightCityLightsTextureOpacity: documentRef.getElementById("dayNightCityLightsTextureOpacity"),
    dayNightCityLightsCorridorStrength: documentRef.getElementById("dayNightCityLightsCorridorStrength"),
    dayNightCityLightsCoreSharpness: documentRef.getElementById("dayNightCityLightsCoreSharpness"),
    dayNightCityLightsPopulationBoostEnabled: documentRef.getElementById("dayNightCityLightsPopulationBoostEnabled"),
    dayNightCityLightsPopulationBoostStrength: documentRef.getElementById("dayNightCityLightsPopulationBoostStrength"),
    dayNightHistoricalCityLightsDensity: documentRef.getElementById("dayNightHistoricalCityLightsDensity"),
    dayNightHistoricalCityLightsSecondaryRetention: documentRef.getElementById("dayNightHistoricalCityLightsSecondaryRetention"),
    dayNightShadowOpacity: documentRef.getElementById("dayNightShadowOpacity"),
    dayNightTwilightWidth: documentRef.getElementById("dayNightTwilightWidth"),
    textureOpacityValue: documentRef.getElementById("textureOpacityValue"),
    texturePaperScaleValue: documentRef.getElementById("texturePaperScaleValue"),
    texturePaperWarmthValue: documentRef.getElementById("texturePaperWarmthValue"),
    texturePaperGrainValue: documentRef.getElementById("texturePaperGrainValue"),
    texturePaperWearValue: documentRef.getElementById("texturePaperWearValue"),
    textureGraticuleMajorStepValue: documentRef.getElementById("textureGraticuleMajorStepValue"),
    textureGraticuleMinorStepValue: documentRef.getElementById("textureGraticuleMinorStepValue"),
    textureGraticuleLabelStepValue: documentRef.getElementById("textureGraticuleLabelStepValue"),
    textureGraticuleLabelSizeValue: documentRef.getElementById("textureGraticuleLabelSizeValue"),
    textureGraticuleMajorWidthValue: documentRef.getElementById("textureGraticuleMajorWidthValue"),
    textureGraticuleMinorWidthValue: documentRef.getElementById("textureGraticuleMinorWidthValue"),
    textureGraticuleMajorOpacityValue: documentRef.getElementById("textureGraticuleMajorOpacityValue"),
    textureGraticuleMinorOpacityValue: documentRef.getElementById("textureGraticuleMinorOpacityValue"),
    textureDraftMajorStepValue: documentRef.getElementById("textureDraftMajorStepValue"),
    textureDraftMinorStepValue: documentRef.getElementById("textureDraftMinorStepValue"),
    textureDraftLonOffsetValue: documentRef.getElementById("textureDraftLonOffsetValue"),
    textureDraftLatOffsetValue: documentRef.getElementById("textureDraftLatOffsetValue"),
    textureDraftRollValue: documentRef.getElementById("textureDraftRollValue"),
    textureDraftWidthValue: documentRef.getElementById("textureDraftWidthValue"),
    textureDraftMajorOpacityValue: documentRef.getElementById("textureDraftMajorOpacityValue"),
    textureDraftMinorOpacityValue: documentRef.getElementById("textureDraftMinorOpacityValue"),
    dayNightManualTimeValue: documentRef.getElementById("dayNightManualTimeValue"),
    dayNightCycleSpeedValue: documentRef.getElementById("dayNightCycleSpeedValue"),
    dayNightCityLightsIntensityValue: documentRef.getElementById("dayNightCityLightsIntensityValue"),
    dayNightCityLightsTextureOpacityValue: documentRef.getElementById("dayNightCityLightsTextureOpacityValue"),
    dayNightCityLightsCorridorStrengthValue: documentRef.getElementById("dayNightCityLightsCorridorStrengthValue"),
    dayNightCityLightsCoreSharpnessValue: documentRef.getElementById("dayNightCityLightsCoreSharpnessValue"),
    dayNightCityLightsPopulationBoostStrengthValue: documentRef.getElementById("dayNightCityLightsPopulationBoostStrengthValue"),
    dayNightHistoricalCityLightsDensityValue: documentRef.getElementById("dayNightHistoricalCityLightsDensityValue"),
    dayNightHistoricalCityLightsSecondaryRetentionValue: documentRef.getElementById("dayNightHistoricalCityLightsSecondaryRetentionValue"),
    dayNightShadowOpacityValue: documentRef.getElementById("dayNightShadowOpacityValue"),
    dayNightTwilightWidthValue: documentRef.getElementById("dayNightTwilightWidthValue"),
  };
}

export function createAppearanceTextureOwner({
  runtimeState,
  t = (value) => value,
  clamp = clampNumber,
  normalizeOceanFillColor = (value) => value,
  renderDirty = () => {},
  documentRef = globalThis.document,
  captureHistoryStateFn = captureHistoryState,
  pushHistoryEntryFn = pushHistoryEntry,
  syncDayNightClockTimer = () => callRuntimeHook(null, "syncDayNightClockTimerFn"),
} = {}) {
  const nodes = collectTextureNodes(documentRef);
  const defaultDayNight = normalizeDayNightStyleConfig({});
  let textureHistoryBefore = null;
  let textureHistoryKind = "";

  const cloneStyleGroup = (value) => JSON.parse(JSON.stringify(value));

  const syncTextureConfig = () => {
    return setAppearanceStyleGroupState(
      runtimeState,
      "texture",
      normalizeTextureStyleConfig(runtimeState.styleConfig.texture),
    );
  };

  const syncDayNightConfig = () => {
    return setAppearanceStyleGroupState(
      runtimeState,
      "dayNight",
      normalizeDayNightStyleConfig(runtimeState.styleConfig.dayNight),
    );
  };

  const updateDayNightConfig = (mutate) => {
    const draft = cloneStyleGroup(syncDayNightConfig());
    if (typeof mutate === "function") mutate(draft);
    return setAppearanceStyleGroupState(
      runtimeState,
      "dayNight",
      normalizeDayNightStyleConfig(draft),
    );
  };

  const getComputerUtcMinutes = () => {
    const now = new Date();
    return (now.getUTCHours() * 60) + now.getUTCMinutes();
  };

  const beginTextureHistoryCapture = (kind = "texture-style") => {
    if (textureHistoryBefore && textureHistoryKind !== kind) {
      commitTextureHistory(textureHistoryKind || "texture-style");
    }
    if (textureHistoryBefore) return;
    textureHistoryKind = kind;
    textureHistoryBefore = captureHistoryStateFn({
      stylePaths: TEXTURE_STYLE_PATHS,
    });
  };

  const commitTextureHistory = (kind = "texture-style") => {
    if (!textureHistoryBefore) return;
    pushHistoryEntryFn({
      kind,
      before: textureHistoryBefore,
      after: captureHistoryStateFn({
        stylePaths: TEXTURE_STYLE_PATHS,
      }),
    });
    textureHistoryBefore = null;
    textureHistoryKind = "";
  };

  const renderTextureModePanels = (mode = runtimeState.styleConfig.texture?.mode || "none") => {
    nodes.texturePaperControls?.classList.toggle("hidden", mode !== "paper");
    nodes.textureGraticuleControls?.classList.toggle("hidden", mode !== "graticule");
    nodes.textureDraftGridControls?.classList.toggle("hidden", mode !== "draft_grid");
  };

  const renderTextureUI = () => {
    const texture = syncTextureConfig();
    const mode = normalizeTextureMode(texture.mode);
    const degreesLabel = "°";
    if (nodes.textureSelect) nodes.textureSelect.value = mode;
    const textureOpacityDisabled = mode === "none";
    if (nodes.textureOpacity) {
      nodes.textureOpacity.value = String(Math.round(texture.opacity * 100));
      nodes.textureOpacity.disabled = textureOpacityDisabled;
      nodes.textureOpacity.setAttribute("aria-disabled", textureOpacityDisabled ? "true" : "false");
    }
    updateValueLabel(nodes.textureOpacityValue, `${Math.round(texture.opacity * 100)}%`);
    if (nodes.texturePaperScale) nodes.texturePaperScale.value = String(Math.round(texture.paper.scale * 100));
    updateValueLabel(nodes.texturePaperScaleValue, `${texture.paper.scale.toFixed(2)}x`);
    if (nodes.texturePaperWarmth) nodes.texturePaperWarmth.value = String(Math.round(texture.paper.warmth * 100));
    updateValueLabel(nodes.texturePaperWarmthValue, `${Math.round(texture.paper.warmth * 100)}%`);
    if (nodes.texturePaperGrain) nodes.texturePaperGrain.value = String(Math.round(texture.paper.grain * 100));
    updateValueLabel(nodes.texturePaperGrainValue, `${Math.round(texture.paper.grain * 100)}%`);
    if (nodes.texturePaperWear) nodes.texturePaperWear.value = String(Math.round(texture.paper.wear * 100));
    updateValueLabel(nodes.texturePaperWearValue, `${Math.round(texture.paper.wear * 100)}%`);

    if (nodes.textureGraticuleMajorStep) nodes.textureGraticuleMajorStep.value = String(texture.graticule.majorStep);
    updateValueLabel(nodes.textureGraticuleMajorStepValue, `${Math.round(texture.graticule.majorStep)}${degreesLabel}`);
    if (nodes.textureGraticuleMinorStep) {
      nodes.textureGraticuleMinorStep.min = "1";
      nodes.textureGraticuleMinorStep.max = String(texture.graticule.majorStep);
      nodes.textureGraticuleMinorStep.step = "1";
      nodes.textureGraticuleMinorStep.value = String(texture.graticule.minorStep);
    }
    updateValueLabel(nodes.textureGraticuleMinorStepValue, `${Math.round(texture.graticule.minorStep)}${degreesLabel}`);
    if (nodes.textureGraticuleLabelStep) {
      nodes.textureGraticuleLabelStep.min = String(texture.graticule.majorStep);
      nodes.textureGraticuleLabelStep.max = "180";
      nodes.textureGraticuleLabelStep.step = "5";
      nodes.textureGraticuleLabelStep.value = String(texture.graticule.labelStep);
    }
    updateValueLabel(nodes.textureGraticuleLabelStepValue, `${Math.round(texture.graticule.labelStep)}${degreesLabel}`);
    if (nodes.textureGraticuleColor) nodes.textureGraticuleColor.value = texture.graticule.color;
    if (nodes.textureGraticuleLabelColor) nodes.textureGraticuleLabelColor.value = texture.graticule.labelColor;
    if (nodes.textureGraticuleLabelSize) nodes.textureGraticuleLabelSize.value = String(texture.graticule.labelSize);
    updateValueLabel(nodes.textureGraticuleLabelSizeValue, `${Math.round(texture.graticule.labelSize)}px`);
    if (nodes.textureGraticuleMajorWidth) nodes.textureGraticuleMajorWidth.value = String(texture.graticule.majorWidth);
    updateValueLabel(nodes.textureGraticuleMajorWidthValue, Number(texture.graticule.majorWidth).toFixed(2));
    if (nodes.textureGraticuleMinorWidth) nodes.textureGraticuleMinorWidth.value = String(texture.graticule.minorWidth);
    updateValueLabel(nodes.textureGraticuleMinorWidthValue, Number(texture.graticule.minorWidth).toFixed(2));
    if (nodes.textureGraticuleMajorOpacity) nodes.textureGraticuleMajorOpacity.value = String(Math.round(texture.graticule.majorOpacity * 100));
    updateValueLabel(nodes.textureGraticuleMajorOpacityValue, `${Math.round(texture.graticule.majorOpacity * 100)}%`);
    if (nodes.textureGraticuleMinorOpacity) nodes.textureGraticuleMinorOpacity.value = String(Math.round(texture.graticule.minorOpacity * 100));
    updateValueLabel(nodes.textureGraticuleMinorOpacityValue, `${Math.round(texture.graticule.minorOpacity * 100)}%`);

    if (nodes.textureDraftMajorStep) nodes.textureDraftMajorStep.value = String(texture.draftGrid.majorStep);
    updateValueLabel(nodes.textureDraftMajorStepValue, `${Math.round(texture.draftGrid.majorStep)}${degreesLabel}`);
    if (nodes.textureDraftMinorStep) {
      nodes.textureDraftMinorStep.max = String(texture.draftGrid.majorStep);
      nodes.textureDraftMinorStep.value = String(texture.draftGrid.minorStep);
    }
    updateValueLabel(nodes.textureDraftMinorStepValue, `${Math.round(texture.draftGrid.minorStep)}${degreesLabel}`);
    if (nodes.textureDraftLonOffset) nodes.textureDraftLonOffset.value = String(Math.round(texture.draftGrid.lonOffset));
    updateValueLabel(nodes.textureDraftLonOffsetValue, `${Math.round(texture.draftGrid.lonOffset)}${degreesLabel}`);
    if (nodes.textureDraftLatOffset) nodes.textureDraftLatOffset.value = String(Math.round(texture.draftGrid.latOffset));
    updateValueLabel(nodes.textureDraftLatOffsetValue, `${Math.round(texture.draftGrid.latOffset)}${degreesLabel}`);
    if (nodes.textureDraftRoll) nodes.textureDraftRoll.value = String(Math.round(texture.draftGrid.roll));
    updateValueLabel(nodes.textureDraftRollValue, `${Math.round(texture.draftGrid.roll)}${degreesLabel}`);
    if (nodes.textureDraftColor) nodes.textureDraftColor.value = texture.draftGrid.color;
    if (nodes.textureDraftWidth) nodes.textureDraftWidth.value = String(texture.draftGrid.width);
    updateValueLabel(nodes.textureDraftWidthValue, Number(texture.draftGrid.width).toFixed(2));
    if (nodes.textureDraftMajorOpacity) nodes.textureDraftMajorOpacity.value = String(Math.round(texture.draftGrid.majorOpacity * 100));
    updateValueLabel(nodes.textureDraftMajorOpacityValue, `${Math.round(texture.draftGrid.majorOpacity * 100)}%`);
    if (nodes.textureDraftMinorOpacity) nodes.textureDraftMinorOpacity.value = String(Math.round(texture.draftGrid.minorOpacity * 100));
    updateValueLabel(nodes.textureDraftMinorOpacityValue, `${Math.round(texture.draftGrid.minorOpacity * 100)}%`);
    if (nodes.textureDraftDash) nodes.textureDraftDash.value = texture.draftGrid.dash;
    renderTextureModePanels(mode);
  };

  const renderDayNightUI = () => {
    // 这里所有 enabled/disabled 状态都从同一份归一化后的 dayNight config 推导，
    // 避免 modern / historical 两套控件各自记状态，切模式后留下半旧 UI。
    const dayNight = syncDayNightConfig();
    if (nodes.dayNightEnabled) nodes.dayNightEnabled.checked = !!dayNight.enabled;
    if (nodes.dayNightMode) nodes.dayNightMode.value = dayNight.mode;
    if (nodes.dayNightManualTime) nodes.dayNightManualTime.value = String(dayNight.manualUtcMinutes);
    updateValueLabel(nodes.dayNightManualTimeValue, formatUtcMinutes(dayNight.manualUtcMinutes, clamp));
    nodes.dayNightManualControls?.classList.toggle("hidden", dayNight.mode !== "manual");
    nodes.dayNightCycleControls?.classList.toggle("hidden", dayNight.mode !== "cycle");
    if (nodes.dayNightCycleSpeed) nodes.dayNightCycleSpeed.value = String(dayNight.cycleSecondsPerDay);
    updateValueLabel(nodes.dayNightCycleSpeedValue, formatCycleSecondsPerDay(dayNight.cycleSecondsPerDay, t));

    if (nodes.dayNightCityLightsEnabled) nodes.dayNightCityLightsEnabled.checked = !!dayNight.cityLightsEnabled;
    if (nodes.dayNightCityLightsStyle) {
      nodes.dayNightCityLightsStyle.value = dayNight.cityLightsStyle;
      nodes.dayNightCityLightsStyle.disabled = !dayNight.cityLightsEnabled;
    }
    const modernLightsControlsEnabled = dayNight.cityLightsEnabled && dayNight.cityLightsStyle === "modern";
    const historicalLightsControlsEnabled = dayNight.cityLightsEnabled && dayNight.cityLightsStyle === "historical_1930s";
    if (nodes.dayNightCityLightsIntensity) {
      nodes.dayNightCityLightsIntensity.value = String(Math.round(dayNight.cityLightsIntensity * 100));
      nodes.dayNightCityLightsIntensity.disabled = !dayNight.cityLightsEnabled;
    }
    updateValueLabel(nodes.dayNightCityLightsIntensityValue, `${Math.round(dayNight.cityLightsIntensity * 100)}%`);
    if (nodes.dayNightCityLightsTextureOpacity) {
      nodes.dayNightCityLightsTextureOpacity.value = String(Math.round(dayNight.cityLightsTextureOpacity * 100));
      nodes.dayNightCityLightsTextureOpacity.disabled = !modernLightsControlsEnabled;
    }
    updateValueLabel(nodes.dayNightCityLightsTextureOpacityValue, `${Math.round(dayNight.cityLightsTextureOpacity * 100)}%`);
    if (nodes.dayNightCityLightsCorridorStrength) {
      nodes.dayNightCityLightsCorridorStrength.value = String(Math.round(dayNight.cityLightsCorridorStrength * 100));
      nodes.dayNightCityLightsCorridorStrength.disabled = !modernLightsControlsEnabled;
    }
    updateValueLabel(nodes.dayNightCityLightsCorridorStrengthValue, `${Math.round(dayNight.cityLightsCorridorStrength * 100)}%`);
    if (nodes.dayNightCityLightsCoreSharpness) {
      nodes.dayNightCityLightsCoreSharpness.value = String(Math.round(dayNight.cityLightsCoreSharpness * 100));
      nodes.dayNightCityLightsCoreSharpness.disabled = !modernLightsControlsEnabled;
    }
    updateValueLabel(nodes.dayNightCityLightsCoreSharpnessValue, `${Math.round(dayNight.cityLightsCoreSharpness * 100)}%`);
    if (nodes.dayNightCityLightsPopulationBoostEnabled) {
      nodes.dayNightCityLightsPopulationBoostEnabled.checked = !!dayNight.cityLightsPopulationBoostEnabled;
      nodes.dayNightCityLightsPopulationBoostEnabled.disabled = !modernLightsControlsEnabled;
    }
    const populationBoostControlsEnabled = modernLightsControlsEnabled && !!dayNight.cityLightsPopulationBoostEnabled;
    if (nodes.dayNightCityLightsPopulationBoostStrength) {
      nodes.dayNightCityLightsPopulationBoostStrength.value = String(Math.round(dayNight.cityLightsPopulationBoostStrength * 100));
      nodes.dayNightCityLightsPopulationBoostStrength.disabled = !populationBoostControlsEnabled;
    }
    updateValueLabel(nodes.dayNightCityLightsPopulationBoostStrengthValue, `${Math.round(dayNight.cityLightsPopulationBoostStrength * 100)}%`);
    if (nodes.dayNightHistoricalCityLightsDensity) {
      nodes.dayNightHistoricalCityLightsDensity.value = String(Math.round(dayNight.historicalCityLightsDensity * 100));
      nodes.dayNightHistoricalCityLightsDensity.disabled = !historicalLightsControlsEnabled;
    }
    updateValueLabel(nodes.dayNightHistoricalCityLightsDensityValue, `${Math.round(dayNight.historicalCityLightsDensity * 100)}%`);
    if (nodes.dayNightHistoricalCityLightsSecondaryRetention) {
      nodes.dayNightHistoricalCityLightsSecondaryRetention.value = String(Math.round(dayNight.historicalCityLightsSecondaryRetention * 100));
      nodes.dayNightHistoricalCityLightsSecondaryRetention.disabled = !historicalLightsControlsEnabled;
    }
    updateValueLabel(nodes.dayNightHistoricalCityLightsSecondaryRetentionValue, `${Math.round(dayNight.historicalCityLightsSecondaryRetention * 100)}%`);
    if (nodes.dayNightShadowOpacity) nodes.dayNightShadowOpacity.value = String(Math.round(dayNight.shadowOpacity * 100));
    updateValueLabel(nodes.dayNightShadowOpacityValue, `${Math.round(dayNight.shadowOpacity * 100)}%`);
    if (nodes.dayNightTwilightWidth) nodes.dayNightTwilightWidth.value = String(Math.round(dayNight.twilightWidthDeg));
    updateValueLabel(nodes.dayNightTwilightWidthValue, `${Math.round(dayNight.twilightWidthDeg)}°`);
    syncDayNightClockTimer();
  };

  const updateTextureStyle = (mutate, { historyKind = "texture-style", commitHistory = false, renderReason = "texture-style" } = {}) => {
    // input/change 共用同一份 history capture：拖动滑杆期间持续改 working state，
    // 到 commit 边界再写入一条 undo 记录，避免一帧一个历史快照。
    beginTextureHistoryCapture(historyKind);
    const texture = cloneStyleGroup(syncTextureConfig());
    if (typeof mutate === "function") mutate(texture);
    setAppearanceStyleGroupState(
      runtimeState,
      "texture",
      normalizeTextureStyleConfig(texture),
    );
    renderTextureUI();
    renderDirty(renderReason);
    if (commitHistory) {
      commitTextureHistory(historyKind);
    }
  };

  const bindTextureRange = (element, handler) => {
    if (!element || element.dataset.bound === "true") return;
    element.addEventListener("input", (event) => {
      handler(event, false, "texture-style-input");
    });
    element.addEventListener("change", (event) => {
      handler(event, true, "texture-style");
    });
    element.dataset.bound = "true";
  };

  const bindDayNightInput = (element, mutate, reason) => {
    // day/night 滑杆走 input-only 即时刷新，语义上更像 renderer 参数调校而不是表单提交。
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

  const bindEvents = () => {
    if (nodes.textureSelect && nodes.textureSelect.dataset.bound !== "true") {
      nodes.textureSelect.addEventListener("change", (event) => {
        updateTextureStyle((texture) => {
          texture.mode = normalizeTextureMode(event.target.value);
        }, { historyKind: "texture-mode", commitHistory: true });
      });
      nodes.textureSelect.dataset.bound = "true";
    }

    bindTextureRange(nodes.textureOpacity, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        if (normalizeTextureMode(texture.mode) === "none") return;
        texture.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.88, 0, 1);
      }, { historyKind: "texture-opacity", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.texturePaperScale, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.paper.scale = clamp(Number.isFinite(value) ? value / 100 : 1, 0.55, 2.4);
      }, { historyKind: "texture-paper-scale", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.texturePaperWarmth, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.paper.warmth = clamp(Number.isFinite(value) ? value / 100 : 0.62, 0, 1);
      }, { historyKind: "texture-paper-warmth", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.texturePaperGrain, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.paper.grain = clamp(Number.isFinite(value) ? value / 100 : 0.34, 0, 1);
      }, { historyKind: "texture-paper-grain", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.texturePaperWear, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.paper.wear = clamp(Number.isFinite(value) ? value / 100 : 0.26, 0, 1);
      }, { historyKind: "texture-paper-wear", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleMajorStep, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.graticule.majorStep = clamp(Number.isFinite(value) ? value : 30, 10, 90);
        texture.graticule.minorStep = clamp(texture.graticule.minorStep, 1, texture.graticule.majorStep);
        texture.graticule.labelStep = Math.max(texture.graticule.labelStep, texture.graticule.majorStep);
      }, { historyKind: "texture-graticule-major", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleMinorStep, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.graticule.minorStep = clamp(Number.isFinite(value) ? value : 15, 1, texture.graticule.majorStep);
      }, { historyKind: "texture-graticule-minor", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleLabelStep, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.graticule.labelStep = clamp(Number.isFinite(value) ? value : 60, texture.graticule.majorStep, 180);
      }, { historyKind: "texture-graticule-label", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleColor, (event, commit, renderReason) => {
      updateTextureStyle((texture) => {
        texture.graticule.color = normalizeOceanFillColor(event.target.value);
      }, { historyKind: "texture-graticule-color", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleLabelColor, (event, commit, renderReason) => {
      updateTextureStyle((texture) => {
        texture.graticule.labelColor = normalizeOceanFillColor(event.target.value);
      }, { historyKind: "texture-graticule-label-color", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleLabelSize, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.graticule.labelSize = clamp(Math.round(Number.isFinite(value) ? value : 12), 9, 24);
      }, { historyKind: "texture-graticule-label-size", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleMajorWidth, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.graticule.majorWidth = clamp(Number.isFinite(value) ? value : 1.2, 0.2, 4);
      }, { historyKind: "texture-graticule-major-width", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleMinorWidth, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.graticule.minorWidth = clamp(Number.isFinite(value) ? value : 0.7, 0.1, 3);
      }, { historyKind: "texture-graticule-minor-width", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleMajorOpacity, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.graticule.majorOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.34, 0, 1);
      }, { historyKind: "texture-graticule-major-opacity", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureGraticuleMinorOpacity, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.graticule.minorOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.14, 0, 1);
      }, { historyKind: "texture-graticule-minor-opacity", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftMajorStep, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.draftGrid.majorStep = clamp(Number.isFinite(value) ? value : 24, 12, 90);
        texture.draftGrid.minorStep = Math.min(texture.draftGrid.minorStep, texture.draftGrid.majorStep);
      }, { historyKind: "texture-draft-major", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftMinorStep, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.draftGrid.minorStep = clamp(Number.isFinite(value) ? value : 12, 4, texture.draftGrid.majorStep);
      }, { historyKind: "texture-draft-minor", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftLonOffset, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.draftGrid.lonOffset = clamp(Number.isFinite(value) ? value : 0, -180, 180);
      }, { historyKind: "texture-draft-longitude", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftLatOffset, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.draftGrid.latOffset = clamp(Number.isFinite(value) ? value : 12, -80, 80);
      }, { historyKind: "texture-draft-latitude", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftRoll, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.draftGrid.roll = clamp(Number.isFinite(value) ? value : -18, -180, 180);
      }, { historyKind: "texture-draft-roll", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftColor, (event, commit, renderReason) => {
      updateTextureStyle((texture) => {
        texture.draftGrid.color = normalizeOceanFillColor(event.target.value);
      }, { historyKind: "texture-draft-color", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftWidth, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.draftGrid.width = clamp(Number.isFinite(value) ? value : 1.1, 0.2, 4);
      }, { historyKind: "texture-draft-width", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftMajorOpacity, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.draftGrid.majorOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.28, 0, 1);
      }, { historyKind: "texture-draft-major-opacity", commitHistory: commit, renderReason });
    });
    bindTextureRange(nodes.textureDraftMinorOpacity, (event, commit, renderReason) => {
      const value = Number(event.target.value);
      updateTextureStyle((texture) => {
        texture.draftGrid.minorOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.14, 0, 1);
      }, { historyKind: "texture-draft-minor-opacity", commitHistory: commit, renderReason });
    });
    if (nodes.textureDraftDash && nodes.textureDraftDash.dataset.bound !== "true") {
      nodes.textureDraftDash.addEventListener("change", (event) => {
        updateTextureStyle((texture) => {
          texture.draftGrid.dash = String(event.target.value || "dashed");
        }, { historyKind: "texture-draft-dash", commitHistory: true });
      });
      nodes.textureDraftDash.dataset.bound = "true";
    }

    if (nodes.dayNightEnabled && nodes.dayNightEnabled.dataset.bound !== "true") {
      nodes.dayNightEnabled.addEventListener("change", (event) => {
        updateDayNightConfig((draft) => {
          draft.enabled = !!event.target.checked;
        });
        renderDayNightUI();
        renderDirty("day-night-enabled");
      });
      nodes.dayNightEnabled.dataset.bound = "true";
    }
    bindDayNightChange(nodes.dayNightMode, (event) => {
      const mode = String(event.target.value || "manual").trim().toLowerCase();
      updateDayNightConfig((draft) => {
        draft.mode = mode === "utc" || mode === "cycle" ? mode : "manual";
      });
    }, "day-night-mode");
    bindDayNightInput(nodes.dayNightManualTime, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.mode = "manual";
        draft.manualUtcMinutes = clamp(Number.isFinite(value) ? value : 12 * 60, 0, 24 * 60 - 1);
      });
    }, "day-night-time");
    bindDayNightInput(nodes.dayNightCycleSpeed, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.mode = "cycle";
        draft.cycleSecondsPerDay = clamp(
          Number.isFinite(value) ? value : defaultDayNight.cycleSecondsPerDay,
          10,
          600
        );
      });
    }, "day-night-cycle-speed");
    if (nodes.dayNightSyncComputerUtcBtn && nodes.dayNightSyncComputerUtcBtn.dataset.bound !== "true") {
      nodes.dayNightSyncComputerUtcBtn.addEventListener("click", () => {
        updateDayNightConfig((draft) => {
          draft.mode = "manual";
          draft.manualUtcMinutes = clamp(getComputerUtcMinutes(), 0, 24 * 60 - 1);
        });
        renderDayNightUI();
        renderDirty("day-night-sync-computer-utc");
      });
      nodes.dayNightSyncComputerUtcBtn.dataset.bound = "true";
    }
    bindDayNightChange(nodes.dayNightCityLightsEnabled, (event) => {
      updateDayNightConfig((draft) => {
        draft.cityLightsEnabled = !!event.target.checked;
      });
    }, "day-night-city-lights-enabled");
    bindDayNightChange(nodes.dayNightCityLightsStyle, (event) => {
      updateDayNightConfig((draft) => {
        draft.cityLightsStyle = String(event.target.value || "modern");
      });
    }, "day-night-city-lights-style");
    bindDayNightInput(nodes.dayNightCityLightsIntensity, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.cityLightsIntensity = clamp(
          Number.isFinite(value) ? value / 100 : defaultDayNight.cityLightsIntensity,
          0,
          1.8
        );
      });
    }, "day-night-city-lights-intensity");
    bindDayNightInput(nodes.dayNightCityLightsTextureOpacity, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.cityLightsTextureOpacity = clamp(
          Number.isFinite(value) ? value / 100 : defaultDayNight.cityLightsTextureOpacity,
          0,
          1
        );
      });
    }, "day-night-city-lights-texture-opacity");
    bindDayNightInput(nodes.dayNightCityLightsCorridorStrength, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.cityLightsCorridorStrength = clamp(
          Number.isFinite(value) ? value / 100 : defaultDayNight.cityLightsCorridorStrength,
          0,
          1
        );
      });
    }, "day-night-city-lights-corridor-strength");
    bindDayNightInput(nodes.dayNightCityLightsCoreSharpness, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.cityLightsCoreSharpness = clamp(
          Number.isFinite(value) ? value / 100 : defaultDayNight.cityLightsCoreSharpness,
          0,
          1
        );
      });
    }, "day-night-city-lights-core-sharpness");
    bindDayNightChange(nodes.dayNightCityLightsPopulationBoostEnabled, (event) => {
      updateDayNightConfig((draft) => {
        draft.cityLightsPopulationBoostEnabled = !!event.target.checked;
      });
    }, "day-night-city-lights-population-boost-enabled");
    bindDayNightInput(nodes.dayNightCityLightsPopulationBoostStrength, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.cityLightsPopulationBoostStrength = clamp(
          Number.isFinite(value) ? value / 100 : defaultDayNight.cityLightsPopulationBoostStrength,
          0,
          1.5
        );
      });
    }, "day-night-city-lights-population-boost-strength");
    bindDayNightInput(nodes.dayNightHistoricalCityLightsDensity, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.historicalCityLightsDensity = clamp(Number.isFinite(value) ? value / 100 : 1.25, 0.75, 2);
      });
    }, "day-night-historical-city-lights-density");
    bindDayNightInput(nodes.dayNightHistoricalCityLightsSecondaryRetention, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.historicalCityLightsSecondaryRetention = clamp(Number.isFinite(value) ? value / 100 : 0.55, 0, 1);
      });
    }, "day-night-historical-city-lights-secondary-retention");
    bindDayNightInput(nodes.dayNightShadowOpacity, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.shadowOpacity = clamp(
          Number.isFinite(value) ? value / 100 : defaultDayNight.shadowOpacity,
          0,
          0.85
        );
      });
    }, "day-night-shadow-opacity");
    bindDayNightInput(nodes.dayNightTwilightWidth, (event) => {
      const value = Number(event.target.value);
      updateDayNightConfig((draft) => {
        draft.twilightWidthDeg = clamp(Number.isFinite(value) ? value : 10, 2, 28);
      });
    }, "day-night-twilight-width");
  };

  return {
    bindEvents,
    renderDayNightUI,
    renderTextureUI,
    syncDayNightConfig,
    syncTextureConfig,
  };
}
