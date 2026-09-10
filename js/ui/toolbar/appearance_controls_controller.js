import {
  URBAN_ADAPTIVE_TINT_DEFAULT_COLOR,
  URBAN_MANUAL_DEFAULT_COLOR,
  normalizeUrbanStyleConfig,
} from "../../core/state.js";
import {
  patchAppearanceStyleGroupState,
  setAppearanceStyleGroupState,
} from "../../core/state/actions/appearance_actions.js";
import { setSelectedColorState } from "../../core/state/actions/appearance_selection_actions.js";
import { getPhysicalContextLayerRequests } from "../../core/state_defaults.js";
import { setAppearanceVisibilityState } from "../../core/state/actions/appearance_visibility_actions.js";
import { normalizeHexColor } from "../../core/palette_manager.js";
import { createTransportAppearanceController } from "./transport_appearance_controller.js";
import { createAppearanceParentBorderOwner } from "./appearance_parent_border_owner.js";
import { createAppearanceBorderOwner } from "./appearance_border_owner.js";
import { createAppearanceTextureOwner } from "./appearance_texture_owner.js";
import { createAppearanceCityPointsOwner } from "./appearance_city_points_owner.js";
import { createAppearancePhysicalOwner } from "./appearance_physical_owner.js";
import { createAppearanceReferenceOwner } from "./appearance_reference_owner.js";
import { createAppearanceRiversOwner } from "./appearance_rivers_owner.js";
import { createAppearancePresetsOwner } from "./appearance_presets_owner.js";
import {
  buildLayerStatusDiagnostics,
  resolveLayerStatusTone,
  sanitizeLayerStatusText,
} from "./layer_status_diagnostics.js";
import { createThematicLayerPreviewController } from "./thematic_layer_preview_controller.js";
import {
  getLayerPanelStatusAnchorMap,
} from "./layer_panel_contracts.js";
import {
  createToolbarDirtyRenderScheduler,
  normalizeRenderReason,
  shouldBatchToolbarRenderReason,
} from "./toolbar_render_scheduler.js";
import {
  getTransportOverviewDataLayerKeys,
  getTransportOverviewVisibilityField,
  listTransportOverviewCapabilityFamilyIds,
} from "../../core/transport_capability_registry.js";
import {
  captureHistoryState as captureRuntimeHistoryState,
  pushHistoryEntry as pushRuntimeHistoryEntry,
} from "../../core/history_manager.js";
import {
  createIntensityFieldEditorNodes,
  createIntensityFieldEditorSection,
} from "./intensity_field_editor_section.js";

/**
 * Owns the Appearance 面板 shell plus urban controls.
 * Transport, texture/day-night, city-points, physical, reference, rivers, and border details live in narrower owners.
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
  requestRender,
  ensureActiveScenarioOptionalLayerLoaded,
  normalizeOceanFillColor,
  updateSwatchUI,
  openSpecialZonePopover,
}) {
  const layerRenderScheduler = createToolbarDirtyRenderScheduler({ markDirty, requestRender });
  const renderLayerDirtyNow = (reason) => {
    const normalizedReason = normalizeRenderReason(reason);
    if (typeof markDirty === "function") markDirty(normalizedReason);
    if (typeof requestRender === "function") requestRender(normalizedReason);
    return normalizedReason;
  };
  const scheduleLayerRenderDirty = (reason) => (
    shouldBatchToolbarRenderReason(reason)
      ? layerRenderScheduler.schedule(reason)
      : renderLayerDirtyNow(reason)
  );
  const toggleUrban = document.getElementById("toggleUrban");
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
  const urbanOpacityValue = document.getElementById("urbanOpacityValue");
  const urbanAdaptiveStrengthValue = document.getElementById("urbanAdaptiveStrengthValue");
  const urbanStrokeOpacityValue = document.getElementById("urbanStrokeOpacityValue");
  const urbanToneBiasValue = document.getElementById("urbanToneBiasValue");
  const urbanAdaptiveTintStrengthValue = document.getElementById("urbanAdaptiveTintStrengthValue");
  const urbanMinAreaValue = document.getElementById("urbanMinAreaValue");
  const appearanceLayerFilter = document.getElementById("appearanceLayerFilter");
  const mapContentStack = document.getElementById("mapContentStack");
  const mapContentPanelSpecs = [
    {
      panel: document.getElementById("appearancePanelOcean"),
      tabId: "ocean",
      labelledBy: "mapContentTabOcean",
    },
    {
      panel: document.getElementById("appearancePanelDayNight"),
      tabId: "daynight",
      labelledBy: "mapContentTabDayNight",
    },
    {
      panel: document.getElementById("appearancePanelTexture"),
      tabId: "texture",
      labelledBy: "mapContentTabTexture",
    },
    {
      panel: document.getElementById("lblRiversPanel")?.closest(".appearance-mini-section"),
      tabId: "rivers",
      labelledBy: "mapContentTabRivers",
    },
  ];
  const moveAppearanceLayerPanel = (summaryId, targetStackId) => {
    const panel = document.getElementById(summaryId)?.closest(".appearance-mini-section");
    const targetStack = document.getElementById(targetStackId);
    if (!panel || !targetStack) return;
    panel.hidden = false;
    panel.classList.remove("hidden", "is-active");
    panel.setAttribute("data-promoted-layer-panel", "true");
    panel.removeAttribute("data-appearance-panel");
    panel.removeAttribute("role");
    if (panel instanceof HTMLDetailsElement) panel.open = true;
    targetStack.appendChild(panel);
  };
  const moveAppearanceLayerPanels = () => {
    moveAppearanceLayerPanel("lblPhysicalPanel", "appearancePhysicalStack");
    moveAppearanceLayerPanel("lblUrbanPanel", "appearanceUrbanStack");
    moveAppearanceLayerPanel("lblCityPointsPanel", "appearanceCityPointsStack");
  };
  const moveMapContentPanels = () => {
    if (!mapContentStack) return;
    mapContentPanelSpecs.filter((spec) => spec.panel).forEach(({ panel, tabId, labelledBy }) => {
      panel.hidden = false;
      panel.classList.remove("hidden", "is-active");
      panel.removeAttribute("data-appearance-panel");
      if (panel instanceof HTMLDetailsElement) {
        panel.classList.add("card-flat", "appearance-subsection", "map-content-panel");
      }
      panel.setAttribute("data-map-content-panel", tabId);
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", labelledBy);
      if (panel instanceof HTMLDetailsElement) panel.open = true;
      mapContentStack.appendChild(panel);
    });
  };
  moveAppearanceLayerPanels();
  moveMapContentPanels();
  const layerStatusAnchorById = getLayerPanelStatusAnchorMap();
  const layerStatusNodes = new Map();
  let thematicLayerPreviewController = null;
  const ensureLayerStatusNode = (diagnosticId) => {
    if (layerStatusNodes.has(diagnosticId)) return layerStatusNodes.get(diagnosticId);
    const anchorId = layerStatusAnchorById[diagnosticId];
    const anchor = anchorId ? document.getElementById(anchorId) : null;
    if (!anchor?.parentNode) return null;
    const node = document.createElement("p");
    node.className = "layer-status-strip";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.dataset.layerStatusId = diagnosticId;
    anchor.insertAdjacentElement("afterend", node);
    layerStatusNodes.set(diagnosticId, node);
    return node;
  };
  const setLayerStatusNode = (node, diagnostic) => {
    if (!node || !diagnostic) return;
    const summary = sanitizeLayerStatusText(diagnostic.summary);
    if (node.dataset.statusSummary !== summary) {
      node.textContent = summary;
      node.dataset.statusSummary = summary;
    }
    const severity = String(diagnostic.severity || "active").trim() || "active";
    node.dataset.severity = severity;
    node.dataset.statusTone = resolveLayerStatusTone(diagnostic, severity);
    node.classList.toggle("is-muted", severity === "muted");
    node.classList.toggle("is-warning", severity === "warning");
    node.classList.toggle("is-active", severity === "active");
  };
  const ensureTransportWorkbenchOnlyStatusNode = () => {
    const container = document.getElementById("transportVisualModeControls");
    if (!container) return null;
    let node = document.getElementById("transportWorkbenchOnlyStatus");
    if (node) return node;
    node = document.createElement("p");
    node.id = "transportWorkbenchOnlyStatus";
    node.className = "layer-status-strip transport-workbench-only-status is-muted";
    node.dataset.severity = "muted";
    node.dataset.statusTone = "muted";
    container.appendChild(node);
    return node;
  };
  const renderLayerStatusSummaries = () => {
    const diagnostics = buildLayerStatusDiagnostics(runtimeState, {
      translate: t,
      thematicCatalogPreview: thematicLayerPreviewController?.getPreview?.() || null,
    });
    const diagnosticsById = new Map(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]));
    Object.keys(layerStatusAnchorById).forEach((diagnosticId) => {
      const diagnostic = diagnosticsById.get(diagnosticId);
      if (!diagnostic) return;
      setLayerStatusNode(ensureLayerStatusNode(diagnosticId), diagnostic);
    });
    const unsupportedTransportFamilies = diagnostics
      .filter((diagnostic) => diagnostic.familyId && diagnostic.supported === false && diagnostic.familyId !== "layers");
    const workbenchStatusNode = ensureTransportWorkbenchOnlyStatusNode();
    if (workbenchStatusNode) {
      const labels = unsupportedTransportFamilies
        .map((diagnostic) => t(diagnostic.label || diagnostic.familyId, "ui"))
        .filter(Boolean);
      workbenchStatusNode.textContent = labels.length
        ? `${t("Workbench only", "ui")}: ${labels.join(", ")}`
        : "";
      workbenchStatusNode.hidden = labels.length === 0;
    }
  };
  thematicLayerPreviewController = createThematicLayerPreviewController({ t });
  void thematicLayerPreviewController.load().then(() => renderLayerStatusSummaries());
  const appearanceTabButtons = Array.from(document.querySelectorAll("[data-appearance-tab]"));
  const appearanceTabPanels = Array.from(document.querySelectorAll("[data-appearance-panel]"));
  const mapContentTabButtons = Array.from(document.querySelectorAll("[data-map-content-tab]"));
  const mapContentTabPanels = Array.from(document.querySelectorAll("[data-map-content-panel]"));
  const appearanceFilterItems = Array.from(document.querySelectorAll("[data-appearance-filter-item]"));
  const appearanceSpecialZoneBtn = document.getElementById("appearanceSpecialZoneBtn");
  const recentContainer = document.getElementById("recentColors");
  const dockRecentDivider = document.getElementById("dockRecentDivider");
  const parentBordersVisible = document.getElementById("parentBordersVisible");
  const parentBorderColor = document.getElementById("parentBorderColor");
  const parentBorderOpacity = document.getElementById("parentBorderOpacity");
  const parentBorderOpacityValue = document.getElementById("parentBorderOpacityValue");
  const parentBorderWidth = document.getElementById("parentBorderWidth");
  const parentBorderWidthValue = document.getElementById("parentBorderWidthValue");
  const parentBorderEnableAll = document.getElementById("parentBorderEnableAll");
  const parentBorderDisableAll = document.getElementById("parentBorderDisableAll");
  const parentBorderCountryList = document.getElementById("parentBorderCountryList");
  const parentBorderEmpty = document.getElementById("parentBorderEmpty");
  const getContextLayerRequestFromKeys = (layerKeys = []) => {
    const normalizedKeys = (Array.isArray(layerKeys) ? layerKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean);
    if (normalizedKeys.length === 0) return null;
    return normalizedKeys.length === 1 ? normalizedKeys[0] : normalizedKeys;
  };
  const ensureAppearancePresetLayerData = () => {
    if (runtimeState.showCityPoints) {
      const loadOptions = { reason: "appearance-preset-apply", renderNow: true };
      if (typeof runtimeState.ensureBaseCityDataFn === "function") {
        void runtimeState.ensureBaseCityDataFn(loadOptions);
      }
      if (typeof ensureActiveScenarioOptionalLayerLoaded === "function") {
        void ensureActiveScenarioOptionalLayerLoaded("cities", loadOptions);
      }
    }
    if (runtimeState.showStrategicResourceMarkers || runtimeState.strategicChoroplethMetric) {
      void ensureActiveScenarioOptionalLayerLoaded("strategicvalues", {
        reason: "appearance-preset-apply",
        renderNow: true,
      });
    }
    if (typeof runtimeState.ensureContextLayerDataFn !== "function") return;
    const requests = [];
    if (runtimeState.showUrban) requests.push("urban");
    if (runtimeState.showPhysical) requests.push(getPhysicalContextLayerRequests(runtimeState.styleConfig?.physical));
    if (runtimeState.showRivers) requests.push("rivers");
    if (runtimeState.showTransport !== false) {
      listTransportOverviewCapabilityFamilyIds().forEach((familyId) => {
        const visibilityField = getTransportOverviewVisibilityField(familyId);
        if (!visibilityField || !runtimeState[visibilityField]) return;
        const layerRequest = getContextLayerRequestFromKeys(getTransportOverviewDataLayerKeys(familyId));
        if (layerRequest) requests.push(layerRequest);
      });
    }
    requests.forEach((layerRequest) => {
      void runtimeState.ensureContextLayerDataFn(layerRequest, {
        reason: "appearance-preset-apply",
        renderNow: true,
      });
    });
  };
  const appearancePresetsOwner = createAppearancePresetsOwner({
    runtimeState,
    nodes: {
      nameInput: document.getElementById("appearancePresetName"),
      select: document.getElementById("appearancePresetSelect"),
      saveButton: document.getElementById("appearancePresetSaveBtn"),
      applyButton: document.getElementById("appearancePresetApplyBtn"),
      deleteButton: document.getElementById("appearancePresetDeleteBtn"),
      exportButton: document.getElementById("appearancePresetExportBtn"),
      importButton: document.getElementById("appearancePresetImportBtn"),
      importInput: document.getElementById("appearancePresetImportFile"),
      summary: document.getElementById("appearancePresetSummary"),
      list: document.getElementById("appearancePresetList"),
    },
    t,
    renderDirty: scheduleLayerRenderDirty,
    captureHistoryState: captureRuntimeHistoryState,
    pushHistoryEntry: pushRuntimeHistoryEntry,
    requestUiRefresh: () => renderAppearanceStyleControlsUi(),
    afterApply: ensureAppearancePresetLayerData,
  });

  // Appearance shell 自己只保留跨分区的 tab/filter/toggle 编排。
  // 细分面板各自维护自己的脏标记、状态归一化和 UI 刷新，避免再次回到 toolbar.js 式的大一统逻辑。
  const transportAppearanceController = createTransportAppearanceController({
    runtimeState,
    t,
    clamp,
    renderDirty: scheduleLayerRenderDirty,
    normalizeOceanFillColor,
  });
  const renderTransportAppearanceUi = () => {
    transportAppearanceController.renderTransportAppearanceUi();
    renderLayerStatusSummaries();
  };
  const textureOwner = createAppearanceTextureOwner({
    runtimeState,
    clamp,
    renderDirty: scheduleLayerRenderDirty,
    normalizeOceanFillColor,
  });
  const renderTextureUI = textureOwner.renderTextureUI;
  const renderDayNightUI = textureOwner.renderDayNightUI;
  const cityPointsOwner = createAppearanceCityPointsOwner({
    runtimeState,
    t,
    clamp,
    renderDirty: scheduleLayerRenderDirty,
    normalizeOceanFillColor,
    ensureActiveScenarioOptionalLayerLoaded,
  });
  const physicalOwner = createAppearancePhysicalOwner({
    runtimeState,
    t,
    clamp,
    renderDirty: scheduleLayerRenderDirty,
    normalizeOceanFillColor,
  });
  const urbanIntensityFieldEditor = createIntensityFieldEditorSection({
    runtimeState,
    nodes: createIntensityFieldEditorNodes(document, {
      prefix: "urbanIntensityField",
    }),
    channelIds: ["urbanGlow"],
    defaultChannelId: "urbanGlow",
    historyLabel: "Urban intensity field",
    reasonPrefix: "urban-intensity-field",
    t,
    clamp,
    renderDirty: scheduleLayerRenderDirty,
    captureHistoryState: captureRuntimeHistoryState,
    pushHistoryEntry: pushRuntimeHistoryEntry,
  });
  const riversOwner = createAppearanceRiversOwner({
    runtimeState,
    clamp,
    renderDirty: scheduleLayerRenderDirty,
    normalizeOceanFillColor,
  });
  const referenceOwner = createAppearanceReferenceOwner({
    runtimeState,
    clamp,
    markDirty,
  });
  const renderReferenceOverlayUi = referenceOwner.renderReferenceOverlayUi;
  const borderOwner = createAppearanceBorderOwner({
    runtimeState,
    clamp,
    renderDirty: scheduleLayerRenderDirty,
  });
  const renderBorderUi = borderOwner.renderBorderUi;
  const parentBorderOwner = createAppearanceParentBorderOwner({
    runtimeState,
    nodes: {
      visibleToggle: parentBordersVisible,
      colorInput: parentBorderColor,
      opacityInput: parentBorderOpacity,
      opacityValue: parentBorderOpacityValue,
      widthInput: parentBorderWidth,
      widthValue: parentBorderWidthValue,
      enableAllButton: parentBorderEnableAll,
      disableAllButton: parentBorderDisableAll,
      countryList: parentBorderCountryList,
      emptyNode: parentBorderEmpty,
    },
    translateGeo: (label) => t(label, "geo"),
    renderDirty: scheduleLayerRenderDirty,
  });

  const applyAppearanceFilter = () => {
    const query = String(appearanceLayerFilter?.value || "").trim().toLowerCase();
    appearanceFilterItems.forEach((item) => {
      const label = String(item.getAttribute("data-appearance-filter-label") || item.textContent || "").toLowerCase();
      item.classList.toggle("hidden", !!query && !label.includes(query));
    });
  };

  const setAppearanceTab = (tabId = "borders") => {
    const normalizedTabId = String(tabId || "borders").trim().toLowerCase();
    appearanceTabButtons.forEach((button) => {
      const id = String(button.dataset.appearanceTab || "").trim().toLowerCase();
      const isActive = id === normalizedTabId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    appearanceTabPanels.forEach((panel) => {
      const id = String(panel.dataset.appearancePanel || "").trim().toLowerCase();
      const isActive = id === normalizedTabId;
      panel.classList.toggle("is-active", isActive);
      panel.classList.toggle("hidden", !isActive);
      panel.hidden = !isActive;
    });
    runtimeState.syncFacilityInfoCardVisibilityFn?.();
  };

  const moveAppearanceTabFocus = (currentButton, direction) => {
    const buttons = appearanceTabButtons.filter((button) => !button.disabled && !button.hidden);
    if (!buttons.length) return;
    const currentIndex = Math.max(0, buttons.indexOf(currentButton));
    const nextIndex = direction === "first"
      ? 0
      : direction === "last"
        ? buttons.length - 1
        : (currentIndex + direction + buttons.length) % buttons.length;
    const nextButton = buttons[nextIndex];
    if (!nextButton) return;
    setAppearanceTab(nextButton.dataset.appearanceTab || "borders");
    nextButton.focus?.();
  };

  const setMapContentTab = (tabId = "ocean") => {
    const normalizedTabId = String(tabId || "ocean").trim().toLowerCase();
    mapContentTabButtons.forEach((button) => {
      const id = String(button.dataset.mapContentTab || "").trim().toLowerCase();
      const isActive = id === normalizedTabId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    mapContentTabPanels.forEach((panel) => {
      const id = String(panel.dataset.mapContentPanel || "").trim().toLowerCase();
      const isActive = id === normalizedTabId;
      panel.classList.toggle("is-active", isActive);
      panel.classList.toggle("hidden", !isActive);
      panel.hidden = !isActive;
    });
  };

  const moveMapContentTabFocus = (currentButton, direction) => {
    const buttons = mapContentTabButtons.filter((button) => !button.disabled && !button.hidden);
    if (!buttons.length) return;
    const currentIndex = Math.max(0, buttons.indexOf(currentButton));
    const nextIndex = direction === "first"
      ? 0
      : direction === "last"
        ? buttons.length - 1
        : (currentIndex + direction + buttons.length) % buttons.length;
    const nextButton = buttons[nextIndex];
    if (!nextButton) return;
    setMapContentTab(nextButton.dataset.mapContentTab || "ocean");
    nextButton.focus?.();
  };

  const syncUrbanConfig = () => {
    const normalized = normalizeUrbanStyleConfig(runtimeState.styleConfig.urban);
    return setAppearanceStyleGroupState(runtimeState, "urban", {
      ...normalized,
      color: normalized.mode === "manual"
        ? normalizeOceanFillColor(normalized.color || URBAN_MANUAL_DEFAULT_COLOR)
        : normalized.color,
      adaptiveTintColor: normalizeOceanFillColor(
        normalized.adaptiveTintColor || URBAN_ADAPTIVE_TINT_DEFAULT_COLOR,
      ),
    });
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
    if (urbanAdaptiveTintColor) urbanAdaptiveTintColor.value = urbanConfig.adaptiveTintColor || URBAN_ADAPTIVE_TINT_DEFAULT_COLOR;
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
    // 先让子 owner 刷到各自的稳定视图，再回填这个 shell 仍然直接拥有的原始 toggle/value。
    // 这样 transport/city/physical 的派生状态不会被后面的简单 DOM 赋值覆盖回旧值。
    cityPointsOwner.renderCityPointsUi();
    renderBorderUi();
    if (toggleUrban) toggleUrban.checked = !!runtimeState.showUrban;
    physicalOwner.renderPhysicalUi();
    riversOwner.renderRiversUi();
    syncUrbanControls();
    urbanIntensityFieldEditor.render();
    appearancePresetsOwner.renderAppearancePresetsUi();
    thematicLayerPreviewController?.render();
    renderLayerStatusSummaries();
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
        setSelectedColorState(runtimeState, normalized);
        updateSwatchUI();
      });
      recentContainer.appendChild(btn);
    });
  };

  const syncParentBorderVisibilityUI = () => parentBorderOwner.syncVisibilityUi();

  const renderParentBorderCountryList = () => parentBorderOwner.renderCountryList();

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
        setAppearanceTab(button.dataset.appearanceTab || "borders");
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          moveAppearanceTabFocus(button, 1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          moveAppearanceTabFocus(button, -1);
        } else if (event.key === "Home") {
          event.preventDefault();
          moveAppearanceTabFocus(button, "first");
        } else if (event.key === "End") {
          event.preventDefault();
          moveAppearanceTabFocus(button, "last");
        }
      });
      button.dataset.bound = "true";
    });

    mapContentTabButtons.forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.addEventListener("click", () => {
        setMapContentTab(button.dataset.mapContentTab || "ocean");
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          moveMapContentTabFocus(button, 1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          moveMapContentTabFocus(button, -1);
        } else if (event.key === "Home") {
          event.preventDefault();
          moveMapContentTabFocus(button, "first");
        } else if (event.key === "End") {
          event.preventDefault();
          moveMapContentTabFocus(button, "last");
        }
      });
      button.dataset.bound = "true";
    });

    if (appearanceLayerFilter && !appearanceLayerFilter.dataset.bound) {
      appearanceLayerFilter.addEventListener("input", () => {
        applyAppearanceFilter();
      });
      appearanceLayerFilter.dataset.bound = "true";
    }

    transportAppearanceController.bindEvents();
    textureOwner.bindEvents();
    cityPointsOwner.bindEvents();
    physicalOwner.bindEvents();
    urbanIntensityFieldEditor.bindEvents();
    riversOwner.bindEvents();
    referenceOwner.bindEvents();
    borderOwner.bindEvents();
    parentBorderOwner.bindEvents();
    appearancePresetsOwner.bindEvents();

    if (toggleUrban && toggleUrban.dataset.bound !== "true") {
      toggleUrban.checked = !!runtimeState.showUrban;
      toggleUrban.addEventListener("change", (event) => {
        setAppearanceVisibilityState(runtimeState, "showUrban", event.target.checked);
        if (runtimeState.showUrban && typeof runtimeState.ensureContextLayerDataFn === "function") {
          void runtimeState.ensureContextLayerDataFn("urban", { reason: "toolbar-toggle", renderNow: true });
        }
        scheduleLayerRenderDirty("toggle-urban");
      });
      toggleUrban.dataset.bound = "true";
    }

    if (urbanMode && urbanMode.dataset.bound !== "true") {
      urbanMode.addEventListener("change", (event) => {
        syncUrbanConfig();
        const requestedMode = String(event.target.value || "adaptive");
        const capability = getUrbanCapability();
        patchAppearanceStyleGroupState(runtimeState, "urban", {
          mode: requestedMode === "adaptive" && !capability.adaptiveAvailable ? "manual" : requestedMode,
        });
        syncUrbanControls();
        scheduleLayerRenderDirty("urban-mode");
      });
      urbanMode.dataset.bound = "true";
    }
    if (urbanColor && urbanColor.dataset.bound !== "true") {
      urbanColor.addEventListener("input", (event) => {
        syncUrbanConfig();
        patchAppearanceStyleGroupState(runtimeState, "urban", {
          color: normalizeOceanFillColor(event.target.value),
        });
        scheduleLayerRenderDirty("urban-color");
      });
      urbanColor.dataset.bound = "true";
    }
    if (urbanOpacity && urbanOpacity.dataset.bound !== "true") {
      urbanOpacity.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        const fillOpacity = clamp(Number.isFinite(value) ? value / 100 : cfg.fillOpacity, 0, 1);
        patchAppearanceStyleGroupState(runtimeState, "urban", { fillOpacity });
        if (urbanOpacityValue) urbanOpacityValue.textContent = `${Math.round(fillOpacity * 100)}%`;
        scheduleLayerRenderDirty("urban-opacity");
      });
      urbanOpacity.dataset.bound = "true";
    }
    if (urbanBlendMode && urbanBlendMode.dataset.bound !== "true") {
      urbanBlendMode.addEventListener("change", (event) => {
        syncUrbanConfig();
        patchAppearanceStyleGroupState(runtimeState, "urban", {
          blendMode: String(event.target.value || "multiply"),
        });
        scheduleLayerRenderDirty("urban-blend");
      });
      urbanBlendMode.dataset.bound = "true";
    }
    if (urbanAdaptiveStrength && urbanAdaptiveStrength.dataset.bound !== "true") {
      urbanAdaptiveStrength.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        const adaptiveStrength = clamp(Number.isFinite(value) ? value / 100 : cfg.adaptiveStrength, 0, 1);
        patchAppearanceStyleGroupState(runtimeState, "urban", { adaptiveStrength });
        if (urbanAdaptiveStrengthValue) urbanAdaptiveStrengthValue.textContent = `${Math.round(adaptiveStrength * 100)}%`;
        scheduleLayerRenderDirty("urban-adaptive-strength");
      });
      urbanAdaptiveStrength.dataset.bound = "true";
    }
    if (urbanStrokeOpacity && urbanStrokeOpacity.dataset.bound !== "true") {
      urbanStrokeOpacity.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        const strokeOpacity = clamp(Number.isFinite(value) ? value / 100 : cfg.strokeOpacity, 0, 1);
        patchAppearanceStyleGroupState(runtimeState, "urban", { strokeOpacity });
        if (urbanStrokeOpacityValue) urbanStrokeOpacityValue.textContent = `${Math.round(strokeOpacity * 100)}%`;
        scheduleLayerRenderDirty("urban-stroke-opacity");
      });
      urbanStrokeOpacity.dataset.bound = "true";
    }
    if (urbanToneBias && urbanToneBias.dataset.bound !== "true") {
      urbanToneBias.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        const toneBias = clamp(Number.isFinite(value) ? value / 100 : cfg.toneBias, -0.3, 0.3);
        patchAppearanceStyleGroupState(runtimeState, "urban", { toneBias });
        if (urbanToneBiasValue) urbanToneBiasValue.textContent = formatUrbanToneBias(toneBias);
        scheduleLayerRenderDirty("urban-tone-bias");
      });
      urbanToneBias.dataset.bound = "true";
    }
    if (urbanAdaptiveTintEnabled && urbanAdaptiveTintEnabled.dataset.bound !== "true") {
      urbanAdaptiveTintEnabled.addEventListener("change", (event) => {
        syncUrbanConfig();
        patchAppearanceStyleGroupState(runtimeState, "urban", {
          adaptiveTintEnabled: !!event.target.checked,
        });
        syncUrbanControls();
        scheduleLayerRenderDirty("urban-adaptive-tint-enabled");
      });
      urbanAdaptiveTintEnabled.dataset.bound = "true";
    }
    if (urbanAdaptiveTintColor && urbanAdaptiveTintColor.dataset.bound !== "true") {
      urbanAdaptiveTintColor.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        patchAppearanceStyleGroupState(runtimeState, "urban", {
          adaptiveTintColor: normalizeOceanFillColor(
            event.target.value || cfg.adaptiveTintColor || URBAN_ADAPTIVE_TINT_DEFAULT_COLOR,
          ),
        });
        scheduleLayerRenderDirty("urban-adaptive-tint-color");
      });
      urbanAdaptiveTintColor.dataset.bound = "true";
    }
    if (urbanAdaptiveTintStrength && urbanAdaptiveTintStrength.dataset.bound !== "true") {
      urbanAdaptiveTintStrength.addEventListener("input", (event) => {
        const cfg = syncUrbanConfig();
        const value = Number(event.target.value);
        const adaptiveTintStrength = clamp(Number.isFinite(value) ? value / 100 : cfg.adaptiveTintStrength, 0, 0.5);
        patchAppearanceStyleGroupState(runtimeState, "urban", { adaptiveTintStrength });
        if (urbanAdaptiveTintStrengthValue) urbanAdaptiveTintStrengthValue.textContent = `${Math.round(adaptiveTintStrength * 100)}%`;
        scheduleLayerRenderDirty("urban-adaptive-tint-strength");
      });
      urbanAdaptiveTintStrength.dataset.bound = "true";
    }
    if (urbanMinArea && urbanMinArea.dataset.bound !== "true") {
      urbanMinArea.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        syncUrbanConfig();
        const minAreaPx = clamp(Number.isFinite(value) ? value : 1, 1, 80);
        patchAppearanceStyleGroupState(runtimeState, "urban", { minAreaPx });
        if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(minAreaPx)}`;
        scheduleLayerRenderDirty("urban-area");
      });
      urbanMinArea.dataset.bound = "true";
    }
  };

  setMapContentTab("ocean");

  return {
    applyAppearanceFilter,
    bindEvents,
    clearReferenceImage: referenceOwner.clearReferenceImage,
    renderAppearanceStyleControlsUi,
    renderBorderUi,
    renderReferenceOverlayUi,
    renderParentBorderCountryList,
    renderRecentColors,
    renderDayNightUI,
    renderTextureUI,
    renderTransportAppearanceUi,
    renderLayerStatusSummaries,
    setAppearanceTab,
    syncParentBorderVisibilityUI,
  };
}
