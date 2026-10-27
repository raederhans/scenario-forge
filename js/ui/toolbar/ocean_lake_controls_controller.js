import { normalizeLakeStyleConfig } from "../../core/state.js";
import { captureHistoryState, pushHistoryEntry } from "../../core/history_manager.js";
import {
  SCENARIO_PRESENTATION_FEATURES,
  scenarioHasPresentationFeature,
} from "../../core/scenario/presentation_hint_helpers.js";
import {
  createIntensityFieldEditorNodes,
  createIntensityFieldEditorSection,
} from "./intensity_field_editor_section.js";

/**
 * Owns ocean / lake appearance controls.
 *
 * toolbar.js 继续保留更高层 facade：
 * - startup 阶段的 ocean / lake styleConfig 归一
 * - workspace status 刷新链
 * - toolbar inputs 总刷新入口
 * - auto-fill 工作流里的 ocean color handoff
 */
export function createOceanLakeControlsController({
  state,
  t,
  clamp,
  renderDirty,
  normalizeOceanFillColor,
  normalizeOceanPreset,
  advancedPresets,
  getBathymetryPresetStyleDefaults,
  invalidateOceanBackgroundVisualState,
  invalidateOceanCoastalAccentVisualState,
  invalidateOceanVisualState,
  invalidateOceanWaterInteractionVisualState,
  oceanFillColor,
  oceanRegionNamesToggle,
  lakeLinkToOcean,
  lakeFillColor,
  lakeOutlineToggle,
  oceanCoastalAccentRow,
  oceanCoastalAccentToggle,
  oceanAdvancedStylesToggle,
  oceanStyleSelect,
  oceanTextureOpacity,
  oceanTextureScale,
  oceanContourStrength,
  oceanBathymetryDebugDetails,
  oceanBathymetrySourceValue,
  oceanBathymetryBandsValue,
  oceanBathymetryContoursValue,
  oceanTextureOpacityValue,
  oceanTextureScaleValue,
  oceanContourStrengthValue,
  requestLayerStatusRefresh = () => {},
  documentRef = globalThis.document,
}) {
  let pendingOceanVisualFrame = 0;
  let pendingOceanVisualReason = "";
  const pendingOceanVisualInvalidations = new Map();
  const lakeStylePaths = [
    "lakes.linkedToOcean",
    "lakes.fillColor",
    "lakes.outlineEnabled",
  ];
  const oceanRegionNamesStylePaths = ["ocean.showRegionNames"];
  let lakeHistoryBefore = null;
  const oceanDepthFieldEditor = createIntensityFieldEditorSection({
    runtimeState: state,
    nodes: createIntensityFieldEditorNodes(documentRef, {
      prefix: "oceanDepthField",
    }),
    channelIds: ["oceanDepth"],
    defaultChannelId: "oceanDepth",
    historyLabel: "Ocean depth field",
    reasonPrefix: "ocean-depth-field",
    t,
    clamp,
    renderDirty,
    captureHistoryState,
    pushHistoryEntry,
    documentRef,
  });

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

  const syncLakeConfig = () => {
    state.styleConfig.lakes = normalizeLakeStyleConfig(state.styleConfig.lakes);
    return state.styleConfig.lakes;
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

  const syncOceanPresetControlValues = () => {
    if (oceanStyleSelect) {
      oceanStyleSelect.value = state.styleConfig.ocean.preset || "bathymetry_soft";
    }
    if (oceanTextureOpacity) {
      oceanTextureOpacity.value = String(Math.round(clamp(state.styleConfig.ocean.opacity ?? 0.9, 0, 1) * 100));
    }
    if (oceanTextureOpacityValue) {
      oceanTextureOpacityValue.textContent = `${Math.round(clamp(state.styleConfig.ocean.opacity ?? 0.9, 0, 1) * 100)}%`;
    }
    if (oceanTextureScale) {
      oceanTextureScale.value = String(Math.round(clamp(state.styleConfig.ocean.scale ?? 1.25, 0.6, 2.4) * 100));
    }
    if (oceanTextureScaleValue) {
      oceanTextureScaleValue.textContent = `${clamp(state.styleConfig.ocean.scale ?? 1.25, 0.6, 2.4).toFixed(2)}x`;
    }
    if (oceanContourStrength) {
      oceanContourStrength.value = String(Math.round(clamp(state.styleConfig.ocean.contourStrength ?? 0, 0, 1) * 100));
    }
    if (oceanContourStrengthValue) {
      oceanContourStrengthValue.textContent = `${Math.round(clamp(state.styleConfig.ocean.contourStrength ?? 0, 0, 1) * 100)}%`;
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
    if (lakeOutlineToggle) {
      lakeOutlineToggle.checked = lakeConfig.outlineEnabled;
    }
  };

  const oceanAdvancedStylesEnabled = () => state.styleConfig.ocean.experimentalAdvancedStyles === true;
  const hasCoastalAccentFeature = () => scenarioHasPresentationFeature(
    state.activeScenarioManifest,
    SCENARIO_PRESENTATION_FEATURES.COASTAL_ACCENT
  );

  const renderOceanAdvancedStylesUi = () => {
    const enabled = oceanAdvancedStylesEnabled();
    const selectDisabledTitle = t("Enable Bathymetry to use depth presets.", "ui");
    const sliderDisabledTitle = t("Select a bathymetry style to adjust these controls.", "ui");
    if (!enabled && advancedPresets.has(state.styleConfig.ocean.preset)) {
      state.styleConfig.ocean.preset = "flat";
    }
    if (oceanAdvancedStylesToggle) {
      oceanAdvancedStylesToggle.checked = enabled;
    }
    if (oceanStyleSelect) {
      Array.from(oceanStyleSelect.options).forEach((option) => {
        if (advancedPresets.has(option.value)) {
          option.disabled = !enabled;
        }
      });
      oceanStyleSelect.value = state.styleConfig.ocean.preset || "bathymetry_soft";
      oceanStyleSelect.title = enabled ? "" : selectDisabledTitle;
    }
    [
      oceanTextureOpacity,
      oceanTextureScale,
      oceanContourStrength,
    ].forEach((control) => {
      if (!control) return;
      control.disabled = !enabled || state.styleConfig.ocean.preset === "flat";
      control.title = control.disabled ? sliderDisabledTitle : "";
    });
    if (oceanBathymetryDebugDetails) {
      oceanBathymetryDebugDetails.classList.toggle("opacity-60", !enabled);
    }
  };

  const renderOceanCoastalAccentUi = () => {
    const visible = hasCoastalAccentFeature();
    if (oceanCoastalAccentRow) {
      oceanCoastalAccentRow.classList.toggle("hidden", !visible);
    }
    if (oceanCoastalAccentToggle) {
      oceanCoastalAccentToggle.checked = state.styleConfig.ocean.coastalAccentEnabled !== false;
      oceanCoastalAccentToggle.disabled = !visible;
      oceanCoastalAccentToggle.title = visible ? "" : t("Available when the active scenario enables coastal accent.", "ui");
    }
  };

  const renderOceanBathymetryDebugUi = () => {
    if (oceanBathymetrySourceValue) {
      const bathymetrySourceLabel = String(state.activeBathymetrySource || "").trim();
      oceanBathymetrySourceValue.textContent = bathymetrySourceLabel || t("None", "ui");
    }
    if (oceanBathymetryBandsValue) {
      oceanBathymetryBandsValue.textContent = state.renderPerfMetrics?.bathymetryVisibility?.backend || t("None", "ui");
    }
    if (oceanBathymetryContoursValue) {
      oceanBathymetryContoursValue.textContent = String(state.renderPerfMetrics?.bathymetryLoad?.loadedTileCount
        ?? state.renderPerfMetrics?.bathymetryVisibility?.loadedTileCount ?? 0);
    }
    requestLayerStatusRefresh();
  };

  const renderOceanLakeControlsUi = () => {
    if (oceanFillColor) {
      oceanFillColor.value = normalizeOceanFillColor(state.styleConfig.ocean.fillColor);
    }
    if (oceanRegionNamesToggle) {
      oceanRegionNamesToggle.checked = state.styleConfig.ocean.showRegionNames === true;
    }
    if (oceanStyleSelect) {
      oceanStyleSelect.value = state.styleConfig.ocean.preset || "bathymetry_soft";
    }
    syncOceanPresetControlValues();
    renderOceanAdvancedStylesUi();
    renderOceanCoastalAccentUi();
    renderOceanBathymetryDebugUi();
    oceanDepthFieldEditor.render();
    renderLakeUi();
  };

  const bindEvents = () => {
    oceanDepthFieldEditor.bindEvents();

    if (oceanFillColor) {
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

    if (oceanRegionNamesToggle && oceanRegionNamesToggle.dataset.bound !== "true") {
      oceanRegionNamesToggle.addEventListener("change", (event) => {
        const before = captureHistoryState({ stylePaths: oceanRegionNamesStylePaths });
        state.styleConfig.ocean.showRegionNames = !!event.target.checked;
        pushHistoryEntry({
          kind: "ocean-region-names",
          before,
          after: captureHistoryState({ stylePaths: oceanRegionNamesStylePaths }),
        });
        renderDirty("ocean-region-names");
      });
      oceanRegionNamesToggle.dataset.bound = "true";
    }

    if (oceanStyleSelect && oceanStyleSelect.dataset.bound !== "true") {
      renderOceanAdvancedStylesUi();
      oceanStyleSelect.addEventListener("change", (event) => {
        const nextPreset = normalizeOceanPreset(event.target.value);
        if (!oceanAdvancedStylesEnabled() && advancedPresets.has(nextPreset)) {
          state.styleConfig.ocean.preset = "flat";
          event.target.value = "flat";
        } else {
          state.styleConfig.ocean.preset = nextPreset;
          applyBathymetryPresetDefaults(nextPreset);
        }
        syncOceanPresetControlValues();
        renderOceanAdvancedStylesUi();
        renderOceanBathymetryDebugUi();
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-style");
      });
      oceanStyleSelect.dataset.bound = "true";
    }

    if (oceanAdvancedStylesToggle && oceanAdvancedStylesToggle.dataset.bound !== "true") {
      oceanAdvancedStylesToggle.checked = oceanAdvancedStylesEnabled();
      oceanAdvancedStylesToggle.addEventListener("change", (event) => {
        state.styleConfig.ocean.experimentalAdvancedStyles = !!event.target.checked;
        if (state.styleConfig.ocean.experimentalAdvancedStyles && state.styleConfig.ocean.preset === "flat") {
          state.styleConfig.ocean.preset = "bathymetry_soft";
          applyBathymetryPresetDefaults("bathymetry_soft");
        }
        if (!state.styleConfig.ocean.experimentalAdvancedStyles && advancedPresets.has(state.styleConfig.ocean.preset)) {
          state.styleConfig.ocean.preset = "flat";
        }
        syncOceanPresetControlValues();
        renderOceanAdvancedStylesUi();
        renderOceanBathymetryDebugUi();
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-experimental-advanced-styles");
      });
      oceanAdvancedStylesToggle.dataset.bound = "true";
    }

    if (oceanCoastalAccentToggle && oceanCoastalAccentToggle.dataset.bound !== "true") {
      oceanCoastalAccentToggle.checked = state.styleConfig.ocean.coastalAccentEnabled !== false;
      oceanCoastalAccentToggle.addEventListener("change", (event) => {
        state.styleConfig.ocean.coastalAccentEnabled = !!event.target.checked;
        applyOceanVisualUpdateNow(invalidateOceanCoastalAccentVisualState, "ocean-coastal-accent");
      });
      oceanCoastalAccentToggle.dataset.bound = "true";
    }

    bindOceanVisualInput(oceanTextureOpacity, (event, commitNow) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.9, 0, 1);
      if (oceanTextureOpacityValue) {
        oceanTextureOpacityValue.textContent = `${event.target.value}%`;
      }
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-opacity");
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanVisualState, "ocean-opacity");
    });

    bindOceanVisualInput(oceanTextureScale, (event, commitNow) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.scale = clamp(Number.isFinite(value) ? value / 100 : 1.25, 0.6, 2.4);
      if (oceanTextureScaleValue) {
        oceanTextureScaleValue.textContent = `${state.styleConfig.ocean.scale.toFixed(2)}x`;
      }
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-scale");
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanVisualState, "ocean-scale");
    });

    bindOceanVisualInput(oceanContourStrength, (event, commitNow) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.contourStrength = clamp(Number.isFinite(value) ? value / 100 : 0, 0, 1);
      if (oceanContourStrengthValue) {
        oceanContourStrengthValue.textContent = `${event.target.value}%`;
      }
      if (commitNow) {
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-contour");
        return;
      }
      scheduleOceanVisualUpdate(invalidateOceanVisualState, "ocean-contour");
    });

    if (lakeLinkToOcean && lakeLinkToOcean.dataset.bound !== "true") {
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

    if (lakeOutlineToggle && lakeOutlineToggle.dataset.bound !== "true") {
      lakeOutlineToggle.addEventListener("change", (event) => {
        beginLakeHistoryCapture();
        syncLakeConfig().outlineEnabled = !!event.target.checked;
        applyOceanVisualUpdateNow(invalidateOceanWaterInteractionVisualState, "lake-outline");
        commitLakeHistory("lake-outline");
      });
      lakeOutlineToggle.dataset.bound = "true";
    }

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
  };

  const applyAutoFillOceanColor = () => {
    const oceanMeta = state.activePaletteOceanMeta || state.activePalettePack?.ocean || null;
    const nextFillColor = normalizeOceanFillColor(
      oceanMeta?.apply_on_autofill ? oceanMeta?.fill_color : "#aadaff"
    );
    if (oceanFillColor) {
      oceanFillColor.value = nextFillColor;
    }
    return nextFillColor;
  };

  return {
    applyAutoFillOceanColor,
    bindEvents,
    renderOceanCoastalAccentUi,
    renderOceanLakeControlsUi,
  };
}
