import { normalizeLakeStyleConfig } from "../../core/state.js";
import { captureHistoryState, pushHistoryEntry } from "../../core/history_manager.js";

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
}) {
  let pendingOceanVisualFrame = 0;
  let pendingOceanVisualReason = "";
  const pendingOceanVisualInvalidations = new Map();
  const lakeStylePaths = [
    "styleConfig.lakes.linkedToOcean",
    "styleConfig.lakes.fillColor",
  ];
  let lakeHistoryBefore = null;

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

  const renderOceanLakeControlsUi = () => {
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
  };

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

  const bindEvents = () => {
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
        renderOceanBathymetryDebugUi();
        applyOceanVisualUpdateNow(invalidateOceanVisualState, "ocean-style");
      });
      oceanStyleSelect.dataset.bound = "true";
    }

    if (oceanAdvancedStylesToggle && oceanAdvancedStylesToggle.dataset.bound !== "true") {
      oceanAdvancedStylesToggle.checked = oceanAdvancedStylesEnabled();
      oceanAdvancedStylesToggle.addEventListener("change", (event) => {
        state.styleConfig.ocean.experimentalAdvancedStyles = !!event.target.checked;
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
