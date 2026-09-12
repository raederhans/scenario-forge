import {
  createPhysicalStyleConfigForPreset,
  normalizePhysicalPreset,
  normalizePhysicalStyleConfig,
} from "../../core/state.js";
import {
  patchAppearanceStyleGroupState,
  setAppearanceStyleGroupState,
} from "../../core/state/actions/appearance_actions.js";
import { setAppearanceVisibilityState } from "../../core/state/actions/appearance_visibility_actions.js";
import { getPhysicalContextLayerRequests } from "../../core/state_defaults.js";
import {
  captureHistoryState as captureRuntimeHistoryState,
  pushHistoryEntry as pushRuntimeHistoryEntry,
} from "../../core/history_manager.js";
import {
  createIntensityFieldEditorSection,
} from "./intensity_field_editor_section.js";

export const PHYSICAL_CLASS_TOGGLE_IDS = Object.freeze({
  mountain_high_relief: "physicalClassMountain",
  mountain_hills: "physicalClassMountainHills",
  upland_plateau: "physicalClassPlateau",
  badlands_canyon: "physicalClassBadlands",
  plains_lowlands: "physicalClassPlains",
  basin_lowlands: "physicalClassBasin",
  wetlands_delta: "physicalClassWetlands",
  forest_temperate: "physicalClassForestTemperate",
  rainforest_tropical: "physicalClassRainforestTropical",
  grassland_steppe: "physicalClassGrassland",
  desert_bare: "physicalClassDesert",
  tundra_ice: "physicalClassTundra",
});

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function collectPhysicalNodes(documentRef) {
  const physicalClassToggles = Object.fromEntries(
    Object.entries(PHYSICAL_CLASS_TOGGLE_IDS).map(([key, id]) => [key, documentRef.getElementById(id)]),
  );
  return {
    togglePhysical: documentRef.getElementById("togglePhysical"),
    physicalPreset: documentRef.getElementById("physicalPreset"),
    physicalPresetHint: documentRef.getElementById("physicalPresetHint"),
    physicalMode: documentRef.getElementById("physicalMode"),
    physicalOpacity: documentRef.getElementById("physicalOpacity"),
    physicalAtlasIntensity: documentRef.getElementById("physicalAtlasIntensity"),
    physicalRainforestEmphasis: documentRef.getElementById("physicalRainforestEmphasis"),
    physicalContourColor: documentRef.getElementById("physicalContourColor"),
    physicalContourOpacity: documentRef.getElementById("physicalContourOpacity"),
    physicalMinorContours: documentRef.getElementById("physicalMinorContours"),
    physicalContourMajorWidth: documentRef.getElementById("physicalContourMajorWidth"),
    physicalContourMinorWidth: documentRef.getElementById("physicalContourMinorWidth"),
    physicalContourMajorInterval: documentRef.getElementById("physicalContourMajorInterval"),
    physicalContourMinorInterval: documentRef.getElementById("physicalContourMinorInterval"),
    physicalContourMajorLowReliefCutoff: documentRef.getElementById("physicalContourMajorLowReliefCutoff"),
    physicalContourMinorLowReliefCutoff: documentRef.getElementById("physicalContourMinorLowReliefCutoff"),
    physicalBlendMode: documentRef.getElementById("physicalBlendMode"),
    physicalIntensityFieldChannelAtlas: documentRef.getElementById("physicalIntensityFieldChannelAtlas"),
    physicalIntensityFieldChannelContour: documentRef.getElementById("physicalIntensityFieldChannelContour"),
    physicalIntensityFieldEnabled: documentRef.getElementById("physicalIntensityFieldEnabled"),
    physicalIntensityFieldToolToggleBtn: documentRef.getElementById("physicalIntensityFieldToolToggleBtn"),
    physicalIntensityFieldPaintBtn: documentRef.getElementById("physicalIntensityFieldPaintBtn"),
    physicalIntensityFieldEraseBtn: documentRef.getElementById("physicalIntensityFieldEraseBtn"),
    physicalIntensityFieldPointsBtn: documentRef.getElementById("physicalIntensityFieldPointsBtn"),
    physicalIntensityFieldWeight: documentRef.getElementById("physicalIntensityFieldWeight"),
    physicalIntensityFieldRadius: documentRef.getElementById("physicalIntensityFieldRadius"),
    physicalIntensityFieldClearBtn: documentRef.getElementById("physicalIntensityFieldClearBtn"),
    physicalIntensityFieldPointCount: documentRef.getElementById("physicalIntensityFieldPointCount"),
    physicalIntensityFieldPointList: documentRef.getElementById("physicalIntensityFieldPointList"),
    physicalOpacityValue: documentRef.getElementById("physicalOpacityValue"),
    physicalAtlasIntensityValue: documentRef.getElementById("physicalAtlasIntensityValue"),
    physicalRainforestEmphasisValue: documentRef.getElementById("physicalRainforestEmphasisValue"),
    physicalContourOpacityValue: documentRef.getElementById("physicalContourOpacityValue"),
    physicalContourMajorWidthValue: documentRef.getElementById("physicalContourMajorWidthValue"),
    physicalContourMinorWidthValue: documentRef.getElementById("physicalContourMinorWidthValue"),
    physicalContourMajorIntervalValue: documentRef.getElementById("physicalContourMajorIntervalValue"),
    physicalContourMinorIntervalValue: documentRef.getElementById("physicalContourMinorIntervalValue"),
    physicalContourMajorLowReliefCutoffValue: documentRef.getElementById("physicalContourMajorLowReliefCutoffValue"),
    physicalContourMinorLowReliefCutoffValue: documentRef.getElementById("physicalContourMinorLowReliefCutoffValue"),
    physicalIntensityFieldWeightValue: documentRef.getElementById("physicalIntensityFieldWeightValue"),
    physicalIntensityFieldRadiusValue: documentRef.getElementById("physicalIntensityFieldRadiusValue"),
    physicalClassToggles,
  };
}

export function createAppearancePhysicalOwner({
  runtimeState,
  t = (value) => value,
  clamp = clampNumber,
  renderDirty = () => {},
  normalizeOceanFillColor = (value) => value,
  documentRef = globalThis.document,
  captureHistoryState = captureRuntimeHistoryState,
  pushHistoryEntry = pushRuntimeHistoryEntry,
} = {}) {
  const nodes = collectPhysicalNodes(documentRef);

  const syncPhysicalConfig = () => {
    const normalized = normalizePhysicalStyleConfig(runtimeState.styleConfig.physical);
    return setAppearanceStyleGroupState(runtimeState, "physical", {
      ...normalized,
      contourColor: normalizeOceanFillColor(normalized.contourColor || "#6b5947"),
    });
  };

  const intensityFieldEditor = createIntensityFieldEditorSection({
    runtimeState,
    nodes: {
      channelInputs: {
        physicalAtlas: nodes.physicalIntensityFieldChannelAtlas,
        physicalContour: nodes.physicalIntensityFieldChannelContour,
      },
      enabled: nodes.physicalIntensityFieldEnabled,
      toolToggleBtn: nodes.physicalIntensityFieldToolToggleBtn,
      paintBtn: nodes.physicalIntensityFieldPaintBtn,
      eraseBtn: nodes.physicalIntensityFieldEraseBtn,
      pointsBtn: nodes.physicalIntensityFieldPointsBtn,
      weight: nodes.physicalIntensityFieldWeight,
      radius: nodes.physicalIntensityFieldRadius,
      clearBtn: nodes.physicalIntensityFieldClearBtn,
      pointCount: nodes.physicalIntensityFieldPointCount,
      pointList: nodes.physicalIntensityFieldPointList,
      weightValue: nodes.physicalIntensityFieldWeightValue,
      radiusValue: nodes.physicalIntensityFieldRadiusValue,
    },
    channelIds: ["physicalAtlas", "physicalContour"],
    defaultChannelId: "physicalAtlas",
    historyLabel: "Physical intensity field",
    reasonPrefix: "physical-intensity-field",
    t,
    clamp,
    renderDirty,
    captureHistoryState,
    pushHistoryEntry,
    documentRef,
  });
  const renderPhysicalIntensityFieldUi = () => intensityFieldEditor.render();

  const applyPhysicalPresetConfig = (preset, { preserveMode = true } = {}) => {
    const current = syncPhysicalConfig();
    const resolvedPreset = normalizePhysicalPreset(preset);
    const next = createPhysicalStyleConfigForPreset(resolvedPreset);
    return setAppearanceStyleGroupState(runtimeState, "physical", normalizePhysicalStyleConfig({
      ...next,
      mode: preserveMode ? current.mode : next.mode,
      contourColor: current.contourColor || next.contourColor,
    }));
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

  const renderPhysicalUi = () => {
    if (nodes.togglePhysical) nodes.togglePhysical.checked = !!runtimeState.showPhysical;
    const physicalConfig = syncPhysicalConfig();
    const activePhysicalPreset = normalizePhysicalPreset(physicalConfig.preset || "balanced");
    if (nodes.physicalPreset) nodes.physicalPreset.value = activePhysicalPreset;
    if (nodes.physicalPresetHint) nodes.physicalPresetHint.textContent = getPhysicalPresetHint(activePhysicalPreset);
    if (nodes.physicalMode) nodes.physicalMode.value = physicalConfig.mode;
    if (nodes.physicalOpacity) nodes.physicalOpacity.value = String(Math.round(physicalConfig.opacity * 100));
    if (nodes.physicalOpacityValue) nodes.physicalOpacityValue.textContent = `${Math.round(physicalConfig.opacity * 100)}%`;
    if (nodes.physicalAtlasIntensity) nodes.physicalAtlasIntensity.value = String(Math.round(physicalConfig.atlasIntensity * 100));
    if (nodes.physicalAtlasIntensityValue) nodes.physicalAtlasIntensityValue.textContent = `${Math.round(physicalConfig.atlasIntensity * 100)}%`;
    if (nodes.physicalRainforestEmphasis) nodes.physicalRainforestEmphasis.value = String(Math.round(physicalConfig.rainforestEmphasis * 100));
    if (nodes.physicalRainforestEmphasisValue) nodes.physicalRainforestEmphasisValue.textContent = `${Math.round(physicalConfig.rainforestEmphasis * 100)}%`;
    if (nodes.physicalContourColor) nodes.physicalContourColor.value = physicalConfig.contourColor;
    if (nodes.physicalContourOpacity) nodes.physicalContourOpacity.value = String(Math.round(physicalConfig.contourOpacity * 100));
    if (nodes.physicalContourOpacityValue) nodes.physicalContourOpacityValue.textContent = `${Math.round(physicalConfig.contourOpacity * 100)}%`;
    if (nodes.physicalMinorContours) nodes.physicalMinorContours.checked = !!physicalConfig.contourMinorVisible;
    if (nodes.physicalContourMajorWidth) nodes.physicalContourMajorWidth.value = String(Number(physicalConfig.contourMajorWidth).toFixed(2));
    if (nodes.physicalContourMajorWidthValue) nodes.physicalContourMajorWidthValue.textContent = Number(physicalConfig.contourMajorWidth).toFixed(2);
    if (nodes.physicalContourMinorWidth) nodes.physicalContourMinorWidth.value = String(Number(physicalConfig.contourMinorWidth).toFixed(2));
    if (nodes.physicalContourMinorWidthValue) nodes.physicalContourMinorWidthValue.textContent = Number(physicalConfig.contourMinorWidth).toFixed(2);
    if (nodes.physicalContourMajorInterval) nodes.physicalContourMajorInterval.value = String(Math.round(physicalConfig.contourMajorIntervalM));
    if (nodes.physicalContourMajorIntervalValue) nodes.physicalContourMajorIntervalValue.textContent = `${Math.round(physicalConfig.contourMajorIntervalM)}`;
    if (nodes.physicalContourMinorInterval) nodes.physicalContourMinorInterval.value = String(Math.round(physicalConfig.contourMinorIntervalM));
    if (nodes.physicalContourMinorIntervalValue) nodes.physicalContourMinorIntervalValue.textContent = `${Math.round(physicalConfig.contourMinorIntervalM)}`;
    if (nodes.physicalContourMajorLowReliefCutoff) nodes.physicalContourMajorLowReliefCutoff.value = String(Math.round(physicalConfig.contourMajorLowReliefCutoffM));
    if (nodes.physicalContourMajorLowReliefCutoffValue) nodes.physicalContourMajorLowReliefCutoffValue.textContent = `${Math.round(physicalConfig.contourMajorLowReliefCutoffM)}`;
    if (nodes.physicalContourMinorLowReliefCutoff) nodes.physicalContourMinorLowReliefCutoff.value = String(Math.round(physicalConfig.contourMinorLowReliefCutoffM));
    if (nodes.physicalContourMinorLowReliefCutoffValue) nodes.physicalContourMinorLowReliefCutoffValue.textContent = `${Math.round(physicalConfig.contourMinorLowReliefCutoffM)}`;
    if (nodes.physicalBlendMode) nodes.physicalBlendMode.value = physicalConfig.blendMode;
    renderPhysicalIntensityFieldUi();
    Object.entries(nodes.physicalClassToggles).forEach(([key, element]) => {
      if (element) element.checked = physicalConfig.atlasClassVisibility?.[key] !== false;
    });
    return physicalConfig;
  };

  const bindPhysicalInput = (element, mutate, reason) => {
    if (!element || element.dataset.bound === "true") return;
    element.addEventListener("input", (event) => {
      const cfg = syncPhysicalConfig();
      const patch = mutate(cfg, event);
      if (patch && typeof patch === "object") {
        patchAppearanceStyleGroupState(runtimeState, "physical", patch);
      }
      renderDirty(reason);
    });
    element.dataset.bound = "true";
  };

  const bindPhysicalChange = (element, mutate, reason) => {
    if (!element || element.dataset.bound === "true") return;
    element.addEventListener("change", (event) => {
      const cfg = syncPhysicalConfig();
      const patch = mutate(cfg, event);
      if (patch && typeof patch === "object") {
        patchAppearanceStyleGroupState(runtimeState, "physical", patch);
      }
      if (reason === "physical-mode" && runtimeState.showPhysical
        && typeof runtimeState.ensureContextLayerDataFn === "function") {
        void callCompatRuntimeHook(runtimeState, "ensureContextLayerDataFn", getPhysicalContextLayerRequests(runtimeState.styleConfig.physical), { reason, renderNow: true });
      }
      renderDirty(reason);
    });
    element.dataset.bound = "true";
  };

  const bindEvents = () => {
    if (nodes.togglePhysical && nodes.togglePhysical.dataset.bound !== "true") {
      nodes.togglePhysical.checked = !!runtimeState.showPhysical;
      nodes.togglePhysical.addEventListener("change", (event) => {
        setAppearanceVisibilityState(runtimeState, "showPhysical", event.target.checked);
        if (runtimeState.showPhysical && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void callCompatRuntimeHook(runtimeState, "ensureContextLayerDataFn", getPhysicalContextLayerRequests(runtimeState.styleConfig?.physical), { reason: "toolbar-toggle", renderNow: true });
        }
        renderDirty("toggle-physical");
      });
      nodes.togglePhysical.dataset.bound = "true";
    }

    if (nodes.physicalPreset && nodes.physicalPreset.dataset.bound !== "true") {
      nodes.physicalPreset.addEventListener("change", (event) => {
        applyPhysicalPresetConfig(event.target.value || "balanced");
        renderPhysicalUi();
        renderDirty("physical-preset-select");
      });
      nodes.physicalPreset.dataset.bound = "true";
    }

    bindPhysicalChange(nodes.physicalMode, (_cfg, event) => ({ mode: String(event.target.value || "atlas_only") }), "physical-mode");
    bindPhysicalInput(nodes.physicalOpacity, (_cfg, event) => {
      const value = Number(event.target.value);
      const opacity = clamp(Number.isFinite(value) ? value / 100 : 0.5, 0, 1);
      if (nodes.physicalOpacityValue) nodes.physicalOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
      return { opacity };
    }, "physical-opacity");
    bindPhysicalInput(nodes.physicalAtlasIntensity, (_cfg, event) => {
      const value = Number(event.target.value);
      const atlasIntensity = clamp(Number.isFinite(value) ? value / 100 : 0.9, 0.2, 1.4);
      if (nodes.physicalAtlasIntensityValue) nodes.physicalAtlasIntensityValue.textContent = `${Math.round(atlasIntensity * 100)}%`;
      return { atlasIntensity };
    }, "physical-atlas-intensity");
    bindPhysicalInput(nodes.physicalRainforestEmphasis, (_cfg, event) => {
      const value = Number(event.target.value);
      const rainforestEmphasis = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0, 1);
      if (nodes.physicalRainforestEmphasisValue) nodes.physicalRainforestEmphasisValue.textContent = `${Math.round(rainforestEmphasis * 100)}%`;
      return { rainforestEmphasis };
    }, "physical-rainforest-emphasis");
    bindPhysicalInput(nodes.physicalContourColor, (_cfg, event) => ({ contourColor: normalizeOceanFillColor(event.target.value) }), "physical-contour-color");
    bindPhysicalInput(nodes.physicalContourOpacity, (_cfg, event) => {
      const value = Number(event.target.value);
      const contourOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.34, 0, 1);
      if (nodes.physicalContourOpacityValue) nodes.physicalContourOpacityValue.textContent = `${Math.round(contourOpacity * 100)}%`;
      return { contourOpacity };
    }, "physical-contour-opacity");
    bindPhysicalChange(nodes.physicalMinorContours, (_cfg, event) => ({ contourMinorVisible: !!event.target.checked }), "physical-contour-minor-toggle");
    bindPhysicalInput(nodes.physicalContourMajorWidth, (_cfg, event) => {
      const value = Number(event.target.value);
      const contourMajorWidth = clamp(Number.isFinite(value) ? value : 0.8, 0.2, 3);
      if (nodes.physicalContourMajorWidthValue) nodes.physicalContourMajorWidthValue.textContent = Number(contourMajorWidth).toFixed(2);
      return { contourMajorWidth };
    }, "physical-contour-major-width");
    bindPhysicalInput(nodes.physicalContourMinorWidth, (_cfg, event) => {
      const value = Number(event.target.value);
      const contourMinorWidth = clamp(Number.isFinite(value) ? value : 0.45, 0.1, 2);
      if (nodes.physicalContourMinorWidthValue) nodes.physicalContourMinorWidthValue.textContent = Number(contourMinorWidth).toFixed(2);
      return { contourMinorWidth };
    }, "physical-contour-minor-width");
    bindPhysicalInput(nodes.physicalContourMajorInterval, (_cfg, event) => {
      const value = Number(event.target.value);
      const contourMajorIntervalM = clamp(Number.isFinite(value) ? Math.round(value / 500) * 500 : 500, 500, 2000);
      if (nodes.physicalContourMajorIntervalValue) nodes.physicalContourMajorIntervalValue.textContent = `${Math.round(contourMajorIntervalM)}`;
      return { contourMajorIntervalM };
    }, "physical-contour-major-interval");
    bindPhysicalInput(nodes.physicalContourMinorInterval, (_cfg, event) => {
      const value = Number(event.target.value);
      const contourMinorIntervalM = clamp(Number.isFinite(value) ? Math.round(value / 100) * 100 : 100, 100, 1000);
      if (nodes.physicalContourMinorIntervalValue) nodes.physicalContourMinorIntervalValue.textContent = `${Math.round(contourMinorIntervalM)}`;
      return { contourMinorIntervalM };
    }, "physical-contour-minor-interval");
    bindPhysicalInput(nodes.physicalContourMajorLowReliefCutoff, (_cfg, event) => {
      const value = Number(event.target.value);
      const contourMajorLowReliefCutoffM = clamp(Number.isFinite(value) ? Math.round(value) : 200, 0, 2000);
      if (nodes.physicalContourMajorLowReliefCutoffValue) nodes.physicalContourMajorLowReliefCutoffValue.textContent = `${Math.round(contourMajorLowReliefCutoffM)}`;
      return { contourMajorLowReliefCutoffM };
    }, "physical-contour-major-low-relief-cutoff");
    bindPhysicalInput(nodes.physicalContourMinorLowReliefCutoff, (_cfg, event) => {
      const value = Number(event.target.value);
      const contourMinorLowReliefCutoffM = clamp(Number.isFinite(value) ? Math.round(value) : 280, 0, 2000);
      if (nodes.physicalContourMinorLowReliefCutoffValue) nodes.physicalContourMinorLowReliefCutoffValue.textContent = `${Math.round(contourMinorLowReliefCutoffM)}`;
      return { contourMinorLowReliefCutoffM };
    }, "physical-contour-minor-low-relief-cutoff");
    bindPhysicalChange(nodes.physicalBlendMode, (_cfg, event) => ({ blendMode: String(event.target.value || "source-over") }), "physical-blend");

    intensityFieldEditor.bindEvents();

    Object.entries(nodes.physicalClassToggles).forEach(([key, element]) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("change", (event) => {
        const cfg = syncPhysicalConfig();
        patchAppearanceStyleGroupState(runtimeState, "physical", {
          atlasClassVisibility: {
            ...(cfg.atlasClassVisibility || {}),
            [key]: !!event.target.checked,
          },
        });
        renderDirty(`physical-class-${key}`);
      });
      element.dataset.bound = "true";
    });
  };

  return {
    applyPhysicalPresetConfig,
    bindEvents,
    getPhysicalPresetHint,
    renderPhysicalIntensityFieldUi,
    renderPhysicalUi,
    syncPhysicalIntensityField: intensityFieldEditor.getSelectedChannel,
    syncPhysicalConfig,
  };
}
import { callCompatRuntimeHook } from "../../core/state/index.js";
