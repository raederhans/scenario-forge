import { createRiverPaintControls } from "./river_paint_controls.js";
import { createRiverCellPicker } from "./river_cell_picker.js";
import { getEditedRiverParentIds } from "../core/river_paint/partition_model.js";
import { clearAllRiverPaintOverridesState } from "../core/state/actions/river_paint_actions.js";
import { normalizePaintMode } from "../core/map_editing_policy.js";
// Toolbar UI (Phase 13)
import {
  state as runtimeState,
  PARENT_BORDER_STYLE_DEFAULTS,
  PALETTE_THEMES,
  normalizeLakeStyleConfig,
} from "../core/state.js";
import {
  autoFillMap,
  getZoomPercent,
  focusRiverPaintParentById,
  applyRiverPaintCellById,
  invalidateOceanBackgroundVisualState,
  invalidateOceanCoastalAccentVisualState,
  invalidateOceanVisualState,
  invalidateOceanWaterInteractionVisualState,
  getBathymetryPresetStyleDefaults,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  resetZoomToFit,
  recomputeDynamicBordersNow,
  zoomByStep,
  setZoomPercent,
  RENDER_PASS_NAMES,
  renderExportPassesToCanvas,
  assertPopulationHeatmapReadyForExport,
  ensurePopulationHeatmapReadyForExport,
  ensurePaintContoursReady,
  ensureBathymetryReadyForExport,
  ensureCountryLabelsReadyForExport,
  setMapData,
} from "../core/map_renderer/public.js";
import { captureHistoryState, canRedoHistory, canUndoHistory, getLatestHistoryEntry, pushHistoryEntry, redoHistory, undoHistory } from "../core/history_manager.js";
import { callRuntimeHook, registerRuntimeHook } from "../core/state/index.js";
import { setSelectedColorState } from "../core/state/actions/appearance_selection_actions.js";
import "../core/state/actions/ui_visibility_actions.js";
import { setAppearanceVisibilityState } from "../core/state/actions/appearance_visibility_actions.js";
import {
  buildPaletteQuickSwatches,
  getPaletteSourceOptions,
  normalizeHexColor,
} from "../core/palette_manager.js";
import { ensureActiveScenarioOptionalLayerLoaded, ensureScenarioPoliticalDetailForExport } from "../core/scenario/scenario_resources.js";
import { getDirectGeoLabel, toggleLanguage, updateUIText, t } from "./i18n.js";
import { showToast } from "./toast.js";
import { createToolGuidance } from "./toolbar/tool_guidance.js";
import { createMobileEditingHintController } from "./toolbar/mobile_editing_hint_controller.js";
import { createUiIcon, setUiIcon } from "./ui_icons.js";
import { showAppDialog } from "./app_dialog.js";
import { createUiSurfaceUrlState } from "./ui_surface_url_state.js";
import { loadPublicSampleProjectIntoRuntime } from "../core/sample_project_import_workflow.js";
import { loadPublicSampleProjectList } from "../core/sample_project_registry.js";
import {
  applyDialogContract,
  createFocusReturnRegistry,
  focusSurface,
  getFocusableElements,
  getActiveModal,
  restoreFocusOrigin,
  rememberSurfaceTrigger,
  restoreSurfaceTriggerFocus,
  UI_URL_STATE_KEYS,
} from "./ui_contract.js";
import { markDirty, updateDirtyIndicator } from "../core/dirty_state.js";
import { createOceanLakeControlsController } from "./toolbar/ocean_lake_controls_controller.js";
import {
  resolveExportPassSequence,
} from "./toolbar/export_workbench_controller.js";
import { createPaletteLibraryPanelController, selectPalettePaintColor } from "./toolbar/palette_library_panel.js";
import { createPaletteLibraryOperation } from "../core/palette_library_operation.js";
import { createPaletteCountryEditor } from "./toolbar/palette_country_editor.js";
import { getPaletteCountryTargets } from "../core/palette_country_targets.js";
import { createPaletteLibraryStateAccess } from "../core/palette_library_state_access.js";
import { createAppearanceControlsController } from "./toolbar/appearance_controls_controller.js";
import { createScenarioContextBarController } from "./toolbar/scenario_context_bar_controller.js";
import { createScenarioGuidePopoverController } from "./toolbar/scenario_guide_popover.js";
import {
  createSampleProjectBannerController,
  createSampleProjectGuideCardController,
} from "./toolbar/sample_project_banner_controller.js";
import { createSpecialZoneEditorController } from "./toolbar/special_zone_editor.js";
import { createSpecialZonesWorkbenchController } from "./toolbar/special_zones_workbench_controller.js";
import {
  createTransportWorkbenchController,
  TRANSPORT_WORKBENCH_INSPECTOR_TABS,
} from "./transport_workbench/transport_workbench_controller.js";
import { createWorkspaceChromeSupportSurfaceController } from "./toolbar/workspace_chrome_support_surface_controller.js";
import { shouldShowDeveloperModeEntry } from "./toolbar/developer_mode_visibility.js";
import { createExportWorkflowController } from "./toolbar/export_workflow_controller.js";
const state = runtimeState;

function composePaletteLibraryOperation() {
  const stateAccess = createPaletteLibraryStateAccess(runtimeState);
  const owner = createPaletteLibraryOperation({
    getApplyTarget: stateAccess.getApplyTarget,
    getOwnerFeatureIds: stateAccess.getOwnerFeatureIds,
    getCountryFeatureIds: (code) => [...(getPaletteCountryTargets(runtimeState).get(code) || [])],
    applyFeatureColor: stateAccess.applyFeatureColor,
    applyOwnerColor: stateAccess.applyOwnerColor,
    captureHistoryState,
    pushHistoryEntry,

    refreshResolvedColorsForFeatures,
    refreshColorState,
    markDirty,
    selectPaintColor: (color) => selectPalettePaintColor(runtimeState, color),
  });
  return owner;
}

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
      selectPalettePaintColor(runtimeState, normalized);
      if (runtimeState.currentTool === "select") {
        callRuntimeHook(runtimeState, "runToolSelectionFn", "fill", { feedbackLabel: t("Switched to fill tool", "ui") });
      }
      callRuntimeHook(state, "updateSwatchUIFn");
    });
    paletteGrid.appendChild(btn);
  });

  if (!normalizeHexColor(runtimeState.selectedColor) && swatches.length > 0) {
    setSelectedColorState(runtimeState, swatches[0]);
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



function initToolbar({ render } = {}) {
  // toolbar.js 保留的是壳层接线职责：集中拿 DOM、拼 controller、注册 runtime hooks。
  // 各个面板自身的业务逻辑应继续留在子 controller，避免再把 owner 逻辑回流到这个大文件。
  const OCEAN_ADVANCED_PRESETS = new Set([
    "bathymetry_soft",
    "bathymetry_contours",
  ]);
  const toolButtons = document.querySelectorAll(".btn-tool");
  const customColor = document.getElementById("customColor");
  const transportAppearanceWorkbenchBtn = document.getElementById("transportAppearanceWorkbenchBtn");
  const specialZoneEditorHint = document.getElementById("specialZoneEditorHint");
  const recentContainer = document.getElementById("recentColors");
  const paletteLibraryToggle = document.getElementById("paletteLibraryToggle");
  const paletteLibraryPanel = document.getElementById("paletteLibraryPanel");
  const paletteLibrarySources = document.getElementById("paletteLibrarySources");
  const paletteLibrarySearch = document.getElementById("paletteLibrarySearch");
  const paletteLibrarySearchClear = document.getElementById("paletteLibrarySearchClear");
  const paletteLibrarySummary = document.getElementById("paletteLibrarySummary");
  const paletteLibraryList = document.getElementById("paletteLibraryList");
  const presetPolitical = document.getElementById("presetPolitical");
  const presetClear = document.getElementById("presetClear");
  const dockQuickFillBtn = document.getElementById("dockQuickFillBtn");
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
  const zoomPercentInput = document.getElementById("zoomPercentInput");
  const zoomControls = document.getElementById("zoomControls");
  const developerModeBtn = document.getElementById("developerModeBtn");
  const zoomUtilityWorkspaceGroup = document.getElementById("zoomUtilityWorkspaceGroup");
  const toolHudChip = document.getElementById("toolHudChip");
  const mapOnboardingHint = document.getElementById("mapOnboardingHint");
  const scenarioContextBar = document.getElementById("scenarioContextBar");
  const scenarioContextCollapseBtn = document.getElementById("scenarioContextCollapseBtn");
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
  const scenarioGuideNavButtons = Array.from(document.querySelectorAll(".scenario-guide-nav-btn"));
  const scenarioGuidePanels = Array.from(document.querySelectorAll("[data-guide-panel]"));
  const scenarioGuideSampleProjectCard = document.getElementById("scenarioGuideSampleProjectCard");
  const scenarioGuideSampleProjectTitle = document.getElementById("scenarioGuideSampleProjectTitle");
  const scenarioGuideSampleProjectBody = document.getElementById("scenarioGuideSampleProjectBody");
  const scenarioGuideSampleProjectRecommendation = document.getElementById("scenarioGuideSampleProjectRecommendation");
  const scenarioGuideSampleProjectOpenExportBtn = document.getElementById("scenarioGuideSampleProjectOpenExportBtn");
  const scenarioGuideSampleProjectDownloadOriginalLink = document.getElementById("scenarioGuideSampleProjectDownloadOriginalLink");
  const scenarioGuideSampleProjectContinueBtn = document.getElementById("scenarioGuideSampleProjectContinueBtn");
  const scenarioGuideSampleProjectChoices = document.getElementById("scenarioGuideSampleProjectChoices");
  const scenarioGuideSampleProjectStatus = document.getElementById("scenarioGuideSampleProjectStatus");
  const dockReferenceBtn = document.getElementById("dockReferenceBtn");
  const sampleProjectBanner = document.getElementById("sampleProjectBanner");
  const sampleProjectBannerTitle = document.getElementById("sampleProjectBannerTitle");
  const sampleProjectBannerBody = document.getElementById("sampleProjectBannerBody");
  const sampleProjectBannerOpenExportBtn = document.getElementById("sampleProjectBannerOpenExportBtn");
  const sampleProjectBannerDownloadOriginalLink = document.getElementById("sampleProjectBannerDownloadOriginalLink");
  const sampleProjectBannerDismissBtn = document.getElementById("sampleProjectBannerDismissBtn");
  const dockReferencePopover = document.getElementById("dockReferencePopover");
  const dockEditPopover = document.getElementById("dockEditPopover");
  const devWorkspaceToggleBtn = document.getElementById("devWorkspaceToggleBtn");
  const leftPanelToggle = document.getElementById("leftPanelToggle");
  const rightPanelToggle = document.getElementById("rightPanelToggle");
  const inspectorSidebarTabProject = document.getElementById("inspectorSidebarTabProject");
  const inspectorUtilitiesSection = document.getElementById("inspectorUtilitiesSection");
  const transportWorkbenchOverlay = document.getElementById("transportWorkbenchOverlay");
  const transportWorkbenchPanel = document.getElementById("transportWorkbenchPanel");
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
  const transportWorkbenchPackSelect = document.getElementById("transportWorkbenchPackSelect");
  const transportWorkbenchPreviewMode = document.getElementById("transportWorkbenchPreviewMode");
  const transportWorkbenchPreviewTitle = document.getElementById("transportWorkbenchPreviewTitle");
  const transportWorkbenchPreviewCanvas = document.getElementById("transportWorkbenchPreviewCanvas");
  const transportWorkbenchPreviewControls = document.getElementById("transportWorkbenchPreviewControls");
  const transportWorkbenchCarrierMount = document.getElementById("transportWorkbenchCarrierMount");
  const transportWorkbenchLayerOrderPanel = document.getElementById("transportWorkbenchLayerOrderPanel");
  const transportWorkbenchLayerOrderList = document.getElementById("transportWorkbenchLayerOrderList");
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
  const dockQuickFillRow = document.getElementById("dockQuickFillRow");
  const quickFillParentBtn = document.getElementById("quickFillParentBtn");
  const quickFillCountryBtn = document.getElementById("quickFillCountryBtn");
  const dockQuickFillHint = document.getElementById("dockQuickFillHint");
  const paintModeVisualBtn = document.getElementById("paintModeVisualBtn");
  const activeSovereignLabel = document.getElementById("activeSovereignLabel");
  const recalculateBordersBtn = document.getElementById("recalculateBordersBtn");
  const dynamicBorderStatus = document.getElementById("dynamicBorderStatus");
  const oceanFillColor = document.getElementById("oceanFillColor");
  const oceanRegionNamesToggle = document.getElementById("oceanRegionNamesToggle");
  const lakeLinkToOcean = document.getElementById("lakeLinkToOcean");
  const lakeFillColor = document.getElementById("lakeFillColor");
  const lakeOutlineToggle = document.getElementById("lake-outline-toggle");
  const oceanCoastalAccentRow = document.getElementById("oceanCoastalAccentRow");
  const oceanCoastalAccentToggle = document.getElementById("oceanCoastalAccentToggle");
  const oceanAdvancedStylesToggle = document.getElementById("oceanAdvancedStylesToggle");
  const oceanStyleSelect = document.getElementById("oceanStyleSelect");
  const oceanTextureOpacity = document.getElementById("oceanTextureOpacity");
  const oceanTextureScale = document.getElementById("oceanTextureScale");
  const oceanContourStrength = document.getElementById("oceanContourStrength");
  const oceanBathymetryDebugDetails = document.getElementById("oceanBathymetryDebugDetails");
  const oceanBathymetrySourceValue = document.getElementById("oceanBathymetrySourceValue");
  const oceanBathymetryBandsValue = document.getElementById("oceanBathymetryBandsValue");
  const oceanBathymetryContoursValue = document.getElementById("oceanBathymetryContoursValue");
  const toggleLang = document.getElementById("btnToggleLang");
  const scenarioGuideLanguageToggle = document.getElementById("scenarioGuideLanguageToggle");
  const themeSelect = document.getElementById("themeSelect");
  const paletteLibraryToggleLabel = document.getElementById("paletteLibraryToggleLabel");

  const oceanTextureOpacityValue = document.getElementById("oceanTextureOpacityValue");
  const oceanTextureScaleValue = document.getElementById("oceanTextureScaleValue");
  const oceanContourStrengthValue = document.getElementById("oceanContourStrengthValue");
  const appearanceSpecialZoneBtn = document.getElementById("appearanceSpecialZoneBtn");
  const specialZonePopover = document.getElementById("specialZonePopover");
  const specialZoneEditorInline = specialZonePopover?.dataset.inlineEditor === "true";
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const DEVELOPER_MODE_STORAGE_KEY = "map_creator_developer_mode";
  let toolHudTimerId = null;
  const overlayFocusReturnTargets = createFocusReturnRegistry();
  const MOBILE_WORKSPACE_MAX_WIDTH = 767;
  const TABLET_WORKSPACE_MAX_WIDTH = 1023;
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
  runtimeState.paletteLibraryGroupingMode = ["default", "region"].includes(runtimeState.paletteLibraryGroupingMode)
    ? runtimeState.paletteLibraryGroupingMode
    : "default";
  const uiSurfaceUrlState = createUiSurfaceUrlState({
    uiUrlStateKeys: UI_URL_STATE_KEYS,
  });
  const {
    getScenarioGuideSectionFromUrl,
    getSupportSurfaceViewFromUrl,
    syncSampleProjectUrlState,
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
  const mobileEditingHintController = createMobileEditingHintController({
    documentRef: document,
    storage: {
      getItem: (key) => globalThis.localStorage.getItem(key),
      setItem: (key, value) => globalThis.localStorage.setItem(key, value),
    },
    matchMedia: (query) => globalThis.matchMedia(query),
    t,
    createUiIcon,
  });
  mobileEditingHintController.mount();

  const persistDeveloperMode = () => {
    try {
      globalThis.localStorage?.setItem(
        DEVELOPER_MODE_STORAGE_KEY,
        runtimeState.ui.developerMode ? "true" : "false"
      );
    } catch {}
  };

  const updateLanguageToggleUi = () => {
    const currentLangLabel = runtimeState.currentLanguage === "zh" ? "ZH" : "EN";
    [toggleLang, scenarioGuideLanguageToggle].forEach((button) => {
      if (!button) return;
      button.textContent = currentLangLabel;
      button.setAttribute("title", `${t("Language", "ui")}: ${currentLangLabel}`);
      button.setAttribute("aria-label", `${t("Language", "ui")}: ${currentLangLabel}`);
    });
  };

  const readStoredDeveloperMode = () => {
    try {
      return globalThis.localStorage?.getItem(DEVELOPER_MODE_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  };

  const isDeveloperModeEntryVisible = () => shouldShowDeveloperModeEntry({
    hostname: globalThis.location?.hostname,
    search: globalThis.location?.search,
    storedDeveloperMode: readStoredDeveloperMode(),
  });

  const syncDeveloperModeUi = () => {
    // 快捷键显式开启的开发者模式是内存中的 opt-in：即使存储被阻止、主机也不是本地，入口与开启态都要保留。
    const entryVisible = isDeveloperModeEntryVisible() || !!runtimeState.ui.developerMode;
    document.body?.classList.toggle("developer-mode", !!runtimeState.ui.developerMode);
    if (developerModeBtn) {
      // .zoom-btn 自带 display，单靠 hidden 属性压不住，同时挂全局 .hidden 类。
      developerModeBtn.hidden = !entryVisible;
      developerModeBtn.classList.toggle("hidden", !entryVisible);
      const buttonLabel = runtimeState.ui.developerMode
        ? t("Hide development workspace", "ui")
        : t("Show development workspace", "ui");
      developerModeBtn.classList.toggle("is-active", !!runtimeState.ui.developerMode);
      developerModeBtn.setAttribute("aria-pressed", runtimeState.ui.developerMode ? "true" : "false");
      developerModeBtn.setAttribute("aria-label", buttonLabel);
      developerModeBtn.setAttribute("title", buttonLabel);
    }
    zoomUtilityWorkspaceGroup?.classList.add("hidden");
    zoomUtilityWorkspaceGroup?.setAttribute("aria-hidden", "true");
    devWorkspaceToggleBtn?.classList.add("hidden");
    devWorkspaceToggleBtn?.setAttribute("aria-hidden", "true");
    devWorkspaceToggleBtn?.setAttribute("tabindex", "-1");
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

  const storedDeveloperMode = readStoredDeveloperMode();
  if (storedDeveloperMode === "true" || storedDeveloperMode === "false") {
    runtimeState.ui.developerMode = storedDeveloperMode === "true";
  }
  updateLanguageToggleUi();
  syncDeveloperModeUi();

  const focusOverlaySurface = (container) => focusSurface(container);
  const rememberOverlayTrigger = (overlay, trigger) => rememberSurfaceTrigger(overlayFocusReturnTargets, overlay, trigger);
  const restoreOverlayTriggerFocus = (overlay, explicitTrigger = null, fallback = null) => (
    restoreSurfaceTriggerFocus(overlayFocusReturnTargets, overlay, explicitTrigger, fallback)
  );
  const isVisibleFocusTarget = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = globalThis.getComputedStyle?.(element);
    if (!style || style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0;
  };
  const focusElementIfVisible = (element) => {
    if (!isVisibleFocusTarget(element) || typeof element.focus !== "function") return false;
    element.focus({ preventScroll: true });
    return true;
  };
  const exportWorkflowController = createExportWorkflowController({
    state, document, t,
    renderPassNames: RENDER_PASS_NAMES,
    renderExportPassesToCanvas,
    assertPopulationHeatmapReadyForExport,
    ensurePopulationHeatmapReadyForExport,
    ensurePaintContoursReady,
    ensureBathymetryReadyForExport,
    ensureCountryLabelsReadyForExport,
    ensureScenarioPoliticalDetailForExport,
    closeDockPopover: (...args) => closeDockPopover(...args),
    closeScenarioGuide: () => {
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
        closeScenarioGuidePopover({ restoreFocus: false, syncUrl: false });
      }
    },
    syncSupportSurfaceUrlState,
    rememberOverlayTrigger,
    restoreOverlayTriggerFocus,
    focusOverlaySurface,
  });
  const {
    exportWorkbenchOverlay, exportWorkbenchPanel, dockExportBtn, exportProjectSection,
    setExportWorkbenchState, renderExportWorkbenchLayerList, syncExportWorkbenchControlsFromState,
  } = exportWorkflowController;
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
    transportWorkbenchPackSelect,
    transportWorkbenchPreviewMode,
    transportWorkbenchPreviewTitle,
    transportWorkbenchPreviewCanvas,
    transportWorkbenchPreviewControls,
    transportWorkbenchCarrierMount,
    transportWorkbenchLayerOrderPanel,
    transportWorkbenchLayerOrderList,
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
    dockQuickFillBtn,
    dockReferencePopover,
    dockEditPopover,
    dockQuickFillRow,
    quickFillParentBtn,
    quickFillCountryBtn,
    dockQuickFillHint,
    refreshPaintModeUi: () => {
      callRuntimeHook(runtimeState, "updatePaintModeUIFn");
    },
    t,
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
    ensureRightPanelVisible: () => callRuntimeHook(runtimeState, "toggleRightPanelFn", true),
    openExportWorkbench: (trigger = dockExportBtn) => callRuntimeHook(runtimeState, "openExportWorkbenchFn", trigger),
    closeExportWorkbench: ({ restoreFocus = true } = {}) => callRuntimeHook(runtimeState, "closeExportWorkbenchFn", { restoreFocus }),
  });
  const {
    bindQuickFillControls,
    refreshQuickFillControls,
    bindDockPopoverDismiss,
    closeDockPopover,
    closeScenarioGuidePopover,
    openDockPopover,
    restoreSupportSurfaceFromUrl,
    toggleScenarioGuidePopover,
  } = workspaceChromeSupportSurfaceController;
  registerRuntimeHook(state, "restoreSupportSurfaceFromUrlFn", restoreSupportSurfaceFromUrl);
  registerRuntimeHook(state, "closeDockPopoverFn", closeDockPopover);

  const drawerMedia = globalThis.matchMedia("(max-width: 1023px)");
  const drawerBackdrop = document.getElementById("sidebarDrawerBackdrop");
  const getDrawerFocusTargets = (side) => Array.from(
    document.getElementById(`${side}Sidebar`)?.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]'
    ) || []
  ).filter((element) => element.tabIndex >= 0
    && !element.closest('[inert], [aria-hidden="true"]')
    && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== "hidden"
    && (() => {
      // Closed details may retain layout boxes, but only their summary is focusable.
      for (let details = element.closest("details"); details; details = details.parentElement?.closest("details")) {
        if (!details.open && !details.querySelector("summary")?.contains(element)) return false;
      }
      return true;
    })());
  const syncPanelToggleButtons = () => {
    leftPanelToggle?.setAttribute("aria-expanded", String(document.body.classList.contains("left-drawer-open")));
    rightPanelToggle?.setAttribute("aria-expanded", String(document.body.classList.contains("right-drawer-open")));
    document.getElementById("editorInspectorToggleBtn")?.setAttribute("aria-expanded", String(
      drawerMedia.matches
        ? document.body.classList.contains("right-drawer-open")
        : !document.body.classList.contains("right-sidebar-collapsed")
    ));
    let openDrawer = false;
    for (const side of ["left", "right"]) {
      const sidebar = document.getElementById(`${side}Sidebar`);
      const open = document.body.classList.contains(`${side}-drawer-open`);
      if (sidebar) sidebar.inert = drawerMedia.matches && !open;
      openDrawer ||= open;
    }
    drawerBackdrop?.classList.toggle("hidden", !drawerMedia.matches || !openDrawer);
  };
  const focusDrawer = (side, open) => {
    if (!drawerMedia.matches) return;
    const sidebar = document.getElementById(`${side}Sidebar`);
    const toggle = side === "left" ? leftPanelToggle : rightPanelToggle;
    if (open) getDrawerFocusTargets(side)[0]?.focus({ preventScroll: true });
    else if (sidebar?.contains(document.activeElement)) toggle?.focus({ preventScroll: true });
  };
  drawerMedia.addEventListener("change", () => {
    const active = document.activeElement;
    if (!drawerMedia.matches) {
      document.body.classList.remove("left-drawer-open", "right-drawer-open");
    }
    syncPanelToggleButtons();
    for (const side of ["left", "right"]) {
      const sidebar = document.getElementById(`${side}Sidebar`);
      if (sidebar?.inert && sidebar.contains(active)) {
        restoreFocusOrigin(side === "left" ? leftPanelToggle : rightPanelToggle);
      }
    }
  });

  const toggleLeftPanel = (force) => {
    // transport workbench 打开时，左右抽屉继续展开会和 workbench 抢同一块侧边布局。
    // 这里直接把面板切换收口成单一入口，保证 chrome 状态始终只有一种主布局。
    if (runtimeState.transportWorkbenchUi?.open && force !== false) {
      return false;
    }
    closeDockPopover();
    const next = typeof force === "boolean" ? force : !document.body.classList.contains("left-drawer-open");
    document.body.classList.toggle("left-drawer-open", next);
    document.body.classList.toggle("right-drawer-open", false);
    syncPanelToggleButtons();
    focusDrawer("left", next);
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
    focusDrawer("right", next);
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

  // runtime hooks 是 toolbar 壳层暴露给其他 owner 的控制平面。
  // 其他模块通过这些窄入口开关 export/workbench，避免反向 import 具体 controller 并把 DOM 依赖扩散出去。
  registerRuntimeHook(state, "openExportWorkbenchFn", (trigger = dockExportBtn) => {
    setExportWorkbenchState(true, { trigger });
    return true;
  });
  registerRuntimeHook(state, "closeExportWorkbenchFn", ({ restoreFocus = true } = {}) => {
    setExportWorkbenchState(false, { restoreFocus });
    return false;
  });

  const fetchForSampleProjects = typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : null;
  const getCommittedSampleProjectId = () => {
    const sampleState = runtimeState.sampleProjectDeeplink || {};
    return String(sampleState.status || "") === "success"
      ? String(sampleState.sampleId || "").trim()
      : String(sampleState.previousSampleId || "").trim();
  };
  const resolveExportWorkbenchFocusReturnTrigger = (trigger) => {
    if (!(trigger instanceof HTMLElement)) return trigger;
    if (!trigger.closest?.("#scenarioGuidePopover")) return trigger;
    if (isVisibleFocusTarget(utilitiesGuideBtn)) return utilitiesGuideBtn;
    if (isVisibleFocusTarget(scenarioGuideBtn)) return scenarioGuideBtn;
    return trigger;
  };
  const resolveScenarioGuideFocusReturnTrigger = (trigger) => {
    if (isVisibleFocusTarget(trigger)) return trigger;
    if (isVisibleFocusTarget(utilitiesGuideBtn)) return utilitiesGuideBtn;
    if (isVisibleFocusTarget(scenarioGuideBtn)) return scenarioGuideBtn;
    return trigger;
  };
  const focusCommittedSampleGuideChoice = (fallback = null) => {
    const committedSampleId = getCommittedSampleProjectId();
    const choices = Array.from(scenarioGuideSampleProjectChoices?.querySelectorAll?.("[data-sample-guide-choice]") || []);
    const selectedChoice = choices.find((choice) => (
      String(choice?.dataset?.sampleGuideChoice || "") === committedSampleId
    ));
    const focusTarget = selectedChoice || fallback || scenarioGuideSampleProjectOpenExportBtn || scenarioGuideCloseBtn;
    focusElementIfVisible(focusTarget);
  };
  const scheduleSampleGuideChoiceFocusRestore = (fallback = null) => {
    const restoreFocus = () => {
      if (scenarioGuidePopover?.classList.contains("hidden")) {
        toggleScenarioGuidePopover(resolveScenarioGuideFocusReturnTrigger(fallback));
      }
      renderScenarioGuideSection("quick");
      focusCommittedSampleGuideChoice(fallback);
    };
    const runAfterFrame = () => {
      if (typeof globalThis.setTimeout === "function") {
        globalThis.setTimeout(restoreFocus, 0);
        return;
      }
      restoreFocus();
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => {
        if (typeof globalThis.requestAnimationFrame === "function") {
          globalThis.requestAnimationFrame(runAfterFrame);
          return;
        }
        runAfterFrame();
      });
      return;
    }
    runAfterFrame();
  };

  const sampleProjectBannerController = createSampleProjectBannerController(runtimeState, {
    root: sampleProjectBanner,
    titleNode: sampleProjectBannerTitle,
    bodyNode: sampleProjectBannerBody,
    openExportButton: sampleProjectBannerOpenExportBtn,
    downloadOriginalLink: sampleProjectBannerDownloadOriginalLink,
    dismissButton: sampleProjectBannerDismissBtn,
    t,
    openExportWorkbench: (trigger = sampleProjectBannerOpenExportBtn) => (
      callRuntimeHook(runtimeState, "openExportWorkbenchFn", resolveExportWorkbenchFocusReturnTrigger(trigger))
    ),
  });
  const sampleProjectGuideCardController = createSampleProjectGuideCardController(runtimeState, {
    root: scenarioGuideSampleProjectCard,
    titleNode: scenarioGuideSampleProjectTitle,
    bodyNode: scenarioGuideSampleProjectBody,
    recommendationNode: scenarioGuideSampleProjectRecommendation,
    openExportButton: scenarioGuideSampleProjectOpenExportBtn,
    downloadOriginalLink: scenarioGuideSampleProjectDownloadOriginalLink,
    continueButton: scenarioGuideSampleProjectContinueBtn,
    sampleListNode: scenarioGuideSampleProjectChoices,
    sampleListStatusNode: scenarioGuideSampleProjectStatus,
    t,
    openExportWorkbench: (trigger = scenarioGuideSampleProjectOpenExportBtn) => (
      callRuntimeHook(runtimeState, "openExportWorkbenchFn", resolveExportWorkbenchFocusReturnTrigger(trigger))
    ),
    continueWithDefaultGuide: () => {
      renderScenarioGuideSection("quick");
      document.getElementById("scenarioGuideStepApply")?.scrollIntoView?.({ block: "nearest" });
    },
    onSampleChoice: async (sampleId, trigger = null) => {
      const normalizedSampleId = String(sampleId || "").trim();
      if (!normalizedSampleId) return;
      if (
        String(runtimeState.sampleProjectDeeplink?.status || "") === "success"
        && getCommittedSampleProjectId() === normalizedSampleId
      ) {
        return;
      }
      if (runtimeState.isDirty) {
        const confirmed = await showAppDialog({
          title: t("Load another sample?", "ui"),
          message: t("Loading another sample replaces the current workspace.", "ui"),
          details: t("Export or save your current work before continuing if you want to keep it.", "ui"),
          confirmLabel: t("Load Sample", "ui"),
          cancelLabel: t("Keep Current Project", "ui"),
          tone: "warning",
        });
        if (!confirmed) {
          sampleProjectGuideCardController.setSwitcherState({ status: "idle" });
          scheduleSampleGuideChoiceFocusRestore(trigger);
          return;
        }
      }
      sampleProjectGuideCardController.setSwitcherState({
        status: "loading",
        activeSampleId: normalizedSampleId,
      });
      const result = await loadPublicSampleProjectIntoRuntime(normalizedSampleId, {
        targetState: state,
        helpers: {
          fetchImpl: fetchForSampleProjects,
          ui: {
            t,
            showToast,
            showAppDialog,
          },
          hooks: {
            refreshColorState,
          },
          showToast,
        },
      });
      if (result?.ok) {
        syncSampleProjectUrlState(result.sampleProject?.id || normalizedSampleId);
        sampleProjectGuideCardController.setSwitcherState({ status: "idle" });
        updateDirtyIndicator();
        scheduleSampleGuideChoiceFocusRestore(trigger);
        return;
      }
      sampleProjectGuideCardController.setSwitcherState({
        status: "error",
        message: t(result?.error?.userMessage || "The selected sample project could not be opened.", "ui"),
      });
      updateDirtyIndicator();
      scheduleSampleGuideChoiceFocusRestore(trigger);
    },
  });
  sampleProjectBannerController.bindEvents();
  sampleProjectGuideCardController.bindEvents();
  const refreshSampleProjectSurfaces = () => {
    sampleProjectBannerController.render();
    sampleProjectGuideCardController.render();
  };
  registerRuntimeHook(state, "refreshSampleProjectBannerFn", refreshSampleProjectSurfaces);
  sampleProjectBannerController.render();
  sampleProjectGuideCardController.render();
  void loadPublicSampleProjectList({ fetchImpl: fetchForSampleProjects })
    .then((sampleProjects) => {
      sampleProjectGuideCardController.setSampleProjects(sampleProjects);
    })
    .catch((error) => {
      console.warn("[sample-project] Unable to load public sample list.", error);
      sampleProjectGuideCardController.setSwitcherState({
        status: "error",
        message: t("The sample project list could not be loaded.", "ui"),
      });
    });

  registerRuntimeHook(state, "openTransportWorkbenchFn", (trigger = null) => openTransportWorkbench(trigger));
  registerRuntimeHook(state, "closeTransportWorkbenchFn", ({ restoreFocus = true } = {}) => (
    closeTransportWorkbench({ restoreFocus })
  ));
  registerRuntimeHook(state, "refreshTransportWorkbenchUiFn", renderTransportWorkbenchUi);
  initializeTransportWorkbenchRuntime();

  const getPaintModeLabel = () => t("Visual Color", "ui");

  const getPrimaryActionLabel = () => t("Auto-Fill Visuals", "ui");

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
      return `${getDirectGeoLabel(label) || label} (${selectedCode})`;
    }

    return t("No selection", "ui");
  };

  let renderOceanCoastalAccentUiForWorkspace = () => {};
  let handlePaletteLibraryResizeForWorkspace = () => {};
  const scenarioContextBarController = createScenarioContextBarController({
    runtimeState,
    scenarioContextBar,
    scenarioContextCollapseBtn,
    scenarioContextScenarioText,
    scenarioContextModeText,
    scenarioContextActiveText,
    scenarioContextSelectionItem,
    scenarioContextSelectionText,
    scenarioTransportWorkbenchBtn,
    scenarioGuidePopover,
    mapContainer,
    zoomControls,
    getPaintModeLabel,
    getWorkspaceSelectionLabel,
    syncScenarioGuideTriggerButtons,
    updateLanguageToggleUi,
    renderOceanCoastalAccentUi: () => renderOceanCoastalAccentUiForWorkspace(),
    applyResponsiveChromeDefaults,
    updateDockCollapsedUi: () => updateDockCollapsedUi(),
    handlePaletteLibraryResize: () => handlePaletteLibraryResizeForWorkspace(),
    translate: t,
  });
  const {
    bindResponsiveChromeLayout,
    bindScenarioContextBarEvents,
    refreshScenarioContextBar,
    refreshWorkspaceStatus,
    triggerScenarioGuide,
  } = scenarioContextBarController;
  registerRuntimeHook(state, "triggerScenarioGuideFn", triggerScenarioGuide);

  const refreshPaintControlsLayout = () => {
    const isScenarioMode = !!runtimeState.activeScenarioId;
    const showBorderMaintenance = isScenarioMode;
    const primaryActionLabel = getPrimaryActionLabel();

    if (document.getElementById("labelPresetPolitical")) {
      document.getElementById("labelPresetPolitical").textContent = primaryActionLabel;
    }
    if (presetPolitical) {
      presetPolitical.setAttribute("aria-label", primaryActionLabel);
      presetPolitical.setAttribute("title", primaryActionLabel);
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
      setUiIcon(dockHandleChevron, runtimeState.ui.dockCollapsed ? "chevron-up" : "chevron-down");
    }
    if (dockHandleLabel) {
      dockHandleLabel.textContent = runtimeState.ui.dockCollapsed ? t("Expand", "ui") : t("Collapse", "ui");
    }
  };

  const closeSpecialZonePopover = () => {
    if (!specialZonePopover || specialZoneEditorInline) return;
    specialZonePopover.classList.add("hidden");
    specialZonePopover.setAttribute("aria-hidden", "true");
    appearanceSpecialZoneBtn?.classList.remove("is-active");
    appearanceSpecialZoneBtn?.setAttribute("aria-expanded", "false");
    appearanceSpecialZoneBtn?.focus?.();
  };

  const openSpecialZonePopover = async () => {
    if (!specialZonePopover || specialZoneEditorInline) return;
    const willOpen = specialZonePopover.classList.contains("hidden");
    if (!willOpen) {
      closeSpecialZonePopover();
      return;
    }
    await specialZonesWorkbenchController?.loadScenarioSpecialZoneLayers?.();
    rememberOverlayTrigger(specialZonePopover, appearanceSpecialZoneBtn);
    specialZonePopover.classList.remove("hidden");
    specialZonePopover.setAttribute("aria-hidden", "false");
    appearanceSpecialZoneBtn?.classList.add("is-active");
    appearanceSpecialZoneBtn?.setAttribute("aria-expanded", "true");
    focusOverlaySurface(specialZonePopover);
    specialZonesWorkbenchController?.focusSpecialZonesWorkbench?.();
  };

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

  const showToolHud = (message) => {
    if (!toolHudChip || !message) return;
    toolHudChip.textContent = "";
    toolHudChip.classList.remove("is-visible");
    toolHudChip.classList.add("hidden", "is-hidden");
    if (toolHudTimerId) {
      globalThis.clearTimeout(toolHudTimerId);
      toolHudTimerId = 0;
    }
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
        : tool === "select"
          ? "Select tool"
          : "Fill",
    "ui"
  );

  const setToolCursorClass = () => {
    if (!mapContainer) return;
    mapContainer.classList.remove("tool-select", "tool-fill", "tool-eraser", "tool-eyedropper", "tool-special-zone", "tool-pan-override");
    if (runtimeState.specialZoneEditor?.active || runtimeState.currentTool === "special-zone-membership") {
      mapContainer.classList.add("tool-special-zone");
      return;
    }
    if (runtimeState.brushModeEnabled && runtimeState.brushPanModifierActive) {
      mapContainer.classList.add("tool-pan-override");
      return;
    }
    mapContainer.classList.add(`tool-${runtimeState.currentTool || "select"}`);
  };

  const renderDirty = (reason) => {
    markDirty(reason);
    if (render) render();
  };

  const addRecentColor = (color) => {
    const normalized = normalizeHexColor(color);
    if (!normalized || normalizeHexColor(runtimeState.recentColors?.[0]) === normalized) return;
    runtimeState.recentColors = (Array.isArray(runtimeState.recentColors) ? runtimeState.recentColors : [])
      .filter((value) => normalizeHexColor(value) !== normalized);
    runtimeState.recentColors.unshift(normalized);
    runtimeState.recentColors = runtimeState.recentColors.slice(0, 10);
    callRuntimeHook(state, "updateRecentUI");
  };

  const { applyColor: applyPaletteLibraryOperation } = composePaletteLibraryOperation();

  const applyPaletteLibraryColor = (rawColor) => {
    const result = applyPaletteLibraryOperation(rawColor);
    if (result.status === "no-target") {
      showToast(t("Select or hover a land feature first.", "ui"), {
        title: t("Color Library", "ui"),
        tone: "info",
        duration: 2400,
      });
    }
    if (result.status !== "applied") return false;
    addRecentColor(result.color);
    updateSwatchUI();
    if (render) render();
    return true;
  };

  const refreshActiveSovereignLabel = () => {
    const code = String(runtimeState.activeSovereignCode || "").trim().toUpperCase();
    if (activeSovereignLabel) {
      if (!code) {
        activeSovereignLabel.textContent = t("None selected", "ui");
      } else {
        const label = String(runtimeState.countryNames?.[code] || code).trim() || code;
        activeSovereignLabel.textContent = `${getDirectGeoLabel(label) || label} (${code})`;
      }
    }
    refreshScenarioContextBar();
    refreshWorkspaceStatus();
    callRuntimeHook(runtimeState, "renderPresetTreeFn");
  };
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
  const riverCellPicker = createRiverCellPicker({
    state: runtimeState,
    panel: document.getElementById("riverCellPicker"),
    select: document.getElementById("riverCellSelect"),
    preview: document.getElementById("riverCellPreview"),
    applyButton: document.getElementById("riverCellApplyBtn"),
    title: document.getElementById("riverCellPickerTitle"),
    closeButton: document.getElementById("riverCellCloseBtn"),
    caption: document.getElementById("riverCellPreviewCaption"),
    applyCell: applyRiverPaintCellById,
    announce: message => showToast(message),
  });
  const riverPaintControls = createRiverPaintControls({
    state: runtimeState,
    button: document.getElementById("riverPaintToggleBtn"),
    statusNode: document.getElementById("riverPaintStatus"),
    navigationPanel: document.getElementById("riverPaintNavigation"),
    searchInput: document.getElementById("riverPaintSearchInput"),
    riverSelect: document.getElementById("riverPaintRiverSelect"),
    resultsNode: document.getElementById("riverPaintLocationResults"),
    locationButton: document.getElementById("riverPaintLocationGoBtn"),
    locationSelect: document.getElementById("riverPaintLocationSelect"),
    focusParent: focusRiverPaintParentById,
    onLocation: riverCellPicker.open,
    onSync: riverCellPicker.sync,
    rebuildGeometry: () => setMapData({ refitProjection: false, resetZoom: false }),
    render: () => { if (typeof render === "function") render(); },
    markDirty,
    announce: (message) => showToast(message),
  });
  const refreshPaintModeUi = () => {
    runtimeState.paintMode = normalizePaintMode(runtimeState.paintMode);
    runtimeState.ui.politicalEditingExpanded = false;
    if (paintModeVisualBtn) {
      paintModeVisualBtn.classList.add("is-active");
      paintModeVisualBtn.setAttribute("aria-pressed", "true");
    }
    riverPaintControls.sync();
    refreshPaintControlsLayout();
    refreshActiveSovereignLabel();
    refreshDynamicBorderStatus();
    refreshWorkspaceStatus();
    updateDockCollapsedUi();
  };
  const normalizeOceanPreset = (value) => {
    const candidate = String(value || "bathymetry_soft").trim().toLowerCase();
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
    return normalizeHexColor(value, "#aadaff");
  };
  const normalizeHexColor = (value, fallbackColor) => {
    const candidate = String(value || "").trim();
    if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate;
    if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
      return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`;
    }
    return fallbackColor;
  };
  if (!runtimeState.styleConfig.ocean || typeof runtimeState.styleConfig.ocean !== "object") {
    runtimeState.styleConfig.ocean = {};
  }
  runtimeState.styleConfig.ocean.preset = normalizeOceanPreset(runtimeState.styleConfig.ocean.preset || "bathymetry_soft");
  runtimeState.styleConfig.ocean.experimentalAdvancedStyles = runtimeState.styleConfig.ocean.experimentalAdvancedStyles ?? true;
  if (!runtimeState.styleConfig.ocean.experimentalAdvancedStyles && OCEAN_ADVANCED_PRESETS.has(runtimeState.styleConfig.ocean.preset)) {
    runtimeState.styleConfig.ocean.preset = "flat";
  }
  runtimeState.styleConfig.ocean.coastalAccentEnabled = runtimeState.styleConfig.ocean.coastalAccentEnabled !== false;
  runtimeState.styleConfig.ocean.fillColor = normalizeOceanFillColor(runtimeState.styleConfig.ocean.fillColor);
  runtimeState.styleConfig.ocean.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.opacity)) ? Number(runtimeState.styleConfig.ocean.opacity) : 0.9,
    0,
    1
  );
  runtimeState.styleConfig.ocean.scale = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.scale)) ? Number(runtimeState.styleConfig.ocean.scale) : 1.25,
    0.6,
    2.4
  );
  runtimeState.styleConfig.ocean.contourStrength = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.contourStrength))
      ? Number(runtimeState.styleConfig.ocean.contourStrength)
      : 0,
    0,
    1
  );
  runtimeState.styleConfig.lakes = normalizeLakeStyleConfig(runtimeState.styleConfig.lakes);
  if (!runtimeState.styleConfig.internalBorders || typeof runtimeState.styleConfig.internalBorders !== "object") {
    runtimeState.styleConfig.internalBorders = {};
  }
  runtimeState.styleConfig.internalBorders.color = normalizeHexColor(
    runtimeState.styleConfig.internalBorders.color,
    "#cccccc"
  );
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
  runtimeState.styleConfig.empireBorders.color = normalizeHexColor(
    runtimeState.styleConfig.empireBorders.color,
    "#4b5563"
  );
  runtimeState.styleConfig.empireBorders.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.empireBorders.opacity))
      ? Number(runtimeState.styleConfig.empireBorders.opacity)
      : 0.9,
    0,
    1
  );
  runtimeState.styleConfig.empireBorders.width = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.empireBorders.width))
      ? Number(runtimeState.styleConfig.empireBorders.width)
      : 1.2,
    0.01,
    5
  );
  if (!runtimeState.styleConfig.coastlines || typeof runtimeState.styleConfig.coastlines !== "object") {
    runtimeState.styleConfig.coastlines = {};
  }
  runtimeState.styleConfig.coastlines.color = normalizeHexColor(
    runtimeState.styleConfig.coastlines.color,
    "#333333"
  );
  runtimeState.styleConfig.coastlines.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.coastlines.opacity))
      ? Number(runtimeState.styleConfig.coastlines.opacity)
      : 0.8,
    0,
    1
  );
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
    runtimeState.styleConfig.parentBorders.color || PARENT_BORDER_STYLE_DEFAULTS.color
  );
  runtimeState.styleConfig.parentBorders.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.parentBorders.opacity))
      ? Number(runtimeState.styleConfig.parentBorders.opacity)
      : PARENT_BORDER_STYLE_DEFAULTS.opacity,
    0,
    1
  );
  runtimeState.styleConfig.parentBorders.width = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.parentBorders.width))
      ? Number(runtimeState.styleConfig.parentBorders.width)
      : PARENT_BORDER_STYLE_DEFAULTS.width,
    0.2,
    4
  );
  if (!runtimeState.parentBorderEnabledByCountry || typeof runtimeState.parentBorderEnabledByCountry !== "object") {
    runtimeState.parentBorderEnabledByCountry = {};
  }
  setAppearanceVisibilityState(runtimeState, "parentBordersVisible", runtimeState.parentBordersVisible !== false);

  const paletteCountryEditor = createPaletteCountryEditor({
    state: runtimeState,
    host: paletteLibraryPanel,
    applyColor: (color, countryCode) => {
      if (!countryCode) return { status: "no-target" };
      const result = applyPaletteLibraryOperation(color, { countryCode });
      if (result.status === "applied") {
        addRecentColor(result.color);
        updateSwatchUI();
        if (render) render();
      }
      return result;
    },
  });
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
    requestPaletteLibraryRender,
    syncPaletteSourceControls,
    syncPanelVisibility: syncPaletteLibraryPanelVisibility,
  } = paletteLibraryPanelController;
  handlePaletteLibraryResizeForWorkspace = handlePaletteLibraryResize;
  registerRuntimeHook(state, "updatePaletteSourceUIFn", syncPaletteSourceControls);
  registerRuntimeHook(state, "renderPaletteFn", renderPalette);

  registerRuntimeHook(state, "updatePaletteLibraryUIFn", () => {
    renderPaletteLibrary();
    paletteCountryEditor.render();
  });

  function renderSpecialZoneEditorUI() {
    renderAppearanceStyleControlsUi();
    specialZoneEditorController.renderSpecialZoneEditorUI();
    specialZonesWorkbenchController.renderSpecialZonesWorkbenchUi();
    updateToolUI();
  }
  registerRuntimeHook(state, "updateSpecialZoneEditorUIFn", renderSpecialZoneEditorUI);

  function updateSwatchUI() {
    paletteCountryEditor.render();
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

  const toolGuidance = createToolGuidance({ state: runtimeState, t });
  function updateToolUI() {
    toolButtons.forEach((button) => {
      const isActive = button.dataset.tool === runtimeState.currentTool;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    const disableBrush = runtimeState.currentTool === "eyedropper"
      || runtimeState.currentTool === "special-zone-membership"
      || !!runtimeState.specialZoneEditor?.active;
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
    toolGuidance.sync();
    updateDirtyIndicator();
  }
  registerRuntimeHook(state, "updateToolUIFn", updateToolUI);

  const appearanceControlsController = createAppearanceControlsController({
    runtimeState: state,
    t,
    translateGeo: getDirectGeoLabel,
    clamp,
    markDirty,
    requestRender: () => {
      if (render) render();
    },
    ensureActiveScenarioOptionalLayerLoaded,
    normalizeOceanFillColor,
    updateSwatchUI,
    openSpecialZonePopover,
  });
  const {
    bindEvents: bindAppearanceControlEvents,
    clearReferenceImage,
    renderAppearanceStyleControlsUi,
    renderBorderUi,
    renderDayNightUI,
    renderParentBorderCountryList,
    renderRecentColors,
    renderReferenceOverlayUi,
    renderTextureUI,
    renderTransportAppearanceUi,
    renderLayerStatusSummaries,
    setAppearanceTab: setAppearanceTabController,
    syncParentBorderVisibilityUI,
  } = appearanceControlsController;
  registerRuntimeHook(state, "clearReferenceImageFn", clearReferenceImage);
  registerRuntimeHook(state, "updateTransportAppearanceUIFn", renderTransportAppearanceUi);
  // Recent colors feed only the recent strip and the library's recent group.
  // The full library rebuild waits until after the paint input's frame, and while
  // the library is hidden it waits until the library is shown.
  registerRuntimeHook(state, "updateRecentUI", () => {
    renderRecentColors();
    requestPaletteLibraryRender();
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
    requestLayerStatusRefresh: renderLayerStatusSummaries,
  });
  const {
    applyAutoFillOceanColor,
    bindEvents: bindOceanLakeControlEvents,
    renderOceanCoastalAccentUi,
    renderOceanLakeControlsUi,
  } = oceanLakeControlsController;
  renderOceanCoastalAccentUiForWorkspace = renderOceanCoastalAccentUi;
  renderOceanLakeControlsUi();
  registerRuntimeHook(state, "updateWorkspaceStatusFn", refreshWorkspaceStatus);
  registerRuntimeHook(state, "updateScenarioContextBarFn", refreshScenarioContextBar);
  registerRuntimeHook(state, "updateActiveSovereignUIFn", refreshActiveSovereignLabel);
  registerRuntimeHook(state, "updatePaintModeUIFn", refreshPaintModeUi);

  const specialZoneEditorController = createSpecialZoneEditorController({
    runtimeState: state,
    specialZoneEditorHint,
    renderTransportAppearanceUi,
    t,
  });
  specialZoneEditorController.normalizeSpecialZoneEditorState();
  const specialZonesWorkbenchController = createSpecialZonesWorkbenchController({
    runtimeState: state,
    container: specialZonePopover,
    markDirty,
    render,
    updateToolUI,
    captureHistoryState,
    pushHistoryEntry,
    ensureActiveScenarioOptionalLayerLoaded,
    showToast,
    t,
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
    const nextTool = tool || "select";
    runtimeState.currentTool = nextTool;
    if (nextTool === "eyedropper" || nextTool === "select") {
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
    if (runtimeState.brushModeEnabled && (runtimeState.currentTool === "eyedropper" || runtimeState.currentTool === "select")) {
      runtimeState.currentTool = "fill";
    }
    updateToolUI();
    if (dismissHint) {
      dismissOnboardingHint();
    }
    emitTransientFeedback(t(
      runtimeState.brushModeEnabled
        ? globalThis.matchMedia?.("(pointer: coarse)")?.matches
          ? "Brush On · Drag to paint · Use two fingers or Shift+Drag to pan"
          : "Brush On · Shift+Drag to pan"
        : "Brush Off",
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
    resetZoomToFit({ animate: true });
  };

  registerRuntimeHook(state, "runToolSelectionFn", runToolSelection);
  registerRuntimeHook(state, "runBrushModeToggleFn", runBrushModeToggle);
  registerRuntimeHook(state, "runHistoryActionFn", runHistoryAction);
  registerRuntimeHook(state, "runZoomStepFn", runZoomStep);
  registerRuntimeHook(state, "runZoomResetFn", runZoomReset);
  registerRuntimeHook(state, "commitZoomInputValueFn", commitZoomInputValue);

  registerRuntimeHook(state, "updateToolbarInputsFn", () => {
    renderBorderUi();
    syncParentBorderVisibilityUI();
    renderOceanLakeControlsUi();
    if (themeSelect) {
      syncPaletteSourceControls();
    }
    renderReferenceOverlayUi();
    syncExportWorkbenchControlsFromState();
    renderTextureUI();
    renderDayNightUI();
    renderSpecialZoneEditorUI();
    updateLanguageToggleUi();
  });
  registerRuntimeHook(state, "updateTextureUIFn", renderTextureUI);

  if (customColor) {
    customColor.addEventListener("input", (event) => {
      selectPalettePaintColor(runtimeState, event.target.value);
      if (runtimeState.currentTool === "select") {
        callRuntimeHook(runtimeState, "runToolSelectionFn", "fill", { feedbackLabel: t("Switched to fill tool", "ui") });
      }
      updateSwatchUI();
    });
  }

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      runToolSelection(button.dataset.tool || "select");
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
      if (typeof customColor.showPicker === "function") {
        customColor.showPicker();
        return;
      }
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
      // Enter already committed; its UI refresh may still show the animation's
      // current scale. Do not replace the requested target with that value.
      if (zoomPercentInput.dataset.editing === "true") commitZoomInputValue();
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

  const closeDrawers = () => {
    const side = document.body.classList.contains("left-drawer-open") ? "left" : "right";
    if (side === "left") toggleLeftPanel(false);
    else toggleRightPanel(false);
    (side === "left" ? leftPanelToggle : rightPanelToggle)?.focus({ preventScroll: true });
  };
  drawerBackdrop?.addEventListener("click", closeDrawers);
  document.querySelectorAll("[data-close-drawer]").forEach((button) => {
    button.addEventListener("click", closeDrawers);
  });
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (!drawerMedia.matches || drawerBackdrop?.classList.contains("hidden")) return;
    // An open dialog owns Escape and focus until it closes.
    if (getActiveModal()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawers();
    } else if (event.key === "Tab") {
      const side = document.body.classList.contains("left-drawer-open") ? "left" : "right";
      const elements = getDrawerFocusTargets(side);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });

  exportWorkflowController.bindEntryEvents();

  bindTransportWorkbenchEvents();

  if (toggleLang && !toggleLang.dataset.bound) {
    toggleLang.addEventListener("click", toggleLanguage);
    toggleLang.dataset.bound = "true";
  }

  if (scenarioGuideLanguageToggle && !scenarioGuideLanguageToggle.dataset.bound) {
    scenarioGuideLanguageToggle.addEventListener("click", toggleLanguage);
    scenarioGuideLanguageToggle.dataset.bound = "true";
  }

  if (developerModeBtn && !developerModeBtn.dataset.bound) {
    developerModeBtn.addEventListener("click", () => {
      callRuntimeHook(runtimeState, "toggleDeveloperModeFn");
    });
    developerModeBtn.dataset.bound = "true";
  }

  [paintModeVisualBtn].forEach((button) => {
    if (!button || button.dataset.bound === "true") return;
    button.addEventListener("click", () => {
      const nextMode = normalizePaintMode(button.dataset.paintMode);
      runtimeState.paintMode = nextMode;
      runtimeState.ui.politicalEditingExpanded = false;
      markDirty?.("paint-mode");
      callRuntimeHook(runtimeState, "updatePaintModeUIFn");
      if (typeof render === "function") {
        render();
      }
    });
    button.dataset.bound = "true";
  });

  exportWorkflowController.bindWorkbenchEvents();

  if (dockCollapseBtn && !dockCollapseBtn.dataset.bound) {
    dockCollapseBtn.addEventListener("click", () => {
      toggleDock();
    });
    dockCollapseBtn.dataset.bound = "true";
  }

  bindQuickFillControls();

  bindScenarioContextBarEvents();

  bindScenarioGuideEvents({
    onToggle: (trigger) => {
      toggleScenarioGuidePopover(trigger);
    },
    onClose: () => {
      closeScenarioGuidePopover({ restoreFocus: true });
    },
  });

  document.getElementById("scenarioGuideSelectCountryBtn")?.addEventListener("click", () => {
    closeScenarioGuidePopover({ restoreFocus: false });
    document.getElementById("editorObjects-countries")?.click();
    if (globalThis.matchMedia("(max-width: 1023px)").matches) {
      toggleLeftPanel(true);
    } else if (document.body.classList.contains("left-sidebar-collapsed")) {
      document.getElementById("leftSidebarCollapseBtn")?.click();
    }
    document.getElementById("countrySearch")?.focus({ preventScroll: true });
    document.getElementById("countrySearch")?.scrollIntoView({ block: "nearest" });
  });

  bindDockPopoverDismiss();
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(() => {
      restoreSupportSurfaceFromUrl();
    });
  });

  renderTextureUI();
  renderDayNightUI();

  bindAppearanceControlEvents();
  bindOceanLakeControlEvents();
  specialZoneEditorController.bindSpecialZoneEditorEvents();
  specialZonesWorkbenchController.bindSpecialZonesWorkbenchEvents();

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
          "This removes current paint overrides. You can undo the clear from history.",
          "ui"
        ),
        confirmLabel: t("Clear Map", "ui"),
        cancelLabel: t("Keep Current Map", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      const featureIds = [...new Set([
        ...Object.keys(runtimeState.visualOverrides || {}),
        ...getEditedRiverParentIds(runtimeState.riverPaint),
      ])];
      const ownerCodes = Array.from(new Set([
        ...Object.keys(runtimeState.sovereignBaseColors || {}),
      ]));
      const before = captureHistoryState({
        featureIds,
        ownerCodes,
      });
      runtimeState.colors = {};
      runtimeState.visualOverrides = {};
      clearAllRiverPaintOverridesState(runtimeState);
      runtimeState.sovereignBaseColors = {};
      refreshColorState({ renderNow: true });
      refreshActiveSovereignLabel();
      refreshDynamicBorderStatus();
      markDirty("clear-map");
      const clearEntry = pushHistoryEntry({
        kind: "clear-map",
        before,
        after: captureHistoryState({
          featureIds,
          ownerCodes,
        }),
      }) ? getLatestHistoryEntry() : null;
      showToast(t("Map cleared. Undo is available from history.", "ui"), {
        title: t("Clear Map", "ui"),
        tone: "warning",
        actionLabel: clearEntry ? t("Undo", "ui") : "",
        onAction: !clearEntry ? null : () => {
          if (getLatestHistoryEntry() !== clearEntry) {
            showToast(t("Can't undo the clear because newer edits exist.", "ui"), { tone: "warning" });
            return;
          }
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

  bindResponsiveChromeLayout();

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
  setAppearanceTabController("borders");
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
  if (exportWorkbenchOverlay) {
    exportWorkbenchOverlay.setAttribute("aria-hidden", "true");
  }
  if (scenarioGuidePopover) {
    applyDialogContract(scenarioGuidePopover, {
      tone: "info",
      labelledBy: "scenarioGuideTitle",
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
  updateLanguageToggleUi();
}



export { initToolbar, resolveExportPassSequence };
