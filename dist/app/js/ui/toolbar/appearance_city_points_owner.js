import { normalizeCityLayerStyleConfig } from "../../core/state.js";
import {
  patchAppearanceStyleGroupState,
  setAppearanceStyleGroupState,
} from "../../core/state/actions/appearance_actions.js";
import { setAppearanceVisibilityState } from "../../core/state/actions/appearance_visibility_actions.js";
import {
  CITY_POINTS_THEME_OPTIONS,
  formatCityPointsDensityValue,
  getCityPointsLabelDensityHint,
  getCityPointsThemeHint,
  getCityPointsThemeLabel,
  getCityPointsThemeMeta,
  getCityPointsThemeStyle,
} from "./appearance_city_points_descriptor.js";

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildCityPointsThemePatch(themeStyle) {
  // Palette changes preserve the user's density, label and size choices.
  return { color: themeStyle.color, capitalColor: themeStyle.capitalColor };
}

function collectCityPointsNodes(documentRef) {
  return {
    toggleCityPoints: documentRef.getElementById("toggleCityPoints"),
    cityPointsDensityPreset: documentRef.getElementById("cityPointsDensityPreset"),
    cityPointsMinRank: documentRef.getElementById("cityPointsMinRank"),
    cityPointsHierarchyHint: documentRef.getElementById("cityPointsHierarchyHint"),
    cityPointsTheme: documentRef.getElementById("cityPointsTheme"),
    cityPointsThemeHint: documentRef.getElementById("cityPointsThemeHint"),
    cityPointsMarkerScale: documentRef.getElementById("cityPointsMarkerScale"),
    cityPointsMarkerDensity: documentRef.getElementById("cityPointsMarkerDensity"),
    cityPointsMarkerDensityHint: documentRef.getElementById("cityPointsMarkerDensityHint"),
    cityPointsLabelDensity: documentRef.getElementById("cityPointsLabelDensity"),
    cityPointsLabelDensityHint: documentRef.getElementById("cityPointsLabelDensityHint"),
    cityPointsColor: documentRef.getElementById("cityPointsColor"),
    cityPointsCapitalColor: documentRef.getElementById("cityPointsCapitalColor"),
    cityPointsOpacity: documentRef.getElementById("cityPointsOpacity"),
    cityPointLabelsEnabled: documentRef.getElementById("cityPointLabelsEnabled"),
    cityPointsLabelSize: documentRef.getElementById("cityPointsLabelSize"),
    cityCapitalOverlayEnabled: documentRef.getElementById("cityCapitalOverlayEnabled"),
    cityPointsMarkerScaleValue: documentRef.getElementById("cityPointsMarkerScaleValue"),
    cityPointsMarkerDensityValue: documentRef.getElementById("cityPointsMarkerDensityValue"),
    cityPointsOpacityValue: documentRef.getElementById("cityPointsOpacityValue"),
    cityPointsLabelSizeValue: documentRef.getElementById("cityPointsLabelSizeValue"),
  };
}

export function createAppearanceCityPointsOwner({
  runtimeState,
  t = (value) => value,
  clamp = clampNumber,
  renderDirty = () => {},
  normalizeOceanFillColor = (value) => value,
  ensureActiveScenarioOptionalLayerLoaded = () => {},
  documentRef = globalThis.document,
} = {}) {
  const nodes = collectCityPointsNodes(documentRef);

  const persistCityViewSettings = () => {
    runtimeState.persistViewSettingsFn?.();
  };

  const syncCityPointsConfig = () => {
    return setAppearanceStyleGroupState(
      runtimeState,
      "cityPoints",
      normalizeCityLayerStyleConfig(runtimeState.styleConfig.cityPoints),
    );
  };

  const ensureCityPointsThemeOptions = () => {
    if (!nodes.cityPointsTheme) return;
    const normalizedExisting = Array.from(nodes.cityPointsTheme.options || []).map((option) => String(option.value || ""));
    const expected = CITY_POINTS_THEME_OPTIONS.map((option) => option.value);
    const matchesExisting =
      normalizedExisting.length === expected.length
      && normalizedExisting.every((value, index) => value === expected[index]);
    if (matchesExisting) {
      // 语言切换时 option value 顺序保持稳定，只需要刷新 id/text；
      // 重建节点可能扰动选择状态和辅助技术焦点。
      Array.from(nodes.cityPointsTheme.options || []).forEach((optionNode, index) => {
        const meta = CITY_POINTS_THEME_OPTIONS[index];
        if (!meta) return;
        optionNode.id = meta.labelKey;
        optionNode.textContent = getCityPointsThemeLabel(meta.value, t);
      });
      return;
    }
    const fragment = documentRef.createDocumentFragment();
    CITY_POINTS_THEME_OPTIONS.forEach((optionMeta) => {
      const option = documentRef.createElement("option");
      option.value = optionMeta.value;
      option.id = optionMeta.labelKey;
      option.textContent = getCityPointsThemeLabel(optionMeta.value, t);
      fragment.appendChild(option);
    });
    nodes.cityPointsTheme.replaceChildren(fragment);
  };

  const renderCityPointsUi = () => {
    if (nodes.toggleCityPoints) nodes.toggleCityPoints.checked = !!runtimeState.showCityPoints;
    const cityPointsConfig = syncCityPointsConfig();
    if (nodes.cityPointsDensityPreset) nodes.cityPointsDensityPreset.value = cityPointsConfig.densityPreset;
    if (nodes.cityPointsMinRank) nodes.cityPointsMinRank.value = cityPointsConfig.minSettlementRank;
    if (nodes.cityPointsHierarchyHint) nodes.cityPointsHierarchyHint.textContent = runtimeState.currentLanguage === "zh"
      ? "首都是独立标记。历史剧本沿用已知等级，可由剧本单独覆盖。"
      : "Capitals have a separate symbol. Historical scenarios retain known ranks and can override them.";
    ensureCityPointsThemeOptions();
    if (nodes.cityPointsTheme) nodes.cityPointsTheme.value = String(cityPointsConfig.theme || "classic_graphite");
    if (nodes.cityPointsThemeHint) {
      nodes.cityPointsThemeHint.textContent = getCityPointsThemeHint(
        cityPointsConfig.theme || "classic_graphite",
        runtimeState.currentLanguage,
      );
    }
    if (nodes.cityPointsMarkerScale) nodes.cityPointsMarkerScale.value = Number(cityPointsConfig.markerScale || 1).toFixed(2);
    if (nodes.cityPointsMarkerScaleValue) nodes.cityPointsMarkerScaleValue.textContent = `${Number(cityPointsConfig.markerScale || 1).toFixed(2)}x`;
    if (nodes.cityPointsMarkerDensity) nodes.cityPointsMarkerDensity.value = Number(cityPointsConfig.markerDensity || 1).toFixed(2);
    if (nodes.cityPointsMarkerDensityValue) nodes.cityPointsMarkerDensityValue.textContent = formatCityPointsDensityValue(cityPointsConfig.markerDensity || 1);
    if (nodes.cityPointsMarkerDensityHint) {
      nodes.cityPointsMarkerDensityHint.textContent = runtimeState.currentLanguage === "zh"
        ? "控制每个缩放阶段最多允许出现多少个城市点。"
        : "Controls how many city markers can surface at each zoom stage.";
    }
    if (nodes.cityPointsLabelDensity) nodes.cityPointsLabelDensity.value = String(cityPointsConfig.labelDensity || "balanced");
    if (nodes.cityPointsLabelDensityHint) {
      nodes.cityPointsLabelDensityHint.textContent = getCityPointsLabelDensityHint(
        cityPointsConfig.labelDensity || "balanced",
        runtimeState.currentLanguage,
      );
    }
    if (nodes.cityPointsColor) nodes.cityPointsColor.value = normalizeOceanFillColor(cityPointsConfig.color || "#20262e");
    if (nodes.cityPointsCapitalColor) nodes.cityPointsCapitalColor.value = normalizeOceanFillColor(cityPointsConfig.capitalColor || "#f0b84f");
    if (nodes.cityPointsOpacity) nodes.cityPointsOpacity.value = String(Math.round(cityPointsConfig.opacity * 100));
    if (nodes.cityPointsOpacityValue) nodes.cityPointsOpacityValue.textContent = `${Math.round(cityPointsConfig.opacity * 100)}%`;
    if (nodes.cityPointLabelsEnabled) nodes.cityPointLabelsEnabled.checked = !!cityPointsConfig.showLabels;
    if (nodes.cityPointsLabelSize) nodes.cityPointsLabelSize.value = String(Math.round(cityPointsConfig.labelSize));
    if (nodes.cityPointsLabelSizeValue) nodes.cityPointsLabelSizeValue.textContent = `${Math.round(cityPointsConfig.labelSize)}px`;
    if (nodes.cityCapitalOverlayEnabled) nodes.cityCapitalOverlayEnabled.checked = !!cityPointsConfig.showCapitalOverlay;
    return cityPointsConfig;
  };

  const bindCityPointsControl = (
    element,
    mutate,
    reason,
    { events = ["input"], afterMutate = () => {} } = {},
  ) => {
    if (!element || element.dataset.bound === "true") return;
    events.forEach((eventName) => {
      element.addEventListener(eventName, (event) => {
        const cfg = syncCityPointsConfig();
        const patch = mutate(cfg, event);
        const nextConfig = patch && typeof patch === "object"
          ? patchAppearanceStyleGroupState(runtimeState, "cityPoints", patch)
          : cfg;
        afterMutate(nextConfig);
        persistCityViewSettings();
        renderDirty(reason);
      });
    });
    element.dataset.bound = "true";
  };

  const bindCityPointsInput = (element, mutate, reason, afterMutate = () => {}) =>
    bindCityPointsControl(element, mutate, reason, { events: ["input"], afterMutate });

  const bindCityPointsChange = (element, mutate, reason, afterMutate = () => {}) =>
    bindCityPointsControl(element, mutate, reason, { events: ["change"], afterMutate });

  const bindEvents = () => {
    if (nodes.toggleCityPoints && nodes.toggleCityPoints.dataset.bound !== "true") {
      nodes.toggleCityPoints.checked = !!runtimeState.showCityPoints;
      nodes.toggleCityPoints.addEventListener("change", (event) => {
        setAppearanceVisibilityState(runtimeState, "showCityPoints", event.target.checked);
        if (runtimeState.showCityPoints) {
          // 城市点开关同时触发基础城市数据和 scenario optional layer；
          // 前者给普通城市标记，后者给剧本覆盖和首都提示。
          if (typeof runtimeState.ensureBaseCityDataFn === "function") {
            void runtimeState.ensureBaseCityDataFn({ reason: "toolbar-toggle", renderNow: true });
          }
          void ensureActiveScenarioOptionalLayerLoaded("cities", { renderNow: true });
        }
        persistCityViewSettings();
        renderDirty("toggle-city-points");
      });
      nodes.toggleCityPoints.dataset.bound = "true";
    }

    bindCityPointsChange(nodes.cityPointsDensityPreset, (_cfg, event) => {
      const densityPreset = event.target.value;
      return { densityPreset, labelDensity: { compact: "sparse", balanced: "balanced", detailed: "dense" }[densityPreset] || "balanced" };
    }, "city-points-density-preset", () => renderCityPointsUi());
    bindCityPointsChange(nodes.cityPointsMinRank, (_cfg, event) => ({
      minSettlementRank: event.target.value,
    }), "city-points-min-rank");

    bindCityPointsInput(nodes.cityPointsColor, (_cfg, event) => ({
      color: normalizeOceanFillColor(event.target.value),
    }), "city-points-color");

    bindCityPointsChange(nodes.cityPointsTheme, (cfg, event) => {
      const theme = getCityPointsThemeMeta(event.target.value || "classic_graphite").value;
      const themeStyle = getCityPointsThemeStyle(theme);
      // 颜色主题与密度、符号大小和文字设置相互独立。
      return { theme, ...buildCityPointsThemePatch(themeStyle, clamp) };
    }, "city-points-theme", () => renderCityPointsUi());

    bindCityPointsInput(nodes.cityPointsMarkerScale, (_cfg, event) => {
      const value = Number(event.target.value);
      const markerScale = clamp(Number.isFinite(value) ? value : 1, 0.75, 2.5);
      if (nodes.cityPointsMarkerScaleValue) nodes.cityPointsMarkerScaleValue.textContent = `${Number(markerScale).toFixed(2)}x`;
      return { markerScale };
    }, "city-points-marker-scale");

    bindCityPointsControl(nodes.cityPointsMarkerDensity, (_cfg, event) => {
        const value = Number(event.target.value);
        const markerDensity = clamp(Number.isFinite(value) ? value : 1, 0.5, 2);
        if (nodes.cityPointsMarkerDensityValue) nodes.cityPointsMarkerDensityValue.textContent = formatCityPointsDensityValue(markerDensity);
        return { markerDensity };
    }, "city-points-marker-density", { events: ["input", "change"] });

    bindCityPointsChange(nodes.cityPointsLabelDensity, (_cfg, event) => {
      const labelDensity = String(event.target.value || "balanced");
      if (nodes.cityPointsLabelDensityHint) {
        nodes.cityPointsLabelDensityHint.textContent = getCityPointsLabelDensityHint(labelDensity, runtimeState.currentLanguage);
      }
      return { labelDensity };
    }, "city-points-label-density");

    bindCityPointsInput(nodes.cityPointsCapitalColor, (_cfg, event) => ({
      capitalColor: normalizeOceanFillColor(event.target.value),
    }), "city-points-capital-color");

    bindCityPointsInput(nodes.cityPointsOpacity, (_cfg, event) => {
      const value = Number(event.target.value);
      const opacity = clamp(Number.isFinite(value) ? value / 100 : 0.92, 0, 1);
      if (nodes.cityPointsOpacityValue) nodes.cityPointsOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
      return { opacity };
    }, "city-points-opacity");

    bindCityPointsChange(nodes.cityPointLabelsEnabled, (_cfg, event) => ({
      showLabels: !!event.target.checked,
    }), "city-points-labels-toggle");

    bindCityPointsInput(nodes.cityPointsLabelSize, (_cfg, event) => {
      const value = Number(event.target.value);
      const labelSize = clamp(Math.round(Number.isFinite(value) ? value : 12), 8, 24);
      if (nodes.cityPointsLabelSizeValue) nodes.cityPointsLabelSizeValue.textContent = `${Math.round(labelSize)}px`;
      return { labelSize };
    }, "city-points-label-size");

    bindCityPointsChange(nodes.cityCapitalOverlayEnabled, (_cfg, event) => ({
      showCapitalOverlay: !!event.target.checked,
    }), "city-points-capital-overlay");
  };

  return {
    bindEvents,
    ensureCityPointsThemeOptions,
    renderCityPointsUi,
    syncCityPointsConfig,
  };
}
